import {
  LabActor,
  LabModerationRequest,
  LabRaffleJoinRequest,
  LabRole,
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
import {
  RaffleLabError409,
  type RaffleLabService,
} from '../raffle-lab/raffle-lab-service.js';
import {
  SoundLabError409,
  SoundLabNotFoundError,
} from '../sound-lab/sound-lab-service.js';
import {
  TtsLabError409,
  TtsLabNotFoundError,
  type TtsLabService,
} from '../tts-lab/tts-lab-service.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// Moderation V2 (D4) + Lab test wallet + TTS configuration + Tombola. Registered by the Lab Core only
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
        grant: error.grant,
        needs: error.needs,
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
      error instanceof RaffleLabError409 ||
      error instanceof LabModerationError
    )
      throw new HttpError(409, {
        error: (error as { code: string }).code,
        message: error.message,
      });
    if (
      error instanceof TtsLabNotFoundError ||
      error instanceof SoundLabNotFoundError
    )
      throw new HttpError(404, { error: 'interaction_not_found' });
    throw error;
  }
}

export function labModerationRoutes(
  mod: LabModerationService,
  tts: TtsLabService,
  raffle: RaffleLabService,
): Route[] {
  const channel = (params: string[]) => parse(Digits, params[0]);
  /**
   * Read models are for the team. The extension façade names the reader (`as`, `as_role`): Core
   * refuses a viewer. Studio (no reader named) is the broadcaster.
   */
  const reader = async (c: string, url: URL) => {
    const id = url.searchParams.get('as');
    if (!id) return;
    await mod.assertReader(c, {
      id: parse(Digits, id),
      role: parse(LabRole, url.searchParams.get('as_role') ?? 'viewer'),
      via: 'extension',
    });
  };
  const read = <T>(fn: (c: string, url: URL, params: string[]) => Promise<T>) =>
    (({ params, url }: { params: string[]; url: URL }) =>
      mappedModeration(async () => {
        const c = channel(params);
        await reader(c, url);
        return fn(c, url, params);
      })) as Route['handle'];
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/overview$/,
      auth: 'studio',
      handle: read((c) => mod.overview(c)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/search$/,
      auth: 'studio',
      handle: read(async (c, url) => ({
        viewers: await mod.search(
          c,
          (url.searchParams.get('q') ?? '').slice(0, 40),
        ),
      })),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/viewers\/([^/]+)$/,
      auth: 'studio',
      handle: read((c, _url, params) =>
        mod.viewer(c, parse(Digits, params[1])),
      ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/interactions$/,
      auth: 'studio',
      handle: read((c, url) =>
        mod.interactions(c, {
          module: url.searchParams.get('module'),
          status: url.searchParams.get('status'),
          viewer: url.searchParams.get('viewer'),
          q: (url.searchParams.get('q') ?? '').slice(0, 40) || null,
          period: url.searchParams.get('period'),
          before: url.searchParams.get('before'),
          limit: limitParam(url, 60, 200),
        }),
      ),
    },
    {
      method: 'GET',
      pattern:
        /^\/v1\/lab\/moderation\/([^/]+)\/interactions\/([0-9a-f-]{36})$/,
      auth: 'studio',
      handle: read(async (c, _url, params) => {
        const found = await mod.interaction(c, params[1]!);
        if (!found)
          throw new HttpError(404, { error: 'interaction_not_found' });
        return found;
      }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/ledger$/,
      auth: 'studio',
      handle: read((c, url) =>
        mod.ledger(c, {
          viewer: url.searchParams.get('viewer'),
          before: Number(url.searchParams.get('before')) || null,
          limit: limitParam(url, 60, 200),
          auto: url.searchParams.get('auto') === '1',
        }),
      ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/team$/,
      auth: 'studio',
      handle: read((c) => mod.team(c)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/words$/,
      auth: 'studio',
      handle: read((c) => mod.words(c)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/moderation\/([^/]+)\/audit$/,
      auth: 'studio',
      handle: read(async (c, url) => ({
        audit: await mod.auditTrail(c, {
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
    // --- Tombola (extension session / entry) --------------------------------------------------------------
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/raffle\/([^/]+)\/state$/,
      auth: 'studio',
      handle: ({ params, url }) =>
        mappedModeration(() =>
          raffle.state(
            channel(params),
            url.searchParams.get('viewer')
              ? parse(Digits, url.searchParams.get('viewer'))
              : null,
          ),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/raffle\/entries$/,
      auth: 'studio',
      handle: ({ body }) =>
        mappedModeration(() => raffle.join(parse(LabRaffleJoinRequest, body))),
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
