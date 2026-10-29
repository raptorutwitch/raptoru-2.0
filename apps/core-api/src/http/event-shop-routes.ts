import {
  EventItemId,
  EventShopAckRequest,
  EventShopClaimRequest,
  EventShopConvertRequest,
  EventShopGrantRequest,
  EventShopHeartbeat,
  EventShopItemUpdate,
  EventShopPurchaseRequest,
  EventShopRules,
} from '@raptoru/schemas';
import { z } from 'zod';
import {
  EventShopError,
  type EventShopService,
} from '../event-shop/service.js';
import { HttpError, parse, type Route } from './server.js';

// Boutique d'événement (docs/HALLOWEEN.md).
// - Studio (panel + overlay executor): production /v1/studio/events/* (installation credential: a body naming another
//   Studio instance is refused), Lab /v1/lab/events/* (Studio secret).
// - Viewer (state, purchase, conversion): Lab routes only — reached in production through the Core's in-process call
//   by the extension frontier, after the Twitch JWT (never mounted on the public HTTP server).

const Digits = z.string().regex(/^\d{1,32}$/);
const Uuid = z.uuid();
const SettingsPatch = z.strictObject({
  enabled: z.boolean().optional(),
  rules: EventShopRules.partial().optional(),
});

export async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EventShopError)
      throw new HttpError(e.status, { error: e.code, ...e.details });
    throw e;
  }
}

export function eventShopRoutes(
  shop: EventShopService,
  production?: { channelId: string },
): Route[] {
  const base = production ? '/v1/studio/events' : '/v1/lab/events';
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const at = (path: string) =>
    new RegExp('^' + (base + path).replaceAll('/', '\\/') + '$');
  const channel = (id: string) => {
    const ch = parse(Digits, id);
    if (production && ch !== production.channelId)
      throw new HttpError(409, {
        error: 'wrong_channel',
        expected_channel_id: production.channelId,
      });
    return ch;
  };
  /** Production: the body must name the authenticated Studio installation. */
  const own = <T extends { studio_instance_id: string }>(
    req: T,
    installation?: string,
  ) => {
    if (production && req.studio_instance_id !== installation)
      throw new HttpError(403, { error: 'studio_instance_mismatch' });
    return req;
  };
  const studio: Route[] = [
    {
      method: 'GET',
      pattern: at('/channels/(\\d{1,32})/admin'),
      auth,
      handle: ({ params }) => mapped(() => shop.admin(channel(params[0]!))),
    },
    {
      // Studio › Bonbons: find a viewer (Bonbons wallets, then every viewer seen) with their balance.
      method: 'GET',
      pattern: at('/channels/(\\d{1,32})/viewers'),
      auth,
      handle: ({ params, url }) =>
        mapped(() =>
          shop.searchViewers(
            channel(params[0]!),
            (url.searchParams.get('q') ?? '').slice(0, 64),
          ),
        ),
    },
    {
      // One viewer's Bonbons: balance, purchases, movements.
      method: 'GET',
      pattern: at('/channels/(\\d{1,32})/viewers/(\\d{1,32})'),
      auth,
      handle: ({ params }) =>
        mapped(() => shop.viewerHistory(channel(params[0]!), params[1]!)),
    },
    {
      method: 'POST',
      pattern: at('/channels/(\\d{1,32})/settings'),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          shop.updateSettings(channel(params[0]!), parse(SettingsPatch, body)),
        ),
    },
    {
      method: 'POST',
      pattern: at('/channels/(\\d{1,32})/items/([^/]+)'),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          shop.updateItem(
            channel(params[0]!),
            parse(EventItemId, params[1]),
            parse(EventShopItemUpdate, body),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: at('/grant'),
      auth,
      handle: ({ body }) =>
        mapped(() => {
          const req = parse(EventShopGrantRequest, body);
          channel(req.channel_id);
          return shop.grant(req, 'studio');
        }),
    },
    {
      method: 'POST',
      pattern: at('/channels/(\\d{1,32})/stop'),
      auth,
      handle: ({ params }) => mapped(() => shop.stopAll(channel(params[0]!))),
    },
    {
      method: 'POST',
      pattern: at('/studio/heartbeat'),
      auth,
      handle: ({ body, installation }) =>
        mapped(() => {
          const req = own(parse(EventShopHeartbeat, body), installation);
          channel(req.channel_id);
          return shop.heartbeat(req);
        }),
    },
    {
      method: 'POST',
      pattern: at('/claim'),
      auth,
      handle: ({ body, installation }) =>
        mapped(async () => {
          const req = own(parse(EventShopClaimRequest, body), installation);
          return {
            play: await shop.claim(
              req.studio_instance_id,
              channel(req.channel_id),
            ),
          };
        }),
    },
    {
      method: 'POST',
      pattern: at('/purchases/([^/]+)/ack'),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(() =>
          shop.ack(
            parse(Uuid, params[0]),
            own(parse(EventShopAckRequest, body), installation),
          ),
        ),
    },
  ];
  if (production) return studio;
  // Viewer side (Lab façade, and the production frontier's in-process call).
  return [
    ...studio,
    {
      method: 'GET',
      pattern: at('/channels/(\\d{1,32})/state'),
      auth,
      handle: ({ params, url }) => {
        const v = url.searchParams.get('viewer');
        return mapped(() =>
          shop.viewerState(
            channel(params[0]!),
            v === null ? null : parse(Digits, v),
          ),
        );
      },
    },
    {
      method: 'POST',
      pattern: at('/purchase'),
      auth,
      handle: ({ body }) =>
        mapped(() => shop.purchase(parse(EventShopPurchaseRequest, body))),
    },
    {
      method: 'POST',
      pattern: at('/convert'),
      auth,
      handle: ({ body }) =>
        mapped(() => shop.convert(parse(EventShopConvertRequest, body))),
    },
  ];
}
