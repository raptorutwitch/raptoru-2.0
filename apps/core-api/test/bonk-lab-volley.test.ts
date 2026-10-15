import {
  BonkLabVolleyAdmitRequest,
  type BonkLabInteraction,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  BONK_LAB_RULES,
  BonkLabError409,
  BonkLabUnavailableError,
} from '../src/bonk-lab/bonk-lab-service.js';
import { internalLabCall } from '../src/ext/lab-internal.js';
import { bonkLabRoutes } from '../src/http/bonk-lab-routes.js';
import { LabWalletError } from '../src/lab-moderation/store.js';
import { count, setup, type TestCore } from './helpers.js';

// Bonk VNext lot 5 — salves (mode Auto): N individual Bonks admitted and paid atomically, claimed together,
// each with its own lifecycle. The single Bonk (mode Manuel) is unchanged.

const CHANNEL = '900100';
const STUDIO = 'studio-A';
const VIEWER = { id: '900101', display_name: 'Viewer Lab' };
let seq = 0;

const smile = {
  provider: 'unicode' as const,
  id: 'unicode:1f600',
  glyph: '😀',
};
const fire = { provider: 'unicode' as const, id: 'unicode:1f525', glyph: '🔥' };
const volleyReq = (
  over: Partial<BonkLabVolleyAdmitRequest> = {},
): BonkLabVolleyAdmitRequest => ({
  idempotency_key: `v-${++seq}`,
  channel_id: CHANNEL,
  viewer: VIEWER,
  lab_session_id: 'lab-1',
  emotes: [smile, fire, smile],
  cadence_ms: 160,
  ...over,
});
const single = (key = `s-${++seq}`, viewer = VIEWER) => ({
  idempotency_key: key,
  channel_id: CHANNEL,
  viewer,
  lab_session_id: 'lab-1',
  emote: smile,
});

async function ready(core: TestCore) {
  await core.bonkLab.heartbeat({
    studio_instance_id: STUDIO,
    obs: 'connected',
    source_ready: true,
    overlay_ready: true,
  });
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (error) {
    if (
      error instanceof BonkLabError409 ||
      error instanceof BonkLabUnavailableError ||
      error instanceof LabWalletError
    )
      return error.code;
    return `unexpected: ${(error as Error).message}`;
  }
};
const tokens = async (core: TestCore, viewer = VIEWER.id) =>
  Number(
    (
      await core.db.query<{ tokens: string }>(
        'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
        [CHANNEL, viewer],
      )
    )[0]?.tokens ?? NaN,
  );
const setTokens = (core: TestCore, value: number, viewer = VIEWER.id) =>
  core.db.query(
    `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
     values ($1, $2, $3, 0, 0, now())
     on conflict (channel_id, viewer_id) do update set tokens = excluded.tokens`,
    [CHANNEL, viewer, value],
  );
const ack = (
  core: TestCore,
  i: BonkLabInteraction,
  event: 'started' | 'completed' | 'failed' | 'execution_unknown',
) =>
  core.bonkLab.ack(i.interaction_id, {
    studio_instance_id: STUDIO,
    attempt_id: i.delivery.attempt_id!,
    event,
  });

describe('Bonk salves — atomic admission', () => {
  it('admits N individual Bonks in one go: contiguous sequences, firing order, one debit per shot', async () => {
    const core = await setup();
    await ready(core);
    await core.bonkLab.admit(single()); // sequence 1, before the salve
    const before = await tokens(core);
    const out = await core.bonkLab.admitVolley(volleyReq());
    expect(out.replayed).toBe(false);
    expect(out.interactions.map((i) => i.channel_sequence)).toEqual([2, 3, 4]);
    expect(out.interactions.map((i) => i.emote_id)).toEqual([
      'unicode:1f600',
      'unicode:1f525',
      'unicode:1f600',
    ]);
    for (const [index, i] of out.interactions.entries())
      expect(i).toMatchObject({
        status: 'queued',
        quantity: 1,
        simulated_cost: 200,
        test_mode: true,
        payment_mode: 'simulated',
        volley: { id: out.volley_id, index, count: 3, cadence_ms: 160 },
      });
    expect(before - (await tokens(core))).toBe(3 * 200);
  });

  it('same key + same salve replays (nothing paid twice); same key + other salve is refused', async () => {
    const core = await setup();
    await ready(core);
    const req = volleyReq();
    const first = await core.bonkLab.admitVolley(req);
    const paid = await tokens(core);
    const again = await core.bonkLab.admitVolley(req);
    expect(again.replayed).toBe(true);
    expect(again.volley_id).toBe(first.volley_id);
    expect(again.interactions.map((i) => i.interaction_id)).toEqual(
      first.interactions.map((i) => i.interaction_id),
    );
    expect(await tokens(core)).toBe(paid);
    expect(
      await code(core.bonkLab.admitVolley({ ...req, cadence_ms: 420 })),
    ).toBe('idempotency_conflict');
    expect(
      await code(core.bonkLab.admitVolley({ ...req, emotes: [fire] })),
    ).toBe('idempotency_conflict');
    expect(await count(core.db, 'bonk_lab_interactions')).toBe(3);
  });

  it('insufficient balance for the whole salve: nothing admitted, nothing paid (never a partial salve)', async () => {
    const core = await setup();
    await ready(core);
    await setTokens(core, 500); // 2 shots worth, the salve has 3
    expect(await code(core.bonkLab.admitVolley(volleyReq()))).toBe(
      'insufficient_tokens',
    );
    expect(await tokens(core)).toBe(500);
    expect(await count(core.db, 'bonk_lab_interactions')).toBe(0);
    // A single Bonk (Manuel) still passes with the same balance.
    expect(await code(core.bonkLab.admit(single()))).toBe('ok');
    expect(await tokens(core)).toBe(300);
  });

  it('one invalid emote refuses the whole salve; Core bounds (shots, cadence) are enforced', async () => {
    const core = await setup();
    await ready(core);
    expect(
      await code(
        core.bonkLab.admitVolley(
          volleyReq({
            emotes: [smile, { provider: 'unicode', id: 'unicode:zz' }],
          }),
        ),
      ),
    ).toBe('emote_not_available');
    const max = BONK_LAB_RULES.volleyMaxShots;
    expect(
      await code(
        core.bonkLab.admitVolley(
          volleyReq({ emotes: Array.from({ length: max + 1 }, () => smile) }),
        ),
      ),
    ).toBe('volley_too_large');
    expect(
      await code(
        core.bonkLab.admitVolley(
          volleyReq({ cadence_ms: BONK_LAB_RULES.volleyCadenceMinMs - 1 }),
        ),
      ),
    ).toBe('invalid_cadence');
    expect(
      await code(
        core.bonkLab.admitVolley(
          volleyReq({ cadence_ms: BONK_LAB_RULES.volleyCadenceMaxMs + 1 }),
        ),
      ),
    ).toBe('invalid_cadence');
    expect(
      await code(
        core.bonkLab.admitVolley(
          volleyReq({ emotes: Array.from({ length: max }, () => smile) }),
        ),
      ),
    ).toBe('ok');
    expect(await count(core.db, 'bonk_lab_interactions')).toBe(max);
    // The contract itself refuses an empty or absurd salve and caller-imposed payment fields.
    for (const bad of [
      { emotes: [] },
      { emotes: Array.from({ length: 51 }, () => smile) },
      { payment_mode: 'jetons' },
    ])
      expect(
        BonkLabVolleyAdmitRequest.safeParse({ ...volleyReq(), ...bad }).success,
      ).toBe(false);
  });

  it('Studio not ready, moderation pause or a full queue: refused before anything is stored', async () => {
    const core = await setup();
    expect(await code(core.bonkLab.admitVolley(volleyReq()))).toBe(
      'studio_offline',
    );
    await ready(core);
    for (let i = 0; i < BONK_LAB_RULES.maxOpenPerChannel - 2; i++)
      await core.bonkLab.admit(single());
    expect(await code(core.bonkLab.admitVolley(volleyReq()))).toBe(
      'queue_full',
    );
    expect(await count(core.db, 'bonk_lab_interactions')).toBe(
      BONK_LAB_RULES.maxOpenPerChannel - 2,
    );
  });
});

describe('Bonk salves — delivery', () => {
  it('claimBatch hands out the whole salve at once, in firing order, each shot with its own attempt', async () => {
    const core = await setup();
    await ready(core);
    const other = { id: '900102', display_name: 'Autre' };
    const early = await core.bonkLab.admit(single(undefined, other)); // before the salve
    const { interactions } = await core.bonkLab.admitVolley(volleyReq());
    const late = await core.bonkLab.admit(single(undefined, other)); // after the salve

    const a = await core.bonkLab.claimBatch(STUDIO, CHANNEL);
    expect(a.interaction?.interaction_id).toBe(
      early.interaction.interaction_id,
    );
    expect(a.volley).toBeNull();
    await ack(core, a.interaction!, 'started');

    const b = await core.bonkLab.claimBatch(STUDIO, CHANNEL);
    const shots = [b.interaction!, ...b.volley!];
    expect(shots.map((s) => s.interaction_id)).toEqual(
      interactions.map((i) => i.interaction_id),
    );
    expect(new Set(shots.map((s) => s.delivery.attempt_id)).size).toBe(3);
    // Start order kept: nothing else is handed out before the salve's shots have started.
    expect(
      (await core.bonkLab.claimBatch(STUDIO, CHANNEL)).interaction,
    ).toBeNull();
    for (const s of shots) await ack(core, s, 'started');
    const c = await core.bonkLab.claimBatch(STUDIO, CHANNEL);
    expect(c.interaction?.interaction_id).toBe(late.interaction.interaction_id);
  });

  it('the historical single claim takes one shot at a time (never claims a shot without returning it)', async () => {
    const core = await setup();
    await ready(core);
    const { interactions } = await core.bonkLab.admitVolley(volleyReq());
    const first = await core.bonkLab.claim(STUDIO, CHANNEL);
    expect(first?.interaction_id).toBe(interactions[0]!.interaction_id);
    expect(await count(core.db, 'bonk_lab_deliveries')).toBe(1);
    await ack(core, first!, 'started');
    expect((await core.bonkLab.claim(STUDIO, CHANNEL))?.interaction_id).toBe(
      interactions[1]!.interaction_id,
    );
  });

  it('per-shot outcome: a shot failed before its start is refunded alone; the others complete', async () => {
    const core = await setup();
    await ready(core);
    await core.bonkLab.admitVolley(volleyReq());
    const paid = await tokens(core);
    const { interaction, volley } = await core.bonkLab.claimBatch(
      STUDIO,
      CHANNEL,
    );
    const [s0, s1, s2] = [interaction!, ...volley!];
    await ack(core, s0!, 'started');
    await ack(core, s0!, 'completed');
    expect((await ack(core, s1!, 'failed')).refund_status).toBe('refunded');
    await ack(core, s2!, 'started');
    await ack(core, s2!, 'completed');
    expect(await tokens(core)).toBe(paid + 200);
    const statuses = (await core.bonkLab.recent(CHANNEL, VIEWER.id)).map(
      (i) => [i.volley?.index, i.status, i.refund_status],
    );
    expect(statuses).toEqual([
      [2, 'completed', 'none'],
      [1, 'failed', 'refunded'],
      [0, 'completed', 'none'],
    ]);
  });

  it('lost Studio: each claimed shot ends execution_unknown (never success, never a silent refund); an unclaimed salve expires and is refunded once per shot', async () => {
    const core = await setup();
    await ready(core);
    await core.bonkLab.admitVolley(volleyReq());
    await core.bonkLab.claimBatch(STUDIO, CHANNEL);
    core.clock.advance(BONK_LAB_RULES.claimLeaseMs + 1);
    await core.bonkLab.sweepExpired();
    expect(
      (await core.bonkLab.recent(CHANNEL, VIEWER.id)).map((i) => i.status),
    ).toEqual(['execution_unknown', 'execution_unknown', 'execution_unknown']);

    const core2 = await setup();
    await ready(core2);
    await core2.bonkLab.admitVolley(volleyReq());
    const paid = await tokens(core2);
    core2.clock.advance(BONK_LAB_RULES.expiresAfterMs + 1);
    await core2.bonkLab.sweepExpired();
    await core2.bonkLab.sweepExpired(); // refund at most once
    const rows = await core2.bonkLab.recent(CHANNEL, VIEWER.id);
    expect(rows.map((i) => [i.status, i.refund_status])).toEqual([
      ['failed', 'refunded'],
      ['failed', 'refunded'],
      ['failed', 'refunded'],
    ]);
    expect(await tokens(core2)).toBe(paid + 3 * 200);
  });

  it('a single Bonk (Manuel) is unchanged: no volley, claimed alone', async () => {
    const core = await setup();
    await ready(core);
    const { interaction } = await core.bonkLab.admit(single());
    expect(interaction.volley).toBeNull();
    expect(await core.bonkLab.claimBatch(STUDIO, CHANNEL)).toMatchObject({
      interaction: { interaction_id: interaction.interaction_id },
      volley: null,
    });
  });
});

describe('Bonk salves — routes', () => {
  it('rules, salve admission and batch claim through the Lab route table (same as the viewer frontier)', async () => {
    const core = await setup();
    await ready(core);
    const call = internalLabCall(bonkLabRoutes(core.bonkLab));
    expect(await call('/v1/lab/bonk/rules')).toEqual({
      cost: 200,
      volley: {
        max_shots: BONK_LAB_RULES.volleyMaxShots,
        cadence_min_ms: BONK_LAB_RULES.volleyCadenceMinMs,
        cadence_max_ms: BONK_LAB_RULES.volleyCadenceMaxMs,
      },
    });
    const admitted = await call<{ volley_id: string; interactions: unknown[] }>(
      '/v1/lab/bonk/volleys',
      volleyReq(),
    );
    expect(admitted.interactions).toHaveLength(3);
    const claimed = await call<{ interaction: unknown; volley: unknown[] }>(
      '/v1/lab/bonk/claim',
      { studio_instance_id: STUDIO, channel_id: CHANNEL },
    );
    expect(claimed.volley).toHaveLength(2);
    await expect(
      call('/v1/lab/bonk/volleys', { ...volleyReq(), cadence_ms: 1 }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_cadence' },
    });
  });
});
