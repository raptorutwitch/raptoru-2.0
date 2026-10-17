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
}

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
  const lines = [
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
