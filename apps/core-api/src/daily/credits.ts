import type { Db } from '../db/db.js';
import { WalletService } from '../wallet/wallet-service.js';

export interface CreditRequest {
  twitchUserId: string;
  login: string;
  amount: number;
  /** Durable key of what is paid, e.g. `daily-claim:42` (one per claim, never reused). */
  reference: string;
}

export type CreditResult =
  | { status: 'credited'; operationId?: number }
  | { status: 'failed'; error: string };

/**
 * Wallet provider. Return `failed` only when the credit was certainly NOT applied.
 *
 * Non-idempotent provider (e.g. StreamElements): throw when the outcome is unknown (timeout,
 * crash…); the credit is then flagged for manual reconciliation instead of being retried and
 * possibly paid twice.
 *
 * Idempotent provider (`idempotent: true`, e.g. the Core Wallet keyed by `reference`): resending
 * the same reference can never pay twice, so an error or an interrupted send is simply retried.
 */
export interface CreditProvider {
  readonly name: string;
  readonly idempotent?: boolean;
  credit(request: CreditRequest): Promise<CreditResult>;
}

/** Dev/test provider: moves no real money, writes nothing in the Wallet (preview/shadow). */
export class DevFakeCreditProvider implements CreditProvider {
  readonly name = 'dev-fake';
  readonly credited: CreditRequest[] = [];

  async credit(request: CreditRequest) {
    this.credited.push(request);
    return { status: 'credited' as const };
  }
}

/**
 * Daily → Core Wallet (DAILY_WALLET_CREDITS=true only). Receives an amount already decided by
 * Daily; the claim reference is the Wallet idempotency key, so retries, restarts and several Core
 * instances produce exactly one Wallet operation per claim.
 */
export class WalletCreditProvider implements CreditProvider {
  readonly name = 'core-wallet';
  readonly idempotent = true;
  private readonly wallet: WalletService;

  constructor(private readonly db: Db) {
    this.wallet = new WalletService(db);
  }

  async credit(request: CreditRequest): Promise<CreditResult> {
    const known = (
      await this.db.query<{ display_name: string }>(
        'select display_name from viewers where twitch_user_id = $1',
        [request.twitchUserId],
      )
    )[0];
    const result = await this.wallet.credit({
      key: request.reference,
      viewer: {
        twitchUserId: request.twitchUserId,
        login: request.login,
        displayName: known?.display_name ?? request.login,
      },
      amount: request.amount,
      kind: 'reward',
      source: 'daily',
      reference: request.reference,
    });
    return result.status === 'applied'
      ? { status: 'credited', operationId: result.operationId }
      : { status: 'failed', error: `wallet: ${result.rejection}` };
  }
}

interface CreditRow {
  claim_id: number;
  twitch_user_id: string;
  login: string;
  amount: number;
  idempotency_key: string | null;
}

export class DailyCredits {
  constructor(
    private readonly db: Db,
    private readonly provider: CreditProvider,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * At startup: a credit left in 'sending' may or may not have been applied before the crash.
   * Idempotent provider: resent (a replay if it was applied). Otherwise: flagged 'unknown'.
   */
  async recoverInterrupted(): Promise<number> {
    const rows = await this.db.query(
      `update daily_credits set status = $2, last_error = 'interrupted while sending', updated_at = now()
       where status = 'sending' and provider = $1 returning claim_id`,
      [this.provider.name, this.provider.idempotent ? 'pending' : 'unknown'],
    );
    return rows.length;
  }

  /**
   * Periodic sweep, safe on every Core instance at once. Idempotent provider only: a credit left
   * in 'sending' for longer than `staleSeconds` was interrupted (crashed Core while the others kept
   * running) and is requeued; resending it is a Wallet replay if it had been applied. Then every
   * pending credit is sent.
   */
  async retryTick(staleSeconds = 300): Promise<void> {
    if (this.provider.idempotent) {
      await this.db.query(
        `update daily_credits set status = 'pending', last_error = 'interrupted while sending', updated_at = now()
         where status = 'sending' and provider = $1 and updated_at < now() - make_interval(secs => $2)`,
        [this.provider.name, staleSeconds],
      );
    }
    await this.processPending();
  }

  /**
   * Sends every pending credit of this provider once. Never re-sends failed/unknown ones. An error
   * with an idempotent provider puts the credit back to 'pending' for the next run (next claim or
   * Core start) and stops this run.
   */
  async processPending(): Promise<void> {
    for (;;) {
      const row = (
        await this.db.query<CreditRow>(
          `update daily_credits set status = 'sending', updated_at = now()
           where claim_id = (
             select claim_id from daily_credits where status = 'pending' and provider = $1
             order by claim_id limit 1 for update skip locked
           )
           returning claim_id, twitch_user_id, login, amount, idempotency_key`,
          [this.provider.name],
        )
      )[0];
      if (!row) return;

      let status: 'credited' | 'failed' | 'unknown' | 'pending';
      let error: string | null = null;
      let operationId: number | null = null;
      try {
        const result = await this.provider.credit({
          twitchUserId: row.twitch_user_id,
          login: row.login,
          amount: row.amount,
          reference: row.idempotency_key ?? `daily-claim:${row.claim_id}`,
        });
        status = result.status;
        if (result.status === 'failed') error = result.error;
        else operationId = result.operationId ?? null;
      } catch (e) {
        status = this.provider.idempotent ? 'pending' : 'unknown';
        error = e instanceof Error ? e.message : String(e);
      }
      await this.db.query(
        `update daily_credits set status = $2, last_error = $3, wallet_operation_id = $4, updated_at = now()
         where claim_id = $1`,
        [row.claim_id, status, error, operationId],
      );
      if (status === 'pending') return; // retried later, never in a tight loop
    }
  }
}
