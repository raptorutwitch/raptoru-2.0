import { describe, expect, it } from 'vitest';
import { generateCoffre } from '../src/casino/coffre.js';
import { floatFrom, seededRng, type IntRng } from '../src/casino/rng.js';
import { settleRoulette } from '../src/casino/roulette.js';
import {
  CasinoError,
  type CasinoService,
  shareText,
} from '../src/casino/service.js';
import { evaluate, STRIPS, windowAt } from '../src/casino/slot.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { studioCockpitRoutes } from '../src/http/studio-cockpit-routes.js';
import { editWallet, setBlock } from '../src/lab-moderation/store.js';
import { CasinoService as Service } from '../src/casino/service.js';
import { openCanonicalLive } from './live.js';
import { setup, type TestCore } from './helpers.js';

// Casino (docs/CASINO.md) — the Core decides, pays once, never below 0, refuses before any payment, and the extension
// only animates. PGlite: one connection; the two-pool races are in casino.integration.test.ts (real PostgreSQL).

const CH = '83603689';
const ALICE = { id: '9001', display_name: 'Alice' };
const BOB = { id: '9002', display_name: 'Bob' };

async function lab(tokens = 100_000) {
  const core = await setup();
  for (const v of [ALICE, BOB])
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      v.id,
      'set',
      { tokens },
      'test',
    );
  await core.moduleSettings.set(CH, 'casino.open', 1, 'test');
  return core;
}
/** The Lab's simulated live (Studio › Simulation › « Simuler début »). */
async function liveOn(core: TestCore) {
  await core.db.query(
    `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
     values (gen_random_uuid(), $1, $2, 'simulated', 'test')`,
    [CH, core.clock.now()],
  );
}
async function liveOff(core: TestCore) {
  await core.db.query(
    'update lab_stream_sessions set ended_at = $2 where channel_id = $1 and ended_at is null',
    [CH, core.clock.now()],
  );
}
const tokens = async (core: TestCore, id = ALICE.id) =>
  (await core.economy.balances(core.db, CH, id)).tokens;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof CasinoError ? e.code : `throw:${(e as Error).message}`;
  }
};
/** Forced draws first, then a reproducible generator (the Coffre's floats come from the same source). */
function scripted(first: number[], seed = 1): IntRng {
  const rest = seededRng(seed);
  const queue = first.slice();
  return { int: (n) => (queue.length ? queue.shift()! % n : rest.int(n)) };
}
/** Stops showing exactly k BONUS (reels 0…k-1, middle row) and none elsewhere. */
function bonusStops(k: number) {
  return STRIPS.map((s, r) => {
    const b = s.indexOf('bonus');
    return r < k ? (b - 1 + s.length) % s.length : (b + 2) % s.length;
  });
}
const rounds = async (core: TestCore) =>
  (
    await core.db.query<{ n: number }>(
      'select count(*)::int as n from casino_rounds',
    )
  )[0]!.n;

describe('casino — refusals before any payment', () => {
  it('closed by default, offline, wrong game, blocked bets: nothing debited, nothing recorded', async () => {
    const core = await setup();
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      ALICE.id,
      'set',
      { tokens: 5000 },
      'test',
    );
    const c = core.casino;
    expect(
      await code(c.spinSlot(CH, ALICE, { key: 'k-closed-1', bet: 100 })),
    ).toBe('casino_closed');
    await core.moduleSettings.set(CH, 'casino.open', 1, 'test');
    expect(
      await code(c.spinSlot(CH, ALICE, { key: 'k-offline-1', bet: 100 })),
    ).toBe('stream_offline');
    await liveOn(core);
    await core.moduleSettings.set(CH, 'casino.roulette_open', 0, 'test');
    expect(
      await code(
        c.spinRoulette(CH, ALICE, { key: 'k-game-01', bets: { red: 100 } }),
      ),
    ).toBe('game_closed');
    for (const [bet, why] of [
      [19, 'below_min'],
      [10_020, 'above_max'],
      [-100, 'below_min'],
      [20.5, 'invalid_bet'],
      ['100', 'invalid_bet'],
      [null, 'invalid_bet'],
      [Number.NaN, 'invalid_bet'],
      [1e300, 'invalid_bet'],
    ] as const)
      expect(
        await code(
          c.spinSlot(CH, ALICE, {
            key: `k-bad-${String(bet)}`.replace(/[^A-Za-z0-9_:-]/g, '_'),
            bet,
          }),
        ),
      ).toBe(why);
    expect(await code(c.spinSlot(CH, ALICE, { key: 'short', bet: 100 }))).toBe(
      'idempotency_key_required',
    );
    expect(
      await code(c.spinSlot(CH, ALICE, { key: 'k-poor-001', bet: 6000 })),
    ).toBe('insufficient_tokens');
    expect(await tokens(core)).toBe(5000);
    expect(await rounds(core)).toBe(0);
    // Studio sees what was refused (counts and the last ones)
    const admin = await c.adminState(CH);
    expect(admin.refusals.counts).toMatchObject({
      casino_closed: 1,
      stream_offline: 1,
      game_closed: 1,
      insufficient_tokens: 1,
    });
  });

  it('roulette: only the mat, multiples of 20, the per-spin maximum, never a possible win above the cap', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    for (const [bets, why] of [
      [{}, 'empty'],
      [[], 'empty'],
      [JSON.parse('{"__proto__": 20}'), 'unknown_spot'],
      [{ constructor: 20 }, 'unknown_spot'],
      [{ n37: 20 }, 'unknown_spot'],
      [{ red: 30 }, 'not_multiple'],
      [{ red: 10 }, 'invalid_amount'],
      [{ red: '20' }, 'invalid_amount'],
      [{ red: 60_000, black: 60_000 }, 'above_max'],
      [{ n17: 40_000 }, 'above_max_win'], // 36 × 40 000 > 1 000 000
    ] as const)
      expect(
        await code(
          c.spinRoulette(CH, ALICE, {
            key: `r-bad-${JSON.stringify(bets)}`.replace(
              /[^A-Za-z0-9_:-]/g,
              '_',
            ),
            bets,
          }),
        ),
      ).toBe(why);
    expect(await tokens(core)).toBe(100_000);
    expect(await rounds(core)).toBe(0);
  });
});

describe('casino — one intent, one payment', () => {
  it('slot: debit the bet, credit the engine’s win, record the round; the same key replays it, never a second payment', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    const stops = [3, 7, 11, 19, 25];
    c.rng = scripted(stops);
    const r = await c.spinSlot(CH, ALICE, { key: 'slot-intent-1', bet: 100 });
    const ev = evaluate(windowAt(stops), 100);
    expect(r.round.outcome).toMatchObject({ stops, line_win: ev.total });
    expect(r.round.payout).toBe(
      ev.total +
        ((r.round.outcome as { coffre: { win: number } | null }).coffre?.win ??
          0),
    );
    expect(r.balance).toBe(100_000 - 100 + r.round.payout);
    expect(await tokens(core)).toBe(r.balance);
    // Resent (lost answer, double click): the same round, the same balance
    c.rng = scripted([0, 0, 0, 0, 0]);
    const again = await c.spinSlot(CH, ALICE, {
      key: 'slot-intent-1',
      bet: 100,
    });
    expect(again.replayed).toBe(true);
    expect(again.round.round_id).toBe(r.round.round_id);
    expect(await tokens(core)).toBe(r.balance);
    expect(await rounds(core)).toBe(1);
    // The same key for another bet: refused, nothing moves
    expect(
      await code(c.spinSlot(CH, ALICE, { key: 'slot-intent-1', bet: 200 })),
    ).toBe('idempotency_conflict');
    // Ledger: exactly one bet and one win for this round (Lab ledger, keyed by the round)
    const moves = await core.db.query<{ amount: number }>(
      `select amount from lab_wallet_ledger where viewer_id = $1 and module_id = 'casino' order by id`,
      [ALICE.id],
    );
    expect(moves.map((m) => Number(m.amount))).toEqual(
      r.round.payout ? [-100, r.round.payout] : [-100],
    );
  });

  it('ten clicks at once with the same key: one round; ten intents with money for three: exactly three, never below 0', async () => {
    const core = await lab(300);
    await liveOn(core);
    const c = core.casino;
    c.rng = scripted([], 5);
    // all losing spins: stops chosen to pay nothing (the 5 reels on positions without a line win)
    const losing = (() => {
      const rng = seededRng(77);
      for (;;) {
        const s = STRIPS.map((x) => rng.int(x.length));
        const ev = evaluate(windowAt(s), 100);
        if (ev.total === 0 && ev.scatter.count < 3) return s;
      }
    })();
    let cnt = 0;
    c.rng = { int: (n) => losing[cnt++ % 5]! % n };
    const same = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        c.spinSlot(CH, ALICE, { key: 'same-click', bet: 100 }),
      ),
    );
    expect(same.filter((x) => x.status === 'fulfilled').length).toBe(10);
    expect(
      new Set(
        same.map(
          (x) =>
            (x as PromiseFulfilledResult<{ round: { round_id: string } }>).value
              .round.round_id,
        ),
      ).size,
    ).toBe(1);
    expect(await tokens(core)).toBe(200);
    const many = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        c.spinSlot(CH, ALICE, { key: `intent-${i}-xyz`, bet: 100 }),
      ),
    );
    expect(many.filter((x) => x.status === 'fulfilled').length).toBe(2);
    expect(await tokens(core)).toBe(0);
    expect(await rounds(core)).toBe(3);
  });

  it('roulette: the gross of the engine for the drawn pocket, the ball’s seed kept for the spectators', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    const bets = { red: 1000, n17: 100, d2: 200 };
    c.rng = scripted([8]); // pocket 8 = number 17 (black)
    const r = await c.spinRoulette(CH, ALICE, { key: 'roul-intent-1', bets });
    const o = r.round.outcome as {
      number: number;
      pocket: number;
      seed: number;
    };
    expect(o.number).toBe(17);
    expect(r.round.payout).toBe(settleRoulette(bets, 17).gross);
    expect(r.balance).toBe(100_000 - 1300 + r.round.payout);
    expect(Number.isInteger(o.seed)).toBe(true);
  });
});

describe('casino — roulette ALL-IN (the whole balance, above the per-spin maximum)', () => {
  const setTokens = (core: TestCore, tokens: number, id = ALICE.id) =>
    editWallet(core.db, core.clock.now(), CH, id, 'set', { tokens }, 'test');
  const allInOn = (core: TestCore, cap = 36_000_000) =>
    core.moduleSettings.set(CH, 'casino.roulette_all_in_max_win', cap, 'test');
  const RED_POCKET = 1; // ORDER[1] = 32, red
  const BLACK_POCKET = 2; // ORDER[2] = 15, black

  it('off by default: ALL-IN stays within the per-spin maximum (Production unchanged)', async () => {
    const core = await lab(1_000_000);
    await liveOn(core);
    const c = core.casino;
    expect((await c.limits(core.db, CH)).roulette_all_in_max_win).toBe(0);
    expect(
      await code(
        c.spinRoulette(CH, ALICE, {
          key: 'allin-off-1',
          bets: { red: 1_000_000 },
        }),
      ),
    ).toBe('above_max');
    c.rng = scripted([RED_POCKET]);
    const r = await c.spinRoulette(CH, ALICE, {
      key: 'allin-off-2',
      bets: { red: 100_000 },
    });
    expect(r.round.payout).toBe(200_000);
    expect(await tokens(core)).toBe(1_100_000);
  });

  it('on: the whole balance passes the maximum and is paid in full; ordinary bets keep the maximum', async () => {
    const core = await lab(1_000_000);
    await liveOn(core);
    await allInOn(core);
    const c = core.casino;
    // ordinary bets above the maximum: refused, nothing debited
    for (const bets of [{ red: 500_000 }, { red: 999_980 }, { red: 120_000 }])
      expect(
        await code(
          c.spinRoulette(CH, ALICE, { key: `allin-ord-${bets.red}`, bets }),
        ),
      ).toBe('above_max');
    expect(await rounds(core)).toBe(0);
    // ALL-IN on red, won: 2 000 000 paid in full (the ordinary 1 000 000 cap does not apply)
    c.rng = scripted([RED_POCKET]);
    const won = await c.spinRoulette(CH, ALICE, {
      key: 'allin-win',
      bets: { red: 1_000_000 },
    });
    expect(won.round).toMatchObject({
      bet: 1_000_000,
      raw_payout: 2_000_000,
      payout: 2_000_000,
      capped: false,
    });
    expect(await tokens(core)).toBe(2_000_000);
    // ALL-IN split over several spots (the whole balance), lost
    c.rng = scripted([BLACK_POCKET]);
    const lost = await c.spinRoulette(CH, ALICE, {
      key: 'allin-lost',
      bets: { red: 1_500_000, d3: 500_000 },
    });
    expect(lost.round.payout).toBe(0);
    expect(await tokens(core)).toBe(0);
  });

  it('on: within the ordinary limits, the whole balance on a number (36 ×) with the ALL-IN cap', async () => {
    const core = await lab(100_000);
    await liveOn(core);
    const c = core.casino;
    expect(
      await code(
        c.spinRoulette(CH, ALICE, {
          key: 'allin-n-off',
          bets: { n32: 100_000 },
        }),
      ),
    ).toBe('above_max_win');
    await allInOn(core);
    c.rng = scripted([RED_POCKET]); // 32
    const r = await c.spinRoulette(CH, ALICE, {
      key: 'allin-n-on',
      bets: { n32: 100_000 },
    });
    expect(r.round.payout).toBe(3_600_000);
    expect(await tokens(core)).toBe(3_600_000);
  });

  it('on: odd balances (whole bets of 20), a possible win above the ALL-IN cap refused before the draw, never reduced', async () => {
    const core = await lab(1_000_010);
    await liveOn(core);
    await allInOn(core);
    const c = core.casino;
    // 1 000 010 → ALL-IN = 1 000 000 (10 stay)
    c.rng = scripted([BLACK_POCKET]);
    await c.spinRoulette(CH, ALICE, {
      key: 'allin-odd',
      bets: { red: 1_000_000 },
    });
    expect(await tokens(core)).toBe(10);
    // 2 000 000 on one number could pay 72 000 000 > 36 000 000: refused, nothing moves
    await setTokens(core, 2_000_000);
    expect(
      await code(
        c.spinRoulette(CH, ALICE, {
          key: 'allin-big-n',
          bets: { n7: 2_000_000 },
        }),
      ),
    ).toBe('above_max_win');
    expect(await tokens(core)).toBe(2_000_000);
  });

  it('a very large balance: within the integer columns and the wallet, or refused before any payment', async () => {
    const core = await lab(500_000_000);
    await liveOn(core);
    await allInOn(core, 2_000_000_000);
    const c = core.casino;
    c.rng = scripted([RED_POCKET]);
    const r = await c.spinRoulette(CH, ALICE, {
      key: 'allin-huge',
      bets: { red: 500_000_000 },
    });
    expect(r.round.payout).toBe(1_000_000_000);
    expect(await tokens(core)).toBe(1_000_000_000);
    // the Lab wallet holds at most 1 000 000 000: a win that could pass it is refused before the draw
    expect(
      await code(
        c.spinRoulette(CH, ALICE, {
          key: 'allin-huge-2',
          bets: { red: 1_000_000_000 },
        }),
      ),
    ).toBe('balance_cap');
    expect(await tokens(core)).toBe(1_000_000_000);
    // the setting itself never goes past the integer bound
    expect(
      await code(
        core.moduleSettings.set(
          CH,
          'casino.roulette_all_in_max_win',
          3_000_000_000,
          'test',
        ),
      ),
    ).not.toBe('ok');
  });

  it('double clicks and two tabs: one ALL-IN, never below 0', async () => {
    const core = await lab(1_000_000);
    await liveOn(core);
    await allInOn(core);
    const c = core.casino;
    c.rng = scripted([BLACK_POCKET, BLACK_POCKET, BLACK_POCKET]);
    const same = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        c.spinRoulette(CH, ALICE, {
          key: 'allin-same',
          bets: { red: 1_000_000 },
        }),
      ),
    );
    expect(same.every((x) => x.status === 'fulfilled')).toBe(true);
    expect(await rounds(core)).toBe(1);
    await setTokens(core, 1_000_000);
    const tabs = await Promise.all(
      ['allin-tab-1', 'allin-tab-2', 'allin-tab-3'].map((key) =>
        code(c.spinRoulette(CH, ALICE, { key, bets: { red: 1_000_000 } })),
      ),
    );
    expect(tabs.filter((x) => x === 'ok')).toHaveLength(1);
    expect(
      tabs
        .filter((x) => x !== 'ok')
        .every((x) => x === 'insufficient_tokens' || x === 'above_max'),
    ).toBe(true);
    expect(await tokens(core)).toBe(0);
    expect(await rounds(core)).toBe(2);
  });
});

describe('casino — the Coffre, the cap, the announcements', () => {
  it('3 BONUS: the Coffre drawn whole with the spin and paid with it (= the engine); watching changes nothing', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    c.rng = scripted(bonusStops(3), 4242);
    const before = await tokens(core);
    const r = await c.spinSlot(CH, ALICE, { key: 'coffre-intent-1', bet: 100 });
    const o = r.round.outcome as {
      coffre: {
        total: number;
        win: number;
        k: number;
        start: { cell: number }[];
      };
      line_win: number;
    };
    expect(o.coffre.k).toBe(3);
    expect(o.coffre.start.map((x) => x.cell).sort()).toEqual([1, 4, 7]);
    const expected = generateCoffre(3, floatFrom(seededRng(4242)), [1, 4, 7]);
    expect(o.coffre.total).toBe(expected.total);
    expect(o.coffre.win).toBe(Math.floor(expected.total * 100));
    expect(await tokens(core)).toBe(before - 100 + o.line_win + o.coffre.win);
    // the player watches (any pace, any device): progress only, never a Jeton
    const credited = await tokens(core);
    expect((await c.viewerState(CH, ALICE)).me?.resume).toMatchObject({
      round_id: r.round.round_id,
    });
    await c.progress(CH, ALICE, { round_id: r.round.round_id, step: 2 });
    await c.progress(CH, ALICE, { round_id: r.round.round_id, step: 1 }); // never backwards
    expect(
      (
        (await c.round(CH, r.round.round_id, ALICE)).round as {
          progress_step: number;
        }
      ).progress_step,
    ).toBe(2);
    expect(
      await code(c.progress(CH, BOB, { round_id: r.round.round_id, step: 3 })),
    ).toBe('round_not_found');
    // the live ends during the Coffre: still readable, still resumable, still closable; nothing moves
    await liveOff(core);
    expect((await c.viewerState(CH, ALICE)).me?.resume).toMatchObject({
      round_id: r.round.round_id,
    });
    await c.progress(CH, ALICE, {
      round_id: r.round.round_id,
      step: 99 - 40,
      done: true,
    });
    expect((await c.viewerState(CH, ALICE)).me?.resume).toBeNull();
    expect(await tokens(core)).toBe(credited);
  });

  it('the win cap: shown as such (raw and capped), never above; a GRAND is announced once, then 2 min of silence', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    // a seed whose Coffre fills the grid from these cells
    let seed = 1;
    while (!generateCoffre(3, floatFrom(seededRng(seed)), [1, 4, 7]).full)
      seed++;
    await core.moduleSettings.set(CH, 'casino.max_win', 50_000, 'test');
    c.rng = scripted(bonusStops(3), seed);
    const r = await c.spinSlot(CH, ALICE, { key: 'grand-intent-1', bet: 100 });
    expect(r.round.raw_payout).toBeGreaterThan(100_000); // GRAND ×1 000 at 100
    expect(r.round.payout).toBe(50_000);
    expect(r.round.capped).toBe(true);
    expect(await tokens(core)).toBe(100_000 - 100 + 50_000);
    const steps = await core.db.query<{ text: string; origin: string }>(
      `select params->>'text' as text, origin from cmd_steps where origin = 'module:casino'`,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]!.text).toMatch(/GRAND/);
    // a second GRAND right after: paid, not announced (2 min)
    c.rng = scripted(bonusStops(3), seed);
    await c.spinSlot(CH, BOB, { key: 'grand-intent-2', bet: 100 });
    expect(
      await core.db.query(
        `select 1 from cmd_steps where origin = 'module:casino'`,
      ),
    ).toHaveLength(1);
  });
});

describe('casino — shares, history, spectators, rights', () => {
  it('a share: the viewer’s own round, once, the Core’s text; per viewer and channel pace', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    c.rng = scripted([3, 7, 11, 19, 25]);
    const a1 = await c.spinSlot(CH, ALICE, { key: 'share-1-xx', bet: 100 });
    const a2 = await c.spinSlot(CH, ALICE, { key: 'share-2-xx', bet: 100 });
    const b1 = await c.spinSlot(CH, BOB, { key: 'share-3-xx', bet: 100 });
    expect(await code(c.share(CH, BOB, a1.round.round_id))).toBe(
      'round_not_found',
    );
    const s = await c.share(CH, ALICE, a1.round.round_id);
    expect(s.text).toBe(
      shareText({ ...a1.round, viewer_name: 'Alice' } as Parameters<
        typeof shareText
      >[0]),
    );
    expect((await c.share(CH, ALICE, a1.round.round_id)).already).toBe(true);
    expect(await code(c.share(CH, ALICE, a2.round.round_id))).toBe(
      'share_cooldown',
    );
    expect(await code(c.share(CH, BOB, b1.round.round_id))).toBe('share_busy'); // 30 s on the channel
    core.clock.set(new Date(core.clock.now().getTime() + 31_000));
    await c.share(CH, BOB, b1.round.round_id);
    const shares = await core.db.query<{ text: string }>(
      `select params->>'text' as text from cmd_steps where origin = 'module:casino' order by created_at`,
    );
    expect(shares).toHaveLength(2);
  });

  it('a share only while the casino plays: closed, offline, blocked, too old, malformed ids — nothing posted', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    c.rng = scripted([3, 7, 11, 19, 25]);
    const r = await c.spinSlot(CH, ALICE, { key: 'gate-1-xxx', bet: 100 });
    const id = r.round.round_id;
    expect(
      await code(c.share(CH, ALICE, 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')),
    ).toBe('invalid_round');
    expect(
      await code(c.share(CH, ALICE, '------------------------------------')),
    ).toBe('invalid_round');
    await core.moduleSettings.set(CH, 'casino.open', 0, 'test');
    expect(await code(c.share(CH, ALICE, id))).toBe('casino_closed');
    await core.moduleSettings.set(CH, 'casino.open', 1, 'test');
    await liveOff(core);
    expect(await code(c.share(CH, ALICE, id))).toBe('stream_offline');
    await liveOn(core);
    await setBlock(core.db, core.clock.now(), {
      channelId: CH,
      viewerId: ALICE.id,
      module: 'all',
      until: null,
      reason: 'test',
      actor: 'test',
    });
    expect(await code(c.share(CH, ALICE, id))).toBe('viewer_blocked');
    await core.db.query('delete from lab_viewer_blocks where viewer_id = $1', [
      ALICE.id,
    ]);
    core.clock.set(new Date(core.clock.now().getTime() + 86_400_001));
    expect(await code(c.share(CH, ALICE, id))).toBe('share_too_old');
    const posted = await core.db.query(
      `select 1 from cmd_steps where origin = 'module:casino'`,
    );
    expect(posted).toHaveLength(0);
  });

  it('history (own), a round (public), the rounds in progress (no result before its animation)', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    c.rng = scripted([3, 7, 11, 19, 25]);
    const r = await c.spinSlot(CH, ALICE, { key: 'hist-1-xxx', bet: 100 });
    c.rng = scripted([0]);
    await c.spinRoulette(CH, BOB, { key: 'hist-2-xxx', bets: { red: 20 } });
    const h = await c.history(CH, ALICE, {});
    expect(h.rounds.map((x) => x.round_id)).toEqual([r.round.round_id]);
    expect(h.stats).toMatchObject({
      rounds: 1,
      staked: 100,
      won: r.round.payout,
    });
    const st = await c.viewerState(CH, null);
    expect(st.me).toBeNull();
    // the players in a game now (spectators): who, which game — never a result
    expect(st.players.map((x) => x.name).sort()).toEqual(['Alice', 'Bob']);
    expect(JSON.stringify(st.players)).not.toContain('payout');
    core.clock.set(new Date(core.clock.now().getTime() + 10 * 60_000));
    expect((await c.viewerState(CH, null)).players).toEqual([]);
    // another viewer's round: whole once its end is public (here: long over)
    expect((await c.round(CH, r.round.round_id, BOB)).round).toMatchObject({
      mine: false,
      viewer_name: 'Alice',
      payout: r.round.payout,
    });
  });

  it('Studio’s cockpit never reaches a spin, a progress, a share, a viewer’s state or history; the admin reads only', async () => {
    const calls: string[] = [];
    const routes = studioCockpitRoutes(
      async <T>(p: string) => (calls.push(p), {} as T),
      CH,
    );
    const get = routes.find((x) => x.method === 'GET')!;
    const post = routes.find((x) => x.method === 'POST')!;
    const url = (p: string) => new URL(`http://c/v1/studio/cockpit/${p}`);
    for (const p of [
      `casino/${CH}/slot/spin`,
      `casino/${CH}/roulette/spin`,
      `casino/${CH}/progress`,
      `casino/${CH}/share`,
    ])
      await expect(
        (async () =>
          post.handle({
            params: [p],
            body: { viewer: ALICE, key: 'kkkkkkkk', bet: 100 },
            url: url(p),
          } as never))(),
      ).rejects.toMatchObject({ status: 404 });
    for (const p of [`casino/${CH}/state`, `casino/${CH}/history`])
      await expect(
        (async () =>
          get.handle({ params: [p], body: undefined, url: url(p) } as never))(),
      ).rejects.toMatchObject({ status: 404 });
    await get.handle({
      params: [`casino/${CH}/admin/state`],
      body: undefined,
      url: url(`casino/${CH}/admin/state`),
    } as never);
    await expect(
      (async () =>
        get.handle({
          params: [`casino/42/admin/state`],
          body: undefined,
          url: url('casino/42/admin/state'),
        } as never))(),
    ).rejects.toMatchObject({ status: 403 });
    // « Dernières parties » by player: one player's history (read only), its paging kept.
    const player = `casino/${CH}/admin/players/${ALICE.id}/rounds`;
    await get.handle({
      params: [player],
      body: undefined,
      url: new URL(`http://c/v1/studio/cockpit/${player}?limit=30`),
    } as never);
    expect(calls).toEqual([
      `/v1/lab/casino/${CH}/admin/state`,
      `/v1/lab/casino/${CH}/admin/players/${ALICE.id}/rounds?limit=30`,
    ]);
  });
});

describe('casino — Production (canonical Wallet)', () => {
  it('never plays without CASINO_EXTENSION; then the canonical live and the real ledger, keyed by the round', async () => {
    const core = await setup();
    const economy = coreWalletEconomy(core.wallet.wallet);
    const settings = core.moduleSettings;
    const c: CasinoService = new Service(
      core.db,
      core.clock,
      economy,
      settings,
    );
    await settings.set(CH, 'casino.open', 1, 'test');
    await core.wallet.wallet.credit({
      key: 'fund-casino-1',
      viewer: { twitchUserId: ALICE.id, login: 'alice', displayName: 'Alice' },
      amount: 1000,
      source: 'test',
    });
    expect(
      await code(c.spinSlot(CH, ALICE, { key: 'prod-1-xxxx', bet: 100 })),
    ).toBe('not_approved');
    c.productionApproved = true;
    expect(
      await code(c.spinSlot(CH, ALICE, { key: 'prod-2-xxxx', bet: 100 })),
    ).toBe('stream_offline');
    await openCanonicalLive(core.db, core.clock);
    c.rng = scripted([3, 7, 11, 19, 25]);
    const r = await c.spinSlot(CH, ALICE, { key: 'prod-3-xxxx', bet: 100 });
    expect((await economy.balances(core.db, CH, ALICE.id)).tokens).toBe(
      900 + r.round.payout,
    );
    const tx = await core.db.query<{
      kind: string;
      source: string;
      amount: string;
    }>(
      `select t.kind, t.source, t.amount from wallet_transactions t where t.source = 'casino' order by t.id`,
    );
    expect(tx.map((t) => t.kind)).toEqual(
      r.round.payout ? ['spend', 'reward'] : ['spend'],
    );
    expect(
      await code(c.spinSlot(CH, ALICE, { key: 'prod-4-xxxx', bet: 10_000 })),
    ).toBe('insufficient_tokens');
  });
});

describe('casino — Studio « Dernières parties » by player (read only)', () => {
  it('one player’s whole history by pages: newest first, no duplicate, nobody else’s rounds, totals as recorded; nothing written', async () => {
    const core = await lab();
    await liveOn(core);
    const c = core.casino;
    for (let i = 0; i < 7; i++) {
      await c.spinSlot(CH, ALICE, {
        key: `k-alice-${i}-0001`,
        bet: 100 + i * 20,
      });
      core.clock.advance(5_000);
      if (i < 3) {
        await c.spinRoulette(CH, BOB, {
          key: `k-bob-${i}-00001`,
          bets: { red: 100 },
        });
        core.clock.advance(5_000);
      }
    }
    const before = [
      await tokens(core),
      await tokens(core, BOB.id),
      await rounds(core),
    ];
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let totals: {
      rounds: number;
      staked: number;
      won: number;
      net: number;
    } | null;
    do {
      const page = await c.adminPlayer(CH, ALICE.id, {
        before: cursor,
        limit: 3,
      });
      expect(page.viewer_name).toBe('Alice');
      for (const r of page.rounds) expect(r.round_id).not.toBe('');
      ids.push(...page.rounds.map((r) => r.round_id));
      totals = page.totals;
      cursor = page.next_before;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(7);
    const db = await core.db.query<{
      round_id: string;
      bet: number;
      payout: number;
    }>(
      'select round_id, bet, payout from casino_rounds where channel_id = $1 and viewer_id = $2 order by created_at desc, round_id desc',
      [CH, ALICE.id],
    );
    expect(ids).toEqual(db.map((r) => r.round_id));
    const staked = db.reduce((s, r) => s + Number(r.bet), 0);
    const won = db.reduce((s, r) => s + Number(r.payout), 0);
    expect(totals).toEqual({ rounds: 7, staked, won, net: won - staked });
    // Each round as recorded: bet, gross payout, net = payout − bet (never recomputed).
    const first = await c.adminPlayer(CH, ALICE.id, { limit: 100 });
    for (const r of first.rounds) {
      const d = db.find((x) => x.round_id === r.round_id)!;
      expect([r.bet, r.payout, r.net]).toEqual([
        Number(d.bet),
        Number(d.payout),
        Number(d.payout) - Number(d.bet),
      ]);
    }
    expect(first.next_before).toBeNull();
    // Bob's rounds never in Alice's history; an unknown player: empty; a malformed cursor: the first page.
    expect((await c.adminPlayer(CH, BOB.id)).rounds).toHaveLength(3);
    expect(await c.adminPlayer(CH, '424242')).toMatchObject({
      rounds: [],
      totals: { rounds: 0 },
      next_before: null,
    });
    expect(
      (
        await c.adminPlayer(CH, ALICE.id, { before: 'nope', limit: 2 })
      ).rounds.map((r) => r.round_id),
    ).toEqual(ids.slice(0, 2));
    expect([
      await tokens(core),
      await tokens(core, BOB.id),
      await rounds(core),
    ]).toEqual(before);
  });
});
