// Temporary Test Lab tab: local control panel for the presence shadow test.
// Talks only to the local Studio server; receives no secret.

type Step = { step: string; ok: boolean; detail: string };
type Status = {
  busy: string | null;
  sequence: { running: boolean; action: string | null; steps: Step[] };
  postgres: { state: string; detail: string };
  core: {
    process: string;
    pid: number | null;
    health: { ok: boolean; checkedAt: string | null; error: string | null };
  };
  auth: {
    tokenFile: boolean;
    login: string | null;
    scopes: string[];
    expiresAt: string | null;
    accessTokenFresh: boolean;
    hasRefreshToken: boolean;
    lastPreflight: { ok: boolean; at: string; lines: string[] } | null;
  };
  bot: {
    state: string;
    pid: number | null;
    flags: Record<string, string>;
    guard: string | null;
    twitch: string;
    lastError: string | null;
  };
  loyalty: {
    flags: Record<string, string>;
    creditsGuard: string | null;
    broadcasterToken: {
      login: string | null;
      scopes: string[];
      hasRefreshToken: boolean;
    };
    events: string;
    lastSubSnapshot: string | null;
    passiveExclusions: string[] | null;
  };
  presence: {
    worker: string;
    lastChatters: number | null;
    lastSnapshotAt: string | null;
    lastError: string | null;
    report:
      | null
      | { available: false; error?: string }
      | {
          available: true;
          streamId: string;
          live: boolean;
          durationMinutes: number;
          uniqueViewers: number;
          cycles: {
            total: number;
            ok: number;
            failed: number;
            coveragePercent: number;
            lastOkAt: string | null;
          };
          lastError: {
            observedAt: string;
            errorKind: string;
            httpStatus: number | null;
          } | null;
        };
  };
};
type LogLine = {
  seq: number;
  at: string;
  source: string;
  level: string;
  text: string;
};

const HEADERS = { 'x-raptoru-studio': '1' };
const MAX_LOG_LINES = 400;

const esc = (v: unknown) =>
  String(v ?? '—').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('fr-FR') : '—';
const badge = (label: string, tone: 'ok' | 'ko' | 'idle' | 'warn') =>
  `<span class="badge ${tone}">${esc(label)}</span>`;
const row = (k: string, v: string) =>
  `<div class="row"><span>${esc(k)}</span><span>${v}</span></div>`;
const button = (action: string, label: string, extra = '') =>
  `<button type="button" data-action="${action}" ${extra}>${esc(label)}</button>`;

async function api<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const res = await fetch(`/api/${path}`, { method, headers: HEADERS });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function render(s: Status): string {
  const pg =
    s.postgres.state === 'running'
      ? badge('Running', 'ok')
      : s.postgres.state === 'stopped'
        ? badge('Stopped', 'idle')
        : badge('Error', 'ko');
  const coreUp = s.core.health.ok;
  const botRunning = s.bot.state.startsWith('running');
  const r = s.presence.report;
  const disabled = s.busy ? 'disabled' : '';

  const steps = s.sequence.steps.length
    ? `<ul class="steps">${s.sequence.steps.map((st) => `<li>${st.ok ? '✅' : '❌'} <b>${esc(st.step)}</b> <small>${esc(st.detail)}</small></li>`).join('')}</ul>`
    : '';

  return `
  <section class="hero">
    <div>
      <h1>Test Lab — Presence Shadow</h1>
      <p>Panneau local temporaire · <b>NO WALLET / NO CREDITS / SHADOW MODE</b> · aucun message chat</p>
    </div>
    <div class="actions">
      ${button('start-all', 'Start All', `class="primary" ${disabled}`)}
      ${button('stop-all', 'Stop All', disabled)}
    </div>
  </section>
  ${s.busy ? `<p class="busy">⏳ ${esc(s.busy)}…</p>` : ''}
  ${s.sequence.action ? `<div class="card wide"><h2>${esc(s.sequence.action)}</h2>${steps || '<p>…</p>'}</div>` : ''}

  <div class="grid">
    <div class="card">
      <h2>Postgres ${pg}</h2>
      ${row('Conteneur', 'raptoru2-pg')}
      ${row('État', esc(s.postgres.detail))}
      <div class="actions">${button('postgres/start', 'Start', disabled)}${button('postgres/stop', 'Stop Postgres', disabled)}</div>
    </div>

    <div class="card">
      <h2>Core API ${coreUp ? badge('Healthy', 'ok') : s.core.process === 'stopped' ? badge('Stopped', 'idle') : badge('Down', 'ko')}</h2>
      ${row('Process', `${esc(s.core.process)}${s.core.pid ? ` · pid ${s.core.pid}` : ''}`)}
      ${row('/health', coreUp ? 'ok' : esc(s.core.health.error ?? 'ko'))}
      ${row('Dernier check', time(s.core.health.checkedAt))}
      <div class="actions">${button('core/start', 'Start', disabled)}${button('core/stop', 'Stop', disabled)}${button('core/restart', 'Restart', disabled)}</div>
    </div>

    <div class="card">
      <h2>Twitch Auth ${s.auth.lastPreflight ? (s.auth.lastPreflight.ok ? badge('Preflight OK', 'ok') : badge('Preflight KO', 'ko')) : badge('Non vérifié', 'idle')}</h2>
      ${row('Compte du token', esc(s.auth.login ?? (s.auth.tokenFile ? '?' : 'aucun token')))}
      ${row('Scopes', esc(s.auth.scopes.join(' ') || '—'))}
      ${row('Expiration enregistrée', s.auth.accessTokenFresh ? `jusqu’à ${time(s.auth.expiresAt)} · validité Twitch non vérifiée ici` : 'dépassée ou inconnue (refresh possible au démarrage)')}
      ${row('Refresh token', s.auth.hasRefreshToken ? 'disponible' : '<b>absent</b>')}
      ${row('Dernier preflight', time(s.auth.lastPreflight?.at))}
      ${s.auth.lastPreflight ? `<pre>${esc(s.auth.lastPreflight.lines.join('\n'))}</pre>` : ''}
      <div class="actions">${button('preflight', 'Run Preflight', disabled)}</div>
    </div>

    <div class="card">
      <h2>Twitch Bot ${botRunning ? badge('Running', 'ok') : s.bot.state === 'error' ? badge('Error', 'ko') : badge('Stopped', 'idle')}</h2>
      ${row('Process', `${esc(s.bot.state)}${s.bot.pid ? ` · pid ${s.bot.pid}` : ''}`)}
      ${row('DAILY_CHAT_COMMANDS', s.bot.flags.DAILY_CHAT_COMMANDS === 'false' ? badge('false', 'ok') : badge(s.bot.flags.DAILY_CHAT_COMMANDS ?? '?', 'ko'))}
      ${row('LOYALTY_CHAT_COMMANDS', s.bot.flags.LOYALTY_CHAT_COMMANDS === 'false' ? badge('false', 'ok') : badge(s.bot.flags.LOYALTY_CHAT_COMMANDS ?? '?', 'ko'))}
      ${row('PRESENCE_SHADOW', s.bot.flags.PRESENCE_SHADOW === 'true' ? badge('true', 'ok') : badge(s.bot.flags.PRESENCE_SHADOW ?? '?', 'ko'))}
      ${row('Connexion Twitch', esc(s.bot.twitch))}
      ${row('Dernière erreur', esc(s.bot.lastError))}
      ${s.bot.guard ? `<p class="error">${esc(s.bot.guard)}</p>` : ''}
      <div class="actions">${button('bot/start', 'Start', `${disabled} ${s.bot.guard ? 'disabled' : ''}`)}${button('bot/stop', 'Stop', disabled)}${button('bot/restart', 'Restart', `${disabled} ${s.bot.guard ? 'disabled' : ''}`)}</div>
    </div>

    <div class="card">
      <h2>Loyalty ${s.loyalty.flags.LOYALTY_PASSIVE_CREDITS === 'false' && s.loyalty.flags.LOYALTY_EVENT_CREDITS === 'false' ? badge('NO CREDITS', 'ok') : badge('CREDITS ON', 'ko')}</h2>
      ${row('LOYALTY_PREVIEW', s.loyalty.flags.LOYALTY_PREVIEW === 'true' ? badge('true', 'ok') : badge(s.loyalty.flags.LOYALTY_PREVIEW ?? '?', 'warn'))}
      ${row('LOYALTY_TWITCH_EVENTS', s.loyalty.flags.LOYALTY_TWITCH_EVENTS === 'true' ? badge('true', 'ok') : badge(s.loyalty.flags.LOYALTY_TWITCH_EVENTS ?? '?', 'warn'))}
      ${row('LOYALTY_PASSIVE_CREDITS', s.loyalty.flags.LOYALTY_PASSIVE_CREDITS === 'false' ? badge('false', 'ok') : badge(s.loyalty.flags.LOYALTY_PASSIVE_CREDITS ?? '?', 'ko'))}
      ${row('LOYALTY_EVENT_CREDITS', s.loyalty.flags.LOYALTY_EVENT_CREDITS === 'false' ? badge('false', 'ok') : badge(s.loyalty.flags.LOYALTY_EVENT_CREDITS ?? '?', 'ko'))}
      ${row('Token broadcaster', esc(s.loyalty.broadcasterToken.login ?? 'aucun'))}
      ${row('Événements broadcaster', esc(s.loyalty.events))}
      ${row('Snapshot abonnés', esc(s.loyalty.lastSubSnapshot))}
      ${row('Exclus du passif', esc(s.loyalty.passiveExclusions ? s.loyalty.passiveExclusions.join(', ') || 'aucun' : 'Core arrêté'))}
      ${s.loyalty.creditsGuard ? `<p class="error">${esc(s.loyalty.creditsGuard)}</p>` : ''}
      <p class="hint">Rapport : <code>npm run loyalty:report -w @raptoru/core-api -- --latest</code></p>
    </div>

    <div class="card wide">
      <h2>Presence Shadow ${botRunning ? badge(s.presence.worker, s.presence.worker.startsWith('tracking') ? 'ok' : 'warn') : badge('Stopped', 'idle')}</h2>
      <div class="cols">
        <div>
          ${row('Dernier snapshot', time(s.presence.lastSnapshotAt))}
          ${row('Chatters (dernier)', esc(s.presence.lastChatters))}
          ${row('Dernière erreur', esc(s.presence.lastError))}
        </div>
        <div>
          ${
            r && r.available
              ? row(
                  'Stream',
                  `${esc(r.streamId)} ${r.live ? badge('live', 'ok') : badge('terminé', 'idle')}`,
                ) +
                row('Durée', `${r.durationMinutes} min`) +
                row('Cycles', `${r.cycles.ok} ok / ${r.cycles.failed} ratés`) +
                row('Couverture', `${r.cycles.coveragePercent} %`) +
                row('Viewers uniques', String(r.uniqueViewers)) +
                row('Dernier snapshot OK', time(r.cycles.lastOkAt)) +
                row(
                  'Dernière erreur Twitch',
                  r.lastError
                    ? esc(
                        `${r.lastError.errorKind} ${r.lastError.httpStatus ?? ''} · ${time(r.lastError.observedAt)}`,
                      )
                    : '—',
                )
              : row(
                  'Rapport',
                  coreUp
                    ? 'aucune donnée de présence pour l’instant'
                    : 'Core arrêté',
                )
          }
        </div>
      </div>
      <p class="hint">Rapport complet / CSV : <code>npm run presence:report -w @raptoru/core-api -- --latest</code></p>
    </div>
  </div>`;
}

export function mountTestLab(root: HTMLElement): void {
  root.innerHTML = `<div id="panel"><p>Connexion au serveur Studio…</p></div>
    <section class="card wide logs">
      <h2>Logs <span class="filters">${['all', 'core', 'bot', 'presence', 'preflight', 'studio', 'errors'].map((f) => `<label><input type="radio" name="logf" value="${f}" ${f === 'all' ? 'checked' : ''}/> ${f}</label>`).join('')}</span>
        <button type="button" id="clear-logs">Clear</button></h2>
      <pre id="log"></pre>
    </section>`;
  const panel = root.querySelector<HTMLElement>('#panel')!;
  const logEl = root.querySelector<HTMLElement>('#log')!;
  let logs: LogLine[] = [];
  let lastSeq = 0;
  let filter = 'all';
  let refreshing = false;

  const drawLogs = () => {
    const shown = logs.filter(
      (l) =>
        filter === 'all' ||
        (filter === 'errors' ? l.level === 'error' : l.source === filter),
    );
    logEl.innerHTML = shown
      .map(
        (l) =>
          `<span class="${l.level}">${time(l.at)} [${esc(l.source)}] ${esc(l.text)}</span>`,
      )
      .join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  };

  const refresh = async () => {
    if (refreshing) return; // never stack polls
    refreshing = true;
    try {
      panel.innerHTML = render(await api<Status>('test-lab/status'));
      const fresh = await api<LogLine[]>(`test-lab/logs?since=${lastSeq}`);
      if (fresh.length) {
        lastSeq = fresh.at(-1)!.seq;
        logs = [...logs, ...fresh].slice(-MAX_LOG_LINES);
        drawLogs();
      }
    } catch (error) {
      panel.innerHTML = `<p class="error">Serveur Studio injoignable : ${esc((error as Error).message)}</p>`;
    } finally {
      refreshing = false;
    }
  };

  panel.addEventListener('click', async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-action]',
    );
    if (!target || target.disabled) return;
    const action = target.dataset.action!;
    if (
      action === 'postgres/stop' &&
      !confirm('Arrêter Postgres ? (les données sont conservées)')
    )
      return;
    target.disabled = true;
    const run = api(`test-lab/${action}`, 'POST').catch((error: Error) =>
      alert(error.message),
    );
    await refresh();
    await run;
    await refresh();
  });
  root.querySelector('#clear-logs')!.addEventListener('click', async () => {
    await api('test-lab/logs/clear', 'POST');
    logs = [];
    drawLogs();
  });
  root
    .querySelectorAll<HTMLInputElement>('input[name="logf"]')
    .forEach((input) =>
      input.addEventListener('change', () => {
        filter = input.value;
        drawLogs();
      }),
    );

  // Light polling of the local server only, paused while the window is hidden.
  const tick = async () => {
    if (document.visibilityState === 'visible') await refresh();
    setTimeout(tick, 3000);
  };
  void tick();
}
