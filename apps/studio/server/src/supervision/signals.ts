import type {
  ModuleStatus,
  StatusLevel,
  StatusProvider,
} from '../control-center/model.js';

// Supervision of the viewer interactions (incident 22/10, docs/PLAN_SUPERVISION_2026-10-23.md lot 1). What Studio knows
// in memory, judged with the Core's OWN admission rules (tts/sound/bonk-lab-service.ts `assertReady`): a module whose
// last accepted heartbeat is older than 10 s is « studio_offline » for the Core, a player / overlay not ready is
// « player_offline » / « overlay_not_ready ». Studio's view only: what the Core really refused comes with lot 3.

/** Core's `heartbeatFreshMs` (TTS / Soundboard / Bonk): past it, the Core refuses the module's requests. */
export const CORE_FRESH_MS = 10_000;

/** One supervised element, the unit of the incidents and the history. */
export interface Signal {
  id: string;
  label: string;
  level: StatusLevel;
  /** Short state for the streamer (« Prêt », « Lecteur absent »…). */
  value: string;
  /** Technical cause (the Core's refusal code when there is one), null when fine. */
  cause: string | null;
  /** auto: retried by itself · manual: needs an action from the streamer. */
  action: 'auto' | 'manual' | null;
  hint: string | null;
}

/** Live objects read (structural: the real workers / link satisfy them). */
export interface InteractionSources {
  /** Production transport only (null in the Lab profile). */
  link: { state: string; detail: string | null } | null;
  tts: {
    ready: boolean;
    error: string | null;
    lastHeartbeat: number;
    moduleState: string;
    playerInfo: { voices: number; seen_ms_ago: number } | null;
  } | null;
  sound: {
    ready: boolean;
    error: string | null;
    lastHeartbeat: number;
    /** « Couper le son » in the player: a choice, not an outage. */
    cutOnPurpose?: boolean;
  } | null;
  bonk: {
    obsConnected: boolean;
    obsReconnecting: boolean;
    obsError: string | null;
    sourceReady: boolean;
    overlayReady: boolean;
    error: string | null;
    lastHeartbeat: number;
  } | null;
}

const LINK_MANUAL: Record<string, string> = {
  revoked:
    'Installation Studio révoquée dans le Core : réappairer Studio (Profil).',
  not_paired: 'Studio n’est pas appairé au Core : appairer Studio (Profil).',
  update_required:
    'Version de Studio trop ancienne pour le Core : mettre Studio à jour.',
  tls_invalid:
    'Certificat du Core refusé : vérifier l’adresse du Core (Profil).',
  identity_mismatch:
    'Le Core ne reconnaît pas cette installation : réappairer Studio (Profil).',
  start_failed: 'Le transport Production n’a pas démarré : redémarrer Studio.',
};

function age(now: number, at: number) {
  if (!at) return 'jamais';
  const s = Math.round((now - at) / 1000);
  return s < 90 ? `il y a ${s} s` : `il y a ${Math.round(s / 60)} min`;
}

/** The link Studio ↔ Core (Production). */
function linkSignal(link: NonNullable<InteractionSources['link']>): Signal {
  const base = { id: 'core-link', label: 'Studio ↔ Core' };
  if (link.state === 'connected')
    return {
      ...base,
      level: 'ok',
      value: 'Connecté',
      cause: null,
      action: null,
      hint: null,
    };
  if (link.state === 'connecting')
    return {
      ...base,
      level: 'warn',
      value: 'Connexion…',
      cause: null,
      action: null,
      hint: null,
    };
  const manual = LINK_MANUAL[link.state];
  return {
    ...base,
    level: 'error',
    value: manual ? 'Refusé' : 'Core injoignable',
    cause: link.state,
    action: manual ? 'manual' : 'auto',
    hint:
      manual ??
      `Studio réessaie toutes les 5 s${link.detail ? ` (${link.detail})` : ''}. Si cela dure : connexion internet du PC.`,
  };
}

/** Heartbeat older than the Core's freshness: every request of the module is refused (studio_offline). */
function stale(
  id: string,
  label: string,
  now: number,
  lastHeartbeat: number,
  error: string | null,
): Signal | null {
  if (lastHeartbeat && now - lastHeartbeat <= CORE_FRESH_MS) return null;
  return {
    id,
    label,
    level: 'error',
    value: 'Non vu par le Core',
    cause: 'studio_offline',
    action: 'auto',
    hint: `Dernier signal accepté par le Core : ${age(now, lastHeartbeat)}${error ? ` — erreur : ${error}` : ''}. Nouvel essai automatique ; les demandes des viewers sont refusées en attendant.`,
  };
}

/** A worker that works but reported an error on its last tick: a reservation, never an incident. */
/**
 * Fresh heartbeat + ready player: the Core serves this module, whatever one tick reported. Its last error stays
 * visible but never turns the tile orange (tests 23/10: « Réserve » flickered after every recovery — a worker clears
 * its error at its next good tick, ≤ 1 s later, while the tile refreshes every 5 s).
 */
function withError(s: Signal, error: string | null): Signal {
  return error && s.level === 'ok'
    ? {
        ...s,
        value: `${s.value} · erreur passagère`,
        hint: `Dernière erreur passagère du module : ${error}`,
      }
    : s;
}

export function readSignals(src: InteractionSources, now: number): Signal[] {
  const out: Signal[] = [];
  if (src.link) out.push(linkSignal(src.link));
  if (src.tts) {
    const t = src.tts;
    const label = 'TTS';
    out.push(
      t.moduleState !== 'active'
        ? {
            id: 'tts',
            label,
            level: 'off',
            value:
              t.moduleState === 'paused'
                ? 'En pause (réglage)'
                : 'Désactivé (réglage)',
            cause: null,
            action: null,
            hint: null,
          }
        : (stale('tts', label, now, t.lastHeartbeat, t.error) ??
            (t.ready
              ? withError(
                  {
                    id: 'tts',
                    label,
                    level: 'ok',
                    value: `Prêt (${t.playerInfo?.voices ?? 0} voix)`,
                    cause: null,
                    action: null,
                    hint: null,
                  },
                  t.error,
                )
              : {
                  id: 'tts',
                  label,
                  level: 'error',
                  value: 'Lecteur absent',
                  cause: 'player_offline',
                  action: 'manual',
                  hint: `Le lecteur TTS (source navigateur d’OBS) ne répond plus${t.playerInfo ? ` — vu ${age(now, now - t.playerInfo.seen_ms_ago)}` : ''}. Vérifier que la source est présente et active (clic droit → Actualiser).`,
                })),
    );
  }
  if (src.sound) {
    const s = src.sound;
    const label = 'Soundboard';
    out.push(
      stale('soundboard', label, now, s.lastHeartbeat, s.error) ??
        (s.cutOnPurpose
          ? {
              id: 'soundboard',
              label,
              level: 'off',
              value: 'Son coupé (volontaire)',
              cause: null,
              action: null,
              hint: 'Les demandes Soundboard des viewers sont refusées tant que le son reste coupé (lecteur Soundboard → « Activer le son »).',
            }
          : s.ready
            ? withError(
                {
                  id: 'soundboard',
                  label,
                  level: 'ok',
                  value: 'Prêt',
                  cause: null,
                  action: null,
                  hint: null,
                },
                s.error,
              )
            : {
                id: 'soundboard',
                label,
                level: 'error',
                value: 'Lecteur absent',
                cause: 'player_offline',
                action: 'manual',
                hint: 'Le lecteur Soundboard (source navigateur d’OBS) ne répond plus ou n’a pas l’audio. Vérifier que la source est présente et active (clic droit → Actualiser).',
              }),
    );
  }
  if (src.bonk) {
    const b = src.bonk;
    const label = 'Bonk';
    out.push(
      stale('bonk', label, now, b.lastHeartbeat, b.error) ??
        (!b.obsConnected
          ? {
              id: 'bonk',
              label,
              level: 'error',
              value: 'OBS déconnecté',
              cause: 'obs_offline',
              action: b.obsReconnecting ? 'auto' : 'manual',
              hint: b.obsReconnecting
                ? `Reconnexion automatique à OBS en cours${b.obsError ? ` (${b.obsError})` : ''}.`
                : 'Studio n’est pas connecté à OBS : onglet Bonk → Connecter OBS.',
            }
          : !b.sourceReady || !b.overlayReady
            ? {
                id: 'bonk',
                label,
                level: 'error',
                value: !b.sourceReady ? 'Source absente' : 'Overlay absent',
                cause: 'overlay_not_ready',
                action: 'manual',
                hint: !b.sourceReady
                  ? 'Source OBS « Raptoru Bonk Lab » absente, mal réglée (URL de l’onglet Bonk, 1920×1080) ou non affichée à l’écran en ce moment.'
                  : 'L’overlay Bonk (source navigateur d’OBS) ne répond plus : vérifier qu’elle est active (clic droit → Actualiser).',
              }
            : withError(
                {
                  id: 'bonk',
                  label,
                  level: 'ok',
                  value: 'Prêt',
                  cause: null,
                  action: null,
                  hint: null,
                },
                b.error,
              )),
    );
  }
  return out;
}

const RANK: Record<StatusLevel, number> = {
  error: 4,
  warn: 3,
  unknown: 2,
  ok: 1,
  off: 0,
};

/** Centre de contrôle tile « Interactions viewers »: one fact per signal, the worst level wins. */
export function interactionsStatusProvider(
  read: () => Signal[],
  now: () => Date = () => new Date(),
): StatusProvider {
  const id = 'interactions';
  const label = 'Interactions viewers (TTS, Soundboard, Bonk)';
  return {
    id,
    label,
    async read(): Promise<ModuleStatus> {
      const signals = read();
      const worst = signals.reduce<StatusLevel>(
        (w, s) => (RANK[s.level] > RANK[w] ? s.level : w),
        signals.length ? 'off' : 'unknown',
      );
      const down = signals.filter((s) => s.level === 'error');
      return {
        id,
        label,
        level: worst,
        state:
          worst === 'error'
            ? 'Indisponible'
            : worst === 'warn'
              ? 'Réserve'
              : worst === 'unknown'
                ? 'Inconnu'
                : worst === 'off'
                  ? 'Arrêté'
                  : 'Prêt',
        summary: !signals.length
          ? 'Aucun module d’interaction ne tourne dans ce Studio.'
          : down.length
            ? `Refusé aux viewers en ce moment : ${down.map((s) => s.label).join(', ')}.`
            : 'Vu depuis Studio : les demandes des viewers peuvent être servies.',
        facts: signals.map((s) => ({
          label: s.label,
          value: s.value,
          level: s.level,
        })),
        hint:
          signals
            .filter((s) => s.hint && s.level !== 'off')
            .map((s) => `${s.label} : ${s.hint}`)
            .join(' ') || null,
        checkedAt: now().toISOString(),
      };
    },
  };
}
