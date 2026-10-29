import {
  RaffleCommand,
  type LabActor,
  type RaffleConfig,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { labEconomy } from '../src/economy/economy.js';
import { withBonbonsRewards } from '../src/event-shop/raffle-currency.js';
import {
  RaffleLabError409,
  RaffleLabService,
} from '../src/raffle-lab/raffle-lab-service.js';
import { DEFAULT_RAFFLE_CONFIG } from '../src/raffle-lab/rules.js';
import { setup } from './helpers.js';

// A Tombola rewarding in Bonbons (docs/HALLOWEEN.md): the Tombola's own draw, split and payout states; the `bonbons`
// currency credited to the event ledger once per round and winner; only while the event is open; every other currency
// exactly as before. Entering stays free.

const CH = '900100';
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
let seq = 0;

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-10-31T20:00:00Z'));
  const economy = withBonbonsRewards(labEconomy);
  const raffle = new RaffleLabService(
    core.db,
    core.clock,
    () => 0.42,
    undefined,
    economy,
  );
  const act = (command: Record<string, unknown>) =>
    raffle.act(CH, { actor: studio, command: RaffleCommand.parse(command) });
  const config = (patch: Partial<RaffleConfig>) =>
    act({
      action: 'config',
      config: {
        ...DEFAULT_RAFFLE_CONFIG,
        amount_mode: 'fixed',
        winners_mode: 'custom',
        full: { enabled: false, chance_pct: 1 },
        super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
        ...patch,
      },
    });
  const join = (v: string) =>
    raffle.join({
      channel_id: CH,
      viewer: { id: v, display_name: `V${v}` },
      idempotency_key: `ext-${v}-${++seq}`,
    });
  const after = async (ms: number) => {
    core.clock.advance(ms);
    await raffle.tick();
  };
  const bonbons = async (v: string) =>
    (await core.eventShop.viewerState(CH, v)).balance;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof RaffleLabError409) return e.code;
      return (e as Error).message;
    }
  };
  return { core, raffle, economy, act, config, join, after, bonbons, code };
}

describe('Tombola in Bonbons', () => {
  it('three winners, each credited once in Bonbons (the event ledger), the losers nothing', async () => {
    const t = await lab();
    await t.core.eventShop.updateSettings(CH, { enabled: true });
    await t.config({
      currency_id: 'bonbons',
      fixed_amount: 30,
      winners_custom: 3,
    });
    await t.act({ action: 'launch' });
    for (const v of ['9401', '9402', '9403', '9404']) await t.join(v);
    await t.after(62_000);
    const balances = await Promise.all(
      ['9401', '9402', '9403', '9404'].map(t.bonbons),
    );
    expect(balances.filter((b) => b === 10)).toHaveLength(3);
    expect(balances.filter((b) => b === 0)).toHaveLength(1);
    const rows = await t.core.db.query<{ kind: string; key: string }>(
      "select kind, key from event_ledger where kind = 'raffle'",
    );
    expect(rows).toHaveLength(3);
    // The Tombola's own record: three paid winners in Bonbons.
    const winners = await t.core.db.query<{
      payout_status: string;
      currency_id: string;
    }>('select payout_status, currency_id from lab_raffle_winners');
    expect(
      winners.every(
        (w) => w.payout_status === 'paid' && w.currency_id === 'bonbons',
      ),
    ).toBe(true);
  });

  it('a payout replayed (retry, second tick, restart) never credits twice', async () => {
    const t = await lab();
    await t.core.eventShop.updateSettings(CH, { enabled: true });
    await t.config({
      currency_id: 'bonbons',
      fixed_amount: 5,
      winners_custom: 1,
    });
    await t.act({ action: 'launch' });
    await t.join('9411');
    await t.after(62_000);
    await t.after(1_000);
    const raffleId = (
      await t.core.db.query<{ raffle_id: string }>(
        'select raffle_id from lab_raffle_winners',
      )
    )[0]!.raffle_id;
    // The same credit asked again through the port: the first one comes back, nothing new.
    const again = await t.core.db.tx((q) =>
      t.economy.move(q, t.core.clock.now(), {
        channelId: CH,
        viewerId: '9411',
        currency: 'bonbons',
        amount: 5,
        kind: 'raffle_win',
        moduleId: 'raffle',
        raffleId,
      }),
    );
    expect(again.balanceAfter).toBe(5);
    expect(await t.bonbons('9411')).toBe(5);
    expect(
      (await t.core.db.tx((q) => t.economy.raffleWins(q, raffleId))).filter(
        (w) => w.currency === 'bonbons',
      ),
    ).toHaveLength(1);
  });

  it('event closed: a round cannot be set in Bonbons; Jetons rounds exactly as before', async () => {
    const t = await lab();
    expect(
      await t.code(
        t.config({
          currency_id: 'bonbons',
          fixed_amount: 5,
          winners_custom: 1,
        }),
      ),
    ).not.toBe('ok');
    await t.config({
      currency_id: 'tokens',
      fixed_amount: 700,
      winners_custom: 1,
    });
    await t.act({ action: 'launch' });
    await t.join('9421');
    await t.after(62_000);
    const w = (
      await t.core.db.query<{
        payout_status: string;
        currency_id: string;
        amount: string;
      }>('select payout_status, currency_id, amount from lab_raffle_winners')
    )[0]!;
    expect(w).toMatchObject({ payout_status: 'paid', currency_id: 'tokens' });
    expect(await t.bonbons('9421')).toBe(0);
  });
});
