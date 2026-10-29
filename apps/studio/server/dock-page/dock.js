import {
  DEFAULT_PREFS,
  entries,
  esc,
  FILTERS,
  icon,
  learnRewards,
  parseSse,
  prefsHtml,
  rangeKeys,
  readPrefs,
  readTrash,
  recipientsByGift,
  replayable,
  rowHtml,
  shownBy,
  trashAdd,
  trashedKeys,
  trashEmpty,
  trashListHtml,
  trashRestore,
} from './dock-view.js';

// Dock OBS V1.2 (docs/OBS_DOCK.md) — the dock page, in an OBS custom browser dock. Reads Studio's dock server only
// (same origin, key from the URL fragment, never sent elsewhere). Rows are recomputed from the raw activities
// (entries(): filters and trash first, then the Bonk grouping) and reconciled by key: an unchanged row keeps its
// element, so the browser's scroll anchoring keeps what you read in place while rows arrive above.
// Kept in this dock's localStorage, apart from each other and from the canonical history: the preferences
// (`dock.prefs`) and the display trash (`dock.trash`). Hiding a row never deletes or changes an event.
// The replay is one click: the request carries one key per intention (a retried request never queues a second
// replay), the button is locked while it is in flight, and the Core keeps one replay waiting per original.

const KEY = new URLSearchParams(location.hash.slice(1)).get('key') ?? '';
const $ = (s) => document.querySelector(s);
const list = $('#list');
const scroller = list.parentElement;
const banner = $('#banner');
const pill = $('#pill');
const dot = $('#dot');
const gear = $('#gear');
const bin = $('#bin');
const pickBtn = $('#pick');
const prefsPanel = $('#prefs');
const trashPanel = $('#trash');
const selbar = $('#selbar');

const store = (k, v) => {
  try {
    if (v === undefined)
      return JSON.parse(localStorage.getItem(`dock.${k}`) ?? 'null');
    localStorage.setItem(`dock.${k}`, JSON.stringify(v));
  } catch {
    return null;
  }
  return v;
};

const FRESH_MS = 60_000;
const SENT_MS = 2_500;
const acts = new Map();
const ui = new Map(); // row key → { open, busy, sent, replayKey }
const fresh = new Map(); // activity key → until (ms)
const htmlOf = new WeakMap(); // row element → the HTML it was built from
// V1.1 kept only the hidden categories under `dock.hidden` (V1) or `dock.prefs` (V1.1): read once, carried over.
let prefs = readPrefs(store('prefs') ?? { hidden: store('hidden') ?? [] });
let trash = readTrash(store('trash'));
let hiddenKeys = trashedKeys(trash);
let rows = [];
let rowByKey = new Map();
const selected = new Set(); // row keys
let anchor = null;
let picking = false; // selection mode (header button): a plain click selects
let more = false;
let unseen = 0;
let loadingOlder = false;

const uiOf = (k) => {
  if (!ui.has(k)) ui.set(k, {});
  return ui.get(k);
};
const skip = (a) => hiddenKeys.has(a.activity_key) || !shownBy(prefs, a);

const make = (html) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
};

/** A viewer text cut on its line makes the row openable (to read it whole); a whole one does not. */
function measure(el) {
  const l3 = el.querySelector('.l3');
  if (!l3 || !el.classList.contains('has-text')) return;
  const cut =
    l3.classList.contains('whole') || l3.scrollWidth > l3.clientWidth + 1;
  el.classList.toggle('expandable', cut);
  if (cut)
    el.setAttribute('aria-expanded', String(l3.classList.contains('whole')));
  else el.removeAttribute('aria-expanded');
}

// Live feedback 29/10: reading below the top, the view never moves by itself. The browser's scroll anchoring loses its
// anchor when that row is rebuilt (relative times every 30 s, highlight, new events at once): the first visible row is
// kept in place by hand instead. At the top (the live flow) new events show up.
const TOP_PX = 24;

/** The first row visible in the view and its offset, while reading below the top; null at the top. */
function readingPosition() {
  if (scroller.scrollTop <= TOP_PX) return null;
  const top = scroller.getBoundingClientRect().top;
  for (const li of list.children) {
    const r = li.getBoundingClientRect();
    if (r.bottom > top) return { key: li.dataset.key, offset: r.top - top };
  }
  return null;
}

function keepPosition(p) {
  const li =
    p && list.querySelector(`li[data-key="${CSS.escape(p.key ?? '')}"]`);
  if (!li) return;
  const shift =
    li.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    p.offset;
  if (shift) scroller.scrollTop += shift;
}

/** Renders the rows, reusing every element whose HTML did not change (position, focus and scroll stay put). */
function render() {
  const now = Date.now();
  const reading = readingPosition();
  rows = entries(acts.values(), skip);
  rowByKey = new Map(rows.map((r) => [r.key, r]));
  for (const k of selected) if (!rowByKey.has(k)) selected.delete(k);
  const gifts = recipientsByGift(acts.values());
  const focused =
    document.activeElement?.closest?.('li[data-key]')?.dataset.key;
  const prev = new Map([...list.children].map((li) => [li.dataset.key, li]));
  let cursor = list.firstElementChild;
  for (const row of rows) {
    const a = row.items[0];
    const html = rowHtml(row, {
      ...uiOf(row.key),
      now,
      prefs,
      selected: selected.has(row.key),
      fresh: row.items.some((x) => (fresh.get(x.activity_key) ?? 0) > now),
      recipients:
        a.type === 'gift_community' && a.data?.community_gift_id
          ? gifts.get(a.data.community_gift_id)
          : undefined,
    });
    let el = prev.get(row.key);
    prev.delete(row.key);
    if (el && htmlOf.get(el) !== html) {
      const next = make(html);
      el.replaceWith(next);
      if (cursor === el) cursor = next;
      el = next;
      htmlOf.set(el, html);
      measure(el);
    } else if (!el) {
      el = make(html);
      htmlOf.set(el, html);
    }
    if (el === cursor) cursor = el.nextElementSibling;
    else {
      list.insertBefore(el, cursor);
      measure(el);
    }
  }
  for (const el of prev.values()) el.remove();
  keepPosition(reading);
  // Never scrolls: focus() alone would bring the focused row back into view at every refresh.
  if (focused && !list.contains(document.activeElement))
    list
      .querySelector(`li[data-key="${CSS.escape(focused)}"]`)
      ?.focus({ preventScroll: true });
  const empty = $('#empty');
  empty.hidden = rows.length > 0;
  empty.innerHTML = acts.size
    ? `${icon('select', 'i big')}<b>Rien à afficher</b><span>Tes préférences ou la corbeille masquent les événements reçus.</span>`
    : `${icon('sparkle', 'i big')}<b>Aucun événement pour l’instant</b><span>Les follows, subs, dons et interactions arriveront ici.</span>`;
  $('#older').hidden = !more;
  renderChrome();
}

/** Header state: selection bar, trash counter, selection mode. */
function renderChrome() {
  const n = selected.size;
  selbar.hidden = n === 0 && !picking;
  $('#selcount').textContent =
    n === 0
      ? 'Clique des lignes pour les sélectionner'
      : `${n} ligne${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`;
  $('#hide').disabled = n === 0;
  document.body.classList.toggle('picking', picking || n > 0);
  pickBtn.setAttribute('aria-pressed', String(picking));
  const t = trash.items.length;
  $('#bincount').textContent = t > 999 ? '999+' : String(t);
  $('#bincount').hidden = t === 0;
  bin.title = t
    ? `Corbeille d’affichage (${t})`
    : 'Corbeille d’affichage (vide)';
  const hidden = prefs.hidden.length + prefs.rewards.hidden.length;
  gear.classList.toggle('filtered', hidden > 0);
  gear.title = hidden ? 'Préférences (filtres actifs)' : 'Préférences';
}

/** The display size: a class on the body, CSS variables do the rest. */
function applyDensity() {
  for (const c of [...document.body.classList])
    if (c.startsWith('d-')) document.body.classList.remove(c);
  document.body.classList.add(`d-${prefs.density}`);
}

function setPrefs(next) {
  prefs = readPrefs(next);
  store('prefs', prefs);
  applyDensity();
  if (!prefsPanel.hidden) renderPrefs();
  render();
}

function apply(activities, isNew) {
  let added = 0;
  const now = Date.now();
  for (const a of activities) {
    const cur = acts.get(a.activity_key);
    if (cur && cur.seq >= a.seq) continue;
    acts.set(a.activity_key, a);
    if (!cur && isNew) {
      fresh.set(a.activity_key, now + FRESH_MS);
      if (!skip(a)) added += 1;
    }
  }
  learn(activities);
  if (added && scroller.scrollTop > TOP_PX) {
    unseen += added;
    pill.innerHTML = `${icon('arrowUp')}${unseen} nouveau${unseen > 1 ? 'x' : ''}`;
    pill.hidden = false;
  }
  render();
}

/** Remembers the rewards seen (for the panel), without touching the choices. */
function learn(activities) {
  const next = learnRewards(prefs, activities);
  if (next === prefs) return;
  prefs = next;
  store('prefs', prefs);
  if (!prefsPanel.hidden) renderPrefs();
}

const STATUS = {
  live: ['ok', 'Connecté'],
  connecting: ['wait', 'Connexion au Core…'],
  stale: ['bad', 'Core injoignable — données en cache'],
  idle: ['wait', 'En pause'],
  studio: ['bad', 'Studio injoignable — reconnexion…'],
  key: [
    'bad',
    'Clé du dock absente ou changée : recopie l’URL depuis Studio (Alertes → Dock OBS).',
  ],
};
function setStatus(s, detail) {
  const [tone, label] = STATUS[s] ?? STATUS.connecting;
  dot.className = `dot t-${tone}`;
  dot.title = label;
  dot.setAttribute('aria-label', label);
  banner.hidden = tone === 'ok';
  banner.textContent = detail ? `${label} (${detail})` : label;
}

// --- the stream (fetch: EventSource cannot send the key header) ------------------------------------------------------

let backoff = 1000;
async function connect() {
  if (!KEY) return setStatus('key');
  try {
    const res = await fetch('/api/stream', {
      headers: { 'x-dock-key': KEY },
      cache: 'no-store',
    });
    if (res.status === 401) return setStatus('key');
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    backoff = 1000;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseSse(buf);
      buf = rest;
      for (const e of events) handle(e);
    }
    throw new Error('stream closed');
  } catch {
    setStatus('studio');
    setTimeout(connect, backoff + Math.random() * 500);
    backoff = Math.min(backoff * 2, 10_000);
  }
}

function handle(e) {
  let msg;
  try {
    msg = JSON.parse(e.data);
  } catch {
    return;
  }
  if (msg.type === 'snapshot') {
    // Keep older pages already loaded; replace what the snapshot covers.
    for (const a of msg.activities) {
      const cur = acts.get(a.activity_key);
      if (!cur || cur.seq < a.seq) acts.set(a.activity_key, a);
    }
    more = msg.more || more;
    learn(msg.activities);
    render();
  } else if (msg.type === 'upsert') apply(msg.activities, true);
  else if (msg.type === 'status') setStatus(msg.status.state, msg.status.error);
}

// --- replay: one click ------------------------------------------------------------------------------------------------

async function replay(key) {
  const a = acts.get(key);
  const u = uiOf(key);
  // In flight, or just accepted (until the feed shows the replay waiting): a second click does nothing.
  if (!a || u.busy || u.sent || !replayable(a)) return;
  u.busy = true;
  // One key per intention: a retried request (network) never queues a second replay.
  u.replayKey ??= crypto.randomUUID();
  render();
  try {
    const res = await fetch('/api/replay', {
      method: 'POST',
      headers: { 'x-dock-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        alert_id: a.state.alert_id,
        replay_key: u.replayKey,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
    u.replayKey = undefined; // done: a later click is a new, deliberate replay
    u.busy = false;
    u.sent = true;
    setTimeout(() => {
      u.sent = false;
      render();
    }, SENT_MS);
    toast(
      out.already_pending
        ? 'Un rejeu de cette alerte est déjà en attente.'
        : 'Rejeu demandé au lecteur d’alertes.',
    );
  } catch (err) {
    u.busy = false;
    const reason =
      {
        original_not_played_yet: 'l’alerte d’origine n’a pas encore été jouée',
        alert_not_replayable: 'aucune animation à rejouer',
      }[err.message] ?? err.message;
    toast(`Rejeu impossible : ${reason}`, { bad: true });
  }
  render();
}

// --- toasts (with an optional action: « Annuler ») --------------------------------------------------------------------

let toastTimer;
let toastAction = null;
function toast(text, { bad = false, action = null, label = '' } = {}) {
  const t = $('#toast');
  toastAction = action;
  t.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="link" id="toast-act">${esc(label)}</button>` : ''}`;
  t.className = bad ? 'toast bad' : 'toast';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 7_000 : 4_000);
}
$('#toast').addEventListener('click', (ev) => {
  if (ev.target.id !== 'toast-act' || !toastAction) return;
  toastAction();
  toastAction = null;
  $('#toast').hidden = true;
});

// --- history ----------------------------------------------------------------------------------------------------------

async function older() {
  if (loadingOlder) return;
  let last;
  for (const a of acts.values())
    if (
      !last ||
      a.occurred_at < last.occurred_at ||
      (a.occurred_at === last.occurred_at && a.seq < last.seq)
    )
      last = a;
  if (!last) return;
  loadingOlder = true;
  $('#older').disabled = true;
  try {
    const res = await fetch(
      `/api/history?before=${encodeURIComponent(last.occurred_at)}&before_seq=${last.seq}`,
      { headers: { 'x-dock-key': KEY } },
    );
    const out = await res.json();
    if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
    for (const a of out.activities)
      if (!acts.has(a.activity_key)) acts.set(a.activity_key, a);
    more = out.more;
    learn(out.activities);
    render();
  } catch (err) {
    toast(`Historique indisponible : ${err.message}`, { bad: true });
  } finally {
    loadingOlder = false;
    $('#older').disabled = false;
  }
}

// --- rows: open, select -----------------------------------------------------------------------------------------------

function toggleOpen(li) {
  if (!li?.classList.contains('expandable')) return;
  const u = uiOf(li.dataset.key);
  u.open = !u.open;
  render();
}

function select(key, { add = false, range = false } = {}) {
  if (range && anchor) {
    for (const k of rangeKeys(
      rows.map((r) => r.key),
      anchor,
      key,
    ))
      selected.add(k);
  } else if (add || selected.size || picking) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    anchor = key;
  } else {
    selected.add(key);
    anchor = key;
  }
  render();
}

function clearSelection() {
  selected.clear();
  anchor = null;
  picking = false;
  render();
}

/** Hides the selected rows (a Bonk salve: all its Bonks). Undo from the toast, or restore from the trash. */
function hideSelected() {
  const keys = [...selected].flatMap(
    (k) => rowByKey.get(k)?.items.map((a) => a.activity_key) ?? [],
  );
  if (!keys.length) return;
  trash = trashAdd(trash, keys);
  hiddenKeys = trashedKeys(trash);
  store('trash', trash);
  selected.clear();
  anchor = null;
  picking = false;
  render();
  if (!trashPanel.hidden) renderTrash();
  const n = keys.length;
  toast(
    `${n} événement${n > 1 ? 's' : ''} masqué${n > 1 ? 's' : ''} (corbeille d’affichage)`,
    {
      label: 'Annuler',
      action: () => restore(keys),
    },
  );
}

function restore(keys) {
  trash = trashRestore(trash, keys);
  hiddenKeys = trashedKeys(trash);
  store('trash', trash);
  render();
  if (!trashPanel.hidden) renderTrash();
}

list.addEventListener('mousedown', (ev) => {
  // Shift + clic selects a range: no text selection on the way.
  if (ev.shiftKey && ev.target.closest('li[data-key]')) ev.preventDefault();
});
list.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-replay]');
  if (btn) {
    ev.stopPropagation();
    void replay(btn.dataset.replay);
    return;
  }
  const li = ev.target.closest('li[data-key]');
  if (!li) return;
  const key = li.dataset.key;
  if (ev.ctrlKey || ev.metaKey) return select(key, { add: true });
  if (ev.shiftKey) return select(key, { range: true });
  if (selected.size || picking) return select(key);
  // Selecting text in an open detail does not close it.
  if (
    ev.target.closest('.detail') ||
    String(window.getSelection() ?? '').length
  )
    return;
  toggleOpen(li);
});
list.addEventListener('keydown', (ev) => {
  const li = ev.target.closest?.('li[data-key]');
  if (!li || ev.target !== li) return;
  const key = li.dataset.key;
  if (ev.key === ' ') {
    ev.preventDefault();
    select(key, { add: true, range: ev.shiftKey });
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    if (selected.size || picking) select(key);
    else toggleOpen(li);
  } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    (ev.key === 'ArrowDown'
      ? li.nextElementSibling
      : li.previousElementSibling
    )?.focus();
  }
});
// A picture that cannot load leaves the initial underneath.
list.addEventListener(
  'error',
  (ev) => {
    if (ev.target?.tagName === 'IMG') ev.target.remove();
  },
  true,
);
document.addEventListener('keydown', (ev) => {
  if (ev.target?.tagName === 'INPUT') return;
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected.size) {
    ev.preventDefault();
    hideSelected();
  } else if (ev.key === 'Escape') {
    if (!prefsPanel.hidden || !trashPanel.hidden) closePanels();
    else if (selected.size || picking) clearSelection();
    else {
      const li = document.activeElement?.closest?.('li[data-key]');
      if (li && uiOf(li.dataset.key).open) toggleOpen(li);
    }
  }
});

pickBtn.addEventListener('click', () => {
  if (picking || selected.size) clearSelection();
  else {
    picking = true;
    render();
  }
});
$('#hide').addEventListener('click', hideSelected);
$('#selclear').addEventListener('click', clearSelection);
$('#older').addEventListener('click', () => void older());
pill.addEventListener('click', () => {
  scroller.scrollTo({ top: 0, behavior: 'smooth' });
});
// Far down without anything new: the same pill brings back the recent events.
const FAR_PX = 900;
scroller.addEventListener('scroll', () => {
  const top = scroller.scrollTop;
  if (top <= TOP_PX && unseen) unseen = 0;
  if (unseen) return;
  if (top > FAR_PX) {
    if (pill.hidden) {
      pill.innerHTML = `${icon('arrowUp')}Revenir aux récents`;
      pill.hidden = false;
    }
  } else pill.hidden = true;
});

// --- panels: preferences, trash ---------------------------------------------------------------------------------------

function closePanels() {
  prefsPanel.hidden = true;
  trashPanel.hidden = true;
  gear.setAttribute('aria-expanded', 'false');
  bin.setAttribute('aria-expanded', 'false');
}
function openPanel(which) {
  const open = which.hidden;
  closePanels();
  if (!open) return;
  which.hidden = false;
  (which === prefsPanel ? gear : bin).setAttribute('aria-expanded', 'true');
  if (which === prefsPanel) renderPrefs();
  else renderTrash();
}

function renderPrefs() {
  const open = !!prefsPanel.querySelector('details.rewards')?.open;
  $('#prefs-body').innerHTML = prefsHtml(prefs, { rewardsOpen: open });
  for (const el of prefsPanel.querySelectorAll('[data-mixed]'))
    el.indeterminate = true;
}

gear.addEventListener('click', () => openPanel(prefsPanel));
$('#prefs-body').addEventListener('change', (ev) => {
  const t = ev.target;
  const hidden = new Set(prefs.hidden);
  if (t.dataset.filter) {
    if (t.checked) hidden.delete(t.dataset.filter);
    else hidden.add(t.dataset.filter);
    setPrefs({ ...prefs, hidden: [...hidden] });
  } else if (t.dataset.group) {
    const fieldset = t.closest('fieldset');
    for (const box of fieldset.querySelectorAll('[data-filter]'))
      if (t.checked) hidden.delete(box.dataset.filter);
      else hidden.add(box.dataset.filter);
    setPrefs({ ...prefs, hidden: [...hidden] });
  } else if (t.dataset.reward) {
    const rh = new Set(prefs.rewards.hidden);
    if (t.checked) rh.delete(t.dataset.reward);
    else rh.add(t.dataset.reward);
    setPrefs({ ...prefs, rewards: { ...prefs.rewards, hidden: [...rh] } });
  } else if (t.id === 'costs') setPrefs({ ...prefs, costs: t.checked });
  else if (t.name === 'density') setPrefs({ ...prefs, density: t.value });
});
$('#all').addEventListener('click', () =>
  setPrefs({ ...prefs, hidden: [], rewards: { ...prefs.rewards, hidden: [] } }),
);
$('#none').addEventListener('click', () =>
  setPrefs({ ...prefs, hidden: [...FILTERS] }),
);
$('#reset').addEventListener('click', () =>
  // The rewards seen stay known (names only); every choice goes back to its default.
  setPrefs({
    ...DEFAULT_PREFS,
    rewards: { hidden: [], names: prefs.rewards.names },
    density: prefs.density, // « Réinitialiser » is about the events shown, not the size
  }),
);

const tChecked = new Set(); // activity keys ticked in the trash panel

function renderTrash() {
  const inTrash = new Set(trash.items.map((x) => x.k));
  for (const k of tChecked) if (!inTrash.has(k)) tChecked.delete(k);
  const loaded = [...acts.values()].filter((a) => inTrash.has(a.activity_key));
  const trows = entries(loaded);
  const missing = inTrash.size - loaded.length;
  $('#trash-list').innerHTML = trashListHtml(
    trows,
    tChecked,
    Date.now(),
    prefs,
  );
  for (const el of trashPanel.querySelectorAll('[data-mixed]'))
    el.indeterminate = true;
  $('#trash-empty').hidden = inTrash.size > 0;
  $('#trash-note').hidden = missing <= 0;
  $('#trash-note').textContent =
    `+ ${missing} plus ancien${missing > 1 ? 's' : ''}, non chargé${missing > 1 ? 's' : ''} (restaurés avec « Tout restaurer »).`;
  $('#t-restore').disabled = tChecked.size === 0;
  $('#t-restore').textContent = tChecked.size
    ? `Restaurer (${tChecked.size})`
    : 'Restaurer';
  $('#t-all').disabled = inTrash.size === 0;
  $('#t-empty').disabled = inTrash.size === 0;
}

bin.addEventListener('click', () => {
  if (selected.size) hideSelected();
  else openPanel(trashPanel);
});
$('#trash-list').addEventListener('change', (ev) => {
  const t = ev.target;
  const keys = t.dataset.tkeys
    ? t.dataset.tkeys.split(' ')
    : t.dataset.tkey
      ? [t.dataset.tkey]
      : [];
  for (const k of keys)
    if (t.checked) tChecked.add(k);
    else tChecked.delete(k);
  renderTrash();
});
$('#t-restore').addEventListener('click', () => {
  restore([...tChecked]);
  tChecked.clear();
  renderTrash();
});
$('#t-all').addEventListener('click', () => {
  restore(null);
  tChecked.clear();
});
$('#t-empty').addEventListener('click', (ev) => {
  // Emptying is final for this dock: ask once more, inline (no blocking dialog in OBS).
  const b = ev.currentTarget;
  if (!b.classList.contains('confirm')) {
    b.classList.add('confirm');
    b.textContent = 'Confirmer : vider';
    setTimeout(() => {
      b.classList.remove('confirm');
      b.textContent = 'Vider la corbeille';
    }, 3_000);
    return;
  }
  b.classList.remove('confirm');
  b.textContent = 'Vider la corbeille';
  trash = trashEmpty(trash);
  hiddenKeys = trashedKeys(trash);
  store('trash', trash);
  tChecked.clear();
  render();
  renderTrash();
});
for (const b of document.querySelectorAll('[data-close]'))
  b.addEventListener('click', closePanels);

// Relative times and the « just arrived » highlight age every 30 s (only rows whose text changed are rebuilt);
// a resized dock measures again which viewer texts are cut.
setInterval(() => {
  const now = Date.now();
  for (const [k, until] of fresh) if (until <= now) fresh.delete(k);
  render();
}, 30_000);
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const li of list.children) measure(li);
  }, 150);
});

gear.innerHTML = icon('gear');
bin.insertAdjacentHTML('afterbegin', icon('trash'));
pickBtn.innerHTML = icon('select');
$('#hide').insertAdjacentHTML('afterbegin', icon('trash'));
applyDensity();
render();
setStatus('connecting');
void connect();
