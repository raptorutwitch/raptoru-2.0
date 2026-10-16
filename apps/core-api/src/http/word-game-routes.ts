import { WordGameAction } from '@raptoru/schemas';
import { WordGameError, type WordGameService } from '../word-game/service.js';
import { HttpError, parse, type Route } from './server.js';

// Jeu des mots V1 (Lab) — Studio routes (docs/WORD_GAME_PARITY.md § 14). Registered by the Lab Core only
// (Bearer secret, Lab database); never by the production or public Core. Viewers play in the chat only.

const channel = (params: string[]) => params[0]!;

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WordGameError)
      throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

export function wordGameRoutes(game: WordGameService): Route[] {
  return [
    {
      // Status, active words and their age, streak, recent wins (read only).
      method: 'GET',
      pattern: /^\/v1\/lab\/word-game\/(\d{1,32})\/state$/,
      auth: 'studio',
      handle: ({ params }) => game.state(channel(params)),
    },
    {
      // « Arrêter » / reprise of the cycle, « Nouveau mot » (live session only: 409 offline).
      method: 'POST',
      pattern: /^\/v1\/lab\/word-game\/(\d{1,32})\/actions$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => game.act(channel(params), parse(WordGameAction, body))),
    },
  ];
}
