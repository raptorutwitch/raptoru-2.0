import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { CpAction } from '@raptoru/schemas';
import {
  type EffectEnd,
  EffectError,
  type EffectsPlayer,
} from '../effects/player.js';
import type { LabCoreCall } from '../lab-moderation/proxy.js';
import { Brb } from '../interactions/brb.js';
import { InteractionError, Interactions } from '../interactions/creepy.js';
import { ColorCam } from '../interactions/color-cam.js';
import { FxCam } from '../interactions/fx-cam.js';
import { SOUND_MAX_BYTES } from '../raffle-lab/runtime.js';
import { RandomBanRuntime } from '../random-ban/runtime.js';
import { SpotifyRuntime } from '../spotify/runtime.js';
import { SubWheelRuntime } from '../sub-wheel/runtime.js';
import {
  MuteController,
  RAPTORU_MUTE_FX,
} from '../votekick/mute-controller.js';
import { VotekickLaunchSound } from '../votekick/launch-sound.js';
import { VotekickRuntime } from '../votekick/runtime.js';
import { ObsActionError, ObsActions, type ObsLike } from './obs-actions.js';

// Points de chaîne V1 in Studio (docs/CHANNEL_POINTS_V1.md). Core decides (master switch, rules, dedup, history);
// Studio is the control panel and the only one that touches OBS: it claims the OBS part of each redemption, runs it
// through the typed executor (obs-actions.ts) and reports per-action results. The loop runs with Studio, in both
// profiles (Lab Core or paired production Core: same sub-paths, only the base changes); nothing runs unless Core
// queued a job (switch ON, or an explicit « Tester »). Sounds are Core's (Soundboard queue). Effect sounds are played by
// Studio's effects player (effects/player.ts): reported « playing » in the job once started, their end reported after.

const MAX_BODY = 16 * 1024;
const POLL_MS = 1000;

export interface ChannelPointsRuntimeDeps {
  core: LabCoreCall;
  environment: 'lab' | 'production';
  channelId: string;
  origin: string;
  /** Studio storage for this module (pending OBS reverts). */
  dir: string;
  /** Studio's OBS connection (the Bonk's), or null when absent. */
  obs: () => ObsLike | null;
  /** Studio's effects player (effect sounds); absent → those actions fail with a readable reason. */
  effects?: EffectsPlayer | null;
  /** Twitch reception as Studio sees it (token summary, adapter). */
  twitch: () => {
    scope: boolean;
    adapter_running: boolean;
    profile_note?: string;
  };
  pollMs?: number;
  /** Votekick V2: the overlay files (apps/studio/server/votekick-overlay); absent: no Votekick in this Studio. */
  votekickOverlayDir?: string;
  /** Spotify V2: its storage; absent: no Spotify in this Studio. */
  spotifyDir?: string;
}

export class ChannelPointsRuntime {
  private readonly consumer = `studio-${randomUUID().slice(0, 8)}`;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lastError: string | null = null;
  /** Native interactions (Creepy…): on this runtime's OBS executor and effects player. */
  readonly interactions: Interactions;
  readonly brb: Brb;
  readonly fxCam: FxCam;
  readonly colorCam: ColorCam;
  /** Random Ban V2: its animations (Core + the Twitch executor decide and time out). */
  readonly randomBan: RandomBanRuntime;
  /** Roue du Sub: its animations (Core decides and records the spins). */
  readonly subWheel: SubWheelRuntime;

  private constructor(
    private readonly d: ChannelPointsRuntimeDeps,
    readonly obs: ObsActions,
    /** Votekick's MUTED scene, shared with the Random Ban streamer mute. */
    readonly muteFx: MuteController,
    /** Votekick V2: the broadcaster's mute in OBS (same OBS connection) and the overlay's live event. */
    readonly votekick: VotekickRuntime | null = null,
    /** Spotify V2: Studio is the only Spotify caller (docs/SPOTIFY_V2.md). */
    readonly spotify: SpotifyRuntime | null = null,
  ) {
    this.interactions = new Interactions({ obs, effects: d.effects ?? null });
    this.brb = new Brb({ obs, effects: d.effects ?? null });
    this.fxCam = new FxCam({ obs });
    this.colorCam = new ColorCam({ obs });
    this.subWheel = new SubWheelRuntime({
      core: d.core,
      environment: d.environment,
      channelId: d.channelId,
      effects: d.effects ?? null,
    });
    this.randomBan = new RandomBanRuntime({
      core: d.core,
      environment: d.environment,
      channelId: d.channelId,
      effects: d.effects ?? null,
      mic: {
        input: RAPTORU_MUTE_FX.micInput,
        holds: obs.holds,
        obs: d.obs,
        fx: muteFx,
      },
    });
  }

  static async create(d: ChannelPointsRuntimeDeps) {
    const obs = await ObsActions.open(join(d.dir, 'obs-reverts.json'), d.obs);
    // Votekick's MUTED scene (zoom, band, drive, mic): ONE controller, shared with the Random Ban streamer mute. Its
    // mic is a hold of the shared MuteHolds (BRB too). The mute in progress survives a Studio restart.
    const muteFx = await MuteController.open(
      join(d.dir, 'votekick-mute.json'),
      d.obs,
      RAPTORU_MUTE_FX,
      undefined,
      undefined,
      obs.holds,
    );
    return new ChannelPointsRuntime(
      d,
      obs,
      muteFx,
      d.votekickOverlayDir
        ? new VotekickRuntime({
            core: d.core,
            base:
              d.environment === 'production'
                ? '/v1/studio/votekick'
                : '/v1/lab/votekick',
            channelId: d.channelId,
            // The mute in progress survives a Studio restart (restored at the next start when due).
            mute: muteFx,
            overlayDir: d.votekickOverlayDir,
            sound: await VotekickLaunchSound.open(
              join(d.dir, 'votekick-launch-sound.json'),
              d.effects ?? null,
              (line) => console.log(line),
            ),
            effects: d.effects ?? null,
            log: (line) => console.log(line),
          })
        : null,
      d.spotifyDir
        ? await SpotifyRuntime.forProfile({
            core: d.core,
            environment: d.environment,
            channelId: d.channelId,
            dir: d.spotifyDir,
            origin: d.origin,
            log: (line) => console.log(line),
          })
        : null,
    );
  }

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/channel-points'
      : '/v1/lab/channel-points';
  }

  /** Starts with Studio: the job loop and the pending reverts (nothing happens without a job). */
  start() {
    this.obs.start();
    this.muteFx.start(); // the MUTED scene's watchdog (also without Votekick)
    this.votekick?.start();
    this.spotify?.start();
    this.randomBan.start();
    this.subWheel.start();
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
    this.obs.stop();
    this.votekick?.stop();
    this.muteFx.stop();
    this.spotify?.stop();
    this.randomBan.stop();
    this.subWheel.stop();
  }

  /** One job if Core has one: started, actions in order, per-action results, completed. Returns true if one ran. */
  async once(): Promise<boolean> {
    const { job } = await this.d.core<{
      job: {
        job_id: string;
        attempt_id: string;
        actions: { index: number; action: CpAction }[];
      } | null;
    }>(`${this.base}/${this.d.channelId}/claim`, {
      consumer_id: this.consumer,
    });
    if (!job) return false;
    const ack = (event: string, extra: object = {}) =>
      this.d.core(`${this.base}/jobs/${job.job_id}/ack`, {
        consumer_id: this.consumer,
        attempt_id: job.attempt_id,
        event,
        ...extra,
      });
    await ack('started');
    const results: {
      index: number;
      ok: boolean;
      error?: string;
      playing?: true;
    }[] = [];
    const ends: { index: number; end: Promise<EffectEnd> }[] = [];
    for (const { index, action } of job.actions) {
      try {
        if (action.type === 'effect_sound' || action.type === 'effect_video') {
          if (!this.d.effects)
            throw new EffectError('effects_player_unavailable');
          // Waits for the START only: the job ends at once, the next redemption may overlap this effect.
          const { end } = await this.d.effects.play(
            action.type === 'effect_sound'
              ? { kind: 'sound', id: action.sound_id, volume: action.volume }
              : { kind: 'video', id: action.video_id, volume: action.volume },
          );
          ends.push({ index, end });
          results.push({ index, ok: true, playing: true });
          continue;
        }
        if (action.type === 'interaction') {
          // Accepted now (it may wait for the same interaction already running); its end is reported after.
          const { end } =
            action.interaction === 'brb'
              ? this.brb.start()
              : action.interaction === 'fx_cam'
                ? this.fxCam.start(action.effect)
                : action.interaction === 'color_cam'
                  ? this.colorCam.start(action.color)
                  : this.interactions.start(action.interaction);
          ends.push({ index, end });
          results.push({ index, ok: true, playing: true });
          continue;
        }
        await this.obs.run(action);
        results.push({ index, ok: true });
      } catch (e) {
        results.push({
          index,
          ok: false,
          error: (e instanceof ObsActionError ||
          e instanceof EffectError ||
          e instanceof InteractionError
            ? e.message
            : 'erreur inattendue'
          ).slice(0, 200),
        });
      }
    }
    await ack('completed', { results });
    // The ends, after the job's report (Core needs the « playing » first); never awaited by the loop.
    for (const { index, end } of ends)
      void end.then((r) => this.reportEffect(job.job_id, index, r));
    return true;
  }

  /** The end of an effect, to Core (a few retries; Core marks it unknown if it never arrives). */
  private async reportEffect(jobId: string, index: number, r: EffectEnd) {
    for (let n = 0; n < 5; n++) {
      try {
        await this.d.core(`${this.base}/jobs/${jobId}/effects`, {
          consumer_id: this.consumer,
          index,
          event: r.event,
          ...(r.error ? { error: r.error } : {}),
        });
        return;
      } catch (e) {
        // Refused by Core (job unknown, not an effect): retrying changes nothing.
        if ((e as { status?: number }).status) return;
        await new Promise((ok) => setTimeout(ok, 500 * (n + 1)));
      }
    }
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (this.d.effects && (await this.d.effects.handle(req, res, url)))
      return true;
    if (this.votekick && (await this.votekick.handle(req, res, url)))
      return true;
    if (this.spotify && (await this.spotify.handle(req, res, url))) return true;
    const rb = url.pathname.startsWith('/api/random-ban');
    const sp =
      url.pathname.startsWith('/api/spotify/') && Boolean(this.spotify);
    const sw = url.pathname.startsWith('/api/sub-wheel');
    const caution = url.pathname === '/api/caution/state';
    const vk = /^\/api\/votekick\/(settings|sounds)$/.test(url.pathname);
    if (
      !url.pathname.startsWith('/api/channel-points') &&
      !rb &&
      !sp &&
      !sw &&
      !caution &&
      !vk
    )
      return false;
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
      (req.headers.origin && req.headers.origin !== this.d.origin) ||
      req.headers['x-raptoru-studio'] !== '1'
    ) {
      reply(403, { error: 'forbidden' });
      return true;
    }
    try {
      if (caution)
        // Caution: read only (docs/CAUTION.md); the money moves only through the chat.
        reply(
          200,
          await this.d.core(
            `${this.d.environment === 'production' ? '/v1/studio/caution' : '/v1/lab/caution'}/${this.d.channelId}/state`,
          ),
        );
      else if (vk) {
        if (!this.votekick) return (reply(404, { error: 'not_found' }), true);
        reply(
          200,
          await this.votekick.api(
            req.method ?? 'GET',
            url.pathname.slice('/api/votekick'.length),
            () => this.body(req),
            async () => {
              let name = 'son';
              try {
                name = decodeURIComponent(
                  String(req.headers['x-sound-name'] ?? 'son'),
                );
              } catch {
                /* keep the default */
              }
              return { body: await this.raw(req, SOUND_MAX_BYTES), name };
            },
          ),
        );
      } else if (sw)
        reply(
          200,
          await this.subWheel.api(
            req.method ?? 'GET',
            url.pathname.slice('/api/sub-wheel'.length),
            () => this.body(req),
          ),
        );
      else if (sp)
        reply(
          200,
          await this.spotify!.api(
            req.method ?? 'GET',
            url.pathname.slice('/api/spotify'.length),
            () => this.body(req),
          ),
        );
      else if (rb)
        reply(
          200,
          await this.randomBan.api(
            req.method ?? 'GET',
            url.pathname.slice('/api/random-ban'.length),
            () => this.body(req),
          ),
        );
      else await this.api(req, url, reply);
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      if (!res.headersSent)
        reply(err.status ?? 503, {
          ...(err.body ?? {}),
          error:
            err.body?.error ??
            (e instanceof ObsActionError ? e.message : err.message),
        });
    }
    return true;
  }

  private async raw(req: IncomingMessage, max: number) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > max)
        throw Object.assign(new Error('sound_too_large'), { status: 413 });
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private async body(req: IncomingMessage) {
    let raw = '';
    for await (const chunk of req) {
      raw += String(chunk);
      if (raw.length > MAX_BODY)
        throw Object.assign(new Error('body_too_large'), { status: 413 });
    }
    try {
      return JSON.parse(raw || '{}') as Record<string, unknown>;
    } catch {
      throw Object.assign(new Error('invalid_json'), { status: 400 });
    }
  }

  private async api(
    req: IncomingMessage,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const p = url.pathname.slice('/api/channel-points'.length);
    const ch = `${this.base}/${this.d.channelId}`;
    if (req.method === 'GET' && p === '/state') {
      const obs = this.d.obs();
      return reply(200, {
        ...(await this.d.core<Record<string, unknown>>(`${ch}/state`)),
        environment: this.d.environment,
        obs: {
          connected: Boolean(obs?.connected),
          pending_reverts: this.obs.pending,
        },
        twitch: this.d.twitch(),
        effects: this.d.effects
          ? {
              ...this.d.effects.status(),
              sounds: this.d.effects.sounds(),
              videos: this.d.effects.videos(),
              interaction_media: this.d.effects.interactionMedia(),
            }
          : null,
        executor_error: this.lastError,
      });
    }
    if (req.method === 'GET' && p === '/obs') {
      const scene = url.searchParams.get('scene') ?? undefined;
      const source = url.searchParams.get('source') ?? undefined;
      return reply(200, await this.obs.lists(scene, source));
    }
    if (req.method !== 'POST') return reply(404, { error: 'not_found' });
    if (p === '/settings')
      return reply(
        200,
        await this.d.core(`${ch}/settings`, await this.body(req)),
      );
    if (p === '/test')
      return reply(200, await this.d.core(`${ch}/test`, await this.body(req)));
    const rule = /^\/rules\/([A-Za-z0-9-]{1,128})$/.exec(p);
    if (rule)
      return reply(
        200,
        await this.d.core(`${ch}/rules/${rule[1]}`, await this.body(req)),
      );
    reply(404, { error: 'not_found' });
  }
}
