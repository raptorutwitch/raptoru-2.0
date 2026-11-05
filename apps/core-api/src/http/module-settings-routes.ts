import {
  DAILY_STEPS_BOUNDS,
  DailyConfigError,
  DEFAULT_DAILY_CONFIG,
  loadDailyConfig,
  saveDailySteps,
} from '../daily/config.js';
import type { Db } from '../db/db.js';
import {
  ModuleSettingsError,
  type ModuleSettings,
} from '../module-settings/service.js';
import { STREAM_DAY_RESET_HOUR } from '../stream/stream-day.js';
import { HttpError, type Route } from './server.js';

// Refonte H10 / H12 / H14 — Studio's settings of the modules and the Daily steps. Lab: /v1/lab/* (Studio secret);
// Production: /v1/studio/* (the paired installation), the Core's own channel only. The Core validates everything.

export function moduleSettingsRoutes(
  settings: ModuleSettings,
  db: Db,
  o: { channelId: string | null; production: boolean },
): Route[] {
  const base = o.production ? 'studio' : 'lab';
  const auth = o.production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const channel = (id: string) => {
    if (o.channelId && id !== o.channelId)
      throw new HttpError(409, { error: 'wrong_channel' });
    return id;
  };
  const mapped = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ModuleSettingsError)
        throw new HttpError(e.status, { error: e.code });
      if (e instanceof DailyConfigError)
        throw new HttpError(400, { error: e.code });
      if ((e as { code?: string }).code === '42P01')
        throw new HttpError(503, { error: 'daily_unavailable' });
      throw e;
    }
  };
  const daily = async () => {
    const config = await loadDailyConfig(db).catch(() => DEFAULT_DAILY_CONFIG);
    return {
      steps: config.reward.steps ?? [config.reward.base],
      default_steps: DEFAULT_DAILY_CONFIG.reward.steps!,
      bounds: {
        max_steps: DAILY_STEPS_BOUNDS.maxSteps,
        max_value: DAILY_STEPS_BOUNDS.maxValue,
      },
      reset_time: `${STREAM_DAY_RESET_HOUR}:00 (heure de Paris)`,
    };
  };
  return [
    {
      method: 'GET',
      pattern: new RegExp(`^\\/v1\\/${base}\\/module-settings\\/(\\d{1,32})$`),
      auth,
      handle: ({ params }) =>
        mapped(async () => ({
          settings: await settings.list(channel(params[0]!)),
        })),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^\\/v1\\/${base}\\/module-settings\\/(\\d{1,32})$`),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(async () => {
          const b = (body ?? {}) as { key?: unknown; value?: unknown };
          return {
            settings: await settings.set(
              channel(params[0]!),
              String(b.key ?? ''),
              b.value,
              installation ? 'Studio' : 'Studio (Lab)',
            ),
          };
        }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^\\/v1\\/${base}\\/daily\\/config$`),
      auth,
      handle: () => mapped(daily),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^\\/v1\\/${base}\\/daily\\/config$`),
      auth,
      handle: ({ body }) =>
        mapped(async () => {
          await saveDailySteps(db, (body as { steps?: unknown } | null)?.steps);
          return daily();
        }),
    },
  ];
}
