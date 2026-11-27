import {
  ChaosAckRequest,
  ChaosClaimRequest,
  ChaosHeartbeat,
  ChaosLabBuyRequest,
  ChaosLabQuoteRequest,
  ChaosStopAllRequest,
} from '@raptoru/schemas';
import { z } from 'zod';
import { ChaosError, type ChaosService } from '../chaos/service.js';
import { LabWalletError } from '../lab-moderation/store.js';
import { ModuleSettingsError } from '../module-settings/service.js';
import { HttpError, parse, type Route } from './server.js';

// Chaos V2 lot 2 (docs/chaos/CONTRAT_LOT2.md § 2.4) — the Lab routes `/v1/lab/chaos/<channel>/…` (STUDIO_SECRET): the
// Lab Studio's execution loop, and in-process the viewer façade (/v1/ext/chaos/*, ext/chaos-ext.ts), which names the
// verified JWT viewer in the body. Production's Studio uses /v1/studio/chaos/* (studio-transport-routes.ts).

const Digits = z.string().regex(/^\d{1,32}$/);
const Uuid = z.uuid();

/** Every refusal as an explicit HTTP answer `{ error, code, message, …details }`. */
export async function mappedChaos<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ChaosError)
      throw new HttpError(error.status, {
        ...error.details,
        error: error.code,
        code: error.code,
        message: error.message,
      });
    if (error instanceof LabWalletError)
      throw new HttpError(409, {
        ...error.details,
        error: error.code,
        code: error.code,
      });
    if (error instanceof ModuleSettingsError)
      throw new HttpError(error.status, {
        error: error.code,
        code: error.code,
      });
    throw error;
  }
}

/** Studio › Chaos › Tarifs: one effect's range, or back to its default (the Core checks the amounts). */
const PricesRequest = z.union([
  z.strictObject({ effect: z.string().max(32), reset: z.literal(true) }),
  z.strictObject({
    effect: z.string().max(32),
    min: z.number(),
    max: z.number(),
  }),
]);

const viewerOf = (url: URL) => {
  const id = url.searchParams.get('viewer_id');
  if (!id) return null;
  return {
    id: parse(Digits, id),
    display_name: (url.searchParams.get('viewer_name') ?? id).slice(0, 64),
  };
};

export function chaosLabRoutes(chaos: ChaosService): Route[] {
  const base = '^\\/v1\\/lab\\/chaos\\/([^/]+)';
  const route = (
    method: 'GET' | 'POST',
    tail: string,
    fn: (
      channel: string,
      ctx: { body: unknown; url: URL; params: string[] },
    ) => Promise<unknown>,
  ): Route => ({
    method,
    pattern: new RegExp(`${base}${tail}$`),
    auth: 'studio',
    handle: ({ params, body, url }) =>
      mappedChaos(() => fn(parse(Digits, params[0]), { body, url, params })),
  });
  return [
    route('GET', '\\/state', (c, { url }) => chaos.state(c, viewerOf(url))),
    route('GET', '\\/summary', (c) => chaos.summary(c)),
    route('GET', '\\/moderation', (c) => chaos.moderationView(c)),
    // Studio › Chaos › Tarifs (Lab Studio; Production: the paired installation's cockpit, studio-cockpit-routes.ts).
    route('GET', '\\/prices', (c) => chaos.prices(c)),
    // Studio › Chaos header: the purchase switch's state and who may buy (read only).
    route('GET', '\\/access', (c) => chaos.access(c)),
    route('POST', '\\/prices', (c, { body }) =>
      chaos.setPrices(c, parse(PricesRequest, body), 'Studio'),
    ),
    route('POST', '\\/quote', (c, { body }) => {
      const req = parse(ChaosLabQuoteRequest, body);
      return chaos.quote(c, req.viewer ?? null, req);
    }),
    route('POST', '\\/buy', (c, { body }) =>
      chaos.buy(c, parse(ChaosLabBuyRequest, body)),
    ),
    route('POST', '\\/heartbeat', (c, { body }) =>
      chaos.heartbeat(c, parse(ChaosHeartbeat, body)),
    ),
    route('POST', '\\/claim', (c, { body }) => {
      const req = parse(ChaosClaimRequest, body);
      return chaos.claim(c, req.studio_instance_id, req.startable);
    }),
    route('POST', '\\/requests\\/([^/]+)\\/ack', (c, { body, params }) =>
      chaos.ack(c, parse(Uuid, params[1]), parse(ChaosAckRequest, body)),
    ),
    route('POST', '\\/stop-all', (c, { body }) =>
      chaos.stopAll(c, parse(ChaosStopAllRequest, body).studio_instance_id),
    ),
  ];
}
