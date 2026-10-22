import type { VotekickOverlayEvent } from '@raptoru/schemas';
import {
  InsufficientJetonsError,
  type ReleaseResult,
  type TimeoutResult,
  type VkUser,
  type VotekickPorts,
} from './engine.js';

// Votekick V2 — explicit, isolated simulators of everything outside the engine (Twitch, Wallet, the OBS mute, chat,
// overlay), for the Lab and the tests: no Twitch call, no real Jeton, no OBS. Every action is recorded, failures are
// switches. Never wired to a production port.

export class SimTwitch {
  readonly users = new Map<string, VkUser>();
  readonly moderators = new Set<string>();
  /** userId → a timeout's end (ms) or a permanent ban. */
  readonly sanctions = new Map<string, number | 'permanent'>();
  readonly timeouts: { login: string; seconds: number; reason: string }[] = [];
  readonly releases: string[] = [];
  unreadable = false;
  modsUnreadable = false;
  timeoutAnswer: TimeoutResult = 'confirmed';
  releaseAnswer: ReleaseResult = 'released';
  /** A release Twitch says done but that did not happen (the check still sees the timeout). */
  releaseIneffective = false;

  constructor(private readonly now: () => number) {}

  add(...users: VkUser[]) {
    for (const u of users) this.users.set(u.login.toLowerCase(), u);
    return this;
  }

  port(): VotekickPorts['twitch'] {
    return {
      user: async (login) => {
        if (this.unreadable) throw new Error('twitch_unreadable');
        return this.users.get(login.toLowerCase()) ?? null;
      },
      isModerator: async (id) => {
        if (this.modsUnreadable) throw new Error('mods_unreadable');
        return this.moderators.has(id);
      },
      timeout: async (user, seconds, reason) => {
        this.timeouts.push({ login: user.login, seconds, reason });
        if (this.timeoutAnswer === 'confirmed')
          this.sanctions.set(user.id, this.now() + seconds * 1000);
        return this.timeoutAnswer;
      },
      untimeout: async (user) => {
        this.releases.push(user.login);
        if (this.releaseAnswer !== 'refused' && !this.releaseIneffective)
          this.sanctions.delete(user.id);
        return this.releaseAnswer;
      },
      sanction: async (id) => {
        if (this.unreadable) throw new Error('twitch_unreadable');
        const s = this.sanctions.get(id);
        if (s === undefined) return null;
        if (s === 'permanent') return 'permanent';
        return s > this.now() ? { endsAt: s } : null;
      },
    };
  }
}

export class SimWallet {
  readonly balances = new Map<string, number>();
  /** ref → debited amount (refunded refs removed from `open`). */
  readonly debits = new Map<string, { viewer: string; amount: number }>();
  readonly refunds = new Set<string>();
  unavailable = false;

  port(): VotekickPorts['wallet'] {
    return {
      debit: async (ref, payer, amount) => {
        if (this.unavailable) throw new Error('wallet_unavailable');
        if (this.debits.has(ref)) return; // idempotent
        const balance = this.balances.get(payer.id) ?? 0;
        if (balance < amount) throw new InsufficientJetonsError(balance);
        this.balances.set(payer.id, balance - amount);
        this.debits.set(ref, { viewer: payer.id, amount });
      },
      refund: async (ref) => {
        if (this.unavailable) throw new Error('wallet_unavailable');
        const d = this.debits.get(ref);
        if (!d || this.refunds.has(ref)) return; // idempotent
        this.refunds.add(ref);
        this.balances.set(
          d.viewer,
          (this.balances.get(d.viewer) ?? 0) + d.amount,
        );
      },
    };
  }
}

export class SimMute {
  readonly log: string[] = [];
  port(): VotekickPorts['mute'] {
    return {
      start: async (id, seconds) =>
        void this.log.push(`start ${id} ${seconds}s`),
      end: async (id, reason) => void this.log.push(`end ${id} ${reason}`),
    };
  }
}

/** All the simulated ports at once, with a manual clock and a fixed coin. */
export function simulatedPorts(start = Date.UTC(2026, 9, 22, 20)) {
  let now = start;
  const clock = {
    now: () => now,
    advance: (ms: number) => void (now += ms),
  };
  const twitch = new SimTwitch(clock.now);
  const wallet = new SimWallet();
  const mute = new SimMute();
  const chat: string[] = [];
  const overlay: VotekickOverlayEvent[] = [];
  let coin: 0 | 1 = 0;
  const ports: VotekickPorts = {
    now: clock.now,
    coin: () => coin,
    twitch: twitch.port(),
    mute: mute.port(),
    wallet: wallet.port(),
    say: async (text, announce) =>
      void chat.push(announce ? `/announce ${text}` : text),
    overlay: (e) => void overlay.push(e),
  };
  return {
    ports,
    clock,
    twitch,
    wallet,
    mute,
    chat,
    overlay,
    setCoin: (c: 0 | 1) => void (coin = c),
  };
}
