import { describe, expect, it } from 'vitest';
import { seededRng, type IntRng } from '../src/casino/rng.js';
import { CasinoError } from '../src/casino/service.js';
import { STRIPS } from '../src/casino/slot.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup, type TestCore } from './helpers.js';

// Casino spectators (docs/CASINO.md § 6, feed.ts): a spectator follows a PLAYER; a stage reaches them only once the
// player's screen showed it (or its animation is overdue); each stage once, in order; the next respins of a Coffre are
// never sent ahead; a spectator can never act on the round they watch.

const CH = '83603689';
const ALICE = { id: '9001', display_name: 'Alice' };
const BOB = { id: '9002', display_name: 'Bob' };

async function lab() {
  const core = await setup();
  for (const v of [ALICE, BOB])
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      v.id,
      'set',
      { tokens: 100_000 },
      'test',
    );
  await core.moduleSettings.set(CH, 'casino.open', 1, 'test');
  await core.db.query(
    `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
     values (gen_random_uuid(), $1, $2, 'simulated', 'test')`,
    [CH, core.clock.now()],
  );
  return core;
}
function scripted(first: number[], seed = 1): IntRng {
  const rest = seededRng(seed);
  const queue = first.slice();
  return { int: (n) => (queue.length ? queue.shift()! % n : rest.int(n)) };
}
function bonusStops(k: number) {
  return STRIPS.map((s, r) => {
    const b = s.indexOf('bonus');
    return r < k ? (b - 1 + s.length) % s.length : (b + 2) % s.length;
  });
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof CasinoError ? e.code : `throw:${(e as Error).message}`;
  }
};
type Ev = {
  seq: number;
  kind: string;
  pos: number | null;
  data: Record<string, unknown>;
  round_id: string | null;
};
const watch = async (core: TestCore, after = -1) =>
  (await core.casino.watch(CH, ALICE.id, after, 0)) as unknown as {
    events: Ev[];
    cursor: number;
    reset: boolean;
    player: { state: string; game: string | null; name: string | null };
  };
const later = (core: TestCore, ms: number) =>
  core.clock.set(new Date(core.clock.now().getTime() + ms));

describe('casino spectators — the feed of a player', () => {
  it('a spin: the stake at once, the result only once the player’s reels stopped; each stage once', async () => {
    const core = await lab();
    const c = core.casino;
    c.rng = scripted([3, 7, 11, 19, 25]);
    const first = await watch(core);
    expect(first.events).toEqual([]);
    const r = await c.spinSlot(CH, ALICE, { key: 'feed-slot-001', bet: 100 });
    const a = await watch(core, first.cursor);
    expect(a.events.map((e) => e.kind)).toEqual(['start']);
    expect(a.events[0]!.data).toEqual({ bet: 100 }); // no stops, no grid, no payout
    expect(JSON.stringify(a)).not.toContain('"stops"');
    expect(a.player.state).toBe('playing');
    // another viewer cannot read the result ahead through the round either
    const early = (await c.round(CH, r.round.round_id, BOB)).round as Record<
      string,
      unknown
    >;
    expect(early.revealed).toBe(false);
    expect(early.outcome).toBeUndefined();
    // the player's reels stopped: result + end (no Coffre), once — a resent progress adds nothing
    await c.progress(CH, ALICE, {
      round_id: r.round.round_id,
      stage: 'result',
    });
    await c.progress(CH, ALICE, {
      round_id: r.round.round_id,
      stage: 'result',
    });
    const b = await watch(core, a.cursor);
    expect(b.events.map((e) => e.kind)).toEqual(['result', 'end']);
    expect(b.events[0]!.data.stops).toEqual(
      (r.round.outcome as { stops: number[] }).stops,
    );
    expect(b.events[1]!.data.payout).toBe(r.round.payout);
    expect((await watch(core, b.cursor)).events).toEqual([]);
    expect(
      ((await c.round(CH, r.round.round_id, BOB)).round as { payout: number })
        .payout,
    ).toBe(r.round.payout);
    // a spectator can never move the player's round
    expect(
      await code(
        c.progress(CH, BOB, { round_id: r.round.round_id, stage: 'end' }),
      ),
    ).toBe('round_not_found');
  });

  it('the Coffre: one respin at a time, as the player plays it; never the next ones; Passer publishes in order', async () => {
    const core = await lab();
    const c = core.casino;
    c.rng = scripted(bonusStops(3), 4242);
    const r = await c.spinSlot(CH, ALICE, { key: 'feed-coffre-01', bet: 100 });
    const coffre = (r.round.outcome as { coffre: { steps: unknown[] } }).coffre;
    const n = coffre.steps.length;
    expect(n).toBeGreaterThan(2);
    const id = r.round.round_id;
    let cur = (await watch(core)).cursor;
    await c.progress(CH, ALICE, { round_id: id, stage: 'result' });
    let w = await watch(core, cur);
    expect(w.events.map((e) => e.kind)).toEqual(['result']); // the reels, the BONUS — not the Coffre's content
    expect(JSON.stringify(w.events)).not.toContain('"steps"');
    expect(w.events[0]!.data.coffre).toEqual({ k: 3 });
    cur = w.cursor;
    await c.progress(CH, ALICE, { round_id: id, stage: 'coffre' });
    w = await watch(core, cur);
    expect(w.events.map((e) => e.kind)).toEqual(['coffre']);
    expect(w.player.state).toBe('bonus');
    cur = w.cursor;
    // manual: the player thinks for minutes — nothing is published for them
    later(core, 10 * 60_000);
    expect((await watch(core, cur)).events).toEqual([]);
    await c.progress(CH, ALICE, { round_id: id, stage: 'step', step: 0 });
    w = await watch(core, cur);
    expect(w.events.map((e) => [e.kind, e.data.i])).toEqual([['step', 0]]);
    cur = w.cursor;
    // a lost progress then Passer to step 2: steps 1 and 2 arrive, in order, once
    await c.progress(CH, ALICE, {
      round_id: id,
      stage: 'step',
      step: 2,
      fast: true,
    });
    await c.progress(CH, ALICE, { round_id: id, stage: 'step', step: 1 });
    w = await watch(core, cur);
    expect(w.events.map((e) => [e.kind, e.data.i])).toEqual([
      ['step', 1],
      ['step', 2],
    ]);
    cur = w.cursor;
    await c.progress(CH, ALICE, { round_id: id, stage: 'end' });
    w = await watch(core, cur);
    expect(w.events.map((e) => e.kind)).toEqual([
      ...Array.from({ length: n - 3 }, () => 'step'),
      'end',
    ]);
    expect((w.events.at(-1)!.data.coffre as { win: number }).win).toBe(
      (r.round.outcome as { coffre: { win: number } }).coffre.win,
    );
    // out-of-range stages are refused
    expect(
      await code(
        c.progress(CH, ALICE, { round_id: id, stage: 'step', step: n }),
      ),
    ).toBe('invalid_step');
  });

  it('a closed tab never blocks the spectators: an overdue result is published; a new spectator rejoins the round', async () => {
    const core = await lab();
    const c = core.casino;
    c.rng = scripted(bonusStops(3), 7);
    const r = await c.spinSlot(CH, ALICE, { key: 'feed-overdue1', bet: 100 });
    // a spectator arriving now: the round's start (to rejoin it), the player's game
    const snap = await watch(core);
    expect(snap.reset).toBe(true);
    expect(snap.events.map((e) => e.kind)).toEqual(['start']);
    later(core, 10_000);
    const w = await watch(core, snap.cursor);
    expect(w.events.map((e) => e.kind)).toEqual(['result']);
    later(core, 8_000);
    expect((await watch(core, w.cursor)).events.map((e) => e.kind)).toEqual([
      'coffre',
    ]);
    // the respins wait for the player (manual), whatever the clock
    later(core, 60_000);
    await c.progress(CH, ALICE, {
      round_id: r.round.round_id,
      stage: 'step',
      step: 0,
    });
    const again = await watch(core); // a refreshed spectator: the whole round so far, in order
    expect(again.events.map((e) => e.kind)).toEqual([
      'start',
      'result',
      'coffre',
      'step',
    ]);
  });

  it('long-poll: a waiting spectator is woken by the spin, not by the clock', async () => {
    const core = await lab();
    const c = core.casino;
    c.rng = scripted([3, 7, 11, 19, 25]);
    const cur = (await watch(core)).cursor;
    const t0 = Date.now();
    const waiting = c.watch(CH, ALICE.id, cur, 5_000);
    await new Promise((ok) => setTimeout(ok, 150));
    await c.spinSlot(CH, ALICE, { key: 'feed-wake-001', bet: 100 });
    const got = (await waiting) as { events: Ev[] };
    expect(got.events.map((e) => e.kind)).toEqual(['start']);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it('roulette: the bets being placed (never debited), the spin, the result after the ball; presence follows the game', async () => {
    const core = await lab();
    const c = core.casino;
    await c.presence(CH, ALICE, 'roulette');
    await c.draft(CH, ALICE, { red: 100, n17: 40 });
    let w = await watch(core);
    expect(w.player.game).toBe('roulette');
    expect(w.events.map((e) => e.kind)).toEqual(['presence', 'draft']);
    expect(w.events[1]!.data).toEqual({
      bets: { red: 100, n17: 40 },
      total: 140,
    });
    expect((await core.economy.balances(core.db, CH, ALICE.id)).tokens).toBe(
      100_000,
    );
    // bad drafts are refused; a burst is slowed
    expect(await code(c.draft(CH, ALICE, { nope: 20 }))).toBe('unknown_spot');
    expect(await code(c.draft(CH, ALICE, { red: 30 }))).toBe('invalid_amount');
    expect(
      await code(c.draft(CH, ALICE, JSON.parse('{"__proto__": 20}'))),
    ).toBe('unknown_spot');
    expect(await code(c.draft(CH, ALICE, { red: 120 }))).toBe('rate_limited');
    c.rng = scripted([5, 12345]);
    const r = await c.spinRoulette(CH, ALICE, {
      key: 'feed-roul-001',
      bets: { red: 100, n17: 40 },
    });
    w = await watch(core, w.cursor);
    expect(w.events.map((e) => e.kind)).toEqual(['start']);
    expect(w.events[0]!.data).toEqual({
      bet: 140,
      bets: { red: 100, n17: 40 },
    });
    await c.progress(CH, ALICE, {
      round_id: r.round.round_id,
      stage: 'result',
    });
    w = await watch(core, w.cursor);
    expect(w.events.map((e) => e.kind)).toEqual(['result', 'end']);
    expect(w.events[0]!.data).toMatchObject({
      number: (r.round.outcome as { number: number }).number,
      seed: 12345,
    });
    // the player goes to the machine: the spectator follows
    await c.presence(CH, ALICE, 'slot');
    w = await watch(core, w.cursor);
    expect(w.events.map((e) => [e.kind, e.data.game])).toEqual([
      ['presence', 'slot'],
    ]);
    expect(await code(c.presence(CH, ALICE, 'poker'))).toBe('invalid_game');
    // « parties en direct »: Alice, on the machine; gone once she closes it
    expect(
      (await c.livePlayers(CH, -1, 0)).players.map((p) => [p.name, p.game]),
    ).toEqual([['Alice', 'slot']]);
    later(core, 25_000);
    await c.presence(CH, ALICE, null);
    expect((await c.livePlayers(CH, -1, 0)).players).toEqual([]);
  });
});
