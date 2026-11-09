import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  BUILTINS,
  OverlaySettings,
  PALETTES,
  type OverlayStore,
} from './music-overlays.js';
import { MusicOverlayObs, ObsOverlayError } from './music-overlay-obs.js';

// Music Hub — the overlays' host in Studio (docs/music/MUSIC_OVERLAYS.md): the OBS page and its long poll, the editor's
// API. What the page shows comes from what Studio already knows (Windows' track, its exact Spotify track, the request
// Core attributes, by its exact uri) — never a Spotify call of its own, never a decision. The page only reads.

/** What the overlay shows (no id, no secret: titles, artists, a cover URL, a requester's display name). */
export interface OverlayLive {
  state: 'playing' | 'paused' | 'stale' | 'lost' | 'off' | 'none';
  /** One occurrence (a replay of the same track is another one). */
  gen: number;
  track: {
    title: string;
    artists: string[];
    album: string | null;
    duration_ms: number | null;
  } | null;
  position_ms: number | null;
  /** Studio's local cover (Windows' bytes) or Spotify's image URL. */
  cover: string | null;
  /** A request Core attributes to THIS exact track; `by` null while its name is being read. */
  request: { by: string | null } | null;
}

/** A long poll waits this long for a change, then answers anyway (the page re-anchors its clock). */
const HOLD_MS = 25_000;
const FILES: Record<string, string> = {
  'overlay.html': 'text/html; charset=utf-8',
  'overlay.css': 'text/css; charset=utf-8',
  'overlay.js': 'text/javascript; charset=utf-8',
};
const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.scdn.co; connect-src 'self'; frame-ancestors 'self'";

const httpError = (code: string, status = 400) =>
  Object.assign(new Error(code), { status });

export class MusicOverlayHost {
  private v = 1;
  private pulse = 0;
  private readonly waiters = new Set<() => void>();
  readonly obs: MusicOverlayObs;

  constructor(
    private readonly d: {
      store: OverlayStore;
      /** The page's folder (apps/studio/server/music-overlay). */
      dir: string;
      origin: string;
      live: () => OverlayLive;
      obs: () => import('./music-overlay-obs.js').ObsLike | null;
      now?: () => number;
    },
  ) {
    this.obs = new MusicOverlayObs(d.obs, () => this.url);
  }

  /** The OBS browser source's URL: the token rides in the hash (never sent in a request line, never logged). */
  get url() {
    return `${this.d.origin}/music-overlay/overlay.html#${this.d.store.token}`;
  }

  /** Something the page shows changed: every waiting page answers now. */
  bump() {
    this.v++;
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  payload() {
    const s = this.d.store;
    const p = s.onAir;
    return {
      version: this.v,
      visible: s.state.visible,
      preset: { id: s.state.active, name: p.name, settings: p.settings },
      live: this.d.live(),
      pulse: this.pulse,
      server_now: (this.d.now ?? Date.now)(),
    };
  }

  /** /music-overlay/*: the page (static) and its state (token, long poll). */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!url.pathname.startsWith('/music-overlay/')) return false;
    const name = url.pathname.slice('/music-overlay/'.length);
    if (req.method === 'GET' && FILES[name]) {
      try {
        const body = await readFile(join(this.d.dir, name));
        res.writeHead(200, {
          'content-type': FILES[name],
          'cache-control': 'no-cache',
          'content-security-policy': PAGE_CSP,
          'x-content-type-options': 'nosniff',
        });
        res.end(body);
      } catch {
        res.writeHead(404, { 'cache-control': 'no-store' });
        res.end();
      }
      return true;
    }
    if (req.method === 'GET' && name === 'state') {
      if (req.headers['x-overlay-token'] !== this.d.store.token) {
        res.writeHead(403, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        res.end('{"error":"forbidden"}');
        return true;
      }
      const since = Number(url.searchParams.get('since'));
      if (since !== this.v) {
        this.answer(res);
        return true;
      }
      let done = false;
      const reply = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(reply);
        this.answer(res);
      };
      const timer = setTimeout(reply, HOLD_MS);
      timer.unref?.();
      this.waiters.add(reply);
      req.on('close', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(reply);
      });
      return true;
    }
    res.writeHead(404, { 'cache-control': 'no-store' });
    res.end();
    return true;
  }

  private answer(res: ServerResponse) {
    if (res.writableEnded) return;
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(this.payload()));
  }

  /** /api/spotify/overlays* (Studio's own origin check is the caller's). */
  async api(
    method: string,
    path: string,
    body: () => Promise<Record<string, unknown>>,
  ): Promise<unknown> {
    const s = this.d.store;
    const view = () => ({
      ...this.payload(),
      url: this.url,
      builtins: BUILTINS,
      variants: s.state.variants,
      palettes: PALETTES,
      repaired: s.repaired,
    });
    const changed = async <T>(fn: () => Promise<T>) => {
      const out = await fn();
      this.bump();
      return out;
    };
    if (method === 'GET' && path === '/overlays') return view();
    // The Spotify page's quick control: shown or not, which preset (a few bytes, read with its state).
    if (method === 'GET' && path === '/overlays/summary')
      return {
        visible: s.state.visible,
        preset: { id: s.state.active, name: s.onAir.name },
      };
    if (method === 'GET' && path === '/overlays/obs') return this.obs.status();
    if (method !== 'POST') throw httpError('not_found', 404);
    const b = await body();
    const str = (k: string) =>
      typeof b[k] === 'string' ? (b[k] as string) : '';
    switch (path) {
      case '/overlays/visible':
        if (typeof b.visible !== 'boolean') throw httpError('visible_required');
        await changed(() => s.setVisible(b.visible as boolean));
        return view();
      case '/overlays/active':
        await changed(() => s.setActive(str('id')));
        return view();
      case '/overlays/variant': {
        const v = await changed(() =>
          s.saveVariant({
            id: str('id') || null,
            base: str('base'),
            name: str('name') || null,
            settings: b.settings,
          }),
        );
        return { variant: v, ...view() };
      }
      case '/overlays/variant/duplicate': {
        const v = await changed(() =>
          s.duplicate(str('id'), str('name') || null),
        );
        return { variant: v, ...view() };
      }
      case '/overlays/variant/rename':
        await changed(() => s.rename(str('id'), str('name')));
        return view();
      case '/overlays/variant/reset':
        await changed(() => s.reset(str('id')));
        return view();
      case '/overlays/variant/delete':
        await changed(() => s.remove(str('id')));
        return view();
      case '/overlays/pulse':
        // « Tester l'animation » on stream: the page replays its entrance with the REAL track (never demo data).
        this.pulse++;
        this.bump();
        return { pulse: this.pulse };
      case '/overlays/validate': {
        const r = OverlaySettings.safeParse(b.settings);
        return r.success
          ? { ok: true }
          : { ok: false, issues: r.error.issues.map((i) => i.path.join('.')) };
      }
    }
    try {
      if (path === '/overlays/obs/install') return await this.obs.install();
      if (path === '/overlays/obs/add')
        return await this.obs.addTo(str('scene'));
      if (path === '/overlays/obs/repair') return await this.obs.repair();
    } catch (e) {
      if (e instanceof ObsOverlayError)
        throw Object.assign(new Error(e.message), { status: e.status });
      throw e;
    }
    throw httpError('not_found', 404);
  }
}
