// The module host on a real Postgres with two Cores (two pools): the same viewer intent sent 10 times at once → one
// debit, one journal row; a moderator refund racing the expiry and the fictional player → the original debit back once.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted. Fictional data.
import type { LabActor } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { ModuleSettings } from '../src/module-settings/service.js';
import { COFFRE_SHOW_MS } from '../src/modules/coffre-mystere.js';
import { ModuleHost } from '../src/modules/host.js';
import { MODULES } from '../src/modules/index.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '900331';
const V = { id: '900332', display_name: 'Viewer Fictif' };
const mod: LabActor = {
  id: '900333',
  role: 'moderator',
  via: 'extension',
  display_name: 'Modo',
};

describe.skipIf(!isLocal)('module host, real Postgres, two Cores', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-11-05T20:00:00Z'));
  const host = (db: Db) =>
    new ModuleHost(MODULES, {
      db,
      clock,
      economy: labEconomy,
      settings: new ModuleSettings(db, clock),
    });
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
    await host(a).ctx.settings.set(CH, 'coffre_mystere.enabled', 1, 'test');
    await editWallet(
      a,
      clock.now(),
      CH,
      V.id,
      'set',
      { tokens: 10_000 },
      'test',
    );
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await b?.close();
    await a?.close();
    await unlock?.();
  });
  const tokens = async () =>
    Number(
      (
        await a.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, V.id],
        )
      )[0]!.tokens,
    );

  it('10 concurrent sends of ONE intent from two Cores: one debit, one row, the others replayed', async () => {
    const [A, B] = [host(a), host(b)];
    const out = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? A : B).viewer(CH, 'coffre_mystere', 'ouvrir', {
          viewer: V,
          idempotency_key: 'intent-once-001',
        }),
      ),
    );
    const ok = out.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(await tokens()).toBe(9_900);
    const rows = await a.query(
      "select 1 from module_activity where module_id = 'coffre_mystere'",
    );
    expect(rows).toHaveLength(1);
  });

  it('refund, expiry and the fictional player racing on one chest: refunded exactly once', async () => {
    const [A, B] = [host(a), host(b)];
    // The chest of the previous test is shown first (otherwise it would expire too, refunded once — correctly).
    await A.admin(CH, 'coffre_mystere', 'lecteur_fictif', {
      actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
    });
    const { activity } = await A.viewer(CH, 'coffre_mystere', 'ouvrir', {
      viewer: V,
      idempotency_key: 'intent-race-001',
    });
    clock.advance(COFFRE_SHOW_MS + 1);
    const before = await tokens();
    await Promise.allSettled([
      A.refund(CH, {
        actor: mod,
        activity_id: activity.activity_id,
        reason: 'course',
      }),
      B.refund(CH, {
        actor: mod,
        activity_id: activity.activity_id,
        reason: 'course',
      }),
      A.tick(),
      B.tick(),
      B.settle(activity.activity_id, { status: 'failed' }),
    ]);
    expect(await tokens()).toBe(before + 100);
    const refunds = await a.query(
      "select 1 from lab_wallet_ledger where interaction_id = $1 and kind = 'refund'",
      [activity.activity_id],
    );
    expect(refunds).toHaveLength(1);
  });
});
