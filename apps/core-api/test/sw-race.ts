import type { Db } from '../src/db/db.js';

// Real-Postgres races of the Roue du Sub V2 suites (R1, R2): a Core whose queries can drop a protection, stop at a
// decision point or fail, so that two Cores decide at the same time when nothing serializes them.

/** Lets every caller reach the same point before going on (or gives up after `ms`: a lock held elsewhere). */
export function barrier(n: number, ms = 300) {
  const waiting = new Map<
    string,
    { n: number; open: () => void; p: Promise<void> }
  >();
  return async (key: string) => {
    let b = waiting.get(key);
    if (!b) {
      let open!: () => void;
      const p = new Promise<void>((r) => (open = r));
      b = { n: 0, open, p };
      waiting.set(key, b);
    }
    if (++b.n >= n) b.open();
    await Promise.race([b.p, new Promise((r) => setTimeout(r, ms))]);
  };
}

/**
 * A Core whose transactions go through `rewrite` (to remove a protection) and stop at `pause` before deciding (the
 * insert / draw), so that two Cores decide at the same time when nothing serializes them.
 */
export function tampered(
  db: Db,
  o: {
    noViewerLock?: boolean;
    noRowLock?: boolean;
    pause?: (key: string) => Promise<void>;
    crashOnCredit?: boolean;
    /** Waits this long before recording a proof (between its lookup and its write). */
    slowProof?: number;
    /** Awaited before recording a proof (between its lookup and its write): a deterministic interleaving. */
    beforeProof?: (params: unknown[] | undefined) => Promise<void>;
    /** Replaces a query matching the pattern (a protection removed). */
    replace?: [RegExp, string];
    /** A query matching the pattern fails (a crash at that point). */
    failOn?: RegExp;
    /** Waits before a query matching the pattern (holds what the transaction locked so far). */
    delayOn?: [RegExp, number];
  },
): Db {
  const rewrite = async (sql: string, params?: unknown[]) => {
    if (
      o.noViewerLock &&
      sql.includes('pg_advisory_xact_lock') &&
      String(params?.[0]).startsWith('sw:')
    )
      return { sql: 'select 1', params: [] };
    if (
      o.noRowLock &&
      sql === 'select * from sw_spins where spin_id = $1 for update'
    )
      return { sql: 'select * from sw_spins where spin_id = $1', params };
    if (o.failOn && o.failOn.test(sql)) throw new Error('connection lost');
    if (o.delayOn && o.delayOn[0].test(sql))
      await new Promise((r) => setTimeout(r, o.delayOn![1]));
    // The replacement keeps the parameters when it uses them.
    if (o.replace && o.replace[0].test(sql))
      return {
        sql: o.replace[1],
        params: o.replace[1].includes('$1') ? params : [],
      };
    if (o.slowProof && /insert into sw_spin_sources/.test(sql))
      await new Promise((r) => setTimeout(r, o.slowProof));
    if (o.beforeProof && /insert into sw_spin_sources/.test(sql))
      await o.beforeProof(params);
    if (o.crashOnCredit && /insert into wallet_transactions/.test(sql))
      throw new Error('connection lost');
    if (
      o.pause &&
      (/^\s*insert into sw_spins/.test(sql) ||
        /update sw_spins set status = 'queued'/.test(sql))
    )
      await o.pause(String(sql.includes('insert') ? params?.[5] : params?.[0]));
    return { sql, params };
  };
  return {
    ...db,
    tx: (fn) =>
      db.tx((q) =>
        fn({
          query: async (sql: string, params?: unknown[]) => {
            const r = await rewrite(sql, params);
            return q.query(r.sql, r.params);
          },
        } as never),
      ),
  };
}
