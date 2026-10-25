import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TWITCH_OAUTH_PROFILES } from '@raptoru/schemas';
import type { TwitchAppConfig } from '../src/config.js';
import { fileTokenStore, type StoredToken } from '../src/twitch/auth.js';
import {
  runTwitchRenewal,
  type TwitchAuthorizationEvent,
} from '../src/scripts/twitch-auth.js';

// Studio « Vérifier » renews the PC's tokens through the bot's own TwitchAuth (23/10): an expired access token is not a
// refused authorization. Fake Twitch: /validate accepts only the live access tokens, /token rotates or refuses.

const BOT = TWITCH_OAUTH_PROFILES.bot;
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

function twitch(options: { refresh?: 'ok' | 'refused' | 'down' } = {}) {
  const live = new Set(['access-0']);
  let n = 0;
  const calls = { validate: 0, refresh: 0 };
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/oauth2/validate')) {
      calls.validate += 1;
      const token = String(
        (init?.headers as Record<string, string>).authorization,
      ).replace('OAuth ', '');
      if (!live.has(token)) return new Response('{}', { status: 401 });
      return Response.json({
        client_id: 'client',
        login: BOT.login,
        user_id: BOT.expectedUserId,
        expires_in: 14_000,
        scopes: [...BOT.scopes],
      });
    }
    calls.refresh += 1;
    if (options.refresh === 'down') throw new TypeError('fetch failed');
    if (options.refresh === 'refused')
      return new Response('{"message":"Invalid refresh token"}', {
        status: 400,
      });
    n += 1;
    live.add(`access-${n}`);
    // Async gap so two concurrent renewals really overlap.
    await new Promise((r) => setTimeout(r, 20));
    return Response.json({
      access_token: `access-${n}`,
      refresh_token: `refresh-${n}`,
      expires_in: 14_000,
      scope: [...BOT.scopes],
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls, expire: () => live.clear() };
}

async function tokenFile(over: Partial<StoredToken> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'renew-'));
  dirs.push(dir);
  const file = join(dir, 'bot.json');
  const token: StoredToken = {
    accessToken: 'access-0',
    refreshToken: 'refresh-0',
    scopes: [...BOT.scopes],
    expiresAt: Date.now() + 3_600_000,
    userId: BOT.expectedUserId,
    login: BOT.login,
    revision: 'r0',
    ...over,
  };
  await writeFile(file, JSON.stringify(token));
  return file;
}
const config = (file: string) =>
  ({
    TWITCH_CLIENT_ID: 'client',
    TWITCH_CLIENT_SECRET: 'secret-for-tests',
    TWITCH_TOKEN_FILE: file,
    TWITCH_BROADCASTER_TOKEN_FILE: `${file}.broadcaster`,
  }) as TwitchAppConfig;
const stored = async (file: string) =>
  JSON.parse(await readFile(file, 'utf8')) as StoredToken;

async function renew(file: string, t: ReturnType<typeof twitch>) {
  const events: TwitchAuthorizationEvent[] = [];
  await runTwitchRenewal({
    role: 'bot',
    config: config(file),
    store: fileTokenStore(file),
    fetch: t.fetch,
    emit: (e) => events.push(e),
  });
  return events;
}

describe('renewal of the PC tokens (Studio « Vérifier »)', () => {
  it('still valid: nothing rewritten, no refresh', async () => {
    const file = await tokenFile();
    const t = twitch();
    const events = await renew(file, t);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'renewed',
        role: 'bot',
        refreshed: false,
      }),
    ]);
    expect(t.calls.refresh).toBe(0);
    expect((await stored(file)).accessToken).toBe('access-0');
  });

  it('access expired (Twitch 401): renewed with the stored refresh token, rotated token saved, no consent', async () => {
    const file = await tokenFile({ expiresAt: Date.now() - 60_000 });
    const t = twitch();
    t.expire();
    const events = await renew(file, t);
    expect(events[0]).toMatchObject({ type: 'renewed', refreshed: true });
    expect(t.calls.refresh).toBe(1);
    const after = await stored(file);
    expect(after).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      login: BOT.login,
    });
    expect(after.expiresAt).toBeGreaterThan(Date.now());
    // Restart: a new process reads the rotated token and needs nothing more.
    const again = await renew(file, t);
    expect(again[0]).toMatchObject({ refreshed: false });
    expect(t.calls.refresh).toBe(1);
  });

  it('refresh refused (revoked / password changed): final, file untouched, a reauthorization is required', async () => {
    const file = await tokenFile({ expiresAt: Date.now() - 60_000 });
    const t = twitch({ refresh: 'refused' });
    t.expire();
    await expect(renew(file, t)).rejects.toMatchObject({
      code: 'refresh_rejected',
    });
    expect(t.calls.refresh).toBe(1); // never retried in a loop
    expect((await stored(file)).refreshToken).toBe('refresh-0');
  });

  it('Twitch unreachable: temporary (not a refusal), file untouched', async () => {
    const file = await tokenFile({ expiresAt: Date.now() - 60_000 });
    const t = twitch({ refresh: 'down' });
    t.expire();
    await expect(renew(file, t)).rejects.toMatchObject({
      code: 'twitch_unavailable',
    });
    expect((await stored(file)).accessToken).toBe('access-0');
  });

  it('two processes renewing the same file at once: one refresh, both end on the same grant', async () => {
    const file = await tokenFile({ expiresAt: Date.now() - 60_000 });
    const t = twitch();
    t.expire();
    const [a, b] = await Promise.all([renew(file, t), renew(file, t)]);
    expect(t.calls.refresh).toBe(1);
    expect([a[0], b[0]].map((e) => (e as { type: string }).type)).toEqual([
      'renewed',
      'renewed',
    ]);
    expect((await stored(file)).refreshToken).toBe('refresh-1');
  });

  it('never prints a token: the event carries no secret', async () => {
    const file = await tokenFile({ expiresAt: Date.now() - 60_000 });
    const t = twitch();
    t.expire();
    const text = JSON.stringify(await renew(file, t));
    expect(text).not.toMatch(/access-|refresh-|secret-for-tests/);
  });
});
