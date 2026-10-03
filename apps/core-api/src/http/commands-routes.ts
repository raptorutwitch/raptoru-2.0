import {
  CmdCreateRequest,
  CmdOutputRequest,
  CmdStepAckRequest,
  CmdStepClaimRequest,
  CmdRightsRequest,
  CmdTestRequest,
  CmdUpdateRequest,
  CmdVersionedRequest,
  LabRole,
} from '@raptoru/schemas';
import { z } from 'zod';
import type { CommandsAdmission } from '../commands/admission.js';
import { CommandsError } from '../commands/model.js';
import type { CommandsService } from '../commands/service.js';
import type { CommandSteps, StepStatus } from '../commands/steps.js';
import type { Actor } from '../lab-moderation/store.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// Commands V2 (Lab) — configuration API (phase A). Registered by the Lab Core only (local,
// secret-protected, Lab database). Reads name their reader like the moderation console (`as`,
// `as_role` from the extension façade; none = Studio = streamer); writes carry the actor. Core
// decides the effective role and every right.

const Digits = z.string().regex(/^\d{1,32}$/);
const Uuid = z.string().regex(/^[0-9a-f-]{36}$/);
const StepStatusParam = z
  .enum([
    'queued',
    'claimed',
    'running',
    'succeeded',
    'failed',
    'unknown',
    'expired',
    'cancelled',
    'skipped',
  ] satisfies StepStatus[])
  .optional();
const BASE = String.raw`^\/v1\/lab\/commands\/([^/]+)`;

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CommandsError)
      throw new HttpError(error.status, {
        error: error.code,
        ...error.details,
      });
    throw error;
  }
}

/** The reader of a GET: the extension façade names it; Studio does not (streamer). */
function reader(url: URL): Actor {
  const id = url.searchParams.get('as');
  if (!id) return { id: 'studio', role: 'broadcaster', via: 'studio' };
  return {
    id: parse(Digits, id),
    role: parse(LabRole, url.searchParams.get('as_role') ?? 'viewer'),
    via: 'extension',
  };
}

export function commandsRoutes(
  commands: CommandsService,
  admission: CommandsAdmission,
  steps: CommandSteps,
): Route[] {
  const channel = (params: string[]) => parse(Digits, params[0]);
  const id = (params: string[]) => parse(Uuid, params[1]);
  return [
    // Phase C — durable steps: « Sortie chat réelle » (OFF by default), executor claim / ACK, debug list.
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}/output$`),
      auth: 'studio',
      handle: ({ params }) => steps.output(channel(params)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}/output$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => {
          const req = parse(CmdOutputRequest, body);
          return steps.setOutput(channel(params), req.actor, req.enabled);
        }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}/steps$`),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => {
          const inv = url.searchParams.get('invocation_id');
          return steps.list(channel(params), reader(url), {
            status:
              parse(
                StepStatusParam,
                url.searchParams.get('status') ?? undefined,
              ) ?? null,
            invocationId: inv ? parse(Uuid, inv) : null,
            limit: limitParam(url, 50, 200),
          });
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}/steps/claim$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        steps.claim(
          channel(params),
          parse(CmdStepClaimRequest, body).executor_id,
        ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}/steps/([0-9a-f-]{36})/ack$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          steps.ack(
            channel(params),
            id(params),
            parse(CmdStepAckRequest, body),
          ),
        ),
    },
    // Phase B — admission: public list (viewer fields), diagnostic of the invocations, « Tester ».
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}/public$`),
      auth: 'studio',
      handle: ({ params }) => admission.publicList(channel(params)),
    },
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}/invocations$`),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => {
          const cmd = url.searchParams.get('command_id');
          return admission.invocations(
            channel(params),
            reader(url),
            cmd ? parse(Uuid, cmd) : null,
            limitParam(url, 50, 200),
          );
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}/test$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          admission.test(channel(params), parse(CmdTestRequest, body)),
        ),
    },
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}$`),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => commands.list(channel(params), reader(url))),
    },
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}/rights$`),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => commands.rights(channel(params), reader(url))),
    },
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}/history$`),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() =>
          commands.history(
            channel(params),
            null,
            reader(url),
            limitParam(url, 50, 200),
          ),
        ),
    },
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}/([0-9a-f-]{36})$`),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => commands.get(channel(params), id(params), reader(url))),
    },
    {
      method: 'GET',
      pattern: new RegExp(`${BASE}/([0-9a-f-]{36})/history$`),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() =>
          commands.history(
            channel(params),
            id(params),
            reader(url),
            limitParam(url, 50, 200),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => {
          const req = parse(CmdCreateRequest, body);
          return commands.create(channel(params), req.actor, req.config);
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}/rights$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => {
          const req = parse(CmdRightsRequest, body);
          return commands.setRights(
            channel(params),
            req.actor,
            req.role,
            req.expected_version,
            req.rights,
          );
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}/([0-9a-f-]{36})/update$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => {
          const req = parse(CmdUpdateRequest, body);
          return commands.update(
            channel(params),
            id(params),
            req.actor,
            req.expected_version,
            req.changes,
          );
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}/([0-9a-f-]{36})/delete$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => {
          const req = parse(CmdVersionedRequest, body);
          return commands.remove(
            channel(params),
            id(params),
            req.actor,
            req.expected_version,
          );
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`${BASE}/([0-9a-f-]{36})/reset$`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => {
          const req = parse(CmdVersionedRequest, body);
          return commands.reset(
            channel(params),
            id(params),
            req.actor,
            req.expected_version,
          );
        }),
    },
  ];
}
