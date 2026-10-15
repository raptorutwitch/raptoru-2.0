// Assembles the exact content of the packaged app in stage/app (then packed by electron-builder):
// compiled dist folders only, the SQL migrations, and the production dependencies. Never any .env,
// token or runtime file: local data stays in the Raptoru folder (see src/main.ts).
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = join(desktopDir, '..', '..', '..');
const stage = join(desktopDir, 'stage');
const app = join(stage, 'app');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(stage, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// Same relative layout as the repository, so every relative path in the code keeps working.
const copies = [
  'apps/core-api/dist',
  'apps/core-api/package.json',
  'apps/twitch-bot/dist',
  'apps/twitch-bot/package.json',
  'apps/studio/server/dist',
  'apps/studio/server/bonk-overlay',
  // Soundboard V2 local player page (served by the Studio server, played in the Studio window).
  'apps/studio/server/sound-player',
  // TTS V2 player page (OBS browser source / Studio preview).
  'apps/studio/server/tts-player',
  // Tombola V2 OBS overlay (single browser source served by the Studio server).
  'apps/studio/server/raffle-overlay',
  'apps/studio/server/package.json',
  'apps/studio/web/dist',
  'apps/studio/desktop/dist',
  // Electron-owned status page (server starting / lost / restarting).
  'apps/studio/desktop/static',
  'apps/studio/desktop/package.json',
  // Production extension served by the Extension Lab (package.json: ES module type).
  'apps/twitch-extension/extension',
  'apps/twitch-extension/package.json',
  'supabase/migrations',
];
for (const path of copies) {
  const from = join(repo, path);
  if (!existsSync(from))
    throw new Error(`missing ${path}: run the build first`);
  cpSync(from, join(app, path), { recursive: true });
}

// Files the local runtime needs at run time (standalone Studio: no repository next to it).
const runtimeFiles = [
  'apps/core-api/dist/bonk-lab/local-server.js',
  'apps/studio/server/sound-player/player.html',
  'apps/studio/server/tts-player/player.html',
  'apps/studio/server/tts-player/stage.js',
  'apps/twitch-extension/extension/shared/tts-characters.js',
  'apps/twitch-extension/extension/assets/tts/Mikasa Blabla.webm',
  'apps/studio/server/bonk-overlay/overlay.html',
  'apps/studio/server/raffle-overlay/overlay.html',
  'apps/studio/web/dist/index.html',
  'apps/studio/desktop/static/status.html',
  'apps/twitch-extension/extension/panel.html',
  'supabase/migrations/20261003120000_sound_lab_custom_label.sql',
  'supabase/migrations/20261004120000_tts_lab.sql',
  'supabase/migrations/20261005120000_lab_moderation.sql',
  'supabase/migrations/20261006120000_tts_lab_cooldown_clear.sql',
  'supabase/migrations/20261007120000_moderation_d4.sql',
  'supabase/migrations/20261008120000_raffle_v2.sql',
  'supabase/migrations/20261009120000_raffle_scheduler.sql',
  'supabase/migrations/20261010120000_raffle_round_labels.sql',
  'supabase/migrations/20261011120000_commands_v2.sql',
  'supabase/migrations/20261012120000_commands_v2_invocations.sql',
  'supabase/migrations/20261013120000_commands_v2_steps.sql',
  'supabase/migrations/20261014120000_commands_v2_categories.sql',
  'supabase/migrations/20261015120000_lab_moderation_idempotency.sql',
  'supabase/migrations/20261016130000_lab_stream_session_twitch_id.sql',
  'supabase/migrations/20261017120000_bonk_lab_viewer_oauth.sql',
  'supabase/migrations/20261018120000_bonk_lab_volleys.sql',
];
for (const path of runtimeFiles)
  if (!existsSync(join(app, path)))
    throw new Error(`runtime file missing from the package: ${path}`);

// @raptoru/schemas is a workspace package: pack a real copy of its build.
const schemasCopy = join(stage, 'schemas');
cpSync(join(repo, 'packages/schemas/dist'), join(schemasCopy, 'dist'), {
  recursive: true,
});
writeFileSync(
  join(schemasCopy, 'package.json'),
  JSON.stringify(
    {
      ...readJson(join(repo, 'packages/schemas/package.json')),
      version: '0.0.0',
      dependencies: {},
    },
    null,
    2,
  ),
);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) =>
  execFileSync(npm, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
run(['pack', '--pack-destination', '..'], schemasCopy); // relative: the repo path contains a space

const version = (name) =>
  readJson(join(repo, 'node_modules', name, 'package.json')).version;
const desktop = readJson(join(desktopDir, 'package.json'));
// The packed Schemas copy carries no dependencies: the app manifest below provides them. Every
// runtime dependency Schemas declares must be there (ASTRA-P2-001), never left to chance.
const APP_DEPENDENCIES = ['pg', 'zod', 'electron-updater'];
for (const dep of Object.keys(
  readJson(join(repo, 'packages/schemas/package.json')).dependencies ?? {},
))
  if (!APP_DEPENDENCIES.includes(dep))
    throw new Error(
      `@raptoru/schemas needs ${dep}: add it to the app dependencies`,
    );
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'raptoru-studio',
      productName: 'Raptoru Studio',
      description: 'Raptoru Studio (local control panel)',
      version: desktop.version ?? '0.1.0',
      private: true,
      type: 'module',
      main: 'apps/studio/desktop/dist/main.js',
      dependencies: {
        ...Object.fromEntries(APP_DEPENDENCIES.map((d) => [d, version(d)])),
        '@raptoru/schemas': 'file:../raptoru-schemas-0.0.0.tgz',
      },
    },
    null,
    2,
  ),
);
// Which build this is (Studio « À propos »): version + source commit, never anything secret.
writeFileSync(
  join(app, 'build-info.json'),
  JSON.stringify(
    {
      version: desktop.version ?? '0.1.0',
      sha: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim(),
      built_at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
run(
  [
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
    '--workspaces=false',
    '--install-links',
  ],
  app,
);

// Safety net: nothing secret or local may be in the package.
const forbidden =
  /(^\.env($|\.(?!example$))|twitch-tokens|^\.runtime$|processes\.json)/i;
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (forbidden.test(name))
      throw new Error(`refusing to package ${relative(app, full)}`);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
console.log(
  `staged ${walk(app).length} files in ${relative(repo, app)} (no .env, no token, no runtime file)`,
);
