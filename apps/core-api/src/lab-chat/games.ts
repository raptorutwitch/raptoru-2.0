import type { Clock } from '../clock.js';
import { CommandsAdmission } from '../commands/admission.js';
import {
  raffleReservedWords,
  withInteractionWords,
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
import { TtsChat } from '../tts-lab/chat.js';
import {
  type ChatPrices,
  defaultChatPrices,
} from '../chat-interactions/prices.js';
import { RandomBanChat } from '../chat-interactions/random-ban-chat.js';
import { FxCamChat } from '../chat-interactions/fx-cam-chat.js';
import type { ChannelPointsService } from '../channel-points/service.js';
import type { CautionService } from '../caution/service.js';
import type { VotekickService } from '../votekick/service.js';
import type { RandomBanService } from '../random-ban/service.js';
import type { TtsLabService } from '../tts-lab/tts-lab-service.js';
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
  /** The TTS of this Core: `!tts <message>` in the chat buys the extension's TTS (absent: no chat TTS). */
  tts?: TtsLabService | null;
  /** The Random Ban of this Core: `!rb` in the chat pays it in Jetons (absent: no chat Random Ban). */
  randomBan?: RandomBanService | null;
  /** The channel points engine of this Core: `!fxcam <effet>` pays its FX Cam in Jetons (absent: no chat FX Cam). */
  channelPoints?: ChannelPointsService | null;
  /** Prices of the chat interactions (default: the validated ones, chat-interactions/prices.ts). */
  chatPrices?: ChatPrices;
  /** `!caution pseudo` + `oui` / `non` (absent: no chat Caution — the main Core only with CAUTION_CHAT=true). */
  caution?: CautionService | null;
  /** `!votekick pseudo`, `!kick`, `!save` (absent: no Votekick — the main Core only with VOTEKICK_CHAT=true). */
  votekick?: VotekickService | null;
}) {
  // Tombola's chat words stay Tombola's (reserved); Roulette / Slot words are the mini-games' (StreamElements aliases);
  // `!tts` is the TTS's.
  const reserved = withInteractionWords(
    withMiniGameWords(raffleReservedWords(o.raffle)),
  );
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
  if (o.tts) {
    const ttsChat = new TtsChat(o.db, o.clock, o.tts);
    chatModules.push({ name: 'tts', chat: (m) => ttsChat.chat(m) });
  }
  const randomBanChat = o.randomBan
    ? new RandomBanChat(
        o.db,
        o.clock,
        o.randomBan,
        o.economy,
        o.chatPrices ?? defaultChatPrices,
      )
    : null;
  if (randomBanChat)
    chatModules.push({
      name: 'random_ban',
      chat: (m) => randomBanChat.chat(m),
    });
  const fxCamChat = o.channelPoints
    ? new FxCamChat(
        o.db,
        o.clock,
        o.channelPoints,
        o.economy,
        o.chatPrices ?? defaultChatPrices,
      )
    : null;
  if (fxCamChat)
    chatModules.push({ name: 'fx_cam', chat: (m) => fxCamChat.chat(m) });
  const caution = o.caution ?? null;
  // Plain text too: the payer answers `oui` / `non`.
  if (caution)
    chatModules.push({
      name: 'caution',
      plainText: true,
      chat: (m) => caution.chat(m),
    });
  const votekick = o.votekick ?? null;
  if (votekick)
    chatModules.push({ name: 'votekick', chat: (m) => votekick.chat(m) });
  return {
    commands,
    admission,
    steps,
    wordGame,
    miniGames,
    chatModules,
    randomBanChat,
    fxCamChat,
  };
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
