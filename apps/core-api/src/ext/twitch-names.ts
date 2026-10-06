import type { TwitchUserLookup } from '../raffle-lab/avatars.js';

// Names of real viewers for the public frontier: the Twitch JWT carries only the user id. Helix Get
// Users (app token) when the Core has a Twitch app; otherwise, or while Twitch does not answer, a
// neutral placeholder. A name is a label, never an identity: the id always comes from the JWT.

export interface TwitchName {
  login: string;
  display_name: string;
}

const OK_TTL_MS = 3600_000;
const ERROR_TTL_MS = 300_000;
/** Budget of a lookup on a request path (the cache answers every later request). */
const LOOKUP_BUDGET_MS = 1500;

export const placeholderName = (id: string): TwitchName => ({
  login: `viewer_${id}`,
  display_name: `Viewer ${id.slice(-4)}`,
});

export class TwitchNames {
  private readonly cache = new Map<
    string,
    { name: TwitchName; until: number }
  >();

  constructor(
    private readonly lookup: TwitchUserLookup | null,
    private readonly now: () => number = Date.now,
  ) {}

  async get(id: string): Promise<TwitchName> {
    const hit = this.cache.get(id);
    if (hit && hit.until > this.now()) return hit.name;
    if (!this.lookup) return placeholderName(id);
    try {
      const found = await Promise.race([
        this.lookup([id]),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('lookup_timeout')),
            LOOKUP_BUDGET_MS,
          ).unref(),
        ),
      ]);
      const user = found.find((u) => u.id === id);
      const name =
        user?.login && user.display_name
          ? {
              login: user.login.slice(0, 64),
              display_name: user.display_name.slice(0, 64),
            }
          : placeholderName(id);
      this.remember(id, name, user ? OK_TTL_MS : ERROR_TTL_MS);
      return name;
    } catch {
      const name = hit?.name ?? placeholderName(id);
      this.remember(id, name, ERROR_TTL_MS);
      return name;
    }
  }

  private remember(id: string, name: TwitchName, ttl: number) {
    // ponytail: bounded by a hard cap, not LRU — fine for a test audience; LRU if it ever grows.
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(id, { name, until: this.now() + ttl });
  }
}
