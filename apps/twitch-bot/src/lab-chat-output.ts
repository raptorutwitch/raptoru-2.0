import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { HelixError } from './twitch/helix.js';

// Commands V2 — Lab chat output executor (phase C). Runs inside the Lab chat adapter (LeCroupier_'s
// token), never in the production bot. Core is the source of truth: the executor claims ONE step at a
// time, confirms `running` to Core, journals `about_to_send` locally, calls Helix once, journals the
// outcome, then acknowledges it with the same attempt_id.
//
// A Twitch send is not idempotent — a duplicate in chat is worse than a lost message:
// - certainly not sent (connection refused before the request, 429, explicit « not sent ») → `failed`
//   retryable: Core may queue it again (bounded, backoff, before expiry);
// - certainly refused (4xx) → `failed`, not retryable;
// - possibly sent (timeout, connection lost after the request, 5xx, unreadable answer) → `unknown`,
//   never retried;
// - Helix proof (is_sent + message_id; announcement 204) → `succeeded`.
// After a crash, an `about_to_send` left in the journal is reported `unknown`, never resent.

// --- local journal --------------------------------------------------------------------------------

export interface AckBody {
  event: 'succeeded' | 'failed' | 'unknown';
  twitch_message_id?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    retry_after_ms?: number;
  };
}

export interface JournalEntry {
  step_id: string;
  attempt_id: string;
  /** about_to_send: Helix may have been called, outcome not known yet. done: outcome to report. */
  state: 'about_to_send' | 'done';
  at: string;
  outcome?: AckBody;
}

export interface SendJournal {
  entries(): JournalEntry[];
  put(entry: JournalEntry): void;
  remove(stepId: string, attemptId: string): void;
}

function createJournal(
  state: { entries: JournalEntry[] },
  persist: (s: { entries: JournalEntry[] }) => void,
): SendJournal {
  const same = (e: JournalEntry, s: string, a: string) =>
    e.step_id === s && e.attempt_id === a;
  return {
    entries: () => state.entries.map((e) => ({ ...e })),
    put(entry) {
      state.entries = [
        ...state.entries.filter(
          (e) => !same(e, entry.step_id, entry.attempt_id),
        ),
        entry,
      ];
      persist(state);
    },
    remove(stepId, attemptId) {
      const before = state.entries.length;
      state.entries = state.entries.filter((e) => !same(e, stepId, attemptId));
      if (state.entries.length !== before) persist(state);
    },
  };
}

export function memoryJournal(): SendJournal {
  return createJournal({ entries: [] }, () => {});
}

/**
 * JSON file rewritten atomically (temp file + rename) before every Helix call and after its outcome
 * (same pattern as the loyalty outbox). An unreadable file stops the executor: it may hold sends whose
 * outcome Core does not know yet.
 */
export function fileJournal(path: string): SendJournal {
  const state = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { entries: JournalEntry[] })
    : { entries: [] };
  if (!Array.isArray(state.entries))
    throw new Error(`lab chat journal ${path} is not valid`);
  return createJournal(state, (s) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(s));
    renameSync(`${path}.tmp`, path);
  });
}

// --- rate limiter ---------------------------------------------------------------------------------

/**
 * Sliding window before Helix. Twitch chat limits (https://dev.twitch.tv/docs/chat/#rate-limits):
 * 20 messages / 30 s for a regular account, 100 / 30 s when the sender is a moderator of the channel.
 * Default 20 / 30 s: safe even if LeCroupier_ loses its moderator status (LAB_CHAT_OUTPUT_RATE raises
 * it). The executor claims only when a slot is free, so a burst waits in Core's queue (and expires
 * there, visibly) instead of being dropped. A 429 pauses every send until Twitch's reset.
 * ponytail: in-memory window — a restart inside 30 s forgets it; Twitch then answers 429 (handled).
 */
export function createRateLimiter(o: {
  max: number;
  windowMs: number;
  now?: () => number;
}) {
  const now = o.now ?? Date.now;
  const sent: number[] = [];
  let pausedUntil = 0;
  return {
    /** Milliseconds before the next send may start (0 = now). */
    wait() {
      const t = now();
      while (sent.length && sent[0]! <= t - o.windowMs) sent.shift();
      const slot = sent.length < o.max ? 0 : sent[0]! + o.windowMs - t;
      return Math.max(slot, pausedUntil - t, 0);
    },
    take() {
      sent.push(now());
    },
    pauseUntil(epochMs: number) {
      pausedUntil = Math.max(pausedUntil, epochMs);
    },
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;

// --- outcome of a Helix call ----------------------------------------------------------------------

const NOT_SENT_NETWORK = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
];

/** What a Helix error proves about the send. */
export function classifySendError(e: unknown, now: number): AckBody {
  if (e instanceof HelixError) {
    if (e.status === 429)
      return {
        event: 'failed',
        error: {
          code: 'rate_limited',
          message: 'Twitch 429: not sent',
          retryable: true,
          retry_after_ms: Math.min(
            600_000,
            Math.max(0, (e.rateLimitResetMs ?? now + 1000) - now),
          ),
        },
      };
    if (e.status >= 500)
      return {
        event: 'unknown',
        error: {
          code: 'twitch_server_error',
          message: `Twitch ${e.status}: may have been sent`,
          retryable: false,
        },
      };
    return {
      event: 'failed',
      error: {
        code: `twitch_${e.status}`,
        message: e.message.slice(0, 300),
        retryable: false,
      },
    };
  }
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  if (code && NOT_SENT_NETWORK.includes(code))
    return {
      event: 'failed',
      error: {
        code: 'connection_failed',
        message: `${code}: the request never left`,
        retryable: true,
      },
    };
  const name = (e as { name?: string })?.name;
  return {
    event: 'unknown',
    error: {
      code: name === 'TimeoutError' ? 'timeout' : 'ambiguous_error',
      message: `${name ?? 'error'}: may have been sent, never retried`.slice(
        0,
        300,
      ),
      retryable: false,
    },
  };
}

// --- executor -------------------------------------------------------------------------------------

export interface ClaimedStep {
  step_id: string;
  attempt_id: string;
  type: 'chat' | 'module';
  params: { mode?: string; text?: string; reply_to?: string | null };
  status: string;
}

export interface LabChatOutputDeps {
  /** POST to the Lab Core; throws only when Core could not be reached. */
  core(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  channelId: string;
  executorId: string;
  /** Scopes of LeCroupier_'s token. */
  scopes: string[];
  send: {
    chat(
      text: string,
      replyTo: string | null,
    ): Promise<{
      message_id: string | null;
      is_sent: boolean;
      drop_reason: { code: string; message: string } | null;
    }>;
    announce(text: string): Promise<void>;
  };
  journal: SendJournal;
  limiter: RateLimiter;
  now?: () => number;
  log?: (...args: unknown[]) => void;
}

export type TickResult =
  | { kind: 'sent' | 'failed' | 'unknown' | 'not_started'; step_id: string }
  | { kind: 'idle'; reason: string; retry_in_ms?: number };

export function createLabChatOutput(d: LabChatOutputDeps) {
  const now = d.now ?? Date.now;
  const log = d.log ?? console.log;
  const base = `/v1/lab/commands/${d.channelId}/steps`;
  const ackPath = (stepId: string) => `${base}/${stepId}/ack`;

  /** Reports one journaled outcome; true once Core answered (accepted, replayed or refused). */
  async function report(e: JournalEntry): Promise<boolean> {
    const outcome: AckBody = e.outcome ?? {
      event: 'unknown',
      error: {
        code: 'executor_restart',
        message:
          'the bot stopped during the send: may have been sent, never retried',
        retryable: false,
      },
    };
    try {
      const r = await d.core(ackPath(e.step_id), {
        executor_id: d.executorId,
        attempt_id: e.attempt_id,
        ...outcome,
      });
      // 409 (stale attempt / final already): Core holds a state; nothing more to tell it.
      if (r.status >= 500) return false;
      d.journal.remove(e.step_id, e.attempt_id);
      return true;
    } catch {
      return false;
    }
  }

  /** Every journaled outcome reported (after a restart: ambiguous sends → unknown). */
  async function recover(): Promise<boolean> {
    for (const e of d.journal.entries()) if (!(await report(e))) return false;
    return true;
  }

  async function execute(step: ClaimedStep): Promise<AckBody> {
    const text = step.params.text ?? '';
    try {
      if (step.params.mode === 'announce') {
        await d.send.announce(text);
        return { event: 'succeeded' };
      }
      const r = await d.send.chat(
        text,
        step.params.mode === 'reply' ? (step.params.reply_to ?? null) : null,
      );
      if (r.is_sent)
        return r.message_id
          ? { event: 'succeeded', twitch_message_id: r.message_id }
          : { event: 'succeeded' };
      return {
        event: 'failed',
        error: {
          code: `dropped_${(r.drop_reason?.code ?? 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '_')}`.slice(
            0,
            64,
          ),
          message:
            `Twitch did not send it: ${r.drop_reason?.message ?? ''}`.slice(
              0,
              300,
            ),
          retryable: true,
        },
      };
    } catch (e) {
      const out = classifySendError(e, now());
      if (out.error?.code === 'rate_limited')
        d.limiter.pauseUntil(now() + (out.error.retry_after_ms ?? 1000));
      return out;
    }
  }

  /** Steps that cannot be sent at all: refused before any Helix call (certain, final). */
  function unsendable(step: ClaimedStep): AckBody | null {
    const mode = step.params.mode;
    if (
      step.type !== 'chat' ||
      !['normal', 'reply', 'announce'].includes(mode ?? '')
    )
      return {
        event: 'failed',
        error: {
          code: 'unsupported_step',
          message: `${step.type}/${mode} is not sendable`,
          retryable: false,
        },
      };
    const need =
      mode === 'announce'
        ? 'moderator:manage:announcements'
        : 'user:write:chat';
    if (!d.scopes.includes(need))
      return {
        event: 'failed',
        error: {
          code: 'missing_scope',
          message: `LeCroupier_'s token lacks ${need}`,
          retryable: false,
        },
      };
    return null;
  }

  /** One iteration: report the journal, then claim, confirm, send and acknowledge at most one step. */
  async function tick(): Promise<TickResult> {
    if (!(await recover())) return { kind: 'idle', reason: 'core_unavailable' };
    const wait = d.limiter.wait();
    if (wait > 0)
      return { kind: 'idle', reason: 'rate_limit', retry_in_ms: wait };
    let claimed: { status: number; body: unknown };
    try {
      claimed = await d.core(`${base}/claim`, { executor_id: d.executorId });
    } catch {
      return { kind: 'idle', reason: 'core_unavailable' };
    }
    const c = claimed.body as {
      step: ClaimedStep | null;
      reason?: string;
      retry_in_ms?: number;
    };
    if (claimed.status !== 200 || !c.step)
      return {
        kind: 'idle',
        reason: c.reason ?? `core_${claimed.status}`,
        retry_in_ms: c.retry_in_ms,
      };
    const step = c.step;
    const refused = unsendable(step);
    if (refused) {
      await report({
        step_id: step.step_id,
        attempt_id: step.attempt_id,
        state: 'done',
        at: new Date(now()).toISOString(),
        outcome: refused,
      });
      return { kind: 'failed', step_id: step.step_id };
    }
    // Core must know it is about to be sent before anything leaves; otherwise nothing is sent (the
    // claim lease expires and Core queues it again: certainly not sent).
    try {
      const r = await d.core(ackPath(step.step_id), {
        executor_id: d.executorId,
        attempt_id: step.attempt_id,
        event: 'running',
      });
      if (
        r.status !== 200 ||
        (r.body as { step?: { status?: string } }).step?.status !== 'running'
      )
        return { kind: 'not_started', step_id: step.step_id };
    } catch {
      return { kind: 'not_started', step_id: step.step_id };
    }
    d.journal.put({
      step_id: step.step_id,
      attempt_id: step.attempt_id,
      state: 'about_to_send',
      at: new Date(now()).toISOString(),
    });
    d.limiter.take();
    const outcome = await execute(step);
    const entry: JournalEntry = {
      step_id: step.step_id,
      attempt_id: step.attempt_id,
      state: 'done',
      at: new Date(now()).toISOString(),
      outcome,
    };
    d.journal.put(entry);
    if (!(await report(entry)))
      log(
        `[lab-chat] output: outcome of ${step.step_id} kept in the journal (Core unreachable)`,
      );
    return {
      kind: outcome.event === 'succeeded' ? 'sent' : outcome.event,
      step_id: step.step_id,
    };
  }

  let stopped = false;
  /** Loop: immediately after a send, otherwise after the wait Core / the limiter asked for. */
  async function run() {
    while (!stopped) {
      let delay = 1000;
      try {
        const r = await tick();
        if (r.kind !== 'idle') delay = 0;
        else if (r.retry_in_ms !== undefined)
          delay = Math.min(Math.max(r.retry_in_ms, 50), 5000);
        else if (r.reason === 'busy') delay = 250;
      } catch (e) {
        log('[lab-chat] output tick failed', (e as Error).message);
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { tick, recover, run, stop: () => (stopped = true) };
}
