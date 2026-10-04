import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  TtsLabAckRequest,
  TtsLabAdmitResponse,
  TtsLabInteraction,
  TtsLabModerationRequest,
  TtsLabViewerState,
} from '@raptoru/schemas';

// TTS V2 Lab worker: same durability rules as the Soundboard / Bonk workers. Core decides (price,
// cast, order, cooldown, refund); this worker hands ONE TTS at a time to the local player page
// (OBS overlay or Studio preview), relays its ACKs, and tells the player to stop a TTS cancelled
// by moderation. A TTS that may have been sent to the player is never sent again.

type Event = TtsLabAckRequest['event'];
type PlayerError = { code: string; message: string };
type Entry = {
  interaction: TtsLabInteraction;
  sent: boolean;
  events: Event[];
  reported: Event[];
  player: string | null;
  error: PlayerError | null;
  /** Core says it was cancelled (stop / purge): the player must stop it. */
  cancelled: boolean;
  /** Last time the stop order was handed to the player (proposed again until its `stopped` ACK). */
  stopSentAt?: number;
};
/** A stop order whose answer may have been lost is proposed again after this delay. */
const STOP_RESEND_MS = 1000;
type Journal = {
  studio: string;
  session: string;
  token: string;
  entries: Entry[];
};
export type TtsCoreCall = <T>(
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number },
) => Promise<T>;
export const TTS_CHANNEL = '900100';
const FINAL: Event[] = ['completed', 'failed', 'execution_unknown'];
const settled = (e: Entry) =>
  e.cancelled || e.events.some((v) => FINAL.includes(v));

/** Local Lab Core only, TTS routes only. */
export function localTtsCoreClient(base: string, secret: string): TtsCoreCall {
  const url = new URL(base);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/' ||
    !secret
  )
    throw new Error('local_tts_core_required');
  return async <T>(
    path: string,
    body?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<T> => {
    if (!path.startsWith('/v1/lab/tts/')) throw new Error('tts_route_required');
    const res = await fetch(new URL(path, url), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 4000),
    });
    const result = (await res.json()) as T & { error?: string };
    if (!res.ok)
      throw Object.assign(new Error(result.error ?? 'core_unavailable'), {
        status: res.status,
        body: result,
      });
    return result;
  };
}

export class TtsWorker {
  private chain: Promise<unknown> = Promise.resolve();
  private player: { id: string; at: number; voices: number } | null = null;
  private lastHeartbeat = 0;
  /** Breathing time between two TTS, from Core (the player waits it before asking again). */
  transitionGapMs = 1500;
  moduleState: 'active' | 'paused' | 'disabled' = 'active';
  error: string | null = null;
  private constructor(
    private readonly file: string,
    private readonly core: TtsCoreCall,
    private state: Journal,
  ) {}

  static async open(file: string, core: TtsCoreCall) {
    let state: Journal;
    try {
      state = JSON.parse(await readFile(file, 'utf8')) as Journal;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      state = {
        studio: randomUUID(),
        session: randomUUID(),
        token: randomBytes(32).toString('hex'),
        entries: [],
      };
    }
    const w = new TtsWorker(file, core, state);
    // A restart cannot prove that a TTS handed to the player finished: never replayed, reported unknown.
    for (const e of state.entries)
      if (e.sent && !settled(e)) e.events.push('execution_unknown');
    await w.save();
    return w;
  }

  get token() {
    return this.state.token;
  }
  get session() {
    return this.state.session;
  }
  /** A live player page with Web Speech voices available. */
  get ready() {
    return (
      !!this.player &&
      this.player.voices > 0 &&
      Date.now() - this.player.at < 5000
    );
  }
  get playerInfo() {
    return this.player
      ? { voices: this.player.voices, seen_ms_ago: Date.now() - this.player.at }
      : null;
  }
  /** The TTS currently handed to the player (for the Studio panel). */
  get current() {
    return (
      this.state.entries.find((e) => e.sent && !settled(e))?.interaction ?? null
    );
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.catch(() => {});
    return result;
  }
  /** Last journal content on disk: a tick that changed nothing writes nothing (ASTRA-P2-016). */
  private saved = '';

  private async save() {
    const text = JSON.stringify(this.state);
    if (text === this.saved) return;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file + '.tmp', text, {
      mode: 0o600,
    });
    await rename(this.file + '.tmp', this.file);
    this.saved = text;
  }

  /** One player page at a time (OBS overlay or Studio preview): a second one is refused while fresh. */
  async playerHeartbeat(id: string, voices: number) {
    return this.exclusive(async () => {
      if (
        this.player &&
        this.player.id !== id &&
        Date.now() - this.player.at < 5000
      )
        throw new Error('player_already_connected');
      // A new player page cannot finish what another page may have started.
      for (const e of this.state.entries)
        if (e.sent && e.player !== id && !settled(e))
          e.events.push('execution_unknown');
      this.player = {
        id,
        at: Date.now(),
        voices: Math.max(0, Math.trunc(voices)),
      };
      await this.save();
      return {
        transition_gap_ms: this.transitionGapMs,
        module_state: this.moduleState,
      };
    });
  }

  // --- extension façade (Core owns every decision) --------------------------------------------------

  config() {
    return this.core<{ module_state: string; rules: unknown }>(
      '/v1/lab/tts/config',
      undefined,
      { timeoutMs: 1500 },
    );
  }
  viewerState(viewerId: string) {
    return this.core<TtsLabViewerState>(
      `/v1/lab/tts/channels/${TTS_CHANNEL}/viewers/${viewerId}/state`,
      undefined,
      {
        timeoutMs: 1500,
      },
    );
  }
  /** Local work in progress (entries to hand out, ACK or settle): keep the active cadence. */
  get busy() {
    return this.state.entries.length > 0;
  }
  /** Called after a successful admission (the loop claims it at once, ASTRA-P2-017). */
  onAdmitted: (() => void) | null = null;

  async admit(
    viewer: { id: string; display_name: string },
    key: string,
    text: string,
    paymentMethod: 'tokens' | 'credits',
  ) {
    const out = await this.core<TtsLabAdmitResponse>(
      '/v1/lab/tts/interactions',
      {
        channel_id: TTS_CHANNEL,
        viewer,
        idempotency_key: key,
        lab_session_id: this.session,
        text,
        payment_method: paymentMethod,
      },
    );
    this.onAdmitted?.();
    return out;
  }
  queue() {
    return this.core<Record<string, unknown>>(
      `/v1/lab/tts/channels/${TTS_CHANNEL}/queue`,
    );
  }
  audit() {
    return this.core<{ audit: unknown[] }>(
      `/v1/lab/tts/channels/${TTS_CHANNEL}/audit?limit=30`,
    );
  }
  moderate(m: TtsLabModerationRequest) {
    return this.core<Record<string, unknown>>(
      `/v1/lab/tts/channels/${TTS_CHANNEL}/moderation`,
      m,
    );
  }

  // --- player ---------------------------------------------------------------------------------------

  /**
   * Next instruction for this player: stop a cancelled TTS, or the next TTS (persisted as sent first).
   * A stop is proposed again (at most every second) until the player proves it with `stopped`: a lost
   * answer never leaves a TTS speaking. A play is never handed out twice.
   */
  async command(
    player: string,
    accept = true,
  ): Promise<
    | { stop: string; attempt_id: string | null }
    | { play: TtsLabInteraction }
    | null
  > {
    return this.exclusive(async () => {
      if (!this.ready || this.player?.id !== player) return null;
      const cancelled = this.state.entries.find(
        (e) =>
          e.sent &&
          e.player === player &&
          e.cancelled &&
          !e.reported.includes('failed') &&
          Date.now() - (e.stopSentAt ?? 0) >= STOP_RESEND_MS,
      );
      if (cancelled) {
        cancelled.stopSentAt = Date.now(); // Core already holds the final state
        await this.save();
        return {
          stop: cancelled.interaction.interaction_id,
          attempt_id: cancelled.interaction.delivery.attempt_id,
        };
      }
      if (!accept || this.state.entries.some((e) => e.sent && !settled(e)))
        return null; // strictly one at a time
      const e = this.state.entries.find(
        (x) => !x.sent && !x.events.length && !x.cancelled,
      );
      if (!e) return null;
      e.sent = true;
      e.player = player;
      await this.save();
      return { play: e.interaction };
    });
  }

  async playerAck(
    id: string,
    attempt: string,
    player: string,
    event: 'started' | 'completed' | 'failed' | 'stopped',
    error: PlayerError | null = null,
  ) {
    return this.exclusive(async () => {
      const e = this.state.entries.find(
        (x) =>
          x.interaction.interaction_id === id &&
          x.interaction.delivery.attempt_id === attempt,
      );
      if (!e) {
        const current = await this.core<TtsLabInteraction>(
          `/v1/lab/tts/interactions/${id}`,
        );
        if (
          current.delivery.attempt_id === attempt &&
          current.delivery.studio_instance_id === this.state.studio &&
          ((event === 'started' && current.delivery.started_at !== null) ||
            current.status === event ||
            current.status === 'cancelled')
        )
          return;
        throw new Error('attempt_mismatch');
      }
      if (!e.sent || e.player !== player) throw new Error('attempt_mismatch');
      // Stopped by moderation: the player's proof ends the stop orders (Core holds the final state).
      if (e.cancelled) {
        if (event === 'stopped' && !e.reported.includes('failed')) {
          e.reported.push('failed');
          await this.save();
        }
        return;
      }
      if (event === 'stopped') throw new Error('not_stopped');
      if (e.events.includes(event)) return;
      if (settled(e)) throw new Error('terminal_result');
      if (event === 'completed' && !e.events.includes('started'))
        throw new Error('start_required');
      e.events.push(event);
      if (event === 'failed') e.error = error;
      await this.save();
    });
  }

  async tick() {
    return this.exclusive(async () => {
      try {
        if (Date.now() - this.lastHeartbeat > 2000) {
          const hb = await this.core<{
            module_state: TtsWorker['moduleState'];
            rules: { transition_gap_ms: number };
          }>('/v1/lab/tts/studio/heartbeat', {
            studio_instance_id: this.state.studio,
            player_ready: this.ready,
          });
          this.moduleState = hb.module_state;
          this.transitionGapMs = hb.rules.transition_gap_ms;
          this.lastHeartbeat = Date.now();
        }
        for (const e of this.state.entries) {
          if (
            !settled(e) &&
            e.interaction.delivery.lease_expires_at &&
            Date.now() > Date.parse(e.interaction.delivery.lease_expires_at)
          )
            e.events.push(e.sent ? 'execution_unknown' : 'failed');
          // Moderation: a TTS cancelled in Core must stop on the player (and is never ACKed again).
          if (!settled(e)) {
            const current = await this.core<TtsLabInteraction>(
              `/v1/lab/tts/interactions/${e.interaction.interaction_id}`,
            );
            if (current.status === 'cancelled') {
              e.cancelled = true;
              e.interaction = current;
              // Never handed out, or no page left to stop it: nothing to tell a player.
              if (!e.sent || !this.ready || this.player?.id !== e.player)
                e.reported.push('failed');
              await this.save();
              continue;
            }
          }
          for (const event of e.events.filter((v) => !e.reported.includes(v))) {
            try {
              e.interaction = await this.core<TtsLabInteraction>(
                `/v1/lab/tts/interactions/${e.interaction.interaction_id}/ack`,
                {
                  studio_instance_id: this.state.studio,
                  attempt_id: e.interaction.delivery.attempt_id,
                  event,
                  ...(event === 'failed' && e.error ? { error: e.error } : {}),
                },
              );
            } catch (error) {
              if ((error as { status?: number }).status !== 409) throw error;
              const current = await this.core<TtsLabInteraction>(
                `/v1/lab/tts/interactions/${e.interaction.interaction_id}`,
              );
              if (
                ![
                  'completed',
                  'failed',
                  'execution_unknown',
                  'cancelled',
                ].includes(current.status)
              )
                throw error;
              e.interaction = current;
            }
            e.reported.push(event);
            await this.save();
          }
        }
        // Keep only unsettled local work (and cancelled ones until their stop was handed out).
        this.state.entries = this.state.entries.filter((e) =>
          e.cancelled
            ? !e.reported.includes('failed') &&
              this.ready &&
              this.player?.id === e.player
            : !(settled(e) && e.events.every((v) => e.reported.includes(v))),
        );
        await this.save();
        // Core decides what may play now (order, pause, one at a time).
        if (this.ready && !this.state.entries.length) {
          const { interaction } = await this.core<{
            interaction: TtsLabInteraction | null;
          }>('/v1/lab/tts/claim', {
            studio_instance_id: this.state.studio,
            channel_id: TTS_CHANNEL,
          });
          if (interaction) {
            const foreign = interaction.lab_session_id !== this.session;
            this.state.entries.push({
              interaction,
              sent: false,
              player: null,
              // Admitted by another Studio session: never played here, reported as failed (refunded).
              events: foreign ? ['failed'] : [],
              reported: [],
              error: foreign
                ? {
                    code: 'foreign_session',
                    message: 'admitted by another Studio session',
                  }
                : null,
              cancelled: false,
            });
            await this.save();
          }
        }
        this.error = null;
      } catch (e) {
        this.error = (e as Error).message;
      }
    });
  }
}
