import { createHash } from 'node:crypto';
import { Agent, request } from 'node:https';
import type { CoreCall } from '../bonk-lab/worker.js';
import type { StudioInstallation } from './installation.js';

// ASTRA-P1-019 (lot 1): Studio → Core client of the future production transport. Separate from the
// Lab clients (localCoreClient & co, loopback HTTP, shared Lab secret), which stay unchanged.
// - HTTPS only, outbound only; certificate checked by Node's defaults. A test or private CA is
//   trusted for THIS client only (`ca`, replacing the default roots), never globally (no
//   NODE_TLS_REJECT_UNAUTHORIZED).
// - Every call carries the installation credential and the protocol version.
// - Redirects are refused (the credential is never re-sent elsewhere); bounded deadline and size.
// - Errors are typed so the Studio can say « mise à jour requise » or « Studio révoqué » instead of
//   a generic network error; they never carry headers or the secret.

export const STUDIO_PROTOCOL_VERSION = 1;
const PROTOCOL_HEADER = 'x-raptoru-studio-protocol';
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type StudioTransportCode =
  | 'protocol_incompatible'
  | 'studio_unauthorized'
  | 'studio_revoked'
  | 'core_unreachable'
  | 'tls_rejected'
  | 'redirect_refused'
  | 'invalid_response'
  | 'identity_mismatch';

export class StudioTransportError extends Error {
  constructor(
    readonly code: StudioTransportCode | string,
    message: string,
    /** HTTP status when Core answered (workers rely on 409 for idempotent ACK replays). */
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Certificate / TLS failures (Node `CERT_*`, `ERR_TLS_*`, `ERR_SSL_*`…): « tls_rejected », not « unreachable ». */
const TLS_CODE = /CERT|SSL|TLS/;

export function prodCoreClient(options: {
  url: string;
  installation: StudioInstallation;
  /**
   * Trust anchors for this client only (local test certificate, private CA). Like Node's `ca`, it
   * REPLACES the default roots: leave it unset for a Core behind a publicly trusted certificate.
   */
  ca?: string | Buffer;
  timeoutMs?: number;
  protocolVersion?: number;
}): CoreCall {
  const base = new URL(options.url);
  if (
    base.protocol !== 'https:' ||
    base.pathname !== '/' ||
    base.username ||
    base.password ||
    base.search
  )
    throw new Error('https_core_url_required');
  // The credential only ever goes to the Core this identity was created for.
  const { coreOrigin, caSha256 } = options.installation.binding;
  const ca = options.ca === undefined ? null : Buffer.from(options.ca);
  if (
    base.origin !== coreOrigin ||
    (ca ? createHash('sha256').update(ca).digest('hex') : null) !== caSha256
  )
    throw new StudioTransportError(
      'identity_mismatch',
      'Identité Studio liée à un autre Core : régénération requise',
    );
  const agent = new Agent({ keepAlive: true, ca: ca ?? undefined });
  const timeoutMs = options.timeoutMs ?? 5000;
  const version = String(options.protocolVersion ?? STUDIO_PROTOCOL_VERSION);

  return <T>(
    path: string,
    body?: unknown,
    callOptions: { timeoutMs?: number } = {},
  ) => {
    if (!path.startsWith('/v1/studio/'))
      return Promise.reject(new Error('studio_route_required'));
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<T>((resolve, reject) => {
      const fail = (e: StudioTransportError) => {
        clearTimeout(deadline);
        req.destroy();
        reject(e);
      };
      const req = request(new URL(path, base), {
        method: payload === undefined ? 'GET' : 'POST',
        agent,
        headers: {
          authorization: options.installation.authorization(),
          [PROTOCOL_HEADER]: version,
          accept: 'application/json',
          ...(payload === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }),
        },
      });
      // Total deadline (connection + TLS + response), not only socket inactivity.
      const deadline = setTimeout(
        () =>
          fail(new StudioTransportError('core_unreachable', 'core timeout')),
        callOptions.timeoutMs ?? timeoutMs,
      );
      req.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(deadline);
        reject(
          TLS_CODE.test(e.code ?? '')
            ? new StudioTransportError(
                'tls_rejected',
                `Core certificate refused (${e.code})`,
              )
            : new StudioTransportError(
                'core_unreachable',
                `Core unreachable (${e.code ?? 'network error'})`,
              ),
        );
      });
      req.on('response', (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return fail(
            new StudioTransportError(
              'redirect_refused',
              'Core answered with a redirect: refused',
              status,
            ),
          );
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES)
            return fail(
              new StudioTransportError(
                'invalid_response',
                'Core response too large',
                status,
              ),
            );
          chunks.push(chunk);
        });
        res.on('error', () =>
          fail(
            new StudioTransportError(
              'core_unreachable',
              'Core response interrupted',
            ),
          ),
        );
        res.on('end', () => {
          clearTimeout(deadline);
          let json: {
            error?: string;
            supported?: number[];
          } & Record<string, unknown>;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!json || typeof json !== 'object') throw new Error();
          } catch {
            return reject(
              new StudioTransportError(
                'invalid_response',
                `Core answered ${status} without JSON`,
                status,
              ),
            );
          }
          if (status >= 200 && status < 300) return resolve(json as T);
          if (status === 426 && json.error === 'protocol_incompatible')
            return reject(
              new StudioTransportError(
                'protocol_incompatible',
                `Mise à jour requise : protocole Studio ${version} incompatible (Core accepte ${(json.supported ?? []).join(', ') || '?'})`,
                status,
              ),
            );
          if (
            status === 401 &&
            (json.error === 'studio_revoked' ||
              json.error === 'studio_unauthorized')
          )
            return reject(
              new StudioTransportError(
                json.error,
                json.error === 'studio_revoked'
                  ? 'Studio révoqué côté Core : nouvel appairage requis'
                  : 'Studio non reconnu par le Core : appairage requis',
                status,
              ),
            );
          reject(
            new StudioTransportError(
              json.error ?? 'core_error',
              json.error ?? `core error ${status}`,
              status,
            ),
          );
        });
      });
      req.end(payload);
    });
  };
}
