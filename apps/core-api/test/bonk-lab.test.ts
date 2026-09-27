import { readFileSync } from 'node:fs';
import { BonkLabAdmitRequest } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  BONK_LAB_RULES,
  BonkLabError409,
  BonkLabService,
  BonkLabUnavailableError,
  twemojiEmote,
} from '../src/bonk-lab/bonk-lab-service.js';
import { count, setup, type TestCore } from './helpers.js';

const CHANNEL = '900100';
const STUDIO = 'studio-A';
let seq = 0;

const admitReq = (
  over: Partial<BonkLabAdmitRequest> = {},
): BonkLabAdmitRequest => ({
  idempotency_key: `k-${++seq}`,
  channel_id: CHANNEL,
  viewer: { id: '900101', display_name: 'Viewer Lab' },
  lab_session_id: 'lab-1',
  emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
  ...over,
});

async function ready(core: TestCore, over: Record<string, unknown> = {}) {
  await core.bonkLab.heartbeat({
    studio_instance_id: STUDIO,
    obs: 'connected',
    source_ready: true,
    overlay_ready: true,
    ...over,
  });
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (error) {
    return error instanceof BonkLabError409 ||
      error instanceof BonkLabUnavailableError
      ? error.code
      : `unexpected: ${(error as Error).message}`;
  }
};

const ack = (
  core: TestCore,
  i: { interaction_id: string; delivery: { attempt_id: string | null } },
  event: 'started' | 'completed' | 'failed' | 'execution_unknown' | 'released',
  studio = STUDIO,
) =>
  core.bonkLab.ack(i.interaction_id, {
    studio_instance_id: studio,
    attempt_id: i.delivery.attempt_id!,
    event,
  });

describe('Bonk Lab admission', () => {
  it('admits one Bonk: queued, durable sequence, test_mode and simulated payment imposed, emote resolved by Core', async () => {
    const core = await setup();
    await ready(core);
    const { interaction, replayed } = await core.bonkLab.admit(admitReq());
    expect(replayed).toBe(false);
    expect(interaction).toMatchObject({
      source: 'extension_lab',
      type: 'bonk',
      provider: 'unicode',
      emote_id: 'unicode:1f600',
      emote_glyph: '😀',
      emote_url: 'assets/twemoji/svg/1f600.svg',
      emote_animated: false,
      quantity: 1,
      channel_sequence: 1,
      test_mode: true,
      payment_mode: 'simulated',
      simulated_cost: 200,
      real_debited: 0,
      status: 'queued',
      error: null,
    });
  });

  it('never trusts the caller for test_mode / payment_mode / url (strict contract)', () => {
    for (const extra of [
      { test_mode: false },
      { payment_mode: 'jetons' },
      { emote_url: 'https://evil.example/x.png' },
    ])
      expect(
        BonkLabAdmitRequest.safeParse({ ...admitReq(), ...extra }).success,
      ).toBe(false);
  });

  it('same key + same payload replays; same key + other payload is refused; unknown emote refused', async () => {
    const core = await setup();
    await ready(core);
    const req = admitReq();
    const first = await core.bonkLab.admit(req);
    const again = await core.bonkLab.admit(req);
    expect(again).toMatchObject({
      replayed: true,
      interaction: { interaction_id: first.interaction.interaction_id },
    });
    expect(
      await code(
        core.bonkLab.admit({
          ...req,
          emote: { provider: 'unicode', id: 'unicode:1f603' },
        }),
      ),
    ).toBe('idempotency_conflict');
    for (const id of ['unicode:zz', 'unicode:110000', 'twemoji:1f603'])
      expect(
        await code(
          core.bonkLab.admit(admitReq({ emote: { provider: 'unicode', id } })),
        ),
      ).toBe('emote_not_available');
    expect(
      await code(
        core.bonkLab.admit(
          admitReq({
            emote: { provider: 'unicode', id: 'unicode:1f603', glyph: '😀' },
          }),
        ),
      ),
    ).toBe('emote_mismatch');
    expect(await count(core.db, 'bonk_lab_interactions')).toBe(1);
  });

  it('any Unicode emoji resolves to its local Twemoji path, built by Core', async () => {
    expect(twemojiEmote('unicode:1f603')).toEqual({
      glyph: '😃',
      url: 'assets/twemoji/svg/1f603.svg',
      animated: false,
    });
    // FE0F dropped and leading zeros trimmed, like the extension asset lookup.
    expect(twemojiEmote('unicode:2764-fe0f')?.url).toBe(
      'assets/twemoji/svg/2764.svg',
    );
    expect(twemojiEmote('unicode:0023-fe0f-20e3')).toMatchObject({
      glyph: '#️⃣',
      url: 'assets/twemoji/svg/23-20e3.svg',
    });
    const core = await setup();
    await ready(core);
    const { interaction } = await core.bonkLab.admit(
      admitReq({
        emote: { provider: 'unicode', id: 'unicode:1f44d-1f3fd', glyph: '👍🏽' },
      }),
    );
    expect(interaction.emote_url).toBe('assets/twemoji/svg/1f44d-1f3fd.svg');
  });

  it('channel_sequence is monotone and gap-free under concurrent admissions', async () => {
    const core = await setup();
    await ready(core);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        core.bonkLab.admit(
          admitReq({
            viewer: { id: String(900200 + (i % 3)), display_name: `V${i}` },
          }),
        ),
      ),
    );
    expect(
      results.map((r) => r.interaction.channel_sequence).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('refuses before admission when Studio, OBS or the overlay is not ready (nothing stored)', async () => {
    const core = await setup();
    expect(await code(core.bonkLab.admit(admitReq()))).toBe('studio_offline');
    await ready(core, { obs: 'offline' });
    expect(await code(core.bonkLab.admit(admitReq()))).toBe('obs_offline');
    // OBS connected but the renderer has no heartbeat: not ready.
    await ready(core, { overlay_ready: false });
    expect(await code(core.bonkLab.admit(admitReq()))).toBe(
      'overlay_not_ready',
    );
    await ready(core, { source_ready: false });
    expect(await code(core.bonkLab.admit(admitReq()))).toBe(
      'overlay_not_ready',
    );
    // A stale heartbeat is an offline Studio.
    await ready(core);
    core.clock.set(
      new Date(
        core.clock.now().getTime() + BONK_LAB_RULES.heartbeatFreshMs + 1,
      ),
    );
    expect(await code(core.bonkLab.admit(admitReq()))).toBe('studio_offline');
    expect(await count(core.db, 'bonk_lab_interactions')).toBe(0);
  });

  it('touches no Wallet, Loyalty, Daily, Presence or stats table, and does not even import them', async () => {
    const core = await setup();
    await ready(core);
    const tables = [
      'wallets',
      'wallet_operations',
      'wallet_transactions',
      'loyalty_rewards',
      'daily_claims',
      'daily_credits',
      'presence_viewer_streams',
      'viewers',
    ];
    const before = await Promise.all(tables.map((t) => count(core.db, t)));
    const { interaction } = await core.bonkLab.admit(admitReq());
    const claimed = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    await ack(core, claimed, 'started');
    await ack(core, claimed, 'completed');
    expect(await Promise.all(tables.map((t) => count(core.db, t)))).toEqual(
      before,
    );
    expect(
      (await core.bonkLab.get(interaction.interaction_id)).real_debited,
    ).toBe(0);
    const source = readFileSync(
      new URL('../src/bonk-lab/bonk-lab-service.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/from '\.\.\/(wallet|loyalty|daily|presence)\//);
  });
});

describe('Bonk Lab execution (Studio worker contract)', () => {
  it('claim in sequence order; started → executing; completed → completed; duplicate ACKs are replays', async () => {
    const core = await setup();
    await ready(core);
    const a = (await core.bonkLab.admit(admitReq())).interaction;
    const b = (await core.bonkLab.admit(admitReq())).interaction;
    const c1 = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    expect(c1.interaction_id).toBe(a.interaction_id);
    // Start order: nothing else is handed out before the first one has started.
    expect(await core.bonkLab.claim(STUDIO, CHANNEL)).toBeNull();
    expect((await ack(core, c1, 'started')).status).toBe('executing');
    expect((await ack(core, c1, 'started')).status).toBe('executing'); // lost ACK re-sent
    // Overlap allowed after `started`.
    const c2 = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    expect(c2.interaction_id).toBe(b.interaction_id);
    const done = await ack(core, c1, 'completed');
    expect(done).toMatchObject({ status: 'completed', error: null });
    expect(done.delivery.started_at).not.toBeNull();
    expect(done.delivery.completed_at).not.toBeNull();
    expect((await ack(core, c1, 'completed')).status).toBe('completed'); // replay
    // Nothing regresses a final state; no success without `started`.
    expect(await code(ack(core, c1, 'failed'))).toBe('invalid_transition');
    expect(await code(ack(core, c2, 'completed'))).toBe('invalid_transition');
    // Another attempt cannot write this interaction.
    expect(await code(ack(core, c2, 'started', 'studio-B'))).toBe(
      'attempt_mismatch',
    );
  });

  it('failed and execution_unknown are explicit final states', async () => {
    const core = await setup();
    await ready(core);
    await core.bonkLab.admit(admitReq());
    await core.bonkLab.admit(admitReq());
    const f = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    const failed = await core.bonkLab.ack(f.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: f.delivery.attempt_id!,
      event: 'failed',
      error: { code: 'image_load_failed', message: 'twemoji not found' },
    });
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'image_load_failed', retryable: false },
    });
    const u = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    await ack(core, u, 'started');
    expect((await ack(core, u, 'execution_unknown')).status).toBe(
      'execution_unknown',
    );
    expect(await code(ack(core, u, 'completed'))).toBe('invalid_transition');
  });

  it('a lease that ends without renderer proof becomes execution_unknown, never success; unclaimed work expires', async () => {
    const core = await setup();
    await ready(core);
    const claimedA = (await core.bonkLab.admit(admitReq())).interaction;
    await core.bonkLab.claim(STUDIO, CHANNEL);
    const neverClaimed = (await core.bonkLab.admit(admitReq())).interaction;
    core.clock.set(
      new Date(core.clock.now().getTime() + BONK_LAB_RULES.expiresAfterMs + 1),
    );
    await ready(core);
    expect(await core.bonkLab.claim(STUDIO, CHANNEL)).toBeNull();
    expect((await core.bonkLab.get(claimedA.interaction_id)).status).toBe(
      'execution_unknown',
    );
    expect(await core.bonkLab.get(neverClaimed.interaction_id)).toMatchObject({
      status: 'failed',
      error: { code: 'expired' },
    });
  });

  it('restart: an unsent claim is released and replayed once; completed work is never handed out again', async () => {
    const core = await setup();
    await ready(core);
    const done = (await core.bonkLab.admit(admitReq())).interaction;
    const pending = (await core.bonkLab.admit(admitReq())).interaction;
    const c1 = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    await ack(core, c1, 'started');
    await ack(core, c1, 'completed');
    const c2 = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    expect(c2.interaction_id).toBe(pending.interaction_id);
    // Studio crashed after the claim, before sending it to the renderer: its journal says "not
    // emitted", so it releases it (same sequence, new attempt later).
    expect((await ack(core, c2, 'released')).delivery.attempt_id).toBeNull();
    const restarted = new BonkLabService(core.db, core.clock);
    const again = (await restarted.claim(STUDIO, CHANNEL))!;
    expect(again).toMatchObject({
      interaction_id: pending.interaction_id,
      channel_sequence: 2,
    });
    expect(again.delivery.attempt_id).not.toBe(c2.delivery.attempt_id);
    // Once the renderer has started it, it can never be released (it may be visible): no replay.
    await ack(core, again, 'started');
    expect(await code(ack(core, again, 'released'))).toBe('invalid_transition');
    expect(await restarted.claim(STUDIO, CHANNEL)).toBeNull();
    expect((await core.bonkLab.get(done.interaction_id)).status).toBe(
      'completed',
    );
  });
});

describe('Bonk Lab admission and claimant isolation', () => {
  it('does not let an offline worker borrow another Studio heartbeat', async () => {
    const core = await setup();
    await ready(core);
    await core.bonkLab.admit(admitReq());
    expect(await code(core.bonkLab.claim('offline-studio', CHANNEL))).toBe(
      'studio_offline',
    );
    expect((await core.bonkLab.claim(STUDIO, CHANNEL))?.channel_sequence).toBe(
      1,
    );
  });
  it('rejects a changed session or glyph under the same key', async () => {
    const core = await setup();
    await ready(core);
    const r = admitReq();
    await core.bonkLab.admit(r);
    expect(
      await code(core.bonkLab.admit({ ...r, lab_session_id: 'other' })),
    ).toBe('idempotency_conflict');
    expect(
      await code(
        core.bonkLab.admit({ ...r, emote: { ...r.emote, glyph: '😈' } }),
      ),
    ).toBe('idempotency_conflict');
  });
  it('expires a full abandoned queue before admitting new work', async () => {
    const core = await setup();
    await ready(core);
    for (let n = 0; n < BONK_LAB_RULES.maxOpenPerChannel; n++)
      await core.bonkLab.admit(admitReq());
    expect(await code(core.bonkLab.admit(admitReq()))).toBe('queue_full');
    core.clock.advance(BONK_LAB_RULES.expiresAfterMs + 1);
    await ready(core);
    expect((await core.bonkLab.admit(admitReq())).interaction.status).toBe(
      'queued',
    );
  });
});
