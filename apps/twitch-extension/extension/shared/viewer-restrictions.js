// Viewer feedback of Raptoru restrictions (never a Twitch sanction): the session's `restrictions` are
// Core's rows for this viewer (blocks: module or « all »; personal cooldowns with `wait_until`). This
// file only reads them: which ones apply to a module, and the small pieces of UI that say it (Hub pill,
// module header chips + detail, popup listing every active one). Core still refuses every action;
// nothing here decides.

const HUB_TO_CORE = { tts: 'tts', soundboard: 'soundboard', bonk: 'bonk', raffle_join: 'raffle' };
const LABEL = { tts: 'TTS', soundboard: 'Soundboard', bonk: 'Bonk', raffle: 'Tombola' };
const ICON = {
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const svg = (document, name) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2.4');
  node.setAttribute('stroke-linecap', 'round');
  node.innerHTML = ICON[name];
  return node;
};
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const make = (document, tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * Every restriction that applies to a Hub module now, blocks first (the module's and « all », until
 * unblocked first, then the longest), then its personal cooldown. A cooldown is a regime (one use per
 * `delay_s`): `waiting` while its next use is not allowed yet (`wait_until`), only then does it hold.
 */
export function restrictionsFor(restrictions, hubModuleId, now = Date.now()) {
  const module = HUB_TO_CORE[hubModuleId];
  if (!module || !Array.isArray(restrictions)) return [];
  const live = (r) => !r.until || ms(r.until) > now;
  const blocks = restrictions
    .filter((r) => r.kind === 'block' && live(r) && (r.module === module || r.module === 'all'))
    .sort((a, b) => (b.until ? ms(b.until) : Infinity) - (a.until ? ms(a.until) : Infinity))
    .map((r) => ({ ...r, module, global: r.module === 'all', waiting: false, end: r.until }));
  const cooldowns = restrictions
    .filter((r) => r.kind === 'cooldown' && r.module === module && ms(r.until) > now)
    .map((r) => {
      const waiting = Boolean(r.wait_until) && ms(r.wait_until) > now;
      return { ...r, module, global: false, waiting, end: waiting ? r.wait_until : null };
    });
  return [...blocks, ...cooldowns];
}
/** The one that says the most (Hub pill, action hold): the first block, else the cooldown. */
export const restrictionFor = (restrictions, hubModuleId, now = Date.now()) => restrictionsFor(restrictions, hubModuleId, now)[0] ?? null;

/** Holds the action now: a block, or a cooldown being waited. */
export const holdsAction = (r) => Boolean(r) && (r.kind === 'block' || r.waiting);

/** Hub pill: « 4m », « 45s », « 1h05 ». */
export function shortLeft(left) {
  const s = Math.max(0, Math.ceil(left / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}
/** Header / detail: « 4:32 », « 1:05:00 ». */
export function clockLeft(left) {
  const s = Math.max(0, Math.ceil(left / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
const author = (actor) => (/^studio(:|$)/.test(String(actor)) ? 'Studio' : String(actor) === 'system' ? 'Automatique' : String(actor ?? ''));
const title = (r) => (r.kind === 'cooldown' ? `Cooldown ${LABEL[r.module]}` : r.global ? 'Interactions Raptoru suspendues' : `${LABEL[r.module]} restreint`);
/** Header chip: « Bloqué », « Global », « Cooldown ». */
const chipLabel = (r) => (r.kind === 'cooldown' ? 'Cooldown' : r.global ? 'Global' : 'Bloqué');
const every = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 360) / 10} h`);

/** Time node kept up to date by `tickRestrictions` (pill = short, others = clock). */
function leftNode(document, r, format, suffix = '') {
  const node = make(document, 'b', 'rl-time');
  node.dataset.rlEnd = String(ms(r.end));
  node.dataset.rlFormat = format;
  node.dataset.rlSuffix = suffix;
  node.textContent = (format === 'short' ? shortLeft : clockLeft)(ms(r.end) - Date.now()) + suffix;
  return node;
}
/** « 4:32 restantes », « Jusqu'au déblocage », « 1 envoi / 5 min · prochain dans 0:45 ». */
function leftLine(document, r) {
  const line = make(document, 'span', 'rl-left');
  if (r.kind === 'cooldown') {
    line.append(`1 envoi / ${every(r.delay_s)}`);
    if (r.waiting) line.append(' · prochain dans ', leftNode(document, r, 'clock'));
  } else if (r.end) line.append(leftNode(document, r, 'clock', ' restantes'));
  else line.append(make(document, 'b', 'rl-time', 'Jusqu’au déblocage'));
  return line;
}
function byLine(document, r) {
  const line = make(document, 'span', 'rl-by', 'Sanctionné par : ');
  line.append(make(document, 'b', '', author(r.actor)));
  return line;
}

/** Hub card pill (secondary, fixed size, never a sentence). */
export function restrictionPill(document, r) {
  const pill = make(document, 'span', `rl-rpill rl-rpill--${r.kind}`);
  pill.setAttribute('aria-label', `${title(r)}${r.end ? ` · ${clockLeft(ms(r.end) - Date.now())}` : ' · jusqu’au déblocage'}`);
  pill.title = pill.getAttribute('aria-label');
  pill.append(svg(document, r.kind === 'cooldown' ? 'clock' : 'ban'));
  if (r.end) pill.append(leftNode(document, r, 'short'));
  return pill;
}

/** Module header: one chip per active restriction (left of the header); detail on hover / focus / click. */
export function restrictionChips(document, list) {
  // Several: the first keeps its words and time, the others are icons (all words in their detail).
  const wrap = make(document, 'span', `rl-rchips${list.length > 1 ? ' rl-rchips--multi' : ''}`);
  for (const r of list) {
    const item = make(document, 'span', `rl-rind rl-rind--${r.kind}${r.global ? ' rl-rind--global' : ''}`);
    const button = make(document, 'button', 'rl-rind__btn');
    button.type = 'button';
    button.setAttribute('aria-label', title(r));
    button.setAttribute('aria-expanded', 'false');
    button.append(svg(document, r.kind === 'cooldown' ? 'clock' : 'ban'), make(document, 'span', 'rl-rind__label', chipLabel(r)));
    if (r.end) button.append(leftNode(document, r, 'clock'));
    const detail = make(document, 'span', 'rl-rind__detail');
    detail.setAttribute('role', 'tooltip');
    detail.append(make(document, 'span', 'rl-rind__title', title(r)), leftLine(document, r), byLine(document, r));
    if (r.reason) detail.append(make(document, 'span', 'rl-rind__why', r.reason));
    button.addEventListener('click', () => {
      const open = !item.classList.contains('is-open');
      for (const other of wrap.querySelectorAll('.rl-rind.is-open')) other.classList.remove('is-open');
      item.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
    });
    item.addEventListener('focusout', (event) => {
      if (item.contains(event.relatedTarget)) return;
      item.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
    });
    item.append(button, detail);
    wrap.append(item);
  }
  return wrap;
}

// Popup: comes back at every opening of the module while a restriction is active, unless the viewer
// ticked « Ne plus afficher ce message » for that precise restriction (a new or changed one shows again).
const HIDE_KEY = 'raptoru-live:restriction-hidden';
export const restrictionId = (viewerId, r) => [viewerId ?? '', r.kind, r.global ? 'all' : r.module, r.created_at, r.until ?? 'forever'].join('|');
function readHidden(storage) {
  try {
    const list = JSON.parse(storage?.getItem(HIDE_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export const isHidden = (storage, viewerId, r) => readHidden(storage).includes(restrictionId(viewerId, r));
export function hideRestrictions(storage, viewerId, list) {
  try {
    const ids = list.map((r) => restrictionId(viewerId, r));
    const kept = readHidden(storage).filter((id) => !ids.includes(id));
    storage?.setItem(HIDE_KEY, JSON.stringify([...kept, ...ids].slice(-30)));
  } catch {
    /* storage blocked: shown again next time, nothing else */
  }
}

/** Popup listing every active restriction of the module; `onClose(dontShowAgain)`. */
export function restrictionModal(document, list, onClose) {
  const backdrop = make(document, 'div', 'rl-rmodal');
  const card = make(document, 'div', 'rl-rmodal__card');
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  const heading = make(document, 'strong', 'rl-rmodal__heading', list.length > 1 ? `${list.length} restrictions actives` : 'Restriction active');
  heading.id = `rl-rmodal-${Math.random().toString(36).slice(2, 8)}`;
  card.setAttribute('aria-labelledby', heading.id);
  card.append(heading);
  for (const r of list) {
    const entry = make(document, 'div', `rl-rmodal__entry rl-rmodal__entry--${r.kind}`);
    const icon = make(document, 'span', 'rl-rmodal__icon');
    icon.append(svg(document, r.kind === 'cooldown' ? 'clock' : 'ban'));
    const text = make(document, 'span', 'rl-rmodal__text');
    text.append(make(document, 'span', 'rl-rmodal__title', title(r)), leftLine(document, r), byLine(document, r));
    if (r.reason) text.append(make(document, 'span', 'rl-rmodal__why', `Raison : ${r.reason}`));
    entry.append(icon, text);
    card.append(entry);
  }
  const hide = make(document, 'label', 'rl-rmodal__hide');
  const box = make(document, 'input');
  box.type = 'checkbox';
  hide.append(box, ' Ne plus afficher ce message');
  const ok = make(document, 'button', 'rl-rmodal__ok', 'J’ai compris');
  ok.type = 'button';
  ok.addEventListener('click', () => {
    backdrop.remove();
    onClose?.(box.checked);
  });
  card.append(hide, ok);
  backdrop.append(card);
  queueMicrotask(() => ok.focus({ preventScroll: true }));
  return backdrop;
}

/** Updates every time left under `root`; returns true when one has just ended (re-render then). */
export function tickRestrictions(root, now = Date.now()) {
  let ended = false;
  for (const node of root.querySelectorAll('[data-rl-end]')) {
    const left = Number(node.dataset.rlEnd) - now;
    if (left <= 0) ended = true;
    node.textContent = (node.dataset.rlFormat === 'short' ? shortLeft : clockLeft)(left) + (node.dataset.rlSuffix ?? '');
  }
  return ended;
}
