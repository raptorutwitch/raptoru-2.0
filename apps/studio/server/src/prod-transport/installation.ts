import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// ASTRA-P1-019 (lot 1): identity of this Studio installation on the future production transport.
// Generated once (random UUID + 256-bit secret, never derived from the machine, the user or Twitch),
// kept in a file of the Studio server's data directory: Node side only, never sent to the renderer,
// the extension or a browser. Owner-only mode on POSIX; on Windows the per-user profile ACL applies.
// A damaged file stops the transport: a new identity is never generated silently (it would orphan
// the pairing registered in Core).

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export class StudioInstallationError extends Error {}

export class StudioInstallation {
  readonly #secret: string;
  constructor(
    readonly installationId: string,
    secret: string,
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
    return { installation_id: this.installationId };
  }
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `StudioInstallation(${this.installationId})`;
  }
}

/** Reads this installation's identity, creating it the first time only (atomic, never overwritten). */
export async function loadOrCreateInstallation(
  file: string,
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
  let data: { version?: unknown; installation_id?: unknown; secret?: unknown };
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
    !SECRET.test(data.secret)
  )
    throw new StudioInstallationError('studio_installation_corrupt');
  return new StudioInstallation(data.installation_id, data.secret);
}
