import type { IncomingMessage, ServerResponse } from 'node:http';
import { WordGameAction } from '@raptoru/schemas';
import { WordGameError, type WordGameService } from '../word-game/service.js';
import { HttpError, parse, type Route, STREAMED } from './server.js';

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
  streamWins(game, m[1]!, res);
  return true;
}

/** Keeps an idle stream open through reverse proxies (a comment line: ignored by Studio). */
export const EVENTS_KEEPALIVE_MS = 25_000;

function streamWins(
  game: WordGameService,
  channelId: string,
  res: ServerResponse,
) {
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
  const keepalive = setInterval(
    () => res.write(': ping\n\n'),
    EVENTS_KEEPALIVE_MS,
  );
  res.on('close', () => {
    off();
    clearInterval(keepalive);
  });
}

/**
 * Lot 9 — the same stream for Studio's production profile (installation credential, the Core's channel only): the
 * main Core's committed wins reach Studio, which relays them to its local OBS sound source. Live only, like the Lab:
 * a (re)connection never replays a win, a win is emitted once (never for a replayed message).
 */
export function wordGameCockpitEvents(
  game: WordGameService,
  channelId: string,
): Route {
  return {
    method: 'GET',
    pattern: /^\/v1\/studio\/cockpit\/word-game\/(\d{1,32})\/events$/,
    auth: 'studio_installation',
    handle: async ({ params, res }) => {
      if (params[0] !== channelId)
        throw new HttpError(403, { error: 'wrong_channel' });
      streamWins(game, channelId, res!);
      return STREAMED;
    },
  };
}
