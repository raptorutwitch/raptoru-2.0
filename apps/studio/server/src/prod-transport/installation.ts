import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// ASTRA-P1-019 (lot 1): identity of this Studio installation on the future production transport.
// Generated once (random UUID + 256-bit secret, never derived from the machine, the user or Twitch),
// kept in a file of the Studio server's data directory: Node side only, never sent to the renderer,
// the extension or a browser. Owner-only mode on POSIX; on Windows the per-user profile ACL applies.
// A damaged file stops the transport: a new identity is never generated silently (it would orphan
// the pairing registered in Core).
// The identity is BOUND to the Core it was created for (origin + fingerprint of the trusted CA, if
// any): the credential is never sent to another Core, even if the configuration changes (lot 2
// security review). Another Core = an explicit regeneration.

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** The Core an identity is bound to: its origin and the SHA-256 of the trusted CA (null: system roots). */
export interface CoreBinding {
  coreOrigin: string;
  caSha256: string | null;
}

export class StudioInstallationError extends Error {}

export class StudioInstallation {
  readonly #secret: string;
  constructor(
    readonly installationId: string,
    secret: string,
    readonly binding: CoreBinding,
  ) {
    this.#secret = secret;
  }
  /** To give to the operator who pairs this Studio in Core: proves nothing on its own. */
  get pairingCode() {
    return `${this.installationId}.${createHash('sha256').update(this.#secret).digest('hex')}`;
  }
  /** Authorization header value. Only the production transport client calls this. */
  authorization() {
    return `Bearer rsi_${this.installationId}.${this.#secret}`;
  }
  // Logged or serialized by mistake: the identifier only, never the secret.
  toJSON() {
    return {
      installation_id: this.installationId,
      core_origin: this.binding.coreOrigin,
    };
  }
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `StudioInstallation(${this.installationId})`;
  }
}

/** Existing identity, or null when none was created yet (never creates one). */
export async function loadInstallation(
  file: string,
): Promise<StudioInstallation | null> {
  try {
    return parse(await readFile(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Reads this installation's identity, creating it the first time only (atomic, never overwritten),
 * bound to `binding`. An existing identity keeps ITS binding (compare it before use).
 */
export async function loadOrCreateInstallation(
  file: string,
  binding: CoreBinding,
): Promise<StudioInstallation> {
  try {
    return parse(await readFile(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(
    tmp,
    JSON.stringify({
      version: 1,
      installation_id: randomUUID(),
      secret: randomBytes(32).toString('base64url'),
      created_at: new Date().toISOString(),
      core_origin: binding.coreOrigin,
      ca_sha256: binding.caSha256,
    }),
    { mode: 0o600, flag: 'wx' },
  );
  try {
    // link() fails if the file already exists: a concurrent first start keeps the first identity.
    await link(tmp, file).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'EEXIST') throw e;
    });
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
  return parse(await readFile(file, 'utf8'));
}

function parse(text: string): StudioInstallation {
  let data: {
    version?: unknown;
    installation_id?: unknown;
    secret?: unknown;
    core_origin?: unknown;
    ca_sha256?: unknown;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new StudioInstallationError('studio_installation_corrupt');
  }
  if (
    data.version !== 1 ||
    typeof data.installation_id !== 'string' ||
    !ID.test(data.installation_id) ||
    typeof data.secret !== 'string' ||
    !SECRET.test(data.secret) ||
    typeof data.core_origin !== 'string' ||
    !/^https:\/\/[^/]+$/.test(data.core_origin) ||
    !(
      data.ca_sha256 === null ||
      (typeof data.ca_sha256 === 'string' && DIGEST.test(data.ca_sha256))
    )
  )
    throw new StudioInstallationError('studio_installation_corrupt');
  return new StudioInstallation(data.installation_id, data.secret, {
    coreOrigin: data.core_origin,
    caSha256: data.ca_sha256,
  });
}
