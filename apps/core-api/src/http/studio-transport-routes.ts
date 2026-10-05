import {
  BonkLabAckRequest,
  BonkLabClaimRequest,
  BonkLabHeartbeat,
  SoundLabAckRequest,
  SoundLabClaimRequest,
  SoundLabHeartbeat,
  TtsLabAckRequest,
  TtsLabClaimRequest,
  TtsLabHeartbeat,
} from '@raptoru/schemas';
import { z } from 'zod';
import type { BonkLabService } from '../bonk-lab/bonk-lab-service.js';
import type { SoundLabService } from '../sound-lab/sound-lab-service.js';
import type { TtsLabService } from '../tts-lab/tts-lab-service.js';
import { STUDIO_PROTOCOL } from '../studio/installations.js';
import { mapped as bonkMapped } from './bonk-lab-routes.js';
import { mapped as soundMapped } from './sound-lab-routes.js';
import { mapped as ttsMapped } from './tts-lab-routes.js';
import { HttpError, parse, type Route } from './server.js';

// ASTRA-P1-019: execution routes of the future production transport (Studio → Core over HTTPS),
// for Bonk (lot 1), Soundboard and TTS (lot 2). Only a Studio installation credential reaches them
// (never STUDIO_SECRET, never an extension JWT); the protocol version is checked first. The Studio
// instance is the authenticated installation: a body naming another instance is refused, so nobody
// acts for another Studio. Same sub-paths as the Lab routes (the Studio workers only swap their base),
// same Core services, claim / ACK / STOP semantics and guarantees (payment stays simulated).

const Uuid = z.uuid();

/** Validated body (400 if malformed) that must name the authenticated installation (403 if not). */
function ownBody<T extends { studio_instance_id: string }>(
  installation: string,
  schema: z.ZodType<T>,
  body: unknown,
): T {
  const req = parse(schema, body);
  if (req.studio_instance_id !== installation)
    throw new HttpError(403, { error: 'studio_instance_mismatch' });
  return req;
}

/** What the execution protocol needs from a module service (Bonk, Soundboard, TTS share it). */
interface ExecutionService<H, A> {
  heartbeat(h: H): Promise<unknown>;
  claim(studioInstanceId: string, channelId: string): Promise<unknown>;
  get(
    interactionId: string,
  ): Promise<{ delivery: { studio_instance_id: string | null } }>;
  ack(interactionId: string, a: A): Promise<unknown>;
}

function executionRoutes<
  H extends { studio_instance_id: string },
  C extends { studio_instance_id: string; channel_id: string },
  A extends { studio_instance_id: string },
>(
  module: 'bonk' | 'sound' | 'tts',
  service: ExecutionService<H, A>,
  schemas: { heartbeat: z.ZodType<H>; claim: z.ZodType<C>; ack: z.ZodType<A> },
  mapped: <T>(fn: () => Promise<T>) => Promise<T>,
): Route[] {
  const base = `^\\/v1\\/studio\\/${module}`;
  return [
    {
      method: 'POST',
      pattern: new RegExp(`${base}\\/studio\\/heartbeat$`),
      auth: 'studio_installation',
      handle: ({ body, installation }) =>
        mapped(() =>
          service.heartbeat(ownBody(installation!, schemas.heartbeat, body)),
        ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${base}\\/claim$`),
      auth: 'studio_installation',
      handle: ({ body, installation }) =>
        mapped(async () => {
          const req = ownBody(installation!, schemas.claim, body);
          return {
            interaction: await service.claim(installation!, req.channel_id),
          };
        }),
    },
    {
      // Only an interaction this installation holds: any other one is « not found ».
      method: 'GET',
      pattern: new RegExp(`${base}\\/interactions\\/([^/]+)$`),
      auth: 'studio_installation',
      handle: ({ params, installation }) =>
        mapped(async () => {
          const interaction = await service.get(parse(Uuid, params[0]));
          if (interaction.delivery.studio_instance_id !== installation)
            throw new HttpError(404, { error: 'interaction_not_found' });
          return interaction;
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${base}\\/interactions\\/([^/]+)\\/ack$`),
      auth: 'studio_installation',
      handle: ({ params, body, installation }) =>
        mapped(() =>
          service.ack(
            parse(Uuid, params[0]),
            ownBody(installation!, schemas.ack, body),
          ),
        ),
    },
  ];
}

export function studioTransportRoutes(services: {
  bonk?: BonkLabService;
  sound?: SoundLabService;
  tts?: TtsLabService;
}): Route[] {
  return [
    {
      // Handshake: credential and protocol accepted (the Studio checks it on (re)connection).
      method: 'GET',
      pattern: /^\/v1\/studio\/session$/,
      auth: 'studio_installation',
      handle: async ({ installation }) => ({
        installation_id: installation,
        protocol: STUDIO_PROTOCOL.current,
      }),
    },
    ...(services.bonk
      ? executionRoutes(
          'bonk',
          services.bonk,
          {
            heartbeat: BonkLabHeartbeat,
            claim: BonkLabClaimRequest,
            ack: BonkLabAckRequest,
          },
          bonkMapped,
        )
      : []),
    ...(services.sound
      ? executionRoutes(
          'sound',
          services.sound,
          {
            heartbeat: SoundLabHeartbeat,
            claim: SoundLabClaimRequest,
            ack: SoundLabAckRequest,
          },
          soundMapped,
        )
      : []),
    ...(services.tts
      ? executionRoutes(
          'tts',
          services.tts,
          {
            heartbeat: TtsLabHeartbeat,
            claim: TtsLabClaimRequest,
            ack: TtsLabAckRequest,
          },
          ttsMapped,
        )
      : []),
  ];
}
