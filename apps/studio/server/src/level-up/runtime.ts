import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Level Up V2 in Studio (docs/PROGRESSION.md) — its own OBS browser source, apart from every other overlay (the Twitch
// alerts, the effects player and the Halloween overlay are untouched). Core decides everything: which level-ups are
// shown (the viewer's mode), which one gets the sound (the channel's cooldown), what is too old. Studio only asks Core
// for the next notices WHILE an OBS source listens (nothing is claimed without one: an unseen level-up expires in Core,
// never played late), pushes them to the source and remembers nothing. The sound: a short chime made here, or the
// streamer's own file (runtimeDir/level-up/sound.mp3 | .ogg | .wav), at Studio's volume.

export const CLAIM_EVERY_MS = 2000;
export const DEFAULT_VOLUME = 70;
const MAX_BODY = 1024;
const PLAYER_FILES: Record<string, string> = {
  'player.html': 'text/html; charset=utf-8',
  'player.js': 'text/javascript; charset=utf-8',
};
const CUSTOM_SOUNDS: [string, string][] = [
  ['sound.mp3', 'audio/mpeg'],
  ['sound.ogg', 'audio/ogg'],
  ['sound.wav', 'audio/wav'],
];

export type LevelUpNotice = {
  id: number;
  twitchUserId: string;
  displayName: string;
  level: number;
  fromLevel: number;
  sound: boolean;
};

/** The default level-up chime: a rising arpeggio (C5 E5 G5 C6), about 2.4 s, 22 050 Hz mono 16-bit WAV. */
export function synthChime(): Buffer {
  const rate = 22_050;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const step = 0.16;
  const tail = 1.8;
  const total = Math.ceil((step * (notes.length - 1) + tail) * rate);
  const pcm = new Int16Array(total);
  notes.forEach((f, n) => {
    const start = Math.floor(n * step * rate);
    for (let i = 0; start + i < total; i++) {
      const t = i / rate;
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 2.6);
      const v =
        Math.sin(2 * Math.PI * f * t) * 0.6 +
        Math.sin(4 * Math.PI * f * t) * 0.15;
      const k = start + i;
      pcm[k] = Math.max(
        -32767,
        Math.min(32767, pcm[k]! + Math.round(v * env * 7000)),
      );
    }
  });
  const data = Buffer.from(pcm.buffer);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export interface LevelUpRuntimeDeps {
  core: LabCoreCall;
  environment: 'lab' | 'production';
  /** Studio's own origin (http://127.0.0.1:<port>). */
  origin: string;
  /** Studio storage for this module (the OBS source token, the volume, an optional custom sound). */
  dir: string;
  /** The OBS source files (apps/studio/server/level-up-player). */
  playerDir: string;
  claimEveryMs?: number;
}

export class LevelUpRuntime {
  private readonly clients = new Set<ServerResponse>();
  private readonly consumer = `studio-lu-${randomUUID().slice(0, 8)}`;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chime: Buffer | null = null;
  lastError: string | null = null;
  shown = 0;

  private constructor(
    private readonly d: LevelUpRuntimeDeps,
    private readonly token: string,
    private volume: number,
  ) {}

  static async create(d: LevelUpRuntimeDeps) {
    await mkdir(d.dir, { recursive: true });
    const tokenFile = join(d.dir, 'source-token');
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
    let volume = DEFAULT_VOLUME;
    try {
      const v = Number(
        (await readFile(join(d.dir, 'sound-volume'), 'utf8')).trim(),
      );
      if (Number.isInteger(v) && v >= 0 && v <= 100) volume = v;
    } catch {
      /* never set */
    }
    return new LevelUpRuntime(d, token, volume);
  }

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/progression'
      : '/v1/lab/progression';
  }

  /** The OBS browser source (1920 × 1080, transparent). */
  get playerUrl() {
    return `${this.d.origin}/level-up/player.html#${this.token}`;
  }

  /** Asks Core for the next notices while a source listens, then pushes them; stops when the last source leaves. */
  private schedule() {
    if (this.timer || !this.clients.size) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (!this.clients.size) return;
      try {
        const out = await this.d.core<{ notices: LevelUpNotice[] }>(
          `${this.base}/levelups/claim`,
          { consumer: this.consumer },
        );
        this.lastError = null;
        for (const n of out.notices ?? []) this.push(n);
      } catch (e) {
        this.lastError = (e as Error).message;
      }
      this.schedule();
    }, this.d.claimEveryMs ?? CLAIM_EVERY_MS);
  }

  private push(n: LevelUpNotice) {
    const out = `event: levelup\ndata: ${JSON.stringify({
      id: n.id,
      name: n.displayName,
      level: n.level,
      sound: n.sound,
      volume: this.volume / 100,
    })}\n\n`;
    for (const c of this.clients) c.write(out);
    this.shown++;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const isApi = url.pathname.startsWith('/api/level-up/');
    const isPage = url.pathname.startsWith('/level-up/');
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
    if (isPage) await this.page(req, res, url, reply);
    else if (req.headers['x-raptoru-studio'] !== '1')
      reply(403, { error: 'forbidden' });
    else await this.api(req, url, reply);
    return true;
  }

  /** Studio's panel: the source URL, the volume, the connected sources, a local test (never through Core). */
  private async api(
    req: IncomingMessage,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const p = url.pathname.slice('/api/level-up'.length);
    if (req.method === 'GET' && p === '/state')
      return reply(200, {
        player_url: this.playerUrl,
        volume: this.volume,
        sources: this.clients.size,
        shown: this.shown,
        last_error: this.lastError,
        custom_sound: (await this.customSound()) !== null,
      });
    let raw = '';
    for await (const chunk of req) {
      raw += String(chunk);
      if (raw.length > MAX_BODY) return reply(413, { error: 'body_too_large' });
    }
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    if (req.method === 'POST' && p === '/volume') {
      const v = body.volume;
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100)
        return reply(400, { error: 'invalid_volume' });
      await writeFile(join(this.d.dir, 'sound-volume'), String(v));
      this.volume = v as number;
      return reply(200, { volume: this.volume });
    }
    // To place the source in OBS: a sample notice shown on the connected sources only (no viewer, no Core).
    if (req.method === 'POST' && p === '/test') {
      if (!this.clients.size) return reply(409, { error: 'no_source' });
      this.push({
        id: 0,
        twitchUserId: '0',
        displayName: 'Test Raptoru',
        level: 42,
        fromLevel: 41,
        sound: body.sound === true,
      });
      return reply(200, { sent: true });
    }
    reply(404, { error: 'not_found' });
  }

  private async customSound() {
    for (const [file, type] of CUSTOM_SOUNDS) {
      try {
        return { data: await readFile(join(this.d.dir, file)), type };
      } catch {
        /* next */
      }
    }
    return null;
  }

  private async page(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const name = url.pathname.slice('/level-up/'.length);
    if (req.method !== 'GET')
      return reply(405, { error: 'method_not_allowed' });
    if (name === 'events') {
      if (url.searchParams.get('t') !== this.token)
        return reply(403, { error: 'forbidden' });
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      this.clients.add(res);
      res.on('close', () => this.clients.delete(res));
      this.schedule();
      return;
    }
    let data: Buffer;
    let type: string;
    if (name === 'sound') {
      const custom = await this.customSound();
      data = custom?.data ?? (this.chime ??= synthChime());
      type = custom?.type ?? 'audio/wav';
    } else if (name in PLAYER_FILES) {
      try {
        data = await readFile(join(this.d.playerDir, name));
      } catch {
        return reply(404, { error: 'not_found' });
      }
      type = PLAYER_FILES[name]!;
    } else return reply(404, { error: 'not_found' });
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'self'",
    });
    res.end(data);
  }
}
