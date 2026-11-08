import { createHmac } from 'node:crypto';

// The Extension Lab on the MAIN Core's viewer frontier (architecture decision of 05/11/2026: the Lab runs the same Core
// as Production, CORE_ENVIRONMENT=lab — core-api/src/lab/environment.ts). Studio decides nothing here:
// - it signs the Twitch Extension JWT Twitch would hand the extension (HS256, the Lab Core's extension secret, the Lab's
//   fictional accounts and channel) — the role / identity switch of the Extension Lab is a change of claims;
// - it relays /ext-lab/api/* to the Core's /v1/ext/* unchanged (the extension's pages stay same-origin: CSP unchanged).
// Every price, balance, rule, refusal and history is the Core's, exactly as in Production.

export interface LabFrontier {
  /** The Lab Core's base URL (loopback). */
  coreUrl: string;
  /** The Lab Core's TWITCH_EXTENSION_SECRET (decoded). */
  extensionSecret: Buffer;
  /** The Lab's fictional channel (900100). */
  channelId: string;
}

/** `supermod`: « Supermod Lab », a moderator for Twitch, a supermod for the Core (lab_staff, lab/fixtures.ts). */
export type LabRole = 'viewer' | 'moderator' | 'supermod' | 'broadcaster';

/** The Lab's fictional accounts (the same ids as core-api/src/lab/environment.ts LAB_TWITCH_USERS). */
const LAB_USER_IDS: Record<LabRole, string> = {
  viewer: '900101',
  moderator: '900102',
  supermod: '900103',
  broadcaster: '900100',
};

/** A day: the Extension Lab never has to refresh it. */
const TOKEN_LIFETIME_S = 24 * 60 * 60;

/** The JWT Twitch would give the extension of this fictional account (user_id only when the identity is shared). */
export function labExtensionToken(
  f: LabFrontier,
  role: LabRole,
  identityShared: boolean,
  nowS = Math.floor(Date.now() / 1000),
  userId = LAB_USER_IDS[role],
): string {
  const enc = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
    exp: nowS + TOKEN_LIFETIME_S,
    opaque_user_id: `U${userId}`,
    ...(identityShared ? { user_id: userId } : {}),
    channel_id: f.channelId,
    // Twitch's JWT has no « supermod »: a moderator; the Core reads the grade from its own team (lab_staff).
    role: role === 'supermod' ? 'moderator' : role,
    is_unlinked: !identityShared,
    pubsub_perms: { listen: ['broadcast', 'global'], send: [] },
  })}`;
  return `${head}.${createHmac('sha256', f.extensionSecret).update(head).digest('base64url')}`;
}

/** Ids the Lab keeps for its fictional viewers (lab/environment.ts): nothing else may buy through the simulators. */
const LAB_VIEWER_ID = /^9001\d\d$|^9002\d\d$/;

/**
 * A fictional viewer buys with Lab Jetons, at the extension's own door: the Core checks, debits, admits or refuses exactly as
 * for a real purchase. Only the JWT is Studio's, as for every Extension Lab request.
 */
export function simulatedPurchase(
  f: LabFrontier,
  viewerId: string,
  key: string,
  purchase: { module_id: string; payload: unknown },
) {
  if (!LAB_VIEWER_ID.test(viewerId)) return null;
  return relayToFrontier(
    f,
    'POST',
    '/actions/tokens',
    JSON.stringify(purchase),
    {
      authorization: `Bearer ${labExtensionToken(f, 'viewer', true, undefined, viewerId)}`,
      idempotencyKey: key,
    },
  );
}

/** The image of a fictional emote: its initials on a colour taken from its id. */
export function fictionalEmoteSvg(id: string): string {
  const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const mark = id.replace(/^e2e/, '').slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112"><rect width="112" height="112" rx="24" fill="hsl(${hue} 70% 45%)"/><text x="56" y="72" font-family="sans-serif" font-size="48" font-weight="700" text-anchor="middle" fill="#fff">${mark}</text></svg>`;
}

export function labRoleOf(value: string | null): LabRole {
  return value === 'moderator' ||
    value === 'supermod' ||
    value === 'broadcaster'
    ? value
    : 'viewer';
}

/** One extension request, relayed to the Core's /v1/ext as it came (method, path, query, body, auth, idempotency). */
export async function relayToFrontier(
  f: LabFrontier,
  method: string,
  pathAndQuery: string,
  body: string | undefined,
  headers: { authorization?: string; idempotencyKey?: string },
): Promise<{ status: number; body: string; contentType: string }> {
  const res = await fetch(`${f.coreUrl}/v1/ext${pathAndQuery}`, {
    method,
    headers: {
      ...(headers.authorization
        ? { authorization: headers.authorization }
        : {}),
      ...(headers.idempotencyKey
        ? { 'idempotency-key': headers.idempotencyKey }
        : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body } : {}),
  }).catch(() => null);
  if (!res)
    return {
      status: 503,
      body: JSON.stringify({ ok: false, error: 'core_unreachable' }),
      contentType: 'application/json; charset=utf-8',
    };
  return {
    status: res.status,
    body: await res.text(),
    contentType:
      res.headers.get('content-type') ?? 'application/json; charset=utf-8',
  };
}
