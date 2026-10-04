import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  SoundLabAckRequest,
  SoundLabAdmitRequest,
  SoundLabInteraction,
  SoundLabSettings,
  SoundLabSound,
  SoundLabSoundConfig,
} from '@raptoru/schemas';

// Soundboard V2 Lab worker: same durability rules as the Bonk Lab worker (separate code, Bonk is
// untouched). Core decides; this worker hands one sound at a time to the local player page and
// reports its ACKs. A sound that may have been sent is never replayed. A sound stopped by
// moderation (cancelled in Core) is stopped on the player, which proves it with a `stopped` ACK.

type Event = SoundLabAckRequest['event'];
type PlayerError = { code: string; message: string };
type Entry = {
  interaction: SoundLabInteraction;
  sent: boolean;
  events: Event[];
  reported: Event[];
  player: string | null;
  error: PlayerError | null;
  /** Cancelled in Core (moderation stop / removal). */
  cancelled?: boolean;
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
export type SoundCoreCall = <T>(
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number },
) => Promise<T>;
export const SOUND_CHANNEL = '900100';
const FINAL: Event[] = ['completed', 'failed', 'execution_unknown', 'stopped'];
const settled = (e: Entry) => e.events.some((v) => FINAL.includes(v));

/** Local Lab Core only, Soundboard routes only. */
export function localSoundCoreClient(
  base: string,
  secret: string,
): SoundCoreCall {
  const url = new URL(base);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/' ||
    !secret
  )
    throw new Error('local_sound_core_required');
  return async <T>(
    path: string,
    body?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<T> => {
    if (!path.startsWith('/v1/lab/sound/'))
      throw new Error('sound_route_required');
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
      });
    return result;
  };
}

export class SoundWorker {
  private chain: Promise<unknown> = Promise.resolve();
  private player: { id: string; at: number; audio: boolean } | null = null;
  private lastHeartbeat = 0;
  /** Global Soundboard settings from Core (sent to the player with each heartbeat answer). */
  settings: SoundLabSettings = { volume_protection: 'light' };
  error: string | null = null;
  private constructor(
    private readonly file: string,
    private readonly core: SoundCoreCall,
    private state: Journal,
  ) {}

  static async open(file: string, core: SoundCoreCall) {
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
    const w = new SoundWorker(file, core, state);
    // A restart cannot prove that a sound handed to the player finished. Keep known results.
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
  /** A live player page whose audio output has been enabled by a user gesture. */
  get ready() {
    return (
      !!this.player && this.player.audio && Date.now() - this.player.at < 5000
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

  async playerHeartbeat(id: string, audio: boolean) {
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
      this.player = { id, at: Date.now(), audio };
      await this.save();
    });
  }

  /** Catalog for the extension, with live cooldown / running state (short timeout: local Core). */
  catalog() {
    return this.core<{ sounds: SoundLabSound[] }>(
      `/v1/lab/sound/channels/${SOUND_CHANNEL}/catalog`,
      undefined,
      { timeoutMs: 1500 },
    );
  }

  config() {
    return this.core<{
      sounds: SoundLabSoundConfig[];
      settings: SoundLabSettings;
    }>('/v1/lab/sound/config');
  }
  updateSound(id: string, update: Record<string, unknown>) {
    return this.core<SoundLabSoundConfig>(
      `/v1/lab/sound/sounds/${encodeURIComponent(id)}`,
      update,
    );
  }
  async updateSettings(settings: SoundLabSettings) {
    this.settings = await this.core<SoundLabSettings>(
      '/v1/lab/sound/settings',
      settings,
    );
    return this.settings;
  }

  admit(
    viewer: SoundLabAdmitRequest['viewer'],
    key: string,
    soundId: string,
    paymentMethod: SoundLabAdmitRequest['payment_method'],
  ) {
    // No local wallet debit: Core records the simulated cost snapshot.
    return this.core<{ interaction: SoundLabInteraction; replayed: boolean }>(
      '/v1/lab/sound/interactions',
      {
        channel_id: SOUND_CHANNEL,
        viewer,
        idempotency_key: key,
        lab_session_id: this.session,
        sound_id: soundId,
        payment_method: paymentMethod,
      },
    );
  }

  recent() {
    return this.core<{ interactions: SoundLabInteraction[] }>(
      `/v1/lab/sound/channels/${SOUND_CHANNEL}/interactions?limit=30`,
    );
  }

  /**
   * Sounds to stop on this player: cancelled in Core by moderation. The order is proposed again
   * (at most every second) until the player proves the silence with its `stopped` ACK: a lost answer
   * never leaves a sound playing. Stopping is idempotent on the player; a play is never replayed.
   */
  async stopOrders(
    player: string,
  ): Promise<{ interaction_id: string; attempt_id: string | null }[]> {
    return this.exclusive(async () => {
      if (!this.ready || this.player?.id !== player) return [];
      const stop = this.state.entries.filter(
        (e) =>
          e.cancelled &&
          e.sent &&
          e.player === player &&
          !settled(e) &&
          Date.now() - (e.stopSentAt ?? 0) >= STOP_RESEND_MS,
      );
      if (!stop.length) return [];
      for (const e of stop) e.stopSentAt = Date.now();
      await this.save();
      return stop.map((x) => ({
        interaction_id: x.interaction.interaction_id,
        attempt_id: x.interaction.delivery.attempt_id,
      }));
    });
  }

  /** Next sound for this player. Persisted as sent before the HTTP answer: never replayed. */
  async command(player: string) {
    return this.exclusive(async () => {
      if (!this.ready || this.player?.id !== player) return null;
      const e = this.state.entries.find(
        (e) => !e.sent && !e.events.length && !e.cancelled,
      );
      if (!e) return null;
      e.sent = true;
      e.player = player;
      await this.save();
      return e.interaction;
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
        (e) =>
          e.interaction.interaction_id === id &&
          e.interaction.delivery.attempt_id === attempt,
      );
      if (!e) {
        // Already settled and reported: a replayed ACK from the player is accepted as is.
        const current = await this.core<SoundLabInteraction>(
          `/v1/lab/sound/interactions/${id}`,
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
      if (e.events.includes(event)) return;
      // Stopped by moderation: only the proof of the stop matters (Core holds the final state).
      if (e.cancelled) {
        if (event === 'stopped' && !settled(e)) {
          e.events.push('stopped');
          await this.save();
        }
        return;
      }
      if (event === 'stopped') throw new Error('not_stopped');
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
          const { settings } = await this.core<{ settings: SoundLabSettings }>(
            '/v1/lab/sound/studio/heartbeat',
            {
              studio_instance_id: this.state.studio,
              player_ready: this.ready,
            },
          );
          this.settings = settings;
          this.lastHeartbeat = Date.now();
        }
        for (const e of this.state.entries) {
          if (
            !settled(e) &&
            Date.now() > Date.parse(e.interaction.delivery.lease_expires_at!)
          )
            e.events.push(e.sent ? 'execution_unknown' : 'failed');
          // Moderation: a sound cancelled in Core is stopped on the player (never handed out: dropped).
          if (!settled(e) && !e.cancelled) {
            const current = await this.core<SoundLabInteraction>(
              `/v1/lab/sound/interactions/${e.interaction.interaction_id}`,
            );
            if (current.status === 'cancelled') {
              e.cancelled = true;
              e.interaction = current;
              if (!e.sent) e.events.push('failed');
              else if (!this.ready || this.player?.id !== e.player)
                e.events.push('execution_unknown'); // no page left to stop it: not provable
              await this.save();
            }
          }
          for (const event of e.events.filter((v) => !e.reported.includes(v))) {
            try {
              e.interaction = await this.core<SoundLabInteraction>(
                `/v1/lab/sound/interactions/${e.interaction.interaction_id}/ack`,
                {
                  studio_instance_id: this.state.studio,
                  attempt_id: e.interaction.delivery.attempt_id,
                  event,
                  ...(event === 'failed' && e.error ? { error: e.error } : {}),
                },
              );
            } catch (error) {
              if ((error as { status?: number }).status !== 409) throw error;
              const current = await this.core<SoundLabInteraction>(
                `/v1/lab/sound/interactions/${e.interaction.interaction_id}`,
              );
              if (!FINAL.includes(current.status as Event)) throw error;
              e.interaction = current;
            }
            e.reported.push(event);
            await this.save();
          }
        }
        // Keep only unsettled local work. Core retains authoritative terminal history.
        this.state.entries = this.state.entries.filter(
          (e) => !(settled(e) && e.events.every((v) => e.reported.includes(v))),
        );
        await this.save();
        // Core decides what may play now (playback modes, concurrency cap): claim until it says no.
        for (
          let n = 0;
          this.ready && n < 8 && this.state.entries.length < 8;
          n++
        ) {
          const { interaction } = await this.core<{
            interaction: SoundLabInteraction | null;
          }>('/v1/lab/sound/claim', {
            studio_instance_id: this.state.studio,
            channel_id: SOUND_CHANNEL,
          });
          if (!interaction) break;
          {
            this.state.entries.push({
              interaction,
              sent: false,
              player: null,
              // Claimed from another Studio session: never played here, reported as failed.
              events:
                interaction.lab_session_id === this.session ? [] : ['failed'],
              reported: [],
              error:
                interaction.lab_session_id === this.session
                  ? null
                  : {
                      code: 'foreign_session',
                      message: 'admitted by another Studio session',
                    },
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
