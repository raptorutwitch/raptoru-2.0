// Spotify V2 — Studio « Musique » section: the state Studio serves (/api/spotify/state), the panel's own state and the
// small formatting helpers shared by the main view (spotify-view.ts) and the secondary spaces (spotify-panels.ts).

export interface SpTrack {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  duration_ms: number;
}

export interface SpRequest {
  request_id: string;
  source: 'twitch' | 'simulation';
  viewer: { id: string; login: string; name: string };
  input: string | null;
  state: string;
  reason: string | null;
  track: SpTrack | null;
  confidence: string | null;
  confirmation: string | null;
  received_at: string;
  queued_at: string | null;
  playback_started_at: string | null;
  ended_at: string | null;
  canceled_by: string | null;
  removed_by: string | null;
  skipped_by: string | null;
  auto_skip: boolean;
  auto_skip_result: string | null;
  twitch_status: 'cancel_requested' | 'kept' | 'unmanaged' | 'none' | null;
}

export interface SpSettings {
  enabled: boolean;
  max_pending_per_viewer: number;
  viewer_cooldown_seconds: number;
  max_duration_seconds: number;
  cancel_grace_seconds: number;
}

export interface SpOverride {
  viewer_login: string;
  max_pending_per_viewer: number | null;
  viewer_cooldown_seconds: number | null;
  updated_at: string;
}

export interface SpPlayback {
  observed_at: string;
  track: SpTrack | null;
  progress_ms: number | null;
  is_playing: boolean;
}

export interface SpState {
  environment: 'lab' | 'production';
  settings: SpSettings;
  admission: string;
  studio: {
    fresh: boolean;
    playback: SpPlayback | null;
    status: { device: { name: string; type: string } | null };
  } | null;
  current: SpRequest | null;
  queue: SpRequest[];
  in_progress: SpRequest[];
  to_verify: SpRequest[];
  recent: SpRequest[];
  overrides?: SpOverride[];
  twitch_actions: {
    kind: string;
    status: string;
    error: string | null;
    payload: {
      redemption_id?: string;
      status?: string;
      title?: string;
      cost?: number;
    };
    created_at: string;
  }[];
  managed_rewards: { reward_id: string; title: string; cost: number }[];
  connection: {
    auth: 'ok' | 'not_configured' | 'needs_reauth';
    client_id: string | null;
    account: { name: string; product: string | null } | null;
    redirect_uri: string;
    simulated: boolean;
  };
  api: {
    limited_until: string | null;
    quota_exceeded: boolean;
    calls_last_minute: number;
    rate_high: boolean;
    backoff_until: string | null;
    counters?: Record<string, number>;
  };
  local: {
    error: string | null;
    watching: boolean;
    fast_lane: boolean;
    next_poll_in_ms?: number | null;
    refresh_in_ms?: number;
    reservations?: unknown[];
  };
  sim: {
    device_active: boolean;
    queue_answer: number;
    limited: boolean;
    current: string | null;
    progress_ms: number | null;
    queue: string[];
    calls: number;
  } | null;
}

export type SpTab = 'live' | 'viewers' | 'settings' | 'reward' | 'tech' | 'sim';

export interface SpIdentity {
  id: string;
  label: string;
  login?: string;
}

/** The panel's own state: the open space, what is being typed (kept across the 3 s refresh), the Lab identities. */
export interface SpUi {
  tab: SpTab;
  fields: Record<string, string>;
  who: SpIdentity[];
  /** Now, for the « lu il y a » and the progress (passed in: the view stays pure and testable). */
  now: number;
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export const chip = (cls: string, text: string, title = '') =>
  `<span class="cp-chip cp-chip--${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
export const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('fr-FR') : '';
export const mmss = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
export const trackLabel = (t: SpTrack | null) =>
  t ? `${t.title} — ${t.artists.join(', ')}` : '—';
/** « il y a 12 s », « il y a 3 min », « il y a 2 h ». */
export const ago = (ms: number) =>
  ms < 60_000
    ? `il y a ${Math.max(0, Math.round(ms / 1000))} s`
    : ms < 3_600_000
      ? `il y a ${Math.round(ms / 60_000)} min`
      : `il y a ${Math.round(ms / 3_600_000)} h`;
export const minutes = (s: number) =>
  s % 60 === 0
    ? `${s / 60} min`
    : `${(s / 60).toFixed(1).replace('.', ',')} min`;

/** A field's value: what is being typed, else the saved value. */
export const val = (ui: SpUi, name: string, saved: unknown) =>
  esc(ui.fields[name] ?? saved ?? '');

/** Why a request did not go through (Core / Studio codes → the panel's words). */
export const REASONS: Record<string, string> = {
  INVALID_INPUT: 'texte vide',
  INVALID_REFERENCE: 'lien non Spotify ou pas un titre',
  NOT_FOUND: 'aucun titre assez proche',
  AMBIGUOUS: 'plusieurs titres possibles',
  TOO_LONG: 'titre trop long',
  VIEWER_LIMIT: 'trop de demandes en attente',
  VIEWER_COOLDOWN: 'délai entre deux demandes',
  DUPLICATE_REDEEM: 'rédemption déjà reçue',
  NO_DEVICE: 'aucun appareil Spotify actif',
  AUTH_NOT_CONFIGURED: 'Spotify non connecté',
  AUTH_REQUIRED: 'reconnexion Spotify nécessaire',
  SPOTIFY_UNAVAILABLE: 'Spotify indisponible',
  RATE_LIMITED: 'Spotify limite les appels',
  TEMPORARY_ERROR: 'erreur temporaire de Spotify',
  QUEUE_RESULT_UNKNOWN: 'ajout non confirmé',
  MODULE_DISABLED: 'demandes fermées',
  STUDIO_UNAVAILABLE: 'Studio absent',
  STUDIO_LOST: 'Studio perdu pendant le traitement',
  LATE: 'rédemption trop ancienne',
  INTERRUPTED: 'interrompue par une autre demande',
  INTERRUPTED_EXTERNAL: 'interrompue par un autre titre',
};

export const STATES: Record<string, string> = {
  RECEIVED: 'Reçue',
  SEARCHING: 'Recherche',
  QUEUED: 'En file',
  PLAYING: 'En cours',
  PLAYED: 'Jouée',
  SKIPPED: 'Passée',
  CANCELED: 'Annulée',
  REMOVED_BY_MOD: 'Retirée',
  FAILED: 'Refusée',
  AMBIGUOUS: 'Ambiguë',
  TOO_LONG: 'Trop longue',
  VIEWER_LIMIT: 'Limite',
  VIEWER_COOLDOWN: 'Délai',
  UNKNOWN: 'À vérifier',
};

export const TWITCH: Record<string, string> = {
  cancel_requested: 'points remboursés (demande envoyée à Twitch)',
  kept: 'gardée : réclamation en attente sur Twitch',
  unmanaged: 'non remboursable (récompense non créée par Raptoru)',
  none: '',
};
