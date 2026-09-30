// « Modération » tab — Moderation V2 (D4) on the real Core: every action goes to the local Lab Core
// (/api/lab/*), which checks permissions, acts on the real queues / transactions / players and
// audits. Nothing is simulated or stored here: the screen only shows Core's state (polled).
// Layout D4: left = search + modules + history + tools; centre = one intention; right = viewer card.

type Json = Record<string, unknown>;
type Interaction = {
  interaction_id: string;
  viewer_id: string;
  viewer_display_name: string;
  status: string;
  created_at: string;
  simulated_cost: number;
  payment_method: string;
  refund_status?: string;
  refundable?: boolean;
  paid?: boolean;
  message?: string;
  sound_label?: string;
  estimated_duration_ms?: number;
  duration_ms?: number;
  cast?: { character_id: string; voice_profile_id: string };
  delivery?: { started_at: string | null };
  emote?: { label?: string };
};
type Overview = {
  tts: {
    module_state: string;
    current: Interaction | null;
    waiting: Interaction[];
    wait_ms: number;
    recent: Interaction[];
    player_offline: boolean;
  };
  soundboard: {
    module_state: string;
    playing: Interaction[];
    waiting: Interaction[];
    recent: Interaction[];
  };
  bonk: { module_state: string; recent: Interaction[] };
  players: {
    tts?: { ready: boolean; preview_url?: string } | null;
    soundboard?: { ready: boolean } | null;
    bonk?: { obs: boolean; source_ready: boolean } | null;
  };
};
type View = 'tts' | 'soundboard' | 'bonk' | 'history' | 'config' | 'wallet';

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const fmt = (n: number) => Number(n).toLocaleString('fr-FR');
const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60
    ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
    : `${s} s`;
};
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const pay = (i: Interaction) =>
  i.payment_method === 'credits'
    ? `${i.simulated_cost} crédit${i.simulated_cost > 1 ? 's' : ''}`
    : `${fmt(i.simulated_cost)} J`;
const STATE: Record<string, [string, string]> = {
  active: ['ok', 'Actif'],
  paused: ['warn', 'En pause'],
  disabled: ['ko', 'Désactivé'],
};
const MODULE_LABEL: Record<string, string> = {
  tts: 'TTS',
  soundboard: 'Soundboard',
  bonk: 'Bonk',
  all: 'Tout Raptoru',
};
const STATUS_LABEL: Record<string, string> = {
  queued: 'en attente',
  starting: 'remis au lecteur',
  playing: 'en lecture',
  executing: 'en cours',
  completed: 'terminé',
  failed: 'échec',
  execution_unknown: 'non confirmé',
  cancelled: 'annulé',
};
const ERRORS: Record<string, string> = {
  forbidden: 'Action non autorisée pour ce rôle.',
  already_refunded: 'Déjà remboursé.',
  not_terminal: 'Arrête ou annule d’abord cette demande.',
  not_refundable:
    'Rien à rembourser : les sons ne sont pas débités dans le Lab.',
  nothing_playing: 'Aucun TTS en lecture.',
  not_open: 'Cette demande n’est plus dans la file.',
  not_waiting: 'Ce son est déjà remis au lecteur.',
  invalid_rules: 'Configuration refusée par Core.',
  lab_core_unavailable: 'Core local indisponible.',
  core_unavailable: 'Core local indisponible.',
};

async function api<T = Json>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/lab${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw Object.assign(new Error(out.error ?? 'error'), { body: out });
  return out;
}

export function mountModeration(root: HTMLElement) {
  root.classList.add('mod-root');
  root.innerHTML = `
    <aside class="mod-left">
      <div class="mod-search"><input data-id="search" placeholder="Viewer…" aria-label="Rechercher un viewer" autocomplete="off"><div class="mod-results" data-id="results" hidden></div></div>
      <nav class="mod-modules" data-id="modules"></nav>
      <button class="mod-nav" type="button" data-view="history">Historique</button>
      <div class="mod-tools">
        <button class="mod-nav" type="button" data-view="config">Configuration TTS</button>
        <button class="mod-nav" type="button" data-view="wallet">Wallet de test <em>Lab</em></button>
      </div>
      <p class="mod-foot">Core local · aucune action simulée · tout est audité</p>
    </aside>
    <section class="mod-center" data-id="center"></section>
    <aside class="mod-right" data-id="right" hidden></aside>
    <div class="mod-dialog" data-id="dialog" hidden></div>
    <div class="mod-toast" data-id="toast" hidden></div>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<T>(`[data-id="${id}"]`)!;

  let view: View = 'tts';
  let viewerId: string | null = null;
  let overview: Overview | null = null;
  let lastCenter = '';
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Views with a form: never repainted by the poll while being edited. */
  const editing = () => view === 'config' || view === 'wallet';

  const toast = (text: string, bad = false) => {
    const t = $('toast');
    t.textContent = text;
    t.className = `mod-toast${bad ? ' is-bad' : ''}`;
    t.hidden = false;
    clearTimeout((t as unknown as { _t?: ReturnType<typeof setTimeout> })._t);
    (t as unknown as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(
      () => (t.hidden = true),
      3500,
    );
  };
  const errorText = (e: unknown) => {
    const b = (
      e as { body?: { error?: string; message?: string; errors?: string[] } }
    ).body;
    if (b?.errors?.length) return b.errors.join(' ');
    return (
      ERRORS[b?.error ?? ''] ?? b?.message ?? b?.error ?? (e as Error).message
    );
  };
  /** One Core command; the screen then shows Core's new state. */
  const act = async (command: Json, done?: string) => {
    try {
      await api('/actions', { command });
      if (done) toast(done);
    } catch (e) {
      toast(errorText(e), true);
    }
    await refresh(true);
    if (viewerId) void openViewer(viewerId);
  };

  // --- left column --------------------------------------------------------------------------------------
  function renderModules() {
    const o = overview;
    const row = (id: View, label: string, state: string, sub: string) => {
      const [cls, txt] = STATE[state] ?? ['', state];
      return `<button class="mod-module${view === id ? ' is-on' : ''}" type="button" data-view="${id}"><b>${label}</b><span class="mod-dot ${cls}" title="${txt}"></span><small>${esc(sub)}</small></button>`;
    };
    if (!o) {
      $('modules').innerHTML = '<p class="muted">Core local…</p>';
      return;
    }
    const tts = o.tts;
    const ttsSub =
      tts.module_state === 'active'
        ? `${tts.current ? 'Lecture en cours · ' : ''}${tts.waiting.length} en attente`
        : `${STATE[tts.module_state]?.[1]} · ${tts.waiting.length} en attente`;
    const sb = o.soundboard;
    const sbSub = `${sb.module_state === 'active' ? '' : `${STATE[sb.module_state]?.[1]} · `}${sb.playing.length} en cours · ${sb.waiting.length} en attente`;
    $('modules').innerHTML =
      row('tts', 'TTS', tts.module_state, ttsSub) +
      row('soundboard', 'Soundboard', sb.module_state, sbSub) +
      row(
        'bonk',
        'Bonk',
        o.bonk.module_state,
        STATE[o.bonk.module_state]?.[1] ?? '',
      );
    for (const b of root.querySelectorAll<HTMLElement>('.mod-nav'))
      b.classList.toggle('is-on', b.dataset.view === view);
  }

  // --- centre -----------------------------------------------------------------------------------------------
  const stateMenu = (module: string, state: string) => `<div class="mod-state">
      <span class="badge ${STATE[state]?.[0] ?? ''}">${STATE[state]?.[1] ?? state}</span>
      ${state !== 'active' ? `<button type="button" data-cmd="resume" data-module="${module}">Reprendre</button>` : ''}
      ${state === 'active' ? `<button type="button" data-dialog="pause" data-module="${module}">Mettre en pause</button>` : ''}
      ${state !== 'disabled' ? `<button type="button" class="ghost" data-dialog="disable" data-module="${module}">Désactiver</button>` : ''}
    </div>`;
  const viewerLink = (i: Interaction) =>
    `<button type="button" class="mod-link" data-viewer="${esc(i.viewer_id)}">${esc(i.viewer_display_name)}</button>`;
  const ttsRow = (i: Interaction, pos: number | null) => `<div class="mod-row">
      <span class="mod-pos">${pos ?? '▶'}</span>${viewerLink(i)}
      <span class="mod-msg" title="${esc(i.message)}">${esc(i.message)}</span>
      <span class="mod-meta">${esc(i.cast?.character_id ?? '')} · ${esc(i.cast?.voice_profile_id?.split('.')[1] ?? '')} · ≈ ${secs(i.estimated_duration_ms ?? 0)}</span>
      <span class="mod-pay">${pay(i)}</span>
      <span class="mod-actions">
        <button type="button" data-cmd="cancel" data-module="tts" data-id="${i.interaction_id}" data-refund="1" title="Retirer et rembourser ${esc(pay(i))}">Retirer + rembourser</button>
        <button type="button" class="ghost" data-cmd="cancel" data-module="tts" data-id="${i.interaction_id}" data-refund="0">Retirer</button>
      </span></div>`;
  const historyRow = (i: Interaction, module: string) => {
    const refund =
      i.refund_status === 'refunded'
        ? '<span class="badge ok">remboursé</span>'
        : i.refundable && (module !== 'tts' || i.paid !== false)
          ? `<button type="button" data-cmd="refund" data-module="${module}" data-id="${i.interaction_id}">Rembourser</button>`
          : module === 'tts'
            ? '<span class="muted">non remboursable</span>'
            : '';
    return `<div class="mod-row is-past"><span class="mod-pos">${hhmm(i.created_at)}</span>${viewerLink(i)}
      <span class="mod-msg">${esc(i.message ?? i.sound_label ?? i.emote?.label ?? '')}</span>
      <span class="mod-meta">${STATUS_LABEL[i.status] ?? i.status}</span><span class="mod-pay">${pay(i)}</span><span class="mod-actions">${refund}</span></div>`;
  };

  function centerHtml(): string {
    const o = overview;
    if (!o && !editing() && view !== 'history')
      return '<p class="muted">Connexion au Core local…</p>';
    if (view === 'tts' && o) {
      const t = o.tts;
      const player = o.players.tts;
      return `<header class="mod-head"><h2>TTS</h2>${stateMenu('tts', t.module_state)}
          <button type="button" class="ghost" data-dialog="purge" data-module="tts" ${t.waiting.length ? '' : 'disabled'}>Vider la file…</button></header>
        <p class="mod-rule">Pause : la file est gardée, les nouveaux achats sont refusés avant paiement, le TTS en cours finit sa lecture. Lecteur : ${
          player?.ready
            ? '<b class="okc">prêt</b>'
            : '<b class="koc">absent</b> (source OBS ou aperçu Studio)'
        }</p>
        <h3>En cours</h3>
        ${
          t.current
            ? `<div class="mod-row is-current"><span class="mod-pos">▶</span>${viewerLink(t.current)}<span class="mod-msg" title="${esc(t.current.message)}">${esc(t.current.message)}</span>
              <span class="mod-meta">${esc(t.current.cast?.character_id ?? '')} · ${STATUS_LABEL[t.current.status]}</span><span class="mod-pay">${pay(t.current)}</span>
              <span class="mod-actions"><button type="button" class="danger" data-cmd="stop" data-refund="0">Stop</button><button type="button" data-cmd="stop" data-refund="1">Stop + rembourser</button></span></div>`
            : '<p class="muted">Aucun TTS en lecture.</p>'
        }
        <h3>En attente · ${t.waiting.length} <span class="muted">≈ ${secs(t.wait_ms)}</span></h3>
        ${t.waiting.map((i, n) => ttsRow(i, n + 1)).join('') || '<p class="muted">File vide.</p>'}
        <details class="mod-past"><summary>Transactions récentes</summary>${t.recent
          .filter((i) => !['queued', 'starting', 'playing'].includes(i.status))
          .map((i) => historyRow(i, 'tts'))
          .join('')}</details>`;
    }
    if (view === 'soundboard' && o) {
      const s = o.soundboard;
      return `<header class="mod-head"><h2>Soundboard</h2>${stateMenu('soundboard', s.module_state)}
          <button type="button" class="ghost" data-dialog="purge" data-module="soundboard" ${s.waiting.length ? '' : 'disabled'}>Vider la file…</button></header>
        <p class="mod-rule">Pause : les sons en attente restent en file, rien de nouveau n’est joué, les sons en cours finissent. Les sons du Lab ne sont pas débités : rien à rembourser. Lecteur : ${
          o.players.soundboard?.ready
            ? '<b class="okc">prêt</b>'
            : '<b class="koc">absent</b>'
        }</p>
        <h3>En cours · ${s.playing.length}</h3>
        ${s.playing.map((i) => `<div class="mod-row is-current"><span class="mod-pos">▶</span>${viewerLink(i)}<span class="mod-msg">${esc(i.sound_label)}</span><span class="mod-meta">${STATUS_LABEL[i.status]}</span><span class="mod-pay">${pay(i)}</span><span class="mod-actions muted">déjà dans le lecteur</span></div>`).join('') || '<p class="muted">Aucun son en cours.</p>'}
        <h3>En attente · ${s.waiting.length}</h3>
        ${s.waiting.map((i, n) => `<div class="mod-row"><span class="mod-pos">${n + 1}</span>${viewerLink(i)}<span class="mod-msg">${esc(i.sound_label)}</span><span class="mod-meta">${esc(i.sound_label)}</span><span class="mod-pay">${pay(i)}</span><span class="mod-actions"><button type="button" data-cmd="cancel" data-module="soundboard" data-id="${i.interaction_id}" data-refund="0">Retirer</button></span></div>`).join('') || '<p class="muted">File vide.</p>'}
        <details class="mod-past"><summary>Sons récents</summary>${s.recent.map((i) => historyRow(i, 'soundboard')).join('')}</details>`;
    }
    if (view === 'bonk' && o) {
      const b = o.bonk;
      const obs = o.players.bonk;
      return `<header class="mod-head"><h2>Bonk</h2>${stateMenu('bonk', b.module_state)}</header>
        <p class="mod-rule">Un Bonk est un impact court sans file à gérer : pause / désactivation, blocage et cooldown par viewer. OBS : ${
          obs?.obs
            ? obs.source_ready
              ? '<b class="okc">connecté, source active</b>'
              : '<b class="koc">connecté, source inactive</b>'
            : '<b class="koc">non connecté</b>'
        }</p>
        <details class="mod-past" open><summary>Bonks récents</summary>${b.recent.map((i) => historyRow(i, 'bonk')).join('') || '<p class="muted">Aucun.</p>'}</details>`;
    }
    return '';
  }

  function renderCenter(force = false) {
    if (editing() && !force) return;
    if (view === 'history') {
      if (force) void renderHistory();
      return;
    }
    if (view === 'config') return void renderConfig();
    if (view === 'wallet') return void renderWallet();
    const html = centerHtml();
    if (html === lastCenter && !force) return;
    lastCenter = html;
    $('center').innerHTML = html;
  }

  // --- history (audit) ---------------------------------------------------------------------------------------
  async function renderHistory() {
    const center = $('center');
    try {
      const { audit } = await api<{ audit: Json[] }>('/audit?limit=100');
      center.innerHTML = `<header class="mod-head"><h2>Historique</h2><span class="muted">Toutes les actions sensibles, enregistrées par Core</span></header>
        <table class="mod-table"><thead><tr><th>Heure</th><th>Acteur</th><th>Rôle</th><th>Module</th><th>Action</th><th>Viewer</th><th>Raison</th><th>Avant → après</th></tr></thead><tbody>
        ${audit
          .map(
            (
              a,
            ) => `<tr><td>${esc(new Date(String(a.created_at)).toLocaleTimeString('fr-FR'))}</td><td>${esc(a.actor)}</td><td>${esc(a.role)}</td><td>${esc(MODULE_LABEL[String(a.module_id)] ?? a.module_id ?? '—')}</td>
              <td><b>${esc(a.action)}</b>${a.interaction_id ? `<br><small class="muted">${esc(String(a.interaction_id).slice(0, 8))}</small>` : ''}</td>
              <td>${a.viewer_id ? `<button type="button" class="mod-link" data-viewer="${esc(a.viewer_id)}">${esc(a.viewer_id)}</button>` : '—'}</td><td>${esc(a.reason ?? '')}</td>
              <td><small>${esc(JSON.stringify(a.before ?? {}))}<br>→ ${esc(JSON.stringify(a.after ?? {}))}</small></td></tr>`,
          )
          .join('')}</tbody></table>`;
    } catch (e) {
      center.innerHTML = `<p class="bad">${esc(errorText(e))}</p>`;
    }
  }

  // --- TTS configuration ------------------------------------------------------------------------------------------
  type Tier = {
    min: number;
    max: number | null;
    price: number;
    credit_cost: number;
    cooldown_seconds: number;
  };
  type Rules = {
    tiers: Tier[];
    max_chars: number;
    max_waiting_global: number;
    max_waiting_weight_ms: number | null;
    transition_gap_ms: number;
    max_per_viewer: number;
  };
  let draft: Rules | null = null;
  async function renderConfig(reload = true) {
    const center = $('center');
    try {
      let customized = false;
      if (reload || !draft) {
        const v = await api<{ rules: Rules; customized: boolean }>(
          '/tts/rules',
        );
        draft = structuredClone(v.rules);
        customized = v.customized;
      }
      const d = draft!;
      const num = (field: string, value: number | null, attrs = '') =>
        `<input type="number" data-f="${field}" value="${value ?? ''}" ${attrs}>`;
      center.innerHTML = `<header class="mod-head"><h2>TTS · Configuration</h2><span class="muted">${customized ? 'Valeurs personnalisées' : 'Valeurs par défaut (legacy)'} · appliquées par Core dès l’enregistrement</span></header>
        <table class="mod-table mod-tiers"><thead><tr><th>Longueur min</th><th>Longueur max</th><th>Prix jetons</th><th>Crédits</th><th>Cooldown (s)</th><th></th></tr></thead><tbody>
        ${d.tiers
          .map(
            (
              t,
              i,
            ) => `<tr data-tier="${i}"><td>${num('min', t.min, 'min="1"')}</td><td>${num('max', t.max, `min="1" placeholder="${i === d.tiers.length - 1 ? 'ouvert' : ''}"`)}</td>
              <td>${num('price', t.price, 'min="0" step="100"')}</td><td>${num('credit_cost', t.credit_cost, 'min="0"')}</td><td>${num('cooldown_seconds', t.cooldown_seconds, 'min="0"')}</td>
              <td><button type="button" class="ghost" data-tier-del="${i}" ${d.tiers.length < 2 ? 'disabled' : ''}>Retirer</button></td></tr>`,
          )
          .join('')}</tbody></table>
        <p><button type="button" class="ghost" data-tier-add>Ajouter un palier</button> <span class="muted">Dernier palier sans max = ouvert.</span></p>
        <div class="mod-grid">
          <fieldset><legend>Message</legend><label>Longueur max <input type="number" data-g="max_chars" value="${d.max_chars}" min="1"></label></fieldset>
          <fieldset><legend>File</legend>
            <label>Nombre max en attente <input type="number" data-g="max_waiting_global" value="${d.max_waiting_global}" min="1"></label>
            <label>Durée max en attente (s, vide = aucune) <input type="number" data-g="max_waiting_weight_s" value="${d.max_waiting_weight_ms === null ? '' : Math.round(d.max_waiting_weight_ms / 1000)}" min="5"></label>
            <label>Délai entre deux TTS (ms) <input type="number" data-g="transition_gap_ms" value="${d.transition_gap_ms}" min="0" step="100"></label></fieldset>
          <fieldset><legend>Viewer</legend><label>TTS simultanés par viewer <input type="number" data-g="max_per_viewer" value="${d.max_per_viewer}" min="1"></label></fieldset>
          <fieldset><legend>Module</legend>${overview ? stateMenu('tts', overview.tts.module_state) : ''}</fieldset>
        </div>
        <p class="bad" data-id="config-errors"></p>
        <div class="actions"><button type="button" data-config-save>Enregistrer</button><button type="button" class="ghost" data-config-reset>Restaurer les valeurs par défaut</button><button type="button" class="ghost" data-config-reload>Annuler les modifications</button></div>`;
    } catch (e) {
      center.innerHTML = `<p class="bad">${esc(errorText(e))}</p>`;
    }
  }
  function readDraft(): Rules {
    const d = structuredClone(draft!);
    const n = (v: string) => (v.trim() === '' ? null : Number(v));
    root.querySelectorAll<HTMLTableRowElement>('[data-tier]').forEach((row) => {
      const t = d.tiers[Number(row.dataset.tier)]!;
      for (const input of row.querySelectorAll<HTMLInputElement>('[data-f]')) {
        const f = input.dataset.f as keyof Tier;
        (t as Record<string, number | null>)[f] =
          f === 'max' ? n(input.value) : Number(input.value);
      }
    });
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-g]')) {
      const g = input.dataset.g!;
      if (g === 'max_waiting_weight_s')
        d.max_waiting_weight_ms =
          n(input.value) === null ? null : Number(input.value) * 1000;
      else (d as unknown as Record<string, number>)[g] = Number(input.value);
    }
    return d;
  }

  // --- Lab test wallet ------------------------------------------------------------------------------------------------
  let walletViewer: string | null = null;
  async function renderWallet() {
    const center = $('center');
    try {
      const { identities } = await api<{
        identities: { id: string; label: string }[];
      }>('/identities');
      walletViewer ??= identities[0]?.id ?? null;
      const [w, card] = walletViewer
        ? await Promise.all([
            api<{
              tokens: number;
              credits_tts: number;
              credits_soundboard: number;
            }>(`/wallet/${walletViewer}`),
            api<{
              restrictions: {
                kind: string;
                module: string;
                until: string | null;
              }[];
            }>(`/viewers/${walletViewer}`),
          ])
        : [null, null];
      const ttsCd = card?.restrictions.find(
        (r) => r.kind === 'cooldown' && r.module === 'tts',
      );
      center.innerHTML = `<header class="mod-head"><h2>Wallet de test <em class="lab">Lab</em></h2><span class="muted">Jetons et crédits fictifs du Lab local · jamais l’économie réelle · Studio uniquement</span></header>
        <label class="mod-field">Viewer <select data-id="wallet-viewer">${identities.map((i) => `<option value="${esc(i.id)}" ${i.id === walletViewer ? 'selected' : ''}>${esc(i.label)} · ${esc(i.id)}</option>`).join('')}</select></label>
        ${
          w
            ? `<div class="mod-wallet">
              <label>Jetons <input type="number" data-w="tokens" value="${w.tokens}" min="0"></label>
              <label>Crédits TTS <input type="number" data-w="credits_tts" value="${w.credits_tts}" min="0"></label>
              <label>Crédits Soundboard <input type="number" data-w="credits_soundboard" value="${w.credits_soundboard}" min="0"></label>
            </div>
            <div class="actions"><button type="button" data-wallet="set">Définir</button>
              <button type="button" class="ghost" data-wallet="adjust" data-tokens="10000">+10 000 jetons</button>
              <button type="button" class="ghost" data-wallet="adjust" data-credits_tts="1">+1 crédit TTS</button>
              <button type="button" class="ghost" data-wallet="adjust" data-credits_soundboard="1">+1 crédit Soundboard</button>
              <button type="button" class="ghost" data-wallet="reset">Reset test</button></div>
            <h3>Cooldown TTS</h3>
            <p>${ttsCd?.until ? `Actif jusqu’à ${hhmm(ttsCd.until)} (${secs(Date.parse(ttsCd.until) - Date.now())})` : 'Aucun cooldown TTS.'}
              <button type="button" data-cmd="cooldown-clear" data-module="tts" data-viewer-id="${esc(walletViewer)}" ${ttsCd ? '' : 'disabled'}>Effacer le cooldown TTS</button></p>`
            : '<p class="muted">Aucun viewer.</p>'
        }`;
    } catch (e) {
      center.innerHTML = `<p class="bad">${esc(errorText(e))}</p>`;
    }
  }

  // --- viewer card ---------------------------------------------------------------------------------------------------------
  async function openViewer(id: string) {
    viewerId = id;
    const right = $('right');
    right.hidden = false;
    try {
      const v = await api<{
        viewer_id: string;
        display_name: string;
        staff_role: string | null;
        wallet: {
          tokens: number;
          credits_tts: number;
          credits_soundboard: number;
        };
        restrictions: {
          kind: string;
          module: string;
          until: string | null;
          reason: string | null;
        }[];
        activity: {
          module: string;
          interaction_id: string;
          status: string;
          created_at: string;
          detail: string;
          cost: number;
          payment_method: string;
          refund_status: string;
          refundable: boolean;
        }[];
        wallet_ledger: {
          kind: string;
          currency: string;
          amount: number;
          module_id: string | null;
          created_at: string;
          reason: string | null;
        }[];
        history: {
          action: string;
          created_at: string;
          actor: string;
          module_id: string | null;
          reason: string | null;
        }[];
      }>(`/viewers/${id}`);
      if (viewerId !== id) return;
      const cur = (c: string) =>
        c === 'tokens' ? 'J' : c === 'credits_tts' ? 'cr TTS' : 'cr Sons';
      right.innerHTML = `<header class="mod-card-head"><div><small>VIEWER${v.restrictions.length ? ` · ${v.restrictions.length} restriction${v.restrictions.length > 1 ? 's' : ''}` : ''}</small>
          <b>${esc(v.display_name)}</b><span class="muted">Twitch ID ${esc(v.viewer_id)}${v.staff_role ? ' · supermod' : ''}</span></div>
          <div class="mod-bal"><b>${fmt(v.wallet.tokens)} J</b><span>${v.wallet.credits_tts} cr TTS · ${v.wallet.credits_soundboard} cr Sons</span><small class="muted">wallet de test (Lab)</small></div>
          <button type="button" class="ghost" data-close-viewer aria-label="Fermer">✕</button></header>
        ${v.restrictions
          .map(
            (
              r,
            ) => `<div class="mod-restr"><span>${r.kind === 'block' ? 'Bloqué' : 'Cooldown'} ${esc(MODULE_LABEL[r.module] ?? r.module)}${r.until ? ` · jusqu’à ${hhmm(r.until)} (${secs(Date.parse(r.until) - Date.now())})` : ' · illimité'}${r.reason ? ` · ${esc(r.reason)}` : ''}</span>
              <button type="button" class="ghost" data-cmd="${r.kind === 'block' ? 'unblock' : 'cooldown-clear'}" data-module="${esc(r.module)}" data-viewer-id="${esc(v.viewer_id)}" title="Retirer">✕</button></div>`,
          )
          .join('')}
        <div class="actions"><button type="button" data-dialog="block" data-viewer-id="${esc(v.viewer_id)}">Bloquer</button><button type="button" class="ghost" data-dialog="cooldown" data-viewer-id="${esc(v.viewer_id)}">Cooldown</button>
          <button type="button" class="ghost" data-cmd="staff" data-viewer-id="${esc(v.viewer_id)}" data-role="${v.staff_role ? '' : 'supermod'}">${v.staff_role ? 'Retirer supermod' : 'Nommer supermod'}</button></div>
        <h3>Activité récente</h3>
        ${
          v.activity
            .map(
              (
                a,
              ) => `<div class="mod-mini"><span>${hhmm(a.created_at)}</span><b>${esc(MODULE_LABEL[a.module])}</b><span class="mod-msg">${esc(a.detail)}</span><span>${STATUS_LABEL[a.status] ?? a.status}</span>
              <span>${a.refund_status === 'refunded' ? '<span class="badge ok">remboursé</span>' : a.refundable ? `<button type="button" data-cmd="refund" data-module="${a.module}" data-id="${a.interaction_id}">Rembourser</button>` : ''}</span></div>`,
            )
            .join('') || '<p class="muted">Aucune.</p>'
        }
        <h3>Activité jetons (Lab)</h3>
        ${
          v.wallet_ledger
            .map(
              (l) =>
                `<div class="mod-mini"><span>${hhmm(l.created_at)}</span><b class="${Number(l.amount) < 0 ? 'koc' : 'okc'}">${Number(l.amount) > 0 ? '+' : ''}${fmt(Number(l.amount))} ${cur(l.currency)}</b><span>${esc({ debit: 'Débit', refund: 'Remboursement', set: 'Défini (Lab)', adjust: 'Ajusté (Lab)', reset: 'Reset (Lab)' }[l.kind] ?? l.kind)} ${esc(MODULE_LABEL[l.module_id ?? ''] ?? '')}</span></div>`,
            )
            .join('') || '<p class="muted">Aucun mouvement.</p>'
        }
        <h3>Historique modération</h3>
        ${v.history.map((h) => `<div class="mod-mini"><span>${hhmm(h.created_at)}</span><b>${esc(h.action)}</b><span>${esc(MODULE_LABEL[h.module_id ?? ''] ?? '')} · ${esc(h.actor)}${h.reason ? ` · ${esc(h.reason)}` : ''}</span></div>`).join('') || '<p class="muted">Aucune action.</p>'}`;
    } catch (e) {
      right.innerHTML = `<p class="bad">${esc(errorText(e))}</p>`;
    }
  }

  // --- dialogs (D4) ----------------------------------------------------------------------------------------------------------
  const reasonField =
    '<label class="mod-field">Raison (facultatif) <input data-d="reason" maxlength="200" placeholder="spam, abus, test…"></label>';
  function dialog(kind: string, data: DOMStringMap) {
    const d = $('dialog');
    const module = data.module ?? 'tts';
    const label = MODULE_LABEL[module] ?? module;
    let body = '';
    if (kind === 'pause' || kind === 'disable')
      body = `<h3>${kind === 'pause' ? 'Mettre en pause' : 'Désactiver'} · ${label}</h3>
        <p class="muted">${kind === 'pause' ? 'Les nouveaux achats sont refusés avant paiement ; ce qui est en cours finit.' : 'Le module est indisponible pour les viewers.'}</p>
        <label class="mod-choice"><input type="radio" name="waiting" value="keep" checked> Garder la file</label>
        <label class="mod-choice"><input type="radio" name="waiting" value="cancel_refund"> Annuler la file + rembourser</label>
        <label class="mod-choice"><input type="radio" name="waiting" value="cancel"> Annuler la file sans rembourser</label>${reasonField}
        <div class="actions"><button type="button" data-confirm>${kind === 'pause' ? 'Mettre en pause' : 'Désactiver'}</button><button type="button" class="ghost" data-cancel>Annuler</button></div>`;
    else if (kind === 'purge')
      body = `<h3>Vider la file · ${label}</h3><p class="muted">Seules les demandes en attente sont retirées ; ce qui est en cours n’est pas touché.</p>
        ${module === 'tts' ? '<label class="mod-choice"><input type="radio" name="refund" value="1" checked> Vider + rembourser</label><label class="mod-choice"><input type="radio" name="refund" value="0"> Vider sans rembourser</label>' : ''}${reasonField}
        <div class="actions"><button type="button" class="danger" data-confirm>Vider la file</button><button type="button" class="ghost" data-cancel>Annuler</button></div>`;
    else if (kind === 'block')
      body = `<h3>Bloquer</h3><p class="muted">Aucune sanction Twitch : blocage interne Raptoru, décidé par Core.</p>
        <p>Sur : ${['all', 'tts', 'soundboard', 'bonk'].map((m, i) => `<label class="mod-pill"><input type="radio" name="scope" value="${m}" ${i === 1 ? 'checked' : ''}> ${MODULE_LABEL[m]}</label>`).join('')}</p>
        <p>Durée : ${[
          ['30', '30 s'],
          ['60', '1 min'],
          ['300', '5 min'],
          ['3600', '1 h'],
          ['', 'Jusqu’au déblocage'],
        ]
          .map(
            ([v, l], i) =>
              `<label class="mod-pill"><input type="radio" name="duration" value="${v}" ${i === 2 ? 'checked' : ''}> ${l}</label>`,
          )
          .join('')}</p>${reasonField}
        <div class="actions"><button type="button" class="danger" data-confirm>Bloquer</button><button type="button" class="ghost" data-cancel>Annuler</button></div>`;
    else if (kind === 'cooldown')
      body = `<h3>Cooldown</h3>
        <p>Module : ${['tts', 'soundboard', 'bonk'].map((m, i) => `<label class="mod-pill"><input type="radio" name="module" value="${m}" ${i === 0 ? 'checked' : ''}> ${MODULE_LABEL[m]}</label>`).join('')}</p>
        <p>Mode : <label class="mod-pill"><input type="radio" name="mode" value="replace" checked> Remplacer</label><label class="mod-pill"><input type="radio" name="mode" value="add"> Ajouter</label></p>
        <label class="mod-field">Durée (minutes) <input type="number" data-d="minutes" value="10" min="0" step="0.5"></label>${reasonField}
        <div class="actions"><button type="button" data-confirm>Appliquer</button><button type="button" class="ghost" data-cancel>Annuler</button></div>`;
    d.innerHTML = `<div class="mod-dialog-box">${body}</div>`;
    d.hidden = false;
    // A closed dialog keeps nothing clickable (no stale action behind a hidden box).
    const close = () => {
      d.hidden = true;
      queueMicrotask(() => (d.innerHTML = ''));
    };
    d.querySelector<HTMLElement>('[data-cancel]')!.onclick = close;
    d.querySelector<HTMLElement>('[data-confirm]')!.onclick = () => {
      const pick = (name: string) =>
        d.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)
          ?.value ?? '';
      const reason =
        d.querySelector<HTMLInputElement>('[data-d="reason"]')?.value.trim() ||
        undefined;
      close();
      if (kind === 'pause' || kind === 'disable')
        void act(
          {
            action: 'module_state',
            module,
            state: kind === 'pause' ? 'paused' : 'disabled',
            waiting: pick('waiting'),
            reason,
          },
          `${label} : ${kind === 'pause' ? 'en pause' : 'désactivé'}`,
        );
      else if (kind === 'purge')
        void act(
          {
            action: 'purge',
            module,
            refund: module === 'tts' && pick('refund') === '1',
            reason,
          },
          'File vidée',
        );
      else if (kind === 'block') {
        const dur = pick('duration');
        void act(
          {
            action: 'block_viewer',
            viewer_id: data.viewerId,
            module: pick('scope'),
            duration_s: dur ? Number(dur) : null,
            reason,
          },
          'Viewer bloqué',
        );
      } else if (kind === 'cooldown') {
        const seconds = Math.round(
          Number(
            d.querySelector<HTMLInputElement>('[data-d="minutes"]')?.value ?? 0,
          ) * 60,
        );
        void act(
          {
            action: 'viewer_cooldown',
            viewer_id: data.viewerId,
            module: pick('module'),
            mode: pick('mode'),
            seconds,
            reason,
          },
          'Cooldown appliqué',
        );
      }
    };
  }

  // --- events ------------------------------------------------------------------------------------------------------------------
  root.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    const nav = t.closest<HTMLElement>('[data-view]');
    if (nav) {
      view = nav.dataset.view as View;
      lastCenter = '';
      renderModules();
      renderCenter(true);
      return;
    }
    const who = t.closest<HTMLElement>('[data-viewer]');
    if (who) {
      $('results').hidden = true;
      return void openViewer(who.dataset.viewer!);
    }
    if (t.closest('[data-close-viewer]')) {
      viewerId = null;
      $('right').hidden = true;
      return;
    }
    const dlg = t.closest<HTMLElement>('[data-dialog]');
    if (dlg) return dialog(dlg.dataset.dialog!, dlg.dataset);
    const c = t.closest<HTMLButtonElement>('[data-cmd]');
    if (c) {
      const d = c.dataset;
      const refund = d.refund === '1';
      c.disabled = true;
      if (d.cmd === 'resume')
        await act(
          {
            action: 'module_state',
            module: d.module,
            state: 'active',
            waiting: 'keep',
          },
          `${MODULE_LABEL[d.module!]} : repris`,
        );
      else if (d.cmd === 'stop')
        await act(
          { action: 'stop_current', module: 'tts', refund },
          refund ? 'Lecture stoppée + remboursée' : 'Lecture stoppée',
        );
      else if (d.cmd === 'cancel')
        await act(
          { action: 'cancel', module: d.module, interaction_id: d.id, refund },
          refund ? 'Retiré + remboursé' : 'Retiré',
        );
      else if (d.cmd === 'refund')
        await act(
          { action: 'refund', module: d.module, interaction_id: d.id },
          'Remboursé',
        );
      else if (d.cmd === 'unblock')
        await act(
          { action: 'unblock_viewer', viewer_id: d.viewerId, module: d.module },
          'Blocage retiré',
        );
      else if (d.cmd === 'cooldown-clear') {
        await act(
          {
            action: 'viewer_cooldown',
            viewer_id: d.viewerId,
            module: d.module,
            mode: 'clear',
            seconds: 0,
          },
          'Cooldown effacé',
        );
        if (view === 'wallet') void renderWallet();
      } else if (d.cmd === 'staff')
        await act(
          { action: 'set_staff', viewer_id: d.viewerId, role: d.role || null },
          d.role ? 'Nommé supermod' : 'Supermod retiré',
        );
      c.disabled = false;
      return;
    }
    // TTS configuration
    if (t.closest('[data-tier-add]') && draft) {
      draft = readDraft();
      const last = draft.tiers.at(-1)!;
      const min = (last.max ?? last.min) + 1;
      if (last.max === null) last.max = last.min;
      draft.tiers.push({
        min: Math.max(min, last.max + 1),
        max: null,
        price: last.price,
        credit_cost: last.credit_cost,
        cooldown_seconds: last.cooldown_seconds,
      });
      return void renderConfig(false);
    }
    const del = t.closest<HTMLElement>('[data-tier-del]');
    if (del && draft) {
      draft = readDraft();
      draft.tiers.splice(Number(del.dataset.tierDel), 1);
      return void renderConfig(false);
    }
    if (t.closest('[data-config-reload]')) return void renderConfig(true);
    if (t.closest('[data-config-save]') && draft) {
      const rules = readDraft();
      try {
        await api('/tts/rules', { rules });
        toast('Configuration TTS enregistrée : appliquée aux prochains achats');
        return void renderConfig(true);
      } catch (e) {
        $('config-errors').textContent = errorText(e);
        return;
      }
    }
    if (t.closest('[data-config-reset]')) {
      if (!confirm('Restaurer les valeurs TTS par défaut (legacy) ?')) return;
      try {
        await api('/tts/rules/reset', {});
        toast('Valeurs par défaut restaurées');
      } catch (e) {
        toast(errorText(e), true);
      }
      return void renderConfig(true);
    }
    // Lab wallet
    const w = t.closest<HTMLElement>('[data-wallet]');
    if (w && walletViewer) {
      const op = w.dataset.wallet!;
      const body: Json = { viewer_id: walletViewer, op };
      if (op === 'set')
        for (const input of root.querySelectorAll<HTMLInputElement>('[data-w]'))
          body[input.dataset.w!] = Number(input.value);
      if (op === 'adjust')
        for (const k of ['tokens', 'credits_tts', 'credits_soundboard'])
          if (w.dataset[k]) body[k] = Number(w.dataset[k]);
      if (
        op === 'reset' &&
        !confirm('Remettre ce wallet de test aux valeurs par défaut ?')
      )
        return;
      try {
        await api('/wallet', body);
        toast('Wallet de test mis à jour');
      } catch (e) {
        toast(errorText(e), true);
      }
      return void renderWallet();
    }
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.matches('[data-id="wallet-viewer"]')) {
      walletViewer = (t as HTMLSelectElement).value;
      void renderWallet();
    }
  });
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = $<HTMLInputElement>('search').value.trim();
      const box = $('results');
      if (!q) return void (box.hidden = true);
      try {
        const { viewers } = await api<{
          viewers: { viewer_id: string; display_name: string }[];
        }>(`/search?q=${encodeURIComponent(q)}`);
        box.innerHTML =
          viewers
            .map(
              (v) =>
                `<button type="button" data-viewer="${esc(v.viewer_id)}">${esc(v.display_name)} <small>${esc(v.viewer_id)}</small></button>`,
            )
            .join('') || '<p class="muted">Aucun viewer.</p>';
        box.hidden = false;
      } catch {
        box.hidden = true;
      }
    }, 200);
  });

  // --- polling ------------------------------------------------------------------------------------------------------------------
  async function refresh(force = false) {
    try {
      overview = await api<Overview>('/overview');
    } catch {
      overview = null;
    }
    renderModules();
    renderCenter(force);
  }
  const loop = async () => {
    if (!visible) return;
    await refresh();
    timer = setTimeout(() => void loop(), 1500);
  };
  return {
    setVisible(v: boolean) {
      visible = v;
      clearTimeout(timer);
      if (v) {
        lastCenter = '';
        void loop();
        if (editing()) renderCenter(true);
      }
    },
  };
}
