// Casino V1 — les réactions à la table de Blackjack (docs/CASINO.md § 18, mandat d'Antoni du 21/11, C). Un viewer assis
// choisit une émote dans une petite bulle ; elle apparaît brièvement au-dessus de sa place, chez tous les joueurs et les
// spectateurs. Aucun texte libre, aucun Jeton : seulement les identifiants que le Core accepte (r1 … r6), transmis par le
// Core avec l'état de la table (long-poll), à sa cadence (anti-spam côté Core). Les visuels sont dans
// assets/casino/reactions/reactions.js : les remplacer ne touche jamais ce fichier.
//
// Activé seulement si le Core l'annonce (`reactions` dans la réponse de l'état de la table) : un Core qui ne connaît pas
// les réactions n'affiche ni bouton ni bulle. La banque réagit parfois (pickDealerReaction) : un choix déterministe à
// partir de la manche, le même chez tous les viewers — jamais une IA, jamais à chaque manche.
import { REACTIONS, DEALER, assetUrl } from '../../assets/casino/reactions/reactions.js';

const BY_ID = new Map(REACTIONS.map((r) => [r.id, r]));
const SHOW_MS = 2600;
const FRESH_MS = 3500; // plus vieille : jamais rejouée (reconnexion, onglet revenu au premier plan)
const COOL_MS = 1500;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Un nombre de 0 à 1, le même partout pour la même clé (FNV-1a 32 bits). */
export function unit(key) {
  let h = 0x811c9dc5;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h / 0x100000000;
}
// La banque ne réagit qu'aux manches qui le méritent, et pas à toutes : au plus une fois par manche, ≈ 1 manche sur 4.
const CHANCE = { dealer_bj: 0.6, blackjack: 0.6, big_win: 0.5, dealer_bust: 0.35, bust: 0.2 };
/**
 * La réaction de la banque à une manche réglée, ou null. Déterministe (table, manche) : chaque viewer voit la même.
 * `s` : l'état de la table (phase settled) ; `mainMin` : la mise minimum (un « gros gain » = au moins 10 fois).
 */
export function pickDealerReaction(s, mainMin = 100) {
  if (s?.phase !== 'settled') return null;
  const players = s.seats.filter((p) => p?.result);
  if (!players.length) return null;
  const hands = players.flatMap((p) => p.hands ?? []);
  const kind =
    s.outcome === 'BJ' ? 'dealer_bj'
    : hands.some((h) => h.verdict === 'blackjack') ? 'blackjack'
    : players.some((p) => p.result.net >= 10 * mainMin) ? 'big_win'
    : s.outcome === 'BUST' ? 'dealer_bust'
    : hands.some((h) => h.verdict === 'bust') ? 'bust'
    : null;
  if (!kind || unit(`${s.table}:${s.round}:${kind}`) >= CHANCE[kind]) return null;
  const lines = DEALER[kind]?.lines ?? [];
  return { kind, line: lines[Math.floor(unit(`${s.table}:${s.round}:line`) * lines.length)] ?? '' };
}

const imgHTML = (r, cls) => `<img class="${cls}" src="${esc(assetUrl(r.src))}" alt="${esc(r.label ?? '')}" draggable="false" data-glyph="${esc(r.glyph ?? '')}">`;

/**
 * Les réactions d'un écran de table. `felt` (le tapis), `seatsEl` (les places, carrousel au téléphone), `seatEl(seat)`
 * (le nœud d'une place, ou null), `send(id)` (→ le Core), `toast`, `prefs` (Frame.prefs : { muted }), `signal`.
 */
export function createReactions({ root, felt, seatsEl, seatEl, send, toast, prefs, signal }) {
  let caps = null; // ce que le Core annonce : { on, dealer, ids, seq, list }
  let lastN = 0;
  let primed = false; // le premier état reçu (ouverture, reconnexion) : ses réactions passées ne sont jamais rejouées
  let cool = 0;
  const muted = () => !!prefs.get().muted;
  const layer = document.createElement('div');
  layer.className = 'rxl';
  layer.setAttribute('aria-hidden', 'true');
  felt.append(layer);
  const onSeat = new Map(); // place → la bulle en cours (une seule par place)
  // Une image qui ne charge pas : son émoji de repli (jamais une case vide).
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (img?.tagName !== 'IMG' || img.dataset.glyph === undefined) return;
    const s = document.createElement('span');
    s.className = `${img.className} glyph`;
    s.textContent = img.dataset.glyph || '★';
    img.replaceWith(s);
  }, { capture: true, signal });

  /** Une bulle au-dessus d'une place ; une place hors du carrousel visible : un repère sur le bord, touchable. */
  function show(seat, id) {
    const r = BY_ID.get(id);
    const el = seatEl(seat);
    if (!r || !el) return;
    if (seatsEl.classList.contains('carousel') && seatsEl.contains(el)) {
      const c = seatsEl.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const mid = b.left + b.width / 2; // une place à moitié coupée par le bord : le repère, jamais une émote rognée
      if (mid < c.left + 12 || mid > c.right - 12) return edge(mid < c.left + 12 ? 'l' : 'r', seat, r);
    }
    const fr = felt.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    onSeat.get(seat)?.remove();
    const n = document.createElement('span');
    n.className = 'rx';
    n.innerHTML = imgHTML(r, 'rx__img');
    n.style.left = `${b.left - fr.left + b.width / 2}px`;
    n.style.top = `${Math.max(4, b.top - fr.top - 4)}px`;
    layer.append(n);
    onSeat.set(seat, n);
    setTimeout(() => (n.remove(), onSeat.get(seat) === n && onSeat.delete(seat)), SHOW_MS);
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

  // --- La bulle de choix (au-dessus du bouton de la barre) -------------------------------------------------------------
  let pal = null;
  function close() {
    pal?.remove();
    pal = null;
  }
  function open(btn) {
    if (pal) return close();
    pal = document.createElement('div');
    pal.className = 'rx-pal';
    pal.setAttribute('role', 'dialog');
    pal.setAttribute('aria-label', 'Réagir');
    const ids = new Set(caps?.ids ?? []);
    pal.innerHTML = `<div class="rx-pal__row">${REACTIONS.filter((r) => ids.has(r.id))
      .map((r) => `<button type="button" class="rx-pick" data-rx="${esc(r.id)}" title="${esc(r.label)}" aria-label="Réagir : ${esc(r.label)}">${imgHTML(r, 'rx-pick__img')}</button>`)
      .join('')}</div><button type="button" class="rx-mute" data-rx-mute aria-pressed="${muted()}">${muted() ? 'Réactions masquées · les afficher' : 'Masquer les réactions'}</button>`;
    root.append(pal);
    const rb = root.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    pal.style.left = `${Math.max(6, Math.min(rb.width - pal.offsetWidth - 6, bb.left - rb.left + bb.width / 2 - pal.offsetWidth / 2))}px`;
    pal.style.bottom = `${rb.bottom - bb.top + 8}px`;
    pal.querySelector('[data-rx]')?.focus({ preventScroll: true });
    pal.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-rx-mute]');
      if (m) {
        prefs.get().muted = !muted();
        prefs.save();
        if (muted()) for (const n of layer.children) n.remove();
        return close();
      }
      const p = e.target.closest('[data-rx]');
      if (!p) return;
      close();
      await pick(p.dataset.rx);
    });
  }
  async function pick(id) {
    if (Date.now() < cool) return;
    cool = Date.now() + COOL_MS;
    try {
      await send(id);
    } catch (e) {
      toast(e?.code === 'react_rate' ? 'Doucement : une réaction toutes les deux secondes.' : e?.code === 'reactions_off' ? 'Les réactions sont désactivées pour l’instant.' : 'Réaction non envoyée.', true);
    }
  }
  root.addEventListener('click', (e) => pal && !e.target.closest('.rx-pal, [data-rx-open]') && close(), { signal });
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
      close();
      for (const n of [...layer.children]) n.remove();
      onSeat.clear();
    },
    /** Ce que le Core a joint à l'état : les réactions récentes (jamais rejouées), et ses réglages. */
    receive(R) {
      caps = R ?? null;
      if (!caps?.on) close();
      const list = Array.isArray(R?.list) ? R.list : [];
      const first = !primed;
      primed = !!R;
      const fresh = list.filter((x) => x.n > lastN);
      lastN = Math.max(lastN, Number(R?.seq) || 0, ...list.map((x) => x.n));
      if (first || muted() || !caps?.on) return;
      for (const x of fresh) if (x.age_ms < FRESH_MS) show(x.seat, x.r);
    },
    /** La banque réagit (une manche réglée) : une bulle à côté de ses cartes, si le Core et le viewer le veulent. */
    dealer(pickd) {
      if (!pickd || !caps?.dealer || muted()) return;
      const d = DEALER[pickd.kind];
      const deal = felt.querySelector('.dealer');
      if (!d || !deal) return;
      felt.querySelector('.rx-dealer')?.remove();
      const n = document.createElement('div');
      n.className = 'rx-dealer';
      n.innerHTML = `${imgHTML({ ...d, label: '' }, 'rx-dealer__img')}<span>${esc(pickd.line)}</span>`;
      felt.append(n);
      const fr = felt.getBoundingClientRect();
      const b = deal.getBoundingClientRect();
      const room = b.left - fr.left - 10;
      // À gauche des cartes (le score est à droite) ; sans la place, dessous.
      const below = room < n.offsetWidth;
      n.classList.toggle('below', below);
      n.style.left = `${below ? Math.max(6, b.left - fr.left + b.width / 2 - n.offsetWidth / 2) : room - n.offsetWidth}px`;
      n.style.top = `${below ? b.bottom - fr.top + 4 : b.top - fr.top + b.height / 2 - n.offsetHeight / 2}px`;
      setTimeout(() => n.remove(), 3200);
    },
    destroy() {
      close();
      layer.remove();
    },
  };
}
