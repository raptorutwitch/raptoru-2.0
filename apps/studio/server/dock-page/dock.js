import {
  catOf,
  CATS,
  DEFAULT_PREFS,
  entries,
  esc,
  folded,
  icon,
  parseSse,
  readPrefs,
  recipientsByGift,
  rowHtml,
} from './dock-view.js';

// Dock OBS V1.1 (docs/OBS_DOCK.md) — the dock page, in an OBS custom browser dock. Reads Studio's dock server only
// (same origin, key from the URL fragment, never sent elsewhere). Rows are recomputed from the raw activities
// (entries(): filters, then presentation grouping) and reconciled by key: an unchanged row keeps its element, so the
// browser's scroll anchoring keeps what you read in place while rows arrive above; « N nouveaux » brings you back.
// Preferences live in this dock's localStorage (kept across OBS restarts). The replay asks a second click within 3 s;
// the Core decides and never repeats the event's effects.

const KEY = new URLSearchParams(location.hash.slice(1)).get('key') ?? '';
const $ = (s) => document.querySelector(s);
const list = $('#list');
const scroller = list.parentElement;
const banner = $('#banner');
const pill = $('#pill');
const dot = $('#dot');
const gear = $('#gear');
const panel = $('#prefs');

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
const acts = new Map();
const ui = new Map(); // row key → { open, confirm, busy, replayKey }
const fresh = new Map(); // activity key → until (ms)
const htmlOf = new WeakMap(); // row element → the HTML it was built from
let prefs = readPrefs(store('prefs'));
let more = false;
let unseen = 0;
let loadingOlder = false;

const uiOf = (k) => {
  if (!ui.has(k)) ui.set(k, {});
  return ui.get(k);
};
const shown = (a) => !folded(a) && !prefs.hidden.includes(catOf(a));

const make = (html) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
};

/** Renders the rows, reusing every element whose HTML did not change (position, focus and scroll stay put). */
function render() {
  const now = Date.now();
  const rows = entries(acts.values(), prefs);
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
    } else if (!el) el = make(html);
    htmlOf.set(el, html);
    if (el === cursor) cursor = el.nextElementSibling;
    else list.insertBefore(el, cursor);
  }
  for (const el of prev.values()) el.remove();
  if (focused && !list.contains(document.activeElement))
    list.querySelector(`li[data-key="${CSS.escape(focused)}"]`)?.focus();
  const empty = $('#empty');
  empty.hidden = rows.length > 0;
  empty.textContent = acts.size
    ? 'Rien à afficher avec tes préférences actuelles.'
    : 'Aucun événement pour l’instant.';
  $('#older').hidden = !more;
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
      if (shown(a)) added += 1;
    }
    // A replay seen queued / played: the click is done.
    const u = ui.get(a.activity_key);
    if (u?.busy && a.state?.replay) u.busy = false;
  }
  if (added && scroller.scrollTop > 24) {
    unseen += added;
    pill.innerHTML = `${icon('arrowUp')}${unseen} nouveau${unseen > 1 ? 'x' : ''}`;
    pill.hidden = false;
  }
  render();
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
    render();
  } else if (msg.type === 'upsert') apply(msg.activities, true);
  else if (msg.type === 'status') setStatus(msg.status.state, msg.status.error);
}

// --- actions ---------------------------------------------------------------------------------------------------------

async function replay(key) {
  const a = acts.get(key);
  const u = uiOf(key);
  if (!a || u.busy) return;
  if (!u.confirm) {
    u.confirm = true;
    render();
    setTimeout(() => {
      if (u.confirm && !u.busy) {
        u.confirm = false;
        render();
      }
    }, 3_000);
    return;
  }
  u.confirm = false;
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
    toast(
      out.already_pending
        ? 'Un rejeu de cette alerte est déjà en attente.'
        : 'Rejeu envoyé au lecteur d’alertes.',
    );
  } catch (err) {
    u.busy = false;
    const reason =
      {
        original_not_played_yet: 'l’alerte d’origine n’a pas encore été jouée',
        alert_not_replayable: 'aucune animation à rejouer',
      }[err.message] ?? err.message;
    toast(`Rejeu impossible : ${reason}`, true);
    render();
  }
}

let toastTimer;
function toast(text, bad = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = bad ? 'toast bad' : 'toast';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4_000);
}

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
    render();
  } catch (err) {
    toast(`Historique indisponible : ${err.message}`, true);
  } finally {
    loadingOlder = false;
    $('#older').disabled = false;
  }
}

function toggle(li) {
  if (!li?.classList.contains('expandable')) return;
  const u = uiOf(li.dataset.key);
  u.open = !u.open;
  render();
}

list.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-replay]');
  if (btn) {
    ev.stopPropagation();
    void replay(btn.dataset.replay);
    return;
  }
  // Selecting text in an open detail does not close it.
  if (ev.target.closest('.detail')) return;
  toggle(ev.target.closest('li[data-key]'));
});
list.addEventListener('keydown', (ev) => {
  const li = ev.target.closest?.('li[data-key]');
  if (!li || ev.target !== li) return;
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    toggle(li);
  } else if (ev.key === 'Escape' && uiOf(li.dataset.key).open) toggle(li);
});
$('#older').addEventListener('click', () => void older());
pill.addEventListener('click', () => {
  scroller.scrollTo({ top: 0, behavior: 'smooth' });
});
scroller.addEventListener('scroll', () => {
  if (scroller.scrollTop <= 24 && unseen) {
    unseen = 0;
    pill.hidden = true;
  }
});

// --- preferences -----------------------------------------------------------------------------------------------------

function renderPrefs() {
  const hidden = new Set(prefs.hidden);
  $('#cats').innerHTML = CATS.map(
    (c) => `<label class="cat c-${c.id}">
      <input type="checkbox" data-cat="${c.id}"${hidden.has(c.id) ? '' : ' checked'}>
      ${icon(c.icon)}<span>${esc(c.label)}</span></label>`,
  ).join('');
  $('#costs').checked = prefs.costs;
  gear.classList.toggle('filtered', hidden.size > 0);
  gear.title = hidden.size
    ? `Préférences (${hidden.size} catégorie${hidden.size > 1 ? 's' : ''} masquée${hidden.size > 1 ? 's' : ''})`
    : 'Préférences';
}

function setPrefs(next) {
  prefs = readPrefs(next);
  store('prefs', prefs);
  renderPrefs();
  render();
}

gear.addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  gear.setAttribute('aria-expanded', String(!panel.hidden));
});
$('#cats').addEventListener('change', (ev) => {
  const id = ev.target.dataset?.cat;
  if (!id) return;
  const hidden = new Set(prefs.hidden);
  if (ev.target.checked) hidden.delete(id);
  else hidden.add(id);
  setPrefs({ ...prefs, hidden: [...hidden] });
});
$('#all').addEventListener('click', () => setPrefs({ ...prefs, hidden: [] }));
$('#costs').addEventListener('change', (ev) =>
  setPrefs({ ...prefs, costs: ev.target.checked }),
);
$('#reset').addEventListener('click', () => setPrefs(DEFAULT_PREFS));
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !panel.hidden) {
    panel.hidden = true;
    gear.setAttribute('aria-expanded', 'false');
    gear.focus();
  }
});

// Relative times and the « just arrived » highlight age every 30 s (only rows whose text changed are rebuilt).
setInterval(() => {
  const now = Date.now();
  for (const [k, until] of fresh) if (until <= now) fresh.delete(k);
  render();
}, 30_000);

gear.innerHTML = icon('gear');
renderPrefs();
render();
setStatus('connecting');
void connect();
