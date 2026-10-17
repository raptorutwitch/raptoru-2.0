import {
  AlertAckRequest,
  AlertClaimRequest,
  AlertEventInput,
} from '@raptoru/schemas';
import { AlertError, type AlertsService } from '../alerts/service.js';
import { ALERT_VARIANTS } from '../alerts/variants.js';
import { HttpError, parse, type Route } from './server.js';

// Twitch alerts V1 — the routes of the ONE alerts implementation, served twice with the same sub-paths:
// - Lab Core: /v1/lab/alerts/* (Studio secret, Lab database);
// - production Core (17/10/2026, § 22): /v1/studio/alerts/* behind a Studio installation credential (like the Bonk /
//   Soundboard / TTS transport), for the Core's single channel only; a Studio may post simulated or external
//   (StreamElements) events, never « twitch » ones (those come from the bot).
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
): Route[] {
  const base = production ? '/v1/studio/alerts' : '/v1/lab/alerts';
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
      handle: async () => ({ variants: Object.values(ALERT_VARIANTS) }),
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
        return alerts.receive(event);
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
  ];
}
