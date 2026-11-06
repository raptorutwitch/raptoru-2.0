import pg from 'pg';
import { loadConfig } from '../config.js';
import { createPgDb } from '../db/db.js';
import { migrate } from '../db/migrate.js';
import {
  LAB_TWITCH_USERS,
  labEnvironmentProblems,
} from '../lab/environment.js';
import { LAB_VIEWER_TOKENS, seedLabFixtures } from '../lab/fixtures.js';

// Resets the Lab database of the main Core (src/lab/environment.ts): drop, create, the PRODUCTION migrator (same schema
// as the VPS), then the fictional fixtures (the Lab's viewers and their test Jetons). Explicit only:
//   npm run lab:reset -w @raptoru/core-api        (reads apps/core-api/.env.lab, git-ignored)
// .env.lab: CORE_ENVIRONMENT=lab, DATABASE_URL=postgres://…@127.0.0.1:<port>/<name containing « lab »>,
// TWITCH_CHANNEL_ID=900100, BOT_SECRET / STUDIO_SECRET (16+ characters), TWITCH_EXTENSION_SECRET (base64).
// Refused unless the configuration is a valid Lab one AND the database's name says « lab »: never another database.

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
  console.error(`[lab-reset] refusé : ${problems.join(' ; ')}`);
  process.exit(1);
}

const admin = new pg.Client({
  connectionString: Object.assign(new URL(url.href), { pathname: '/postgres' })
    .href,
});
await admin.connect();
try {
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.query(`create database "${name}"`);
} finally {
  await admin.end();
}

const db = createPgDb(config.DATABASE_URL);
try {
  const applied = await migrate(db, 'main-lab');
  await seedLabFixtures(db);
  console.log(
    `[lab-reset] ${name} : ${applied.length} migrations (périmètre Production), ${LAB_TWITCH_USERS.length} viewers fictifs, ${LAB_VIEWER_TOKENS} Jetons de test pour Viewer Lab`,
  );
} finally {
  await db.close();
}
