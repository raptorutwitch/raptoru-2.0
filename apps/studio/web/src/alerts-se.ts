// Twitch alerts — « Dons StreamElements » in the Alertes tab (17/10/2026, Lab). Its own mode (independent of the
// Twitch events), the account link (the token goes page → Electron main → server, never back), the connection state,
// the last tip and a persistent diagnostic journal (Studio storage), refreshed while the tab is open.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

export interface SeJournalEntry {
  at: string;
  topic: string;
  tip_id: string | null;
  name: string | null;
  amount: string | null;
  currency: string | null;
  message: string | null;
  status: string | null;
  approved: string | null;
  decision: 'test' | 'queued' | 'duplicate' | 'ignored' | 'error';
  detail: string;
}

export interface SeStatus {
  mode: 'off' | 'test' | 'active';
  token: { present: boolean; type: string | null };
  state: string;
  state_label: string;
  room: string | null;
  topics: { topic: string; subscribed: boolean; error: string | null }[];
  error: string | null;
  last_event: SeJournalEntry | null;
  journal: SeJournalEntry[];
  environment?: 'lab' | 'production';
  resumed_from_active?: boolean;
}

interface SeBridge {
  connect(
    tokenType: string,
    token: string,
    room: string,
  ): Promise<{ ok: boolean; error?: string; remembered?: boolean }>;
  forget(): Promise<unknown>;
}

const MODES: { id: SeStatus['mode']; label: string; hint: string }[] = [
  {
    id: 'off',
    label: 'OFF',
    hint: 'Aucune connexion à StreamElements.',
  },
  {
    id: 'test',
    label: 'TEST',
    hint: 'Connecté : chaque don reçu est noté dans le journal ci-dessous, jamais mis en file, rien dans OBS.',
  },
  {
    id: 'active',
    label: 'ACTIVE (Lab)',
    hint: 'Les dons confirmés sont mis en file (famille don) : la source OBS de ce Studio les joue.',
  },
];

const DECISION: Record<SeJournalEntry['decision'], string> = {
  test: 'TEST · reçu',
  queued: 'Mis en file',
  duplicate: 'Doublon',
  ignored: 'Ignoré',
  error: 'Erreur',
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const time = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** One journal line (pure, tested): every donor text is escaped. */
export function seEntryView(e: SeJournalEntry) {
  const amount =
    e.amount !== null ? `${esc(e.amount)} ${esc(e.currency ?? '')}` : '—';
  return `<tr class="al-se-${e.decision}">
    <td>${esc(time(e.at))}</td>
    <td><b>${esc(DECISION[e.decision])}</b>${e.detail ? `<br><small>${esc(e.detail)}</small>` : ''}</td>
    <td>${e.name !== null ? esc(e.name) : '<i>sans nom</i>'}</td>
    <td>${amount}</td>
    <td>${e.message ? esc(e.message) : '—'}</td>
    <td><small>${esc(e.topic)}${e.status ? ` · ${esc(e.status)}` : ''}${e.approved ? ` · ${esc(e.approved)}` : ''}${e.tip_id ? `<br>${esc(e.tip_id)}` : ''}</small></td>
  </tr>`;
}

/** The status block (pure, tested). */
export function seStatusView(s: SeStatus | null, error: string | null) {
  if (error) return `<p class="al-error">${esc(error)}</p>`;
  if (!s) return '<p class="al-hint">Chargement…</p>';
  const ok = s.state === 'connected';
  const bad = s.state === 'auth_failed' || s.state === 'reconnecting';
  const topics = s.topics
    .map(
      (t) =>
        `${esc(t.topic)} : ${t.subscribed ? 'abonné' : t.error ? `refusé (${esc(t.error)})` : '—'}`,
    )
    .join(' · ');
  const last = s.last_event
    ? `<p class="al-hint">Dernier don reçu : ${esc(time(s.last_event.at))} — ${esc(s.last_event.name ?? 'sans nom')}, ${esc(s.last_event.amount ?? '?')} ${esc(s.last_event.currency ?? '')} → <b>${esc(DECISION[s.last_event.decision])}</b>.</p>`
    : '<p class="al-hint">Aucun don reçu pour l’instant.</p>';
  return `
    ${s.resumed_from_active ? '<p class="al-error">ACTIVE n’est jamais repris automatiquement au démarrage de Studio : mode TEST (observation). Choisis ACTIVE à nouveau pour jouer les vrais événements.</p>' : ''}
    <p class="al-hint">Compte : ${s.token.present ? `jeton enregistré (${s.token.type === 'apikey' ? 'Overlay Token' : 'JWT'})` : 'non connecté'}${s.room ? ` · chaîne ${esc(s.room)}` : ''}</p>
    <p class="${ok ? 'al-ok' : bad ? 'al-error' : 'al-hint'}">${esc(s.state_label)}</p>
    ${s.mode !== 'off' && s.token.present ? `<p class="al-hint">${topics}</p>` : ''}
    ${s.error ? `<p class="al-error">${esc(s.error)}</p>` : ''}
    ${last}`;
}

export function mountSeDonations(host: HTMLElement) {
  const bridge = (window as unknown as { raptoruStudio?: { se?: SeBridge } })
    .raptoruStudio?.se;
  let state: SeStatus | null = null;
  let error: string | null = null;
  host.innerHTML = `
    <div class="al-presets" role="radiogroup" aria-label="Dons StreamElements">${MODES.map(
      (m) =>
        `<button type="button" class="al-small" data-se-mode="${m.id}" title="${esc(m.hint)}">${m.label}</button>`,
    ).join('')}</div>
    <p class="al-hint" data-role="se-hint"></p>
    <div data-role="se-status"></div>
    <details class="al-se-connect">
      <summary>Connecter le compte StreamElements</summary>
      ${
        bridge
          ? `<label class="al-field"><span>Type de jeton</span><select data-role="se-type">
              <option value="jwt">JWT Token</option><option value="apikey">Overlay Token</option></select></label>
            <label class="al-field"><span>Jeton (copié depuis le dashboard StreamElements)</span>
              <input type="password" autocomplete="off" spellcheck="false" data-role="se-token"/></label>
            <label class="al-field"><span>ID de chaîne StreamElements (facultatif)</span>
              <input autocomplete="off" spellcheck="false" data-role="se-room"/></label>
            <div class="al-actions"><button type="button" class="al-small" data-act="se-connect">Enregistrer</button>
              <button type="button" class="al-small" data-act="se-forget">Oublier le jeton</button></div>
            <p class="al-hint">Chiffré par Windows sur cet ordinateur, jamais affiché ni renvoyé à la page.</p>`
          : '<p class="al-error">Disponible uniquement dans l’application Raptoru Studio.</p>'
      }
      <p class="al-hint" data-role="se-connect-result"></p>
    </details>
    <h3>Journal des dons (50 derniers, conservé)</h3>
    <div class="al-se-journal" data-role="se-journal"></div>`;
  const $ = (role: string) =>
    host.querySelector<HTMLElement>(`[data-role="${role}"]`)!;
  const render = () => {
    for (const b of host.querySelectorAll<HTMLButtonElement>(
      '[data-se-mode]',
    )) {
      const on = state?.mode === b.dataset.seMode;
      b.classList.toggle('primary', on);
      if (b.dataset.seMode === 'active')
        b.textContent =
          state?.environment === 'production'
            ? 'ACTIVE · Core production'
            : 'ACTIVE · Core Lab';
      b.setAttribute('aria-pressed', String(on));
    }
    $('se-hint').textContent =
      MODES.find((m) => m.id === state?.mode)?.hint ?? '';
    $('se-status').innerHTML = seStatusView(state, error);
    $('se-journal').innerHTML = state?.journal.length
      ? `<table><thead><tr><th>Heure</th><th>Décision</th><th>Nom affiché</th><th>Montant</th><th>Message</th><th>Détail</th></tr></thead>
          <tbody>${state.journal.map(seEntryView).join('')}</tbody></table>`
      : '<p class="al-hint">Vide.</p>';
  };
  const load = async (init?: RequestInit, path = '') => {
    try {
      const res = await fetch(`/api/alerts/se${path}`, {
        headers: HEADERS,
        ...init,
      });
      const body = (await res.json()) as SeStatus & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
    } catch (e) {
      error = `Dons StreamElements indisponibles : ${(e as Error).message}`;
    }
    render();
  };
  host.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const mode =
      target.closest<HTMLButtonElement>('[data-se-mode]')?.dataset.seMode;
    if (mode && mode !== state?.mode) {
      if (
        mode === 'active' &&
        !confirm(
          'Mode ACTIVE : les vrais dons StreamElements confirmés seront joués par la source OBS de ce Studio.\n\nLes alertes StreamElements legacy restent actives : si cette source est dans une scène de live, le don s’affichera deux fois. Continuer ?',
        )
      )
        return;
      void load({ method: 'POST', body: JSON.stringify({ mode }) }, '/mode');
      return;
    }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!bridge || (act !== 'se-connect' && act !== 'se-forget')) return;
    const result = $('se-connect-result');
    void (async () => {
      if (act === 'se-forget') {
        await bridge.forget();
        result.textContent = 'Jeton oublié.';
      } else {
        const input = host.querySelector<HTMLInputElement>(
          '[data-role="se-token"]',
        )!;
        const out = await bridge.connect(
          host.querySelector<HTMLSelectElement>('[data-role="se-type"]')!.value,
          input.value,
          host.querySelector<HTMLInputElement>('[data-role="se-room"]')!.value,
        );
        input.value = ''; // never kept in the page
        result.textContent = out.ok
          ? out.remembered
            ? 'Jeton enregistré (chiffré).'
            : 'Jeton accepté pour cette session, mais pas mémorisé : chiffrement Windows indisponible.'
          : `Refusé : ${out.error === 'invalid_token' ? 'jeton invalide (vide, trop court ou avec des espaces)' : out.error === 'invalid_room' ? 'ID de chaîne invalide (24 caractères hexadécimaux)' : (out.error ?? 'erreur')}.`;
      }
      await load();
    })();
  });
  void load();
  // The journal keeps everything; while the tab is open it refreshes on its own.
  setInterval(() => {
    if (host.isConnected) void load();
  }, 2000);
}
