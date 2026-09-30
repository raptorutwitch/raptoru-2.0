import { editWallet } from '../src/lab-moderation/store.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TtsLabAdmitRequest, TtsLabInteraction } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { CAST_CATALOG, pickCast, VOICE_RATES } from '../src/tts-lab/cast.js';
import {
  DEFAULT_TTS_RULES,
  editableRules,
  normalizeMessage,
  quote,
} from '../src/tts-lab/rules.js';
import {
  TtsLabError409,
  TtsLabService,
  TtsLabUnavailableError,
} from '../src/tts-lab/tts-lab-service.js';
import { count, MINUTE, setup, type TestCore } from './helpers.js';

const CHANNEL = '900100';
const STUDIO = 'studio-A';
let seq = 0;
const req = (over: Partial<TtsLabAdmitRequest> = {}): TtsLabAdmitRequest => ({
  idempotency_key: `k-${++seq}`,
  channel_id: CHANNEL,
  viewer: { id: String(900200 + seq), display_name: `Viewer ${seq}` },
  lab_session_id: 'lab-1',
  text: 'Salut Raptoru ! Bon courage pour le boss ce soir',
  payment_method: 'tokens',
  ...over,
});
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (error) {
    return error instanceof TtsLabError409 ||
      error instanceof TtsLabUnavailableError
      ? error.code
      : `unexpected: ${(error as Error).message}`;
  }
};
async function lab(random: () => number = Math.random) {
  const core = await setup();
  const tts = new TtsLabService(core.db, core.clock, random);
  await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
  return { core, tts };
}
const ack = (
  tts: TtsLabService,
  i: TtsLabInteraction,
  event: 'started' | 'completed' | 'failed' | 'execution_unknown',
) =>
  tts.ack(i.interaction_id, {
    studio_instance_id: STUDIO,
    attempt_id: i.delivery.attempt_id!,
    event,
  });
const rows = (core: TestCore) => count(core.db, 'tts_lab_interactions');

describe('TTS V2 rules (legacy values, server-side)', () => {
  it('keeps the legacy tiers: base 7 500, ×1/1.5/2/3/5, cooldowns 60…300 s, curve 1…0.1', () => {
    expect(DEFAULT_TTS_RULES.base_price).toBe(7500);
    expect(
      [1, 80, 81, 150, 151, 300, 301, 500, 501, 2000].map(
        (n) => quote(n, DEFAULT_TTS_RULES).price,
      ),
    ).toEqual([
      7500, 7500, 11250, 11250, 15000, 15000, 22500, 22500, 37500, 37500,
    ]);
    expect(DEFAULT_TTS_RULES.tiers.map((t) => t.cooldown_seconds)).toEqual([
      60, 90, 120, 180, 300,
    ]);
    expect(
      DEFAULT_TTS_RULES.tiers.map((t) => t.painful_voice_weight_multiplier),
    ).toEqual([1, 0.8, 0.5, 0.25, 0.1]);
    expect(DEFAULT_TTS_RULES.max_per_viewer).toBe(1);
    expect(DEFAULT_TTS_RULES.max_waiting_global).toBe(5);
  });
  it('normalizes like the legacy player and counts code points', () => {
    expect(normalizeMessage('  a\u0007b\n\n c  ')).toEqual({
      text: 'a b c',
      length: 5,
    });
    expect(normalizeMessage('😀😀').length).toBe(2);
  });
});

describe('TTS V2 cast (Core decides, legacy probabilities)', () => {
  it('Core catalog = shared extension/player catalog (ids, weights, categories, rates)', async () => {
    const path = pathToFileURL(
      join(
        import.meta.dirname,
        '../../twitch-extension/extension/shared/tts-characters.js',
      ),
    ).href;
    const shared = (await import(path)) as {
      CHARACTERS: {
        id: string;
        voicePool: {
          voiceProfileId: string;
          weight: number;
          category: string;
        }[];
      }[];
      VOICE_PROFILES: Record<string, { rate: number }>;
    };
    expect(shared.CHARACTERS.map((c) => c.id)).toEqual(
      CAST_CATALOG.map((c) => c.id),
    );
    for (const c of CAST_CATALOG) {
      const other = shared.CHARACTERS.find((x) => x.id === c.id)!;
      expect(
        other.voicePool.map((v) => [v.voiceProfileId, v.weight, v.category]),
      ).toEqual(
        c.voices.map((v) => [v.voice_profile_id, v.weight, v.category]),
      );
      for (const v of c.voices)
        expect(shared.VOICE_PROFILES[v.voice_profile_id]!.rate).toBe(
          VOICE_RATES[v.voice_profile_id],
        );
    }
  });

  it('never draws the same character twice in a row', () => {
    for (let i = 0; i < 200; i++) {
      const last = CAST_CATALOG[i % CAST_CATALOG.length]!.id;
      expect(
        pickCast(40, DEFAULT_TTS_RULES, Math.random, last).character_id,
      ).not.toBe(last);
    }
  });
  it('applies the variant and Japanese probabilities with the length curve', () => {
    const draws = (length: number, character: string) => {
      const others = CAST_CATALOG.filter((c) => c.id === character);
      const n = 20_000;
      const out = { variant: 0, japanese: 0, normal: 0 };
      for (let i = 0; i < n; i++)
        out[
          pickCast(length, DEFAULT_TTS_RULES, Math.random, null, others)
            .voice_category
        ]++;
      return { variant: out.variant / n, japanese: out.japanese / n };
    };
    expect(draws(40, 'golem').variant).toBeCloseTo(0.5, 1); // golem override 50 %
    expect(draws(40, 'zote').variant).toBeCloseTo(0.25, 1); // base 25 %
    expect(draws(600, 'zote').variant).toBeCloseTo(0.025, 1); // × 0.1 for long messages
    expect(draws(40, 'mikasa').japanese).toBeCloseTo(0.2, 1);
    expect(draws(200, 'c21').japanese).toBeCloseTo(0.1, 1); // × 0.5
    expect(draws(40, 'andras').japanese).toBe(0); // no Japanese voice
  });
});

describe('TTS V2 admission', () => {
  it('pays once and draws the cast once: a retry with the same key replays the same TTS', async () => {
    const { core, tts } = await lab();
    const r = req();
    const first = await tts.admit(r);
    const again = await tts.admit(r);
    expect(again.replayed).toBe(true);
    expect(again.interaction.interaction_id).toBe(
      first.interaction.interaction_id,
    );
    expect(again.interaction.cast).toEqual(first.interaction.cast);
    expect(await rows(core)).toBe(1);
    expect(first.interaction).toMatchObject({
      status: 'queued',
      simulated_cost: 7500,
      real_debited: 0,
      refund_status: 'none',
      test_mode: true,
    });
    expect(await code(tts.admit({ ...r, text: 'un autre message' }))).toBe(
      'idempotency_conflict',
    );
    // Refresh / reopening: the viewer's current TTS (same cast) comes back from Core.
    const state = await tts.viewerState(CHANNEL, r.viewer.id);
    expect(state.current?.interaction.cast).toEqual(first.interaction.cast);
    expect(state.viewer_busy).toBe(true);
  });

  it('prices credits per tier (legacy: 1 credit) and tokens by tier', async () => {
    const { core, tts } = await lab();
    // Lab test wallet big enough for the expensive tiers (default: 12 000 jetons).
    await editWallet(
      core.db,
      core.clock.now(),
      CHANNEL,
      '900990',
      'set',
      { tokens: 1_000_000 },
      'test',
    );
    const long = await tts.admit(
      req({
        viewer: { id: '900990', display_name: 'Rich' },
        text: 'a'.repeat(320),
      }),
    );
    expect(long.interaction).toMatchObject({
      tier_id: '301-500',
      simulated_cost: 22500,
      cooldown_seconds: 180,
    });
    const credit = await tts.admit(
      req({ payment_method: 'credits', text: 'b'.repeat(600) }),
    );
    expect(credit.interaction).toMatchObject({
      simulated_cost: 1,
      simulated_currency: 'credits_tts_lab',
      tier_id: '501+',
    });
  });

  it('refuses before any payment: invalid text, paused, disabled, player offline, blocked, busy, queue full', async () => {
    const { core, tts } = await lab();
    expect(await code(tts.admit(req({ text: '   ' })))).toBe('empty_message');
    expect(await code(tts.admit(req({ text: '!!! ???' })))).toBe(
      'message_unreadable',
    );
    expect(await code(tts.admit(req({ text: 'x'.repeat(2001) })))).toBe(
      'message_too_long',
    );
    await tts.moderate(CHANNEL, { action: 'pause', actor: 'mod' });
    expect(await code(tts.admit(req()))).toBe('tts_paused');
    await tts.moderate(CHANNEL, { action: 'disable', actor: 'mod' });
    expect(await code(tts.admit(req()))).toBe('tts_disabled');
    await tts.moderate(CHANNEL, { action: 'resume', actor: 'mod' });
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: false });
    expect(await code(tts.admit(req()))).toBe('player_offline');
    core.clock.advance(MINUTE);
    expect(await code(tts.admit(req()))).toBe('studio_offline');
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    const blocked = req();
    await tts.moderate(CHANNEL, {
      action: 'block_viewer',
      actor: 'mod',
      viewer_id: blocked.viewer.id,
      until: null,
    });
    expect(await code(tts.admit(blocked))).toBe('viewer_blocked');
    expect(await rows(core)).toBe(0);
    const one = req();
    await tts.admit(one);
    expect(await code(tts.admit({ ...req(), viewer: one.viewer }))).toBe(
      'viewer_busy',
    );
    for (let i = 0; i < 4; i++) await tts.admit(req());
    expect(await code(tts.admit(req()))).toBe('queue_full');
    expect(await rows(core)).toBe(5);
    expect((await tts.viewerState(CHANNEL, '1')).queue_full).toBe(true);
  });
});

describe('TTS V2 execution, cooldown and refunds', () => {
  it('reads one at a time in order; cooldown starts at the real `started`, not at the purchase', async () => {
    const { core, tts } = await lab();
    const a = await tts.admit(req());
    const b = await tts.admit(req());
    expect(b.queue.position).toBe(2);
    expect(b.queue.wait_ms).toBe(
      a.interaction.estimated_weight + DEFAULT_TTS_RULES.transition_gap_ms,
    );
    const claimed = (await tts.claim(STUDIO, CHANNEL))!;
    expect(claimed.interaction_id).toBe(a.interaction.interaction_id);
    expect(claimed.status).toBe('starting');
    expect(await tts.claim(STUDIO, CHANNEL)).toBeNull(); // strictly sequential
    core.clock.advance(20_000); // purchase → start delay must not eat the cooldown
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    expect(
      (await tts.viewerState(CHANNEL, a.interaction.viewer_id))
        .cooldown_remaining_ms,
    ).toBe(0);
    const playing = await ack(tts, claimed, 'started');
    expect(playing.status).toBe('playing');
    expect(
      (await tts.viewerState(CHANNEL, a.interaction.viewer_id))
        .cooldown_remaining_ms,
    ).toBe(60_000);
    expect(await ack(tts, claimed, 'started')).toMatchObject({
      status: 'playing',
    }); // replayed ACK
    const done = await ack(tts, claimed, 'completed');
    expect(done.status).toBe('completed');
    expect(done.refund_status).toBe('none');
    // Cooldown: the same viewer cannot buy again before it ends.
    expect(
      await code(
        tts.admit({
          ...req(),
          viewer: { id: a.interaction.viewer_id, display_name: 'x' },
        }),
      ),
    ).toBe('viewer_cooldown');
    const next = (await tts.claim(STUDIO, CHANNEL))!;
    expect(next.interaction_id).toBe(b.interaction.interaction_id);
  });

  it('refunds automatically (once) a TTS that failed before starting; not one that failed while playing', async () => {
    const { core, tts } = await lab();
    const a = await tts.admit(req());
    const c1 = (await tts.claim(STUDIO, CHANNEL))!;
    const failed = await tts.ack(c1.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: c1.delivery.attempt_id!,
      event: 'failed',
      error: { code: 'voice_unavailable', message: 'no Windows voice' },
    });
    expect(failed).toMatchObject({
      status: 'failed',
      refund_status: 'refunded',
    });
    expect(await ack(tts, c1, 'failed')).toMatchObject({
      refund_status: 'refunded',
    }); // replay: no second refund
    expect(
      await code(
        tts.moderate(CHANNEL, {
          action: 'refund',
          actor: 'mod',
          interaction_id: a.interaction.interaction_id,
        }),
      ),
    ).toBe('already_refunded');
    expect(
      (
        await core.db.query<{ n: number }>(
          "select count(*)::int as n from lab_moderation_audit where action = 'refund'",
        )
      )[0]!.n,
    ).toBe(1);
    await tts.admit(req());
    const c2 = (await tts.claim(STUDIO, CHANNEL))!;
    await ack(tts, c2, 'started');
    expect(await ack(tts, c2, 'failed')).toMatchObject({
      status: 'failed',
      refund_status: 'none',
    });
  });

  it('expired queue entries fail and are refunded; a lost player lease is execution_unknown (not refunded)', async () => {
    const { core, tts } = await lab();
    await tts.moderate(CHANNEL, { action: 'pause', actor: 'mod' }); // nothing is claimed while paused
    await tts.moderate(CHANNEL, { action: 'resume', actor: 'mod' });
    const a = await tts.admit(req());
    await tts.moderate(CHANNEL, { action: 'pause', actor: 'mod' });
    expect(await tts.claim(STUDIO, CHANNEL)).toBeNull(); // paused keeps the queue
    core.clock.advance(31 * MINUTE);
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    expect(await tts.get(a.interaction.interaction_id)).toMatchObject({
      status: 'queued',
    });
    await tts.viewerState(CHANNEL, '1'); // any read sweeps
    expect(await tts.get(a.interaction.interaction_id)).toMatchObject({
      status: 'failed',
      refund_status: 'refunded',
    });
    await tts.moderate(CHANNEL, { action: 'resume', actor: 'mod' });
    const b = await tts.admit(req());
    const c = (await tts.claim(STUDIO, CHANNEL))!;
    await ack(tts, c, 'started');
    core.clock.advance(b.interaction.estimated_duration_ms * 2 + 31_000);
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    await tts.viewerState(CHANNEL, '1');
    expect(await tts.get(b.interaction.interaction_id)).toMatchObject({
      status: 'execution_unknown',
      refund_status: 'none',
    });
  });

  describe('manual « clear cooldown » stays effective (Lab tests)', () => {
    const studio = {
      id: 'antoni',
      role: 'broadcaster',
      via: 'studio',
    } as const;
    const setup3 = async () => {
      const l = await lab();
      const viewer = { id: '900101', display_name: 'Viewer Lab' };
      await editWallet(
        l.core.db,
        l.core.clock.now(),
        CHANNEL,
        viewer.id,
        'set',
        { tokens: 1_000_000 },
        'test',
      );
      const buy = async () => {
        await l.tts.heartbeat({
          studio_instance_id: STUDIO,
          player_ready: true,
        });
        return l.tts.admit(req({ viewer }));
      };
      const clear = () =>
        l.core.db.tx((q) =>
          l.tts.applyModeration(
            q,
            CHANNEL,
            {
              action: 'viewer_cooldown',
              viewer_id: viewer.id,
              module: 'tts',
              mode: 'clear',
              seconds: 0,
            },
            studio,
            'broadcaster',
          ),
        );
      const cooldown = async () =>
        (await l.tts.viewerState(CHANNEL, viewer.id)).cooldown_remaining_ms;
      /** Claims the next TTS, starts it and (optionally) completes it. */
      const start = async () => {
        await l.tts.heartbeat({
          studio_instance_id: STUDIO,
          player_ready: true,
        });
        const c = (await l.tts.claim(STUDIO, CHANNEL))!;
        await ack(l.tts, c, 'started');
        return c;
      };
      return { ...l, viewer, buy, clear, cooldown, start };
    };

    it('clear before `started`: the start does not re-arm it; a new TTS is admitted right after the end', async () => {
      const { tts, core, buy, clear, cooldown, start } = await setup3();
      await buy(); // 1. purchase
      core.clock.advance(1_000);
      await clear(); // 2. clear before started
      core.clock.advance(1_000);
      const c = await start(); // 3. started
      expect(await cooldown()).toBe(0); // 4. still 0
      await ack(tts, c, 'completed');
      expect(await code(buy())).toBe('ok'); // 5. admitted at once
    });

    it('clear during playback and after playback', async () => {
      const { tts, core, buy, clear, cooldown, start } = await setup3();
      await buy();
      const c = await start();
      expect(await cooldown()).toBe(60_000);
      await clear(); // during playback
      expect(await cooldown()).toBe(0);
      expect(await code(buy())).toBe('viewer_busy'); // one TTS per viewer: rule kept
      await ack(tts, c, 'completed');
      expect(await cooldown()).toBe(0);
      core.clock.advance(1_000);
      const d = (await buy()).interaction;
      const e = await start();
      expect(e.interaction_id).toBe(d.interaction_id);
      await ack(tts, e, 'completed');
      expect(await cooldown()).toBe(60_000);
      await clear(); // after playback
      expect(await code(buy())).toBe('ok');
    });

    it('several TTS of the viewer in the queue: only those bought before the clear are exempted', async () => {
      const { tts, core, buy, clear, cooldown, start } = await setup3();
      const r = editableRules(DEFAULT_TTS_RULES);
      await tts.updateRules({ ...r, max_per_viewer: 3 }, studio, null);
      await buy();
      core.clock.advance(1_000);
      await buy();
      core.clock.advance(1_000);
      await clear();
      core.clock.advance(1_000);
      await buy(); // bought after the clear: normal cooldown
      for (const expected of [0, 0, 60_000]) {
        const c = await start();
        expect(await cooldown()).toBe(expected);
        await ack(tts, c, 'completed');
        core.clock.advance(1_000);
      }
    });

    it('no manual clear: legacy behaviour unchanged (cooldown armed at the real start)', async () => {
      const { tts, core, buy, cooldown, start } = await setup3();
      await buy();
      core.clock.advance(20_000);
      expect(await cooldown()).toBe(0);
      const c = await start();
      expect(await cooldown()).toBe(60_000);
      await ack(tts, c, 'completed');
      expect(await code(buy())).toBe('viewer_cooldown');
      core.clock.advance(60_000);
      expect(await code(buy())).toBe('ok');
    });
  });

  it('moderation: stop current / purge / cancel, refund only when asked, audit trail kept', async () => {
    const { tts } = await lab();
    const a = await tts.admit(req());
    const b = await tts.admit(req());
    const c = await tts.admit(req());
    const playing = (await tts.claim(STUDIO, CHANNEL))!;
    await ack(tts, playing, 'started');
    await tts.moderate(CHANNEL, {
      action: 'stop_current',
      actor: 'mod',
      refund: false,
    });
    expect(await tts.get(a.interaction.interaction_id)).toMatchObject({
      status: 'cancelled',
      refund_status: 'none',
    });
    // Late ACK from the player after the stop: accepted, ignored.
    expect(await ack(tts, playing, 'completed')).toMatchObject({
      status: 'cancelled',
    });
    await tts.moderate(CHANNEL, {
      action: 'cancel',
      actor: 'mod',
      interaction_id: b.interaction.interaction_id,
      refund: true,
    });
    expect(await tts.get(b.interaction.interaction_id)).toMatchObject({
      status: 'cancelled',
      refund_status: 'refunded',
    });
    await tts.moderate(CHANNEL, {
      action: 'purge',
      actor: 'mod',
      refund: true,
    });
    expect(await tts.get(c.interaction.interaction_id)).toMatchObject({
      status: 'cancelled',
      refund_status: 'refunded',
    });
    const audit = (await tts.auditTrail(CHANNEL)) as { action: string }[];
    expect(audit.map((x) => x.action)).toEqual(
      expect.arrayContaining(['stop', 'cancel', 'purge', 'refund']),
    );
    const q = await tts.queue(CHANNEL);
    expect(q.current).toBeNull();
    expect(q.waiting).toHaveLength(0);
  });
});
