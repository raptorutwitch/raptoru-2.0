import { createPgDb } from '../db/db.js';
import { migrate } from '../db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const db = createPgDb(url);
try {
  // Production path: never a Lab migration added after the Lab / prod boundary (src/db/migration-scopes.ts).
  const applied = await migrate(db, 'prod', process.env.MIGRATIONS_DIR);
  console.log(
    applied.length
      ? `applied: ${applied.join(', ')}`
      : 'database already up to date',
  );
} finally {
  await db.close();
}
