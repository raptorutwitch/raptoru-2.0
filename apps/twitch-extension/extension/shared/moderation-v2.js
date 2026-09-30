// Moderation V2 (D4) — extension console. Port of the validated prototype
// `prototypes/moderation-v2-d4` (left column = context, right zone = one intention; compact stack on
// Panel / Mobile), on the REAL Core: every list comes from Core read models (/moderation/v2/*), every
// action is a Core command executed with the caller's permissions and audited by Core. No simulated
// state, no business rule here, no localStorage. Studio stays the complete cockpit; same Core.

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
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  tts: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  soundboard: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  bonk: '<path d="m13 3 8 8-3 3-8-8z"/><path d="m11.5 8.5-8 8 4 4 8-8"/>',
  all: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  refund: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4M12 7.5v1.5M12 15.5V17"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const MODS = {
  tts: { label: 'TTS', c: 'var(--m-tts)', unit: 'demande', units: 'demandes' },
  soundboard: { label: 'Soundboard', short: 'Sons', c: 'var(--m-soundboard)', unit: 'son', units: 'sons' },
  bonk: { label: 'Bonk', c: 'var(--m-bonk)', unit: 'bonk', units: 'bonks' },
};
const MOD_KEYS = Object.keys(MODS);
const SCOPE = { all: 'Tout Raptoru', ...Object.fromEntries(MOD_KEYS.map((m) => [m, MODS[m].label])) };
const STATE = { active: 'Actif', paused: 'En pause', disabled: 'Désactivé' };
const STATUS = {
  queued: 'en attente',
  starting: 'remis au lecteur',
  playing: 'en lecture',
  executing: 'en cours',
  completed: 'terminé',
  failed: 'échec',
  execution_unknown: 'non confirmé',
  cancelled: 'retiré',
};
const ROLE = { broadcaster: 'Streamer', supermod: 'Supermod', moderator: 'Mod', viewer: 'Viewer' };
const PERM_LABEL = {
  'module.pause': 'Mettre en pause / reprendre un module',
  'module.disable': 'Désactiver un module',
  'queue.stop': 'Arrêter la lecture en cours',
  'queue.cancel': 'Retirer une demande',
  'queue.purge': 'Vider une file',
  refund: 'Rembourser',
  'viewer.block': 'Bloquer / débloquer un viewer',
  'viewer.cooldown': 'Imposer un cooldown',
  'audit.read': 'Lire l’historique',
  'config.tts': 'Configurer le TTS (Studio)',
  'staff.manage': 'Gérer l’équipe (Studio)',
  'wallet.lab': 'Wallet de test (Studio)',
};
const NEEDS = { refund: 'Supermod', 'module.disable': 'Supermod' };
const ACTION = {
  module_paused: 'Mise en pause',
  module_active: 'Reprise',
  module_disabled: 'Désactivation',
  stop: 'Lecture arrêtée',
  cancel: 'Demande retirée',
  purge: 'File vidée',
  refund: 'Remboursement',
  block_viewer: 'Blocage',
  unblock_viewer: 'Déblocage',
  cooldown_replace: 'Cooldown imposé',
  cooldown_add: 'Cooldown prolongé',
  cooldown_clear: 'Cooldown effacé',
  config_update: 'Configuration TTS',
  config_reset: 'Configuration TTS (défaut)',
  lab_wallet_set: 'Wallet de test défini',
  lab_wallet_adjust: 'Wallet de test ajusté',
  lab_wallet_reset: 'Wallet de test réinitialisé',
  set_staff: 'Rôle d’équipe',
};
const ERRORS = {
  forbidden: 'Permission insuffisante pour cette action.',
  already_refunded: 'Déjà remboursé.',
  not_terminal: 'Arrête ou retire d’abord cette demande.',
  not_refundable: 'Rien à rembourser : cette interaction n’a pas été débitée.',
  nothing_playing: 'Aucun TTS en lecture.',
  not_open: 'Cette demande n’est plus dans la file.',
  not_waiting: 'Ce son est déjà remis au lecteur.',
  unsupported: 'Action sans objet pour ce module.',
  network_error: 'Connexion perdue : réessaie.',
};
const actorName = (a) => (/^studio(:|$)/.test(String(a)) ? 'Studio' : String(a ?? ''));
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const dur = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h${Math.round((s % 3600) / 60) ? ` ${Math.round((s % 3600) / 60)}` : ''}`);
const ago = (iso) => {
  const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return d < 60 ? `il y a ${d} s` : d < 3600 ? `il y a ${Math.floor(d / 60)} min` : `il y a ${Math.floor(d / 3600)} h`;
};
const money = (i) => `${fmt(i.simulated_cost ?? i.cost)} ${i.payment_method === 'credits' ? 'cr' : 'J'}`;
const hue = (id) => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const av = (id, name, size) => {
  const h = hue(id);
  const initials = esc(String(name || id).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase());
  return `<span class="avatar${size ? ` avatar--${size}` : ''}" style="--a1:hsl(${h} 70% 58%);--a2:hsl(${(h + 40) % 360} 70% 45%)" aria-hidden="true">${initials}</span>`;
};
const OPEN = ['queued', 'starting', 'playing', 'executing'];

/**
 * @param {{ document: Document, client: object, onChange?: () => void }} options
 * onChange: after a successful command (the host may refresh its own session).
 */
export function createModerationV2View({ document, client, onChange }) {
  const win = document.defaultView;
  const node = document.createElement('div');
  node.className = 'modv2';
  node.innerHTML = '<div class="layout" data-layout></div>';
  const L = node.querySelector('[data-layout]');

  // Core data (read models). Nothing else is kept: no local truth.
  let overview = null;
  let me = { role: 'viewer', permissions: [] };
  const cards = new Map(); // viewer_id → Core viewer card
  let audit = null;
  let destroyed = false;
  let pollTimer = null;
  let tick = null;
  const can = (p) => me.permissions.includes(p);

  // ------------------------------------------------------------------ navigation (prototype D4)
  const mode = () => {
    const w = node.clientWidth || win.innerWidth;
    return w >= 900 ? 'window' : w >= 560 ? 'video' : 'compact';
  };
  const nav = { stack: [], viewer: null, dir: '', hf: 'all', htab: 'actions' };
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
    history(vid) {
      closeDrawers();
      void loadAudit();
      push({ v: 'history', vid });
    },
  };

  // ------------------------------------------------------------------ data from Core
  const list = (m, key) => overview?.[m]?.[key] ?? [];
  const current = () => overview?.tts?.current ?? null;
  const waiting = (m) => list(m, 'waiting');
  const playing = (m) => (m === 'tts' ? (current() ? [current()] : []) : list(m, 'playing'));
  const stateOf = (m) => overview?.[m]?.module_state ?? 'active';
  const allItems = () => [...playing('tts'), ...waiting('tts'), ...list('tts', 'recent'), ...playing('soundboard'), ...waiting('soundboard'), ...list('soundboard', 'recent'), ...list('bonk', 'recent')];
  const findItem = (id) => {
    for (const m of MOD_KEYS)
      for (const key of ['current', 'waiting', 'playing', 'recent']) {
        const v = overview?.[m]?.[key];
        const hit = Array.isArray(v) ? v.find((i) => i.interaction_id === id) : v?.interaction_id === id ? v : null;
        if (hit) return { ...hit, module: m };
      }
    for (const card of cards.values()) {
      const a = card.activity?.find((x) => x.interaction_id === id);
      if (a) return { interaction_id: id, module: a.module, status: a.status, created_at: a.created_at, message: a.detail, simulated_cost: a.cost, payment_method: a.payment_method, refund_status: a.refund_status, refundable: a.refundable, viewer_id: card.viewer_id, viewer_display_name: card.display_name };
    }
    return null;
  };
  const nameOf = (id) => cards.get(id)?.display_name ?? allItems().find((i) => i.viewer_id === id)?.viewer_display_name ?? id;

  async function refresh() {
    try {
      const o = await client.modV2('overview');
      if (destroyed) return;
      overview = o;
      me = o.me ?? me;
      render();
    } catch (e) {
      if (!overview) {
        L.innerHTML = `<div class="empty">${esc(errorText(e))}</div>`;
      }
    }
  }
  async function loadViewer(id) {
    try {
      const card = await client.modV2(`viewers/${id}`);
      if (destroyed) return;
      cards.set(id, card);
      render();
    } catch (e) {
      toast(errorText(e), false);
    }
  }
  async function loadAudit() {
    try {
      const out = await client.modV2('audit?limit=80');
      if (destroyed) return;
      audit = out.audit ?? [];
      render();
    } catch (e) {
      audit = [];
      toast(errorText(e), false);
    }
  }
  const errorText = (e) => {
    const code = e?.code ?? e?.details?.error;
    if (code === 'forbidden' && e?.details?.permission)
      return `${ic('lock')} ${PERM_LABEL[e.details.permission] ?? e.details.permission} : ${NEEDS[e.details.permission] ?? 'permission'} requis.`;
    return ERRORS[code] ?? e?.details?.message ?? code ?? 'Action impossible.';
  };
  /** One Core command; the console then shows Core's new state. */
  async function act(command, done) {
    try {
      await client.modV2Act(command);
      if (done) toast(done, true);
      onChange?.();
    } catch (e) {
      toast(errorText(e), false);
    }
    await refresh();
    const vid = nav.viewer ?? (top().v === 'viewer' ? top().id : null);
    if (vid) await loadViewer(vid);
    if (top().v === 'history') await loadAudit();
  }

  // ------------------------------------------------------------------ left column
  const sdot = (st) => `<span class="sdot sdot--${st}"></span>`;
  function summary(m) {
    const st = stateOf(m);
    const q = waiting(m);
    const p = playing(m);
    let text = 'Calme';
    if (m === 'tts') text = q.length ? `${q.length} en attente` : p.length ? 'Lecture en cours' : 'Calme';
    if (m === 'soundboard') text = [p.length ? `${p.length} en cours` : '', q.length ? `${q.length} en attente` : ''].filter(Boolean).join(' · ') || 'Calme';
    if (m === 'bonk') {
      const b = list('bonk', 'recent')[0];
      text = b ? `Dernier : <span data-ago="${esc(b.created_at)}">${ago(b.created_at)}</span>` : 'Calme';
    }
    if (st !== 'active') text = `<span class="sword sword--${st}">${STATE[st]}</span>${q.length ? ` · ${q.length} en attente` : ''}`;
    return { st, text };
  }
  function modLine(m, sel) {
    const s = summary(m);
    const cur = m === 'tts' ? current() : null;
    return `<button class="mod${sel ? ' is-sel' : ''}" data-act="go-module" data-m="${m}" style="--c:${MODS[m].c}" aria-current="${sel}">
      <span class="mod__top"><span class="mod__ic">${ic(m)}</span><span class="mod__name">${MODS[m].label}</span><span class="grow"></span>${sdot(s.st)}</span>
      <span class="mod__sum">${s.text}</span>${cur?.delivery?.started_at ? `<span class="thin"><i data-prog="${cur.interaction_id}"></i></span>` : ''}</button>`;
  }
  const footHtml = () =>
    `<button class="gpill" data-act="me" data-tip="Mes permissions"><span class="live"></span>${ROLE[me.role] ?? me.role} · Core</button>
     <button class="icon-btn icon-btn--sm" data-act="me" data-tip="Mes permissions" aria-label="Mes permissions">${ic('shield')}</button>`;
  function sideHtml() {
    const t = top();
    const selM = t.v === 'module' ? t.m : null;
    return `<label class="search"><span class="sr">Rechercher un viewer</span>${ic('search')}<input data-q placeholder="Viewer…" autocomplete="off"></label>
      <nav class="mods" data-mods aria-label="Modules">${MOD_KEYS.map((m) => modLine(m, selM === m)).join('')}</nav>
      <button class="sidelink${t.v === 'history' && !t.vid ? ' is-sel' : ''}" data-act="history" data-histlink>${ic('history')}Historique</button>
      <div class="side__foot" data-foot>${footHtml()}</div>`;
  }

  // ------------------------------------------------------------------ rows
  const who = (id, name) => `<button class="who" data-act="open-viewer" data-id="${esc(id)}" data-tip="Ouvrir la fiche de ${esc(name)}">${esc(name)}</button>`;
  function ttsNow(i) {
    return `<div class="now" style="--c:${MODS.tts.c}">
      <div class="now__row">${av(i.viewer_id, i.viewer_display_name, 'xs')}${who(i.viewer_id, i.viewer_display_name)}
        <button class="txt" data-act="toggle-text" data-tip="${esc(i.message)}" data-tip-wide="1">${esc(i.message)}</button>
        <span class="meta tnum hide-narrow">${esc(i.cast?.character_id ?? '')}</span><span class="meta tnum" data-left="${i.interaction_id}"></span>
        <button class="btn btn--stop btn--sm" data-act="item-menu" data-id="${i.interaction_id}" data-tip="Arrêter la lecture">${ic('stop')}Stop</button></div>
      <span class="thin"><i data-prog="${i.interaction_id}"></i></span></div>`;
  }
  function queueRow(i, m, pos, withModule) {
    const body = m === 'tts' ? `<span class="txt" data-tip="${esc(i.message)}" data-tip-wide="1">${esc(i.message)}</span>` : `<span class="txt txt--snd">${esc(i.sound_label ?? i.message ?? '')}</span>`;
    return `<div class="row" data-act="open-ix" data-id="${i.interaction_id}">
      ${withModule ? `<span class="mini" style="--c:${MODS[m].c}">${ic(m)}</span>` : who(i.viewer_id, i.viewer_display_name)}${body}
      <span class="meta tnum">${pos ? `#${pos} · ` : ''}${money(i)}</span><span class="meta tnum hide-narrow">${hhmm(i.created_at)}</span>
      <button class="icon-btn icon-btn--xs trash" data-act="item-menu" data-id="${i.interaction_id}" data-tip="${m === 'soundboard' ? 'Retirer ce son' : 'Retirer la demande'}" aria-label="Retirer">${ic('trash')}</button></div>`;
  }
  function sndNow(i) {
    return `<div class="row row--now" style="--c:${MODS.soundboard.c}"><span class="txt txt--snd">${esc(i.sound_label)}</span>${who(i.viewer_id, i.viewer_display_name)}
      <span class="meta">déjà dans le lecteur</span></div>`;
  }
  const refundBadge = (i) =>
    i.refund_status === 'refunded' ? '<span class="h__st">remboursé</span>' : '';
  function hLine(i, m, vid) {
    return `<button class="h" data-act="open-ix" data-id="${i.interaction_id}"><span class="h__t tnum">${hhmm(i.created_at)}</span><span class="mini" style="--c:${MODS[m].c}">${ic(m)}</span>
      <span class="h__what">${vid ? MODS[m].label : `<b>${esc(i.viewer_display_name)}</b> · ${MODS[m].short || MODS[m].label}`}</span>
      <span class="h__st h__st--${esc(i.status)}">${STATUS[i.status] ?? esc(i.status)}</span>${refundBadge(i)}<span class="meta tnum">${money(i)}</span></button>`;
  }
  function aLine(a) {
    const m = MODS[a.module_id] ? a.module_id : null;
    return `<button class="h" data-act="open-audit" data-id="${esc(a.id)}"><span class="h__t tnum">${hhmm(a.created_at)}</span>${m ? `<span class="mini" style="--c:${MODS[m].c}">${ic(m)}</span>` : `<span class="mini">${ic('shield')}</span>`}
      <span class="h__what"><b>${esc(ACTION[a.action] ?? a.action)}</b> · ${esc(actorName(a.actor))}${a.viewer_id ? ` → ${esc(nameOf(a.viewer_id))}` : ''}</span><span class="meta">${esc(ROLE[a.role] ?? a.role)}</span></button>`;
  }
  const sec = (t, end) => `<div class="sec"><span>${t}</span>${end || ''}</div>`;
  const statenote = (m) => {
    const st = stateOf(m);
    if (st === 'active') return '';
    const q = waiting(m).length;
    return `<div class="statenote statenote--${st}">${st === 'paused' ? `${ic('pause')}En pause${q ? ' · file conservée' : ''} · achats refusés avant paiement` : 'Désactivé · indisponible pour les viewers'}
      <button class="btn btn--sm" data-act="set-state" data-m="${m}" data-s="active">Réactiver</button></div>`;
  };

  // ------------------------------------------------------------------ views
  function moduleView(m) {
    const st = stateOf(m);
    const headEnd = `<button class="statebtn statebtn--${st}" data-act="state-menu" data-m="${m}" data-tip="Changer l’état du module">${sdot(st)}${STATE[st]}${ic('down')}</button>
      ${m !== 'bonk' ? `<button class="icon-btn icon-btn--sm" data-act="module-menu" data-m="${m}" data-tip="Actions ${MODS[m].label}" aria-label="Actions ${MODS[m].label}">${ic('more')}</button>` : ''}`;
    let b = statenote(m);
    if (!overview) b += '<div class="empty">Connexion au Core…</div>';
    else if (m === 'tts') {
      const p = playing('tts');
      const q = waiting('tts');
      b += sec('En cours') + (p.length ? p.map(ttsNow).join('') : '<div class="empty">Rien en lecture</div>');
      b += sec(`En attente · ${q.length}${overview.tts.wait_ms ? ` <span class="muted">≈ ${dur(Math.round(overview.tts.wait_ms / 1000))}</span>` : ''}`);
      b += q.length ? `<div class="rows">${q.map((i, n) => queueRow(i, 'tts', n + 1)).join('')}</div>` : '<div class="empty">File vide</div>';
    } else if (m === 'soundboard') {
      const p = playing(m);
      const q = waiting(m);
      b += sec(`En cours · ${p.length}`) + (p.length ? `<div class="rows">${p.map(sndNow).join('')}</div>` : '<div class="empty">Aucun son</div>');
      b += sec(`En attente · ${q.length}`) + (q.length ? `<div class="rows">${q.map((i, n) => queueRow(i, 'soundboard', n + 1)).join('')}</div>` : '<div class="empty">File vide</div>');
      b += '<p class="fine">Les sons du Lab ne sont pas débités : rien à rembourser.</p>';
    } else {
      const r = list('bonk', 'recent').slice(0, 9);
      b += `<p class="explain">${ic('bonk')}<span><b>Instantané.</b> Chaque bonk part tout de suite sur le stream : pas de file.</span></p>`;
      b += sec('Derniers bonks') + (r.length ? `<div class="rows">${r.map((i) => `<div class="row row--bonk">${av(i.viewer_id, i.viewer_display_name, 'xs')}${who(i.viewer_id, i.viewer_display_name)}<span class="emote">${esc(i.emote?.label ?? i.emote?.id ?? 'Bonk')}</span><span class="grow"></span><span class="meta" data-ago="${esc(i.created_at)}">${ago(i.created_at)}</span></div>`).join('')}</div>` : '<div class="empty">Aucun bonk</div>');
    }
    return { title: `<span class="ttl-ic" style="--c:${MODS[m].c}">${ic(m)}</span>${MODS[m].label}`, headEnd, body: b };
  }

  function viewerView(id) {
    const v = cards.get(id);
    const name = v?.display_name ?? nameOf(id);
    if (!v) return { title: `${av(id, name, 'sm')}<span class="ellipsis">${esc(name)}</span>`, body: '<div class="empty">Chargement de la fiche…</div>' };
    const live = [...playing('tts'), ...waiting('tts')].filter((i) => i.viewer_id === id).map((i) => ({ i, m: 'tts' }))
      .concat(waiting('soundboard').filter((i) => i.viewer_id === id).map((i) => ({ i, m: 'soundboard' })));
    const ctxM = live[0]?.m ?? 'tts';
    const ls = v.restrictions ?? [];
    let b = '';
    if (ls.length)
      b += `<div class="rows">${ls
        .map(
          (l) => `<div class="limit limit--${l.kind}">${ic(l.kind === 'block' ? 'ban' : 'clock')}
        <span class="grow ellipsis">${l.kind === 'block' ? `Bloqué · ${SCOPE[l.module] ?? l.module}` : `Cooldown ${SCOPE[l.module] ?? l.module}`}${l.reason ? ` · ${esc(l.reason)}` : ''}</span>
        ${l.until ? `<span class="timer tnum" data-until="${Date.parse(l.until)}">${mmss(Date.parse(l.until) - Date.now())}</span>` : '<span class="timer">illimité</span>'}
        <button class="icon-btn icon-btn--xs" data-act="lift" data-v="${esc(id)}" data-kind="${l.kind}" data-m="${esc(l.module)}" data-tip="Retirer la restriction" aria-label="Retirer la restriction">${ic('x')}</button></div>`,
        )
        .join('')}</div>`;
    b += `<div class="vact">
      <button class="btn btn--primary" data-act="block" data-v="${esc(id)}" data-m="${ctxM}">${ic('ban')}Bloquer</button>
      <button class="btn" data-act="cooldown" data-v="${esc(id)}" data-m="${ctxM}">${ic('clock')}Cooldown</button>
      <button class="btn" data-act="history" data-v="${esc(id)}">${ic('history')}Historique</button></div>`;
    if (live.length) b += sec('En ce moment') + `<div class="rows">${live.map(({ i, m }) => queueRow(i, m, null, true)).join('')}</div>`;
    const recent = (v.activity ?? []).filter((a) => !OPEN.includes(a.status)).slice(0, 5);
    const led = (v.wallet_ledger ?? []).slice(0, 5);
    b += `<div class="vblocks"><div>${sec('Activité récente')}
      ${recent.length ? `<div class="rows">${recent.map((a) => hLine({ ...a, simulated_cost: a.cost, viewer_display_name: name }, a.module, id)).join('')}</div>` : '<div class="empty">Rien récemment</div>'}</div>
      <div>${sec('Activité Jetons (Lab)')}
      ${led.length ? `<div class="rows">${led.map((e) => `<div class="j${e.kind === 'refund' ? '' : ''}"><b class="j__amt ${Number(e.amount) > 0 ? 'plus' : 'minus'} tnum">${Number(e.amount) > 0 ? '+' : '−'} ${fmt(Math.abs(Number(e.amount)))} ${e.currency === 'tokens' ? 'J' : 'cr'}</b><span class="j__src">${esc({ debit: 'Débit', refund: 'Remboursement', set: 'Wallet de test', adjust: 'Wallet de test', reset: 'Wallet de test' }[e.kind] ?? e.kind)} ${esc(MODS[e.module_id]?.label ?? '')}</span><span class="meta tnum">${hhmm(e.created_at)}</span></div>`).join('')}</div>` : '<div class="empty">Aucun mouvement</div>'}</div></div>`;
    const kick = [v.staff_role ? 'Supermod' : 'Viewer', ls.length ? `<span class="kwarn">${ls.length} restriction${ls.length > 1 ? 's' : ''}</span>` : ''].filter(Boolean).join(' · ');
    return {
      title: `${av(id, name, 'sm')}<span class="ellipsis">${esc(name)}</span>`,
      kicker: kick,
      headEnd: `<div class="vh__bal"><b class="cost tnum">${fmt(v.wallet?.tokens)} J</b><b class="cost cost--credit tnum">${fmt(v.wallet?.credits_tts)} cr</b></div>`,
      body: b,
    };
  }

  function historyView(vid) {
    const tabs = `<div class="tabs"><button class="${nav.htab === 'actions' ? 'is-on' : ''}" data-act="htab" data-val="actions">Actions modération</button><button class="${nav.htab === 'ix' ? 'is-on' : ''}" data-act="htab" data-val="ix">Interactions</button></div>`;
    const chip = (k, l) => `<button class="chip${nav.hf === k ? ' is-on' : ''}" data-act="hfilter" data-val="${k}">${l}</button>`;
    const chips = `<div class="hbar"><div class="chips chips--scroll">${chip('all', 'Tout')}${MOD_KEYS.map((m) => chip(m, MODS[m].short || MODS[m].label)).join('')}</div></div>`;
    let rows;
    if (nav.htab === 'actions') {
      const a = (audit ?? []).filter((x) => (!vid || x.viewer_id === vid) && (nav.hf === 'all' || x.module_id === nav.hf || (x.module_id === 'all' && nav.hf !== 'all')));
      rows = audit === null ? '<div class="empty">Chargement…</div>' : a.length ? a.map(aLine).join('') : '<div class="empty">Aucune action</div>';
    } else {
      const items = MOD_KEYS.filter((m) => nav.hf === 'all' || nav.hf === m)
        .flatMap((m) => [...playing(m), ...waiting(m), ...list(m, 'recent')].map((i) => ({ i, m })))
        .filter(({ i }, k, all) => all.findIndex((x) => x.i.interaction_id === i.interaction_id) === k)
        .filter(({ i }) => !vid || i.viewer_id === vid)
        .sort((a, b) => (a.i.created_at < b.i.created_at ? 1 : -1))
        .slice(0, 60);
      rows = items.length ? items.map(({ i, m }) => hLine(i, m, vid)).join('') : '<div class="empty">Rien pour ce filtre</div>';
    }
    return { kicker: vid ? 'Historique' : '', title: vid ? esc(nameOf(vid)) : 'Historique', body: `${tabs}${chips}<div class="rows hist">${rows}</div>` };
  }

  // ------------------------------------------------------------------ render
  function pane(key, scr, back, closeBtn) {
    const anim = nav.dir === 'fwd' ? 'anim-in' : nav.dir === 'back' ? 'anim-back' : '';
    return `<section class="pane pane--${key}"><header class="pane__head">${back ? `<button class="icon-btn icon-btn--sm" data-act="nav-back" data-tip="Retour" aria-label="Retour">${ic('back')}</button>` : ''}
      <div class="pane__title">${scr.kicker ? `<small>${scr.kicker}</small>` : ''}<strong>${scr.title || ''}</strong></div>${scr.headEnd || ''}
      ${closeBtn ? `<button class="icon-btn icon-btn--sm" data-act="close-viewer" data-tip="Fermer la fiche" aria-label="Fermer">${ic('x')}</button>` : ''}</header>
      <div class="scroll" data-scroll="${key}"><div class="pane__body ${anim}">${scr.body}</div></div></section>`;
  }
  const viewFor = (s) => (s.v === 'module' ? moduleView(s.m) : s.v === 'viewer' ? viewerView(s.id) : s.v === 'history' ? historyView(s.vid) : { body: '' });
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
      L.innerHTML =
        md === 'compact'
          ? '<main class="stage" data-stage><div class="stage__body" data-stage-body></div></main>'
          : '<aside class="side" data-side></aside><main class="stage" data-stage><div class="stage__body" data-stage-body></div></main><aside class="vcol" data-vcol hidden><div class="stage__body" data-vcol-body></div></aside>';
      builtMode = md;
    }
    const keep = {};
    L.querySelectorAll('[data-scroll]').forEach((n) => (keep[n.dataset.scroll] = n.scrollTop));
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
    if (md === 'compact' && t.v === 'home') {
      const focused = stage.querySelector('[data-q]') === document.activeElement;
      if (!focused) {
        stage.innerHTML = `<section class="pane pane--main"><div class="scroll" data-scroll="main"><div class="side side--home">${sideHtml()}</div></div></section>`;
        bindSearch();
      } else {
        stage.querySelector('[data-mods]').innerHTML = MOD_KEYS.map((m) => modLine(m, false)).join('');
        stage.querySelector('[data-foot]').innerHTML = footHtml();
      }
    } else stage.innerHTML = pane('main', viewFor(t), nav.stack.length > 1);
    const vcol = L.querySelector('[data-vcol]');
    if (vcol) {
      const show = md === 'window' && nav.viewer;
      vcol.hidden = !show;
      if (show) L.querySelector('[data-vcol-body]').innerHTML = pane('viewer', viewerView(nav.viewer), false, true);
    }
    L.querySelectorAll('[data-scroll]').forEach((n) => {
      if (keep[n.dataset.scroll]) n.scrollTop = keep[n.dataset.scroll];
    });
    nav.dir = '';
    liveTick();
    for (const d of drawers) paintDrawer(d);
  }
  function liveTick() {
    const now = Date.now();
    node.querySelectorAll('[data-until]').forEach((n) => (n.textContent = mmss(Number(n.dataset.until) - now)));
    const cur = current();
    node.querySelectorAll('[data-prog]').forEach((n) => {
      if (!cur || n.dataset.prog !== cur.interaction_id || !cur.delivery?.started_at) return;
      const pct = ((now - Date.parse(cur.delivery.started_at)) / Math.max(1, cur.estimated_duration_ms)) * 100;
      n.style.width = `${Math.min(100, Math.max(2, pct))}%`;
    });
    node.querySelectorAll('[data-left]').forEach((n) => {
      if (!cur || n.dataset.left !== cur.interaction_id) return;
      n.textContent = cur.delivery?.started_at ? mmss(Date.parse(cur.delivery.started_at) + cur.estimated_duration_ms - now).replace(/^0/, '') : 'démarrage';
    });
    node.querySelectorAll('[data-ago]').forEach((n) => (n.textContent = ago(n.dataset.ago)));
  }

  // ------------------------------------------------------------------ search (Core)
  let searchSeq = 0;
  async function showSearch(q) {
    const input = node.querySelector('[data-q]');
    if (!input) return;
    const seq = ++searchSeq;
    let viewers = [];
    try {
      viewers = (await client.modV2(`search?q=${encodeURIComponent(q.trim())}`)).viewers ?? [];
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
    d.innerHTML = `<div class="sdrop__label">${q.trim() ? 'Résultats' : 'Actifs récemment'}</div>${
      viewers.length
        ? viewers.map((v) => `<button class="srow" data-act="open-viewer" data-id="${esc(v.viewer_id)}">${av(v.viewer_id, v.display_name, 'xs')}<b class="ellipsis">${esc(v.display_name)}</b><span class="grow"></span><span class="muted small">${esc(v.viewer_id)}</span></button>`).join('')
        : `<div class="empty">Personne pour « ${esc(q)} »</div>`
    }`;
  }
  function closeSearch() {
    node.querySelector('.sdrop')?.remove();
    const q = node.querySelector('[data-q]');
    if (q) q.value = '';
  }
  let searchTimer = null;
  function bindSearch() {
    const q = node.querySelector('[data-q]');
    if (!q) return;
    q.addEventListener('focus', () => void showSearch(q.value));
    q.addEventListener('input', () => {
      win.clearTimeout(searchTimer);
      searchTimer = win.setTimeout(() => void showSearch(q.value), 180);
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') node.querySelector('.sdrop [data-act="open-viewer"]')?.click();
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSearch();
        q.blur();
      }
    });
    q.addEventListener('blur', () => win.setTimeout(() => {
      if (document.activeElement !== q) node.querySelector('.sdrop')?.remove();
    }, 180));
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
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
      scrim.classList.add('is-in');
      el.classList.add('is-in');
    }));
  }
  function paintDrawer(entry) {
    if (!drawers.includes(entry)) return;
    if (!entry.host.isConnected || !node.contains(entry.host)) return closeDrawer(entry, true);
    const r = entry.render();
    if (!r) return closeDrawer(entry);
    entry.el.innerHTML = `<header class="sheet__head"><div class="bar__title">${r.kicker ? `<small>${r.kicker}</small>` : ''}<strong>${r.title}</strong></div>
      <button class="icon-btn" data-act="drawer-close" aria-label="Fermer">${ic('x')}</button></header><div class="sheet__body">${r.body}</div>`;
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
  const closeDrawers = () => drawers.slice().reverse().forEach((d) => closeDrawer(d));
  const hostOf = (b) => (mode() === 'compact' ? node : b?.closest?.('.stage,.vcol') || node);

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
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
      scrim.classList.add('is-in');
      el.classList.add('is-in');
    }));
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
  const reasonField = (s) =>
    s.why ? `<label class="field"><span>Raison</span><input class="input" data-dlg="reason" value="${esc(s.reason)}" maxlength="200" placeholder="spam, abus, test…"></label>` : '<button class="linkish" data-act="dlg-set" data-k="why" data-val="1">+ Raison (facultatif)</button>';

  function blockDialog(vid, m) {
    dialog({
      state: { module: MODS[m] ? m : 'tts', d: 300, cv: 10, cu: 'min', reason: '', why: 0 },
      render(s) {
        const forever = s.d === 'forever';
        const secs = forever ? null : s.d === 'custom' ? toSecs(s.cv, s.cu) : Number(s.d);
        return {
          kicker: 'Bloquer',
          title: esc(nameOf(vid)),
          lead: 'Empêche ce viewer d’utiliser une ou plusieurs interactions.',
          body: `<div class="field"><span>Sur</span>${chips('module', s.module, [['all', 'Tout Raptoru'], ...MOD_KEYS.map((k) => [k, MODS[k].short || MODS[k].label])])}</div>
            <div class="field"><span>Durée</span>${chips('d', s.d, [[30, '30 s'], [60, '1 min'], [300, '5 min'], [3600, '1 h'], ['forever', 'Jusqu’au déblocage'], ['custom', 'Autre…']])}${s.d === 'custom' ? custom(s, 'cv', 'cu', ['s', 'min', 'h']) : ''}</div>
            ${reasonField(s)}
            <div data-slot="p"><div class="viewer-sees"><small>Le viewer verra</small><span>${ic('lock')} ${s.module === 'all' ? 'Interactions indisponibles' : `${MODS[s.module].label} indisponible`}${forever ? '' : ` — ${mmss(secs * 1000)}`}</span></div></div>`,
          foot: `<span class="fine grow">Blocage interne Raptoru · aucune sanction Twitch.</span><button class="btn btn--ghost" data-act="dlg-close">Annuler</button><button class="btn btn--primary" data-act="dlg-ok">Bloquer${forever ? '' : ` ${dur(secs)}`}</button>`,
        };
      },
      ok(s) {
        const forever = s.d === 'forever';
        void act(
          { action: 'block_viewer', viewer_id: vid, module: s.module, duration_s: forever ? null : s.d === 'custom' ? toSecs(s.cv, s.cu) : Number(s.d), reason: s.reason?.trim() || undefined },
          `${esc(nameOf(vid))} · ${SCOPE[s.module]} bloqué`,
        );
      },
    });
  }
  function cooldownDialog(vid, m) {
    dialog({
      state: { module: MODS[m] ? m : 'tts', cd: 600, cv: 20, cu: 'min', mode: 'replace', reason: '', why: 0 },
      render(s) {
        const secs = s.cd === 'custom' ? toSecs(s.cv, s.cu) : Number(s.cd);
        return {
          kicker: 'Cooldown',
          title: esc(nameOf(vid)),
          lead: 'Ce viewer ne pourra plus utiliser ce module pendant la durée choisie (décidé par Core).',
          body: `<div class="field"><span>Module</span>${chips('module', s.module, MOD_KEYS.map((k) => [k, MODS[k].short || MODS[k].label]))}</div>
            <div class="field"><span>Durée</span>${chips('cd', s.cd, [[30, '30 s'], [60, '1 min'], [300, '5 min'], [600, '10 min'], ['custom', 'Autre…']])}${s.cd === 'custom' ? custom(s, 'cv', 'cu', ['s', 'min', 'h']) : ''}</div>
            <div class="field"><span>Mode</span>${chips('mode', s.mode, [['replace', 'Remplacer'], ['add', 'Ajouter au cooldown actuel']])}</div>${reasonField(s)}
            <div data-slot="sum"><p class="summary">${s.mode === 'add' ? 'Ajoute' : 'Impose'} <b>${dur(secs)}</b> de cooldown ${MODS[s.module].label}.</p></div>`,
          foot: '<button class="btn btn--ghost" data-act="dlg-close">Annuler</button><button class="btn btn--primary" data-act="dlg-ok">Appliquer</button>',
        };
      },
      ok(s) {
        const secs = s.cd === 'custom' ? toSecs(s.cv, s.cu) : Number(s.cd);
        void act({ action: 'viewer_cooldown', viewer_id: vid, module: s.module, mode: s.mode, seconds: secs, reason: s.reason?.trim() || undefined }, `Cooldown ${MODS[s.module].label} ${dur(secs)} · ${esc(nameOf(vid))}`);
      },
    });
  }
  function choiceDialog(o) {
    dialog({
      state: { pick: o.choices[0]?.v ?? '', ok: !o.confirm },
      render(s) {
        return {
          kicker: o.kicker || '',
          title: o.title,
          lead: o.lead,
          body: `${o.choices.length ? `<div class="choices">${o.choices.map((c) => `<button class="choice${s.pick === c.v ? ' is-on' : ''}" data-act="${c.locked ? 'locked' : 'dlg-set'}" data-perm="refund" data-k="pick" data-val="${c.v}"><i></i><span><b>${c.label}</b>${c.sub ? `<small>${c.sub}</small>` : ''}</span></button>`).join('')}</div>` : ''}
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
    const t = items.filter((i) => i.payment_method !== 'credits').reduce((a, i) => a + i.simulated_cost, 0);
    const c = items.filter((i) => i.payment_method === 'credits').reduce((a, i) => a + i.simulated_cost, 0);
    return [t ? `${fmt(t)} J` : '', c ? `${fmt(c)} cr` : ''].filter(Boolean).join(' + ') || '0 J';
  };
  const refundLock = () => (can('refund') ? {} : { locked: true, sub: `${ic('lock')} Supermod requis` });
  function stateChange(m, st) {
    if (stateOf(m) === st) return;
    if (st === 'active') return void act({ action: 'module_state', module: m, state: 'active', waiting: 'keep' }, `${MODS[m].label} · Actif`);
    if (st === 'disabled' && !can('module.disable')) return toast(`${ic('lock')} Désactiver un module : Supermod requis.`, false);
    const q = waiting(m);
    const run = (pick) => void act({ action: 'module_state', module: m, state: st, waiting: pick || 'keep' }, `${MODS[m].label} · ${STATE[st]}`);
    if (!q.length) return st === 'paused' ? run('keep') : choiceDialog({ kicker: MODS[m].label, title: 'Désactiver', lead: 'Le module devient indisponible pour les viewers.', choices: [], okLabel: 'Désactiver', danger: true, run });
    choiceDialog({
      kicker: MODS[m].label,
      title: st === 'paused' ? 'Mettre en pause' : 'Désactiver',
      lead: `${q.length} ${q.length > 1 ? MODS[m].units : MODS[m].unit} en attente. ${st === 'paused' ? 'Ce qui est en cours finit ; les nouveaux achats sont refusés avant paiement.' : ''}`,
      choices: [
        { v: 'keep', label: 'Garder la file' },
        ...(m === 'tts' ? [{ v: 'cancel_refund', label: 'Annuler la file + rembourser', sub: sumCost(q), ...refundLock() }] : []),
        { v: 'cancel', label: 'Annuler la file sans rembourser' },
      ],
      okLabel: st === 'paused' ? 'Mettre en pause' : 'Désactiver',
      danger: st === 'disabled',
      run,
    });
  }
  function purgeDialog(m) {
    const q = waiting(m);
    choiceDialog({
      kicker: MODS[m].label,
      title: 'Vider la file',
      lead: `<b>${q.length} ${q.length > 1 ? MODS[m].units : MODS[m].unit}</b> en attente · ${sumCost(q)}. Ce qui est en cours n’est pas touché.`,
      choices: m === 'tts' ? [{ v: 'refund', label: 'Vider + rembourser', ...refundLock() }, { v: 'keep', label: 'Vider sans rembourser' }] : [],
      confirm: `Retirer les ${q.length} ${MODS[m].units}`,
      okLabel: 'Vider la file',
      danger: true,
      run: (pick) => void act({ action: 'purge', module: m, refund: m === 'tts' && pick === 'refund' }, `File ${MODS[m].label} vidée`),
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
        return `<button role="menuitem" class="${it.danger ? 'is-danger' : ''}${it.on ? ' is-on' : ''}" ${attrs} ${it.disabled ? 'disabled' : ''}>${it.dot ? `<span class="sdot sdot--${it.dot}"></span>` : ic(it.icon || 'chev')}<span class="grow">${it.label}</span>${it.hint ? `<span class="menu__hint">${it.hint}</span>` : ''}${it.on ? ic('check') : ''}</button>`;
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
    const isPlaying = i.status === 'playing' || i.status === 'starting';
    const verb = isPlaying ? 'Stop' : 'Retirer';
    const lockR = can('refund') ? {} : { icon: 'lock', hint: 'supermod', data: { act: 'locked', perm: 'refund' } };
    menu(anchor, [
      { header: true, label: `${esc(i.viewer_display_name)} · ${money(i)}` },
      i.module === 'tts' ? { label: `${verb} + rembourser`, icon: 'refund', data: { act: 'remove', id: i.interaction_id, refund: '1' }, ...lockR } : null,
      { label: `${verb}${i.module === 'tts' ? ' sans rembourser' : ''}`, icon: isPlaying ? 'stop' : 'trash', danger: true, data: { act: 'remove', id: i.interaction_id, refund: '0' } },
      '-',
      { label: 'Ouvrir le viewer', icon: 'user', data: { act: 'open-viewer', id: i.viewer_id } },
      isPlaying ? null : { label: 'Voir la demande', icon: 'info', data: { act: 'open-ix', id: i.interaction_id } },
    ]);
  }
  function stateMenu(anchor, m) {
    const cur = stateOf(m);
    menu(anchor, [
      { header: true, label: `État · ${MODS[m].label}` },
      ...['active', 'paused', 'disabled'].map((s) =>
        s === 'disabled' && !can('module.disable') && cur !== 'disabled'
          ? { label: STATE[s], icon: 'lock', hint: 'supermod', data: { act: 'locked', perm: 'module.disable' } }
          : { label: STATE[s], dot: s, on: s === cur, data: { act: 'set-state', m, s } },
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
  function ixDrawer(id) {
    const i = findItem(id);
    if (!i) return null;
    const live = OPEN.includes(i.status);
    let b = `<button class="vrow" data-act="open-viewer" data-id="${esc(i.viewer_id)}">${av(i.viewer_id, i.viewer_display_name, 'xs')}<b class="grow">${esc(i.viewer_display_name)}</b>${ic('chev')}</button>`;
    if (i.message) b += `<blockquote class="itext">${esc(i.message)}</blockquote>`;
    if (i.error) b += `<div class="watchline watchline--err">${ic('info')}<span>${esc(i.error.code ?? i.error)}</span></div>`;
    b += `<p class="istatus"><b>${esc((STATUS[i.status] ?? i.status).replace(/^./, (c) => c.toUpperCase()))}</b> · ${money(i)} · ${hhmm(i.created_at)}${i.refund_status === 'refunded' ? ' · <b>remboursé</b>' : ''}</p>`;
    // Core says whether it was debited (`refundable`); a refund only applies to a finished interaction.
    const refundable = i.module === 'tts' && i.refundable !== false && i.refund_status !== 'refunded' && !live;
    b += `<div class="vact">${live ? `<button class="btn" data-act="item-menu" data-id="${i.interaction_id}">${ic(i.status === 'playing' ? 'stop' : 'trash')}${i.status === 'playing' ? 'Stop' : 'Retirer'}${ic('down')}</button>` : ''}
      ${refundable ? `<button class="btn" data-act="${can('refund') ? 'refund' : 'locked'}" data-perm="refund" data-id="${i.interaction_id}" data-m="${i.module}">${ic(can('refund') ? 'refund' : 'lock')}Rembourser</button>` : ''}
      <button class="btn" data-act="quick-block" data-v="${esc(i.viewer_id)}" data-m="${i.module}">${ic('ban')}Bloquer${ic('down')}</button></div>
      ${i.module === 'soundboard' && !live ? '<p class="fine">Sons du Lab non débités : non remboursable.</p>' : ''}`;
    b += `<details class="acc"><summary>Détails techniques</summary><div class="acc__body"><dl class="kv"><dt>module</dt><dd>${i.module}</dd><dt>status</dt><dd>${esc(i.status)}</dd>
      <dt>cost</dt><dd>${esc(i.simulated_cost)}</dd><dt>payment</dt><dd>${esc(i.payment_method)}</dd><dt>refund</dt><dd>${esc(i.refund_status ?? 'none')}</dd><dt>interaction</dt><dd>${esc(i.interaction_id)}</dd><dt>viewer_id</dt><dd>${esc(i.viewer_id)}</dd></dl></div></details>`;
    return { kicker: `${MODS[i.module].label} · ${ago(i.created_at)}`, title: i.module === 'soundboard' ? `Son « ${esc(i.sound_label ?? '')} »` : i.module === 'bonk' ? 'Bonk' : 'Message TTS', body: b };
  }
  function auditDrawer(id) {
    const a = (audit ?? []).find((x) => String(x.id) === String(id));
    if (!a) return null;
    return {
      kicker: `Historique · ${hhmm(a.created_at)}`,
      title: esc(ACTION[a.action] ?? a.action),
      body: `<dl class="facts"><dt>Par</dt><dd>${esc(actorName(a.actor))} (${esc(ROLE[a.role] ?? a.role)})</dd><dt>Module</dt><dd>${esc(SCOPE[a.module_id] ?? a.module_id ?? '—')}</dd>
        ${a.viewer_id ? `<dt>Viewer</dt><dd><button class="linkish" data-act="open-viewer" data-id="${esc(a.viewer_id)}">${esc(nameOf(a.viewer_id))}</button></dd>` : ''}${a.reason ? `<dt>Raison</dt><dd>${esc(a.reason)}</dd>` : ''}</dl>
        <details class="acc" open><summary>Avant → après</summary><div class="acc__body"><dl class="kv"><dt>avant</dt><dd>${esc(JSON.stringify(a.before ?? {}))}</dd><dt>après</dt><dd>${esc(JSON.stringify(a.after ?? {}))}</dd>${a.interaction_id ? `<dt>interaction</dt><dd>${esc(a.interaction_id)}</dd>` : ''}</dl></div></details>`,
    };
  }
  function meDrawer() {
    const all = Object.keys(PERM_LABEL);
    return {
      kicker: 'Équipe',
      title: `Tu es ${ROLE[me.role] ?? me.role}`,
      body: `<div class="rows">${all.map((p) => `<div class="perm"><div class="grow"><b>${esc(PERM_LABEL[p])}</b></div>${can(p) ? `<span class="badge badge--ok">${ic('check')}</span>` : `<span class="lock">${ic('lock')}${NEEDS[p] ?? 'Streamer'}</span>`}</div>`).join('')}</div>
        <p class="fine">Permissions décidées par Core. Un modérateur Twitch ne rembourse pas : le streamer peut le nommer supermod (Studio).</p>`,
    };
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
  const acts = {
    'go-module': (d) => open.module(d.m),
    'open-viewer': (d) => open.viewer(d.id),
    'open-ix': (d, b) => drawer(() => ixDrawer(d.id), `ix:${d.id}`, hostOf(b)),
    'open-audit': (d, b) => drawer(() => auditDrawer(d.id), `a:${d.id}`, hostOf(b)),
    me: (d, b) => drawer(meDrawer, 'me', hostOf(b)),
    'nav-back': () => pop(),
    'close-viewer': () => {
      closeDrawers();
      nav.viewer = null;
      render();
    },
    history: (d) => open.history(d.v),
    htab: (d) => {
      nav.htab = d.val;
      if (d.val === 'actions') void loadAudit();
      render();
    },
    hfilter: (d) => {
      nav.hf = d.val;
      render();
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
      const isPlaying = i.status === 'playing' || i.status === 'starting';
      void act(
        isPlaying && i.module === 'tts' ? { action: 'stop_current', module: 'tts', refund } : { action: 'cancel', module: i.module, interaction_id: i.interaction_id, refund },
        `${isPlaying ? 'Arrêté' : 'Retiré'}${refund ? ' + remboursé' : ''} · ${esc(i.viewer_display_name)}`,
      );
    },
    refund: (d) => void act({ action: 'refund', module: d.m, interaction_id: d.id }, 'Remboursé'),
    'state-menu': (d, b) => stateMenu(b, d.m),
    'set-state': (d) => stateChange(d.m, d.s),
    'module-menu': (d, b) =>
      menu(b, [
        { header: true, label: MODS[d.m].label },
        { label: `Historique ${MODS[d.m].label}`, icon: 'history', data: { act: 'hist-module', m: d.m } },
        '-',
        { label: 'Vider la file…', icon: 'trash', danger: true, disabled: !waiting(d.m).length, data: { act: 'purge', m: d.m } },
      ]),
    'hist-module': (d) => {
      nav.hf = d.m;
      open.history();
    },
    purge: (d) => purgeDialog(d.m),
    block: (d) => blockDialog(d.v, d.m),
    'quick-block': (d, b) => quickBlockMenu(b, d.v, d.m),
    'apply-block': (d) => void act({ action: 'block_viewer', viewer_id: d.v, module: d.m, duration_s: Number(d.s) }, `${esc(nameOf(d.v))} · ${MODS[d.m].label} bloqué ${dur(Number(d.s))}`),
    cooldown: (d) => cooldownDialog(d.v, d.m),
    lift: (d) =>
      void act(
        d.kind === 'block' ? { action: 'unblock_viewer', viewer_id: d.v, module: d.m } : { action: 'viewer_cooldown', viewer_id: d.v, module: d.m, mode: 'clear', seconds: 0 },
        `Restriction retirée · ${esc(nameOf(d.v))}`,
      ),
    locked: (d) => toast(`${ic('lock')} ${PERM_LABEL[d.perm] ?? 'Action'} : ${NEEDS[d.perm] ?? 'permission'} requis.`, false),
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
  node.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.matches?.('[data-dlg]')) return;
    const dl = dialogs[dialogs.length - 1];
    if (!dl) return;
    dl.state[t.dataset.dlg] = t.type === 'checkbox' ? t.checked : t.value;
    refreshDialog(dl);
  });
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    hideTip();
    if (menuEl) return closeMenu();
    if (dialogs.length) return closeDialog();
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
  async function poll() {
    await refresh();
    const vid = nav.viewer ?? (top().v === 'viewer' ? top().id : null);
    if (vid) await loadViewer(vid);
    if (top().v === 'history' && nav.htab === 'actions') await loadAudit();
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
    destroy() {
      destroyed = true;
      win.clearTimeout(pollTimer);
      win.clearInterval(tick);
      ro?.disconnect();
    },
  };
}
