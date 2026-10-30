import {
  LevelUpClaimRequest,
  LevelUpNotifyMode,
  LevelV2ActivateRequest,
  ProgressionAdjustRequest,
  ProgressionAttachRequest,
  ProgressionEquipRequest,
  ProgressionGrantRequest,
  ProgressionImportRequest,
  ProgressionResolveRequest,
  ProgressionWizebotImportRequest,
  ViewerPrefsRequest,
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
//   WizeBot import (every row kept, attached when certain), its status, the re-attachment of waiting rows, its undo;
//   manual XP adjustments and a viewer's journal;
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
/**
 * The viewer's level-up notification mode, read and written by the extension's façade (the JWT's identity): the Lab
 * Core serves it on HTTP to the Extension Lab (Lab secret); the main Core only in-process (never on HTTP).
 */
export function progressionViewerPrefsRoutes(
  svc: ProgressionService,
  channelId: string,
): Route[] {
  const pattern = /^\/v1\/lab\/progression\/prefs\/(\d{1,32})$/;
  return [
    {
      method: 'GET',
      pattern,
      auth: 'studio',
      handle: ({ params }) => svc.viewerPrefs(channelId, params[0]!),
    },
    {
      method: 'POST',
      pattern,
      auth: 'studio',
      handle: ({ params, body }) =>
        svc.setViewerPrefs(
          channelId,
          params[0]!,
          parse(ViewerPrefsRequest, body),
        ),
    },
  ];
}

const SiteIdentify = z.strictObject({
  viewer: TwitchId,
  login: z.string().regex(/^[a-z0-9_]{1,25}$/),
  display_name: z.string().trim().min(1).max(40).nullable().default(null),
});

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
      handle: ({ url }) =>
        svc.leaderboard(
          ch,
          limitParam(url, 100, 2000),
          parse(
            z.enum(['xp', 'watch', 'messages']),
            url.searchParams.get('by') ?? 'xp',
          ),
          parse(
            z.enum(['all', 'week', 'month']),
            url.searchParams.get('period') ?? 'all',
          ),
        ),
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
      method: 'GET',
      pattern: admin('/viewers/([0-9]{1,32})/history'),
      auth,
      handle: ({ params }) => svc.history(ch, params[0]!),
    },
    {
      method: 'POST',
      pattern: admin('/adjust'),
      auth,
      handle: ({ body, installation }) =>
        mapped(() =>
          svc.adjust(
            ch,
            parse(ProgressionAdjustRequest, body),
            actor(installation),
          ),
        ),
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
      // Studio's « Simuler » / « Importer depuis WizeBot »: the Core reads raptoru.fr's export itself.
      method: 'POST',
      pattern: admin('/import/wizebot'),
      auth,
      handle: ({ body, installation }) =>
        mapped(() =>
          svc.importFromWizebot(
            ch,
            parse(ProgressionWizebotImportRequest, body ?? {}).dry_run,
            actor(installation),
          ),
        ),
    },
    {
      method: 'GET',
      pattern: admin('/import/waiting'),
      auth,
      handle: ({ url }) => svc.waiting(ch, url.searchParams.get('q') ?? ''),
    },
    {
      method: 'POST',
      pattern: admin('/import/attach'),
      auth,
      handle: ({ body, installation }) =>
        mapped(() =>
          svc.attachManually(
            ch,
            parse(ProgressionAttachRequest, body),
            actor(installation),
          ),
        ),
    },
    // --- Level Up V2 ---------------------------------------------------------------------------------------------------
    {
      method: 'GET',
      pattern: admin('/level-v2'),
      auth,
      handle: () => svc.levelV2Status(ch),
    },
    {
      // Once, with the typed confirmation (never a plain click).
      method: 'POST',
      pattern: admin('/level-v2/activate'),
      auth,
      handle: ({ body, installation }) => {
        parse(LevelV2ActivateRequest, body);
        return mapped(() => svc.activateLevelV2(ch, actor(installation)));
      },
    },
    {
      method: 'POST',
      pattern: admin('/level-v2/revert'),
      auth,
      handle: ({ body }) => {
        parse(
          z.strictObject({ confirm: z.literal('ANNULER LA NORMALISATION') }),
          body,
        );
        return mapped(() => svc.revertLevelV2(ch));
      },
    },
    {
      method: 'GET',
      pattern: admin('/levelups'),
      auth,
      handle: () => svc.levelUps(ch),
    },
    {
      // Studio's OBS level-up source: the next notices (delivered once).
      method: 'POST',
      pattern: admin('/levelups/claim'),
      auth,
      handle: ({ body }) =>
        svc.claimLevelUps(ch, parse(LevelUpClaimRequest, body).consumer),
    },
    {
      method: 'POST',
      pattern: admin('/viewers/([0-9]{1,32})/notify'),
      auth,
      handle: ({ params, body }) =>
        svc.setViewerPrefs(ch, params[0]!, {
          level_up_notify: parse(
            z.strictObject({ level_up_notify: LevelUpNotifyMode }),
            body,
          ).level_up_notify,
        }),
    },
    {
      method: 'GET',
      pattern: admin('/import/status'),
      auth,
      handle: () => svc.importStatus(ch),
    },
    {
      // The stored rows still waiting, attached again against today's Core (no new WizeBot reading needed).
      method: 'POST',
      pattern: admin('/import/resolve'),
      auth,
      handle: ({ body, installation }) => {
        const r = parse(ProgressionResolveRequest, body ?? {});
        return mapped(() =>
          svc.importHistory(
            ch,
            { source: r.source, dry_run: r.dry_run, rows: [] },
            actor(installation),
          ),
        );
      },
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
          {
            // A viewer signed in on the site (its verified Twitch pair): joins the directory, history attached if certain.
            method: 'POST' as const,
            pattern: /^\/v1\/site\/progression\/identify$/,
            auth: 'site' as const,
            handle: ({ body }: { body: unknown }) =>
              mapped(() => svc.identify(ch, parse(SiteIdentify, body))),
          },
        ]
      : []),
  ];
}
