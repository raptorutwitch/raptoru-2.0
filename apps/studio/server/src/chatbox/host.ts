import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { type BusEvent, DemoRunner, SCENARIOS } from './demo.js';
import { EmoteCatalog } from './emotes.js';
import {
  BUILTIN_PRESETS,
  BUNDLED_FONTS,
  DEFAULT_PLACEMENTS,
  FIELD_GROUPS,
  PROFILE_LABELS,
  PROFILES,
  type ProfileId,
  SCENES,
  type SceneId,
} from './settings.js';
import { ChatboxError, ChatboxStore } from './store.js';
import {
  type CatalogCommand,
  ChatboxUpstream,
  type CoreLink,
} from './upstream.js';
import {
  type ChatboxMessage,
  CROUPIER_CATEGORIES,
  decide,
  type Decision,
  type Role,
  roleOf,
} from './visibility.js';

// Chatbox Raptoru — the host in Studio (docs/CHATBOX.md § 5): the OBS page and its event stream, the editor's API, the
// simulator. Two feeds that never mix: `live` (the real chat: the Core's relay, jalon 2) for the OBS sources, `demo`
// (the simulator) for Studio's preview and the demonstration. Studio decides what is shown (one decision, visibility.ts)
// and pushes each profile's settings to its pages the moment they are saved. Messages live in memory only.

type Feed = 'live' | 'demo';
const HISTORY_MAX = 150;
const HEARTBEAT_MS = 25_000;

export type PageMessage = ChatboxMessage & { role: Role; decision: Decision };

interface Client {
  res: ServerResponse;
  feed: Feed;
  profile: ProfileId;
  scene: SceneId;
  explain: boolean;
  preset: string;
}

const STATIC: Record<string, string> = {
  'player.html': 'text/html; charset=utf-8',
  'player.css': 'text/css; charset=utf-8',
  'player.js': 'text/javascript; charset=utf-8',
  'engine.js': 'text/javascript; charset=utf-8',
  'demo.html': 'text/html; charset=utf-8',
  'demo.css': 'text/css; charset=utf-8',
  'demo.js': 'text/javascript; charset=utf-8',
};
const FONT = /^fonts\/([a-z0-9-]+\.woff2|OFL-[A-Za-z]+\.txt)$/;
// Images over https only: emote CDNs, Twemoji, badge images, and Twitch's GIFs (an URL Twitch gives, to use unchanged).
const IMG_SRC = "'self' data: https:";
const CSP = {
  player: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src ${IMG_SRC}; font-src 'self'; connect-src 'self'; frame-ancestors 'self'`,
  demo: "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; frame-ancestors 'self'",
};

const sceneOf = (profile: ProfileId, scene: string | null): SceneId => {
  const own = SCENES.filter((s) => s.profile === profile);
  return (own.find((s) => s.id === scene) ?? own[0]!).id;
};

export class ChatboxHost {
  private readonly history: Record<Feed, ChatboxMessage[]> = {
    live: [],
    demo: [],
  };
  private readonly clients = new Set<Client>();
  private readonly accounts = new Map<
    string,
    { id: string; login: string; name: string; feed: Feed; at: number }
  >();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly catalogTimer: ReturnType<typeof setInterval> | null = null;
  /** Every word of every known command → its catalogue entry (aliases share it). */
  private byWord = new Map<string, CatalogCommand>();
  readonly demo: DemoRunner;
  readonly upstream: ChatboxUpstream | null;

  constructor(
    private readonly d: {
      store: ChatboxStore;
      emotes: EmoteCatalog;
      /** apps/studio/server/chatbox-player */
      dir: string;
      origin: string;
      /** Changes at every Studio start: an open page reloads on its next connection (never an old page). */
      build: string;
      /** Studio's API checks (same host, Studio header): an error code, or null. */
      guard: (req: IncomingMessage) => string | null;
      now?: () => number;
      /** The Core (Lab or Production cockpit): the real chat and the command catalogue. Absent: simulator only. */
      core?: CoreLink | null;
    },
  ) {
    this.demo = new DemoRunner((e) => this.ingest('demo', e), d.now);
    this.upstream = d.core
      ? new ChatboxUpstream({
          core: d.core,
          emit: (e) => this.ingest('live', e),
          reset: (messages) => this.resetLive(messages),
          wanted: () => [...this.clients].some((c) => c.feed === 'live'),
        })
      : null;
    if (this.upstream) {
      void this.refreshCatalog();
      this.catalogTimer = setInterval(() => void this.refreshCatalog(), 60_000);
      this.catalogTimer.unref?.();
    }
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.res.write(': hb\n\n');
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  stop() {
    clearInterval(this.heartbeat);
    if (this.catalogTimer) clearInterval(this.catalogTimer);
    this.upstream?.stop();
    this.demo.stop();
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }

  private get token() {
    return this.d.store.token;
  }

  /** The OBS source of a scene (its profile in the address, the token in the hash: never in a request line). */
  url(scene: SceneId) {
    const s = SCENES.find((x) => x.id === scene)!;
    return `${this.d.origin}/chatbox/player.html?profile=${s.profile}&scene=${s.id}#${this.token}`;
  }

  get demoUrl() {
    return `${this.d.origin}/chatbox/demo.html#${this.token}`;
  }

  /** The emote catalogue changed: the pages reload it. */
  catalogChanged() {
    for (const c of this.clients)
      this.send(c, 'catalog', { version: this.d.emotes.version });
  }

  /** A feed's event (the Core's relay for `live`, the simulator for `demo`). */
  ingest(feed: Feed, e: BusEvent) {
    const h = this.history[feed];
    if (e.type === 'msg') {
      const m = e.message;
      if (h.some((x) => x.id === m.id)) return;
      h.push(m);
      if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
      this.accounts.set(m.user.login.toLowerCase(), {
        id: m.user.id,
        login: m.user.login.toLowerCase(),
        name: m.user.name,
        feed,
        at: m.at,
      });
      if (this.accounts.size > 60)
        this.accounts.delete(this.accounts.keys().next().value!);
      if (feed === 'live') {
        // Fictional demo ids never bind a rule: only the real chat does.
        void this.d.store.bindAccount(m.user.login, m.user.id).catch(() => {});
        if (m.croupier?.family)
          void this.d.store.noteFamily(m.croupier.family).catch(() => {});
      }
      const pm = this.page(m);
      for (const c of this.clients)
        if (c.feed === feed && (c.explain || pm.decision.mode !== 'hide'))
          this.send(c, 'msg', { message: pm });
      return;
    }
    if (e.type === 'delete') {
      this.history[feed] = h.filter((x) => x.id !== e.id);
      for (const c of this.clients)
        if (c.feed === feed) this.send(c, 'delete', { id: e.id });
    } else if (e.type === 'clear_user') {
      this.history[feed] = h.filter((x) => x.user.id !== e.userId);
      for (const c of this.clients)
        if (c.feed === feed) this.send(c, 'clear_user', { userId: e.userId });
    } else {
      this.history[feed] = [];
      for (const c of this.clients)
        if (c.feed === feed) this.send(c, 'clear', {});
    }
  }

  private page(m: ChatboxMessage): PageMessage {
    return {
      ...m,
      role: roleOf(m.user),
      decision: decide(
        m,
        this.d.store.state.rules,
        (w) => this.byWord.get(w) ?? null,
      ),
    };
  }

  /** The command catalogue read again; a change re-decides what every page shows. */
  async refreshCatalog(force = false) {
    if (!this.upstream) return;
    const commands = await this.upstream.catalog(force);
    const next = new Map<string, CatalogCommand>();
    for (const c of commands)
      for (const w of c.words) next.set(w.toLowerCase(), c);
    const changed = [...next.keys()].join() !== [...this.byWord.keys()].join();
    this.byWord = next;
    if (changed) this.pushRules();
  }

  /** The Core restarted (or Studio was away too long): its chat as it stands replaces the live history. */
  private resetLive(messages: ChatboxMessage[]) {
    this.history.live = messages.slice(-HISTORY_MAX);
    for (const c of this.clients)
      if (c.feed === 'live')
        this.send(c, 'history', { messages: this.historyFor(c) });
  }

  private historyFor(c: Client) {
    return this.history[c.feed]
      .map((m) => this.page(m))
      .filter((m) => c.explain || m.decision.mode !== 'hide');
  }

  private settingsFor(c: Client) {
    return c.preset
      ? this.d.store.presetSettings(c.profile, c.preset)
      : this.d.store.state.profiles[c.profile].settings;
  }

  private send(c: Client, event: string, data: unknown) {
    if (!c.res.writableEnded)
      c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Saved settings or placement: every page of that profile / scene applies them now. */
  private pushSettings(profile?: ProfileId, scene?: SceneId) {
    for (const c of this.clients) {
      if (profile && c.profile !== profile) continue;
      if (scene && c.scene !== scene) continue;
      this.send(c, 'settings', {
        settings: this.settingsFor(c),
        placement: this.d.store.state.placements[c.scene],
      });
    }
  }

  /** New rules: every page re-decides what it shows. */
  private pushRules() {
    for (const c of this.clients)
      this.send(c, 'history', { messages: this.historyFor(c) });
  }

  private forbidden(res: ServerResponse) {
    res.writeHead(403, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end('{"error":"forbidden"}');
    return true;
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
    return true;
  }

  /** /chatbox/* (the page, its stream, its catalogue) and /api/chatbox* (the editor). */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (
      url.pathname === '/api/chatbox' ||
      url.pathname.startsWith('/api/chatbox/')
    )
      return this.api(req, res, url);
    if (!url.pathname.startsWith('/chatbox/')) return false;
    const name = url.pathname.slice('/chatbox/'.length);
    if (req.method !== 'GET')
      return this.json(res, 405, { error: 'method_not_allowed' });
    const font = FONT.exec(name);
    if (STATIC[name] || font) {
      try {
        const body = await readFile(join(this.d.dir, name));
        res.writeHead(200, {
          'content-type': font
            ? name.endsWith('.txt')
              ? 'text/plain; charset=utf-8'
              : 'font/woff2'
            : STATIC[name]!,
          'cache-control': 'no-cache',
          'content-security-policy': name.startsWith('demo')
            ? CSP.demo
            : CSP.player,
          'x-content-type-options': 'nosniff',
        });
        res.end(body);
      } catch {
        res.writeHead(404, { 'cache-control': 'no-store' });
        res.end();
      }
      return true;
    }
    if (url.searchParams.get('t') !== this.token) return this.forbidden(res);
    const profileParam = url.searchParams.get('profile') ?? '';
    const profile = (PROFILES as readonly string[]).includes(profileParam)
      ? (profileParam as ProfileId)
      : 'just-chatting';
    if (name === 'catalog.json')
      return this.json(res, 200, {
        version: this.d.emotes.version,
        emotes: this.d.emotes.emotes,
      });
    if (name === 'settings.json') {
      try {
        const preset = url.searchParams.get('preset') ?? '';
        return this.json(res, 200, {
          settings: preset
            ? this.d.store.presetSettings(profile, preset)
            : this.d.store.state.profiles[profile].settings,
        });
      } catch (e) {
        return this.json(res, (e as ChatboxError).status ?? 400, {
          error: (e as Error).message,
        });
      }
    }
    if (name === 'events') {
      const preset = url.searchParams.get('preset') ?? '';
      const c: Client = {
        res,
        feed: url.searchParams.get('feed') === 'demo' ? 'demo' : 'live',
        profile,
        scene: sceneOf(profile, url.searchParams.get('scene')),
        explain: url.searchParams.get('explain') === '1',
        preset,
      };
      let settings;
      try {
        settings = this.settingsFor(c);
      } catch {
        c.preset = '';
        settings = this.settingsFor(c);
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      this.clients.add(c);
      res.on('close', () => {
        this.clients.delete(c);
        if (![...this.clients].some((x) => x.feed === 'live'))
          this.upstream?.stop();
      });
      if (c.feed === 'live') this.upstream?.ensure();
      this.send(c, 'hello', {
        build: this.d.build,
        settings,
        placement: this.d.store.state.placements[c.scene],
        catalog: this.d.emotes.version,
      });
      this.send(c, 'history', { messages: this.historyFor(c) });
      return true;
    }
    res.writeHead(404, { 'cache-control': 'no-store' });
    res.end();
    return true;
  }

  view() {
    const s = this.d.store.state;
    return {
      version: this.d.store.version,
      profiles: PROFILES.map((id) => ({
        id,
        label: PROFILE_LABELS[id],
        ...s.profiles[id],
      })),
      builtins: BUILTIN_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        desc: p.desc,
        settings: p.settings,
      })),
      presets: s.presets,
      scenes: SCENES.map((x) => ({
        ...x,
        placement: s.placements[x.id],
        url: this.url(x.id),
      })),
      defaults: DEFAULT_PLACEMENTS,
      rules: s.rules,
      categories: CROUPIER_CATEGORIES,
      catalogue: this.d.store.catalogue(),
      accounts: [...this.accounts.values()].reverse(),
      fields: FIELD_GROUPS,
      fonts: BUNDLED_FONTS,
      demo: {
        url: this.demoUrl,
        token: this.token,
        playing: this.demo.playing,
        scenarios: SCENARIOS.map(({ id, label }) => ({ id, label })),
      },
      emotes: {
        count: this.d.emotes.emotes.length,
        status: this.d.emotes.status,
      },
      repaired: this.d.store.repaired,
      live: {
        linked: !!this.upstream,
        connected: this.upstream?.connected ?? false,
        lastEventAt: this.upstream?.lastEventAt ?? null,
        catalogError: this.upstream?.catalogError ?? null,
        pages: [...this.clients].filter((c) => c.feed === 'live').length,
      },
      commands: this.upstream?.commands ?? [],
    };
  }

  private async api(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const refused = this.d.guard(req);
    if (refused) return this.json(res, 403, { error: refused });
    const path = url.pathname.slice('/api/chatbox'.length) || '/';
    try {
      if (req.method === 'GET' && path === '/') {
        await this.refreshCatalog().catch(() => {});
        return this.json(res, 200, this.view());
      }
      if (req.method !== 'POST')
        return this.json(res, 405, { error: 'method_not_allowed' });
      const b = await body(req);
      const str = (k: string) =>
        typeof b[k] === 'string' ? (b[k] as string) : '';
      const st = this.d.store;
      switch (path) {
        case '/profile':
          await st.saveProfile(str('profile'), b.settings);
          this.pushSettings(str('profile') as ProfileId);
          break;
        case '/preset/apply':
          await st.applyPreset(str('profile'), str('preset'));
          this.pushSettings(str('profile') as ProfileId);
          break;
        case '/preset/save':
          await st.savePreset(str('profile'), str('name'), b.settings);
          this.pushSettings(str('profile') as ProfileId);
          break;
        case '/preset/rename':
          await st.renamePreset(str('profile'), str('id'), str('name'));
          break;
        case '/preset/delete':
          await st.deletePreset(str('profile'), str('id'));
          break;
        case '/placement':
          await st.setPlacement(str('scene'), b.placement);
          this.pushSettings(undefined, str('scene') as SceneId);
          break;
        case '/placement/reset':
          await st.resetPlacement(str('scene'));
          this.pushSettings(undefined, str('scene') as SceneId);
          break;
        case '/rules':
          await st.setRules(b.rules);
          this.pushRules();
          break;
        case '/demo':
          if (typeof b.case === 'string') {
            const id = this.demo.emitCase(b.case);
            if (!id) throw new ChatboxError('unknown_case', 404);
            return this.json(res, 200, { id });
          }
          if (typeof b.delete === 'string')
            this.ingest('demo', { type: 'delete', id: b.delete });
          else if (typeof b.clearUser === 'string')
            this.ingest('demo', { type: 'clear_user', userId: b.clearUser });
          else if (b.stop === true) this.demo.stop();
          else if (b.clear === true) {
            this.demo.stop();
            this.ingest('demo', { type: 'clear' });
          } else if (!this.demo.play(str('scenario')))
            throw new ChatboxError('unknown_scenario', 404);
          break;
        default:
          return this.json(res, 404, { error: 'not_found' });
      }
      return this.json(res, 200, this.view());
    } catch (e) {
      if (e instanceof ChatboxError)
        return this.json(res, e.status, { error: e.code });
      if (e instanceof SyntaxError)
        return this.json(res, 400, { error: 'invalid_json' });
      throw e;
    }
  }
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 256 * 1024) throw new ChatboxError('body_too_large', 413);
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Studio's start: the store (settings, rules), the emote catalogues (loaded in the background), the host. */
export async function createChatboxHost(o: {
  dir: string;
  playerDir: string;
  origin: string;
  channelId: string;
  guard: (req: IncomingMessage) => string | null;
  /** Tests: the emote providers' answers without the network. */
  fetcher?: (url: string, init?: RequestInit) => Promise<unknown>;
  /** The Core (real chat + command catalogue); absent: simulator only. */
  core?: CoreLink | null;
}) {
  const store = await ChatboxStore.open(o.dir);
  let host: ChatboxHost | null = null;
  const emotes = new EmoteCatalog({
    channelId: o.channelId,
    file: join(o.dir, 'emotes-cache.json'),
    ...(o.fetcher ? { fetcher: o.fetcher } : {}),
    onChange: () => host?.catalogChanged(),
  });
  host = new ChatboxHost({
    store,
    emotes,
    dir: o.playerDir,
    origin: o.origin,
    build: `${process.env.npm_package_version ?? 'dev'}-${Date.now().toString(36)}`,
    guard: o.guard,
    core: o.core ?? null,
  });
  const stop = host.stop.bind(host);
  host.stop = () => {
    emotes.stop();
    stop();
  };
  void emotes.start();
  return host;
}
