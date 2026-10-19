import type { LabCall } from '../ext/lab-internal.js';
import { HttpError, type Route } from './server.js';

// ASTRA-P1-019 (cockpit delta, minimal): the streamer's Studio screens that are not execution —
// Moderation V2, Tombola, Lab test wallet, TTS configuration — on the production transport. Only a
// paired Studio installation reaches them (its credential, never STUDIO_SECRET), for the Core's own
// channel only, and always as the broadcaster's Studio: an actor sent in the body is replaced.
// They relay in-process to the same Lab routes the Lab cockpit uses (same validation, permissions and
// audit); the Lab routes themselves stay off the public server. Never the Lab chat (a simulated message would move
// real money on the canonical Wallet), the chat answers' claim / ACK (the bot's) or the extension's own Tombola entry.
// Lot 8: the chat games' configuration (Commands V2, Jeu des mots, Roulette / Slot / Duel).

const STUDIO_ACTOR = { id: 'studio', role: 'broadcaster', via: 'studio' };

/** Allowed Lab sub-paths: `<prefix>/<channel>/…` (channel checked) or a channel-less route. */
const CHANNEL_ROUTES =
  /^(moderation|raffle|wallet|commands|word-game|mini-games)\/(\d{1,32})(\/[A-Za-z0-9/_-]*)?$/;
/** Never through the cockpit: the executor side of the chat answers belongs to the bot. */
const BOT_ONLY = /^commands\/\d{1,32}\/steps\/(claim|[0-9a-f-]{36}\/ack)$/;
// Channel-less: TTS rules; Soundboard bank configuration (prices, cooldowns, stack / queue / ignore,
// enabled, volume protection) — the « Soundboard config » screen.
const PLAIN_ROUTES =
  /^(tts\/rules(\/reset)?|sound\/(config|settings|sounds\/[a-z0-9][a-z0-9_-]{0,47}))$/;

export function studioCockpitRoutes(core: LabCall, channelId: string): Route[] {
  const target = (rest: string, search: string) => {
    if (BOT_ONLY.test(rest)) throw new HttpError(404, { error: 'not_found' });
    const channel = CHANNEL_ROUTES.exec(rest);
    if (channel) {
      if (channel[2] !== channelId)
        throw new HttpError(403, { error: 'wrong_channel' });
    } else if (!PLAIN_ROUTES.test(rest))
      throw new HttpError(404, { error: 'not_found' });
    return `/v1/lab/${rest}${search}`;
  };
  const relay = async (path: string, body?: unknown) => {
    try {
      return await core<unknown>(path, body);
    } catch (e) {
      const err = e as { status?: number; body?: unknown };
      if (typeof err.status === 'number')
        throw new HttpError(err.status, err.body ?? { error: 'error' });
      throw e;
    }
  };
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/studio\/cockpit\/([A-Za-z0-9/_-]{1,200})$/,
      auth: 'studio_installation',
      handle: ({ params, url }) => relay(target(params[0]!, url.search)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/studio\/cockpit\/([A-Za-z0-9/_-]{1,200})$/,
      auth: 'studio_installation',
      handle: ({ params, url, body }) => {
        const payload =
          body && typeof body === 'object' && !Array.isArray(body)
            ? { ...(body as Record<string, unknown>) }
            : {};
        if ('actor' in payload) payload.actor = STUDIO_ACTOR;
        return relay(target(params[0]!, url.search), payload);
      },
    },
  ];
}
