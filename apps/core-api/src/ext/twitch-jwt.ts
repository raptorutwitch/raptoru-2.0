import { createHmac, timingSafeEqual } from 'node:crypto';

// ASTRA-P1-006 (minimal public frontier): the Twitch Extension JWT, verified by the Core alone. Same
// rules as the legacy EBS (`verifyExtensionJwt`): HS256 only, key = the base64-decoded extension
// secret, `user_id` is an identity only when the viewer shared it, `opaque_user_id` never is.
// Nothing the client sends besides this token says who the caller is.

export type ExtRole = 'broadcaster' | 'moderator' | 'viewer' | 'external';

export interface ExtCaller {
  role: ExtRole;
  channelId: string;
  /** Twitch user id, only when the viewer shared their identity (null otherwise). */
  userId: string | null;
  /** Per-viewer opaque id (rate limiting only, never an identity). */
  opaqueUserId: string;
}

export class ExtAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const ROLES: readonly ExtRole[] = [
  'broadcaster',
  'moderator',
  'viewer',
  'external',
];
const SEGMENT = /^[A-Za-z0-9_-]+$/;
/** Clock skew accepted on `exp` (Twitch tokens live about an hour). */
const SKEW_S = 30;

const json = (segment: string): Record<string, unknown> => {
  const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ExtAuthError('invalid_token');
  return value as Record<string, unknown>;
};

export function verifyExtensionJwt(
  authorization: string | undefined,
  options: { secret: Buffer; channelId: string; nowS?: number },
): ExtCaller {
  const match = /^Bearer ([^.\s]+)\.([^.\s]+)\.([^.\s]+)$/.exec(
    authorization ?? '',
  );
  if (!match) throw new ExtAuthError('unauthorized');
  const [, h, p, s] = match as unknown as [string, string, string, string];
  if (![h, p, s].every((x) => SEGMENT.test(x)))
    throw new ExtAuthError('invalid_token');
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = json(h);
    payload = json(p);
  } catch {
    throw new ExtAuthError('invalid_token');
  }
  // HS256 only: never `none`, never an algorithm chosen by the token beyond this one.
  if (header.alg !== 'HS256') throw new ExtAuthError('invalid_token');
  const expected = createHmac('sha256', options.secret)
    .update(`${h}.${p}`)
    .digest();
  const actual = Buffer.from(s, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new ExtAuthError('invalid_token');

  const now = options.nowS ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + SKEW_S < now)
    throw new ExtAuthError('token_expired');
  const role = ROLES.find((r) => r === payload.role);
  if (!role) throw new ExtAuthError('invalid_token');
  if (String(payload.channel_id ?? '') !== options.channelId)
    throw new ExtAuthError('wrong_channel');
  const opaque = payload.opaque_user_id;
  if (typeof opaque !== 'string' || !opaque || opaque.length > 64)
    throw new ExtAuthError('invalid_token');
  const userId =
    typeof payload.user_id === 'string' && /^\d{1,32}$/.test(payload.user_id)
      ? payload.user_id
      : null;
  return { role, channelId: options.channelId, userId, opaqueUserId: opaque };
}

/** Test helper and local tooling: a signed token (the real ones are signed by Twitch). */
export function signExtensionJwt(
  payload: Record<string, unknown>,
  secret: Buffer,
): string {
  const enc = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`;
}
