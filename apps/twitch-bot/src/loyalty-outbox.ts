import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { LoyaltyEvent } from '@raptoru/schemas';

// Durable outbox of the events received from EventSub (loyalty events; the Lab alerts, lab-alerts-ingest.ts). An
// event is written here BEFORE it is sent to Core and removed only once Core has answered (accepted, replayed or
// refused), so a restart while Core is down never loses it. Core is idempotent per event id: resending is safe.

/** Anything keyed by its Twitch event id. */
export interface OutboxEvent {
  eventId: string;
}

export interface OutboxEntry<E extends OutboxEvent = LoyaltyEvent> {
  event: E;
  /** Twitch time of the EventSub message (metadata.message_timestamp). */
  receivedAt: string;
  /** EventSub session that received it. */
  session: string;
}

export interface RejectedEntry<
  E extends OutboxEvent = LoyaltyEvent,
> extends OutboxEntry<E> {
  rejectedAt: string;
  reason: string;
}

export interface Outbox<E extends OutboxEvent> {
  pending(): OutboxEntry<E>[];
  /** No-op if this event id is already pending. */
  add(entry: OutboxEntry<E>): void;
  remove(eventId: string): void;
  /** Definitive refusal: removed from pending, kept (bounded) for traceability. */
  reject(entry: OutboxEntry<E>, reason: string, at: Date): void;
  rejected(): RejectedEntry<E>[];
}

export type LoyaltyOutbox = Outbox<LoyaltyEvent>;

const MAX_REJECTED = 1000;

interface State<E extends OutboxEvent> {
  pending: OutboxEntry<E>[];
  rejected: RejectedEntry<E>[];
}

function createOutbox<E extends OutboxEvent>(
  state: State<E>,
  persist: (s: State<E>) => void,
): Outbox<E> {
  return {
    pending: () => [...state.pending],
    add(entry) {
      if (state.pending.some((e) => e.event.eventId === entry.event.eventId))
        return;
      state.pending.push(entry);
      persist(state);
    },
    remove(eventId) {
      const before = state.pending.length;
      state.pending = state.pending.filter((e) => e.event.eventId !== eventId);
      if (state.pending.length !== before) persist(state);
    },
    reject(entry, reason, at) {
      state.pending = state.pending.filter(
        (e) => e.event.eventId !== entry.event.eventId,
      );
      state.rejected = [
        ...state.rejected,
        { ...entry, rejectedAt: at.toISOString(), reason },
      ].slice(-MAX_REJECTED);
      persist(state);
    },
    rejected: () => [...state.rejected],
  };
}

export function memoryOutbox<
  E extends OutboxEvent = LoyaltyEvent,
>(): Outbox<E> {
  return createOutbox<E>({ pending: [], rejected: [] }, () => {});
}

/**
 * JSON file, rewritten atomically (temp file + rename) on every change. An unreadable file stops
 * the loyalty events instead of being silently replaced (it may hold unsent events).
 */
export function fileOutbox<E extends OutboxEvent = LoyaltyEvent>(
  path: string,
): Outbox<E> {
  const state: State<E> = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as State<E>)
    : { pending: [], rejected: [] };
  if (!Array.isArray(state.pending) || !Array.isArray(state.rejected))
    throw new Error(`outbox ${path} is not valid`);
  return createOutbox<E>(state, (s) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(s));
    renameSync(`${path}.tmp`, path);
  });
}
