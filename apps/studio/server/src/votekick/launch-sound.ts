import { readFile, rename, writeFile } from 'node:fs/promises';
import type { VotekickOverlayEvent } from '@raptoru/schemas';
import { z } from 'zod';

// Votekick V2 — the launch sound (Studio only, docs/VOTEKICK_V2.md): played ONCE when a vote is really open, through
// the effects player (the OBS source « Effets », the stream's sound effects), never a second audio system.
// - The setting lives in Studio (<channel-points dir>/votekick-launch-sound.json): what plays the sound is here; the
//   vote itself is Core's. No sound by default.
// - « Really open »: Core's overlay event is `live` only for an accepted, open vote (a refused `!votekick` never is).
// - Once: one play per vote id (`session`), whatever its updates (votes, seq), the overlay reloading or a Studio
//   restart: the first look after a start, or after more than FOLLOW_GAP_MS without Core, only notes the vote
//   (never a late sound).
// - A sound that cannot play (player absent, file missing…) is logged; the vote never depends on it.

/** Without a successful follow-up of Core for longer than this, the next vote seen is noted, not sounded. */
export const FOLLOW_GAP_MS = 5_000;

export const LaunchSoundConfig = z.strictObject({
  enabled: z.boolean(),
  /** An effect sound of the catalogue, or a sound imported in Studio (`upload:<sha256>.<ext>`); null: none. */
  sound: z
    .string()
    .regex(/^(upload:[a-f0-9]{64}\.(mp3|wav|ogg)|[a-z0-9][a-z0-9-]{0,63})$/)
    .nullable(),
  /** The name shown for an imported sound (display only). */
  sound_name: z.string().max(80).nullable(),
  /** 0–100 % of the file's level. */
  volume: z.number().int().min(0).max(100),
});
export type LaunchSoundConfig = z.infer<typeof LaunchSoundConfig>;

export const LAUNCH_SOUND_DEFAULT: LaunchSoundConfig = {
  enabled: false,
  sound: null,
  sound_name: null,
  volume: 80,
};

/** What the launch sound needs from the effects player (effects/player.ts). */
export interface LaunchSoundPlayer {
  play(effect: { kind: 'sound'; id: string; volume: number }): Promise<unknown>;
}

export class VotekickLaunchSound {
  private cfg: LaunchSoundConfig = { ...LAUNCH_SOUND_DEFAULT };
  private readonly seen: string[] = [];
  private lastFollowAt: number | null = null;

  private constructor(
    private readonly file: string,
    private readonly player: LaunchSoundPlayer | null,
    private readonly log: (line: string) => void,
    private readonly now: () => number,
  ) {}

  /** Reads the saved setting (missing or unreadable: no sound). */
  static async open(
    file: string,
    player: LaunchSoundPlayer | null,
    log: (line: string) => void = () => {},
    now: () => number = Date.now,
  ) {
    const s = new VotekickLaunchSound(file, player, log, now);
    try {
      const saved = LaunchSoundConfig.safeParse(
        JSON.parse(await readFile(file, 'utf8')),
      );
      if (saved.success) s.cfg = saved.data;
      else log('[votekick] réglage du son de lancement illisible : ignoré');
    } catch {
      /* never saved: no sound */
    }
    return s;
  }

  get config(): LaunchSoundConfig {
    return { ...this.cfg };
  }

  /** Saved first, then used (a failed write keeps the previous setting and throws). */
  async save(next: unknown) {
    const cfg = LaunchSoundConfig.parse(next);
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(cfg, null, 2));
    await rename(tmp, this.file);
    this.cfg = cfg;
    return this.config;
  }

  /** Every successful follow-up of Core: a vote newly open (and followed live) is sounded once. */
  onEvent(event: VotekickOverlayEvent) {
    const now = this.now();
    const following =
      this.lastFollowAt !== null && now - this.lastFollowAt <= FOLLOW_GAP_MS;
    this.lastFollowAt = now;
    if (event.action !== 'live' || !event.session) return;
    if (this.seen.includes(event.session)) return;
    this.seen.push(event.session);
    if (this.seen.length > 100) this.seen.shift();
    if (!following) return; // just started, or back after a gap: never a late sound
    void this.play(event.session);
  }

  private async play(vote: string) {
    const { enabled, sound, volume } = this.cfg;
    if (!enabled || !sound || !this.player) return;
    try {
      await this.player.play({ kind: 'sound', id: sound, volume });
      this.log(`[votekick] son de lancement joué (${vote})`);
    } catch (e) {
      this.log(
        `[votekick] son de lancement non joué : ${(e as Error).message}`,
      );
    }
  }
}
