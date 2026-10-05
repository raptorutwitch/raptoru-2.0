import { createHash, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';

// ASTRA-P1-019 (lot 1): identity of a Studio installation on the future production transport.
// The Studio generates `installation_id` + a 256-bit secret once; Core only knows SHA-256(secret)
// (registered by an operator from the pairing code). Every request is checked against the table:
// no cache, so a revocation applies to the very next call.

/** Protocol versions of the Studio ↔ Core transport this Core accepts. */
export const STUDIO_PROTOCOL = Object.freeze({ current: 1, supported: [1] });
export const STUDIO_PROTOCOL_HEADER = 'x-raptoru-studio-protocol';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const DIGEST = /^[0-9a-f]{64}$/;
/** last_seen_at is a diagnostic, not a lock: written at most this often per installation. */
const SEEN_EVERY_MS = 30_000;

export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export class StudioAuthError extends Error {
  constructor(readonly code: 'studio_unauthorized' | 'studio_revoked') {
    super(code);
  }
}
export class StudioPairingError extends Error {}

/** `Bearer rsi_<installation_id>.<secret>`, strictly; anything else is null (never reaches SQL). */
export function parseStudioCredential(
  header: string | undefined,
): { installationId: string; secret: string } | null {
  const m = /^Bearer rsi_([^.\s]+)\.([^.\s]+)$/.exec(header ?? '');
  if (!m || !ID.test(m[1]!) || !SECRET.test(m[2]!)) return null;
  return { installationId: m[1]!, secret: m[2]! };
}

/** Pairing code shown by the Studio: `<installation_id>.<sha256(secret)>` (never the secret). */
export function parsePairingCode(code: string) {
  const [id, digest, extra] = code.trim().split('.');
  if (extra !== undefined || !ID.test(id ?? '') || !DIGEST.test(digest ?? ''))
    throw new StudioPairingError('invalid pairing code');
  return { installationId: id!, secretSha256: digest! };
}

export interface StudioInstallation {
  installation_id: string;
  label: string;
  created_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date | null;
}

const DUMMY = Buffer.alloc(32);

export class StudioInstallations {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Operator action (pairing). Re-pairing an existing id is refused: revoke, pair a new install. */
  async register(code: string, label: string): Promise<StudioInstallation> {
    const { installationId, secretSha256 } = parsePairingCode(code);
    const name = label.trim();
    if (name.length < 1 || name.length > 80)
      throw new StudioPairingError('label must be 1 to 80 characters');
    const rows = await this.db.query<StudioInstallation>(
      `insert into studio_installations (installation_id, secret_sha256, label, created_at)
       values ($1, $2, $3, $4) on conflict (installation_id) do nothing
       returning installation_id, label, created_at, revoked_at, last_seen_at`,
      [installationId, secretSha256, name, this.clock.now()],
    );
    if (!rows[0]) throw new StudioPairingError('installation already paired');
    return rows[0];
  }

  /**
   * Operator action. Idempotent. The installation's unfinished Bonk deliveries lose their lease now:
   * the next sweep turns them into execution_unknown (never replayed, never refunded by default).
   */
  async revoke(installationId: string): Promise<boolean> {
    if (!ID.test(installationId)) return false;
    const now = this.clock.now();
    return this.db.tx(async (q) => {
      const rows = await q.query(
        `update studio_installations set revoked_at = coalesce(revoked_at, $2)
         where installation_id = $1 returning installation_id`,
        [installationId, now],
      );
      if (!rows[0]) return false;
      await q.query(
        `update bonk_lab_deliveries set lease_expires_at = least(lease_expires_at, $2)
         where studio_instance_id = $1 and completed_at is null`,
        [installationId, now],
      );
      return true;
    });
  }

  list(): Promise<StudioInstallation[]> {
    return this.db.query<StudioInstallation>(
      'select installation_id, label, created_at, revoked_at, last_seen_at from studio_installations order by created_at',
    );
  }

  /** Authenticated installation id, or StudioAuthError. `revoked` only after the secret matched. */
  async authenticate(header: string | undefined): Promise<string> {
    const credential = parseStudioCredential(header);
    const row = credential
      ? (
          await this.db.query<{
            secret_sha256: string;
            revoked_at: Date | null;
            last_seen_at: Date | null;
          }>(
            'select secret_sha256, revoked_at, last_seen_at from studio_installations where installation_id = $1',
            [credential.installationId],
          )
        )[0]
      : undefined;
    // Same work whether the id exists or not: no timing hint about known installations.
    const expected = row ? Buffer.from(row.secret_sha256, 'hex') : DUMMY;
    const actual = Buffer.from(sha256(credential?.secret ?? ''), 'hex');
    if (!credential || !row || !timingSafeEqual(expected, actual))
      throw new StudioAuthError('studio_unauthorized');
    if (row.revoked_at) throw new StudioAuthError('studio_revoked');
    const now = this.clock.now();
    if (
      !row.last_seen_at ||
      now.getTime() - row.last_seen_at.getTime() > SEEN_EVERY_MS
    )
      await this.db.query(
        'update studio_installations set last_seen_at = $2 where installation_id = $1',
        [credential.installationId, now],
      );
    return credential.installationId;
  }
}
