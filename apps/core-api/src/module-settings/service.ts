import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import {
  CHAT_INTERACTION_PRICES,
  type ChatInteraction,
  type ChatPrices,
} from '../chat-interactions/prices.js';

// Refonte H10 / H12 (decided 05/11/2026) — prices, delays and limits of the modules, set from Studio and read by the
// executors from here, the ONE place. Per channel, bounded by the Core, defaults = what the Core applies today. Never
// the odds, the prize tables, the deduplication or the internal safety parameters (decision H10).
// Next keys (same mechanism, not wired yet): Caution prices, Votekick delays, mini-games stakes and delays, Duel cap.

export const MODULE_SETTINGS = {
  'random_ban.price': {
    label: 'Prix de !rb',
    unit: 'Jetons',
    default: CHAT_INTERACTION_PRICES.random_ban,
    min: 1_000,
    max: 1_000_000,
  },
  'fx_cam.price': {
    label: 'Prix de !fxcam',
    unit: 'Jetons',
    default: CHAT_INTERACTION_PRICES.fx_cam,
    min: 100,
    max: 100_000,
  },
  'bonk.price': {
    label: 'Prix d’un Bonk',
    unit: 'Jetons',
    // BONK_LAB_RULES.simulatedCost, the price the Core applies today (not an older document's value).
    default: 200,
    min: 10,
    max: 100_000,
  },
  'bonk.cooldown_s': {
    label: 'Délai entre deux achats de Bonk d’un même viewer',
    unit: 's',
    default: 0,
    min: 0,
    max: 600,
    help: 'une salve compte pour un seul achat ; 0 = aucun délai (comportement actuel)',
  },
} as const;
export type ModuleSettingKey = keyof typeof MODULE_SETTINGS;
const KEYS = Object.keys(MODULE_SETTINGS) as ModuleSettingKey[];

export class ModuleSettingsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export class ModuleSettings {
  /** Does this database hold the table (a Core whose migration is not applied keeps the defaults)? */
  private table: boolean | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private async ready(q: Queryable) {
    this.table ??=
      (
        await q.query<{ ok: boolean }>(
          "select to_regclass('public.module_settings') is not null as ok",
        )
      )[0]?.ok === true;
    return this.table;
  }

  /** The value an executor applies now (the caller's transaction when it has one). */
  async get(q: Queryable, channelId: string, key: ModuleSettingKey) {
    if (!(await this.ready(q))) return MODULE_SETTINGS[key].default;
    const row = (
      await q.query<{ value: number | string }>(
        'select value from module_settings where channel_id = $1 and key = $2',
        [channelId, key],
      )
    )[0];
    return row ? Number(row.value) : MODULE_SETTINGS[key].default;
  }

  /** What Studio shows: every setting with its value, default and bounds. */
  async list(channelId: string) {
    const stored = new Map<string, number>();
    if (await this.ready(this.db))
      for (const r of await this.db.query<{
        key: string;
        value: number | string;
      }>('select key, value from module_settings where channel_id = $1', [
        channelId,
      ]))
        stored.set(r.key, Number(r.value));
    return KEYS.map((key) => {
      const d = MODULE_SETTINGS[key];
      return {
        key,
        label: d.label,
        unit: d.unit,
        value: stored.get(key) ?? d.default,
        default: d.default,
        min: d.min,
        max: d.max,
        ...('help' in d ? { help: d.help } : {}),
      };
    });
  }

  /** Validated here (integer, bounds, known key), whatever Studio sent; applied to the next purchases only. */
  async set(channelId: string, key: string, value: unknown, actor: string) {
    if (!KEYS.includes(key as ModuleSettingKey))
      throw new ModuleSettingsError(400, 'unknown_setting');
    const d = MODULE_SETTINGS[key as ModuleSettingKey];
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < d.min ||
      value > d.max
    )
      throw new ModuleSettingsError(400, 'out_of_bounds');
    if (!(await this.ready(this.db)))
      throw new ModuleSettingsError(503, 'module_settings_unavailable');
    await this.db.query(
      `insert into module_settings (channel_id, key, value, updated_at, updated_by) values ($1, $2, $3, $4, $5)
       on conflict (channel_id, key) do update set value = $3, updated_at = $4, updated_by = $5`,
      [channelId, key, value, this.clock.now(), actor.slice(0, 64)],
    );
    return this.list(channelId);
  }

  /** `!rb` / `!fxcam` prices from here (the reader prices.ts announced for Studio's setting). */
  chatPrices(): ChatPrices {
    return {
      price: (channelId: string, interaction: ChatInteraction) =>
        this.get(this.db, channelId, `${interaction}.price`),
    };
  }
}
