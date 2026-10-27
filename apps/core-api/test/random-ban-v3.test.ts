import { randomUUID } from 'node:crypto';
import { RANDOM_BAN } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { CautionService } from '../src/caution/service.js';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { RandomBanService } from '../src/random-ban/service.js';
import { VotekickService } from '../src/votekick/service.js';
import { setup } from './helpers.js';

// Random Ban V3 (27/10) — Core: the streamer as an exceptional target (his mic muted in OBS by Studio, never a Twitch
// timeout), drawn only when Studio can mute and nobody else mutes him; Studio's claim / report (leased, idempotent,
// stale attempts refused, never lost: back to the viewers' draw); the running mute listed for Studio; a paid caution
// ends it (300 Jetons per started 10 s) — through the real Caution, Random Ban and Votekick services.

const CH = '83603689';
const STREAMER = { id: CH, login: 'raptoru_' };
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const BUYER = { id: '9001', login: 'buyer', name: 'Buyer' };
const PAYER = { id: '9003', login: 'viewer3', name: 'Viewer3' };
const STUDIO = 'studio-rb-1';

async function fixture(drawn = true) {
  const core = await setup();
  core.clock.set(new Date('2026-10-27T20:00:00Z'));
  const votekick = new VotekickService(core.db, core.clock, () => CH);
  // draw(1000) for the streamer: 0 (< 20 ‰) drawn, 999 not; other draws (animations): 0.
  const rb = new RandomBanService(
    core.db,
    core.clock,
    (n) => (n === 1000 ? (drawn ? 0 : 999) : 0),
    { streamer: () => STREAMER, otherMutes: votekick },
  );
  const caution = new CautionService(
    core.db,
    core.clock,
    labEconomy,
    () => CH,
    [
      { kind: 'votekick', label: 'Votekick', source: votekick },
      { kind: 'random_ban', label: 'Random Ban', source: rb.mutes },
    ],
  );
  const ask = (mode: 'real' | 'dry_run' = 'real') =>
    rb.request({
      channel_id: CH,
      source: 'channel_points',
      source_ref: randomUUID(),
      mode,
      buyer: BUYER,
    });
  const studio = (o: { obs_ready?: boolean; mic_held?: boolean } = {}) =>
    rb.claimMute(CH, {
      consumer_id: STUDIO,
      obs_ready: o.obs_ready ?? true,
      mic_held: o.mic_held ?? false,
    });
  const report = (
    id: string,
    attempt: string,
    event: 'muted' | 'failed' = 'muted',
  ) => rb.reportMute(id, { consumer_id: STUDIO, attempt_id: attempt, event });
  const lines = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'rb:streamer:%' or idempotency_key like 'caution:%'
         order by seq_global`,
      )
    ).map((r) => r.params.text);
  return { core, rb, votekick, caution, ask, studio, report, lines };
}

describe('Random Ban V3 — the streamer drawn', () => {
  it('drawn only when Studio said « OBS ready, mic free » recently; never in a dry run', async () => {
    const f = await fixture();
    await f.ask();
    // Studio never polled: a viewers' search.
    expect((await f.rb.claim(CH, EXEC)).request).not.toBeNull();
    const f2 = await fixture();
    await f2.studio({ mic_held: true }); // BRB holds the mic
    await f2.ask();
    expect((await f2.rb.claim(CH, EXEC)).request).not.toBeNull();
    const f3 = await fixture();
    await f3.studio();
    f3.core.clock.advance(RANDOM_BAN.studioReadyMs + 1);
    await f3.ask();
    expect((await f3.rb.claim(CH, EXEC)).request).not.toBeNull();
    const f4 = await fixture();
    await f4.studio();
    await f4.ask('dry_run');
    expect((await f4.rb.claim(CH, EXEC)).request).not.toBeNull();
    const f5 = await fixture(false); // 999 ≥ 20 ‰
    await f5.studio();
    await f5.ask();
    expect((await f5.rb.claim(CH, EXEC)).request).not.toBeNull();
  });

  it('drawn: no Twitch job — Studio mutes 60 s, one chat line, the redemption result; listed while it runs', async () => {
    const f = await fixture();
    await f.studio();
    const r = await f.ask();
    expect(await f.rb.claim(CH, EXEC)).toEqual({
      request: null,
      reason: 'busy',
    });
    const c = await f.studio();
    expect(c.mute).toMatchObject({
      request_id: r.request_id,
      seconds: 60,
      buyer: 'Buyer',
      streamer: 'raptoru_',
    });
    expect((await f.studio()).mute).toBeNull(); // handed out once
    const done = await f.report(r.request_id, c.mute!.attempt_id);
    expect(done).toMatchObject({
      status: 'confirmed',
      streamer_mute: true,
      duration_s: 60,
      target: { id: CH, login: 'raptoru_' },
      refund: 'none',
    });
    // Same report again (answer lost): the state, nothing more.
    expect(await f.report(r.request_id, c.mute!.attempt_id)).toMatchObject({
      status: 'confirmed',
    });
    expect(await f.lines()).toEqual([
      '🔇 Buyer a coupé le micro de raptoru_ pendant 60 s !',
    ]);
    expect((await f.studio()).active).toEqual([
      {
        request_id: r.request_id,
        ends_at: new Date(f.core.clock.now().getTime() + 60_000).toISOString(),
      },
    ]);
    // While it runs: the next Random Ban is a viewers' one (never the streamer twice).
    await f.ask();
    expect((await f.rb.claim(CH, EXEC)).request).not.toBeNull();
    f.core.clock.advance(60_000);
    expect((await f.studio()).active).toEqual([]);
  });

  it('a stale attempt is refused; Studio failing or silent → back to a viewers’ draw (nothing lost)', async () => {
    const f = await fixture();
    await f.studio();
    const r = await f.ask();
    await f.rb.claim(CH, EXEC);
    const c = await f.studio();
    await expect(f.report(r.request_id, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await f.report(r.request_id, c.mute!.attempt_id, 'failed'),
    ).toMatchObject({ status: 'queued', target: null, streamer_mute: false });
    // Studio silent past its lease: swept back too.
    const f2 = await fixture();
    await f2.studio();
    const r2 = await f2.ask();
    await f2.rb.claim(CH, EXEC);
    await f2.studio();
    f2.core.clock.advance(RANDOM_BAN.studioMuteLeaseMs + 1);
    await f2.studio({ obs_ready: false }); // and it cannot mute now
    const next = await f2.rb.claim(CH, EXEC);
    expect(next.request?.request_id).toBe(r2.request_id); // a viewers' search
  });

  it('never while Votekick mutes him', async () => {
    const f = await fixture();
    await f.votekick.active(f.core.db, CH); // (no mute yet)
    const vk = {
      active: async () => ({
        id: 'mute:vk',
        endsAt: new Date(Date.now() + 1e9),
      }),
    };
    const rb = new RandomBanService(f.core.db, f.core.clock, () => 0, {
      streamer: () => STREAMER,
      otherMutes: vk,
    });
    await rb.claimMute(CH, {
      consumer_id: STUDIO,
      obs_ready: true,
      mic_held: false,
    });
    await f.ask();
    expect((await rb.claim(CH, EXEC)).request).not.toBeNull();
  });

  it('Studio « Tester le mute »: handed to Studio at once (no Twitch executor); refused while he is muted', async () => {
    const f = await fixture();
    const t = await f.rb.testStreamerMute(CH);
    expect(t).toMatchObject({
      status: 'timeout_requested',
      streamer_mute: true,
    });
    await expect(f.rb.testStreamerMute(CH)).rejects.toMatchObject({
      status: 409,
    });
    const c = await f.studio();
    expect(c.mute?.request_id).toBe(t.request_id);
  });
});

describe('Random Ban V3 — a caution on the streamer’s mute (real services)', () => {
  async function muted() {
    const f = await fixture();
    await f.studio();
    const r = await f.ask();
    await f.rb.claim(CH, EXEC);
    const c = await f.studio();
    await f.report(r.request_id, c.mute!.attempt_id);
    await editWallet(
      f.core.db,
      f.core.clock.now(),
      CH,
      PAYER.id,
      'set',
      { tokens: 10_000 },
      'test',
    );
    const msg = (text: string, id = randomUUID()) =>
      f.caution.chat({
        channel_id: CH,
        message_id: id,
        text,
        chatter: {
          id: PAYER.id,
          login: PAYER.login,
          display_name: PAYER.name,
          role: 'viewer',
        },
        source: 'twitch',
      });
    const quote = async (text = '!caution raptoru_') => {
      await f.caution.claim(CH, {
        executor_id: 'bot-1',
        login: 'lecroupier_',
        can_read: true,
        can_release: true,
        missing: [],
      });
      expect((await msg(text)).outcome).toBe('checking');
      const job = (
        await f.caution.claim(CH, {
          executor_id: 'bot-1',
          login: 'lecroupier_',
          can_read: true,
          can_release: true,
          missing: [],
        })
      ).job!;
      return f.caution.check(job.request_id, {
        executor_id: 'bot-1',
        attempt_id: job.attempt_id,
        target: { id: CH, login: 'raptoru_', name: 'Raptoru_' },
        sanction: { kind: 'none' },
      });
    };
    const tokens = async () =>
      Number(
        (
          await f.core.db.query<{ tokens: number }>(
            'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
            [CH, PAYER.id],
          )
        )[0]?.tokens ?? 0,
      );
    return { ...f, r, msg, quote, tokens };
  }

  it('quoted on the seconds left (41 s → 1 500), `oui` debits and ends it: Studio no longer lists it', async () => {
    const f = await muted();
    f.core.clock.advance(19_000);
    expect(await f.quote()).toMatchObject({ status: 'quoted', price: 1_500 });
    expect((await f.msg('oui')).outcome).toBe('released');
    expect(await f.tokens()).toBe(8_500);
    expect((await f.studio()).active).toEqual([]);
    expect((await f.rb.outcome(f.r.request_id))!).toMatchObject({
      status: 'confirmed',
      streamer_mute: true,
    });
    // Nothing left to pay for.
    expect(await f.quote()).toMatchObject({
      status: 'refused',
      reason: 'not_muted',
    });
  });

  it('the mute over before `oui`: nothing debited', async () => {
    const f = await muted();
    f.core.clock.advance(45_000);
    expect(await f.quote()).toMatchObject({ price: 600 }); // 15 s left: 2 × 300
    f.core.clock.advance(15_000); // the mute ends, the quote (30 s) is still open
    expect((await f.msg('oui')).outcome).toBe('mute_over');
    expect(await f.tokens()).toBe(10_000);
  });
});

describe('Random Ban V3 — « Tester le mute du streamer » is the mic only (Production contract)', () => {
  it('muted: no chat line, no animation, never a caution, no redemption; the mute is listed for Studio', async () => {
    const f = await fixture();
    const t = await f.rb.testStreamerMute(CH);
    const c = await f.studio();
    const done = await f.report(t.request_id, c.mute!.attempt_id);
    expect(done).toMatchObject({
      status: 'confirmed',
      streamer_mute: true,
      animation: null,
      animation_status: 'none',
      refund: 'none',
    });
    expect(await f.lines()).toEqual([]); // no chat line
    expect((await f.studio()).active.map((a) => a.request_id)).toEqual([
      t.request_id,
    ]);
    expect(await f.rb.mutes.active(f.core.db, CH)).toBeNull(); // no caution on a test
    expect((await f.rb.claimAnimation(CH, 'studio-anim')).animation).toBeNull();
    expect(
      (
        await f.core.db.query(
          `select 1 from lab_wallet_ledger where module_id in ('random_ban', 'caution')`,
        )
      ).length,
    ).toBe(0);
  });

  it('Studio failing or silent: the test ends there — never handed to the Twitch executor (nobody timed out)', async () => {
    const f = await fixture();
    const t = await f.rb.testStreamerMute(CH);
    const c = await f.studio();
    expect(
      await f.rb.reportMute(t.request_id, {
        consumer_id: 'studio-rb-1',
        attempt_id: c.mute!.attempt_id,
        event: 'failed',
        error: 'obs_offline',
      }),
    ).toMatchObject({ status: 'failed', refund: 'none' });
    expect(await f.rb.claim(CH, EXEC)).toEqual({
      request: null,
      reason: 'idle',
    });
    const f2 = await fixture();
    const t2 = await f2.rb.testStreamerMute(CH);
    f2.core.clock.advance(RANDOM_BAN.studioMuteLeaseMs + 1);
    expect(await f2.rb.claim(CH, EXEC)).toEqual({
      request: null,
      reason: 'idle',
    });
    expect((await f2.rb.outcome(t2.request_id))!).toMatchObject({
      status: 'failed',
      error: 'studio_silent',
    });
  });
});

describe('Random Ban V3 — the streamer trace (27/10): eligible or why not, the draw, re-eligibility', () => {
  const decisionOf = async (
    f: Awaited<ReturnType<typeof fixture>>,
    id: string,
  ) => (await f.rb.outcome(id))!.streamer_decision;

  it('every reason is recorded on the request: Studio never seen / too old, OBS not ready, mic held, dry run', async () => {
    const f = await fixture(false);
    const a = await f.ask();
    await f.rb.claim(CH, EXEC);
    expect(await decisionOf(f, a.request_id)).toMatchObject({
      decision: 'studio_silent',
      studio_age_ms: null,
    });
    await f.studio();
    f.core.clock.advance(RANDOM_BAN.studioReadyMs + 500);
    await f.rb.result(a.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: (
        await f.core.db.query<{ attempt_id: string }>(
          'select attempt_id from rb_requests where request_id = $1',
          [a.request_id],
        )
      )[0]!.attempt_id,
      event: 'flop',
      stats: { chatters: 3, candidates: 0, follow_checks: 0 },
    });
    // The search's own stats are written: the streamer decision stays.
    expect(await decisionOf(f, a.request_id)).toMatchObject({
      decision: 'studio_silent',
    });
    const b = await f.ask();
    await f.rb.claim(CH, EXEC);
    expect(await decisionOf(f, b.request_id)).toMatchObject({
      decision: 'studio_silent',
      studio_age_ms: RANDOM_BAN.studioReadyMs + 500,
    });
    const g = await fixture(false);
    await g.studio({ obs_ready: false });
    const c = await g.ask();
    await g.rb.claim(CH, EXEC);
    expect(await decisionOf(g, c.request_id)).toMatchObject({
      decision: 'obs_not_ready',
    });
    const h = await fixture(false);
    await h.studio({ mic_held: true });
    const d = await h.ask();
    await h.rb.claim(CH, EXEC);
    expect(await decisionOf(h, d.request_id)).toMatchObject({
      decision: 'mic_held',
    });
    const k = await fixture(false);
    await k.studio();
    const e = await k.ask('dry_run');
    await k.rb.claim(CH, EXEC);
    expect(await decisionOf(k, e.request_id)).toMatchObject({
      decision: 'dry_run',
    });
  });

  it('eligible: the draw is recorded (not drawn ≥ 20, drawn < 20); a Votekick or Random Ban mute running: recorded too', async () => {
    const f = await fixture(false);
    await f.studio();
    const a = await f.ask();
    const c = (await f.rb.claim(CH, EXEC)).request!;
    expect(await decisionOf(f, a.request_id)).toMatchObject({
      decision: 'not_drawn',
      draw: 999,
    });
    await f.rb.target(a.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: { id: '9002', login: 'target', name: 'Target' },
      is_sub: false,
      stats: { chatters: 4, candidates: 2, follow_checks: 1 },
    });
    expect((await f.rb.outcome(a.request_id))!).toMatchObject({
      stats: { chatters: 4, streamer: { decision: 'not_drawn', draw: 999 } },
    });
    const g = await fixture(true);
    await g.studio();
    const b = await g.ask();
    await g.rb.claim(CH, EXEC);
    expect(await decisionOf(g, b.request_id)).toMatchObject({
      decision: 'drawn',
      draw: 0,
    });
    const m = (await g.studio()).mute!;
    await g.report(b.request_id, m.attempt_id); // the streamer's mute runs
    const next = await g.ask();
    await g.studio();
    await g.rb.claim(CH, EXEC);
    expect(await decisionOf(g, next.request_id)).toMatchObject({
      decision: 'streamer_muted',
    });
    const vk = await setup();
    vk.clock.set(new Date('2026-10-27T20:00:00Z'));
    const rb = new RandomBanService(vk.db, vk.clock, () => 0, {
      streamer: () => STREAMER,
      otherMutes: {
        active: async () => ({ id: 'mute:vk', endsAt: new Date(2e12) }),
      },
    });
    await rb.claimMute(CH, {
      consumer_id: STUDIO,
      obs_ready: true,
      mic_held: false,
    });
    const r = await rb.request({
      channel_id: CH,
      source: 'channel_points',
      source_ref: randomUUID(),
      mode: 'real',
      buyer: BUYER,
    });
    await rb.claim(CH, EXEC);
    expect((await rb.outcome(r.request_id))!.streamer_decision).toMatchObject({
      decision: 'votekick_mute',
    });
  });

  it('OBS failing on the mute: recorded, kept after the viewers’ re-draw', async () => {
    const f = await fixture(true);
    await f.studio();
    const a = await f.ask();
    await f.rb.claim(CH, EXEC);
    const m = (await f.studio()).mute!;
    await f.rb.reportMute(a.request_id, {
      consumer_id: STUDIO,
      attempt_id: m.attempt_id,
      event: 'failed',
      error: 'obs_offline',
    });
    expect(await decisionOf(f, a.request_id)).toMatchObject({
      decision: 'drawn',
      obs_failed: 'studio: obs_offline',
    });
    await f.studio({ obs_ready: false });
    await f.rb.claim(CH, EXEC); // the viewers' draw (OBS not ready now)
    expect(await decisionOf(f, a.request_id)).toMatchObject({
      decision: 'obs_not_ready',
      obs_failed: 'studio: obs_offline',
    });
  });

  it('re-eligible after the mute EXPIRED and after a CAUTION ended it (no residual state)', async () => {
    const f = await fixture(true);
    await f.studio();
    const a = await f.ask();
    await f.rb.claim(CH, EXEC);
    const m = (await f.studio()).mute!;
    await f.report(a.request_id, m.attempt_id);
    // Expired: 60 s later, eligible again (drawn here: draw 0).
    f.core.clock.advance(60_000);
    await f.studio();
    const b = await f.ask();
    await f.rb.claim(CH, EXEC);
    expect(await decisionOf(f, b.request_id)).toMatchObject({
      decision: 'drawn',
    });
    // Ended by a caution (Core side, as Caution does): eligible again at once.
    const m2 = (await f.studio()).mute!;
    await f.report(b.request_id, m2.attempt_id);
    f.core.clock.advance(5_000);
    await f.core.db.tx(async (q) => {
      const run = await f.rb.mutes.active(q, CH);
      expect(run).not.toBeNull();
      await f.rb.mutes.end(q, CH, run!.id);
    });
    await f.studio();
    const c = await f.ask();
    await f.rb.claim(CH, EXEC);
    expect(await decisionOf(f, c.request_id)).toMatchObject({
      decision: 'drawn',
    });
  });

  it('the summary tells bad luck from exclusion: eligible count, reasons, run since the last win, its chance', async () => {
    const f = await fixture(false);
    await f.studio();
    for (let i = 0; i < 3; i++) {
      const r = await f.ask();
      const c = (await f.rb.claim(CH, EXEC)).request!;
      await f.rb.result(r.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: c.attempt_id,
        event: 'flop',
        stats: { chatters: 1, candidates: 0, follow_checks: 0 },
      });
      await f.studio();
    }
    await f.studio({ obs_ready: false });
    const r = await f.ask();
    await f.rb.claim(CH, EXEC);
    const s = await f.rb.state(CH);
    expect(s.streamer_trace).toMatchObject({
      traced: 4,
      eligible: 3,
      drawn: 0,
      by_decision: { not_drawn: 3, obs_not_ready: 1 },
      eligible_since_last_drawn: 3,
      luck_pct: 94.119,
    });
    expect(r).toBeTruthy();
  });
});
