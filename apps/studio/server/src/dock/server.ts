import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { dirname, join } from 'node:path';
import type { DockHub, DockHubEvent } from './hub.js';

// Dock OBS V1 (docs/OBS_DOCK.md) — the dock's OWN local server, on its own port (Studio's port + 10 by default: 4110): only
// the dock page, its activity stream, older history pages and the visual replay. Nothing else of Studio is reachable
// from this origin, and Studio's own API refuses it (other origin). Access:
// - Host must be this server (127.0.0.1 / localhost on this port: no DNS rebinding);
// - every API call carries the dock key (header x-dock-key, compared in constant time). The key lives in the URL
//   FRAGMENT given to OBS (#key=…): never sent in a request line, a log or a Referer; regenerated from Studio (the
//   open docks are then closed);
// - the replay also needs the page's own Origin and a JSON body (no form post from another site);
// - strict CSP (scripts and styles of this origin only), no-store, nosniff, no referrer.
// The stream is a `fetch` stream of server-sent events (EventSource cannot send a header); a slow dock is cut (it
// reconnects and gets a fresh snapshot), never an unbounded buffer.

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATIC: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/dock.js': { file: 'dock.js', type: 'text/javascript; charset=utf-8' },
  '/dock-view.js': {
    file: 'dock-view.js',
    type: 'text/javascript; charset=utf-8',
  },
  '/dock.css': { file: 'dock.css', type: 'text/css; charset=utf-8' },
};
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
export const DOCK_SERVER = {
  heartbeatMs: 20_000,
  /** Unsent bytes allowed for one dock before it is cut (it reconnects). */
  maxBufferedBytes: 512 * 1024,
  maxBodyBytes: 4 * 1024,
};

/** The dock key, kept in Studio's storage (never shown in a log). */
export class DockKey {
  private constructor(
    private readonly file: string,
    private key: string,
  ) {}

  static async open(file: string) {
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as {
        key?: string;
      };
      if (typeof saved.key === 'string' && saved.key.length >= 32)
        return new DockKey(file, saved.key);
    } catch {
      /* none yet */
    }
    const k = new DockKey(file, '');
    await k.regenerate();
    return k;
  }

  get value() {
    return this.key;
  }

  async regenerate() {
    this.key = randomBytes(24).toString('base64url');
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify({ key: this.key }), {
      mode: 0o600,
    });
    await rename(`${this.file}.tmp`, this.file);
  }

  matches(candidate: unknown) {
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.key);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export class DockServer {
  private server: Server | null = null;
  private readonly streams = new Set<ServerResponse>();

  constructor(
    private readonly d: {
      hub: DockHub;
      key: DockKey;
      port: number;
      /** The folder of the dock page (apps/studio/server/dock-page). */
      pageDir: string;
      host?: string;
      log?: (line: string) => void;
    },
  ) {}

  private get host() {
    return this.d.host ?? '127.0.0.1';
  }

  /** The URL to give OBS (Studio's « Dock OBS » panel). */
  url() {
    return `http://${this.host}:${this.d.port}/#key=${this.d.key.value}`;
  }

  get clients() {
    return this.streams.size;
  }

  listen() {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) this.json(res, 500, { error: 'dock_error' });
        else res.destroy();
      });
    });
    return new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.d.port, this.host, () => resolve());
    });
  }

  async close() {
    for (const s of this.streams) s.destroy();
    this.streams.clear();
    await new Promise<void>((r) =>
      this.server ? this.server.close(() => r()) : r(),
    );
  }

  /** A new key: every open dock is closed (it must be given the new URL). */
  async regenerateKey() {
    await this.d.key.regenerate();
    for (const s of this.streams) s.destroy();
    this.streams.clear();
  }

  private headers(type: string, extra: Record<string, string> = {}) {
    return {
      'content-type': type,
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'same-origin',
      ...extra,
    };
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, this.headers('application/json; charset=utf-8'));
    res.end(JSON.stringify(body));
  }

  private hostOk(req: IncomingMessage) {
    const h = req.headers.host;
    return h === `127.0.0.1:${this.d.port}` || h === `localhost:${this.d.port}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (!this.hostOk(req)) return this.json(res, 421, { error: 'wrong_host' });
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const page = req.method === 'GET' ? STATIC[url.pathname] : undefined;
    if (page) {
      const body = await readFile(join(this.d.pageDir, page.file));
      res.writeHead(200, this.headers(page.type));
      res.end(body);
      return;
    }
    if (!url.pathname.startsWith('/api/'))
      return this.json(res, 404, { error: 'not_found' });
    if (!this.d.key.matches(req.headers['x-dock-key']))
      return this.json(res, 401, { error: 'dock_key_required' });
    if (req.method === 'GET' && url.pathname === '/api/stream')
      return this.stream(req, res);
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const at = url.searchParams.get('before');
      const seq = Number(url.searchParams.get('before_seq') ?? 0);
      if (
        !at ||
        Number.isNaN(Date.parse(at)) ||
        !Number.isInteger(seq) ||
        seq < 0
      )
        return this.json(res, 400, { error: 'bad_query' });
      return this.json(res, 200, await this.d.hub.history({ at, seq }));
    }
    if (req.method === 'POST' && url.pathname === '/api/replay') {
      // The page's own origin, JSON only: no other site can make OBS post this.
      if (req.headers.origin !== `http://${req.headers.host}`)
        return this.json(res, 403, { error: 'origin_refused' });
      if (
        !String(req.headers['content-type'] ?? '').startsWith(
          'application/json',
        )
      )
        return this.json(res, 415, { error: 'json_required' });
      const body = await this.body(req);
      if (
        !body ||
        typeof body !== 'object' ||
        Object.keys(body).sort().join(',') !== 'alert_id,replay_key' ||
        !UUID.test(String((body as Record<string, unknown>).alert_id)) ||
        !UUID.test(String((body as Record<string, unknown>).replay_key))
      )
        return this.json(res, 400, { error: 'bad_request' });
      const b = body as { alert_id: string; replay_key: string };
      try {
        return this.json(
          res,
          200,
          await this.d.hub.replay(b.alert_id, b.replay_key),
        );
      } catch (e) {
        const err = e as {
          status?: number;
          message?: string;
          body?: { error?: string };
        };
        // Core's answer as is (its code only: never a stack or a secret).
        const status =
          err.status && err.status >= 400 && err.status < 500
            ? err.status
            : 502;
        return this.json(res, status, {
          error:
            err.body?.error ?? err.message?.slice(0, 80) ?? 'replay_failed',
        });
      }
    }
    return this.json(res, 404, { error: 'not_found' });
  }

  private body(req: IncomingMessage) {
    return new Promise<unknown>((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > DOCK_SERVER.maxBodyBytes) {
          resolve(null);
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  /** The activity stream: the snapshot, then every change and status (server-sent events over a fetch stream). */
  private stream(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(
      200,
      this.headers('text/event-stream; charset=utf-8', {
        connection: 'keep-alive',
      }),
    );
    res.write(`retry: 3000\n\n`);
    this.streams.add(res);
    const id = randomUUID().slice(0, 8);
    const send = (e: DockHubEvent) => {
      if (res.writableLength > DOCK_SERVER.maxBufferedBytes) {
        // Too slow (OBS hidden, frozen): cut; it reconnects and gets a fresh snapshot.
        this.d.log?.(`[dock] slow client ${id} cut`);
        res.destroy();
        return;
      }
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    const unsubscribe = this.d.hub.subscribe(send);
    const beat = setInterval(
      () => res.write(`: ping\n\n`),
      DOCK_SERVER.heartbeatMs,
    );
    beat.unref?.();
    const done = () => {
      clearInterval(beat);
      unsubscribe();
      this.streams.delete(res);
    };
    req.on('close', done);
    res.on('close', done);
  }
}
