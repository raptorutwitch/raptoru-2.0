import { z } from 'zod';

// Chatbox Raptoru — the visibility manager (docs/CHATBOX.md § 6). ONE pure decision for every message, in this order:
// account rule → family of LeCroupier_'s message → special type → command → shown. Moderation (deleted message,
// excluded viewer, clear) never reaches here: it removes. Hiding a message in the chatbox never acts on Twitch.
// No AI, no list of sentences: the Core classifies (known command, Croupier family from cmd_steps, staff role).

export const Mode = z.enum(['hide', 'normal', 'highlight']);
export type Mode = z.infer<typeof Mode>;

/** What the chatbox receives for one chat message (from the Core, jalon 2; from the simulator, jalon 1). */
export interface ChatboxMessage {
  id: string;
  /** Epoch ms of the message. */
  at: number;
  user: {
    /** Twitch user id: the stable identity of every rule. */
    id: string;
    login: string;
    name: string;
    /** Twitch colour (#rrggbb) or null (the page picks the fallback palette). */
    color: string | null;
    badges: { set: string; version: string; url: string | null }[];
    /** Raptoru staff role joined by the Core (lab-moderation team table): an authorised source of moderation. */
    staff?: 'broadcaster' | 'supermod' | 'moderator' | null;
  };
  fragments: (
    | { t: 'text'; text: string }
    | { t: 'emote'; id: string; text: string }
    | { t: 'mention'; text: string }
    | { t: 'cheer'; text: string; bits: number }
    | { t: 'gif'; url: string; text: string }
  )[];
  /** `/me`. */
  action?: boolean;
  type?: 'chat' | 'announcement' | 'highlighted' | 'first' | 'sub' | 'raid';
  /** Twitch announcement colour. */
  accent?: 'primary' | 'blue' | 'green' | 'orange' | 'purple';
  reply?: { name: string; text: string };
  /** Set by the Core: the first word is a Raptoru command or alias (registry + modules' reserved words). */
  command?: { name: string; known: boolean };
  /** Set by the Core for LeCroupier_'s own messages: the family of the cmd_steps step that sent it (null: none). */
  croupier?: { family: string | null; command?: string | null };
}

export const Rules = z.strictObject({
  accounts: z
    .array(
      z.strictObject({
        /** Bound at the first message seen from `login` (or resolved by the Core): then the id decides. */
        id: z
          .string()
          .regex(/^\d{1,20}$/)
          .nullable(),
        login: z
          .string()
          .regex(/^[A-Za-z0-9_]{1,25}$/)
          .transform((s) => s.toLowerCase()),
        mode: Mode,
      }),
    )
    .max(300),
  commands: z.strictObject({
    /** Recognised Raptoru commands. */
    raptoru: z.enum(['hide', 'normal']),
    /** Other bots' commands (Nightbot, StreamElements…), hidden when listed. */
    external: z.array(z.string().regex(/^[\p{Ll}\p{N}_]{1,40}$/u)).max(300),
    /** `!word` that nobody recognises: never removed on the mere presence of « ! » by default. */
    unknown: z.enum(['hide', 'normal']),
    /**
     * Per command of the catalogue (its key; its aliases share it): the viewer's command message, and LeCroupier_'s
     * answer to it — set independently; absent = the defaults above / the Croupier's catalogue.
     */
    rules: z
      .record(
        z.string().regex(/^[\w:.-]{1,120}$/),
        z.strictObject({
          message: z.enum(['hide', 'normal']).optional(),
          reply: Mode.optional(),
        }),
      )
      .default({}),
  }),
  croupier: z.strictObject({
    /** A message of LeCroupier_ that no step explains (direct bot message, typed by hand). */
    fallback: Mode,
    categories: z.record(z.string(), Mode),
    families: z.record(z.string(), Mode),
  }),
  special: z.strictObject({
    announcement: Mode,
    highlighted: Mode,
    first: Mode,
    sub: Mode,
    raid: Mode,
  }),
});
export type Rules = z.infer<typeof Rules>;

/** LeCroupier_'s message categories (plain words for the streamer; a family belongs to exactly one). */
export const CROUPIER_CATEGORIES = [
  { id: 'commands', label: 'Réponses aux commandes' },
  { id: 'errors', label: 'Refus et erreurs' },
  { id: 'games', label: 'Jeux du chat' },
  { id: 'casino', label: 'Casino' },
  { id: 'raffle', label: 'Tombola' },
  { id: 'sub_wheel', label: 'Roue du Sub' },
  { id: 'music', label: 'Musique' },
  { id: 'level_up', label: 'Level Up' },
  { id: 'other', label: 'Autres' },
] as const;
export type CroupierCategory = (typeof CROUPIER_CATEGORIES)[number]['id'];

/**
 * A family id is `params.family` when the emitter declares one, else `<origin>:<kind>` and, for a command,
 * `commands:<kind>:<command>` (docs/CHATBOX.md § 6.3). Its category and a readable label follow from the origin.
 */
export function familyInfo(family: string): {
  category: CroupierCategory;
  label: string;
} {
  const [origin = '', kind = '', ...rest] = family.split(':');
  const what = rest.join(':');
  if (origin === 'bot')
    return {
      category: 'commands',
      label: 'Réponses directes du bot (Daily, Jetons)',
    };
  if (origin === 'commands') {
    if (kind === 'refusal')
      return {
        category: 'errors',
        label: what ? `Refus de !${what}` : 'Refus d’une commande',
      };
    return {
      category: 'commands',
      label: what ? `Réponse à !${what}` : 'Réponse à une commande',
    };
  }
  if (origin === 'module') {
    const mod = kind;
    if (mod === 'level_up')
      return { category: 'level_up', label: 'Annonce Level Up' };
    if (mod === 'casino')
      return { category: 'casino', label: 'Message du Casino' };
    return { category: 'other', label: `Module ${mod}` };
  }
  const label: Record<string, [CroupierCategory, string]> = {
    word_game: ['games', 'Jeu des mots'],
    mini_game: [
      'games',
      'Jeux et interactions du chat (mini-jeux, !rb, !tts, caution…)',
    ],
    raffle: ['raffle', 'Tombola'],
    sub_wheel: ['sub_wheel', 'Roue du Sub'],
    music: ['music', 'Musique'],
  };
  const hit = label[origin];
  if (hit) {
    const refusal = kind === 'refusal';
    return {
      category: refusal ? 'errors' : hit[0],
      label: refusal ? `${hit[1]} : refus` : hit[1],
    };
  }
  return { category: 'other', label: family };
}

export const DEFAULT_RULES: Rules = {
  // Ids bound at the first message seen (jalon 2: resolved by the Core, Helix).
  accounts: [
    { id: null, login: 'nightbot', mode: 'hide' },
    { id: null, login: 'streamelements', mode: 'hide' },
  ],
  commands: { raptoru: 'hide', external: [], unknown: 'normal', rules: {} },
  // LeCroupier_: ordinary messages and technical feedback hidden; Antoni allows the families he picks.
  croupier: {
    fallback: 'hide',
    categories: Object.fromEntries(
      CROUPIER_CATEGORIES.map((c) => [c.id, 'hide' as Mode]),
    ),
    families: {},
  },
  special: {
    announcement: 'highlight',
    highlighted: 'highlight',
    first: 'normal',
    // Already shown by the Twitch alerts: no duplicate by default (and not received before jalon 3).
    sub: 'hide',
    raid: 'hide',
  },
};

/** `!` followed by a letter or a digit; `!!!!!`, `!?!?`, `! salut` are never commands. */
export function commandName(text: string): string | null {
  const m = /^\s*!([\p{L}\p{N}][\p{L}\p{N}_]*)/u.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

export const messageText = (m: Pick<ChatboxMessage, 'fragments'>) =>
  m.fragments.map((f) => f.text).join('');

export type Role = 'broadcaster' | 'moderator' | 'vip' | null;

/**
 * The highest role an authorised source confirms: the Twitch badges, or the Raptoru staff role the Core joins. A Lead
 * Moderator carries `lead_moderator` INSTEAD of `moderator` (the historical widgets missed it: the Aouh case).
 */
export function roleOf(user: ChatboxMessage['user']): Role {
  const sets = new Set(user.badges.map((b) => b.set));
  if (sets.has('broadcaster') || user.staff === 'broadcaster')
    return 'broadcaster';
  if (
    sets.has('moderator') ||
    sets.has('lead_moderator') ||
    user.staff === 'supermod' ||
    user.staff === 'moderator'
  )
    return 'moderator';
  if (sets.has('vip')) return 'vip';
  return null;
}

export interface Decision {
  mode: Mode;
  /** What decided, in plain words (shown in Studio's preview, never on stream). */
  reason: string;
  /** A highlighted message's short tag. */
  label?: string;
}

const SPECIAL_LABEL: Record<string, string> = {
  announcement: 'Annonce',
  highlighted: 'Mis en avant',
  first: 'Premier message',
  sub: 'Abonnement',
  raid: 'Raid',
};

/** A command of the catalogue, found by any of its words (its aliases share its setting). */
export interface CommandRef {
  key: string;
  label: string;
}
export type CommandLookup = (word: string) => CommandRef | null;

export function decide(
  m: ChatboxMessage,
  rules: Rules,
  lookup: CommandLookup = () => null,
): Decision {
  const login = m.user.login.toLowerCase();
  const account = rules.accounts.find((a) =>
    a.id ? a.id === m.user.id : a.login === login,
  );
  if (account)
    return {
      mode: account.mode,
      reason:
        account.mode === 'hide'
          ? `compte ${account.login} masqué`
          : account.mode === 'highlight'
            ? `compte ${account.login} mis en avant`
            : `compte ${account.login} toujours affiché`,
      ...(account.mode === 'highlight' ? { label: m.user.name } : {}),
    };
  const special = m.type && m.type !== 'chat' ? m.type : null;
  if (m.croupier) {
    // LeCroupier_'s answer to a command: that command's own setting first (whatever module answered).
    const answered = m.croupier.command ? lookup(m.croupier.command) : null;
    const reply = answered
      ? rules.commands.rules[answered.key]?.reply
      : undefined;
    if (answered && reply)
      return {
        mode: reply,
        reason: `réponse du Croupier à ${answered.label}`,
        ...(reply === 'highlight'
          ? { label: special === 'announcement' ? 'Annonce' : answered.label }
          : {}),
      };
    const family = m.croupier.family;
    if (!family)
      return {
        mode: rules.croupier.fallback,
        reason: 'message du Croupier non catégorisé',
        ...(rules.croupier.fallback === 'highlight'
          ? { label: special ? SPECIAL_LABEL[special] : 'Croupier' }
          : {}),
      };
    const info = familyInfo(family);
    const own = rules.croupier.families[family];
    const mode = own ?? rules.croupier.categories[info.category] ?? 'hide';
    return {
      mode,
      reason: `Croupier : ${info.label}${own ? '' : ` (catégorie ${CROUPIER_CATEGORIES.find((c) => c.id === info.category)!.label})`}`,
      ...(mode === 'highlight'
        ? { label: special === 'announcement' ? 'Annonce' : info.label }
        : {}),
    };
  }
  if (special) {
    const mode = rules.special[special];
    if (mode !== 'normal')
      return {
        mode,
        reason: `${SPECIAL_LABEL[special]} : ${mode === 'hide' ? 'masqué' : 'mis en avant'}`,
        ...(mode === 'highlight' ? { label: SPECIAL_LABEL[special] } : {}),
      };
  }
  const name = commandName(messageText(m));
  if (name) {
    const known = lookup(name);
    if (known) {
      const mode =
        rules.commands.rules[known.key]?.message ?? rules.commands.raptoru;
      return { mode, reason: `commande ${known.label} (!${name})` };
    }
    // The simulator's own flag (no Core: no catalogue).
    if (m.command?.known)
      return {
        mode: rules.commands.raptoru,
        reason: `commande Raptoru !${name}`,
      };
    if (rules.commands.external.includes(name))
      return { mode: 'hide', reason: `commande externe !${name}` };
    return {
      mode: rules.commands.unknown,
      reason: `commande inconnue !${name}`,
    };
  }
  return { mode: 'normal', reason: 'message ordinaire' };
}
