// Points de chaîne V1 — Studio tab, pure part (tested): readable statuses, reward list, history. Every Twitch text
// (reward titles, viewer names, inputs) is untrusted and escaped. No JSON, no ids shown.

export type CpActionView =
  | { type: 'sound'; sound_id: string }
  | { type: 'effect_sound'; sound_id: string; volume: number }
  | { type: 'effect_video'; video_id: string; volume: number }
  | {
      type: 'obs_source';
      scene: string;
      source: string;
      visible: boolean;
      duration_ms?: number;
    }
  | {
      type: 'obs_filter';
      source: string;
      filter: string;
      enabled: boolean;
      duration_ms?: number;
    }
  | { type: 'obs_scene'; scene: string; duration_ms?: number }
  | { type: 'interaction'; interaction: 'creepy' | 'brb' };

/** The native interactions (written in Studio's code: nothing to configure but the reward). */
export const INTERACTIONS: Record<
  'creepy' | 'brb',
  { label: string; description: string }
> = {
  creepy: {
    label: 'Creepy',
    description:
      'Comme SAMMI : effet « Prowler Effect », son Prowler, scène « Creepy Effect » (animations OBS) pendant 4,2 s puis retour à la scène de départ. Seulement depuis Fullscreen, Just Chatting, PS5 ou Dessin ; plusieurs Creepy se suivent.',
  },
  brb: {
    label: 'BRB',
    description:
      'Comme SAMMI : capture de l’écran puis de la caméra, animation « We’ll be right back » par-dessus, micro et « Musique Isolée » coupés 6 s puis rétablis. Seulement depuis Dessin, Fullscreen ou PS5 ; un seul BRB à la fois ; nécessite le lecteur d’effets.',
  },
};

export interface CpReward {
  id: string;
  title: string;
  cost: number;
  twitch_enabled: boolean | null;
  listed_by_twitch: boolean;
  rule: { enabled: boolean; actions: CpActionView[]; version: number } | null;
}

export interface CpRedemption {
  source: string;
  redemption_id: string;
  reward: { title: string; cost: number };
  user: { display_name: string };
  user_input: string | null;
  received_at: string;
  status: 'ignored' | 'pending' | 'done' | 'partial' | 'failed';
  reason: string | null;
  actions: CpActionView[];
  results: {
    index: number;
    status: string;
    error?: string;
    /** Sound actions: in the Soundboard queue or being played (pending until the player reports the end). */
    progress?: 'queued' | 'playing';
  }[];
}

export interface CpState {
  settings: { enabled: boolean };
  rewards: CpReward[];
  recent: CpRedemption[];
  jobs_waiting: number;
  sounds: { id: string; label: string; enabled: boolean }[];
  environment: 'lab' | 'production';
  obs: { connected: boolean; pending_reverts: number };
  twitch: { scope: boolean; adapter_running: boolean; profile_note?: string };
  /** Studio's effects player (null: not wired in this Studio). */
  effects: {
    url: string;
    connected: boolean;
    audio: boolean;
    /** The OBS page runs the current files (absent: older Studio). */
    current?: boolean;
    playing: number;
    sounds: EffectSoundView[];
    videos: EffectSoundView[];
    /** Media of the native interactions (BRB video). */
    interaction_media?: { id: string; label: string; available: boolean }[];
  } | null;
  executor_error: string | null;
}

/** Effect sounds and videos (same shape; ids unique across both). */
export interface EffectSoundView {
  id: string;
  label: string;
  /** Original volume (default of a new action). */
  volume: number;
  /** Imported into Studio's storage. */
  available: boolean;
}

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const REASON: Record<string, string> = {
  automations_off: 'automatisations désactivées',
  no_rule: 'aucune action configurée',
  rule_disabled: 'règle désactivée',
  late: 'reçue trop tard',
};
const STATUS: Record<CpRedemption['status'], string> = {
  ignored: 'Ignorée',
  pending: 'En cours',
  done: 'Exécutée',
  partial: 'Partielle',
  failed: 'Échec',
};

/** Readable reasons (Core / Soundboard / OBS codes); OBS reasons are already in French. */
const ERRORS: Record<string, string> = {
  player_offline: 'lecteur Soundboard non ouvert ou son non activé',
  studio_offline: 'Studio absent',
  expired: 'non joué à temps (expiré)',
  playback_not_confirmed: 'lecture non confirmée par le lecteur',
  stopped_by_moderation: 'arrêté par la modération',
  soundboard_paused: 'Soundboard en pause',
  module_disabled: 'Soundboard désactivé',
  sound_disabled: 'son désactivé',
  sound_cooldown: 'son en cooldown',
  queue_full: 'file du Soundboard pleine',
  studio_absent: 'Studio absent',
  execution_unknown: 'exécution non confirmée',
  effects_player_offline: 'lecteur d’effets non ouvert (source OBS absente)',
  effects_player_muted: 'lecteur d’effets ouvert mais son bloqué',
  effects_player_outdated:
    'lecteur d’effets à recharger (ancienne version dans OBS : clic droit sur la source › Actualiser)',
  effects_player_unavailable: 'lecteur d’effets indisponible dans ce Studio',
  effects_busy: 'trop d’effets en même temps',
  effect_media_missing: 'fichier du son non importé dans Studio',
  effect_start_timeout: 'lecture non démarrée',
  file_missing: 'fichier du son illisible',
  playback_error: 'erreur pendant la lecture',
  start_timeout: 'lecture non démarrée',
  creepy_no_sound: 'Creepy exécuté sans son (lecteur d’effets indisponible)',
};
const PROGRESS = {
  queued: 'en attente du lecteur Soundboard',
  playing: 'en cours de lecture',
};

const seconds = (ms?: number) =>
  ms ? ` pendant ${String(ms / 1000).replace('.', ',')} s` : '';

/** Every effect of the catalogue (for labels). */
export const effectItems = (e: CpState['effects'] | undefined) => [
  ...(e?.sounds ?? []),
  ...(e?.videos ?? []),
];

/** One action in plain French. */
export function actionLabel(
  a: CpActionView,
  sounds: CpState['sounds'] = [],
  effects: EffectSoundView[] = [],
): string {
  switch (a.type) {
    case 'sound':
      return `Son « ${sounds.find((s) => s.id === a.sound_id)?.label ?? a.sound_id} »`;
    case 'effect_sound':
      return `Son d’effet « ${effects.find((s) => s.id === a.sound_id)?.label ?? a.sound_id} » (${a.volume} %)`;
    case 'effect_video':
      return `Vidéo d’effet « ${effects.find((s) => s.id === a.video_id)?.label ?? a.video_id} » (${a.volume} %)`;
    case 'obs_source':
      return `${a.visible ? 'Afficher' : 'Masquer'} « ${a.source} » (scène « ${a.scene} »)${seconds(a.duration_ms)}`;
    case 'obs_filter':
      return `${a.enabled ? 'Activer' : 'Désactiver'} le filtre « ${a.filter} » de « ${a.source} »${seconds(a.duration_ms)}`;
    case 'obs_scene':
      return a.duration_ms
        ? `Passer sur la scène « ${a.scene} »${seconds(a.duration_ms)}, puis revenir`
        : `Passer sur la scène « ${a.scene} »`;
    case 'interaction':
      return `Interaction « ${INTERACTIONS[a.interaction]?.label ?? a.interaction} »`;
  }
}

const chip = (cls: string, text: string, title = '') =>
  `<span class="cp-chip cp-chip--${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;

/** The effects player as Studio sees it (its OBS source). */
function effectsChip(e: CpState['effects']) {
  if (!e) return '';
  if (!e.connected)
    return chip(
      'warn',
      'Lecteur d’effets : non ouvert',
      'Ajoute la source navigateur du lecteur d’effets dans OBS (URL dans « Lecteur d’effets »).',
    );
  if (!e.audio) return chip('warn', 'Lecteur d’effets : son bloqué');
  if (e.current === false)
    return chip(
      'warn',
      'Lecteur d’effets : à recharger',
      'La source OBS du lecteur exécute une ancienne version : clic droit sur la source › Actualiser (elle se recharge seule ensuite).',
    );
  return chip(
    'on',
    e.playing
      ? `Lecteur d’effets : ${e.playing} en lecture`
      : 'Lecteur d’effets prêt',
  );
}

/** The effects player's OBS source (URL to copy) and the imported sounds. */
export function effectsView(e: CpState['effects']) {
  if (!e) return '';
  const all = [...effectItems(e), ...(e.interaction_media ?? [])];
  const missing = all.filter((s) => !s.available).length;
  return `<details class="cp-effects"><summary>Lecteur d’effets (source OBS)</summary>
    <p class="cp-muted">Une seule source navigateur OBS (1920 × 1080, plein cadre) joue les sons et vidéos d’effet, tout
      de suite et en superposition, hors Soundboard. URL de la source :</p>
    <input class="cp-url" readonly value="${esc(e.url)}"/>
    <p class="cp-muted">${all.length - missing} / ${all.length} média(s) importé(s)${
      missing
        ? ' — à importer : ' +
          all
            .filter((s) => !s.available)
            .map((s) => esc(s.label))
            .join(', ')
        : ''
    }.</p>
  </details>`;
}

/** The status chips of the header. */
export function statusView(s: CpState | null, error: string | null) {
  if (error) return `<p class="cp-error">${esc(error)}</p>`;
  if (!s) return '<p class="cp-muted">Chargement…</p>';
  const twitch =
    s.environment === 'production'
      ? chip(
          'off',
          'Twitch : bot de production',
          'En profil Production, les récompenses arrivent par le bot Twitch de production (option CHANNEL_POINTS_EVENTS).',
        )
      : !s.twitch.scope
        ? chip(
            'warn',
            'Twitch : autorisation manquante',
            'Le jeton broadcaster (raptoru_) n’a pas le droit channel:read:redemptions : aucune récompense n’est reçue.',
          )
        : s.twitch.adapter_running
          ? chip('on', 'Twitch : réception active')
          : chip(
              'warn',
              'Twitch : ingestion chat arrêtée',
              'Onglet Simulation › Ingestion chat Twitch.',
            );
  return `
    ${chip(s.settings.enabled ? 'on' : 'off', s.settings.enabled ? 'Automatisations : ON' : 'Automatisations : OFF')}
    ${twitch}
    ${chip(s.obs.connected ? 'on' : 'warn', s.obs.connected ? 'OBS connecté' : 'OBS non connecté')}
    ${effectsChip(s.effects)}
    ${s.obs.pending_reverts ? chip('off', `${s.obs.pending_reverts} effet(s) temporaire(s) en cours`) : ''}
    ${s.executor_error ? chip('warn', 'Exécution : Core injoignable', s.executor_error) : ''}`;
}

/** The rewards Twitch lists (left column), with their local rule. */
export function rewardsView(s: CpState, selected: string | null) {
  if (!s.rewards.length)
    return `<p class="cp-muted">Aucune récompense connue. Elles apparaissent dès que Twitch les liste (autorisation
      channel:read:redemptions) ou à la première utilisation par un viewer.</p>`;
  return `<ul class="cp-rewards">${s.rewards
    .map((r) => {
      const twitch =
        r.twitch_enabled === false
          ? '<span class="cp-tag">désactivée sur Twitch</span>'
          : r.twitch_enabled === null && r.listed_by_twitch
            ? '<span class="cp-tag cp-tag--warn">plus listée par Twitch</span>'
            : '';
      const rule = !r.rule
        ? '<span class="cp-tag">aucune action</span>'
        : r.rule.enabled
          ? `<span class="cp-tag cp-tag--on">${r.rule.actions.length} action(s)</span>`
          : '<span class="cp-tag">règle désactivée</span>';
      return `<li><button type="button" class="cp-reward${r.id === selected ? ' cp-reward--sel' : ''}" data-reward="${esc(r.id)}">
        <span class="cp-reward-title">${esc(r.title)}</span>
        <span class="cp-muted">${r.cost.toLocaleString('fr-FR')} pts</span>${twitch}${rule}</button></li>`;
    })
    .join('')}</ul>`;
}

const time = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** The last redemptions and what happened to each action. */
export function historyView(s: CpState) {
  if (!s.recent.length)
    return '<p class="cp-muted">Aucune récompense reçue.</p>';
  return `<table class="cp-history"><thead><tr><th>Heure</th><th>Viewer</th><th>Récompense</th><th>Résultat</th></tr></thead><tbody>${s.recent
    .map((r) => {
      const detail =
        r.status === 'ignored'
          ? esc(REASON[r.reason ?? ''] ?? r.reason ?? '')
          : r.results
              .map((x) => {
                const a = r.actions[x.index];
                const mark =
                  x.status === 'done'
                    ? '✓'
                    : x.status === 'pending'
                      ? '…'
                      : x.status === 'unknown'
                        ? '?'
                        : '✗';
                const note =
                  x.status === 'pending' && x.progress
                    ? a?.type === 'interaction'
                      ? 'en cours'
                      : PROGRESS[x.progress]
                    : x.error
                      ? (ERRORS[x.error] ?? x.error)
                      : '';
                return `${mark} ${a ? esc(actionLabel(a, s.sounds, effectItems(s.effects))) : ''}${note ? ` — ${esc(note)}` : ''}`;
              })
              .join('<br>');
      return `<tr class="cp-row--${r.status}">
        <td>${esc(time(r.received_at))}</td>
        <td>${r.source === 'simulation' ? '<i>Test Studio</i>' : esc(r.user.display_name)}${r.user_input ? `<br><small>« ${esc(r.user_input)} »</small>` : ''}</td>
        <td>${esc(r.reward.title)}</td>
        <td><b>${STATUS[r.status]}</b><br><small>${detail}</small></td></tr>`;
    })
    .join('')}</tbody></table>`;
}
