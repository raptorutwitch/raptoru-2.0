import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MUSIC_OVERLAY_DEFAULT,
  MusicOverlay,
  type MusicCardPlayer,
} from '../src/spotify/overlay.js';

// Music Hub V2 — the OBS music card (src/spotify/overlay.ts): off by default; a request newly queued (and, as an
// option, one starting) is shown ONCE, never late (the first reading after a start or a gap only notes), one card at a
// time with a short backlog; the card goes through the effects player (kind `music`), a refused card is only logged.

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

type Played = Parameters<MusicCardPlayer['play']>[0];

async function overlay(o: { fail?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mh-overlay-'));
  dirs.push(dir);
  const clock = { t: 1_000_000 };
  const played: Played[] = [];
  const logs: string[] = [];
  const ends: (() => void)[] = [];
  const player: MusicCardPlayer = {
    play: async (effect) => {
      if (o.fail) throw new Error(o.fail);
      played.push(effect);
      return { end: new Promise<void>((r) => ends.push(r)) };
    },
  };
  const file = join(dir, 'music-overlay.json');
  const ov = await MusicOverlay.open(
    file,
    player,
    (l) => logs.push(l),
    () => clock.t,
  );
  const flush = async () => {
    for (let i = 0; i < 10; i++) {
      ends.splice(0).forEach((r) => r());
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { ov, played, logs, clock, file, flush, ends };
}

const req = (n: number, state = 'QUEUED', title = `Titre ${n}`) => ({
  request_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  state,
  track: { title, artists: [`Artiste ${n}`] },
  viewer: { name: `Viewer${n}` },
});

describe('Music Hub V2 — OBS music card', () => {
  it('off by default: nothing is read for it, nothing shown; the setting is saved and validated', async () => {
    const h = await overlay();
    expect(h.ov.config).toEqual(MUSIC_OVERLAY_DEFAULT);
    expect(h.ov.following).toBe(false);
    h.ov.observe({ queue: [req(1)] });
    h.clock.t += 2_500;
    h.ov.observe({ queue: [req(1), req(2)] });
    expect(h.played).toHaveLength(0);
    await expect(
      h.ov.save({ ...MUSIC_OVERLAY_DEFAULT, duration_s: 99 }),
    ).rejects.toThrow();
    await h.ov.save({
      ...MUSIC_OVERLAY_DEFAULT,
      enabled: true,
      sound: 'tiens-bon',
      volume: 40,
    });
    expect(JSON.parse(await readFile(h.file, 'utf8'))).toMatchObject({
      enabled: true,
      sound: 'tiens-bon',
      volume: 40,
    });
    expect(h.ov.following).toBe(true);
    const again = await MusicOverlay.open(h.file, null);
    expect(again.config.enabled).toBe(true);
    expect(again.available).toBe(false);
  });

  it('a new request: one card (title, artist, requester), once — the queue already there when it starts is only noted', async () => {
    const h = await overlay();
    await h.ov.save({
      ...MUSIC_OVERLAY_DEFAULT,
      enabled: true,
      duration_s: 5,
      position: 'bottom-left',
    });
    h.ov.observe({ queue: [req(1)] }); // first reading: noted
    h.clock.t += 2_500;
    h.ov.observe({ queue: [req(1), req(2)] });
    h.clock.t += 2_500;
    h.ov.observe({ queue: [req(1), req(2)] }); // the same again: nothing
    await h.flush();
    expect(h.played).toEqual([
      {
        kind: 'music',
        card: {
          event: 'request',
          title: 'Titre 2',
          artists: ['Artiste 2'],
          requested_by: 'Viewer2',
        },
        sound: null,
        volume: 60,
        duration_ms: 5_000,
        position: 'bottom-left',
      },
    ]);
  });

  it('« au début de la lecture » (option): the request starting gets its card; never a late « nouvelle demande » for it', async () => {
    const h = await overlay();
    await h.ov.save({
      ...MUSIC_OVERLAY_DEFAULT,
      enabled: true,
      on_request: false,
      on_start: true,
    });
    h.ov.observe({ queue: [req(1)] });
    h.clock.t += 2_500;
    h.ov.observe({ queue: [req(2)], current: req(1, 'PLAYING') });
    await h.flush();
    expect(h.played.map((p) => [p.card.event, p.card.title])).toEqual([
      ['start', 'Titre 1'],
    ]);
  });

  it('after a gap without Core (or right after switching on): what is there is noted, never shown late', async () => {
    const h = await overlay();
    await h.ov.save({ ...MUSIC_OVERLAY_DEFAULT, enabled: true });
    h.ov.observe({ queue: [] });
    h.clock.t += 60_000; // Core unreachable for a minute
    h.ov.observe({ queue: [req(1), req(2)] });
    h.clock.t += 2_500;
    h.ov.observe({ queue: [req(1), req(2), req(3)] });
    await h.flush();
    expect(h.played.map((p) => p.card.title)).toEqual(['Titre 3']);
  });

  it('a burst: one card on screen at a time, the latest few kept (never a long tail); a refused card is only logged', async () => {
    const h = await overlay();
    await h.ov.save({ ...MUSIC_OVERLAY_DEFAULT, enabled: true });
    h.ov.observe({ queue: [] });
    h.clock.t += 2_500;
    h.ov.observe({ queue: [1, 2, 3, 4, 5, 6, 7].map((n) => req(n)) });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.played).toHaveLength(1); // the first one on screen, the others wait
    await h.flush();
    expect(h.played.map((p) => p.card.title)).toEqual([
      'Titre 1',
      'Titre 4',
      'Titre 5',
      'Titre 6',
      'Titre 7',
    ]);
    const bad = await overlay({ fail: 'effects_player_offline' });
    await bad.ov.save({ ...MUSIC_OVERLAY_DEFAULT, enabled: true });
    bad.ov.observe({ queue: [] });
    bad.clock.t += 2_500;
    bad.ov.observe({ queue: [req(1)] });
    await bad.flush();
    expect(bad.logs.join('\n')).toMatch(
      /carte non affichée : effects_player_offline/,
    );
  });

  it('« Prévisualiser »: a sample card through the same path, with the chosen sound', async () => {
    const h = await overlay();
    await h.ov.save({
      ...MUSIC_OVERLAY_DEFAULT,
      sound: 'tiens-bon',
      volume: 30,
    });
    expect(await h.ov.preview()).toEqual({ shown: true });
    expect(h.played[0]).toMatchObject({
      kind: 'music',
      sound: 'tiens-bon',
      volume: 30,
    });
  });
});

describe('Music Hub V2 — OBS music card storage', () => {
  it('the first save creates the module folder when it does not exist yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mh-overlay-'));
    dirs.push(dir);
    const file = join(dir, 'not-yet', 'music-overlay.json');
    const ov = await MusicOverlay.open(file, null);
    await ov.save({ ...MUSIC_OVERLAY_DEFAULT, enabled: true });
    expect(JSON.parse(await readFile(file, 'utf8')).enabled).toBe(true);
  });
});
