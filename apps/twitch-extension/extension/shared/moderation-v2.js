// Moderation V2 (D4) — the console of the validated prototype `prototypes/moderation-v2-d4` (left
// column = context, right zone = one intention; compact stack on Panel / Mobile), on the REAL Core:
// every list comes from Core read models (/moderation/v2/*), every action is a Core command executed
// with the caller's permissions (roles + D4 grants per moderator) and audited by Core. No simulated
// state, no business rule here, no localStorage. The same module is Studio's « Modération » console
// (Studio = broadcaster), so Studio and the extension show the same moderation.
import { moneyHtml } from './currency.js';

const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 11h6M9 15h4"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  timeplus: '<circle cx="11" cy="13" r="7"/><path d="M11 9.5V13l2.2 1.6M18.5 2.5v5M16 5h5"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  tts: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  soundboard: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  bonk: '<path d="m13 3 8 8-3 3-8-8z"/><path d="m11.5 8.5-8 8 4 4 8-8"/>',
  raffle: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2.5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  refund: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4M12 7.5v1.5M12 15.5V17"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  hub: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const MODS = {
  tts: { label: 'TTS', c: 'var(--m-tts)', unit: 'demande', units: 'demandes' },
  soundboard: { label: 'Soundboard', short: 'Sons', c: 'var(--m-soundboard)', unit: 'son', units: 'sons' },
  bonk: { label: 'Bonk', c: 'var(--m-bonk)', unit: 'bonk', units: 'bonks' },
  raffle: { label: 'Tombola', c: 'var(--m-raffle)', unit: 'ticket', units: 'tickets' },
};
const MOD_KEYS = ['tts', 'soundboard', 'bonk', 'raffle'];
const SCOPE = { all: 'Tout Raptoru', ...Object.fromEntries(MOD_KEYS.map((m) => [m, MODS[m].label])) };
const STATE = { active: 'Actif', paused: 'En pause', disabled: 'Désactivé' };
const STATUS = {
  queued: 'en attente',
  accepted: 'en attente',
  starting: 'en cours',
  playing: 'en cours',
  executing: 'en cours',
  completed: 'terminé',
  failed: 'échec',
  execution_unknown: 'non confirmé',
  cancelled: 'retiré',
};
/** The 6 permissions D4 grants per moderator (Core names them the same way). */
const PERMS = {
  wallet: ['Admin Wallet', 'Créditer ou débiter Jetons et crédits.'],
  modules: ['Désactiver un module', 'Passer un module en « Désactivé ».'],
  globalPause: ['Pause globale', 'Refuser toutes les nouvelles interactions.'],
  perms: ['Gérer les permissions', 'Accorder ces permissions aux autres mods.'],
  sensitive: ['Sanctions sensibles', 'Bloquer tout Raptoru, ou plus d’une heure.'],
  words: ['Mots surveillés / bloqués', 'Modifier la liste de surveillance TTS.'],
  raffle: ['Gérer la Tombola', '+ temps, pause, tirage immédiat, ajout manuel.'],
};
const ROLE_LABEL = { broadcaster: 'Streamer', supermod: 'Supermod', moderator: 'Mod', viewer: 'Viewer' };
const ACTION = {
  module_paused: 'Mise en pause',
  module_active: 'Reprise',
  module_disabled: 'Désactivation',
  stop: 'Arrêté',
  stop_all: 'Stop tous les sons',
  cancel: 'Retiré',
  purge: 'File purgée',
  refund: 'Remboursement',
  allow: 'Laissé passer',
  block_viewer: 'Blocage',
  unblock_viewer: 'Déblocage',
  cooldown_set: 'Cooldown personnel',
  cooldown_clear: 'Cooldown retiré',
  cooldown_running_clear: 'Cooldown TTS effacé',
  global_pause: 'Pause globale',
  global_resume: 'Pause globale levée',
  set_permission: 'Permission',
  set_staff: 'Rôle d’équipe',
  note_add: 'Note',
  word_add: 'Mot ajouté',
  word_remove: 'Mot retiré',
  wallet_adjust: 'Wallet admin',
  raffle_open: 'Tombola ouverte',
  raffle_close: 'Tombola fermée',
  raffle_draw: 'Tirage Tombola',
  raffle_extend: 'Tombola · + temps',
  raffle_pause: 'Tombola · pause',
  raffle_resume: 'Tombola · reprise',
  raffle_cancel: 'Tombola · annulation',
  raffle_add_participant: 'Tombola · ajout manuel',
  raffle_remove_participant: 'Tombola · retrait',
  raffle_no_participants: 'Tombola · aucun participant',
  raffle_config: 'Configuration Tombola',
  config_update: 'Configuration TTS',
  config_reset: 'Configuration TTS (défaut)',
  lab_wallet_set: 'Wallet de test défini',
  lab_wallet_adjust: 'Wallet de test ajusté',
  lab_wallet_reset: 'Wallet de test réinitialisé',
};
const ERRORS = {
  already_refunded: 'Déjà remboursé.',
  not_terminal: 'Arrête ou retire d’abord cette demande.',
  nothing_playing: 'Rien en cours de lecture.',
  not_open: 'Cette demande n’est plus dans la file.',
  not_pending: 'Cette demande n’attend plus de vérification.',
  unsupported: 'Action sans objet pour ce module.',
  target_is_staff: 'Un membre de l’équipe ne peut pas être sanctionné.',
  target_not_editable: 'Supermods et streamer ont déjà toutes les permissions.',
  self_edit: 'Tu ne peux pas modifier tes propres permissions.',
  not_in_team: 'Cette personne n’est pas dans l’équipe.',
  word_exists: 'Ce mot est déjà dans la liste.',
  word_not_found: 'Mot introuvable.',
  nothing_to_debit: 'Solde déjà à 0.',
  wallet_full: 'Solde au maximum.',
  raffle_already_open: 'Une tombola est déjà ouverte.',
  no_open_raffle: 'Aucune tombola ouverte.',
  nothing_to_draw: 'Aucune tombola à tirer.',
  viewer_blocked: 'Viewer bloqué de la Tombola.',
  already_joined: 'Déjà inscrit à cette manche.',
  not_a_participant: 'Ne participe pas à cette manche.',
  invalid_phase: 'Impossible à ce stade de la manche.',
  network_error: 'Connexion perdue : réessaie.',
};
// History filters of the prototype (status / period): applied by Core.
const STATUS_F = [['all', 'Tous'], ['done', 'terminé'], ['queued', 'en attente'], ['refunded', 'remboursé'], ['cancelled', 'retiré'], ['failed', 'échec']];
const PERIOD_F = [['all', 'Ce stream'], ['60', 'Dernière heure'], ['15', '15 dernières min']];
const statusKey = (i) =>
  i.status_key ?? (i.refund_status === 'refunded' ? 'refunded' : i.status === 'completed' ? 'done' : ['queued', 'accepted', 'starting', 'playing', 'executing'].includes(i.status) ? 'queued' : i.status === 'cancelled' ? 'cancelled' : 'failed');
const statusText = (i) => (i.refund_status === 'refunded' ? 'remboursé' : STATUS[i.status] ?? esc(i.status));
const actorName = (a) => (/^studio(:|$)/.test(String(a)) ? 'Studio' : String(a) === 'system' ? 'Automatique' : String(a ?? ''));
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const dday = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '');
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const dur = (s) => {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m}` : `${h} h`;
};
const agoSecs = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
const ago = (iso) => {
  const d = agoSecs(iso);
  return d < 60 ? `il y a ${d} s` : d < 3600 ? `il y a ${Math.floor(d / 60)} min` : `il y a ${Math.floor(d / 3600)} h`;
};
const money = (i) => (Number(i.simulated_cost ?? i.cost) === 0 && i.module === 'raffle' ? 'gratuit' : `${fmt(i.simulated_cost ?? i.cost)} ${i.payment_method === 'credits' ? 'cr' : 'J'}`);
const CUR = { tokens: 'J', credits_tts: 'cr TTS', credits_soundboard: 'cr Sons' };
const signed = (e) => `${Number(e.amount) > 0 ? '+' : '−'} ${fmt(Math.abs(Number(e.amount)))} ${CUR[e.currency] ?? e.currency}`;
const hue = (id) => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const av = (id, name, size) => {
  const h = hue(id);
  const initials = esc(String(name || id).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase());
  return `<span class="avatar${size ? ` avatar--${size}` : ''}" style="--a1:hsl(${h} 70% 58%);--a2:hsl(${(h + 40) % 360} 70% 45%)" aria-hidden="true">${initials}</span>`;
};
const OPEN = ['queued', 'accepted', 'starting', 'playing', 'executing'];
const isLive = (i) => OPEN.includes(i.status);
const isPlaying = (i) => ['starting', 'playing', 'executing'].includes(i.status) || (i.module === 'soundboard' && !!i.delivery?.attempt_id && isLive(i));
/** Highlights the words Core matched (positions in the original message). */
const marked = (text, hits) => {
  const t = String(text ?? '');
  if (!hits?.length) return esc(t);
  let out = '';
  let at = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start < at) continue;
    out += `${esc(t.slice(at, h.start))}<mark>${esc(t.slice(h.start, h.end))}</mark>`;
    at = h.end;
  }
  return out + esc(t.slice(at));
};
const pending = (i) => i.review_status === 'pending';

/**
 * @param {{ document: Document, client: { modV2: (path: string) => Promise<any>, modV2Act: (command: object) => Promise<any> },
 *   onChange?: () => void, onBack?: () => void, assetBase?: string }} options
 * onChange: after a successful command (the host may refresh its own session).
 * onBack: leave the console (back to the Hub); the console replaces the host header.
 * assetBase: where the extension assets are served (emotes of the Bonk rows).
 */
export function createModerationV2View({ document, client, onChange, onBack, onCommands, assetBase = '' }) {
  const win = document.defaultView;
  const node = document.createElement('div');
  node.className = 'modv2';
  node.innerHTML = '<div class="layout" data-layout></div>';
  const L = node.querySelector('[data-layout]');

  // Core data (read models). Nothing else is kept: no local truth.
  let overview = null;
  let me = { role: 'viewer', grants: [], permissions: [] };
  const cards = new Map(); // viewer_id → Core viewer card
  const details = new Map(); // interaction_id → Core interaction detail
  const ledgerById = new Map(); // ledger id → movement (from any ledger read)
  let team = null;
  let words = null;
  let hist = null; // { key, items, more } interactions or ledger of the current history view
  let audit = null;
  let destroyed = false;
  let pollTimer = null;
  let tick = null;
  const can = (p) => me.permissions.includes(p);
  /** D4 `can(p)` on the 6 grants (supermods and the streamer have them all). */
  const has = (g) => (me.grants ?? []).includes(g);
  const myId = () => me.actor?.id ?? me.viewer_id ?? null;

  // ------------------------------------------------------------------ navigation (prototype D4)
  const mode = () => {
    const w = node.clientWidth || win.innerWidth;
    return w >= 900 ? 'window' : w >= 560 ? 'video' : 'compact';
  };
  const freshFilters = () => ({ module: 'all', status: 'all', period: 'all', viewer: '' });
  const nav = { stack: [], viewer: null, dir: '', hf: freshFilters(), htab: 'ix', vq: false, auto: false, wtype: 'watch' };
  const reset = () => (nav.stack = mode() === 'compact' ? [{ v: 'home' }] : [{ v: 'module', m: 'tts' }]);
  reset();
  const top = () => nav.stack[nav.stack.length - 1];
  const push = (s) => {
    nav.stack.push(s);
    nav.dir = 'fwd';
    render();
  };
  const pop = () => {
    if (nav.stack.length > 1) {
      nav.stack.pop();
      nav.dir = 'back';
      render();
    }
  };
  const viewerInView = () => nav.viewer ?? (top().v === 'viewer' ? top().id : ['jetons', 'history'].includes(top().v) ? top().vid : null);
  const open = {
    module(m) {
      closeDrawers();
      nav.stack = mode() === 'compact' ? [{ v: 'home' }, { v: 'module', m }] : [{ v: 'module', m }];
      nav.dir = mode() === 'compact' ? 'fwd' : '';
      render();
    },
    viewer(id) {
      closeSearch();
      closeDrawers();
      void loadViewer(id);
      if (mode() === 'window') {
        nav.viewer = id;
        render();
        return;
      }
      if (top().v === 'viewer' && top().id === id) return;
      push({ v: 'viewer', id });
    },
    history(vid, module = 'all') {
      closeDrawers();
      nav.htab = 'ix';
      nav.hf = { ...freshFilters(), module };
      nav.vq = false;
      nav.auto = false;
      hist = null;
      if (vid) void loadViewer(vid);
      push({ v: 'history', vid });
      void loadHistory();
    },
    jetons(vid) {
      closeDrawers();
      nav.auto = false;
      hist = null;
      void loadViewer(vid);
      push({ v: 'jetons', vid });
      void loadHistory();
    },
  };

  // ------------------------------------------------------------------ data from Core
  const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const list = (m, key) => overview?.[m]?.[key] ?? [];
  const current = () => overview?.tts?.current ?? null;
  const waiting = (m) => list(m, 'waiting');
  const playing = (m) => (m === 'tts' ? (current() ? [current()] : []) : m === 'soundboard' ? list(m, 'playing') : []);
  const stateOf = (m) => overview?.[m]?.module_state ?? 'active';
  const liveItems = () => ['tts', 'soundboard'].flatMap((m) => [...playing(m), ...waiting(m)].map((i) => ({ ...i, module: m })));
  const overviewItems = () => [
    ...liveItems(),
    ...['tts', 'soundboard', 'bonk'].flatMap((m) => list(m, 'recent').map((i) => ({ ...i, module: m }))),
    ...(overview?.raffle?.recent_entries ?? []).map((i) => ({ ...i, module: 'raffle' })),
  ];
  const findItem = (id) => {
    const d = details.get(id);
    const hit = overviewItems().find((i) => i.interaction_id === id);
    if (hit) return d ? { ...d, ...hit, actions: d.actions, movements: d.movements } : hit;
    if (d) return d;
    for (const card of cards.values()) {
      const a = card.activity?.find((x) => x.interaction_id === id);
      if (a) return { ...a, message: a.module === 'tts' ? a.detail : undefined, sound_label: a.module === 'soundboard' ? a.detail : undefined };
    }
    return hist?.items?.find((x) => x.interaction_id === id) ?? null;
  };
  const nameOf = (id) =>
    cards.get(id)?.display_name ?? overviewItems().find((i) => i.viewer_id === id)?.viewer_display_name ?? team?.members?.find((m) => m.viewer_id === id)?.display_name ?? id;

  async function refresh() {
    try {
      const o = await client.modV2('overview');
      if (destroyed) return;
      overview = o;
      me = o.me ?? me;
      render();
    } catch (e) {
      if (!overview) L.innerHTML = `<div class="empty">${esc(errorText(e))}</div>`;
    }
  }
  async function loadViewer(id) {
    try {
      const card = await client.modV2(`viewers/${id}`);
      if (destroyed) return;
      cards.set(id, card);
      for (const e of card.wallet_ledger ?? []) ledgerById.set(String(e.id), e);
      render();
    } catch (e) {
      toast(errorText(e), false);
    }
  }
  async function loadDetail(id) {
    try {
      const d = await client.modV2(`interactions/${id}`);
      if (destroyed) return;
      details.set(id, d);
      render();
    } catch {
      /* shown from the data already loaded */
    }
  }
  async function loadTeam() {
    try {
      team = await client.modV2('team');
      if (!destroyed) render();
    } catch (e) {
      toast(errorText(e), false);
    }
  }
  async function loadWords() {
    try {
      words = (await client.modV2('words')).words ?? [];
      if (!destroyed) render();
    } catch (e) {
      toast(errorText(e), false);
    }
  }
  /** The history view's rows, filtered and paginated by Core. */
  async function loadHistory(more = false) {
    const t = top();
    if (t.v !== 'history' && t.v !== 'jetons') return;
    const vid = t.vid;
    const f = nav.hf;
    const tab = t.v === 'jetons' ? 'j' : nav.htab;
    const key = JSON.stringify([tab, vid, f, nav.auto]);
    try {
      let out;
      if (tab === 'audit') {
        out = { items: (await client.modV2(`audit?${q({ limit: 80, viewer: vid, module: f.module === 'all' ? null : f.module })}`)).audit ?? [] };
      } else if (tab === 'j') {
        const before = more ? hist?.items?.at(-1)?.id : null;
        out = await client.modV2(`ledger?${q({ viewer: vid, limit: 60, before, auto: nav.auto ? 1 : null })}`);
        for (const e of out.items ?? []) ledgerById.set(String(e.id), e);
      } else {
        const before = more ? hist?.items?.at(-1)?.created_at : null;
        out = await client.modV2(
          `interactions?${q({ module: f.module === 'all' ? null : f.module, status: f.status === 'all' ? null : f.status, period: f.period === 'all' ? 'stream' : f.period, viewer: vid, q: vid ? null : f.viewer.trim(), before, limit: 60 })}`,
        );
      }
      if (destroyed) return;
      hist = more && hist?.key === key ? { ...out, key, items: [...hist.items, ...(out.items ?? [])] } : { ...out, key };
      render();
    } catch (e) {
      hist = { key, items: [], more: false };
      toast(errorText(e), false);
      render();
    }
  }
  const errorText = (e) => {
    const code = e?.code ?? e?.details?.error;
    if (code === 'forbidden') {
      const g = e?.details?.grant ?? String(e?.details?.permission ?? '').replace(/^grant\./, '');
      if (PERMS[g]) return `${ic('lock')} Permission « ${PERMS[g][0]} » requise`;
      return `${ic('lock')} Action réservée${e?.details?.needs === 'broadcaster' ? ' au streamer (Studio)' : ''}.`;
    }
    return ERRORS[code] ?? e?.details?.message ?? code ?? 'Action impossible.';
  };
  /** One Core command; the console then shows Core's new state. */
  async function act(command, done) {
    let ok = true;
    try {
      await client.modV2Act(command);
      if (done) toast(done, true);
      onChange?.();
    } catch (e) {
      ok = false;
      toast(errorText(e), false);
    }
    await refresh();
    const vid = viewerInView();
    if (vid) await loadViewer(vid);
    for (const id of [...details.keys()]) if (drawers.some((d) => d.key === `ix:${id}`)) await loadDetail(id);
    if (drawers.some((d) => d.key === 'team')) await loadTeam();
    if (drawers.some((d) => d.key === 'words')) await loadWords();
    if (['history', 'jetons'].includes(top().v)) await loadHistory();
    return ok;
  }

  // ------------------------------------------------------------------ left column
  const sdot = (st) => `<span class="sdot sdot--${st}"></span>`;
  // ------------------------------------------------------------------ Tombola V2 (phase G)
  // The running round as Core shows it (same data as Studio's live view), the same Core commands as
  // Studio carried by the D4 actions channel; Core checks every permission and audits.
  const rv2 = () => overview?.raffle_v2 ?? null;
  const rRound = () => rv2()?.round ?? null;
  const BEFORE_DRAW = ['opening', 'open', 'paused'];
  const SRC = { chat: 'Chat', extension: 'Extension', manual: 'Manuel' };
  const capital = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
  const titleOf = (r, k) => (r?.titles?.[k] ?? []).join(' ').trim();
  function raffleSummary() {
    const r = rRound();
    if (!r) return 'Calme';
    if (r.status === 'paused') return `En pause · ${r.participants}`;
    if (BEFORE_DRAW.includes(r.status)) return `${capital(r.titles?.open?.[1]) || esc(r.titles?.name ?? '')} · ${r.participants}`;
    if (r.status === 'cancelled') return esc(capital(r.titles?.cancelled?.[1]));
    return r.outcome === 'no_participants' ? 'Aucun participant' : 'Tirage';
  }
  function raffleBody() {
    const v = rv2();
    if (!v) return '<div class="empty">Connexion au Core…</div>';
    const r = v.round;
    let b = '';
    if (r) {
      const before = BEFORE_DRAW.includes(r.status);
      const st = r.status === 'paused' ? titleOf(r, 'paused') : before ? titleOf(r, 'open') : r.status === 'cancelled' ? titleOf(r, 'cancelled') : r.status === 'drawing' ? 'Tirage en cours' : r.outcome === 'no_participants' ? titleOf(r, 'ended') : 'Résultat à l’écran';
      const left = Math.max(0, Math.min(r.duration_ms, r.remaining_ms));
      const timer = r.status === 'paused' ? `<span class="timer tnum">${mmss(left)}</span><span class="muted">figé</span>` : before ? `<span class="timer tnum" data-until="${Date.now() + left}">${mmss(left)}</span>` : '';
      const what = r.kind === 'giveaway' ? esc(r.prize ?? '') : moneyHtml(r.amount, r.currency);
      b += `<div class="tmbm tmbm--${esc(r.status)}"><div class="tmbm__top"><b class="tmbm__st">${esc(st)}</b><span class="grow"></span>${timer}</div>
        <div class="tmbm__nums"><span><b class="tnum">${r.participants}</b> participant${r.participants > 1 ? 's' : ''}</span><span class="cost">${what}</span>${r.origin === 'automatic' ? '<span class="muted">auto</span>' : ''}</div></div>`;
      b += sec(`Participants · ${r.participants}`, before ? (can('raffle.manage') ? '<button class="linkish" data-act="raffle-add">+ Ajouter</button>' : `<button class="linkish" data-act="locked" data-perm="raffle">${ic('lock')}Ajouter</button>`) : '');
      b += r.entries.length
        ? `<div class="rows">${r.entries
            .map(
              (e) => `<div class="row">${av(e.viewer_id, e.display_name, 'xs')}${who(e.viewer_id, e.display_name)}<span class="srcpill srcpill--${esc(e.source)}">${SRC[e.source] ?? esc(e.source)}</span><span class="grow"></span><span class="meta tnum hide-narrow">${hhmm(e.created_at)}</span>
              ${before && can('raffle.moderate') ? `<button class="icon-btn icon-btn--xs trash" data-act="raffle-remove" data-v="${esc(e.viewer_id)}" data-name="${esc(e.display_name)}" data-tip="Retirer de la manche" aria-label="Retirer ${esc(e.display_name)}">${ic('x')}</button>` : ''}</div>`,
            )
            .join('')}</div>`
        : '<div class="empty">Aucun participant pour l’instant</div>';
    } else b += '<div class="tmbm tmbm--idle"><b>Aucune manche en cours</b><span class="muted">Lancement depuis Studio (manuel ou automatique).</span></div>';
    // D4 « Dernier tirage »: the winners, their payout and their Jetons movement (drawer).
    const drawn = r?.winners?.length ? r : v.last && (!r || v.last.raffle_id !== r.raffle_id) ? v.last : null;
    if (drawn) {
      const give = drawn.kind === 'giveaway';
      const res = drawn.status === 'cancelled' ? esc(titleOf(drawn, 'cancelled')) : drawn.outcome === 'no_participants' ? `Aucun participant · ${hhmm(drawn.opened_at)}` : '';
      b += sec(drawn === r ? 'Gagnants' : `Dernier tirage · ${esc(drawn.titles?.name ?? '')}`) +
        (res
          ? `<div class="empty">${res}</div>`
          : `<div class="rows">${drawn.winners
              .map((w) =>
                w.ledger_id
                  ? `<button class="j" data-act="open-ledger" data-id="${esc(w.ledger_id)}" data-v="${esc(w.viewer_id)}"><b class="j__amt plus tnum">${moneyHtml(w.amount, drawn.currency, { sign: '+ ' })}</b><span class="j__src">${esc(w.display_name)} · gagnant</span>${w.payout_status === 'paid' ? `<span class="paid">${ic('check')}payé</span>` : `<span class="muted">${w.payout_status === 'failed' ? 'échec' : 'en cours'}</span>`}<span class="meta tnum">${hhmm(w.paid_at)}</span></button>`
                  : `<div class="row">${av(w.viewer_id, w.display_name, 'xs')}${who(w.viewer_id, w.display_name)}<span class="grow"></span><span class="muted">${give ? 'gagne le lot' : esc(w.payout_status)}</span></div>`,
              )
              .join('')}</div>`);
    }
    return b + '<p class="fine">Lancement et réglages : Studio. Ici : la manche en cours.</p>';
  }
  /** Manual entry (Core: through a pause, never over a block unless forced with « Sanctions sensibles »). */
  async function raffleAdd(v, name, force = false) {
    try {
      await client.modV2Act({ action: 'raffle', command: { action: 'add_participant', viewer_id: v, display_name: name, force, ...(force ? { reason: 'ajout forcé malgré le blocage' } : {}) } });
      toast(`${esc(name)} ajouté à la manche`, true);
      onChange?.();
    } catch (e) {
      if ((e?.code ?? e?.details?.error) === 'viewer_blocked' && can('raffle.force'))
        return choiceDialog({
          kicker: 'Action sensible',
          title: 'Viewer bloqué de la Tombola',
          lead: `<b>${esc(name)}</b> est bloqué. Forcer son inscription ? L’action est tracée.`,
          choices: [],
          confirm: 'Je force l’inscription malgré le blocage',
          okLabel: 'Forcer',
          danger: true,
          run: () => void raffleAdd(v, name, true),
        });
      toast((e?.code ?? e?.details?.error) === 'viewer_blocked' ? `${ic('lock')} Viewer bloqué : forcer demande « Sanctions sensibles »` : errorText(e), false);
    }
    await refresh();
    const vid = viewerInView();
    if (vid) await loadViewer(vid);
  }
  let rqTimer = null;
  function raffleAddDialog() {
    dialog({
      state: { q: '', results: [], asked: null },
      render(s) {
        if (s.q !== s.asked) {
          s.asked = s.q;
          win.clearTimeout(rqTimer);
          rqTimer = win.setTimeout(async () => {
            try {
              s.results = (await client.modV2(`search?q=${encodeURIComponent(s.q.trim().slice(0, 40))}`)).viewers ?? [];
            } catch {
              s.results = [];
            }
            const dl = dialogs.find((x) => x.state === s);
            if (dl) refreshDialog(dl);
          }, 180);
        }
        const joined = new Set((rRound()?.entries ?? []).map((e) => e.viewer_id));
        return {
          kicker: rRound()?.titles?.name ?? 'Tombola',
          title: 'Ajouter un participant',
          lead: 'Inscription manuelle, tracée. Passe une pause ; un viewer bloqué est refusé (forcer : « Sanctions sensibles »).',
          body: `<label class="search">${ic('search')}<input data-dlg="q" placeholder="Pseudo…" value="${esc(s.q)}" autocomplete="off"></label>
            <div class="rows" data-slot="res">${
              s.results
                .map((x) =>
                  joined.has(x.viewer_id)
                    ? `<div class="row">${av(x.viewer_id, x.display_name, 'xs')}<b class="ellipsis">${esc(x.display_name)}</b><span class="grow"></span><span class="muted">déjà inscrit</span></div>`
                    : `<button class="row" data-act="raffle-add-pick" data-v="${esc(x.viewer_id)}" data-name="${esc(x.display_name)}">${av(x.viewer_id, x.display_name, 'xs')}<b class="ellipsis">${esc(x.display_name)}</b><span class="grow"></span>${x.restriction === 'block' ? '<span class="kwarn">bloqué</span>' : ''}<span class="linkish">Ajouter</span></button>`,
                )
                .join('') || '<div class="empty">Aucun viewer</div>'
            }</div>`,
          foot: '<button class="btn btn--ghost" data-act="dlg-close">Fermer</button>',
        };
      },
      ok() {},
    });
    win.setTimeout(() => node.querySelector('.dialog [data-dlg="q"]')?.focus(), 60);
  }
  function summary(m) {
    const st = stateOf(m);
    const q0 = waiting(m);
    const p = playing(m);
    const hits = m === 'tts' ? [...p, ...q0].filter(pending).length : 0;
    let text = 'Calme';
    if (m === 'tts') text = q0.length ? `${q0.length} en attente` : p.length ? 'Lecture en cours' : 'Calme';
    if (m === 'soundboard') text = [p.length ? `${p.length} en cours` : '', q0.length ? `${q0.length} en attente` : ''].filter(Boolean).join(' · ') || 'Calme';
    if (m === 'bonk') {
      const b = list('bonk', 'recent')[0];
      text = b ? `Dernier : <span data-ago="${esc(b.created_at)}">${ago(b.created_at)}</span>` : 'Calme';
    }
    if (m === 'raffle') text = raffleSummary();
    if (st !== 'active') text = `<span class="sword sword--${st}">${STATE[st]}</span>${q0.length ? ` · ${q0.length} en attente` : ''}`;
    return { st, text, hits };
  }
  function modLine(m, sel) {
    const s = summary(m);
    const cur = m === 'tts' ? current() : null;
    return `<button class="mod${sel ? ' is-sel' : ''}" data-act="go-module" data-m="${m}" style="--c:${MODS[m].c}" aria-current="${sel}">
      <span class="mod__top"><span class="mod__ic">${ic(m)}</span><span class="mod__name">${MODS[m].label}</span><span class="grow"></span>${s.hits ? `<span class="watchpill" data-tip="Demandes contenant un mot surveillé">${s.hits} à vérifier</span>` : ''}${sdot(s.st)}</span>
      <span class="mod__sum">${s.text}</span>${cur?.delivery?.started_at ? `<span class="thin"><i data-prog="${cur.interaction_id}"></i></span>` : ''}</button>`;
  }
  const gPaused = () => !!overview?.global?.paused;
  const footHtml = () =>
    `<button class="gpill${gPaused() ? ' gpill--paused' : ''}" data-act="global-menu" data-tip="État global de Raptoru">${gPaused() ? `${ic('pause')}Pause globale` : '<span class="live"></span>En direct'}</button>
     <button class="icon-btn icon-btn--sm" data-act="team" data-tip="Équipe et permissions" aria-label="Équipe et permissions">${ic('shield')}</button>`;
  function sideHtml() {
    const t = top();
    const selM = t.v === 'module' ? t.m : null;
    // The console replaces the host header: its only addition to D4 is the way back to the Hub.
    const hub = onBack ? `<button class="icon-btn icon-btn--sm" data-act="hub" data-tip="Retour au Hub" aria-label="Retour au Hub">${ic('hub')}</button>` : '';
    return `<div class="side__top">${hub}<label class="search"><span class="sr">Rechercher un viewer</span>${ic('search')}<input data-q placeholder="Viewer…" autocomplete="off"></label></div>
      <nav class="mods" data-mods aria-label="Modules">${MOD_KEYS.map((m) => modLine(m, selM === m)).join('')}</nav>
      <button class="sidelink${t.v === 'history' && !t.vid ? ' is-sel' : ''}" data-act="history" data-histlink>${ic('history')}Historique</button>
      ${onCommands ? `<button class="sidelink" data-act="commands">${ic('note')}Commandes</button>` : ''}
      <div class="side__foot" data-foot>${footHtml()}</div>`;
  }

  // ------------------------------------------------------------------ rows
  const who = (id, name) => `<button class="who" data-act="open-viewer" data-id="${esc(id)}" data-tip="Ouvrir la fiche de ${esc(name)}">${esc(name)}</button>`;
  function ttsNow(i) {
    return `<div class="now" style="--c:${MODS.tts.c}">
      <div class="now__row">${av(i.viewer_id, i.viewer_display_name, 'xs')}${who(i.viewer_id, i.viewer_display_name)}
        <button class="txt" data-act="toggle-text" data-tip="${esc(i.message)}" data-tip-wide="1">${pending(i) ? marked(i.message, i.review_hits) : esc(i.message)}</button>
        <span class="meta tnum hide-narrow">${hhmm(i.created_at)}</span><span class="meta tnum" data-left="${i.interaction_id}"></span>
        <button class="btn btn--stop btn--sm" data-act="item-menu" data-id="${i.interaction_id}" data-tip="Arrêter la lecture">${ic('stop')}Stop</button></div>
      <span class="thin"><i data-prog="${i.interaction_id}"></i></span></div>`;
  }
  function queueRow(i, m, withModule) {
    const hits = m === 'tts' && pending(i) ? i.review_hits ?? [] : [];
    const body = m === 'tts' ? `<span class="txt" data-tip="${esc(i.message)}" data-tip-wide="1">${hits.length ? marked(i.message, hits) : esc(i.message)}</span>` : `<span class="txt txt--snd">${esc(i.sound_label ?? i.detail ?? '')}</span>`;
    const words = [...new Set(hits.map((h) => h.word))];
    return `<div class="row${hits.length ? ' row--watch' : ''}" data-act="open-ix" data-id="${i.interaction_id}">
      ${withModule ? `<span class="mini" style="--c:${MODS[m].c}">${ic(m)}</span>` : who(i.viewer_id, i.viewer_display_name)}${body}
      ${hits.length ? `<span class="watchtag" data-tip="Contient : ${esc(words.join(', '))}">À vérifier</span>` : `<span class="meta tnum">${money(i)}</span>`}
      <span class="meta tnum hide-narrow">${hhmm(i.created_at)}</span>
      <button class="icon-btn icon-btn--xs trash" data-act="item-menu" data-id="${i.interaction_id}" data-tip="${m === 'soundboard' ? 'Retirer ce son' : 'Retirer la demande'}" aria-label="Retirer">${ic('trash')}</button></div>`;
  }
  function sndNow(i) {
    return `<div class="row row--now" style="--c:${MODS.soundboard.c}"><span class="txt txt--snd">${esc(i.sound_label)}</span>${who(i.viewer_id, i.viewer_display_name)}
      <span class="meta tnum" data-left="${i.interaction_id}"></span>
      <button class="icon-btn icon-btn--xs stopic" data-act="item-menu" data-id="${i.interaction_id}" data-tip="Arrêter ce son" aria-label="Arrêter ${esc(i.sound_label)}">${ic('stop')}</button>
      <span class="thin"><i data-prog="${i.interaction_id}"></i></span></div>`;
  }
  const itemWhat = (i) => (i.module === 'soundboard' ? MODS.soundboard.short : MODS[i.module]?.short || MODS[i.module]?.label || i.module);
  function hLine(i, vid) {
    const m = i.module;
    return `<button class="h" data-act="open-ix" data-id="${esc(i.interaction_id)}"><span class="h__t tnum">${hhmm(i.created_at)}</span><span class="mini" style="--c:${MODS[m].c}">${ic(m)}</span>
      <span class="h__what">${vid ? MODS[m].label : `<b>${esc(i.viewer_display_name)}</b> · ${itemWhat(i)}`}</span>
      <span class="h__st h__st--${esc(statusKey(i) === 'done' ? 'done' : i.status)}">${statusText(i)}</span>${vid ? `<span class="meta tnum">${money(i)}</span>` : ''}</button>`;
  }
  function aLine(a) {
    const m = MODS[a.module_id] ? a.module_id : null;
    return `<button class="h" data-act="open-audit" data-id="${esc(a.id)}"><span class="h__t tnum">${hhmm(a.created_at)}</span>${m ? `<span class="mini" style="--c:${MODS[m].c}">${ic(m)}</span>` : `<span class="mini">${ic('shield')}</span>`}
      <span class="h__what"><b>${esc(ACTION[a.action] ?? a.action)}</b> · ${esc(actorName(a.actor))}${a.viewer_id ? ` → ${esc(nameOf(a.viewer_id))}` : ''}</span><span class="meta">${esc(ROLE_LABEL[a.role] ?? a.role)}</span></button>`;
  }
  function jLine(e, withViewer) {
    return `<button class="j${e.refunded_by ? ' j--refunded' : ''}" data-act="open-ledger" data-id="${esc(e.id)}" data-v="${esc(e.viewer_id)}">
      <b class="j__amt ${Number(e.amount) > 0 ? 'plus' : 'minus'} tnum">${signed(e)}</b><span class="j__src">${esc(e.label)}${withViewer ? ` <span class="muted">· ${esc(e.viewer_display_name)}</span>` : ''}</span>
      ${e.refunded_by ? '<span class="meta">remboursé</span>' : ''}${e.visible_in_moderation_activity === false ? '<span class="meta">auto</span>' : ''}<span class="meta tnum">${hhmm(e.created_at)}</span></button>`;
  }
  const sec = (t, end) => `<div class="sec"><span>${t}</span>${end || ''}</div>`;
  const statenote = (m) => {
    const st = stateOf(m);
    if (st === 'active') return '';
    const locked = st === 'disabled' && !has('modules');
    return `<div class="statenote statenote--${st}">${st === 'paused' ? `${ic('pause')}En pause${waiting(m).length ? ' · file conservée' : ''}` : 'Désactivé · masqué aux viewers'}
      <button class="btn btn--sm" data-act="${locked ? 'locked' : 'set-state'}" data-perm="modules" data-m="${m}" data-s="active">Réactiver</button></div>`;
  };
  const emoteImg = (i) => {
    const url = String(i.emote_url ?? '');
    const src = /^https:\/\//.test(url) ? url : /^assets\//.test(url) ? `${assetBase}${url}` : '';
    return src ? `<img class="emote__img" src="${esc(src)}" alt="${esc(i.emote_glyph ?? i.emote_id ?? '')}" width="18" height="18">` : esc(i.emote_glyph ?? i.emote_id ?? '—');
  };

  // ------------------------------------------------------------------ views of the right zone
  /**
   * Live actions worth one click, as compact header icons (tooltip on each). Rare or dangerous ones stay
   * in « … ». Without the permission the icon stays, locked, and names the permission (as before).
   */
  /**
   * Every module action as an icon of the header, left of the state button (no « … » menu): tooltip on
   * each; same permissions as before (a locked icon names the missing permission); dangerous ones keep
   * their confirmation.
   */
  function headActs(m) {
    const hb = (act, icon, tip, { ok = true, perm = '', disabled = false, danger = false } = {}) =>
      ok
        ? `<button class="icon-btn icon-btn--sm hact${danger ? ' hact--danger' : ''}${disabled ? ' is-off' : ''}" data-act="${disabled ? '' : act}" data-m="${m}" data-tip="${tip}" aria-label="${tip}" ${disabled ? 'aria-disabled="true"' : ''}>${ic(icon)}</button>`
        : `<button class="icon-btn icon-btn--sm hact is-locked" data-act="locked" data-perm="${perm}" data-tip="${tip} · permission « ${PERMS[perm][0]} »" aria-label="${tip} (verrouillé)">${ic(icon)}<i class="hact__lock">${ic('lock')}</i></button>`;
    const hist = hb('hist-module', 'history', `Historique ${MODS[m].label}`);
    const purge = () => {
      const n = waiting(m).length;
      return hb('purge', 'trash', n ? `Purger toute la file (${n})` : 'Purger toute la file · file vide', { disabled: !n, danger: true });
    };
    let out = '';
    if (m === 'tts') out = hb('words', 'eye', 'Surveillance des mots') + hist + purge();
    else if (m === 'soundboard') {
      const n = playing('soundboard').length;
      out = hb('stop-all', 'stop', n > 1 ? `Stop tous les sons (${n} en cours)` : 'Stop tous les sons · au moins 2 sons en cours', { disabled: n < 2 }) + hist + purge();
    } else if (m === 'raffle') {
      const r = rRound();
      if (r && BEFORE_DRAW.includes(r.status)) {
        const M = { ok: can('raffle.manage'), perm: 'raffle' };
        out += r.status === 'paused' ? hb('raffle-resume', 'play', 'Reprendre la manche', M) : hb('raffle-pause', 'pause', 'Mettre la manche en pause', M);
        out += hb('raffle-extend', 'timeplus', 'Ajouter 30 secondes', M) + hb('raffle-draw', 'crown', 'Tirer maintenant', M);
        if (can('raffle.moderate')) out += hb('raffle-cancel', 'x', 'Annuler la manche', { danger: true });
      }
      out += hist;
    } else out = hist;
    return `<span class="hacts">${out}</span>`;
  }
  function moduleView(m) {
    const st = stateOf(m);
    const headEnd = `${headActs(m)}<button class="statebtn statebtn--${st}" data-act="state-menu" data-m="${m}" data-tip="État : ${STATE[st]} · changer l’état du module" aria-label="État : ${STATE[st]}">${sdot(st)}${STATE[st]}${ic('down')}</button>`;
    let b = statenote(m);
    if (!overview) b += '<div class="empty">Connexion au Core…</div>';
    else if (m === 'tts') {
      const p = playing('tts');
      const q0 = waiting('tts');
      const hits = q0.filter(pending).length;
      b += sec('En cours') + (p.length ? p.map(ttsNow).join('') : '<div class="empty">Rien en lecture</div>');
      b += sec(`En attente · ${q0.length}${hits ? ` <span class="watch">· ${hits} à vérifier</span>` : ''}`);
      b += q0.length ? `<div class="rows">${q0.map((i) => queueRow(i, 'tts')).join('')}</div>` : '<div class="empty">File vide</div>';
    } else if (m === 'soundboard') {
      const p = playing(m);
      const q0 = waiting(m);
      b += sec(`En cours · ${p.length}`) + (p.length ? `<div class="rows">${p.map(sndNow).join('')}</div>` : '<div class="empty">Aucun son</div>');
      b += sec(`En attente · ${q0.length}`) + (q0.length ? `<div class="rows">${q0.map((i) => queueRow(i, 'soundboard')).join('')}</div>` : '<div class="empty">File vide</div>');
    } else if (m === 'bonk') {
      const r = list('bonk', 'recent').slice(0, 9);
      b += `<p class="explain">${ic('bonk')}<span><b>Instantané.</b> Chaque bonk part tout de suite sur le stream : pas de file.</span></p>`;
      b += sec('Derniers bonks') + (r.length ? `<div class="rows">${r.map((i) => `<div class="row row--bonk">${av(i.viewer_id, i.viewer_display_name, 'xs')}${who(i.viewer_id, i.viewer_display_name)}<span class="emote">${emoteImg(i)}</span><span class="grow"></span><span class="meta" data-ago="${esc(i.created_at)}">${ago(i.created_at)}</span></div>`).join('')}</div>` : '<div class="empty">Aucun bonk</div>');
    } else {
      b += raffleBody();
    }
    return { title: `<span class="ttl-ic" style="--c:${MODS[m].c}">${ic(m)}</span>${MODS[m].label}`, headEnd, body: b };
  }

  const balance = (w) =>
    `<div class="vh__bal"><b class="cost tnum">${fmt(w?.tokens)} J</b><span class="vh__cr"><b class="cost cost--credit tnum">${fmt(w?.credits_tts)} cr</b> TTS · <b class="cost cost--credit tnum">${fmt(w?.credits_soundboard)} cr</b> Sons</span></div>`;
  function viewerView(id) {
    const v = cards.get(id);
    const name = v?.display_name ?? nameOf(id);
    if (!v) return { title: `${av(id, name, 'sm')}<span class="ellipsis">${esc(name)}</span>`, body: '<div class="empty">Chargement de la fiche…</div>' };
    const live = liveItems().filter((i) => i.viewer_id === id);
    const ctxM = live[0]?.module ?? 'tts';
    const ls = v.restrictions ?? [];
    const staff = Boolean(v.staff);
    let b = '';
    if (v.notes?.length) b += `<button class="noteline-btn" data-act="notes" data-v="${esc(id)}" data-tip="Notes internes (équipe)">${ic('note')}<span class="muted">Notes · ${v.notes.length}</span><span class="ellipsis">${esc(v.notes[0].text)}</span></button>`;
    if (ls.length)
      b += `<div class="rows">${ls
        .map(
          (l) => `<div class="limit limit--${l.kind}">${ic(l.kind === 'block' ? 'ban' : 'clock')}
        <span class="grow ellipsis">${l.kind === 'block' ? `Bloqué · ${SCOPE[l.module] ?? l.module}` : `Cooldown ${MODS[l.module]?.label ?? l.module} · ${dur(l.delay_s)}`}${l.reason ? ` · ${esc(l.reason)}` : ''}</span>
        ${l.until ? `<span class="timer tnum" data-until="${Date.parse(l.until)}">${mmss(Date.parse(l.until) - Date.now())}</span>` : '<span class="timer">jusqu’au déblocage</span>'}
        <button class="icon-btn icon-btn--xs" data-act="lift" data-v="${esc(id)}" data-kind="${l.kind}" data-m="${esc(l.module)}" data-tip="Retirer la restriction" aria-label="Retirer la restriction">${ic('x')}</button></div>`,
        )
        .join('')}</div>`;
    const rp = v.raffle;
    if (rp) {
      const label = rp.joined ? `Participe à la manche · ${SRC[rp.source] ?? ''}` : rp.removed ? 'Retiré de la manche en cours' : 'Ne participe pas à la manche en cours';
      const btn = rp.joined
        ? can('raffle.moderate') ? `<button class="btn btn--sm" data-act="raffle-remove" data-v="${esc(id)}" data-name="${esc(name)}">${ic('x')}Retirer</button>` : ''
        : can('raffle.manage') ? `<button class="btn btn--sm" data-act="raffle-add" data-v="${esc(id)}" data-name="${esc(name)}">Ajouter</button>` : `<button class="btn btn--sm" data-act="locked" data-perm="raffle">${ic('lock')}Ajouter</button>`;
      b += `<div class="tmbv${rp.joined ? ' is-in' : ''}"><span class="mini" style="--c:${MODS.raffle.c}">${ic('raffle')}</span><span class="grow">${label}</span>${btn}</div>`;
    }
    b += `<div class="vact">
      <button class="btn btn--primary" data-act="block" data-v="${esc(id)}" data-m="${ctxM}" ${staff ? 'disabled data-tip="Membre de l’équipe"' : ''}>${ic('ban')}Bloquer</button>
      <button class="btn" data-act="cooldown" data-v="${esc(id)}" data-m="${ctxM}" ${staff ? 'disabled' : ''}>${ic('clock')}Cooldown</button>
      <button class="btn" data-act="viewer-more" data-v="${esc(id)}" data-tip="Historique, Jetons, notes, wallet">Plus${ic('down')}</button></div>`;
    if (live.length) b += sec('En ce moment') + `<div class="rows">${live.map((i) => queueRow(i, i.module, true)).join('')}</div>`;
    const recent = (v.activity ?? []).filter((a) => !isLive(a)).slice(0, 4);
    const led = (v.wallet_ledger ?? []).filter((e) => e.visible_in_moderation_activity !== false).slice(0, 4);
    b += `<div class="vblocks"><div>${sec('Activité récente', `<button class="linkish" data-act="history" data-v="${esc(id)}">Voir tout</button>`)}
      ${recent.length ? `<div class="rows">${recent.map((a) => hLine(a, id)).join('')}</div>` : '<div class="empty">Rien aujourd’hui</div>'}</div>
      <div>${sec('Activité Jetons', `<button class="linkish" data-act="jetons" data-v="${esc(id)}">Voir tout</button>`)}
      ${led.length ? `<div class="rows">${led.map((e) => jLine(e)).join('')}</div>` : '<div class="empty">Aucun mouvement</div>'}</div></div>`;
    const kick = [ROLE_LABEL[v.role] ?? 'Viewer', ls.length ? `<span class="kwarn">${ls.length} restriction${ls.length > 1 ? 's' : ''}</span>` : ''].filter(Boolean).join(' · ');
    return { title: `${av(id, name, 'sm')}<span class="ellipsis">${esc(name)}</span>`, kicker: kick, headEnd: balance(v.wallet), body: b };
  }

  function jetonsBody(vid) {
    if (!hist) return '<div class="empty">Chargement…</div>';
    const rows = hist.items ?? [];
    const hidden = Number(hist.hidden ?? 0);
    return `<div class="rows hist">${rows.length ? rows.map((e) => jLine(e, !vid)).join('') : '<div class="empty">Aucun mouvement</div>'}</div>
      ${hist.more ? '<button class="linkish autos" data-act="hmore">Plus ancien</button>' : ''}
      ${hidden || nav.auto ? `<button class="linkish autos" data-act="toggle-auto">${nav.auto ? 'Masquer' : 'Afficher'} les mouvements automatiques${hidden ? ` (${hidden})` : ''}</button><p class="fine">Présence, watchtime, récompenses sub, follow et Bits sont masqués par défaut.</p>` : ''}`;
  }
  const jetonsView = (vid) => ({ kicker: 'Activité Jetons', title: esc(nameOf(vid)), body: jetonsBody(vid) });

  function historyRows(vid) {
    if (!hist) return '<div class="empty">Chargement…</div>';
    const rows = hist.items ?? [];
    if (nav.htab === 'audit') return rows.length ? rows.map(aLine).join('') : '<div class="empty">Aucune action pour ces filtres</div>';
    return (rows.length ? rows.map((i) => hLine(i, vid)).join('') : '<div class="empty">Rien pour ces filtres</div>') + (hist.more ? '<button class="linkish autos" data-act="hmore">Plus ancien</button>' : '');
  }
  function historyView(vid) {
    const f = nav.hf;
    const tab = (k, l) => `<button class="${nav.htab === k ? 'is-on' : ''}" data-act="htab" data-val="${k}">${l}</button>`;
    const tabs = `<div class="tabs">${tab('ix', 'Interactions')}${tab('j', 'Jetons')}${tab('audit', 'Modération')}</div>`;
    const title = vid ? esc(nameOf(vid)) : 'Historique';
    if (nav.htab === 'j') return { kicker: vid ? 'Historique' : '', title, body: tabs + jetonsBody(vid) };
    const chip = (k, l) => `<button class="chip${f.module === k ? ' is-on' : ''}" data-act="hfilter" data-k="module" data-val="${k}">${l}</button>`;
    const active = [
      nav.htab === 'ix' && f.status !== 'all' ? ['status', STATUS_F.find((x) => x[0] === f.status)[1]] : null,
      nav.htab === 'ix' && f.period !== 'all' ? ['period', PERIOD_F.find((x) => x[0] === f.period)[1]] : null,
    ].filter(Boolean);
    const body = `${tabs}<div class="hbar"><div class="chips chips--scroll">${chip('all', 'Tout')}${MOD_KEYS.map((m) => chip(m, MODS[m].short || MODS[m].label)).join('')}</div>
        ${nav.htab === 'ix' ? `<button class="icon-btn icon-btn--sm${active.length || f.viewer ? ' is-on' : ''}" data-act="hfilters" data-tip="Statut, période, viewer" aria-label="Filtres">${ic('filter')}</button>` : ''}</div>
      ${nav.vq && !vid && nav.htab === 'ix' ? `<label class="search search--sm">${ic('search')}<input data-hq placeholder="Filtrer par viewer" value="${esc(f.viewer)}"></label>` : ''}
      ${active.length ? `<div class="chips">${active.map(([k, l]) => `<button class="chip is-on" data-act="hfilter" data-k="${k}" data-val="all" data-tip="Retirer ce filtre">${l} ${ic('x')}</button>`).join('')}</div>` : ''}
      <div class="rows hist" data-hist>${historyRows(vid)}</div>`;
    return { kicker: vid ? 'Historique' : '', title, body };
  }

  // ------------------------------------------------------------------ render
  function pane(key, scr, back, closeBtn) {
    const anim = nav.dir === 'fwd' ? 'anim-in' : nav.dir === 'back' ? 'anim-back' : '';
    return `<section class="pane pane--${key}"><header class="pane__head">${back ? `<button class="icon-btn icon-btn--sm" data-act="nav-back" data-tip="Retour" aria-label="Retour">${ic('back')}</button>` : ''}
      <div class="pane__title">${scr.kicker ? `<small>${scr.kicker}</small>` : ''}<strong>${scr.title || ''}</strong></div>${scr.headEnd || ''}
      ${closeBtn ? `<button class="icon-btn icon-btn--sm" data-act="close-viewer" data-tip="Fermer la fiche" aria-label="Fermer">${ic('x')}</button>` : ''}</header>
      <div class="scroll" data-scroll="${key}"><div class="pane__body ${anim}">${scr.body}</div></div></section>`;
  }
  const viewFor = (s) =>
    s.v === 'module' ? moduleView(s.m) : s.v === 'viewer' ? viewerView(s.id) : s.v === 'history' ? historyView(s.vid) : s.v === 'jetons' ? jetonsView(s.vid) : { body: '' };
  const banner = () =>
    gPaused() ? `<div class="gbanner">${ic('pause')}<span class="grow">Pause globale · nouvelles interactions refusées${overview.global.refused ? ` (${overview.global.refused})` : ''}</span><button class="btn btn--sm" data-act="global-resume">Lever</button></div>` : '';
  let builtMode = null;
  function render() {
    if (destroyed) return;
    const md = mode();
    node.dataset.mode = md;
    if (md !== builtMode) {
      if (md === 'compact' && nav.stack[0]?.v !== 'home') nav.stack.unshift({ v: 'home' });
      if (md !== 'compact') {
        nav.stack = nav.stack.filter((s) => s.v !== 'home');
        if (!nav.stack.length) nav.stack = [{ v: 'module', m: 'tts' }];
      }
      closeDrawers(true);
      L.innerHTML =
        md === 'compact'
          ? '<main class="stage" data-stage><div class="stage__body" data-stage-body></div></main>'
          : '<aside class="side" data-side></aside><main class="stage" data-stage><div class="stage__body" data-stage-body></div></main><aside class="vcol" data-vcol hidden><div class="stage__body" data-vcol-body></div></aside>';
      builtMode = md;
    }
    const keep = {};
    L.querySelectorAll('[data-scroll]').forEach((n) => (keep[n.dataset.scroll] = n.scrollTop));
    const openD = [...L.querySelectorAll('details[data-key]')].map((d) => [d.dataset.key, d.open]);
    if (nav.dir) keep.main = 0;
    const t = top();
    if (md !== 'compact') {
      const side = L.querySelector('[data-side]');
      if (!side.firstChild) {
        side.innerHTML = sideHtml();
        bindSearch();
      } else {
        side.querySelector('[data-mods]').innerHTML = MOD_KEYS.map((m) => modLine(m, t.v === 'module' && t.m === m)).join('');
        side.querySelector('[data-histlink]').classList.toggle('is-sel', t.v === 'history' && !t.vid);
        side.querySelector('[data-foot]').innerHTML = footHtml();
      }
    }
    const stage = L.querySelector('[data-stage-body]');
    const typing = document.activeElement?.matches?.('[data-hq]') && node.contains(document.activeElement);
    if (typing && t.v === 'history') {
      // Filtering by viewer: only the rows change (the field keeps focus and caret).
      stage.querySelector('[data-hist]').innerHTML = historyRows(t.vid);
    } else if (md === 'compact' && t.v === 'home') {
      const focused = stage.querySelector('[data-q]') === document.activeElement;
      if (!focused) {
        stage.innerHTML = `${banner()}<section class="pane pane--main"><div class="scroll" data-scroll="main"><div class="side side--home">${sideHtml()}</div></div></section>`;
        bindSearch();
      } else {
        stage.querySelector('[data-mods]').innerHTML = MOD_KEYS.map((m) => modLine(m, false)).join('');
        stage.querySelector('[data-foot]').innerHTML = footHtml();
      }
    } else stage.innerHTML = banner() + pane('main', viewFor(t), nav.stack.length > 1);
    const vcol = L.querySelector('[data-vcol]');
    if (vcol) {
      const show = md === 'window' && nav.viewer;
      vcol.hidden = !show;
      if (show) L.querySelector('[data-vcol-body]').innerHTML = pane('viewer', viewerView(nav.viewer), false, true);
    }
    L.querySelectorAll('[data-scroll]').forEach((n) => {
      if (keep[n.dataset.scroll]) n.scrollTop = keep[n.dataset.scroll];
    });
    openD.forEach(([k, o]) => {
      const d = L.querySelector(`details[data-key="${k}"]`);
      if (d) d.open = o;
    });
    nav.dir = '';
    liveTick();
    for (const d of drawers.slice()) paintDrawer(d);
  }
  /** Items being played: TTS (estimated duration) and sounds (duration), with their real start. */
  const playingNow = () => [
    ...playing('tts').map((i) => ({ id: i.interaction_id, start: i.delivery?.started_at, ms: i.estimated_duration_ms })),
    ...playing('soundboard').map((i) => ({ id: i.interaction_id, start: i.delivery?.started_at, ms: i.duration_ms })),
  ];
  function liveTick() {
    const now = Date.now();
    node.querySelectorAll('[data-until]').forEach((n) => (n.textContent = mmss(Number(n.dataset.until) - now)));
    const live = new Map(playingNow().map((p) => [p.id, p]));
    node.querySelectorAll('[data-prog]').forEach((n) => {
      const p = live.get(n.dataset.prog);
      if (!p?.start || !p.ms) return;
      n.style.width = `${Math.min(100, Math.max(2, ((now - Date.parse(p.start)) / p.ms) * 100))}%`;
    });
    node.querySelectorAll('[data-left]').forEach((n) => {
      const p = live.get(n.dataset.left);
      if (!p) return;
      n.textContent = p.start && p.ms ? mmss(Date.parse(p.start) + p.ms - now).replace(/^0/, '') : '…';
    });
    node.querySelectorAll('[data-ago]').forEach((n) => (n.textContent = ago(n.dataset.ago)));
  }

  // ------------------------------------------------------------------ search (Core)
  let searchSeq = 0;
  async function showSearch(qv) {
    const input = node.querySelector('[data-q]');
    if (!input) return;
    const seq = ++searchSeq;
    let viewers = [];
    try {
      viewers = (await client.modV2(`search?q=${encodeURIComponent(qv.trim())}`)).viewers ?? [];
    } catch {
      /* shown empty */
    }
    if (seq !== searchSeq || destroyed) return;
    let d = node.querySelector('.sdrop');
    if (!d) {
      d = document.createElement('div');
      d.className = 'sdrop';
      node.append(d);
    }
    const r = input.getBoundingClientRect();
    const rr = node.getBoundingClientRect();
    Object.assign(d.style, { top: `${r.bottom - rr.top + 4}px`, left: `${r.left - rr.left}px` });
    d.innerHTML = `<div class="sdrop__label">${qv.trim() ? 'Résultats' : 'Actifs récemment'}</div>${
      viewers.length
        ? viewers
            .slice(0, 6)
            .map((v) => `<button class="srow" data-act="open-viewer" data-id="${esc(v.viewer_id)}">${av(v.viewer_id, v.display_name, 'xs')}<b class="ellipsis">${esc(v.display_name)}</b><span class="grow"></span>${v.restriction ? `<span class="badge badge--warn">${ic(v.restriction === 'block' ? 'ban' : 'clock')}</span>` : ''}${v.role && v.role !== 'viewer' ? `<span class="muted small">${ROLE_LABEL[v.role]}</span>` : ''}</button>`)
            .join('')
        : `<div class="empty">Personne pour « ${esc(qv)} »</div>`
    }`;
  }
  function closeSearch() {
    node.querySelector('.sdrop')?.remove();
    const qi = node.querySelector('[data-q]');
    if (qi) qi.value = '';
  }
  let searchTimer = null;
  function bindSearch() {
    const qi = node.querySelector('[data-q]');
    if (!qi) return;
    qi.addEventListener('focus', () => void showSearch(qi.value));
    qi.addEventListener('input', () => {
      win.clearTimeout(searchTimer);
      searchTimer = win.setTimeout(() => void showSearch(qi.value), 180);
    });
    qi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') node.querySelector('.sdrop [data-act="open-viewer"]')?.click();
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSearch();
        qi.blur();
      }
    });
    qi.addEventListener('blur', () =>
      win.setTimeout(() => {
        if (document.activeElement !== qi) node.querySelector('.sdrop')?.remove();
      }, 180),
    );
  }

  // ------------------------------------------------------------------ overlays (drawer, dialog, menu, toast, tooltip)
  const drawers = [];
  function drawer(renderFn, key, host) {
    const same = key && drawers.find((d) => d.key === key);
    if (same) return paintDrawer(same);
    const h = host || node;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const el = document.createElement('section');
    el.className = 'sheet';
    el.setAttribute('role', 'dialog');
    h.append(scrim, el);
    const entry = { render: renderFn, el, scrim, key, host: h };
    drawers.push(entry);
    paintDrawer(entry);
    scrim.addEventListener('click', () => closeDrawer(entry));
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        scrim.classList.add('is-in');
        el.classList.add('is-in');
      }),
    );
  }
  function paintDrawer(entry) {
    if (!drawers.includes(entry)) return;
    if (!entry.host.isConnected || !node.contains(entry.host)) return closeDrawer(entry, true);
    const r = entry.render();
    if (!r) return closeDrawer(entry);
    const ae = document.activeElement;
    if (ae && entry.el.contains(ae) && ae.matches('input,textarea')) return; // never repaint under the caret
    const body = entry.el.querySelector('.sheet__body');
    const top0 = body ? body.scrollTop : 0;
    const openD = [...entry.el.querySelectorAll('details[data-key]')].map((d) => [d.dataset.key, d.open]);
    entry.el.innerHTML = `<header class="sheet__head"><div class="bar__title">${r.kicker ? `<small>${r.kicker}</small>` : ''}<strong>${r.title}</strong></div>
      ${r.headEnd || ''}<button class="icon-btn" data-act="drawer-close" data-tip="Fermer" aria-label="Fermer">${ic('x')}</button></header><div class="sheet__body">${r.body}</div>`;
    openD.forEach(([k, o]) => {
      const d = entry.el.querySelector(`details[data-key="${k}"]`);
      if (d) d.open = o;
    });
    entry.el.querySelector('.sheet__body').scrollTop = top0;
    liveTick();
  }
  function closeDrawer(entry, now) {
    const k = drawers.indexOf(entry);
    if (k < 0) return;
    drawers.splice(k, 1);
    if (now) {
      entry.el.remove();
      entry.scrim.remove();
      return;
    }
    entry.el.classList.remove('is-in');
    entry.scrim.classList.remove('is-in');
    win.setTimeout(() => {
      entry.el.remove();
      entry.scrim.remove();
    }, 220);
  }
  const closeDrawers = (now) => drawers.slice().reverse().forEach((d) => closeDrawer(d, now));
  // D4: a drawer opens in the panel it comes from (stage or viewer column); from the left column, in the stage.
  const hostOf = (b) => (mode() === 'compact' ? node : b?.closest?.('.stage,.vcol') || node.querySelector('[data-stage]') || node);

  const dialogs = [];
  function dialog(spec) {
    const scrim = document.createElement('div');
    scrim.className = 'scrim scrim--dialog';
    const el = document.createElement('section');
    el.className = 'dialog';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    node.append(scrim, el);
    const d = { ...spec, el, scrim };
    dialogs.push(d);
    paintDialog(d);
    scrim.addEventListener('click', () => closeDialog(d));
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        scrim.classList.add('is-in');
        el.classList.add('is-in');
      }),
    );
  }
  function paintDialog(d) {
    const r = d.render(d.state);
    d.el.innerHTML = `<header class="sheet__head"><div class="bar__title">${r.kicker ? `<small>${r.kicker}</small>` : ''}<strong>${r.title}</strong></div><button class="icon-btn" data-act="dlg-close" aria-label="Fermer">${ic('x')}</button></header>
      ${r.lead ? `<p class="lead">${r.lead}</p>` : ''}<div class="sheet__body">${r.body}</div><footer class="sheet__foot">${r.foot}</footer>`;
  }
  function refreshDialog(d) {
    const r = d.render(d.state);
    const tmp = document.createElement('div');
    tmp.innerHTML = r.body;
    tmp.querySelectorAll('[data-slot]').forEach((n) => {
      const cur = d.el.querySelector(`[data-slot="${n.dataset.slot}"]`);
      if (cur) cur.innerHTML = n.innerHTML;
    });
    d.el.querySelector('.sheet__foot').innerHTML = r.foot;
  }
  function closeDialog(d) {
    const k = dialogs.indexOf(d || dialogs[dialogs.length - 1]);
    if (k < 0) return;
    const x = dialogs.splice(k, 1)[0];
    x.el.classList.remove('is-in');
    x.scrim.classList.remove('is-in');
    // Nothing clickable is left behind a closed dialog.
    x.el.innerHTML = '';
    win.setTimeout(() => {
      x.el.remove();
      x.scrim.remove();
    }, 200);
  }
  const chips = (k, cur, items) => `<div class="chips">${items.map(([v, label]) => `<button class="chip${String(cur) === String(v) ? ' is-on' : ''}" data-act="dlg-set" data-k="${k}" data-val="${v}">${label}</button>`).join('')}</div>`;
  const toSecs = (v, u) => Math.max(1, Math.round(Number(v) || 0)) * (u === 'h' ? 3600 : u === 'min' ? 60 : 1);
  const custom = (s, vk, uk, units) => `<div class="inline"><input class="input" type="number" min="1" data-dlg="${vk}" value="${esc(s[vk])}" aria-label="Valeur">${chips(uk, s[uk], units.map((u) => [u, u]))}</div>`;

  function blockDialog(vid, m) {
    dialog({
      state: { module: MODS[m] ? m : 'tts', d: 300, cv: 10, cu: 'min', reason: '', why: false },
      render(s) {
        const forever = s.d === 'forever';
        const secs = forever ? null : s.d === 'custom' ? toSecs(s.cv, s.cu) : Number(s.d);
        // D4: everything, or more than one hour, is a sensitive sanction (Core decides too).
        const locked = (s.module === 'all' || forever || secs > 3600) && !has('sensitive');
        return {
          kicker: 'Bloquer',
          title: esc(nameOf(vid)),
          lead: 'Empêche ce viewer d’utiliser une ou plusieurs interactions.',
          body: `<div class="field"><span>Sur</span>${chips('module', s.module, [['all', `${has('sensitive') ? '' : ic('lock')}Tout Raptoru`], ...MOD_KEYS.map((k) => [k, MODS[k].short || MODS[k].label])])}</div>
            <div class="field"><span>Durée</span>${chips('d', s.d, [[30, '30 s'], [60, '1 min'], [300, '5 min'], ['forever', `${has('sensitive') ? '' : ic('lock')}Jusqu’au déblocage`], ['custom', 'Autre…']])}${s.d === 'custom' ? custom(s, 'cv', 'cu', ['s', 'min', 'h']) : ''}</div>
            ${s.why ? `<label class="field"><span>Raison</span><input class="input" data-dlg="reason" value="${esc(s.reason)}" maxlength="200" placeholder="Visible par l’équipe seulement"></label>` : '<button class="linkish" data-act="dlg-set" data-k="why" data-val="1">+ Raison (facultatif)</button>'}
            <div data-slot="p"><div class="viewer-sees"><small>Le viewer verra</small><span>${ic('lock')} ${s.module === 'all' ? 'Interactions indisponibles' : `${MODS[s.module].label} indisponible`}${forever ? '' : ` — ${mmss(secs * 1000)}`}</span></div>
            ${locked ? `<p class="lock">${ic('lock')} ${s.module === 'all' ? 'Tout Raptoru' : forever ? 'Jusqu’au déblocage' : 'Plus d’une heure'} : permission « Sanctions sensibles ».</p>` : ''}</div>`,
          foot: `<span class="fine grow">Aucune sanction Twitch.</span><button class="btn btn--ghost" data-act="dlg-close">Annuler</button><button class="btn btn--primary" data-act="dlg-ok" ${locked ? 'disabled' : ''}>Bloquer${forever ? '' : ` ${dur(secs)}`}</button>`,
        };
      },
      ok(s) {
        const forever = s.d === 'forever';
        const secs = forever ? null : s.d === 'custom' ? toSecs(s.cv, s.cu) : Number(s.d);
        void act(
          { action: 'block_viewer', viewer_id: vid, module: s.module, duration_s: secs, reason: String(s.reason ?? '').trim() || undefined },
          `${esc(nameOf(vid))} · ${SCOPE[s.module]} bloqué${forever ? '' : ` ${dur(secs)}`}`,
        );
      },
    });
  }
  function cooldownDialog(vid, m) {
    dialog({
      state: { module: ['tts', 'soundboard', 'bonk'].includes(m) ? m : 'tts', cd: 300, cv: 2, cu: 'min', span: 3600, sv: 3, su: 'h' },
      render(s) {
        const cd = s.cd === 'custom' ? toSecs(s.cv, s.cu) : Number(s.cd);
        const span = s.span === 'custom' ? toSecs(s.sv, s.su) : s.span === 'stream' ? 'stream' : Number(s.span);
        const unit = s.module === 'tts' ? 'deux TTS' : s.module === 'soundboard' ? 'deux sons' : 'deux bonks';
        return {
          kicker: 'Cooldown personnel',
          title: esc(nameOf(vid)),
          lead: 'Augmente temporairement le délai entre ses utilisations.',
          body: `<div class="field"><span>Module</span>${chips('module', s.module, ['tts', 'soundboard', 'bonk'].map((k) => [k, MODS[k].short || MODS[k].label]))}</div>
            <div class="field"><span>Délai imposé</span>${chips('cd', s.cd, [[30, '30 s'], [60, '1 min'], [180, '3 min'], [300, '5 min'], ['custom', 'Autre…']])}${s.cd === 'custom' ? custom(s, 'cv', 'cu', ['s', 'min', 'h']) : ''}</div>
            <div class="field"><span>Pendant</span>${chips('span', s.span, [[900, '15 min'], [3600, '1 h'], [7200, '2 h'], ['stream', 'Ce stream'], ['custom', 'Autre…']])}${s.span === 'custom' ? custom(s, 'sv', 'su', ['min', 'h']) : ''}</div>
            <div data-slot="sum"><p class="summary">Ce viewer devra attendre <b>${dur(cd)}</b> entre ${unit} <b>${span === 'stream' ? 'jusqu’à la fin du stream' : `pendant ${dur(span)}`}</b>.</p></div>`,
          foot: '<button class="btn btn--ghost" data-act="dlg-close">Annuler</button><button class="btn btn--primary" data-act="dlg-ok">Appliquer</button>',
        };
      },
      ok(s) {
        const cd = s.cd === 'custom' ? toSecs(s.cv, s.cu) : Number(s.cd);
        const span = s.span === 'custom' ? Math.max(60, toSecs(s.sv, s.su)) : s.span === 'stream' ? 'stream' : Number(s.span);
        void act({ action: 'set_cooldown', viewer_id: vid, module: s.module, delay_s: cd, span }, `${esc(nameOf(vid))} · cooldown ${MODS[s.module].label} ${dur(cd)}`);
      },
    });
  }
  function choiceDialog(o) {
    dialog({
      state: { pick: o.choices[0] ? o.choices[0].v : '', ok: !o.confirm },
      render(s) {
        return {
          kicker: o.kicker || '',
          title: o.title,
          lead: o.lead,
          body: `${o.choices.length ? `<div class="choices">${o.choices.map((c) => `<button class="choice${s.pick === c.v ? ' is-on' : ''}" data-act="dlg-set" data-k="pick" data-val="${c.v}"><i></i><span><b>${c.label}</b>${c.sub ? `<small>${c.sub}</small>` : ''}</span></button>`).join('')}</div>` : ''}
            ${o.note ? `<p class="fine">${o.note}</p>` : ''}${o.confirm ? `<label class="confirm"><input type="checkbox" data-dlg="ok" ${s.ok ? 'checked' : ''}> ${o.confirm}</label>` : ''}`,
          foot: `<button class="btn btn--ghost" data-act="dlg-close">Annuler</button><button class="btn ${o.danger ? 'btn--danger-solid' : 'btn--primary'}" data-act="dlg-ok" ${s.ok ? '' : 'disabled'}>${o.okLabel}</button>`,
        };
      },
      ok(s) {
        o.run(s.pick);
      },
    });
  }
  const sumCost = (items) => {
    const t = items.filter((i) => i.payment_method !== 'credits').reduce((a, i) => a + Number(i.simulated_cost), 0);
    const c = items.filter((i) => i.payment_method === 'credits').reduce((a, i) => a + Number(i.simulated_cost), 0);
    return [t ? `${fmt(t)} J` : '', c ? `${fmt(c)} cr` : ''].filter(Boolean).join(' + ') || '0 J';
  };
  function stateChange(m, st) {
    const cur = stateOf(m);
    if (cur === st) return;
    if ((st === 'disabled' || cur === 'disabled') && !has('modules')) return acts.locked({ perm: 'modules' });
    const run = (pick) => void act({ action: 'module_state', module: m, state: st, waiting: pick || 'keep' }, `${MODS[m].label} · ${STATE[st]}${pick === 'cancel_refund' ? ' · file remboursée' : ''}`);
    if (st === 'active') return run('keep');
    const q0 = waiting(m);
    if (!q0.length && st === 'paused') return run('keep');
    choiceDialog({
      kicker: MODS[m].label,
      title: st === 'paused' ? 'Mettre en pause' : 'Désactiver',
      lead: q0.length ? `${q0.length} ${q0.length > 1 ? MODS[m].units : MODS[m].unit} en attente.` : 'Le module disparaît pour les viewers.',
      // D4: keep / cancel + refund. « Annuler sans rembourser » is an explicit addition to D4.
      choices: q0.length ? [{ v: 'keep', label: 'Garder la file' }, { v: 'cancel_refund', label: 'Annuler + rembourser', sub: sumCost(q0) }, { v: 'cancel', label: 'Annuler sans rembourser' }] : [],
      okLabel: st === 'paused' ? 'Mettre en pause' : 'Désactiver',
      danger: st === 'disabled',
      run,
    });
  }

  let menuEl = null;
  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
  }
  function menu(anchor, items) {
    closeMenu();
    hideTip();
    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = items
      .filter(Boolean)
      .map((it) => {
        if (it === '-') return '<hr>';
        if (it.header) return `<div class="menu__label">${it.label}</div>`;
        const attrs = Object.entries(it.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
        return `<button role="menuitem" class="${it.danger ? 'is-danger' : ''}${it.on ? ' is-on' : ''}${it.good ? ' is-good' : ''}" ${attrs} ${it.disabled ? 'disabled' : ''}>${it.dot ? `<span class="sdot sdot--${it.dot}"></span>` : ic(it.icon || 'chev')}<span class="grow">${it.label}</span>${it.hint ? `<span class="menu__hint">${it.hint}</span>` : ''}${it.on ? ic('check') : ''}</button>`;
      })
      .join('');
    node.append(m);
    menuEl = m;
    const ar = anchor.getBoundingClientRect();
    const rr = node.getBoundingClientRect();
    const mw = m.offsetWidth;
    const mh = Math.min(m.offsetHeight, rr.height - 16);
    const left = Math.min(Math.max(8, ar.right - rr.left - mw), rr.width - mw - 8);
    let topPx = ar.bottom - rr.top + 4;
    if (topPx + mh > rr.height - 8) topPx = Math.max(8, ar.top - rr.top - mh - 4);
    Object.assign(m.style, { left: `${Math.max(8, left)}px`, top: `${topPx}px`, maxHeight: `${rr.height - 16}px` });
  }
  function itemMenu(anchor, i) {
    if (!i) return;
    const p = isPlaying(i);
    const verb = p ? 'Stop' : 'Retirer';
    menu(anchor, [
      { header: true, label: `${esc(i.viewer_display_name)} · ${money(i)}` },
      pending(i) ? { label: 'Laisser passer', icon: 'check', good: true, data: { act: 'allow', id: i.interaction_id } } : null,
      { label: `${verb} + rembourser`, icon: 'refund', data: { act: 'remove', id: i.interaction_id, refund: '1' } },
      { label: `${verb} sans rembourser`, icon: p ? 'stop' : 'trash', danger: true, data: { act: 'remove', id: i.interaction_id, refund: '0' } },
      '-',
      { label: 'Ouvrir le viewer', icon: 'user', data: { act: 'open-viewer', id: i.viewer_id } },
      p ? null : { label: 'Voir la demande', icon: 'info', data: { act: 'open-ix', id: i.interaction_id } },
    ]);
  }
  function stateMenu(anchor, m) {
    const cur = stateOf(m);
    const locked = (s) => !has('modules') && (s === 'disabled' || cur === 'disabled') && s !== cur;
    menu(anchor, [
      { header: true, label: `État · ${MODS[m].label}` },
      ...['active', 'paused', 'disabled'].map((s) =>
        locked(s) ? { label: STATE[s], icon: 'lock', hint: 'permission', data: { act: 'locked', perm: 'modules' } } : { label: STATE[s], dot: s, on: s === cur, data: { act: 'set-state', m, s } },
      ),
    ]);
  }
  function quickBlockMenu(anchor, vid, m) {
    const mod = MODS[m] ? m : 'tts';
    menu(anchor, [
      { header: true, label: `Bloquer ${esc(nameOf(vid))}` },
      { label: `${MODS[mod].label} · 5 min`, icon: 'ban', data: { act: 'apply-block', v: vid, m: mod, s: 300 } },
      { label: `${MODS[mod].label} · 1 min`, icon: 'ban', data: { act: 'apply-block', v: vid, m: mod, s: 60 } },
      { label: 'Autre…', icon: 'more', data: { act: 'block', v: vid, m: mod } },
    ]);
  }

  // ------------------------------------------------------------------ drawers (content)
  const whatOf = (i) => (i.module === 'soundboard' ? `Son « ${esc(i.sound_label ?? i.detail ?? '')} »` : i.module === 'bonk' ? `Bonk ${esc(i.emote_glyph ?? '')}` : i.module === 'raffle' ? 'Ticket tombola ×1' : 'Message TTS');
  function ixDrawer(id) {
    const i = findItem(id);
    if (!i) return { kicker: 'Demande', title: '…', body: '<div class="empty">Chargement…</div>' };
    const live = isLive(i);
    const hits = pending(i) ? i.review_hits ?? [] : [];
    const words0 = [...new Set(hits.map((h) => h.word))];
    const role = cards.get(i.viewer_id)?.role;
    let b = `<button class="vrow" data-act="open-viewer" data-id="${esc(i.viewer_id)}">${av(i.viewer_id, i.viewer_display_name, 'xs')}<b class="grow">${esc(i.viewer_display_name)}</b>${role && role !== 'viewer' ? `<span class="badge badge--role">${ROLE_LABEL[role]}</span>` : ''}${ic('chev')}</button>`;
    if (hits.length) b += `<div class="watchline">${ic('eye')}<span>À vérifier · contient <b>${esc(words0.join(', '))}</b></span></div>`;
    if (i.review_status === 'allowed' && i.reviewed_by) b += `<p class="fine">Laissée passer par ${esc(actorName(i.reviewed_by))}.</p>`;
    const text = i.message ?? (i.module === 'tts' ? i.detail : null);
    if (text) b += `<blockquote class="itext">${hits.length ? marked(text, hits) : esc(text)}</blockquote>`;
    const error = i.error?.code ?? null;
    if (error && !['cancelled_by_moderator', 'stopped_by_moderator', 'purged_by_moderator'].includes(error))
      b += `<div class="watchline watchline--err">${ic('info')}<span>${esc(i.error?.message ?? error)} · ${i.refund_status === 'refunded' ? 'remboursé automatiquement' : 'non remboursé'}</span></div>`;
    // Who ended it (Core audit), like D4's « Retiré par X, remboursé ».
    const end = (i.actions ?? []).filter((a) => ['cancel', 'stop', 'purge', 'refund'].includes(a.action));
    const endBy = end.find((a) => a.action !== 'refund');
    const note = endBy ? ` · <span class="muted">${esc(ACTION[endBy.action] ?? endBy.action)} par ${esc(actorName(endBy.actor))}, ${i.refund_status === 'refunded' ? 'remboursé' : 'sans remboursement'}</span>` : '';
    b += `<p class="istatus"><b>${esc(statusText(i).replace(/^./, (c) => c.toUpperCase()))}</b> · ${money(i)} · ${hhmm(i.created_at)}${note}</p>`;
    // Refund after the fact: an explicit addition to D4 (« Admin Wallet »), for a debited, finished item.
    const debited = (i.movements ?? []).some((mv) => mv.kind === 'debit' && Number(mv.amount) !== 0);
    const refundable = !live && i.module !== 'raffle' && i.refund_status !== 'refunded' && debited;
    b += `<div class="vact">${hits.length ? `<button class="btn btn--ok" data-act="allow" data-id="${esc(i.interaction_id)}">${ic('check')}Laisser passer</button>` : ''}
      ${live && i.module !== 'raffle' && i.module !== 'bonk' ? `<button class="btn" data-act="item-menu" data-id="${esc(i.interaction_id)}">${ic(isPlaying(i) ? 'stop' : 'trash')}${isPlaying(i) ? 'Stop' : 'Retirer'}${ic('down')}</button>` : ''}
      ${refundable ? `<button class="btn" data-act="${has('wallet') ? 'refund' : 'locked'}" data-perm="wallet" data-id="${esc(i.interaction_id)}" data-m="${i.module}">${ic(has('wallet') ? 'refund' : 'lock')}Rembourser</button>` : ''}
      <button class="btn" data-act="quick-block" data-v="${esc(i.viewer_id)}" data-m="${i.module}">${ic('ban')}Bloquer${ic('down')}</button></div>`;
    b += `<details class="acc" data-key="tech-${esc(id)}"><summary>Détails techniques</summary><div class="acc__body"><dl class="kv"><dt>module</dt><dd>${esc(i.module)}</dd><dt>status</dt><dd>${esc(i.status)}</dd>
      <dt>cost</dt><dd>${esc(i.simulated_cost ?? i.cost)}</dd><dt>currency</dt><dd>${esc(i.payment_method)}</dd><dt>created_at</dt><dd>${esc(i.created_at)}</dd>
      <dt>completed_at</dt><dd>${esc(i.completed_at ?? i.delivery?.completed_at ?? '—')}</dd><dt>error</dt><dd>${esc(error ?? '—')}</dd>${i.stopped_at ? `<dt>stopped_at</dt><dd>${esc(i.stopped_at)}</dd>` : ''}<dt>reference_id</dt><dd>${esc(i.interaction_id)}</dd><dt>viewer_id</dt><dd>${esc(i.viewer_id)}</dd></dl></div></details>`;
    return { kicker: `${MODS[i.module].label} · ${ago(i.created_at)}`, title: whatOf(i), body: b };
  }
  function ledgerDrawer(id) {
    const e = ledgerById.get(String(id));
    if (!e) return { kicker: 'Activité Jetons', title: '…', body: '<div class="empty">Chargement…</div>' };
    const i = e.interaction_id ? findItem(e.interaction_id) : null;
    const refundE = e.refunded_by ? ledgerById.get(String(e.refunded_by)) : null;
    const debitE = e.refund_of ? ledgerById.get(String(e.refund_of)) : null;
    const st = e.refunded_by ? 'Débité puis remboursé' : Number(e.amount) > 0 ? 'Crédité' : 'Débité';
    let b = `<div class="bigamt ${Number(e.amount) > 0 ? 'plus' : 'minus'} tnum">${signed(e)}</div>
      <dl class="facts"><dt>Source</dt><dd>${esc(e.label)}${e.reason && e.kind !== 'refund' ? ` · <span class="muted">${esc(e.reason)}</span>` : ''}</dd><dt>Statut</dt><dd>${st}</dd><dt>Heure</dt><dd>${hhmm(e.created_at)}</dd>
      <dt>Viewer</dt><dd><button class="linkish" data-act="open-viewer" data-id="${esc(e.viewer_id)}">${esc(e.viewer_display_name)}</button></dd>${e.actor && e.actor !== 'system' ? `<dt>Par</dt><dd>${esc(actorName(e.actor))}</dd>` : ''}</dl>`;
    if (e.interaction_id)
      b += `<button class="vrow" data-act="open-ix" data-id="${esc(e.interaction_id)}"><span class="mini" style="--c:${MODS[e.module_id]?.c ?? 'var(--accent)'}">${ic(MODS[e.module_id] ? e.module_id : 'info')}</span><span class="grow">Interaction liée · ${i ? whatOf(i) : esc(MODS[e.module_id]?.label ?? '')}</span>${ic('chev')}</button>`;
    if (e.refunded_by) b += `<button class="vrow" data-act="open-ledger" data-id="${esc(e.refunded_by)}" data-v="${esc(e.viewer_id)}">${ic('refund')}<span class="grow">Remboursé${refundE ? ` · ${signed(refundE)} à ${hhmm(refundE.created_at)}` : ''}</span>${ic('chev')}</button>`;
    if (e.refund_of) b += `<button class="vrow" data-act="open-ledger" data-id="${esc(e.refund_of)}" data-v="${esc(e.viewer_id)}">${ic('coin')}<span class="grow">Débit d’origine${debitE ? ` · ${signed(debitE)} à ${hhmm(debitE.created_at)}` : ''}</span>${ic('chev')}</button>`;
    b += `<details class="acc" data-key="wtech-${esc(id)}"><summary>Détails techniques</summary><div class="acc__body"><dl class="kv"><dt>ledger_id</dt><dd>${esc(e.id)}</dd><dt>operation_type</dt><dd>${esc(e.operation_type)}</dd>
      <dt>visible_in_moderation_activity</dt><dd>${esc(e.visible_in_moderation_activity)}</dd><dt>currency</dt><dd>${esc(e.currency)}</dd><dt>created_at</dt><dd>${esc(e.created_at)}</dd>${e.interaction_id ? `<dt>reference_id</dt><dd>${esc(e.interaction_id)}</dd>` : ''}${e.raffle_id ? `<dt>raffle_id</dt><dd>${esc(e.raffle_id)}</dd>` : ''}</dl></div></details>`;
    return { kicker: 'Activité Jetons', title: esc(e.label), body: b };
  }
  function auditDrawer(id) {
    const a = (hist?.items ?? audit ?? []).find((x) => String(x.id) === String(id));
    if (!a) return null;
    return {
      kicker: `Historique · ${hhmm(a.created_at)}`,
      title: esc(ACTION[a.action] ?? a.action),
      body: `<dl class="facts"><dt>Par</dt><dd>${esc(actorName(a.actor))} (${esc(ROLE_LABEL[a.role] ?? a.role)})</dd><dt>Module</dt><dd>${esc(SCOPE[a.module_id] ?? a.module_id ?? '—')}</dd>
        ${a.viewer_id ? `<dt>Viewer</dt><dd><button class="linkish" data-act="open-viewer" data-id="${esc(a.viewer_id)}">${esc(nameOf(a.viewer_id))}</button></dd>` : ''}${a.reason ? `<dt>Raison</dt><dd>${esc(a.reason)}</dd>` : ''}</dl>
        <details class="acc" open><summary>Avant → après</summary><div class="acc__body"><dl class="kv"><dt>avant</dt><dd>${esc(JSON.stringify(a.before ?? {}))}</dd><dt>après</dt><dd>${esc(JSON.stringify(a.after ?? {}))}</dd>${a.interaction_id ? `<dt>interaction</dt><dd>${esc(a.interaction_id)}</dd>` : ''}</dl></div></details>`,
    };
  }
  function notesBody(vid) {
    const v = cards.get(vid);
    const notes = v?.notes ?? [];
    return `${notes.length ? `<div class="rows">${notes.map((n) => `<div class="note"><span class="muted">${dday(n.created_at)} ${hhmm(n.created_at)} · ${esc(actorName(n.author))}</span> — ${esc(n.text)}</div>`).join('')}</div>` : '<div class="empty">Aucune note</div>'}
      <div class="addline"><input class="input grow" data-note-input="${esc(vid)}" placeholder="Ex. spam TTS, averti" maxlength="140"><button class="btn btn--primary" data-act="note-add" data-v="${esc(vid)}">Ajouter</button></div>
      <p class="fine">Visible par l’équipe uniquement.</p>`;
  }
  function walletBody(vid) {
    const v = cards.get(vid);
    if (!v) return '<div class="empty">Chargement…</div>';
    const adm = (v.wallet_ledger ?? []).filter((e) => ['admin', 'lab_tools'].includes(e.operation_type));
    return `<div class="wal wal--3"><div><small>Jetons</small><b class="cost tnum">${fmt(v.wallet?.tokens)} J</b></div><div><small>Crédits TTS</small><b class="cost cost--credit tnum">${fmt(v.wallet?.credits_tts)} cr</b></div><div><small>Crédits Sons</small><b class="cost cost--credit tnum">${fmt(v.wallet?.credits_soundboard)} cr</b></div></div>
      ${has('wallet') ? `<div class="vact"><button class="btn" data-act="wallet-dialog" data-v="${esc(vid)}" data-sign="1">+ Créditer</button><button class="btn" data-act="wallet-dialog" data-v="${esc(vid)}" data-sign="-1">− Débiter</button></div>` : `<p class="lock">${ic('lock')} Réservé à la permission « Admin Wallet ».</p>`}
      ${adm.length ? sec('Ajustements') + `<div class="rows">${adm.map((e) => jLine(e)).join('')}</div>` : ''}<p class="fine">Wallet de test du Lab · jamais l’économie réelle.</p>`;
  }
  function walletDialog(vid, sign) {
    dialog({
      state: { amount: 500, cur: 'tokens', reason: '' },
      render(s) {
        const v = cards.get(vid);
        const bal = Number(v?.wallet?.[s.cur] ?? 0);
        const next = Math.max(0, bal + sign * (Math.abs(Math.round(Number(s.amount) || 0))));
        return {
          kicker: sign > 0 ? 'Créditer' : 'Débiter',
          title: esc(nameOf(vid)),
          body: `<div class="field"><span>Monnaie</span>${chips('cur', s.cur, [['tokens', 'Jetons'], ['credits_tts', 'Crédits TTS'], ['credits_soundboard', 'Crédits Sons']])}</div>
            <label class="field"><span>Montant</span><input class="input" type="number" min="1" data-dlg="amount" value="${esc(s.amount)}"></label>
            <label class="field"><span>Raison</span><input class="input" data-dlg="reason" value="${esc(s.reason)}" maxlength="200" placeholder="Ex. bug Soundboard"></label>
            <div data-slot="res"><p class="summary">Nouveau solde : <b>${fmt(next)} ${CUR[s.cur]}</b></p></div>`,
          foot: `<button class="btn btn--ghost" data-act="dlg-close">Annuler</button><button class="btn btn--primary" data-act="dlg-ok">${sign > 0 ? 'Créditer' : 'Débiter'}</button>`,
        };
      },
      ok(s) {
        const amount = Math.abs(Math.round(Number(s.amount) || 0));
        if (!amount) return;
        void act(
          { action: 'wallet_adjust', viewer_id: vid, currency: s.cur, delta: sign * amount, reason: String(s.reason ?? '').trim() || undefined },
          `${sign > 0 ? '+' : '−'} ${fmt(amount)} ${CUR[s.cur]} · ${esc(nameOf(vid))}`,
        );
      },
    });
  }
  function detailsBody(vid) {
    const v = cards.get(vid);
    if (!v) return '<div class="empty">Chargement…</div>';
    return `<dl class="kv"><dt>viewer_id</dt><dd>${esc(vid)}</dd><dt>Premier passage</dt><dd>${v.first_seen ? new Date(v.first_seen).toLocaleDateString('fr-FR') : '—'}</dd><dt>Aujourd’hui</dt><dd>${fmt(v.today_count)} interaction${v.today_count > 1 ? 's' : ''}</dd></dl>`;
  }
  function wordsBody() {
    const edit = has('words');
    if (!words) return '<div class="empty">Chargement…</div>';
    return `<p class="fine"><b>Surveillé</b> : la demande est retenue, marquée « À vérifier », jusqu’à « Laisser passer ».<br><b>Bloqué</b> : la demande est refusée avant la file (rien n’est débité).</p>
      <div class="rows">${words.map((w) => `<div class="row row--word"><span class="grow">${esc(w.word)}</span><span class="wtype wtype--${w.kind}">${w.kind === 'watch' ? 'Surveillé' : 'Bloqué'}</span>
        ${edit ? `<button class="icon-btn icon-btn--xs" data-act="word-del" data-id="${esc(w.id)}" data-tip="Supprimer ce mot" aria-label="Supprimer">${ic('trash')}</button>` : ''}</div>`).join('') || '<div class="empty">Aucun mot</div>'}</div>
      ${edit ? `<div class="addline"><input class="input grow" data-word-input placeholder="Mot ou expression" maxlength="40"><div class="seg"><button class="${nav.wtype !== 'block' ? 'is-on' : ''}" data-act="word-type" data-val="watch">Surveillé</button><button class="${nav.wtype === 'block' ? 'is-on' : ''}" data-act="word-type" data-val="block">Bloqué</button></div><button class="btn btn--primary" data-act="word-add">Ajouter</button></div>` : `<p class="lock">${ic('lock')} Modifier demande « Mots surveillés / bloqués ».</p>`}`;
  }
  function teamBody() {
    if (!team) return '<div class="empty">Chargement…</div>';
    const mine = has('perms');
    const meId = myId();
    let h = `<p class="fine">Tu es <b>${ROLE_LABEL[me.role] ?? me.role}</b>${me.role === 'moderator' ? ' : modération standard + permissions accordées.' : ' : toutes les permissions.'}</p>`;
    for (const t of team.members ?? []) {
      if (t.role !== 'moderator') {
        h += `<div class="vrow vrow--static">${av(t.viewer_id, t.display_name, 'xs')}<b class="grow">${esc(t.display_name)}</b><span class="badge badge--role">${ROLE_LABEL[t.role]}</span></div>`;
        continue;
      }
      const on = (t.grants ?? []).length;
      const self = t.viewer_id === meId;
      h += `<details class="acc" data-key="perm-${esc(t.viewer_id)}"><summary><span class="inline">${av(t.viewer_id, t.display_name, 'xs')}${esc(t.display_name)}${self ? ' <span class="muted small">(toi)</span>' : ''}<span class="muted small">${on ? `${on} accordée${on > 1 ? 's' : ''}` : 'standard'}</span></span></summary><div class="acc__body">${Object.keys(PERMS)
        .map((p) => {
          const g = (t.grants ?? []).includes(p);
          // Core rules: never one's own, a moderator grants only what they hold.
          const editable = mine && !self && (me.role !== 'moderator' || has(p));
          return `<div class="perm"><div class="grow"><b>${PERMS[p][0]}</b><span>${PERMS[p][1]}</span></div>
            <button class="sw${g ? ' is-on' : ''}" role="switch" aria-checked="${g}" aria-label="${PERMS[p][0]}" data-act="${editable ? 'toggle-perm' : 'locked'}" data-perm="${self ? 'self' : mine ? p : 'perms'}" data-v="${esc(t.viewer_id)}" data-p="${p}" data-on="${g ? 1 : 0}" ${editable ? '' : 'aria-disabled="true"'}></button></div>`;
        })
        .join('')}</div></details>`;
    }
    if (!mine) h += `<p class="lock">${ic('lock')} Modifier demande « Gérer les permissions ».</p>`;
    return h;
  }

  let tipEl = null;
  let tipT = 0;
  function hideTip() {
    win.clearTimeout(tipT);
    tipEl?.remove();
    tipEl = null;
  }
  node.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !node.contains(t)) return;
    win.clearTimeout(tipT);
    tipT = win.setTimeout(() => {
      if (!t.isConnected || menuEl) return;
      hideTip();
      tipEl = document.createElement('div');
      tipEl.className = `tip${t.dataset.tipWide ? ' tip--wide' : ''}`;
      tipEl.setAttribute('role', 'tooltip');
      tipEl.textContent = t.dataset.tip;
      node.append(tipEl);
      const r = t.getBoundingClientRect();
      const rr = node.getBoundingClientRect();
      const w = tipEl.offsetWidth;
      const h = tipEl.offsetHeight;
      let topPx = r.top - rr.top - h - 6;
      if (topPx < 4) topPx = r.bottom - rr.top + 6;
      Object.assign(tipEl.style, { top: `${topPx}px`, left: `${Math.min(Math.max(4, r.left - rr.left + r.width / 2 - w / 2), rr.width - w - 4)}px` });
    }, t.dataset.tipWide ? 380 : 220);
  });
  node.addEventListener('pointerout', (e) => {
    if (e.target.closest?.('[data-tip]')) hideTip();
  });
  node.addEventListener('pointerdown', hideTip);

  let toastT = 0;
  function toast(html, ok) {
    node.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = `toast${ok === false ? ' toast--err' : ''}`;
    t.setAttribute('role', 'status');
    t.innerHTML = `<span>${html}</span>`;
    node.append(t);
    win.clearTimeout(toastT);
    toastT = win.setTimeout(() => t.remove(), 2800);
  }

  // ------------------------------------------------------------------ actions
  const drawerOf = (key, fn, b, kicker, title) => drawer(() => ({ kicker, title: title(), body: fn() }), key, hostOf(b));
  const acts = {
    'go-module': (d) => open.module(d.m),
    'open-viewer': (d) => open.viewer(d.id),
    'open-ix': (d, b) => {
      void loadDetail(d.id);
      drawer(() => ixDrawer(d.id), `ix:${d.id}`, hostOf(b));
    },
    'open-audit': (d, b) => drawer(() => auditDrawer(d.id), `a:${d.id}`, hostOf(b)),
    'open-ledger': (d, b) => {
      if (!ledgerById.has(String(d.id)) && d.v) void loadViewer(d.v);
      drawer(() => ledgerDrawer(d.id), `w:${d.id}`, hostOf(b));
    },
    team: (d, b) => {
      void loadTeam();
      drawerOf('team', teamBody, b, 'Administration', () => 'Équipe & permissions');
    },
    words: (d, b) => {
      void loadWords();
      drawerOf('words', wordsBody, b, 'TTS', () => 'Surveillance');
    },
    notes: (d, b) => {
      void loadViewer(d.v);
      drawerOf(`notes:${d.v}`, () => notesBody(d.v), b, 'Notes internes', () => esc(nameOf(d.v)));
    },
    wallet: (d, b) => {
      void loadViewer(d.v);
      drawerOf(`wallet:${d.v}`, () => walletBody(d.v), b, 'Wallet admin', () => esc(nameOf(d.v)));
    },
    details: (d, b) => drawerOf(`details:${d.v}`, () => detailsBody(d.v), b, 'Détails', () => esc(nameOf(d.v))),
    hub: () => onBack?.(),
    // Commands V2 « Modération › Commandes » (phase E): its own view, Core decides the rights.
    commands: () => onCommands?.(),
    'global-menu': (d, b) =>
      menu(b, [
        { header: true, label: gPaused() ? 'Pause globale active' : 'Raptoru accepte les interactions' },
        gPaused()
          ? { label: 'Lever la pause globale', icon: has('globalPause') ? 'play' : 'lock', data: { act: 'global-resume' } }
          : { label: 'Pause globale…', icon: has('globalPause') ? 'pause' : 'lock', hint: has('globalPause') ? '' : 'supermod', data: { act: 'global-pause' } },
      ]),
    'global-pause': () =>
      has('globalPause')
        ? choiceDialog({
            kicker: 'Action sensible',
            title: 'Pause globale',
            lead: 'Raptoru refuse les <b>nouvelles</b> interactions (TTS, sons, bonks, tombola).',
            choices: [],
            note: 'Ne coupe pas les sons en cours, ne stoppe pas le TTS, ne purge aucune file, ne rembourse rien.',
            confirm: 'Je confirme pour toute la chaîne',
            okLabel: 'Activer',
            danger: true,
            run: () => void act({ action: 'global_pause', paused: true }, 'Pause globale : nouvelles interactions refusées'),
          })
        : acts.locked({ perm: 'globalPause' }),
    'global-resume': () => (has('globalPause') ? void act({ action: 'global_pause', paused: false }, 'Pause globale levée') : acts.locked({ perm: 'globalPause' })),
    'raffle-extend': () => void act({ action: 'raffle', command: { action: 'extend', seconds: 30 } }, '+30 s'),
    'raffle-pause': () => void act({ action: 'raffle', command: { action: 'pause', reason: 'pause depuis la modération' } }, 'Manche en pause'),
    'raffle-resume': () => void act({ action: 'raffle', command: { action: 'resume' } }, 'Manche reprise'),
    'raffle-draw': () =>
      choiceDialog({
        kicker: rRound()?.titles?.name ?? 'Tombola',
        title: 'Tirer maintenant ?',
        lead: 'Les inscriptions ferment et le tirage démarre tout de suite.',
        choices: [],
        okLabel: 'Tirer maintenant',
        run: () => void act({ action: 'raffle', command: { action: 'draw_now', reason: 'tirage depuis la modération' } }, 'Tirage lancé'),
      }),
    'raffle-cancel': () =>
      choiceDialog({
        kicker: 'Action définitive',
        title: 'Annuler la manche ?',
        lead: 'Personne n’est payé. L’annulation s’affiche sur le stream et dans l’Extension.',
        choices: [],
        confirm: 'Je confirme l’annulation',
        okLabel: 'Annuler la manche',
        danger: true,
        run: () => void act({ action: 'raffle', command: { action: 'cancel', reason: 'annulée depuis la modération' } }, 'Manche annulée'),
      }),
    'raffle-remove': (d) => void act({ action: 'raffle', command: { action: 'remove_participant', viewer_id: d.v, reason: 'retiré par la modération' } }, `${esc(d.name)} retiré de la manche`),
    'raffle-add': (d) => (d.v ? void raffleAdd(d.v, d.name) : raffleAddDialog()),
    'raffle-add-pick': (d) => {
      closeDialog();
      void raffleAdd(d.v, d.name);
    },
    'nav-back': () => pop(),
    'close-viewer': () => {
      closeDrawers();
      nav.viewer = null;
      render();
    },
    history: (d) => open.history(d.v),
    jetons: (d) => open.jetons(d.v),
    htab: (d) => {
      nav.htab = d.val;
      hist = null;
      render();
      void loadHistory();
    },
    hfilter: (d) => {
      nav.hf[d.k] = d.val;
      hist = null;
      render();
      void loadHistory();
    },
    hmore: () => void loadHistory(true),
    'toggle-auto': () => {
      nav.auto = !nav.auto;
      hist = null;
      render();
      void loadHistory();
    },
    hfilters: (d, b) =>
      menu(b, [
        { header: true, label: 'Statut' },
        ...STATUS_F.map(([k, l]) => ({ label: l, on: nav.hf.status === k, icon: 'none', data: { act: 'hfilter', k: 'status', val: k } })),
        { header: true, label: 'Période' },
        ...PERIOD_F.map(([k, l]) => ({ label: l, on: nav.hf.period === k, icon: 'clock', data: { act: 'hfilter', k: 'period', val: k } })),
        top().vid ? null : '-',
        top().vid ? null : { label: 'Filtrer par viewer…', icon: 'user', data: { act: 'hviewer' } },
      ]),
    hviewer: () => {
      nav.vq = true;
      render();
      win.setTimeout(() => node.querySelector('[data-hq]')?.focus(), 30);
    },
    'viewer-more': (d, b) => {
      const v = cards.get(d.v);
      menu(b, [
        { label: 'Historique complet', icon: 'history', data: { act: 'history', v: d.v } },
        { label: 'Activité Jetons', icon: 'coin', data: { act: 'jetons', v: d.v } },
        { label: `Notes · ${v?.notes?.length ?? 0}`, icon: 'note', data: { act: 'notes', v: d.v } },
        { label: 'Wallet admin', icon: has('wallet') ? 'wallet' : 'lock', hint: has('wallet') ? '' : 'permission', data: { act: 'wallet', v: d.v } },
        { label: 'Détails', icon: 'info', data: { act: 'details', v: d.v } },
      ]);
    },
    'toggle-text': (d, b) => b.classList.toggle('is-open'),
    'drawer-close': (d, b) => {
      const e = drawers.find((x) => x.el.contains(b));
      if (e) closeDrawer(e);
    },
    'item-menu': (d, b) => itemMenu(b, findItem(d.id)),
    remove: (d) => {
      const i = findItem(d.id);
      if (!i) return;
      const refund = d.refund === '1';
      const p = isPlaying(i);
      void act(
        p && i.module === 'tts' ? { action: 'stop_current', module: 'tts', refund } : { action: 'cancel', module: i.module, interaction_id: i.interaction_id, refund },
        `${p ? 'Arrêté' : 'Retiré'}${refund ? ' + remboursé' : ' sans remboursement'} · ${esc(i.viewer_display_name)}`,
      );
    },
    allow: (d) => {
      const i = findItem(d.id);
      void act({ action: 'allow', module: 'tts', interaction_id: d.id }, `Demande de ${esc(i?.viewer_display_name ?? '')} laissée passer`);
    },
    refund: (d) => void act({ action: 'refund', module: d.m, interaction_id: d.id }, 'Remboursé'),
    'state-menu': (d, b) => stateMenu(b, d.m),
    'set-state': (d) => stateChange(d.m, d.s),
    'hist-module': (d) => open.history(undefined, d.m),
    purge: (d) => {
      const q0 = waiting(d.m);
      choiceDialog({
        kicker: MODS[d.m].label,
        title: 'Purger toute la file',
        lead: `<b>${q0.length} ${q0.length > 1 ? MODS[d.m].units : MODS[d.m].unit}</b> retiré${d.m === 'tts' ? 'e' : ''}${q0.length > 1 ? 's' : ''} d’un coup · ${sumCost(q0)}.`,
        choices: [{ v: 'refund', label: 'Purger + rembourser' }, { v: 'keep', label: 'Purger sans rembourser' }],
        confirm: `Supprimer les ${q0.length} ${MODS[d.m].units}`,
        okLabel: 'Purger',
        danger: true,
        run: (pick) => void act({ action: 'purge', module: d.m, refund: pick === 'refund' }, `File ${MODS[d.m].label} purgée · ${q0.length} ${q0.length > 1 ? MODS[d.m].units : MODS[d.m].unit}${pick === 'refund' ? ' · remboursement effectué' : ''}`),
      });
    },
    'stop-all': (d) => {
      const p = playing(d.m);
      choiceDialog({
        kicker: MODS[d.m].label,
        title: 'Stop tous les sons',
        lead: `${p.length} sons en cours. La file n’est pas touchée.`,
        choices: [{ v: 'refund', label: 'Stop + rembourser', sub: sumCost(p) }, { v: 'keep', label: 'Stop sans rembourser' }],
        okLabel: 'Stop tout',
        danger: true,
        run: (pick) => void act({ action: 'stop_all', module: 'soundboard', refund: pick === 'refund' }, `${p.length} son${p.length > 1 ? 's' : ''} arrêté${p.length > 1 ? 's' : ''}`),
      });
    },
    block: (d) => blockDialog(d.v, d.m),
    'quick-block': (d, b) => quickBlockMenu(b, d.v, d.m),
    'apply-block': (d) => void act({ action: 'block_viewer', viewer_id: d.v, module: d.m, duration_s: Number(d.s) }, `${esc(nameOf(d.v))} · ${MODS[d.m].label} bloqué ${dur(Number(d.s))}`),
    cooldown: (d) => cooldownDialog(d.v, d.m),
    'wallet-dialog': (d) => (has('wallet') ? walletDialog(d.v, Number(d.sign)) : acts.locked({ perm: 'wallet' })),
    lift: (d) =>
      void act(
        d.kind === 'block' ? { action: 'unblock_viewer', viewer_id: d.v, module: d.m } : { action: 'clear_cooldown', viewer_id: d.v, module: d.m },
        `Restriction retirée · ${esc(nameOf(d.v))}`,
      ),
    'toggle-perm': (d) => {
      const on = d.on === '1';
      void act({ action: 'set_permission', viewer_id: d.v, permission: d.p, granted: !on }, `${PERMS[d.p][0]} ${on ? 'retirée à' : 'accordée à'} ${esc(nameOf(d.v))}`);
    },
    'note-add': (d) => {
      const inp = node.querySelector(`[data-note-input="${d.v}"]`);
      const t = inp && inp.value.trim();
      if (!t) {
        inp?.focus();
        return;
      }
      inp.value = '';
      inp.blur();
      void act({ action: 'add_note', viewer_id: d.v, text: t }, 'Note ajoutée');
    },
    'word-type': (d) => {
      nav.wtype = d.val;
      const e = drawers.find((x) => x.key === 'words');
      if (e) {
        const inp = e.el.querySelector('[data-word-input]');
        const v = inp ? inp.value : '';
        paintDrawer(e);
        const i2 = e.el.querySelector('[data-word-input]');
        if (i2) i2.value = v;
      }
    },
    'word-add': () => {
      const inp = node.querySelector('[data-word-input]');
      const w = inp && inp.value.trim();
      if (!w) {
        inp?.focus();
        return;
      }
      inp.value = '';
      inp.blur();
      const kind = nav.wtype === 'block' ? 'block' : 'watch';
      void act({ action: 'add_word', word: w, kind }, `« ${esc(w)} » ajouté (${kind === 'watch' ? 'surveillé' : 'bloqué'})`);
    },
    'word-del': (d) => {
      const w = words?.find((x) => String(x.id) === String(d.id));
      void act({ action: 'remove_word', word_id: Number(d.id) }, `« ${esc(w?.word ?? '')} » retiré`);
    },
    locked: (d) =>
      toast(d.perm === 'self' ? `${ic('lock')} Tu ne peux pas modifier tes propres permissions.` : `${ic('lock')} Permission « ${PERMS[d.perm]?.[0] ?? 'Gérer les permissions'} » requise`, false),
    'dlg-close': () => closeDialog(),
    'dlg-set': (d) => {
      const dl = dialogs[dialogs.length - 1];
      dl.state[d.k] = /^\d+$/.test(d.val) ? Number(d.val) : d.val;
      paintDialog(dl);
    },
    'dlg-ok': () => {
      const dl = dialogs[dialogs.length - 1];
      const ok = dl.ok;
      const st = { ...dl.state };
      closeDialog(dl);
      ok(st);
    },
  };
  node.addEventListener('click', (e) => {
    // A click changes the view: a tooltip never outlives its button.
    hideTip();
    if (menuEl && !e.target.closest?.('.menu')) closeMenu();
    const b = e.target.closest?.('[data-act]');
    if (!b || b.disabled || !node.contains(b)) return;
    if (menuEl && b.closest('.menu')) closeMenu();
    const fn = acts[b.dataset.act];
    if (fn) {
      e.preventDefault();
      e.stopPropagation();
      fn(b.dataset, b, e);
    }
  });
  let hqTimer = null;
  node.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches?.('[data-hq]')) {
      nav.hf.viewer = t.value;
      win.clearTimeout(hqTimer);
      hqTimer = win.setTimeout(() => void loadHistory(), 200);
      return;
    }
    if (!t.matches?.('[data-dlg]')) return;
    const dl = dialogs[dialogs.length - 1];
    if (!dl) return;
    dl.state[t.dataset.dlg] = t.type === 'checkbox' ? t.checked : t.value;
    refreshDialog(dl);
  });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.target.matches?.('[data-note-input]')) acts['note-add']({ v: e.target.dataset.noteInput });
      if (e.target.matches?.('[data-word-input]')) acts['word-add']();
      return;
    }
    if (e.key !== 'Escape') return;
    hideTip();
    if (menuEl) return closeMenu();
    if (dialogs.length) return closeDialog();
    if (node.querySelector('.sdrop')) return closeSearch();
    if (drawers.length) return closeDrawer(drawers[drawers.length - 1]);
    if (mode() === 'window' && nav.viewer) {
      nav.viewer = null;
      return render();
    }
    pop();
  });
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => {
    if (mode() !== builtMode) render();
  }) : null;
  ro?.observe(node);

  // ------------------------------------------------------------------ polling (Core is the truth)
  let suspended = false;
  async function poll() {
    if (!suspended) {
      await refresh();
      const vid = viewerInView();
      if (vid) await loadViewer(vid);
      if (drawers.some((d) => d.key === 'team')) await loadTeam();
      for (const d of drawers) if (d.key?.startsWith('ix:')) await loadDetail(d.key.slice(3));
    }
    if (!destroyed) pollTimer = win.setTimeout(poll, 2000);
  }

  return {
    node,
    /** First mount: start reading Core. */
    start() {
      if (pollTimer || destroyed) return;
      render();
      void poll();
      tick = win.setInterval(liveTick, 1000);
    },
    /** The host re-appended the node (layout measurable again). */
    attached() {
      if (mode() !== builtMode) render();
    },
    /** Host hidden (Studio tab): stop reading Core until resumed. */
    suspend() {
      suspended = true;
    },
    resume() {
      suspended = false;
      void refresh();
    },
    destroy() {
      destroyed = true;
      win.clearTimeout(pollTimer);
      win.clearInterval(tick);
      ro?.disconnect();
    },
  };
}
