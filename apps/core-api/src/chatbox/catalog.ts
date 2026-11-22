import type { Queryable } from '../db/db.js';
import { ADMIN_WALLET_WORDS } from '../commands/reserved.js';
import type { ReservedWord } from '../commands/service.js';
import { DUEL_WORDS } from '../mini-games/duel-rules.js';
import { MINI_GAME_WORDS } from '../mini-games/rules.js';

// Chatbox Raptoru — every chat command the project knows (docs/CHATBOX.md § 6.2), for Studio's command catalogue:
// the Commands V2 registry of the channel (names + aliases, disabled ones included: read live, so a command created in
// Studio appears at once), the modules' reserved words (Tombola, mini-games, interactions, module host), the words the
// modules only declare in their own parser (listed ONCE here) and the words a module took in the chat (discovered:
// a new module command appears on its first use). One entry per command; its aliases share its setting.

export interface CatalogCommand {
  /** Stable: `v2:<command_id>`, `module:<id>`, `found:<word>`. */
  key: string;
  label: string;
  module: string;
  /** The words that call it (the first is its name), lower case, without « ! ». */
  words: string[];
  source: 'commands_v2' | 'module' | 'discovered';
  enabled: boolean;
}

/** The modules whose words only live in their parser (caution/service.ts, spotify/chat.ts…): one list, one place. */
export const MODULE_COMMANDS: {
  id: string;
  label: string;
  module: string;
  words: string[];
}[] = [
  { id: 'tts', label: 'Message lu par le TTS', module: 'TTS', words: ['tts'] },
  { id: 'rb', label: 'Random Ban', module: 'Random Ban', words: ['rb'] },
  {
    id: 'fxcam',
    label: 'Effet sur la caméra',
    module: 'FX Cam',
    words: ['fxcam'],
  },
  { id: 'caution', label: 'Caution', module: 'Caution', words: ['caution'] },
  {
    id: 'votekick',
    label: 'Votekick',
    module: 'Votekick',
    words: ['votekick'],
  },
  { id: 'roue', label: 'Roue du Sub', module: 'Roue du Sub', words: ['roue'] },
  { id: 'song', label: 'Titre en cours', module: 'Musique', words: ['song'] },
  {
    id: 'songqueue',
    label: 'File de musique',
    module: 'Musique',
    words: ['songqueue'],
  },
  {
    id: 'mysong',
    label: 'Ma demande de musique',
    module: 'Musique',
    words: ['mysong'],
  },
  {
    id: 'songskip',
    label: 'Passer le titre',
    module: 'Musique',
    words: ['songskip'],
  },
  {
    id: 'songcancel',
    label: 'Annuler ma demande',
    module: 'Musique',
    words: ['songcancel'],
  },
  {
    id: 'songremove',
    label: 'Retirer une demande',
    module: 'Musique',
    words: ['songremove'],
  },
  {
    id: 'peur',
    label: 'Boutique Halloween : peur',
    module: 'Halloween',
    words: ['peur'],
  },
  {
    id: 'bonbons',
    label: 'Boutique Halloween : bonbons',
    module: 'Halloween',
    words: ['bonbons'],
  },
  {
    id: 'mots',
    label: 'Jeu des mots : score',
    module: 'Jeu des mots',
    words: ['mots'],
  },
  {
    id: 'streakmot',
    label: 'Jeu des mots : série',
    module: 'Jeu des mots',
    words: ['streakmot'],
  },
  {
    id: 'objectif',
    label: 'Objectif de la soirée',
    module: 'Objectif de la soirée',
    words: ['objectif'],
  },
  // Answered by the bot itself (twitch-bot: chat-commands.ts, loyalty-commands.ts).
  { id: 'daily', label: 'Daily', module: 'Daily', words: ['daily'] },
  { id: 'streak', label: 'Série du Daily', module: 'Daily', words: ['streak'] },
  {
    id: 'solde',
    label: 'Solde de Jetons',
    module: 'Jetons',
    words: ['solde', 'balance', 'compte'],
  },
  {
    id: 'give',
    label: 'Donner des Jetons',
    module: 'Jetons',
    words: ['give', 'trade'],
  },
  { id: 'wallet', label: 'Portefeuille', module: 'Jetons', words: ['wallet'] },
  {
    id: 'admin-wallet',
    label: 'Jetons : commandes des modérateurs',
    module: 'Portefeuille',
    words: [...ADMIN_WALLET_WORDS],
  },
];

const MODULE_LABEL: Record<string, string> = {
  raffle: 'Tombola',
  'Mini-jeux': 'Mini-jeux',
};

export async function buildCatalog(o: {
  db: Queryable;
  channelId: string;
  reserved: (q: Queryable, channelId: string) => Promise<ReservedWord[]>;
  discovered: Map<string, string>;
}): Promise<CatalogCommand[]> {
  const out: CatalogCommand[] = [];
  const taken = new Set<string>();
  const add = (c: CatalogCommand) => {
    const words = c.words
      .map((w) => w.toLowerCase())
      .filter((w) => w && !taken.has(w));
    if (!words.length) return;
    words.forEach((w) => taken.add(w));
    out.push({ ...c, words });
  };
  const rows = await o.db
    .query<{
      command_id: string;
      name: string;
      enabled: boolean;
      config: { aliases?: unknown; category?: unknown };
    }>(
      `select command_id, name, enabled, config from cmd_commands
         where channel_id = $1 and deleted_at is null order by name`,
      [o.channelId],
    )
    .catch(() => []);
  for (const r of rows)
    add({
      key: `v2:${r.command_id}`,
      label: `!${r.name}`,
      module:
        typeof r.config?.category === 'string' && r.config.category
          ? `Commandes : ${r.config.category}`
          : 'Commandes du chat',
      words: [
        r.name,
        ...(Array.isArray(r.config?.aliases)
          ? r.config.aliases.map(String)
          : []),
      ],
      source: 'commands_v2',
      enabled: r.enabled,
    });
  for (const m of MODULE_COMMANDS)
    add({
      key: `module:${m.id}`,
      label: m.label,
      module: m.module,
      words: m.words,
      source: 'module',
      enabled: true,
    });
  // Roulette / Slot / Duel: one entry per game, its StreamElements aliases with it.
  const games = new Map<string, string[]>();
  for (const [word, game] of Object.entries(MINI_GAME_WORDS))
    games.set(String(game), [...(games.get(String(game)) ?? []), word]);
  for (const [game, words] of games)
    add({
      key: `module:mini-${game}`,
      label: game[0]!.toUpperCase() + game.slice(1),
      module: 'Mini-jeux',
      words,
      source: 'module',
      enabled: true,
    });
  add({
    key: 'module:duel',
    label: 'Duel',
    module: 'Mini-jeux',
    words: Object.keys(DUEL_WORDS),
    source: 'module',
    enabled: true,
  });
  const reserved = await o
    .reserved(o.db, o.channelId)
    .catch(() => [] as ReservedWord[]);
  const byModule = new Map<string, string[]>();
  for (const r of reserved)
    byModule.set(r.module, [...(byModule.get(r.module) ?? []), r.word]);
  for (const [module, words] of byModule)
    for (const w of words)
      add({
        key: `module:${module.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${w}`,
        label: `!${w}`,
        module: MODULE_LABEL[module] ?? module,
        words: [w],
        source: 'module',
        enabled: true,
      });
  for (const [w, module] of o.discovered)
    add({
      key: `found:${w}`,
      label: `!${w}`,
      module: MODULE_LABEL[module] ?? module,
      words: [w],
      source: 'discovered',
      enabled: true,
    });
  return out;
}
