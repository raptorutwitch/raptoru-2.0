import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SPOTIFY_API,
  SpotifyApi,
  SpotifyApiError,
  classifyRateLimit,
} from '../src/spotify/api.js';
import { SpotifyAuth } from '../src/spotify/oauth.js';

// Spotify V2 — the one gate to Spotify (docs/SPOTIFY_V2.md § 5): pacing, cache, 429 circuit, 401 / 403, writes.

type Answer = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

async function harness(
  answers: (url: URL, method: string) => Answer,
  opts: { stateFile?: string } = {},
) {
  let t = 1_000_000;
  const calls: {
    at: number;
    method: string;
    path: string;
    auth: string | undefined;
  }[] = [];
  let refreshes = 0;
  const api = new SpotifyApi({
    auth: {
      accessToken: async () => `tok${refreshes}`,
      refresh: async () => `tok${++refreshes}`,
    },
    stateFile:
      opts.stateFile ??
      join(await mkdtemp(join(tmpdir(), 'sp-api-')), 'limit.json'),
    now: () => t,
    sleep: async (ms) => void (t += ms),
    random: () => 0.5,
    fetch: (async (input: URL, init: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        at: t,
        method: init.method ?? 'GET',
        path: url.pathname.replace('/v1/', ''),
        auth: (init.headers as Record<string, string>).authorization,
      });
      const a = answers(url, init.method ?? 'GET');
      return new Response(
        a.body === undefined ? null : JSON.stringify(a.body),
        {
          status: a.status,
          headers: a.headers,
        },
      );
    }) as typeof fetch,
  });
  return {
    api,
    calls,
    advance: (ms: number) => void (t += ms),
    refreshes: () => refreshes,
  };
}

const ITEM = {
  id: 'a'.repeat(22),
  name: 'Numb',
  artists: [{ name: 'Linkin Park' }],
  duration_ms: 185_000,
};

describe('Spotify API gate', () => {
  it('serializes and spaces calls (≥ 200 ms), caps a sliding minute at 90', async () => {
    const h = await harness(() => ({ status: 200, body: { devices: [] } }));
    for (let i = 0; i < 3; i++) await h.api.devices(true);
    const gaps = h.calls.slice(1).map((c, i) => c.at - h.calls[i]!.at);
    expect(gaps.every((g) => g >= SPOTIFY_API.minSpacingMs)).toBe(true);
    for (let i = 0; i < 95; i++) await h.api.devices(true);
    const first = h.calls[0]!.at;
    const within = h.calls.filter((c) => c.at < first + 60_000);
    expect(within.length).toBeLessThanOrEqual(SPOTIFY_API.maxPerMinute);
  });

  it('reads are cached (playback 1.5 s, search 5 min) and one in flight is shared', async () => {
    const h = await harness((u) =>
      u.pathname.endsWith('/search')
        ? { status: 200, body: { tracks: { items: [ITEM] } } }
        : { status: 204 },
    );
    const [a, b] = await Promise.all([h.api.playback(), h.api.playback()]);
    expect(a).toBe(b);
    await h.api.playback();
    expect(h.calls.filter((c) => c.path === 'me/player')).toHaveLength(1);
    h.advance(1_600);
    await h.api.playback();
    expect(h.calls.filter((c) => c.path === 'me/player')).toHaveLength(2);
    await h.api.search('Numb  linkin park');
    await h.api.search('numb linkin PARK');
    h.advance(4 * 60_000);
    expect(await h.api.search('numb linkin park')).toEqual([ITEM]);
    expect(h.calls.filter((c) => c.path === 'search')).toHaveLength(1);
  });

  it('a 429 stops EVERY call until Retry-After (+ jitter), persisted across a restart; QUOTA_EXCEEDED kept apart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sp-429-'));
    const stateFile = join(dir, 'limit.json');
    const h = await harness(
      () => ({
        status: 429,
        headers: { 'retry-after': '120' },
        body: { error: 'quota exceeded' },
      }),
      {
        stateFile,
      },
    );
    const e = await h.api.devices(true).catch((x) => x);
    expect(e).toBeInstanceOf(SpotifyApiError);
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.maybeSent).toBe(false);
    const s = await h.api.status();
    expect(s.quota_exceeded).toBe(true);
    // Retry-After (120 s) + 0.5 × 1 s jitter, never shortened.
    expect(Date.parse(s.limited_until!)).toBe(1_000_000 + 120_000 + 500);
    // Writes and reads are refused WITHOUT calling Spotify.
    await expect(
      h.api.addToQueue(`spotify:track:${ITEM.id}`, 'dev'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', maybeSent: false });
    await expect(h.api.playback(true)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(h.calls).toHaveLength(1);
    // A restarted Studio reads the persisted circuit.
    expect(JSON.parse(await readFile(stateFile, 'utf8')).reason).toBe(
      'QUOTA_EXCEEDED',
    );
    const again = await harness(
      () => ({ status: 200, body: { devices: [] } }),
      { stateFile },
    );
    await expect(again.api.devices(true)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(again.calls).toHaveLength(0);
    again.advance(121_000);
    expect(await again.api.devices(true)).toEqual([]);
    expect((await again.api.status()).limited_until).toBeNull();
  });

  it('classifies a quota answer apart from a plain rate limit', () => {
    expect(classifyRateLimit({ error: { message: 'Quota exceeded' } })).toBe(
      'QUOTA_EXCEEDED',
    );
    expect(
      classifyRateLimit({ error: { message: 'API rate limit exceeded' } }),
    ).toBe('RATE_LIMITED');
  });

  it('401: one shared refresh, one retry; a second 401 → AUTH_REQUIRED', async () => {
    let n = 0;
    const h = await harness(() =>
      n++ === 0 ? { status: 401 } : { status: 200, body: { devices: [] } },
    );
    expect(await h.api.devices(true)).toEqual([]);
    expect(h.refreshes()).toBe(1);
    expect(h.calls.map((c) => c.auth)).toEqual(['Bearer tok0', 'Bearer tok1']);
    const k = await harness(() => ({ status: 401 }));
    await expect(k.api.devices(true)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(k.calls).toHaveLength(2);
  });

  it('403 is never retried; 5xx / network back off (no call during the backoff)', async () => {
    const h = await harness(() => ({ status: 403 }));
    await expect(h.api.devices(true)).rejects.toMatchObject({
      code: 'SPOTIFY_UNAVAILABLE',
      status: 403,
    });
    expect(h.calls).toHaveLength(1);
    const k = await harness(() => ({ status: 503 }));
    await expect(k.api.devices(true)).rejects.toMatchObject({
      code: 'TEMPORARY_ERROR',
    });
    await expect(k.api.devices(true)).rejects.toMatchObject({
      code: 'TEMPORARY_ERROR',
    });
    expect(k.calls).toHaveLength(1);
    k.advance(1_100);
    await k.api.devices(true).catch(() => {});
    expect(k.calls).toHaveLength(2);
    // Second failure: 2 s.
    k.advance(1_100);
    await k.api.devices(true).catch(() => {});
    expect(k.calls).toHaveLength(2);
  });

  it('a write is sent once: 204 ok, a 200 / 5xx is « maybe sent » (never resent)', async () => {
    const h = await harness(() => ({ status: 204 }));
    await h.api.addToQueue(`spotify:track:${ITEM.id}`, 'dev');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      path: 'me/player/queue',
    });
    for (const status of [200, 502]) {
      const k = await harness(() => ({ status, body: {} }));
      await expect(
        k.api.addToQueue(`spotify:track:${ITEM.id}`, 'dev'),
      ).rejects.toMatchObject({ maybeSent: true });
      expect(k.calls).toHaveLength(1);
    }
  });
});

describe('Spotify OAuth (PKCE, sealed refresh token)', () => {
  const box = {
    protect: async (s: string) => `sealed:${s}`,
    unprotect: async (s: string) => s.replace(/^sealed:/, ''),
  };

  it('connects, never stores a token in clear, rotates the refresh token, invalid_grant → needs_reauth', async () => {
    const file = join(
      await mkdtemp(join(tmpdir(), 'sp-oauth-')),
      'spotify-auth.json',
    );
    const forms: Record<string, string>[] = [];
    let next: { status: number; body: unknown } = {
      status: 200,
      body: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 },
    };
    let t = 0;
    const auth = await SpotifyAuth.open({
      file,
      redirectUri: 'http://127.0.0.1:4100/api/spotify/oauth/callback',
      box,
      now: () => t,
      fetch: (async (_: unknown, init: RequestInit) => {
        forms.push(Object.fromEntries(new URLSearchParams(String(init.body))));
        return new Response(JSON.stringify(next.body), { status: next.status });
      }) as typeof fetch,
    });
    expect(auth.view().auth).toBe('not_configured');
    await expect(auth.accessToken()).rejects.toMatchObject({
      code: 'AUTH_NOT_CONFIGURED',
    });
    expect(() => auth.authorizeUrl('pas-un-client-id')).toThrow(
      'invalid_client_id',
    );
    const url = new URL(auth.authorizeUrl('0123456789abcdef0123456789abcdef'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:4100/api/spotify/oauth/callback',
    );
    expect(url.searchParams.get('scope')).toBe(
      'user-modify-playback-state user-read-playback-state user-read-private',
    );
    await expect(
      auth.callback(new URLSearchParams({ state: 'forged', code: 'c' })),
    ).rejects.toThrow('state_invalide');
    const state = url.searchParams.get('state')!;
    await auth.callback(new URLSearchParams({ state, code: 'CODE' }));
    expect(forms[0]).toMatchObject({
      grant_type: 'authorization_code',
      code: 'CODE',
      client_id: '0123456789abcdef0123456789abcdef',
    });
    expect(forms[0]!.code_verifier).toBeTruthy();
    // The state is single-use.
    await expect(
      auth.callback(new URLSearchParams({ state, code: 'CODE' })),
    ).rejects.toThrow('state_invalide');
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('AT1');
    expect(raw).toContain('sealed:RT1');
    expect(auth.view().auth).toBe('ok');
    expect(await auth.accessToken()).toBe('AT1');
    // Expired: one shared refresh, rotated refresh token kept (sealed).
    t = 3600_000;
    next = {
      status: 200,
      body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 },
    };
    const [a, b] = await Promise.all([auth.accessToken(), auth.accessToken()]);
    expect([a, b]).toEqual(['AT2', 'AT2']);
    expect(forms.filter((f) => f.grant_type === 'refresh_token')).toHaveLength(
      1,
    );
    expect(forms.at(-1)).toMatchObject({ refresh_token: 'RT1' });
    expect(await readFile(file, 'utf8')).toContain('sealed:RT2');
    // Revoked / expired refresh token: reconnect, nothing retries.
    next = { status: 400, body: { error: 'invalid_grant' } };
    await expect(auth.refresh()).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(auth.view().auth).toBe('needs_reauth');
    const count = forms.length;
    await expect(auth.refresh()).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(forms).toHaveLength(count);
    // Survives a restart.
    const reopened = await SpotifyAuth.open({ file, redirectUri: 'x', box });
    expect(reopened.view().auth).toBe('needs_reauth');
  });
});
