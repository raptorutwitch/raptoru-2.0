import {
  LabActor,
  LabModerationRequest,
  LabWalletRequest,
  TtsRulesReset,
  TtsRulesUpdate,
} from '@raptoru/schemas';
import { z } from 'zod';
import { BonkLabError409 } from '../bonk-lab/bonk-lab-service.js';
import {
  LabModerationError,
  type LabModerationService,
} from '../lab-moderation/service.js';
import { LabForbiddenError, LabWalletError } from '../lab-moderation/store.js';
import { SoundLabError409 } from '../sound-lab/sound-lab-service.js';
import {
  TtsLabError409,
  TtsLabNotFoundError,
  type TtsLabService,
} from '../tts-lab/tts-lab-service.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// Moderation V2 + Lab test wallet + TTS configuration. Registered by the Lab Core only
// (bonk-lab/local-server.ts: local, secret-protected, Lab database) — never by the production Core.

const Digits = z.string().regex(/^\d{1,32}$/);

/** Maps every moderation / wallet / module refusal to an explicit HTTP answer. */
export async function mappedModeration<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof LabForbiddenError)
      throw new HttpError(403, {
        error: 'forbidden',
        permission: error.permission,
        role: error.role,
        message: error.message,
      });
    if (error instanceof LabWalletError)
      throw new HttpError(409, { error: error.code, ...error.details });
    if (error instanceof TtsLabError409)
      throw new HttpError(409, {
        error: error.code,
        message: error.message,
        ...error.details,
      });
    if (
      error instanceof SoundLabError409 ||
      error instanceof BonkLabError409 ||
      error instanceof LabModerationError
    )
      throw new HttpError(409, {
        error: (error as { code: string }).code,
        message: error.message,
      });
    if (error instanceof TtsLabNotFoundError)
      throw new HttpError(404, { error: 'interaction_not_found' });
    throw error;
  }
}

export function labModerationRoutes(
  mod: LabModerationService,
  tts: TtsLabService,
): Route[] {
  const channel = (params: string[]) => parse(Digits, params[0]);
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/overview$/,
      auth: 'studio',
      handle: ({ params }) =>
        mappedModeration(() => mod.overview(channel(params))),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/search$/,
      auth: 'studio',
      handle: ({ params, url }) =>
        mappedModeration(async () => ({
          viewers: await mod.search(
            channel(params),
            (url.searchParams.get('q') ?? '').slice(0, 40),
          ),
        })),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/viewers\/([^/]+)$/,
      auth: 'studio',
      handle: ({ params }) =>
        mappedModeration(() =>
          mod.viewer(channel(params), parse(Digits, params[1])),
        ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/audit$/,
      auth: 'studio',
      handle: ({ params, url }) =>
        mappedModeration(async () => ({
          audit: await mod.auditTrail(channel(params), {
            limit: limitParam(url, 50, 200),
            module: url.searchParams.get('module'),
            viewer: url.searchParams.get('viewer'),
          }),
        })),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/whoami$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mappedModeration(() =>
          mod.whoami(channel(params), parse(LabActor, body)),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/actions$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mappedModeration(() =>
          mod.act(channel(params), parse(LabModerationRequest, body)),
        ),
    },
    // --- Lab test wallet -------------------------------------------------------------------------------
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/wallet\/([^/]+)\/([^/]+)$/,
      auth: 'studio',
      handle: ({ params }) =>
        mappedModeration(() =>
          mod.wallet(channel(params), parse(Digits, params[1])),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/wallet\/([^/]+)$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mappedModeration(() =>
          mod.editWallet(channel(params), parse(LabWalletRequest, body)),
        ),
    },
    // --- TTS configuration ------------------------------------------------------------------------------
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/tts\/rules$/,
      auth: 'studio',
      handle: () => mappedModeration(() => tts.rulesView()),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/tts\/rules$/,
      auth: 'studio',
      handle: ({ body }) =>
        mappedModeration(() => {
          const req = parse(TtsRulesUpdate, body);
          return tts.updateRules(req.rules, req.actor, req.reason ?? null);
        }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/tts\/rules\/reset$/,
      auth: 'studio',
      handle: ({ body }) =>
        mappedModeration(() => {
          const req = parse(TtsRulesReset, body);
          return tts.updateRules(
            null as never,
            req.actor,
            req.reason ?? null,
            true,
          );
        }),
    },
  ];
}
