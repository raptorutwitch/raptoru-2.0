import { randomUUID } from 'node:crypto';
import { PRESENCE_INTERVAL_SECONDS } from '@raptoru/schemas';
import type { CoreClient } from '../core-client.js';
import {
  SnapshotAbortedError,
  takeChattersSnapshot,
  type GetChattersPage,
  type SnapshotOptions,
} from './chatters-snapshot.js';

// Shadow presence worker: observes Get Chatters every 2 minutes during a live and reports each
// snapshot (or failure) to Core, which alone decides what counts as watch time.
//
// Lifecycle invariants:
// - at most one worker state and one pending timer per process (chained setTimeout, no setInterval);
// - a cycle never starts before the previous one finished; missed deadlines are skipped, not stacked;
// - stop() clears the timer and aborts the in-flight snapshot;
// - RAM holds only the current snapshot; history lives in Core's database.

export interface PresenceWorkerDeps {
  core: Pick<CoreClient, 'presenceLease' | 'presenceObservation'>;
  getPage: GetChattersPage;
  workerId: string;
  liveStateAgeSeconds: () => number | null;
  intervalMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  log?: (...args: unknown[]) => void;
  snapshotOptions?: Omit<SnapshotOptions, 'signal'>;
}

type CycleOutcome =
  | { kind: 'ok' }
  | { kind: 'skipped' }
  | { kind: 'failed'; retryAtMs: number | null }
  | { kind: 'auth' };

interface RunState {
  streamId: string;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  nextAt: number;
  failures: number;
}

export class PresenceWorker {
  private state: RunState | null = null;
  private readonly intervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly log: (...args: unknown[]) => void;

  constructor(private readonly deps: PresenceWorkerDeps) {
    this.intervalMs = deps.intervalMs ?? PRESENCE_INTERVAL_SECONDS * 1000;
    this.maxBackoffMs = deps.maxBackoffMs ?? 10 * 60 * 1000;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? console.log;
  }

  get activeStreamId(): string | null {
    return this.state?.streamId ?? null;
  }

  /** Idempotent for the same stream; switching stream restarts cleanly. */
  start(streamId: string): void {
    if (this.state?.streamId === streamId) return;
    this.stop();
    const state: RunState = {
      streamId,
      controller: new AbortController(),
      timer: null,
      nextAt: this.now(),
      failures: 0,
    };
    this.state = state;
    this.log(`[presence] shadow worker started for stream ${streamId}`);
    this.schedule(state, 0);
  }

  stop(): void {
    const state = this.state;
    if (!state) return;
    this.state = null;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.controller.abort();
    this.log(`[presence] shadow worker stopped for stream ${state.streamId}`);
  }

  private schedule(state: RunState, delayMs: number): void {
    state.timer = setTimeout(() => void this.tick(state), Math.max(0, delayMs));
  }

  private async tick(state: RunState): Promise<void> {
    state.timer = null;
    if (this.state !== state) return;

    let outcome: CycleOutcome;
    try {
      outcome = await this.cycle(state);
    } catch (error) {
      if (this.state !== state || error instanceof SnapshotAbortedError) return;
      this.log(
        '[presence] cycle failed',
        error instanceof Error ? error.message : error,
      );
      outcome = { kind: 'failed', retryAtMs: null };
    }
    if (this.state !== state) return;

    if (outcome.kind === 'auth') {
      this.log(
        '[presence] Twitch refused the token (401/403): worker stopped. Check scope moderator:read:chatters and moderator status.',
      );
      this.stop();
      return;
    }

    const now = this.now();
    state.nextAt += this.intervalMs;
    if (state.nextAt < now) state.nextAt = now; // missed deadline: run once, never catch up
    let delay = state.nextAt - now;
    if (outcome.kind === 'failed') {
      state.failures++;
      const backoff = Math.min(
        this.intervalMs * 2 ** (state.failures - 1),
        this.maxBackoffMs,
      );
      delay = Math.max(delay, backoff);
      if (outcome.retryAtMs !== null)
        delay = Math.max(delay, outcome.retryAtMs - now);
    } else {
      state.failures = 0;
    }
    this.schedule(state, delay);
  }

  private async cycle(state: RunState): Promise<CycleOutcome> {
    const { core, workerId } = this.deps;
    const lease = await core.presenceLease({
      workerId,
      streamId: state.streamId,
    });
    if (!lease.granted) {
      this.log(
        `[presence] lease held by ${lease.holder} until ${lease.expiresAt}: skipping cycle`,
      );
      return { kind: 'skipped' };
    }

    const observedAt = this.now();
    const { snapshot, retryAtMs } = await takeChattersSnapshot(
      this.deps.getPage,
      {
        ...this.deps.snapshotOptions,
        signal: state.controller.signal,
      },
    );
    if (this.state !== state) throw new SnapshotAbortedError();

    const result = await core.presenceObservation({
      cycleId: randomUUID(),
      workerId,
      streamId: state.streamId,
      observedAt: new Date(observedAt).toISOString(),
      durationMs: this.now() - observedAt,
      liveStateAgeSeconds: this.deps.liveStateAgeSeconds(),
      snapshot,
    });
    this.log(
      snapshot.status === 'ok'
        ? `[presence] ${snapshot.chatters.length} chatters · +${result.creditedSeconds}s for ${result.creditedViewers} viewers${result.gapReason ? ` (${result.gapReason})` : ''}${result.accepted ? '' : ` · REJECTED ${result.rejection}`}`
        : `[presence] snapshot failed: ${snapshot.errorKind} ${snapshot.httpStatus ?? ''} ${snapshot.message}`,
    );

    if (snapshot.status === 'ok') return { kind: 'ok' };
    if (snapshot.errorKind === 'auth') return { kind: 'auth' };
    return { kind: 'failed', retryAtMs };
  }
}
