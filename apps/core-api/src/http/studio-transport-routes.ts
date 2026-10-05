import {
  BonkLabAckRequest,
  BonkLabClaimRequest,
  BonkLabHeartbeat,
} from '@raptoru/schemas';
import { z } from 'zod';
import type { BonkLabService } from '../bonk-lab/bonk-lab-service.js';
import { STUDIO_PROTOCOL } from '../studio/installations.js';
import { mapped } from './bonk-lab-routes.js';
import { HttpError, parse, type Route } from './server.js';

// ASTRA-P1-019 (lot 1): execution routes of the future production transport (Studio → Core over
// HTTPS). Only a Studio installation credential reaches them (never STUDIO_SECRET, never an
// extension JWT); the protocol version is checked first. The Studio instance is the authenticated
// installation: a body naming another instance is refused, so nobody acts for another Studio.
// Same Core services, claim / ACK semantics and guarantees as the Lab routes (payment stays simulated).

const Uuid = z.uuid();

function sameInstance(installation: string, body: unknown) {
  const claimed = (body as { studio_instance_id?: unknown } | null)
    ?.studio_instance_id;
  if (claimed !== installation)
    throw new HttpError(403, { error: 'studio_instance_mismatch' });
}

export function studioTransportRoutes(bonk: BonkLabService): Route[] {
  return [
    {
      // Handshake: credential and protocol accepted (the Studio logs it on (re)connection).
      method: 'GET',
      pattern: /^\/v1\/studio\/session$/,
      auth: 'studio_installation',
      handle: async ({ installation }) => ({
        installation_id: installation,
        protocol: STUDIO_PROTOCOL.current,
      }),
    },
    {
      method: 'POST',
      // Same sub-paths as the Lab routes: the Studio worker only swaps its base.
      pattern: /^\/v1\/studio\/bonk\/studio\/heartbeat$/,
      auth: 'studio_installation',
      handle: ({ body, installation }) =>
        mapped(() => {
          sameInstance(installation!, body);
          return bonk.heartbeat(parse(BonkLabHeartbeat, body));
        }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/studio\/bonk\/claim$/,
      auth: 'studio_installation',
      handle: ({ body, installation }) =>
        mapped(async () => {
          sameInstance(installation!, body);
          const req = parse(BonkLabClaimRequest, body);
          return {
            interaction: await bonk.claim(installation!, req.channel_id),
          };
        }),
    },
    {
      // Only an interaction this installation holds: any other one is « not found ».
      method: 'GET',
      pattern: /^\/v1\/studio\/bonk\/interactions\/([^/]+)$/,
      auth: 'studio_installation',
      handle: ({ params, installation }) =>
        mapped(async () => {
          const interaction = await bonk.get(parse(Uuid, params[0]));
          if (interaction.delivery.studio_instance_id !== installation)
            throw new HttpError(404, { error: 'interaction_not_found' });
          return interaction;
        }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/studio\/bonk\/interactions\/([^/]+)\/ack$/,
      auth: 'studio_installation',
      handle: ({ params, body, installation }) =>
        mapped(() => {
          sameInstance(installation!, body);
          return bonk.ack(
            parse(Uuid, params[0]),
            parse(BonkLabAckRequest, body),
          );
        }),
    },
  ];
}
