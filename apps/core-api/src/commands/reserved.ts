import type { RaffleLabService } from '../raffle-lab/raffle-lab-service.js';
import { DUEL_WORDS } from '../mini-games/duel-rules.js';
import { MINI_GAME_WORDS } from '../mini-games/rules.js';
import type { ReservedWords } from './service.js';

/**
 * Tombola's chat commands (entry and cancel words, edited in Studio's Tombola tab) are Tombola's:
 * Commands V2 only reads them, through Tombola's own configuration reader, and refuses them.
 */
export function raffleReservedWords(
  raffle: Pick<RaffleLabService, 'config'>,
): ReservedWords {
  return async (q, channelId) => {
    const c = await raffle.config(q, channelId);
    return [...c.join_commands, ...c.cancel_commands].map((w) => ({
      word: w.replace(/^!+/, '').toLowerCase(),
      module: 'raffle',
    }));
  };
}

/** Roulette / Slot / Duel words (StreamElements aliases included) on top of another module's reserved words. */
export function withMiniGameWords(base: ReservedWords): ReservedWords {
  return async (q, channelId) => [
    ...(await base(q, channelId)),
    ...[...Object.keys(MINI_GAME_WORDS), ...Object.keys(DUEL_WORDS)].map(
      (word) => ({
        word,
        module: 'Mini-jeux',
      }),
    ),
  ];
}
