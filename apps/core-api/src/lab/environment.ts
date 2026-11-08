import type { CoreConfig } from '../config.js';
import type { TwitchUserLookup } from '../raffle-lab/avatars.js';

// The Lab environment of the MAIN Core (architecture decision of 05/11/2026: two environments only — the local Lab and
// Production on the VPS). The Lab runs THIS entry point (src/index.ts), the same assembly (app.ts), the same schema (the
// production migrator) and the same doors (/v1/ext for the Extension, /v1/studio for Studio, /v1/bot for the bot) as
// Production, on fictional data: no second backend, no copy of a rule. What differs is only what reaches the outside:
// a fictional channel and a fictional Twitch directory, and guards that refuse to start when anything real is configured.

/** The fictional channel of the Lab (the Extension Lab's broadcaster). */
export const LAB_CHANNEL = Object.freeze({
  id: '900100',
  login: 'raptoru_lab',
});

/** The fictional Twitch accounts of the Lab: the Extension Lab's broadcaster, viewer and moderator, and the simulators' viewers. */
export const LAB_TWITCH_USERS = Object.freeze([
  { id: '900100', login: 'raptoru_lab', display_name: 'Raptoru_ (lab)' },
  { id: '900101', login: 'lab_viewer', display_name: 'Viewer Lab' },
  { id: '900102', login: 'lab_modo', display_name: 'Modo Lab' },
  // A moderator the broadcaster named supermod (lab_staff, seeded by lab/fixtures.ts): Twitch only knows « moderator ».
  { id: '900103', login: 'lab_supermod', display_name: 'Supermod Lab' },
  { id: '900201', login: 'luna_lab', display_name: 'Luna_lab' },
  { id: '900202', login: 'kiwi_lab', display_name: 'Kiwi_lab' },
  { id: '900203', login: 'nox_lab', display_name: 'Nox_lab' },
  { id: '900204', login: 'mila_lab', display_name: 'Mila_lab' },
]);

/** Names of the Lab's viewers, in place of Helix: never a request. Unknown ids keep the Core's placeholder name. */
export const labUserLookup: TwitchUserLookup = async (ids) =>
  LAB_TWITCH_USERS.filter((u) => ids.includes(u.id)).map((u) => ({
    ...u,
    profile_image_url: '',
  }));

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Whether a connection string points at this machine (a Lab database is never remote). */
export function isLoopbackDatabase(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Why this configuration may not run as a Lab Core (empty: it may). Checked before anything starts: a Lab Core that
 * could reach a real database, the real channel or a real Twitch app refuses to start rather than run « carefully ».
 */
export function labEnvironmentProblems(
  c: Pick<
    CoreConfig,
    | 'CORE_ENVIRONMENT'
    | 'DATABASE_URL'
    | 'TWITCH_CHANNEL_ID'
    | 'TWITCH_APP_CLIENT_ID'
    | 'TWITCH_APP_CLIENT_SECRET'
    | 'EXT_TWITCH_REDIRECT_URI'
    | 'OPS_TOKEN'
  >,
): string[] {
  if (c.CORE_ENVIRONMENT !== 'lab') return [];
  const problems: string[] = [];
  if (!isLoopbackDatabase(c.DATABASE_URL))
    problems.push('DATABASE_URL doit viser cette machine (127.0.0.1)');
  if (c.TWITCH_CHANNEL_ID !== LAB_CHANNEL.id)
    problems.push(
      `TWITCH_CHANNEL_ID doit être la chaîne fictive du Lab (${LAB_CHANNEL.id})`,
    );
  for (const key of [
    'TWITCH_APP_CLIENT_ID',
    'TWITCH_APP_CLIENT_SECRET',
    'EXT_TWITCH_REDIRECT_URI',
    'OPS_TOKEN',
  ] as const)
    if (c[key])
      problems.push(
        `${key} est réservé à la Production (Twitch du Lab fictif)`,
      );
  return problems;
}
