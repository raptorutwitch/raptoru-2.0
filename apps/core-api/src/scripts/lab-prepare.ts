import pg from 'pg';
import { systemClock } from '../clock.js';
import { loadConfig } from '../config.js';
import { createPgDb } from '../db/db.js';
import { migrate } from '../db/migrate.js';
import { labEnvironmentProblems } from '../lab/environment.js';
import { seedLabFixtures } from '../lab/fixtures.js';
import { StudioInstallations } from '../studio/installations.js';

// Prepares the Lab database of the main Core before each start of the local Lab (Studio's runtime, opt-in
// STUDIO_LAB_CORE=main), IDEMPOTENT — never a reset (npm run lab:reset does that, explicitly):
// - the database is created when missing (local, name containing « lab »);
// - the PRODUCTION migrator applies what is pending (same schema as the VPS);
// - the fictional fixtures are written the first time only (the Lab's Jetons are never put back on a restart);
// - the local Studio installation is paired once (pairing code in argv; already paired = nothing to do).
// Same guards as the Core's start (CORE_ENVIRONMENT=lab, loopback database, fictional channel, no real Twitch app).
//   node dist/scripts/lab-prepare.js [<pairing code>]

const config = loadConfig();
const problems =
  config.CORE_ENVIRONMENT === 'lab'
    ? labEnvironmentProblems(config)
    : ['CORE_ENVIRONMENT doit être lab'];
const url = new URL(config.DATABASE_URL);
const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
if (!/^[a-z0-9_]*lab[a-z0-9_]*$/.test(name))
  problems.push(`la base « ${name} » ne porte pas « lab » dans son nom`);
if (problems.length) {
  console.error(`[lab-prepare] refusé : ${problems.join(' ; ')}`);
  process.exit(1);
}

const admin = new pg.Client({
  connectionString: Object.assign(new URL(url.href), { pathname: '/postgres' })
    .href,
});
await admin.connect();
try {
  const exists = await admin.query(
    'select 1 from pg_database where datname = $1',
    [name],
  );
  if (!exists.rowCount) await admin.query(`create database "${name}"`);
} finally {
  await admin.end();
}

const db = createPgDb(config.DATABASE_URL);
try {
  const applied = await migrate(db, 'prod');
  const seeded = await db.query(
    `select 1 from lab_wallets where channel_id = $1 and viewer_id = '900101'`,
    [config.TWITCH_CHANNEL_ID],
  );
  if (!seeded.length) await seedLabFixtures(db);
  const code = process.argv[2];
  let paired = 'déjà appairé';
  if (code) {
    try {
      await new StudioInstallations(db, systemClock).register(
        code,
        'Studio Lab (local)',
      );
      paired = 'appairé';
    } catch (e) {
      if (!/already paired/.test((e as Error).message)) throw e;
    }
  }
  console.log(
    `[lab-prepare] ${name} : ${applied.length} migration(s) appliquée(s) · fixtures ${seeded.length ? 'présentes' : 'écrites'} · Studio ${code ? paired : 'non demandé'}`,
  );
} finally {
  await db.close();
}
