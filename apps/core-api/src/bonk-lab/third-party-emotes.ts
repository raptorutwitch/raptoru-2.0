// Bonk V2 Lab — 7TV / BTTV / FFZ public catalogs of the channel (global + channel sets).
// No viewer token: these catalogs are public. Core knows where every emote comes from: the caller
// only sends `provider` + `id`, Core checks the id is in the current catalog and builds the CDN URL
// itself from a fixed template. Core never serves or proxies images.

import type { Clock } from '../clock.js';

export const THIRD_PARTY_PROVIDERS = ['7tv', 'bttv', 'ffz'] as const;
export type ThirdPartyProvider = (typeof THIRD_PARTY_PROVIDERS)[number];

export interface ThirdPartyEmote {
  provider: ThirdPartyProvider;
  /** Provider id (without the `7tv:` / `bttv:` / `ffz:` prefix). */
  id: string;
  name: string;
  scope: 'global' | 'channel';
  animated: boolean;
  url: string;
}

export interface ThirdPartyCatalog {
  fetched_at: string;
  channel_display_name: string | null;
  emotes: ThirdPartyEmote[];
  /** Provider -> error code of the last refresh (previous emotes kept when a provider fails). */
  errors: Partial<Record<ThirdPartyProvider, string>>;
}

const CACHE_MS = 10 * 60 * 1000;
const MAX_PER_SET = 1000;
const ID: Record<ThirdPartyProvider, RegExp> = {
  // 7TV v3 ids are ULIDs; older objects keep a 24-hex id.
  '7tv': /^(?:[0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{24})$/,
  bttv: /^[0-9a-f]{24}$/,
  ffz: /^[0-9]{1,10}$/,
};

/** Only these CDN URL shapes can ever be stored for a third-party Bonk. */
export function thirdPartyUrl(
  provider: ThirdPartyProvider,
  id: string,
  options: { animated?: boolean; scale?: 1 | 2 | 4 } = {},
): string | null {
  if (!ID[provider].test(id)) return null;
  if (provider === '7tv') return `https://cdn.7tv.app/emote/${id}/4x.webp`;
  if (provider === 'bttv') return `https://cdn.betterttv.net/emote/${id}/3x`;
  const scale = options.scale ?? 4;
  return options.animated
    ? `https://cdn.frankerfacez.com/emote/${id}/animated/${scale}`
    : `https://cdn.frankerfacez.com/emote/${id}/${scale}`;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function collect(
  provider: ThirdPartyProvider,
  scope: 'global' | 'channel',
  entries: unknown[],
  read: (entry: Json) => {
    id: string;
    name: string;
    animated: boolean;
    scale?: 1 | 2 | 4;
  } | null,
): ThirdPartyEmote[] {
  const out: ThirdPartyEmote[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const entry = read(obj(raw));
    if (!entry || !entry.name || seen.has(entry.id)) continue;
    const url = thirdPartyUrl(provider, entry.id, entry);
    if (!url) continue;
    seen.add(entry.id);
    out.push({
      provider,
      id: entry.id,
      name: entry.name.slice(0, 64),
      scope,
      animated: entry.animated,
      url,
    });
    if (out.length >= MAX_PER_SET) break;
  }
  return out;
}

/** 7TV: `emote-sets/global` and `users/twitch/{id}` (field `emote_set`). */
export function parse7tv(set: unknown, scope: 'global' | 'channel') {
  return collect('7tv', scope, list(obj(set).emotes), (e) => ({
    id: text(e.id),
    name: text(e.name),
    animated: obj(e.data).animated === true,
  }));
}

/** BTTV: global array, or `{ channelEmotes, sharedEmotes }` for the channel. */
export function parseBttv(body: unknown, scope: 'global' | 'channel') {
  const entries =
    scope === 'global'
      ? list(body)
      : [...list(obj(body).channelEmotes), ...list(obj(body).sharedEmotes)];
  return collect('bttv', scope, entries, (e) => ({
    id: text(e.id),
    name: text(e.code),
    animated: e.animated === true || text(e.imageType).toLowerCase() === 'gif',
  }));
}

/** FFZ: `set/global` (only its `default_sets`) or `room/id/{id}` (its `sets`). */
export function parseFfz(body: unknown, scope: 'global' | 'channel') {
  const root = obj(body);
  const sets = obj(root.sets);
  const keys =
    scope === 'global'
      ? list(root.default_sets).map(String)
      : Object.keys(sets);
  const entries = keys.flatMap((key) => list(obj(sets[key]).emoticons));
  return collect('ffz', scope, entries, (e) => {
    const id = typeof e.id === 'number' ? String(e.id) : text(e.id);
    const animatedUrls = obj(e.animated);
    const urls = Object.keys(animatedUrls).length ? animatedUrls : obj(e.urls);
    const scale = (['4', '2', '1'] as const).find((s) => urls[s]);
    if (!scale) return null;
    return {
      id,
      name: text(e.name),
      animated: Object.keys(animatedUrls).length > 0,
      scale: Number(scale) as 1 | 2 | 4,
    };
  });
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class ThirdPartyEmotes {
  private cached: ThirdPartyCatalog | null = null;
  private inflight: Promise<ThirdPartyCatalog> | null = null;

  constructor(
    private readonly channelTwitchId: string,
    private readonly clock: Clock,
    private readonly fetchImpl: Fetch = globalThis.fetch,
    private readonly cacheMs = CACHE_MS,
  ) {
    if (!/^\d+$/.test(channelTwitchId))
      throw new Error('channel_twitch_id_required');
  }

  /** Cached 10 min; a failing provider keeps its previous emotes (error reported). */
  async catalog({ force = false } = {}): Promise<ThirdPartyCatalog> {
    const fresh =
      this.cached &&
      this.clock.now().getTime() - Date.parse(this.cached.fetched_at) <
        this.cacheMs;
    if (fresh && !force) return this.cached!;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Emote of the current catalog, or null (unknown id => refused by Core). */
  async resolve(provider: ThirdPartyProvider, id: string) {
    if (!ID[provider].test(id)) return null;
    const catalog = await this.catalog();
    return (
      catalog.emotes.find((e) => e.provider === provider && e.id === id) ?? null
    );
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    // 404 = no set for this channel on this provider: an empty channel set, not an error.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`http_${response.status}`);
    return response.json();
  }

  private async refresh(): Promise<ThirdPartyCatalog> {
    const channel = encodeURIComponent(this.channelTwitchId);
    const sources: [
      ThirdPartyProvider,
      'global' | 'channel',
      string,
      (b: unknown) => ThirdPartyEmote[],
    ][] = [
      [
        '7tv',
        'global',
        'https://7tv.io/v3/emote-sets/global',
        (b) => parse7tv(b, 'global'),
      ],
      [
        '7tv',
        'channel',
        `https://7tv.io/v3/users/twitch/${channel}`,
        (b) => parse7tv(obj(b).emote_set, 'channel'),
      ],
      [
        'bttv',
        'global',
        'https://api.betterttv.net/3/cached/emotes/global',
        (b) => parseBttv(b, 'global'),
      ],
      [
        'bttv',
        'channel',
        `https://api.betterttv.net/3/cached/users/twitch/${channel}`,
        (b) => parseBttv(b, 'channel'),
      ],
      [
        'ffz',
        'global',
        'https://api.frankerfacez.com/v1/set/global',
        (b) => parseFfz(b, 'global'),
      ],
      [
        'ffz',
        'channel',
        `https://api.frankerfacez.com/v1/room/id/${channel}`,
        (b) => parseFfz(b, 'channel'),
      ],
    ];
    const results = await Promise.allSettled(
      sources.map(async ([, , url, parse]) => ({
        url,
        body: await this.json(url),
        parse,
      })),
    );
    const emotes: ThirdPartyEmote[] = [];
    const errors: Partial<Record<ThirdPartyProvider, string>> = {};
    let channelName: string | null = this.cached?.channel_display_name ?? null;
    results.forEach((result, index) => {
      const [provider, scope] = sources[index]!;
      if (result.status === 'fulfilled') {
        if (result.value.body === null) return;
        emotes.push(...result.value.parse(result.value.body));
        if (provider === '7tv' && scope === 'channel')
          channelName =
            text(obj(obj(result.value.body).user).display_name) || channelName;
        return;
      }
      errors[provider] = 'provider_unavailable';
      // Keep the previous emotes of this provider/scope rather than dropping them.
      emotes.push(
        ...(this.cached?.emotes.filter(
          (e) => e.provider === provider && e.scope === scope,
        ) ?? []),
      );
    });
    this.cached = {
      fetched_at: this.clock.now().toISOString(),
      channel_display_name: channelName,
      emotes,
      errors,
    };
    return this.cached;
  }
}
