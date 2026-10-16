// Studio Lab — « Simulation » tab: the chat as a viewer would see it, pure view. Incoming messages come from
// Core's memory of the Lab chat ingress (simulator and real chat, with the modules' outcomes); LeCroupier_'s
// answers are the real texts Core queued in cmd_steps (Commandes, Jeu des mots, mini-jeux). Nothing is
// recomputed here, and reading never changes a step: « envoyé » only when Twitch acknowledged it.

export interface ChatIn {
  seq: number;
  message_id: string;
  received_at: string;
  source: 'twitch' | 'simulator';
  chatter: { id: string; display_name: string; role: string };
  text: string;
  handled: { module: string; outcome: string; replayed?: boolean }[];
  error?: string;
}

export interface StepOut {
  step_id: string;
  origin?: 'commands' | 'word_game' | 'mini_game';
  kind: string;
  status: string;
  params: { mode?: string; text?: string };
  created_at: string;
  available_at: string;
  error?: { code?: string } | null;
  twitch_message_id?: string | null;
  /** Times the chat executor took it (0 = never taken). */
  attempt_count?: number;
}

export type ChatItem =
  | { type: 'in'; key: string; at: number; msg: ChatIn }
  | { type: 'out'; key: string; at: number; step: StepOut };

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const MODULE_FR: Record<string, string> = {
  raffle: 'Tombola',
  commands: 'Commandes',
  word_game: 'Jeu des mots',
  mini_games: 'Mini-jeux',
};
const OUTCOME_FR: Record<string, string> = {
  joined: 'inscrit',
  already_joined: 'déjà inscrit',
  cancelled: 'Tombola annulée',
  word_game_win: 'mot trouvé',
  word_game_command: 'commande',
  mini_game_played: 'partie jouée',
  duel_challenged: 'défi lancé',
  duel_resolved: 'duel joué',
  duel_denied: 'défi refusé',
  duel_cancelled: 'défi annulé',
  duel_refused: 'refusé',
  accepted: 'acceptée',
  rejected: 'refusée',
  refused: 'refusée',
};
const ORIGIN_FR: Record<string, string> = {
  commands: 'Commandes',
  word_game: 'Jeu des mots',
  mini_game: 'Mini-jeux',
};

/**
 * Incoming messages and LeCroupier_'s answers in one conversation, oldest first, one item per message id /
 * step id (a re-read never duplicates). Items before `clearedAt` (the local « Vider ») are hidden.
 */
export function chatTimeline(
  inbox: ChatIn[],
  steps: StepOut[],
  clearedAt = 0,
): ChatItem[] {
  const items = new Map<string, ChatItem>();
  for (const msg of inbox)
    items.set(`in:${msg.message_id}`, {
      type: 'in',
      key: `in:${msg.message_id}`,
      at: Date.parse(msg.received_at),
      msg,
    });
  for (const step of steps)
    if (step.params?.text)
      items.set(`out:${step.step_id}`, {
        type: 'out',
        key: `out:${step.step_id}`,
        at: Date.parse(step.created_at),
        step,
      });
  return [...items.values()]
    .filter((i) => i.at >= clearedAt)
    .sort(
      (a, b) =>
        a.at - b.at || (a.type === b.type ? 0 : a.type === 'in' ? -1 : 1),
    );
}

/** Never taken by the executor while the real output is OFF: a simulation, not a failure. */
const SIMULATED = {
  label: 'Simulé · non envoyé sur Twitch',
  tone: 'off',
} as const;

/**
 * What happened to an answer, honestly: sent only with Twitch's proof. With the real output OFF, an
 * answer the executor never took reads « Simulé » (queued or expired: Core keeps its real status); an
 * answer that was taken, or that failed while the output was ON, keeps its failure.
 */
export function stepState(
  s: StepOut,
  outputOn: boolean,
  now: number,
): { label: string; tone: 'ok' | 'wait' | 'off' | 'bad' } {
  switch (s.status) {
    case 'succeeded':
      return { label: 'envoyé sur Twitch', tone: 'ok' };
    case 'queued':
    case 'claimed':
    case 'running': {
      if (!outputOn && s.status === 'queued') return SIMULATED;
      const wait = Math.ceil((Date.parse(s.available_at) - now) / 1000);
      return {
        label: wait > 0 ? `envoi dans ${wait} s` : 'envoi en cours',
        tone: 'wait',
      };
    }
    case 'expired':
      return !outputOn && !s.attempt_count
        ? SIMULATED
        : { label: 'expiré · jamais envoyé', tone: 'off' };
    case 'skipped':
      return {
        label: `non envoyé${s.error?.code ? ` (${s.error.code})` : ''}`,
        tone: 'off',
      };
    case 'cancelled':
      return { label: 'annulé', tone: 'off' };
    default:
      return {
        label: `échec d’envoi${s.error?.code ? ` (${s.error.code})` : ''}`,
        tone: 'bad',
      };
  }
}

const ROLE_FR: Record<string, string> = {
  broadcaster: 'streamer',
  moderator: 'modo',
};

/** The conversation's HTML. */
export function chatView(
  items: ChatItem[],
  outputOn: boolean,
  now: number,
): string {
  if (!items.length)
    return '<p class="sc-empty">Aucun message. Envoyez un message ci-dessous : il passe par la même entrée Core que le vrai chat.</p>';
  return items
    .map((i) => {
      if (i.type === 'in') {
        const m = i.msg;
        const tags = [
          `<span class="sc-src sc-src--${m.source === 'twitch' ? 'twitch' : 'sim'}">${m.source === 'twitch' ? 'Twitch' : 'Simulé'}</span>`,
          ROLE_FR[m.chatter.role]
            ? `<span class="sc-tag">${ROLE_FR[m.chatter.role]}</span>`
            : '',
        ].join('');
        const result = m.handled.length
          ? m.handled
              .map(
                (h) =>
                  `<span class="sc-res">${esc(MODULE_FR[h.module] ?? h.module)} : ${esc(OUTCOME_FR[h.outcome] ?? h.outcome)}${h.replayed ? ' (déjà traité)' : ''}</span>`,
              )
              .join('')
          : '';
        return `<div class="sc-msg${m.source === 'twitch' ? ' sc-msg--twitch' : ''}" data-key="${esc(i.key)}"><div class="sc-line"><time>${time(i.at)}</time>${tags}<b class="sc-who">${esc(m.chatter.display_name)}</b><span class="sc-text">${esc(m.text)}</span></div>${result || m.error ? `<div class="sc-meta">${result}${m.error ? `<span class="sc-res sc-res--bad">refusé : ${esc(m.error)}</span>` : ''}</div>` : ''}</div>`;
      }
      const s = i.step;
      const st = stepState(s, outputOn, now);
      return `<div class="sc-msg sc-msg--bot" data-key="${esc(i.key)}"><div class="sc-line"><time>${time(i.at)}</time><span class="sc-src sc-src--bot">${esc(ORIGIN_FR[s.origin ?? 'commands'] ?? s.origin)}</span><b class="sc-who sc-who--bot">LeCroupier_</b><span class="sc-text">${esc(s.params.text)}</span></div><div class="sc-meta"><span class="sc-state sc-state--${st.tone}" title="Statut Core : ${esc(s.status)}">${esc(st.label)}</span>${s.params.mode === 'announce' ? '<span class="sc-tag">annonce</span>' : ''}</div></div>`;
    })
    .join('');
}
