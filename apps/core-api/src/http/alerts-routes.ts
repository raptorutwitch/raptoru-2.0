import {
  AlertAckRequest,
  AlertClaimRequest,
  AlertEventInput,
  AlertReceptionReport,
} from '@raptoru/schemas';
import { AlertError, type AlertsService } from '../alerts/service.js';
import { ALERT_VARIANTS, HALLOWEEN_VARIANTS } from '../alerts/variants.js';
import type { SubWheelService } from '../sub-wheel/service.js';
import { HttpError, parse, type Route } from './server.js';

// Twitch alerts V1 — the routes of the ONE alerts implementation, served twice with the same sub-paths:
// - Lab Core: /v1/lab/alerts/* (Studio secret, Lab database);
// - production Core (17/10/2026, § 22): /v1/studio/alerts/* behind a Studio installation credential (like the Bonk /
//   Soundboard / TTS transport), for the Core's single channel only; a Studio may post simulated or external
//   (StreamElements) events, never « twitch » ones: those come from the production bot (bot secret) on
//   /v1/bot/alerts/events (lot 8), the same contract as the Lab adapter's /v1/lab/alerts/events.
// Normalized events in (Twitch adapter, StreamElements, simulator), supervision, claim and ACK (Studio).

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AlertError)
      throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

export function alertsRoutes(
  alerts: AlertsService,
  /** Production: the Studio installation routes for this channel; absent: the Lab routes. */
  production?: { channelId: string },
  /** Roue du Sub: a Twitch sub / resub also asks for its wheel (idempotent, OFF by default: recorded « ignored »). */
  subWheel?: SubWheelService,
): Route[] {
  const base = production ? '/v1/studio/alerts' : '/v1/lab/alerts';
  let reception: (AlertReceptionReport & { reported_at: string }) | null = null;
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const at = (path: string) =>
    new RegExp('^' + (base + path).replaceAll('/', '\\/') + '$');
  /** Production: only the Core's channel (409 wrong_channel otherwise). */
  const channel = (id: string) => {
    if (production && id !== production.channelId)
      throw new HttpError(409, {
        error: 'wrong_channel',
        expected_channel_id: production.channelId,
      });
    return id;
  };
  /** Production: an alert of another channel is « not found ». */
  const own = async (id: string) => {
    const item = await alerts.get(id);
    if (production && item.channel_id !== production.channelId)
      throw new HttpError(404, { error: 'alert_not_found' });
    return item;
  };
  return [
    {
      // The variant catalogue (Studio preview: renders a variant without touching the queue).
      method: 'GET',
      pattern: at('/catalog'),
      auth,
      // The Halloween profile's variants too (docs/HALLOWEEN.md § 14): previewed and calibrated like the others.
      handle: async () => ({
        variants: [...Object.values(ALERT_VARIANTS), ...HALLOWEEN_VARIANTS],
      }),
    },
    {
      // One normalized event (deduplicated by source + id); `source: simulation` for tests.
      method: 'POST',
      pattern: at('/events'),
      auth,
      handle: async ({ body }) => {
        const event = parse(AlertEventInput, body);
        channel(event.channel_id);
        if (production && event.source === 'twitch')
          throw new HttpError(403, { error: 'twitch_events_from_bot_only' });
        const received = await alerts.receive(event);
        // A redelivery (duplicate) asks again: the same spin (and a spin missed by a failed first reception is made).
        if (subWheel)
          await subWheel.fromAlert(
            event,
            received.alert?.alert_id ?? null,
            alerts.isStale(event),
          );
        return received;
      },
    },
    {
      method: 'GET',
      pattern: at('/(\\d{1,32})/state'),
      auth,
      handle: ({ params }) => alerts.state(channel(params[0]!)),
    },
    {
      method: 'GET',
      pattern: at('/items/([0-9a-f-]{36})'),
      auth,
      handle: ({ params }) => mapped(() => own(params[0]!)),
    },
    {
      method: 'POST',
      pattern: at('/(\\d{1,32})/claim'),
      auth,
      handle: async ({ params, body }) => ({
        alert: await alerts.claim(
          channel(params[0]!),
          parse(AlertClaimRequest, body).consumer_id,
        ),
      }),
    },
    {
      method: 'POST',
      pattern: at('/items/([0-9a-f-]{36})/ack'),
      auth,
      handle: ({ params, body }) =>
        mapped(async () => {
          await own(params[0]!);
          return alerts.ack(params[0]!, parse(AlertAckRequest, body));
        }),
    },
    // Production: the real Twitch events, from the bot only (durable outbox there, deduplicated here by their id).
    ...(production
      ? [
          {
            method: 'POST' as const,
            pattern: /^\/v1\/bot\/alerts\/events$/,
            auth: 'bot' as const,
            handle: async ({ body }: { body: unknown }) => {
              const event = parse(AlertEventInput, body);
              channel(event.channel_id);
              if (event.source !== 'twitch')
                throw new HttpError(400, { error: 'twitch_source_required' });
              const received = await mapped(() => alerts.receive(event));
              // A redelivery asks again: the same spin (and a spin missed by a failed first reception is made).
              if (subWheel)
                await subWheel.fromAlert(
                  event,
                  received.alert?.alert_id ?? null,
                  alerts.isStale(event),
                );
              return received;
            },
          },
          {
            // Lot 9: the bot's reception (mode, subscriptions, outbox), kept in memory: Studio shows it.
            method: 'POST' as const,
            pattern: /^\/v1\/bot\/alerts\/status$/,
            auth: 'bot' as const,
            handle: async ({ body }: { body: unknown }) => {
              const report = parse(AlertReceptionReport, body);
              channel(report.channel_id);
              reception = {
                ...report,
                reported_at: alerts.now().toISOString(),
              };
              return { ok: true };
            },
          },
          {
            method: 'GET' as const,
            pattern: at('/(\\d{1,32})/reception'),
            auth,
            handle: async ({ params }: { params: string[] }) => {
              const id = channel(params[0]!);
              return {
                channel_id: id,
                /** Null: no report since this Core started (bot stopped, alerts and games OFF, or an older bot). */
                bot: reception && {
                  ...reception,
                  // Core's clock (Studio's may differ): reports come every minute while the bot runs.
                  age_ms:
                    alerts.now().getTime() - Date.parse(reception.reported_at),
                },
                last_twitch_event_at: await alerts.lastReceived(id, 'twitch'),
                max_age_ms: alerts.maxAgeMs,
              };
            },
          },
        ]
      : []),
  ];
}
