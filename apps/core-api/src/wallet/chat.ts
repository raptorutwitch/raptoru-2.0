import type {
  WalletBalanceRequest,
  WalletChatAdminRequest,
  WalletChatResponse,
  WalletTransferRequest,
} from '@raptoru/schemas';
import { walletMessages } from './chat-messages.js';
import type { CurrencyService } from './currencies.js';
import type { StaffService } from './staff.js';
import type { WalletService } from './wallet-service.js';

// Chat entry points (!solde, !give, !wallet): the bot sends structured intents, Core decides and
// returns the reply. The same wallet operations are usable without any chat output.

export class WalletChat {
  constructor(
    private readonly wallet: WalletService,
    private readonly currencies: CurrencyService,
    private readonly staff: StaffService,
  ) {}

  /** Read-only. `requester` (someone else asking, `!solde @Pseudo`) only changes who the reply is addressed to. */
  async balance({
    viewer,
    requester,
    currencyId,
  }: WalletBalanceRequest): Promise<WalletChatResponse> {
    const other =
      requester && requester.twitchUserId !== viewer.twitchUserId
        ? requester
        : null;
    const view = await this.wallet.getWallet(viewer.twitchUserId, currencyId);
    if (!view || !view.currency.active)
      return {
        message: `@${(other ?? viewer).displayName} — monnaie indisponible.`,
        result: null,
      };
    return {
      message: other
        ? walletMessages.balanceOf(
            other.displayName,
            viewer.displayName,
            view.balance,
            view.currency,
          )
        : walletMessages.balance(
            viewer.displayName,
            view.balance,
            view.currency,
          ),
      result: null,
    };
  }

  async transfer(req: WalletTransferRequest): Promise<WalletChatResponse> {
    const result = await this.wallet.transfer({
      key: `twitch-chat:${req.requestId}`,
      from: req.from,
      to: req.to,
      amount: req.amount,
      currencyId: req.currencyId,
      source: 'chat:give',
    });
    const currency = await this.currencies.get(
      result.currencyId || req.currencyId,
    );
    return {
      message: walletMessages.transfer(
        { id: req.from.twitchUserId, name: req.from.displayName },
        req.to.displayName,
        req.amount,
        result,
        currency,
      ),
      result,
    };
  }

  async admin(req: WalletChatAdminRequest): Promise<WalletChatResponse> {
    if (!(await this.staff.canAdministerEconomy(req.actor.twitchUserId))) {
      return {
        message: walletMessages.notAuthorized(req.actor.displayName),
        result: null,
      };
    }
    const result = await this.wallet.adminAdjust({
      key: `twitch-chat:${req.requestId}`,
      actor: `twitch:${req.actor.twitchUserId}`,
      target: req.target,
      op: req.op,
      amount: req.amount,
      reason: req.reason,
      currencyId: req.currencyId,
    });
    const currency = await this.currencies.get(
      result.currencyId || req.currencyId,
    );
    return {
      message: walletMessages.admin(
        req.actor.displayName,
        req.target.displayName,
        req.target.twitchUserId,
        req.op,
        result,
        currency,
      ),
      result,
    };
  }
}
