import {
  SoundLabAckRequest,
  SoundLabAdmitRequest,
  SoundLabClaimRequest,
  SoundLabHeartbeat,
  SoundLabSettings,
  SoundLabSoundId,
  SoundLabSoundUpdate,
} from '@raptoru/schemas';
import { z } from 'zod';
import {
  SoundLabError409,
  SoundLabNotFoundError,
  SoundLabUnavailableError,
  type SoundLabService,
} from '../sound-lab/sound-lab-service.js';
import { LabWalletError } from '../lab-moderation/store.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// Soundboard V2 Lab routes. Studio only (STUDIO_SECRET): the Studio server is the Lab façade of
// the extension, the local player and the configuration panel. Nothing here is reachable by the
// bot or the public.

const Uuid = z.uuid();
const Digits = z.string().regex(/^\d+$/);

export async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // Economic refusal at admission (Lab wallet or Core Wallet): a 409, like the TTS routes.
    if (error instanceof LabWalletError)
      throw new HttpError(409, { error: error.code, ...error.details });
    if (error instanceof SoundLabUnavailableError)
      throw new HttpError(503, { error: error.code });
    if (error instanceof SoundLabError409)
      throw new HttpError(409, {
        error: error.code,
        message: error.message,
        ...error.details,
      });
    if (error instanceof SoundLabNotFoundError)
      throw new HttpError(404, { error: 'interaction_not_found' });
    throw error;
  }
}

export function soundLabRoutes(sound: SoundLabService): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/sound\/channels\/([^/]+)\/catalog$/,
      auth: 'studio',
      handle: ({ params }) =>
        mapped(async () => ({
          sounds: await sound.catalog(parse(Digits, params[0])),
        })),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/sound\/config$/,
      auth: 'studio',
      handle: () => mapped(() => sound.config()),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/sounds\/([^/]+)$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          sound.updateSound(
            parse(SoundLabSoundId, params[0]),
            parse(SoundLabSoundUpdate, body),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/settings$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(() => sound.updateSettings(parse(SoundLabSettings, body))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/interactions$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(() => sound.admit(parse(SoundLabAdmitRequest, body))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/sound\/interactions\/([^/]+)$/,
      auth: 'studio',
      handle: ({ params }) => mapped(() => sound.get(parse(Uuid, params[0]))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/sound\/channels\/([^/]+)\/interactions$/,
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(async () => ({
          interactions: await sound.recent(
            parse(Digits, params[0]),
            limitParam(url, 20, 100),
          ),
        })),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/studio\/heartbeat$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(() => sound.heartbeat(parse(SoundLabHeartbeat, body))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/claim$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(async () => {
          const req = parse(SoundLabClaimRequest, body);
          return {
            interaction: await sound.claim(
              req.studio_instance_id,
              req.channel_id,
            ),
          };
        }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/interactions\/([^/]+)\/ack$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          sound.ack(parse(Uuid, params[0]), parse(SoundLabAckRequest, body)),
        ),
    },
  ];
}
