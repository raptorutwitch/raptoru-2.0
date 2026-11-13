import { insertWordGameSteps } from '../commands/steps.js';
import type { Queryable } from '../db/db.js';
import { waitText } from './pricing.js';

// Random Ban refusals in the chat (V5, 13/11/2026): one short line, the time left when it helps, at most ONE refusal
// line per viewer every 5 minutes (`!rb` and the channel points together). Only the line is limited: the refund itself
// (Jetons never debited, points CANCELED) always happens.

export const REFUSAL_LINE_MS = 5 * 60_000;

export type RbRefusal =
  'no_charge' | 'viewer_cooldown' | 'viewer_blocked' | 'rb_paused' | 'rb_busy';

export function refusalText(code: RbRefusal, waitMs = 0) {
  const wait = waitText(waitMs);
  switch (code) {
    case 'no_charge':
      return `plus de charge Random Ban, la prochaine dans ${wait}`;
    case 'viewer_cooldown':
      return `Random Ban bloqué pour toi encore ${wait}`;
    case 'viewer_blocked':
      return 'Random Ban indisponible pour ton compte';
    case 'rb_paused':
      return 'Random Ban en pause pour le moment';
    case 'rb_busy':
      return `trop de Random Ban en ce moment, réessaie dans ${wait}`;
  }
}

/**
 * One refusal line for this viewer unless he got one in the last 5 minutes (true: written). Serialized per viewer by
 * the Random Ban buyer lock, so two refusals at once never both write.
 */
export async function sayRefusal(
  q: Queryable,
  r: {
    channelId: string;
    viewerId: string;
    /** The trigger (a message, a redemption): the same one again writes nothing new. */
    ref: string;
    text: string;
    now: Date;
  },
) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [
    `random_ban:buyer:${r.channelId}:${r.viewerId}`,
  ]);
  const prefix = `rb:refuse:${r.viewerId}:`;
  const recent = await q.query(
    `select 1 from cmd_steps where channel_id = $1 and created_at > $2 and left(idempotency_key, $3) = $4 limit 1`,
    [
      r.channelId,
      new Date(r.now.getTime() - REFUSAL_LINE_MS),
      prefix.length,
      prefix,
    ],
  );
  if (recent.length) return false;
  return (
    (await insertWordGameSteps(q, {
      channelId: r.channelId,
      now: r.now,
      origin: 'mini_game',
      drafts: [
        {
          idempotencyKey: `${prefix}${r.ref}`.slice(0, 200),
          mode: 'normal',
          text: r.text,
        },
      ],
    })) > 0
  );
}
