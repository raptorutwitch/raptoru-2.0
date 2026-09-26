import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { LoyaltyEvent } from '@raptoru/schemas';

// Durable outbox of the loyalty events received from EventSub. An event is written here BEFORE it
// is sent to Core and removed only once Core has answered (accepted, replayed or refused), so a bot
// restart while Core is down never loses it. Core is idempotent per event id: resending is safe.

export interface OutboxEntry {
  event: LoyaltyEvent;
  /** Twitch time of the EventSub message (metadata.message_timestamp). */
  receivedAt: string;
  /** EventSub session that received it. */
  session: string;
}

export interface RejectedEntry extends OutboxEntry {
  rejectedAt: string;
  reason: string;
}

export interface LoyaltyOutbox {
  pending(): OutboxEntry[];
  /** No-op if this event id is already pending. */
  add(entry: OutboxEntry): void;
  remove(eventId: string): void;
  /** Definitive refusal: removed from pending, kept (bounded) for traceability. */
  reject(entry: OutboxEntry, reason: string, at: Date): void;
  rejected(): RejectedEntry[];
}

const MAX_REJECTED = 1000;

interface State {
  pending: OutboxEntry[];
  rejected: RejectedEntry[];
}

function createOutbox(
  state: State,
  persist: (s: State) => void,
): LoyaltyOutbox {
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

export function memoryOutbox(): LoyaltyOutbox {
  return createOutbox({ pending: [], rejected: [] }, () => {});
}

/**
 * JSON file, rewritten atomically (temp file + rename) on every change. An unreadable file stops
 * the loyalty events instead of being silently replaced (it may hold unsent events).
 */
export function fileOutbox(path: string): LoyaltyOutbox {
  const state: State = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as State)
    : { pending: [], rejected: [] };
  if (!Array.isArray(state.pending) || !Array.isArray(state.rejected))
    throw new Error(`loyalty outbox ${path} is not valid`);
  return createOutbox(state, (s) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(s));
    renameSync(`${path}.tmp`, path);
  });
}
