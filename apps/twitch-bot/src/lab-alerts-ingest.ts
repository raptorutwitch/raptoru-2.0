import { normalizeAlertEvent } from './alert-events.js';
import { type LabCorePost, transient } from './lab-chat-ingest.js';
import {
  memoryOutbox,
  type Outbox,
  type OutboxEntry,
} from './loyalty-outbox.js';

// Twitch alerts — real events (17/10/2026, Lab). An input adapter on the Lab chat adapter's EventSub connection (the
// ONE Twitch connection of the Lab, LeCroupier_'s token): no second connection, token or process. Studio's mode,
// given at start (LAB_ALERTS_MODE; a change restarts the adapter):
// - off (default): no alert subscription is created, nothing is read for the alerts;
// - test: subscribed and normalized, written to the adapter log (shown in Studio), NEVER sent to Core: nothing is
//   queued, nothing can be displayed;
// - active: sent to the Lab Core (POST /v1/lab/alerts/events): deduplicated there by the Twitch id, variant drawn
//   once, queued in its family; it plays in the OBS source connected to Studio Lab.
// Delivery to Core (19/10/2026, durable): an alert received from Twitch is written to the outbox file BEFORE it is sent
// and removed only once Core answered (queued, replayed or refused) — a restart of the adapter or a Core down for a
// long time never loses it (a sub also decides a Roue du Sub gain). Resent with the SAME id (Core deduplicates); the
// Twitch time of the message travels as occurred_at. A refusal (4xx) is kept, bounded, for traceability. What cannot
// be guaranteed: an event Twitch sends while no WebSocket session is open is never received (Twitch does not replay a
// lost WebSocket session).

export const ALERTS_MODES = ['off', 'test', 'active'] as const;
export type AlertsMode = (typeof ALERTS_MODES)[number];

/** Scope a moderator token needs for channel.follow v2 (not held by LeCroupier_'s token on 17/10/2026). */
export const FOLLOW_SCOPE = 'moderator:read:followers';

/** Backoff between two sends of a pending alert (the last delay repeats: kept until Core answers). */
export const ALERT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];

/** One alert waiting for Core, as stored in the outbox. */
export interface AlertOutboxEvent {
  /** The Twitch id of the alert (source_event_id). */
  eventId: string;
  body: Record<string, unknown>;
  label: string;
}

export interface LabAlertsIngestDeps {
  mode: AlertsMode;
  /** The alerts channel of the Lab Core (Studio's alerts runtime). */
  channelId: string;
  broadcasterId: string;
  /** Owner of the reading token (LeCroupier_) and its scopes. */
  tokenUserId: string;
  scopes: string[];
  lab: LabCorePost;
  /** Durable outbox (the Lab adapter: a JSON file); in memory by default (tests). */
  outbox?: Outbox<AlertOutboxEvent>;
  log?: (...args: unknown[]) => void;
  now?: () => number;
}

export function createLabAlertsIngest(d: LabAlertsIngestDeps) {
  const log = d.log ?? console.log;
  const now = d.now ?? Date.now;
  const outbox = d.outbox ?? memoryOutbox<AlertOutboxEvent>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const sending = new Set<string>();

  /** One send of a stored alert; a transient failure schedules the next one (never blocks EventSub). */
  const attempt = async (
    entry: OutboxEntry<AlertOutboxEvent>,
    n: number,
  ): Promise<void> => {
    const { eventId, body, label } = entry.event;
    try {
      const out = (await d.lab('/v1/lab/alerts/events', body)) as {
        outcome?: string;
      };
      outbox.remove(eventId);
      sending.delete(eventId);
      log(`[lab-alerts] ${label} → ${out.outcome ?? '?'}`);
    } catch (error) {
      const reason = (error as Error).message;
      if (!transient(error)) {
        outbox.reject(entry, reason, new Date(now()));
        sending.delete(eventId);
        log(
          `[lab-alerts] ${label} refusée par Core (${reason}), gardée dans le journal des refus`,
        );
        return;
      }
      const delay =
        ALERT_RETRY_DELAYS_MS[Math.min(n, ALERT_RETRY_DELAYS_MS.length - 1)]!;
      log(
        `[lab-alerts] ${label} : Core indisponible (${reason}), gardée, nouvel essai dans ${delay / 1000} s`,
      );
      const timer = setTimeout(() => {
        retries.delete(eventId);
        void attempt(entry, n + 1);
      }, delay);
      retries.set(eventId, timer);
    }
  };
  const send = async (entry: OutboxEntry<AlertOutboxEvent>) => {
    if (sending.has(entry.event.eventId)) return;
    sending.add(entry.event.eventId);
    await attempt(entry, 0);
  };

  return {
    /** EventSub subscriptions of the alerts (none when OFF). Bits come from channel.chat.message, already there. */
    subscriptions() {
      if (d.mode === 'off') return [];
      const subs: {
        type: string;
        version: string;
        condition: Record<string, string>;
      }[] = [
        {
          type: 'channel.chat.notification',
          version: '1',
          condition: {
            broadcaster_user_id: d.broadcasterId,
            user_id: d.tokenUserId,
          },
        },
      ];
      if (d.scopes.includes(FOLLOW_SCOPE))
        subs.push({
          type: 'channel.follow',
          version: '2',
          condition: {
            broadcaster_user_id: d.broadcasterId,
            moderator_user_id: d.tokenUserId,
          },
        });
      else
        log(
          `[lab-alerts] follows non reçus : le jeton n'a pas le scope ${FOLLOW_SCOPE}`,
        );
      return subs;
    },
    /** A notification of an alert source (chat notice, follow, chat message with a cheer). Never throws. */
    async handle(
      type: string,
      event: Record<string, unknown>,
      messageId: string,
      /** Twitch time of the EventSub message (metadata.message_timestamp). */
      timestamp?: string,
    ) {
      if (d.mode === 'off') return;
      let entry: OutboxEntry<AlertOutboxEvent>;
      try {
        const out = normalizeAlertEvent(type, event, messageId);
        if (!out) return;
        const who = out.actor?.display_name ?? 'anonyme';
        const label = `${out.type} ${who} (${out.source_event_id})`;
        if (d.mode === 'test') {
          log(`[lab-alerts] TEST, non admis : ${label}`);
          return;
        }
        const occurredAt = out.occurred_at ?? timestamp;
        entry = {
          event: {
            eventId: out.source_event_id,
            body: {
              channel_id: d.channelId,
              ...out,
              ...(occurredAt ? { occurred_at: occurredAt } : {}),
            },
            label,
          },
          receivedAt: timestamp ?? new Date(now()).toISOString(),
          session: 'lab',
        };
      } catch (error) {
        log(`[lab-alerts] ${type} ignoré`, (error as Error).message);
        return;
      }
      // Durable BEFORE it is sent (an unwritable outbox throws: the alert is not taken in silently).
      outbox.add(entry);
      await send(entry);
    },
    /** At start: sends what a previous run left unanswered (same ids: Core deduplicates). */
    async resumePending() {
      if (d.mode !== 'active') return;
      const left = outbox.pending();
      if (left.length)
        log(`[lab-alerts] reprise de ${left.length} alerte(s) en attente`);
      for (const entry of left) await send(entry);
    },
    pendingRetries: () => retries.size,
    pending: () => outbox.pending().length,
    close() {
      const kept = outbox.pending().length;
      if (kept)
        log(
          `[lab-alerts] ${kept} alerte(s) en attente gardée(s) pour la reprise`,
        );
      for (const t of retries.values()) clearTimeout(t);
      retries.clear();
      sending.clear();
    },
  };
}

export type LabAlertsIngest = ReturnType<typeof createLabAlertsIngest>;
