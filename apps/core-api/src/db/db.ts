import pg from 'pg';

export interface Queryable {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<R[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction (READ COMMITTED). Rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const DATE_OID = 1082;
const INT8_OID = 20;

// Keep `date` as 'YYYY-MM-DD' (no local-midnight Date) and bigint ids as numbers.
const pgTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === DATE_OID) return (value: string) => value;
    if (oid === INT8_OID) return (value: string) => Number(value);
    return pg.types.getTypeParser(oid, format);
  },
} as pg.CustomTypesConfig;

// Without parameters, use the simple protocol so multi-statement SQL (migrations) works.
function run(target: pg.Pool | pg.PoolClient, sql: string, params: unknown[]) {
  return params.length ? target.query(sql, params) : target.query(sql);
}

/**
 * Time budgets of a server process (ASTRA-P1-004). PostgreSQL's own defaults are « no limit »
 * (statement_timeout / lock_timeout / idle_in_transaction_session_timeout = 0) and so is node-pg's
 * connection wait: a stuck query or lock would hold a connection (and its locks) for ever. With
 * these budgets it fails, rolls back and frees the client. Scripts (migrations, imports, reports)
 * pass no limits: their long statements are legitimate.
 */
export interface DbLimits {
  connectMs: number;
  statementMs: number;
  lockMs: number;
  idleInTxMs: number;
}
export const SERVER_DB_LIMITS: DbLimits = {
  connectMs: 5_000,
  statementMs: 30_000,
  lockMs: 10_000,
  idleInTxMs: 60_000,
};

/**
 * Readiness (ASTRA-P1-005): the database answers a trivial query within `ms`. Liveness (`/health`)
 * only says the HTTP process is up; this says Core can actually serve.
 */
export async function dbReady(
  db: Pick<Db, 'query'>,
  ms = 1_500,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      db.query('select 1').then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createPgDb(connectionString: string, limits?: DbLimits): Db {
  const pool = new pg.Pool({
    connectionString,
    types: pgTypes,
    ...(limits && {
      connectionTimeoutMillis: limits.connectMs,
      statement_timeout: limits.statementMs,
      lock_timeout: limits.lockMs,
      idle_in_transaction_session_timeout: limits.idleInTxMs,
    }),
  });

  return {
    async query<R>(sql: string, params: unknown[] = []) {
      const result = await run(pool, sql, params);
      return result.rows as R[];
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const q: Queryable = {
          async query<R>(sql: string, params: unknown[] = []) {
            const result = await run(client, sql, params);
            return result.rows as R[];
          },
        };
        const value = await fn(q);
        await client.query('commit');
        return value;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
