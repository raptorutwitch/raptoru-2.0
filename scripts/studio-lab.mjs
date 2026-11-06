// npm run studio:lab — the Lab, one command on any shell (PowerShell has no `VAR=x cmd`): builds, then starts Studio, which
// prepares and starts the main Core itself (CORE_ENVIRONMENT=lab, local database, fictional channel). The Lab profile must
// be selected (the default); the installed Studio must be closed (same port 4100).
// npm run studio:legacy — the way back to the historical Lab, until its removal.
// Optional: LAB_EMOTES=<Twitch channel id> reads that channel's PUBLIC 7TV / BTTV / FFZ catalogs (read-only, no token).
// Optional: LAB_OBS=real uses the OBS of this PC (fictional by default: no connection, the saved one is refused).
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const run = (command, env = process.env) => {
  const r = spawnSync(command, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const legacy = process.argv.includes('--legacy');
run('npx turbo run build');
run('npm run start -w @raptoru/studio-desktop', {
  ...process.env,
  STUDIO_LAB_CORE: legacy ? 'legacy' : 'main',
  ...(process.env.LAB_EMOTES
    ? { STUDIO_LAB_EMOTE_CATALOG_CHANNEL_ID: process.env.LAB_EMOTES }
    : {}),
});
