// Casino (docs/CASINO.md) — what the service and its spectators' feed share: the refusal error and a strict round id.

export class CasinoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** A round id: a UUID, strictly (a malformed one never reaches PostgreSQL). */
export const ROUND_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
