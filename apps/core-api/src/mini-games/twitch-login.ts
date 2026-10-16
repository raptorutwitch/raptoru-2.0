import { TWITCH_CALL_TIMEOUT_MS } from '../raffle-lab/avatars.js';

// Duel V1 (docs/DUEL_PARITY.md § 3): a typed Twitch login → its Twitch User ID, exactly, with Helix « Get Users »
// and the Lab Core's app credentials (the ones of the Tombola avatars). Kept apart from avatars.ts, which the
// public Core also uses: nothing on that path changes.

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
}

/** Exact login → user, or null when Twitch has no such login. Throws when Twitch cannot be asked. */
export type LoginLookup = (login: string) => Promise<TwitchUser | null>;

export function twitchAppLoginLookup(
  app: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = TWITCH_CALL_TIMEOUT_MS,
): LoginLookup {
  let token: { value: string; until: number } | null = null;
  const appToken = async () => {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const res = await fetchImpl('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`twitch_app_token_${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    token = {
      value: body.access_token,
      until: Date.now() + body.expires_in * 1000,
    };
    return token.value;
  };
  return async (login) => {
    const url = new URL('https://api.twitch.tv/helix/users');
    url.searchParams.set('login', login);
    const res = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${await appToken()}`,
        'client-id': app.clientId,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`twitch_users_${res.status}`);
    const data = ((await res.json()) as { data?: TwitchUser[] }).data ?? [];
    // Exact match only: one user whose login is the one typed (never an approximation).
    const user = data.length === 1 ? data[0]! : null;
    return user &&
      user.login.toLowerCase() === login.toLowerCase() &&
      /^\d{1,32}$/.test(user.id)
      ? {
          id: user.id,
          login: user.login,
          display_name: user.display_name || user.login,
        }
      : null;
  };
}
