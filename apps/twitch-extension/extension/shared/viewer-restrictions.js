// Viewer feedback of Raptoru restrictions (never a Twitch sanction): the session's `restrictions` are
// Core's rows for this viewer (blocks: module or « all »; personal cooldowns with `wait_until`). This
// file only reads them: which one applies to a module, and the small pieces of UI that say it
// (Hub pill, module header indicator + detail, « J'ai compris » modal for a real block). Core still
// refuses every action; nothing here decides.

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
  node.setAttribute('stroke-width', '2.2');
  node.setAttribute('stroke-linecap', 'round');
  node.innerHTML = ICON[name];
  return node;
};
const ms = (iso) => (iso ? Date.parse(iso) : NaN);

/**
 * The restriction that applies to a Hub module now, or null. A block (the module's or « all ») wins over a
 * personal cooldown. A cooldown is a regime (one use per `delay_s`): `waiting` while its next use is not
 * allowed yet (`wait_until`), only then does it hold the action.
 */
export function restrictionFor(restrictions, hubModuleId, now = Date.now()) {
  const module = HUB_TO_CORE[hubModuleId];
  if (!module || !Array.isArray(restrictions)) return null;
  const live = (r) => !r.until || ms(r.until) > now;
  const blocks = restrictions.filter((r) => r.kind === 'block' && live(r) && (r.module === module || r.module === 'all'));
  // Until unblocked first, then the longest one.
  blocks.sort((a, b) => (a.until ? ms(a.until) : Infinity) - (b.until ? ms(b.until) : Infinity)).reverse();
  if (blocks[0]) return { ...blocks[0], module, global: blocks[0].module === 'all', end: blocks[0].until };
  const cd = restrictions.find((r) => r.kind === 'cooldown' && r.module === module && ms(r.until) > now);
  if (!cd) return null;
  const waiting = Boolean(cd.wait_until) && ms(cd.wait_until) > now;
  return { ...cd, module, global: false, waiting, end: waiting ? cd.wait_until : null };
}


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
const every = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 360) / 10} h`);
const who = (r) => [author(r.actor), r.reason].filter(Boolean).join(' · ');

/** Time node kept up to date by `tickRestrictions` (pill = short, detail = clock). */
function leftNode(document, r, format, suffix = '') {
  const node = document.createElement('b');
  if (!r.end) {
    node.textContent = format === 'short' ? '' : r.kind === 'cooldown' ? `1 envoi / ${every(r.delay_s)}` : 'Jusqu’au déblocage';
    return node;
  }
  node.dataset.rlEnd = String(ms(r.end));
  node.dataset.rlFormat = format;
  node.dataset.rlSuffix = suffix;
  node.textContent = (format === 'short' ? shortLeft : clockLeft)(ms(r.end) - Date.now()) + suffix;
  return node;
}

/** Hub card pill (secondary, fixed size, never a sentence). */
export function restrictionPill(document, r) {
  const pill = document.createElement('span');
  pill.className = `rl-rpill rl-rpill--${r.kind}`;
  pill.setAttribute('aria-label', `${title(r)}${r.end ? ` · ${clockLeft(ms(r.end) - Date.now())}` : ' · jusqu’au déblocage'}`);
  pill.title = pill.getAttribute('aria-label');
  pill.append(svg(document, r.kind === 'cooldown' ? 'clock' : 'ban'));
  if (r.end) pill.append(leftNode(document, r, 'short'));
  return pill;
}

/** Module header indicator; its detail opens on hover / focus / click. */
export function restrictionIndicator(document, r) {
  const wrap = document.createElement('span');
  wrap.className = `rl-rind rl-rind--${r.kind}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rl-rind__btn';
  button.setAttribute('aria-label', title(r));
  button.setAttribute('aria-expanded', 'false');
  button.append(svg(document, r.kind === 'cooldown' ? 'clock' : 'ban'));
  if (r.end) button.append(leftNode(document, r, 'clock'));
  const detail = document.createElement('span');
  detail.className = 'rl-rind__detail';
  detail.setAttribute('role', 'tooltip');
  const line = (cls, content) => {
    const node = document.createElement('span');
    node.className = cls;
    node.append(content);
    return node;
  };
  detail.append(
    line('rl-rind__title', title(r)),
    line('rl-rind__left', r.end ? leftNode(document, r, 'clock', ' restantes') : leftNode(document, r, 'clock')),
  );
  if (who(r)) detail.append(line('rl-rind__who', who(r)));
  button.addEventListener('click', () => {
    const open = !wrap.classList.contains('is-open');
    wrap.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
  });
  wrap.addEventListener('focusout', (event) => {
    if (wrap.contains(event.relatedTarget)) return;
    wrap.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  });
  wrap.append(button, detail);
  return wrap;
}

// « J'ai compris »: a block is shown once per state (a new block or a changed one is a new state).
const ACK_KEY = 'raptoru-live:restriction-acks';
const ackId = (viewerId, r) => [viewerId ?? '', r.module === 'all' || r.global ? 'all' : r.module, r.created_at, r.until ?? 'forever'].join('|');
function readAcks(storage) {
  try {
    const list = JSON.parse(storage?.getItem(ACK_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export const isAcknowledged = (storage, viewerId, r) => readAcks(storage).includes(ackId(viewerId, r));
export function acknowledge(storage, viewerId, r) {
  try {
    const list = readAcks(storage).filter((id) => id !== ackId(viewerId, r));
    storage?.setItem(ACK_KEY, JSON.stringify([...list, ackId(viewerId, r)].slice(-20)));
  } catch {
    /* storage blocked: shown again next time, nothing else */
  }
}

/** Small informative modal for a real block (module or global). */
export function restrictionModal(document, r, onAck) {
  const backdrop = document.createElement('div');
  backdrop.className = 'rl-rmodal';
  const card = document.createElement('div');
  card.className = 'rl-rmodal__card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  const head = document.createElement('strong');
  head.className = 'rl-rmodal__title';
  head.id = `rl-rmodal-${Math.random().toString(36).slice(2, 8)}`;
  head.append(svg(document, 'ban'), r.global ? 'Interactions Raptoru suspendues' : `${LABEL[r.module]} temporairement restreint`);
  card.setAttribute('aria-labelledby', head.id);
  const left = document.createElement('span');
  left.className = 'rl-rmodal__left';
  left.append(r.end ? leftNode(document, r, 'clock', ' restantes') : 'Jusqu’au déblocage');
  card.append(head, left);
  if (who(r)) {
    const line = document.createElement('span');
    line.className = 'rl-rmodal__who';
    line.textContent = who(r);
    card.append(line);
  }
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'rl-rmodal__ok';
  ok.textContent = 'J’ai compris';
  ok.addEventListener('click', () => {
    backdrop.remove();
    onAck?.();
  });
  card.append(ok);
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
