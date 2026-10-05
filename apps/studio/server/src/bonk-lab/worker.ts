import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { bindJournal, type WorkerTransport } from '../worker-journal.js';
import type {
  BonkLabAckRequest,
  BonkLabAdmitRequest,
  BonkLabInteraction,
} from '@raptoru/schemas';

type Event = BonkLabAckRequest['event'];
type Entry = {
  interaction: BonkLabInteraction;
  sent: boolean;
  events: Event[];
  reported: Event[];
  renderer: string | null;
};
type Journal = {
  studio: string;
  profile?: 'production';
  session: string;
  token: string;
  entries: Entry[];
};
export type CoreCall = <T>(
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number },
) => Promise<T>;
export const CHANNEL = '900100';

export function localCoreClient(base: string, secret: string): CoreCall {
  const url = new URL(base);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/' ||
    !secret
  )
    throw new Error('local_bonk_core_required');
  return async <T>(
    path: string,
    body?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<T> => {
    if (!path.startsWith('/v1/lab/bonk/'))
      throw new Error('bonk_route_required');
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

/** Durable local inbox/outbox. No replay once an effect may have been sent. */
export class BonkWorker {
  private chain: Promise<unknown> = Promise.resolve();
  private renderer: { id: string; at: number } | null = null;
  private obs = false;
  private source = false;
  private lastHeartbeat = 0;
  error: string | null = null;
  private constructor(
    private readonly file: string,
    private readonly core: CoreCall,
    private state: Journal,
    private readonly base: string,
  ) {}

  /**
   * `base` / `studioId`: the future production transport (ASTRA-P1-019) uses the same journal and
   * guarantees on `/v1/studio/bonk` with the authenticated installation as Studio instance. The Lab
   * keeps the defaults (`/v1/lab/bonk`, random instance per journal).
   */
  static async open(
    file: string,
    core: CoreCall,
    options: WorkerTransport = {},
  ) {
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
    bindJournal(state, options);
    const w = new BonkWorker(file, core, state, options.base ?? '/v1/lab/bonk');
    // A process restart cannot prove that a sent effect finished. Keep already received results.
    for (const e of state.entries)
      if (
        e.sent &&
        !e.events.some((v) =>
          ['completed', 'failed', 'execution_unknown'].includes(v),
        )
      )
        e.events.push('execution_unknown');
    await w.save();
    return w;
  }

  get token() {
    return this.state.token;
  }
  get session() {
    return this.state.session;
  }
  /**
   * Lab: an interaction admitted under another Studio session is never played here. Production: the
   * admissions come from the public EBS, not from this Studio; stale work is bounded by Core
   * (expires_at, leases, claim) — ASTRA-P1-019 lot 2.
   */
  private ownSession(i: { lab_session_id: string | null }) {
    return (
      this.state.profile === 'production' || i.lab_session_id === this.session
    );
  }
  get ready() {
    return (
      this.obs &&
      this.source &&
      !!this.renderer &&
      Date.now() - this.renderer.at < 5000
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
  setObs(connected: boolean, sourceReady: boolean) {
    this.obs = connected;
    this.source = sourceReady;
  }

  async rendererHeartbeat(id: string) {
    return this.exclusive(async () => {
      if (
        this.renderer &&
        this.renderer.id !== id &&
        Date.now() - this.renderer.at < 5000
      )
        throw new Error('renderer_already_connected');
      for (const e of this.state.entries)
        if (
          e.sent &&
          e.renderer !== id &&
          !e.events.some((v) =>
            ['completed', 'failed', 'execution_unknown'].includes(v),
          )
        )
          e.events.push('execution_unknown');
      this.renderer = { id, at: Date.now() };
      await this.save();
    });
  }

  /** Local work in progress (entries to hand out, ACK or settle): keep the active cadence. */
  get busy() {
    return this.state.entries.length > 0;
  }
  /** Called after a successful admission (the loop claims it at once, ASTRA-P2-017). */
  onAdmitted: (() => void) | null = null;

  async admit(
    viewer: BonkLabAdmitRequest['viewer'],
    key: string,
    emote: BonkLabAdmitRequest['emote'],
  ) {
    // No local wallet debit: Core records the simulated cost snapshot.
    const out = await this.core<{
      interaction: BonkLabInteraction;
      replayed: boolean;
    }>(`${this.base}/interactions`, {
      channel_id: CHANNEL,
      viewer,
      idempotency_key: key,
      lab_session_id: this.session,
      emote,
    });
    this.onAdmitted?.();
    return out;
  }
  recent(viewer?: string) {
    return this.core<{ interactions: BonkLabInteraction[] }>(
      `${this.base}/channels/${CHANNEL}/interactions?limit=50${viewer ? '&viewer_id=' + viewer : ''}`,
    );
  }

  async command(renderer: string) {
    return this.exclusive(async () => {
      if (!this.ready || this.renderer?.id !== renderer) return null;
      const e = this.state.entries.find((e) => !e.sent && !e.events.length);
      if (!e) return null;
      // Persist before releasing the command to HTTP. Lost response => unknown, never replay.
      e.sent = true;
      e.renderer = renderer;
      await this.save();
      return e.interaction;
    });
  }

  async rendererAck(
    id: string,
    attempt: string,
    renderer: string,
    event: 'started' | 'completed' | 'failed',
  ) {
    return this.exclusive(async () => {
      const e = this.state.entries.find(
        (e) =>
          e.interaction.interaction_id === id &&
          e.interaction.delivery.attempt_id === attempt,
      );
      if (!e) {
        const current = await this.core<BonkLabInteraction>(
          `${this.base}/interactions/${id}`,
        );
        if (
          current.delivery.attempt_id === attempt &&
          current.delivery.studio_instance_id === this.state.studio &&
          ((event === 'started' && current.delivery.started_at !== null) ||
            current.status === event)
        )
          return;
        throw new Error('attempt_mismatch');
      }
      if (!e.sent || e.renderer !== renderer)
        throw new Error('attempt_mismatch');
      if (!e.events.includes(event)) {
        if (
          e.events.some((v) =>
            ['completed', 'failed', 'execution_unknown'].includes(v),
          )
        )
          throw new Error('terminal_result');
        if (event === 'completed' && !e.events.includes('started'))
          throw new Error('start_required');
        e.events.push(event);
        await this.save();
      }
    });
  }

  async tick() {
    return this.exclusive(async () => {
      try {
        if (Date.now() - this.lastHeartbeat > 2000) {
          await this.core(`${this.base}/studio/heartbeat`, {
            studio_instance_id: this.state.studio,
            obs: this.obs ? 'connected' : 'offline',
            source_ready: this.source,
            overlay_ready: this.ready,
          });
          this.lastHeartbeat = Date.now();
        }
        for (const e of this.state.entries) {
          if (
            !e.events.some((v) =>
              ['completed', 'failed', 'execution_unknown'].includes(v),
            ) &&
            Date.now() > Date.parse(e.interaction.delivery.lease_expires_at!)
          )
            e.events.push(e.sent ? 'execution_unknown' : 'failed');
          for (const event of e.events.filter((v) => !e.reported.includes(v))) {
            try {
              e.interaction = await this.core<BonkLabInteraction>(
                `${this.base}/interactions/${e.interaction.interaction_id}/ack`,
                {
                  studio_instance_id: this.state.studio,
                  attempt_id: e.interaction.delivery.attempt_id,
                  event,
                },
              );
            } catch (error) {
              if ((error as { status?: number }).status !== 409) throw error;
              const current = await this.core<BonkLabInteraction>(
                `${this.base}/interactions/${e.interaction.interaction_id}`,
              );
              if (
                !['completed', 'failed', 'execution_unknown'].includes(
                  current.status,
                )
              )
                throw error;
              e.interaction = current;
            }
            e.reported.push(event);
            await this.save();
          }
        }
        // Keep only unsettled local work. Core retains authoritative terminal history.
        this.state.entries = this.state.entries.filter(
          (e) =>
            !(
              e.events.some((v) =>
                ['completed', 'failed', 'execution_unknown'].includes(v),
              ) && e.events.every((v) => e.reported.includes(v))
            ),
        );
        await this.save();
        if (this.ready && this.state.entries.length < 12) {
          const { interaction } = await this.core<{
            interaction: BonkLabInteraction | null;
          }>(`${this.base}/claim`, {
            studio_instance_id: this.state.studio,
            channel_id: CHANNEL,
          });
          if (interaction) {
            this.state.entries.push({
              interaction,
              sent: false,
              renderer: null,
              events: this.ownSession(interaction) ? [] : ['failed'],
              reported: [],
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
