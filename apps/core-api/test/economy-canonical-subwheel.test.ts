import { randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  SUB_WHEEL,
  subWheelAmount,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import type { Db } from '../src/db/db.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { count, setup } from './helpers.js';

// Phase 2 lot 5: Roue du Sub on the CANONICAL Core Wallet. A gain decided while the canonical Wallet is the runtime's
// economy is credited with its spin (one transaction, key move:sub_wheel:<spin>): redeliveries, restarts, lost answers,
// two Cores never pay twice; a refused credit stays pending with its reason; a gain pending from before is never paid
// automatically; « credited by hand » is closed on canonical (one payment path). Wheel rules unchanged. Test DB only.

const CH = '83603689';
const SEGMENT = 4; // months 7 (layout 4–11), T1: value × multiplier
const event = (over: Partial<AlertEventInput> = {}): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: '9101', login: 'viewer', display_name: 'Viewer' },
  tier: '1000',
  months: 7,
  ...over,
});
const GAIN = subWheelAmount(7, 1, SEGMENT);

async function canonical() {
  const core = await setup();
  core.clock.set(new Date('2026-10-19T20:00:00Z'));
  const port = coreWalletEconomy(core.wallet.wallet);
  const alerts = new AlertsService(core.db, core.clock, () => 0);
  const wheelOn = (db: Db = core.db, economy: typeof port | null = port) =>
    new SubWheelService(db, core.clock, () => SEGMENT, economy);
  const wheel = wheelOn();
  await wheel.setEnabled(CH, true);
  const receive = async (e: AlertEventInput, w = wheel) => {
    const r = await alerts.receive(e);
    return w.fromAlert(e, r.alert?.alert_id ?? null);
  };
  const tokens = async (id = '9101') =>
    (await core.wallet.wallet.getWallet(id))?.balance ?? 0;
  const credits = () =>
    count(core.db, "wallet_transactions where source = 'sub_wheel'");
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: Error & { code?: string }) => e.code ?? e.message,
    );
  return { core, port, wheelOn, wheel, receive, tokens, credits, code };
}

describe('Roue du Sub on the canonical Wallet', () => {
  it('a real resub: the gain credited with its spin into a blank wallet, exactly the legacy amount, traceable', async () => {
    const f = await canonical();
    const spin = (await f.receive(event()))!;
    expect(spin).toMatchObject({
      status: 'queued',
      segment: SEGMENT,
      amount: GAIN,
      award: { status: 'awarded' },
    });
    expect(spin.award.ref).toMatch(/^wallet_transactions:\d+$/);
    expect(await f.tokens()).toBe(GAIN);
    const leg = (
      await f.core.db.query<{
        key: string;
        source: string;
        reference: string;
        amount: number;
      }>(
        `select o.idempotency_key as key, t.source, t.reference, t.amount from wallet_transactions t
         join wallet_operations o on o.id = t.operation_id where t.source = 'sub_wheel'`,
      )
    )[0]!;
    expect(leg).toMatchObject({
      key: `move:sub_wheel:${spin.spin_id}`,
      reference: spin.spin_id,
      amount: GAIN,
    });
    expect(
      `wallet_transactions:${(await f.core.db.query<{ id: number }>("select id from wallet_transactions where source = 'sub_wheel'"))[0]!.id}`,
    ).toBe(spin.award.ref);
    // D4 « Activité Jetons » shows it under its own label.
    const m = new LabModerationService(
      f.core.db,
      f.core.clock,
      f.core.ttsLab,
      f.core.soundLab,
      f.core.bonkLab,
      f.core.raffleLab,
      f.port,
    );
    expect((await m.ledger(CH, { viewer: '9101' })).items[0]).toMatchObject({
      kind: 'sub_wheel',
      label: 'Roue du Sub',
      amount: GAIN,
    });
  });

  it('the same Twitch event again (redelivery, restarted Core): the same spin, never a second credit', async () => {
    const f = await canonical();
    const e = event();
    const first = (await f.receive(e))!;
    await f.receive(e);
    const again = (await f.receive(e, f.wheelOn()))!;
    expect(again.spin_id).toBe(first.spin_id);
    expect(await f.credits()).toBe(1);
    expect(await f.tokens()).toBe(GAIN);
  });

  it('a crash before the commit keeps neither spin nor credit; the redelivered event decides and pays once', async () => {
    const f = await canonical();
    const crashing: Db = {
      ...f.core.db,
      tx: (fn) =>
        f.core.db.tx((q) =>
          fn({
            query: (sql, params) => {
              if (/insert into wallet_transactions/.test(sql))
                throw new Error('connection lost');
              return q.query(sql, params);
            },
          }),
        ),
    };
    const e = event();
    await expect(f.receive(e, f.wheelOn(crashing))).rejects.toThrow(
      'connection lost',
    );
    expect(await count(f.core.db, 'sw_spins')).toBe(0);
    expect(await f.tokens()).toBe(0);
    await f.receive(e);
    expect(await f.credits()).toBe(1);
    expect(await f.tokens()).toBe(GAIN);
  });

  it('a commit whose answer is lost: the redelivery pays nothing more', async () => {
    const f = await canonical();
    const lost: Db = {
      ...f.core.db,
      tx: async (fn) => {
        await f.core.db.tx(fn);
        throw new Error('connection reset after COMMIT');
      },
    };
    const e = event();
    await expect(f.receive(e, f.wheelOn(lost))).rejects.toThrow('after COMMIT');
    await f.receive(e);
    expect(await f.credits()).toBe(1);
    expect(await f.tokens()).toBe(GAIN);
  });

  it('Jetons unavailable at the decision: the spin and its result stay, the gain pending with its reason; award() pays once', async () => {
    const f = await canonical();
    await f.core.db.query(
      "update currencies set active = false where id = 'main'",
    );
    const spin = (await f.receive(event()))!;
    expect(spin).toMatchObject({
      status: 'queued',
      amount: GAIN,
      award: { status: 'pending' },
    });
    expect(spin.award.note).toMatch(/crédit refusé/);
    expect(await f.code(f.wheel.award(spin.spin_id))).toBe('credit_refused');
    await f.core.db.query(
      "update currencies set active = true where id = 'main'",
    );
    expect(await f.wheel.award(spin.spin_id)).toMatchObject({
      award: { status: 'awarded' },
    });
    expect(await f.code(f.wheel.award(spin.spin_id))).toBe('already_awarded');
    expect(await f.code(f.wheelOn().award(spin.spin_id))).toBe(
      'already_awarded',
    );
    expect(await f.credits()).toBe(1);
    // The animation is independent of the payment: same result handed to Studio.
    f.core.clock.advance(SUB_WHEEL.afterAlertMaxMs + 1); // after its sub alert (existing rule)
    const claimed = await f.wheel.claimAnimation(CH, 'studio-A');
    expect(claimed.spin).toMatchObject({
      spin_id: spin.spin_id,
      segment: SEGMENT,
      amount: GAIN,
    });
  });

  it('no Twitch ID for the beneficiary: never credited to a name, stays pending with its reason', async () => {
    const f = await canonical();
    const spin = (await f.receive(
      event({ actor: { login: 'anon', display_name: 'Anon' } }),
    ))!;
    expect(spin.award).toMatchObject({ status: 'pending' });
    expect(spin.award.note).toMatch(/Twitch ID/);
    expect(await f.code(f.wheel.award(spin.spin_id))).toBe(
      'beneficiary_unknown',
    );
    expect(await count(f.core.db, 'wallet_transactions')).toBe(0);
  });

  it('a gain pending from before the switch (StreamElements era) is never paid automatically; only an explicit award()', async () => {
    const f = await canonical();
    const e = event();
    const old = (await f.receive(e, f.wheelOn(f.core.db, null)))!; // the Lab / pre-cutover runtime
    expect(old.award.status).toBe('pending');
    await f.receive(e); // redelivered after the switch
    await f.wheel.claimAnimation(CH, 'studio-A');
    await f.wheel.state(CH);
    expect(await f.credits()).toBe(0);
    await f.wheel.award(old.spin_id);
    expect(await f.credits()).toBe(1);
    expect(await f.tokens()).toBe(GAIN);
  });

  it('manual settlement on canonical: « credited by hand » closed (one payment path), cancel kept, paid → « already awarded »', async () => {
    const f = await canonical();
    await f.core.db.query(
      "update currencies set active = false where id = 'main'",
    );
    const a = (await f.receive(event()))!;
    const b = (await f.receive(event()))!;
    await f.core.db.query(
      "update currencies set active = true where id = 'main'",
    );
    expect(
      await f.code(
        f.wheel.settleByHand(a.spin_id, {
          status: 'manual',
          note: 'payé à la main',
        }),
      ),
    ).toBe('manual_settlement_disabled');
    expect(
      await f.wheel.settleByHand(a.spin_id, {
        status: 'cancelled',
        note: 'doublon',
      }),
    ).toMatchObject({ award: { status: 'cancelled' } });
    expect(await f.code(f.wheel.award(a.spin_id))).toBe('award_not_pending');
    await f.wheel.award(b.spin_id);
    expect(
      await f.code(
        f.wheel.settleByHand(b.spin_id, {
          status: 'cancelled',
          note: 'trop tard',
        }),
      ),
    ).toBe('already_awarded');
    expect(await f.credits()).toBe(1);
  });

  it('a zero gain is awarded without any Wallet movement; Studio tests and gifts never credit', async () => {
    const f = await canonical();
    await f.core.db.query(
      "update currencies set active = false where id = 'main'",
    );
    const z = (await f.receive(event()))!;
    await f.core.db.query(
      "update currencies set active = true where id = 'main'",
    );
    await f.core.db.query('update sw_spins set amount = 0 where spin_id = $1', [
      z.spin_id,
    ]);
    expect(await f.wheel.award(z.spin_id)).toMatchObject({
      award: { status: 'awarded', ref: null },
    });
    expect(await f.wheel.test(CH, { months: 3 })).toMatchObject({
      award: { status: 'test' },
    });
    expect(await f.receive(event({ type: 'gift_targeted' }))).toBeNull();
    expect(await count(f.core.db, 'wallet_transactions')).toBe(0);
  });

  it('cutover boundary: a sub that happened before the cutoff but reaches Core after it (outbox resumed) is never paid automatically', async () => {
    const f = await canonical();
    await f.core.db.query(
      `insert into wallet_imports (id, currency_id, source, cutoff, snapshot_sha256, accounts, total)
       values ('se-test', 'main', 'streamelements', '2026-10-19T19:00:00Z', $1, 0, 0)`,
      ['a'.repeat(64)],
    );
    // EventSub nanosecond timestamps, as Twitch sends them.
    const old = (await f.receive(
      event({ occurred_at: '2026-10-19T18:59:59.999999999Z' }),
    ))!;
    expect(old.award).toMatchObject({
      status: 'pending',
      note: 'avant la bascule : à rapprocher',
    });
    expect(await f.credits()).toBe(0);
    const late = event({ occurred_at: '2026-10-19T19:00:00.001000000Z' });
    expect((await f.receive(late))!.award.status).toBe('awarded');
    await f.receive(late); // redelivered: nothing more
    expect(await f.credits()).toBe(1);
    expect(await f.tokens()).toBe(GAIN);
  });

  it('the switch OFF: a real sub is still « ignored », nothing owed, nothing credited', async () => {
    const f = await canonical();
    await f.wheel.setEnabled(CH, false);
    expect(await f.receive(event())).toMatchObject({
      status: 'ignored',
      award: { status: 'none' },
    });
    expect(await count(f.core.db, 'wallet_transactions')).toBe(0);
  });
});
