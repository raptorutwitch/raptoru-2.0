import { describe, expect, it } from 'vitest';
import {
  createFeed,
  phaseOf,
  revealGTimeline,
  secondsLeft,
  serverNow,
  soundToPlay,
} from '../raffle-overlay/model.js';
import { revealMs } from '../../../core-api/src/raffle-lab/rules.js';

// Tombola V2 OBS overlay — its view model only follows Core's snapshot and clock (nothing decided).

const T0 = Date.parse('2026-10-02T20:00:00.000Z');
const iso = (ms) => new Date(T0 + ms).toISOString();
const round = (over = {}) => ({
  raffle_id: 'r-1',
  status: 'open',
  kind: 'normal',
  closes_at: iso(60_000),
  duration_ms: 60_000,
  remaining_ms: 60_000,
  paused: false,
  outcome: null,
  launch_sound: null,
  reveal: null,
  ...over,
});

describe('overlay phases (Core status → what the single source shows)', () => {
  it('opening / open / pause / drawing / reveal / no participant / cancellation / end', () => {
    expect(phaseOf(null, T0)).toBe('idle');
    expect(phaseOf(round({ status: 'opening' }), T0)).toBe('announce');
    expect(phaseOf(round(), T0)).toBe('running');
    expect(phaseOf(round({ status: 'paused', paused: true }), T0)).toBe(
      'paused',
    );
    expect(phaseOf(round({ status: 'drawing' }), T0)).toBe('drawing');
    // No winner nor FULL before the reveal: still « Tirage en cours ».
    expect(phaseOf(round({ status: 'revealing', reveal: null }), T0)).toBe(
      'drawing',
    );
    const reveal = { overlay_end_at: iso(20_000), winners: [] };
    expect(
      phaseOf(round({ status: 'revealing', outcome: 'winners', reveal }), T0),
    ).toBe('result');
    expect(
      phaseOf(
        round({ status: 'revealed', outcome: 'winners', reveal }),
        T0 + 20_000,
      ),
    ).toBe('exit');
    expect(
      phaseOf(
        round({ status: 'revealed', outcome: 'no_participants', reveal }),
        T0,
      ),
    ).toBe('empty');
    expect(
      phaseOf(
        round({ status: 'cancelled', cancel_until: iso(4000) }),
        T0 + 3999,
      ),
    ).toBe('cancel');
    expect(
      phaseOf(
        round({ status: 'cancelled', cancel_until: iso(4000) }),
        T0 + 4000,
      ),
    ).toBe('idle');
    expect(phaseOf(round({ status: 'finished' }), T0)).toBe('idle');
  });
});

describe('overlay timer (Core closes_at only)', () => {
  it('counts down from closes_at, capped at the round length, frozen while paused', () => {
    expect(secondsLeft(round(), T0)).toBe(60);
    expect(secondsLeft(round(), T0 + 50_200)).toBe(10); // the last 10 seconds (amber)
    expect(secondsLeft(round(), T0 + 61_000)).toBe(0);
    // Opening announcement: Core's closes_at includes it, the ring never shows more than 60.
    expect(
      secondsLeft(round({ status: 'opening', closes_at: iso(62_000) }), T0),
    ).toBe(60);
    const paused = round({
      status: 'paused',
      paused: true,
      remaining_ms: 23_400,
    });
    expect(secondsLeft(paused, T0)).toBe(24);
    expect(secondsLeft(paused, T0 + 30_000)).toBe(24);
  });

  it('Core time = server_time + local time elapsed since the read (no video re-sync)', () => {
    expect(serverNow({ server_time: iso(5000) }, 1000, 1250)).toBe(T0 + 5250);
  });
});

describe('join feedback FIFO (Core seq)', () => {
  it('a (re)load only primes the cursor; then each new entry once, in order, never twice', () => {
    const feed = createFeed();
    const e = (seq, name) => ({ seq, display_name: name, source: 'chat' });
    expect(feed.take([e(1, 'a'), e(2, 'b')])).toEqual([]); // reload: old entries never replayed
    expect(
      feed
        .take([e(1, 'a'), e(2, 'b'), e(4, 'd'), e(3, 'c')])
        .map((x) => x.display_name),
    ).toEqual(['c', 'd']);
    expect(feed.take([e(3, 'c'), e(4, 'd')])).toEqual([]);
    expect(feed.take([e(5, 'e')]).map((x) => x.display_name)).toEqual(['e']);
  });
});

describe('launch sound (Core decides which one and when)', () => {
  const sound = {
    asset_id: 'a'.repeat(64),
    format: 'mp3',
    volume: 55,
    play_until: iso(4000),
  };
  it('plays once, inside Core window, at the configured volume; never after a reload of a played round', () => {
    const played = new Set();
    const r = round({ status: 'opening', launch_sound: sound });
    expect(soundToPlay(r, T0 + 100, played)).toEqual({
      url: `/raffle-lab/sounds/${'a'.repeat(64)}.mp3`,
      volume: 0.55,
    });
    played.add('r-1');
    expect(soundToPlay(r, T0 + 200, played)).toBeNull(); // already played (reload / reconnect)
    expect(
      soundToPlay(
        round({ status: 'open', launch_sound: sound }),
        T0 + 4000,
        new Set(),
      ),
    ).toBeNull(); // window over
    expect(
      soundToPlay(
        round({ status: 'drawing', launch_sound: sound }),
        T0 + 100,
        new Set(),
      ),
    ).toBeNull();
    expect(soundToPlay(round({ status: 'opening' }), T0, new Set())).toBeNull(); // no sound configured
  });
});

describe('reveal G timeline = the one Core uses to end the reveal', () => {
  it.each([
    ['normal', 1],
    ['normal', 3],
    ['normal', 6],
    ['normal', 12],
    ['super', 1],
    ['super', 5],
  ])('%s · %i winner(s): last gain + count = Core reveal end', (kind, k) => {
    const tl = revealGTimeline(kind, k);
    expect(tl.cards).toHaveLength(k);
    const lastCard = tl.cards[k - 1] + 520;
    const end =
      kind === 'super'
        ? tl.gains[0] + tl.gainMs + 300
        : lastCard + 380 + 700 + 300;
    expect(Math.round(end)).toBe(revealMs(kind, false, k));
  });
});
