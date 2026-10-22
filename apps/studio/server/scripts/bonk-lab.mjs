// Explicit local developer launcher. Never starts the bot or the normal Core process.
import process from 'node:process';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const envText = await readFile(
  new URL('../../../core-api/.env', import.meta.url),
  'utf8',
);
const raw = envText
  .match(/^DATABASE_URL=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^(['"])(.*)\1$/, '$2');
const dbUrl = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname))
  throw new Error('local_database_required');
// Check dedicated ports before any database writes. Existing Studio and Core are never stopped.
const { createServer } = await import('node:net');
for (const port of [4301, 4101])
  await new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => s.close(resolve));
  });
dbUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: dbUrl.href });
await admin.connect();
try {
  if (
    !(
      await admin.query(
        "select 1 from pg_database where datname='raptoru_bonk_lab'",
      )
    ).rowCount
  )
    await admin.query('create database raptoru_bonk_lab');
} finally {
  await admin.end();
}
dbUrl.pathname = '/raptoru_bonk_lab';
const db = new pg.Client({ connectionString: dbUrl.href });
await db.connect();
try {
  await db.query('begin');
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  // Only the Lab migrations, in order: never the Wallet/Loyalty/Daily schema. Must equal
  // LAB_MIGRATIONS of apps/core-api/src/db/migration-scopes.ts (checked by the core-api tests).
  for (const migration of [
    '20260929120000_bonk_lab.sql',
    '20260930120000_bonk_lab_twitch.sql',
    '20261001120000_bonk_lab_third_party.sql',
    // Soundboard V2 Lab (same isolated Lab database).
    '20261002120000_sound_lab.sql',
    '20261003120000_sound_lab_custom_label.sql',
    '20261004120000_tts_lab.sql',
    '20261005120000_lab_moderation.sql',
    '20261006120000_tts_lab_cooldown_clear.sql',
    '20261007120000_moderation_d4.sql',
    '20261008120000_raffle_v2.sql',
    '20261009120000_raffle_scheduler.sql',
    '20261010120000_raffle_round_labels.sql',
    '20261011120000_commands_v2.sql',
    '20261012120000_commands_v2_invocations.sql',
    '20261013120000_commands_v2_steps.sql',
    '20261014120000_commands_v2_categories.sql',
    '20261015120000_lab_moderation_idempotency.sql',
    '20261016130000_lab_stream_session_twitch_id.sql',
    '20261017120000_bonk_lab_viewer_oauth.sql',
    '20261018120000_bonk_lab_volleys.sql',
    '20261019120000_cmd_steps_word_game.sql',
    '20261019130000_word_game_lab.sql',
    '20261020120000_mini_games_lab.sql',
    '20261021120000_mini_game_duels_lab.sql',
    '20261022120000_alerts_lab.sql',
    '20261023120000_alerts_lab_families.sql',
    '20261025120000_channel_points_lab.sql',
    '20261026120000_random_ban_lab.sql',
    '20261027120000_sub_wheel_lab.sql',
    '20261030120000_lab_ledger_channel_points.sql',
    '20261031140000_cmd_steps_win_announcements_lab.sql',
  ]) {
    if (
      (
        await db.query('select 1 from schema_migrations where name=$1', [
          migration,
        ])
      ).rowCount
    )
      continue;
    await db.query(
      await readFile(
        new URL(
          '../../../../supabase/migrations/' + migration,
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await db.query('insert into schema_migrations(name) values($1)', [
      migration,
    ]);
  }
  await db.query('commit');
} catch (e) {
  await db.query('rollback');
  throw e;
} finally {
  await db.end();
}
const secret = randomBytes(32).toString('hex');
const botEnv = await readFile(
  new URL('../../../twitch-bot/.env', import.meta.url),
  'utf8',
).catch(() => '');
const twitchApp = Object.fromEntries(
  botEnv
    .split(/\r?\n/)
    .map((l) =>
      /^(TWITCH_CLIENT_ID|TWITCH_CLIENT_SECRET|TWITCH_BROADCASTER_ID)=(.*)$/.exec(
        l.trim(),
      ),
    )
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^(['"])(.*)\1$/, '$2')]),
);
if (!twitchApp.TWITCH_CLIENT_ID || !twitchApp.TWITCH_CLIENT_SECRET)
  console.warn(
    'Twitch app missing in apps/twitch-bot/.env: Twitch emotes disabled, Twemoji only.',
  );
const children = [];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
};
for (const [path, extra] of [
  [
    'apps/core-api/dist/bonk-lab/local-server.js',
    {
      BONK_LAB_DATABASE_URL: dbUrl.href,
      // Twitch app of Raptoru 2.0 (read from the local bot .env): Lab Core only, never Studio.
      BONK_LAB_TWITCH_CLIENT_ID: twitchApp.TWITCH_CLIENT_ID ?? '',
      BONK_LAB_TWITCH_CLIENT_SECRET: twitchApp.TWITCH_CLIENT_SECRET ?? '',
      // Public channel id: 7TV/BTTV/FFZ channel sets (public APIs, no token).
      BONK_LAB_CHANNEL_TWITCH_ID: twitchApp.TWITCH_BROADCASTER_ID ?? '',
    },
  ],
  [
    'apps/studio/server/dist/index.js',
    {
      PORT: '4101',
      BONK_LAB_CORE_URL: 'http://127.0.0.1:4301',
      RAPTORU_ROOT: root,
      RAPTORU_DATA_ROOT: root,
      BONK_LAB_ONLY: '1',
    },
  ],
]) {
  const child = spawn(process.execPath, [path], {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, ...extra, BONK_LAB_SECRET: secret },
  });
  children.push(child);
  child.on('exit', stop);
  child.on('error', stop);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log(
  'Bonk Lab : http://127.0.0.1:4101/?tab=extension-lab — aucun bot, aucune économie réelle. Ctrl+C pour arrêter.',
);
