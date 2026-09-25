import {
  CurrencyCreate,
  CurrencyId,
  CurrencyUpdate,
  LoyaltyBoostRequest,
  LoyaltyRateRequest,
  StaffRoleRequest,
  WalletAdminAdjustRequest,
  WalletBalanceRequest,
  WalletChatAdminRequest,
  WalletTransferRequest,
} from '@raptoru/schemas';
import { z } from 'zod';
import type { WalletModule } from '../wallet/index.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

const TwitchUserId = z.string().regex(/^\d+$/);
const currencyParam = (url: URL) => {
  const c = url.searchParams.get('currency');
  return c ? parse(CurrencyId, c) : undefined;
};

export function walletRoutes(m: WalletModule): Route[] {
  return [
    // --- bot: chat intents (Core returns the reply) ---
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/wallet\/balance$/,
      auth: 'bot',
      handle: async ({ body }) =>
        m.chat.balance(parse(WalletBalanceRequest, body)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/wallet\/transfer$/,
      auth: 'bot',
      handle: async ({ body }) =>
        m.chat.transfer(parse(WalletTransferRequest, body)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/wallet\/admin$/,
      auth: 'bot',
      handle: async ({ body }) =>
        m.chat.admin(parse(WalletChatAdminRequest, body)),
    },

    // --- public reads (balances are public) ---
    {
      method: 'GET',
      pattern: /^\/v1\/wallet\/currencies$/,
      auth: 'public',
      handle: async () => m.currencies.list(),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/wallet\/leaderboard$/,
      auth: 'public',
      handle: async ({ url }) => {
        const board = await m.wallet.leaderboard({
          currencyId: currencyParam(url),
          limit: limitParam(url, 100, 500),
        });
        if (!board) throw new HttpError(404, { error: 'unknown_currency' });
        return board;
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/wallet\/viewers\/([^/]+)$/,
      auth: 'public',
      handle: async ({ params, url }) => {
        const view = await m.wallet.getWallet(
          parse(TwitchUserId, params[0]),
          currencyParam(url),
        );
        if (!view) throw new HttpError(404, { error: 'unknown_currency' });
        return view;
      },
    },

    // --- admin (Studio) ---
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/wallet\/viewers\/([^/]+)\/transactions$/,
      auth: 'studio',
      handle: async ({ params, url }) =>
        m.wallet.history(parse(TwitchUserId, params[0]), {
          currencyId: currencyParam(url),
          limit: limitParam(url, 50, 500),
          beforeId: url.searchParams.has('before')
            ? Number(url.searchParams.get('before'))
            : undefined,
        }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/wallet\/adjust$/,
      auth: 'studio',
      handle: async ({ body }) => {
        const req = parse(WalletAdminAdjustRequest, body);
        return m.wallet.adminAdjust({
          ...req,
          key: `studio:${req.requestId}`,
          actor: `studio:${req.actor}`,
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/wallet\/currencies$/,
      auth: 'studio',
      handle: async ({ body }) =>
        m.currencies.create(parse(CurrencyCreate, body)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/wallet\/currencies\/([^/]+)$/,
      auth: 'studio',
      handle: async ({ params, body }) => {
        const updated = await m.currencies.update(
          parse(CurrencyId, params[0]),
          parse(CurrencyUpdate, body),
        );
        if (!updated) throw new HttpError(404, { error: 'unknown_currency' });
        return updated;
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/loyalty\/viewers\/([^/]+)\/rate$/,
      auth: 'studio',
      handle: async ({ params }) => {
        const id = parse(TwitchUserId, params[0]);
        return {
          twitchUserId: id,
          multiplier: await m.loyalty.getRate(id),
          resolved: await m.loyalty.resolveMultiplier(id),
        };
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/loyalty\/rate$/,
      auth: 'studio',
      handle: async ({ body }) => {
        const req = parse(LoyaltyRateRequest, body);
        return {
          multiplier: await m.loyalty.setRate(
            req.viewer,
            req.multiplier,
            `studio:${req.actor}`,
            req.reason,
          ),
        };
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/loyalty\/viewers\/([^/]+)\/rate\/reset$/,
      auth: 'studio',
      handle: async ({ params }) => {
        await m.loyalty.resetRate(parse(TwitchUserId, params[0]));
        return { multiplier: null };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/loyalty\/boosts$/,
      auth: 'studio',
      handle: async () => ({
        active: await m.loyalty.activeBoost(),
        recent: await m.loyalty.listBoosts(),
      }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/loyalty\/boosts$/,
      auth: 'studio',
      handle: async ({ body }) => {
        const req = parse(LoyaltyBoostRequest, body);
        return m.loyalty.createBoost({
          multiplier: req.multiplier,
          label: req.label,
          startsAt: req.startsAt ? new Date(req.startsAt) : undefined,
          endsAt: new Date(req.endsAt),
          actor: `studio:${req.actor}`,
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/loyalty\/boosts\/(\d+)\/stop$/,
      auth: 'studio',
      handle: async ({ params }) => {
        const stopped = await m.loyalty.stopBoost(Number(params[0]), 'studio');
        if (!stopped)
          throw new HttpError(404, { error: 'unknown_or_stopped_boost' });
        return stopped;
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/staff$/,
      auth: 'studio',
      handle: async () => m.staff.list(),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/staff$/,
      auth: 'studio',
      handle: async ({ body }) => {
        const req = parse(StaffRoleRequest, body);
        await m.staff.grant(req.viewer, req.role, `studio:${req.actor}`);
        return { twitchUserId: req.viewer.twitchUserId, role: req.role };
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/staff\/([^/]+)\/revoke$/,
      auth: 'studio',
      handle: async ({ params }) => {
        await m.staff.revoke(parse(TwitchUserId, params[0]));
        return { revoked: true };
      },
    },
  ];
}
