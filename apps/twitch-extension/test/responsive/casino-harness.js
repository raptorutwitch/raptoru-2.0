// Casino responsive bench (Lot B § 8) — mounts ONE real game screen (unmodified shared/casino/*.js) in its own
// Shadow DOM, fed a fixture client instead of the Core. No network, no Wallet, no Twitch. Served by casino-bench.mjs
// at /casino-harness.html?game=blackjack&state=split2[&open=rules|hist|histmine].
/* global document, window, URLSearchParams, setTimeout */
import { shell, useSheets, LOADERS } from '/demo/shared/casino/casino.js';
import { installDblclickGuard } from '/demo/shared/dblclick-guard.js';
import { startLayout } from '/demo/app/layout.js';
import * as F from './casino-fixtures.js';
import { buildClient } from './casino-fixture-client.js';

installDblclickGuard();
startLayout(); // --kg/--g/--t, data-mq… the same measurement the rest of the extension uses (app/layout.js)
const q = new URLSearchParams(window.location.search);
const game = q.get('game') || 'blackjack';
const stateId = q.get('state') || 'several';
const open = q.get('open');

function fixtureFor(game, stateId) {
  if (game === 'blackjack') {
    const snapshot = (F.BJ_STATES[stateId] ?? F.BJ_STATES.several)();
    // `mine: 'bench'` makes the lobby's own join logic (client.myTable()) open straight into the fixture table —
    // otherwise mountBlackjack would show the lobby instead of the requested state.
    return {
      client: buildClient('blackjack', {
        casino: { me: { balance: 50_000 }, limits: F.CASINO_LIMITS },
        snapshot,
        tables: F.BJ_TABLES,
        mine: 'bench',
        history: F.BJ_HISTORY,
      }),
      casino: { me: { balance: 50_000 }, limits: F.CASINO_LIMITS },
    };
  }
  if (game === 'slot' || game === 'book') {
    const casino = game === 'slot' ? F.slotCasino() : F.bookCasino();
    const rounds =
      game === 'slot'
        ? F.SLOT_ROUNDS
        : {
            resting: null,
            lineWin: F.SLOT_ROUNDS.lineWin,
            bigWin: F.SLOT_ROUNDS.bigWin,
            loss: F.SLOT_ROUNDS.loss,
          };
    const picked = rounds[stateId] ?? rounds.lineWin;
    const errorId = stateId === 'error' ? 'rate_limited' : null;
    return {
      client: buildClient(game, {
        casino,
        error: errorId,
        spin: () => ({ balance: casino.me.balance, round: picked }),
      }),
      casino,
    };
  }
  // roulette: no table config needed (the mat is fixed client-side); only a plausible spin result.
  const casino = F.rouletteCasino();
  const spot =
    stateId === 'red7'
      ? { number: 7, color: 'red' }
      : stateId === 'black22'
        ? { number: 22, color: 'black' }
        : { number: 0, color: 'green' };
  return {
    client: buildClient('roulette', {
      casino,
      spin: () => ({
        balance: casino.me.balance,
        round: {
          bet: 1000,
          payout: stateId === 'loss' ? 0 : 3600,
          round_id: 'rr1',
          ...spot,
        },
      }),
    }),
    casino,
  };
}

async function main() {
  const { host, D } = shell(document);
  document.body.append(host);
  const { client, casino } = fixtureFor(game, stateId);
  const mountFn = await LOADERS[game]();
  await useSheets(D, game);
  const view = mountFn(D, { client, casino, follow: null, onLeave: () => {} });
  window.__bench = { view, D };
  if (game === 'blackjack' && open) {
    await new Promise((r) => setTimeout(r, 150)); // the table paints once, async, before any class toggle sticks
    const bj = D.querySelector('.bj');
    if (open === 'rules') bj.classList.add('rules-open');
    else if (open === 'hist' || open === 'histmine') {
      D.querySelector('.felt')?.classList.add('hist-open');
      if (open === 'histmine') D.querySelector('[data-htab="mine"]')?.click();
    }
  }
  document.title = `Casino bench — ${game} / ${stateId}`;
  document.body.dataset.ready = '1'; // the matrix script waits on this before screenshotting
}
main();
