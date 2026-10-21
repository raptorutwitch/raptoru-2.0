import {
  BOT_LEASE_RENEW_SECONDS,
  BotStatus,
  type BotFlags,
} from '@raptoru/schemas';
import type { CoreCall } from '../bonk-lab/worker.js';
import { StudioTransportError } from '../prod-transport/core-client.js';
import type {
  ModuleStatus,
  StatusFact,
  StatusLevel,
  StatusProvider,
} from './model.js';

// Centre de contrôle — LeCroupier_ (plan post-live, lot 3). The Production Core knows which bot instance holds the
// single-instance lease and what it reports (GET /v1/studio/status/bot); this turns it into what the streamer needs:
// connected or not, where it runs, its Twitch connections, its last sign of life, and one state among
// Actif · En attente · Déconnecté · Erreur · Arrêté · Non suivi · Inconnu. Ages come from the Core's clock (status.now),
// never the PC's, so a PC clock off by a minute never fakes a disconnection.

const ID = 'bot';
const LABEL = 'LeCroupier_ (bot)';
/** Past two missed renewals the lease is still valid but the bot is late. */
const LATE_MS = 2 * BOT_LEASE_RENEW_SECONDS * 1000;
/** EventSub may take a moment after a (re)start: not an error before this. */
const CONNECTING_GRACE_MS = 60_000;

const HOSTS: Record<string, string> = {
  vps: 'VPS Contabo',
  pc: 'PC de stream',
};
const where = (host: string) => HOSTS[host] ?? host;

const FEATURES: [keyof BotFlags & string, string][] = [
  ['CHAT_GAMES', 'jeux chat'],
  ['CHAT_GAMES_OUTPUT', 'réponses chat'],
  ['DAILY_CHAT_COMMANDS', '!daily'],
  ['LOYALTY_CHAT_COMMANDS', '!solde / !give'],
  ['LOYALTY_TWITCH_EVENTS', 'subs / bits / follows'],
  ['CHANNEL_POINTS_EVENTS', 'points de chaîne'],
  ['PRESENCE_SHADOW', 'présence'],
  ['RANDOM_BAN', 'Ban aléatoire'],
];

/** « 4 s », « 2 min 05 s », « 3 h 12 min ». */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });

const connection = (
  v: boolean | null,
  unused: string,
): [string, StatusLevel] =>
  v === null
    ? [unused, 'off']
    : v
      ? ['Connecté', 'ok']
      : ['Non connecté', 'error'];

function base(now: Date): Pick<ModuleStatus, 'id' | 'label' | 'checkedAt'> {
  return { id: ID, label: LABEL, checkedAt: now.toISOString() };
}

/** Pure: the Core's bot status → the streamer's view. */
export function describeBot(s: BotStatus, readAt: Date): ModuleStatus {
  const now = new Date(s.now).getTime();
  const standby = s.standby.map((i): StatusFact => ({
    label: 'Instance en attente',
    value: `${where(i.host)} (${i.instanceId}) — signal il y a ${duration(now - new Date(i.lastSeenAt).getTime())}`,
    level: 'warn',
  }));

  if (s.state === 'active' && s.active) {
    const a = s.active;
    const age = now - new Date(a.lastSeenAt).getTime();
    const up = now - new Date(a.startedAt).getTime();
    const [chat, chatLevel] = connection(a.health.eventSubBot, 'Non utilisé');
    const [bc, bcLevel] = connection(
      a.health.eventSubBroadcaster,
      'Non utilisé',
    );
    const token =
      a.health.broadcasterToken === null
        ? (['Non utilisé', 'off'] as const)
        : a.health.broadcasterToken
          ? (['Valide', 'ok'] as const)
          : (['Inutilisable', 'error'] as const);
    const features = FEATURES.filter(([k]) => a.flags[k] === true).map(
      ([, l]) => l,
    );
    const alerts = a.flags.ALERTS_MODE;
    const facts: StatusFact[] = [
      { label: 'Où', value: `${where(a.host)} · ${a.instanceId}` },
      {
        label: 'Twitch · chat (LeCroupier_)',
        value: chat,
        level: chatLevel,
      },
      {
        label: 'Twitch · subs, bits, points (raptoru_)',
        value: bc,
        level: bcLevel,
      },
      { label: 'Autorisation raptoru_', value: token[0], level: token[1] },
      {
        label: 'Dernier signal',
        value: `il y a ${duration(age)} (${clock(a.lastSeenAt)})`,
        level: age > LATE_MS ? 'warn' : 'ok',
      },
      {
        label: 'Actif depuis',
        value: `${clock(a.since)} · démarré il y a ${duration(up)}`,
      },
      {
        label: 'Fonctions',
        value:
          [
            ...features,
            ...(typeof alerts === 'string' && alerts !== 'off'
              ? [`alertes (${alerts})`]
              : []),
          ].join(', ') || 'aucune',
      },
      { label: 'Version', value: a.version.slice(0, 12) },
      ...standby,
    ];
    const twitchDown =
      a.health.eventSubBot === false || a.health.eventSubBroadcaster === false;
    if (twitchDown && up < CONNECTING_GRACE_MS)
      return {
        ...base(readAt),
        level: 'warn',
        state: 'Connexion',
        summary: `Actif sur le ${where(a.host)}, connexion à Twitch en cours.`,
        facts,
        hint: null,
      };
    if (twitchDown || a.health.broadcasterToken === false)
      return {
        ...base(readAt),
        level: 'error',
        state: 'Erreur',
        summary: `Le bot tourne sur le ${where(a.host)} mais une connexion Twitch manque.`,
        facts,
        hint:
          a.health.broadcasterToken === false
            ? 'Le jeton de raptoru_ est inutilisable : reconnecter raptoru_ (Studio → Connexions Twitch), puis redémarrer le bot.'
            : 'Twitch ne répond pas au bot : vérifier le jeton de LeCroupier_ (Studio → Connexions Twitch) et le journal du bot.',
      };
    if (age > LATE_MS)
      return {
        ...base(readAt),
        level: 'warn',
        state: 'Actif',
        summary: `Actif sur le ${where(a.host)}, mais son dernier signal date de ${duration(age)}.`,
        facts,
        hint: 'Si le retard dépasse 45 s, le bot sera considéré comme déconnecté.',
      };
    return {
      ...base(readAt),
      level: standby.length ? 'warn' : 'ok',
      state: 'Actif',
      summary: standby.length
        ? `Actif sur le ${where(a.host)} ; une autre instance attend (aucun double bot : elle ne se connecte pas à Twitch).`
        : `Connecté à Twitch, actif sur le ${where(a.host)}.`,
      facts,
      hint: standby.length
        ? 'Normal pendant une bascule PC ↔ VPS ; sinon, fermer l’instance en attente.'
        : null,
    };
  }

  // No live lease.
  if (s.active) {
    // The holder stopped renewing without a clean stop: crash, network, closed window.
    const age = now - new Date(s.active.lastSeenAt).getTime();
    return {
      ...base(readAt),
      level: 'error',
      state: 'Déconnecté',
      summary: `Plus aucun signal du bot (${where(s.active.host)}) depuis ${duration(age)}.`,
      facts: [
        {
          label: 'Dernière instance',
          value: `${where(s.active.host)} · ${s.active.instanceId}`,
        },
        {
          label: 'Dernier signal',
          value: `il y a ${duration(age)} (${clock(s.active.lastSeenAt)})`,
          level: 'error',
        },
        ...standby,
      ],
      hint:
        s.active.host === 'vps'
          ? 'Sur le VPS, Docker le relance de lui-même. Si rien ne revient d’ici 2 min : Coolify → raptoru-bot → Redémarrer, puis consulter son journal.'
          : 'Sur le PC : relancer le bot (mode secours run-production.ps1). Une fenêtre fermée par erreur arrête le bot.',
    };
  }
  if (standby.length)
    return {
      ...base(readAt),
      level: 'warn',
      state: 'En attente',
      summary:
        'Aucun bot actif : une instance attend le bail et va le prendre (≤ 15 s).',
      facts: standby,
      hint: 'Si cela dure plus d’une minute, consulter le journal de l’instance en attente.',
    };
  if (s.lastSeen?.state === 'released')
    return {
      ...base(readAt),
      level: 'off',
      state: 'Arrêté',
      summary: `Bot arrêté proprement (${where(s.lastSeen.host)}) à ${clock(s.lastSeen.lastSeenAt)}.`,
      facts: [
        {
          label: 'Dernière instance',
          value: `${where(s.lastSeen.host)} · ${s.lastSeen.instanceId}`,
        },
      ],
      hint: 'Le démarrer avant le live (VPS : Coolify → raptoru-bot → Démarrer).',
    };
  return {
    ...base(readAt),
    level: 'warn',
    state: 'Non suivi',
    summary:
      'Aucun bot n’a déclaré sa présence au Core : soit il est arrêté, soit c’est une version antérieure au bail d’instance (il peut fonctionner sans être suivi).',
    facts: [],
    hint: 'Vérifier dans le chat qu’il répond (!solde). Le suivi apparaît dès qu’un bot à jour démarre.',
  };
}

/** The Production bot's provider (Production profile: the paired Studio's Core client; Lab: not followed). */
export function botStatusProvider(
  core: CoreCall | null,
  now: () => Date = () => new Date(),
): StatusProvider {
  return {
    id: ID,
    label: LABEL,
    async read() {
      if (!core)
        return {
          ...base(now()),
          level: 'off',
          state: 'Non suivi',
          summary:
            'Profil Lab : le bot Production n’est suivi qu’en profil Production.',
          facts: [],
          hint: null,
        };
      try {
        return describeBot(
          BotStatus.parse(await core('/v1/studio/status/bot')),
          now(),
        );
      } catch (e) {
        const err = e instanceof StudioTransportError ? e : null;
        const missing = err?.status === 404;
        return {
          ...base(now()),
          level: 'unknown',
          state: 'Inconnu',
          summary: missing
            ? 'Le Core Production ne fournit pas encore le statut du bot.'
            : 'Studio ne joint pas le Core Production : statut du bot inconnu.',
          facts: [],
          hint: missing
            ? 'Déployer le Core à jour (lot 1). Le bot actuel fonctionne sans être suivi.'
            : 'Voir la carte « Profil » de Studio (connexion au Core Production).',
        };
      }
    },
  };
}
