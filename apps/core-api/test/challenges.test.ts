import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ChallengeInput, CosmeticItemInput } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { ChallengeService } from '../src/challenges/service.js';
import { labEconomy } from '../src/economy/economy.js';
import { createApp } from '../src/http/server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { setup } from './helpers.js';

// Défis et succès (docs/CHALLENGES.md). Every challenge below is a TEST fixture (« fictif »), never a real one.
// The engine recounts sources, so: a replayed event is not a second row, a refund lowers the value, a second run or two
// runs at once change nothing, a reward is paid once per (challenge, period, viewer), a payment failure is retried
// later, a published condition never changes, and the site only reads.

const CH = '83603689';
const SITE = 'site-token-0123456789abcdef0123456789abcdef';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

type Core = Awaited<ReturnType<typeof setup>>;

async function world() {
  const core = await setup();
  const t0 = new Date('2026-11-03T18:00:00Z');
  core.clock.set(t0);
  for (const [id, login] of [
    ['1', 'ana'],
    ['2', 'bob'],
    ['3', 'bot_x'],
  ] as const) {
    await core.db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2) on conflict do nothing`,
      [id, login],
    );
    await core.db.query(
      `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
       values ($1, $2, 0, 0, 0, $3)`,
      [CH, id, t0],
    );
  }
  await core.db.query(
    `insert into loyalty_exclusions (twitch_user_id, reason, created_by) values ('3', 'bot', 'test')`,
  );
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
  return { core, t0 };
}

/** A Random Ban event (source row) at `at`. */
const rb = (
  core: Core,
  buyer: string,
  status: string,
  target: string | null,
  at: Date,
) =>
  core.db.query(
    `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name,
       status, target_id, target_login, target_name, created_at, updated_at)
     values ($1::uuid, $2, 'chat', $1::text, 'real', $3, $3, $3, $4, $5, $5, $5, $6, $6)`,
    [randomUUID(), CH, buyer, status, target, at],
  );

const def = (over: Partial<ChallengeInput> = {}) =>
  ChallengeInput.parse({
    challenge_id: 'fictif-rb',
    title: 'Défi fictif',
    metric: 'random_ban_sent',
    target: 2,
    ...over,
  });

const jetons = async (core: Core, id: string) =>
  (await labEconomy.balances(core.db, CH, id)).tokens;

describe('challenges engine', () => {
  it('definitions: server rules, a published condition is frozen, only legal transitions, drafts deleted', async () => {
    const { core } = await world();
    const s = core.challenges;
    await expect(
      s.create(CH, def({ metric: 'nope' }), 'test'),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_challenge' });
    // A period-only metric as a dated one-shot: saved as a draft with its problem, refused at activation.
    const bad = await s.create(
      CH,
      def({
        challenge_id: 'fictif-msg',
        metric: 'messages',
        retroactive: false,
      }),
      'test',
    );
    expect(bad.problems.map((p) => p.code)).toEqual(['period_metric_window']);
    await expect(
      s.setStatus(CH, 'fictif-msg', 'active', 'test'),
    ).rejects.toMatchObject({ status: 409, code: 'invalid_challenge' });
    await expect(
      s.create(CH, def({ challenge_id: 'meta' }), 'test'),
    ).rejects.toMatchObject({
      code: 'reserved_id',
    });
    // A reward that does not exist / a draft item.
    const unknown = await s.problems(
      CH,
      def({ reward: { kind: 'reward', reward_id: 'absent' } }),
    );
    expect(unknown.map((p) => p.code)).toEqual(['unknown_item']);

    await s.create(CH, def(), 'test');
    await expect(s.create(CH, def(), 'test')).rejects.toMatchObject({
      code: 'challenge_exists',
    });
    await s.update(CH, def({ target: 3 }), 'test'); // draft: anything
    await s.setStatus(CH, 'fictif-rb', 'active', 'test');
    await expect(
      s.update(CH, def({ target: 1 }), 'test'),
    ).rejects.toMatchObject({ status: 409, code: 'condition_locked' });
    const texts = await s.update(
      CH,
      def({ target: 3, title: 'Nouveau titre fictif' }),
      'test',
    );
    expect(texts.challenge.version).toBe(3);
    await expect(s.remove(CH, 'fictif-rb')).rejects.toMatchObject({
      code: 'not_a_draft',
    });
    await s.setStatus(CH, 'fictif-rb', 'archived', 'test');
    await expect(
      s.setStatus(CH, 'fictif-rb', 'active', 'test'),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(
      s.update(CH, def({ target: 3 }), 'test'),
    ).rejects.toMatchObject({
      code: 'challenge_archived',
    });
    expect((await s.remove(CH, 'fictif-msg')).deleted).toBe(true);
    await expect(s.detail(CH, 'absent')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('retroactive counts what exists, non-retroactive only what follows; an item paid once; excluded accounts never count', async () => {
    const { core, t0 } = await world();
    const s = core.challenges;
    const before = new Date(t0.getTime() - 86_400_000);
    await rb(core, '1', 'confirmed', '2', before);
    await rb(core, '1', 'flop', null, before);
    await rb(core, '1', 'failed', null, before); // no outcome: not counted
    await rb(core, '2', 'confirmed', '1', before);
    await rb(core, '3', 'confirmed', '1', before); // excluded account
    await rb(core, '3', 'confirmed', '1', before);
    const reward = { kind: 'reward' as const, reward_id: 'fictif-titre' };
    await s.create(CH, def({ retroactive: true, reward }), 'test');
    await s.create(
      CH,
      def({ challenge_id: 'fictif-rb-new', retroactive: false, reward }),
      'test',
    );
    // The preview shows who would complete it now, writing nothing.
    const preview = await s.preview(CH, def({ retroactive: true, reward }));
    expect(preview.windows[0]).toMatchObject({
      participants: 2,
      completing: 1,
    });
    expect(
      (await core.db.query('select * from challenge_progress')).length,
    ).toBe(0);

    const act = await s.setStatus(CH, 'fictif-rb', 'active', 'test');
    expect(act.run).toMatchObject({ completed: 1, awards_granted: 1 });
    await s.setStatus(CH, 'fictif-rb-new', 'active', 'test');
    let site = await s.site(CH, '1');
    const retro = site.challenges.find((c) => c.challenge_id === 'fictif-rb')!;
    const fresh = site.challenges.find(
      (c) => c.challenge_id === 'fictif-rb-new',
    )!;
    expect(retro.me).toMatchObject({ value: 2, reward_status: 'granted' });
    expect(retro.me!.completed_at).toBe(t0.toISOString()); // when the Core saw it, no invented date
    expect(fresh.me).toMatchObject({ value: 0, completed_at: null });
    expect(retro.reward).toMatchObject({
      kind: 'title',
      label: 'Titre fictif',
    });
    // The item is owned, through the shop's award (one key).
    const grants = await core.db.query(
      `select * from progression_grants where twitch_user_id = '1' and reward_id = 'fictif-titre' and revoked_at is null`,
    );
    expect(grants.length).toBe(1);
    expect(
      (
        await core.db.query(
          `select 1 from progression_grants where twitch_user_id = '3'`,
        )
      ).length,
    ).toBe(0);

    // New events after the activation: both count them.
    core.clock.set(new Date(t0.getTime() + 60_000));
    await rb(core, '1', 'confirmed', '2', new Date(t0.getTime() + 30_000));
    await rb(core, '1', 'confirmed', '2', new Date(t0.getTime() + 40_000));
    const r = await s.run(CH, { trigger: 'manual' });
    expect(r).toMatchObject({ completed: 1, awards_granted: 1 }); // the non-retroactive one, now
    site = await s.site(CH, '1');
    expect(
      site.challenges.find((c) => c.challenge_id === 'fictif-rb')!.me!.value,
    ).toBe(4);
    expect(site.completed!.map((c) => c.challenge_id).sort()).toEqual([
      'fictif-rb',
      'fictif-rb-new',
    ]);
    // The same item twice: owned once, two award rows (one per challenge), each paid once.
    expect(
      (
        await core.db.query(
          `select * from cosmetic_awards where module = 'challenges' and viewer_id = '1'`,
        )
      ).length,
    ).toBe(2);
    // Again: nothing moves.
    const again = await s.run(CH, { trigger: 'manual' });
    expect(again).toMatchObject({
      changed: 0,
      completed: 0,
      awards_granted: 0,
    });
  });

  it('Jetons: a refund lowers the value (logged), the reward stays and is never paid twice; replays and parallel runs change nothing', async () => {
    const { core } = await world();
    const s = core.challenges;
    const w = core.wallet.wallet;
    const viewer = { twitchUserId: '1', login: 'ana', displayName: 'ana' };
    await w.credit({ key: 'fund-1', viewer, amount: 1000, source: 'test' });
    // The Wallet dates its rows with the database clock (now()): the challenge goes live just before.
    const at = new Date(Date.now() - 60_000);
    core.clock.set(at);
    await s.create(
      CH,
      def({
        challenge_id: 'fictif-bonk',
        metric: 'paid_bonk',
        target: 2,
        reward: { kind: 'jetons', amount: 50 },
      }),
      'test',
    );
    await s.setStatus(CH, 'fictif-bonk', 'active', 'test');
    core.clock.set(new Date(at.getTime() + 1000));
    for (const k of ['a', 'b'])
      await w.spend({
        key: `interaction:${k}:debit`,
        viewer,
        amount: 10,
        source: 'bonk',
        reference: k,
      });
    // A replayed debit (same idempotency key) is the same Wallet operation: still two events.
    await w.spend({
      key: 'interaction:b:debit',
      viewer,
      amount: 10,
      source: 'bonk',
      reference: 'b',
    });
    core.clock.set(new Date(at.getTime() + 2000));
    // Two passes at once: serialized on the definition, one completion, one payment.
    const [x, y] = await Promise.all([
      s.run(CH, { trigger: 'manual' }),
      s.run(CH, { trigger: 'auto' }),
    ]);
    expect(x.completed + y.completed).toBe(1);
    expect(await jetons(core, '1')).toBe(50);
    expect((await core.db.query(`select * from challenge_awards`)).length).toBe(
      1,
    );

    await w.credit({
      key: 'interaction:b:refund',
      viewer,
      amount: 10,
      kind: 'refund',
      source: 'interaction_refund',
    });
    const after = await s.run(CH, { trigger: 'manual' });
    expect(after).toMatchObject({ changed: 1, below_target: 1, completed: 0 });
    const d = await s.detail(CH, 'fictif-bonk');
    expect(d.progress[0]).toMatchObject({ value: 1 });
    expect(d.progress[0]!.completed_at).not.toBeNull();
    expect(d.log.map((l) => l.kind)).toContain('below_target');
    // Back to the target later: no second completion, no second payment.
    await w.spend({
      key: 'interaction:c:debit',
      viewer,
      amount: 10,
      source: 'bonk',
      reference: 'c',
    });
    expect(await s.run(CH, { trigger: 'manual' })).toMatchObject({
      completed: 0,
      awards_granted: 0,
    });
    expect(await jetons(core, '1')).toBe(50);
    // Jetons are not taken back by the engine (a Wallet adjustment does it).
    await expect(
      s.revoke(
        CH,
        'fictif-bonk',
        { period_key: 'all', viewer: '1', reason: 'test' },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'jetons_not_revocable' });
  });

  it('a payment that fails is retried by a later run and paid once; suspended challenges hold; an item is revoked for good', async () => {
    const { core, t0 } = await world();
    const s = core.challenges;
    await rb(core, '1', 'confirmed', '2', t0);
    await rb(core, '1', 'confirmed', '2', t0);
    await core.db.query(
      `update progression_rewards set active = false where reward_id = 'fictif-titre'`,
    );
    await s.create(
      CH,
      def({
        retroactive: true,
        reward: { kind: 'reward', reward_id: 'fictif-titre' },
      }),
      'test',
    );
    // Activation refuses an unavailable item…
    await expect(
      s.setStatus(CH, 'fictif-rb', 'active', 'test'),
    ).rejects.toMatchObject({ code: 'invalid_challenge' });
    await core.db.query(
      `update progression_rewards set active = true where reward_id = 'fictif-titre'`,
    );
    await s.setStatus(CH, 'fictif-rb', 'suspended', 'test').catch(() => {});
    // …and an item switched off between completion and payment: the award fails, nothing is paid.
    const real = core.cosmetics;
    let fail = true;
    const flaky = new ChallengeService(
      core.db,
      core.clock,
      {
        award: (ch, req) =>
          fail ? Promise.reject(new Error('wallet down')) : real.award(ch, req),
      },
      core.progression,
    );
    await flaky.setStatus(CH, 'fictif-rb', 'active', 'test');
    let d = await flaky.detail(CH, 'fictif-rb');
    expect(d.awards[0]).toMatchObject({
      status: 'failed',
      error: 'wallet down',
      attempts: 1,
    });
    // Suspended: no recount, no payment.
    await flaky.setStatus(CH, 'fictif-rb', 'suspended', 'test');
    fail = false;
    expect(await flaky.run(CH, { trigger: 'manual' })).toMatchObject({
      challenges: 0,
      awards_granted: 0,
    });
    await rb(core, '2', 'confirmed', '1', t0);
    expect((await flaky.site(CH, '2')).challenges[0]!.me!.value).toBe(0);
    // Resumed: counted, and the earlier failure paid once.
    const resumed = await flaky.setStatus(CH, 'fictif-rb', 'active', 'test');
    expect(resumed.run).toMatchObject({ awards_granted: 1 });
    d = await flaky.detail(CH, 'fictif-rb');
    expect(d.awards[0]).toMatchObject({ status: 'granted', attempts: 2 });
    expect(d.log.filter((l) => l.kind === 'award_failed').length).toBe(1);

    // Admin correction: the item taken back, never given again.
    await flaky.revoke(
      CH,
      'fictif-rb',
      { period_key: 'all', viewer: '1', reason: 'erreur de test' },
      'test',
    );
    expect(
      (
        await core.db.query(
          `select 1 from progression_grants where twitch_user_id = '1' and revoked_at is null`,
        )
      ).length,
    ).toBe(0);
    await rb(core, '1', 'confirmed', '2', t0);
    await flaky.run(CH, { trigger: 'manual' });
    expect(
      (
        await core.db.query(
          `select 1 from progression_grants where twitch_user_id = '1' and revoked_at is null`,
        )
      ).length,
    ).toBe(0);
    expect(
      (
        await flaky.revoke(
          CH,
          'fictif-rb',
          { period_key: 'all', viewer: '1', reason: 'erreur de test' },
          'test',
        )
      ).replayed,
    ).toBe(true);
  });

  it('weekly challenges: one progress per week (Europe/Paris), whole weeks only when not retroactive; secret ones hidden until done', async () => {
    const { core } = await world();
    const s = core.challenges;
    // Wednesday 4 Nov 2026; the week starts Monday 2 Nov.
    core.clock.set(new Date('2026-11-04T12:00:00Z'));
    const stat = (start: string, viewer: string, messages: number) =>
      core.db.query(
        `insert into progression_period_stats (channel_id, period, period_start, twitch_user_id, xp, watch_seconds,
           messages, updated_at) values ($1, 'week', $2::date, $3, 0, 0, $4, now())`,
        [CH, start, viewer, messages],
      );
    await stat('2026-10-26', '1', 40); // last week
    await stat('2026-11-02', '1', 12);
    await stat('2026-11-02', '2', 3);
    await s.create(
      CH,
      def({
        challenge_id: 'fictif-semaine',
        metric: 'messages',
        period: 'week',
        target: 10,
        retroactive: true,
      }),
      'test',
    );
    await s.create(
      CH,
      def({
        challenge_id: 'fictif-semaine-new',
        metric: 'messages',
        period: 'week',
        target: 10,
        retroactive: false,
      }),
      'test',
    );
    await s.create(
      CH,
      def({
        challenge_id: 'fictif-secret',
        metric: 'messages',
        period: 'week',
        target: 1,
        retroactive: true,
        visibility: 'secret',
      }),
      'test',
    );
    for (const id of ['fictif-semaine', 'fictif-semaine-new', 'fictif-secret'])
      await s.setStatus(CH, id, 'active', 'test');
    const d = await s.detail(CH, 'fictif-semaine');
    expect(
      d.progress.map((p) => [
        p.period_key,
        p.viewer,
        p.value,
        !!p.completed_at,
      ]),
    ).toEqual([
      ['w2026-11-02', '1', 12, true],
      ['w2026-11-02', '2', 3, false],
      ['w2026-10-26', '1', 40, true],
    ]);
    // Not retroactive: the week already started is not counted (no partial week exists).
    expect((await s.detail(CH, 'fictif-semaine-new')).progress).toEqual([]);
    const ana = await s.site(CH, '1');
    expect(
      ana.challenges.find((c) => c.challenge_id === 'fictif-semaine')!.me,
    ).toMatchObject({
      value: 12,
      times_completed: 2,
    });
    expect(ana.challenges.some((c) => c.challenge_id === 'fictif-secret')).toBe(
      true,
    );
    const anon = await s.site(CH, null);
    expect(
      anon.challenges.some((c) => c.challenge_id === 'fictif-secret'),
    ).toBe(false);
    expect(anon.secret_hidden).toBe(1);
    expect(anon.completed).toBeNull();
    expect(anon.challenges[0]!.me).toBeNull();
  });

  it('without the migration: 503 everywhere, the timer does nothing', async () => {
    const { core } = await world();
    const none = new ChallengeService(
      {
        // An older database: information_schema finds none of the tables.
        query: async <R>() => [{ n: 0 }] as R[],
        tx: async () => {
          throw new Error('no');
        },
        close: async () => {},
      },
      core.clock,
      core.cosmetics,
      core.progression,
    );
    expect(await none.tick(CH)).toBeNull();
    await expect(none.list(CH)).rejects.toMatchObject({
      status: 503,
      code: 'challenges_unavailable',
    });
    await expect(none.site(CH, '1')).rejects.toMatchObject({ status: 503 });
    // Tables there, nothing live (production today): the timer does nothing either.
    expect(await core.challenges.tick(CH)).toBeNull();
    expect((await core.db.query('select * from challenge_runs')).length).toBe(
      0,
    );
  });
});

describe('challenges on the main Core HTTP', () => {
  async function fixture(siteToken?: string) {
    const { core } = await world();
    const server = createApp({
      ...core,
      labRoutes: false,
      botSecret: 'bot-test-secret',
      studioSecret: 'studio-test-secret',
      siteToken,
      cockpit: {
        core: () => Promise.reject(new Error('unused')),
        channelId: CH,
      },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise((r) => server.close(() => r())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    await core.studioInstallations.register(
      `${id}.${sha256(secret)}`,
      'PC test',
    );
    const studio = `Bearer rsi_${id}.${secret}`;
    const call = async (path: string, body?: unknown, auth?: string) => {
      const res = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(auth ? { authorization: auth } : {}),
          [STUDIO_PROTOCOL_HEADER]: '1',
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
      return { status: res.status, body: (await res.json()) as any };
    };
    return { call, studio, core };
  }

  it('Studio only for the admin side, the site token only for the read; nobody else; bad input refused', async () => {
    const { call, studio, core } = await fixture(SITE);
    const site = `Bearer ${SITE}`;
    const body = def({ retroactive: true });
    // No credential, the site token or the Studio Lab secret: never the admin side.
    for (const auth of [undefined, site, 'Bearer studio-test-secret']) {
      expect(
        (await call('/v1/studio/challenges', undefined, auth)).status,
      ).toBe(401);
      expect((await call('/v1/studio/challenges', body, auth)).status).toBe(
        401,
      );
      expect((await call('/v1/studio/challenges/run', {}, auth)).status).toBe(
        401,
      );
    }
    // The Lab paths do not exist on the main Core.
    expect((await call('/v1/lab/challenges', undefined, studio)).status).toBe(
      404,
    );
    // The site read: its token only; never with Studio's credential or nothing.
    expect((await call('/v1/site/challenges')).status).toBe(401);
    expect((await call('/v1/site/challenges', undefined, studio)).status).toBe(
      401,
    );
    expect(
      (await call('/v1/site/challenges?viewer=abc', undefined, site)).status,
    ).toBe(400);
    // And the site cannot write anything: no POST route.
    expect(
      (await call('/v1/site/challenges', { viewer: '1' }, site)).status,
    ).toBe(405);

    expect(
      (await call('/v1/studio/challenges', { ...body, target: 0 }, studio))
        .status,
    ).toBe(400);
    expect((await call('/v1/studio/challenges', body, studio)).status).toBe(
      200,
    );
    expect(
      (await call('/v1/studio/challenges/absent', undefined, studio)).status,
    ).toBe(404);
    expect(
      (
        await call(
          '/v1/studio/challenges/fictif-rb',
          { ...body, challenge_id: 'other' },
          studio,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          '/v1/studio/challenges/fictif-rb/status',
          { status: 'nope' },
          studio,
        )
      ).status,
    ).toBe(400);
    await rb(core, '1', 'confirmed', '2', new Date());
    await rb(core, '1', 'confirmed', '2', new Date());
    const live = await call(
      '/v1/studio/challenges/fictif-rb/status',
      { status: 'active' },
      studio,
    );
    expect(live.body.run).toMatchObject({ completed: 1 });
    const meta = await call('/v1/studio/challenges/meta', undefined, studio);
    expect(meta.body.metrics.map((m: { key: string }) => m.key)).toContain(
      'words_found',
    );
    expect(
      meta.body.items.map((i: { reward_id: string }) => i.reward_id),
    ).toEqual(['fictif-titre']);
    const read = await call('/v1/site/challenges?viewer=1', undefined, site);
    expect(read.status).toBe(200);
    expect(read.body.challenges[0].me).toMatchObject({ value: 2 });
    expect(read.body.updated_at).not.toBeNull();
  });

  it('without the site token, the site route is absent', async () => {
    const { call, studio } = await fixture();
    expect((await call('/v1/site/challenges', undefined, studio)).status).toBe(
      404,
    );
    expect(
      (await call('/v1/studio/challenges', undefined, studio)).status,
    ).toBe(200);
  });
});
