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

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, types: pgTypes });

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
