import {
  RaffleCommand,
  type LabActor,
  type RaffleConfig,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import {
  RaffleLabError409,
  RaffleLabService,
} from '../src/raffle-lab/raffle-lab-service.js';
import { DEFAULT_RAFFLE_CONFIG } from '../src/raffle-lab/rules.js';
import { count, setup } from './helpers.js';

// Phase 2 lot 3: Tombola V2 on the CANONICAL Core Wallet (Jetons = currency main), rules unchanged: one credit per
// winner and round whatever the replays (ticks, restart, retry, lost answer), nothing kept by a failed draw, winnings
// read back from the Core ledger (history, round card, moderation), credits and other Lab currencies refused before
// any round is announced. Test databases only.

const CH = '901200';
const T0 = new Date('2026-10-19T18:00:00Z');
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const QUIET: Partial<RaffleConfig> = {
  amount_mode: 'fixed',
  fixed_amount: 20_000,
  winners_mode: 'custom',
  winners_custom: 2,
  full: { enabled: false, chance_pct: 1 },
  super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
};
let seq = 0;

async function canonical() {
  const core = await setup();
  core.clock.set(T0);
  const port = coreWalletEconomy(core.wallet.wallet);
  const random = () => 0.42;
  const service = (db: Db = core.db) =>
    new RaffleLabService(db, core.clock, random, undefined, port);
  const raffle = service();
  const m = new LabModerationService(
    core.db,
    core.clock,
    core.ttsLab,
    core.soundLab,
    core.bonkLab,
    raffle,
    port,
  );
  const act = (command: Record<string, unknown>, r = raffle) =>
    r.act(CH, { actor: studio, command: RaffleCommand.parse(command) });
  const config = (patch: Partial<RaffleConfig> = {}) =>
    act({
      action: 'config',
      config: { ...DEFAULT_RAFFLE_CONFIG, ...QUIET, ...patch },
    });
  const join = (v: string) =>
    raffle.join({
      channel_id: CH,
      viewer: { id: v, display_name: `V${v}` },
      idempotency_key: `ext-${v}-${++seq}`,
    }) as Promise<{
      raffle_id: string;
    }>;
  const after = async (ms: number, r = raffle) => {
    core.clock.advance(ms);
    await r.tick();
  };
  const tokens = async (v: string) =>
    (await core.wallet.wallet.getWallet(v))?.balance ?? 0;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof RaffleLabError409) return e.code;
      throw e;
    }
  };
  const wins = () =>
    count(core.db, "wallet_transactions where source = 'raffle'");
  return {
    core,
    port,
    service,
    raffle,
    m,
    act,
    config,
    join,
    after,
    tokens,
    code,
    wins,
  };
}
/** Core ledger = balances, and the Lab wallet never moved. */
async function consistent(db: Db) {
  expect(
    await count(
      db,
      `wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
         where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`,
    ),
  ).toBe(0);
  expect(await count(db, 'lab_wallet_ledger')).toBe(0);
}

describe('Tombola V2 on the canonical Wallet', () => {
  it('several participants: each winner (blank wallet) credited exactly its share once; card, history and D4 read the Core ledger', async () => {
    const f = await canonical();
    await f.config();
    await f.act({ action: 'launch' });
    let raffleId = '';
    for (const v of ['901201', '901202', '901203', '901204'])
      raffleId = (await f.join(v)).raffle_id;
    await f.after(62_000);
    const card = await f.raffle.round(CH, raffleId);
    expect(card.winners).toHaveLength(2);
    for (const w of card.winners) {
      expect(w).toMatchObject({
        payout_status: 'paid',
        expected: 10_000,
        credited: 10_000,
      });
      expect(w.ledger_id).toBeTypeOf('number');
      expect(await f.tokens(w.viewer_id)).toBe(10_000);
    }
    expect(await f.wins()).toBe(2);
    const history = (await f.raffle.history(CH))[0]!;
    expect(history.winners.every((w) => w.payout_status === 'paid')).toBe(true);
    const d4 = (await f.m.ledger(CH, { viewer: card.winners[0]!.viewer_id }))
      .items[0]!;
    expect(d4).toMatchObject({
      kind: 'raffle_win',
      operation_type: 'raffle_win',
      raffle_id: raffleId,
      amount: 10_000,
      currency: 'tokens',
    });
    // Losers untouched: no Core wallet movement at all.
    const losers = ['901201', '901202', '901203', '901204'].filter(
      (v) => !card.winners.some((w) => w.viewer_id === v),
    );
    for (const v of losers) expect(await f.tokens(v)).toBe(0);
    await consistent(f.core.db);
  });

  it('no participant: no winner, no credit, outcome « no_participants », states unchanged', async () => {
    const f = await canonical();
    await f.config();
    await f.act({ action: 'launch' });
    await f.after(62_000);
    await f.after(3_000 + 1_500);
    expect((await f.raffle.snapshot(CH)).round).toMatchObject({
      outcome: 'no_participants',
      participants: 0,
    });
    await f.after(5_000);
    expect((await f.raffle.snapshot(CH)).round).toBeNull();
    expect(await count(f.core.db, 'wallet_transactions')).toBe(0);
  });

  it('replays never pay twice: extra ticks, a restarted Core, a retry_payout, a replayed moderation retry', async () => {
    const f = await canonical();
    await f.config({ winners_custom: 1 });
    await f.act({ action: 'launch' });
    const { raffle_id } = await f.join('901211');
    await f.after(62_000);
    await f.after(1_000);
    const restarted = f.service();
    await restarted.tick();
    await f.raffle.tick();
    expect(
      await f.code(
        f.act({ action: 'retry_payout', raffle_id, viewer_id: '901211' }),
      ),
    ).toBe('already_paid');
    expect(
      await f.code(
        f.act(
          { action: 'retry_payout', raffle_id, viewer_id: '901211' },
          restarted,
        ),
      ),
    ).toBe('already_paid');
    expect(await f.tokens('901211')).toBe(20_000);
    expect(await f.wins()).toBe(1);
    await consistent(f.core.db);
  });

  it('a crash before the credit commits nothing (no winner, no money); the next tick draws and pays once', async () => {
    const f = await canonical();
    await f.config({ winners_custom: 1 });
    await f.act({ action: 'launch' });
    await f.join('901221');
    let armed = true;
    const crashing: Db = {
      ...f.core.db,
      tx: (fn) =>
        f.core.db.tx((q) =>
          fn({
            query: (sql, params) => {
              if (armed && /insert into wallet_transactions/.test(sql))
                throw new Error('connection lost');
              return q.query(sql, params);
            },
          }),
        ),
    };
    await expect(f.after(62_000, f.service(crashing))).rejects.toThrow(
      'connection lost',
    );
    expect(await count(f.core.db, 'lab_raffle_winners')).toBe(0);
    expect(await f.tokens('901221')).toBe(0);
    armed = false;
    await f.after(0);
    expect(await f.tokens('901221')).toBe(20_000);
    expect(await f.wins()).toBe(1);
    await consistent(f.core.db);
  });

  it('a draw committed whose answer is lost: the restarted Core never pays it again', async () => {
    const f = await canonical();
    await f.config({ winners_custom: 1 });
    await f.act({ action: 'launch' });
    await f.join('901231');
    const lost: Db = {
      ...f.core.db,
      tx: async (fn) => {
        const r = await f.core.db.tx(fn);
        if ((await count(f.core.db, 'lab_raffle_winners')) > 0)
          throw new Error('connection reset after COMMIT');
        return r;
      },
    };
    await expect(f.after(62_000, f.service(lost))).rejects.toThrow(
      'after COMMIT',
    );
    const restarted = f.service();
    await restarted.tick();
    await f.after(5_000, restarted);
    expect(await f.tokens('901231')).toBe(20_000);
    expect(await f.wins()).toBe(1);
  });

  it('Jetons unavailable at the draw: a visible failed payout, no credit; retried once available — paid once', async () => {
    const f = await canonical();
    await f.config({ winners_custom: 1 });
    await f.act({ action: 'launch' });
    const { raffle_id } = await f.join('901241');
    await f.core.db.query(
      "update currencies set active = false where id = 'main'",
    );
    await f.after(62_000);
    let card = await f.raffle.round(CH, raffle_id);
    expect(card.winners[0]).toMatchObject({
      payout_status: 'failed',
      ledger_id: null,
      credited: 0,
    });
    expect(await f.tokens('901241')).toBe(0);
    await f.core.db.query(
      "update currencies set active = true where id = 'main'",
    );
    await f.act({ action: 'retry_payout', raffle_id, viewer_id: '901241' });
    expect(
      await f.code(
        f.act({ action: 'retry_payout', raffle_id, viewer_id: '901241' }),
      ),
    ).toBe('already_paid');
    card = await f.raffle.round(CH, raffle_id);
    expect(card.winners[0]).toMatchObject({
      payout_status: 'paid',
      credited: 20_000,
      attempts: 2,
    });
    expect(await f.tokens('901241')).toBe(20_000);
    await consistent(f.core.db);
  });

  it('credits and other Lab currencies are refused before any round (configuration, SUPER), never converted; giveaways unaffected', async () => {
    const f = await canonical();
    for (const currency_id of ['credits_tts', 'credits_soundboard'])
      expect(await f.code(f.config({ currency_id }))).toBe('invalid_config');
    expect(
      await f.code(
        f.config({
          super: { ...DEFAULT_RAFFLE_CONFIG.super, currency_id: 'credits_tts' },
        }),
      ),
    ).toBe('invalid_config');
    // A configuration saved before the switch (Lab) cannot open a round the Core Wallet would not pay.
    await f.core.db.query(
      `insert into lab_raffle_settings (channel_id, config, updated_at, updated_by) values ($1, $2, now(), 'test')
       on conflict (channel_id) do update set config = excluded.config`,
      [
        CH,
        JSON.stringify({
          ...DEFAULT_RAFFLE_CONFIG,
          ...QUIET,
          currency_id: 'credits_tts',
        }),
      ],
    );
    expect(await f.code(f.act({ action: 'launch' }))).toBe(
      'currency_unavailable',
    );
    expect(await count(f.core.db, 'lab_raffles')).toBe(0);
    // A giveaway pays nothing in any currency: unchanged.
    await f.config({
      amount_mode: 'giveaway',
      prize: 'Lot',
      winners_custom: 1,
    });
    await f.act({ action: 'launch' });
    await f.join('901251');
    await f.after(62_000);
    expect(await count(f.core.db, 'wallet_transactions')).toBe(0);
    expect(await count(f.core.db, 'lab_wallet_ledger')).toBe(0);
  });

  it('moderation reads (viewer card) show the Core balance of a winner', async () => {
    const f = await canonical();
    await f.config({ winners_custom: 1 });
    await f.act({ action: 'launch' });
    await f.join('901261');
    await f.after(62_000);
    expect(await f.m.wallet(CH, '901261')).toEqual({
      tokens: 20_000,
      credits_tts: null,
      credits_soundboard: null,
    });
  });
});
