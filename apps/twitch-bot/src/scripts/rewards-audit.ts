import { readFileSync, writeFileSync } from 'node:fs';

// READ ONLY — the inventory of the channel's custom rewards on Twitch (docs/RECOMPENSES_TWITCH.md, phase 1):
// every reward, and which ones THIS Twitch app may manage (`only_manageable_rewards=true`: the rewards it created —
// the only ones whose redemptions it may refund, and that it may pause or edit). Two GET requests, nothing else:
// - the token is READ from the file given, never refreshed, never written (a refresh could rotate a grant another
//   process uses); an expired token stops the script with the way to get a fresh one;
// - no secret is printed or saved: the report holds the token's app id, login and scopes, and the rewards.
//   TWITCH_AUDIT_TOKEN_FILE=… [TWITCH_CLIENT_ID=…] npx tsx src/scripts/rewards-audit.ts [--out inventory.json]

const file = process.env.TWITCH_AUDIT_TOKEN_FILE;
if (!file) {
  console.error(
    'TWITCH_AUDIT_TOKEN_FILE est requis (le fichier de jeton du streamer, lu seulement).',
  );
  process.exit(1);
}
const token = (
  JSON.parse(readFileSync(file, 'utf8')) as { accessToken?: string }
).accessToken;
if (!token) {
  console.error('Aucun accessToken dans ce fichier.');
  process.exit(1);
}

const v = await fetch('https://id.twitch.tv/oauth2/validate', {
  headers: { authorization: `OAuth ${token}` },
});
if (v.status === 401) {
  console.error(
    'Jeton expiré ou révoqué. Ce script ne le rafraîchit jamais. Nouvelle autorisation, dans un fichier à part :\n' +
      '  TWITCH_BROADCASTER_TOKEN_FILE=.twitch-tokens.audit.json npm run twitch:auth -- --broadcaster',
  );
  process.exit(2);
}
const info = (await v.json()) as {
  client_id: string;
  login: string;
  user_id: string;
  scopes: string[];
  expires_in: number;
};
const clientId = process.env.TWITCH_CLIENT_ID || info.client_id;
console.log(
  `Jeton : ${info.login} (${info.user_id}) · application ${info.client_id} · expire dans ${Math.round(info.expires_in / 60)} min`,
);
console.log(`Droits : ${info.scopes.join(' ')}`);
if (
  !info.scopes.some(
    (s) =>
      s === 'channel:read:redemptions' || s === 'channel:manage:redemptions',
  )
) {
  console.error(
    'Il manque channel:read:redemptions (ou channel:manage:redemptions) : lecture impossible.',
  );
  process.exit(3);
}

interface Reward {
  id: string;
  title: string;
  cost: number;
  prompt: string;
  is_enabled: boolean;
  is_paused: boolean;
  is_in_stock: boolean;
  is_user_input_required: boolean;
  should_redemptions_skip_request_queue: boolean;
  global_cooldown_setting: {
    is_enabled: boolean;
    global_cooldown_seconds: number;
  };
  max_per_stream_setting: { is_enabled: boolean; max_per_stream: number };
  max_per_user_per_stream_setting: {
    is_enabled: boolean;
    max_per_user_per_stream: number;
  };
  redemptions_redeemed_current_stream: number | null;
}
const get = async (manageableOnly: boolean) => {
  const qs = new URLSearchParams({ broadcaster_id: info.user_id });
  if (manageableOnly) qs.set('only_manageable_rewards', 'true');
  const r = await fetch(
    `https://api.twitch.tv/helix/channel_points/custom_rewards?${qs}`,
    {
      headers: { authorization: `Bearer ${token}`, 'client-id': clientId },
    },
  );
  if (!r.ok)
    throw new Error(`Twitch ${r.status} : ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { data: Reward[] }).data;
};
const all = await get(false);
const mine = new Set((await get(true)).map((r) => r.id));
const rows = all
  .map((r) => ({
    id: r.id,
    title: r.title,
    cost: r.cost,
    enabled: r.is_enabled,
    paused: r.is_paused,
    user_input: r.is_user_input_required,
    skip_queue: r.should_redemptions_skip_request_queue,
    global_cooldown_s: r.global_cooldown_setting.is_enabled
      ? r.global_cooldown_setting.global_cooldown_seconds
      : 0,
    max_per_stream: r.max_per_stream_setting.is_enabled
      ? r.max_per_stream_setting.max_per_stream
      : null,
    max_per_user_per_stream: r.max_per_user_per_stream_setting.is_enabled
      ? r.max_per_user_per_stream_setting.max_per_user_per_stream
      : null,
    manageable_by_this_app: mine.has(r.id),
  }))
  .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
console.log(
  `\n${rows.length} récompenses · ${mine.size} gérables par l'application ${clientId}\n`,
);
for (const r of rows)
  console.log(
    [
      r.manageable_by_this_app ? 'GÉRABLE ' : 'lecture ',
      r.enabled ? (r.paused ? 'pause' : 'active') : 'désact.',
      String(r.cost).padStart(7),
      r.title,
      r.global_cooldown_s ? `cooldown ${r.global_cooldown_s}s` : '',
      r.skip_queue ? 'validée auto' : '',
      r.id,
    ]
      .filter(Boolean)
      .join(' · '),
  );
const out = process.argv.indexOf('--out');
if (out > 0 && process.argv[out + 1]) {
  writeFileSync(
    process.argv[out + 1]!,
    JSON.stringify(
      {
        read_at: new Date().toISOString(),
        app: clientId,
        broadcaster: info.login,
        rewards: rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nInventaire écrit : ${process.argv[out + 1]} (aucun secret)`);
}
