import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The legacy Votekick overlay (votekick-overlay/legacy/votekick-overlay.html, the page OBS shows): its countdown is
// drawn from Core's `ends` on THIS PC's clock. A PC late by 2.2 s (24/10, Windows Time off) showed 62–63 at the
// opening. The conversion is the page's own function, read from the page itself.

const page = readFileSync(
  new URL('../votekick-overlay/legacy/votekick-overlay.html', import.meta.url),
  'utf8',
);
const block =
  /<votekick-local-ends>[^\n]*\n([\s\S]*?)\n\s*\/\/ <\/votekick-local-ends>/.exec(
    page,
  )?.[1];
const localEnds = new Function(`${block}; return localEnds;`)();
const shown = (ends, now) => Math.max(0, Math.ceil((ends - now) / 1000)); // the page's countdown
const VOTE = 60_000;

describe('legacy overlay: the vote countdown on the local clock', () => {
  it('is the page’s own function', () => {
    expect(block).toContain('function localEnds');
    expect(typeof localEnds).toBe('function');
  });

  it('a PC 2.2 s late (the 24/10 case): 60 at the opening, never 62–63', () => {
    const serverOpen = 1_000_000;
    const serverEnds = serverOpen + VOTE;
    // Seen 0.5 s after the opening on a PC clock 2.2 s behind the server.
    const pcNow = serverOpen + 500 - 2_200;
    expect(shown(serverEnds, pcNow)).toBeGreaterThanOrEqual(62); // before the fix (62–63 seen)
    const ends = localEnds(serverEnds, pcNow, VOTE);
    expect(shown(ends, pcNow)).toBe(60);
    expect(ends - pcNow).toBe(VOTE);
  });

  it('clocks in agreement: the true remaining time (59 at 0.5 s), down to 0 at Core’s end', () => {
    const now = 2_000_500;
    const serverEnds = 2_000_000 + VOTE;
    const ends = localEnds(serverEnds, now, VOTE);
    expect(ends).toBe(serverEnds);
    expect(shown(ends, now)).toBe(60); // ceil(59.5)
    expect(shown(ends, serverEnds)).toBe(0);
  });

  it('a PC ahead keeps the shorter remaining time; a vote already over shows 0', () => {
    expect(localEnds(1_060_000, 1_002_000, VOTE)).toBe(1_060_000);
    expect(localEnds(1_060_000, 1_070_000, VOTE)).toBe(1_070_000);
  });

  it('the length Core applied (`dur`, set in Studio) caps the countdown: a 30 s vote never shows more than 30', () => {
    const live = page.slice(page.indexOf("action === 'live'"));
    const durLine = live.indexOf(
      'state.duration = Math.max(5, Number(payload.dur))',
    );
    expect(durLine).toBeGreaterThan(-1);
    expect(durLine).toBeLessThan(live.indexOf('localEnds(incomingEnds')); // set before the conversion
    const pcNow = 5_000_000;
    const ends = localEnds(pcNow + 32_000, pcNow, 30_000); // PC 2 s late on a 30 s vote
    expect(shown(ends, pcNow)).toBe(30);
  });

  it('anchored once per vote: later updates of the same vote never move the end', () => {
    const live = page.slice(page.indexOf("action === 'live'"));
    expect(live).toMatch(/endsAnchor !== session \+ ':' \+ incomingEnds/);
    expect(live).toMatch(
      /state\.ends = localEnds\(incomingEnds, Date\.now\(\), state\.duration \* 1000\)/,
    );
  });
});
