import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { SUB_WHEEL, subWheelAmount } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { coreWalletEconomy } from '../../../core-api/src/economy/economy.js';
import { WalletService } from '../../../core-api/src/wallet/wallet-service.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import type { ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import { EffectError, type EffectsPlayer } from '../src/effects/player.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';
import { SubWheelRuntime } from '../src/sub-wheel/runtime.js';
import {
  redrawConfirm,
  rightsTab,
  type SwViewerAdmin,
} from '../../web/src/sub-wheel-rights-view.js';
import { type SwState, subWheelView } from '../../web/src/sub-wheel-view.js';

// Roue du Sub V2, lot R4 — end to end in the Lab: a Twitch sub reaches the REAL Lab Core (alerts route) → its right
// waits → Studio's section shows it (its state through Studio's /api/sub-wheel, rendered by the real view) → « Tirer »
// → the effects player (simulated) shows the wheel Core drew → one gain → the history. Twice: the dedicated Lab
// database (the Lab Core credits the Lab test wallet once) and a full database on the canonical Wallet (one credit).
// Then « À vérifier » decided from Studio. No Twitch, no OBS, no real Jetons.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const CH = '900100';
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function lab(canonical: boolean) {
  const db = createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
  await migrate(db, canonical ? 'all' : 'lab');
  const secret = randomBytes(32).toString('hex');
  /** The Lab Core's time: real time, moved forward by the test (a re-show's delay). */
  const clock = { shift: 0, now: () => new Date(Date.now() + clock.shift) };
  const server: Server = createLabCore({
    db,
    clock,
    secret,
    ...(canonical ? { economy: coreWalletEconomy(new WalletService(db)) } : {}),
  }).server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir = await mkdtemp(join(tmpdir(), 'sw2-'));
  cleanups.push(async () => {
    server.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const direct = localLabCoreClient(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    secret,
  );
  /** The network to Core as the test sets it: the end of a wheel lost while `down`. */
  const net = { down: false, reports: 0 };
  const core = ((path: string, body?: unknown) => {
    if (/\/animation$/.test(path)) {
      net.reports++;
      if (net.down) return Promise.reject(new TypeError('fetch failed'));
    }
    return direct(path, body as never);
  }) as typeof direct;
  const shown: { spin: { segment: number; amount: number; months: number } }[] =
    [];
  /** The player page as the test sets it: connected, sound allowed, holding / failing the next wheel. */
  const fx = {
    connected: true,
    audio: true,
    hold: false,
    failNext: null as string | null,
    release: null as (() => void) | null,
    /** The wheel's sounds imported in Studio. */
    media: true,
  };
  const effects = {
    status: () => ({
      url: '',
      connected: fx.connected,
      audio: fx.connected && fx.audio,
      current: fx.connected,
      playing: 0,
    }),
    play: async (e: never) => {
      if (fx.failNext) {
        const code = fx.failNext;
        fx.failNext = null;
        throw new EffectError(code);
      }
      shown.push(e);
      if (!fx.hold)
        return { end: Promise.resolve({ event: 'completed' as const }) };
      return {
        end: new Promise<{ event: 'completed' }>((r) => {
          fx.release = () => r({ event: 'completed' });
        }),
      };
    },
    handle: async () => false,
    sounds: () => [],
    videos: () => [],
    interactionMedia: () =>
      ['sw-incr', 'sw-fin'].map((id) => ({
        id,
        label: id,
        available: fx.media,
      })),
  } as unknown as EffectsPlayer;
  const obs: ObsLike = { connected: true, request: async () => ({}) };
  const rt = await ChannelPointsRuntime.create({
    core,
    environment: 'lab',
    channelId: CH,
    origin: 'http://127.0.0.1:1',
    dir,
    obs: () => obs,
    effects,
    twitch: () => ({ scope: true, adapter_running: true }),
  });
  /** Studio's own API (/api/sub-wheel/*), as the page calls it. */
  const api = <T = Record<string, unknown>>(
    method: 'GET' | 'POST',
    path: string,
    body: object = {},
  ) =>
    rt.subWheel.api(
      method,
      path,
      async () => body as Record<string, unknown>,
    ) as Promise<T>;
  const state = () => api<SwState>('GET', '/state');
  const playAlerts = async () => {
    for (;;) {
      const c = await core<{
        alert: { alert_id: string; attempt_id: string } | null;
      }>(`/v1/lab/alerts/${CH}/claim`, { consumer_id: 'alerts-page' });
      if (!c.alert) return;
      for (const event of ['started', 'completed'])
        await core(`/v1/lab/alerts/items/${c.alert.alert_id}/ack`, {
          consumer_id: 'alerts-page',
          attempt_id: c.alert.attempt_id,
          event,
        });
    }
  };
  const sub = (over: Record<string, unknown> = {}) =>
    core('/v1/lab/alerts/events', {
      channel_id: CH,
      source: 'twitch',
      source_event_id: randomUUID(),
      type: 'resub',
      actor: { id: '9001', login: 'viewer', display_name: 'Viewer<3' },
      tier: '2000',
      months: 14,
      occurred_at: iso(0),
      ...over,
    });
  return { db, core, rt, shown, api, state, playAlerts, sub, fx, net, clock };
}

async function chain(canonical: boolean) {
  const l = await lab(canonical);
  await l.api('POST', '/settings', { enabled: true });
  expect((await l.api('POST', '/mode', { mode: 'v2' })).mode).toBe('v2');
  // Acquisition: a Twitch resub reaches the Core; off live → a manual tour, kept, nothing drawn.
  const e = { source_event_id: randomUUID() };
  await l.sub(e);
  await l.sub(e); // redelivered: the same tour
  await l.playAlerts();
  // Waiting: no draw without a request; Studio shows it.
  expect(await l.rt.subWheel.once()).toBe(false);
  let s = await l.state();
  expect(s.rights).toHaveLength(1);
  const right = s.rights![0]!;
  expect(right).toMatchObject({
    status: 'owed',
    presence: 'unknown',
    sources: ['chat_notification'],
    right: { queue: 'manual', sub_month: 14, month_source: 'twitch' },
  });
  let html = subWheelView(s, null);
  expect(html).toContain('Tours manuels');
  expect(html).toContain('Viewer&lt;3');
  expect(html).toContain('Mois 14 <span class="sw-ok">confirmé</span>');
  expect(html).toContain(`data-act="sw-draw" data-spin="${right.spin_id}"`);
  // « Tirer » from Studio: the next wheel draws it.
  await l.api('POST', `/spins/${right.spin_id}/request`);
  s = await l.state();
  expect(s.rights![0]!.status).toBe('requested');
  html = subWheelView(s, null);
  expect(html).toMatch(/Demandes de tirage <span class="sw-count">1/);
  // The simulated player shows the wheel Core drew, once.
  expect(await l.rt.subWheel.once()).toBe(true);
  expect(await l.rt.subWheel.once()).toBe(false);
  expect(l.shown).toHaveLength(1);
  const { segment, amount } = l.shown[0]!.spin;
  expect(amount).toBe(subWheelAmount(14, 2, segment));
  // History: shown, one gain; asking again changes nothing.
  s = await l.state();
  expect(s.rights).toEqual([]);
  expect(s.recent[0]).toMatchObject({
    spin_id: right.spin_id,
    status: 'shown',
    amount,
  });
  await expect(
    l.api('POST', `/spins/${right.spin_id}/request`),
  ).rejects.toMatchObject({ body: { error: 'not_owed' } });
  html = subWheelView(s, null, { tab: 'history' });
  expect(html).toContain('Affichée');
  return { l, amount, spinId: right.spin_id };
}

describe('Roue du Sub V2 — R4, Lab end to end (Studio API, real Lab Core, simulated player)', () => {
  it('Lab database: acquisition → waiting → Studio → « Tirer » → wheel → one Lab test wallet credit → history', async () => {
    const { l, amount } = await chain(false);
    const s = await l.state();
    expect(s.recent[0]!.award.status).toBe('awarded');
    expect(s.pending_awards).toEqual({ count: 0, total: 0 });
    const ledger = await l.db.query<{ amount: number }>(
      "select amount from lab_wallet_ledger where kind = 'sub_wheel'",
    );
    expect(ledger.map((r) => Number(r.amount))).toEqual([amount]);
  });

  it('canonical Wallet: the same chain credits once (one movement, the exact gain)', async () => {
    const { l, amount, spinId } = await chain(true);
    expect((await l.state()).recent[0]!.award.status).toBe('awarded');
    const tx = await l.db.query<{ n: number; total: number }>(
      `select count(*)::int as n, coalesce(sum(t.amount), 0)::int as total from wallet_transactions t
       where t.source = 'sub_wheel' and t.reference = $1`,
      [spinId],
    );
    expect(tx[0]).toEqual({ n: 1, total: amount });
  });

  it('RV2-1 — « Annonce du gain »: the delay saved from Studio reaches Core (0–60 s) and the section shows it', async () => {
    const l = await lab(false);
    expect((await l.state()).settings.announce_delay_s).toBe(8);
    expect(
      (
        await l.api<{ announce_delay_s: number }>('POST', '/announce-delay', {
          seconds: 20,
        })
      ).announce_delay_s,
    ).toBe(20);
    await expect(
      l.api('POST', '/announce-delay', { seconds: 61 }),
    ).rejects.toThrow();
    const s = await l.state();
    expect(s.settings.announce_delay_s).toBe(20);
    const html = subWheelView(s, null, { tab: 'settings' });
    expect(html).toContain('data-f="sw-announce-delay"');
    expect(html).toContain('value="20"');
    expect(html).toContain('Actuel : 20 s');
    expect(html).toContain('remporte');
  });

  it('« Accorder un tour » then « Tirer » from Studio; a tour « À vérifier » decided from Studio (merge: never drawn)', async () => {
    const l = await lab(false);
    await l.api('POST', '/settings', { enabled: true });
    // History month 5 (V1), then v2: a « sub » (estimate 6) and, 2 days later, its share (certain 6) → one blocked.
    await l.sub({ months: 5, occurred_at: iso(-40 * 86_400_000) });
    await l.api('POST', '/mode', { mode: 'v2' });
    await l.sub({
      type: 'sub',
      months: undefined,
      occurred_at: iso(-2 * 86_400_000),
    });
    await l.sub({ months: 6, occurred_at: iso(0) });
    await l.playAlerts();
    while (await l.rt.subWheel.once());
    let s = await l.state();
    expect(s.reviews).toHaveLength(1);
    const review = s.reviews![0]!;
    let html = subWheelView(s, null, { tab: 'review' });
    expect(html).toContain('Tour bloqué');
    expect(html).toContain('Fusionner (doublon)');
    expect(html).toContain('avis de chat');
    expect(html).toMatch(/À vérifier \(1\)/);
    // The blocked tour has no « Tirer »; the other one has.
    html = subWheelView(s, null);
    expect(html).toContain(
      '<span class="cp-tag cp-tag--warn">À vérifier</span>',
    );
    await expect(
      l.api('POST', `/spins/${review.suspect.spin_id}/request`),
    ).rejects.toMatchObject({ body: { error: 'needs_review' } });
    await l.api('POST', `/reviews/${review.review_id}/resolve`, {
      decision: 'merge',
      note: 'même renouvellement',
    });
    s = await l.state();
    expect(s.reviews).toEqual([]);
    expect(s.rights!.map((r) => r.spin_id)).not.toContain(
      review.suspect.spin_id,
    );
    // A granted tour, drawn on request.
    const granted = await l.api<{ spin_id: string }>('POST', '/grant', {
      key: randomUUID(),
      viewer: { id: '9002', name: 'Lucky' },
      tier: 1,
      months: 3,
      note: 'cadeau du live',
    });
    await l.api('POST', `/spins/${granted.spin_id}/request`);
    const before = l.shown.length;
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(l.shown.length).toBe(before + 1);
    s = await l.state();
    const merged = s.recent.find((r) => r.spin_id === review.suspect.spin_id)!;
    expect(merged).toMatchObject({ status: 'merged', amount: null });
    html = subWheelView(s, null, { tab: 'history' });
    expect(html).toContain('Fusionnée (doublon)');
    expect(html).toContain('<i>Accordé</i> Lucky');
    // Every decision journaled (Studio = the broadcaster).
    const audit = await l.db.query<{ action: string }>(
      "select action from lab_moderation_audit where module_id = 'sub_wheel' order by id",
    );
    expect(audit.map((a) => a.action)).toEqual([
      'sw_mode',
      'sw_review_merge',
      'sw_grant',
      'sw_draw_request',
    ]);
  });
});

describe('Roue du Sub V2 — RV2-2 Studio « Droits » (real Lab Core)', () => {
  it('search by pseudo → the viewer card; « Accorder » refused while it has a tour; « Lancer » then « Relancer un tirage »: a new draw, paid once more', async () => {
    const l = await lab(false);
    await l.api('POST', '/settings', { enabled: true });
    await l.api('POST', '/mode', { mode: 'v2' });
    const grant = (key = randomUUID()) =>
      l.api<{ spin_id: string }>('POST', '/grant', {
        key,
        viewer: { id: '9301', login: 'wenuyr', name: 'Wenuyr' },
        tier: 1,
        months: 3,
        note: 'roue promise',
      });
    const right = await grant();
    expect(
      await l.api<{ id: string; name: string }[]>('POST', '/admin/search', {
        q: 'wenu',
      }),
    ).toEqual([{ id: '9301', login: 'wenuyr', name: 'Wenuyr' }]);
    const card = () => l.api<SwViewerAdmin>('GET', '/admin/viewers/9301');
    let v = await card();
    expect(v).toMatchObject({
      counts: { available: 1, draws: 0 },
      can_grant: false,
    });
    // Its own tour is to be used: no second right (Core says why, with the count).
    await expect(grant()).rejects.toMatchObject({ status: 409 });
    // « Lancer »: drawn at the next wheel.
    await l.api('POST', `/spins/${right.spin_id}/request`);
    expect(await l.rt.subWheel.once()).toBe(true);
    v = await card();
    expect(v).toMatchObject({
      counts: { available: 0, draws: 1 },
      can_grant: true,
    });
    const gain = v.gains.awarded;
    expect(gain).toBeGreaterThan(0);
    // « Relancer un tirage »: the same click twice is ONE new draw, then drawn and credited once more.
    const key = randomUUID();
    const redraw = () =>
      l.api<{ spin_id: string; redraw_of: string }>('POST', '/redraw', {
        key,
        spin_id: right.spin_id,
        note: 'roue coupée par OBS',
      });
    const r = await redraw();
    expect((await redraw()).spin_id).toBe(r.spin_id);
    expect(r.redraw_of).toBe(right.spin_id);
    v = await card();
    expect(v.draws[0]).toMatchObject({ redraw_pending: true });
    let html = rightsTab(
      { query: 'wenu', hits: null, viewer: v, grantOpen: false },
      true,
    );
    expect(html).toContain('relance en attente');
    expect(await l.rt.subWheel.once()).toBe(true);
    v = await card();
    expect(v.counts.draws).toBe(2);
    expect(v.gains.awarded).toBeGreaterThan(gain);
    html = rightsTab(
      { query: 'wenu', hits: null, viewer: v, grantOpen: false },
      true,
    );
    expect(html).toContain('nouveau tirage');
    expect(html.match(/data-act="swr-redraw"/g)).toHaveLength(2);
  });
});

describe('Roue du Sub V2 — RV2-4 fix: a wheel is drawn only when the player can show it (real Lab Core)', () => {
  /** Two tours of raptoru_ off live (wheel OFF when they came), then « Rattraper »: both requested. */
  async function caughtUp() {
    const l = await lab(false);
    await l.api('POST', '/mode', { mode: 'v2' });
    for (const months of [4, 5])
      await l.sub({
        months,
        actor: { id: '83603689', login: 'raptoru_', display_name: 'raptoru_' },
      });
    await l.api('POST', '/settings', { enabled: true });
    await l.playAlerts(); // their sub alerts first: a V2 wheel never starts over an alert
    const v = await l.api<SwViewerAdmin>('GET', '/admin/viewers/83603689');
    expect(v.counts.available).toBe(2);
    for (const r of v.rights)
      await l.api('POST', `/spins/${r.spin_id}/request`);
    return l;
  }
  const count = async (l: Awaited<ReturnType<typeof lab>>, sql: string) =>
    Number(
      (
        await l.db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)
      )[0]!.n,
    );

  it('the Lab bug: a player page open but its sound blocked gets NOTHING claimed — no draw, no credit; then the two tours play one after the other', async () => {
    const l = await caughtUp();
    l.fx.audio = false; // a browser tab never clicked: « connected », sound blocked
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(l.shown).toHaveLength(0);
    expect(await count(l, "sw_spins where status = 'requested'")).toBe(2);
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      0,
    );
    let s = await l.state();
    expect(s.animations_waiting).toBe('effects_player_muted');
    let html = subWheelView(s, null);
    expect(html).toContain('son bloqué');
    expect(html).not.toContain('Lecteur prêt');
    // Sound allowed: the first wheel plays; while it plays, nothing else is claimed (never two at once).
    l.fx.audio = true;
    l.fx.hold = true;
    const first = l.rt.subWheel.once();
    await new Promise((r) => setTimeout(r, 50));
    expect(l.shown).toHaveLength(1);
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(l.shown).toHaveLength(1);
    l.fx.hold = false;
    l.fx.release!();
    expect(await first).toBe(true);
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(l.shown).toHaveLength(2);
    expect(await count(l, "sw_spins where status = 'shown'")).toBe(2);
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      2,
    );
    s = await l.state();
    html = subWheelView(s, null);
    expect(html).toContain('Lecteur prêt');
  });

  it('a display that fails AFTER the draw: « Non affichée », paid once; « Rejouer l’animation » shows the SAME draw, nothing credited again', async () => {
    const l = await caughtUp();
    l.fx.failNext = 'effects_player_offline'; // the page did not take it in time
    expect(await l.rt.subWheel.once()).toBe(true);
    const failed = (await l.state()).recent.find((r) => r.status === 'failed')!;
    expect(failed).toMatchObject({ reason: 'effects_player_offline' });
    expect(failed.amount).toBeGreaterThan(0);
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      1,
    );
    let html = subWheelView(await l.state(), null, {
      tab: 'history',
    });
    expect(html).toContain('data-act="sw-replay"');
    // Replayed: back in the queue as it is, shown before the next tour; still ONE payment for it.
    await l.api('POST', `/spins/${failed.spin_id}/replay`);
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(l.shown[0]).toMatchObject({
      spin: { amount: failed.amount, segment: failed.segment },
    });
    const replayed = (await l.state()).recent.find(
      (r) => r.spin_id === failed.spin_id,
    )!;
    expect(replayed).toMatchObject({ status: 'shown', replays: 1 });
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      1,
    );
    // The second tour next, paid once too: two credits in all.
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      2,
    );
    expect(await count(l, "sw_spins where status = 'shown'")).toBe(2);
    html = subWheelView(await l.state(), null, {
      tab: 'history',
    });
    expect(html).not.toContain('data-act="sw-replay"');
  });

  it('autonomous: a wheel the page never started is shown again BY ITSELF after its delay — the same draw, paid once; Studio says when', async () => {
    const l = await caughtUp();
    l.fx.failNext = 'effect_start_timeout'; // taken by the page, never started
    expect(await l.rt.subWheel.once()).toBe(true);
    let s = await l.state();
    const failed = s.recent.find((r) => r.status === 'failed')!;
    expect(failed).toMatchObject({ recovery: 'retry', retries: 0 });
    expect(s.recovery).toMatchObject({ retrying: 1, to_replay: 0 });
    let html = subWheelView(s, null, { tab: 'history' });
    expect(html).toContain('nouvel essai automatique');
    expect(html).toContain(
      '1 roue(s) jamais affichée(s) : nouvel essai automatique',
    );
    // Not before its delay: the second tour goes first (one at a time).
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(await l.rt.subWheel.once()).toBe(false);
    l.clock.shift = SUB_WHEEL.retryBaseMs + 1_000;
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(l.shown.at(-1)).toMatchObject({
      spin: { amount: failed.amount, segment: failed.segment },
    });
    s = await l.state();
    expect(s.recent.find((r) => r.spin_id === failed.spin_id)).toMatchObject({
      status: 'shown',
      recovery: null,
      retries: 1,
    });
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      2,
    );
    html = subWheelView(s, null, { tab: 'history' });
    expect(html).not.toContain('nouvel essai automatique');
  });

  it('Lab simulator « Faire échouer le prochain affichage »: the next wheel never starts, then comes back by itself — Lab only', async () => {
    const l = await caughtUp();
    expect(await l.api('POST', '/lab/fail-next-start', { on: true })).toEqual({
      on: true,
    });
    let s = await l.state();
    expect(s.lab_fail_next_start).toBe(true);
    expect(subWheelView(s, null, { tab: 'lab' })).toContain(
      'Prochain affichage : échec avant démarrage',
    );
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(l.shown).toHaveLength(0);
    s = await l.state();
    expect(s.lab_fail_next_start).toBe(false);
    const failed = s.recent.find((r) => r.status === 'failed')!;
    expect(failed).toMatchObject({
      reason: 'effect_start_timeout',
      recovery: 'retry',
    });
    expect(await l.rt.subWheel.once()).toBe(true); // the other tour
    l.clock.shift = SUB_WHEEL.retryBaseMs + 1_000;
    expect(await l.rt.subWheel.once()).toBe(true); // shown again by itself
    expect(l.shown.at(-1)).toMatchObject({
      spin: { amount: failed.amount, segment: failed.segment },
    });
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      2,
    );
  });

  it('Core unreachable when the end is reported: Studio keeps it and sends it again before anything else — « Affichée », never « À vérifier »', async () => {
    const l = await caughtUp();
    l.net.down = true;
    await expect(l.rt.subWheel.once()).rejects.toThrow('fetch failed');
    expect(l.shown).toHaveLength(1);
    expect(await count(l, "sw_spins where status = 'playing'")).toBe(1);
    // Still down: the report is tried again, nothing else is claimed.
    await expect(l.rt.subWheel.once()).rejects.toThrow('fetch failed');
    expect(l.shown).toHaveLength(1);
    l.net.down = false;
    expect(await l.rt.subWheel.once()).toBe(true); // the report, then the next tour
    expect(l.shown).toHaveLength(2);
    expect(await count(l, "sw_spins where status = 'shown'")).toBe(2);
    expect(await count(l, 'sw_spins where recovery is not null')).toBe(0);
  });

  it('Core back only after the lease: the late report of the same player settles « À vérifier » — « Affichée »', async () => {
    const l = await caughtUp();
    l.net.down = true;
    await expect(l.rt.subWheel.once()).rejects.toThrow('fetch failed');
    l.clock.shift = SUB_WHEEL.animationLeaseMs + 1_000;
    let s = await l.state(); // the sweep: perhaps seen
    expect(s.recovery?.checks).toHaveLength(1);
    expect(subWheelView(s, null, { tab: 'review' })).toContain(
      'Animations peut-être vues',
    );
    l.net.down = false;
    expect(await l.rt.subWheel.once()).toBe(true);
    s = await l.state();
    expect(s.recovery?.checks).toHaveLength(0);
    expect(await count(l, "sw_spins where status = 'shown'")).toBe(2);
  });

  it('the player page closed (OBS off), then back: nothing claimed meanwhile — the tours wait, undrawn — then both play by themselves', async () => {
    const l = await caughtUp();
    l.fx.connected = false;
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(l.rt.subWheel.waiting).toBe('effects_player_offline');
    expect(await count(l, "sw_spins where status = 'requested'")).toBe(2);
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      0,
    );
    expect(subWheelView(await l.state(), null)).toContain(
      'Lecteur d’effets : non ouvert',
    );
    l.fx.connected = true;
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(l.shown).toHaveLength(2);
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      2,
    );
  });

  it('the wheel sounds missing in Studio: nothing claimed (no draw, no credit), said in the section', async () => {
    const l = await caughtUp();
    l.fx.media = false;
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(l.shown).toHaveLength(0);
    expect(await count(l, "sw_spins where status = 'requested'")).toBe(2);
    expect(await count(l, "lab_wallet_ledger where kind = 'sub_wheel'")).toBe(
      0,
    );
    const s = await l.state();
    expect(s.animations_waiting).toBe('effect_media_missing');
    expect(subWheelView(s, null)).toContain('Sons de la roue manquants');
    l.fx.media = true;
    expect(await l.rt.subWheel.once()).toBe(true);
  });

  it('« Elle a bien été vue » from Studio: « Affichée », announced once — a wheel perhaps seen is never shown again by itself', async () => {
    const l = await caughtUp();
    l.fx.hold = true;
    const first = l.rt.subWheel.once();
    await new Promise((r) => setTimeout(r, 50));
    // The page started it, then its end never came (closed during the wheel).
    l.fx.release = null;
    l.clock.shift = SUB_WHEEL.animationLeaseMs + 1_000;
    let s = await l.state();
    const check = s.recovery!.checks[0]!;
    expect(check).toMatchObject({ reason: 'animation_not_confirmed' });
    const html = subWheelView(s, null, { tab: 'review' });
    expect(html).toContain('data-act="sw-confirm-shown"');
    expect(html).toContain('Le lecteur a disparu pendant la roue');
    expect(html).toContain('À vérifier (1)');
    await l.api('POST', `/spins/${check.spin_id}/confirm-shown`);
    s = await l.state();
    expect(s.recovery?.checks).toHaveLength(0);
    expect(s.recent.find((r) => r.spin_id === check.spin_id)).toMatchObject({
      status: 'shown',
    });
    expect(
      await count(
        l,
        `cmd_steps where idempotency_key = 'sub_wheel:win:${check.spin_id}'`,
      ),
    ).toBe(1);
    void first;
  });
});

describe('Roue du Sub V2 — RV2-2 « Droits » (pure view)', () => {
  const viewer = (over: Partial<SwViewerAdmin> = {}): SwViewerAdmin => ({
    viewer: { id: '9301', login: 'wenuyr', name: 'Wenuyr' },
    counts: { available: 2, requested: 0, blocked: 0, drawing: 0, draws: 1 },
    gains: { awarded: 8000, pending: 0 },
    can_grant: false,
    rights: [],
    draws: [],
    ...over,
  });
  it('search results, the counts and gains; three distinct actions; « Accorder » closed while it has tours', () => {
    let html = rightsTab(
      {
        query: 'we',
        hits: [
          { id: '9301', login: 'wenuyr', name: 'Wenuyr' },
          { id: '9302', login: 'weed_<b>', name: 'Weed<b>' },
        ],
        viewer: viewer(),
        grantOpen: false,
      },
      true,
    );
    expect(html).toContain('data-act="swr-pick" data-id="9302"');
    expect(html).not.toContain('Weed<b>'); // escaped
    expect(html).toContain('<b>2</b> disponibles');
    expect(html).toContain(
      `<b>${(8000).toLocaleString('fr-FR')}</b> jetons gagnés`,
    );
    expect(html).toContain('data-act="swr-catchup"');
    expect(html).toContain('Rattraper : lancer 2 tours');
    expect(html).toMatch(/data-act="swr-grant-open" disabled/);
    expect(html).toContain('2 tours à utiliser d’abord');
    html = rightsTab(
      {
        query: '',
        hits: [],
        viewer: viewer({
          counts: {
            available: 0,
            requested: 0,
            blocked: 0,
            drawing: 0,
            draws: 0,
          },
          can_grant: true,
        }),
        grantOpen: true,
      },
      true,
    );
    expect(html).toContain('Aucun viewer trouvé');
    expect(html).not.toContain('swr-catchup');
    expect(html).toContain('data-role="swr-grant"');
    expect(html).toContain('Accorder à Wenuyr');
    expect(
      rightsTab(
        { query: '', hits: null, viewer: null, grantOpen: false },
        false,
      ),
    ).toContain('ne gère pas encore');
  });
  it('the redraw confirmation says the previous gain and that it is paid on top', () => {
    const text = redrawConfirm('Wenuyr', '26/10 21:04', 8000, 'awarded');
    expect(text).toContain(
      `a rapporté ${(8000).toLocaleString('fr-FR')} jetons (Crédité)`,
    );
    expect(text).toContain('payé EN PLUS');
  });
});

describe('Roue du Sub V2 — R4, the Studio section (pure view)', () => {
  const base: SwState = {
    settings: { enabled: true, mode: 'v2' },
    waiting: 0,
    pending_awards: { count: 0, total: 0 },
    recent: [],
    effects: { connected: true, current: true, media: [] },
  };
  const right = (over: Record<string, unknown>) =>
    ({
      spin_id: randomUUID(),
      source: 'twitch',
      type: 'resub',
      viewer: { name: 'V' },
      tier: 1,
      months: 7,
      status: 'owed',
      reason: null,
      segment: null,
      amount: null,
      award: { status: 'none', ref: null, note: null },
      created_at: '2026-10-21T20:00:00.000Z',
      right: {
        queue: 'auto',
        sub_month: 7,
        month_source: 'twitch',
        acquired_at: '2026-10-21T20:00:00.000Z',
        drawn_at: null,
      },
      requested_by: null,
      blocked: false,
      presence: 'present',
      sources: ['chat_notification', 'message'],
      ...over,
    }) as never;

  it('waiting: requests, automatic queue (presence), manual tours; estimated months said; blocked tours without « Tirer »', () => {
    const html = subWheelView(
      {
        ...base,
        rights: [
          right({ status: 'requested', requested_by: 'mod<x>' }),
          right({ presence: 'absent' }),
          right({
            right: {
              queue: 'manual',
              sub_month: 6,
              month_source: 'estimated',
              acquired_at: null,
              drawn_at: null,
            },
            presence: 'unknown',
            blocked: true,
            sources: ['subscribe'],
          }),
        ],
      },
      null,
    );
    expect(html).toMatch(/Demandes de tirage <span class="sw-count">1/);
    expect(html).toMatch(/File automatique <span class="sw-count">1/);
    expect(html).toMatch(/Tours manuels <span class="sw-count">1/);
    expect(html).toContain('demandé par mod&lt;x&gt;');
    expect(html).toContain('cp-chip--off">absent');
    expect(html).toContain('présence inconnue');
    expect(html).toContain('Mois ~6 <span class="sw-est">estimé</span>');
    expect(html).toContain('message de resub');
    expect(html.match(/data-act="sw-draw"/g)).toHaveLength(1);
    expect(html).toContain('À vérifier</span>');
    expect(html).not.toContain('La V2 ne tire pas encore');
    // « Accorder un tour » is by pseudo, in « Droits »: no Twitch ID form left.
    expect(html).toContain('data-act="sw-tab" data-tab="rights"');
    expect(html).not.toContain('Twitch ID');
    expect(html).not.toContain('data-f="g-id"');
  });

  it('outside v2 the section says the V2 does not draw yet; settings: switch and the three modes', () => {
    const v1 = { ...base, settings: { enabled: true, mode: 'v1' as const } };
    expect(subWheelView(v1, null)).toContain('la V2 ne tire pas encore');
    const html = subWheelView(v1, null, { tab: 'settings' });
    expect(html).toContain('Désactiver la roue');
    expect(html.match(/name="sw-mode"/g)).toHaveLength(3);
    expect(html).toContain('value="v1" data-act="sw-mode" checked');
    expect(html).toContain('diffuseur uniquement');
    expect(html).toContain('Tester l’animation');
  });

  it('« À vérifier »: both tours and their proofs; merge offered only for a tour neither drawn nor owing a gain; « Possible doublon » has no action', () => {
    const side = (over: Record<string, unknown>) => ({
      spin_id: randomUUID(),
      status: 'owed',
      sub_month: 6,
      month_source: 'estimated',
      award_status: 'none',
      acquired_at: null,
      sources: [
        {
          source: 'subscribe',
          occurred_at: '2026-10-19T20:00:00.000Z',
          months: null,
        },
      ],
      ...over,
    });
    const view = (suspect: Record<string, unknown>) =>
      subWheelView(
        {
          ...base,
          reviews: [
            {
              review_id: 4,
              status: 'open',
              month: 6,
              created_at: '2026-10-21T20:00:00.000Z',
              viewer_id: '9',
              suspect: { ...side(suspect), viewer_name: '<i>W</i>' } as never,
              other: side({
                status: 'shown',
                month_source: 'twitch',
                amount: 2000,
                sources: [
                  {
                    source: 'chat_notification',
                    occurred_at: '2026-10-21T20:00:00.000Z',
                    months: 6,
                  },
                ],
              }) as never,
            },
          ],
          possible_duplicates: [
            {
              viewer_id: '9',
              viewer_name: 'W',
              days_apart: 3.5,
              a: {
                spin_id: 'a',
                status: 'owed',
                sub_month: 6,
                month_source: 'estimated',
                at: '2026-10-18T20:00:00.000Z',
              },
              b: {
                spin_id: 'b',
                status: 'owed',
                sub_month: 8,
                month_source: 'twitch',
                at: '2026-10-21T20:00:00.000Z',
              },
            },
          ],
        },
        null,
        { tab: 'review' },
      );
    const html = view({});
    expect(html).toContain('&lt;i&gt;W&lt;/i&gt;');
    expect(html).toContain('abonnement');
    expect(html).toContain('6 mois cumulés');
    expect(html).toMatch(/2\s000 jetons/); // fr-FR: narrow no-break space
    expect(html).toContain('data-decision="distinct"');
    expect(html).toContain('data-decision="merge"');
    expect(html).toContain('data-decision="unresolved"');
    expect(html).toContain('3,5 j');
    expect(html.match(/data-act="sw-review"/g)).toHaveLength(3);
    expect(view({ award_status: 'pending' })).not.toContain(
      'data-decision="merge"',
    );
  });
});

describe('Roue du Sub — Studio against a Core without the V2 yet (older production Core)', () => {
  /** An older Core: /state answers (V1), the V2 reads are unknown routes (404 not_found). */
  const olderCore = (fail?: { path: string; status: number }) =>
    (async (path: string) => {
      if (fail && path.endsWith(fail.path))
        throw Object.assign(new Error('boom'), { status: fail.status });
      if (path.endsWith('/state'))
        return {
          settings: { enabled: false },
          waiting: 0,
          pending_awards: { count: 0, total: 0 },
          recent: [
            {
              spin_id: randomUUID(),
              source: 'twitch',
              type: 'resub',
              viewer: { name: 'Ancien' },
              tier: 1,
              months: 3,
              status: 'shown',
              reason: null,
              segment: 1,
              amount: 300,
              award: { status: 'awarded', ref: null, note: null },
              created_at: '2026-10-20T20:00:00.000Z',
            },
          ],
        };
      throw Object.assign(new Error('not_found'), {
        status: 404,
        body: { error: 'not_found' },
      });
    }) as never;
  const runtime = async (core: never) => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-old-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    return ChannelPointsRuntime.create({
      core,
      environment: 'production',
      channelId: '83603689',
      origin: 'http://127.0.0.1:1',
      dir,
      obs: () => ({ connected: true, request: async () => ({}) }),
      effects: null,
      twitch: () => ({ scope: true, adapter_running: true }),
    });
  };

  it('the end of a wheel to a Core older than « started » (400): sent again without it — the wheel is « Affichée », not lost', async () => {
    const reports: Record<string, unknown>[] = [];
    const core = (async (path: string, body?: Record<string, unknown>) => {
      if (path.endsWith('/animations/claim'))
        return reports.length
          ? { spin: null }
          : {
              spin: {
                spin_id: randomUUID(),
                name: 'V',
                type: 'resub',
                tier: 1,
                months: 3,
                layout: [],
                segment: 0,
                amount: 300,
              },
            };
      if (path.endsWith('/animation')) {
        if (body && 'started' in body)
          throw Object.assign(new Error('lab_core_400'), { status: 400 });
        reports.push(body!);
        return { status: 'shown' };
      }
      throw Object.assign(new Error('not_found'), { status: 404 });
    }) as never;
    const effects = {
      status: () => ({ connected: true, audio: true, current: true }),
      interactionMedia: () => [],
      play: async () => ({
        end: Promise.resolve({ event: 'completed' as const }),
      }),
    } as unknown as EffectsPlayer;
    const rt = new SubWheelRuntime({
      core,
      environment: 'production',
      channelId: '83603689',
      effects,
    });
    expect(await rt.once()).toBe(true);
    expect(reports).toEqual([
      { consumer_id: expect.any(String), event: 'completed' },
    ]);
    expect(await rt.once()).toBe(false);
  });

  it('the section still opens (no « indisponible : not_found »): V1 history and switch, the V2 said unavailable', async () => {
    const rt = await runtime(olderCore());
    const s = (await rt.subWheel.api(
      'GET',
      '/state',
      async () => ({}),
    )) as SwState;
    expect(s).toMatchObject({
      v2_unavailable: true,
      rights: [],
      possible_duplicates: [],
    });
    const waiting = subWheelView(s, null);
    expect(waiting).toContain('ne gère pas encore la Roue du Sub V2');
    expect(subWheelView(s, null, { tab: 'history' })).toContain('Ancien');
    const settings = subWheelView(s, null, {
      tab: 'settings',
    });
    expect(settings).toContain('Activer la roue');
    expect(settings).not.toContain('name="sw-mode"');
  });

  it('any other failure stays an error (never hidden): /state down, or a V2 read failing with 500', async () => {
    await expect(
      (await runtime(olderCore({ path: '/state', status: 503 }))).subWheel.api(
        'GET',
        '/state',
        async () => ({}),
      ),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      (await runtime(olderCore({ path: '/rights', status: 500 }))).subWheel.api(
        'GET',
        '/state',
        async () => ({}),
      ),
    ).rejects.toMatchObject({ status: 500 });
  });
});
