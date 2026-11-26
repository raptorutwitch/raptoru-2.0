// Chaos V2 lot 2 — the Core's `chaos` module (docs/chaos/CONTRAT_LOT2.md) on PGlite: closed by default, every refusal
// before any debit (in the contract's order), idempotent purchase, claim → lease → ACK state machine (never backwards,
// attempt_mismatch), sweep (expiry, lease, unknown end), refunds exactly once, interruption policy, D4 moderation and its
// permissions, blocks and personal cooldowns, effect credits, charges and burst caps. Fictional data only.
import type { LabActor } from '@raptoru/schemas';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { EFFECTS } from '../src/chaos/catalog.js';
import { CHAOS_RULES, ChaosError, ChaosService } from '../src/chaos/service.js';
import { labEconomy } from '../src/economy/economy.js';
import { ModuleSettings } from '../src/module-settings/service.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { editWallet, LabForbiddenError } from '../src/lab-moderation/store.js';
import { createTestDb, setup, type TestCore } from './helpers.js';

const CH = '900500';
const STUDIO = 'studio-chaos';
const ALL = Object.fromEntries(EFFECTS.map((e) => [e.id, { enabled: true }]));
const v = (n: number) => ({
  id: String(900500 + n),
  display_name: `Viewer${n}`,
});
const V1 = v(1);
const V2 = v(2);
const V3 = v(3);
const V4 = v(4);
const ext = (id: string, role: LabActor['role']): LabActor => ({
  id,
  login: `u${id}`,
  display_name: `U${id}`,
  role,
  via: 'extension',
});
const studioActor: LabActor = {
  id: 'antoni',
  role: 'broadcaster',
  via: 'studio',
};
const MOD = ext('900590', 'moderator');
const VIEWER = ext('900591', 'viewer');

/** The refusal of a call that must be refused (typed ChaosError). */
const notRefused = (): never => {
  throw new Error('not refused');
};

async function lab(o: { enabled?: boolean; studio?: boolean } = {}) {
  const core = await setup();
  core.clock.set(new Date('2026-11-26T20:00:00Z'));
  const chaos = core.chaos;
  if (o.enabled !== false)
    await core.moduleSettings.set(CH, 'chaos.enabled', 1, 'test');
  for (const x of [V1, V2, V3, V4])
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      x.id,
      'set',
      { tokens: 5_000_000 },
      'test',
    );
  const hb = (over: Partial<Parameters<typeof chaos.heartbeat>[1]> = {}) =>
    chaos.heartbeat(CH, {
      studio_instance_id: STUDIO,
      engine_ready: true,
      safety_max_ms: 60_000,
      safe_mode: false,
      effects: ALL,
      inflight: [],
      ...over,
    });
  if (o.studio !== false) await hb();
  const quote = (
    effect: string,
    choice = {},
    viewer = V1,
    credit_id?: string,
  ) =>
    chaos.quote(CH, viewer, {
      effect,
      choice,
      ...(credit_id ? { credit_id } : {}),
    });
  const buy = async (
    effect: string,
    choice: Record<string, unknown> = {},
    viewer = V1,
    key: string = randomUUID(),
    credit_id?: string,
  ) => {
    const p = (await quote(effect, choice, viewer, credit_id)).price;
    return chaos.buy(CH, {
      viewer,
      idempotency_key: key,
      effect,
      choice,
      expected_price: p,
      ...(credit_id ? { credit_id } : {}),
    });
  };
  const refused = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof ChaosError) return e.code;
      throw e;
    }
    throw new Error('not refused');
  };
  const tokens = async (viewer = V1) =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, viewer.id],
        )
      )[0]!.tokens,
    );
  const ledger = async (id: string) =>
    (
      await core.db.query<{ kind: string; amount: number }>(
        'select kind, amount from lab_wallet_ledger where interaction_id = $1 order by id',
        [id],
      )
    ).map((r) => [r.kind, Number(r.amount)]);
  const row = async (id: string) =>
    (
      await core.db.query<{
        status: string;
        code: string | null;
        refund_status: string;
        played_ms: number | null;
      }>(
        'select status, code, refund_status, played_ms from chaos_requests where id = $1',
        [id],
      )
    )[0]!;
  const claim = (startable = EFFECTS.map((e) => e.id)) =>
    chaos.claim(CH, STUDIO, startable);
  const ack = (
    item: { id: string; attempt_id: string },
    event: 'started' | 'ended' | 'failed',
    extra = {},
  ) =>
    chaos.ack(CH, item.id, {
      studio_instance_id: STUDIO,
      attempt_id: item.attempt_id,
      event,
      ...extra,
    });
  const mod = new LabModerationService(
    core.db,
    core.clock,
    core.ttsLab,
    core.soundLab,
    core.bonkLab,
    core.raffleLab,
    core.economy,
    null,
    chaos,
  );
  const act = (actor: LabActor, command: Record<string, unknown>) =>
    mod.act(CH, { actor, command: { action: 'chaos', command } as never });
  return {
    core,
    chaos,
    hb,
    quote,
    buy,
    refused,
    tokens,
    ledger,
    row,
    claim,
    ack,
    mod,
    act,
  };
}
type Lab = Awaited<ReturnType<typeof lab>>;
const playThrough = async (l: Lab, core: TestCore = l.core) => {
  const { item } = await l.claim();
  await l.ack(item!, 'started');
  core.clock.advance(item!.duration_ms);
  await l.ack(item!, 'ended', { played_ms: item!.duration_ms });
  return item!;
};

// The first WASM Postgres boot (every migration) can be slow on a loaded machine.
beforeAll(() => createTestDb(), 180_000);

describe('chaos — closed by default, refusals before any debit', () => {
  it('chaos.enabled = 0 by default: quote blocked, purchase refused, nothing stored or debited', async () => {
    const l = await lab({ enabled: false });
    expect((await l.quote('color')).block?.code).toBe('disabled');
    expect(await l.refused(l.buy('color'))).toBe('disabled');
    expect(await l.tokens()).toBe(5_000_000);
    expect(await l.core.db.query('select 1 from chaos_requests')).toHaveLength(
      0,
    );
    expect((await l.chaos.state(CH, V1)).enabled).toBe(false);
    // Studio keeps its engine stopped while Chaos is closed.
    expect((await l.hb()).enabled).toBe(false);
  });

  it('canonical economy: closed while CHAOS_EXTENSION is off, whatever chaos.enabled says', async () => {
    const core = await setup();
    const settings = new ModuleSettings(core.db, core.clock);
    const chaos = new ChaosService(
      core.db,
      core.clock,
      { ...labEconomy, mode: 'canonical' },
      settings,
    );
    await settings.set(CH, 'chaos.enabled', 1, 'test');
    const q = () => chaos.quote(CH, V1, { effect: 'color', choice: {} });
    expect((await q()).block?.code).toBe('disabled');
    chaos.productionApproved = true;
    // Open now; the canonical live gate comes next (no Twitch session in this test).
    expect((await q()).block?.code).toBe('stream_offline');
  });

  it('Studio absent or engine down → studio_offline (503); effect off in Studio; soft mode; duration over the Safety', async () => {
    const l = await lab({ studio: false });
    const e = await l.buy('color').then(notRefused, (x: ChaosError) => x);
    expect([e.code, e.status]).toEqual(['studio_offline', 503]);
    await l.hb({ engine_ready: false });
    expect(await l.refused(l.buy('color'))).toBe('studio_offline');
    await l.hb({ effects: { ...ALL, color: { enabled: false } } });
    expect(await l.refused(l.buy('color'))).toBe('effect_disabled');
    await l.hb({ safe_mode: true });
    expect(await l.refused(l.buy('flash'))).toBe('safe_mode');
    await l.hb({ safety_max_ms: 20_000 });
    expect(await l.refused(l.buy('color', { duration: 30 }))).toBe(
      'duration_out_of_range',
    );
    expect((await l.quote('color', { duration: 30 })).block).toMatchObject({
      code: 'duration_out_of_range',
      max_s: 20,
    });
    // Studio silent for more than 10 s: offline again.
    l.core.clock.advance(CHAOS_RULES.heartbeatFreshMs + 1);
    expect(await l.refused(l.buy('color'))).toBe('studio_offline');
    expect(await l.tokens()).toBe(5_000_000);
  });

  it('paused, global pause (counted), price changed, balance too low: refused, nothing debited', async () => {
    const l = await lab();
    await l.act(studioActor, { action: 'pause', paused: true });
    expect(await l.refused(l.buy('color'))).toBe('paused');
    await l.act(studioActor, { action: 'pause', paused: false });
    await l.mod.act(CH, {
      actor: studioActor,
      command: { action: 'global_pause', paused: true },
    });
    expect(await l.refused(l.buy('color'))).toBe('global_pause');
    expect(
      (
        await l.core.db.query<{ refused_count: number }>(
          'select refused_count from lab_global_state',
        )
      )[0]!.refused_count,
    ).toBe(1);
    await l.mod.act(CH, {
      actor: studioActor,
      command: { action: 'global_pause', paused: false },
    });
    const p = (await l.quote('color')).price;
    const e = await l.chaos
      .buy(CH, {
        viewer: V1,
        idempotency_key: randomUUID(),
        effect: 'color',
        choice: {},
        expected_price: p - 50,
      })
      .then(notRefused, (x: ChaosError) => x);
    expect([e.code, e.details.price]).toEqual(['price_changed', p]);
    await editWallet(
      l.core.db,
      l.core.clock.now(),
      CH,
      V1.id,
      'set',
      { tokens: p - 1 },
      'test',
    );
    expect((await l.quote('color')).block?.code).toBe('insufficient_funds');
    expect(await l.refused(l.buy('color'))).toBe('insufficient_funds');
    expect(await l.tokens()).toBe(p - 1);
    expect(await l.core.db.query('select 1 from chaos_requests')).toHaveLength(
      0,
    );
  });
});

describe('chaos — purchase, idempotency, queue rules', () => {
  it('a purchase debits the Core price once; the same intent again answers the same request (duplicate)', async () => {
    const l = await lab();
    const q = await l.quote('shake', { style: 'seisme', duration: 30 });
    expect(q.price).toBeGreaterThanOrEqual(5000);
    expect(q.engine_request).toMatchObject({
      effect: 'shake',
      variant: 'seisme',
      duration_ms: 30_000,
    });
    const key = randomUUID();
    const a = await l.buy('shake', { style: 'seisme', duration: 30 }, V1, key);
    const b = await l.buy('shake', { style: 'seisme', duration: 30 }, V1, key);
    expect(b.duplicate).toBe(true);
    expect(b.request.id).toBe(a.request.id);
    expect(await l.tokens()).toBe(5_000_000 - q.price);
    expect(await l.ledger(a.request.id)).toEqual([['debit', -q.price]]);
    expect(await l.refused(l.buy('shake', { style: 'leger' }, V1, key))).toBe(
      'idempotency_conflict',
    );
  });

  it('queue of 3, one waiting per viewer, cooldown after the end, Flash for the whole channel', async () => {
    const l = await lab();
    const first = await l.buy('flip', {}, V1);
    expect(first.outcome).toEqual({ kind: 'now' });
    const { item } = await l.claim();
    await l.ack(item!, 'started');
    // The transform slot is busy: mirrors wait.
    const w2 = await l.buy('mirror', {}, V2);
    expect(w2.outcome).toMatchObject({ kind: 'queue', position: 1 });
    expect(await l.refused(l.buy('color', {}, V2))).toBe('one_waiting');
    await l.buy('mirror', {}, V3);
    await l.buy('mirror', {}, V4);
    const v5 = v(5);
    await editWallet(
      l.core.db,
      l.core.clock.now(),
      CH,
      v5.id,
      'set',
      { tokens: 1_000_000 },
      'test',
    );
    expect(await l.refused(l.buy('mirror', {}, v5))).toBe('queue_full');
    expect(await l.refused(l.buy('flip', {}, V1))).toBe('mine_active');
    l.core.clock.advance(10_000);
    await l.ack(item!, 'ended', { played_ms: 10_000 });
    expect(await l.refused(l.buy('flip', {}, V1))).toBe('cooldown');
    l.core.clock.advance(CHAOS_RULES.viewerCooldownMs);
    await l.hb();
    expect((await l.quote('flip', {}, V1)).block?.code).not.toBe('cooldown');
    // Flash: once a minute for everybody.
    const l2 = await lab();
    await l2.buy('flash', {}, V1);
    await playThrough(l2);
    expect(await l2.refused(l2.buy('flash', {}, V2))).toBe('global_cooldown');
  });

  it('state: queue positions, my requests, effects availability; moderation view', async () => {
    const l = await lab();
    await l.buy('flip', {}, V1);
    const { item } = await l.claim();
    await l.ack(item!, 'started');
    await l.buy('mirror', {}, V2);
    const s = await l.chaos.state(CH, V2);
    expect(s).toMatchObject({ enabled: true, status: 'open', cap_s: 60 });
    expect(s.active).toHaveLength(1);
    expect(s.active[0]).toMatchObject({
      effect: 'flip',
      mine: false,
      status: 'started',
    });
    expect(s.queue[0]).toMatchObject({
      effect: 'mirror',
      mine: true,
      position: 1,
    });
    expect(s.queue[0]!.eta_s).toBeGreaterThan(0);
    expect(s.mine).toHaveLength(1);
    expect(s.effects.color).toEqual({ available: true });
    const m = await l.chaos.moderationView(CH);
    expect(m.module_state).toBe('active');
    expect(m.active[0]).toMatchObject({
      viewer_id: V1.id,
      viewer_name: 'Viewer1',
    });
    expect(m.recent).toHaveLength(2);
  });
});

describe('chaos — execution: claim, lease, ACK', () => {
  it('claim hands the oldest startable request with its engine request; started → ended; replays accepted; never backwards', async () => {
    const l = await lab();
    const a = await l.buy('color', { style: 'sepia', duration: 20 });
    expect((await l.claim(['flip'])).item).toBeNull();
    const { item } = await l.claim();
    expect(item).toMatchObject({
      id: a.request.id,
      duration_ms: 20_000,
      engine_request: { effect: 'color', variant: 'sepia' },
    });
    expect(await l.claim()).toEqual({ item: null });
    await l.ack(item!, 'started');
    await l.ack(item!, 'started');
    l.core.clock.advance(20_000);
    await l.ack(item!, 'ended', { played_ms: 20_000 });
    const again = await l.ack(item!, 'ended', { played_ms: 3 });
    expect(again).toMatchObject({ status: 'ended', played_ms: 20_000 });
    await l.ack(item!, 'failed', { code: 'engine_exit' });
    await l.ack(item!, 'started');
    expect(await l.row(a.request.id)).toMatchObject({
      status: 'ended',
      refund_status: 'none',
    });
    expect(
      await l.refused(l.ack({ ...item!, attempt_id: randomUUID() }, 'ended')),
    ).toBe('attempt_mismatch');
  });

  it('refused by the engine before its start → failed, refunded in full, once', async () => {
    const l = await lab();
    const a = await l.buy('fog', { level: 'extreme' });
    const { item } = await l.claim();
    await l.ack(item!, 'failed', { code: 'exclusive_fullscreen' });
    await l.ack(item!, 'failed', { code: 'exclusive_fullscreen' });
    expect(await l.row(a.request.id)).toMatchObject({
      status: 'failed',
      code: 'exclusive_fullscreen',
      refund_status: 'refunded',
    });
    expect(await l.tokens()).toBe(5_000_000);
    expect((await l.ledger(a.request.id)).map((x) => x[0])).toEqual([
      'debit',
      'refund',
    ]);
  });

  it('Studio’s own codes: before the start → refunded in full; engine_error after the start → interruption policy (raw reason cut)', async () => {
    const l = await lab();
    expect((await l.hb()).enabled).toBe(true);
    const a = await l.buy('color', {}, V1);
    const { item } = await l.claim();
    await l.ack(item!, 'failed', { code: 'engine_not_ready' });
    expect(await l.row(a.request.id)).toMatchObject({
      status: 'failed',
      code: 'engine_not_ready',
      refund_status: 'refunded',
    });
    const b = await l.buy('vhs', { duration: 20 }, V2);
    const { item: ib } = await l.claim();
    await l.ack(ib!, 'started');
    l.core.clock.advance(4000);
    await l.ack(ib!, 'failed', {
      code: 'engine_error',
      reason: 'x'.repeat(150),
      played_ms: 4000,
    });
    expect(await l.row(b.request.id)).toMatchObject({
      status: 'ended',
      code: 'engine_error',
      refund_status: 'refunded',
    });
  });

  it('interruption policy: a breakdown under half the duration is refunded, over half is not (the reason says why)', async () => {
    const l = await lab();
    const a = await l.buy('blur', { duration: 20 }, V1);
    const { item } = await l.claim();
    await l.ack(item!, 'started');
    l.core.clock.advance(6000);
    await l.ack(item!, 'ended', { code: 'capture_lost', played_ms: 6000 });
    expect(await l.row(a.request.id)).toMatchObject({
      status: 'ended',
      refund_status: 'refunded',
      played_ms: 6000,
    });
    const b = await l.buy('pixelate', { duration: 20 }, V2);
    const { item: i2 } = await l.claim();
    await l.ack(i2!, 'started');
    l.core.clock.advance(15_000);
    await l.ack(i2!, 'failed', { code: 'engine_exit', played_ms: 15_000 });
    const r = await l.core.db.query<{ reason: string; refund_status: string }>(
      'select reason, refund_status from chaos_requests where id = $1',
      [b.request.id],
    );
    expect(r[0]).toMatchObject({ refund_status: 'none' });
    expect(r[0]!.reason).toContain('75 %');
  });

  it('sweep: never claimed in 180 s → expired refunded; lease over without start → failed no_ack refunded; started without end → unknown_end kept', async () => {
    const l = await lab();
    const expired = await l.buy('color', {}, V1);
    l.core.clock.advance(CHAOS_RULES.queueTtlMs + 1);
    await l.hb();
    expect(await l.row(expired.request.id)).toMatchObject({
      status: 'expired',
      code: 'queue_expired',
      refund_status: 'refunded',
    });
    const leased = await l.buy('vhs', {}, V2);
    await l.claim();
    l.core.clock.advance(CHAOS_RULES.leaseMs + 1);
    await l.hb();
    expect(await l.row(leased.request.id)).toMatchObject({
      status: 'failed',
      code: 'no_ack',
      refund_status: 'refunded',
    });
    const lost = await l.buy('zoom', {}, V3);
    const { item } = await l.claim();
    await l.ack(item!, 'started');
    l.core.clock.advance(item!.duration_ms + CHAOS_RULES.startedMarginMs + 1);
    expect(await l.chaos.sweepExpired()).toBe(1);
    expect(await l.row(lost.request.id)).toMatchObject({
      status: 'ended',
      code: 'unknown_end',
      refund_status: 'none',
      played_ms: item!.duration_ms,
    });
    for (const x of [V1, V2]) expect(await l.tokens(x)).toBe(5_000_000);
    expect(await l.chaos.sweepExpired()).toBe(0);
  });

  it('heartbeat: in-flight leases extended (bounded), stop list for what moderation removed; Studio STOP ALL', async () => {
    const l = await lab();
    const a = await l.buy('drunk', {}, V1);
    const { item } = await l.claim();
    for (let i = 0; i < 3; i++) {
      l.core.clock.advance(20_000);
      expect((await l.hb({ inflight: [item!.id] })).stop).toEqual([]);
    }
    expect((await l.row(a.request.id)).status).toBe('claimed');
    l.core.clock.advance(70_000);
    await l.hb({ inflight: [item!.id] });
    // Never beyond 120 s after the claim: refunded, and Studio told to stop it.
    expect(await l.row(a.request.id)).toMatchObject({
      status: 'failed',
      code: 'no_ack',
      refund_status: 'refunded',
    });
    expect((await l.hb({ inflight: [item!.id] })).stop).toEqual([
      { id: item!.id, reason: 'no_ack' },
    ]);

    const b = await l.buy('tunnel', {}, V2);
    const c = await l.buy('color', {}, V3);
    const { item: ib } = await l.claim(['tunnel']);
    await l.ack(ib!, 'started');
    const out = await l.chaos.stopAll(CH, STUDIO);
    expect(out).toMatchObject({ stopped: 1, canceled: 1 });
    expect(await l.row(b.request.id)).toMatchObject({
      status: 'ended',
      code: 'stopped_by_studio',
      refund_status: 'refunded',
    });
    expect(await l.row(c.request.id)).toMatchObject({
      status: 'canceled',
      refund_status: 'refunded',
    });
    expect((await l.hb({ inflight: [ib!.id] })).stop).toHaveLength(1);
  });
});

describe('chaos — D4 moderation', () => {
  it('permissions: a viewer is refused; a moderator stops / removes / refunds, but gifts and credits need « Admin Wallet »', async () => {
    const l = await lab();
    const a = await l.buy('mirror', {}, V1);
    await expect(
      l.act(VIEWER, { action: 'cancel', id: a.request.id }),
    ).rejects.toBeInstanceOf(LabForbiddenError);
    await expect(
      l.act(MOD, { action: 'gift', effect: 'color', choice: {} }),
    ).rejects.toBeInstanceOf(LabForbiddenError);
    await expect(
      l.act(MOD, {
        action: 'credit_grant',
        viewer_id: V2.id,
        effect: 'fog',
        constraints: {},
        reason: 'bravo clutch',
      }),
    ).rejects.toBeInstanceOf(LabForbiddenError);
    await expect(
      l.act(MOD, { action: 'pause', paused: true }),
    ).resolves.toMatchObject({ module_state: 'paused' });
    await l.act(MOD, { action: 'pause', paused: false });
    expect(
      await l.refused(
        l.act(MOD, { action: 'cancel', id: a.request.id, refund: false }),
      ),
    ).toBe('reason_required');
    await expect(
      l.act(MOD, { action: 'cancel', id: a.request.id }),
    ).resolves.toMatchObject({ refunded: true });
    expect(await l.tokens()).toBe(5_000_000);
    await l.mod.act(CH, {
      actor: studioActor,
      command: {
        action: 'set_permission',
        viewer_id: MOD.id,
        permission: 'wallet',
        granted: true,
      },
    });
    await expect(
      l.act(MOD, { action: 'gift', effect: 'color', choice: { style: 'nb' } }),
    ).resolves.toMatchObject({ ok: true });
    expect((await l.chaos.moderationView(CH)).queue[0]).toMatchObject({
      payment: 'gift',
      price: 0,
    });
  });

  it('stop: refunded by default under 25 %, by choice afterwards; refund afterwards once; stop_all suspends', async () => {
    const l = await lab();
    const a = await l.buy('shake', { duration: 20 }, V1);
    const { item } = await l.claim();
    await l.ack(item!, 'started');
    l.core.clock.advance(2000);
    await expect(
      l.act(MOD, { action: 'stop', id: a.request.id }),
    ).resolves.toMatchObject({ refunded: true });
    expect((await l.hb({ inflight: [item!.id] })).stop).toEqual([
      { id: item!.id, reason: 'stopped_by_moderator' },
    ]);
    // A late `ended` from Studio changes nothing.
    await l.ack(item!, 'ended', { played_ms: 2100 });
    expect(await l.row(a.request.id)).toMatchObject({
      status: 'ended',
      code: 'stopped_by_moderator',
      refund_status: 'refunded',
    });

    const b = await l.buy('zoom', { duration: 20 }, V2);
    const { item: ib } = await l.claim();
    await l.ack(ib!, 'started');
    l.core.clock.advance(10_000);
    await expect(
      l.act(MOD, { action: 'stop', id: b.request.id }),
    ).resolves.toMatchObject({ refunded: false });
    // A refund afterwards is « Admin Wallet » (refund.manual), like every module.
    await expect(
      l.act(MOD, { action: 'refund', id: b.request.id, reason: 'bug du jeu' }),
    ).rejects.toBeInstanceOf(LabForbiddenError);
    await l.mod.act(CH, {
      actor: studioActor,
      command: {
        action: 'set_permission',
        viewer_id: MOD.id,
        permission: 'wallet',
        granted: true,
      },
    });
    await expect(
      l.act(MOD, { action: 'refund', id: b.request.id, reason: 'bug du jeu' }),
    ).resolves.toMatchObject({ refunded: true });
    expect(
      await l.refused(
        l.act(MOD, {
          action: 'refund',
          id: b.request.id,
          reason: 'bug du jeu',
        }),
      ),
    ).toBe('already_refunded');
    expect(await l.tokens(V2)).toBe(5_000_000);

    const c = await l.buy('fog', {}, V3);
    const { item: ic } = await l.claim();
    await l.ack(ic!, 'started');
    await l.buy('vhs', {}, V4);
    await l.claim(['vhs']);
    const d = await l.buy('color', {}, V1);
    const out = await l.act(MOD, { action: 'stop_all' });
    expect(out).toMatchObject({
      stopped: 1,
      canceled: 1,
      module_state: 'paused',
    });
    expect(await l.row(c.request.id)).toMatchObject({
      status: 'ended',
      refund_status: 'refunded',
    });
    expect((await l.row(d.request.id)).status).toBe('queued');
    expect(await l.refused(l.buy('blur', {}, V2))).toBe('paused');
  });

  it('a blocked viewer and a viewer under a personal cooldown are refused before any debit', async () => {
    const l = await lab();
    await l.mod.act(CH, {
      actor: studioActor,
      command: {
        action: 'block_viewer',
        viewer_id: V1.id,
        module: 'chaos',
        duration_s: 600,
      },
    });
    expect(await l.refused(l.buy('color', {}, V1))).toBe('viewer_blocked');
    await l.mod.act(CH, {
      actor: studioActor,
      command: {
        action: 'block_viewer',
        viewer_id: V2.id,
        module: 'all',
        duration_s: 600,
      },
    });
    expect(await l.refused(l.buy('color', {}, V2))).toBe('viewer_blocked');
    await l.mod.act(CH, {
      actor: studioActor,
      command: {
        action: 'set_cooldown',
        viewer_id: V3.id,
        module: 'chaos',
        delay_s: 600,
        span: 3600,
      },
    });
    await l.buy('color', {}, V3);
    const e = await l.buy('vhs', {}, V3).then(notRefused, (x: ChaosError) => x);
    expect(e.code).toBe('viewer_cooldown');
    expect(Number(e.details.retry_after_ms)).toBeGreaterThan(0);
    expect(await l.tokens(V1)).toBe(5_000_000);
    const restr = await l.mod.viewerRestrictions(CH, V3.id);
    expect(restr[0]).toMatchObject({ module: 'chaos', kind: 'cooldown' });
  });
});

describe('chaos — effect credits and charges', () => {
  it('a credit pays once (price 0), is given back as a credit when the effect never starts, and can be revoked', async () => {
    const l = await lab();
    await l.act(studioActor, {
      action: 'credit_grant',
      viewer_id: V1.id,
      effect: 'fog',
      constraints: { max_duration_ms: 20_000, levels: ['marque', 'dense'] },
      reason: 'Tombola du 24/11',
    });
    const [credit] = (await l.chaos.state(CH, V1)).credits;
    expect(credit).toMatchObject({ effect: 'fog', state: 'available' });
    expect(
      (await l.quote('fog', { level: 'extreme' }, V1, credit!.id)).block?.code,
    ).toBe('credit_mismatch');
    expect(
      (await l.quote('fog', { duration: 30 }, V1, credit!.id)).block?.code,
    ).toBe('credit_mismatch');
    const q = await l.quote(
      'fog',
      { level: 'dense', duration: 20 },
      V1,
      credit!.id,
    );
    expect([q.price, q.block]).toEqual([0, undefined]);
    const a = await l.buy(
      'fog',
      { level: 'dense', duration: 20 },
      V1,
      randomUUID(),
      credit!.id,
    );
    expect(a.request).toMatchObject({ payment: 'credit', price: 0 });
    expect(await l.tokens()).toBe(5_000_000);
    expect((await l.chaos.state(CH, V1)).credits).toHaveLength(0);
    expect(
      await l.refused(
        l.buy(
          'fog',
          { level: 'dense', duration: 20 },
          V2,
          randomUUID(),
          credit!.id,
        ),
      ),
    ).toBe('credit_unavailable');
    const { item } = await l.claim();
    await l.ack(item!, 'failed', { code: 'no_frame' });
    const back = (await l.chaos.state(CH, V1)).credits;
    expect(back).toMatchObject([{ id: credit!.id, state: 'available' }]);
    expect(await l.tokens()).toBe(5_000_000);
    expect((await l.chaos.state(CH, V1)).credit_log.map((x) => x.kind)).toEqual(
      ['restored', 'used', 'granted'],
    );
    await l.act(studioActor, {
      action: 'credit_revoke',
      credit_id: credit!.id,
      reason: 'erreur de saisie',
    });
    expect((await l.chaos.state(CH, V1)).credits).toHaveLength(0);
    expect(
      await l.refused(
        l.act(studioActor, {
          action: 'credit_revoke',
          credit_id: credit!.id,
          reason: 'encore',
        }),
      ),
    ).toBe('credit_unavailable');
  });

  it('charges: 10 per viewer, +1 every 6 s, given back when the blink never plays; burst caps for the channel', async () => {
    const l = await lab();
    const blink = { style: 'ponctuel' };
    const first = await l.buy('blink', blink, V1);
    expect(first.request.charged).toBe(true);
    let s = await l.chaos.state(CH, V1);
    expect(s.charges['blink:ponctuel']).toMatchObject({
      n: 9,
      max: 10,
      next_s: 6,
    });
    for (let i = 0; i < 9; i++) await l.buy('blink', blink, V1);
    expect(await l.refused(l.buy('blink', blink, V1))).toBe('no_charge');
    // 10 pending for the whole channel: another viewer's blink is refused (burst_full).
    expect(await l.refused(l.buy('blink', blink, V2))).toBe('burst_full');
    // Removed by moderation before it played: the Jetons and the charge come back at once.
    await l.act(MOD, { action: 'cancel', id: first.request.id });
    s = await l.chaos.state(CH, V1);
    expect(s.charges['blink:ponctuel']!.n).toBe(1);
    expect(await l.ledger(first.request.id)).toHaveLength(2);
    // Recharge: one more after 6 s.
    l.core.clock.advance(6000);
    await l.hb();
    s = await l.chaos.state(CH, V1);
    expect(s.charges['blink:ponctuel']!.n).toBe(2);
    // Never played (expired): the Jetons AND the charge come back.
    l.core.clock.advance(CHAOS_RULES.queueTtlMs);
    await l.hb();
    s = await l.chaos.state(CH, V1);
    expect(s.charges['blink:ponctuel']!.n).toBe(10);
    expect(await l.tokens()).toBe(5_000_000);
  });

  it('burst rate: 20 starts + pending per sliding minute for the whole channel; one at a time with a gap', async () => {
    const l = await lab();
    const viewers = [V1, V2, V3, V4, v(5), v(6)];
    for (const x of viewers.slice(4))
      await editWallet(
        l.core.db,
        l.core.clock.now(),
        CH,
        x.id,
        'set',
        { tokens: 5_000_000 },
        'test',
      );
    let played = 0;
    for (let i = 0; i < 20; i++) {
      await l.buy('blink', { style: 'ponctuel' }, viewers[i % viewers.length]);
      const { item } = await l.claim();
      await l.ack(item!, 'started');
      l.core.clock.advance(2000);
      await l.ack(item!, 'ended', { played_ms: 2000 });
      // The next one waits for the gap after this end.
      l.core.clock.advance(CHAOS_RULES.burst.gapMs);
      await l.hb();
      played += 1;
    }
    expect(played).toBe(20);
    expect(await l.refused(l.buy('blink', { style: 'ponctuel' }, V1))).toBe(
      'burst_rate',
    );
    l.core.clock.advance(60_000);
    await l.hb();
    await l.buy('blink', { style: 'ponctuel' }, V1);
    await l.buy('blink', { style: 'ponctuel' }, V2);
    const { item } = await l.claim();
    await l.ack(item!, 'started');
    await l.ack(item!, 'ended', { played_ms: 2000 });
    expect((await l.claim()).item).toBeNull();
    l.core.clock.advance(CHAOS_RULES.burst.gapMs);
    await l.hb();
    expect((await l.claim()).item).not.toBeNull();
  });
});
