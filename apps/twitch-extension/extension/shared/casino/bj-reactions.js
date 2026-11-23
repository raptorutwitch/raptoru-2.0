// Casino V1 — les réactions à la table de Blackjack (docs/CASINO.md § 18). Un viewer assis choisit une émote dans une
// petite bulle (qui reste ouverte : on peut en envoyer plusieurs) ; elle s'envole au-dessus de sa place, chez tous les
// joueurs et les spectateurs, comme une petite émote remplie d'hélium. Aucun texte libre, aucun Jeton : seulement les
// identifiants que le Core accepte (r1 … r13, s1 … s9), transmis par le Core avec l'état de la table (long-poll), à son rythme
// (rafale de 5, puis une toutes les 2 s : reactions.ts, recopié ici pour un retour immédiat). Les visuels et les
// réactions de la banque sont dans assets/casino/reactions/reactions.js : les changer ne touche jamais ce fichier.
// Deux pages (mandat du 22/11) : les 10 classiques pour tous ; une petite flèche ouvre celle des abonnés de la chaîne,
// montrée seulement quand le Core annonce l'abonnement (`sub: 'yes'`, avec leurs identifiants) — il le revérifie à
// chaque envoi (sub_only, sub_unknown). Les émotes des abonnés s'envolent chez tout le monde, comme les autres.
//
// Activé seulement si le Core l'annonce (`reactions` dans la réponse de l'état de la table) : un Core qui ne connaît pas
// les réactions n'affiche ni bouton ni bulle. La banque réagit parfois (pickDealerReaction) d'une émote seule : un choix
// déterministe à partir de la manche, le même chez tous les viewers — jamais une IA, jamais à chaque manche.
import { REACTIONS, PAGES, DEALER, assetUrl } from '../../assets/casino/reactions/reactions.js';

const BY_ID = new Map(REACTIONS.map((r) => [r.id, r]));
const FRESH_MS = 3500; // plus vieille : jamais rejouée (reconnexion, onglet revenu au premier plan)
const PER_SEAT = 6; // un petit nuage au plus par place
// Le rythme du Core (reactions.ts) : 5 réactions d'affilée, puis une de plus toutes les 2 s.
export const BURST = 5;
export const REFILL_MS = 2000;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICON = {
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  mute: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  sound: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10"/>',
};
const ico = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

/** Un nombre de 0 à 1, le même partout pour la même clé (FNV-1a 32 bits). */
export function unit(key) {
  let h = 0x811c9dc5;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h / 0x100000000;
}
/**
 * La réaction de la banque à une manche réglée, ou null. Déterministe (table, manche) : chaque viewer voit la même. Au
 * plus une par manche (la situation la plus marquante), seulement avec la probabilité de cette situation (`chance`,
 * reactions.js : ≈ 1 manche sur 4 au total). `s` : l'état de la table (phase settled) ; `mainMin` : la mise minimum (un
 * « gros gain » = au moins 10 fois) ; `cfg` : les associations (DEALER de reactions.js par défaut). Une émote seule.
 */
export function pickDealerReaction(s, mainMin = 100, cfg = DEALER) {
  if (s?.phase !== 'settled') return null;
  const players = s.seats.filter((p) => p?.result);
  if (!players.length) return null;
  const hands = players.flatMap((p) => p.hands ?? []);
  const big = 10 * mainMin;
  const won = (h) => h.verdict === 'win' || h.verdict === 'blackjack' || h.verdict === 'even';
  const kind =
    s.outcome === 'BJ' ? 'dealer_bj'
    : hands.some((h) => h.verdict === 'blackjack') ? 'blackjack'
    : players.some((p) => p.result.net >= big) ? 'big_win'
    : players.some((p) => p.result.net <= -big) ? 'big_loss'
    : s.outcome === 'BUST' ? 'dealer_bust'
    : hands.some((h) => h.doubled && won(h)) ? 'double_win'
    : hands.some((h) => h.doubled && (h.verdict === 'lose' || h.verdict === 'bust')) ? 'double_lose'
    : hands.some((h) => h.fromSplit) ? 'split'
    : hands.some((h) => h.verdict === 'bust') ? 'bust'
    : hands.length && hands.every((h) => h.verdict === 'push') ? 'push'
    : players.some((p) => p.result.net > 0) ? 'win'
    : players.every((p) => p.result.net < 0) ? 'dealer_win'
    : null;
  const c = kind && cfg[kind];
  if (!c || unit(`${s.table}:${s.round}:${kind}`) >= (c.chance ?? 0)) return null;
  const ids = (Array.isArray(c.r) ? c.r : [c.r]).filter((id) => BY_ID.has(id));
  if (!ids.length) return null;
  return { kind, r: ids[Math.floor(unit(`${s.table}:${s.round}:pick`) * ids.length)] };
}

/**
 * Le rythme des réactions (le même que le Core) : un réservoir de `BURST` jetons, un de plus tous les `REFILL_MS`.
 * `take(now)` : true si une réaction peut partir (et la compte), sinon false ; `wait(now)` : les ms avant la prochaine.
 */
export function createBucket(burst = BURST, refill = REFILL_MS) {
  let tokens = burst;
  let at = 0;
  const fill = (now) => {
    tokens = Math.min(burst, tokens + Math.max(0, now - at) / refill);
    at = now;
  };
  return {
    take(now) {
      fill(now);
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    wait(now) {
      fill(now);
      return tokens >= 1 ? 0 : Math.ceil((1 - tokens) * refill);
    },
    /** Le Core a refusé (react_rate) : vide jusqu'à ce qu'il le permette. */
    empty(now, retryMs) {
      at = now;
      tokens = 1 - retryMs / refill; // wait() rend alors exactement retryMs
    },
  };
}

// Les images des réactions chargées une fois, dès que le Core les annonce : une émote reçue s'affiche sans délai (le GIF
// animé pèse ≈ 0,5 Mo). Toujours affichées par <img> : un GIF ou un WebP animé garde son animation et sa transparence.
const preloaded = new Set(); // celles des abonnés : seulement pour un abonné (les autres les chargent à leur premier envol)
function preload(ids) {
  if (typeof Image !== 'function') return;
  for (const r of REACTIONS) {
    if (!ids.has(r.id) || preloaded.has(r.id)) continue;
    preloaded.add(r.id);
    new Image().src = assetUrl(r.src);
  }
}
const imgHTML = (r, cls) => `<img class="${cls}" src="${esc(assetUrl(r.src))}" alt="${esc(r.label ?? '')}" draggable="false" data-glyph="${esc(r.glyph ?? '')}">`;
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * L'envol d'une émote (mandat du 22/11, « une petite émote remplie d'hélium ») : elle grandit avec un petit rebond
 * pendant qu'elle commence DÉJÀ à monter ; la montée est continue et régulière (aucun arrêt, aucune accélération
 * brutale), dérive un peu à gauche ou à droite, et l'émote s'efface pendant le dernier tiers. Chaque émote a sa propre
 * trajectoire et sa propre durée (un nuage, jamais une pile au même endroit). Mouvement réduit : un fondu sur place.
 * `n` : l'ancre (0 × 0) posée au pied de l'émote ; son image garde sa propre animation (GIF, WebP).
 */
function float(n, { rise = rand(32, 44), drift = rand(-16, 16), ms = rand(2700, 3300) } = {}) {
  const img = n.firstElementChild;
  const done = () => n.remove();
  if (reducedMotion() || typeof n.animate !== 'function') {
    if (typeof n.animate !== 'function') return void setTimeout(done, ms);
    n.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }).onfinish = done;
    return;
  }
  // La montée : une seule courbe douce sur toute la durée (vitesse déjà là au départ, à peine ralentie à la fin) ; la
  // dérive en S ; le fondu pendant la fin de la montée (dès un peu plus de la moitié : jamais jusque sur le centre).
  n.animate(
    [
      { transform: 'translate(0, 0)', opacity: 1 },
      { transform: `translate(${(drift * 0.35).toFixed(1)}px, ${(-rise * 0.3).toFixed(1)}px)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${(drift * 0.7).toFixed(1)}px, ${(-rise * 0.55).toFixed(1)}px)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${drift.toFixed(1)}px, ${(-rise).toFixed(1)}px)`, opacity: 0 },
    ],
    { duration: ms, easing: 'cubic-bezier(0.3, 0.45, 0.55, 1)', fill: 'forwards' },
  ).onfinish = done;
  // L'apparition : elle grandit et rebondit une fois, en même temps qu'elle monte déjà.
  img?.animate(
    [
      { transform: 'scale(0.3)', opacity: 0 },
      { transform: 'scale(1.14)', opacity: 1, offset: 0.42 },
      { transform: 'scale(0.94)', offset: 0.7 },
      { transform: 'scale(1)' },
    ],
    { duration: 650, easing: 'cubic-bezier(0.22, 0.8, 0.32, 1)' },
  );
}

/**
 * Les réactions d'un écran de table. `felt` (le tapis), `seatsEl` (les places, carrousel au téléphone), `seatEl(seat)`
 * (le nœud d'une place, ou null), `mySeat()` (ma place, ou null), `send(id)` (→ le Core), `toast`, `prefs` (Frame.prefs :
 * { muted }), `signal`.
 */
export function createReactions({ root, felt, seatsEl, seatEl, mySeat = () => null, send, toast, prefs, signal }) {
  let caps = null; // ce que le Core annonce : { on, dealer, ids, seq, list }
  let lastN = 0;
  let primed = false; // le premier état reçu (ouverture, reconnexion) : ses réactions passées ne sont jamais rejouées
  const bucket = createBucket();
  const sent = []; // mes réactions déjà montrées en attendant leur écho du Core : { r, t, node }
  const muted = () => !!prefs.get().muted;
  const layer = document.createElement('div');
  layer.className = 'rxl';
  layer.setAttribute('aria-hidden', 'true');
  felt.append(layer);
  const onSeat = new Map(); // place → ses émotes en vol (un petit nuage, PER_SEAT au plus)
  // Une image qui ne charge pas : son émoji de repli (jamais une case vide).
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (img?.tagName !== 'IMG' || img.dataset.glyph === undefined) return;
    const s = document.createElement('span');
    s.className = `${img.className} glyph`;
    s.textContent = img.dataset.glyph || '★';
    img.replaceWith(s);
  }, { capture: true, signal });

  /** Une émote qui s'envole au-dessus d'une place ; une place hors du carrousel visible : un repère sur le bord. */
  function show(seat, id) {
    const r = BY_ID.get(id);
    const el = seatEl(seat);
    if (!r || !el) return null;
    if (seatsEl.classList.contains('carousel') && seatsEl.contains(el)) {
      const c = seatsEl.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const mid = b.left + b.width / 2; // une place à moitié coupée par le bord : le repère, jamais une émote rognée
      if (mid < c.left + 12 || mid > c.right - 12) return void edge(mid < c.left + 12 ? 'l' : 'r', seat, r);
    }
    const fr = felt.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const cloud = (onSeat.get(seat) ?? []).filter((x) => x.isConnected);
    while (cloud.length >= PER_SEAT) cloud.shift().remove();
    const n = document.createElement('span');
    n.className = 'rx';
    n.innerHTML = imgHTML(r, 'rx__img');
    // Ma grande place du téléphone (sous le carrousel) : l'émote part de sa partie droite, jamais de la place d'au-dessus.
    // Un léger écart à chaque émote : un nuage, jamais une pile au même endroit.
    const hero = !!el.closest('.myseat');
    const jitter = rand(-12, 12);
    n.style.left = `${(hero ? b.right - fr.left - 34 : b.left - fr.left + b.width / 2) + jitter}px`;
    n.style.top = `${hero ? b.top - fr.top + b.height / 2 + 21 : Math.max(4, b.top - fr.top - 2)}px`;
    layer.append(n);
    cloud.push(n);
    onSeat.set(seat, cloud);
    float(n, hero ? { rise: rand(30, 40) } : undefined);
    return n;
  }
  /** Le repère d'une réaction hors écran (carrousel) : un toucher fait défiler jusqu'à sa place — jamais automatiquement. */
  function edge(side, seat, r) {
    felt.querySelector(`.rx-edge.${side}`)?.remove();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `rx-edge ${side}`;
    b.setAttribute('aria-label', `Réaction ${r.label} d’un joueur hors de l’écran : voir sa place`);
    b.innerHTML = `${side === 'l' ? '‹' : ''}${imgHTML(r, 'rx-edge__img')}${side === 'r' ? '›' : ''}`;
    const s = seatsEl.getBoundingClientRect();
    const fr = felt.getBoundingClientRect();
    b.style.top = `${s.top - fr.top + s.height / 2}px`;
    felt.append(b);
    const t = setTimeout(() => b.remove(), FRESH_MS);
    b.addEventListener('click', () => {
      clearTimeout(t);
      b.remove();
      const el = seatEl(seat);
      if (!el) return;
      seatsEl.scrollTo({ left: el.offsetLeft - (seatsEl.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
      setTimeout(() => show(seat, r.id), 450);
    }, { signal });
  }

  // --- La bulle de choix (au-dessus du bouton de la barre) : elle reste ouverte après chaque envoi -------------------
  let pal = null;
  let dryT = null;
  let page = 1; // la page de la bulle : 1 (classiques) ou 2 (abonnés) ; gardée tant que l'écran vit
  const subOk = () => caps?.sub === 'yes' && PAGES[1].some((id) => !PAGES[0].includes(id) && caps.ids?.includes(id));
  function close() {
    clearTimeout(dryT);
    pal?.remove();
    pal = null;
  }
  const muteHTML = () => `<button type="button" class="rx-mini rx-mute" data-rx-mute aria-pressed="${muted()}" title="${muted() ? 'Afficher les réactions' : 'Masquer les réactions (pour toi seulement)'}" aria-label="${muted() ? 'Afficher les réactions' : 'Masquer les réactions pour toi'}">${ico(muted() ? 'mute' : 'sound')}</button>`;
  /**
   * Les émotes (celles que le Core accepte), en deux étages superposés à la même place : les classiques (1) et, pour un
   * abonné, les siennes (2). Le petit ascenseur haut/bas fait glisser la liste d'un étage à l'autre ; la bulle ne change ni
   * de taille ni de place.
   */
  const rowOf = (list, n) => `<div class="rx-pal__row" data-fl="${n}">${list.filter((id) => (caps?.ids ?? []).includes(id) && BY_ID.has(id))
    .map((id) => BY_ID.get(id))
    .map((r) => `<button type="button" class="rx-pick" data-rx="${esc(r.id)}" title="${esc(r.label)}" aria-label="Réagir : ${esc(r.label)}">${imgHTML(r, 'rx-pick__img')}</button>`)
    .join('')}</div>`;
  function rowHTML() {
    const ids = new Set(caps?.ids ?? []);
    if (page === 2 && !subOk()) page = 1;
    // Un Core d'avant le 22/11 (r1 … r7 seulement, le temps de son déploiement) : ses 7 réactions, jamais un étage à moitié vide.
    if (!ids.has('r8')) return `<div class="rx-floors">${rowOf(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'], 1)}</div>`;
    if (!subOk()) return `<div class="rx-floors">${rowOf(PAGES[0], 1)}</div>`;
    return `<div class="rx-floors">${rowOf(PAGES[0], 1)}${rowOf(PAGES[1], 2)}</div><div class="rx-lift" role="group" aria-label="Étages de réactions">`
      + `<button type="button" data-rx-page="1" title="Réactions classiques" aria-label="Réactions classiques">${ico('up')}</button>`
      + `<button type="button" data-rx-page="2" title="Réactions des abonnés" aria-label="Réactions des abonnés">${ico('down')}</button></div>`;
  }
  /** L'étage affiché : la liste glisse (CSS), l'étage caché n'est ni cliquable ni atteignable au clavier. */
  function floor() {
    if (!pal) return;
    pal.classList.toggle('subs', page === 2);
    pal.querySelector('.rx-floors')?.setAttribute('data-at', String(page));
    for (const r of pal.querySelectorAll('.rx-pal__row')) r.inert = Number(r.dataset.fl) !== page;
    for (const b of pal.querySelectorAll('[data-rx-page]')) {
      b.disabled = Number(b.dataset.rxPage) === page;
      b.setAttribute('aria-pressed', String(b.disabled));
    }
  }
  function render() {
    if (!pal) return;
    pal.querySelector('.rx-pal__main').innerHTML = rowHTML();
    floor();
    dry();
  }
  function place(btn) {
    const rb = root.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    pal.style.left = `${Math.max(6, Math.min(rb.width - pal.offsetWidth - 6, bb.left - rb.left + bb.width / 2 - pal.offsetWidth / 2))}px`;
    pal.style.bottom = `${rb.bottom - bb.top + 8}px`;
  }
  function open(btn) {
    if (pal) return close();
    pal = document.createElement('div');
    pal.className = 'rx-pal';
    pal.setAttribute('role', 'dialog');
    pal.setAttribute('aria-label', 'Réagir');
    pal.innerHTML = `<div class="rx-pal__main"></div><div class="rx-pal__side"><button type="button" class="rx-mini" data-rx-close title="Fermer" aria-label="Fermer">${ico('close')}</button>${muteHTML()}</div>`;
    root.append(pal);
    render();
    place(btn);
    pal.querySelector('[data-rx]')?.focus({ preventScroll: true });
    dry();
    pal.addEventListener('click', (e) => {
      if (e.target.closest('[data-rx-close]')) return close();
      const lift = e.target.closest('[data-rx-page]');
      if (lift) {
        // D'un étage à l'autre sans fermer la bulle ni la redessiner : la liste glisse verticalement.
        page = Number(lift.dataset.rxPage) === 2 && subOk() ? 2 : 1;
        floor();
        pal.querySelector(`[data-fl="${page}"] [data-rx]`)?.focus({ preventScroll: true });
        return;
      }
      const m = e.target.closest('[data-rx-mute]');
      if (m) {
        prefs.get().muted = !muted();
        prefs.save();
        if (muted()) for (const n of [...layer.children]) n.remove();
        m.outerHTML = muteHTML();
        return;
      }
      const p = e.target.closest('[data-rx]');
      if (p) void pick(p.dataset.rx);
    });
  }
  /** Le réservoir vide : les émotes s'estompent, discrètement, jusqu'à ce qu'une réaction soit de nouveau permise. */
  function dry() {
    if (!pal) return;
    clearTimeout(dryT);
    const ms = bucket.wait(Date.now());
    pal.classList.toggle('dry', ms > 0);
    if (ms > 0) dryT = setTimeout(dry, ms + 30);
  }
  async function pick(id) {
    if (!bucket.take(Date.now())) return dry();
    dry();
    // Elle part tout de suite au-dessus de ma place ; l'écho du Core (le même identifiant, de ma place) ne la rejoue pas.
    const me = mySeat();
    const mine = me === null || muted() ? null : { r: id, t: Date.now(), node: show(me, id) };
    if (mine) sent.push(mine);
    try {
      await send(id);
    } catch (e) {
      if (mine) {
        mine.node?.remove();
        sent.splice(sent.indexOf(mine), 1);
      }
      if (e?.code === 'react_rate') {
        bucket.empty(Date.now(), Number(e?.details?.retry_in_ms) || REFILL_MS);
        return dry();
      }
      toast(
        e?.code === 'reactions_off' ? 'Les réactions sont désactivées pour l’instant.'
        : e?.code === 'sub_only' ? 'Réaction réservée aux abonnés de la chaîne.'
        : e?.code === 'sub_unknown' ? 'Ton abonnement n’a pas pu être vérifié pour l’instant : réessaie un peu plus tard.'
        : 'Réaction non envoyée.',
        true,
      );
    }
  }
  // Un clic ailleurs ferme la bulle. Son chemin, pas sa cible : la flèche des pages est remplacée pendant son propre clic.
  root.addEventListener('click', (e) => pal && !e.composedPath().some((n) => n === pal || n?.matches?.('[data-rx-open]')) && close(), { signal });
  root.addEventListener('keydown', (e) => e.key === 'Escape' && pal && close(), { signal });

  return {
    /** Le Core gère-t-il les réactions des joueurs (le bouton de la barre) ? */
    enabled: () => !!caps?.on,
    toggle: open,
    /** Une nouvelle table (ou une reconnexion) : rien de l'ancienne n'est rejoué. */
    reset() {
      caps = null;
      lastN = 0;
      primed = false;
      sent.length = 0;
      close();
      for (const n of [...layer.children]) n.remove();
      onSeat.clear();
    },
    /** Ce que le Core a joint à l'état : les réactions récentes (jamais rejouées), et ses réglages. */
    receive(R) {
      const hadSub = subOk();
      caps = R ?? null;
      if (!caps?.on) close();
      else preload(new Set(caps.ids ?? []));
      if (pal && hadSub !== subOk()) render(); // l'abonnement vient d'être confirmé ou a pris fin : la flèche suit
      const list = Array.isArray(R?.list) ? R.list : [];
      const first = !primed;
      primed = !!R;
      const fresh = list.filter((x) => x.n > lastN);
      lastN = Math.max(lastN, Number(R?.seq) || 0, ...list.map((x) => x.n));
      if (first || muted() || !caps?.on) return;
      const me = mySeat();
      const now = Date.now();
      for (const x of fresh) {
        if (x.age_ms >= FRESH_MS) continue;
        // Mon écho : déjà en vol depuis mon clic.
        const i = x.seat === me ? sent.findIndex((s) => s.r === x.r && now - s.t < FRESH_MS) : -1;
        if (i >= 0) sent.splice(i, 1);
        else show(x.seat, x.r);
      }
    },
    /** La banque réagit (une manche réglée) : une émote seule qui s'envole à côté de ses cartes, si le Core et le viewer le veulent. */
    dealer(pickd) {
      if (!pickd || !caps?.dealer || muted()) return;
      const r = BY_ID.get(pickd.r);
      const deal = felt.querySelector('.dealer');
      if (!r || !deal) return;
      const fr = felt.getBoundingClientRect();
      const b = deal.getBoundingClientRect();
      const n = document.createElement('span');
      n.className = 'rx rx--dealer';
      n.innerHTML = imgHTML(r, 'rx__img');
      // À gauche de ses cartes (son score est à droite), au pied des cartes ; elle s'envole sur leur hauteur.
      n.style.left = `${Math.max(24, b.left - fr.left - 26)}px`;
      n.style.top = `${b.bottom - fr.top}px`;
      layer.append(n);
      float(n, { rise: rand(26, 34), drift: rand(-10, 4) });
    },
    destroy() {
      close();
      layer.remove();
    },
  };
}
