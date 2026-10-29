import {
  ProgressionEquipRequest,
  ProgressionGrantRequest,
  ProgressionImportRequest,
  ProgressionRevokeRequest,
  ProgressionRewardInput,
  ProgressionSettingsPatch,
} from '@raptoru/schemas';
import { z } from 'zod';
import {
  ProgressionError,
  type ProgressionService,
} from '../progression/service.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// Progression native (docs/PROGRESSION.md):
// - public, read-only (raptoru.fr): the levels ranking, one viewer's level / XP / inventory / equipped, the catalogue;
// - Studio (the paired installation in production, the Lab secret in the Lab): settings, catalogue, grant, revoke,
//   WizeBot import and its undo;
// - the site (its own token, SITE_TOKEN; mounted only when set): a viewer equips a title / badges. The site sends the
//   Twitch id of ITS signed-in viewer; the Core checks ownership.

const mapped = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProgressionError)
      throw new HttpError(e.status, { error: e.code });
    throw e;
  }
};

const TwitchId = z.string().regex(/^\d{1,32}$/);

export function progressionRoutes(
  svc: ProgressionService,
  o: { channelId: string; production: boolean; site: boolean },
): Route[] {
  const ch = o.channelId;
  const auth = o.production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const admin = (path: string) =>
    new RegExp(
      `^\\/v1\\/${o.production ? 'studio' : 'lab'}\\/progression${path}$`,
    );
  const actor = (installation?: string) => ({
    id: installation ?? 'studio',
    name: 'Studio',
  });
  return [
    // --- public -------------------------------------------------------------------------------------------------------
    {
      method: 'GET',
      pattern: /^\/v1\/progression\/leaderboard$/,
      auth: 'public',
      handle: ({ url }) => svc.leaderboard(ch, limitParam(url, 100, 500)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/progression\/viewers\/([^/]+)$/,
      auth: 'public',
      handle: ({ params }) => svc.viewer(ch, parse(TwitchId, params[0])),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/progression\/catalog$/,
      auth: 'public',
      handle: () => svc.catalog(ch),
    },
    // --- Studio ---------------------------------------------------------------------------------------------------------
    {
      method: 'GET',
      pattern: admin('/settings'),
      auth,
      handle: async () => ({
        ...(await svc.settings(ch)),
        catalog: await svc.catalog(ch, true),
      }),
    },
    {
      method: 'POST',
      pattern: admin('/settings'),
      auth,
      handle: ({ body }) =>
        mapped(() =>
          svc.updateSettings(ch, parse(ProgressionSettingsPatch, body)),
        ),
    },
    {
      method: 'GET',
      pattern: admin('/viewers'),
      auth,
      handle: ({ url }) =>
        svc.searchViewers(ch, url.searchParams.get('q') ?? ''),
    },
    {
      method: 'GET',
      pattern: admin('/viewers/([0-9]{1,32})'),
      auth,
      handle: ({ params }) => svc.viewer(ch, params[0]!),
    },
    {
      method: 'POST',
      pattern: admin('/rewards'),
      auth,
      handle: ({ body }) =>
        mapped(() => svc.upsertReward(ch, parse(ProgressionRewardInput, body))),
    },
    {
      method: 'POST',
      pattern: admin('/grant'),
      auth,
      handle: ({ body, installation }) =>
        mapped(() =>
          svc.grant(
            ch,
            parse(ProgressionGrantRequest, body),
            actor(installation),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: admin('/revoke'),
      auth,
      handle: ({ body, installation }) =>
        mapped(() =>
          svc.revoke(
            ch,
            parse(ProgressionRevokeRequest, body),
            actor(installation),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: admin('/import'),
      auth,
      handle: ({ body, installation }) =>
        mapped(() =>
          svc.importHistory(
            ch,
            parse(ProgressionImportRequest, body),
            actor(installation),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: admin('/import/revert'),
      auth,
      handle: () => mapped(() => svc.revertImport(ch, 'wizebot')),
    },
    // --- the site ---------------------------------------------------------------------------------------------------------
    ...(o.site
      ? [
          {
            method: 'POST' as const,
            pattern: /^\/v1\/site\/progression\/equip$/,
            auth: 'site' as const,
            handle: ({ body }: { body: unknown }) =>
              mapped(() => svc.equip(ch, parse(ProgressionEquipRequest, body))),
          },
        ]
      : []),
  ];
}
