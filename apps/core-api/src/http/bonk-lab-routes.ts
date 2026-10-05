import {
  BonkLabAckRequest,
  BonkLabAdmitRequest,
  BonkLabClaimRequest,
  BonkLabHeartbeat,
  BonkLabViewerAuthComplete,
} from '@raptoru/schemas';
import { z } from 'zod';
import {
  BonkLabError409,
  BonkLabNotFoundError,
  BonkLabUnavailableError,
  type BonkLabService,
} from '../bonk-lab/bonk-lab-service.js';
import {
  TwitchViewerError,
  type TwitchViewerCatalog,
} from '../bonk-lab/twitch-viewer.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// Bonk V2 Lab routes. Studio only (STUDIO_SECRET): the Studio server is both the Lab façade of the
// extension and the executor. Nothing here is reachable by the bot or the public.

const Uuid = z.uuid();
const Digits = z.string().regex(/^\d+$/);

export async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BonkLabUnavailableError)
      throw new HttpError(503, { error: error.code });
    if (error instanceof BonkLabError409)
      throw new HttpError(409, { error: error.code, message: error.message });
    if (error instanceof BonkLabNotFoundError)
      throw new HttpError(404, { error: 'interaction_not_found' });
    if (error instanceof TwitchViewerError)
      throw new HttpError(error.code.startsWith('oauth_') ? 400 : 409, {
        error: error.code,
      });
    throw error;
  }
}

export function bonkLabRoutes(
  bonk: BonkLabService,
  viewers: TwitchViewerCatalog | null = null,
): Route[] {
  return [
    ...(viewers ? viewerRoutes(viewers) : []),
    {
      // Public 7TV/BTTV/FFZ catalog of the channel: metadata + CDN URLs built by Core, no images.
      method: 'GET',
      pattern: /^\/v1\/lab\/bonk\/third-party\/catalog$/,
      auth: 'studio',
      handle: ({ url }) =>
        mapped(() =>
          bonk.thirdPartyCatalog(url.searchParams.get('refresh') === '1'),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/bonk\/interactions$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(() => bonk.admit(parse(BonkLabAdmitRequest, body))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/bonk\/interactions\/([^/]+)$/,
      auth: 'studio',
      handle: ({ params }) => mapped(() => bonk.get(parse(Uuid, params[0]))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/bonk\/channels\/([^/]+)\/interactions$/,
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(async () => ({
          interactions: await bonk.recent(
            parse(Digits, params[0]),
            url.searchParams.get('viewer_id')
              ? parse(Digits, url.searchParams.get('viewer_id'))
              : null,
            limitParam(url, 20, 100),
          ),
        })),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/bonk\/studio\/heartbeat$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(() => bonk.heartbeat(parse(BonkLabHeartbeat, body))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/bonk\/claim$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(async () => {
          const req = parse(BonkLabClaimRequest, body);
          return {
            interaction: await bonk.claim(
              req.studio_instance_id,
              req.channel_id,
            ),
          };
        }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/bonk\/interactions\/([^/]+)\/ack$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          bonk.ack(parse(Uuid, params[0]), parse(BonkLabAckRequest, body)),
        ),
    },
  ];
}

/** Twitch viewer identity + personal emote catalog (Lab Core only). Never returns a token. */
function viewerRoutes(viewers: TwitchViewerCatalog): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/bonk\/viewer-auth\/start$/,
      auth: 'studio',
      handle: () => mapped(() => viewers.startAuth()),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/bonk\/viewer-auth\/complete$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(async () => {
          const req = parse(BonkLabViewerAuthComplete, body);
          return { viewer: await viewers.completeAuth(req.code, req.state) };
        }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/bonk\/viewers$/,
      auth: 'studio',
      handle: () => mapped(async () => ({ viewers: await viewers.viewers() })),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/bonk\/viewers\/([^/]+)\/disconnect$/,
      auth: 'studio',
      handle: ({ params }) =>
        mapped(() => viewers.disconnect(parse(Digits, params[0]))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/bonk\/viewers\/([^/]+)\/catalog$/,
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() =>
          viewers.catalog(parse(Digits, params[0]), {
            force: url.searchParams.get('refresh') === '1',
          }),
        ),
    },
  ];
}
