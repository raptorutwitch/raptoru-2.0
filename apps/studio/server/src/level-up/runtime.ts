import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Level Up V2 in Studio (docs/LEVEL_UP_V2.md) — its own INVISIBLE OBS browser source, SOUND ONLY (never a banner, a
// text or a frame on the stream), apart from every other overlay (the Twitch alerts, the effects player and the Halloween
// overlay are untouched). Core decides everything: which level-up plays (the viewer turned the sound on, the channel's
// sound is on, its cooldown), what is too old. Studio only asks Core for the next sounds WHILE an OBS source listens
// (nothing is claimed without one: an unheard level-up expires in Core, never played late), pushes them to the source and
// remembers nothing. The sound: a short chime made here (a test sound), or the streamer's own file sent from Studio
// (runtimeDir/level-up/sound.mp3 | .ogg | .wav), at Studio's volume.
// The same invisible source plays the Commands « sound » actions (e.g. « !groslot »): the sounds imported in Studio
// (runtimeDir/level-up/command-sounds/<id>.<format>), each queued by the Core for an accepted use and handed out once
// (`event: sound`, a distinct event: a page of an older Studio ignores it — never the wrong sound).

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
/** A level-up sound is short: 2 MB is far more than a few seconds of MP3 / OGG (a WAV of ~10 s). */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

/** The file's real format from its first bytes (never trusted from a name or a header sent by the page). */
export function soundFormat(data: Buffer): 'mp3' | 'ogg' | 'wav' | null {
  if (data.length < 12) return null;
  if (data.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (
    data.toString('latin1', 0, 4) === 'RIFF' &&
    data.toString('latin1', 8, 12) === 'WAVE'
  )
    return 'wav';
  // An ID3 tag, or an MPEG audio frame sync (11 bits set).
  if (data.toString('latin1', 0, 3) === 'ID3') return 'mp3';
  if (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/**
 * One announcement's sound (Core: one per announcement, just before its banner, delivered once). Only `id` and `sound`
 * reach the OBS page; the rest is for the logs.
 */
export type LevelUpNotice = {
  id: number;
  sound: boolean;
  test?: boolean;
  names?: number;
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

/** A sound imported for the Commands « sound » action. */
export interface CommandSound {
  id: string;
  label: string;
  format: 'mp3' | 'ogg' | 'wav';
  bytes: number;
  added_at: string;
}
const SOUND_TYPES = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
} as const;
const SOUND_ID = /^[a-f0-9]{16}$/;

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
  /**
   * Commands « sound » actions: the channel's command sounds queue (`/v1/lab/commands/<channel>/sounds/claim`, the
   * production cockpit in Production). Absent: none claimed.
   */
  commandSounds?: { core: LabCoreCall; channelId: string };
}

export class LevelUpRuntime {
  private readonly clients = new Set<ServerResponse>();
  private readonly consumer = `studio-lu-${randomUUID().slice(0, 8)}`;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chime: Buffer | null = null;
  lastError: string | null = null;
  lastSoundError: string | null = null;
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
      await this.claimCommandSounds();
      this.schedule();
    }, this.d.claimEveryMs ?? CLAIM_EVERY_MS);
  }

  private push(n: LevelUpNotice) {
    // Nothing to draw: the page receives only « play the sound, at this volume » (no pseudo, no level).
    if (!n.sound) return;
    const out = `event: levelup\ndata: ${JSON.stringify({
      id: n.id,
      sound: true,
      volume: this.volume / 100,
    })}\n\n`;
    for (const c of this.clients) c.write(out);
    this.shown++;
  }

  /** The command sounds queued by the Core (each handed out once), pushed to the sources while one listens. */
  private async claimCommandSounds() {
    const cs = this.d.commandSounds;
    if (!cs) return;
    try {
      const out = await cs.core<{ sounds: { id: number; sound: string }[] }>(
        `/v1/lab/commands/${cs.channelId}/sounds/claim`,
        { consumer: this.consumer },
      );
      this.lastSoundError = null;
      const known = new Set((await this.commandSounds()).map((x) => x.id));
      for (const x of out.sounds ?? [])
        if (SOUND_ID.test(x.sound) && known.has(x.sound))
          this.pushSound(`cmd-${x.id}`, x.sound);
    } catch (e) {
      this.lastSoundError = (e as Error).message;
    }
  }

  /** One command sound on every connected source (nothing drawn): the page plays the file Studio serves. */
  private pushSound(id: string, sound: string) {
    const out = `event: sound\ndata: ${JSON.stringify({
      id,
      src: `/level-up/cmd/${sound}`,
      volume: this.volume / 100,
    })}\n\n`;
    for (const c of this.clients) c.write(out);
    this.shown++;
  }

  private get soundsDir() {
    return join(this.d.dir, 'command-sounds');
  }

  /** The imported command sounds (their index; a missing file is left out). */
  async commandSounds(): Promise<CommandSound[]> {
    try {
      const list = JSON.parse(
        await readFile(join(this.soundsDir, 'index.json'), 'utf8'),
      ) as CommandSound[];
      return Array.isArray(list)
        ? list.filter((x) => SOUND_ID.test(x.id) && x.format in SOUND_TYPES)
        : [];
    } catch {
      return [];
    }
  }

  private async saveSounds(list: CommandSound[]) {
    await mkdir(this.soundsDir, { recursive: true });
    await writeFile(
      join(this.soundsDir, 'index.json'),
      JSON.stringify(list, null, 1),
    );
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
        last_sound_error: this.lastSoundError,
        custom_sound: (await this.customSound()) !== null,
        custom_sound_type: (await this.customSound())?.type ?? null,
      });
    // Antoni's own level-up sound (the raw file as the body), checked by its first bytes; replaces the previous one.
    if (req.method === 'POST' && p === '/sound') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_SOUND_BYTES)
          return reply(413, { error: 'sound_too_large' });
        chunks.push(chunk as Buffer);
      }
      const data = Buffer.concat(chunks);
      const format = soundFormat(data);
      if (!format) return reply(415, { error: 'unsupported_sound' });
      for (const [file] of CUSTOM_SOUNDS)
        await rm(join(this.d.dir, file), { force: true });
      await writeFile(join(this.d.dir, `sound.${format}`), data);
      return reply(200, { custom_sound: true, format, bytes: data.length });
    }
    if (req.method === 'DELETE' && p === '/sound') {
      for (const [file] of CUSTOM_SOUNDS)
        await rm(join(this.d.dir, file), { force: true });
      return reply(200, { custom_sound: false });
    }
    // Commands « sound » actions: the imported sounds (list, import a file as the raw body, remove, try in OBS).
    if (req.method === 'GET' && p === '/command-sounds')
      return reply(200, { sounds: await this.commandSounds() });
    if (req.method === 'POST' && p === '/command-sounds') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_SOUND_BYTES)
          return reply(413, { error: 'sound_too_large' });
        chunks.push(chunk as Buffer);
      }
      const data = Buffer.concat(chunks);
      const format = soundFormat(data);
      if (!format) return reply(415, { error: 'unsupported_sound' });
      // The file's name without its extension, control characters or angle brackets (a label, never markup).
      const label =
        Array.from(
          (url.searchParams.get('name') ?? '').replace(/\.[a-z0-9]{2,4}$/i, ''),
        )
          .filter((ch) => ch >= ' ' && ch !== '<' && ch !== '>')
          .join('')
          .trim()
          .slice(0, 60) || 'Son';
      const sound: CommandSound = {
        id: randomBytes(8).toString('hex'),
        label,
        format,
        bytes: data.length,
        added_at: new Date().toISOString(),
      };
      await mkdir(this.soundsDir, { recursive: true });
      await writeFile(join(this.soundsDir, `${sound.id}.${format}`), data);
      await this.saveSounds([...(await this.commandSounds()), sound]);
      return reply(200, sound);
    }
    const one = /^\/command-sounds\/([a-f0-9]{16})(\/test)?$/.exec(p);
    if (one && req.method === 'DELETE' && !one[2]) {
      const list = await this.commandSounds();
      const gone = list.find((x) => x.id === one[1]);
      if (gone)
        await rm(join(this.soundsDir, `${gone.id}.${gone.format}`), {
          force: true,
        });
      await this.saveSounds(list.filter((x) => x.id !== one[1]));
      return reply(200, { removed: Boolean(gone) });
    }
    if (one && req.method === 'POST' && one[2]) {
      if (!(await this.commandSounds()).some((x) => x.id === one[1]))
        return reply(404, { error: 'not_found' });
      if (!this.clients.size) return reply(409, { error: 'no_source' });
      this.pushSound(`try-${Date.now()}`, one[1]!);
      return reply(200, { sent: true });
    }
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
    // « Tester le son »: the sound on the connected sources only, at the volume set (no viewer, no Core).
    if (req.method === 'POST' && p === '/test') {
      if (!this.clients.size) return reply(409, { error: 'no_source' });
      this.push({ id: 0, sound: true, test: true });
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
    const cmd = /^cmd\/([a-f0-9]{16})$/.exec(name);
    if (name === 'sound') {
      const custom = await this.customSound();
      data = custom?.data ?? (this.chime ??= synthChime());
      type = custom?.type ?? 'audio/wav';
    } else if (cmd) {
      const x = (await this.commandSounds()).find((y) => y.id === cmd[1]);
      if (!x) return reply(404, { error: 'not_found' });
      try {
        data = await readFile(join(this.soundsDir, `${x.id}.${x.format}`));
      } catch {
        return reply(404, { error: 'not_found' });
      }
      type = SOUND_TYPES[x.format];
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
