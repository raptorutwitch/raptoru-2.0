import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Viewer } from '@raptoru/schemas';
import { createCore, type Core } from '../src/app.js';
import { SHADOW_MODES, type LoyaltyModes } from '../src/loyalty/engine.js';
import type { Clock } from '../src/clock.js';
import {
  DevFakeCreditProvider,
  type CreditProvider,
} from '../src/daily/credits.js';
import type { Db, Queryable } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { parisWallTime } from '../src/stream/stream-day.js';

/** Real Postgres (WASM) behind the Core `Db` interface. Single connection: calls are serialized. */
export function createPgliteDb(pg: PGlite): Db {
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  const run = async <R>(
    target: PGlite | Transaction,
    sql: string,
    params: unknown[],
  ) =>
    params.length
      ? ((await target.query<R>(sql, params)).rows as R[])
      : (((await target.exec(sql)).at(-1)?.rows ?? []) as R[]);

  return {
    query: <R>(sql: string, params: unknown[] = []) =>
      exclusive(() => run<R>(pg, sql, params)),
    tx: <T>(fn: (q: Queryable) => Promise<T>) =>
      exclusive(() =>
        pg.transaction((t) =>
          fn({
            query: <R>(sql: string, params: unknown[] = []) =>
              run<R>(t, sql, params),
          }),
        ),
      ),
    close: () => pg.close(),
  };
}

let shared: Promise<Db> | null = null;

/**
 * Migrated database, emptied before each use. One Postgres
 * instance per test file: booting WASM Postgres for every test is too slow.
 */
export async function createTestDb(): Promise<Db> {
  shared ??= (async () => {
    const pg = new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    });
    const db = createPgliteDb(pg);
    await migrate(db, 'all');
    return db;
  })();
  const db = await shared;
  const tables = await db.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'",
  );
  await db.query(
    `truncate ${tables.map((t) => t.tablename).join(', ')} restart identity cascade`,
  );
  // Seed rows of the migrations that the truncate removed.
  await db.query(
    "insert into currencies (id, singular, plural, is_primary) values ('main', 'Jeton', 'Jetons', true)",
  );
  await db.query(
    `insert into currencies (id, singular, plural, icon, active, is_primary, transferable, allow_negative_admin) values
      ('credits_tts', 'Crédit TTS', 'Crédits TTS', 'tts', true, false, false, false),
      ('credits_soundboard', 'Crédit Soundboard', 'Crédits Soundboard', 'sound', true, false, false, false)`,
  );
  await db.query(
    `insert into lab_currencies (currency_id, label, short_label, icon, wallet_column, sort, max_balance) values
      ('tokens', 'Jetons', 'J', 'coin', 'tokens', 0, 1000000000),
      ('credits_tts', 'Crédits TTS', 'cr TTS', 'tts', 'credits_tts', 1, 100000),
      ('credits_soundboard', 'Crédits Soundboard', 'cr Sons', 'sound', 'credits_soundboard', 2, 100000)`,
  );
  return db;
}

export class FakeClock implements Clock {
  constructor(public current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(date: Date): void {
    this.current = date;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Paris wall-clock instant, e.g. paris('2026-09-24', 20, 30). */
export const paris = parisWallTime;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function viewer(id: string, displayName: string): Viewer {
  return { twitchUserId: id, login: displayName.toLowerCase(), displayName };
}

export interface TestCore extends Core {
  db: Db;
  clock: FakeClock;
  provider: CreditProvider;
}

export async function setup(
  options: {
    provider?: CreditProvider;
    db?: Db;
    clock?: FakeClock;
    loyalty?: Partial<LoyaltyModes>;
  } = {},
): Promise<TestCore> {
  const db = options.db ?? (await createTestDb());
  const clock = options.clock ?? new FakeClock(paris('2026-09-24', 12));
  const provider = options.provider ?? new DevFakeCreditProvider();
  const core = createCore(db, clock, provider, {
    ...SHADOW_MODES,
    ...options.loyalty,
  });
  return { ...core, db, clock, provider };
}

let requestSeq = 0;

/** Moves the clock to `at` and sends !daily. */
export async function claimAt(
  core: TestCore,
  v: Viewer,
  at: Date,
  requestId = `msg-${++requestSeq}`,
) {
  core.clock.set(at);
  return core.daily.claim({ viewer: v, requestId });
}

/** Starts a live at `startedAt` (clock moves there too). */
export async function goLive(
  core: TestCore,
  streamId: string,
  startedAt: Date,
) {
  core.clock.set(startedAt);
  return core.streams.online({ streamId, startedAt });
}

export async function endLive(core: TestCore, at: Date) {
  core.clock.set(at);
  await core.streams.offline(at);
}

export async function count(db: Db, table: string): Promise<number> {
  return (
    await db.query<{ n: number }>(`select count(*)::int as n from ${table}`)
  )[0]!.n;
}
