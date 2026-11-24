import {
  SOUND_FILE_RULES,
  SoundFileId,
  SoundFileUpload,
  SoundLabAckRequest,
  SoundLabAdmitRequest,
  SoundLabClaimRequest,
  SoundLabHeartbeat,
  SoundLabSettings,
  SoundLabSoundCreate,
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
import { SoundFileError } from '../sound-lab/wav.js';
import { LabWalletError } from '../lab-moderation/store.js';
import {
  HttpError,
  limitParam,
  parse,
  type Route,
  STREAMED,
} from './server.js';

/** A WAV of SOUND_FILE_RULES.maxBytes in base64, inside its JSON envelope: this route alone accepts it. */
export const SOUND_FILE_MAX_BODY =
  Math.ceil(SOUND_FILE_RULES.maxBytes / 3) * 4 + 4096;

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
    if (error instanceof SoundFileError)
      throw new HttpError(400, { error: error.code });
    throw error;
  }
}

/**
 * A published sound file for the extension's preview (public: an immutable extract, its id is its SHA-256; nothing
 * private in it). Any origin may fetch it: the extension reads it with fetch() (its CSP allows the Core in connect-src
 * and plays blob: media), so no Twitch media allowlist is needed.
 */
export function soundFileRoutes(sound: SoundLabService): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/ext\/sound-files\/([0-9a-f]{64})\.wav$/,
      auth: 'public',
      handle: async ({ params, res }) => {
        const file = await sound.file(params[0]!);
        if (!file) throw new HttpError(404, { error: 'unknown_file' });
        res!.writeHead(200, {
          'content-type': file.mime,
          'content-length': file.bytes.length,
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
          'cross-origin-resource-policy': 'cross-origin',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        });
        res!.end(file.bytes);
        return STREAMED;
      },
    },
  ];
}

export function soundLabRoutes(sound: SoundLabService): Route[] {
  return [
    {
      // Studio publishes a cut extract (sounds added or re-cut in Studio): checked and stored by its SHA-256.
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/files$/,
      auth: 'studio',
      maxBody: SOUND_FILE_MAX_BODY,
      handle: ({ body }) =>
        mapped(() =>
          sound.uploadFile(parse(SoundFileUpload, body).data_base64),
        ),
    },
    {
      // A published file for Studio's local cache (its Core channel speaks JSON).
      method: 'GET',
      pattern: /^\/v1\/lab\/sound\/files\/([^/]+)$/,
      auth: 'studio',
      handle: async ({ params }) => {
        const file = await sound.file(parse(SoundFileId, params[0]));
        if (!file) throw new HttpError(404, { error: 'unknown_file' });
        return { mime: file.mime, data_base64: file.bytes.toString('base64') };
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/sounds$/,
      auth: 'studio',
      handle: ({ body }) =>
        mapped(() => sound.createSound(parse(SoundLabSoundCreate, body))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/sound\/sounds\/([^/]+)\/delete$/,
      auth: 'studio',
      handle: ({ params }) =>
        mapped(() => sound.deleteSound(parse(SoundLabSoundId, params[0]))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/sound\/player-ready$/,
      auth: 'studio',
      handle: async () => ({ player_ready: await sound.playerReady() }),
    },
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
