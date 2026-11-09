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
  viewer_skip: { enabled: boolean; protect_requests: boolean };
  open_bar: { on: boolean; since: string | null; by: string | null };
}

const DEFAULTS: MusicRules = {
  viewer_skip: { enabled: false, protect_requests: true },
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

/**
 * The price of the next paid skip (global to the stream): the base, doubled once per successful paid skip in a chain
 * where each came within the window of the next one — the most recent within the window of now.
 */
export async function skipPrice(q: Queryable, channelId: string, now: Date) {
  const done = await q.query<{ at: string }>(
    `select result->>'at' as at from module_activity
      where channel_id = $1 and module_id = $2 and status = 'done' and result ? 'at'
      order by (result->>'at')::timestamptz desc limit $3`,
    [channelId, SKIP_MODULE, MUSIC_RULES.skipMaxDoublings + 1],
  );
  let doublings = 0;
  let prev = now.getTime();
  for (const r of done) {
    const t = Date.parse(r.at);
    if (prev - t > MUSIC_RULES.skipWindowMs) break;
    doublings++;
    prev = t;
  }
  const last = done[0] ? Date.parse(done[0].at) : null;
  const inWindow = doublings > 0 && last !== null;
  return {
    price:
      MUSIC_RULES.skipBasePriceTokens *
      2 ** Math.min(doublings, MUSIC_RULES.skipMaxDoublings),
    doublings,
    last_success_at: last === null ? null : new Date(last).toISOString(),
    /** When the price falls back to the base (null: it is the base already). */
    resets_at: inWindow
      ? new Date(last + MUSIC_RULES.skipWindowMs).toISOString()
      : null,
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
