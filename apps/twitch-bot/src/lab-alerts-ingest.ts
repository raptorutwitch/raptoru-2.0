import { normalizeAlertEvent } from './alert-events.js';
import { type LabCorePost, transient } from './lab-chat-ingest.js';

// Twitch alerts — real events (17/10/2026, Lab). An input adapter on the Lab chat adapter's EventSub connection (the
// ONE Twitch connection of the Lab, LeCroupier_'s token): no second connection, token or process. Studio's mode,
// given at start (LAB_ALERTS_MODE; a change restarts the adapter):
// - off (default): no alert subscription is created, nothing is read for the alerts;
// - test: subscribed and normalized, written to the adapter log (shown in Studio), NEVER sent to Core: nothing is
//   queued, nothing can be displayed;
// - active: sent to the Lab Core (POST /v1/lab/alerts/events): deduplicated there by the Twitch id, variant drawn
//   once, queued in its family; it plays in the OBS source connected to Studio Lab.
// Delivery to Core: retried in memory with the SAME id (Core deduplicates), dropped after 90 s or when the adapter
// stops. Not durable: Twitch itself does not replay the events of a lost WebSocket session either.

export const ALERTS_MODES = ['off', 'test', 'active'] as const;
export type AlertsMode = (typeof ALERTS_MODES)[number];

/** Scope a moderator token needs for channel.follow v2 (not held by LeCroupier_'s token on 17/10/2026). */
export const FOLLOW_SCOPE = 'moderator:read:followers';

export const ALERT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
export const ALERT_RETRY_TTL_MS = 90_000;

export interface LabAlertsIngestDeps {
  mode: AlertsMode;
  /** The alerts channel of the Lab Core (Studio's alerts runtime). */
  channelId: string;
  broadcasterId: string;
  /** Owner of the reading token (LeCroupier_) and its scopes. */
  tokenUserId: string;
  scopes: string[];
  lab: LabCorePost;
  log?: (...args: unknown[]) => void;
  now?: () => number;
}

export function createLabAlertsIngest(d: LabAlertsIngestDeps) {
  const log = d.log ?? console.log;
  const now = d.now ?? Date.now;
  const retries = new Set<ReturnType<typeof setTimeout>>();

  /** One alert event to Core; transient failures are retried in the background (never blocks EventSub). */
  const forward = async (event: Record<string, unknown>, label: string) => {
    const receivedAt = now();
    let attempt = 0;
    const send = async (): Promise<void> => {
      try {
        const out = (await d.lab('/v1/lab/alerts/events', event)) as {
          outcome?: string;
        };
        log(`[lab-alerts] ${label} → ${out.outcome ?? '?'}`);
      } catch (error) {
        const reason = (error as Error).message;
        const delay = ALERT_RETRY_DELAYS_MS[attempt];
        if (
          !transient(error) ||
          delay === undefined ||
          now() + delay - receivedAt > ALERT_RETRY_TTL_MS
        ) {
          log(`[lab-alerts] ${label} perdu (Core : ${reason})`);
          return;
        }
        attempt += 1;
        const timer = setTimeout(() => {
          retries.delete(timer);
          void send();
        }, delay);
        retries.add(timer);
      }
    };
    await send();
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
    ) {
      if (d.mode === 'off') return;
      try {
        const out = normalizeAlertEvent(type, event, messageId);
        if (!out) return;
        const who = out.actor?.display_name ?? 'anonyme';
        const label = `${out.type} ${who} (${out.source_event_id})`;
        if (d.mode === 'test') {
          log(`[lab-alerts] TEST, non admis : ${label}`);
          return;
        }
        await forward({ channel_id: d.channelId, ...out }, label);
      } catch (error) {
        log(`[lab-alerts] ${type} ignoré`, (error as Error).message);
      }
    },
    pendingRetries: () => retries.size,
    close() {
      if (retries.size)
        log(`[lab-alerts] ${retries.size} alerte(s) en attente abandonnée(s)`);
      for (const t of retries) clearTimeout(t);
      retries.clear();
    },
  };
}

export type LabAlertsIngest = ReturnType<typeof createLabAlertsIngest>;
