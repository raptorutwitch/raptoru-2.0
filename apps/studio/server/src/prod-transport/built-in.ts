// The Production Core this Studio build talks to — a build constant, never a setting of the Studio
// page (ASTRA-P1-019: the installation credential only ever goes to this Core). The production Core
// (core.raptoru.fr, 20/10/2026); its economy is whatever that Core runs.
// The environment (RAPTORU_PRODUCTION_CORE_URL / _CA_FILE / _CHANNEL_ID) still overrides it for the
// local HTTPS test Core of the developers.

export const BUILT_IN_PRODUCTION = {
  url: 'https://core.raptoru.fr',
  /** raptoru_ (Twitch broadcaster id). */
  channelId: '83603689',
  label: 'Production',
} as const;

/** Channel of a Core given by the environment (local test Core): the Lab channel by default. */
export const ENV_CORE_DEFAULT_CHANNEL = '900100';
