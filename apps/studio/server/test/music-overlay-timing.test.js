import { describe, expect, it } from 'vitest';
import { LATE_REQUEST_MS, timeline } from '../music-overlay/overlay-timing.js';

// Music overlay — when it shows (docs/music/MUSIC_OVERLAYS.md § 3 ter): the event strip at each new track for its
// announce time, never on a pause / resume or a refresh, armed by « Afficher », the late requester without a replay.

const settings = (display = {}) => ({
  display: {
    mode: 'announce',
    announce_s: 30,
    on_pause: 'hide',
    on_idle: 'hide',
    request_spotlight: true,
    ...display,
  },
});
const track = (gen, extra = {}) => ({
  state: 'playing',
  gen,
  track: { title: `T${gen}`, artists: ['A'], album: null, duration_ms: 200000 },
  position_ms: 1000,
  cover: null,
  request: null,
  ...extra,
});

/** An OBS page (not the editor), shown from Studio, its model changed step by step. */
function page(display, o = {}) {
  const tl = timeline(o);
  const m = {
    preset: { settings: settings(display) },
    live: track(1),
    visible: true,
    offline: false,
    pulse: 0,
  };
  const at = (t, patch = {}) => {
    Object.assign(m, patch);
    return tl.step(m, t).form;
  };
  return { tl, m, at };
}

describe('the event strip (announce mode, 30 s)', () => {
  it('the track already playing when the page opens: not announced (an OBS reload is not a new track); armed only', () => {
    const p = page();
    expect(p.at(0)).toBe('hidden');
    expect(p.at(5000)).toBe('hidden');
  });

  it('a new track: shown 30 s, then gone', () => {
    const p = page();
    p.at(0);
    expect(p.at(1000, { live: track(2) })).toBe('full');
    expect(p.tl.until).toBe(31000);
    expect(p.at(30999)).toBe('full');
    expect(p.at(31000)).toBe('hidden');
  });

  it('another track during the announce: the 30 s start again', () => {
    const p = page();
    p.at(0);
    p.at(1000, { live: track(2) });
    expect(p.at(20000, { live: track(3) })).toBe('full');
    expect(p.at(45000)).toBe('full');
    expect(p.at(50000)).toBe('hidden');
  });

  it('the same track really played again (a new occurrence): announced again', () => {
    const p = page();
    p.at(0);
    p.at(1000, { live: track(2) });
    expect(p.at(40000)).toBe('hidden');
    expect(p.at(41000, { live: { ...track(3), track: track(2).track } })).toBe(
      'full',
    );
  });

  it('pause / resume, refreshes of the same occurrence: never a new announce', () => {
    const p = page();
    p.at(0);
    p.at(1000, { live: track(2) });
    // Paused (« Cacher » en pause) then resumed within the announce: back, same end.
    expect(p.at(5000, { live: track(2, { state: 'paused' }) })).toBe('hidden');
    expect(p.at(8000, { live: track(2) })).toBe('full');
    expect(p.tl.until).toBe(31000);
    // Resumed after the announce: stays hidden.
    expect(p.at(35000, { live: track(2, { state: 'paused' }) })).toBe('hidden');
    expect(p.at(60000, { live: track(2, { position_ms: 90000 }) })).toBe(
      'hidden',
    );
    // Studio cut then back (offline → online): nothing replayed.
    expect(p.at(61000, { offline: true })).toBe('hidden');
    expect(p.at(70000, { offline: false })).toBe('hidden');
  });

  it('a confirmed request: shown with the track; one confirmed late keeps the strip without a full replay', () => {
    const p = page();
    p.at(0);
    p.at(1000, { live: track(2) });
    // The requester read 25 s in: the strip stays 8 s more (the tab is read), the announce is not restarted.
    expect(p.at(26000, { live: track(2, { request: { by: 'Lea' } }) })).toBe(
      'full',
    );
    expect(p.tl.until).toBe(26000 + LATE_REQUEST_MS);
    expect(p.at(31500)).toBe('full');
    expect(p.at(26000 + LATE_REQUEST_MS)).toBe('hidden');
    // Early: the end of the announce does not move.
    p.at(40000, { live: track(3) });
    p.at(41000, { live: track(3, { request: { by: 'Lea' } }) });
    expect(p.tl.until).toBe(70000);
  });

  it('a request confirmed after the announce: it comes back for it (« Mettre en avant »), once', () => {
    const p = page();
    p.at(0);
    p.at(1000, { live: track(2) });
    expect(p.at(40000)).toBe('hidden');
    expect(p.at(41000, { live: track(2, { request: { by: 'Lea' } }) })).toBe(
      'full',
    );
    expect(p.at(72000)).toBe('hidden');
    expect(p.at(73000, { live: track(2, { request: { by: 'Lea' } }) })).toBe(
      'hidden',
    );
    // Without « Mettre en avant »: the tab is not worth a new announce.
    const q = page({ request_spotlight: false });
    q.at(0);
    q.at(1000, { live: track(2) });
    expect(q.at(41000, { live: track(2, { request: { by: 'Lea' } }) })).toBe(
      'hidden',
    );
  });

  it('Spotify closed: hidden at once; reopened on a new track: announced', () => {
    const p = page();
    p.at(0);
    p.at(1000, { live: track(2) });
    expect(
      p.at(2000, { live: { ...track(2), state: 'off', track: null } }),
    ).toBe('hidden');
    expect(p.at(9000, { live: track(3) })).toBe('full');
  });

  it('« Masquer »: hidden at once and nothing appears; « Afficher » arms it (nothing before the next track); « Montrer maintenant » shows it', () => {
    const p = page();
    p.at(0);
    p.at(1000, { live: track(2) });
    expect(p.at(2000, { visible: false })).toBe('hidden');
    expect(p.at(3000, { live: track(3) })).toBe('hidden');
    expect(p.at(4000, { visible: true })).toBe('hidden');
    expect(p.at(5000, { live: track(4) })).toBe('full');
    expect(p.at(40000)).toBe('hidden');
    expect(p.at(41000, { pulse: 1 })).toBe('full');
    expect(p.at(71000)).toBe('hidden');
  });
});

describe('the other modes', () => {
  it('always: shown while music plays, whatever the announces; hidden on Spotify closed', () => {
    const p = page({ mode: 'always', on_pause: 'show' });
    expect(p.at(0)).toBe('full');
    expect(p.at(1000, { live: track(2) })).toBe('full');
    expect(p.at(90000)).toBe('full');
    expect(p.at(91000, { live: track(2, { state: 'paused' }) })).toBe('full');
    expect(p.at(92000, { live: { ...track(2), state: 'lost' } })).toBe(
      'hidden',
    );
  });

  it('hybrid: compact, expanded at a new track and when shown from Studio', () => {
    const p = page({ mode: 'hybrid', announce_s: 9 });
    expect(p.at(0)).toBe('full'); // shown from Studio: wide once
    expect(p.at(9000)).toBe('compact');
    expect(p.at(10000, { live: track(2) })).toBe('full');
    expect(p.at(19000)).toBe('compact');
    expect(p.at(20000, { visible: false })).toBe('hidden');
    expect(p.at(21000, { visible: true })).toBe('full');
  });

  it('the editor preview: every track announced, even the first; the gallery card: always full', () => {
    const e = timeline({ preview: true });
    const m = {
      preset: { settings: settings() },
      live: track(1),
      visible: false,
      offline: false,
      pulse: 0,
    };
    expect(e.step(m, 0).form).toBe('full');
    const c = timeline({ card: true });
    expect(c.step(m, 0).form).toBe('full');
    expect(c.step({ ...m, live: null }, 1).form).toBe('idle');
  });
});

describe('the editor preview', () => {
  it('a setting changed after the announce shows the widget again (what is edited is seen)', () => {
    const e = timeline({ preview: true });
    const m = {
      preset: { settings: settings() },
      live: track(1),
      visible: true,
      offline: false,
      pulse: 0,
    };
    e.step(m, 0);
    expect(e.step(m, 40000).form).toBe('hidden');
    expect(e.step({ ...m }, 41000).form).toBe('hidden'); // the same setting again: nothing
    m.preset = { settings: settings({ announce_s: 20 }) };
    expect(e.step(m, 42000).form).toBe('full');
  });
});
