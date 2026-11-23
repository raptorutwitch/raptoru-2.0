// Casino V1 — the multiplayer blackjack (docs/CASINO.md § 12): the validated prototype's screen
// (prototypes/casino-blackjack/src/view.js) unchanged in its layout, rules display and gestures, on the Core's real
// tables. The Core (apps/core-api/src/casino/blackjack/) deals, times, validates and pays; this screen only sends
// intents (sit, bet, PRÊT, an action with its turn token, insurance) and shows the redacted state it is given — the
// hole card and the shoe's order never reach it. A refresh shows the table as the Core has it (no animation replayed).
import * as R from './bj-rules.js';
import { SIDE_LABEL, SIDE_SPOTS, betProblem, oddsText, sideReturn } from './bj-paytable.js';
import { avatarHTML, repairAvatars } from './bj-avatar.js';
import { Sfx } from './bj-sfx.js';
import { createReactions, pickDealerReaction } from './bj-reactions.js';
import * as Frame from './frame.js';

const fmt = (n) => Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
/** Montant condensé façon table, SANS arrondi (retour d'Antoni du 21/11 : 1 250 s'affichait « 1K2 ») :
 * 200 · 1K · 1K25 · 12K5 · 1M2 ; trop de chiffres pour rester court → le montant exact. */
export function kfmt(n) {
  if (n < 1000) return String(n);
  const [u, d] = n >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const rest = String(n % u).padStart(String(u).length - 1, '0').replace(/0+$/, '');
  return rest.length > 3 ? fmt(n) : `${Math.floor(n / u)}${d}${rest}`;
}
const signedTxt = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CHIPS = [100, 500, 1000, 5000, 25000];
const TONES = [[25000, 't25k'], [5000, 't5k'], [1000, 't1k'], [500, 't500'], [100, 't100'], [50, 't50'], [0, 't10']];
const tone = (v) => TONES.find(([min]) => v >= min)[1];
const PHASE = { betting: 'Mises', shuffle: 'Nouveau sabot', dealing: 'Distribution', insurance: 'Assurance', players: 'Décisions', dealer: 'La banque joue', settled: 'Résultats' };
/**
 * Le résultat de la MAIN PRINCIPALE seule (paris banque et assurance à part) : jamais confondu avec le net total.
 * Après un Split, les verdicts peuvent différer (une gagnée, une perdue) pour un net qui retombe à zéro : ce n'est
 * jamais une « Égalité » (BJ-07) — `kind` devient `mixed`, affiché par ses mains plutôt que par un seul mot.
 */
export function mainResult(p) {
  const hands = p.hands ?? [];
  const stake = hands.reduce((a, h) => a + h.stake, 0);
  const paid = hands.reduce((a, h) => a + (h.payout ?? 0), 0);
  const v = hands.map((h) => h.verdict);
  const kind = v.includes('even') ? 'even' : v.length <= 1 || v.every((x) => x === v[0]) ? v[0] : 'mixed';
  return { stake, paid, net: paid - stake, kind };
}
// « Gain assuré » (retour d'Antoni du 21/11) : le libellé français de l'even money — un gain 1:1, jamais un « +0 ».
const KIND = { blackjack: 'Blackjack', even: 'Gain assuré', win: 'Gagné', push: 'Égalité', lose: 'Perdu', bust: 'Bust' };
/**
 * A9 : le bilan « Mes manches » depuis la remise à zéro — un compteur purement local (jamais une opération Wallet),
 * recalculé à partir des manches réelles du Core (`rounds`, les plus récentes en premier, chacune avec `created_at`
 * et `net`). `resetAt` : l'horodatage (ms, horloge du Core) du dernier « Effacer le total ».
 */
export function sessionSummary(rounds, resetAt) {
  const kept = rounds.filter((r) => Date.parse(r.created_at) >= resetAt);
  return { count: kept.length, net: kept.reduce((a, r) => a + r.net, 0) };
}
const OUT = (o, d) => (o === 'BJ' ? 'Blackjack' : o === 'BUST' ? `Bust (${d})` : String(o));
const ERR = {
  not_seated: 'Assieds-toi pour miser : un spectateur ne peut rien engager.',
  betting_closed: 'Les mises sont fermées : tu joueras la prochaine manche.',
  bets_locked: 'Tu es prêt : tes mises sont verrouillées pour cette manche.',
  insufficient_balance: 'Solde insuffisant.',
  insufficient_tokens: 'Solde insuffisant.',
  no_table: 'Cette table n’existe plus.',
  bad_seat: 'Place inconnue.',
  bad_insurance: 'Assurance : la moitié de ta mise au plus.',
  no_insurance_now: 'L’assurance n’est plus proposée.',
  already_answered: 'Tu as déjà répondu.',
  not_your_turn: 'Ce n’est pas ton tour.',
  too_late: 'Trop tard : le temps était écoulé, ta main est restée.',
  not_allowed: 'Action impossible maintenant.',
  core_unavailable: 'Le Casino ne répond pas : réessaie dans un instant.',
  network_error: 'Connexion perdue…',
  bad_main_bet: 'Mise principale : 100 minimum.',
  bad_side_bet: 'Pari banque : en multiples de 10.',
  table_full: 'Cette table est complète.',
  seat_taken: 'Cette place vient d’être prise.',
  casino_full: 'Toutes les tables sont pleines.',
  tables_cap: 'Toutes les tables autorisées pour l’instant sont ouvertes : rejoins-en une (une de plus s’ouvrira quand elles seront bien remplies).',
  react_rate: 'Doucement : une réaction toutes les deux secondes.',
};
const why = (e, L) =>
  e?.code === 'bad_main_bet'
    ? `Mise principale : ${fmt(L?.mainMin ?? 100)} minimum, par pas de ${L?.step ?? 10}.`
    : e?.code === 'bad_side_bet'
      ? `Pari banque : ${fmt(L?.sideMin ?? 10)} minimum, par pas de ${L?.step ?? 10}.`
      : e?.code === 'max_win'
    ? `Gain possible trop élevé (splits et doubles compris) : mise de ${fmt(Math.max(L?.mainMin ?? 100, e.max ?? 0))} au plus${e.max < (L?.mainMin ?? 100) ? ' — retire des paris banque' : ''}.`
    : e?.code === 'side_max_return'
        ? `Paris banque : ${fmt(e.max)} de retour au plus par manche.`
        : ERR[e?.code] ?? Frame.REFUSAL[e?.code] ?? 'Ça n’a pas marché : réessaie.';
const SILENT = new Set(['stale_turn', 'no_decision_now']);

const cardHTML = (c, k) =>
  c.hidden
    ? `<span class="card back" data-k="${k}"></span>`
    : `<span class="card${c.red ? ' red' : ''}" data-k="${k}"><b>${c.rank}</b><i>${c.suit}</i><em>${c.suit}</em></span>`;
/** Une pile de jetons dessinée (les plus grosses valeurs en bas), au plus 5 disques. */
function stackHTML(amount) {
  const discs = [];
  let left = amount;
  for (const v of [25000, 5000, 1000, 500, 100, 50, 10])
    while (left >= v && discs.length < 5) {
      discs.push(v);
      left -= v;
    }
  return discs.map((v, i) => `<i class="disc ${tone(v)}" style="--i:${i}"></i>`).join('');
}
const SEAT_HTML = '<span class="tag"></span><div class="hand"><span class="ms"></span><button type="button" class="sb" data-main hidden aria-label="Ma place : poser le jeton choisi"><span class="sb__stack"></span><b class="sb__amt"></b></button></div><div class="pl"><span class="avw"></span><span class="nm"></span></div><div class="bet"></div><i class="tm"></i>';
const totText = (h) => (h.cards.length ? (h.soft && h.total < 21 ? `${h.total - 10}/${h.total}` : String(h.total)) : '');

/** Dans la case : « BJ » pour Blackjack (le nom complet au survol). Libellé seul : le pari reste `BJ`. */
const SHORT = { ...SIDE_LABEL, BJ: 'BJ' };
/** Gain net d'un pari banque gagné (le retour, mise comprise, est sideReturn). */
const sideNet = (k, v) => sideReturn(k, v) - v;
/** Le feutre : la zone intérieure est une ellipse de demi-axes (largeur du tapis, ARC_B) dont le bas touche le bord.
 * Le même calcul place les places sur la courbe (bj.css .felt::before). */
const ARC_B = 201;
const SVG = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  rules: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.6"/><path d="M12 16.8v.2"/>',
  shield: '<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  clear: '<path d="M6 6l12 12M18 6 6 18"/>',
  rebet: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  hit: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M12 9v6M9 12h6"/>',
  stand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 13.5a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
  double: '<rect x="3" y="6" width="10" height="14" rx="1.8"/><path d="M8 6V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
  split: '<path d="M12 21v-7M12 14 6 8M12 14l6-6M6 3v5h5M18 3v5h-5"/>',
  leave: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
  tables: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8.7 13.3 6.6 3.9M15.3 6.8l-6.6 3.9"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4.2h4.2"/><ellipse cx="12" cy="12" rx="2" ry="2.9"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.2a4.5 4.5 0 0 0 7 0"/><path d="M9.2 9.6v.4M14.8 9.6v.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>`;
let uidN = 0;

/** Les règles (retour d'Antoni du 21/11 : un accordéon, des textes courts) — exactement ce que fait le Core
 * (apps/core-api/src/casino/blackjack : rules.ts, engine.ts, paytable.ts) ; les cotes viennent de la grille elle-même. */
const RULES = [
  ['Blackjack', 'Approche <b>21</b> sans le dépasser et fais mieux que la banque. Un <b>blackjack</b>, c’est un As et une carte qui vaut 10, en 2 cartes : payé <b>3:2</b> (100 → +150). Une main gagnée est payée 1:1, une égalité te rend ta mise. Mise principale dès 100, par pas de 10.'],
  ['Valeur des cartes', 'De 2 à 10 : leur valeur. Valet, Dame et Roi valent <b>10</b>. L’As vaut <b>11</b>, ou <b>1</b> si 11 te ferait dépasser 21 : « 7/17 » veut dire que ta main vaut 7 ou 17.'],
  ['Tour de la banque', 'Elle joue après tous les joueurs : elle <b>tire jusqu’à 16</b> et <b>reste dès 17</b>, même un 17 avec un As. Si elle dépasse 21, toutes les mains encore en jeu gagnent. Avec un As ou une carte de 10 visible, elle regarde d’abord si elle a blackjack : si oui, la manche est réglée aussitôt.'],
  ['Tirer / Rester', '<b>Tirer</b> : une carte de plus. <b>Rester</b> : tu gardes ta main. Au-delà de 21, ta main est perdue (bust), même si la banque saute ensuite. Sans réponse à temps, ta main reste.'],
  ['Doubler', 'Sur tes 2 premières cartes : ta mise double et tu reçois <b>une seule carte</b>, puis ta main s’arrête. Permis après un Split, sauf sur des As splittés.'],
  ['Split', 'Deux cartes de même valeur (deux 8, ou un Roi et une Dame) : sépare-les en deux mains, chacune avec la même mise. Chaque main reçoit <b>automatiquement sa 2ᵉ carte</b> : la main 1 tout de suite, la main 2 quand vient son tour. Tu joues ensuite <b>une main à la fois</b> (celle au premier plan, les autres attendent derrière) : Tirer, Rester et Doubler ne touchent qu’elle. Jusqu’à <b>4 mains</b>. As splittés : une seule carte chacun, ni nouveau Split ni Doubler. Un 21 fait après un Split n’est pas un blackjack (payé 1:1).'],
  ['Assurance', 'Proposée quand la banque montre un <b>As</b>. Tu mises jusqu’à <b>la moitié</b> de ta mise principale ; elle paie <b>2:1 seulement si la banque a blackjack</b>, sinon tu la perds et ta main continue.<span class="ex">Exemple : mise 200, assurance 100. Banque blackjack : ta main perd 200, l’assurance rapporte +200 net (payée 2:1 : 300 rendus), bilan 0. Pas de blackjack : l’assurance perd 100, ta main se joue normalement.</span>Elle ne protège que du blackjack de la banque, jamais d’une défaite.'],
  ['Gain assuré (Even money)', 'Tu as un blackjack et la banque montre un As. <b>Gain assuré</b> : ta main est payée <b>1:1 tout de suite</b> (mise 200 → +200), quoi qu’ait la banque. Sinon, tu gardes ta chance du <b>3:2</b> (+300)… mais si la banque a aussi blackjack, c’est une égalité (+0, mise rendue).'],
  ['Paris sur le score de la banque', `Avant la donne, en plus de ta main, parie sur le résultat final de la banque : ${SIDE_SPOTS.map((k) => `${SIDE_LABEL[k]} <b>${oddsText(k)}</b>`).join(' · ')}. « 11:2 » = 11 gagnés pour 2 misés (100 → +550). Dès 10 par pari.`],
  ['Quitter la table', 'Avant la donne, tu repars avec ta mise. En pleine manche, ta mise reste engagée : ta main est jouée par Rester et payée normalement au règlement.'],
];

/** Un écran de blackjack dans `host`. `client` : createClient() ; `onTitle(text)`. */
export function createTableView(host, { client, spectator = false, canAnnounce = () => false, onTitle = () => {}, log = () => {} }) {
  const uid = `bj${++uidN}`;
  host.innerHTML = `
    <div class="bj" data-phase="lobby">
      <section class="lobby" hidden></section>
      <section class="tbl" hidden>
        <div class="felt">
          <div class="shoe" data-shoe aria-label="Sabot"><i></i><small></small></div>
          <div class="dealer"><div class="cards big" data-zone="dealer"></div><span class="tot" data-tot="dealer"></span></div>
          <div class="sides" role="group" aria-label="Pari sur le score de la banque">
            <svg class="sides__arc" aria-hidden="true"><path id="${uid}-arc" fill="none"/><text><textPath href="#${uid}-arc" startOffset="50%" text-anchor="middle">Pari sur le score de la banque</textPath></text></svg>
            <p class="sides__t">Pari sur le score de la banque</p>
            ${SIDE_SPOTS.map((k) => `<button type="button" class="side" data-side="${k}"${SHORT[k] !== SIDE_LABEL[k] ? ` data-full="${SIDE_LABEL[k]}"` : ''}><b>${SHORT[k]}</b><small><i>paye </i>${oddsText(k)}</small><span class="sv"></span></button>`).join('')}
          </div>
          <div class="spot" aria-live="polite"></div>
          <div class="cart" hidden></div>
          <div class="seats"></div>
          <div class="myseat" aria-label="Ta place"></div>
          <div class="tabs">
            <button type="button" class="rtab" data-rules aria-label="Règles du jeu">${icon('rules')}<span>Règles</span></button>
            <button type="button" class="htab" data-hist aria-label="Historique des manches">${icon('clock')}<span>Historique</span><i class="hn"></i></button>
          </div>
          <aside class="hist" aria-label="Historique des manches">
            <header><b>${icon('clock')}Historique</b><button type="button" class="ic" data-hist aria-label="Fermer">✕</button></header>
            <div class="htabs" role="tablist" aria-label="Quel historique">
              <button type="button" class="htabbtn on" data-htab="table" role="tab" aria-selected="true">Cette table</button>
              <button type="button" class="htabbtn" data-htab="mine" role="tab" aria-selected="false">Mes manches</button>
            </div>
            <div class="hist__list"></div>
          </aside>
          <div class="fly" aria-hidden="true"></div>
          <div class="tip" role="tooltip" hidden></div>
        </div>
        <div class="bar"></div>
      </section>
      <aside class="rules" aria-label="Règles du jeu"><header><b>Règles</b><button type="button" class="ic" data-rules aria-label="Fermer">✕</button></header>
        <div class="rules__list">${RULES.map(([t, body]) => `<details class="rule" name="${uid}-rule"><summary>${t}</summary><p>${body}</p></details>`).join('')}</div></aside>
      <div class="toast" role="status"></div>
    </div>`;
  const $ = (q) => host.querySelector(q);
  const bj = $('.bj');
  const felt = $('.felt');
  const bar = $('.bar');
  const spot = $('.spot');
  const seatsEl = $('.seats');
  const mineEl = $('.myseat');
  const tip = $('.tip');
  // Tous les écouteurs de cet écran tombent avec lui (un écran recréé sur le même cadre ne double aucun clic).
  const life = new AbortController();
  const sig = { signal: life.signal };
  repairAvatars(host, life.signal);
  // Les réactions (bj-reactions.js) : activées seulement quand le Core les annonce avec l'état de la table.
  const rx = createReactions({
    root: bj,
    felt,
    seatsEl,
    seatEl: (seat) => host.querySelector(`.seat[data-seat="${seat}"]`),
    mySeat: () => mine()?.seat ?? null,
    send: (id) => client.react(id),
    toast: (t, bad) => toast(t, bad),
    prefs: Frame.prefs('casino:bj:reactions', { muted: false }),
    signal: life.signal,
  });
  // Le cadre change de taille (format panneau) : places et arc des paris banque se recalculent.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => st && mode === 'table' && paint(null, false)) : null;
  ro?.observe(felt);

  let st = null; // le dernier état du Core
  let lastSeq = -1;
  let offset = 0; // horloge du Core − horloge locale
  let mode = 'lobby';
  let tableId = null;
  let chip = 100;
  let custom = null; // le jeton libre
  let draft = { main: 0, side: {} };
  let undo = []; // ['main' | case, valeur]
  let dirty = false; // des jetons posés pas encore envoyés au Core
  let syncT = null;
  let lastBet = null;
  let pending = false;
  let typing = false;
  let destroyed = false;
  let toastT = null;
  let tipT = null;
  let tickedFor = '';
  let serverBet = '';
  let layout = []; // l'ordre des places affichées : figé pendant une manche (personne ne bouge)
  let centreSeat = null; // la place dont la main est montrée en grand au centre (paint)
  const open = new Set(); // les manches dépliées dans l'historique
  // A9/A10 : « Mes manches » (CAS-01/BJ-05) — le Core garde déjà l'historique du viewer et son partage ; l'onglet
  // ne fait que les lire. Le point de départ du compteur de session est local (aucun stockage serveur nécessaire) :
  // « Effacer le total » ne touche jamais le Wallet, seulement où ce compteur recommence à additionner.
  let histTab = 'table';
  let myHist = null; // les manches du viewer (Core), chargées à l'ouverture de l'onglet seulement
  const sessionPrefs = Frame.prefs('casino:bj:session', { resetAt: 0 });
  const now = () => Date.now() + offset;
  const L = () => st?.limits;
  const mine = () => st?.seats.find((x) => x?.me) ?? null;

  function toast(text, bad = false) {
    const t = $('.toast');
    t.textContent = text;
    t.className = `toast show${bad ? ' bad' : ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.className = 'toast'), 2600);
  }
  const fail = (e) => !SILENT.has(e?.code) && toast(why(e, L()), true);

  // --- Le salon : chaque table montre ses 10 places ; une place libre se choisit d'un clic --------------------------
  async function lobby() {
    mode = 'lobby';
    bj.dataset.phase = 'lobby';
    client.unwatch();
    tableId = null;
    $('.tbl').hidden = true;
    $('.lobby').hidden = false;
    onTitle('Blackjack');
    lobbyHtml = '';
    await paintLobby(true);
  }
  // Le salon se met à jour seul (mandat du 21/11, B) : une table ouverte, rejointe ou fermée ailleurs apparaît sans
  // recharger — toutes les 6 s tant qu'il est à l'écran, jamais redessiné quand rien n'a changé.
  let lobbyT = null;
  let lobbyHtml = '';
  async function paintLobby(first = false) {
    clearTimeout(lobbyT);
    const LB = $('.lobby');
    let tables = [];
    try {
      tables = await client.tables();
    } catch (e) {
      if (first) fail(e);
    }
    if (destroyed || mode !== 'lobby') return;
    lobbyT = setTimeout(() => !destroyed && mode === 'lobby' && !globalThis.document?.hidden && void paintLobby(), 6000);
    const my = client.myTable();
    // La politique des tables du Core (mandat du 21/11, B) : absente d'un Core plus ancien → pas de « Nouvelle table ».
    const cr = client.createInfo();
    const html = `
      <header><b>Tables de blackjack</b><small>8 paquets · jusqu’à 10 joueurs · chacun contre la banque · mise dès 100</small><button type="button" class="btn rules-lnk" data-rules title="Règles du jeu" aria-label="Règles du jeu">${icon('rules')}Règles</button></header>
      <div class="tlist">${
        tables
          .map((t) => {
            // Une ligne par table (retour d'Antoni du 21/11) : son numéro, ses joueurs, son état, l'œil pour regarder,
            // Rejoindre sur la même ligne. Les petites places restent pour choisir la sienne (souris, grand écran).
            const full = t.players >= t.seats;
            const act =
              t.id === my
                ? `<button type="button" class="btn go" data-open="${t.id}">Ma table</button>`
                : spectator || my
                  ? ''
                  : full
                    ? '<span class="tfull">Complète</span>'
                    : `<button type="button" class="btn go" data-join="${t.id}">Rejoindre</button>`;
            return `<div class="trow${t.id === my ? ' mine' : ''}"><span class="tno">Table ${t.no}</span><span class="tph"><b>${t.players}/${t.seats}</b> · ${t.players ? PHASE[t.phase] ?? '' : 'libre'}</span><span class="dots" title="${spectator || my ? '' : 'Choisis ta place'}">${(t.taken ?? []).map((on, i) => `<button type="button" class="${on ? 'on' : ''}" ${!on && !spectator && !my ? `data-join="${t.id}" data-seat="${i}" title="Place ${i + 1}"` : 'disabled'}></button>`).join('')}</span>${t.id === my ? '' : `<button type="button" class="ic eye" data-watch="${t.id}" title="Regarder la table ${t.no} (spectateur)" aria-label="Regarder la table ${t.no}">${icon('eye')}</button>`}${act}</div>`;
          })
          .join('') || '<p class="none">Aucune table ouverte pour l’instant.</p>'
      }</div>
      ${spectator || my ? '' : `<div class="lacts"><button type="button" class="btn go wide" data-join="">${tables.length ? 'Trouver une place' : 'Ouvrir une table'}</button>${cr && tables.length ? `<button type="button" class="btn newt" data-newtable${cr.allowed ? '' : ' disabled'} title="${cr.allowed ? 'Ouvrir une nouvelle table : seul contre la banque, et les autres peuvent la rejoindre' : esc(ERR.tables_cap)}">${icon('plus')}Nouvelle table</button>` : ''}</div>`}
      <p class="fine">Seul contre la banque ou à plusieurs : la donne part dès que tous les joueurs assis sont prêts. Une table en pleine manche : tu joues la suivante. ${cr ? `Nouvelle table : ${cr.open} ouverte${cr.open > 1 ? 's' : ''} sur ${cr.cap} possibles pour l’instant ; chaque table reste ouverte à tous.` : 'Une nouvelle table s’ouvre quand les autres sont complètes.'}</p>`;
    if (html !== lobbyHtml) LB.innerHTML = lobbyHtml = html;
  }
  let joining = false; // un double-clic sur « S'asseoir » (BJ-02/A3) : la même demande, jamais deux
  async function join(id, seat = null, newTable = false) {
    if (joining) return;
    joining = true;
    try {
      const j = await client.join(id ? { tableId: id, ...(seat !== null ? { seat } : {}) } : { newTable });
      if (j.already && (id || newTable) && j.table !== id) toast('Tu es déjà assis à une autre table.');
      else if (j.reused) toast(`La table ${j.no} était libre : tu y es seul contre la banque.`);
      else if (j.nextRound) toast('Tu rejoindras la manche suivante.');
      if (j.created && canAnnounce()) setTimeout(() => askAnnounce(j.table), 600);
      if (j.resumed) toast('Tu reprends ta place : ta main a continué sans toi.');
      await openTable(j.table);
    } catch (e) {
      fail(e);
    } finally {
      joining = false;
    }
  }
  /** The table this viewer just opened: a small optional dialog — never a message without an explicit click. */
  function askAnnounce(tableId) {
    if (destroyed || host.querySelector('.ann')) return;
    const d = document.createElement('div');
    d.className = 'ann';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Annoncer la table');
    d.innerHTML = `<div class="ann__box"><b>Une table de blackjack vient d’ouvrir !</b><small>Tu veux prévenir le chat ?</small><div class="ann__acts"><button type="button" class="btn go" data-ann="yes">Annoncer dans le chat</button><button type="button" class="btn" data-ann="no">Non merci</button></div></div>`;
    bj.append(d);
    d.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ann]');
      if (!b) return;
      d.remove();
      if (b.dataset.ann !== 'yes') return;
      try {
        const r = await client.announce(tableId);
        toast(r?.already ? 'Cette table a déjà été annoncée.' : 'LeCroupier_ annonce la table dans le chat.');
      } catch (err) {
        toast(err?.code === 'announce_cooldown' ? 'Une table vient déjà d’être annoncée : réessaie plus tard.' : 'L’annonce n’a pas pu partir (le jeu continue normalement).', true);
      }
    });
  }
  /** A small confirm dialog (same visual family as the table-announce prompt); resolves with the clicked value. */
  function modal(html, buttons) {
    return new Promise((resolve) => {
      if (destroyed || host.querySelector('.ann')) return resolve(null);
      const d = document.createElement('div');
      d.className = 'ann';
      d.setAttribute('role', 'dialog');
      d.innerHTML = `<div class="ann__box">${html}<div class="ann__acts">${buttons.map(([v, label, cls]) => `<button type="button" class="btn${cls ? ` ${cls}` : ''}" data-x="${esc(v)}">${label}</button>`).join('')}</div></div>`;
      bj.append(d);
      d.addEventListener('click', (e) => {
        const b = e.target.closest('[data-x]');
        if (!b) return;
        d.remove();
        resolve(b.dataset.x);
      });
    });
  }
  /**
   * Quitter (décision d'Antoni du 21/11, comportement du Core `leave()` inchangé) : on quitte l'AFFICHAGE, jamais le
   * règlement déjà en cours. Rien d'engagé (mises, avant la donne : le Core rend la mise ; ou en attente de la
   * manche suivante) → départ immédiat. Une main en jeu → une confirmation : la mise reste engagée jusqu'au règlement
   * (RESTER à l'échéance) et le joueur peut revenir la retrouver. Après départ : spectateur de la table.
   */
  let quitting = false; // un double appui sur Quitter = une seule demande (la 2e affichait « pas assis »)
  async function doQuit() {
    const me = mine();
    if (!me || me.status === 'left' || quitting) return;
    quitting = true;
    try {
      // Une mise engagée = une manche donnée et pas encore réglée (après le règlement, plus rien n'est en jeu).
      if (me.inRound && st.phase !== 'betting' && st.phase !== 'settled') {
        const ok = await modal('<b>Quitter la table ?</b><small>Ta mise reste engagée jusqu’au règlement de cette manche : ta main est jouée (RESTER) et payée normalement. Tu peux revenir la retrouver avant la fin.</small>', [['no', 'Rester', ''], ['yes', 'Quitter quand même', 'go']]);
        if (ok !== 'yes') return;
      }
      const r = await client.leave();
      toast(r.engaged && st.phase !== 'settled' ? 'Table quittée : ta mise reste engagée jusqu’au règlement.' : r.refunded ? 'Table quittée : ta mise t’est rendue.' : 'Table quittée.');
    } catch (e) {
      fail(e);
    } finally {
      quitting = false;
    }
  }
  async function openTable(id) {
    mode = 'table';
    tableId = id;
    $('.lobby').hidden = true;
    $('.tbl').hidden = false;
    lastSeq = -1;
    st = null;
    layout = [];
    rx.reset();
    await client.watch(id, onState, (R) => tableId === id && rx.receive(R), () => {
      // Une table vide fermée par le Core (mandat du 21/11, B) : retour au salon, sans rien perdre.
      if (tableId !== id || destroyed) return;
      toast('Cette table vient de fermer (plus personne n’y jouait).');
      void lobby();
    });
  }

  // --- L'état du Core -----------------------------------------------------------------------------------------
  function onState(next, { live }) {
    if (destroyed || next.table !== tableId) return;
    if (next.seq <= lastSeq) return; // doublon ou plus ancien : jamais d'animation ni de paiement rejoué
    const animate = live && lastSeq >= 0 && next.seq > lastSeq && next.seq - lastSeq <= 8;
    const prev = st;
    st = next;
    lastSeq = next.seq;
    offset = next.now - Date.now();
    const me = mine();
    if (next.phase === 'betting' && prev?.phase !== 'betting') {
      const was = prev?.seats.find((s) => s?.me);
      if (was?.bet?.ready) lastBet = { main: was.bet.main, side: { ...(was.side ?? {}) } };
      draft = { main: 0, side: {} };
      undo = [];
      dirty = false;
    }
    const sig2 = next.phase === 'betting' && me?.bet ? JSON.stringify([next.round, me.bet.main, me.side, me.bet.ready]) : '';
    if (sig2 && sig2 !== serverBet && !dirty && !typing) draft = { main: me.bet.main, side: { ...(me.side ?? {}) } };
    serverBet = sig2;
    onTitle(`Blackjack · Table ${next.no}`);
    paint(prev, animate);
    if (animate) sounds(next);
    // Split (retour d'Antoni du 21/11) : la 2ᵉ carte de chaque main est une règle du moteur, distribuée sans clic — on le dit.
    const ev = next.last;
    // Une seule fois par manche (mandat du 21/11, A2 : pas de répétition) — la pile montre ensuite chaque main.
    if (animate && me && ev?.seat === me.seat && me.hands.length > 1) {
      if (ev.type === 'split' && me.hands.length === 2) toast(`Split : tu joues la main ${ev.hand + 1} d’abord ; la main ${ev.hand + 2} recevra sa 2ᵉ carte à son tour.`);
      else if (ev.type === 'card' && ev.auto && ev.hand === 1) toast('Main 2 : sa 2ᵉ carte est distribuée automatiquement (règle du Split).');
    }
    if (animate && next.last?.type === 'peek') toast(me?.insurance?.stake ? `Pas de blackjack pour la banque : assurance perdue (−${fmt(me.insurance.stake)}), la main continue.` : 'Pas de blackjack pour la banque : la main continue.');
    if (animate && next.phase === 'settled' && prev?.phase !== 'settled') {
      payFlights(next);
      setTimeout(() => !destroyed && st === next && rx.dealer(pickDealerReaction(next, L()?.mainMin)), 900);
    }
    log(next.last);
  }

  // --- Dessin --------------------------------------------------------------------------------------------------
  function cardsInto(el, cards, keyPrefix, fresh) {
    const want = cards.map((c, i) => ({ c, k: `${keyPrefix}:${c.hidden ? 'h' : c.id}:${i}` }));
    const have = new Map([...el.children].map((x) => [x.dataset.k, x]));
    const out = [];
    want.forEach(({ c, k }, i) => {
      let node = have.get(k);
      if (!node) {
        const flipFrom = [...have.values()].find((x) => x.classList.contains('back') && Number(x.dataset.k.split(':').pop()) === i);
        const tmp = document.createElement('div');
        tmp.innerHTML = cardHTML(c, k);
        node = tmp.firstElementChild;
        if (flipFrom && !c.hidden) node.dataset.flip = '1';
        fresh?.push(node);
      }
      have.delete(k);
      out.push(node);
    });
    for (const x of have.values()) x.remove();
    out.forEach((node, i) => el.children[i] !== node && el.insertBefore(node, el.children[i] ?? null));
    el.style.setProperty('--n', String(cards.length));
  }

  function paint(prev, animate) {
    const s = st;
    if (!s) return;
    bj.dataset.phase = s.phase;
    const me = mine();
    const fresh = [];
    bj.classList.toggle('is-spect', !me);
    bj.classList.toggle('my-turn', !!me && turnOf(s)?.seat === me.seat);
    $('.shoe small').textContent = s.shoe.shuffling ? '…' : String(s.shoe.size - s.shoe.dealt);
    $('.shoe').dataset.tip = s.shoe.shuffling ? 'Nouveau sabot : 8 paquets mélangés' : `Sabot : ${s.shoe.size - s.shoe.dealt} cartes sur ${s.shoe.size}|8 paquets · remélangé au dernier quart`;
    $('.shoe').classList.toggle('mixing', !!s.shoe.shuffling);
    $('.htab .hn').textContent = s.history.length ? String(s.history.length) : '';
    const df = [];
    cardsInto($('[data-zone="dealer"]'), s.dealer.cards, `d${s.roundId}`, df);
    fresh.push(...df);
    const dt = $('[data-tot="dealer"]');
    // Bust (mandat d'Antoni du 22/11) : UN seul signal, le ruban diagonal « BUST » sur la main (.cards.is-bust) ; le score
    // reste lisible, en rouge, sans répéter le mot.
    $('[data-zone="dealer"]').classList.toggle('is-bust', s.dealer.total > 21);
    dt.textContent = s.dealer.cards.length ? (s.dealer.natural ? 'BJ' : String(s.dealer.total)) : '';
    dt.className = `tot${s.dealer.natural ? ' is-bj' : s.dealer.total > 21 ? ' bust' : ''}`;
    // Le joueur dont la main est au centre (mandat du 21/11, A3) : sa place se fait discrète (pseudo, repère, petites
    // cartes), sans répéter score, mise ni étiquette déjà au centre. Pas quand le centre parle d'autre chose.
    const tt = turnOf(s);
    centreSeat = tt && !(me && !me.inRound) ? tt.seat : null;
    paintSeats(s, fresh);
    paintSides(s, me); // après les places : l'arc du portrait dépend de .has-hero
    paintSpot(s, fresh, me);
    paintBar(s, me);
    if (felt.classList.contains('hist-open') && histTab === 'table') paintHistory();
    if (animate) animateCards(fresh, prev);
    if (animate && s.phase === 'settled' && prev?.phase !== 'settled') spot.querySelector('.msg.res')?.classList.add('go');
  }

  /** Les 7 scores de la banque, en arc autour d'elle (comme les cases imprimées d'une vraie table). */
  function paintSides(s, me) {
    const betting = s.phase === 'betting' && me?.status === 'seated' && !me.bet?.ready;
    const side = s.phase === 'betting' ? draft.side : me?.side ?? {};
    const settled = s.phase === 'settled';
    const box = $('.sides');
    box.classList.toggle('live', betting);
    box.classList.toggle('quiet', !betting && !Object.keys(side).length && !settled);
    // L'arc : 7 cases identiques, droites, symétriques autour de l'axe de la banque, sur une parabole qui passe sous
    // ses cartes (les bords remontent à leur hauteur) ; le titre suit la même courbe, dessous. Panneau étroit : grille.
    const W = felt.clientWidth || 547;
    const H = felt.clientHeight || 364;
    // Portrait (téléphone, mandat du 21/11, F) : 4 + 3 grandes cases symétriques sous leur titre — au doigt, bien plus
    // lisibles qu'un arc de 7 cases de 44 px. Panneau étroit : la même grille. Paysage bas mais large (844 × 390) :
    // l'arc revient, large et peu profond, de part et d'autre de la banque (une rangée plate de 7 cases sur toute la
    // largeur écrasait la banque, minuscule, au-dessus d'une barre).
    const hero = felt.classList.contains('has-hero');
    const flat = hero || W < 420 || (H < 300 && W < 600);
    box.classList.toggle('flat', flat);
    // De l'air entre les cartes de la banque, les cases et leur titre (retour d'Antoni du 21/11) : la rangée descend
    // (bord 50, flèche 42 au lieu de 40/40), et suit l'échelle --kg comme les cartes qu'elle contourne.
    const kg = Number.parseFloat(getComputedStyle(felt).getPropertyValue('--kg')) || 1;
    // La rangée de la banque est plus basse en hauteur moyenne ou basse (bj.css) : l'arc et son titre s'y calent
    // toujours (sinon ils débordaient sur le centre, sous les mains d'un Split).
    const fit = Math.min(1, (box.clientHeight || 136 * kg) / (136 * kg));
    const span = Math.min(210 * kg, W / 2 - 41);
    const [yEdge, depth] = [50 * kg * fit, 42 * kg * fit];
    const cx = W / 2;
    felt.querySelectorAll('[data-side]').forEach((b, i) => {
      if (flat) return void ((b.style.left = ''), (b.style.top = ''));
      const u = (i - 3) / 3;
      b.style.left = `${Math.round(cx + span * u)}px`;
      b.style.top = `${Math.round(yEdge + depth * (1 - u * u))}px`;
    });
    // Une parabole exacte = une courbe de Bézier quadratique (contrôle au double de la flèche).
    // Le titre : sous les cases, avec de l'air (retour d'Antoni du 21/11 : sur PC, il touchait presque les cases).
    const ty = yEdge + 39 * kg * fit;
    $('.sides__arc path').setAttribute('d', flat ? '' : `M${cx - span} ${ty} Q${cx} ${ty + 2 * depth} ${cx + span} ${ty}`);
    for (const b of felt.querySelectorAll('[data-side]')) {
      const k = b.dataset.side;
      const v = side[k] ?? 0;
      const hit = settled && String(s.outcome) === k;
      // Gagné : le gain NET (le retour brut, mise comprise, est dans la bulle et l'historique).
      b.querySelector('.sv').innerHTML = v ? (hit ? `+${kfmt(sideNet(k, v))}` : kfmt(v)) : '';
      b.classList.toggle('has', !!v);
      b.classList.toggle('hit', hit);
      b.classList.toggle('won', hit && !!v);
      b.classList.toggle('lost', settled && !!v && !hit);
      b.disabled = !betting;
      b.setAttribute('aria-label', `Banque ${SIDE_LABEL[k]}, paye ${oddsText(k)}${v ? `, ta mise ${fmt(v)}` : ''}`);
      if (!betting && SIDE_LABEL[k] !== SHORT[k]) b.title = SIDE_LABEL[k];
      else b.removeAttribute('title');
    }
  }

  // --- Les places : seulement les joueurs, en arc, à une taille qui dépend de leur nombre -------------------------
  function paintSeats(s, fresh) {
    const occupied = s.seats.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    // Entre deux manches, la table se recompose ; pendant une manche, personne n'apparaît ni ne bouge.
    if (s.phase === 'betting' || !layout.length) layout = occupied.filter((i) => s.phase === 'betting' || s.seats[i].inRound || s.seats[i].me);
    else layout = layout.filter((i) => s.seats[i]);
    const later = occupied.filter((i) => !layout.includes(i)).length;
    const W = felt.clientWidth || 547;
    const narrow = W < 420;
    // Portrait (téléphone, retour d'Antoni du 21/11) : MA place quitte le carrousel et s'affiche en grand juste
    // au-dessus des commandes (mes cartes, ma mise, mon cercle de mise) ; les autres restent dans le carrousel.
    const meSeat = layout.find((i) => s.seats[i]?.me);
    const hero = narrow && (felt.clientHeight || 0) >= 430 && meSeat !== undefined;
    felt.classList.toggle('has-hero', hero);
    const others = hero ? layout.filter((i) => i !== meSeat) : layout;
    const n = Math.max(1, others.length);
    // Téléphone / panneau étroit, plus de 3 joueurs : un carrousel (une rangée qu'on fait glisser du doigt) de places
    // à taille confortable, au lieu de 2 rangées de places minuscules ; recentré sur qui joue (ou sur moi).
    const carousel = narrow && n > 3;
    seatsEl.classList.toggle('carousel', carousel);
    const perRow = carousel ? n : narrow ? (n > 4 ? 3 : n) : n;
    // La place grandit un peu sur un grand écran (plein écran 1080p : rien ne grandissait, audit UI-02) avec la même
    // échelle --kg que le reste de l'extension (clamp 0,85-1,15) : le plafond ci-dessous suit --kg, la largeur réelle
    // (ligne suivante) continue de protéger les petites tailles.
    const kg = Number.parseFloat(getComputedStyle(felt).getPropertyValue('--kg')) || 1;
    // Beaucoup de joueurs sur une table large (paysage 844, plein écran) : la largeur en plus élargit leurs places
    // (mandat du 21/11, F : 10 places de 50 px laissaient un tiers du tapis vide).
    const max = (narrow ? (n <= 3 ? 96 : 60) : n <= 2 ? 128 : n <= 3 ? 116 : n <= 5 ? 92 : n <= 7 ? 70 : W >= 760 ? 70 : 50) * kg;
    const gap = carousel ? 8 : n >= 9 ? 4 : 8;
    const sw = carousel ? Math.round(88 * kg) : Math.floor(Math.min(max, (W - 28 - gap * (perRow - 1)) / perRow));
    seatsEl.style.setProperty('--sw', `${sw}px`);
    seatsEl.style.setProperty('--gap', `${gap}px`);
    seatsEl.style.setProperty('--mw', `${Math.max(18, Math.min(carousel ? 24 : narrow ? 21 : 28, Math.round(sw * 0.3)))}px`);
    seatsEl.style.setProperty('--av', `${Math.max(14, Math.min(20, Math.round(sw * 0.17)))}px`);
    seatsEl.dataset.size = carousel ? 'l' : n <= 3 ? 'xl' : n <= 5 ? 'l' : n <= 7 ? 'm' : 's';
    const have = new Map([...seatsEl.querySelectorAll('.seat'), ...mineEl.querySelectorAll('.seat')].map((x) => [Number(x.dataset.seat), x]));
    const nodes = others.map((i, k) => {
      let el = have.get(i);
      if (!el) {
        el = document.createElement('div');
        el.className = 'seat';
        el.dataset.seat = String(i);
        el.innerHTML = SEAT_HTML;
      }
      have.delete(i);
      // L'arc : chaque place est posée sur la courbe du feutre (même ellipse que .felt::before), juste au-dessus.
      const dx = ((k % perRow) - (perRow - 1) / 2) * (sw + gap);
      const lift = ARC_B * (Math.sqrt(Math.max(0, 1 - (dx / W) ** 2)) - 1);
      el.style.setProperty('--lift', narrow ? '0px' : `${lift.toFixed(1)}px`);
      paintSeat(el, s, i, fresh);
      return el;
    });
    // Ma place en grand (portrait) : le même nœud, simplement posé dans .mine (rien n'est recréé, aucune animation rejouée).
    if (hero) {
      let heroNode = have.get(meSeat);
      if (!heroNode) {
        heroNode = document.createElement('div');
        heroNode.className = 'seat';
        heroNode.dataset.seat = String(meSeat);
        heroNode.innerHTML = SEAT_HTML;
      }
      have.delete(meSeat);
      heroNode.style.removeProperty('--lift');
      paintSeat(heroNode, s, meSeat, fresh);
      if (heroNode.parentNode !== mineEl) mineEl.replaceChildren(heroNode);
    }
    for (const x of have.values()) x.remove();
    nodes.forEach((node, k) => seatsEl.children[k] !== node && seatsEl.insertBefore(node, seatsEl.children[k] ?? null));
    if (carousel) centerSeat(s);
    // Les places libres ne prennent pas de place : une pastille discrète (et, pour un arrivant, « manche suivante »).
    let extra = seatsEl.querySelector('.freepill');
    const free = s.seats.filter((x) => !x).length;
    const label = later ? `+${later} à la manche suivante` : free && !mine() ? `${free} libre${free > 1 ? 's' : ''}` : '';
    if (!label) extra?.remove();
    else {
      if (!extra) {
        extra = document.createElement('span');
        extra.className = 'freepill';
      }
      extra.textContent = label;
      seatsEl.append(extra);
    }
  }
  /** Carrousel : la place de qui joue (sinon la mienne) au centre, une fois par changement — jamais contre le doigt
   * du viewer qui fait défiler entre deux tours. */
  let centered = '';
  function centerSeat(s) {
    const target = s.phase === 'players' && s.turn ? s.turn.seat : (mine()?.seat ?? null);
    if (target !== null && mineEl.querySelector(`.seat[data-seat="${target}"]`)) return;
    const key = `${s.roundId}:${s.phase === 'players' ? s.turn?.seat : 'me'}:${target}`;
    if (target === null || key === centered) return;
    const el = seatsEl.querySelector(`.seat[data-seat="${target}"]`);
    if (!el) return;
    const smooth = centered !== '';
    centered = key;
    requestAnimationFrame(() => seatsEl.scrollTo({ left: el.offsetLeft - (seatsEl.clientWidth - el.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' }));
  }
  function paintSeat(el, s, i, fresh) {
    const p = s.seats[i];
    const turn = s.turn?.seat === i && s.phase === 'players';
    const hi = turn ? s.turn.hand : Math.max(0, p.hands.length - 1);
    const multi = p.hands.length > 1;
    const allBusted = p.hands.length > 0 && p.hands.every((x) => x.total > 21);
    const myBetting = p.me && s.phase === 'betting' && p.status === 'seated';
    el.className = `seat${p.me ? ' me' : ''}${turn ? ' turn' : ''}${p.status === 'left' ? ' left' : ''}${!p.connected ? ' off' : ''}${!p.inRound && s.phase !== 'betting' ? ' wait' : ''}${s.phase === 'betting' && p.bet?.ready ? ' ready' : ''}${allBusted ? ' busted' : ''}${myBetting ? ' betting' : ''}${multi ? ' multi' : ''}${centreSeat === i ? ' focus' : ''}`;
    const avw = el.querySelector('.avw');
    const avKey = `${p.user}|${p.avatar ?? ''}`;
    if (avw.dataset.k !== avKey) {
      avw.dataset.k = avKey;
      avw.innerHTML = avatarHTML(p);
    }
    el.querySelector('.nm').innerHTML = `${p.me ? '<b>Toi</b>' : esc(p.name)}${!p.connected ? ' <i class="ic-off" title="Déconnecté">⏻</i>' : ''}`;
    el.title = `${p.name}${p.status === 'left' ? ' — parti : sa main reste (RESTER) et sera payée' : ''}${!p.connected ? ' — déconnecté' : ''}`;
    // Après un Split : une place mini par main (BJ-01), jamais une seule main avec la mise additionnée. La place active
    // (celle à jouer) est marquée `.cur` ; sans Split, c'est la même carte unique qu'avant.
    const hand = el.querySelector('.hand');
    hand.classList.toggle('multi', multi);
    hand.style.setProperty('--k', String(Math.max(1, p.hands.length))); // bj.css : la largeur de chaque main
    const list = p.hands.length ? p.hands : [null];
    let subs = [...hand.querySelectorAll('.subhand')];
    while (subs.length < list.length) {
      const sub = document.createElement('div');
      sub.className = 'subhand';
      sub.innerHTML = '<div class="cards mini"></div><span class="tot"></span><span class="hbet"></span>';
      hand.insertBefore(sub, hand.querySelector('.ms'));
      subs.push(sub);
    }
    while (subs.length > list.length) subs.pop().remove();
    list.forEach((hd, k) => {
      const sub = subs[k];
      sub.classList.toggle('cur', !!hd && turn && hi === k);
      const fr = [];
      cardsInto(sub.querySelector('.cards'), hd ? hd.cards : [], `s${i}:${s.roundId}:${k}`, fr);
      fresh.push(...fr);
      const tot = sub.querySelector('.tot');
      sub.querySelector('.cards').classList.toggle('is-bust', !!hd && hd.total > 21);
      tot.textContent = hd?.cards.length ? (hd.natural ? 'BLACKJACK' : hd.total > 21 ? String(hd.total) : totText(hd)) : '';
      // `is-bj`, jamais `bj` : `.bj` est la racine de la table (position absolue, inset 0) et étirait l'étiquette.
      tot.className = `tot${hd?.natural ? ' is-bj' : hd && hd.total > 21 ? ' bust' : ''}`;
      const hbet = sub.querySelector('.hbet');
      hbet.hidden = !multi;
      hbet.textContent = multi && hd ? kfmt(hd.stake) : '';
    });
    // Ma place pendant les mises : le cercle où poser mes jetons (ma pile, mon montant).
    const sb = el.querySelector('.sb');
    sb.hidden = !myBetting;
    if (myBetting) {
      const amt = draft.main;
      const st2 = sb.querySelector('.sb__stack');
      if (st2.dataset.v !== String(amt)) {
        st2.dataset.v = String(amt);
        st2.innerHTML = stackHTML(amt);
      }
      sb.querySelector('.sb__amt').textContent = amt ? kfmt(amt) : '';
      sb.classList.toggle('has', !!amt);
      sb.disabled = !!p.bet?.ready;
    }
    // Les autres pendant les mises : leur petite pile.
    const ms = el.querySelector('.ms');
    const pile = s.phase === 'betting' && p.bet && !myBetting ? `${p.bet.main}` : '';
    if (ms.dataset.v !== pile) {
      ms.dataset.v = pile;
      ms.innerHTML = pile ? stackHTML(p.bet.main) : '';
    }
    const stake = p.hands.length ? p.hands.reduce((a, x) => a + x.stake, 0) : (myBetting ? draft.main : p.bet?.main) ?? 0;
    const sides = myBetting ? Object.keys(draft.side).length : p.sideCount;
    // La mise : une étiquette ; aux résultats, la même étiquette devient le résultat NET de la manche.
    const r = s.phase === 'settled' ? p.result : null;
    const bet = el.querySelector('.bet');
    if (r) {
      // Le résultat de SA MAIN (sa couleur, son montant) ; les paris banque et l'assurance sont dans la bulle. Après
      // un Split aux verdicts opposés (BJ-07) : jamais « Égalité » — « 2 mains ±0 », le détail est au centre.
      const m = mainResult(p);
      const extra = [...Object.entries(r.side ?? {}).map(([k, x]) => `pari ${SIDE_LABEL[k]} ${signedTxt(x.payout - x.stake)}`), ...(r.insurance ? [`assurance ${signedTxt(r.insurance.payout - r.insurance.stake)}`] : [])];
      const perHand = p.hands.length > 1 ? `${p.hands.map((hd, k) => `main ${k + 1} ${KIND[hd.verdict] ?? ''}`).join(' · ')} · ` : '';
      bet.title = `${perHand}main ${signedTxt(m.net)}${extra.length ? ` · ${extra.join(' · ')} · bilan ${signedTxt(r.net)}` : ''}`;
      if (extra.length) {
        // Assurance ou paris banque (retour d'Antoni du 21/11 : « −5 000 » ici, « 0 » dans l'historique) : l'étiquette
        // dit le BILAN de la manche, comme l'historique ; le détail (main, assurance, paris) est au centre et au survol.
        bet.className = `bet res ${r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push'}`;
        bet.innerHTML = `<small>bilan</small>${r.net > 0 ? `+${kfmt(r.net)}` : r.net < 0 ? `−${kfmt(-r.net)}` : '±0'}`;
      } else {
        const cls = m.kind === 'mixed' ? (m.net > 0 ? 'win' : m.net < 0 ? 'lose' : 'push') : ({ blackjack: 'blackjack', even: 'win', win: 'win', push: 'push', lose: 'lose', bust: 'lose' }[m.kind] ?? 'push');
        bet.className = `bet res ${cls}`;
        const label = m.net > 0 ? `+${kfmt(m.net)}` : m.net < 0 ? `−${kfmt(-m.net)}` : m.kind === 'mixed' ? '±0' : 'Égalité';
        bet.innerHTML = `${m.kind === 'blackjack' ? '<small>BJ</small>' : m.kind === 'mixed' ? `<small>${p.hands.length} mains</small>` : ''}${label}`;
      }
    } else {
      bet.className = 'bet';
      bet.removeAttribute('title');
      bet.innerHTML = stake
        ? `<i class="chipdot ${tone(stake)}"></i>${kfmt(stake)}${sides ? '<small title="Paris sur la banque">B</small>' : ''}${p.insurance?.stake ? `<small class="ins" title="Assurance ${fmt(p.insurance.stake)}">A</small>` : p.insurance?.even ? '<small class="ins" title="Gain assuré (even money) : payé 1:1">1:1</small>' : ''}${s.phase === 'betting' && p.bet?.ready ? '<em title="Prêt">✓</em>' : ''}`
        : s.phase === 'betting' ? '<span class="muted">…</span>' : '';
    }
    // L'étiquette au-dessus de la place : JOUE (joueur actif), BUSTED, ou « parti ».
    const tag = el.querySelector('.tag');
    const tg = turn ? 'joue' : p.status === 'left' ? 'left' : '';
    if (tag.dataset.v !== tg) {
      tag.dataset.v = tg;
      tag.className = `tag${tg ? ` ${tg}` : ''}`;
      tag.textContent = { joue: 'Joue', left: 'Parti' }[tg] ?? '';
    }
  }

  // --- Le centre : ce qui se passe ; pendant les décisions, le joueur actif ---------------------------------------
  /** Le joueur dont c'est le tour — ou, entre deux décisions (une carte en route, la main suivante qui reçoit sa 2ᵉ
   * carte), celui qui vient d'agir : le Core n'a pas encore rendu le tour, mais c'est toujours sa main qu'on regarde. */
  function turnOf(s) {
    if (s.phase !== 'players') return null;
    if (s.turn) return { seat: s.turn.seat, hand: s.turn.hand, between: false };
    const l = s.last;
    const p = Number.isInteger(l?.seat) ? s.seats[l.seat] : null;
    if (!p?.inRound || !p.hands.length) return null;
    return { seat: l.seat, hand: Math.min(Number(l.hand) || 0, p.hands.length - 1), between: true };
  }
  function paintSpot(s, fresh, me) {
    const tt = turnOf(s);
    let html = '';
    let key = '';
    const tally = `${s.ready}/${s.ready + s.waiting} prêt${s.ready > 1 ? 's' : ''}`;
    if (me && !me.inRound && s.phase !== 'betting') {
      key = `later:${s.round}`;
      html = `<div class="msg"><b>Tu rejoindras la manche suivante</b><small>ta place t’attend · regarde la manche en cours</small></div>`;
    } else if (s.phase === 'betting') {
      key = `bet:${s.round}:${!!me}:${me?.bet?.ready}:${tally}`;
      html = me?.status === 'seated' && !me.bet?.ready
        ? `<div class="msg"><b>Faites vos jeux</b><small class="hint">choisis un jeton · touche ta place ou un score de la banque</small><small class="tally">${tally}</small><span class="safety"></span></div>`
        : `<div class="msg"><b>${me?.bet?.ready ? 'Prêt ✓' : 'Faites vos jeux'}</b><small class="tally">${tally}</small><span class="safety"></span></div>`;
    } else if (s.phase === 'insurance') {
      const answered = s.seats.filter((x) => x?.inRound && x.insurance).length;
      const inRound = s.seats.filter((x) => x?.inRound).length;
      key = `ins:${s.round}:${answered}:${me?.insurance ? 1 : 0}`;
      const mine = me?.inRound && me.insurance === null;
      const h0 = mine ? me.hands[0] : null;
      const nat = !!h0?.natural;
      const max = h0 ? Math.floor(h0.stake / 2) : 0;
      // Retour d'Antoni du 21/11 : ce qu'on accepte réellement, en Jetons NETS (moteur du Core : assurance payée 2:1 =
      // 3 × la mise d'assurance rendue ; gain assuré = la main payée 1:1 ; blackjack = 3:2).
      const txt = !mine
        ? 'La banque montre un As : chacun peut s’assurer.'
        : nat
          ? `Blackjack contre un As. Gain assuré (even money) : +${fmt(h0.stake)} quoi qu’il arrive. Ou le 3:2 : +${fmt(Math.floor((h0.stake * 5) / 2) - h0.stake)}, mais 0 si la banque a blackjack.`
          : `La banque montre un As. Assurance ${fmt(max)} : +${fmt(2 * max)} net si elle a blackjack (ta mise est compensée), sinon perdue et ta main continue.`;
      html = `<div class="msg ins"><b>${icon('shield')}${nat ? 'Gain assuré ?' : 'Assurance ?'}</b><small>${txt}</small><small class="tally">${answered}/${inRound} ont répondu</small></div>`;
    } else if (s.phase === 'shuffle') {
      key = 'shuffle';
      html = '<div class="msg"><b>Nouveau sabot</b><small>8 paquets mélangés</small></div>';
    } else if (s.phase === 'dealing') {
      key = `deal:${s.round}`;
      html = '';
    } else if (tt) {
      const p = s.seats[tt.seat];
      // La clé ne dépend pas de la main jouée : passer de la main 1 à la main 2 (ou attendre la carte suivante) ne
      // redessine rien — avant, le centre se vidait puis réapparaissait à chaque carte, et les deux mains semblaient
      // recevoir une carte ensemble (retour d'Antoni du 21/11). Main active, scores et mises se mettent à jour dessous.
      key = `turn:${tt.seat}:${p.hands.length}:${s.roundId}`;
      // Mandat du 21/11 (A1, A2) : qui joue est dit par le cartouche du coin (.cart) ; le centre montre la main en jeu,
      // en grand, avec son score et sa mise. Après un Split (2 à 4 mains), les mains en PILE : celle à jouer au premier
      // plan, nette ; les autres derrière, décalées et estompées, leur numéro et leur score lisibles sur leur coin.
      const n = p.hands.length;
      const foot = (z) => `<span class="sh__foot"><span class="tot" data-tot="${z}"></span><span class="sh__bet"></span></span>`;
      html = n > 1
        ? `<div class="hstack${p.me ? ' me' : ''}" style="--n:${n}" role="group" aria-label="${n} mains">${p.hands.map((_, k) => `<div class="sh" data-k="${k}"><span class="sh__tag"></span><div class="cards big" data-zone="spot${k}"></div>${foot(`spot${k}`)}</div>`).join('')}</div>`
        : `<div class="sh solo${p.me ? ' me' : ''}"><div class="cards big" data-zone="spot"></div>${foot('spot')}</div>`;
    } else if (s.phase === 'dealer') {
      key = `dealer:${s.round}`;
      html = '<div class="msg"><b>La banque joue</b><small>elle tire jusqu’à 16 et reste sur tous les 17</small></div>';
    } else if (s.phase === 'settled') {
      key = `settled:${s.round}`;
      const out = s.outcome === 'BJ' ? 'Blackjack de la banque' : s.outcome === 'BUST' ? 'La banque saute' : `La banque fait ${s.outcome}`;
      const r = me?.result;
      const m = me && r ? mainResult(me) : null;
      const bjMe = m?.kind === 'blackjack';
      // Après un Split, chaque main d'abord (son verdict), puis les à-côtés et le total : jamais « égalité » pour un
      // net nul issu de verdicts opposés (BJ-07) — « Bilan » à la place, le détail par main le rend vérifiable.
      const HV = { blackjack: 'blackjack', even: 'gain assuré', win: 'gagnée', push: 'à égalité', lose: 'perdue', bust: 'bust' };
      const handsLine = me && me.hands.length > 1 ? me.hands.map((hd, k) => `Main ${k + 1} ${HV[hd.verdict] ?? ''}`).join(' · ') : '';
      // Assurance ou paris banque (retour d'Antoni du 21/11) : jamais un seul montant ambigu — la main, chaque à-côté
      // (son NET, jamais le paiement brut) et le bilan de la manche, tels que le Core les a réglés.
      const rows = r ? [...Object.entries(r.side ?? {}).map(([k, x]) => [`Pari ${SIDE_LABEL[k]} ${x.payout ? 'gagné' : 'perdu'}`, x.payout - x.stake]), ...(r.insurance ? [[`Assurance ${r.insurance.payout ? 'gagnée' : 'perdue'}`, r.insurance.payout - r.insurance.stake]] : [])] : [];
      const c = (n) => (n > 0 ? 'g' : n < 0 ? 'l' : '');
      const jetons = (n) => (n ? `${signedTxt(n)} Jeton${Math.abs(n) > 1 ? 's' : ''}` : '0 Jeton');
      const mainLbl = m && (m.kind === 'mixed' ? `${me.hands.length} mains` : HV[m.kind] ?? '');
      html = `<div class="msg res${bjMe ? ' is-bj' : ''}"><b>${out}</b>${handsLine ? `<small class="handsline">${handsLine}</small>` : ''}${
        !m
          ? ''
          : rows.length
            ? `<div class="bd"><p><span>Main${mainLbl ? ` <i>${mainLbl}</i>` : ''}</span><em class="${c(m.net)}">${signedTxt(m.net)}</em></p>${rows.map(([l, n]) => `<p><span>${l}</span><em class="${c(n)}">${signedTxt(n)}</em></p>`).join('')}<p class="bd__tot"><span>Bilan</span><em class="${c(r.net)}">${jetons(r.net)}</em></p></div>`
            : `<span class="me ${c(m.net)}">${m.kind === 'mixed' ? (m.net ? `Bilan ${signedTxt(m.net)}` : 'Bilan ±0 · rien gagné, rien perdu') : `${KIND[m.kind] ?? ''}${m.net ? ` ${signedTxt(m.net)}` : ''}`}</span>`
      }</div>`;
    }
    if (spot.dataset.key !== key) {
      spot.dataset.key = key;
      spot.innerHTML = html;
      spot.classList.toggle('has-split', html.includes('hstack'));
      spot.classList.toggle('is-me', !!tt && !!s.seats[tt.seat]?.me);
      spot.classList.remove('in');
      void spot.offsetWidth;
      spot.classList.add('in');
    }
    paintCart(s, tt);
    if (spot.querySelector('.sh') && tt) {
      const p = s.seats[tt.seat];
      const n = p.hands.length;
      const multi = n > 1;
      const zones = multi ? p.hands.map((h, k) => [h, k, `spot${k}`]) : [[p.hands[tt.hand], tt.hand, 'spot']];
      for (const [h, k, z] of zones) {
        const el = spot.querySelector(`[data-zone="${z}"]`);
        if (!h || !el) continue;
        const fr = [];
        cardsInto(el, h.cards, `sp${tt.seat}:${s.roundId}:${k}`, fr);
        fresh.push(...fr);
        const tot = spot.querySelector(`[data-tot="${z}"]`);
        el.classList.toggle('is-bust', h.total > 21);
        tot.textContent = h.natural ? 'BJ' : h.total > 21 ? String(h.total) : totText(h);
        tot.className = `tot${h.total > 21 ? ' bust' : ''}`;
        const sh = el.closest('.sh');
        sh.querySelector('.sh__bet').textContent = kfmt(h.stake); // un Double sur une main splittée change sa mise
        if (!multi) continue;
        // La pile : profondeur 0 = la main à jouer (au premier plan), puis les suivantes, puis celles déjà finies. Une
        // main splittée qui n'a qu'une carte attend la sienne : le Core la lui donne quand vient son tour (règle du moteur).
        const cur = k === tt.hand;
        const bust = h.total > 21;
        const wait = h.cards.length === 1;
        const done = !cur && (h.done || k < tt.hand);
        sh.style.setProperty('--d', String((k - tt.hand + n) % n));
        sh.classList.toggle('cur', cur);
        sh.classList.toggle('done', done);
        sh.classList.toggle('bust', bust);
        sh.querySelector('.sh__tag').innerHTML = `<b data-k="${k + 1}">Main ${k + 1}</b>${cur ? '' : `<i>${wait ? '…' : bust ? 'bust' : totText(h)}${done && !bust ? ' ✓' : ''}</i>`}`;
        sh.title = `Main ${k + 1} : ${cur ? 'à jouer' : wait ? 'attend sa 2ᵉ carte' : bust ? 'bust' : done ? `finie (${totText(h)})` : totText(h)}`;
      }
      if (multi) swapStack(spot.querySelector('.hstack'), tt.hand);
    }
  }
  /** La pile du Split : quand la main jouée change, celle qui finit glisse hors de la pile puis repasse derrière ; la
   * suivante avance au premier plan (transition CSS de `--d`). Mouvement réduit : seulement le fondu. */
  const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function swapStack(box, active) {
    if (!box) return;
    const was = box.dataset.active;
    box.dataset.active = String(active);
    if (was === undefined || was === String(active) || reducedMotion()) return;
    // `translate`/`rotate` (pas `transform`, que la pile transitionne) : les deux mouvements se composent.
    box.querySelector(`.sh[data-k="${was}"]`)?.animate(
      [
        { translate: '0 0', rotate: '0deg', zIndex: 30 },
        { translate: '-62% 10%', rotate: '-9deg', zIndex: 30, offset: 0.42 },
        { zIndex: 0, offset: 0.43 },
        { translate: '0 0', rotate: '0deg', zIndex: 0 },
      ],
      { duration: 560, easing: 'cubic-bezier(0.3, 0.75, 0.3, 1)' },
    );
  }
  /** Le cartouche du coin (A2) : qui joue, et « Main 1/2 » après un Split — rien de plus (le temps restant, frame()). */
  const cart = $('.cart');
  function paintCart(s, tt) {
    if (!tt) {
      cart.hidden = true;
      cart.dataset.k = '';
      return;
    }
    const p = s.seats[tt.seat];
    const n = p.hands.length;
    cart.hidden = false;
    cart.classList.toggle('me', !!p.me);
    const k = `${p.user}|${p.avatar ?? ''}|${tt.hand}|${n}`;
    if (cart.dataset.k === k) return;
    cart.dataset.k = k;
    cart.innerHTML = `${avatarHTML(p)}<b>${p.me ? 'À toi' : esc(p.name)}</b>${n > 1 ? `<i>Main ${tt.hand + 1}/${n}</i>` : ''}<small class="cart__t"></small>`;
  }

  // --- La barre : jetons et PRÊT, ou les 4 actions, ou ce qui se passe ------------------------------------------------
  const isMyTurn = (s, me) => !!(me && s.turn && s.turn.seat === me.seat && s.phase === 'players');
  const reserved = () => (mine()?.bet ? mine().bet.main + Object.values(mine().side ?? {}).reduce((a, b) => a + b, 0) : 0);
  const draftTotal = (d = draft) => d.main + Object.values(d.side).reduce((a, b) => a + b, 0);
  const spendable = () => client.balance() + reserved();
  /** Ce que j'ai d'engagé dans la manche : mes mains (doubles et splits compris), mes paris banque, mon assurance. */
  const engaged = (me) => (me.hands.length ? me.hands.reduce((a, h) => a + h.stake, 0) + Object.values(me.side ?? {}).reduce((a, b) => a + b, 0) + (me.insurance?.stake ?? 0) : reserved());
  /** « Mise en cours » : une petite zone à part (le solde, lui, est dans l'en-tête de Raptoru Live). */
  const stakeHTML = (v) => `<div class="stake${v ? '' : ' none'}" title="Jetons misés sur cette manche"><small>Mise<i> en cours</i></small><b>${fmt(v)}</b></div>`;
  function paintBar(s, me) {
    let key;
    let html;
    if (!me) {
      key = `spect:${s.seats.includes(null)}`;
      // BJ-02/A3 : « S'asseoir » rejoint CETTE table (data-join=tableId), jamais le salon — l'ancien bug partageait
      // `data-lobby` avec le bouton « Tables » juste à côté, et renvoyait toujours au salon.
      html = `<div class="state"><b>Spectateur</b><small>table ${s.no} en direct · tu ne peux ni miser ni jouer</small></div><button type="button" class="btn" data-lobby>${icon('tables')}Tables</button>${!spectator && s.seats.includes(null) ? `<button type="button" class="btn go" data-join="${tableId}">S’asseoir</button>` : ''}`;
    } else if (me.status === 'seated' && s.phase === 'betting' && !me.bet?.ready) {
      const total = draftTotal();
      const left = spendable() - total;
      const no = draft.main ? betProblem(draft, L()) : { code: 'bad_main_bet' };
      key = `bet:${JSON.stringify(draft)}:${chip}:${custom}:${left}:${undo.length}:${pending}:${!!lastBet}`;
      const chips = [...CHIPS, ...(custom && !CHIPS.includes(custom) ? [custom] : [])];
      html = `<div class="chips" role="radiogroup" aria-label="Jeton à poser">${chips.map((v) => `<button type="button" class="chip ${tone(v)}${v === chip ? ' on' : ''}${v === custom ? ' cu' : ''}" data-chip="${v}" role="radio" aria-checked="${v === chip}" aria-label="Jeton ${fmt(v)}"${v > spendable() ? ' disabled' : ''}>${kfmt(v)}</button>`).join('')}<button type="button" class="chip custom" data-custom title="Jeton libre : le montant exact" aria-label="Jeton libre">✎</button></div>
        <div class="ops"><button type="button" class="ic k-undo" data-undo title="Retirer le dernier jeton posé" aria-label="Retirer le dernier jeton"${undo.length ? '' : ' disabled'}>${icon('undo')}</button><button type="button" class="ic k-clear" data-clear title="Tout retirer" aria-label="Tout retirer"${total ? '' : ' disabled'}>${icon('clear')}</button><button type="button" class="ic k-rebet" data-rebet title="Mêmes mises que la manche précédente" aria-label="Rejouer les mêmes mises"${lastBet ? '' : ' disabled'}>${icon('rebet')}</button></div>
        ${stakeHTML(total)}
        <button type="button" class="btn go ready" data-ready${no || pending || left < 0 ? ' disabled' : ''} title="${no ? esc(why(no, L())) : 'Verrouiller mes mises'}">Prêt</button>`;
    } else if (me.status === 'seated' && s.phase === 'betting') {
      key = `ready:${s.ready}:${s.waiting}`;
      html = `<div class="state"><b>Prêt ✓ — mises verrouillées</b><small>${s.ready} sur ${s.ready + s.waiting} · la donne part quand tout le monde est prêt</small></div>${stakeHTML(engaged(me))}`;
    } else if (s.phase === 'insurance' && me.inRound && me.insurance === null) {
      const h = me.hands[0];
      const max = Math.floor(h.stake / 2);
      key = `ins:${s.round}:${pending}`;
      // Gain assuré (even money) : libellé français, le montant garanti dessus ; l'autre choix dit ce qu'il garde (3:2).
      const bjNet = Math.floor((h.stake * 5) / 2) - h.stake;
      html = h.natural
        ? `<div class="acts two"><button type="button" class="act k-ins" data-ins="even"${pending ? ' disabled' : ''} title="Even money : ton blackjack payé 1:1 (+${fmt(h.stake)}), quoi qu’ait la banque">${icon('shield')}<b>Gain assuré</b><small>+${kfmt(h.stake)}</small></button><button type="button" class="act k-no" data-ins="0"${pending ? ' disabled' : ''} title="Garder le 3:2 (+${fmt(bjNet)}) ; égalité (0) si la banque a blackjack"><b>Tenter le 3:2</b><small>+${kfmt(bjNet)} ou 0</small></button></div><i class="tmbar big"><i></i></i>`
        : `<div class="acts two"><button type="button" class="act k-ins" data-ins="${max}"${pending || max > client.balance() ? ' disabled' : ''} title="Assurance de ${fmt(max)} : +${fmt(max * 2)} net si la banque a blackjack, perdue sinon">${icon('shield')}<b>Assurer</b><small>${kfmt(max)}</small></button><button type="button" class="act k-no" data-ins="0"${pending ? ' disabled' : ''}><b>Non merci</b></button></div><i class="tmbar big"><i></i></i>`;
    } else if (isMyTurn(s, me) || turnOf(s)?.seat === me.seat) {
      // Mon tour — ou l'instant entre deux de mes décisions (la carte tirée arrive, ma main suivante reçoit sa 2ᵉ
      // carte) : les actions restent à leur place, en attente, au lieu de céder la barre à un texte puis de revenir.
      const tt = turnOf(s);
      const wait = tt.between;
      const h = me.hands[tt.hand];
      const raw = { cards: h.cards.map((c) => c.id), stake: h.stake, fromSplit: h.fromSplit, splitAces: h.splitAces, done: h.done };
      const a = R.actions(raw, { handsCount: me.hands.length, balance: client.balance() });
      key = `turn:${s.turn?.token ?? 'wait'}:${pending}:${JSON.stringify(a)}:${tt.hand}`;
      const multi = me.hands.length > 1;
      const b = (k, label, kb, extra = '') => `<button type="button" class="act k-${k}${wait && a[k] ? ' soon' : ''}" data-act="${k}"${!a[k] || pending || wait ? ' disabled' : ''} title="${label}${multi ? ` (main ${tt.hand + 1})` : ''} — touche ${kb}">${icon(k)}<b>${label}</b>${extra}</button>`;
      // Après un Split : la main que ces boutons jouent est celle au premier plan de la pile, et le cartouche dit
      // « Main 1/2 » (mandat du 21/11, A2 : plus de 3ᵉ rappel au-dessus des boutons) ; les lecteurs d'écran l'entendent ici.
      html = `${stakeHTML(engaged(me))}<div class="acts" role="group" aria-label="${multi ? `Jouer la main ${tt.hand + 1} sur ${me.hands.length}` : 'Jouer ma main'}">${b('hit', 'Tirer', 'T')}${b('stand', 'Rester', 'R')}${b('double', 'Doubler', 'D', `<small>+${kfmt(h.stake)}</small>`)}${b('split', 'Split', 'S', `<small>+${kfmt(h.stake)}</small>`)}</div><i class="tmbar big"><i></i></i>`;
    } else {
      key = `info:${s.phase}:${s.turn?.token ?? ''}:${me.status}:${me.inRound}`;
      const who = s.turn ? s.seats[s.turn.seat] : null;
      const one = (h) => (h.verdict ? KIND[h.verdict] : h.natural ? 'Blackjack' : h.total > 21 ? 'Bust' : String(h.total));
      const myLine = me.hands.length > 1 ? me.hands.map((h, k) => `main ${k + 1} ${one(h)}`).join(' · ') : me.hands.length ? one(me.hands[0]) : '';
      const text =
        me.status === 'left' ? (s.phase === 'settled' ? 'Tu as quitté la table : la manche est réglée, ta place se libère.' : 'Tu as quitté la table : ta mise reste engagée jusqu’au règlement.') :
        !me.inRound && s.phase !== 'betting' ? 'Tu rejoindras la manche suivante.' :
        s.phase === 'insurance' ? (me.insurance?.even ? `Gain assuré : +${fmt(me.hands[0].stake)} (payé au règlement)` : me.insurance?.stake ? `Assurance prise : ${fmt(me.insurance.stake)}` : me.insurance ? 'Pas d’assurance' : 'Assurance proposée') :
        s.phase === 'players' && who ? `Au tour de ${esc(who.name)}` :
        s.phase === 'dealer' ? 'La banque joue…' :
        s.phase === 'settled' ? 'Prochaine manche dans un instant' :
        PHASE[s.phase] ?? '';
      html = `<div class="state"><b>${text}</b>${myLine ? `<small>${me.hands.length > 1 ? 'tes mains' : 'ta main'} : ${myLine}</small>` : ''}</div>${me.inRound && s.phase !== 'settled' ? stakeHTML(engaged(me)) : ''}`;
    }
    // Quitter (décision d'Antoni du 21/11) : dans la barre, dans TOUS les états d'un joueur assis — une porte rouge
    // compacte, séparée du reste ; son nom au survol (title) et pour les lecteurs d'écran (aria-label). Au toucher :
    // sans mise engagée, on quitte tout de suite ; avec une mise engagée, une confirmation explique ce qu'il advient.
    // Réagir (mandat du 21/11, C) : à côté de Quitter, pour tout joueur assis, quand le Core gère les réactions.
    if (me?.status === 'seated') {
      const react = rx.enabled() ? `<button type="button" class="btn rxb" data-rx-open title="Réagir" aria-label="Réagir avec une émote">${icon('smile')}</button>` : '';
      key = `q:${!!react}:${key}`;
      html = `<button type="button" class="btn quit" data-quit title="Quitter la table" aria-label="Quitter la table">${icon('leave')}</button>${react}<i class="sep" aria-hidden="true"></i>${html}`;
    }
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = html;
    }
  }

  // --- Historique : une languette ; un panneau latéral ; des manches repliées --------------------------------------
  // Une manche dépliée se lit sans calcul : pour chacun, sa mise principale et ce qu'elle a donné, puis chaque pari
  // banque (score parié, misé, retour) ; le NET (payé − misé) est toujours signé, le retour brut jamais.
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
  const cls = (n) => (n > 0 ? 'g' : n < 0 ? 'l' : 'e');
  const VERDICT = { blackjack: 'blackjack', even: 'gain assuré', win: 'gagné', push: 'égalité', lose: 'perdu', bust: 'bust' };
  function paintHistory() {
    const list = [...(st?.history ?? [])].reverse();
    const meUser = client.user;
    $('.hist__list').innerHTML = list.length
      ? list
          .map((r) => {
            const meP = r.players.find((p) => p.user === meUser);
            const isOpen = open.has(r.round);
            const body = () =>
              r.players
                .map((p) => {
                  const hands = p.hands ?? [];
                  const mainNet = (p.mainPaid ?? 0) - (p.main ?? 0);
                  const handTxt = hands.map((h) => `${h.verdict === 'blackjack' ? 'BJ' : h.total}${h.doubled ? ' ×2' : ''} ${VERDICT[h.verdict] ?? ''}`).join(' · ');
                  const sides = (p.side ?? [])
                    .map((x) => `<li class="${x.payout ? 'g' : 'l'}"><span><em>Pari ${SIDE_LABEL[x.spot]}</em> · ${fmt(x.stake)} misés · ${x.payout ? `retour ${fmt(x.payout)}` : 'perdu'}</span><b>${signed(x.payout - x.stake)}</b></li>`)
                    .join('');
                  const ins = p.insurance ? `<li class="${p.insurance.payout ? 'g' : 'l'}"><span><em>Assurance</em> · ${fmt(p.insurance.stake)} misés · ${p.insurance.payout ? `retour ${fmt(p.insurance.payout)}` : 'perdue'}</span><b>${signed(p.insurance.payout - p.insurance.stake)}</b></li>` : '';
                  return `<div class="hp${p.user === meUser ? ' me' : ''}"><p class="hp__h"><span>${p.user === meUser ? 'Toi' : esc(p.name)}</span><b class="${cls(p.net)}">${signed(p.net)}</b></p><ul><li class="${cls(mainNet)}"><span><em>Main</em> · ${fmt(p.main ?? 0)} misés${hands.length > 1 ? ` · ${hands.length} mains` : ''} · ${handTxt}</span><b>${signed(mainNet)}</b></li>${sides}${ins}</ul></div>`;
                })
                .join('');
            // Replié : la banque, mon net ; dessous, ma main et mes paris banque (ou ceux de la table), d'un coup d'œil.
            const bets = r.players.flatMap((p) => (p.side ?? []).map((x) => ({ ...x, who: p })));
            const line = meP
              ? [`main ${signed((meP.mainPaid ?? 0) - (meP.main ?? 0))}`, ...(meP.side ?? []).map((x) => `<i class="${x.payout ? 'g' : 'l'}">${SHORT[x.spot]} ${x.payout ? '✓' : '✗'}</i> ${signed(x.payout - x.stake)}`), ...(meP.insurance ? [`assur. ${signed(meP.insurance.payout - meP.insurance.stake)}`] : [])].join(' · ')
              : `${r.players.length} joueur${r.players.length > 1 ? 's' : ''}${bets.length ? ` · ${bets.length} pari${bets.length > 1 ? 's' : ''} banque, ${bets.filter((x) => x.payout).length} gagné${bets.filter((x) => x.payout).length > 1 ? 's' : ''}` : ''}`;
            return `<div class="hr${isOpen ? ' open' : ''}"><button type="button" class="hround" data-round="${r.round}" aria-expanded="${isOpen}"><span class="hno">Manche ${r.round}</span><span class="hout">Banque <b>${OUT(r.outcome, r.dealer)}</b></span>${meP ? `<span class="hme ${cls(meP.net)}">${meP.net > 0 ? '+' : meP.net < 0 ? '−' : ''}${kfmt(Math.abs(meP.net))}</span>` : '<span class="hme"></span>'}<i class="chev"></i><span class="hsum">${line}</span></button>${isOpen ? `<div class="hd">${body()}<p class="hnote">net = payé − misé · retour = mise comprise</p></div>` : ''}</div>`;
          })
          .join('')
      : '<p class="none">Aucune manche terminée pour l’instant.</p>';
  }

  // --- « Mes manches » (A9/CAS-01) : l'historique du viewer (Core, toutes tables), avec Partager (A10) et un
  // compteur de session qui se remet à zéro localement — jamais une opération Wallet. --------------------------
  async function loadMyHistory() {
    try {
      myHist = (await client.history(50)).rounds;
    } catch {
      /* affiché vide : relisible à la prochaine ouverture */
    }
    if (felt.classList.contains('hist-open') && histTab === 'mine') paintMyHistory();
  }
  // Une manche du viewer, lisible d'un coup d'œil : la banque et le net en gros, le reste (table, mise, quand) petit.
  const bankTxt = (d) => (d === 'BJ' ? 'Blackjack de la banque' : d === 'BUST' ? 'La banque saute' : `Banque ${d}`);
  const netTxt = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');
  function paintMyHistory() {
    const resetAt = sessionPrefs.get().resetAt;
    const rounds = myHist ?? [];
    const { count, net } = sessionSummary(rounds, resetAt);
    const since = resetAt ? `depuis ta remise à zéro · ${Frame.ago(resetAt)}` : 'tes dernières manches';
    const head = `<section class="hsess"><p class="hsess__row"><span>Bilan de la session</span><b class="${cls(net)}">${netTxt(net)}</b></p><p class="hsess__row2"><small>${count} manche${count > 1 ? 's' : ''} · ${since}</small><button type="button" class="hico hsess__reset" data-session-reset title="Remettre le bilan à zéro" aria-label="Remettre le bilan à zéro">${icon('reset')}</button></p></section>`;
    let divided = false;
    const rows = rounds
      .map((r) => {
        const old = Date.parse(r.created_at) < resetAt;
        const divider = old && !divided && resetAt ? ((divided = true), '<p class="mdiv">Avant la remise à zéro</p>') : '';
        // Le détail (main, assurance, paris banque) quand la manche est encore dans l'historique de cette table : le
        // Core ne le renvoie pas dans « Mes manches » (seulement le net et le total misé). Jamais recalculé ni inventé.
        const det = st && r.table === st.no ? st.history.find((h) => h.round === r.round)?.players.find((p) => p.user === client.user) : null;
        const parts = det ? [`main ${signed((det.mainPaid ?? 0) - (det.main ?? 0))}`, ...(det.insurance ? [`assurance ${signed(det.insurance.payout - det.insurance.stake)}`] : []), ...(det.side ?? []).map((x) => `pari ${SIDE_LABEL[x.spot]} ${signed(x.payout - x.stake)}`)] : [];
        return `${divider}<article class="mrow${old ? ' old' : ''}"><p class="mrow__top"><span>${bankTxt(r.dealer)}</span><b class="${cls(r.net)}">${netTxt(r.net)}</b></p>${parts.length > 1 ? `<p class="mrow__bd">${parts.join(' · ')}</p>` : ''}<p class="mrow__meta"><span>Table ${r.table ?? '?'} · manche ${r.round ?? '?'} · misé ${fmt(r.bet)}</span><time>${Frame.ago(Date.parse(r.created_at))}</time></p><button type="button" class="hico mrow__share" data-share="${r.round_id}"${r.shared ? ' disabled' : ''} title="${r.shared ? 'Déjà partagée dans le chat' : 'Partager dans le chat'}" aria-label="${r.shared ? 'Manche déjà partagée dans le chat' : 'Partager cette manche dans le chat'}">${icon(r.shared ? 'check' : 'share')}</button></article>`;
      })
      .join('');
    $('.hist__list').innerHTML = head + (rows || '<p class="none">Aucune manche terminée pour l’instant.</p>');
  }
  async function resetSession() {
    const ok = await modal('<b>Remettre le bilan à zéro ?</b><small>Le bilan recommence à 0 à partir de maintenant (pour une nouvelle soirée, par exemple). Tes Jetons, tes manches et l’historique ne changent pas.</small>', [['no', 'Annuler', ''], ['yes', 'Remettre à zéro', 'go']]);
    if (ok !== 'yes') return;
    sessionPrefs.get().resetAt = now();
    sessionPrefs.save();
    toast('Bilan remis à zéro.');
    paintMyHistory();
  }
  async function shareMyRound(id) {
    const r = (myHist ?? []).find((x) => x.round_id === id);
    const what = r ? `${bankTxt(r.dealer)}, ${r.net ? `${netTxt(r.net)} Jetons` : 'un bilan de 0'}` : 'cette manche';
    const ok = await modal(`<b>Partager dans le chat ?</b><small>LeCroupier_ annoncera ta manche (${what}), telle que le Core l’a réglée. Une seule fois par manche.</small>`, [['no', 'Annuler', ''], ['yes', 'Partager', 'go']]);
    if (ok !== 'yes') return;
    try {
      const out = await client.share(id);
      if (r) r.shared = true;
      toast(out?.already ? 'Déjà partagé.' : 'LeCroupier_ annonce ta manche dans le chat.');
    } catch (e) {
      const wait = e?.details?.retry_in_s;
      toast(`${why(e, L())}${wait ? ` (${wait} s)` : ''}`, true);
    }
    paintMyHistory();
  }

  // --- Animations, sons, paiements ------------------------------------------------------------------------------
  const seenIds = (s) => {
    const ids = new Set();
    if (!s) return ids;
    for (const c of s.dealer.cards) if (!c.hidden) ids.add(c.id);
    for (const p of s.seats) for (const h of p?.hands ?? []) for (const c of h.cards) ids.add(c.id);
    return ids;
  };
  /** Distribution : un glissement latéral net (de la gauche, côté sabot), rapide, sans rotation ; une carte déjà
   * visible ne rejoue jamais son entrée. */
  function animateCards(fresh, prev) {
    if (!fresh.length) return;
    const before = seenIds(prev);
    const deal = (prev?.phase === 'betting' || prev?.phase === 'shuffle') && st.phase === 'dealing';
    const order = st.seats.map((p, i) => (p?.inRound ? i : -1)).filter((i) => i >= 0);
    const n = order.length;
    fresh.forEach((node) => {
      if (node.dataset.flip) return void node.animate([{ transform: 'scaleX(0.05)' }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
      const parts = node.dataset.k.split(':');
      const id = Number(parts[parts.length - 2]);
      if (before.has(id)) return; // déjà visible ailleurs (split, projecteur) : aucune entrée
      let k = 0;
      if (deal) {
        const idx = Number(parts[parts.length - 1]);
        const zone = parts[0];
        if (zone.startsWith('d')) k = idx === 0 ? n : 2 * n + 1;
        else if (zone.startsWith('s') && !zone.startsWith('sp')) {
          const seat = Number(zone.slice(1));
          k = idx === 0 ? order.indexOf(seat) : n + 1 + order.indexOf(seat);
        }
      }
      node.animate([{ transform: 'translateX(-64px)', opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 190, delay: k * 115, easing: 'cubic-bezier(0.15, 0.9, 0.3, 1)', fill: 'backwards' });
    });
  }
  /** Le règlement mis en scène : des jetons vont du joueur à la banque (perdu) ou de la banque au joueur (payé). */
  function payFlights(s) {
    const layer = $('.fly');
    const fr = layer.getBoundingClientRect();
    const center = (el) => {
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2 - fr.left, r.top + r.height / 2 - fr.top];
    };
    const bank = center($('[data-zone="dealer"]'));
    let k = 0;
    const fly = (from, to, v, delay) => {
      const c = document.createElement('i');
      c.className = `flychip ${tone(v)}`;
      layer.append(c);
      const a = c.animate([{ transform: `translate(${from[0]}px, ${from[1]}px) scale(0.9)`, opacity: 0 }, { opacity: 1, offset: 0.15 }, { transform: `translate(${to[0]}px, ${to[1]}px) scale(0.7)`, opacity: 0.9, offset: 0.9 }, { transform: `translate(${to[0]}px, ${to[1]}px) scale(0.5)`, opacity: 0 }], { duration: 560, delay, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' });
      a.onfinish = () => c.remove();
    };
    for (const p of s.seats) {
      if (!p?.result) continue;
      const el = seatsEl.querySelector(`.seat[data-seat="${p.seat}"] .bet`) ?? seatsEl.querySelector(`.seat[data-seat="${p.seat}"]`);
      if (!el) continue;
      const at = center(el);
      const stake = p.hands.reduce((a, h) => a + h.stake, 0);
      const won = p.hands.some((h) => h.payout > h.stake);
      const lost = p.hands.some((h) => !h.payout);
      const d = 250 + k++ * 70;
      if (lost) fly(at, bank, stake, d);
      if (won) for (let j = 0; j < 2; j++) fly(bank, at, stake, d + 320 + j * 90);
      for (const [spotK, r] of Object.entries(p.result.side ?? {})) {
        const sEl = felt.querySelector(`[data-side="${spotK}"]`);
        if (!sEl) continue;
        if (r.payout) fly(bank, center(sEl), r.stake, d + 380);
        else if (p.me) fly(center(sEl), bank, r.stake, d);
      }
    }
  }
  function sounds(s) {
    const t = s.last?.type;
    const me = mine();
    if (t === 'deal') for (let i = 0; i < s.seats.filter((x) => x?.inRound).length * 2 + 2; i++) Sfx.card(i * 0.115);
    else if (t === 'card' || t === 'dealer_card' || t === 'split') Sfx.card();
    else if (t === 'reveal') Sfx.flip();
    else if (t === 'insurance' && me?.inRound) Sfx.turn();
    else if (t === 'shuffle') Sfx.shuffle();
    else if (t === 'turn' && me && s.turn?.seat === me.seat) Sfx.turn();
    else if (t === 'settle' && me?.result) {
      if (me.hands.some((h) => h.verdict === 'blackjack')) Sfx.blackjack();
      else if (me.result.net > 0) Sfx.win();
      else if (me.result.net === 0) Sfx.push();
      else Sfx.lose();
    }
  }

  // --- Les délais : ceux du Core ; affichés seulement quand ils comptent -------------------------------------------
  function frame() {
    if (destroyed) return;
    requestAnimationFrame(frame);
    if (!st || mode !== 'table') return;
    const msLeft = st.phase === 'players' && st.turn ? st.turn.deadline - now() : st.phase === 'insurance' && st.insurance ? st.insurance.deadline - now() : null;
    const show = msLeft !== null && msLeft < st.timing.showMs;
    const v = show ? Math.max(0, Math.min(1, msLeft / st.timing.showMs)) : 1;
    host.querySelectorAll('.tmbar').forEach((x) => (x.classList.toggle('show', show), x.classList.toggle('warn', show && msLeft < 4000)));
    host.querySelectorAll('.tmbar > i').forEach((x) => (x.style.transform = `scaleX(${v})`));
    const ts = seatsEl.querySelector('.seat.turn .tm');
    if (ts) {
      ts.style.setProperty('--p', String(v));
      ts.classList.toggle('show', show);
    }
    const label = cart.querySelector('.cart__t');
    if (label) label.textContent = show && msLeft > 0 && st.phase === 'players' ? `${Math.ceil(msLeft / 1000)} s` : '';
    const safety = spot.querySelector('.safety');
    if (safety) {
      const left = st.phase === 'betting' && st.betDeadline ? st.betDeadline - now() : null;
      safety.textContent = left !== null && left < 15_000 && left > 0 ? `Distribution dans ${Math.ceil(left / 1000)} s avec les joueurs prêts` : '';
    }
    const me = mine();
    if (me && st.turn?.seat === me.seat && show && msLeft > 0 && msLeft < 3200) {
      const k = `${st.turn.token}:${Math.ceil(msLeft / 1000)}`;
      if (k !== tickedFor) {
        tickedFor = k;
        Sfx.tick();
      }
    }
  }
  requestAnimationFrame(frame);

  // --- Le gain possible : une bulle discrète, au survol, ou juste après avoir posé -----------------------------------
  // Trois montants exacts, en Jetons entiers : la mise, le gain NET, le retour total (mise comprise).
  function showTip(el, ms = 0) {
    const zone = el.dataset.side ?? 'main';
    const stake = zone === 'main' ? draft.main || chip : draft.side[zone] || chip;
    const line = (what, net) => `<span>${what}</span><b>+${fmt(net)}</b><i>retour ${fmt(stake + net)}</i>`;
    const html = zone === 'main'
      ? `<p class="tip__h">Mise ${fmt(stake)}</p>${line('Victoire 1:1', stake)}${line('Blackjack 3:2', Math.floor((stake * 3) / 2))}`
      : `<p class="tip__h">Mise ${fmt(stake)} sur ${SIDE_LABEL[zone]} · paye ${oddsText(zone)}</p>${line(`Si la banque fait ${SIDE_LABEL[zone]}`, sideNet(zone, stake))}`;
    tipAt(el, html, false, ms);
  }
  function tipAt(el, html, below = false, ms = 0) {
    tip.innerHTML = html;
    tip.hidden = false;
    const fr = felt.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.max(4, Math.min(fr.width - w - 4, r.left - fr.left + r.width / 2 - w / 2))}px`;
    const above = r.top - fr.top - h - 6;
    tip.style.top = `${below || above < 4 ? Math.min(fr.height - h - 4, r.bottom - fr.top + 6) : above}px`;
    if (below && r.bottom - fr.top + 6 + h > fr.height) tip.style.top = `${Math.max(4, above)}px`;
    clearTimeout(tipT);
    if (ms) tipT = setTimeout(() => (tip.hidden = true), ms);
  }
  host.addEventListener('pointerover', (e) => {
    const b = e.target.closest?.('[data-side]:not(:disabled), .sb:not(:disabled):not([hidden])');
    if (b && e.pointerType !== 'touch') showTip(b);
    const sh = e.target.closest?.('[data-shoe]');
    if (sh) tipAt(sh, (sh.dataset.tip ?? '').split('|').map((x, i) => `<p class="${i ? 'tip__s' : 'tip__h'}">${esc(x)}</p>`).join(''), true);
  }, sig);
  host.addEventListener('pointerout', (e) => {
    const b = e.target.closest?.('[data-side], .sb, [data-shoe]');
    if (b && !b.contains(e.relatedTarget)) tip.hidden = true;
  }, sig);

  // --- Poser, retirer, PRÊT ----------------------------------------------------------------------------------------
  function canPlace(next) {
    if (draftTotal(next) > spendable()) return 'Solde insuffisant.';
    if (next.main >= (L()?.mainMin ?? 100)) {
      const no = betProblem(next, L());
      if (no && no.code !== 'bad_main_bet') return why(no, L());
    }
    return null;
  }
  function place(zone, el) {
    const me = mine();
    if (!me || me.status !== 'seated') return toast(ERR.not_seated, true);
    if (st.phase !== 'betting') return toast(ERR.betting_closed, true);
    if (me.bet?.ready) return toast(ERR.bets_locked, true);
    const v = chip;
    const next = zone === 'main' ? { ...draft, main: draft.main + v } : { ...draft, side: { ...draft.side, [zone]: (draft.side[zone] ?? 0) + v } };
    const no = canPlace(next);
    if (no) return toast(no, true);
    draft = next;
    undo.push([zone, v]);
    Sfx.chip();
    changed();
    const fresh = zone === 'main' ? seatsEl.querySelector('.seat.me .sb') : el;
    if (fresh) showTip(fresh, 1500);
  }
  /** Retirer un jeton : d'une zone (clic droit, appui long), ou le dernier posé (↶). */
  function unplace(zone = null) {
    if (mine()?.bet?.ready) return toast(ERR.bets_locked, true);
    const i = zone ? undo.map((u) => u[0]).lastIndexOf(zone) : undo.length - 1;
    let z = zone;
    let v;
    if (i >= 0) [[z, v]] = undo.splice(i, 1);
    else if (zone && (zone === 'main' ? draft.main : draft.side[zone])) v = Math.min(chip, zone === 'main' ? draft.main : draft.side[zone]);
    else return;
    if (z === 'main') draft = { ...draft, main: Math.max(0, draft.main - v) };
    else {
      const side = { ...draft.side, [z]: Math.max(0, (draft.side[z] ?? 0) - v) };
      if (!side[z]) delete side[z];
      draft = { ...draft, side };
    }
    Sfx.chip();
    tip.hidden = true;
    changed();
  }
  function clearDraft() {
    draft = { main: 0, side: {} };
    undo = [];
    changed();
  }
  /** Le brouillon change : dessiné tout de suite, réservé au Core un instant après (une seule réservation, ajustée). */
  function changed() {
    dirty = true;
    paint(null, false);
    clearTimeout(syncT);
    syncT = setTimeout(() => void sync(false), 280);
  }
  async function sync(isReady) {
    clearTimeout(syncT);
    const me = mine();
    if (!me || st.phase !== 'betting' || me.bet?.ready) return;
    const d = { main: draft.main, side: { ...draft.side } };
    const problem = d.main >= (L()?.mainMin ?? 100) ? betProblem(d, L()) : { code: 'bad_main_bet' };
    try {
      if (problem) {
        if (isReady) throw Object.assign(new Error(problem.code), problem);
        if (me.bet) await client.clearBets();
      } else await client.placeBets({ ...d, ready: isReady });
      if (JSON.stringify(d) === JSON.stringify(draft)) dirty = false;
      if (isReady) Sfx.chip();
    } catch (e) {
      fail(e);
    }
  }
  async function ready() {
    if (pending) return;
    pending = true;
    tip.hidden = true;
    paint(null, false);
    try {
      await sync(true);
    } finally {
      pending = false;
      if (st) paint(null, false);
    }
  }
  function editCustom() {
    if (bar.querySelector('.cuform')) return;
    typing = true;
    const f = document.createElement('form');
    f.className = 'cuform';
    // Les valeurs acceptées, celles du Core (retour d'Antoni du 21/11 : le montant semblait arrondi au hasard) : par pas
    // de `step`, mise principale dès `mainMin`, jusqu'au plafond de gain (splits et doubles compris). Jamais arrondi
    // en silence : un montant hors pas est refusé avec les deux valeurs voisines.
    const lim = L() ?? { step: 10, mainMin: 100, sideMin: 10 };
    const top = betProblem({ main: 1e12 }, lim)?.max;
    f.innerHTML = `<input inputmode="numeric" placeholder="ex. 250" aria-label="Montant du jeton libre" aria-describedby="${uid}-cuh" value="${custom ?? ''}"><button type="submit" class="btn go">OK</button><small id="${uid}-cuh" class="cuform__h">Par pas de ${lim.step} · mise principale ${fmt(lim.mainMin)}${top ? ` à ${fmt(top)}` : ' minimum'} · pari banque dès ${fmt(lim.sideMin)}</small>`;
    bar.append(f);
    const input = f.querySelector('input');
    input.focus();
    input.select();
    const done = (ok) => {
      if (!typing) return;
      typing = false;
      f.remove();
      if (ok && input.value.trim()) {
        const m = /^(\d+(?:[.,]\d+)?)(k?)$/i.exec(String(input.value).replace(/[\s\u202f]/g, ''));
        const v = m ? Math.round(Number(m[1].replace(',', '.')) * (m[2] ? 1000 : 1)) : NaN;
        const lo = Math.floor(v / lim.step) * lim.step;
        if (!Number.isSafeInteger(v) || v < lim.step) toast(`Jeton libre : ${lim.step} minimum, par pas de ${lim.step}.`, true);
        else if (v !== lo) toast(`Par pas de ${lim.step} : ${fmt(lo)} ou ${fmt(lo + lim.step)} ?`, true);
        else {
          custom = v;
          chip = v;
        }
      }
      bar.dataset.key = '';
      paint(null, false);
    };
    f.addEventListener('submit', (e) => (e.preventDefault(), done(true)));
    input.addEventListener('keydown', (e) => e.key === 'Escape' && done(false));
    input.addEventListener('blur', () => setTimeout(() => done(true), 150));
  }

  /** La réponse à l'assurance : une seule, renvoyée à l'identique si la réponse se perd. */
  async function insure(v) {
    const s = st;
    if (pending || s?.phase !== 'insurance') return;
    pending = true;
    paintBar(s, mine());
    const req = v === 'even' ? { even: true } : { stake: Number(v) };
    try {
      for (let tries = 0; ; tries++) {
        try {
          await client.insure({ ...req, actionId: `${s.roundId}:ins` });
          break;
        } catch (e) {
          if (e.code !== 'network_error' || tries >= 3) throw e;
          await new Promise((ok) => setTimeout(ok, 300 + tries * 400));
        }
      }
      if (req.stake) Sfx.chip();
    } catch (e) {
      fail(e);
    } finally {
      pending = false;
      if (st) paintBar(st, mine());
    }
  }

  /** Une action : un identifiant stable par tour (double clic ou renvoi = la même action pour le Core). */
  async function act(type) {
    const s = st;
    const me = mine();
    if (!me || !isMyTurn(s, me) || pending) return;
    pending = true;
    paintBar(s, me);
    const req = { type, token: s.turn.token, actionId: `${s.turn.token}:${type}` };
    try {
      for (let tries = 0; ; tries++) {
        try {
          await client.act(req);
          break;
        } catch (e) {
          if (e.code !== 'network_error' || tries >= 3) throw e;
          await new Promise((ok) => setTimeout(ok, 300 + tries * 400));
        }
      }
      if (type === 'double' || type === 'split') Sfx.chip();
    } catch (e) {
      fail(e);
    } finally {
      pending = false;
      if (st) paintBar(st, mine());
    }
  }

  // Appui long (tactile) sur ma place ou une case : retirer un jeton, sans déclencher le clic.
  let press = null;
  host.addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('[data-side], [data-main]');
    if (!b || b.disabled || e.button) return;
    press = { b, t: setTimeout(() => ((press.long = true), unplace(b.dataset.side ?? 'main')), 480) };
  }, sig);
  const endPress = () => press && clearTimeout(press.t);
  host.addEventListener('pointerup', endPress, sig);
  host.addEventListener('pointercancel', endPress, sig);

  host.addEventListener('click', (e) => {
    if (destroyed) return;
    const q = (sel) => e.target.closest(sel);
    let b;
    if (press?.long) return void (press = null);
    press = null;
    if ((b = q('[data-newtable]'))) return void (!b.disabled && join(null, null, true));
    if ((b = q('[data-join]'))) return void (!b.disabled && join(b.dataset.join || null, b.dataset.seat !== undefined ? Number(b.dataset.seat) : null));
    if ((b = q('[data-watch]'))) return void openTable(b.dataset.watch);
    if ((b = q('[data-open]'))) return void openTable(b.dataset.open);
    if (q('[data-lobby]')) return void lobby();
    if ((b = q('[data-round]'))) {
      const r = Number(b.dataset.round);
      if (open.has(r)) open.delete(r);
      else open.add(r);
      return paintHistory();
    }
    // Règles et Historique (mandat du 21/11, D) : un seul panneau ouvert à la fois — ouvrir l'un ferme l'autre.
    if (q('[data-rules]')) {
      if (bj.classList.toggle('rules-open')) felt.classList.remove('hist-open'); // A8 : aussi depuis le salon
      return;
    }
    if ((b = q('[data-ins]'))) return void (!b.disabled && insure(b.dataset.ins));
    if (q('[data-hist]')) {
      if (felt.classList.toggle('hist-open')) {
        bj.classList.remove('rules-open');
        if (histTab === 'mine') void loadMyHistory();
        else paintHistory();
      }
      return;
    }
    if ((b = q('[data-htab]'))) {
      histTab = b.dataset.htab;
      for (const x of host.querySelectorAll('.htabbtn')) {
        x.classList.toggle('on', x.dataset.htab === histTab);
        x.setAttribute('aria-selected', String(x.dataset.htab === histTab));
      }
      return void (histTab === 'mine' ? (myHist ? paintMyHistory() : void loadMyHistory()) : paintHistory());
    }
    if ((b = q('[data-share]'))) return void (!b.disabled && shareMyRound(b.dataset.share));
    if (q('[data-session-reset]')) return void resetSession();
    if (q('[data-custom]')) return editCustom();
    if ((b = q('[data-chip]'))) return void (!b.disabled && ((chip = Number(b.dataset.chip)), Sfx.chip(), paint(null, false)));
    if ((b = q('[data-main]'))) return void (!b.disabled && place('main', b));
    if ((b = q('[data-side]'))) return void (!b.disabled && place(b.dataset.side, b));
    if (q('[data-undo]')) return unplace();
    if (q('[data-clear]')) return clearDraft();
    if (q('[data-rebet]') && lastBet) {
      const next = { main: lastBet.main, side: { ...lastBet.side } };
      const no = canPlace(next);
      if (no) return toast(no, true);
      draft = next;
      undo = [['main', next.main], ...Object.entries(next.side)];
      return changed();
    }
    if (q('[data-ready]')) return void ready();
    if ((b = q('[data-act]'))) return void (!b.disabled && act(b.dataset.act));
    if ((b = q('[data-quit]'))) return void (!b.disabled && doQuit());
    if ((b = q('[data-rx-open]'))) return void rx.toggle(b);
  }, sig);
  host.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-side], [data-main]');
    if (!b) return;
    e.preventDefault();
    if (!b.disabled) unplace(b.dataset.side ?? 'main');
  }, sig);
  // Clavier : T tirer · R rester · D doubler · S split ; Entrée = Prêt.
  const keys = (e) => {
    if (e.target.closest?.('input') || !st || !host.isConnected) return;
    const k = { t: 'hit', r: 'stand', d: 'double', s: 'split' }[e.key.toLowerCase()];
    if (k) act(k);
    else if (e.key === 'Enter' && st.phase === 'betting' && bar.querySelector('[data-ready]:not(:disabled)')) void ready();
  };
  if (!spectator) window.addEventListener('keydown', keys, sig);

  return {
    lobby,
    join,
    open: openTable,
    get tableId() {
      return tableId;
    },
    get state() {
      return st;
    },
    get draft() {
      return draft;
    },
    destroy() {
      destroyed = true;
      clearTimeout(syncT);
      clearTimeout(lobbyT);
      life.abort();
      rx.destroy();
      ro?.disconnect();
      client.unwatch();
    },
  };
}

/**
 * The client the screen talks through (the prototype's interface), on the extension's API. Errors keep the Core's
 * details (the largest bet allowed after a refusal). The table is followed by long-poll; a lost connection resumes from
 * a snapshot (no animation replayed). The balance shown is the Core's, read again after every money movement.
 */
function coreClient(api, { onMoney = () => {} } = {}) {
  let balance = 0;
  let mine = null;
  let me = null;
  let watching = null;
  let create = null; // la politique des tables annoncée par le Core (null : un Core qui ne l'annonce pas)
  const wrap = (e) => Object.assign(e ?? new Error('network_error'), { max: e?.details?.max ?? e?.max });
  const call = async (p) => {
    try {
      return await p;
    } catch (e) {
      throw wrap(e);
    }
  };
  const refresh = async () => {
    try {
      const st = await api.casinoState();
      balance = st.me?.balance ?? balance;
    } catch {
      /* the last one */
    }
    onMoney();
  };
  return {
    get user() {
      return me;
    },
    balance: () => balance,
    refresh,
    myTable: () => mine,
    createInfo: () => create,
    async tables() {
      const r = await call(api.bjTables());
      mine = r.mine ?? null;
      create = r.create && typeof r.create === 'object' ? r.create : null;
      return r.tables;
    },
    async join({ tableId = null, seat = null, newTable = false } = {}) {
      const r = await call(api.bjJoin(tableId, seat, newTable));
      mine = r.table;
      return r;
    },
    async leave() {
      const r = await call(api.bjLeave());
      mine = null;
      void refresh();
      return r;
    },
    async placeBets({ main, side, ready }) {
      const r = await call(api.bjBet(main, side, ready));
      void refresh();
      return r;
    },
    async clearBets() {
      const r = await call(api.bjClear());
      void refresh();
      return r;
    },
    async act({ type, token, actionId }) {
      const r = await call(api.bjAct(type, token, actionId));
      if (type === 'double' || type === 'split') void refresh();
      return r;
    },
    async insure({ stake, even, actionId }) {
      const r = await call(api.bjInsure({ ...(even ? { even: true } : { stake }), action_id: actionId }));
      void refresh();
      return r;
    },
    announce: (tableId) => call(api.bjAnnounce(tableId)),
    react: (id) => call(api.bjReact(id)),
    // A9/A10 : l'historique du viewer et le partage, génériques au Casino (déjà utilisés par les autres jeux).
    history: (limit = 50) => call(api.casinoHistory('blackjack', limit)),
    share: (roundId) => call(api.casinoShare(roundId)),
    /** Follows a table: a snapshot, then each newer state (long-poll), until unwatch. A Core that handles the reactions
     *  joins them to every answer (`onReactions`, before the state) and also answers for a new reaction (`rx`). */
    async watch(table, onState, onReactions = () => {}, onGone = () => {}) {
      const token = {};
      watching = token;
      let after = -1;
      let rx = -1;
      let fails = 0;
      let phase = null;
      while (watching === token) {
        if (globalThis.document?.hidden && after >= 0) {
          await new Promise((ok) => setTimeout(ok, 1000));
          continue;
        }
        try {
          const res = await api.bjState(table, after, after < 0 ? 0 : 20_000, rx);
          const { state } = res;
          if (watching !== token) return;
          fails = 0;
          rx = Number.isSafeInteger(res.reactions?.seq) ? res.reactions.seq : -1;
          onReactions(res.reactions);
          const live = after >= 0;
          const seat = state.seats.find((x) => x?.me);
          me = seat?.user ?? me;
          if (seat) mine = state.table;
          if (state.seq > after) {
            onState(state, { live });
            after = state.seq;
          }
          if (state.phase !== phase && (state.phase === 'settled' || state.phase === 'betting')) void refresh();
          phase = state.phase;
        } catch (e) {
          if (watching !== token) return;
          fails += 1;
          if (e?.code === 'no_table' || e?.status === 404) return void onGone();
          await new Promise((ok) => setTimeout(ok, Math.min(8000, 400 * 2 ** fails)));
          after = -1; // back from a cut: a fresh snapshot (never an animation replayed)
        }
      }
    },
    unwatch() {
      watching = null;
    },
  };
}

/**
 * The blackjack screen in the casino's shadow root `D` (its `#body`). `ctx`: { client (the extension's API), casino (the
 * Core's state), follow? (a player to watch: their table) }. Returns the Mini-jeux game view.
 */
export function mountBlackjack(D, ctx) {
  const body = D.getElementById('body');
  body.className = 'cz bj-body';
  body.innerHTML = '<div class="bj-host"></div>';
  const host = body.querySelector('.bj-host');
  const refreshWallet = () => body.dispatchEvent(new globalThis.CustomEvent('jdm:host-refresh', { bubbles: true, composed: true }));
  const client = coreClient(ctx.client, { onMoney: refreshWallet });
  const casino = ctx.casino;
  const view = createTableView(host, {
    client,
    spectator: !!ctx.follow || !casino.me,
    canAnnounce: () => !!casino.limits?.bj_announce,
  });
  void (async () => {
    await client.refresh();
    try {
      const tables = await client.tables();
      // A followed player: their table, as a spectator. Else: my table (a reload, another device), or the lobby.
      const target = ctx.follow ? tables.find((t) => (t.users ?? []).includes(ctx.follow.id))?.id : client.myTable();
      if (target) return void view.open(target);
    } catch {
      /* the lobby says it */
    }
    void view.lobby();
  })();
  return {
    busy: () => false,
    // The table's money moves through the Core only; the header follows it (jdm:host-refresh). No wallet-sync here.
    wallet: () => ({ balance: client.balance(), serial: 0, busy: true }),
    sync() {},
    apply: async () => {},
    snapshot: async () => {},
    skip() {},
    destroy: () => view.destroy(),
  };
}
