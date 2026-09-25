import { createPgDb } from '../db/db.js';
import { migrate } from '../db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const db = createPgDb(url);
try {
  const applied = await migrate(db, process.env.MIGRATIONS_DIR);
  console.log(
    applied.length
      ? `applied: ${applied.join(', ')}`
      : 'database already up to date',
  );
} finally {
  await db.close();
}
