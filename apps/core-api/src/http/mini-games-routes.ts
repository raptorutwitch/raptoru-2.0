import { MiniGamesSettings } from '@raptoru/schemas';
import type { MiniGamesService } from '../mini-games/service.js';
import { parse, type Route } from './server.js';

// Roulette and Slot V1 (Lab) — Studio routes (docs/ROULETTE_SLOT_PARITY.md § 6). Registered by the Lab Core
// only (Bearer secret, Lab database); never by the production or public Core. Viewers play in the chat only.

export function miniGamesRoutes(games: MiniGamesService): Route[] {
  return [
    {
      // The switch « Mini-jeux » and the last plays (read only).
      method: 'GET',
      pattern: /^\/v1\/lab\/mini-games\/(\d{1,32})\/state$/,
      auth: 'studio',
      handle: ({ params }) => games.state(params[0]!),
    },
    {
      // Turns the games on / off (OFF by default).
      method: 'POST',
      pattern: /^\/v1\/lab\/mini-games\/(\d{1,32})\/settings$/,
      auth: 'studio',
      handle: async ({ params, body }) =>
        games.setEnabled(params[0]!, parse(MiniGamesSettings, body).enabled),
    },
  ];
}
