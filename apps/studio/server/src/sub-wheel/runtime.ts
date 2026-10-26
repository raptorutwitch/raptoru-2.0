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
  /**
   * Why no wheel is asked from Core right now although the player page exists (null: nothing in the way). A wheel is
   * drawn — and credited — by Core when it is CLAIMED: Studio claims only when the player can really play it.
   */
  waiting: string | null = null;
  /**
   * The end of a wheel Core did not receive (unreachable, restarting): sent again before anything else is claimed — Core
   * keeps that wheel « en cours » meanwhile, then « À vérifier »; this report settles it.
   */
  private unsent: { spinId: string; body: Record<string, unknown> } | null =
    null;
  /** Lab simulator only: the next wheel is taken by a page that never starts it (as `effect_start_timeout`). */
  private failNextStart = false;

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

  /** Why the player could not play a wheel now (null: it can): checked BEFORE Core decides anything. */
  private unplayable(): string | null {
    const fx = this.d.effects?.status();
    if (!fx) return 'effects_player_unavailable';
    if (!fx.connected) return 'effects_player_offline';
    if (!fx.audio) return 'effects_player_muted';
    if (!fx.current) return 'effects_player_outdated';
    // The wheel's two sounds: without them every wheel would fail the same way.
    if (
      this.d
        .effects!.interactionMedia()
        .some((m) => m.id.startsWith('sw-') && !m.available)
    )
      return 'effect_media_missing';
    return null;
  }

  /** The end of a wheel to Core: kept and sent again while Core cannot take it; an answer (even a refusal) ends it. */
  private async report(spinId: string, body: Record<string, unknown>) {
    const send = (b: Record<string, unknown>) =>
      this.d.core(`${this.base}/spins/${spinId}/animation`, b);
    try {
      await send(body).catch(async (e: { status?: number }) => {
        // A Core older than « started » refuses the field (400): the same report without it.
        if (e.status !== 400 || !('started' in body)) throw e;
        const older = { ...body };
        delete older.started;
        await send(older);
      });
      this.unsent = null;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== undefined && status < 500) {
        this.unsent = null; // Core answered (another player had it, unknown wheel…): nothing to send again
        return;
      }
      this.unsent = { spinId, body };
      throw e;
    }
  }

  /** One recorded spin if Core has one ready AND the player can play it: shown to its end, then reported. */
  async once(): Promise<boolean> {
    if (this.unsent) await this.report(this.unsent.spinId, this.unsent.body);
    // A connected page whose sound is blocked (a browser tab never clicked), offline or outdated would turn the next
    // right into a paid draw nobody sees: nothing is claimed — the rights wait, undecided.
    this.waiting = this.unplayable();
    if (this.waiting) return false;
    const { spin } = await this.d.core<{ spin: Spin | null }>(
      `${this.base}/${this.d.channelId}/animations/claim`,
      { consumer_id: this.consumer },
    );
    if (!spin) return false;
    let event: 'completed' | 'failed' | 'unknown' = 'failed';
    let error: string | undefined;
    // play() resolves once the page STARTED it: before that, nothing was seen nor heard (Core shows it again by itself).
    let started = false;
    try {
      if (this.failNextStart) {
        this.failNextStart = false;
        throw new EffectError('effect_start_timeout');
      }
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
      started = true;
      const r = await end;
      event = r.event;
      error = r.error;
    } catch (e) {
      error = e instanceof EffectError ? e.message : 'erreur inattendue';
    }
    await this.report(spin.spin_id, {
      consumer_id: this.consumer,
      event,
      started,
      ...(error ? { error: error.slice(0, 200) } : {}),
    });
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
        animations_waiting: this.waiting,
        lab_fail_next_start:
          this.d.environment === 'lab' ? this.failNextStart : undefined,
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
    // RV2-2 « Droits »: viewers by pseudo, one viewer's rights / draws / gains, the exceptional new draw.
    if (method === 'POST' && path === '/admin/search') {
      const q = String((await body()).q ?? '').slice(0, 64);
      return this.d.core(`${ch}/admin/viewers?q=${encodeURIComponent(q)}`);
    }
    const viewer = /^\/admin\/viewers\/(\d{1,32})$/.exec(path);
    if (method === 'GET' && viewer)
      return this.d.core(`${ch}/admin/viewers/${viewer[1]}`);
    if (method === 'POST' && path === '/redraw')
      return this.d.core(`${ch}/redraw`, await body());
    // Lab simulators only (never relayed by a production Studio): presence readings, Twitch subscriptions, the live.
    if (this.d.environment === 'lab' && method === 'POST') {
      if (path === '/lab/fail-next-start') {
        this.failNextStart = (await body()).on !== false;
        return { on: this.failNextStart };
      }
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
    const replay = /^\/spins\/([0-9a-f-]{36})\/replay$/.exec(path);
    if (method === 'POST' && replay)
      return this.d.core(`${this.base}/spins/${replay[1]}/replay`, {});
    const seen = /^\/spins\/([0-9a-f-]{36})\/confirm-shown$/.exec(path);
    if (method === 'POST' && seen)
      return this.d.core(`${this.base}/spins/${seen[1]}/confirm-shown`, {});
    const award = /^\/spins\/([0-9a-f-]{36})\/award$/.exec(path);
    if (method === 'POST' && award)
      return this.d.core(`${this.base}/spins/${award[1]}/award`, await body());
    throw Object.assign(new Error('not_found'), { status: 404 });
  }
}
