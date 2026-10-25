import { randomUUID } from 'node:crypto';
import { EffectError, type EffectsPlayer } from '../effects/player.js';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Roue du Sub in Studio (docs/SUB_WHEEL.md). Core decides (one spin per sub / resub / Prime, segment drawn and gain
// recorded before any animation) and orders the wheels after their sub alert; Studio only shows each recorded spin on
// the effects player (one OBS browser source, no reload), one at a time, then reports. A wheel Studio cannot show
// never draws again nor changes the gain. No economy here: the gains are Core's records.

const POLL_MS = 500;

export interface SubWheelRuntimeDeps {
  core: LabCoreCall;
  environment: 'lab' | 'production';
  channelId: string;
  effects: EffectsPlayer | null;
  pollMs?: number;
}

type Spin = {
  spin_id: string;
  name: string;
  type: 'sub' | 'resub';
  tier: 1 | 2 | 3;
  months: number;
  layout: { val: number; mult: number }[];
  segment: number;
  amount: number;
};

export class SubWheelRuntime {
  private readonly consumer = `studio-sw-${randomUUID().slice(0, 8)}`;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  lastError: string | null = null;

  constructor(private readonly d: SubWheelRuntimeDeps) {}

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/sub-wheel'
      : '/v1/lab/sub-wheel';
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

  /** One recorded spin if Core has one ready: shown to its end, then reported. */
  async once(): Promise<boolean> {
    const { spin } = await this.d.core<{ spin: Spin | null }>(
      `${this.base}/${this.d.channelId}/animations/claim`,
      { consumer_id: this.consumer },
    );
    if (!spin) return false;
    let event: 'completed' | 'failed' | 'unknown' = 'failed';
    let error: string | undefined;
    try {
      if (!this.d.effects) throw new EffectError('effects_player_unavailable');
      const { end } = await this.d.effects.play({
        kind: 'wheel',
        spin: {
          name: spin.name,
          type: spin.type,
          tier: spin.tier,
          months: spin.months,
          layout: spin.layout,
          segment: spin.segment,
          amount: spin.amount,
        },
      });
      const r = await end;
      event = r.event;
      error = r.error;
    } catch (e) {
      error = e instanceof EffectError ? e.message : 'erreur inattendue';
    }
    await this.d
      .core(`${this.base}/spins/${spin.spin_id}/animation`, {
        consumer_id: this.consumer,
        event,
        ...(error ? { error: error.slice(0, 200) } : {}),
      })
      .catch(() => {});
    return true;
  }

  /** /api/sub-wheel/* (origin-checked by the channel points runtime). */
  async api(
    method: string,
    path: string,
    body: () => Promise<Record<string, unknown>>,
  ) {
    const ch = `${this.base}/${this.d.channelId}`;
    if (method === 'GET' && path === '/state') {
      const effects = this.d.effects;
      // V2 (R4): the rights not drawn yet and the « Possible doublon » pairs travel with the state (one refresh).
      // The V2 reads: a Core without the V2 yet (an older Core, e.g. production before its update) answers 404 —
      // the V1 section keeps working and says so; any other failure stays an error.
      const v2 = <T>(path: string) =>
        this.d.core<T>(path).catch((e: { status?: number }) => {
          if (e.status === 404) return null;
          throw e;
        });
      const [state, rights, duplicates, detections] = await Promise.all([
        this.d.core<Record<string, unknown>>(`${ch}/state`),
        v2<unknown[]>(`${ch}/rights`),
        v2<unknown[]>(`${ch}/possible-duplicates`),
        v2<unknown[]>(`${ch}/subscription-detections`),
      ]);
      // Lab Core: the simulators' state (presence readings, viewers) travels with it too.
      const lab =
        this.d.environment === 'lab' &&
        (state.settings as { lab?: boolean } | undefined)?.lab
          ? await this.d.core<unknown>(`${ch}/lab/presence`)
          : null;
      return {
        ...state,
        v2_unavailable: rights === null,
        rights: rights ?? [],
        possible_duplicates: duplicates ?? [],
        subscription_detections: detections ?? [],
        lab_sim: lab,
        animations_error: this.lastError,
        effects: effects
          ? {
              ...effects.status(),
              media: effects
                .interactionMedia()
                .filter((m) => m.id.startsWith('sw-')),
            }
          : null,
      };
    }
    if (method === 'POST' && path === '/settings')
      return this.d.core(`${ch}/settings`, await body());
    if (method === 'POST' && path === '/test')
      return this.d.core(`${ch}/test`, await body());
    // V2 (R3 / R4): the Core checks the permissions (Studio = the broadcaster) and journals every decision.
    if (method === 'POST' && path === '/mode')
      return this.d.core(`${ch}/mode`, await body());
    if (method === 'POST' && path === '/grant')
      return this.d.core(`${ch}/grant`, await body());
    if (method === 'POST' && path === '/invitations')
      return this.d.core(`${ch}/invitations`, await body());
    if (method === 'POST' && path === '/announce-delay')
      return this.d.core(`${ch}/announce-delay`, await body());
    // Lab simulators only (never relayed by a production Studio): presence readings, Twitch subscriptions, the live.
    if (this.d.environment === 'lab' && method === 'POST') {
      if (path === '/lab/presence')
        return this.d.core(`${ch}/lab/presence`, await body());
      if (path === '/lab/simulate')
        return this.d.core(`${ch}/lab/simulate`, await body());
      if (path === '/lab/live') {
        const on = (await body()).on === true;
        return this.d.core(`/v1/lab/raffle/${this.d.channelId}/actions`, {
          actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
          command: {
            action: on ? 'stream_start' : 'stream_end',
            reason: 'Roue du Sub — simulateur Lab',
          },
        });
      }
    }
    const request = /^\/spins\/([0-9a-f-]{36})\/request$/.exec(path);
    if (method === 'POST' && request)
      return this.d.core(`${this.base}/spins/${request[1]}/request`, {});
    const review = /^\/reviews\/(\d{1,18})\/resolve$/.exec(path);
    if (method === 'POST' && review)
      return this.d.core(
        `${this.base}/reviews/${review[1]}/resolve`,
        await body(),
      );
    const award = /^\/spins\/([0-9a-f-]{36})\/award$/.exec(path);
    if (method === 'POST' && award)
      return this.d.core(`${this.base}/spins/${award[1]}/award`, await body());
    throw Object.assign(new Error('not_found'), { status: 404 });
  }
}
