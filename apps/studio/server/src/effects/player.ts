import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { EFFECT_SOUNDS, EFFECT_VIDEOS } from '@raptoru/schemas';
import type { AlertMediaStore } from '../alerts/media-store.js';

// Effects player (P0.1, docs/EFFECTS_PLAYER.md) — Studio's native capability to play an effect at once on ONE local
// page (OBS browser source), outside the Soundboard: no queue, no price, no cooldown, effects overlap. Effect sounds
// (EFFECT_SOUNDS) and full-frame effect videos with their legacy presentation (EFFECT_VIDEOS, P0.2), media in Studio's
// storage. Studio hands each effect to the page that asks
// first (never two pages), waits for its `started`, then follows its end. Nothing is ever replayed: an effect not taken
// by a page within PICKUP_MS fails (player absent); one started whose end never comes is « unknown »; the hand-overs
// live in memory only (a Studio restart drops them).

export const EFFECTS_RULES = {
  /** A page that did not call within this delay is gone. */
  heartbeatMs: 4000,
  /** An effect no page took within this delay fails: player absent. */
  pickupMs: 2000,
  /** Taken, never started (blocked, unreadable). */
  startMs: 6000,
  /** Started, no end reported (page closed…): unknown. */
  endMs: 120_000,
  /** Effects playing at once (beyond: refused, never queued). */
  maxActive: 8,
} as const;

/** Readable codes (Studio tab): see channel-points-view.ts. */
export class EffectError extends Error {}

export type EffectEnd = {
  event: 'completed' | 'failed' | 'unknown';
  error?: string;
};

/** What the page needs to present a video as its legacy overlay did (catalogue entry). */
type Presentation = {
  mirror: number;
  rise: boolean;
  ducking: { audible: number; step: number; min: number };
};

interface Delivery {
  delivery_id: string;
  kind: 'sound' | 'video';
  /** Catalogue id (the page groups the plays of one video for its ducking). */
  effect_id: string;
  label: string;
  url: string;
  /** 0-1 */
  volume: number;
  presentation: Presentation | null;
  player: string | null;
  started: boolean;
  onStart: (ok: true | EffectError) => void;
  onEnd: (end: EffectEnd) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const PLAYER_FILES: Record<string, string> = {
  'player.html': 'text/html; charset=utf-8',
  'player.js': 'text/javascript; charset=utf-8',
};
const MEDIA_TYPES: Record<string, string> = {
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.webm': 'video/webm',
};

/** One catalogue (sounds and videos share the media route: ids are unique across both). */
const CATALOGUE: {
  kind: 'sound' | 'video';
  id: string;
  label: string;
  file: string;
}[] = [
  ...EFFECT_SOUNDS.map((s) => ({
    kind: 'sound' as const,
    id: s.id,
    label: s.label,
    file: s.file,
  })),
  ...EFFECT_VIDEOS.map((v) => ({
    kind: 'video' as const,
    id: v.id,
    label: v.label,
    file: v.file,
  })),
];
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'self'";

export interface EffectsPlayerDeps {
  /** Studio storage of the module (the OBS source token). */
  dir: string;
  origin: string;
  /** Effect media (imported copies). */
  media: AlertMediaStore;
  playerDir: string;
  now?: () => number;
  /** Tests only: shorter delays. */
  rules?: Partial<typeof EFFECTS_RULES>;
}

export class EffectsPlayer {
  private readonly deliveries = new Map<string, Delivery>();
  private page: { player: string; at: number; audio: boolean } | null = null;

  private constructor(
    private readonly d: EffectsPlayerDeps,
    private readonly token: string,
  ) {}

  static async create(d: EffectsPlayerDeps) {
    // The OBS source URL carries this token: kept across restarts (the source never needs editing).
    const file = join(d.dir, 'player-token');
    let token = '';
    try {
      token = (await readFile(file, 'utf8')).trim();
    } catch {
      /* first run */
    }
    if (!/^[a-f0-9]{32}$/.test(token)) {
      token = randomBytes(16).toString('hex');
      await writeFile(file, token);
    }
    return new EffectsPlayer(d, token);
  }

  private get rules() {
    return { ...EFFECTS_RULES, ...this.d.rules };
  }

  private now() {
    return (this.d.now ?? Date.now)();
  }

  get url() {
    return `${this.d.origin}/effects/player.html#${this.token}`;
  }

  /** The page as Studio sees it (Studio tab). */
  status() {
    const connected =
      this.page !== null && this.now() - this.page.at < this.rules.heartbeatMs;
    return {
      url: this.url,
      connected,
      audio: connected && this.page!.audio,
      playing: [...this.deliveries.values()].filter((x) => x.started).length,
    };
  }

  /** The catalogue with each sound's availability in Studio's storage. */
  sounds() {
    return EFFECT_SOUNDS.map((s) => ({
      id: s.id,
      label: s.label,
      volume: s.volume,
      available: this.d.media.path(s.file) !== null,
    }));
  }

  /** The video catalogue with each video's availability in Studio's storage. */
  videos() {
    return EFFECT_VIDEOS.map((v) => ({
      id: v.id,
      label: v.label,
      volume: v.volume,
      available: this.d.media.path(v.file) !== null,
    }));
  }

  /**
   * Plays an effect now (a sound, or a video with its legacy presentation). Resolves once the page STARTED it, with the
   * promise of its end; rejects with a readable code when it cannot start (player absent or muted, too many effects,
   * media missing, unreadable file…).
   */
  async play(effect: { kind: 'sound' | 'video'; id: string; volume: number }) {
    const item = CATALOGUE.find(
      (c) => c.kind === effect.kind && c.id === effect.id,
    );
    if (!item) throw new EffectError('effect_unknown');
    if (!this.d.media.path(item.file))
      throw new EffectError('effect_media_missing');
    const video = EFFECT_VIDEOS.find((v) => v.id === item.id);
    const presentation: Presentation | null =
      item.kind === 'video' && video
        ? {
            mirror: video.mirror,
            rise: video.rise,
            ducking: { ...video.ducking },
          }
        : null;
    const page = this.status();
    if (!page.connected) throw new EffectError('effects_player_offline');
    if (!page.audio) throw new EffectError('effects_player_muted');
    if (this.deliveries.size >= this.rules.maxActive)
      throw new EffectError('effects_busy');
    let end!: Promise<EffectEnd>;
    const started = new Promise<true | EffectError>((onStart) => {
      end = new Promise<EffectEnd>((onEnd) => {
        const x: Delivery = {
          delivery_id: randomUUID(),
          kind: item.kind,
          effect_id: item.id,
          label: item.label,
          url: `media/${item.id}`,
          volume: Math.min(100, Math.max(0, effect.volume)) / 100,
          presentation,
          player: null,
          started: false,
          onStart,
          onEnd,
          timer: null,
        };
        this.deliveries.set(x.delivery_id, x);
        this.arm(x, this.rules.pickupMs, () =>
          this.fail(x, 'effects_player_offline'),
        );
      });
    });
    const out = await started;
    if (out instanceof EffectError) throw out;
    return { end };
  }

  private arm(x: Delivery, ms: number, fn: () => void) {
    if (x.timer) clearTimeout(x.timer);
    x.timer = setTimeout(fn, ms);
    x.timer.unref?.();
  }

  /** Never started: a clean failure (nothing was heard). */
  private fail(x: Delivery, code: string) {
    if (x.timer) clearTimeout(x.timer);
    this.deliveries.delete(x.delivery_id);
    x.onStart(new EffectError(code));
    x.onEnd({ event: 'failed', error: code });
  }

  private finish(x: Delivery, end: EffectEnd) {
    if (x.timer) clearTimeout(x.timer);
    this.deliveries.delete(x.delivery_id);
    x.onEnd(end);
  }

  /** The page's report for an effect it took (only that page). */
  private report(player: string, body: Record<string, unknown>) {
    const x = this.deliveries.get(String(body.delivery_id ?? ''));
    if (!x || x.player !== player) return;
    const error =
      typeof body.error === 'string' ? body.error.slice(0, 64) : undefined;
    if (body.event === 'started' && !x.started) {
      x.started = true;
      this.arm(x, this.rules.endMs, () =>
        this.finish(x, { event: 'unknown', error: 'playback_not_confirmed' }),
      );
      x.onStart(true);
    } else if (body.event === 'completed' && x.started)
      this.finish(x, { event: 'completed' });
    else if (body.event === 'unknown' && x.started)
      this.finish(x, { event: 'unknown', error: 'playback_not_confirmed' });
    else if (body.event === 'failed') {
      if (x.started)
        this.finish(x, { event: 'failed', error: error ?? 'playback_error' });
      else this.fail(x, error ?? 'playback_error');
    }
  }

  /** Effects not taken yet, handed to this page only. */
  private take(player: string) {
    const out = [];
    for (const x of this.deliveries.values()) {
      if (x.player) continue;
      x.player = player;
      this.arm(x, this.rules.startMs, () =>
        this.fail(x, 'effect_start_timeout'),
      );
      out.push({
        delivery_id: x.delivery_id,
        kind: x.kind,
        effect_id: x.effect_id,
        label: x.label,
        url: x.url,
        volume: x.volume,
        ...(x.presentation ? { presentation: x.presentation } : {}),
      });
    }
    return out;
  }

  /** /effects/*: the page and its script, the media, the page's calls (token). */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/effects/')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (
      req.headers.host !== new URL(this.d.origin).host ||
      (req.headers.origin && req.headers.origin !== this.d.origin)
    ) {
      reply(403, { error: 'forbidden_origin' });
      return true;
    }
    const name = url.pathname.slice('/effects/'.length);
    if (req.method === 'GET' && name in PLAYER_FILES) {
      res.writeHead(200, {
        'content-type': PLAYER_FILES[name]!,
        'cache-control': 'no-store',
        'content-security-policy': CSP,
      });
      res.end(await readFile(join(this.d.playerDir, name)));
      return true;
    }
    if (req.method === 'GET' && name.startsWith('media/')) {
      const item = CATALOGUE.find((c) => c.id === name.slice(6));
      const file = item ? this.d.media.path(item.file) : null;
      if (!item || !file) {
        reply(404, { error: 'media_missing' });
        return true;
      }
      res.writeHead(200, {
        'content-type':
          MEDIA_TYPES[extname(item.file).toLowerCase()] ??
          'application/octet-stream',
        'content-length': (await stat(file)).size,
        'cache-control': 'no-store',
      });
      // Streamed (videos are a few MB).
      createReadStream(file).pipe(res);
      return true;
    }
    if (req.method !== 'POST' || !name.startsWith('player/')) {
      reply(404, { error: 'not_found' });
      return true;
    }
    if (req.headers['x-effects-token'] !== this.token) {
      reply(403, { error: 'forbidden' });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += String(chunk);
        if (raw.length > 4096) throw new Error('body_too_large');
      }
      body = JSON.parse(raw || '{}') as Record<string, unknown>;
    } catch {
      reply(400, { error: 'invalid_request' });
      return true;
    }
    const player = String(body.player ?? '');
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(player)) {
      reply(400, { error: 'invalid_player' });
      return true;
    }
    if (name === 'player/heartbeat') {
      this.page = { player, at: this.now(), audio: body.audio === true };
      reply(200, { ok: true });
    } else if (name === 'player/next') {
      if (this.page?.player === player) this.page.at = this.now();
      reply(200, { effects: this.take(player) });
    } else if (name === 'player/report') {
      this.report(player, body);
      reply(200, { ok: true });
    } else reply(404, { error: 'not_found' });
    return true;
  }
}
