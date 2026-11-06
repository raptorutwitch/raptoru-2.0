// Studio Lab — « Simulation de stream » panel, pure view. Gathers the existing switches (simulated live of
// the shared session, real Twitch chat ingestion, real chat output through LeCroupier_, mini-games) with
// their effective states. Nothing is decided here; the detailed settings stay in their own tabs.

import { esc, ic } from './ds/ds.js';

export interface SimState {
  /** Production profile: the mini-games switch below is the viewers' real one. */
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
  games?: { enabled: boolean } | null;
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
    {
      key: 'games',
      label: 'Jeux',
      tone: !s.games ? 'na' : s.games.enabled ? 'on' : 'off',
    },
  ];
  return s.chatFictional
    ? all.filter((x) => x.key === 'live' || x.key === 'games')
    : all;
}

/** The top bar button: one dot per service. */
export function simButton(s: SimState | null, open: boolean): string {
  const dots = s
    ? simStates(s)
        .map(
          (x) =>
            `<i class="sim-dot sim-dot--${x.tone}" title="${esc(x.label)}"></i>`,
        )
        .join('')
    : '';
  return `<button type="button" class="sim-toggle${open ? ' is-open' : ''}" data-sim="panel" aria-expanded="${open}" title="Simulation">${ic('flask')}<span>Simulation</span><em>${dots}</em></button>`;
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
    ? row('Ingestion chat Twitch', 'Indisponible', 'na', '')
    : row(
        'Ingestion chat Twitch',
        i.enabled
          ? i.running
            ? `ON · connectée${i.token_login ? ` (${esc(i.token_login)})` : ''}`
            : 'ON · démarrage…'
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
          ? `ON · écrit dans le vrai chat${o.executor_absent ? ' (exécuteur absent : ingestion coupée ?)' : ''}`
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
  const g = s.games;
  const gamesLabel = s.production
    ? 'Mini-jeux Roulette / Slot / Duel · PRODUCTION'
    : 'Mini-jeux Roulette / Slot / Duel';
  const games = !g
    ? row(gamesLabel, 'Indisponible', 'na', '')
    : row(
        gamesLabel,
        g.enabled
          ? 'ON · !roulette, !slots et !duel répondent pendant un live'
          : 'OFF',
        g.enabled ? 'on' : 'off',
        btn(
          g.enabled ? 'games_off' : 'games_on',
          g.enabled ? 'Désactiver' : 'Activer',
          busy,
        ),
        s.production
          ? 'Interrupteur réel des viewers (vrais Jetons) : ce n’est pas une simulation.'
          : 'Profil Lab : Jetons fictifs.',
      );
  return `<div class="sim-panel" role="dialog" aria-label="Simulation de stream">
    <div class="sim-head"><b>Simulation de stream</b><span class="d-tag ${writesRealChat(s) ? 'warn' : 'ok'}">${writesRealChat(s) ? 'Écrit dans le vrai chat' : 'Aucune écriture dans le vrai chat'}</span></div>
    ${error ? `<p class="d-note bad">${esc(error)}</p>` : ''}
    ${s.chatFictional ? `${live}${games}` : `${live}${ingress}${output}${games}`}
    <p class="d-note">Réglages détaillés : pages Tombola, Commandes, Jeu des mots.</p>
  </div>`;
}

/**
 * The confirmation to ask before an action, or null. Turning the real output on always asks; with the
 * output on, anything that makes LeCroupier_ answer real viewers asks too.
 */
export function confirmFor(action: string, s: SimState): string | null {
  if (action === 'output_on')
    return 'Activer la sortie réelle ? LeCroupier_ écrira dans le VRAI chat Twitch (Commandes, Jeu des mots, mini-jeux). Le bot de production répond aussi dans ce chat : évitez de tester un module qu’il exécute déjà.';
  if (s.production && (action === 'games_on' || action === 'games_off'))
    return action === 'games_on'
      ? 'Profil Production : activer Roulette / Slot / Duel pour les vrais viewers (vrais Jetons, pendant les lives) ?'
      : 'Profil Production : couper Roulette / Slot / Duel pour les vrais viewers ?';
  if (!writesRealChat(s)) return null;
  if (action === 'stream_start')
    return 'La sortie réelle est ON : un live simulé fera publier le Jeu des mots dans le VRAI chat. Démarrer ?';
  if (action === 'ingress_on')
    return 'La sortie réelle est ON : les vrais viewers déclencheront des réponses de LeCroupier_ dans le VRAI chat. Activer l’ingestion ?';
  if (action === 'games_on')
    return 'La sortie réelle est ON : !roulette et !slots répondront dans le VRAI chat (pensez à couper StreamElements). Activer les mini-jeux ?';
  return null;
}
