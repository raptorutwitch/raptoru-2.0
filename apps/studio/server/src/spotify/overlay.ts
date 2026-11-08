import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

// Music Hub V2 — the music card of the OBS overlay (docs/music/MUSIC_HUB_STATE.md § Overlay). Not a second alert
// system nor a player: a brief card (title, artist, requester) handed to the EFFECTS PLAYER (the OBS source « Effets »,
// effects/player.ts, kind `music`), like Random Ban's flop or the Sub Wheel. It never plays the music itself; only an
// optional short alert sound of the effects catalogue (or imported), at its own volume.
// - The setting lives in Studio (<spotify dir>/music-overlay.json). Off by default.
// - What it shows comes from Core's Spotify state (the queue, the request playing), read every few seconds ONLY while
//   the overlay is on: a request newly queued → « Nouvelle demande »; a request starting → « À l'écoute » (option).
// - Once per request and event, never late: the first reading after a start, or after a gap without Core, only notes
//   what is there (no burst of old cards). Cards wait their turn (one on screen at a time, a short backlog).
// - A card that cannot be shown (player absent, muted…) is logged; the requests never depend on it.

export const MusicOverlayConfig = z.strictObject({
  enabled: z.boolean(),
  /** A card when a request enters the queue. */
  on_request: z.boolean(),
  /** A card when a request starts playing. */
  on_start: z.boolean(),
  /** An effect sound of the catalogue, or an imported one (`upload:<sha256>.<ext>`); null: silent card. */
  sound: z
    .string()
    .regex(/^(upload:[a-f0-9]{64}\.(mp3|wav|ogg)|[a-z0-9][a-z0-9-]{0,63})$/)
    .nullable(),
  sound_name: z.string().max(80).nullable(),
  /** 0–100 % of the sound file's level. */
  volume: z.number().int().min(0).max(100),
  /** How long the card stays (seconds). */
  duration_s: z.number().int().min(3).max(15),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
});
export type MusicOverlayConfig = z.infer<typeof MusicOverlayConfig>;

export const MUSIC_OVERLAY_DEFAULT: MusicOverlayConfig = {
  enabled: false,
  on_request: true,
  on_start: false,
  sound: null,
  sound_name: null,
  volume: 60,
  duration_s: 6,
  position: 'top-right',
};

/** Without a successful reading of Core for longer than this, what is seen next is noted, never shown late. */
export const FOLLOW_GAP_MS = 10_000;
const BACKLOG = 4;

export interface MusicCard {
  event: 'request' | 'start';
  title: string;
  artists: string[];
  requested_by: string | null;
}

/** What the overlay needs from the effects player (effects/player.ts). */
export interface MusicCardPlayer {
  play(effect: {
    kind: 'music';
    card: MusicCard;
    sound: string | null;
    volume: number;
    duration_ms: number;
    position: MusicOverlayConfig['position'];
  }): Promise<{ end: Promise<unknown> }>;
}

/** The part of Core's Spotify state (studio route) the overlay reads. */
interface Req {
  request_id: string;
  state: string;
  track: { title: string; artists: string[] } | null;
  viewer?: { name?: string } | null;
}
export interface MusicStateView {
  queue?: Req[];
  current?: Req | null;
}

export class MusicOverlay {
  private cfg: MusicOverlayConfig = { ...MUSIC_OVERLAY_DEFAULT };
  private readonly seen = new Set<string>();
  private lastFollowAt: number | null = null;
  private readonly waiting: MusicCard[] = [];
  private showing = false;

  private constructor(
    private readonly file: string,
    private readonly player: MusicCardPlayer | null,
    private readonly log: (line: string) => void,
    private readonly now: () => number,
  ) {}

  static async open(
    file: string,
    player: MusicCardPlayer | null,
    log: (line: string) => void = () => {},
    now: () => number = Date.now,
  ) {
    const o = new MusicOverlay(file, player, log, now);
    try {
      const saved = MusicOverlayConfig.safeParse(
        JSON.parse(await readFile(file, 'utf8')),
      );
      if (saved.success) o.cfg = saved.data;
      else log('[musique] réglage de l’overlay illisible : ignoré');
    } catch {
      /* never saved: off */
    }
    return o;
  }

  get config(): MusicOverlayConfig {
    return { ...this.cfg };
  }

  /** Whether Core's state must be read for the overlay (on, with at least one kind of card). */
  get following() {
    return this.cfg.enabled && (this.cfg.on_request || this.cfg.on_start);
  }

  get available() {
    return this.player !== null;
  }

  /** Saved first, then used (a failed write keeps the previous setting and throws). */
  async save(next: unknown) {
    const cfg = MusicOverlayConfig.parse(next);
    const tmp = `${this.file}.tmp`;
    await mkdir(dirname(this.file), { recursive: true }); // the module's folder may not exist yet
    await writeFile(tmp, JSON.stringify(cfg, null, 2));
    await rename(tmp, this.file);
    const wasFollowing = this.following;
    this.cfg = cfg;
    if (!wasFollowing && this.following) this.lastFollowAt = null; // switched on: note first, never a late card
    return this.config;
  }

  /** A successful reading of Core's Spotify state: the new requests and the one starting, each shown once. */
  observe(state: MusicStateView) {
    const now = this.now();
    const live =
      this.lastFollowAt !== null && now - this.lastFollowAt <= FOLLOW_GAP_MS;
    this.lastFollowAt = now;
    const cards: MusicCard[] = [];
    const note = (key: string, card: MusicCard | null) => {
      if (this.seen.has(key)) return;
      this.seen.add(key);
      if (this.seen.size > 400)
        this.seen.delete(this.seen.values().next().value!);
      if (live && card) cards.push(card);
    };
    const card = (r: Req, event: MusicCard['event']): MusicCard | null =>
      r.track
        ? {
            event,
            title: r.track.title.slice(0, 120),
            artists: r.track.artists.slice(0, 4).map((a) => a.slice(0, 60)),
            requested_by: r.viewer?.name?.slice(0, 40) ?? null,
          }
        : null;
    for (const r of state.queue ?? [])
      if (r.track && (r.state === 'QUEUED' || r.state === 'UNKNOWN'))
        note(
          `req:${r.request_id}`,
          this.cfg.on_request ? card(r, 'request') : null,
        );
    const cur = state.current;
    if (cur?.track && cur.state === 'PLAYING') {
      // A request seen for the first time while already playing: its « request » card is never shown late.
      this.seen.add(`req:${cur.request_id}`);
      note(
        `start:${cur.request_id}`,
        this.cfg.on_start ? card(cur, 'start') : null,
      );
    }
    if (!this.cfg.enabled) return;
    for (const c of cards) this.enqueue(c);
  }

  /** « Prévisualiser »: a sample card now, through the same path. */
  async preview() {
    if (!this.player)
      throw Object.assign(new Error('effects_unavailable'), { status: 503 });
    await this.player.play(
      this.effect({
        event: 'request',
        title: 'Néon Sauvage (Remix)',
        artists: ['Lune Rouge', 'DJ Orbite'],
        requested_by: 'Viewer_Lab',
      }),
    );
    return { shown: true };
  }

  private effect(card: MusicCard) {
    return {
      kind: 'music' as const,
      card,
      sound: this.cfg.sound,
      volume: this.cfg.volume,
      duration_ms: this.cfg.duration_s * 1000,
      position: this.cfg.position,
    };
  }

  private enqueue(c: MusicCard) {
    this.waiting.push(c);
    while (this.waiting.length > BACKLOG) this.waiting.shift(); // a burst: the latest ones, never a long tail
    void this.drain();
  }

  private async drain() {
    if (this.showing || !this.player) return;
    this.showing = true;
    try {
      while (this.waiting.length) {
        const c = this.waiting.shift()!;
        try {
          const { end } = await this.player.play(this.effect(c));
          await end;
          this.log(
            `[musique] carte ${c.event === 'start' ? 'à l’écoute' : 'nouvelle demande'} : ${c.title}`,
          );
        } catch (e) {
          this.log(`[musique] carte non affichée : ${(e as Error).message}`);
        }
      }
    } finally {
      this.showing = false;
    }
  }

  /** Tests: cards waiting to be shown. */
  get backlog() {
    return this.waiting.length;
  }
}
