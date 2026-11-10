import { MUSIC_RULES } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';

// Music Hub — the paid viewer skip and the Open Bar (docs/music/MUSIC_HUB_STATE.md § 14). Stored in the module host's
// tables, no migration of their own:
// - module_state (music_hub / rules): the switches (paid skip on / off, paid requests protected, Open Bar on / off);
// - module_state (music_hub / song): when `!song` last answered (its global cooldown);
// - module_activity (music_skip): one row per paid skip — `queued` (paid, Studio skipping), `done` (Studio's reading
//   proved it), `refunded` (failed, uncertain, or Studio never took it). Only `done` rows make the price climb.
// Every read that decides runs under the channel's lock (service.ts lock()): one decision at a time per channel.

export const SKIP_MODULE = 'music_skip';
const MODULE = 'music_hub';

export interface MusicRules {
  viewer_skip: {
    enabled: boolean;
    protect_requests: boolean;
    /** The progression, set in Studio (defaults: MUSIC_RULES). */
    base_price: number;
    multiplier: number;
    window_minutes: number;
  };
  open_bar: { on: boolean; since: string | null; by: string | null };
}

const DEFAULTS: MusicRules = {
  viewer_skip: {
    enabled: false,
    protect_requests: true,
    base_price: MUSIC_RULES.skipBasePriceTokens,
    multiplier: MUSIC_RULES.skipMultiplier,
    window_minutes: MUSIC_RULES.skipWindowMs / 60_000,
  },
  open_bar: { on: false, since: null, by: null },
};

async function readState<T>(q: Queryable, channelId: string, key: string) {
  return (
    (
      await q.query<{ value: T }>(
        `select value from module_state where channel_id = $1 and module_id = $2 and key = $3`,
        [channelId, MODULE, key],
      )
    )[0]?.value ?? null
  );
}

async function writeState(
  q: Queryable,
  channelId: string,
  key: string,
  value: unknown,
  now: Date,
) {
  await q.query(
    `insert into module_state (channel_id, module_id, key, value, updated_at) values ($1, $2, $3, $4, $5)
     on conflict (channel_id, module_id, key) do update set value = $4, updated_at = $5`,
    [channelId, MODULE, key, JSON.stringify(value), now],
  );
}

export async function loadRules(
  q: Queryable,
  channelId: string,
): Promise<MusicRules> {
  const v = await readState<Partial<MusicRules>>(q, channelId, 'rules');
  return {
    viewer_skip: { ...DEFAULTS.viewer_skip, ...v?.viewer_skip },
    open_bar: { ...DEFAULTS.open_bar, ...v?.open_bar },
  };
}

export const saveRules = (
  q: Queryable,
  channelId: string,
  r: MusicRules,
  now: Date,
) => writeState(q, channelId, 'rules', r, now);

/** The price after `n` chained successful skips: base × multiplier^n, rounded, never above the ledger's cap. */
export function priceAfter(
  vs: Pick<MusicRules['viewer_skip'], 'base_price' | 'multiplier'>,
  n: number,
) {
  let p = vs.base_price;
  for (let i = 0; i < n && p < MUSIC_RULES.skipMaxPriceTokens; i++)
    p *= vs.multiplier;
  return Math.min(Math.round(p), MUSIC_RULES.skipMaxPriceTokens);
}

/**
 * The price of the next paid skip (global to the stream), ALWAYS from the settings of now: `n` = the successful paid
 * skips chained (each within the window — the current one — of the next, the most recent within the window of now),
 * price = base × multiplier^n. A setting changed during a series applies to the next skip at once: a new base or
 * multiplier reprices the same `n`; a shorter window may end the series (back to the base), a longer one may extend
 * it. A page showing the old price is refused (`price_changed`), never charged the new one silently.
 */
export async function skipPrice(
  q: Queryable,
  channelId: string,
  now: Date,
  rules?: MusicRules,
) {
  const vs = (rules ?? (await loadRules(q, channelId))).viewer_skip;
  const windowMs = vs.window_minutes * 60_000;
  // ponytail: the 64 most recent successes — past that the price sits at its cap (or does not move with ×1).
  const done = await q.query<{ at: string }>(
    `select result->>'at' as at from module_activity
      where channel_id = $1 and module_id = $2 and status = 'done' and result ? 'at'
      order by (result->>'at')::timestamptz desc limit 64`,
    [channelId, SKIP_MODULE],
  );
  let doublings = 0;
  let prev = now.getTime();
  for (const r of done) {
    const t = Date.parse(r.at);
    if (prev - t > windowMs) break;
    doublings++;
    prev = t;
  }
  const last = done[0] ? Date.parse(done[0].at) : null;
  const inWindow = doublings > 0 && last !== null;
  return {
    price: priceAfter(vs, doublings),
    /** Successful paid skips in the series (the exponent; named before the multiplier was a setting). */
    doublings,
    last_success_at: last === null ? null : new Date(last).toISOString(),
    /** When the price falls back to the base (null: it is the base already). */
    resets_at: inWindow ? new Date(last + windowMs).toISOString() : null,
  };
}

/** `!song`'s global cooldown: true (and the answer is recorded now) when an answer may be given. */
export async function takeSongTurn(q: Queryable, channelId: string, now: Date) {
  const last = await readState<{ at: string }>(q, channelId, 'song');
  if (
    last &&
    now.getTime() - Date.parse(last.at) < MUSIC_RULES.songCooldownMs &&
    now.getTime() >= Date.parse(last.at)
  )
    return false;
  await writeState(q, channelId, 'song', { at: now.toISOString() }, now);
  return true;
}
