import { LabActor } from '@raptoru/schemas';
import { z } from 'zod';
import { LabForbiddenError } from '../lab-moderation/store.js';
import { ModuleSettingsError } from '../module-settings/service.js';
import type { ModuleHost } from '../modules/host.js';
import { ModuleError } from '../modules/kit.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// The generic routes of the module host (docs/studio-refonte/architecture/CONTRATS.md): written ONCE for every module.
// Lab paths behind the Studio secret; on the main Core they are reached only in-process — by the Studio cockpit
// (`/v1/studio/cockpit/modules/<channel>/…`, the broadcaster's identity) and by the extension façade (the verified
// viewer) — never on public HTTP.

const Viewer = z.strictObject({
  id: z.string().regex(/^\d{1,32}$/),
  display_name: z.string().min(1).max(64),
});
const ViewerCall = z.strictObject({
  viewer: Viewer,
  idempotency_key: z.string().regex(/^[A-Za-z0-9_:-]{8,128}$/),
  input: z.unknown().optional(),
});
const AdminCall = z.strictObject({
  actor: LabActor,
  input: z.unknown().optional(),
});
const RefundCall = z.strictObject({
  actor: LabActor,
  activity_id: z.uuid(),
  reason: z.string().min(1).max(200),
});

/** ONE mapping of the module errors (no per-module wrapper). */
async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ModuleError)
      throw new HttpError(e.status, { error: e.code, ...e.details });
    if (e instanceof ModuleSettingsError)
      throw new HttpError(e.status, { error: e.code });
    if (e instanceof LabForbiddenError)
      throw new HttpError(403, {
        error: 'forbidden',
        permission: e.permission,
      });
    throw e;
  }
}

export function modulesRoutes(host: ModuleHost): Route[] {
  const at = (path: string) =>
    new RegExp(`^\\/v1\\/lab\\/modules\\/(\\d{1,32})${path}$`);
  const M = '\\/([a-z][a-z0-9_]{1,40})';
  const A = '\\/([a-z][a-z0-9_]{0,40})';
  return [
    {
      method: 'GET',
      pattern: at(''),
      auth: 'studio',
      handle: ({ params }) => mapped(() => host.catalog(params[0]!)),
    },
    {
      method: 'GET',
      pattern: at('\\/activity'),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() =>
          host.activity(params[0]!, {
            module: url.searchParams.get('module') ?? undefined,
            viewer: url.searchParams.get('viewer') ?? undefined,
            limit: limitParam(url, 50, 200),
          }),
        ),
    },
    {
      method: 'POST',
      pattern: at('\\/refund'),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() => host.refund(params[0]!, parse(RefundCall, body))),
    },
    {
      method: 'GET',
      pattern: at(`${M}\\/status`),
      auth: 'studio',
      handle: ({ params }) => mapped(() => host.status(params[0]!, params[1]!)),
    },
    {
      method: 'GET',
      pattern: at(`${M}\\/viewer-state`),
      auth: 'studio',
      handle: ({ params, url }) => {
        const id = url.searchParams.get('viewer_id');
        if (id !== null && !/^\d{1,32}$/.test(id))
          throw new HttpError(400, { error: 'invalid_viewer' });
        return mapped(() =>
          host.viewerState(
            params[0]!,
            params[1]!,
            id
              ? {
                  id,
                  display_name: (
                    url.searchParams.get('viewer_name') ?? id
                  ).slice(0, 64),
                }
              : null,
          ),
        );
      },
    },
    {
      method: 'POST',
      pattern: at(`${M}\\/admin${A}`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          host.admin(
            params[0]!,
            params[1]!,
            params[2]!,
            parse(AdminCall, body),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: at(`${M}\\/viewer${A}`),
      auth: 'studio',
      handle: ({ params, body }) =>
        mapped(() =>
          host.viewer(
            params[0]!,
            params[1]!,
            params[2]!,
            parse(ViewerCall, body),
          ),
        ),
    },
  ];
}
