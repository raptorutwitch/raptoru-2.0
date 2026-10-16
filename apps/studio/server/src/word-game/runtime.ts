import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { LabCoreCall, LabCoreEvents } from '../lab-moderation/proxy.js';

// Jeu des mots V1 in Studio (docs/WORD_GAME_PARITY.md §§ 14, 18). Core decides and stores everything;
// Studio only relays the panel's calls (state, stop / start / new word) and serves the OBS sound source:
// a page with no visual that plays ShuffleWordsSong.ogg once per winning message. Wins are PUSHED, never
// polled: Core's committed wins stream (server-sent events) is relayed to the connected OBS sources
// (token-protected) while at least one is connected. Live only: nothing is buffered or replayed.

/** Delays between reconnections to Core's stream while an OBS source listens (the last one repeats). */
export const EVENTS_RETRY_MS = [1000, 2000, 5000, 10_000];

const MAX_BODY = 1024;
const PLAYER_FILES: Record<string, string> = {
  'player.html': 'text/html; charset=utf-8',
  'player.js': 'text/javascript; charset=utf-8',
  'model.js': 'text/javascript; charset=utf-8',
  'ShuffleWordsSong.ogg': 'audio/ogg',
};

export interface WordGameRuntimeDeps {
  channelId: string;
  core: LabCoreCall;
  /** Core's committed wins stream (server-sent events). */
  events: LabCoreEvents;
  /** Studio's own origin (http://127.0.0.1:<port>). */
  origin: string;
  /** Studio storage for this module (the OBS source token). */
  dir: string;
  /** The OBS source files (apps/studio/server/word-game-player). */
  playerDir: string;
}

export class WordGameRuntime {
  /** Connected OBS sources (server-sent events responses). */
  private readonly clients = new Set<ServerResponse>();
  /** Open connection to Core's stream (only while a source listens). */
  private upstream: AbortController | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  private constructor(
    private readonly d: WordGameRuntimeDeps,
    private readonly token: string,
  ) {}

  static async create(d: WordGameRuntimeDeps) {
    await mkdir(d.dir, { recursive: true });
    const tokenFile = join(d.dir, 'sound-token');
    let token = '';
    try {
      token = (await readFile(tokenFile, 'utf8')).trim();
    } catch {
      /* first run */
    }
    if (!/^[a-f0-9]{32}$/.test(token)) {
      token = randomBytes(16).toString('hex');
      await writeFile(tokenFile, token);
    }
    return new WordGameRuntime(d, token);
  }

  /** The OBS browser source (sound only). */
  get playerUrl() {
    return `${this.d.origin}/word-game/player.html#${this.token}`;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const isApi = url.pathname.startsWith('/api/word-game/');
    const isPage = url.pathname.startsWith('/word-game/');
    if (!isApi && !isPage) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    const origin = new URL(this.d.origin);
    if (
      req.headers.host !== origin.host ||
      (req.headers.origin && req.headers.origin !== this.d.origin)
    ) {
      reply(403, { error: 'forbidden_origin' });
      return true;
    }
    try {
      if (isPage) await this.page(req, res, url, reply);
      else if (req.headers['x-raptoru-studio'] !== '1')
        reply(403, { error: 'forbidden' });
      else await this.api(req, url, reply);
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      reply(err.status ?? 503, {
        ...(err.body ?? {}),
        error: err.body?.error ?? err.message,
      });
    }
    return true;
  }

  /** The panel: Core's state (+ the OBS source URL) and the three actions, relayed as they are. */
  private async api(
    req: IncomingMessage,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const base = `/v1/lab/word-game/${this.d.channelId}`;
    const p = url.pathname.slice('/api/word-game'.length);
    if (req.method === 'GET' && p === '/state')
      return reply(200, {
        ...(await this.d.core<Record<string, unknown>>(`${base}/state`)),
        player_url: this.playerUrl,
      });
    if (req.method === 'POST' && p === '/actions') {
      let raw = '';
      for await (const chunk of req) {
        raw += String(chunk);
        if (raw.length > MAX_BODY)
          return reply(413, { error: 'body_too_large' });
      }
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      // Only the action fields reach Core (it validates them: start / stop / new_word + request_id).
      const action: Record<string, unknown> = { action: body.action };
      if ('request_id' in body) action.request_id = body.request_id;
      return reply(200, await this.d.core(`${base}/actions`, action));
    }
    reply(404, { error: 'not_found' });
  }

  /** OBS source files and its events stream (token): only the new wins' ids and times. */
  private async page(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const name = url.pathname.slice('/word-game/'.length);
    if (req.method !== 'GET')
      return reply(405, { error: 'method_not_allowed' });
    if (name === 'events') {
      // EventSource cannot send headers: the token comes in the query string.
      if (url.searchParams.get('t') !== this.token)
        return reply(403, { error: 'forbidden' });
      return this.listen(res);
    }
    if (!(name in PLAYER_FILES)) return reply(404, { error: 'not_found' });
    let data: Buffer;
    try {
      data = await readFile(join(this.d.playerDir, name));
    } catch {
      return reply(404, { error: 'not_found' });
    }
    res.writeHead(200, {
      'content-type': PLAYER_FILES[name]!,
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'self'",
    });
    res.end(data);
  }

  /** An OBS source listens: new wins only (nothing replayed); Core's stream opens with the first one. */
  private listen(res: ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
      if (!this.clients.size) this.stop();
    });
    if (!this.upstream && !this.retry) void this.connect();
  }

  /** No source left (or Studio stopping): Core's stream is closed, no reconnection. */
  stop() {
    this.upstream?.abort();
    this.upstream = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.attempt = 0;
  }

  /** Reads Core's stream until it ends (Core stopped / restarted), then reconnects while a source listens. */
  private async connect() {
    const ac = new AbortController();
    this.upstream = ac;
    try {
      const res = await this.d.events(
        `/v1/lab/word-game/${this.d.channelId}/events`,
        ac.signal,
      );
      this.attempt = 0;
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let i; (i = buffer.indexOf('\n\n')) >= 0;) {
          this.relay(buffer.slice(0, i));
          buffer = buffer.slice(i + 2);
        }
      }
    } catch {
      /* Core unreachable, restarted, or the stream was closed on purpose */
    }
    if (this.upstream !== ac) return; // stopped meanwhile
    this.upstream = null;
    if (!this.clients.size) return;
    const delay =
      EVENTS_RETRY_MS[Math.min(this.attempt++, EVENTS_RETRY_MS.length - 1)];
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.clients.size) void this.connect();
    }, delay);
  }

  /** One Core event → every connected source (the win's id and time only). */
  private relay(block: string) {
    if (!/^event: win$/m.test(block)) return;
    let win: {
      channel_id?: unknown;
      message_id?: unknown;
      created_at?: unknown;
    };
    try {
      win = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '') as typeof win;
    } catch {
      return;
    }
    if (
      win.channel_id !== this.d.channelId ||
      typeof win.message_id !== 'string'
    )
      return;
    const out = `event: win\ndata: ${JSON.stringify({ message_id: win.message_id, created_at: String(win.created_at ?? '') })}\n\n`;
    for (const client of this.clients) client.write(out);
  }
}
