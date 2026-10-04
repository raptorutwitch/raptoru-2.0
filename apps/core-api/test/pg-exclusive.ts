import pg from 'pg';

/**
 * Real-Postgres suites that wipe the schema (`drop schema public`) take this lock first, on their own
 * connection, and keep it until they end: two of them never run at once on the same database, however
 * they are started (npm run test:integration, npm test with TEST_DATABASE_URL…) — ASTRA-P2-029.
 * Advisory locks are per database: suites on different databases still run in parallel.
 */
const LOCK_KEY = 2_029_000;

export async function lockDestructiveSuite(
  url: string,
): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
  return async () => {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    await client.end();
  };
}

/** Waiting for the other destructive suite to finish fits in the hook budget. */
export const LOCK_WAIT_MS = 300_000;
