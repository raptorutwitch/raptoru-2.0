// Blackjack (prototype) — L'ÉCRAN (V3, 19/11). Il n'affiche que l'état redacté que le Core lui envoie et n'envoie que
// des intentions. Les mises se posent comme à la roulette : on choisit un jeton, on touche SA place (mise principale)
// ou un score de la banque (pari banque) ; clic droit ou appui long retire un jeton ; PRÊT verrouille. La règle
// d'exposition est celle du Core (paytable.betProblem), appliquée ici avant d'envoyer pour expliquer un refus.
// Un état « en direct » anime ce qui est nouveau ; un instantané (arrivée, rafraîchissement, reconnexion) se dessine
// tel quel, sans rejouer d'animation ni de son.
import * as R from './rules.js';
import { SIDE_LABEL, SIDE_SPOTS, betProblem, oddsText, sideReturn } from './paytable.js';
import { avatarHTML, repairAvatars } from './avatar.js';
import { Sfx } from './sfx.js';

const fmt = (n) => Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
/** Montant condensé façon table : 200 · 1K · 1K5 · 12K5 · 1M2. */
function kfmt(n) {
  if (n < 1000) return String(n);
  const [u, d] = n >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const whole = Math.floor(n / u);
  const rest = Math.floor((n % u) / (u / 10));
  return whole >= 100 || !rest ? `${whole}${d}` : `${whole}${d}${rest}`;
}
const signedTxt = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CHIPS = [100, 500, 1000, 5000, 25000];
const TONES = [[25000, 't25k'], [5000, 't5k'], [1000, 't1k'], [500, 't500'], [100, 't100'], [50, 't50'], [0, 't10']];
const tone = (v) => TONES.find(([min]) => v >= min)[1];
const PHASE = { betting: 'Mises', shuffle: 'Nouveau sabot', dealing: 'Distribution', insurance: 'Assurance', players: 'Décisions', dealer: 'La banque joue', settled: 'Résultats' };
/** Le résultat de la MAIN PRINCIPALE seule (paris banque et assurance à part) : jamais confondu avec le net total. */
function mainResult(p) {
  const hands = p.hands ?? [];
  const stake = hands.reduce((a, h) => a + h.stake, 0);
  const paid = hands.reduce((a, h) => a + (h.payout ?? 0), 0);
  const v = hands.map((h) => h.verdict);
  const kind = v.includes('even') ? 'even' : v.length === 1 || v.every((x) => x === v[0]) ? v[0] : paid > stake ? 'win' : paid < stake ? 'lose' : 'push';
  return { stake, paid, net: paid - stake, kind };
}
const KIND = { blackjack: 'Blackjack', even: 'Even money', win: 'Gagné', push: 'Égalité', lose: 'Perdu', bust: 'Busted' };
const OUT = (o, d) => (o === 'BJ' ? 'Blackjack' : o === 'BUST' ? `Bust (${d})` : String(o));
const ERR = {
  not_seated: 'Assieds-toi pour miser : un spectateur ne peut rien engager.',
  betting_closed: 'Les mises sont fermées : tu joueras la prochaine manche.',
  bets_locked: 'Tu es prêt : tes mises sont verrouillées pour cette manche.',
  insufficient_balance: 'Solde insuffisant.',
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
};
const why = (e, L) =>
  e?.code === 'max_win'
    ? `Gain possible trop élevé (splits et doubles compris) : mise de ${fmt(Math.max(L?.mainMin ?? 100, e.max ?? 0))} au plus${e.max < (L?.mainMin ?? 100) ? ' — retire des paris banque' : ''}.`
    : e?.code === 'side_max_return'
      ? `Paris banque : ${fmt(e.max)} de retour au plus par manche.`
      : ERR[e?.code] ?? 'Ça n’a pas marché : réessaie.';
const SILENT = new Set(['stale_turn', 'no_decision_now']);

const cardHTML = (c, k) =>
  c.hidden
    ? `<span class="card back" data-k="${k}"></span>`
    : `<span class="card${c.red ? ' red' : ''}" data-k="${k}"><b>${c.rank}</b><i>${c.suit}</i><em>${c.suit}</em></span>`;
/** Une pile de jetons dessinée (les plus grosses valeurs en bas), au plus 5 disques. */
function stackHTML(amount) {
  const discs = [];
  let left = amount;
  for (const v of [25000, 5000, 1000, 500, 100, 50, 10]) while (left >= v && discs.length < 5) (discs.push(v), (left -= v));
  return discs.map((v, i) => `<i class="disc ${tone(v)}" style="--i:${i}"></i>`).join('');
}
const totText = (h) => (h.cards.length ? (h.soft && h.total < 21 ? `${h.total - 10}/${h.total}` : String(h.total)) : '');

/** Dans la case : « B » pour Blackjack (le nom complet au survol). */
const SHORT = { ...SIDE_LABEL, BJ: 'B' };
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
};
const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>`;
let uidN = 0;

/** Un écran de blackjack dans `host`. `client` : createClient() ; `onTitle(text)`. */
export function createTableView(host, { client, spectator = false, onTitle = () => {}, log = () => {} }) {
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
            ${SIDE_SPOTS.map((k) => `<button type="button" class="side" data-side="${k}"${SHORT[k] !== SIDE_LABEL[k] ? ` data-full="${SIDE_LABEL[k]}"` : ''}><b>${SHORT[k]}</b><small>paye ${oddsText(k)}</small><span class="sv"></span></button>`).join('')}
          </div>
          <div class="spot" aria-live="polite"></div>
          <div class="seats"></div>
          <button type="button" class="htab" data-hist aria-label="Historique des manches" title="Historique">${icon('clock')}<span>Historique</span><i class="hn"></i></button>
          <button type="button" class="rtab" data-rules aria-label="Règles du jeu" title="Règles">${icon('rules')}<span>Règles</span></button>
          <aside class="rules" aria-label="Règles du jeu"><header><b>Règles</b><button type="button" class="ic" data-rules aria-label="Fermer">✕</button></header>
            <ul>
              <li><b>But :</b> approcher 21 sans le dépasser, et faire mieux que la banque.</li>
              <li><b>Blackjack</b> (As + 10 ou figure, en 2 cartes) : payé <b>3:2</b>. Victoire 1:1, égalité = mise rendue.</li>
              <li>La <b>banque tire</b> jusqu’à 16 et <b>reste dès 17</b>.</li>
              <li><b>Banque bust</b> (plus de 21) : tous les joueurs encore en jeu gagnent. Une main déjà bust reste perdue.</li>
              <li><b>Assurance</b> si la banque montre un As : jusqu’à la moitié de ta mise, payée <b>2:1</b> si elle a blackjack, perdue sinon.</li>
              <li><b>Doubler :</b> une seule carte, mise ×2. <b>Split :</b> une paire devient deux mains.</li>
              <li><b>Score de la banque :</b> « paye 11:2 » = 11 de gain pour 2 misés (100 → +550).</li>
            </ul></aside>
          <aside class="hist" aria-label="Historique des manches"><header><b>Dernières manches</b><button type="button" class="ic" data-hist aria-label="Fermer">✕</button></header><div class="hist__list"></div></aside>
          <div class="fly" aria-hidden="true"></div>
          <div class="tip" role="tooltip" hidden></div>
        </div>
        <div class="bar"></div>
      </section>
      <div class="toast" role="status"></div>
    </div>`;
  const $ = (q) => host.querySelector(q);
  const bj = $('.bj');
  const felt = $('.felt');
  const bar = $('.bar');
  const spot = $('.spot');
  const seatsEl = $('.seats');
  const tip = $('.tip');
  // Tous les écouteurs de cet écran tombent avec lui (un écran recréé sur le même cadre ne double aucun clic).
  const life = new AbortController();
  const sig = { signal: life.signal };
  repairAvatars(host, life.signal);
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
  const open = new Set(); // les manches dépliées dans l'historique
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
    const LB = $('.lobby');
    LB.hidden = false;
    onTitle('Blackjack');
    let tables = [];
    try {
      tables = await client.tables();
    } catch (e) {
      fail(e);
    }
    if (destroyed || mode !== 'lobby') return;
    const my = client.myTable();
    LB.innerHTML = `
      <header><b>Tables de blackjack</b><small>8 paquets · jusqu’à 10 joueurs · chacun contre la banque · mise dès 100</small></header>
      <div class="tlist">${
        tables
          .map(
            (t) => `<div class="trow${t.id === my ? ' mine' : ''}"><span class="tno">Table ${t.no}</span><span class="dots" title="${spectator || my ? '' : 'Choisis ta place'}">${(t.taken ?? []).map((on, i) => `<button type="button" class="${on ? 'on' : ''}" ${!on && !spectator && !my ? `data-join="${t.id}" data-seat="${i}" title="Place ${i + 1}"` : 'disabled'}></button>`).join('')}</span><span class="tph">${t.players}/${t.seats} · ${PHASE[t.phase] ?? ''}</span>
            ${t.id === my ? `<button type="button" class="btn go" data-open="${t.id}">Ma table</button>` : `<button type="button" class="btn" data-watch="${t.id}">Regarder</button>`}</div>`,
          )
          .join('') || '<p class="none">Aucune table ouverte pour l’instant.</p>'
      }</div>
      ${spectator || my ? '' : '<button type="button" class="btn go wide" data-join="">Trouver une place</button>'}
      <p class="fine">Touche une place libre pour t’y asseoir. Une table en pleine manche : tu joues la suivante.</p>`;
  }
  async function join(id, seat = null) {
    try {
      const j = await client.join(id ? { tableId: id, ...(seat !== null ? { seat } : {}) } : {});
      if (j.nextRound) toast('Tu rejoindras la manche suivante.');
      if (j.resumed) toast('Tu reprends ta place : ta main a continué sans toi.');
      await openTable(j.table);
    } catch (e) {
      fail(e);
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
    await client.watch(id, onState);
  }

  // --- L'état du Core -----------------------------------------------------------------------------------------
  function onState(next, { live }) {
    if (destroyed || next.table !== tableId) return;
    if (next.seq <= lastSeq) return; // doublon ou plus ancien : jamais d'animation ni de paiement rejoué
    const animate = live && lastSeq >= 0 && next.seq === lastSeq + 1;
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
    if (animate && next.last?.type === 'peek') toast(me?.insurance?.stake ? `Pas de blackjack pour la banque : assurance perdue (−${fmt(me.insurance.stake)}), la main continue.` : 'Pas de blackjack pour la banque : la main continue.');
    if (animate && next.phase === 'settled' && prev?.phase !== 'settled') payFlights(next);
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
    bj.classList.toggle('my-turn', !!(me && s.turn?.seat === me.seat && s.phase === 'players'));
    $('.shoe small').textContent = s.shoe.shuffling ? '…' : String(s.shoe.size - s.shoe.dealt);
    $('.shoe').dataset.tip = s.shoe.shuffling ? 'Nouveau sabot : 8 paquets mélangés' : `Sabot : ${s.shoe.size - s.shoe.dealt} cartes sur ${s.shoe.size}|8 paquets · remélangé au dernier quart`;
    $('.shoe').classList.toggle('mixing', !!s.shoe.shuffling);
    $('.htab .hn').textContent = s.history.length ? String(s.history.length) : '';
    const df = [];
    cardsInto($('[data-zone="dealer"]'), s.dealer.cards, `d${s.roundId}`, df);
    fresh.push(...df);
    const dt = $('[data-tot="dealer"]');
    dt.textContent = s.dealer.cards.length ? (s.dealer.natural ? 'BJ' : s.dealer.total > 21 ? `${s.dealer.total} · bust` : String(s.dealer.total)) : '';
    dt.className = `tot${s.dealer.natural ? ' bj' : s.dealer.total > 21 ? ' bust' : ''}`;
    paintSides(s, me);
    paintSeats(s, fresh);
    paintSpot(s, fresh, me);
    paintBar(s, me);
    if (felt.classList.contains('hist-open')) paintHistory();
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
    const flat = W < 420;
    box.classList.toggle('flat', flat);
    const span = Math.min(210, W / 2 - 41);
    const [yEdge, depth] = [40, 40];
    const cx = W / 2;
    felt.querySelectorAll('[data-side]').forEach((b, i) => {
      if (flat) return void ((b.style.left = ''), (b.style.top = ''));
      const u = (i - 3) / 3;
      b.style.left = `${Math.round(cx + span * u)}px`;
      b.style.top = `${Math.round(yEdge + depth * (1 - u * u))}px`;
    });
    // Une parabole exacte = une courbe de Bézier quadratique (contrôle au double de la flèche).
    const ty = yEdge + 31; // le titre : sous les cases, avec de l'air
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
    const n = Math.max(1, layout.length);
    const W = felt.clientWidth || 547;
    const narrow = W < 420;
    const perRow = narrow ? (n > 6 ? 5 : n > 4 ? 3 : n) : n;
    const max = narrow ? (n <= 3 ? 96 : 60) : n <= 2 ? 128 : n <= 3 ? 116 : n <= 5 ? 92 : n <= 7 ? 70 : 50;
    const gap = n >= 9 ? 4 : 8;
    const sw = Math.floor(Math.min(max, (W - 28 - gap * (perRow - 1)) / perRow));
    seatsEl.style.setProperty('--sw', `${sw}px`);
    seatsEl.style.setProperty('--gap', `${gap}px`);
    seatsEl.style.setProperty('--mw', `${Math.max(18, Math.min(narrow ? 21 : 25, Math.round(sw * 0.3)))}px`);
    seatsEl.style.setProperty('--av', `${Math.max(14, Math.min(20, Math.round(sw * 0.17)))}px`);
    seatsEl.dataset.size = n <= 3 ? 'xl' : n <= 5 ? 'l' : n <= 7 ? 'm' : 's';
    const have = new Map([...seatsEl.querySelectorAll('.seat')].map((x) => [Number(x.dataset.seat), x]));
    const nodes = layout.map((i, k) => {
      let el = have.get(i);
      if (!el) {
        el = document.createElement('div');
        el.className = 'seat';
        el.dataset.seat = String(i);
        el.innerHTML = '<span class="tag"></span><div class="hand"><div class="cards mini"></div><span class="ms"></span><button type="button" class="sb" data-main hidden aria-label="Ma place : poser le jeton choisi"><span class="sb__stack"></span><b class="sb__amt"></b></button><span class="tot"></span><span class="bustb">Busted</span></div><div class="pl"><span class="avw"></span><span class="nm"></span></div><div class="bet"></div><i class="tm"></i>';
      }
      have.delete(i);
      // L'arc : chaque place est posée sur la courbe du feutre (même ellipse que .felt::before), juste au-dessus.
      const dx = ((k % perRow) - (perRow - 1) / 2) * (sw + gap);
      const lift = ARC_B * (Math.sqrt(Math.max(0, 1 - (dx / W) ** 2)) - 1);
      el.style.setProperty('--lift', narrow ? '0px' : `${lift.toFixed(1)}px`);
      paintSeat(el, s, i, fresh);
      return el;
    });
    for (const x of have.values()) x.remove();
    nodes.forEach((node, k) => seatsEl.children[k] !== node && seatsEl.insertBefore(node, seatsEl.children[k] ?? null));
    // Les places libres ne prennent pas de place : une pastille discrète (et, pour un arrivant, « manche suivante »).
    let extra = seatsEl.querySelector('.freepill');
    const free = s.seats.filter((x) => !x).length;
    const label = later ? `+${later} à la manche suivante` : free && !mine() ? `${free} libre${free > 1 ? 's' : ''}` : '';
    if (!label) extra?.remove();
    else {
      if (!extra) ((extra = document.createElement('span')), (extra.className = 'freepill'));
      extra.textContent = label;
      seatsEl.append(extra);
    }
  }
  function paintSeat(el, s, i, fresh) {
    const p = s.seats[i];
    const turn = s.turn?.seat === i && s.phase === 'players';
    const hi = turn ? s.turn.hand : Math.max(0, p.hands.length - 1);
    const h = p.hands[hi];
    const busted = !!h && h.total > 21;
    const myBetting = p.me && s.phase === 'betting' && p.status === 'seated';
    el.className = `seat${p.me ? ' me' : ''}${turn ? ' turn' : ''}${p.status === 'left' ? ' left' : ''}${!p.connected ? ' off' : ''}${!p.inRound && s.phase !== 'betting' ? ' wait' : ''}${s.phase === 'betting' && p.bet?.ready ? ' ready' : ''}${busted ? ' busted' : ''}${myBetting ? ' betting' : ''}`;
    const avw = el.querySelector('.avw');
    const avKey = `${p.user}|${p.avatar ?? ''}`;
    if (avw.dataset.k !== avKey) ((avw.dataset.k = avKey), (avw.innerHTML = avatarHTML(p)));
    el.querySelector('.nm').innerHTML = `${p.me ? '<b>Toi</b>' : esc(p.name)}${!p.connected ? ' <i class="ic-off" title="Déconnecté">⏻</i>' : ''}`;
    el.title = `${p.name}${p.status === 'left' ? ' — parti : sa main reste (RESTER) et sera payée' : ''}${!p.connected ? ' — déconnecté' : ''}`;
    const fr = [];
    cardsInto(el.querySelector('.cards'), h ? h.cards : [], `s${i}:${s.roundId}:${hi}`, fr);
    fresh.push(...fr);
    // Ma place pendant les mises : le cercle où poser mes jetons (ma pile, mon montant).
    const sb = el.querySelector('.sb');
    sb.hidden = !myBetting;
    if (myBetting) {
      const amt = draft.main;
      const st2 = sb.querySelector('.sb__stack');
      if (st2.dataset.v !== String(amt)) ((st2.dataset.v = String(amt)), (st2.innerHTML = stackHTML(amt)));
      sb.querySelector('.sb__amt').textContent = amt ? kfmt(amt) : '';
      sb.classList.toggle('has', !!amt);
      sb.disabled = !!p.bet?.ready;
    }
    // Les autres pendant les mises : leur petite pile.
    const ms = el.querySelector('.ms');
    const pile = s.phase === 'betting' && p.bet && !myBetting ? `${p.bet.main}` : '';
    if (ms.dataset.v !== pile) ((ms.dataset.v = pile), (ms.innerHTML = pile ? stackHTML(p.bet.main) : ''));
    const tot = el.querySelector('.tot');
    tot.textContent = h ? (h.natural ? 'BJ' : totText(h)) : '';
    tot.className = `tot${h?.natural ? ' bj' : busted ? ' bust' : ''}`;
    tot.dataset.hands = p.hands.length > 1 ? `${hi + 1}/${p.hands.length}` : '';
    const stake = p.hands.length ? p.hands.reduce((a, x) => a + x.stake, 0) : (myBetting ? draft.main : p.bet?.main) ?? 0;
    const sides = myBetting ? Object.keys(draft.side).length : p.sideCount;
    // La mise : une étiquette ; aux résultats, la même étiquette devient le résultat NET de la manche.
    const r = s.phase === 'settled' ? p.result : null;
    const bet = el.querySelector('.bet');
    if (r) {
      // Le résultat de SA MAIN (sa couleur, son montant) ; les paris banque et l'assurance sont dans la bulle.
      const m = mainResult(p);
      const cls = { blackjack: 'blackjack', even: 'win', win: 'win', push: 'push', lose: 'lose', bust: 'lose' }[m.kind] ?? 'push';
      bet.className = `bet res ${cls}`;
      bet.innerHTML = `${m.kind === 'blackjack' ? '<small>BJ</small>' : ''}${m.net > 0 ? `+${kfmt(m.net)}` : m.net < 0 ? `−${kfmt(-m.net)}` : 'Égalité'}`;
      const extra = [...Object.entries(r.side ?? {}).map(([k, x]) => `pari ${SIDE_LABEL[k]} ${signedTxt(x.payout - x.stake)}`), ...(r.insurance ? [`assurance ${signedTxt(r.insurance.payout - r.insurance.stake)}`] : [])];
      bet.title = `Main : ${KIND[m.kind] ?? ''} ${signedTxt(m.net)}${extra.length ? ` · ${extra.join(' · ')} · total ${signedTxt(r.net)}` : ''}`;
    } else {
      bet.className = 'bet';
      bet.removeAttribute('title');
      bet.innerHTML = stake
        ? `<i class="chipdot ${tone(stake)}"></i>${kfmt(stake)}${sides ? '<small title="Paris sur la banque">B</small>' : ''}${p.insurance?.stake ? `<small class="ins" title="Assurance ${fmt(p.insurance.stake)}">A</small>` : p.insurance?.even ? '<small class="ins" title="Even money">EM</small>' : ''}${s.phase === 'betting' && p.bet?.ready ? '<em title="Prêt">✓</em>' : ''}`
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
  function paintSpot(s, fresh, me) {
    const t = s.turn;
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
      const nat = mine && me.hands[0]?.natural;
      html = `<div class="msg ins"><b>${icon('shield')}Assurance ?</b><small>${mine ? (nat ? 'Tu as un blackjack : prends l’even money (+' + fmt(me.hands[0].stake) + ' garanti) ou tente le 3:2.' : `La banque montre un As : jusqu’à ${fmt(Math.floor(me.hands[0].stake / 2))}, payée 2:1 si elle a blackjack.`) : 'La banque montre un As : chacun peut s’assurer.'}</small><small class="tally">${answered}/${inRound} ont répondu</small></div>`;
    } else if (s.phase === 'shuffle') {
      key = 'shuffle';
      html = '<div class="msg"><b>Nouveau sabot</b><small>8 paquets mélangés</small></div>';
    } else if (s.phase === 'dealing') {
      key = `deal:${s.round}`;
      html = '';
    } else if (t) {
      const p = s.seats[t.seat];
      key = `turn:${t.seat}:${t.hand}:${p.hands.length}:${s.roundId}`;
      html = `<div class="who${p.me ? ' me' : ''}">${avatarHTML(p, 'av big')}<div><b>${p.me ? 'À toi de jouer' : esc(p.name)}</b><span class="lbl">${p.me ? 'ton tour' : 'à son tour'}${p.hands.length > 1 ? ` · main ${t.hand + 1}/${p.hands.length}` : ''}</span><small class="st"></small></div></div><div class="cards big" data-zone="spot"></div><span class="tot" data-tot="spot"></span>`;
    } else if (s.phase === 'dealer') {
      key = `dealer:${s.round}`;
      html = '<div class="msg"><b>La banque joue</b><small>elle tire jusqu’à 16 et reste sur tous les 17</small></div>';
    } else if (s.phase === 'settled') {
      key = `settled:${s.round}`;
      const out = s.outcome === 'BJ' ? 'Blackjack de la banque' : s.outcome === 'BUST' ? 'La banque saute' : `La banque fait ${s.outcome}`;
      const r = me?.result;
      const m = me && r ? mainResult(me) : null;
      const bjMe = m?.kind === 'blackjack';
      // Ma main d'abord (son verdict, son montant), puis les à-côtés et le total : jamais « égalité » pour un net nul.
      const extra = r ? [...Object.entries(r.side ?? {}).map(([k, x]) => `pari ${SIDE_LABEL[k]} ${signedTxt(x.payout - x.stake)}`), ...(r.insurance ? [`assurance ${signedTxt(r.insurance.payout - r.insurance.stake)}`] : [])] : [];
      html = `<div class="msg res${bjMe ? ' bj' : ''}"><b>${out}</b>${m ? `<span class="me ${m.net > 0 ? 'g' : m.net < 0 ? 'l' : ''}">${KIND[m.kind] ?? ''}${m.net ? ` ${signedTxt(m.net)}` : ''}</span>${extra.length ? `<small>${extra.join(' · ')} · <b class="${r.net > 0 ? 'g' : r.net < 0 ? 'l' : ''}">total ${signedTxt(r.net)}</b></small>` : ''}` : ''}</div>`;
    }
    if (spot.dataset.key !== key) {
      spot.dataset.key = key;
      spot.innerHTML = html;
      spot.classList.remove('in');
      void spot.offsetWidth;
      spot.classList.add('in');
    }
    if (t && s.phase === 'players' && spot.querySelector('[data-zone="spot"]')) {
      const p = s.seats[t.seat];
      const h = p.hands[t.hand];
      const fr = [];
      cardsInto(spot.querySelector('[data-zone="spot"]'), h.cards, `sp${t.seat}:${s.roundId}:${t.hand}`, fr);
      fresh.push(...fr);
      const tot = spot.querySelector('[data-tot="spot"]');
      tot.textContent = totText(h);
      tot.className = `tot${h.total > 21 ? ' bust' : ''}`;
    }
  }

  // --- La barre : jetons et PRÊT, ou les 4 actions, ou ce qui se passe ------------------------------------------------
  const isMyTurn = (s, me) => !!(me && s.turn && s.turn.seat === me.seat && s.phase === 'players');
  const reserved = () => (mine()?.bet ? mine().bet.main + Object.values(mine().side ?? {}).reduce((a, b) => a + b, 0) : 0);
  const draftTotal = (d = draft) => d.main + Object.values(d.side).reduce((a, b) => a + b, 0);
  const spendable = () => client.balance() + reserved();
  function paintBar(s, me) {
    let key;
    let html;
    if (!me) {
      key = `spect:${s.seats.includes(null)}`;
      html = `<div class="state"><b>Spectateur</b><small>table ${s.no} en direct · tu ne peux ni miser ni jouer</small></div><button type="button" class="btn" data-lobby>${icon('tables')}Tables</button>${!spectator && s.seats.includes(null) ? `<button type="button" class="btn go" data-lobby>S’asseoir</button>` : ''}`;
    } else if (me.status === 'seated' && s.phase === 'betting' && !me.bet?.ready) {
      const total = draftTotal();
      const left = spendable() - total;
      const no = draft.main ? betProblem(draft, L()) : { code: 'bad_main_bet' };
      key = `bet:${JSON.stringify(draft)}:${chip}:${custom}:${left}:${undo.length}:${pending}:${!!lastBet}`;
      const chips = [...CHIPS, ...(custom && !CHIPS.includes(custom) ? [custom] : [])];
      html = `<div class="chips" role="radiogroup" aria-label="Jeton à poser">${chips.map((v) => `<button type="button" class="chip ${tone(v)}${v === chip ? ' on' : ''}${v === custom ? ' cu' : ''}" data-chip="${v}" role="radio" aria-checked="${v === chip}" aria-label="Jeton ${fmt(v)}"${v > spendable() ? ' disabled' : ''}>${kfmt(v)}</button>`).join('')}<button type="button" class="chip custom" data-custom title="Jeton libre : le montant exact" aria-label="Jeton libre">✎</button></div>
        <div class="ops"><button type="button" class="ic k-undo" data-undo title="Retirer le dernier jeton posé" aria-label="Retirer le dernier jeton"${undo.length ? '' : ' disabled'}>${icon('undo')}</button><button type="button" class="ic k-clear" data-clear title="Tout retirer" aria-label="Tout retirer"${total ? '' : ' disabled'}>${icon('clear')}</button><button type="button" class="ic k-rebet" data-rebet title="Mêmes mises que la manche précédente" aria-label="Rejouer les mêmes mises"${lastBet ? '' : ' disabled'}>${icon('rebet')}</button></div>
        <div class="sum" title="Engagé · reste"><b>${fmt(total)}</b><small>reste ${fmt(Math.max(0, left))}</small></div>
        <button type="button" class="btn go ready" data-ready${no || pending || left < 0 ? ' disabled' : ''} title="${no ? esc(why(no, L())) : 'Verrouiller mes mises'}">Prêt</button>`;
    } else if (me.status === 'seated' && s.phase === 'betting') {
      key = `ready:${s.ready}:${s.waiting}`;
      html = `<div class="state"><b>Prêt ✓ — mises verrouillées</b><small>${s.ready} sur ${s.ready + s.waiting} · la donne part quand tout le monde est prêt</small></div>`;
    } else if (s.phase === 'insurance' && me.inRound && me.insurance === null) {
      const h = me.hands[0];
      const max = Math.floor(h.stake / 2);
      key = `ins:${s.round}:${pending}`;
      html = h.natural
        ? `<div class="acts two"><button type="button" class="act k-ins" data-ins="even"${pending ? ' disabled' : ''} title="Ton blackjack payé 1:1 tout de suite, quoi qu’ait la banque">${icon('shield')}<b>Even money</b><small>+${kfmt(h.stake)}</small></button><button type="button" class="act k-no" data-ins="0"${pending ? ' disabled' : ''} title="Garder la chance du 3:2 (égalité si la banque a blackjack)"><b>Non merci</b></button></div><i class="tmbar big"><i></i></i>`
        : `<div class="acts two"><button type="button" class="act k-ins" data-ins="${max}"${pending || max > client.balance() ? ' disabled' : ''} title="Payée 2:1 si la banque a blackjack (+${fmt(max * 2)}), perdue sinon">${icon('shield')}<b>Assurer</b><small>${kfmt(max)}</small></button><button type="button" class="act k-no" data-ins="0"${pending ? ' disabled' : ''}><b>Non merci</b></button></div><i class="tmbar big"><i></i></i>`;
    } else if (isMyTurn(s, me)) {
      const h = me.hands[s.turn.hand];
      const raw = { cards: h.cards.map((c) => c.id), stake: h.stake, fromSplit: h.fromSplit, splitAces: h.splitAces, done: h.done };
      const a = R.actions(raw, { handsCount: me.hands.length, balance: client.balance() });
      key = `turn:${s.turn.token}:${pending}:${JSON.stringify(a)}`;
      const b = (k, label, kb, extra = '') => `<button type="button" class="act k-${k}" data-act="${k}"${!a[k] || pending ? ' disabled' : ''} title="${label} (touche ${kb})">${icon(k)}<b>${label}</b>${extra}</button>`;
      html = `<div class="acts">${b('hit', 'Tirer', 'T')}${b('stand', 'Rester', 'R')}${b('double', 'Doubler', 'D', `<small>+${kfmt(h.stake)}</small>`)}${b('split', 'Split', 'S', `<small>+${kfmt(h.stake)}</small>`)}</div><i class="tmbar big"><i></i></i>`;
    } else {
      key = `info:${s.phase}:${s.turn?.token ?? ''}:${me.status}:${me.inRound}`;
      const who = s.turn ? s.seats[s.turn.seat] : null;
      const VERD = { blackjack: 'Blackjack', even: 'Even money', win: 'Gagné', push: 'Égalité', lose: 'Perdu', bust: 'Busted' };
      const myLine = me.hands.length ? me.hands.map((h) => (h.verdict ? VERD[h.verdict] : h.natural ? 'Blackjack' : h.total > 21 ? 'Busted' : String(h.total))).join(' · ') : '';
      const text =
        me.status === 'left' ? 'Tu as quitté la table : ta main reste et sera payée normalement.' :
        !me.inRound && s.phase !== 'betting' ? 'Tu rejoindras la manche suivante.' :
        s.phase === 'insurance' ? (me.insurance?.even ? 'Even money pris : +' + fmt(me.hands[0].stake) + ' assurés' : me.insurance?.stake ? `Assurance prise : ${fmt(me.insurance.stake)}` : me.insurance ? 'Pas d’assurance' : 'Assurance proposée') :
        s.phase === 'players' && who ? `Au tour de ${esc(who.name)}` :
        s.phase === 'dealer' ? 'La banque joue…' :
        s.phase === 'settled' ? 'Prochaine manche dans un instant' :
        PHASE[s.phase] ?? '';
      html = `<div class="state"><b>${text}</b>${myLine ? `<small>ta main : ${myLine}</small>` : ''}</div><button type="button" class="btn k-leave" data-leave title="Quitter la table">${icon('leave')}Quitter</button>`;
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
  const VERDICT = { blackjack: 'blackjack', even: 'even money', win: 'gagné', push: 'égalité', lose: 'perdu', bust: 'busted' };
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
    if (ts) (ts.style.setProperty('--p', String(v)), ts.classList.toggle('show', show));
    const label = spot.querySelector('.st');
    if (label) label.textContent = show && msLeft > 0 ? `encore ${Math.ceil(msLeft / 1000)} s` : '';
    const safety = spot.querySelector('.safety');
    if (safety) {
      const left = st.phase === 'betting' && st.betDeadline ? st.betDeadline - now() : null;
      safety.textContent = left !== null && left < 15_000 && left > 0 ? `Distribution dans ${Math.ceil(left / 1000)} s avec les joueurs prêts` : '';
    }
    const me = mine();
    if (me && st.turn?.seat === me.seat && show && msLeft > 0 && msLeft < 3200) {
      const k = `${st.turn.token}:${Math.ceil(msLeft / 1000)}`;
      if (k !== tickedFor) ((tickedFor = k), Sfx.tick());
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
    f.innerHTML = `<input inputmode="numeric" placeholder="ex. 250" aria-label="Montant du jeton libre" value="${custom ?? ''}"><button type="submit" class="btn go">OK</button>`;
    bar.append(f);
    const input = f.querySelector('input');
    input.focus();
    input.select();
    const done = (ok) => {
      if (!typing) return;
      typing = false;
      f.remove();
      if (ok && input.value.trim()) {
        const raw = Number(String(input.value).replace(/[\s ]/g, '').replace(/k$/i, '000'));
        const v = Math.floor(raw / 10) * 10;
        if (!Number.isFinite(raw) || v < 10) toast('Jeton libre : 10 minimum, en multiples de 10.', true);
        else ((custom = v), (chip = v));
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
    if (q('[data-rules]')) return void felt.classList.toggle('rules-open');
    if ((b = q('[data-ins]'))) return void (!b.disabled && insure(b.dataset.ins));
    if (q('[data-hist]')) {
      felt.classList.toggle('hist-open');
      if (felt.classList.contains('hist-open')) paintHistory();
      return;
    }
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
    if (q('[data-leave]')) {
      client.leave().then((r) => {
        toast(r.engaged ? 'Table quittée : ta main reste en jeu (RESTER) et sera payée normalement.' : r.refunded ? 'Table quittée : ta mise non engagée t’est rendue.' : 'Table quittée.');
        lobby();
      }, fail);
    }
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
      life.abort();
      ro?.disconnect();
      client.unwatch();
    },
  };
}
