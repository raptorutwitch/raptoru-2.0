import { describe, expect, it } from 'vitest';
import {
  BonkLabError409,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import {
  TwitchViewerCatalog,
  TwitchViewerError,
  VIEWER_REDIRECT_URI,
} from '../src/bonk-lab/twitch-viewer.js';
import { MINUTE, setup, type TestCore } from './helpers.js';

const APP = { clientId: 'cid-lab', clientSecret: 'secret-lab' };
const VIEWER = '83603689';

/** Fake Twitch (OAuth + Helix). No network. */
function fakeTwitch(
  over: Partial<{
    scopes: string[];
    clientId: string;
    refreshFails: boolean;
  }> = {},
) {
  const calls: { method: string; url: string; body: string }[] = [];
  let tokenN = 0;
  let unauthorizedOnce = false;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const page1 = [
    {
      id: 'emotesv2_anim1',
      name: 'raptorDance',
      emote_type: 'subscriptions',
      emote_set_id: '301',
      owner_id: '83603689',
      format: ['static', 'animated'],
    },
    {
      id: '25',
      name: 'Kappa',
      emote_type: 'globals',
      emote_set_id: '0',
      owner_id: '0',
      format: ['static'],
    },
  ];
  const page2 = [
    {
      id: 'emotesv2_other',
      name: 'ptitGG',
      emote_type: 'subscriptions',
      emote_set_id: '302',
      owner_id: '43',
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
  ];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? String(init.body) : '';
    calls.push({ method: init?.method ?? 'GET', url: url.href, body });
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    if (url.href === 'https://id.twitch.tv/oauth2/token') {
      const p = new URLSearchParams(body);
      if (
        p.get('grant_type') === 'authorization_code' &&
        p.get('code') !== 'good'
      )
        return json(400, { message: 'bad code' });
      if (p.get('grant_type') === 'refresh_token' && over.refreshFails)
        return json(400, { message: 'invalid refresh token' });
      tokenN++;
      return json(200, {
        access_token: `AT${tokenN}`,
        refresh_token: `RT${tokenN}`,
        expires_in: 3600,
      });
    }
    if (url.href === 'https://id.twitch.tv/oauth2/validate')
      return json(200, {
        client_id: over.clientId ?? APP.clientId,
        login: 'raptoru_',
        user_id: VIEWER,
        scopes: over.scopes ?? ['user:read:emotes'],
      });
    if (url.href === 'https://id.twitch.tv/oauth2/revoke') return json(200, {});
    if (!auth.startsWith('Bearer AT')) return json(401, {});
    if (url.pathname === '/helix/users') {
      const names: Record<string, [string, string]> = {
        [VIEWER]: ['raptoru_', 'Raptoru_'],
        '43': ['ptitchef', 'PtitChef'],
      };
      return json(200, {
        data: url.searchParams
          .getAll('id')
          .filter((id) => names[id])
          .map((id) => ({
            id,
            login: names[id]![0],
            display_name: names[id]![1],
            profile_image_url: `https://static-cdn.jtvnw.net/jtv_user_pictures/${id}.png`,
          })),
      });
    }
    if (url.pathname === '/helix/chat/emotes/user') {
      if (url.searchParams.get('user_id') !== VIEWER) return json(400, {});
      if (unauthorizedOnce) {
        unauthorizedOnce = false;
        return json(401, {});
      }
      return url.searchParams.get('after') === 'p2'
        ? json(200, { data: page2, pagination: {} })
        : json(200, { data: page1, pagination: { cursor: 'p2' } });
    }
    return json(404, {});
  }) as typeof fetch;
  return { fetchImpl, calls, expireNextHelix: () => (unauthorizedOnce = true) };
}

async function linked(core: TestCore, tw = fakeTwitch()) {
  const viewers = new TwitchViewerCatalog(
    core.db,
    core.clock,
    APP,
    tw.fetchImpl,
  );
  const { authorization_url } = await viewers.startAuth();
  const state = new URL(authorization_url).searchParams.get('state')!;
  const viewer = await viewers.completeAuth('good', state);
  return { viewers, viewer, tw, state };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (error) {
    return error instanceof TwitchViewerError ||
      error instanceof BonkLabError409
      ? error.code
      : `unexpected: ${(error as Error).message}`;
  }
};

describe('Twitch viewer identity (Lab OAuth)', () => {
  it('authorize URL: registered redirect, only user:read:emotes, single-use state; token owner stored, never returned', async () => {
    const core = await setup();
    const tw = fakeTwitch();
    const viewers = new TwitchViewerCatalog(
      core.db,
      core.clock,
      APP,
      tw.fetchImpl,
    );
    const url = new URL((await viewers.startAuth()).authorization_url);
    expect(url.origin + url.pathname).toBe(
      'https://id.twitch.tv/oauth2/authorize',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: APP.clientId,
      redirect_uri: VIEWER_REDIRECT_URI,
      response_type: 'code',
      scope: 'user:read:emotes',
      force_verify: 'true',
    });
    const state = url.searchParams.get('state')!;
    expect(await viewers.completeAuth('good', state)).toEqual({
      user_id: VIEWER,
      login: 'raptoru_',
      display_name: 'Raptoru_',
      scopes: ['user:read:emotes'],
    });
    expect(await code(viewers.completeAuth('good', state))).toBe(
      'oauth_state_invalid',
    ); // single use
    expect(await code(viewers.completeAuth('good', 'forged'))).toBe(
      'oauth_state_invalid',
    );
    const viewersList = JSON.stringify(await viewers.viewers());
    expect(viewersList).not.toMatch(/AT\d|RT\d/);
    // Expired state.
    const late = new URL(
      (await viewers.startAuth()).authorization_url,
    ).searchParams.get('state')!;
    core.clock.set(new Date(core.clock.now().getTime() + 11 * MINUTE));
    expect(await code(viewers.completeAuth('good', late))).toBe(
      'oauth_state_invalid',
    );
  });

  it('refuses (and revokes) a token with more than the read-only scope, or from another app', async () => {
    const core = await setup();
    const extra = fakeTwitch({ scopes: ['user:read:emotes', 'chat:edit'] });
    const v1 = new TwitchViewerCatalog(
      core.db,
      core.clock,
      APP,
      extra.fetchImpl,
    );
    const s1 = new URL(
      (await v1.startAuth()).authorization_url,
    ).searchParams.get('state')!;
    expect(await code(v1.completeAuth('good', s1))).toBe('oauth_wrong_scopes');
    expect(extra.calls.some((c) => c.url.endsWith('/oauth2/revoke'))).toBe(
      true,
    );
    const other = fakeTwitch({ clientId: 'someone-else' });
    const v2 = new TwitchViewerCatalog(
      core.db,
      core.clock,
      APP,
      other.fetchImpl,
    );
    const s2 = new URL(
      (await v2.startAuth()).authorization_url,
    ).searchParams.get('state')!;
    expect(await code(v2.completeAuth('good', s2))).toBe('oauth_wrong_client');
    expect(await v1.viewers()).toEqual([]);
  });
});

describe('Twitch personal emote catalog (Get User Emotes)', () => {
  it('all pages, owners, animated/static URLs built by Core, de-duplicated, cached 10 min', async () => {
    const core = await setup();
    const { viewers, tw } = await linked(core);
    const catalog = await viewers.catalog(VIEWER);
    expect(catalog.emotes.map((e) => e.id)).toEqual([
      'emotesv2_anim1',
      '25',
      'emotesv2_other',
    ]);
    expect(catalog.emotes[0]).toEqual({
      provider: 'twitch',
      id: 'emotesv2_anim1',
      name: 'raptorDance',
      emote_type: 'subscriptions',
      emote_set_id: '301',
      owner_id: VIEWER,
      owner_login: 'raptoru_',
      owner_display_name: 'Raptoru_',
      formats: ['static', 'animated'],
      animated: true,
      url: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_anim1/animated/dark/3.0',
      static_url:
        'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_anim1/static/dark/3.0',
    });
    expect(catalog.emotes[1]).toMatchObject({
      owner_id: '0',
      owner_login: null,
      animated: false,
    });
    expect(catalog.owners.map((o) => o.login).sort()).toEqual([
      'ptitchef',
      'raptoru_',
    ]);
    const helixCalls = () =>
      tw.calls.filter((c) => c.url.includes('/helix/chat/emotes/user')).length;
    const before = helixCalls();
    await viewers.catalog(VIEWER);
    expect(helixCalls()).toBe(before); // cached
    await viewers.catalog(VIEWER, { force: true });
    expect(helixCalls()).toBe(before + 2);
    expect(JSON.stringify(catalog)).not.toMatch(/AT\d|RT\d/);
  });

  it('401 → refresh → retry; refused refresh → reauth_required and the token is forgotten', async () => {
    const core = await setup();
    const { viewers, tw } = await linked(core);
    tw.expireNextHelix();
    expect(
      (await viewers.catalog(VIEWER, { force: true })).emotes,
    ).toHaveLength(3);
    expect(
      tw.calls.filter((c) => c.body.includes('grant_type=refresh_token')),
    ).toHaveLength(1);

    const failing = fakeTwitch({ refreshFails: true });
    const { viewers: v2, tw: tw2 } = await linked(await setup(), failing);
    tw2.expireNextHelix();
    expect(await code(v2.catalog(VIEWER, { force: true }))).toBe(
      'reauth_required',
    );
    expect(await v2.viewers()).toEqual([]);
  });
});

describe('Bonk admission with a Twitch emote', () => {
  async function ready(core: TestCore) {
    await core.bonkLab.heartbeat({
      studio_instance_id: 's',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
  }
  const req = (id: string, key: string, viewerId = VIEWER) => ({
    idempotency_key: key,
    channel_id: '900100',
    viewer: { id: viewerId, display_name: 'Raptoru_' },
    lab_session_id: 'lab',
    emote: { provider: 'twitch' as const, id },
  });

  it('admits only an emote of this viewer’s catalog, with the CDN URL resolved by Core; Twemoji still works', async () => {
    const core = await setup();
    await ready(core);
    const { viewers } = await linked(core);
    const bonk = new BonkLabService(core.db, core.clock, viewers);
    const { interaction } = await bonk.admit(req('twitch:emotesv2_anim1', 'a'));
    expect(interaction).toMatchObject({
      provider: 'twitch',
      emote_id: 'twitch:emotesv2_anim1',
      emote_glyph: null,
      emote_url:
        'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_anim1/animated/dark/3.0',
      emote_animated: true,
      test_mode: true,
      payment_mode: 'simulated',
      real_debited: 0,
      status: 'queued',
    });
    expect(await code(bonk.admit(req('twitch:emotesv2_notmine', 'b')))).toBe(
      'emote_not_in_catalog',
    );
    expect(await code(bonk.admit(req('twitch:../../x', 'c')))).toBe(
      'emote_not_available',
    );
    // Another Twitch account has no linked catalog here.
    expect(
      await code(bonk.admit(req('twitch:emotesv2_anim1', 'd', '4242'))),
    ).toBe('viewer_not_linked');
    const twemoji = await bonk.admit({
      ...req('unicode:1f600', 'e'),
      emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
    });
    expect(twemoji.interaction).toMatchObject({
      provider: 'unicode',
      emote_url: 'assets/twemoji/svg/1f600.svg',
    });
  });

  it('a retry replays even while Twitch is unreachable; a stale catalog never validates a new Bonk', async () => {
    const core = await setup();
    await ready(core);
    const { viewers } = await linked(core);
    const bonk = new BonkLabService(core.db, core.clock, viewers);
    const first = await bonk.admit(req('twitch:25', 'k1'));
    const down = new TwitchViewerCatalog(
      core.db,
      core.clock,
      APP,
      (async () => {
        throw new Error('network down');
      }) as typeof fetch,
    );
    const offline = new BonkLabService(core.db, core.clock, down);
    core.clock.set(new Date(core.clock.now().getTime() + 30 * MINUTE));
    await ready(core);
    expect(await offline.admit(req('twitch:25', 'k1'))).toMatchObject({
      replayed: true,
      interaction: { interaction_id: first.interaction.interaction_id },
    });
    // 30 min old catalog + Twitch down: still usable (≤ 1 h) …
    expect(await code(offline.admit(req('twitch:25', 'k2')))).toBe('ok');
    // … but never beyond one hour.
    core.clock.set(new Date(core.clock.now().getTime() + 40 * MINUTE));
    await ready(core);
    expect(await code(offline.admit(req('twitch:25', 'k3')))).toBe(
      'catalog_unavailable',
    );
    // A network outage (even during a token refresh) never forgets the viewer's authorization.
    expect((await down.viewers()).map((v) => v.user_id)).toEqual([VIEWER]);
  });
});
