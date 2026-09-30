import {
  TtsLabAckRequest,
  TtsLabAdmitRequest,
  TtsLabClaimRequest,
  TtsLabHeartbeat,
  TtsLabModerationRequest,
} from '@raptoru/schemas';
import { z } from 'zod';
import {
  TtsLabError409,
  TtsLabNotFoundError,
  TtsLabUnavailableError,
  type TtsLabService,
} from '../tts-lab/tts-lab-service.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// TTS V2 Lab routes. Studio only (STUDIO_SECRET / Lab Core secret): the Studio server is the Lab
// façade of the extension, the TTS worker of the local player and (later) the moderation panel.
// Nothing here is reachable by the bot or the public.

const Uuid = z.uuid();
const Digits = z.string().regex(/^\d+$/);

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TtsLabUnavailableError)
      throw new HttpError(503, { error: error.code });
    if (error instanceof TtsLabError409)
      throw new HttpError(409, {
        error: error.code,
        message: error.message,
        ...error.details,
      });
    if (error instanceof TtsLabNotFoundError)
      throw new HttpError(404, { error: 'interaction_not_found' });
    throw error;
  }
}

export function ttsLabRoutes(tts: TtsLabService): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/tts\/config$/,
      auth: 'studio',
      handle: () => mapped(() => tts.publicConfig()),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/tts\/channels\/([^/]+)\/viewers\/([^/]+)\/state$/,
      auth: 'studio',
      handle: ({ params }) =>
        mapped(() =>
          tts.viewerState(parse(Digits, params[0]), parse(Digits, params[1])),
        ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/tts\/channels\/([^/]+)\/queue$/,
      auth: 'studio',
      handle: ({ params }) => mapped(() => tts.queue(parse(Digits, params[0]))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/tts\/channels\/([^/]+)\/audit$/,
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(async () => ({
          audit: await tts.auditTrail(
            parse(Digits, params[0]),
            limitParam(url, 50, 200),
          ),
        })),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/tts\/channels\/([^/]+)\/moderation$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          tts.moderate(
            parse(Digits, params[0]),
            parse(TtsLabModerationRequest, body),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/tts\/interactions$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(() => tts.admit(parse(TtsLabAdmitRequest, body))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/tts\/interactions\/([^/]+)$/,
      auth: 'studio',
      handle: ({ params }) => mapped(() => tts.get(parse(Uuid, params[0]))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/tts\/studio\/heartbeat$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(() => tts.heartbeat(parse(TtsLabHeartbeat, body))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/tts\/claim$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(async () => {
          const req = parse(TtsLabClaimRequest, body);
          return {
            interaction: await tts.claim(
              req.studio_instance_id,
              req.channel_id,
            ),
          };
        }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/tts\/interactions\/([^/]+)\/ack$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          tts.ack(parse(Uuid, params[0]), parse(TtsLabAckRequest, body)),
        ),
    },
  ];
}
