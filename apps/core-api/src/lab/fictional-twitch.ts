import { createHash } from 'node:crypto';
import { TwitchViewerCatalog } from '../bonk-lab/twitch-viewer.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { STREAMED, type Route } from '../http/server.js';
import { LAB_CHANNEL } from './environment.js';

// The outside world of the Lab, simulated at its FRONTIER (CORE_ENVIRONMENT=lab; decision of 05/11/2026): the Core runs
// its real OAuth code exchange, token validation, Helix catalog, storage and 7TV / BTTV / FFZ parsing on these answers.
// No request leaves the machine, no real app, no real account. Fictional accounts and emotes only.

/** The fictional Twitch app of the Lab: an identifier nowhere, only the fictional Twitch below knows it. */
export const LAB_TWITCH_APP = Object.freeze({
  clientId: 'lab-fictional-client',
  clientSecret: 'lab-fictional-secret',
});
export const LAB_TWITCH_AUTHORIZE_PATH = '/v1/ext/lab/twitch-authorize';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const USERS: Record<
  string,
  { id: string; login: string; display_name: string }
> = {
  '900101': {
    id: '900101',
    login: 'viewer_fictif',
    display_name: 'Viewer fictif',
  },
  '900102': { id: '900102', login: 'modo_fictif', display_name: 'Modo fictif' },
  '900100': {
    id: '900100',
    login: 'raptoru_fictif',
    display_name: 'Raptoru_ (fictif)',
  },
  '900200': {
    id: '900200',
    login: 'autre_chaine',
    display_name: 'Autre chaîne (fictive)',
  },
};
const EMOTES = [
  {
    id: 'e2eRaptorHype',
    name: 'raptorHype',
    emote_type: 'subscriptions',
    emote_set_id: '1001',
    owner_id: '900100',
    format: ['static'],
  },
  {
    id: 'e2eRaptorDance',
    name: 'raptorDance',
    emote_type: 'subscriptions',
    emote_set_id: '1001',
    owner_id: '900100',
    format: ['static', 'animated'],
  },
  {
    id: 'e2eAutreWave',
    name: 'autreWave',
    emote_type: 'subscriptions',
    emote_set_id: '2002',
    owner_id: '900200',
    format: ['static'],
  },
  {
    id: 'e2eKappaFictif',
    name: 'KappaFictif',
    emote_type: 'globals',
    emote_set_id: '0',
    owner_id: '0',
    format: ['static'],
  },
];

/** A code or token names its fictional account (`lab-900102`); anything else is the Lab's viewer. */
const accountOf = (value: string | null | undefined) => {
  const id = /^lab-(\d+)$/.exec(value ?? '')?.[1];
  return id && USERS[id] ? id : '900101';
};

export const labTwitchFetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const path = `${url.host}${url.pathname}`;
  if (path === 'id.twitch.tv/oauth2/token') {
    const form = new URLSearchParams(String(init?.body ?? ''));
    if (form.get('client_id') !== LAB_TWITCH_APP.clientId)
      return json({ message: 'invalid client' }, 400);
    const account = accountOf(form.get('code') ?? form.get('refresh_token'));
    return json({
      access_token: `lab-${account}`,
      refresh_token: `lab-${account}`,
      expires_in: 14_400,
    });
  }
  if (path === 'id.twitch.tv/oauth2/validate') {
    const bearer = new Headers(init?.headers).get('authorization');
    const user = USERS[accountOf(bearer?.replace(/^\w+\s+/, ''))]!;
    return json({
      client_id: LAB_TWITCH_APP.clientId,
      login: user.login,
      user_id: user.id,
      scopes: ['user:read:emotes'],
      expires_in: 14_400,
    });
  }
  if (path === 'id.twitch.tv/oauth2/revoke') return json({});
  if (path === 'api.twitch.tv/helix/users')
    return json({
      data: url.searchParams
        .getAll('id')
        .map((id) => USERS[id])
        .filter(Boolean),
    });
  if (path === 'api.twitch.tv/helix/chat/emotes/user')
    return json({ data: EMOTES, pagination: {} });
  throw new Error(`lab_no_network: ${url.href}`);
}) as typeof fetch;

/** Fictional 7TV / BTTV / FFZ catalogs of the Lab's channel (what the Bonk offers unless a real channel is chosen). */
const PROVIDERS: Record<string, unknown> = {
  'https://7tv.io/v3/emote-sets/global': {
    emotes: [
      {
        id: '0123456789abcdef01234567',
        name: 'ClapFictif',
        data: { animated: false },
      },
    ],
  },
  [`https://7tv.io/v3/users/twitch/${LAB_CHANNEL.id}`]: {
    user: { display_name: 'Raptoru_ (fictif)' },
    emote_set: {
      emotes: [
        {
          id: '89abcdef0123456789abcdef',
          name: 'PepoFictif',
          data: { animated: false },
        },
        {
          id: 'fedcba9876543210fedcba98',
          name: 'CatJamFictif',
          data: { animated: true },
        },
      ],
    },
  },
  'https://api.betterttv.net/3/cached/emotes/global': [],
  [`https://api.betterttv.net/3/cached/users/twitch/${LAB_CHANNEL.id}`]: {
    channelEmotes: [
      { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', code: 'BttvFictif', imageType: 'png' },
    ],
    sharedEmotes: [],
  },
  'https://api.frankerfacez.com/v1/set/global': {
    default_sets: [3],
    sets: {
      '3': {
        emoticons: [{ id: 424242, name: 'FfzFictif', urls: { '1': 'x' } }],
      },
    },
  },
  [`https://api.frankerfacez.com/v1/room/id/${LAB_CHANNEL.id}`]: { sets: {} },
};
export const labEmoteProvidersFetch = (async (
  input: string | URL | Request,
) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!(url in PROVIDERS)) throw new Error(`lab_no_network: ${url}`);
  return json(PROVIDERS[url]);
}) as typeof fetch;

/** A fictional emote's image: served by the Lab's Studio (same origin as the extension and the overlay), never a CDN. */
export const labEmoteImage = (provider: string, id: string) =>
  `/ext-lab/fictional-emote/${provider.replace(/\W/g, '')}-${id}.svg`;

/** The viewers' Twitch emotes in the Lab: the real catalog code, on the fictional Twitch. */
export function labTwitchViewers(db: Db, clock: Clock, port: number) {
  return new TwitchViewerCatalog(db, clock, LAB_TWITCH_APP, labTwitchFetch, {
    redirectUri: `http://127.0.0.1:${port}/v1/ext/emotes/oauth/callback`,
    authorizeUrl: `http://127.0.0.1:${port}${LAB_TWITCH_AUTHORIZE_PATH}`,
    tokenKey: createHash('sha256').update('raptoru-lab-fictional').digest(),
    emoteImageUrl: (id) => labEmoteImage('twitch', id),
  });
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Twitch's consent page, fictional: pick a fictional account, or refuse. Back to the Core's own callback. */
export function labTwitchConsentRoutes(): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/ext\/lab\/twitch-authorize$/,
      auth: 'public',
      handle: async ({ url, res }) => {
        const back = (q: Record<string, string>) => {
          const u = new URL(String(url.searchParams.get('redirect_uri')));
          if (u.hostname !== '127.0.0.1')
            throw new Error('lab_redirect_refused');
          for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
          u.searchParams.set('state', String(url.searchParams.get('state')));
          return esc(u.href);
        };
        const accounts = ['900101', '900102', '900100']
          .map(
            (id) =>
              `<li><a href="${back({ code: `lab-${id}` })}">Autoriser avec ${esc(USERS[id]!.display_name)}</a></li>`,
          )
          .join('');
        res!.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        res!
          .end(`<!doctype html><meta charset="utf-8"><title>Twitch fictif (Lab)</title>
<body style="font:15px system-ui;background:#111317;color:#e6e6e6;padding:24px">
<h1 style="font-size:18px">Twitch fictif — aucun vrai compte</h1>
<p>Le Lab simule l’autorisation Twitch : rien ne part vers Twitch.</p>
<ul>${accounts}</ul><p><a href="${back({ error: 'access_denied' })}">Refuser</a></p>`);
        return STREAMED;
      },
    },
  ];
}
