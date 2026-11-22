// Casino interactive demo — a LOCAL Core for `npm run casino:bench` (mode « Extension complète »). The extension's real
// pages (video_component.html, mobile.html: the Raptoru Live header, the Mini-jeux module, the four games) run in demo
// mode and their client answers come from here (RUNTIME.fixtureCall, the calibration build's hook) instead of the Core.
//
// The draws, rules and settlements are the Core's OWN engines (apps/core-api/src/casino/*.ts, bundled for the browser
// by esbuild when the bench starts: build.mjs) — this file only plays the service's part (routes, answer shapes,
// idempotency, the table ticker), with fictitious Jetons kept in this page's memory. No network, no Core, no Wallet,
// no Twitch, no real viewer. Reloading the page starts again from 50 000 Jetons.
//
// window.__casinoDemo (the bench page's controls): next({ game, kind }) forces the next result's KIND by drawing again
// with the real engine until it matches (never an invented result); bots(n) seats n simulated players (basic strategy)
// at the viewer's table; balance(n) sets the fictitious balance.
/* global window, document, setTimeout, clearTimeout, setInterval, location, crypto, structuredClone, URLSearchParams, CSS */
import * as Slot from '../../../../core-api/src/casino/slot.ts';
import { generateCoffre } from '../../../../core-api/src/casino/coffre.ts';
import { floatFrom } from '../../../../core-api/src/casino/rng.ts';
import * as Book from '../../../../core-api/src/casino/book.ts';
import * as R from '../../../../core-api/src/casino/roulette.ts';
import * as BJ from '../../../../core-api/src/casino/blackjack/engine.ts';
import {
  actions as handActions,
  basicStrategy,
} from '../../../../core-api/src/casino/blackjack/rules.ts';
import * as Lobby from '../../../../core-api/src/casino/blackjack/lobby.ts';
import {
  REACTION_IDS,
  SUB_REACTION_IDS,
  TableReactions,
  isReactionId,
  isSubReactionId,
} from '../../../../core-api/src/casino/blackjack/reactions.ts';

const ME = '42'; // the demo session's twitch_user_id (shared/demo-data.js)
const MY_NAME = 'Toi (démo)';
const START = 50_000;
const rng = { int: (n) => Math.floor(Math.random() * n) };
// The Core's defaults (apps/core-api/src/casino/service.ts CASINO_SETTINGS → limits()).
const LIMITS = Object.freeze({
  book_min_bet: 20,
  book_max_bet: 1_000,
  bj_main_min: 100,
  bj_max_win: 1_000_000,
  bj_side_max_return: 100_000,
  bj_announce: false,
  bj_reactions: true,
  bj_dealer_reactions: true,
  bj_announce_gap_s: 600,
  slot_min_bet: 20,
  slot_max_bet: 10_000,
  roulette_max_total: 100_000,
  roulette_step: R.BET_STEP,
  max_win: 1_000_000,
  roulette_all_in_max_win: 0,
  share_cooldown_s: 0,
  announce: true,
  announce_min_x: 500,
});
const BJ_LIMITS = {
  step: 10,
  mainMin: LIMITS.bj_main_min,
  sideMin: 10,
  maxWin: LIMITS.bj_max_win,
  sideMaxReturn: LIMITS.bj_side_max_return,
};

let balance = START;
const rounds = []; // this viewer's rounds, newest first (publicView shape)
const replies = new Map(); // idempotency key → answer (a resent intent replays it)
const forced = {
  slot: 'random',
  book: 'random',
  roulette: 'random',
  blackjack: 'random',
};
let session = null;

// --- Errors in the client's shape (shared/api.js: code, status, details = the JSON body) --------------------------------
function refuse(code, details = {}, status = 409) {
  return Object.assign(new Error(code), {
    code,
    status,
    details: { ok: false, error: code, ...details },
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// --- The session the header shows (the demo session, its wallet = the fictitious balance) ------------------------------
async function sessionPayload() {
  if (!session) {
    const base = `/${location.pathname.split('/')[1]}/shared/demo-data.js`;
    const { createDemoSession } = await import(base);
    session = createDemoSession('paid');
    session.pending_actions = [];
  }
  session.wallet = { points: balance, reserved: 0, available: balance };
  return structuredClone(session);
}
const HOST_MODULES = {
  modules: [
    {
      id: 'random_ban_ext',
      label: 'Mini-jeux',
      description: 'Random Ban et les jeux du stream',
      category: 'games',
      enabled: true,
      actions: [],
    },
  ],
};

// --- Rounds (slot, book, roulette) ---------------------------------------------------------------------------------------
function record(game, bet, raw, outcome) {
  const payout = Math.min(raw, LIMITS.max_win);
  const row = {
    round_id: crypto.randomUUID(),
    game,
    viewer_name: MY_NAME,
    bet,
    payout,
    raw_payout: raw,
    capped: payout < raw,
    net: payout - bet,
    outcome,
    created_at: new Date().toISOString(),
    progress_step: -1, // the casino_rounds column's default: nothing watched yet
    finished: !(outcome?.coffre || outcome?.feature),
    shared: false,
    mine: true,
  };
  rounds.unshift(row);
  if (rounds.length > 100) rounds.pop();
  balance += payout - bet;
  return row;
}

/** Draws with the REAL engine until the result is of the asked kind (bounded; the last draw if none matched). */
function until(drawOnce, ok, tries = 40_000) {
  let r = drawOnce();
  for (let k = 0; k < tries && !ok(r); k++) r = drawOnce();
  return r;
}

function spinSlot(bet) {
  const draw = () => {
    const stops = Slot.drawStops(rng);
    const grid = Slot.windowAt(stops);
    return { stops, grid, ev: Slot.evaluate(grid, bet) };
  };
  const kind = forced.slot;
  const want = {
    loss: (r) => r.ev.total === 0 && r.ev.scatter.count < 3,
    line: (r) =>
      r.ev.lines.length === 1 &&
      !r.ev.lines[0].wilds?.length &&
      r.ev.scatter.count < 3,
    wild: (r) =>
      r.ev.lines.some((l) => l.wilds?.length) && r.ev.scatter.count < 3,
    lines: (r) => r.ev.lines.length >= 2 && r.ev.scatter.count < 3,
    big: (r) => r.ev.total >= 15 * bet && r.ev.scatter.count < 3,
    bonus: (r) => r.ev.scatter.count >= 3,
  }[kind];
  const { stops, grid, ev } = want ? until(draw, want) : draw();
  let coffre = null;
  if (ev.scatter.count >= 3) {
    const cells = ev.scatter.cells.map(([r, row]) => r * 3 + row);
    const s = generateCoffre(ev.scatter.count, floatFrom(rng), cells);
    coffre = { ...s, win: Math.floor(s.total * bet) };
  }
  const raw = ev.total + (coffre?.win ?? 0);
  return record('slot', bet, raw, {
    stops,
    grid,
    lines: ev.lines,
    scatter: ev.scatter,
    line_win: ev.total,
    coffre,
  });
}

function spinBook(bet) {
  const kind = forced.book;
  let r;
  if (kind === 'bonus') r = Book.playRound(rng, bet, { bonus: 3 });
  else if (kind === 'bigbonus')
    r = Book.playRound(rng, bet, { bonus: 3, big: true });
  else {
    const want = {
      loss: (x) => x.payout === 0,
      line: (x) =>
        x.base.eval.lines.length === 1 &&
        !x.base.eval.lines[0].wilds?.length &&
        !x.feature,
      wild: (x) => x.base.eval.lines.some((l) => l.wilds?.length) && !x.feature,
      lines: (x) => x.base.eval.lines.length >= 2 && !x.feature,
    }[kind];
    const once = () => Book.playRound(rng, bet, null);
    r = want ? until(once, want) : once();
  }
  return record('book', bet, r.payout, r);
}

function spinRoulette(bets) {
  const shape = R.rouletteError(bets, Number.MAX_SAFE_INTEGER);
  if (shape)
    throw refuse(
      shape,
      { max: LIMITS.roulette_max_total, step: R.BET_STEP },
      400,
    );
  const lim = R.rouletteLimit(bets, balance, LIMITS);
  if (lim.refusal)
    throw refuse(lim.refusal, {
      max: LIMITS.roulette_max_total,
      max_win: lim.cap,
      balance,
    });
  const bet = R.stakeOf(bets);
  if (balance < bet)
    throw refuse('insufficient_tokens', { balance, needed: bet });
  const n = Number.isInteger(forced.roulette) ? forced.roulette : null;
  const pocket = n === null ? rng.int(R.ORDER.length) : R.ORDER.indexOf(n);
  const number = R.ORDER[pocket];
  const s = R.settleRoulette(bets, number);
  return record('roulette', bet, s.gross, {
    bets: { ...bets },
    pocket,
    number,
    color: R.colorOf(number),
    wins: s.wins,
    seed: rng.int(2 ** 31),
  });
}

function spin(game, body, key) {
  if (!key) throw refuse('idempotency_key_required', {}, 400);
  const memo = replies.get(key);
  if (memo) return { ...structuredClone(memo), replayed: true };
  let row;
  if (game === 'roulette') row = spinRoulette(body?.bets ?? {});
  else {
    const bet = body?.bet;
    if (
      typeof bet !== 'number' ||
      !Number.isSafeInteger(bet) ||
      (game === 'book' && bet % 10)
    )
      throw refuse('invalid_bet', {}, 400);
    const [min, max] =
      game === 'book'
        ? [LIMITS.book_min_bet, LIMITS.book_max_bet]
        : [LIMITS.slot_min_bet, LIMITS.slot_max_bet];
    if (bet < min) throw refuse('below_min', { min });
    if (bet > max) throw refuse('above_max', { max });
    if (balance < bet)
      throw refuse('insufficient_tokens', { balance, needed: bet });
    row = game === 'book' ? spinBook(bet) : spinSlot(bet);
  }
  const out = { round: structuredClone(row), balance, replayed: false };
  replies.set(key, out);
  return out;
}

function lightView(r) {
  const o = r.outcome ?? {};
  const best =
    r.game === 'slot' ? o.lines.slice().sort((a, b) => b.win - a.win)[0] : null;
  return {
    round_id: r.round_id,
    game: r.game,
    bet: r.bet,
    payout: r.payout,
    net: r.net,
    capped: r.capped,
    created_at: r.created_at,
    shared: r.shared,
    ...(r.game === 'slot'
      ? {
          best: best ? { symbol: best.symbol, count: best.count } : null,
          lines: o.lines.length,
          coffre: o.coffre
            ? {
                k: o.coffre.k,
                total: o.coffre.total,
                win: o.coffre.win,
                full: o.coffre.full,
                jackpots: o.coffre.jackpots,
              }
            : null,
        }
      : {}),
    ...(r.game === 'roulette' ? { number: o.number, color: o.color } : {}),
    ...(r.game === 'book'
      ? {
          lines: o.base.eval.lines.length,
          feature: o.feature
            ? {
                symbol: o.feature.symbol,
                games: o.feature.games,
                win: o.feature.total,
              }
            : null,
        }
      : {}),
    ...(r.game === 'blackjack'
      ? { table: o.table, round: o.round, dealer: o.outcome }
      : {}),
  };
}

function history(query) {
  const game = query.get('game');
  const limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), 100);
  const mine = rounds.filter((r) => !game || r.game === game);
  return {
    rounds: mine.slice(0, limit).map(lightView),
    stats: {
      rounds: mine.length,
      staked: mine.reduce((n, r) => n + r.bet, 0),
      won: mine.reduce((n, r) => n + r.payout, 0),
      best: mine.reduce((n, r) => Math.max(n, r.payout), 0),
    },
  };
}

function casinoState() {
  return {
    availability: {
      open: true,
      reason: null,
      live: true,
      games: { slot: true, roulette: true, book: true, blackjack: true },
      economy: 'lab',
    },
    limits: LIMITS,
    tables: {
      slot: Slot.slotTable(),
      roulette: { order: R.ORDER, spots: Object.keys(R.SPOTS) },
      book: {
        strips: Book.STRIPS,
        lines: Book.LINES,
        pays: Book.PAYS,
        scatter_pays: Book.SCATTER_PAYS,
        free_games: Book.FREE_GAMES,
      },
    },
    players: [],
    live_cursor: 0,
    me: { balance, resume: null, resume_book: null, share_ready_in_s: 0 },
    server_now: new Date().toISOString(),
  };
}

// --- Blackjack: the tables, the ticker, the simulated players --------------------------------------------------------
const tables = []; // TableState[] (engine.ts), in table order
const waiters = new Map(); // table id → Set(resolve)
let botsWanted = 0;
const BOT_NAMES = [
  'Lucie',
  'Marco',
  'Nadia',
  'Hugo',
  'Inès',
  'Tom',
  'Sacha',
  'Jade',
  'Yanis',
];
const isBot = (u) => u.startsWith('bot-');
const botPlan = new Map(); // bot user → time of its next move
// The players' reactions: the Core's own in-memory store (reactions.ts), its pace and ids.
const reactions = new TableReactions();
const players = (t) => t.seats.filter(Boolean).length;

function ctx() {
  return {
    now: Date.now(),
    int: (n) => rng.int(n),
    T: BJ.TIMING,
    L: BJ_LIMITS,
    balance: (u) => (isBot(u) ? 1e9 : balance),
    debit: (u, amount) => {
      if (isBot(u)) return;
      if (balance < amount)
        throw new BJ.BjError('insufficient_tokens', {
          balance,
          needed: amount,
        });
      balance -= amount;
    },
    credit: (u, amount) => {
      if (!isBot(u)) balance += amount;
    },
    connected: () => true,
    maxBalance: Number.MAX_SAFE_INTEGER,
  };
}

function wake(t) {
  for (const done of waiters.get(t.id) ?? []) done();
}

/** One change of a table, as the service's `mutate`: the engine call, this viewer's new history row, the wake-up. */
function mutate(t, fn) {
  const before = t.history.at(-1)?.round ?? 0;
  const seq = t.seq;
  let res;
  try {
    res = fn(t, ctx());
  } catch (e) {
    if (e instanceof BJ.BjError) throw refuse(e.code, e.details);
    throw e;
  }
  const last = t.history.at(-1);
  if (last && last.round !== before) {
    const p = last.players.find((x) => x.user === ME);
    if (p?.staked)
      rounds.unshift({
        round_id: crypto.randomUUID(),
        game: 'blackjack',
        viewer_name: MY_NAME,
        bet: p.staked,
        payout: p.staked + p.net,
        raw_payout: p.staked + p.net,
        capped: false,
        net: p.net,
        outcome: {
          table: t.no,
          table_id: t.id,
          round: last.round,
          outcome: last.outcome,
          dealer: last.dealer,
          player: p,
        },
        created_at: new Date().toISOString(),
        progress_step: 0,
        finished: true,
        shared: false,
        mine: true,
      });
  }
  if (t.seq !== seq) {
    t.lastChange = Date.now();
    wake(t);
  }
  return res;
}

const seatedAt = (u) =>
  tables.find((t) =>
    t.seats.some((s) => s?.user === u && s.status === 'seated'),
  );

function tablesView() {
  const mine = seatedAt(ME);
  const p = Lobby.createPolicy(
    tables.map((t) => ({ no: t.no, players: players(t) })),
  );
  return {
    create: { allowed: p.allowed, reason: p.reason, cap: p.cap, open: p.open },
    tables: tables.map((t) => ({
      id: t.id,
      no: t.no,
      players: t.seats.filter(Boolean).length,
      seats: BJ.TABLE_SEATS,
      taken: t.seats.map(Boolean),
      users: t.seats.filter(Boolean).map((s) => s.user),
      phase: t.phase,
      round: t.round,
    })),
    mine: mine?.id ?? null,
  };
}

function join(body) {
  const mine = seatedAt(ME);
  if (mine)
    return {
      table: mine.id,
      seat: BJ.seatOf(mine, ME),
      already: true,
      created: false,
    };
  const left = tables.find((t) =>
    t.seats.some((s) => s?.user === ME && s.status === 'left'),
  );
  if (left)
    return {
      table: left.id,
      seat: mutate(left, (t) => BJ.resume(t, ME)),
      resumed: true,
      created: false,
    };
  const count = players;
  let target = body?.table_id
    ? tables.find((t) => t.id === body.table_id)
    : null;
  if (body?.table_id && !target) throw refuse('no_table', {}, 404);
  if (target && count(target) >= BJ.TABLE_SEATS) throw refuse('table_full');
  let reused = false;
  // « + Nouvelle table » : la politique du Core (lobby.ts), telle quelle.
  if (!body?.table_id && body?.new_table === true) {
    const p = Lobby.createPolicy(
      tables.map((t) => ({ no: t.no, players: count(t) })),
    );
    if (!p.allowed) throw refuse(p.reason, { cap: p.cap, open: p.open });
    target = tables.find((t) => t.no === p.reuse) ?? null;
    reused = !!target;
  } else if (!target)
    target = tables
      .filter((t) => count(t) < BJ.TABLE_SEATS)
      .sort((a, b) => count(b) - count(a) || a.no - b.no)[0];
  let created = false;
  if (!target) {
    if (tables.length >= Lobby.MAX_TABLES) throw refuse('casino_full');
    target = newDemoTable();
    created = true;
  }
  const seat = body?.seat ?? null;
  const r = mutate(target, (t, c) => BJ.sit(t, c, ME, MY_NAME, null, seat));
  fillBots(target);
  return {
    table: target.id,
    seat: r.seat,
    nextRound: r.nextRound,
    created,
    ...(reused ? { reused } : {}),
    no: target.no,
  };
}
function newDemoTable() {
  const t = BJ.newTable(
    crypto.randomUUID(),
    Lobby.nextTableNo(tables.map((x) => x.no)),
    (n) => rng.int(n),
  );
  t.lastChange = Date.now();
  tables.push(t);
  tables.sort((a, b) => a.no - b.no);
  return t;
}
/** Another table, with `n` simulated players who play by themselves (lobby, spectator, navigation between tables). */
function otherTable(n) {
  const t = newDemoTable();
  for (let k = 0; k < n; k++) {
    const name = BOT_NAMES[(t.no * 3 + k) % BOT_NAMES.length];
    mutate(t, (x, c) =>
      BJ.sit(
        x,
        c,
        `bot-${name}-${t.no}`,
        name,
        null,
        ((k * 2) % 10) + (k >= 5 ? 1 : 0),
      ),
    );
  }
  return t;
}
/** The local twin of the Core's sweep (lobby.ts closable); `now`: the bench can jump past the 10 minutes. */
function sweep(now = Date.now()) {
  const gone = Lobby.closable(
    tables.map((t) => ({
      id: t.id,
      no: t.no,
      players: players(t),
      since: t.lastChange ?? 0,
      pending: !!t.next,
    })),
    now,
  );
  for (const id of gone) {
    const [t] = tables.splice(
      tables.findIndex((x) => x.id === id),
      1,
    );
    reactions.drop(id);
    wake(t);
  }
  return gone.length;
}
/** A simulated player reacts (its own pace applies: reactions.ts). */
// What the simulated players send: the reactions an up-to-date screen offers (both pages: they are subscribers).
const BOT_IDS = [
  'r1',
  'r8',
  'r9',
  'r2',
  'r10',
  'r3',
  'r11',
  'r12',
  'r13',
  'r7',
  ...SUB_REACTION_IDS,
];
// The demo viewer's subscription as the Core would know it (the bench's « Abonnement » control): yes | no | unknown.
let subStatus = 'yes';
function botReact(t, s, r = BOT_IDS[rng.int(BOT_IDS.length)]) {
  try {
    reactions.push(t.id, s.user, t.seats.indexOf(s), r, Date.now());
    wake(t);
  } catch {
    /* too soon for that player */
  }
}

function fillBots(t) {
  const bots = t.seats.filter((s) => s && isBot(s.user));
  for (let k = bots.length; k < botsWanted; k++) {
    const free = t.seats.indexOf(null);
    if (free < 0) break;
    const name =
      BOT_NAMES.find((n) => !t.seats.some((s) => s?.name === n)) ??
      `Joueur ${k + 1}`;
    mutate(t, (x, c) => BJ.sit(x, c, `bot-${name}`, name, null, free));
  }
  // Fewer wanted: the extra bots leave (between rounds their seat frees at once; in a round, after it).
  for (const s of t.seats.filter((x) => x && isBot(x.user)).slice(botsWanted))
    mutate(t, (x, c) => BJ.leave(x, c, s.user));
}

/** The simulated players: bet then PRÊT during the betting, decline the insurance, basic strategy at their turn. */
function botsMove(t) {
  const now = Date.now();
  // Une manche réglée : de temps en temps un joueur fictif réagit (une émote au-dessus de sa place).
  if (t.phase === 'settled' && t.reactedRound !== t.round) {
    t.reactedRound = t.round;
    const bots = t.seats.filter(
      (s) => s && isBot(s.user) && s.status === 'seated',
    );
    if (bots.length && rng.int(3) === 0)
      setTimeout(
        () => botReact(t, bots[rng.int(bots.length)]),
        400 + rng.int(900),
      );
  }
  const due = (u, ms) => {
    if (!botPlan.has(u)) botPlan.set(u, now + ms * (0.6 + Math.random() * 0.8));
    if (botPlan.get(u) > now) return false;
    botPlan.delete(u);
    return true;
  };
  t.seats.forEach((s) => {
    if (!s || !isBot(s.user) || s.status !== 'seated') return;
    if (t.phase === 'betting' && !s.bet?.ready && due(s.user, 1800)) {
      const main = 100 * (1 + rng.int(5));
      const side =
        rng.int(3) === 0
          ? { [['d17', 'd18', 'd19', 'd20', 'd21', 'bust'][rng.int(6)]]: 50 }
          : {};
      try {
        mutate(t, (x, c) =>
          BJ.placeBets(x, c, s.user, { main, side, ready: true }),
        );
      } catch {
        /* a refused bot bet: it simply waits for the next round */
      }
    }
    if (
      t.phase === 'insurance' &&
      s.inRound &&
      s.ins === null &&
      due(s.user, 1200)
    )
      mutate(t, (x, c) => BJ.insure(x, c, s.user, { stake: 0 }));
  });
  const turn = t.turn;
  const s = turn && t.phase === 'players' ? t.seats[turn.seat] : null;
  if (s && isBot(s.user) && due(`${s.user}:${turn.token}`, 1100)) {
    const hand = s.hands[turn.hand];
    const allowed = handActions(hand, { handsCount: s.hands.length });
    const type = basicStrategy(hand, t.dealer[0], allowed);
    try {
      mutate(t, (x, c) => BJ.act(x, c, s.user, { type, token: turn.token }));
    } catch {
      /* stale turn: the next tick sees the new one */
    }
  }
}

let lastSweep = 0;
setInterval(() => {
  if (Date.now() - lastSweep > 5000) {
    lastSweep = Date.now();
    sweep();
  }
  for (const t of tables) {
    mutate(t, (x, c) => {
      for (let k = 0; k < 20 && BJ.runDue(x, c); k++);
    });
    botsMove(t);
  }
}, 120);

async function bjState(query) {
  const t = tables.find((x) => x.id === query.get('table'));
  if (!t) throw refuse('no_table', {}, 404);
  const after = Number(query.get('after') ?? -1);
  const rx = query.has('rx')
    ? Number(query.get('rx'))
    : Number.MAX_SAFE_INTEGER;
  const ms = Math.min(Math.max(Number(query.get('wait_ms')) || 0, 0), 20_000);
  if (ms > 0 && t.seq <= after && reactions.seq(t.id) <= rx)
    await new Promise((ok) => {
      const set = waiters.get(t.id) ?? new Set();
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        ok();
      };
      const timer = setTimeout(done, ms);
      set.add(done);
      waiters.set(t.id, set);
    });
  const c = ctx();
  return {
    state: BJ.view(t, ME, c),
    reactions: {
      on: LIMITS.bj_reactions,
      dealer: LIMITS.bj_dealer_reactions,
      ids: [...REACTION_IDS, ...(subStatus === 'yes' ? SUB_REACTION_IDS : [])],
      sub: subStatus,
      ...reactions.view(t.id, Date.now()),
    },
  };
}

function bj(action, body) {
  if (action === 'join') return join(body);
  const t = seatedAt(ME);
  if (action === 'leave') {
    if (!t) return { ok: true, already: true };
    return mutate(t, (x, c) => BJ.leave(x, c, ME));
  }
  if (action === 'announce') return { ok: true, announced: true };
  if (action === 'react') {
    if (!isReactionId(body?.r)) throw refuse('bad_reaction', {}, 400);
    if (!t) throw refuse('not_seated');
    if (isSubReactionId(body.r) && subStatus !== 'yes')
      throw refuse(
        subStatus === 'unknown' ? 'sub_unknown' : 'sub_only',
        {},
        403,
      );
    try {
      const n = reactions.push(t.id, ME, BJ.seatOf(t, ME), body.r, Date.now());
      wake(t);
      return { ok: true, n };
    } catch (e) {
      throw refuse(e.code ?? 'react_rate', e.details ?? {}, e.status ?? 429);
    }
  }
  if (!t) throw refuse('not_seated');
  if (action === 'bet')
    return mutate(t, (x, c) => {
      if (forced.blackjack !== 'random') x.rig = rigFor(x, forced.blackjack);
      return BJ.placeBets(x, c, ME, {
        main: body?.main,
        side: body?.side ?? {},
        ready: body?.ready === true,
      });
    });
  if (action === 'clear') return mutate(t, (x, c) => BJ.clearBets(x, c, ME));
  if (action === 'act')
    return mutate(t, (x, c) =>
      BJ.act(x, c, ME, {
        type: body?.type,
        token: body?.token,
        actionId: body?.action_id,
      }),
    );
  if (action === 'insure')
    return mutate(t, (x, c) =>
      BJ.insure(x, c, ME, {
        stake: body?.stake ?? 0,
        even: body?.even === true,
        actionId: body?.action_id,
      }),
    );
  throw refuse('not_available', {}, 404);
}

/** The Lab's rig (engine.ts applyRig: card VALUES swapped inside the shoe) for the viewer's next deal. */
function rigFor(t, kind) {
  const seat = String(BJ.seatOf(t, ME));
  const rigs = {
    pair: { seats: { [seat]: [8, 8] }, dealer: [6, 10] },
    // Re-split : chaque main 1 reçoit encore un 8, jusqu'à 4 mains ; puis 3, 10 (21), 9, 10, 7, 2.
    resplit: {
      seats: { [seat]: [8, 8] },
      dealer: [6, 10],
      then: [8, 8, 3, 10, 9, 10, 7, 2],
    },
    aces: { seats: { [seat]: [1, 1] }, dealer: [9, 7] },
    blackjack: { seats: { [seat]: [1, 10] }, dealer: [9, 7] },
    insurance: { seats: { [seat]: [10, 9] }, dealer: [1, 10] },
    even: { seats: { [seat]: [1, 10] }, dealer: [1, 7] },
    double: { seats: { [seat]: [6, 5] }, dealer: [6, 10], then: [10] },
    dealer_bust: { seats: { [seat]: [10, 6] }, dealer: [6, 10], then: [10] },
    bust: { seats: { [seat]: [10, 6] }, dealer: [10, 7], then: [10] },
    many: {
      seats: { [seat]: [2, 3] },
      dealer: [6, 10],
      then: [2, 2, 2, 3, 1, 1, 2],
    },
  };
  return rigs[kind] ?? null;
}

// --- The router (shared/api.js `call` in demo mode: method, path with its query, body, idempotency key) ---------------
export async function casinoDemoCall(method, rawPath, body, key) {
  const [path, qs = ''] = String(rawPath).split('?');
  const query = new URLSearchParams(qs);
  if (path === '/session' || path === '/state') return sessionPayload();
  if (method === 'GET' && path === '/modules/v3')
    return structuredClone(HOST_MODULES);
  if (method === 'GET' && path === '/casino/state') return casinoState();
  if (method === 'GET' && path === '/casino/history') return history(query);
  const round = /^\/casino\/rounds\/([^/]+)$/.exec(path);
  if (method === 'GET' && round) {
    const r = rounds.find((x) => x.round_id === decodeURIComponent(round[1]));
    if (!r) throw refuse('round_not_found', {}, 404);
    return {
      round: { ...structuredClone(r), phase: 'done' },
      server_now: new Date().toISOString(),
    };
  }
  if (method === 'GET' && path === '/casino/live') {
    await wait(Math.min(Number(query.get('wait_ms')) || 0, 20_000));
    return { cursor: 0, players: [] };
  }
  if (method === 'GET' && path === '/casino/watch') {
    await wait(Math.min(Number(query.get('wait_ms')) || 0, 20_000));
    return {
      events: [],
      cursor: Number(query.get('after')) || 0,
      reset: false,
    };
  }
  const game = /^\/casino\/(slot|book|roulette)\/spin$/.exec(path);
  if (method === 'POST' && game) {
    await wait(120); // a network's worth: the screens' pending states are visible, never instant
    return spin(game[1], body, key);
  }
  if (
    method === 'POST' &&
    (path === '/casino/progress' ||
      path === '/casino/draft' ||
      path === '/casino/presence')
  )
    return { ok: true };
  if (method === 'POST' && path === '/casino/share') {
    const r = rounds.find((x) => x.round_id === body?.round_id);
    if (!r) throw refuse('round_not_found', {}, 404);
    const already = r.shared;
    r.shared = true;
    return {
      shared: true,
      already,
      text: 'Démo locale : rien n’est envoyé dans le chat.',
    };
  }
  if (method === 'GET' && path === '/casino/bj/tables') return tablesView();
  if (method === 'GET' && path === '/casino/bj/state') return bjState(query);
  const bjm =
    /^\/casino\/bj\/(join|bet|clear|act|insure|leave|announce|react)$/.exec(
      path,
    );
  if (method === 'POST' && bjm) {
    await wait(60);
    return bj(bjm[1], body);
  }
  throw refuse('not_available', {}, 404);
}

// ?casinoGame=<tile id> (casino_blackjack, casino_slot…): opens Mini-jeux then that game as a viewer would (the Hub's
// « Tous » list, then the tile) — the ‹ of the header then goes back to the catalogue and to the Hub, for real.
const wanted = new URLSearchParams(location.search).get('casinoGame');
if (wanted)
  (async () => {
    const find = async (fn) => {
      for (let t = 0; t < 10_000; t += 100) {
        const x = fn();
        if (x) return x;
        await wait(100);
      }
      return null;
    };
    (
      await find(() =>
        [...document.querySelectorAll('.rh-all__item')].find((b) =>
          b.textContent.includes('Mini-jeux'),
        ),
      )
    )?.click();
    (
      await find(() =>
        document.querySelector(`[data-game="${CSS.escape(wanted)}"]`),
      )
    )?.click();
  })();
// Framed by the bench page (which says « Démo locale » around it): the environment badge would hide the header's title.
if (window.top !== window) {
  const style = document.createElement('style');
  style.textContent = '.env-badge { display: none !important; }';
  document.head.append(style);
}

window.__casinoDemo = {
  /** `kind`: slot/book random|loss|line|wild|lines|big|bonus (book: bigbonus too); roulette a number or 'random';
   *  blackjack random|pair|resplit|aces|blackjack|insurance|even|double|dealer_bust|bust|many (the viewer's next deal). */
  next(game, kind) {
    forced[game] =
      game === 'roulette' && kind !== 'random' ? Number(kind) : kind;
  },
  get forced() {
    return { ...forced };
  },
  bots(n) {
    botsWanted = Math.max(0, Math.min(9, Number(n) || 0));
    const t = seatedAt(ME);
    if (t) fillBots(t);
  },
  balance(n) {
    balance = Math.max(0, Math.floor(Number(n) || 0));
  },
  /** Another table with `n` simulated players (default 3); its number. */
  table(n = 3) {
    return otherTable(Math.max(0, Math.min(10, Number(n) || 0))).no;
  },
  /** The demo viewer's subscription (the subscribers' reactions): 'yes' | 'no' | 'unknown'. */
  sub(v) {
    subStatus = ['yes', 'no', 'unknown'].includes(v) ? v : 'yes';
    const t = seatedAt(ME);
    if (t) wake(t);
  },
  /** A simulated player at the viewer's table reacts now (`r`: a reaction id, else at random). */
  react(r) {
    const t = seatedAt(ME);
    const bots = t?.seats.filter((s) => s && isBot(s.user)) ?? [];
    if (!bots.length) return false;
    botReact(t, bots[rng.int(bots.length)], isReactionId(r) ? r : undefined);
    return true;
  },
  /** Close the empty tables now, as the Core does after 10 minutes. */
  sweep() {
    return sweep(Date.now() + Lobby.EMPTY_CLOSE_MS);
  },
  get state() {
    return {
      balance,
      tables: tables.length,
      rounds: rounds.length,
      bots: botsWanted,
    };
  },
};
