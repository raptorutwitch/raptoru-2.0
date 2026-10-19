import type { Clock } from '../clock.js';
import { CommandsAdmission } from '../commands/admission.js';
import {
  raffleReservedWords,
  withMiniGameWords,
} from '../commands/reserved.js';
import { CommandsService } from '../commands/service.js';
import { CommandSteps } from '../commands/steps.js';
import type { Db } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import { MiniGamesService } from '../mini-games/service.js';
import {
  type LoginLookup,
  twitchAppLoginLookup,
} from '../mini-games/twitch-login.js';
import type { RaffleLabService } from '../raffle-lab/raffle-lab-service.js';
import { WordGameService } from '../word-game/service.js';
import { LabChatRouter, type LabChatModule } from './router.js';

// The chat games of Raptoru, assembled ONCE for every Core that hosts them (the Lab Core, the main Core): Commands V2
// (admission, answers as durable steps), Jeu des mots (whole chat), Roulette / Slot / Duel (whole chat). Same services,
// same rules; the runtime only gives its economy (Lab test wallet or canonical Wallet) and its broadcaster.

export function createChatGames(o: {
  db: Db;
  clock: Clock;
  economy: EconomyPort;
  raffle: RaffleLabService;
  /** The channel's real Twitch broadcaster (the streamer of every chat module), or null. */
  broadcasterOf: () => string | null;
  /** Twitch app (Duel: the target's Twitch ID by exact login); null = Duel by login unavailable. */
  twitch?: { clientId: string; clientSecret: string } | null;
  /** Replaces the Helix lookup of the Duel target (tests: never a call to Twitch). */
  loginLookup?: LoginLookup | null;
}) {
  // Tombola's chat words stay Tombola's (reserved); Roulette / Slot words are the mini-games' (StreamElements aliases).
  const reserved = withMiniGameWords(raffleReservedWords(o.raffle));
  const commands = new CommandsService(o.db, o.clock, { reserved });
  const admission = new CommandsAdmission(o.db, o.clock, {
    reserved,
    broadcasterOf: o.broadcasterOf,
  });
  const steps = new CommandSteps(o.db, o.clock);
  const wordGame = new WordGameService(
    o.db,
    o.clock,
    undefined,
    undefined,
    o.economy,
  );
  const miniGames = new MiniGamesService(
    o.db,
    o.clock,
    undefined,
    o.loginLookup ?? (o.twitch ? twitchAppLoginLookup(o.twitch) : null),
    o.economy,
  );
  const chatModules: LabChatModule[] = [
    { name: 'commands', chat: (m) => admission.chat(m) },
    { name: 'word_game', plainText: true, chat: (m) => wordGame.chat(m) },
    // Whole chat: the identities it learns are the Duel targets.
    { name: 'mini_games', plainText: true, chat: (m) => miniGames.chat(m) },
  ];
  return { commands, admission, steps, wordGame, miniGames, chatModules };
}
export type ChatGames = ReturnType<typeof createChatGames>;

/** The single chat ingress of a Core: the Tombola first, then the chat games. */
export function chatRouter(raffle: RaffleLabService, modules: LabChatModule[]) {
  return new LabChatRouter([
    {
      name: 'raffle',
      chat: (m) => raffle.chat(m),
      stream: (e) => raffle.streamEvent(e),
    },
    ...modules,
  ]);
}
