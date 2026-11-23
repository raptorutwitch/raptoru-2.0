import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Chatbox Raptoru — the third-party emote catalogues (7TV, BTTV, FFZ), loaded ONCE by Studio for every page (the old
// widgets loaded them three times), every 10 minutes, kept on disk so a restart without network still knows them.
// Ported from the StreamElements widgets (docs/CHATBOX.md § 1): same public endpoints, same priority (the channel's
// emotes before the global ones; 7TV > BTTV > FFZ for the same name), same zero-width flag. A provider that fails
// keeps its last list and never blocks the others.

export interface CatalogEmote {
  code: string;
  url: string;
  provider: '7tv' | 'bttv' | 'ffz';
  scope: 'channel' | 'global';
  /** 7TV zero-width: drawn over the previous emote. */
  zw: boolean;
  animated: boolean;
}

type Provider = 'seventv' | 'bttv' | 'ffz';
const PROVIDERS: Provider[] = ['seventv', 'bttv', 'ffz'];

const ENDPOINTS = {
  sevenTvGraphql: 'https://7tv.io/v4/gql',
  sevenTvGlobal: 'https://7tv.io/v3/emote-sets/global',
  bttv: 'https://api.betterttv.net/3/cached',
  ffz: 'https://api.frankerfacez.com/v1',
};

const SEVENTV_QUERY = `query OverlayEmotes($platformId: String!, $globalSetId: Id!) {
  users { userByConnection(platform: TWITCH, platformId: $platformId) { style { activeEmoteSet {
    emotes(page: 1, perPage: 300) { items { alias flags { zeroWidth } emote { id flags { animated } } } } } } } }
  emoteSets { emoteSet(id: $globalSetId) {
    emotes(page: 1, perPage: 100) { items { alias flags { zeroWidth } emote { id flags { animated } } } } } }
}`;

const secureUrl = (url: unknown) => {
  const s = typeof url === 'string' ? url : '';
  if (s.startsWith('//')) return `https:${s}`;
  return s.replace(/^http:/, 'https:');
};

type Fetcher = (url: string, init?: RequestInit) => Promise<unknown>;

function sevenTv(set: unknown, scope: CatalogEmote['scope']): CatalogEmote[] {
  const items = (set as { emotes?: { items?: unknown[] } } | null)?.emotes
    ?.items;
  return (Array.isArray(items) ? items : []).flatMap((x) => {
    const i = x as {
      alias?: unknown;
      flags?: { zeroWidth?: unknown };
      emote?: { id?: unknown; flags?: { animated?: unknown } };
    };
    if (typeof i.alias !== 'string' || typeof i.emote?.id !== 'string')
      return [];
    return [
      {
        code: i.alias,
        url: `https://cdn.7tv.app/emote/${encodeURIComponent(i.emote.id)}/3x.webp`,
        provider: '7tv' as const,
        scope,
        zw: Boolean(i.flags?.zeroWidth),
        animated: Boolean(i.emote.flags?.animated),
      },
    ];
  });
}

function bttv(items: unknown, scope: CatalogEmote['scope']): CatalogEmote[] {
  return (Array.isArray(items) ? items : []).flatMap((x) => {
    const i = x as { code?: unknown; id?: unknown; imageType?: unknown };
    if (typeof i.code !== 'string' || typeof i.id !== 'string') return [];
    return [
      {
        code: i.code,
        url: `https://cdn.betterttv.net/emote/${encodeURIComponent(i.id)}/3x`,
        provider: 'bttv' as const,
        scope,
        zw: false,
        animated: i.imageType === 'gif',
      },
    ];
  });
}

function ffz(
  payload: unknown,
  scope: CatalogEmote['scope'],
  onlyDefault: boolean,
) {
  const p = (payload ?? {}) as {
    sets?: Record<string, { emoticons?: unknown[] }>;
    default_sets?: unknown[];
  };
  const sets = p.sets ?? {};
  const ids =
    onlyDefault && Array.isArray(p.default_sets)
      ? p.default_sets.map(String)
      : Object.keys(sets);
  return ids.flatMap((id) =>
    (sets[id]?.emoticons ?? []).flatMap((x) => {
      const i = x as { name?: unknown; urls?: Record<string, unknown> };
      const url = secureUrl(i.urls?.['4'] ?? i.urls?.['2'] ?? i.urls?.['1']);
      if (typeof i.name !== 'string' || !url) return [];
      return [
        {
          code: i.name,
          url,
          provider: 'ffz' as const,
          scope,
          zw: false,
          animated: false,
        },
      ];
    }),
  );
}

async function load(p: Provider, get: Fetcher, channelId: string) {
  if (p === 'seventv') {
    const global = (await get(ENDPOINTS.sevenTvGlobal)) as { id?: string };
    if (!global?.id) throw new Error('7tv_global_without_id');
    const out = (await get(ENDPOINTS.sevenTvGraphql, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: SEVENTV_QUERY,
        variables: { platformId: channelId, globalSetId: global.id },
      }),
    })) as {
      errors?: { message?: string }[];
      data?: {
        users?: { userByConnection?: { style?: { activeEmoteSet?: unknown } } };
        emoteSets?: { emoteSet?: unknown };
      };
    };
    if (out.errors?.length) throw new Error('7tv_graphql_error');
    return [
      ...sevenTv(out.data?.emoteSets?.emoteSet, 'global'),
      ...sevenTv(
        out.data?.users?.userByConnection?.style?.activeEmoteSet,
        'channel',
      ),
    ];
  }
  if (p === 'bttv') {
    const [g, c] = (await Promise.all([
      get(`${ENDPOINTS.bttv}/emotes/global`),
      get(`${ENDPOINTS.bttv}/users/twitch/${encodeURIComponent(channelId)}`),
    ])) as [unknown, { sharedEmotes?: unknown; channelEmotes?: unknown }];
    return [
      ...bttv(g, 'global'),
      ...bttv(c?.sharedEmotes, 'channel'),
      ...bttv(c?.channelEmotes, 'channel'),
    ];
  }
  const [g, c] = await Promise.all([
    get(`${ENDPOINTS.ffz}/set/global`),
    get(`${ENDPOINTS.ffz}/room/id/${encodeURIComponent(channelId)}`),
  ]);
  return [...ffz(g, 'global', true), ...ffz(c, 'channel', false)];
}

const priority = (e: CatalogEmote) =>
  (e.scope === 'channel' ? 100 : 0) +
  { '7tv': 30, bttv: 20, ffz: 10 }[e.provider];

/** One emote per name: the channel's before the global ones, 7TV > BTTV > FFZ. */
export function mergeCatalog(emotes: CatalogEmote[]): CatalogEmote[] {
  const byCode = new Map<string, CatalogEmote>();
  for (const e of emotes) {
    const cur = byCode.get(e.code);
    if (!cur || priority(e) >= priority(cur)) byCode.set(e.code, e);
  }
  return [...byCode.values()];
}

export class EmoteCatalog {
  private lists: Record<Provider, CatalogEmote[]> = {
    seventv: [],
    bttv: [],
    ffz: [],
  };
  private merged: CatalogEmote[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  version = 0;
  status: Record<
    Provider,
    { ok: boolean; count: number; error: string | null }
  > = {
    seventv: { ok: false, count: 0, error: null },
    bttv: { ok: false, count: 0, error: null },
    ffz: { ok: false, count: 0, error: null },
  };

  constructor(
    private readonly d: {
      channelId: string;
      /** Disk cache (Studio's data folder). */
      file: string;
      fetcher?: Fetcher;
      refreshMs?: number;
      timeoutMs?: number;
      onChange?: () => void;
    },
  ) {}

  get emotes(): CatalogEmote[] {
    return this.merged;
  }

  private get fetcher(): Fetcher {
    return (
      this.d.fetcher ??
      (async (url, init) => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), this.d.timeoutMs ?? 10_000);
        try {
          const r = await fetch(url, {
            ...init,
            signal: ac.signal,
            headers: { accept: 'application/json', ...(init?.headers ?? {}) },
          });
          if (!r.ok) throw new Error(`http_${r.status}`);
          return (await r.json()) as unknown;
        } finally {
          clearTimeout(t);
        }
      })
    );
  }

  async start() {
    try {
      const cached = JSON.parse(await readFile(this.d.file, 'utf8')) as {
        lists?: Partial<Record<Provider, CatalogEmote[]>>;
      };
      for (const p of PROVIDERS)
        if (Array.isArray(cached.lists?.[p])) this.lists[p] = cached.lists[p]!;
      this.rebuild();
    } catch {
      /* no cache yet */
    }
    void this.refresh();
    this.timer = setInterval(
      () => void this.refresh(),
      this.d.refreshMs ?? 600_000,
    );
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh() {
    this.running ??= (async () => {
      const results = await Promise.allSettled(
        PROVIDERS.map((p) => load(p, this.fetcher, this.d.channelId)),
      );
      results.forEach((r, i) => {
        const p = PROVIDERS[i]!;
        if (r.status === 'fulfilled') this.lists[p] = r.value;
        this.status[p] = {
          ok: r.status === 'fulfilled',
          count: this.lists[p].length,
          error:
            r.status === 'rejected'
              ? String((r.reason as Error)?.message ?? r.reason)
              : null,
        };
      });
      this.rebuild();
      await mkdir(dirname(this.d.file), { recursive: true }).catch(() => {});
      await writeFile(
        `${this.d.file}.tmp`,
        JSON.stringify({ lists: this.lists }),
      )
        .then(() => rename(`${this.d.file}.tmp`, this.d.file))
        .catch(() => {});
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private rebuild() {
    this.merged = mergeCatalog(PROVIDERS.flatMap((p) => this.lists[p]));
    this.version++;
    this.d.onChange?.();
  }
}
