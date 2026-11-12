import { RB_LAB_CHATTERS } from '@raptoru/schemas';
import type { RbTwitch, RbUser } from './random-ban-executor.js';

// LAB ONLY — a fake Twitch for the Random Ban executor (scripts/rb-lab-simulator.ts, the Lab E2E test): fictional
// chatters, all followers, nobody moderator or banned, `ban()` records and logs — never a network call.

/** The same fictional chatters the Lab Core offers as Sniper targets (@raptoru/schemas). */
export const LAB_CHATTERS: RbUser[] = RB_LAB_CHATTERS.map((c) => ({ ...c }));
const SUBS = new Set([LAB_CHATTERS[1]!.id, LAB_CHATTERS[4]!.id]);

/** `bans`: what the fake Twitch was asked (a test reads it). */
export function labFakeTwitch(
  bans: { userId: string; durationS: number }[] = [],
): RbTwitch {
  return {
    chattersPage: async () => ({ chatters: LAB_CHATTERS, cursor: null }),
    moderators: async () => [],
    bans: async () => [],
    follows: async () => true,
    subscribers: async (ids) => ids.filter((id) => SUBS.has(id)),
    ban: async (userId, durationS) => {
      bans.push({ userId, durationS });
      console.log(
        `[rb-lab-simulator] timeout SIMULÉ : ${LAB_CHATTERS.find((c) => c.id === userId)?.name ?? userId} ${durationS} s (aucun appel Twitch)`,
      );
    },
  };
}
