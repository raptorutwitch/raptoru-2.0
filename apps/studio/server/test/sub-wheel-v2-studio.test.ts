import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { subWheelAmount } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { coreWalletEconomy } from '../../../core-api/src/economy/economy.js';
import { WalletService } from '../../../core-api/src/wallet/wallet-service.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import type { ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import type { EffectsPlayer } from '../src/effects/player.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';
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
  const server: Server = createLabCore({
    db,
    clock: systemClock,
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
  const core = localLabCoreClient(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    secret,
  );
  const shown: { spin: { segment: number; amount: number; months: number } }[] =
    [];
  const effects = {
    status: () => ({
      url: '',
      connected: true,
      audio: true,
      current: true,
      playing: 0,
    }),
    play: async (e: never) => {
      shown.push(e);
      return { end: Promise.resolve({ event: 'completed' as const }) };
    },
    handle: async () => false,
    sounds: () => [],
    videos: () => [],
    interactionMedia: () => [],
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
  return { db, core, rt, shown, api, state, playAlerts, sub };
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
  html = subWheelView(s, null, { tab: 'history', grantOpen: false });
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
    const html = subWheelView(s, null, { tab: 'settings', grantOpen: false });
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
    let html = subWheelView(s, null, { tab: 'review', grantOpen: false });
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
    html = subWheelView(s, null, { tab: 'history', grantOpen: false });
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
  });

  it('outside v2 the section says the V2 does not draw yet; settings: switch and the three modes', () => {
    const v1 = { ...base, settings: { enabled: true, mode: 'v1' as const } };
    expect(subWheelView(v1, null)).toContain('la V2 ne tire pas encore');
    const html = subWheelView(v1, null, { tab: 'settings', grantOpen: false });
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
        { tab: 'review', grantOpen: false },
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
    expect(
      subWheelView(s, null, { tab: 'history', grantOpen: false }),
    ).toContain('Ancien');
    const settings = subWheelView(s, null, {
      tab: 'settings',
      grantOpen: false,
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
