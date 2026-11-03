import { randomUUID } from 'node:crypto';
import { ChallengeInput, CosmeticItemInput } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChallengeService } from '../src/challenges/service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { labEconomy } from '../src/economy/economy.js';
import { FakeClock, resetTestDb, setup } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

// Défis on a REAL Postgres (several connections): recounts running truly at once — the same process twice and two
// « processes » (two services on two pools) — complete a challenge once and pay it once. Opt-in like every real-Postgres
// suite (TEST_DATABASE_URL, local, a database whose name contains « test »; it is wiped). Fixtures are fictional.
const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';

describe.skipIf(!isLocal)('Défis, real Postgres', () => {
  let db: Db;
  let other: Db;
  let unlock: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    db = createPgDb(url!);
    other = createPgDb(url!);
    await db.query('drop schema public cascade; create schema public;');
    await migrate(db, 'all');
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await other?.close();
    await db?.close();
    await unlock?.();
  });

  it('parallel recounts (one process, two processes): one completion and one payment per viewer', async () => {
    await resetTestDb(db);
    const t0 = new Date('2026-11-03T18:00:00Z');
    const core = await setup({ db, clock: new FakeClock(t0) });
    const viewers = Array.from({ length: 20 }, (_, i) => String(100 + i));
    for (const id of viewers) {
      await db.query(
        `insert into viewers (twitch_user_id, login, display_name) values ($1, $1, $1)`,
        [id],
      );
      await db.query(
        `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
         values ($1, $2, 0, 0, 0, $3)`,
        [CH, id, t0],
      );
      for (let k = 0; k < 3; k++)
        await db.query(
          `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name,
             status, created_at, updated_at)
           values ($1::uuid, $2, 'chat', $1::text, 'real', $3, $3, $3, 'flop', $4, $4)`,
          [randomUUID(), CH, id, t0],
        );
    }
    await core.cosmetics.upsertItem(
      CH,
      CosmeticItemInput.parse({
        reward_id: 'fictif-titre',
        kind: 'title',
        label: 'Titre fictif',
        status: 'published',
        style: { color: '#ff8a00' },
      }),
    );
    const s = core.challenges;
    for (const [id, reward] of [
      ['fictif-jetons', { kind: 'jetons', amount: 7 }],
      ['fictif-objet', { kind: 'reward', reward_id: 'fictif-titre' }],
    ] as const) {
      await s.create(
        CH,
        ChallengeInput.parse({
          challenge_id: id,
          title: 'Défi fictif',
          metric: 'random_ban_sent',
          target: 3,
          retroactive: true,
          reward,
        }),
        'test',
      );
      // Live without a pass of its own: the passes below race for the first completion.
      await db.query(
        `update challenge_defs set status = 'active', activated_at = $2 where challenge_id = $1`,
        [id, t0],
      );
    }
    const twin = new ChallengeService(
      other,
      core.clock,
      core.cosmetics,
      core.progression,
    );
    const runs = await Promise.all([
      s.run(CH, { trigger: 'auto' }),
      s.run(CH, { trigger: 'manual' }),
      twin.run(CH, { trigger: 'auto' }),
      twin.run(CH, { trigger: 'manual' }),
    ]);
    expect(runs.reduce((n, r) => n + r.completed, 0)).toBe(40);
    expect(
      (
        await db.query(
          `select 1 from challenge_awards where status = 'granted'`,
        )
      ).length,
    ).toBe(40);
    expect(
      (
        await db.query(
          `select 1 from cosmetic_awards where module = 'challenges'`,
        )
      ).length,
    ).toBe(40);
    for (const id of viewers)
      expect((await labEconomy.balances(db, CH, id)).tokens).toBe(7);
    expect(
      (
        await db.query(
          `select 1 from progression_grants where reward_id = 'fictif-titre' and revoked_at is null`,
        )
      ).length,
    ).toBe(20);
    // A pending row whose payment already happened (a crash between the two): replayed, never paid again.
    await db.query(
      `update challenge_awards set status = 'pending' where challenge_id = 'fictif-jetons' and viewer_id = '100'`,
    );
    await Promise.all([
      s.run(CH, { trigger: 'auto' }),
      twin.run(CH, { trigger: 'auto' }),
    ]);
    expect((await labEconomy.balances(db, CH, '100')).tokens).toBe(7);
    expect(
      (
        await db.query(
          `select status from challenge_awards where challenge_id = 'fictif-jetons' and viewer_id = '100'`,
        )
      )[0],
    ).toMatchObject({ status: 'granted' });
  });
});
