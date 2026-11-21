// Casino responsive bench (Lot B § 8) — fictitious states for the four games, hand-authored (no Core, no network,
// no Wallet). Shapes match what the Core's redacted view actually sends (apps/core-api/src/casino/*), read from the
// server code and apps/core-api/test/casino-blackjack.test.ts, not guessed. Never used by the shipped extension.

let cid = 0;
/** A card as the Core sends it (rules.ts cardView): rank/suit as text, red precomputed, never a raw int here. */
export function card(rank, suit, hidden = false) {
  return { id: cid++, rank, suit, red: suit === '♥' || suit === '♦', hidden };
}
const total21 = (cards) => {
  let t = 0;
  let aces = 0;
  for (const c of cards) {
    const v =
      c.rank === 'A'
        ? 1
        : ['K', 'Q', 'J', '10'].includes(c.rank)
          ? 10
          : Number(c.rank);
    t += v;
    if (v === 1) aces++;
  }
  const soft = aces > 0 && t + 10 <= 21;
  return { total: soft ? t + 10 : t, soft };
};
/** A hand: cards + stake, with its total/soft/verdict/payout precomputed (as the Core sends it). */
export function hand(cards, stake, extra = {}) {
  const { total, soft } = total21(cards.filter((c) => !c.hidden));
  return {
    cards,
    stake,
    total,
    soft,
    doubled: false,
    fromSplit: false,
    splitAces: false,
    done: false,
    natural: cards.length === 2 && total === 21,
    ...extra,
  };
}
/** A seat: null (empty) or a player with 0..4 hands (0 before the deal). */
export function seat(
  name,
  {
    me = false,
    hands = [],
    bet = null,
    status = 'seated',
    inRound = true,
    result = null,
    connected = true,
  } = {},
) {
  return {
    me,
    user: me ? 'me' : `v_${name}`,
    name,
    avatar: null,
    connected,
    status,
    inRound,
    hands,
    bet,
    side: null,
    sideCount: 0,
    insurance: null,
    result,
  };
}
const EMPTY10 = () => Array.from({ length: 10 }, () => null);
// The Core's view gives each seat its index (`seat: i`, engine.ts view()): isMyTurn() compares it to turn.seat.
const put = (arr, seats) => {
  const out = EMPTY10();
  seats.forEach((s, i) => (out[i] = { ...s, seat: i }));
  return out;
};

const BASE = {
  table: 'bench',
  no: 1,
  round: 1,
  roundId: 1,
  shoe: { size: 416, dealt: 40, shuffling: false },
  turn: null,
  insurance: null,
  betDeadline: null,
  ready: 0,
  waiting: 0,
  history: [],
  timing: { showMs: 8000 },
  limits: { mainMin: 100, bj_announce: false },
};
let seq = 0;
const snap = (over) => ({ ...BASE, seq: ++seq, now: Date.now(), ...over });

export const BJ_STATES = {
  empty: () =>
    snap({
      phase: 'betting',
      dealer: { cards: [], natural: false, total: 0 },
      seats: put(EMPTY10(), [seat('Toi', { me: true, hands: [], bet: null })]),
      ready: 0,
      waiting: 1,
      betDeadline: Date.now() + 20_000,
    }),

  several: () =>
    snap({
      phase: 'betting',
      dealer: { cards: [], natural: false, total: 0 },
      seats: put(EMPTY10(), [
        seat('Toi', { me: true, bet: { main: 200, ready: false } }),
        seat('Nova_', { bet: { main: 100, ready: true } }),
        seat('K7lo', { bet: { main: 500, ready: true } }),
        seat('Zarielle', { bet: null }),
      ]),
      ready: 2,
      waiting: 2,
      betDeadline: Date.now() + 12_000,
    }),

  full: () =>
    snap({
      phase: 'players',
      dealer: {
        cards: [card('9', '♣'), card('?', '?', true)],
        natural: false,
        total: 9,
      },
      seats: put(
        EMPTY10(),
        Array.from({ length: 10 }, (_, i) =>
          seat(i === 0 ? 'Toi' : `Viewer${i}`, {
            me: i === 0,
            hands: [hand([card('10', '♦'), card('6', '♠')], 100)],
            bet: { main: 100, ready: true },
          }),
        ),
      ),
      turn: {
        seat: 3,
        hand: 0,
        token: 't1',
        startsAt: Date.now(),
        deadline: Date.now() + 15_000,
      },
    }),

  myTurn: () =>
    snap({
      phase: 'players',
      dealer: {
        cards: [card('6', '♠'), card('?', '?', true)],
        natural: false,
        total: 6,
      },
      seats: put(EMPTY10(), [
        seat('Toi', {
          me: true,
          hands: [hand([card('8', '♥'), card('7', '♣')], 200)],
        }),
        seat('Nova_', { hands: [hand([card('K', '♠'), card('9', '♦')], 100)] }),
      ]),
      turn: {
        seat: 0,
        hand: 0,
        token: 'turn1',
        startsAt: Date.now(),
        deadline: Date.now() + 15_000,
      },
    }),

  blackjackHand: () =>
    snap({
      phase: 'settled',
      outcome: 19,
      dealer: {
        cards: [card('10', '♣'), card('9', '♦')],
        natural: false,
        total: 19,
      },
      seats: put(EMPTY10(), [
        seat('Toi', {
          me: true,
          hands: [
            hand([card('A', '♠'), card('K', '♥')], 100, {
              done: true,
              verdict: 'blackjack',
              payout: 250,
            }),
          ],
          result: { side: {}, insurance: null, net: 150 },
        }),
      ]),
    }),

  // BJ-01/BJ-07 (post-live audit) : deux mains, chacune sa place, son total, sa mise ; la seconde encore à jouer.
  split2: () =>
    snap({
      phase: 'players',
      dealer: {
        cards: [card('6', '♠'), card('?', '?', true)],
        natural: false,
        total: 6,
      },
      seats: put(EMPTY10(), [
        seat('Toi', {
          me: true,
          hands: [
            hand([card('8', '♥'), card('10', '♦')], 100, {
              fromSplit: true,
              done: true,
            }),
            hand([card('8', '♣')], 100, { fromSplit: true }),
          ],
        }),
        seat('Nova_', { hands: [hand([card('K', '♠'), card('9', '♦')], 100)] }),
      ]),
      turn: {
        seat: 0,
        hand: 1,
        token: 'turn2',
        startsAt: Date.now(),
        deadline: Date.now() + 15_000,
      },
    }),

  // BJ-07 : une main perdue, l'autre gagnée, net 0 — jamais affiché « Égalité ».
  splitMixed: () =>
    snap({
      phase: 'settled',
      outcome: 20,
      dealer: {
        cards: [card('6', '♠'), card('10', '♦'), card('4', '♣')],
        natural: false,
        total: 20,
      },
      seats: put(EMPTY10(), [
        seat('Toi', {
          me: true,
          hands: [
            hand([card('8', '♥'), card('10', '♦')], 100, {
              fromSplit: true,
              done: true,
              verdict: 'lose',
              payout: 0,
            }),
            hand([card('8', '♣'), card('3', '♦'), card('10', '♥')], 100, {
              fromSplit: true,
              done: true,
              verdict: 'win',
              payout: 200,
            }),
          ],
          result: { side: {}, insurance: null, net: 0 },
        }),
      ]),
    }),

  dealerBlackjack: () =>
    snap({
      phase: 'settled',
      outcome: 'BJ',
      dealer: {
        cards: [card('A', '♠'), card('K', '♦')],
        natural: true,
        total: 21,
      },
      seats: put(EMPTY10(), [
        seat('Toi', {
          me: true,
          hands: [
            hand([card('9', '♥'), card('8', '♣')], 100, {
              done: true,
              verdict: 'lose',
              payout: 0,
            }),
          ],
          result: { side: {}, insurance: null, net: -100 },
        }),
        seat('Nova_', {
          hands: [
            hand([card('A', '♦'), card('Q', '♠')], 100, {
              done: true,
              verdict: 'push',
              payout: 100,
            }),
          ],
          result: { side: {}, insurance: null, net: 0 },
        }),
      ]),
    }),

  spectator: () =>
    snap({
      phase: 'players',
      dealer: {
        cards: [card('6', '♠'), card('?', '?', true)],
        natural: false,
        total: 6,
      },
      seats: put(EMPTY10(), [
        seat('Nova_', { hands: [hand([card('K', '♠'), card('9', '♦')], 100)] }),
        seat('K7lo', { hands: [hand([card('7', '♥'), card('6', '♣')], 200)] }),
      ]),
      turn: {
        seat: 1,
        hand: 0,
        token: 'spect1',
        startsAt: Date.now(),
        deadline: Date.now() + 15_000,
      },
    }),
};

export const BJ_TABLES = [
  {
    id: 'bench',
    no: 1,
    seats: 10,
    players: 2,
    phase: 'betting',
    taken: [true, true, false, false, false, false, false, false, false, false],
  },
];

/** My history (A9), a few rounds already behind a session-reset point (prefixed to pick any slice in the picker). */
export const BJ_HISTORY = Array.from({ length: 6 }, (_, i) => {
  const bet = 100;
  const net = [100, -100, 0, 250, -100, 100][i];
  return {
    round_id: `r${i}`,
    game: 'blackjack',
    bet,
    payout: bet + net,
    net,
    capped: false,
    created_at: new Date(Date.now() - i * 900_000).toISOString(),
    shared: i === 4,
    table: 1,
    round: 40 - i,
    dealer: i === 3 ? 'BUST' : 19,
  };
});

/** `casino.me`/`casino.limits` (the fields the four games actually read — apps/core-api/src/casino/service.ts state()). */
export const CASINO_LIMITS = {
  mainMin: 100,
  bj_announce: false,
  slot_min_bet: 20,
  slot_max_bet: 10_000,
  book_min_bet: 20,
  book_max_bet: 1_000,
  roulette_step: 100,
  roulette_max_total: 100_000,
  roulette_all_in_max_win: 0,
  max_win: 1_000_000,
  share_cooldown_s: 300,
};
export const baseCasino = (extra = {}) => ({
  availability: {
    open: true,
    games: { slot: true, book: true, roulette: true, blackjack: true },
  },
  limits: CASINO_LIMITS,
  me: { balance: 50_000, resume: null, resume_book: null, share_ready_in_s: 0 },
  players: [],
  live_cursor: -1,
  server_now: new Date().toISOString(),
  ...extra,
});

// --- Machine à sous (SYMBOLS/LINES copiés tels quels de apps/core-api/src/casino/slot.ts — un vrai symbole, un vrai
// gain ; les bandes (STRIPS) sont synthétiques ici, le calibrage exact du RTP n'a aucun intérêt pour un banc visuel. */
export const SLOT_SYMBOLS = [
  { id: 'cerise', name: 'Cerise', pays: { 3: 40, 4: 115, 5: 350 } },
  { id: 'citron', name: 'Citron', pays: { 3: 35, 4: 115, 5: 350 } },
  { id: 'raisin', name: 'Raisin', pays: { 3: 65, 4: 225, 5: 700 } },
  { id: 'cloche', name: 'Cloche', pays: { 3: 175, 4: 550, 5: 1750 } },
  { id: 'bar', name: 'BAR', pays: { 3: 350, 4: 1250, 5: 4500 } },
  {
    id: 'diamant',
    name: 'Diamant',
    pays: { 2: 25, 3: 750, 4: 3000, 5: 10000 },
  },
  { id: 'sept', name: '7', pays: { 2: 50, 3: 1500, 4: 6000, 5: 25000 } },
  {
    id: 'wild',
    name: 'WILD',
    wild: true,
    pays: { 3: 1000, 4: 5000, 5: 50000 },
  },
  { id: 'bonus', name: 'BONUS', scatter: true, pays: {} },
];
export const SLOT_LINES = [
  { name: 'Haut', rows: [0, 0, 0, 0, 0] },
  { name: 'Milieu', rows: [1, 1, 1, 1, 1] },
  { name: 'Bas', rows: [2, 2, 2, 2, 2] },
  { name: 'V', rows: [0, 1, 2, 1, 0] },
  { name: 'V inversé', rows: [2, 1, 0, 1, 2] },
  { name: 'Creux', rows: [1, 2, 2, 2, 1] },
  { name: 'Bosse', rows: [1, 0, 0, 0, 1] },
  { name: 'Montée', rows: [2, 2, 1, 0, 0] },
  { name: 'Descente', rows: [0, 0, 1, 2, 2] },
  { name: 'Rampe', rows: [2, 1, 1, 1, 0] },
];
const cyc = (ids, n) =>
  Array.from({ length: n }, (_, i) => ids[i % ids.length]);
export const SLOT_STRIPS = Array.from({ length: 5 }, () =>
  cyc(
    [
      'cerise',
      'citron',
      'raisin',
      'cloche',
      'bar',
      'diamant',
      'sept',
      'wild',
      'bonus',
    ],
    20,
  ),
);

export const slotCasino = () =>
  baseCasino({
    tables: {
      slot: { symbols: SLOT_SYMBOLS, lines: SLOT_LINES, strips: SLOT_STRIPS },
    },
  });
/** A spin result "as the reels' view expects it" (slot.js asSpin): resting, one line win (Haut, cerises), a bigger
 * multi-line win, or nothing (loss) — stops picked so the grid actually shows the claimed symbols on that line. */
// The grid the Core derives from the stops (apps/core-api/src/casino/slot.ts): 3 rows read down each strip.
const gridOf = (stops) =>
  stops.map((s, r) =>
    [0, 1, 2].map((row) => SLOT_STRIPS[r][(s + row) % SLOT_STRIPS[r].length]),
  );
export const SLOT_ROUNDS = {
  resting: null,
  lineWin: {
    bet: 100,
    payout: 140,
    round_id: 'sr1',
    outcome: {
      stops: [0, 0, 0, 3, 3],
      grid: gridOf([0, 0, 0, 3, 3]),
      line_win: 40,
      lines: [
        {
          line: 0,
          symbol: 'cerise',
          count: 3,
          cells: [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
          win: 40,
          wilds: [],
        },
      ],
      scatter: { count: 0, cells: [], win: 0 },
    },
  },
  bigWin: {
    bet: 100,
    payout: 1750,
    round_id: 'sr2',
    outcome: {
      stops: [7, 0, 0, 0, 3],
      grid: gridOf([7, 0, 0, 0, 3]),
      line_win: 1750,
      lines: [
        {
          line: 0,
          symbol: 'sept',
          count: 4,
          cells: [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ],
          win: 1150,
          wilds: [[0, 0]],
        },
        {
          line: 6,
          symbol: 'cerise',
          count: 3,
          cells: [
            [0, 1],
            [1, 0],
            [2, 0],
          ],
          win: 40,
          wilds: [[0, 1]],
        },
      ],
      scatter: { count: 0, cells: [], win: 0 },
    },
  },
  loss: {
    bet: 100,
    payout: 0,
    round_id: 'sr3',
    outcome: {
      stops: [1, 4, 6, 2, 5],
      grid: gridOf([1, 4, 6, 2, 5]),
      line_win: 0,
      lines: [],
      scatter: { count: 0, cells: [], win: 0 },
    },
  },
};

// --- Machine à émotes (symboles p1..p4/c1..c5 + bonus : réels, copiés de apps/core-api/src/casino/book.ts). ---------
export const BOOK_PAYS = {
  p1: { 2: 10, 3: 100, 4: 1000, 5: 5000 },
  p2: { 2: 5, 3: 40, 4: 400, 5: 2000 },
  p3: { 2: 5, 3: 30, 4: 100, 5: 750 },
  p4: { 2: 5, 3: 30, 4: 100, 5: 750 },
  c1: { 3: 5, 4: 40, 5: 150 },
  c2: { 3: 5, 4: 40, 5: 150 },
  c3: { 3: 5, 4: 25, 5: 100 },
  c4: { 3: 5, 4: 25, 5: 100 },
  c5: { 3: 5, 4: 25, 5: 100 },
};
export const BOOK_SCATTER_PAYS = { 3: 2, 4: 20, 5: 200 };
export const BOOK_LINES = SLOT_LINES;
export const BOOK_STRIPS = Array.from({ length: 5 }, () =>
  cyc(['p1', 'p2', 'p3', 'p4', 'c1', 'c2', 'c3', 'c4', 'c5', 'bonus'], 20),
);
export const bookCasino = () =>
  baseCasino({
    tables: {
      book: {
        strips: BOOK_STRIPS,
        lines: BOOK_LINES,
        pays: BOOK_PAYS,
        scatter_pays: BOOK_SCATTER_PAYS,
        free_games: 10,
      },
    },
  });

// --- Roulette : seulement casino.me/limits (le tapis 0-36 est fixe côté client, jamais une config du Core). --------
export const rouletteCasino = () => baseCasino();
