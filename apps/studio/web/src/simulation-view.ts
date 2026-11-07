// Studio Lab — the simulated stream, pure view. The simulated live of the shared session and, on the legacy Lab, the real
// Twitch chat ingestion and output, with their effective states. Nothing is decided here. A module's own switches live on
// its page (Mini-jeux: the mini-games page).

import { esc, ic } from './ds/ds.js';

export interface SimState {
  /** Production profile: no simulation at all. */
  production?: boolean;
  /** The Lab on the main Core: the chat is the simulator's, neither real ingestion nor real output exist. */
  chatFictional?: boolean;
  /** Shared live session (Tombola status); undefined = unavailable (Production profile / no Lab Core). */
  stream?: { source: string; started_at: string } | null;
  ingress?: {
    enabled: boolean;
    running: boolean;
    blocked: { message: string } | null;
    token_login: string | null;
  } | null;
  output?: {
    enabled: boolean;
    write_scope?: boolean;
    executor_absent?: boolean;
  } | null;
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

/** LeCroupier_ may write in the real Twitch chat right now. */
export const writesRealChat = (s: SimState) => s.output?.enabled === true;

type Tone = 'on' | 'off' | 'warn' | 'na';

/** The four effective states, as the top bar shows them. */
export function simStates(
  s: SimState,
): { key: string; label: string; tone: Tone }[] {
  const all: { key: string; label: string; tone: Tone }[] = [
    {
      key: 'live',
      label: 'Live',
      tone: s.stream === undefined ? 'na' : s.stream ? 'on' : 'off',
    },
    {
      key: 'ingress',
      label: 'Chat',
      tone: !s.ingress
        ? 'na'
        : s.ingress.enabled
          ? s.ingress.running
            ? 'on'
            : 'warn'
          : 'off',
    },
    {
      key: 'output',
      label: 'Sortie',
      tone: !s.output ? 'na' : s.output.enabled ? 'warn' : 'off',
    },
  ];
  return s.chatFictional ? all.filter((x) => x.key === 'live') : all;
}

/** The sidebar entry: the way to the Simulation page, one dot per service. */
export function simButton(s: SimState | null): string {
  const dots = s
    ? simStates(s)
        .map(
          (x) =>
            `<i class="sim-dot sim-dot--${x.tone}" title="${esc(x.label)}"></i>`,
        )
        .join('')
    : '';
  return `<a class="sim-toggle" href="?p=simulation" data-page="simulation" title="Ouvrir la simulation">${ic('flask')}<span>${s?.stream ? 'Live fictif en cours' : 'Simulation'}</span><em>${dots}</em></a>`;
}

const row = (
  label: string,
  state: string,
  tone: Tone,
  button: string,
  note = '',
) =>
  `<div class="sim-row"><span class="sim-dot sim-dot--${tone}"></span><div class="sim-what"><b>${label}</b><span>${state}</span>${note ? `<small>${note}</small>` : ''}</div>${button}</div>`;

const btn = (action: string, label: string, busy: boolean, danger = false) =>
  `<button type="button" class="d-btn sm ${danger ? 'bad' : ''}" data-sim="${action}" ${busy ? 'disabled' : ''}>${label}</button>`;

/** The panel's HTML. `busy` disables the buttons while an action runs; `error` is the last refusal. */
export function simPanel(
  s: SimState | null,
  busy = false,
  error: string | null = null,
): string {
  if (!s)
    return `<div class="sim-panel"><p class="d-note">Chargement…</p></div>`;
  const live =
    s.stream === undefined
      ? row('Live simulé', 'Indisponible (profil Lab uniquement)', 'na', '')
      : s.stream
        ? row(
            'Live',
            s.stream.source === 'twitch'
              ? `En direct (Twitch) depuis ${esc(hhmm(s.stream.started_at))}`
              : `En direct (simulation) depuis ${esc(hhmm(s.stream.started_at))}`,
            'on',
            s.stream.source === 'twitch'
              ? '<span class="d-note">fin par Twitch</span>'
              : btn('stream_end', 'Terminer', busy),
          )
        : row(
            'Live simulé',
            'Hors ligne',
            'off',
            btn('stream_start', 'Démarrer', busy),
          );
  const i = s.ingress;
  const ingress = !i
    ? row('Lecture du chat Twitch', 'Indisponible', 'na', '')
    : row(
        'Lecture du chat Twitch',
        i.enabled
          ? i.running
            ? `Activée · connectée${i.token_login ? ` (${esc(i.token_login)})` : ''}`
            : 'Activée · démarrage…'
          : 'OFF',
        i.enabled ? (i.running ? 'on' : 'warn') : 'off',
        i.blocked && !i.enabled
          ? ''
          : btn(
              i.enabled ? 'ingress_off' : 'ingress_on',
              i.enabled ? 'Désactiver' : 'Activer',
              busy,
            ),
        i.blocked ? esc(i.blocked.message) : 'Lit le vrai chat ; n’écrit rien.',
      );
  const o = s.output;
  const output = !o
    ? row('Sortie réelle LeCroupier_', 'Indisponible', 'na', '')
    : row(
        'Sortie réelle LeCroupier_',
        o.enabled
          ? `Activée · écrit dans le vrai chat${o.executor_absent ? ' (bot absent : lecture du chat coupée ?)' : ''}`
          : 'OFF',
        o.enabled ? 'warn' : 'off',
        btn(
          o.enabled ? 'output_off' : 'output_on',
          o.enabled ? 'Désactiver' : 'Activer',
          busy,
          !o.enabled,
        ),
        o.write_scope === false
          ? 'Autorisation d’écriture manquante pour LeCroupier_.'
          : 'Réponses Commandes, Jeu des mots, mini-jeux.',
      );
  return `<div class="sim-panel">
    ${writesRealChat(s) ? '<div class="sim-head"><span class="d-tag warn">Écrit dans le vrai chat</span></div>' : ''}
    ${error ? `<p class="d-note bad">${esc(error)}</p>` : ''}
    ${s.chatFictional ? live : `${live}${ingress}${output}`}
  </div>`;
}

/**
 * The confirmation to ask before an action, or null. Turning the real output on always asks; with the
 * output on, anything that makes LeCroupier_ answer real viewers asks too.
 */
export function confirmFor(action: string, s: SimState): string | null {
  if (action === 'output_on')
    return 'Activer la sortie réelle ? LeCroupier_ écrira dans le VRAI chat Twitch (Commandes, Jeu des mots, mini-jeux). Le bot de production répond aussi dans ce chat : évitez de tester un module qu’il exécute déjà.';
  if (!writesRealChat(s)) return null;
  if (action === 'stream_start')
    return 'La sortie réelle est ON : un live simulé fera publier le Jeu des mots dans le VRAI chat. Démarrer ?';
  if (action === 'ingress_on')
    return 'La sortie réelle est ON : les vrais viewers déclencheront des réponses de LeCroupier_ dans le VRAI chat. Activer l’ingestion ?';
  return null;
}
