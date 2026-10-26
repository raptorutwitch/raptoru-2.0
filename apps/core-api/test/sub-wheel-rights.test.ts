import { randomUUID } from 'node:crypto';
import { type AlertEventInput, subWheelAmount } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { coreWalletEconomy } from '../src/economy/economy.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { count, setup } from './helpers.js';

// Roue du Sub V2, lot RV2-2 (Studio « Droits »): a new right only when the viewer has none of its own to use
// (« Accorder une roue »), its own tours drawn instead (« Rattraper »: no new right, kept across restarts, wheel OFF or
// off live), and the broadcaster's exceptional NEW draw after a draw (« Relancer un tirage »: a linked right of its own,
// paid once more, a repeated click the same, one pending per draw, never for a test). PGlite; the races are in
// sub-wheel-v2.integration.test.ts.

const CH = '83603689';
const SEGMENT = 3;
const T0 = new Date('2026-10-26T20:00:00Z');
const studio: Actor = { id: 'studio', role: 'broadcaster', via: 'studio' };
const mod = (id: string): Actor => ({
  id,
  login: `mod${id}`,
  role: 'moderator',
  via: 'extension',
});
const notice = (viewer: string, name = `V${viewer}`): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: viewer, login: name.toLowerCase(), display_name: name },
  tier: '1000',
  months: 7,
  occurred_at: T0.toISOString(),
});

async function fixture() {
  const core = await setup();
  core.clock.set(T0);
  const port = coreWalletEconomy(core.wallet.wallet);
  const make = () =>
    new SubWheelService(core.db, core.clock, () => SEGMENT, port);
  const wheel = make();
  await wheel.setEnabled(CH, true);
  await wheel.setMode(CH, 'v2', 'studio');
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: Error & { code?: string }) => e.code ?? e.message,
    );
  const grant = (viewer: string, key = randomUUID(), by: Actor = studio) =>
    wheel.grant(CH, by, {
      key,
      viewer: { id: viewer, name: `V${viewer}` },
      tier: 1,
      months: 3,
      note: 'test',
    });
  /** The player shows the next wheel to its end. */
  const show = async () => {
    const { spin } = await wheel.claimAnimation(CH, 'obs');
    if (!spin) return null;
    core.clock.advance(12_000);
    await wheel.reportAnimation(spin.spin_id, {
      consumer_id: 'obs',
      event: 'completed',
    });
    return spin;
  };
  const credits = () =>
    count(core.db, "wallet_transactions where source = 'sub_wheel'");
  const balance = async (viewer: string) =>
    (await core.wallet.wallet.getWallet(viewer))?.balance ?? 0;
  const staff = (id: string, grants: string[]) =>
    core.db.query(
      `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants)
       values ($1, $2, 'moderator', 'test', $3, $4)`,
      [CH, id, T0, grants],
    );
  return { core, wheel, make, code, grant, show, credits, balance, staff };
}

describe('Roue du Sub V2 — RV2-2 « Accorder une roue »', () => {
  it('a new right only when the viewer has none of its own to use; the same key is the same right', async () => {
    const f = await fixture();
    // A tour of its own (sub off live, kept): no new right — it is to be used.
    const own = (await f.wheel.fromAlert(notice('9101'), null))!;
    expect(own).toMatchObject({ status: 'owed', right: { queue: 'manual' } });
    const refused = await f.grant('9101').catch((e) => e);
    expect(refused).toMatchObject({
      code: 'rights_available',
      details: { usable: 1 },
    });
    // Asked (requested): still its own to use.
    await f.wheel.requestDraw(own.spin_id, studio);
    expect(await f.code(f.grant('9101'))).toBe('rights_available');
    // Drawn: nothing left to use — a grant is possible, retried with the same key: the same right.
    await f.show();
    const key = randomUUID();
    const g = await f.grant('9101', key);
    expect(g).toMatchObject({ source: 'manual', status: 'owed' });
    expect((await f.grant('9101', key)).spin_id).toBe(g.spin_id);
    // That granted right is now its own to use: a second grant waits for it.
    expect(await f.code(f.grant('9101'))).toBe('rights_available');
    expect(await count(f.core.db, "sw_spins where viewer_id = '9101'")).toBe(2);
    // A viewer with nothing: granted at once.
    expect((await f.grant('9102')).status).toBe('owed');
  });
});

describe('Roue du Sub V2 — RV2-2 « Rattraper »', () => {
  it('a sub shared while the wheel was OFF and off live stays owed (restarts included); « Lancer » draws THAT right: no new right, one credit', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, false);
    const missed = (await f.wheel.fromAlert(notice('9201', 'Wenuyr'), null))!;
    expect(missed).toMatchObject({ status: 'owed' });
    expect(await f.show()).toBeNull(); // wheel OFF: nothing drawn, nothing lost
    // A Core restart (new service): the right is still there, usable.
    const again = f.make();
    await again.setEnabled(CH, true);
    const before = await again.viewerAdmin(CH, '9201');
    expect(before).toMatchObject({
      viewer: { id: '9201', name: 'Wenuyr' },
      counts: { available: 1, requested: 0, draws: 0 },
      can_grant: false,
    });
    await again.requestDraw(missed.spin_id, studio);
    const shown = (await f.show())!;
    expect(shown.spin_id).toBe(missed.spin_id);
    expect(await count(f.core.db, 'sw_spins')).toBe(1);
    expect(await f.credits()).toBe(1);
    const after = await again.viewerAdmin(CH, '9201');
    expect(after).toMatchObject({
      counts: { available: 0, requested: 0, draws: 1 },
      gains: { awarded: subWheelAmount(7, 1, SEGMENT), pending: 0 },
      can_grant: true,
    });
  });
});

describe('Roue du Sub V2 — RV2-2 « Relancer un tirage »', () => {
  it('the broadcaster only, after a real draw: a NEW linked right, drawn and paid once more; a repeated click is the same; one pending at a time; journaled', async () => {
    const f = await fixture();
    await f.grant('9301');
    const first = (await f.wheel.viewerAdmin(CH, '9301')).rights[0]!;
    await f.wheel.requestDraw(first.spin_id, studio);
    const o = (await f.show())!;
    const gain = Number(o.amount);
    expect(await f.balance('9301')).toBe(gain);
    const req = (key: string, spin = o.spin_id, by: Actor = studio) =>
      f.wheel.redraw(CH, by, {
        key,
        spin_id: spin,
        note: 'roue coupée par OBS',
      });
    // Not the broadcaster: refused (even with « Accorder »).
    await f.staff('7001', ['subWheelGrant']);
    expect(await f.code(req(randomUUID(), o.spin_id, mod('7001')))).toBe(
      'broadcaster_only',
    );
    // The broadcaster: a new right, requested, linked to the draw.
    const k1 = randomUUID();
    const r = await req(k1);
    expect(r).toMatchObject({
      source: 'manual',
      status: 'requested',
      redraw_of: o.spin_id,
      viewer: { id: '9301' },
    });
    // The same click again (same key): the same new draw. Another one meanwhile: waits for the first.
    expect((await req(k1)).spin_id).toBe(r.spin_id);
    expect(await f.code(req(randomUUID()))).toBe('redraw_pending');
    expect(await f.code(req(randomUUID(), r.spin_id))).toBe('not_drawn_yet');
    expect(await f.code(req(k1, r.spin_id))).toBe('redraw_key_reused');
    const admin = await f.wheel.viewerAdmin(CH, '9301');
    expect(admin.draws.find((d) => d.spin_id === o.spin_id)).toMatchObject({
      redraw_pending: true,
    });
    // Drawn at the next wheel (live or not): paid once more — two credits in all, never three.
    const shown = (await f.show())!;
    expect(shown.spin_id).toBe(r.spin_id);
    await f.show();
    expect(await f.credits()).toBe(2);
    expect(await f.balance('9301')).toBe(gain + Number(shown.amount));
    // Each new draw is announced like any real gain, once.
    expect(await count(f.core.db, "cmd_steps where origin = 'sub_wheel'")).toBe(
      2,
    );
    // Done: another explicit new draw is possible again; journal: who, why, after which draw.
    expect((await req(randomUUID())).status).toBe('requested');
    const audit = await f.core.db.query<{
      reason: string;
      before: { redraw_of: string };
    }>(
      "select reason, before from lab_moderation_audit where action = 'sw_redraw' order by id",
    );
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      reason: 'roue coupée par OBS',
      before: { redraw_of: o.spin_id },
    });
  });

  it('never for a Studio test, a right not drawn yet, or another channel', async () => {
    const f = await fixture();
    await f.wheel.test(CH, { name: 'Antoni', months: 3 });
    const t = (await f.show())!;
    const req = (spin: string, ch = CH) =>
      f.code(
        f.wheel.redraw(ch, studio, {
          key: randomUUID(),
          spin_id: spin,
          note: 'x',
        }),
      );
    expect(await req(t.spin_id)).toBe('not_redrawable');
    const owed = await f.grant('9401');
    expect(await req(owed.spin_id)).toBe('not_drawn_yet');
    expect(await req(owed.spin_id, '1234')).toBe('spin_not_found');
    expect(await count(f.core.db, 'sw_spins where redraw_of is not null')).toBe(
      0,
    );
  });
});

describe('Roue du Sub V2 — RV2-2 Studio « Droits »: search and summary', () => {
  it('by pseudo (the wheel’s viewers, then the channel’s), at least 2 characters; counts, draws and gains', async () => {
    const f = await fixture();
    await f.core.db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('9501', 'wenuyr', 'Wenuyr')`,
    );
    await f.wheel.fromAlert(notice('9502', 'Anaelle'), null);
    expect(await f.wheel.searchViewers(CH, 'a')).toEqual([]);
    expect(await f.wheel.searchViewers(CH, '@WEN')).toEqual([
      { id: '9501', login: 'wenuyr', name: 'Wenuyr' },
    ]);
    expect(await f.wheel.searchViewers(CH, 'anae')).toEqual([
      { id: '9502', login: 'anaelle', name: 'Anaelle' },
    ]);
    expect(await f.wheel.searchViewers(CH, '%')).toEqual([]); // no wildcard injection
    // Wenuyr: never subscribed — nothing to use, a grant possible.
    expect(await f.wheel.viewerAdmin(CH, '9501')).toMatchObject({
      viewer: { name: 'Wenuyr' },
      counts: { available: 0, requested: 0, draws: 0 },
      gains: { awarded: 0, pending: 0 },
      can_grant: true,
      rights: [],
      draws: [],
    });
    // Anaelle: one tour of her own waiting.
    expect(await f.wheel.viewerAdmin(CH, '9502')).toMatchObject({
      counts: { available: 1 },
      can_grant: false,
    });
  });
});

describe('Roue du Sub V2 — RV2-4 « Rejouer l’animation »', () => {
  it('a draw never shown goes back AS IT IS: same gain, nothing credited again, shown once, announced once; even 30 min later', async () => {
    const f = await fixture();
    const g = await f.grant('9601');
    await f.wheel.requestDraw(g.spin_id, studio);
    const { spin } = await f.wheel.claimAnimation(CH, 'obs');
    await f.wheel.reportAnimation(spin!.spin_id, {
      consumer_id: 'obs',
      event: 'failed',
      error: 'effects_player_muted',
    });
    expect(await f.credits()).toBe(1);
    const before = await f.balance('9601');
    f.core.clock.advance(30 * 60_000); // long after: never swept « too late » once replayed
    const q = await f.wheel.replayAnimation(spin!.spin_id, studio);
    expect(q).toMatchObject({ status: 'queued', replays: 1 });
    expect((await f.wheel.replayAnimation(spin!.spin_id, studio)).replays).toBe(
      1,
    ); // already waiting: the same
    const again = await f.wheel.claimAnimation(CH, 'obs');
    expect(again.spin).toMatchObject({
      spin_id: spin!.spin_id,
      amount: spin!.amount,
      segment: spin!.segment,
    });
    await f.wheel.reportAnimation(spin!.spin_id, {
      consumer_id: 'obs',
      event: 'completed',
    });
    expect(await f.credits()).toBe(1);
    expect(await f.balance('9601')).toBe(before);
    expect(await count(f.core.db, "cmd_steps where origin = 'sub_wheel'")).toBe(
      1,
    );
    expect(await f.code(f.wheel.replayAnimation(spin!.spin_id, studio))).toBe(
      'not_replayable',
    ); // shown: nothing to replay
    expect(
      await count(f.core.db, "lab_moderation_audit where action = 'sw_replay'"),
    ).toBe(1);
  });

  it('never a test, never a tour not drawn; « Tirer » permission required', async () => {
    const f = await fixture();
    await f.wheel.test(CH, { name: 'Antoni', months: 3 });
    const t = (await f.wheel.claimAnimation(CH, 'obs')).spin!;
    await f.wheel.reportAnimation(t.spin_id, {
      consumer_id: 'obs',
      event: 'failed',
      error: 'x',
    });
    expect(await f.code(f.wheel.replayAnimation(t.spin_id, studio))).toBe(
      'not_replayable',
    );
    const owed = await f.grant('9602');
    expect(await f.code(f.wheel.replayAnimation(owed.spin_id, studio))).toBe(
      'not_replayable',
    );
    await f.staff('7001', ['subWheelGrant']);
    expect(
      await f.code(f.wheel.replayAnimation(owed.spin_id, mod('7001'))),
    ).toBe('forbidden');
  });
});
