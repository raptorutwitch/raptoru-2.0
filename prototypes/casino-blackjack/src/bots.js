// Blackjack (prototype) — les joueurs SIMULÉS du Lab. Ils passent par le même client (latence comprise) que l'écran,
// donc par les mêmes règles du Core : ils ne peuvent rien que l'écran ne puisse.
//   style 'basic' : stratégie de base, temps de réflexion variable · 'afk' : pose une mise mais ne dit jamais PRÊT
//   (le délai de secours l'exclut et lui rend sa mise) · 'leaver' : part au milieu de sa première manche ·
//   'slow' : réfléchit jusqu'à la fin de sa fenêtre de décision.
// Les avatars : un visuel de démonstration ; un joueur sur cinq a une URL cassée (l'écran montre le remplacement).
import * as R from './rules.js';
import { createClient } from './client.js';

/** Un avatar de démonstration (silhouette sur fond coloré), à la place d'une photo Twitch. */
function demoAvatar(k) {
  const hue = (k * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},65%,38%)"/></linearGradient></defs><rect width="40" height="40" fill="url(#b)"/><circle cx="20" cy="16" r="7.5" fill="hsl(${(hue + 180) % 360},35%,88%)"/><path d="M6 40c1-9 7-13 14-13s13 4 14 13z" fill="hsl(${(hue + 180) % 360},30%,80%)"/><circle cx="17.3" cy="15.5" r="1.1" fill="#2a1d40"/><circle cx="22.7" cy="15.5" r="1.1" fill="#2a1d40"/><path d="M17.5 19c1.5 1.2 3.5 1.2 5 0" stroke="#2a1d40" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const NAMES = ['Lyra', 'Mistigri', 'Kobalt', 'Nyx', 'Pistache', 'Zéphyr', 'Moka', 'Orion', 'Biscotte', 'Vega', 'Pixel', 'Tango', 'Sora', 'Quokka', 'Nova'];
let n = 0;

export function createBot(core, { style = 'basic', tableId = null } = {}) {
  const id = `bot${++n}`;
  const name = `${NAMES[(n - 1) % NAMES.length]}${n > NAMES.length ? n : ''}`;
  core.wallet.apply(`lab:init:${id}`, id, 20_000, 'Jetons fictifs');
  const c = createClient(core, { user: id, name });
  let busy = false;
  let latest = null; // le dernier état reçu pendant une réflexion : traité ensuite
  let rounds = 0;
  let stopped = false;
  const think = (a, b) => new Promise((ok) => setTimeout(ok, a + Math.random() * (b - a)));

  async function onState(v) {
    latest = v;
    if (stopped || busy) return;
    latest = null;
    const me = v.seats.find((s) => s?.user === id);
    if (!me) return stop(); // libéré (absent) ou parti
    busy = true;
    try {
      if (v.phase === 'betting' && !me.bet && me.status === 'seated') {
        await think(900, 4200);
        const main = [100, 100, 200, 300, 500, 1000, 2500][Math.floor(Math.random() * 7)];
        const side = {};
        const spots = ['17', '18', '19', '20', '21', 'BJ', 'BUST'];
        if (Math.random() < 0.35) for (let k = 0; k < 1 + Math.floor(Math.random() * 2); k++) side[spots[Math.floor(Math.random() * 7)]] = 10 * (1 + Math.floor(Math.random() * 10));
        rounds++;
        await c.placeBets({ main, side, ready: false }).catch(() => {});
        if (style !== 'afk') {
          await think(400, 1800); // il regarde sa mise, puis PRÊT
          await c.placeBets({ main, side, ready: true }).catch(() => {});
        }
      } else if (v.phase === 'insurance' && me.inRound && me.insurance === null && style !== 'afk') {
        // Stratégie de base : jamais d'assurance (ni d'even money) ; un sur quatre assure quand même, pour la démo.
        await think(700, 2500);
        const max = Math.floor(me.hands[0].stake / 2);
        await c.insure({ stake: Math.random() < 0.25 && !me.hands[0].natural ? max : 0, actionId: `${v.roundId}:ins` }).catch(() => {});
      } else if (v.phase === 'players' && v.turn && v.seats[v.turn.seat]?.user === id) {
        if (style === 'afk') return; // ne répond jamais : le timer joue RESTER pour lui
        if (style === 'leaver') {
          await think(600, 1200);
          await c.leave().catch(() => {});
          return stop();
        }
        const window = v.turn.deadline - v.turn.startsAt;
        await (style === 'slow' ? think(window - 2500, window - 600) : think(800, 2800));
        const hand = me.hands[v.turn.hand];
        const raw = { cards: hand.cards.map((x) => x.id), stake: hand.stake, fromSplit: hand.fromSplit, splitAces: hand.splitAces, done: hand.done };
        const allowed = R.actions(raw, { handsCount: me.hands.length, balance: c.balance() });
        const up = v.dealer.cards[0].id;
        const type = R.basicStrategy(raw, up, allowed);
        await c.act({ type: allowed[type] ? type : 'stand', token: v.turn.token, actionId: `${v.turn.token}:${type}` }).catch(() => {});
      }
    } finally {
      busy = false;
      if (latest && !stopped) void onState(latest);
    }
  }
  function stop() {
    stopped = true;
    c.unwatch();
  }
  return {
    id,
    name,
    style,
    async start() {
      const avatar = n % 5 === 0 ? 'https://avatars.invalid/raptoru-demo.png' : demoAvatar(n);
      const j = await c.join({ ...(tableId ? { tableId } : {}), avatar });
      await c.watch(j.table, (v) => void onState(v));
      return j;
    },
    async remove() {
      stop();
      await c.leave().catch(() => {});
    },
    get stopped() {
      return stopped;
    },
  };
}
