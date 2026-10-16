import {
  AlertAckRequest,
  AlertClaimRequest,
  AlertEventInput,
} from '@raptoru/schemas';
import { AlertError, type AlertsService } from '../alerts/service.js';
import { ALERT_VARIANTS } from '../alerts/variants.js';
import { HttpError, parse, type Route } from './server.js';

// Twitch alerts V1 (Lab) — routes of the Lab Core only (Bearer secret, Lab database; never the production or public
// Core): normalized events in (Twitch Bot, simulator, future donation adapter), supervision, claim and ACK (Studio).

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AlertError)
      throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

export function alertsRoutes(alerts: AlertsService): Route[] {
  return [
    {
      // The variant catalogue (Studio preview: renders a variant without touching the queue).
      method: 'GET',
      pattern: /^\/v1\/lab\/alerts\/catalog$/,
      auth: 'studio',
      handle: async () => ({ variants: Object.values(ALERT_VARIANTS) }),
    },
    {
      // One normalized event (deduplicated by source + id); `source: simulation` for tests.
      method: 'POST',
      pattern: /^\/v1\/lab\/alerts\/events$/,
      auth: 'studio',
      handle: async ({ body }) => alerts.receive(parse(AlertEventInput, body)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/alerts\/(\d{1,32})\/state$/,
      auth: 'studio',
      handle: ({ params }) => alerts.state(params[0]!),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/alerts\/items\/([0-9a-f-]{36})$/,
      auth: 'studio',
      handle: ({ params }) => mapped(() => alerts.get(params[0]!)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/alerts\/(\d{1,32})\/claim$/,
      auth: 'studio',
      handle: async ({ params, body }) => ({
        alert: await alerts.claim(
          params[0]!,
          parse(AlertClaimRequest, body).consumer_id,
        ),
      }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/lab\/alerts\/items\/([0-9a-f-]{36})\/ack$/,
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => alerts.ack(params[0]!, parse(AlertAckRequest, body))),
    },
  ];
}
