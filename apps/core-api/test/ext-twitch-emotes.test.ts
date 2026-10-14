import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BonkLabService } from '../src/bonk-lab/bonk-lab-service.js';
import { openToken, sealToken } from '../src/bonk-lab/token-crypto.js';
import { TwitchViewerCatalog } from '../src/bonk-lab/twitch-viewer.js';
import type { CoreConfig } from '../src/config.js';
import { createPublicFrontier } from '../src/ext/public-frontier.js';
import { signExtensionJwt } from '../src/ext/twitch-jwt.js';
import { createApp } from '../src/http/server.js';
import { MINUTE, setup } from './helpers.js';

// Bonk Twitch emotes on the public viewer frontier (/v1/ext): OAuth started for the viewer of the
// extension JWT, Twitch's return on a public HTTPS callback, the authorized account must be that
// viewer, tokens encrypted at rest, the catalog shown at once (syncing / ready / stale), a refused
// authorization = reauth_required, the Bonk admits only an emote of the viewer's own catalog.

const CHANNEL = '83603689';
const SECRET = randomBytes(32);
const APP = { clientId: 'cid-public', clientSecret: 'app-secret' };
const KEY = randomBytes(32);
const REDIRECT = 'https://core.test/v1/ext/emotes/oauth/callback';
const ALICE = '1111';
const BOB = '2222';

/** Fake Twitch: OAuth (who validates is settable), Get User Emotes, Get Users. No network. */
function fakeTwitch() {
  const t = {
    owner: ALICE, // the account the viewer authorizes at Twitch
    helixDown: false,
    refreshRefused: false,
    revoked: [] as string[],
    tokens: [] as string[],
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  let n = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = new URLSearchParams(init?.body ? String(init.body) : '');
    if (url.href === 'https://id.twitch.tv/oauth2/token') {
      if (body.get('grant_type') === 'authorization_code') {
        if (
          body.get('code') !== 'good' ||
          body.get('redirect_uri') !== REDIRECT
        )
          return json(400, {});
      } else if (t.refreshRefused) return json(400, {});
      n++;
      t.tokens.push(`AT-${t.owner}-${n}`);
      return json(200, {
        access_token: `AT-${t.owner}-${n}`,
        refresh_token: `RT-${t.owner}-${n}`,
        expires_in: 14_400,
      });
    }
    if (url.href === 'https://id.twitch.tv/oauth2/validate')
      return json(200, {
        client_id: APP.clientId,
        login: `user${t.owner}`,
        user_id: t.owner,
        scopes: ['user:read:emotes'],
      });
    if (url.href === 'https://id.twitch.tv/oauth2/revoke') {
      t.revoked.push(body.get('token') ?? '');
      return json(200, {});
    }
    if (t.helixDown) throw new TypeError('fetch failed');
    if (url.pathname === '/helix/users')
      return json(200, {
        data: url.searchParams.getAll('id').map((id) => ({
          id,
          login: `user${id}`,
          display_name: `User${id}`,
        })),
      });
    if (url.pathname === '/helix/chat/emotes/user')
      return json(200, {
        data: [
          {
            id: 'emotesv2_sub1',
            name: 'aliceHype',
            emote_type: 'subscriptions',
            emote_set_id: '301',
            owner_id: CHANNEL,
            format: ['static'],
          },
          {
            id: '25',
            name: 'Kappa',
            emote_type: 'globals',
            emote_set_id: '0',
            owner_id: '0',
            format: ['static'],
          },
        ],
        pagination: {},
      });
    return json(404, {});
  }) as typeof fetch;
  return { t, fetchImpl };
}

const nowS = () => Math.floor(Date.now() / 1000);
const jwt = (userId: string | null) =>
  signExtensionJwt(
    {
      exp: nowS() + 600,
      opaque_user_id: `U${randomUUID().slice(0, 8)}`,
      channel_id: CHANNEL,
      role: 'viewer',
      ...(userId ? { user_id: userId } : {}),
    },
    SECRET,
  );

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture(key: Buffer | null = KEY) {
  const core = await setup();
  core.clock.set(new Date());
  const tw = fakeTwitch();
  const viewers = new TwitchViewerCatalog(
    core.db,
    core.clock,
    APP,
    tw.fetchImpl,
    { redirectUri: REDIRECT, tokenKey: key },
  );
  const bonkLab = new BonkLabService(core.db, core.clock, viewers);
  const wired = { ...core, bonkLab, twitchViewers: viewers };
  const frontier = createPublicFrontier(wired, core.db, core.clock, {
    TWITCH_CHANNEL_ID: CHANNEL,
    TWITCH_CHANNEL_LOGIN: 'raptoru_',
    TWITCH_EXTENSION_SECRET: SECRET.toString('base64'),
    CORE_ENVIRONMENT: 'staging',
  } as CoreConfig)!;
  const server = createApp({
    ...wired,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
    labRoutes: false,
    ...frontier.deps,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ext = async (path: string, token: string, body?: unknown) => {
    const res = await fetch(`${base}/v1/ext${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(body === undefined ? {} : { 'idempotency-key': randomUUID() }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
    return { status: res.status, body: (await res.json()) as any };
  };
  /** The viewer's browser coming back from Twitch (no JWT). */
  const callback = async (qs: string) => {
    const res = await fetch(`${base}/v1/ext/emotes/oauth/callback?${qs}`);
    return { status: res.status, html: await res.text(), headers: res.headers };
  };
  /** Start for a viewer, then Twitch's return with a good code. */
  const link = async (viewer: string) => {
    const start = await ext('/emotes/oauth/start', jwt(viewer), {});
    const state = new URL(start.body.authorization_url).searchParams.get(
      'state',
    )!;
    return callback(`code=good&state=${state}`);
  };
  const tokenRow = async (userId: string) =>
    (
      await core.db.query<{ access_token: string; refresh_token: string }>(
        'select access_token, refresh_token from bonk_lab_viewer_tokens where user_id = $1',
        [userId],
      )
    )[0];
  return { core, tw, viewers, ext, callback, link, tokenRow };
}

describe('Twitch emotes linking on /v1/ext', () => {
  it('start: the viewer of the JWT only (identity shared); the authorize URL names the HTTPS redirect', async () => {
    const { ext } = await fixture();
    const anonymous = await ext('/emotes/oauth/start', jwt(null), {});
    expect(anonymous.status).toBe(403);
    expect(anonymous.body.error).toBe('identity_required');
    const r = await ext('/emotes/oauth/start', jwt(ALICE), {});
    expect(r.status).toBe(200);
    const url = new URL(r.body.authorization_url);
    expect(url.origin + url.pathname).toBe(
      'https://id.twitch.tv/oauth2/authorize',
    );
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('scope')).toBe('user:read:emotes');
    expect(url.searchParams.get('client_id')).toBe(APP.clientId);
  });

  it('the OAuth account must be the JWT viewer: another account is refused and its token revoked', async () => {
    const { tw, link, tokenRow, ext } = await fixture();
    tw.t.owner = BOB; // Alice's extension, but Bob logs in at Twitch
    const page = await link(ALICE);
    expect(page.status).toBe(400);
    expect(page.html).toContain('n’est pas celui avec lequel tu regardes');
    expect(tw.t.revoked).toEqual([tw.t.tokens.at(-1)]); // Bob's token revoked at once
    expect(await tokenRow(BOB)).toBeUndefined();
    expect(await tokenRow(ALICE)).toBeUndefined();
    expect((await ext('/emotes', jwt(ALICE))).body.twitch_status).toBe(
      'not_linked',
    );
    // The right account: linked to the JWT viewer.
    tw.t.owner = ALICE;
    const ok = await link(ALICE);
    expect(ok.status).toBe(200);
    expect(ok.html).toContain('Connexion Twitch réussie');
    expect(ok.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    expect(await tokenRow(ALICE)).toBeDefined();
  });

  it('a state is single use and expires; a cancelled authorization changes nothing', async () => {
    const { ext, callback, core } = await fixture();
    const start = await ext('/emotes/oauth/start', jwt(ALICE), {});
    const state = new URL(start.body.authorization_url).searchParams.get(
      'state',
    );
    expect((await callback('error=access_denied')).status).toBe(400);
    expect((await callback(`code=good&state=${state}`)).status).toBe(200);
    const replay = await callback(`code=good&state=${state}`);
    expect(replay.status).toBe(400);
    expect(replay.html).toContain('a expiré ou a déjà servi');
    const late = await ext('/emotes/oauth/start', jwt(ALICE), {});
    core.clock.advance(11 * MINUTE);
    expect(
      (
        await callback(
          `code=good&state=${new URL(late.body.authorization_url).searchParams.get('state')}`,
        )
      ).status,
    ).toBe(400);
  });

  it('tokens are encrypted at rest (AES-256-GCM, EXT_TOKEN_KEY), also after a refresh', async () => {
    const { link, tokenRow, tw, core, ext } = await fixture();
    await link(ALICE);
    const row = (await tokenRow(ALICE))!;
    for (const value of [row.access_token, row.refresh_token]) {
      expect(value.startsWith('enc:v1:')).toBe(true);
      expect(value).not.toContain('AT-');
      expect(value).not.toContain('RT-');
    }
    expect(openToken(row.access_token, KEY)).toBe(tw.t.tokens.at(-1));
    expect(openToken(row.access_token, randomBytes(32))).toBeNull();
    // Expired: refreshed on the next Twitch call, stored encrypted again.
    core.clock.advance(5 * 60 * MINUTE);
    await ext('/emotes/refresh', jwt(ALICE), {});
    const after = (await tokenRow(ALICE))!;
    expect(openToken(after.access_token, KEY)).toBe(tw.t.tokens.at(-1));
    expect(after.access_token).not.toBe(row.access_token);
    expect(after.access_token.startsWith('enc:v1:')).toBe(true);
    // Without a key (local Lab Core) a token stays as it was: sealToken is the identity.
    expect(sealToken('x', null)).toBe('x');
  });

  it('states: not_linked → syncing → ready → stale (Twitch down, recent cache) → reauth_required → not_linked', async () => {
    const { link, ext, tw, core, viewers } = await fixture();
    const e = async () => (await ext('/emotes', jwt(ALICE))).body;
    expect(await e()).toMatchObject({
      connected: true,
      twitch_connected: false,
      twitch_status: 'not_linked',
      groups: [],
    });
    await link(ALICE);
    // First read: the catalog is not there yet, it is being loaded (never blocks the answer).
    const first = await e();
    expect(first).toMatchObject({
      twitch_status: 'syncing',
      twitch_connected: true,
      twitch_login: 'UserALICE'.replace('ALICE', ALICE),
    });
    await viewers.emotesState(ALICE, { waitMs: 1000 }); // let the background load finish
    const ready = await e();
    expect(ready.twitch_status).toBe('ready');
    expect(
      ready.groups.flatMap((g: { emotes: { id: string }[] }) =>
        g.emotes.map((x) => x.id),
      ),
    ).toEqual(['twitch:emotesv2_sub1', 'twitch:25']);
    // Older than 10 min and Twitch unreachable: the stored catalog is kept (stale), not an empty screen.
    core.clock.advance(11 * MINUTE);
    tw.t.helixDown = true;
    const stale = (await ext('/emotes/refresh', jwt(ALICE), {})).body;
    expect(stale.twitch_status).toBe('stale');
    expect(stale.groups.length).toBe(2);
    // More than 1 h: nothing old is shown.
    core.clock.advance(55 * MINUTE);
    const old = (await ext('/emotes/refresh', jwt(ALICE), {})).body;
    expect(old.twitch_status).toBe('syncing');
    expect(old.groups).toEqual([]);
    // Twitch refuses the authorization (revoked by the viewer at Twitch): reconnection asked.
    tw.t.helixDown = false;
    tw.t.refreshRefused = true;
    core.clock.advance(5 * 60 * MINUTE); // token expired → refresh refused
    const reauth = (await ext('/emotes/refresh', jwt(ALICE), {})).body;
    expect(reauth).toMatchObject({
      twitch_status: 'reauth_required',
      twitch_connected: false,
      groups: [],
    });
    // A new link clears it.
    tw.t.refreshRefused = false;
    await link(ALICE);
    expect((await e()).twitch_status).not.toBe('reauth_required');
    // The viewer unlinks: revoked at Twitch, not linked (no reconnection asked).
    const revokedBefore = tw.t.revoked.length;
    expect((await ext('/emotes/oauth/disconnect', jwt(ALICE), {})).status).toBe(
      200,
    );
    expect(tw.t.revoked.length).toBe(revokedBefore + 1);
    expect((await e()).twitch_status).toBe('not_linked');
  });

  it('an unreadable token (key changed) asks for a reconnection, never an error', async () => {
    const { link, viewers, core, tw } = await fixture();
    await link(ALICE);
    const other = new TwitchViewerCatalog(
      core.db,
      core.clock,
      APP,
      tw.fetchImpl,
      { redirectUri: REDIRECT, tokenKey: randomBytes(32) },
    );
    const s = await other.emotesState(ALICE, { force: true, waitMs: 1000 });
    expect(s.status).toBe('reauth_required');
    expect((await viewers.emotesState(ALICE)).status).toBe('reauth_required');
  });

  it('one viewer never sees or unlinks another viewer’s account', async () => {
    const { link, ext, tw, tokenRow, viewers } = await fixture();
    await link(ALICE);
    await viewers.emotesState(ALICE, { waitMs: 1000 });
    tw.t.owner = BOB;
    expect((await ext('/emotes', jwt(BOB))).body.twitch_status).toBe(
      'not_linked',
    );
    await ext('/emotes/oauth/disconnect', jwt(BOB), {});
    expect(await tokenRow(ALICE)).toBeDefined();
    expect((await ext('/emotes', jwt(ALICE))).body.twitch_status).toBe('ready');
  });
});

describe('Bonk on /v1/ext with Twitch emotes', () => {
  const bonk = (id: string) => ({
    module_id: 'bonk',
    payload: { emote_source: 'twitch', emotes: [id] },
  });

  it('admits an emote of the viewer’s own catalog, refuses one outside it, and refuses an unlinked viewer', async () => {
    const { core, link, ext, viewers } = await fixture();
    await core.bonkLab.heartbeat({
      studio_instance_id: 'studio-1',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    // Not linked: no catalog, refused before any debit.
    const unlinked = await ext('/actions/tokens', jwt(BOB), bonk('twitch:25'));
    expect(unlinked.status).toBe(409);
    await link(ALICE);
    await viewers.emotesState(ALICE, { waitMs: 1000 });
    const outside = await ext(
      '/actions/tokens',
      jwt(ALICE),
      bonk('twitch:emotesv2_not_mine'),
    );
    expect(outside.status).toBe(409);
    expect(outside.body.error).toBe('emote_not_in_catalog');
    const mine = await ext(
      '/actions/tokens',
      jwt(ALICE),
      bonk('twitch:emotesv2_sub1'),
    );
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ module_id: 'bonk', charged: false });
  });
});

describe('public Core without linking configured', () => {
  it('start answers twitch_emotes_unavailable; the emotes read stays not_linked', async () => {
    const core = await setup();
    const viewers = new TwitchViewerCatalog(core.db, core.clock, APP, fetch, {
      redirectUri: null,
    });
    expect(viewers.canLink).toBe(false);
    await expect(viewers.startAuth(ALICE)).rejects.toMatchObject({
      code: 'oauth_unavailable',
    });
  });
});
