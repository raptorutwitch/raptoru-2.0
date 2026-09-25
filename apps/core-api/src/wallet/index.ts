import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { WalletChat } from './chat.js';
import { CurrencyService } from './currencies.js';
import { LoyaltyService } from './loyalty.js';
import { StaffService } from './staff.js';
import { WalletService } from './wallet-service.js';

export interface WalletModule {
  wallet: WalletService;
  currencies: CurrencyService;
  loyalty: LoyaltyService;
  staff: StaffService;
  chat: WalletChat;
}

export function createWalletModule(db: Db, clock: Clock): WalletModule {
  const wallet = new WalletService(db);
  const currencies = new CurrencyService(db);
  const staff = new StaffService(db);
  return {
    wallet,
    currencies,
    staff,
    loyalty: new LoyaltyService(db, clock),
    chat: new WalletChat(wallet, currencies, staff),
  };
}
