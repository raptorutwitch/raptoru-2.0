import { randomUUID } from 'node:crypto';
import type { RandomBanAnimationId } from '@raptoru/schemas';
import type { MuteHolds } from '../channel-points/mute-holds.js';
import type { MuteController } from '../votekick/mute-controller.js';
import type { ObsLike } from '../channel-points/obs-actions.js';
import { EffectError, type EffectsPlayer } from '../effects/player.js';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Random Ban V2 in Studio (docs/RANDOM_BAN_V2.md). Studio never touches Twitch here: Core holds the requests and the
// Twitch executor (bot) times out; Studio only shows the animation Core hands out once the result is known (a
// confirmed timeout, a flop, a dry run / test) — on the effects player (one OBS browser source, no reload), one at a
// time, then reports how it went. An animation Studio cannot show (player absent…) never undoes a timeout.
// V3 (27/10): the streamer drawn → Studio plays Votekick's MUTED scene in OBS (zoom, MUTED band, drive, mic — the same
// MuteController and OBS items, no vote), as another owner of that scene: a Votekick mute running too keeps it until
// both end, and each one holds the mic under its own name (shared MuteHolds). Studio tells Core, and ends its part when
// the mute is over or when Core no longer lists it as running (a paid caution ended it). It says at each poll whether
// it could mute now (OBS connected, mic held by nobody): Core never draws the streamer otherwise.

const POLL_MS = 500;

export interface RandomBanRuntimeDeps {
  core: LabCoreCall;
  environment: 'lab' | 'production';
  channelId: string;
  effects: EffectsPlayer | null;
  /** V3: the streamer's mic (absent: Studio never offers to mute him). */
  mic?: {
    input: string;
    holds: MuteHolds;
    obs: () => ObsLike | null;
    /** Votekick's MUTED scene (zoom, band, drive, mic), shared. */
    fx: Pick<MuteController, 'muteStart' | 'muteEnd' | 'has' | 'owners'>;
  };
  now?: () => number;
  pollMs?: number;
}

const HOLD_PREFIX = 'random_ban:';

export class RandomBanRuntime {
  private readonly consumer = `studio-rb-${randomUUID().slice(0, 8)}`;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  lastError: string | null = null;
  /** V3: the last failure of the streamer's mute poll (Core or OBS). */
  muteError: string | null = null;

  constructor(private readonly d: RandomBanRuntimeDeps) {}

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/random-ban'
      : '/v1/lab/random-ban';
  }

  /**
   * Two independent loops (27/10): the animations (one plays up to ~11 s), and the streamer's mute with Studio's
   * « ready » signal — every 500 ms whatever plays, so a long animation never makes the streamer look absent to Core
   * (studioReadyMs) nor delays his mute.
   */
  start() {
    const loop = (
      run: () => Promise<boolean>,
      onError: (e: Error | null) => void,
      set: (t: ReturnType<typeof setTimeout>) => void,
    ) => {
      const tick = async () => {
        if (this.stopped) return;
        let worked = false;
        try {
          worked = await run();
          onError(null);
        } catch (e) {
          onError(e as Error);
        }
        const t = setTimeout(
          () => void tick(),
          worked ? 0 : (this.d.pollMs ?? POLL_MS),
        );
        t.unref?.();
        set(t);
      };
      void tick();
    };
    loop(
      () => this.animationOnce(),
      (e) => (this.lastError = e?.message ?? null),
      (t) => (this.timer = t),
    );
    if (this.d.mic)
      loop(
        () => this.muteOnce(),
        (e) => (this.muteError = e?.message ?? null),
        (t) => (this.muteTimer = t),
      );
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.muteTimer) clearTimeout(this.muteTimer);
  }

  /**
   * V3: tells Core whether the streamer could be muted now; starts the mute Core hands out (one at a time); releases
   * the holds of the mutes Core no longer lists as running. True when a mute was started (or failed to).
   */
  async muteOnce(): Promise<boolean> {
    const m = this.d.mic;
    if (!m) return false;
    const { mute, active } = await this.d.core<{
      mute: {
        request_id: string;
        attempt_id: string;
        seconds: number;
      } | null;
      active: { request_id: string; ends_at: string }[];
    }>(`${this.base}/${this.d.channelId}/mutes/claim`, {
      consumer_id: this.consumer,
      obs_ready: !!m.obs()?.connected,
      mic_held: m.holds.holders(m.input).length > 0,
    });
    const running = new Set(active.map((a) => HOLD_PREFIX + a.request_id));
    for (const owner of m.fx.owners())
      if (owner.startsWith(HOLD_PREFIX) && !running.has(owner))
        await m.fx.muteEnd(owner, 'expired');
    // A bare mic hold left by Studio 0.1.11 (before the scene): released the same way.
    for (const owner of m.holds.holders(m.input))
      if (owner.startsWith(HOLD_PREFIX) && !running.has(owner))
        await m.holds.release(m.input, owner);
    if (!mute) return false;
    const owner = HOLD_PREFIX + mute.request_id;
    let error: string | null = null;
    try {
      await m.fx.muteStart(owner, mute.seconds);
      // A scene still being restored never takes a new owner: not muted.
      if (!m.fx.has(owner))
        throw new Error('scène MUTED en cours de restauration');
    } catch (e) {
      error = (e as Error).message || 'obs';
    }
    try {
      const r = await this.d.core<{ status: string }>(
        `${this.base}/requests/${mute.request_id}/mute`,
        {
          consumer_id: this.consumer,
          attempt_id: mute.attempt_id,
          event: error ? 'failed' : 'muted',
          ...(error ? { error: error.slice(0, 200) } : {}),
        },
      );
      if (!error && r.status !== 'confirmed')
        await m.fx.muteEnd(owner, 'expired');
    } catch {
      // Core never heard of this mute: never kept (it would be a mute nobody can pay to end).
      if (!error) await m.fx.muteEnd(owner, 'expired');
    }
    return true;
  }

  /** One step of both loops (tests): the mute poll, then one animation. */
  async once(): Promise<boolean> {
    let muted = false;
    try {
      muted = await this.muteOnce();
      this.muteError = null;
    } catch (e) {
      this.muteError = (e as Error).message;
    }
    return (await this.animationOnce()) || muted;
  }

  /** One animation if Core has one: played to its end on the effects player, then reported. */
  async animationOnce(): Promise<boolean> {
    const { animation: a } = await this.d.core<{
      animation: {
        request_id: string;
        animation: RandomBanAnimationId;
        trigger: string;
        banned: string | null;
      } | null;
    }>(`${this.base}/${this.d.channelId}/animations/claim`, {
      consumer_id: this.consumer,
    });
    if (!a) return false;
    let event: 'completed' | 'failed' | 'unknown' = 'failed';
    let error: string | undefined;
    try {
      if (!this.d.effects) throw new EffectError('effects_player_unavailable');
      const { end } = await this.d.effects.play(
        a.animation === 'flop'
          ? { kind: 'flop', trigger: a.trigger }
          : {
              kind: 'ban',
              animation: a.animation,
              trigger: a.trigger,
              banned: a.banned ?? '',
            },
      );
      const r = await end;
      event = r.event;
      error = r.error;
    } catch (e) {
      error = e instanceof EffectError ? e.message : 'erreur inattendue';
    }
    await this.d
      .core(`${this.base}/requests/${a.request_id}/animation`, {
        consumer_id: this.consumer,
        event,
        ...(error ? { error: error.slice(0, 200) } : {}),
      })
      .catch(() => {});
    return true;
  }

  /** /api/random-ban/* (already origin-checked by the channel points runtime). */
  async api(
    method: string,
    path: string,
    body: () => Promise<Record<string, unknown>>,
  ) {
    const ch = `${this.base}/${this.d.channelId}`;
    if (method === 'GET' && path === '/state') {
      const effects = this.d.effects;
      return {
        ...(await this.d.core<Record<string, unknown>>(`${ch}/state`)),
        animations_error: this.lastError,
        mute_error: this.muteError,
        mic: this.d.mic
          ? {
              input: this.d.mic.input,
              obs_connected: !!this.d.mic.obs()?.connected,
              held_by: this.d.mic.holds.holders(this.d.mic.input),
            }
          : null,
        effects: effects
          ? {
              ...effects.status(),
              media: effects
                .interactionMedia()
                .filter((m) => m.id.startsWith('rb-')),
            }
          : null,
      };
    }
    if (method === 'POST' && path === '/test')
      return this.d.core(`${ch}/test`, await body());
    if (method === 'POST' && path === '/test-streamer-mute')
      return this.d.core(`${ch}/test-streamer-mute`, {});
    throw Object.assign(new Error('not_found'), { status: 404 });
  }
}
