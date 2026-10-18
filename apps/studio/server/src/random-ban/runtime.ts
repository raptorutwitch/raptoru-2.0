import { randomUUID } from 'node:crypto';
import type { RandomBanAnimationId } from '@raptoru/schemas';
import { EffectError, type EffectsPlayer } from '../effects/player.js';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Random Ban V2 in Studio (docs/RANDOM_BAN_V2.md). Studio never touches Twitch here: Core holds the requests and the
// Twitch executor (bot) times out; Studio only shows the animation Core hands out once the result is known (a
// confirmed timeout, a flop, a dry run / test) — on the effects player (one OBS browser source, no reload), one at a
// time, then reports how it went. An animation Studio cannot show (player absent…) never undoes a timeout.

const POLL_MS = 500;

export interface RandomBanRuntimeDeps {
  core: LabCoreCall;
  environment: 'lab' | 'production';
  channelId: string;
  effects: EffectsPlayer | null;
  pollMs?: number;
}

export class RandomBanRuntime {
  private readonly consumer = `studio-rb-${randomUUID().slice(0, 8)}`;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  lastError: string | null = null;

  constructor(private readonly d: RandomBanRuntimeDeps) {}

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/random-ban'
      : '/v1/lab/random-ban';
  }

  start() {
    const loop = async () => {
      if (this.stopped) return;
      let worked = false;
      try {
        worked = await this.once();
        this.lastError = null;
      } catch (e) {
        this.lastError = (e as Error).message;
      }
      this.timer = setTimeout(
        () => void loop(),
        worked ? 0 : (this.d.pollMs ?? POLL_MS),
      );
      this.timer.unref?.();
    };
    void loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One animation if Core has one: played to its end on the effects player, then reported. */
  async once(): Promise<boolean> {
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
    throw Object.assign(new Error('not_found'), { status: 404 });
  }
}
