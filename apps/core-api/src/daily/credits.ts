import type { Db } from '../db/db.js';

export interface CreditRequest {
  twitchUserId: string;
  login: string;
  amount: number;
  /** Stable reference of what is paid, e.g. `daily-claim:42`. */
  reference: string;
}

/**
 * Wallet provider (StreamElements at cutover). Return `failed` only when the credit was certainly
 * NOT applied. Throw when the outcome is unknown (timeout, crash…): the credit is then flagged
 * for manual reconciliation instead of being retried and possibly paid twice.
 */
export interface CreditProvider {
  readonly name: string;
  credit(
    request: CreditRequest,
  ): Promise<{ status: 'credited' } | { status: 'failed'; error: string }>;
}

/** Dev/test provider: moves no real money. The only provider that exists before the cutover. */
export class DevFakeCreditProvider implements CreditProvider {
  readonly name = 'dev-fake';
  readonly credited: CreditRequest[] = [];

  async credit(request: CreditRequest) {
    this.credited.push(request);
    return { status: 'credited' as const };
  }
}

interface CreditRow {
  claim_id: number;
  twitch_user_id: string;
  login: string;
  amount: number;
}

export class DailyCredits {
  constructor(
    private readonly db: Db,
    private readonly provider: CreditProvider,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  /** At startup: a credit left in 'sending' may or may not have been applied before the crash. */
  async recoverInterrupted(): Promise<number> {
    const rows = await this.db.query(
      `update daily_credits set status = 'unknown', last_error = 'interrupted while sending', updated_at = now()
       where status = 'sending' and provider = $1 returning claim_id`,
      [this.provider.name],
    );
    return rows.length;
  }

  /** Sends every pending credit of this provider once. Never re-sends failed/unknown ones. */
  async processPending(): Promise<void> {
    for (;;) {
      const row = (
        await this.db.query<CreditRow>(
          `update daily_credits set status = 'sending', updated_at = now()
           where claim_id = (
             select claim_id from daily_credits where status = 'pending' and provider = $1
             order by claim_id limit 1 for update skip locked
           )
           returning claim_id, twitch_user_id, login, amount`,
          [this.provider.name],
        )
      )[0];
      if (!row) return;

      let status: 'credited' | 'failed' | 'unknown';
      let error: string | null = null;
      try {
        const result = await this.provider.credit({
          twitchUserId: row.twitch_user_id,
          login: row.login,
          amount: row.amount,
          reference: `daily-claim:${row.claim_id}`,
        });
        status = result.status;
        if (result.status === 'failed') error = result.error;
      } catch (e) {
        status = 'unknown';
        error = e instanceof Error ? e.message : String(e);
      }
      await this.db.query(
        'update daily_credits set status = $2, last_error = $3, updated_at = now() where claim_id = $1',
        [row.claim_id, status, error],
      );
    }
  }
}
