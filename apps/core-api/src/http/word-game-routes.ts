import type { IncomingMessage, ServerResponse } from 'node:http';
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

const EVENTS = /^\/v1\/lab\/word-game\/(\d{1,32})\/events$/;

/**
 * Committed wins of a channel, pushed as server-sent events (`event: win`) to Studio, which relays them to
 * the OBS sound source. Live only: nothing is replayed on (re)connection. Called by the Lab Core server
 * after its Bearer check; returns false for any other request.
 */
export function serveWordGameEvents(
  game: WordGameService,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): boolean {
  const m = EVENTS.exec(url.pathname);
  if (!m || req.method !== 'GET') return false;
  const channelId = m[1]!;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  const off = game.onWin((w) => {
    if (w.channel_id === channelId)
      res.write(`event: win\ndata: ${JSON.stringify(w)}\n\n`);
  });
  res.on('close', off);
  return true;
}
