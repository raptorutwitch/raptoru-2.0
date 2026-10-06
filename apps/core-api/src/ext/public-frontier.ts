import type { Core } from '../app.js';
import type { Clock } from '../clock.js';
import type { CoreConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { bonkLabRoutes } from '../http/bonk-lab-routes.js';
import { labModerationRoutes } from '../http/lab-moderation-routes.js';
import type { AppDeps } from '../http/server.js';
import { soundLabRoutes } from '../http/sound-lab-routes.js';
import { ttsLabRoutes } from '../http/tts-lab-routes.js';
import { LabModerationService } from '../lab-moderation/service.js';
import { AvatarCache, twitchAppUserLookup } from '../raffle-lab/avatars.js';
import { ExtFacade } from './ext-facade.js';
import { internalLabCall } from './lab-internal.js';
import { TwitchNames } from './twitch-names.js';

// Public Core assembly of the viewer frontier (/v1/ext/*) and the Studio cockpit (/v1/studio/cockpit/*):
// the Lab services and routes (Moderation V2, Tombola, test wallet, Bonk / Soundboard / TTS admission)
// behind an in-process call only — never mounted on the HTTP server. Off unless the Core is told its
// channel (TWITCH_CHANNEL_ID); the viewer frontier also needs the extension secret.

export interface PublicFrontier {
  deps: Pick<AppDeps, 'ext' | 'cockpit'>;
  /** Time-driven work (Tombola transitions, avatars): started by the process, stopped on exit. */
  start(): () => void;
}

export function createPublicFrontier(
  core: Core,
  db: Db,
  clock: Clock,
  config: CoreConfig,
): PublicFrontier | null {
  const channelId = config.TWITCH_CHANNEL_ID;
  if (!channelId) return null;
  const moderation = new LabModerationService(
    db,
    clock,
    core.ttsLab,
    core.soundLab,
    core.bonkLab,
    core.raffleLab,
  );
  const call = internalLabCall([
    ...bonkLabRoutes(core.bonkLab),
    ...soundLabRoutes(core.soundLab),
    ...ttsLabRoutes(core.ttsLab),
    // No Lab chat module: the bot / chat 2.0 stays off.
    ...labModerationRoutes(moderation, core.ttsLab, core.raffleLab, []),
  ]);
  const app =
    config.TWITCH_APP_CLIENT_ID && config.TWITCH_APP_CLIENT_SECRET
      ? twitchAppUserLookup({
          clientId: config.TWITCH_APP_CLIENT_ID,
          clientSecret: config.TWITCH_APP_CLIENT_SECRET,
        })
      : null;
  const secret = config.TWITCH_EXTENSION_SECRET
    ? Buffer.from(config.TWITCH_EXTENSION_SECRET, 'base64')
    : null;
  return {
    deps: {
      cockpit: { core: call, channelId },
      ext: secret
        ? {
            secret,
            channelId,
            facade: new ExtFacade(call, new TwitchNames(app), {
              channelId,
              channelLogin: config.TWITCH_CHANNEL_LOGIN,
              environment: config.CORE_ENVIRONMENT,
            }),
          }
        : undefined,
    },
    start() {
      // Tombola V2 takes its own time-driven transitions (announcement end, draw at closes_at,
      // reveal, result end) even when nobody reads — like the Lab Core process.
      let ticking = false;
      const raffleTick = setInterval(() => {
        if (ticking) return;
        ticking = true;
        core.raffleLab
          .tick()
          .catch((e: Error) =>
            console.error('[core-api] tombola tick failed', e.message),
          )
          .finally(() => (ticking = false));
      }, 250);
      const avatars = new AvatarCache(db, clock, app);
      const avatarTick = setInterval(() => {
        avatars
          .refresh()
          .catch((e: Error) =>
            console.error('[core-api] avatars failed', e.message),
          );
      }, 5000);
      return () => {
        clearInterval(raffleTick);
        clearInterval(avatarTick);
      };
    },
  };
}
