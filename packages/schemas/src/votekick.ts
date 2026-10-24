// Votekick V2 + Caution (docs/VOTEKICK_V2.md) — the rules of the SAMMI deck « Points de chaine », buttons VK_START,
// VK_VOTE, VK_FINISH, VK_MUTE_BROADCASTER, CAUTION_START / CONFIRM / FINISH (decks_data.json, read 22/10/2026), copied
// as they are. Pure functions: the engine (core-api/src/votekick) and the overlay's demo use the same ones.

export const VOTEKICK = {
  /** VK_START: `vk_ends_ms = now + 60000`; VK_FINISH waits 60 100 ms then decides. */
  voteMs: 60_000,
  finishGraceMs: 100,
  /** VK_START: one initiation per viewer per hour (`votekick_cooldowns`, now + 3600), recorded once the vote opens. */
  initiatorCooldownMs: 3_600_000,
  /** The initiator's vote: counted KICK from the start (`vk_yes = 1`); he cannot vote himself. */
  initiatorKicks: true,
  /** VK_FINISH: fewer than 3 votes (initiator included) → « no_quorum ». */
  quorum: 3,
  /** VK_FINISH: a tie is decided by a coin flip from 4 votes (a tie of 2 is no quorum). */
  coinflipMinVotes: 4,
  /** Timeout minutes: round(5 + (count − 2) × 25 / 18), clamped to [5, 30]; ×2 for Perfect and Backfire. */
  minMinutes: 5,
  maxMinutes: 30,
  doubleFactor: 2,
  /** VK_FINISH → VK_MUTE_BROADCASTER: the broadcaster is muted min(300, max(30, timeout seconds / 12)) seconds. */
  muteMinS: 30,
  muteMaxS: 300,
  muteDivisor: 12,
  /** VK_FINISH: the verdict stays 7 s on screen (VK_RESET then clears the overlay). */
  resultMs: 7_000,
  /** Exact commands (VK_VOTE: case sensitive, the whole message). */
  kickCommand: '!kick',
  saveCommand: '!save',
} as const;

/**
 * Votekick settings set from Studio (votekick_settings). Core is the authority: a new vote reads them at its opening,
 * an open vote keeps what it opened with. Default = the SAMMI rule (VOTEKICK.voteMs).
 */
export const VOTEKICK_SETTINGS = {
  voteSecondsDefault: VOTEKICK.voteMs / 1000,
  voteSecondsMin: 15,
  voteSecondsMax: 300,
} as const;

export const CAUTION = {
  /** CAUTION_START: 1 000 Jetons per started minute still to serve. */
  pricePerMinute: 1_000,
  /** CAUTION_START: the quote waits 30 s for the payer's `oui` / `non`. */
  quoteMs: 30_000,
  confirmWord: 'oui',
  cancelWord: 'non',
} as const;

export type VotekickOutcome =
  | 'no_quorum'
  | 'no_timeout'
  | 'target_timeout'
  | 'target_timeout_perfect'
  | 'coinflip_target'
  | 'coinflip_initiator'
  | 'backfire';

export interface VotekickTally {
  /** KICK count, the initiator's automatic vote included (SAMMI `vk_yes`). */
  kick: number;
  /** SAVE count (SAMMI `vk_no`). */
  save: number;
  /** The target voted SAVE for himself: that vote does not spoil a Perfect (SAMMI `perfect_no`). */
  targetSaved: boolean;
}

export interface VotekickVerdict {
  outcome: VotekickOutcome;
  /** Who is sanctioned, or null (no_quorum, no_timeout). */
  punished: 'target' | 'initiator' | null;
  minutes: number;
  /** minutes × 60 (0 without a sanction). */
  durationS: number;
}

/** The timeout minutes for a vote count: round(5 + (count − 2) × 25 / 18), within [5, 30]. */
export function votekickMinutes(count: number) {
  // ponytail: Math.round; GameMaker's round() may differ on .5 — only count 11 lands on .5 (17.5): to check in SAMMI.
  const m = Math.round(5 + ((count - 2) * 25) / 18);
  return Math.min(VOTEKICK.maxMinutes, Math.max(VOTEKICK.minMinutes, m));
}

/**
 * VK_FINISH, in its order: no quorum; KICK majority (Perfect ×2 when no SAVE except the target's own); a tie from 4
 * votes → coin flip (`coin` 0 = the target loses, 1 = the initiator; minutes of the KICK count, not doubled); only the
 * initiator's KICK against at least 2 SAVE → Backfire (minutes of the SAVE count ×2, the initiator); otherwise saved.
 */
export function votekickVerdict(
  t: VotekickTally,
  coin: () => 0 | 1,
): VotekickVerdict {
  const total = t.kick + t.save;
  const none = (outcome: VotekickOutcome): VotekickVerdict => ({
    outcome,
    punished: null,
    minutes: 0,
    durationS: 0,
  });
  const sanction = (
    outcome: VotekickOutcome,
    punished: 'target' | 'initiator',
    minutes: number,
  ): VotekickVerdict => ({
    outcome,
    punished,
    minutes,
    durationS: minutes * 60,
  });
  if (total < VOTEKICK.quorum) return none('no_quorum');
  if (t.kick > t.save) {
    const minutes = votekickMinutes(t.kick);
    const otherSaves = t.save - (t.targetSaved ? 1 : 0);
    return otherSaves === 0
      ? sanction(
          'target_timeout_perfect',
          'target',
          minutes * VOTEKICK.doubleFactor,
        )
      : sanction('target_timeout', 'target', minutes);
  }
  if (total >= VOTEKICK.coinflipMinVotes && t.kick === t.save) {
    const minutes = votekickMinutes(t.kick);
    return coin() === 0
      ? sanction('coinflip_target', 'target', minutes)
      : sanction('coinflip_initiator', 'initiator', minutes);
  }
  if (t.kick === 1 && t.save >= 2)
    return sanction(
      'backfire',
      'initiator',
      votekickMinutes(t.save) * VOTEKICK.doubleFactor,
    );
  return none('no_timeout');
}

/** VK_MUTE_BROADCASTER: the broadcaster cannot be timed out; muted min(300, max(30, timeout s / 12)) seconds. */
export function broadcasterMuteSeconds(durationS: number) {
  return Math.min(
    VOTEKICK.muteMaxS,
    Math.max(VOTEKICK.muteMinS, durationS / VOTEKICK.muteDivisor),
  );
}

/** CAUTION_START: ceil(remaining s / 60) × 1 000 Jetons (0 when nothing is left). */
export function cautionPrice(remainingS: number) {
  return Math.max(0, Math.ceil(remainingS / 60)) * CAUTION.pricePerMinute;
}

/**
 * The overlay's event (`votekick_update`, sent by SAMMI through obs-browser `emit_event`): the legacy fields kept
 * (`yes` = KICK, `no` = SAVE, `ends` in ms), plus `seq` (V2: a stale event of the same session is ignored).
 */
export interface VotekickOverlayEvent {
  action: 'live' | 'open' | 'update' | 'result' | 'clear';
  session?: string;
  seq?: number;
  target?: string;
  initiator?: string;
  avatar?: string;
  yes?: number;
  no?: number;
  ends?: number;
  /** V2: the vote's length in seconds (the one it opened with), for the overlay's countdown. */
  dur?: number;
  outcome?: VotekickOutcome | 'broadcaster_muted';
  /** V2: who is sanctioned (the broadcaster muted may be the initiator after a Backfire). */
  punished?: string;
  minutes?: number;
  mute_seconds?: number;
}
