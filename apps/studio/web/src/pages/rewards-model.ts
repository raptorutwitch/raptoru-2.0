// Points de chaîne : la partie pure (testée) partagée par les pages Récompenses Twitch et Effets. Les textes viennent de Twitch :
// chacun est échappé. Le Core décide et enregistre, ces fonctions lisent ce qu'il a décidé, sans identifiant ni JSON à l'écran.
import { COLOR_CAM, COLOR_CAM_PRESETS, FX_CAM } from '@raptoru/schemas';
import { esc, fmt, ic, pp, stateChip, type IcName } from '../ds/ds.js';

export type CpInteraction =
  | 'creepy'
  | 'brb'
  | 'fx_cam'
  | 'color_cam'
  | 'random_ban'
  | 'song_request'
  | 'song_skip';

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
  /** Crédits accordés au viewer : le nombre vient de la règle, jamais d'un défaut. */
  | {
      type: 'credits';
      currency: 'credits_tts' | 'credits_soundboard';
      amount: number;
    }
  | {
      type: 'interaction';
      interaction: CpInteraction;
      /** fx_cam : l'effet que le Core a reconnu dans le texte du viewer. */
      effect?: string;
      /** color_cam : la couleur que le Core a reconnue dans le texte du viewer. */
      color?: string;
    };

/** Les interactions natives : écrites dans Studio, il n'y a que la récompense à relier. */
export const INTERACTIONS: Record<
  CpInteraction,
  { label: string; description: string; page: string; icon: IcName }
> = {
  creepy: {
    label: 'Creepy',
    page: 'effects',
    icon: 'sparkle',
    description:
      'Effet « Prowler Effect », son Prowler, scène « Creepy Effect » (animations OBS) pendant 4,2 s, puis retour à la scène de départ. Seulement depuis Fullscreen, Just Chatting, PS5 ou Dessin ; plusieurs Creepy se suivent.',
  },
  brb: {
    label: 'BRB',
    page: 'effects',
    icon: 'clock',
    description:
      'Capture de l’écran puis de la caméra, animation « We’ll be right back » par-dessus, micro et « Musique Isolée » coupés 6 s puis rétablis. Seulement depuis Dessin, Fullscreen ou PS5 ; un seul BRB à la fois ; nécessite le lecteur d’effets.',
  },
  fx_cam: {
    label: 'FX Cam',
    page: 'effects',
    icon: 'filter',
    description: `Le viewer écrit le nom d’un effet ; son filtre OBS (shader) sur « ${FX_CAM.source} » est activé ${FX_CAM.durationMs / 1000} s puis désactivé. Effets reconnus (majuscules et espaces ignorés) : ${FX_CAM.effects.join(', ')}. Seulement depuis Dessin ou Fullscreen ; le même effet déjà actif est refusé, des effets différents se cumulent.`,
  },
  color_cam: {
    label: 'Couleur Cam',
    page: 'effects',
    icon: 'image',
    description: `Le viewer écrit une couleur ; le cadre Shushu (filtre « ${COLOR_CAM.filter} » de « ${COLOR_CAM.source} ») y passe en ${COLOR_CAM.transitionMs / 1000} s puis la garde jusqu’à la suivante. Majuscules, accents et espaces ignorés ; « aléatoire » ou « random » au hasard. Seulement depuis Dessin ou Fullscreen ; une nouvelle couleur reprend la transition en cours.`,
  },
  random_ban: {
    label: 'Random Ban',
    page: 'random-ban',
    icon: 'ban',
    description:
      'Ban aléatoire : un chatter présent (lurkers compris) qui suit la chaîne, ni modérateur ni déjà banni, tiré au hasard ; timeout par LeCroupier_ (3 min abonné, 5 min sinon), puis l’animation historique. Aucun éligible : flop. Le test fait un tirage à blanc, jamais de timeout.',
  },
  song_request: {
    label: 'Demande de musique (Spotify)',
    page: 'spotify',
    icon: 'music',
    description:
      'Le viewer écrit un titre et un artiste, ou un lien Spotify ; Raptoru cherche le titre et l’ajoute à la file Spotify (2 demandes en attente max, 10 min entre deux, 10 min de durée max). Refusée : message dans le chat et remboursement si la récompense est celle de Raptoru.',
  },
  song_skip: {
    label: 'Passer la musique (Spotify)',
    page: 'spotify',
    icon: 'skip',
    description:
      'Passe la musique en cours sur Spotify (la demande correspondante devient « passée »). Échec : remboursement si la récompense est celle de Raptoru.',
  },
};

export const ACTION_TYPES: {
  id: CpActionView['type'];
  label: string;
  icon: IcName;
}[] = [
  { id: 'effect_sound', label: 'Son d’effet (lecture immédiate)', icon: 'vol' },
  {
    id: 'effect_video',
    label: 'Vidéo d’effet (lecture immédiate)',
    icon: 'film',
  },
  { id: 'interaction', label: 'Interaction native', icon: 'sparkle' },
  { id: 'sound', label: 'Jouer un son (Soundboard)', icon: 'wave' },
  {
    id: 'obs_source',
    label: 'Afficher ou masquer une source OBS',
    icon: 'eye',
  },
  {
    id: 'obs_filter',
    label: 'Activer ou désactiver un filtre OBS',
    icon: 'filter',
  },
  { id: 'obs_scene', label: 'Changer de scène OBS', icon: 'layers' },
  {
    id: 'credits',
    label: 'Accorder des crédits (TTS ou Soundboard)',
    icon: 'coin',
  },
];

export const actionIcon = (a: CpActionView): IcName =>
  a.type === 'interaction'
    ? (INTERACTIONS[a.interaction]?.icon ?? 'sparkle')
    : (ACTION_TYPES.find((t) => t.id === a.type)?.icon ?? 'sparkle');

export function blankAction(type: CpActionView['type']): CpActionView {
  switch (type) {
    case 'effect_sound':
      return { type, sound_id: '', volume: 100 };
    case 'effect_video':
      return { type, video_id: '', volume: 100 };
    case 'sound':
      return { type, sound_id: '' };
    case 'obs_source':
      return { type, scene: '', source: '', visible: true };
    case 'obs_filter':
      return { type, source: '', filter: '', enabled: true };
    case 'interaction':
      return { type, interaction: 'creepy' };
    case 'credits':
      // Pas de nombre par défaut : le streamer le choisit, le Core refuse 0.
      return { type, currency: 'credits_tts', amount: 0 };
    case 'obs_scene':
      return { type, scene: '' };
  }
}

export interface CpReward {
  id: string;
  title: string;
  cost: number;
  prompt?: string | null;
  twitch_enabled: boolean | null;
  user_input_required?: boolean;
  listed_by_twitch: boolean;
  rule: { enabled: boolean; actions: CpActionView[]; version: number } | null;
}

export interface CpRedemption {
  source: string;
  redemption_id: string;
  reward: { id?: string; title: string; cost: number };
  user: { id?: string; display_name: string };
  user_input: string | null;
  twitch_status?: string;
  received_at: string;
  status: 'ignored' | 'pending' | 'done' | 'partial' | 'failed';
  reason: string | null;
  actions: CpActionView[];
  results: {
    index: number;
    status: string;
    error?: string;
    /** Sons : dans la file du Soundboard ou en lecture, jusqu'au compte rendu du lecteur. */
    progress?: 'queued' | 'playing';
    /** Random Ban : ce qui s'est passé à la fin (cible et durée, flop, simulation). */
    detail?: string;
  }[];
}

/** Sons et vidéos d'effet (même forme ; identifiants uniques entre les deux). */
export interface EffectSoundView {
  id: string;
  label: string;
  /** Volume d'origine : le défaut d'une nouvelle action. */
  volume: number;
  /** Importé dans le stockage de Studio. */
  available: boolean;
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
  /** Le lecteur d'effets de Studio (null : absent de ce Studio). */
  effects: {
    url: string;
    connected: boolean;
    audio: boolean;
    /** La page dans OBS exécute les fichiers à jour (absent : ancien Studio). */
    current?: boolean;
    playing: number;
    sounds: EffectSoundView[];
    videos: EffectSoundView[];
    /** Médias des interactions natives (vidéo BRB…). */
    interaction_media?: { id: string; label: string; available: boolean }[];
  } | null;
  executor_error: string | null;
}

const REASON: Record<string, string> = {
  automations_off: 'automatisations désactivées',
  no_rule: 'aucune action configurée',
  rule_disabled: 'règle désactivée',
  late: 'reçue trop tard',
  stream_offline:
    'hors live : rien exécuté, seuls les crédits sont accordés (remboursement demandé à Twitch si la récompense est créée par Raptoru)',
};
const STATUS: Record<CpRedemption['status'], [string, string]> = {
  ignored: ['Ignorée', 'off'],
  pending: ['En cours', ''],
  done: ['Exécutée', 'ok'],
  partial: ['Partielle', 'warn'],
  failed: ['Échec', 'bad'],
};

/** Les raisons lisibles (codes du Core, du Soundboard, d'OBS) ; celles d'OBS sont déjà en français. */
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
    'lecteur d’effets à recharger (ancienne version dans OBS : clic droit sur la source, Actualiser)',
  effects_player_unavailable: 'lecteur d’effets indisponible dans ce Studio',
  effects_busy: 'trop d’effets en même temps',
  effect_media_missing: 'fichier du son non importé dans Studio',
  effect_start_timeout: 'lecture non démarrée',
  file_missing: 'fichier du son illisible',
  playback_error: 'erreur pendant la lecture',
  start_timeout: 'lecture non démarrée',
  creepy_no_sound: 'Creepy exécuté sans son (lecteur d’effets indisponible)',
  color_cam_unknown:
    'couleur inconnue, aucun remboursement possible : récompense créée par SAMMI',
  random_ban_unavailable: 'Random Ban indisponible sur ce profil',
  fx_cam_unknown: `effet inconnu (effets : ${FX_CAM.effects.join(', ')}), aucun remboursement possible : récompense créée par SAMMI`,
};
const PROGRESS = {
  queued: 'en attente du lecteur Soundboard',
  playing: 'en cours de lecture',
};

const seconds = (ms?: number) =>
  ms ? ` pendant ${String(ms / 1000).replace('.', ',')} s` : '';

/** Tout le catalogue d'effets (pour les libellés). */
export const effectItems = (e: CpState['effects'] | undefined) => [
  ...(e?.sounds ?? []),
  ...(e?.videos ?? []),
];

/** Une action, en français simple. */
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
    case 'credits':
      return `Accorder ${a.amount} ${a.currency === 'credits_tts' ? 'Crédit(s) TTS' : 'Crédit(s) Soundboard'} au viewer`;
    case 'interaction':
      return a.interaction === 'fx_cam' && a.effect
        ? `FX Cam « ${a.effect} »`
        : a.interaction === 'color_cam' && a.color
          ? `Couleur Cam « ${a.color} »`
          : `Interaction « ${INTERACTIONS[a.interaction]?.label ?? a.interaction} »`;
  }
}

/** Un essai depuis Studio passe en `source: simulation` : crédits, Random Ban et Spotify à blanc ; OBS, sons et effets réels. */
export const isDry = (a: CpActionView) =>
  a.type === 'credits' ||
  (a.type === 'interaction' &&
    ['random_ban', 'song_request', 'song_skip'].includes(a.interaction));

/** Pour chaque action, ce qu'un essai depuis Studio fait vraiment. */
export function runNowLines(
  actions: CpActionView[],
  sounds: CpState['sounds'] = [],
  effects: EffectSoundView[] = [],
) {
  return actions.map(
    (a) =>
      `• ${actionLabel(a, sounds, effects)} : ${
        isDry(a)
          ? a.type === 'credits'
            ? 'à blanc (aucun crédit versé)'
            : a.type === 'interaction' && a.interaction === 'random_ban'
              ? 'à blanc (vraie recherche Twitch, aucun timeout)'
              : 'à blanc (rien n’est envoyé à Spotify)'
          : a.type === 'sound'
            ? 'RÉEL (joué par le lecteur Soundboard du stream)'
            : 'RÉEL (OBS ou lecteur d’effets du stream)'
      }`,
  );
}
export function runNowConfirm(
  actions: CpActionView[],
  sounds: CpState['sounds'] = [],
  effects: EffectSoundView[] = [],
): string {
  return `${runNowLines(actions, sounds, effects).join('\n')}\n\nAucun point de chaîne n’est utilisé ; l’exécution est inscrite dans l’historique.`;
}

/** Les confirmations de l'interrupteur (page Récompenses Twitch, Régie) : achats, remboursements. */
export const CP_ON = {
  title: 'Activer les automatisations ?',
  body: 'Les vraies récompenses de ta chaîne déclencheront les actions configurées (OBS, sons, interactions). Les achats faits pendant la coupure ne sont pas rejoués.',
  yes: 'Activer',
};
export const CP_OFF = {
  title: 'Couper les automatisations ?',
  body: 'Les récompenses ne déclenchent plus leurs actions (OBS, sons, interactions, crédits TTS et Soundboard). Ces achats restent dans l’historique comme « automatisations coupées » et ne seront jamais rejoués.\n\nElles restent achetables sur Twitch : les points dépensés ne sont pas remboursés par Raptoru. Désactive ou mets en pause les récompenses sur Twitch si besoin.\n\nLes autres modules (alertes, Tombola, TTS, Spotify…) ne sont pas touchés.',
  yes: 'Couper',
};
export const CP_ON_CONFIRM = `${CP_ON.title}\n\n${CP_ON.body}`;
export const CP_OFF_CONFIRM = `${CP_OFF.title}\n\n${CP_OFF.body}`;

const fact = (tone: string, text: string, title = '') =>
  `<span class="rw-fact"${title ? ` title="${esc(title)}"` : ''}><i class="d-dot ${tone}"></i>${esc(text)}</span>`;

/** Le lecteur d'effets tel que Studio le voit (sa source OBS). */
export function effectsFact(e: CpState['effects']) {
  if (!e) return null;
  if (!e.connected)
    return {
      tone: 'w',
      text: 'Lecteur d’effets : non ouvert',
      hint: 'Ajoute la source navigateur du lecteur d’effets dans OBS.',
    };
  if (!e.audio)
    return {
      tone: 'w',
      text: 'Lecteur d’effets : son bloqué',
      hint: 'Clique dans la source OBS pour autoriser le son.',
    };
  if (e.current === false)
    return {
      tone: 'w',
      text: 'Lecteur d’effets : à recharger',
      hint: 'La source OBS exécute une ancienne version : clic droit sur la source, Actualiser (elle se recharge seule ensuite).',
    };
  return {
    tone: '',
    text: e.playing
      ? `Lecteur d’effets : ${e.playing} en lecture`
      : 'Lecteur d’effets prêt',
    hint: '',
  };
}

/** Ce qui est importé dans le stockage de Studio, et ce qui manque. */
export function mediaCount(e: CpState['effects']) {
  const all = [...effectItems(e), ...(e?.interaction_media ?? [])];
  const missing = all.filter((m) => !m.available).map((m) => m.label);
  return { have: all.length - missing.length, total: all.length, missing };
}

/** L'interrupteur tel qu'il est vraiment : actif n'est vert que si les actions peuvent s'exécuter (`blocker` : ce qui l'empêche). */
export function masterChip(
  s: CpState | null,
  error: string | null,
  blocker: string | null,
) {
  return !s
    ? stateChip('w', error ?? 'Lecture…')
    : error
      ? stateChip('w', error)
      : !s.settings.enabled
        ? stateChip('off', 'Automatisations coupées')
        : blocker
          ? stateChip('w', `Actives, ${blocker}`)
          : stateChip('live', 'Automatisations actives');
}

/** Le pouls : Twitch, OBS, lecteur, travaux en attente. */
export function statusView(s: CpState | null, error: string | null) {
  if (error) return `<p class="d-note bad">${esc(error)}</p>`;
  if (!s) return '<span class="d-faint">Lecture…</span>';
  const twitch =
    s.environment === 'production'
      ? fact(
          'off',
          'Twitch : bot de production',
          'En profil Production, les récompenses arrivent par le bot Twitch de production.',
        )
      : !s.twitch.scope
        ? fact(
            'w',
            'Twitch : autorisation manquante',
            'Le compte du streamer n’a pas le droit de lire les récompenses (channel:read:redemptions) : aucune n’est reçue.',
          )
        : s.twitch.adapter_running
          ? fact('', 'Twitch : réception active')
          : fact(
              'w',
              'Twitch : ingestion chat arrêtée',
              'Laboratoire, Simulation, Ingestion chat Twitch.',
            );
  const fx = effectsFact(s.effects);
  return [
    twitch,
    fact(
      s.obs.connected ? '' : 'w',
      s.obs.connected ? 'OBS connecté' : 'OBS non connecté',
    ),
    fx ? fact(fx.tone, fx.text, fx.hint) : '',
    s.jobs_waiting
      ? fact(
          'w',
          `${s.jobs_waiting} action${s.jobs_waiting > 1 ? 's' : ''} OBS en attente`,
          'Une action OBS non lancée 2 min après l’achat expire : elle n’est jamais jouée en retard.',
        )
      : '',
    s.obs.pending_reverts
      ? fact('w', `${s.obs.pending_reverts} effet(s) temporaire(s) en cours`)
      : '',
    s.executor_error
      ? fact('w', 'Exécution : Core injoignable', s.executor_error)
      : '',
  ].join('');
}

/** Les récompenses que Twitch liste, avec ce que chacune fait. */
export function rewardsView(s: CpState, selected: string | null, find = '') {
  if (!s.rewards.length)
    return `<div class="d-empty"><b>Aucune récompense connue</b><br>Elles apparaissent dès que Twitch les liste, ou à la première utilisation par un viewer.</div>`;
  const q = find.trim().toLowerCase();
  const list = s.rewards.filter((r) => !q || r.title.toLowerCase().includes(q));
  if (!list.length)
    return '<div class="d-empty">Aucune récompense trouvée.</div>';
  return list
    .map((r) => {
      const twitch =
        r.twitch_enabled === false
          ? '<span class="d-tag off">désactivée sur Twitch</span>'
          : r.twitch_enabled === null && r.listed_by_twitch
            ? '<span class="d-tag warn">plus listée par Twitch</span>'
            : '';
      const rule = !r.rule
        ? '<span class="d-tag off">aucune action</span>'
        : r.rule.enabled
          ? ''
          : '<span class="d-tag off">règle désactivée</span>';
      const acts = r.rule?.actions.length
        ? r.rule.actions
            .map((a) => esc(actionLabel(a, s.sounds, effectItems(s.effects))))
            .join(' → ')
        : '';
      return `<button type="button" class="rw-r${r.id === selected ? ' is-sel d-vf' : ''}" data-reward="${esc(r.id)}">
        <span class="rw-pts">${fmt(r.cost)}</span>
        <span class="rw-rt"><b>${esc(r.title)}</b>${acts ? `<small>${acts}</small>` : ''}${twitch || rule ? `<span class="d-tags">${twitch}${rule}</span>` : ''}</span>
      </button>`;
    })
    .join('');
}

const time = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
/** Les raisons du Core arrivent avec un tiret long : ici, un point médian. */
const plain = (t: string) => t.replace(/\s+—\s+/g, ' · ');

const RES_ICON: Record<string, IcName> = {
  done: 'check',
  pending: 'clock',
  unknown: 'info',
  failed: 'x',
};
function resultLine(
  r: CpRedemption,
  s: CpState,
  x: CpRedemption['results'][number],
) {
  const a = r.actions[x.index];
  const note =
    x.status === 'pending' && x.progress
      ? a?.type === 'interaction'
        ? 'en cours'
        : PROGRESS[x.progress]
      : x.error
        ? (ERRORS[x.error] ?? plain(x.error))
        : (x.detail ?? '');
  const kind = x.status in RES_ICON ? x.status : 'failed';
  return `<li class="rw-res is-${kind}">${ic(RES_ICON[kind]!)}<span>${a ? esc(actionLabel(a, s.sounds, effectItems(s.effects))) : ''}${note ? `<small>${esc(note)}</small>` : ''}</span></li>`;
}

/** À voir : un échec, un achat reçu en retard ou hors live, une expiration, un remboursement. */
export const isNotable = (r: CpRedemption) =>
  r.status === 'failed' ||
  r.status === 'partial' ||
  r.twitch_status === 'canceled' ||
  r.reason === 'late' ||
  r.reason === 'stream_offline' ||
  r.results.some((x) => /expir|rembours/i.test(x.error ?? ''));

/** Une utilisation et ce qui est arrivé à chaque action. */
export function redemptionRow(r: CpRedemption, s: CpState) {
  const [label, tone] = STATUS[r.status];
  const body =
    r.status === 'ignored'
      ? `<p class="rw-why">${esc(REASON[r.reason ?? ''] ?? r.reason ?? '')}</p>`
      : `<ul class="rw-ress">${r.results.map((x) => resultLine(r, s, x)).join('')}</ul>`;
  return `<details class="rw-h d-in is-${r.status}"${r.status === 'failed' || r.status === 'partial' ? ' open' : ''}><summary>
    ${r.source === 'simulation' ? `<span class="rw-who"><span class="d-tag off">Test Studio</span></span>` : `<span class="rw-who">${pp(r.user.display_name, 20)}<b>${esc(r.user.display_name)}</b></span>`}
    <span class="rw-hr">${esc(r.reward.title)}</span>
    <span class="d-tag ${tone}">${label}</span>
    <time title="${esc(time(r.received_at))}">${clockOf(r.received_at)}</time>
  </summary>
  ${r.user_input ? `<blockquote>« ${esc(r.user_input)} »</blockquote>` : ''}
  ${body}
  ${r.twitch_status === 'canceled' ? '<p class="rw-why">Annulée sur Twitch : points rendus au viewer, crédits repris.</p>' : ''}
  </details>`;
}
export const historyView = (s: CpState) =>
  s.recent.length
    ? s.recent.map((r) => redemptionRow(r, s)).join('')
    : '<div class="d-empty">Aucune récompense reçue.</div>';

/** Le texte de test d'une récompense FX Cam ou Couleur Cam, sinon null. */
export function textChoices(r: CpReward) {
  const a = r.rule?.actions.find(
    (x) =>
      x.type === 'interaction' &&
      (x.interaction === 'fx_cam' || x.interaction === 'color_cam'),
  );
  if (a?.type !== 'interaction') return null;
  return a.interaction === 'fx_cam'
    ? [...FX_CAM.effects]
    : [...COLOR_CAM_PRESETS.map((p) => p.name), 'aléatoire'];
}

/** La liaison visible, vue depuis un module : les récompenses dont la règle le déclenche. */
export function triggersHtml(
  s: CpState | null,
  error: string | null,
  uses: (a: CpActionView) => boolean,
) {
  const list = (s?.rewards ?? []).filter((r) => r.rule?.actions.some(uses));
  return `<div class="rw-trig">${
    list.length
      ? list
          .map(
            (r) =>
              `<a class="rw-link" href="/?p=channel-points" data-go-reward="${esc(r.id)}"><b>${esc(r.title)}</b><small>${fmt(r.cost)} pts${r.rule!.enabled ? '' : ', règle désactivée'}</small></a>`,
          )
          .join('')
      : '<span class="d-faint">Aucune récompense Twitch ne le déclenche pour l’instant.</span>'
  }<small class="d-faint">Automatisations des points de chaîne : ${s ? (s.settings.enabled ? 'actives' : 'coupées') : error ? 'état inconnu' : '…'}</small></div>`;
}

/** Depuis un module : ouvrir une récompense précise dans sa page. Le lien change de page, celle-ci reprend la demande. */
let asked: string | null = null;
export const askReward = (id: string) => {
  asked = id;
};
export const takeReward = () => {
  const a = asked;
  asked = null;
  return a;
};

export const usesEffect = (a: CpActionView) =>
  a.type === 'effect_sound' ||
  a.type === 'effect_video' ||
  (a.type === 'interaction' &&
    ['creepy', 'brb', 'fx_cam', 'color_cam'].includes(a.interaction));
export const usesRandomBan = (a: CpActionView) =>
  a.type === 'interaction' && a.interaction === 'random_ban';
