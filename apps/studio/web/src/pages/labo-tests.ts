// Test Lab : les services de test du Lab historique (présence, fidélité). Ne parle qu'au serveur Studio local, ne reçoit aucun secret.
import {
  confirmBox,
  esc,
  ic,
  page,
  patch,
  poller,
  run,
  seg,
  stateChip,
  type Page as DPage,
} from '../ds/ds.js';
import { labOnMainCore } from '../http.js';

const LOG_FILTERS: [string, string][] = [
  ['all', 'Tout'],
  ['core', 'Core'],
  ['bot', 'Bot'],
  ['presence', 'Présence'],
  ['preflight', 'Contrôle'],
  ['studio', 'Studio'],
  ['errors', 'Erreurs'],
];

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

const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('fr-FR') : 'jamais';
const kv = (rows: [string, string][]) =>
  `<dl class="d-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const flag = (v: string | undefined, want: string) =>
  `<span class="d-tag ${v === want ? 'ok' : 'bad'}">${esc(v ?? '?')}</span>`;
const soft = (v: string | undefined, want: string) =>
  `<span class="d-tag ${v === want ? 'ok' : 'warn'}">${esc(v ?? '?')}</span>`;
const button = (
  action: string,
  label: string,
  s: Status,
  cls = 'ghost',
  off = false,
) =>
  `<button type="button" class="d-btn sm ${cls}" data-action="${action}" ${s.busy || off ? 'disabled' : ''}>${esc(label)}</button>`;
const service = (title: string, chip: string, body: string, acts = '') =>
  `<section class="tl-s"><h2>${esc(title)}</h2><div>${chip}${body}</div><div class="tl-a">${acts}</div></section>`;

async function api<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const res = await fetch(`/api/${path}`, { method, headers: HEADERS });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function panelHtml(s: Status): string {
  const coreUp = s.core.health.ok;
  const botRunning = s.bot.state.startsWith('running');
  const r = s.presence.report;
  const noCredits =
    s.loyalty.flags.LOYALTY_PASSIVE_CREDITS === 'false' &&
    s.loyalty.flags.LOYALTY_EVENT_CREDITS === 'false';
  return `${s.busy ? `<p class="d-note">${esc(s.busy)}…</p>` : ''}
  ${
    s.sequence.action
      ? `<section class="tl-s"><h2>${esc(s.sequence.action)}</h2><ul class="tl-steps">${s.sequence.steps.map((st) => `<li>${ic(st.ok ? 'check' : 'x')}<b>${esc(st.step)}</b><small>${esc(st.detail)}</small></li>`).join('')}</ul><span></span></section>`
      : ''
  }
  ${service(
    'Postgres',
    stateChip(
      s.postgres.state === 'running'
        ? ''
        : s.postgres.state === 'stopped'
          ? 'off'
          : 'r',
      s.postgres.state === 'running'
        ? 'En marche'
        : s.postgres.state === 'stopped'
          ? 'Arrêté'
          : 'Erreur',
    ),
    `<p class="d-note">raptoru2-pg · ${esc(s.postgres.detail)}</p>`,
    `${button('postgres/start', 'Démarrer', s)}${button('postgres/stop', 'Arrêter', s)}`,
  )}
  ${service(
    'Core API',
    stateChip(
      coreUp ? '' : s.core.process === 'stopped' ? 'off' : 'r',
      coreUp
        ? 'En bonne santé'
        : s.core.process === 'stopped'
          ? 'Arrêté'
          : 'Hors service',
    ),
    `<details class="d-acc"><summary>Détails techniques</summary>${kv([
      [
        'Processus',
        `${esc(s.core.process)}${s.core.pid ? ` · pid ${s.core.pid}` : ''}`,
      ],
      ['/health', coreUp ? 'ok' : esc(s.core.health.error ?? 'ko')],
      ['Dernier contrôle', time(s.core.health.checkedAt)],
    ])}</details>`,
    `${button('core/start', 'Démarrer', s)}${button('core/stop', 'Arrêter', s)}${button('core/restart', 'Redémarrer', s)}`,
  )}
  ${service(
    'Autorisation Twitch',
    s.auth.lastPreflight
      ? s.auth.lastPreflight.ok
        ? stateChip('', 'Contrôle réussi')
        : stateChip('r', 'Contrôle refusé')
      : stateChip('off', 'Non vérifié'),
    `<details class="d-acc"><summary>Détails techniques</summary>${kv([
      [
        'Compte du jeton',
        esc(s.auth.login ?? (s.auth.tokenFile ? '?' : 'aucun jeton')),
      ],
      ['Droits', esc(s.auth.scopes.join(' ') || 'aucun')],
      [
        'Expiration enregistrée',
        s.auth.accessTokenFresh
          ? `jusqu’à ${time(s.auth.expiresAt)} · validité Twitch non vérifiée ici`
          : 'dépassée ou inconnue (renouvelée au démarrage)',
      ],
      [
        'Renouvellement',
        s.auth.hasRefreshToken ? 'disponible' : '<b>absent</b>',
      ],
      ['Dernier contrôle', time(s.auth.lastPreflight?.at)],
    ])}${s.auth.lastPreflight ? `<pre class="tl-pre">${esc(s.auth.lastPreflight.lines.join('\n'))}</pre>` : ''}</details>`,
    button('preflight', 'Contrôler', s),
  )}
  ${service(
    'Bot Twitch',
    botRunning
      ? stateChip('', 'En marche')
      : s.bot.state === 'error'
        ? stateChip('r', 'Erreur')
        : stateChip('off', 'Arrêté'),
    `${s.bot.guard ? `<p class="d-note bad">${esc(s.bot.guard)}</p>` : ''}<details class="d-acc"><summary>Détails techniques</summary>${kv(
      [
        [
          'Processus',
          `${esc(s.bot.state)}${s.bot.pid ? ` · pid ${s.bot.pid}` : ''}`,
        ],
        ['DAILY_CHAT_COMMANDS', flag(s.bot.flags.DAILY_CHAT_COMMANDS, 'false')],
        [
          'LOYALTY_CHAT_COMMANDS',
          flag(s.bot.flags.LOYALTY_CHAT_COMMANDS, 'false'),
        ],
        ['PRESENCE_SHADOW', flag(s.bot.flags.PRESENCE_SHADOW, 'true')],
        ['Connexion Twitch', esc(s.bot.twitch)],
        ['Dernière erreur', esc(s.bot.lastError ?? 'aucune')],
      ],
    )}</details>`,
    `${button('bot/start', 'Démarrer', s, 'ghost', !!s.bot.guard)}${button('bot/stop', 'Arrêter', s)}${button('bot/restart', 'Redémarrer', s, 'ghost', !!s.bot.guard)}`,
  )}
  ${service(
    'Fidélité',
    noCredits
      ? stateChip('', 'Aucun crédit versé')
      : stateChip('r', 'Crédits actifs'),
    `${s.loyalty.creditsGuard ? `<p class="d-note bad">${esc(s.loyalty.creditsGuard)}</p>` : ''}<details class="d-acc"><summary>Détails techniques</summary>${kv(
      [
        ['LOYALTY_PREVIEW', soft(s.loyalty.flags.LOYALTY_PREVIEW, 'true')],
        [
          'LOYALTY_TWITCH_EVENTS',
          soft(s.loyalty.flags.LOYALTY_TWITCH_EVENTS, 'true'),
        ],
        [
          'LOYALTY_PASSIVE_CREDITS',
          flag(s.loyalty.flags.LOYALTY_PASSIVE_CREDITS, 'false'),
        ],
        [
          'LOYALTY_EVENT_CREDITS',
          flag(s.loyalty.flags.LOYALTY_EVENT_CREDITS, 'false'),
        ],
        ['Jeton du streamer', esc(s.loyalty.broadcasterToken.login ?? 'aucun')],
        ['Événements', esc(s.loyalty.events)],
        ['Relevé des abonnés', esc(s.loyalty.lastSubSnapshot ?? 'aucun')],
        [
          'Exclus du passif',
          esc(
            s.loyalty.passiveExclusions
              ? s.loyalty.passiveExclusions.join(', ') || 'aucun'
              : 'Core arrêté',
          ),
        ],
      ],
    )}<p class="d-note">Rapport : npm run loyalty:report -w @raptoru/core-api -- --latest</p></details>`,
  )}
  ${service(
    'Présence',
    botRunning
      ? stateChip(
          s.presence.worker.startsWith('tracking') ? '' : 'w',
          s.presence.worker,
        )
      : stateChip('off', 'Arrêtée'),
    `<details class="d-acc"><summary>Détails techniques</summary>${kv([
      ['Dernier relevé', time(s.presence.lastSnapshotAt)],
      ['Chatters', esc(s.presence.lastChatters ?? 'inconnu')],
      ['Dernière erreur', esc(s.presence.lastError ?? 'aucune')],
      ...(r && r.available
        ? ([
            [
              'Stream',
              `${esc(r.streamId)} · ${r.live ? 'en direct' : 'terminé'}`,
            ],
            ['Durée', `${r.durationMinutes} min`],
            ['Cycles', `${r.cycles.ok} réussis / ${r.cycles.failed} ratés`],
            ['Couverture', `${r.cycles.coveragePercent} %`],
            ['Viewers uniques', String(r.uniqueViewers)],
            ['Dernier relevé réussi', time(r.cycles.lastOkAt)],
            [
              'Dernière erreur Twitch',
              r.lastError
                ? esc(
                    `${r.lastError.errorKind} ${r.lastError.httpStatus ?? ''} · ${time(r.lastError.observedAt)}`,
                  )
                : 'aucune',
            ],
          ] as [string, string][])
        : ([
            [
              'Rapport',
              coreUp
                ? 'aucune donnée de présence pour l’instant'
                : 'Core arrêté',
            ],
          ] as [string, string][])),
    ])}<p class="d-note">Rapport complet : npm run presence:report -w @raptoru/core-api -- --latest</p></details>`,
  )}`;
}

/** Services de test du Lab historique ; sur le vrai Core, Studio prépare le Lab lui-même. */
export function mountTestLab(root: HTMLElement) {
  const p = page(root, { title: 'Test Lab' });
  let tick: ReturnType<typeof poller> | null = null;
  let visible = false;
  void labOnMainCore().then((main) => {
    if (main) {
      p.body.innerHTML =
        '<p class="d-empty">Sans objet sur ce Lab : Studio le prépare et le surveille lui-même (page Système), et le bot réel ne peut pas démarrer d’ici.</p>';
      return;
    }
    tick = mountPanel(p);
    if (visible) tick.start();
  });
  return {
    setVisible(v: boolean) {
      visible = v;
      if (v) tick?.start();
      else tick?.stop();
    },
  };
}

function mountPanel(p: DPage) {
  patch(
    p.state,
    stateChip('', 'Sans portefeuille, sans crédits, aucun message chat'),
  );
  p.actions.innerHTML = `<span data-z="all"></span>`;
  p.body.innerHTML = `<div class="tl"><div data-z="panel"><p class="d-note">Connexion au serveur Studio…</p></div>
    <section><div class="tl-l">${seg('data-logf', LOG_FILTERS, 'all')}<span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-clear>Vider</button></div><pre class="tl-log" data-z="log"></pre></section></div>`;
  const panel = p.body.querySelector<HTMLElement>('[data-z="panel"]')!;
  const logEl = p.body.querySelector<HTMLElement>('[data-z="log"]')!;
  const all = p.actions.querySelector<HTMLElement>('[data-z="all"]')!;
  let logs: LogLine[] = [];
  let lastSeq = 0;
  let filter = 'all';

  const drawLogs = () => {
    const shown = logs.filter(
      (l) =>
        filter === 'all' ||
        (filter === 'errors' ? l.level === 'error' : l.source === filter),
    );
    logEl.innerHTML = shown
      .map(
        (l) =>
          `<span class="${esc(l.level)}">${time(l.at)} [${esc(l.source)}] ${esc(l.text)}</span>`,
      )
      .join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  };

  const tick = poller(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const s = await api<Status>('test-lab/status');
      patch(panel, panelHtml(s));
      patch(
        all,
        `<button type="button" class="d-btn pri sm" data-action="start-all" ${s.busy ? 'disabled' : ''}>Tout démarrer</button> <button type="button" class="d-btn sm" data-action="stop-all" ${s.busy ? 'disabled' : ''}>Tout arrêter</button>`,
      );
      const fresh = await api<LogLine[]>(`test-lab/logs?since=${lastSeq}`);
      if (fresh.length) {
        lastSeq = fresh.at(-1)!.seq;
        logs = [...logs, ...fresh].slice(-MAX_LOG_LINES);
        drawLogs();
      }
    } catch (error) {
      patch(
        panel,
        `<p class="d-note bad">Serveur Studio injoignable : ${esc((error as Error).message)}</p>`,
      );
    }
  }, 3000);

  p.root.addEventListener('click', async (event) => {
    const t = event.target as HTMLElement;
    if (t.closest('[data-clear]')) {
      await api('test-lab/logs/clear', 'POST').catch(() => {});
      logs = [];
      return drawLogs();
    }
    const f = t.closest<HTMLElement>('[data-logf]')?.dataset.logf;
    if (f) {
      filter = f;
      p.body.querySelector<HTMLElement>('.d-seg')!.outerHTML = seg(
        'data-logf',
        LOG_FILTERS,
        f,
      );
      return drawLogs();
    }
    const target = t.closest<HTMLButtonElement>('button[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action!;
    if (
      action === 'postgres/stop' &&
      !(await confirmBox({
        title: 'Arrêter Postgres ?',
        body: 'Les données sont conservées.',
        yes: 'Arrêter',
        no: 'Garder',
      }))
    )
      return;
    target.disabled = true;
    await run(target, () => api(`test-lab/${action}`, 'POST'));
    tick.now();
  });
  return tick;
}
