import {
  byRecency,
  folded,
  GROUPS,
  groupOf,
  parseSse,
  recipientsByGift,
  rowHtml,
} from './dock-view.js';

// Dock OBS V1 (docs/OBS_DOCK.md) — the dock page, in an OBS custom browser dock. Reads Studio's dock server only
// (same origin, key from the URL fragment, never sent elsewhere). Keeps its position while you read: new rows are
// inserted above (the browser's scroll anchoring keeps what you look at in place) and « N nouveaux » brings you back.
// The replay asks a second click within 3 s; the Core decides and never repeats the event's effects.

const KEY = new URLSearchParams(location.hash.slice(1)).get('key') ?? '';
const $ = (s) => document.querySelector(s);
const list = $('#list');
const banner = $('#banner');
const pill = $('#pill');
const dot = $('#dot');

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

const acts = new Map();
const ui = new Map(); // key → { open, fresh, confirm, busy, replayKey }
let hidden = new Set(store('hidden') ?? []);
let more = false;
let unseen = 0;
let loadingOlder = false;

const uiOf = (k) => {
  if (!ui.has(k)) ui.set(k, {});
  return ui.get(k);
};

function visible(a) {
  return !folded(a) && !hidden.has(groupOf(a));
}

/** The row's UI state, plus a community gift's folded recipients. */
function rowUi(a, now = Date.now()) {
  const recipients =
    a.type === 'gift_community' && a.data?.community_gift_id
      ? recipientsByGift(acts.values()).get(a.data.community_gift_id)
      : undefined;
  return { ...uiOf(a.activity_key), now, recipients };
}

/** Rebuilds the chips (counts are of the loaded activities). */
function renderChips() {
  const counts = {};
  for (const a of acts.values())
    if (!folded(a)) counts[groupOf(a)] = (counts[groupOf(a)] ?? 0) + 1;
  $('#chips').innerHTML = GROUPS.map(
    (g) =>
      `<button type="button" class="chip g-${g.id}${hidden.has(g.id) ? ' off' : ''}" data-group="${g.id}"
        aria-pressed="${!hidden.has(g.id)}" title="${g.label}"><span aria-hidden="true">${g.icon}</span>${counts[g.id] ? `<b>${counts[g.id]}</b>` : ''}</button>`,
  ).join('');
}

/** Full render (snapshot, filter change): rows in order. */
function renderAll() {
  const rows = [...acts.values()].filter(visible).sort(byRecency);
  const now = Date.now();
  list.innerHTML = rows.map((a) => rowHtml(a, rowUi(a, now))).join('');
  $('#empty').hidden = rows.length > 0;
  $('#older').hidden = !more;
  renderChips();
}

/** Inserts / replaces one row in place (keyed), keeping the reader's position. */
function upsertRow(a, isNew) {
  const old = list.querySelector(
    `li[data-key="${CSS.escape(a.activity_key)}"]`,
  );
  if (!visible(a)) {
    old?.remove();
    return;
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = rowHtml(a, rowUi(a)).trim();
  const el = tpl.content.firstElementChild;
  if (old) {
    old.replaceWith(el);
    return;
  }
  const after = [...list.children].find((li) => {
    const b = acts.get(li.dataset.key);
    return b && byRecency(a, b) < 0;
  });
  list.insertBefore(el, after ?? null);
  $('#empty').hidden = true;
  if (isNew && list.parentElement.scrollTop > 24) {
    unseen += 1;
    pill.textContent = `${unseen} nouveau${unseen > 1 ? 'x' : ''} ↑`;
    pill.hidden = false;
  }
}

function apply(activities, isNew) {
  for (const a of activities) {
    const cur = acts.get(a.activity_key);
    if (cur && cur.seq >= a.seq) continue;
    acts.set(a.activity_key, a);
    const u = uiOf(a.activity_key);
    if (!cur && isNew) {
      u.fresh = true;
      setTimeout(() => {
        u.fresh = false;
        list
          .querySelector(`li[data-key="${CSS.escape(a.activity_key)}"]`)
          ?.classList.remove('fresh');
      }, 60_000);
    }
    // A replay seen queued / played: the click is done.
    if (u.busy && a.state?.replay) u.busy = false;
    upsertRow(a, isNew && !cur);
    // A folded recipient: its community gift's row shows it.
    if (folded(a))
      for (const g of acts.values())
        if (
          g.type === 'gift_community' &&
          g.data?.community_gift_id === a.data.community_gift_id
        )
          upsertRow(g, false);
  }
  renderChips();
}

const STATUS = {
  live: ['ok', 'En direct'],
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
  banner.hidden = tone === 'ok';
  banner.textContent = detail ? `${label} (${detail})` : label;
}

// --- the stream (fetch: EventSource cannot send the key header) --------------------------------------------------

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
    renderAll();
  } else if (msg.type === 'upsert') apply(msg.activities, true);
  else if (msg.type === 'status') setStatus(msg.status.state, msg.status.error);
}

// --- actions -----------------------------------------------------------------------------------------------------

async function replay(key) {
  const a = acts.get(key);
  const u = uiOf(key);
  if (!a || u.busy) return;
  if (!u.confirm) {
    u.confirm = true;
    upsertRow(a, false);
    setTimeout(() => {
      if (u.confirm && !u.busy) {
        u.confirm = false;
        upsertRow(a, false);
      }
    }, 3_000);
    return;
  }
  u.confirm = false;
  u.busy = true;
  // One key per intention: a retried request (network) never queues a second replay.
  u.replayKey ??= crypto.randomUUID();
  upsertRow(a, false);
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
    upsertRow(a, false);
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
  const last = [...acts.values()].sort(byRecency).at(-1);
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
    renderAll();
  } catch (err) {
    toast(`Historique indisponible : ${err.message}`, true);
  } finally {
    loadingOlder = false;
    $('#older').disabled = false;
  }
}

list.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-replay]');
  if (btn) {
    ev.stopPropagation();
    void replay(btn.dataset.replay);
    return;
  }
  const li = ev.target.closest('li[data-key]');
  if (!li) return;
  const u = uiOf(li.dataset.key);
  u.open = !u.open;
  upsertRow(acts.get(li.dataset.key), false);
});
list.addEventListener('keydown', (ev) => {
  const li = ev.target.closest?.('li[data-key]');
  if (!li || ev.target !== li) return;
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    li.click();
  } else if (ev.key === 'Escape' && uiOf(li.dataset.key).open) {
    uiOf(li.dataset.key).open = false;
    upsertRow(acts.get(li.dataset.key), false);
  }
});
$('#chips').addEventListener('click', (ev) => {
  const chip = ev.target.closest('[data-group]');
  if (!chip) return;
  const g = chip.dataset.group;
  if (hidden.has(g)) hidden.delete(g);
  else hidden.add(g);
  store('hidden', [...hidden]);
  renderAll();
});
$('#older').addEventListener('click', () => void older());
pill.addEventListener('click', () => {
  list.parentElement.scrollTo({ top: 0, behavior: 'smooth' });
});
list.parentElement.addEventListener('scroll', () => {
  if (list.parentElement.scrollTop <= 24 && unseen) {
    unseen = 0;
    pill.hidden = true;
  }
});
// Relative times refresh every 30 s (text only, no re-sort).
setInterval(() => {
  const now = Date.now();
  for (const li of list.children) {
    const a = acts.get(li.dataset.key);
    const w = li.querySelector('.when');
    if (a && w) {
      const tpl = document.createElement('template');
      tpl.innerHTML = rowHtml(a, rowUi(a, now));
      w.textContent =
        tpl.content.querySelector('.when')?.textContent ?? w.textContent;
    }
  }
}, 30_000);

renderChips();
setStatus('connecting');
void connect();
