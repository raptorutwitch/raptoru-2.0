// npm run studio:lab — the Lab, one command on any shell and from any checkout. It refuses to run beside another Studio
// (Electron would only focus it), makes sure the Lab's own Postgres runs (Docker, 127.0.0.1 only, its own volume), builds,
// then starts Studio on the Lab's own data folder (.lab-data): no .env, no token, no Production profile can be read there,
// whatever this checkout holds. Studio prepares and starts the main Core itself (CORE_ENVIRONMENT=lab, fictional channel).
// npm run studio:legacy — the way back to the historical Lab, until its removal.
// Optional: LAB_EMOTES=<Twitch channel id> reads that channel's PUBLIC 7TV / BTTV / FFZ catalogs (read-only, no token).
// Optional: LAB_OBS=real uses the OBS of this PC (fictional by default: no connection, the saved one is refused).
// --prepare: stops once the database is up (nothing is built, nothing is started).
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_PORT = 4100;
const POSTGRES = {
  container: 'raptoru-lab-core-pg',
  image: 'postgres:17-alpine',
  port: 55460,
  password: 'raptoru-lab',
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const run = (command, env = process.env) => {
  const r = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    env,
    cwd: ROOT,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const docker = (...args) =>
  spawnSync('docker', args, { encoding: 'utf8', shell: true });

const portBusy = (port) =>
  new Promise((resolve) => {
    const s = connect({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });

function labPostgres() {
  const { container, image, port, password } = POSTGRES;
  if (docker('info', '--format', '{{.ServerVersion}}').status !== 0)
    fail('Docker Desktop doit être démarré : le Lab a sa propre base.');
  const state = docker('inspect', '-f', '{{.State.Running}}', container);
  if (state.status !== 0)
    run(
      `docker run -d --name ${container} -p 127.0.0.1:${port}:5432 -e POSTGRES_PASSWORD=${password} -v ${container}:/var/lib/postgresql/data ${image}`,
    );
  else if (state.stdout.trim() !== 'true') run(`docker start ${container}`);
}

const prepare = process.argv.includes('--prepare');
if (!prepare && (await portBusy(STUDIO_PORT)))
  fail(
    'Un Studio tourne déjà (port 4100) : ferme le Studio installé, puis relance.',
  );
labPostgres();
if (prepare) process.exit(0);

const dataRoot = join(ROOT, '.lab-data');
mkdirSync(dataRoot, { recursive: true });
run('npx turbo run build');
run('npm run start -w @raptoru/studio-desktop', {
  ...process.env,
  RAPTORU_DATA_ROOT: dataRoot,
  STUDIO_LAB_CORE: process.argv.includes('--legacy') ? 'legacy' : 'main',
  RAPTORU_LAB_PG_CONTAINER: POSTGRES.container,
  STUDIO_LAB_DATABASE_URL: `postgres://postgres:${POSTGRES.password}@127.0.0.1:${POSTGRES.port}/postgres`,
  ...(process.env.LAB_EMOTES
    ? { STUDIO_LAB_EMOTE_CATALOG_CHANNEL_ID: process.env.LAB_EMOTES }
    : {}),
});
