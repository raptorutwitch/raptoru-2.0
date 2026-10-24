import type { SpotifyReason, SpotifyTrack } from '@raptoru/schemas';

// The chat texts of the historical Spotify V2 service, word for word (spotify-v2/errors.js, bridge.js, moderation.js,
// http.js — 25/08 → 18/10/2026). Only the author changes: LeCroupier_ instead of raptoru_. Where a refund is part of a
// sentence, it is said only when Twitch will really give the points back (docs/SPOTIFY_V2.md § 7).

/** errors.js SAFE_MESSAGES (the ones a viewer or a moderator can see). */
const SAFE: Partial<
  Record<SpotifyReason | 'SKIP_RESULT_UNKNOWN' | 'CANCEL_TOO_LATE', string>
> = {
  INVALID_INPUT: 'La demande est invalide.',
  INVALID_REFERENCE: 'La référence Spotify doit être une piste.',
  NOT_FOUND: 'Aucune piste suffisamment proche n’a été trouvée.',
  AMBIGUOUS:
    'Plusieurs pistes sont suffisamment proches ; aucune n’a été ajoutée.',
  TOO_LONG: 'La piste dépasse la durée maximale configurée.',
  VIEWER_LIMIT: 'La limite de demandes en attente est atteinte.',
  VIEWER_COOLDOWN: 'Cette demande est trop rapprochée de la précédente.',
  DUPLICATE_REDEEM: 'Cette demande a déjà été traitée.',
  NO_DEVICE: 'Aucun appareil Spotify actif et disponible n’a été trouvé.',
  AUTH_NOT_CONFIGURED: 'Spotify OAuth n’est pas configuré.',
  AUTH_REQUIRED: 'Spotify nécessite une nouvelle autorisation.',
  SPOTIFY_UNAVAILABLE: 'Spotify est momentanément indisponible.',
  TEMPORARY_ERROR: 'Spotify a renvoyé une erreur temporaire.',
  QUEUE_RESULT_UNKNOWN:
    'Le résultat de l’ajout à la file est inconnu ; aucune nouvelle tentative automatique.',
  SKIP_RESULT_UNKNOWN:
    'Le résultat du skip est inconnu ; aucune nouvelle tentative automatique.',
  CANCEL_TOO_LATE:
    'Trop tard pour annuler cette demande : la lecture a déjà commencé.',
};

/** Raptoru's admission refusals had no historical text: the historical « momentanément indisponible » one. */
export function safeMessage(reason: string | null | undefined): string {
  return SAFE[reason as keyof typeof SAFE] ?? SAFE.SPOTIFY_UNAVAILABLE!;
}

/** `@viewer` (http.js sammiDisplayName / moderation.js displayLogin). */
export const at = (name: string | null | undefined) =>
  `@${
    String(name ?? '')
      .trim()
      .replace(/^@+/, '') || 'viewer'
  }`;

const clean = (v: string | null | undefined, fallback: string) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim() || fallback;

const artistsOf = (t: Pick<SpotifyTrack, 'artists'> | null | undefined) =>
  (t?.artists ?? [])
    .map((a) => clean(a, ''))
    .filter(Boolean)
    .join(', ');

/** `{Titre} — {Artistes}` (bridge.js / moderation.js trackLabel). */
export const trackLabel = (
  t: Pick<SpotifyTrack, 'title' | 'artists'> | null | undefined,
) =>
  `${clean(t?.title, 'Titre inconnu')} — ${artistsOf(t) || 'Artiste inconnu'}`;

export const MSG = {
  /** http.js: the success line (request queued). */
  queued: (viewer: string, t: SpotifyTrack) =>
    `${at(viewer)} → ${trackLabel(t)} ajouté à la file !`,
  /** http.js: any other outcome. */
  refused: (viewer: string, reason: string) =>
    `${at(viewer)} → ${safeMessage(reason)}`,
  /** service.js viewerCooldownMessage (« récompense remboursée » only when Twitch really gives the points back). */
  cooldown: (viewer: string, remainingMs: number, refunded: boolean) => {
    const minutes = Math.ceil(remainingMs / 60_000);
    const readable = minutes <= 1 ? 'moins d’une minute' : `${minutes} min`;
    return `${at(viewer)} → attends encore ${readable} avant une nouvelle demande${refunded ? ' ; récompense remboursée.' : '.'}`;
  },
  /** bridge.js `!song`. */
  nowPlaying: (t: SpotifyTrack, requester: string | null) =>
    `🎵 En cours : ${trackLabel(t)}${requester ? ` • demandé par @${requester.replace(/^@+/, '')}` : ''}`,
  noPlayback: '🎵 Aucune musique en cours.',
  unavailable: 'Spotify V2 est temporairement indisponible.',
  /** bridge.js `!songqueue`. */
  queue: (items: { title: string; viewer_login: string }[], more: number) =>
    `🎶 À suivre : ${items
      .map(
        (e, i) =>
          `#${i + 1} ${clean(e.title, 'Titre inconnu')}${e.viewer_login ? ` — @${e.viewer_login.toLowerCase()}` : ''}`,
      )
      .join(' • ')}${more > 0 ? ` • +${more}` : ''}`,
  emptyQueue: '🎶 Aucune musique en attente.',
  /** bridge.js `!mysong`. */
  mySongCurrent: (viewer: string, t: SpotifyTrack) =>
    `🎵 ${at(viewer)}, ta musique est en cours : ${trackLabel(t)}`,
  mySongNone: (viewer: string) =>
    `🎵 ${at(viewer)}, tu n'as aucune musique en attente.`,
  mySongFuture: (
    viewer: string,
    t: SpotifyTrack,
    position: number,
    count: number,
  ) =>
    `🎵 ${at(viewer)}, ${count > 1 ? 'ta prochaine demande ' : ''}${trackLabel(t)} est #${position} dans la file.${count > 1 ? ` Tu as ${count} demandes en attente.` : ''}`,
  unidentified: '🎵 Impossible d’identifier le viewer.',
  /** `!mysong` with several requests: all of them, numbered as `!songcancel <n>` takes them. */
  mySongList: (viewer: string, items: string[]) =>
    `🎵 ${at(viewer)}, tes demandes : ${items.join(' · ')}. Annuler : !songcancel <numéro>.`,
  /** `!songcancel` alone while several can be canceled: nothing canceled, the list and how to choose. */
  cancelChoose: (viewer: string, items: string[]) =>
    `🎵 ${at(viewer)}, tu as plusieurs demandes : ${items.join(' · ')}. Écris !songcancel <numéro> (ex. !songcancel 1).`,
  /** `!songcancel <n>` without such a request. */
  cancelNoIndex: (viewer: string, n: number, count: number) =>
    count
      ? `🎵 ${at(viewer)}, tu n’as pas de demande n°${n} (tu en as ${count} : !mysong pour la liste).`
      : `🎵 ${at(viewer)}, tu n’as aucune demande annulable.`,
  /** moderation.js `!songcancel`. */
  cancelNone: (viewer: string) =>
    `🎵 ${at(viewer)}, tu n’as aucune demande annulable.`,
  cancelAlready: (viewer: string) =>
    `🎵 ${at(viewer)}, cette demande est déjà annulée.`,
  cancelTooLate: (viewer: string) =>
    `🎵 ${at(viewer)}, trop tard pour annuler cette demande : la lecture a déjà commencée.`,
  cancelUnsafe:
    '🎵 Cette demande ne peut pas encore être annulée de façon sûre.',
  canceled: (
    viewer: string,
    t: SpotifyTrack,
    refunded: boolean,
    remaining: number | null,
  ) =>
    `🎵 ${at(viewer)}, ta demande "${trackLabel(t)}"${refunded ? ' est annulée et remboursée.' : ' est annulée.'}${remaining ? ` Il t’en reste ${remaining}.` : ''}`,
  /** moderation.js `!songremove`. */
  removeUsage:
    '🗑️ Utilisation : !songremove <position> ou !songremove @viewer.',
  removeNoPosition: (position: number) =>
    `🗑️ Aucune demande à la position #${position}.`,
  removeBadViewer: '🗑️ Viewer invalide.',
  removeNone: (viewer: string) =>
    `🗑️ ${at(viewer)} n’a aucune demande annulable.`,
  removeAmbiguous: (viewer: string) =>
    `🗑️ ${at(viewer)} a plusieurs identités actives ; aucune demande supprimée.`,
  removePlaying: '🎵 Cette demande est déjà en lecture. Utilise !songskip.',
  removeUnsafe:
    '🗑️ Cette demande ne peut pas encore être annulée de façon sûre.',
  removedViewer: (viewer: string, t: SpotifyTrack, refunded: boolean) =>
    `🗑️ Demande de ${at(viewer)} supprimée${refunded ? ' et remboursée' : ''} : ${trackLabel(t)}`,
  removedPosition: (
    position: number,
    viewer: string,
    t: SpotifyTrack,
    refunded: boolean,
  ) =>
    `🗑️ Demande #${position} supprimée${refunded ? ' et remboursée' : ''} : ${trackLabel(t)} (${at(viewer)})`,
  /** http.js / moderation.js `!songskip`. */
  skipped: (t: SpotifyTrack | null, requester: string | null) =>
    t
      ? `⏭️ Musique passée : ${trackLabel(t)}${requester ? ` (${at(requester)})` : ''}`
      : '⏭️ Musique actuelle passée.',
  skipTombstoneBusy: (removed: boolean) =>
    removed
      ? '🗑️ Cette demande retirée est déjà en cours de traitement.'
      : '🎵 Cette demande annulée est déjà en cours de traitement.',
  skipTombstoneConsumed: (removed: boolean) =>
    removed
      ? '🗑️ Cette demande retirée a déjà consommé son passage automatique.'
      : '🎵 Cette demande annulée a déjà consommé son passage automatique.',
  skipTombstoneDone: (removed: boolean) =>
    removed
      ? '🗑️ La demande retirée a été passée.'
      : '🎵 La demande déjà annulée a été passée.',
  skipFailed: (moderator: string, reason: string) =>
    `${at(moderator)} → ${safeMessage(reason)}`,
  /** http.js: the « Skip la musique » reward. */
  rewardSkipped: (viewer: string) =>
    `${at(viewer)} → La musique en cours a été passée !`,
} as const;
