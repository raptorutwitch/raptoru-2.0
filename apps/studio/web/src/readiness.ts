// « Prêt pour le live » (refonte F4, audit P1-1 / D.1 B) — a READ-ONLY checklist: what is ready, what is not, why, what
// it means for the viewers, and where to fix it. It never switches a module on or off.
// Rules (CONTEXTE § 17): an intention ON whose dependency is not ready is never green; a module OFF on purpose is
// « off », never an outage; what Studio cannot check says « non vérifié », never an invented value.
// Data: the read routes each module already serves (the same ones its page reads) — nothing is duplicated.

export type Level = 'ok' | 'warn' | 'error' | 'off' | 'unknown';

export interface Check {
  id: string;
  label: string;
  level: Level;
  /** One or two words. */
  state: string;
  /** Why, in the streamer's words. */
  why: string;
  /** What the viewers get meanwhile (null when nothing is wrong). */
  consequence: string | null;
  /** Where to fix it: a page id of the registry. */
  fix: { page: string; label: string } | null;
}

interface Signal {
  id: string;
  label: string;
  level: Level;
  value: string;
  hint: string | null;
}
interface Module {
  id: string;
  level: Level;
  state: string;
  summary: string;
  hint: string | null;
  data?: Record<string, unknown>;
}

/** What the page read (null: the route did not answer / the module is absent from this profile). */
export interface ReadinessInput {
  profile: {
    effective?: string;
    production?: { state?: string; detail?: string | null };
  } | null;
  modules: Module[] | null;
  channelPoints: {
    settings?: { enabled?: boolean };
    obs?: { connected?: boolean };
    effects?: {
      connected?: boolean;
      audio?: boolean;
      current?: boolean;
    } | null;
    executor_error?: string | null;
  } | null;
  alerts: {
    enabled?: boolean;
    queued?: unknown[];
    source?: { seen?: boolean };
  } | null;
  se: { mode?: string; state?: string; state_label?: string } | null;
  wheel: {
    settings?: { enabled?: boolean };
    animations_waiting?: string | null;
    effects?: {
      connected?: boolean;
      audio?: boolean;
      current?: boolean;
    } | null;
  } | null;
  games: { enabled?: boolean } | null;
  spotify: { admission?: string } | null;
  /** Studio's own runtime in the Lab (Postgres, Lab Core…); absent in Production. */
  runtime?: { id: string; state: string; detail: string }[] | undefined;
  /** Refonte H8: the word game's durable switch and interval (absent: an older Core). */
  wordGame?: {
    enabled?: boolean;
    interval?: { min_s: number; max_s: number };
  } | null;
}

const c = (
  id: string,
  label: string,
  level: Level,
  state: string,
  why: string,
  consequence: string | null,
  fix: Check['fix'],
): Check => ({ id, label, level, state, why, consequence, fix });

const NOT_READ = (id: string, label: string, fix: Check['fix']) =>
  c(
    id,
    label,
    'unknown',
    'Non vérifié',
    'Studio n’a pas pu lire cet état sur ce profil.',
    null,
    fix,
  );

function botFlags(m: Module | undefined) {
  return (m?.data?.flags ?? null) as Record<string, unknown> | null;
}

export function readiness(i: ReadinessInput): Check[] {
  const out: Check[] = [];
  const prod = i.profile?.effective === 'production';
  const bot = i.modules?.find((m) => m.id === 'bot');
  const signals = (i.modules?.find((m) => m.id === 'interactions')?.data
    ?.signals ?? []) as Signal[];
  const sig = (id: string) => signals.find((s) => s.id === id);
  const flags = botFlags(bot);
  const health = (bot?.data?.health ?? null) as {
    eventSubBot?: boolean | null;
    eventSubBroadcaster?: boolean | null;
    broadcasterToken?: boolean | null;
  } | null;

  // --- Core -------------------------------------------------------------------------------------------------------
  const link = sig('core-link');
  if (!i.profile)
    out.push(
      NOT_READ('core', 'Serveur', {
        page: 'systeme',
        label: 'Profil (Système)',
      }),
    );
  else if (!prod) {
    const local = i.runtime?.find((s) => s.id === 'labcore');
    out.push(
      local && local.state !== 'ready'
        ? c(
            'core',
            'Serveur local',
            'error',
            'Arrêté',
            `${local.detail || 'Le serveur du Lab ne répond plus.'} Studio le relance seul.`,
            'Dans le Lab, l’extension et les simulations attendent.',
            { page: 'systeme', label: 'Système' },
          )
        : local
          ? c(
              'core',
              'Serveur local',
              'ok',
              'Prêt',
              'Le serveur du Lab répond.',
              null,
              null,
            )
          : c(
              'core',
              'Serveur',
              'warn',
              'Profil Lab',
              'Studio est sur le serveur local du Lab : cette liste ne vérifie pas ton stream.',
              'Rien de ce qui est vérifié ici ne concerne les viewers.',
              { page: 'systeme', label: 'Profil (Système)' },
            ),
    );
  } else if (i.profile.production?.state === 'start_failed')
    out.push(
      c(
        'core',
        'Serveur Production',
        'error',
        'Démarrage impossible',
        i.profile.production.detail ?? 'Le profil Production n’a pas démarré.',
        'Soundboard, TTS, Bonk et effets refusés aux viewers.',
        { page: 'systeme', label: 'Profil (Système)' },
      ),
    );
  else if (link)
    out.push(
      c(
        'core',
        'Serveur Production',
        link.level,
        link.value,
        link.hint ?? 'Studio est relié au serveur Production.',
        link.level === 'ok'
          ? null
          : 'Les demandes des viewers servies par Studio sont refusées en attendant.',
        link.level === 'ok'
          ? null
          : { page: 'systeme', label: 'Profil (Système)' },
      ),
    );
  else
    out.push(
      NOT_READ('core', 'Serveur Production', {
        page: 'systeme',
        label: 'Profil (Système)',
      }),
    );

  // --- Bot and Twitch -----------------------------------------------------------------------------------------------
  if (!bot)
    out.push(
      NOT_READ('bot', 'Bot LeCroupier_', { page: 'systeme', label: 'Système' }),
    );
  else
    out.push(
      c(
        'bot',
        'Bot LeCroupier_',
        bot.level,
        bot.state,
        bot.summary,
        bot.level === 'ok' || bot.level === 'off'
          ? null
          : 'Commandes, jeux, Daily, fidélité et points de chaîne dépendent de lui.',
        bot.hint ? { page: 'systeme', label: 'Système (bot)' } : null,
      ),
    );
  if (prod) {
    const tw = (
      id: string,
      label: string,
      v: boolean | null | undefined,
      conseq: string,
    ) =>
      out.push(
        v === undefined
          ? NOT_READ(id, label, { page: 'systeme', label: 'Système (bot)' })
          : v === null
            ? c(
                id,
                label,
                'off',
                'Non utilisé',
                'Le bot n’utilise pas cette connexion (fonctions coupées sur le serveur).',
                null,
                null,
              )
            : v
              ? c(
                  id,
                  label,
                  'ok',
                  'Connecté',
                  'Twitch répond au bot.',
                  null,
                  null,
                )
              : c(
                  id,
                  label,
                  'error',
                  'Coupé',
                  'Le bot ne reçoit plus ces événements de Twitch.',
                  conseq,
                  { page: 'systeme', label: 'Système (bot)' },
                ),
      );
    tw(
      'twitch-chat',
      'Twitch · chat (LeCroupier_)',
      health ? health.eventSubBot : undefined,
      'Aucune commande ni jeu ne répond dans le chat.',
    );
    tw(
      'twitch-broadcaster',
      'Twitch · subs, bits, points (raptoru_)',
      health ? health.eventSubBroadcaster : undefined,
      'Subs, bits et points de chaîne ne sont pas reçus (alertes, roue, fidélité).',
    );
    if (health && health.broadcasterToken === false)
      out.push(
        c(
          'twitch-token',
          'Autorisation raptoru_',
          'error',
          'Inutilisable',
          'Le jeton de raptoru_ du bot est refusé par Twitch.',
          'Fidélité, points de chaîne et sanctions ne fonctionnent pas.',
          { page: 'systeme', label: 'Système (bot)' },
        ),
      );
  }

  // --- OBS and players ----------------------------------------------------------------------------------------------
  const cp = i.channelPoints;
  if (!cp)
    out.push(
      NOT_READ('obs', 'OBS', { page: 'bonk', label: 'Bonk (connexion OBS)' }),
    );
  else
    out.push(
      cp.obs?.connected
        ? c('obs', 'OBS', 'ok', 'Connecté', 'Studio commande OBS.', null, null)
        : c(
            'obs',
            'OBS',
            'error',
            'Non connecté',
            'Studio n’est pas relié à OBS (OBS fermé, WebSocket coupé ou mot de passe).',
            'Effets de points de chaîne en attente puis expirés après 2 min ; Bonk et mutes OBS refusés.',
            { page: 'bonk', label: 'Bonk (connexion OBS)' },
          ),
    );
  const fx = cp?.effects ?? i.wheel?.effects ?? null;
  if (!cp && !i.wheel)
    out.push(
      NOT_READ('effects', 'Lecteur d’effets', {
        page: 'channel-points',
        label: 'Récompenses Twitch',
      }),
    );
  else if (!fx)
    out.push(
      c(
        'effects',
        'Lecteur d’effets',
        'unknown',
        'Non vérifié',
        'Ce profil ne fournit pas l’état du lecteur d’effets.',
        null,
        null,
      ),
    );
  else
    out.push(
      !fx.connected
        ? c(
            'effects',
            'Lecteur d’effets',
            'error',
            'Absent',
            'La source navigateur du lecteur d’effets n’est pas ouverte dans OBS.',
            'Roue du Sub, BRB, FX Cam et sons d’effet ne jouent pas.',
            { page: 'effects', label: 'Lecteur d’effets' },
          )
        : fx.audio === false
          ? c(
              'effects',
              'Lecteur d’effets',
              'error',
              'Son bloqué',
              'Le lecteur est ouvert mais son son est bloqué : clique une fois dans sa page.',
              'Les effets jouent sans le son, la roue attend.',
              { page: 'effects', label: 'Lecteur d’effets' },
            )
          : fx.current === false
            ? c(
                'effects',
                'Lecteur d’effets',
                'warn',
                'À recharger',
                'La source OBS exécute une ancienne version : clic droit › Actualiser.',
                null,
                { page: 'effects', label: 'Lecteur d’effets' },
              )
            : c(
                'effects',
                'Lecteur d’effets',
                'ok',
                'Prêt',
                'La source OBS du lecteur répond.',
                null,
                null,
              ),
    );
  for (const [id, label, page, conseq] of [
    [
      'soundboard',
      'Soundboard',
      'soundboard',
      'Les sons achetés sont refusés (aucun Jeton débité).',
    ],
    [
      'tts',
      'TTS',
      'tts',
      'Les messages TTS sont refusés (aucun Jeton débité).',
    ],
    ['bonk', 'Bonk', 'bonk', 'Les Bonk sont refusés (aucun Jeton débité).'],
  ] as const) {
    const s = sig(id);
    out.push(
      !s
        ? c(
            id,
            label,
            'unknown',
            'Non vérifié',
            'Ce module ne tourne pas dans ce Studio.',
            null,
            { page, label },
          )
        : c(
            id,
            label,
            s.level,
            s.value,
            s.hint ??
              (s.level === 'ok' ? 'Prêt à servir les viewers.' : s.value),
            s.level === 'ok' || s.level === 'off' ? null : conseq,
            s.level === 'ok' ? null : { page, label },
          ),
    );
  }

  // --- Alerts and StreamElements ------------------------------------------------------------------------------------
  const al = i.alerts;
  if (!al || al.enabled === false)
    out.push(
      NOT_READ('alerts', 'Alertes', { page: 'alerts', label: 'Alertes' }),
    );
  else {
    const waiting = al.queued?.length ?? 0;
    out.push(
      al.source?.seen === undefined
        ? c(
            'alerts',
            'Alertes',
            'unknown',
            'Non vérifié',
            'Studio ne sait pas si la source OBS « Alertes » est ouverte.',
            null,
            { page: 'alerts', label: 'Alertes' },
          )
        : al.source.seen
          ? c(
              'alerts',
              'Alertes',
              'ok',
              'Prête',
              `La source OBS des alertes répond${waiting ? ` · ${waiting} en attente` : ''}.`,
              null,
              null,
            )
          : c(
              'alerts',
              'Alertes',
              'error',
              'Source absente',
              'La source navigateur « Alertes » ne répond pas dans OBS.',
              `Les alertes attendent${waiting ? ` (${waiting})` : ''}, puis ne sont plus jouées après 30 min.`,
              { page: 'alerts', label: 'Alertes' },
            ),
    );
  }
  if (prod) {
    const se = i.se;
    out.push(
      !se
        ? NOT_READ('se', 'Dons StreamElements', {
            page: 'alerts',
            label: 'Alertes (StreamElements)',
          })
        : se.mode === 'off'
          ? c(
              'se',
              'Dons StreamElements',
              'off',
              'Coupé',
              'Fermé dans les réglages : les dons ne sont pas affichés.',
              null,
              null,
            )
          : se.mode === 'test'
            ? c(
                'se',
                'Dons StreamElements',
                'warn',
                'Mode TEST',
                'Les dons sont observés dans Studio, jamais affichés sur le stream.',
                'Aucun don n’apparaît en alerte.',
                { page: 'alerts', label: 'Alertes (StreamElements)' },
              )
            : se.state === 'connected'
              ? c(
                  'se',
                  'Dons StreamElements',
                  'ok',
                  'ACTIVE',
                  'Connecté à StreamElements.',
                  null,
                  null,
                )
              : c(
                  'se',
                  'Dons StreamElements',
                  'error',
                  'ACTIVE, non connecté',
                  se.state_label ?? 'StreamElements ne répond pas.',
                  'Les dons n’apparaissent pas en alerte.',
                  { page: 'alerts', label: 'Alertes (StreamElements)' },
                ),
    );
  }

  // --- Modules ------------------------------------------------------------------------------------------------------
  if (cp?.settings)
    out.push(
      !cp.settings.enabled
        ? c(
            'cp',
            'Points de chaîne',
            'off',
            'Coupés',
            'Automatisations coupées : les utilisations sont enregistrées, jamais exécutées.',
            null,
            null,
          )
        : cp.obs?.connected && !cp.executor_error
          ? c(
              'cp',
              'Points de chaîne',
              'ok',
              'Actifs',
              'Automatisations actives et exécutables.',
              null,
              null,
            )
          : c(
              'cp',
              'Points de chaîne',
              'error',
              'Activés, en attente',
              cp.executor_error
                ? `Erreur de l’exécuteur : ${cp.executor_error}`
                : 'Activés, mais OBS n’est pas relié à Studio.',
              'Les effets attendent puis expirent après 2 min (remboursés quand c’est possible).',
              { page: 'channel-points', label: 'Récompenses Twitch' },
            ),
    );
  const w = i.wheel;
  if (!w)
    out.push(
      NOT_READ('wheel', 'Roue du Sub', {
        page: 'sub-wheel',
        label: 'Roue du Sub',
      }),
    );
  else
    out.push(
      !w.settings?.enabled
        ? c(
            'wheel',
            'Roue du Sub',
            'off',
            'Fermé',
            'Roue fermée : rien n’est tiré, aucun tour n’est perdu.',
            null,
            null,
          )
        : w.animations_waiting
          ? c(
              'wheel',
              'Roue du Sub',
              'error',
              'En attente',
              w.animations_waiting,
              'Les roues dues attendent (aucun tour perdu).',
              { page: 'sub-wheel', label: 'Roue du Sub' },
            )
          : c(
              'wheel',
              'Roue du Sub',
              'ok',
              'Prête',
              'Ouverte, lecteur prêt.',
              null,
              null,
            ),
    );
  const g = i.games;
  const chatGames = flags ? flags.CHAT_GAMES === true : undefined;
  if (!g)
    out.push(
      NOT_READ('games', 'Mini-jeux (Roulette, Slot, Duel)', {
        page: 'mini-games',
        label: 'Mini-jeux',
      }),
    );
  else
    out.push(
      !g.enabled
        ? c(
            'games',
            'Mini-jeux (Roulette, Slot, Duel)',
            'off',
            'Coupés',
            'Mini-jeux fermés aux viewers.',
            null,
            null,
          )
        : prod && chatGames === false
          ? c(
              'games',
              'Mini-jeux (Roulette, Slot, Duel)',
              'error',
              'Bloqués par le serveur',
              'Ouverts, mais le bot n’a pas les jeux du chat.',
              '!roulette, !slots et !duel ne répondent pas.',
              { page: 'systeme', label: 'Système (bot)' },
            )
          : prod && chatGames === undefined
            ? c(
                'games',
                'Mini-jeux (Roulette, Slot, Duel)',
                'unknown',
                'Ouverts, bot non vérifié',
                'Ouverts ; Studio ne lit pas les fonctions du bot.',
                null,
                null,
              )
            : c(
                'games',
                'Mini-jeux (Roulette, Slot, Duel)',
                'ok',
                'Ouverts',
                'Pendant un live, !roulette, !slots et !duel répondent.',
                null,
                null,
              ),
    );
  if (prod)
    out.push(
      !flags
        ? c(
            'chat-output',
            'Sortie chat',
            'unknown',
            'Non vérifiée',
            'Studio ne lit pas les fonctions du bot.',
            null,
            null,
          )
        : flags.CHAT_GAMES_OUTPUT === true
          ? c(
              'chat-output',
              'Sortie chat',
              'ok',
              'Active (bot)',
              'Le bot peut répondre dans le chat. Chaque commande garde son propre réglage de sortie.',
              null,
              null,
            )
          : c(
              'chat-output',
              'Sortie chat',
              'error',
              'Bloquée par le serveur',
              'Le bot n’envoie aucune réponse de jeux ni de commandes (CHAT_GAMES_OUTPUT).',
              'Commandes et jeux décidés, mais rien n’est écrit dans le chat.',
              { page: 'systeme', label: 'Système (bot)' },
            ),
    );
  const wg = i.wordGame;
  if (wg === null)
    out.push(
      NOT_READ('word-game', 'Jeu des mots', {
        page: 'word-game',
        label: 'Jeu des mots',
      }),
    );
  else if (wg && wg.enabled !== undefined)
    out.push(
      !wg.enabled
        ? c(
            'word-game',
            'Jeu des mots',
            'off',
            'Fermé',
            'Fermé dans ses réglages : aucun mot automatique.',
            null,
            null,
          )
        : c(
            'word-game',
            'Jeu des mots',
            'ok',
            'Ouvert',
            `Un mot toutes les ${Math.round((wg.interval?.min_s ?? 300) / 60)} à ${Math.round((wg.interval?.max_s ?? 900) / 60)} min pendant le live.`,
            null,
            null,
          ),
    );
  const sp = i.spotify;
  if (!sp?.admission)
    out.push(
      NOT_READ('spotify', 'Spotify', { page: 'spotify', label: 'Spotify' }),
    );
  else
    out.push(
      sp.admission === 'MODULE_DISABLED'
        ? c(
            'spotify',
            'Spotify',
            'off',
            'Fermé',
            'Demandes de musique fermées.',
            null,
            null,
          )
        : sp.admission === 'ready'
          ? c(
              'spotify',
              'Spotify',
              'ok',
              'Ouvert',
              'Les demandes de musique sont acceptées.',
              null,
              null,
            )
          : c(
              'spotify',
              'Spotify',
              'error',
              'Refusé',
              `Le serveur refuse les demandes : ${sp.admission}.`,
              'Les demandes sont refusées et remboursées quand c’est possible.',
              { page: 'spotify', label: 'Spotify' },
            ),
    );
  out.push(
    c(
      'extension',
      'Extension servie par Twitch',
      'unknown',
      'Non vérifié',
      'Studio ne lit pas la version de l’extension que Twitch sert aux viewers.',
      null,
      null,
    ),
  );
  return out;
}

const RANK: Record<Level, number> = {
  error: 0,
  warn: 1,
  unknown: 2,
  ok: 3,
  off: 4,
};

/** Problems first, then what cannot be checked, then what is ready, then what is off on purpose. */
export const ordered = (checks: Check[]) =>
  [...checks].sort((a, b) => RANK[a.level] - RANK[b.level]);

export function summary(checks: Check[]) {
  const n = (l: Level) => checks.filter((x) => x.level === l).length;
  const bad = n('error') + n('warn');
  return {
    level: (n('error')
      ? 'error'
      : n('warn')
        ? 'warn'
        : n('unknown')
          ? 'unknown'
          : 'ok') as Level,
    text: bad
      ? `${bad} point(s) à corriger · ${n('unknown')} non vérifié(s) · ${n('ok')} prêt(s) · ${n('off')} fermé(s) volontairement`
      : n('unknown')
        ? `Aucun problème détecté, mais ${n('unknown')} point(s) non vérifié(s) · ${n('ok')} prêt(s) · ${n('off')} fermé(s) volontairement`
        : `Tout est prêt · ${n('ok')} prêt(s) · ${n('off')} fermé(s) volontairement`,
  };
}

const HEADERS = { 'x-raptoru-studio': '1' };
const get = async <T>(path: string): Promise<T | null> => {
  try {
    const res = await fetch(path, { headers: HEADERS });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

/** Every input from the module's own read route (a missing one stays null: « non vérifié »). */
export async function loadReadiness(): Promise<ReadinessInput> {
  const [profile, runtime] = await Promise.all([
    get<ReadinessInput['profile']>('/api/profile'),
    get<{ services?: NonNullable<ReadinessInput['runtime']> }>(
      '/api/runtime/status',
    ),
  ]);
  const [control, channelPoints, alerts, se, wheel, games, spotify, wordGame] =
    await Promise.all([
      get<{ modules: Module[] }>('/api/control/status'),
      get<ReadinessInput['channelPoints']>('/api/channel-points/state'),
      get<ReadinessInput['alerts']>('/api/alerts/state'),
      // No StreamElements in the Lab: nothing to ask.
      profile?.effective === 'production'
        ? get<ReadinessInput['se']>('/api/alerts/se')
        : null,
      get<ReadinessInput['wheel']>('/api/sub-wheel/state'),
      get<ReadinessInput['games']>('/api/mini-games/state'),
      get<ReadinessInput['spotify']>('/api/spotify/state'),
      get<NonNullable<ReadinessInput['wordGame']>>('/api/word-game/state'),
    ]);
  return {
    profile,
    runtime: runtime?.services,
    modules: control?.modules ?? null,
    channelPoints,
    alerts,
    se,
    wheel,
    games,
    spotify,
    wordGame,
  };
}

const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ]!,
  );

/** The sentence at the top of the Centre (pure). */
export function verdict(checks: Check[]) {
  const n = (l: Level) => checks.filter((x) => x.level === l).length;
  const bad = n('error') + n('warn');
  if (bad) return `${bad} point${bad > 1 ? 's' : ''} à corriger avant le live`;
  return n('unknown')
    ? `Rien à corriger · ${n('unknown')} à vérifier toi-même`
    : 'Tout est prêt pour le live';
}

/** La chaîne du live : du serveur aux viewers, chaque vérification à sa place. Le nom court s'affiche, le nom complet reste au détail. */
export const CHAIN: {
  id: string;
  title: string;
  /** Là où ça arrive. */
  end: string;
  checks: [id: string, short: string][];
}[] = [
  {
    id: 'link',
    title: 'Le bot et Twitch',
    end: 'Le chat',
    checks: [
      ['core', 'Serveur'],
      ['bot', 'Bot'],
      ['twitch-chat', 'Chat Twitch'],
      ['twitch-broadcaster', 'Subs, bits, points'],
      ['twitch-token', 'Autorisation'],
      ['chat-output', 'Sortie chat'],
    ],
  },
  {
    id: 'stage',
    title: 'OBS et ses lecteurs',
    end: 'L’écran',
    checks: [
      ['obs', 'OBS'],
      ['effects', 'Lecteur d’effets'],
      ['soundboard', 'Soundboard'],
      ['tts', 'TTS'],
      ['bonk', 'Bonk'],
      ['alerts', 'Alertes'],
      ['se', 'Dons'],
    ],
  },
  {
    id: 'mods',
    title: 'Les modules',
    end: 'Les viewers',
    checks: [
      ['cp', 'Points de chaîne'],
      ['wheel', 'Roue du Sub'],
      ['games', 'Mini-jeux'],
      ['word-game', 'Jeu des mots'],
      ['spotify', 'Spotify'],
      ['extension', 'Extension'],
    ],
  },
];

const node = (x: Check, short: string) =>
  `<button type="button" class="ce-n" data-check="${esc(x.id)}" data-l="${x.level}" title="${esc(`${x.label} : ${x.state}`)}"><i></i>${esc(short)}</button>`;

/** La réponse à « est-ce prêt, et sinon que faire ? » : le verdict, la chaîne complète, puis les gestes dans l'ordre (pure). */
export function readinessHtml(
  checks: Check[] | undefined,
  href: (page: string) => string,
  lab = false,
) {
  if (!checks)
    return '<section class="ce-v"><h2>Prêt pour le live ?</h2><p class="d-faint">Vérification…</p></section>';
  const s = summary(checks);
  const sorted = ordered(checks);
  const todo = sorted.filter((x) => x.level === 'error' || x.level === 'warn');
  const toCheck = sorted.filter((x) => x.level === 'unknown');
  const n = (l: Level) => checks.filter((x) => x.level === l).length;
  const count = (v: number, label: string, l: string) =>
    `<li data-l="${l}"><b>${v}</b>${label}</li>`;
  const byId = new Map(checks.map((x) => [x.id, x]));
  const known = new Set(CHAIN.flatMap((l) => l.checks.map(([id]) => id)));
  const lanes = CHAIN.map((l, i) => {
    const extra =
      i === CHAIN.length - 1
        ? checks.filter((x) => !known.has(x.id)).map((x) => node(x, x.label))
        : [];
    const nodes = [
      ...l.checks.flatMap(([id, short]) => {
        const x = byId.get(id);
        return x ? [node(x, short)] : [];
      }),
      ...extra,
    ];
    return `<div class="ce-lane" data-lane="${l.id}"><h3 class="d-lb">${esc(l.title)}</h3><div class="ce-wire">${nodes.join('')}<span class="ce-end">${esc(l.end)}</span></div></div>`;
  }).join('');
  const step = (x: Check, at: number) =>
    `<li class="ce-s" data-step="${esc(x.id)}" data-l="${x.level}"><span class="ce-s__n">${at + 1}</span><div><h3>${esc(x.label)}<em>${esc(x.state)}</em></h3><p>${esc(x.why)}</p>${x.consequence ? `<p class="ce-s__v"><b>Pour les viewers :</b> ${esc(x.consequence)}</p>` : ''}</div>${x.fix ? `<a class="d-btn sm" href="${href(x.fix.page)}" data-page="${esc(x.fix.page)}">${esc(x.fix.label)}</a>` : ''}</li>`;
  return `<section class="ce-v" data-role="readiness" data-l="${s.level}">
      <div class="ce-v__t"><h2>${esc(verdict(checks))}</h2>${lab ? '<p>Lab : services locaux et lecteurs de ce PC, pas ton vrai stream.</p>' : ''}</div>
      <ul class="ce-counts">${count(todo.length, 'à corriger', 'error')}${count(toCheck.length, 'à vérifier', 'unknown')}${count(n('ok'), 'prêts', 'ok')}${count(n('off'), 'coupés', 'off')}</ul>
      <div class="ce-rule" aria-hidden="true">${sorted.map((x) => `<i data-l="${x.level}"></i>`).join('')}</div>
    </section>
    <section class="ce-chain" aria-label="La chaîne du live">${lanes}</section>
    <section class="ce-todo">
      <h2 class="d-lb">${todo.length ? 'À faire, dans l’ordre' : 'À faire'}</h2>
      ${todo.length ? `<ol class="ce-steps">${todo.map(step).join('')}</ol>` : '<p class="ce-calm">Rien à corriger.</p>'}
      ${toCheck.length ? `<h2 class="d-lb">Studio ne peut pas le vérifier : à toi de regarder</h2><div class="ce-unk">${toCheck.map((x) => node(x, x.label)).join('')}</div>` : ''}
      <p class="d-note">Lecture seule : chaque correction se fait dans la page indiquée.</p>
    </section>`;
}
