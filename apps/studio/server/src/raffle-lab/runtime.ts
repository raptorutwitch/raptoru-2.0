import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { RaffleCommand, RaffleConfig } from '@raptoru/schemas';
import {
  LAB_CHANNEL_ID,
  STUDIO_ACTOR,
  type LabCoreCall,
} from '../lab-moderation/proxy.js';

// Tombola V2 in Studio. Core decides and stores everything (round, phases, configuration, scheduler,
// entries, payouts, audit); this runtime only relays the Studio UI to the Lab Core and owns what is
// local by nature:
// - the launch sounds, imported (copied, content-addressed) into Studio's own storage — never a path
//   of the user's disk — and served to the overlay;
// - the single OBS browser source (`/raffle-lab/overlay.html#<token>`) and its snapshot relay;
// The chat (simulator and real Twitch ingestion) is not handled here: it is the Lab's single chat
// ingress (src/lab-chat/ingress.ts), routed by Core to every module.

export const SOUND_MAX_BYTES = 5 * 1024 * 1024;
const SOUND_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };
type SoundFormat = keyof typeof SOUND_MIME;
const OVERLAY_FILES: Record<string, string> = {
  'overlay.html': 'text/html; charset=utf-8',
  'overlay.js': 'text/javascript; charset=utf-8',
  'overlay.css': 'text/css; charset=utf-8',
  'kit.js': 'text/javascript; charset=utf-8',
  'model.js': 'text/javascript; charset=utf-8',
};

/** Real audio format from the first bytes (the file name / extension is never trusted). */
export function soundFormat(b: Buffer): SoundFormat | null {
  if (b.length < 12) return null;
  if (b.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3';
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return 'mp3';
  if (
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WAVE'
  )
    return 'wav';
  if (b.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  return null;
}

export interface RaffleRuntimeDeps {
  core: LabCoreCall;
  origin: string;
  /** Studio data folder for this module (overlay token, sounds). */
  dir: string;
  /** Overlay page files (phase F); a missing folder serves a clear placeholder. */
  overlayDir: string;
}

export class RaffleRuntime {
  private constructor(
    private readonly d: RaffleRuntimeDeps,
    readonly token: string,
  ) {}

  static async create(d: RaffleRuntimeDeps) {
    await mkdir(join(d.dir, 'sounds'), { recursive: true });
    const tokenFile = join(d.dir, 'overlay-token');
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
    return new RaffleRuntime(d, token);
  }

  /** Single OBS browser source (1920×1080, transparent). */
  get overlayUrl() {
    return `${this.d.origin}/raffle-lab/overlay.html#${this.token}`;
  }
  get previewUrl() {
    return `${this.d.origin}/raffle-lab/overlay.html?preview=1#${this.token}`;
  }

  /** Imports a launch sound into Studio's storage (content-addressed, format checked by its bytes). */
  async importSound(body: Buffer, name: string) {
    if (!body.length) throw httpError(400, 'empty_file');
    if (body.length > SOUND_MAX_BYTES) throw httpError(413, 'sound_too_large');
    const format = soundFormat(body);
    if (!format) throw httpError(415, 'unsupported_audio');
    const asset_id = createHash('sha256').update(body).digest('hex');
    const file = join(this.d.dir, 'sounds', `${asset_id}.${format}`);
    if (!existsSync(file)) await writeFile(file, body);
    // Display name only (never a path): control characters removed, 80 characters.
    const clean = [...name]
      .filter((ch) => ch.charCodeAt(0) >= 32)
      .join('')
      .trim()
      .slice(0, 80);
    return {
      asset_id,
      format,
      name: clean || `son.${format}`,
      size_bytes: body.length,
      volume: 80,
    };
  }

  /** Removes the stored sounds no longer referenced by the configuration (replace / delete). */
  async pruneSounds(config: RaffleConfig) {
    const kept = new Set(
      Object.values(config.launch_sounds)
        .filter((s) => s)
        .map((s) => `${s!.asset_id}.${s!.format}`),
    );
    for (const f of await readdir(join(this.d.dir, 'sounds')))
      if (!kept.has(f))
        await rm(join(this.d.dir, 'sounds', f), { force: true });
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const isApi = url.pathname.startsWith('/api/raffle/');
    const isPage = url.pathname.startsWith('/raffle-lab/');
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

  /** OBS page, its snapshot relay (token) and the stored sounds. */
  private async page(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const name = url.pathname.slice('/raffle-lab/'.length);
    if (req.method !== 'GET')
      return reply(405, { error: 'method_not_allowed' });
    if (name === 'snapshot') {
      if (req.headers['x-raffle-token'] !== this.token)
        return reply(403, { error: 'forbidden' });
      return reply(
        200,
        await this.d.core(`/v1/lab/raffle/${LAB_CHANNEL_ID}/snapshot`),
      );
    }
    const sound = /^sounds\/([a-f0-9]{64})\.(mp3|wav|ogg)$/.exec(name);
    if (sound) {
      try {
        const data = await readFile(
          join(this.d.dir, 'sounds', `${sound[1]}.${sound[2]}`),
        );
        res.writeHead(200, {
          'content-type': SOUND_MIME[sound[2] as SoundFormat],
          'cache-control': 'private, max-age=86400, immutable',
        });
        res.end(data);
      } catch {
        reply(404, { error: 'not_found' });
      }
      return;
    }
    if (!(name in OVERLAY_FILES)) return reply(404, { error: 'not_found' });
    let data: Buffer | string;
    try {
      data = await readFile(join(this.d.overlayDir, name));
    } catch {
      if (name !== 'overlay.html') return reply(404, { error: 'not_found' });
      data = PLACEHOLDER;
    }
    res.writeHead(200, {
      'content-type': OVERLAY_FILES[name]!,
      'cache-control': 'no-store',
      // OBS browser source, or the Studio preview (same origin). Twitch pictures only from its CDN.
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; img-src 'self' data: https://static-cdn.jtvnw.net; frame-ancestors 'self'",
    });
    res.end(data);
  }

  private async api(
    req: IncomingMessage,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const C = LAB_CHANNEL_ID;
    const p = url.pathname.slice('/api/raffle'.length);
    const get = req.method === 'GET';
    let m: RegExpExecArray | null;
    if (!get && p === '/sounds') {
      const body = await readBody(req, SOUND_MAX_BYTES + 1);
      let name = 'son';
      try {
        name = decodeURIComponent(String(req.headers['x-sound-name'] ?? 'son'));
      } catch {
        /* keep the default */
      }
      return reply(200, await this.importSound(body, name));
    }
    const json = get
      ? {}
      : (JSON.parse(
          (await readBody(req, 16 * 1024)).toString('utf8') || '{}',
        ) as Record<string, unknown>);
    if (get && p === '/status') {
      const settings = await this.d.core<Record<string, unknown>>(
        `/v1/lab/raffle/${C}/settings`,
      );
      return reply(200, {
        ...settings,
        overlay_url: this.overlayUrl,
        preview_url: this.previewUrl,
      });
    }
    if (get && p === '/snapshot')
      return reply(200, await this.d.core(`/v1/lab/raffle/${C}/snapshot`));
    if (get && p === '/history')
      return reply(200, {
        items: await this.d.core(`/v1/lab/raffle/${C}/history?limit=50`),
      });
    if (get && (m = /^\/rounds\/([0-9a-f-]{36})$/.exec(p)))
      return reply(
        200,
        await this.d.core(`/v1/lab/raffle/${C}/rounds/${m[1]}`),
      );
    if (get && p === '/search')
      return reply(
        200,
        await this.d.core(
          `/v1/lab/moderation/${C}/search?q=${encodeURIComponent((url.searchParams.get('q') ?? '').slice(0, 40))}`,
        ),
      );
    if (!get && p === '/actions') {
      const command = json.command as RaffleCommand;
      const out = await this.d.core<Record<string, unknown>>(
        `/v1/lab/raffle/${C}/actions`,
        { actor: STUDIO_ACTOR, command },
      );
      if (command?.action === 'config') await this.pruneSounds(command.config);
      return reply(200, out);
    }
    reply(404, { error: 'not_found' });
  }
}

function httpError(status: number, error: string) {
  return Object.assign(new Error(error), { status, body: { error } });
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw httpError(413, 'body_too_large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const PLACEHOLDER = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Tombola · overlay</title>
<meta name="color-scheme" content="dark"><style>html,body{margin:0;background:transparent;color:#93a0b2;font:16px system-ui}p{position:absolute;top:56px;right:56px;margin:0}</style></head>
<body><p>Overlay Tombola : page en cours de portage (phase F).</p></body></html>`;
