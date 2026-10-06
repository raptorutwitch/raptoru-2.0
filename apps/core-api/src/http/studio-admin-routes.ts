import { z } from 'zod';
import {
  StudioPairingError,
  type StudioInstallations,
} from '../studio/installations.js';
import { HttpError, parse, type Route } from './server.js';

// Operator actions on the Studio installations (ASTRA-P1-019), over HTTPS with the Core's operator
// secret (STUDIO_SECRET) — the same actions as scripts/studio-installation.ts, without a shell in the
// container: pair a Studio (its pairing code is not a secret), list, revoke. Never a Studio secret
// in or out: Core only ever stores the SHA-256 of an installation secret.

const PairRequest = z.strictObject({
  pairing_code: z.string().min(1).max(200),
  label: z.string().min(1).max(80),
});
const Uuid = z.uuid();

export function studioAdminRoutes(installations: StudioInstallations): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/studio\/installations\/pair$/,
      auth: 'studio',
      handle: async ({ body }) => {
        const req = parse(PairRequest, body);
        try {
          return await installations.register(req.pairing_code, req.label);
        } catch (error) {
          if (error instanceof StudioPairingError)
            throw new HttpError(409, {
              error: 'pairing_refused',
              message: error.message,
            });
          throw error;
        }
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/studio\/installations$/,
      auth: 'studio',
      handle: async () => ({ installations: await installations.list() }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/studio\/installations\/([^/]+)\/revoke$/,
      auth: 'studio',
      handle: async ({ params }) => {
        const id = parse(Uuid, params[0]);
        if (!(await installations.revoke(id)))
          throw new HttpError(404, { error: 'unknown_installation' });
        return { revoked: id };
      },
    },
  ];
}
