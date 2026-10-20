// Twitch alerts — « Événements Twitch réels » in the Alertes tab (17/10/2026, Lab). The mode lives in Studio's
// storage and is read by the Lab chat adapter at its start (a change restarts it). OFF by default. ACTIVE asks for a
// confirmation: real events then play in the OBS source connected to this Studio.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

export interface TwitchState {
  mode: 'off' | 'test' | 'active';
  ingestion_enabled: boolean;
  ingestion_running: boolean;
  token_login: string | null;
  follow_scope: boolean;
  /** Which Core the ACTIVE mode feeds (§ 22). */
  environment?: 'lab' | 'production';
  /** Real Twitch events can reach this profile (Lab chat adapter; the production bot is not wired yet). */
  available?: boolean;
  resumed_from_active?: boolean;
  /** Lot 9 — Production profile: the production bot's mode (ALERTS_MODE, set on the bot), read only. */
  managed_by?: 'production_bot';
  bot?: {
    mode: 'off' | 'test' | 'active';
    subscriptions: string[];
    refused: string[];
    pending: number;
    reported_at: string;
    age_ms: number;
  } | null;
  last_twitch_event_at?: string | null;
  max_age_ms?: number | null;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Production profile: the bot's last report to the main Core (pure, tested). */
export function productionStatusView(s: TwitchState) {
  const b = s.bot;
  const fresh =
    s.max_age_ms == null
      ? '<p class="al-hint">Fraîcheur des animations : désactivée (toutes les alertes sont jouées, même en retard).</p>'
      : `<p class="al-hint">Fraîcheur des animations : ${Math.round(s.max_age_ms / 1000)} s (plus ancienne : gardée dans l’historique, non jouée ; les gains restent versés).</p>`;
  const last = s.last_twitch_event_at
    ? `<p class="al-hint">Dernier événement Twitch réel reçu par le Core : ${esc(clock(s.last_twitch_event_at))}.</p>`
    : '<p class="al-hint">Aucun événement Twitch réel reçu par le Core.</p>';
  if (!b)
    return `<p class="al-error">Indisponible : aucun rapport du bot de production depuis le démarrage du Core (bot arrêté, alertes et jeux du chat OFF, ou bot non mis à jour).</p>${last}${fresh}`;
  const stale = b.age_ms > 3 * 60_000;
  const state = stale
    ? `<p class="al-error">Bot de production sans nouvelles depuis ${Math.round(b.age_ms / 60_000)} min (dernier rapport ${esc(clock(b.reported_at))}).</p>`
    : b.mode === 'active'
      ? '<p class="al-ok">Réception active : les vrais événements sont mis en file et joués par la source OBS de ce Studio.</p>'
      : b.mode === 'test'
        ? '<p class="al-hint">Réception en TEST : événements reçus et journalisés par le bot, jamais mis en file.</p>'
        : '<p class="al-hint">Réception inactive (OFF sur le bot de production) : aucun événement Twitch réel n’arrive.</p>';
  return [
    state,
    '<p class="al-hint">Mode réglé sur le bot de production (ALERTS_MODE), pas depuis Studio.</p>',
    b.subscriptions.length
      ? `<p class="al-hint">Abonnements : ${esc(b.subscriptions.join(', '))}.</p>`
      : '',
    b.refused.length
      ? `<p class="al-error">Refusés par Twitch : ${esc(b.refused.join(', '))}.</p>`
      : '',
    b.subscriptions.includes('channel.follow')
      ? '<p class="al-hint">Follows : reçus.</p>'
      : '<p class="al-hint">Follows : non reçus (droit moderator:read:followers absent ou refusé).</p>',
    b.pending
      ? `<p class="al-error">${b.pending} alerte(s) en attente dans le bot (Core injoignable ?) : renvoyées automatiquement, jamais en double.</p>`
      : '',
    last,
    fresh,
  ].join('');
}

/** The ACTIVE button names the Core it really feeds. */
export const activeLabel = (env?: string) =>
  env === 'production' ? 'ACTIVE · Core production' : 'ACTIVE · Core Lab';

const MODES: { id: TwitchState['mode']; label: string; hint: string }[] = [
  {
    id: 'off',
    label: 'OFF',
    hint: 'Aucun abonnement aux événements d’alerte, rien n’est lu.',
  },
  {
    id: 'test',
    label: 'TEST',
    hint: 'Reçus et écrits dans le journal de l’ingestion (onglet Simulation), jamais mis en file : rien ne s’affiche dans OBS.',
  },
  {
    id: 'active',
    label: 'ACTIVE (Lab)',
    hint: 'Mis en file : la source OBS de ce Studio les joue, y compris dans une scène de live.',
  },
];

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** The status lines under the switch (pure, tested). */
export function twitchStatusView(s: TwitchState | null, error: string | null) {
  if (error) return `<p class="al-error">${esc(error)}</p>`;
  if (!s) return '<p class="al-hint">Chargement…</p>';
  if (s.managed_by === 'production_bot') return productionStatusView(s);
  if (s.available === false)
    return '<p class="al-error">Indisponible dans ce profil : le bot Twitch de production n’est pas encore raccordé aux alertes (aucun événement Twitch réel n’arrive ici).</p>';
  const lines = [
    s.resumed_from_active
      ? '<p class="al-error">ACTIVE n’est jamais repris automatiquement au démarrage de Studio : mode TEST (observation). Choisis ACTIVE à nouveau pour jouer les vrais événements.</p>'
      : '',
    s.ingestion_enabled
      ? s.ingestion_running
        ? `<p class="al-ok">Ingestion Twitch active (compte ${esc(s.token_login ?? '?')}).</p>`
        : '<p class="al-error">Ingestion Twitch activée mais arrêtée : voir l’onglet Simulation.</p>'
      : '<p class="al-hint">Ingestion Twitch coupée (onglet Simulation) : aucun événement réel n’arrive, quel que soit le mode.</p>',
    s.follow_scope
      ? '<p class="al-hint">Follows : reçus.</p>'
      : '<p class="al-hint">Follows : non reçus (le jeton du bot n’a pas le droit moderator:read:followers).</p>',
  ];
  return lines.join('');
}

export function mountTwitchMode(host: HTMLElement) {
  let state: TwitchState | null = null;
  let error: string | null = null;
  host.innerHTML = `
    <div class="al-presets" role="radiogroup" aria-label="Événements Twitch réels">${MODES.map(
      (m) =>
        `<button type="button" class="al-small" data-mode="${m.id}" title="${esc(m.hint)}">${m.label}</button>`,
    ).join('')}</div>
    <p class="al-hint" data-role="twitch-hint"></p>
    <div data-role="twitch-status"></div>`;
  const render = () => {
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      const on = state?.mode === b.dataset.mode;
      b.classList.toggle('primary', on);
      if (b.dataset.mode === 'active')
        b.textContent = activeLabel(state?.environment);
      // Production profile: the bot's mode is shown, never changed from here.
      b.disabled =
        state?.managed_by === 'production_bot' ||
        (state?.available === false && b.dataset.mode !== 'off');
      b.setAttribute('aria-pressed', String(on));
    }
    host.querySelector('[data-role="twitch-hint"]')!.textContent =
      MODES.find((m) => m.id === state?.mode)?.hint ?? '';
    host.querySelector('[data-role="twitch-status"]')!.innerHTML =
      twitchStatusView(state, error);
  };
  const load = async (init?: RequestInit) => {
    try {
      const res = await fetch('/api/alerts/twitch', {
        headers: HEADERS,
        ...init,
      });
      const body = (await res.json()) as TwitchState & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
    } catch (e) {
      error = `Mode des événements Twitch indisponible : ${(e as Error).message}`;
    }
    render();
  };
  host.addEventListener('click', (ev) => {
    const mode = (ev.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-mode]',
    )?.dataset.mode;
    if (!mode || mode === state?.mode) return;
    if (
      mode === 'active' &&
      !confirm(
        'Mode ACTIVE : les vrais follows, subs, gifts, Bits et raids seront joués par la source OBS de ce Studio.\n\nSi cette source est dans une scène de live, ils s’afficheront en plus des alertes legacy. Continuer ?',
      )
    )
      return;
    void load({ method: 'POST', body: JSON.stringify({ mode }) });
  });
  void load();
  return { refresh: () => load() };
}
