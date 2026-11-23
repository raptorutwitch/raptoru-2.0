import { buildCatalog } from '../chatbox/catalog.js';
import {
  ChatboxBatch,
  type ChatboxEvent,
  type ChatboxRelay,
} from '../chatbox/relay.js';
import type { ReservedWord } from '../commands/service.js';
import type { Queryable } from '../db/db.js';
import { HttpError, parse, type Route, STREAMED } from './server.js';

// Chatbox Raptoru (docs/CHATBOX.md § 5.1): the bot's door (its chat events, bot secret) and Studio's (the relay's
// stream and the command catalogue, installation credential), on the Core's channel only. Mounted before the cockpit's
// catch-all GET. In the Lab environment the same routes serve the Lab's Studio (its cockpit), fed by the simulator.

export const CHATBOX_KEEPALIVE_MS = 25_000;

export function chatboxRoutes(o: {
  relay: ChatboxRelay;
  channelId: string;
  db: Queryable;
  reserved: (q: Queryable, channelId: string) => Promise<ReservedWord[]>;
  /** Studio's routes need the cockpit (installation credential). */
  studio: boolean;
}): Route[] {
  const own = (id: string) => {
    if (id !== o.channelId)
      throw new HttpError(403, { error: 'wrong_channel' });
  };
  const routes: Route[] = [
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/chatbox$/,
      auth: 'bot',
      maxBody: 512 * 1024,
      handle: async ({ body }) => {
        const b = parse(ChatboxBatch, body);
        if (b.channel_id !== o.channelId)
          throw new HttpError(409, {
            error: 'wrong_channel',
            expected_channel_id: o.channelId,
          });
        await o.relay.ingest(b);
        return { ok: true, cursor: o.relay.cursor };
      },
    },
  ];
  if (!o.studio) return routes;
  routes.push(
    {
      method: 'GET',
      pattern: /^\/v1\/studio\/cockpit\/chatbox\/(\d{1,32})\/catalog$/,
      auth: 'studio_installation',
      handle: async ({ params }) => {
        own(params[0]!);
        return {
          commands: await buildCatalog({
            db: o.db,
            channelId: o.channelId,
            reserved: o.reserved,
            discovered: o.relay.discovered,
          }),
        };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/studio\/cockpit\/chatbox\/(\d{1,32})\/events$/,
      auth: 'studio_installation',
      handle: async ({ params, res, url }) => {
        own(params[0]!);
        const r = res!;
        r.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        const send = (event: string, data: unknown) =>
          r.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        // Studio says what it last saw: only the newer events, or a reset (another boot of this Core, or too old).
        const missed = o.relay.since(
          url.searchParams.get('boot') ?? '',
          Number(url.searchParams.get('after') ?? -1),
        );
        send('hello', { boot: o.relay.boot, cursor: o.relay.cursor });
        if (missed) for (const e of missed) send('chatbox', e);
        else
          send('reset', {
            cursor: o.relay.cursor,
            messages: o.relay.snapshot(),
          });
        const off = o.relay.listen((e: ChatboxEvent) => send('chatbox', e));
        const keepalive = setInterval(
          () => r.write(': ping\n\n'),
          CHATBOX_KEEPALIVE_MS,
        );
        r.on('close', () => {
          off();
          clearInterval(keepalive);
        });
        return STREAMED;
      },
    },
  );
  return routes;
}
