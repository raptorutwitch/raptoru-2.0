// Tombola V2 overlay — pure view model. Everything here is derived from Core's snapshot and the
// clock; nothing is decided (Core owns the phases, the timer, the winners, the amounts, FULL, the
// launch sound and its time window). Kept apart from the DOM so it can be tested on its own.

/** Core's time now, from the last snapshot (`server_time`) and the local time elapsed since. */
export function serverNow(snapshot, receivedAt, now) {
  return Date.parse(snapshot.server_time) + (now - receivedAt);
}

/**
 * What the single source shows at time `t`:
 * idle · announce (opening) · running · paused · drawing · result (reveal) · empty (no participant)
 * · cancel · exit (end of the result display, fading out).
 */
export function phaseOf(round, t) {
  if (!round) return 'idle';
  switch (round.status) {
    case 'cancelled':
      return round.cancel_until && t < Date.parse(round.cancel_until)
        ? 'cancel'
        : 'idle';
    case 'opening':
      return 'announce';
    case 'open':
      return 'running';
    case 'paused':
      return 'paused';
    case 'drawing':
      return 'drawing';
    case 'revealing':
    case 'revealed': {
      // The winners (and FULL) arrive with the reveal; before that it is still « Tirage en cours ».
      if (!round.reveal) return 'drawing';
      if (
        round.reveal.overlay_end_at &&
        t >= Date.parse(round.reveal.overlay_end_at)
      )
        return 'exit';
      return round.outcome === 'no_participants' ? 'empty' : 'result';
    }
    default:
      return 'idle';
  }
}

/** Whole seconds left (Core's closes_at, never more than the round length; frozen when paused). */
export function secondsLeft(round, t) {
  if (!round) return 0;
  const ms = round.paused
    ? round.remaining_ms
    : Date.parse(round.closes_at) - t;
  return Math.max(0, Math.ceil(Math.min(round.duration_ms, ms) / 1000));
}

/** The round length in seconds (ring reference). */
export const totalSeconds = (round) =>
  Math.max(1, Math.round((round?.duration_ms ?? 60_000) / 1000));

/**
 * Join feedback FIFO: the entries newer than the last one shown (Core's `seq`), oldest first. The
 * first snapshot after a (re)load only primes the cursor: old entries are never replayed.
 */
export function createFeed() {
  let lastSeq = null;
  return {
    /** Returns the entries to show (in order) and moves the cursor. */
    take(tail) {
      const list = (tail ?? []).slice().sort((a, b) => a.seq - b.seq);
      const max = list.length ? list[list.length - 1].seq : (lastSeq ?? 0);
      if (lastSeq === null) {
        lastSeq = max;
        return [];
      }
      const fresh = list.filter((e) => e.seq > lastSeq);
      lastSeq = Math.max(lastSeq, max);
      return fresh;
    },
    get primed() {
      return lastSeq !== null;
    },
  };
}

/**
 * Launch sound: played once per round, only inside Core's window (`play_until`, right after the
 * opening) and never again for a round already played (reload / reconnect). Core chose the sound
 * when the round opened (normal / SUPER / giveaway; never a FULL one).
 */
export function soundToPlay(round, t, played) {
  const s = round?.launch_sound;
  if (!s || played.has(round.raffle_id)) return null;
  if (!['opening', 'open'].includes(round.status)) return null;
  if (t >= Date.parse(s.play_until)) return null;
  return {
    url: `/raffle-lab/sounds/${s.asset_id}.${s.format}`,
    volume: Math.max(0, Math.min(1, s.volume / 100)),
  };
}

/**
 * Reveal G timeline (ms from `reveal_at`), the same one Core uses to place the end of the reveal
 * (rules.revealMs): cards one by one; normal = each gain right after its card; SUPER = every card
 * first, a short pause, then all the gains together.
 */
export function revealGTimeline(kind, k) {
  const start = kind === 'super' ? 1300 : 750;
  const gap = k <= 3 ? 1050 : k <= 6 ? 820 : Math.max(420, 5200 / k);
  return {
    cards: Array.from({ length: k }, (_, i) => start + i * gap),
    gains:
      kind === 'super'
        ? [start + (k - 1) * gap + 520 + 900]
        : Array.from({ length: k }, (_, i) => start + i * gap + 380),
    gainMs: kind === 'super' ? 900 : 700,
  };
}

/** FULL OSEILLE compact roulette timeline (ms from `reveal_at`), as in rules.revealMs. */
export const FULL_TIMELINE = { start: 650, spin: 4300, settle: 600, name: 380 };
