import type { Queryable } from '../db/db.js';
import { LAB_CHANNEL, LAB_TWITCH_USERS } from './environment.js';

// The Lab's fictional data, ONE place for every Lab database (npm run lab:reset, the Lab test stack): the Lab's
// accounts as viewers of the fictional channel, and test Jetons for « Viewer Lab ». Nothing else: every other state is
// created through the Core's own doors, as in Production.

export const LAB_VIEWER_TOKENS = 12_000;

export async function seedLabFixtures(
  q: Queryable,
  o: { viewerTokens?: number } = {},
): Promise<void> {
  for (const u of LAB_TWITCH_USERS) {
    // Both name tables: the production schema's (viewers) and the test wallet's (lab_viewers).
    await q.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3) on conflict do nothing`,
      [u.id, u.login, u.display_name],
    );
    await q.query(
      `insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen)
       values ($1, $2, $3, now(), now()) on conflict do nothing`,
      [LAB_CHANNEL.id, u.id, u.display_name],
    );
  }
  await q.query(
    `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
     values ($1, '900101', $2, 0, 0, now())
     on conflict (channel_id, viewer_id) do update set tokens = excluded.tokens`,
    [LAB_CHANNEL.id, o.viewerTokens ?? LAB_VIEWER_TOKENS],
  );
}
