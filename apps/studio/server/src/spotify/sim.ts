import { normalizeText, type Candidate } from './search.js';

// Spotify V2 — the Lab's Spotify (CLAUDE.md: the Lab tests end to end without external services). A fake Web API
// answering the few endpoints Raptoru uses, plugged in place of `fetch` in the ONE gate (api.ts): same pacing, cache
// and 429 handling as for real. Explicit and isolated: never the real account, never the real queue. The panel drives
// it (end of track, a track outside the requests, no device, a 429, a 200 instead of 204).

/** A plain simulated cover (one hue per track), so the Lab's page shows what Production's shows. */
const simCover = (id: string) => {
  const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3"><rect width="3" height="3" fill="hsl(${hue} 45% 32%)"/><circle cx="1" cy="1.2" r="1.2" fill="hsl(${(hue + 40) % 360} 55% 50%)"/></svg>`)}`;
};

const track = (
  id: string,
  name: string,
  artists: string[],
  duration_ms: number,
  o: { album?: string; art?: boolean; playable?: boolean } = {},
): Candidate => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: artists.map((name) => ({ name })),
  duration_ms,
  album: {
    ...(o.album ? { name: o.album } : {}),
    images: o.art === false ? [] : [{ url: simCover(id) }],
  },
  ...(o.playable === false ? { is_playable: false } : {}),
});

/** Music Hub: a fictional catalogue (invented artists and titles), with what a real one shows — several versions of a
 *  title, the same title by two artists, short and too long tracks, a version that cannot be played, no cover. */
const labId = (n: number) => `LABMUSIC${String(n).padStart(14, '0')}`;
const m = (min: number, sec: number) => (min * 60 + sec) * 1000;
export const LAB_CATALOG: Candidate[] = [
  track(labId(1), 'Nuit Blanche', ['Lune Rouge'], m(3, 42), { album: 'Néons' }),
  track(labId(2), 'Nuit Blanche (Live à Lyon)', ['Lune Rouge'], m(4, 58), {
    album: 'Néons — Live',
  }),
  track(
    labId(3),
    'Nuit Blanche (Remix Club)',
    ['Lune Rouge', 'DJ Orbite'],
    m(5, 31),
    { album: 'Néons Remixés' },
  ),
  track(labId(4), 'Nuit Blanche', ['Les Phares'], m(2, 57), {
    album: 'Marées',
  }),
  track(labId(5), 'Comète', ['Ava Solène'], m(3, 18), { album: 'Ciel Ouvert' }),
  track(labId(6), 'Comète (Acoustique)', ['Ava Solène'], m(3, 4), {
    album: 'Ciel Ouvert — Sessions',
    art: false,
  }),
  track(labId(7), 'Pixel Rain', ['Kairo Station'], m(3, 55), {
    album: 'Arcade Heart',
  }),
  track(labId(8), 'Boss Final', ['Kairo Station'], m(2, 41), {
    album: 'Arcade Heart',
  }),
  track(labId(9), 'Respawn', ['Kairo Station', 'Mira'], m(3, 33), {
    album: 'Arcade Heart',
  }),
  track(labId(10), 'Velours', ['Mira'], m(4, 12), { album: 'Satin' }),
  track(labId(11), 'Satin Noir', ['Mira'], m(3, 49), { album: 'Satin' }),
  track(labId(12), 'Raptor Run', ['The Velociraptors'], m(2, 48), {
    album: 'Jurassic Garage',
  }),
  track(labId(13), 'Fossiles', ['The Velociraptors'], m(3, 26), {
    album: 'Jurassic Garage',
    art: false,
  }),
  track(labId(14), 'Odyssée Intégrale', ['Orchestre Halcyon'], m(12, 30), {
    album: 'Odyssée',
  }),
  track(labId(15), 'Prélude', ['Orchestre Halcyon'], m(1, 52), {
    album: 'Odyssée',
  }),
  track(labId(16), 'Session Perdue', ['Lune Rouge'], m(3, 10), {
    album: 'Inédits',
    playable: false,
  }),
  track(labId(17), 'Lo-fi pour réviser', ['Café Cassette'], m(2, 22), {
    album: 'Pluie de Mars',
  }),
  track(labId(18), 'Lo-fi pour coder', ['Café Cassette'], m(2, 35), {
    album: 'Pluie de Mars',
  }),
  track(labId(19), 'Lo-fi pour dormir', ['Café Cassette'], m(3, 1), {
    album: 'Pluie de Mars',
    art: false,
  }),
  track(labId(20), 'Hymne du Chat', ['Raptoru Allstars'], m(3, 3), {
    album: 'Communauté Vol. 1',
  }),
  track(labId(21), 'GG WP', ['Raptoru Allstars', 'Ava Solène'], m(2, 59), {
    album: 'Communauté Vol. 1',
  }),
  track(labId(22), 'Tempête', ['Les Phares'], m(4, 40), { album: 'Marées' }),
  track(labId(23), 'Tempête (Radio Edit)', ['Les Phares'], m(3, 9), {
    album: 'Marées (Radio)',
  }),
  track(labId(24), 'Été Indien', ['Solaris Club'], m(3, 37), {
    album: 'Saison 2',
  }),
  track(labId(25), 'Ultraviolet', ['Solaris Club', 'Mira'], m(4, 4), {
    album: 'Saison 2',
  }),
  track(
    labId(26),
    'Un titre au nom vraiment très long pour vérifier que rien ne déborde du panneau',
    ['Artiste au nom tout aussi long que le titre'],
    m(3, 33),
    { album: 'Tests de mise en page' },
  ),
  // Music Hub V2: one title in many versions, as a real catalogue answers « animal i have become » (original, remix,
  // nightcore, slowed, sped up, acoustic, live, instrumental, covers): the viewer must find the exact one.
  track(labId(27), 'Néon Sauvage', ['Lune Rouge'], m(3, 31), {
    album: 'Néons',
  }),
  track(
    labId(28),
    'Néon Sauvage (Remix)',
    ['Lune Rouge', 'DJ Orbite'],
    m(3, 58),
    {
      album: 'Néons Remixés',
    },
  ),
  track(labId(29), 'Néon Sauvage (Nightcore)', ['Kairo Station'], m(2, 49), {
    album: 'Nightcore Vol. 3',
  }),
  track(
    labId(30),
    'Néon Sauvage (Slowed + Reverb)',
    ['Café Cassette'],
    m(4, 22),
    {
      album: 'Ralenti',
    },
  ),
  track(labId(31), 'Néon Sauvage (Sped Up)', ['Lune Rouge'], m(2, 41), {
    album: 'Néon Sauvage (Sped Up)',
  }),
  track(labId(32), 'Néon Sauvage (Acoustique)', ['Ava Solène'], m(3, 40), {
    album: 'Reprises au salon',
    art: false,
  }),
  track(labId(33), 'Néon Sauvage — Live', ['Lune Rouge'], m(4, 5), {
    album: 'Néons — Live',
  }),
  track(labId(34), 'Néon Sauvage (Instrumental)', ['Lune Rouge'], m(3, 31), {
    album: 'Néons (Instrumentals)',
  }),
  track(labId(35), 'Néon Sauvage', ['Les Phares'], m(3, 12), {
    album: 'Reprises',
  }),
  track(labId(36), 'Néon Sauvage (Version Longue)', ['Lune Rouge'], m(11, 2), {
    album: 'Néons — Deluxe',
  }),
];

export const SIM_CATALOG_HISTORICAL: Candidate[] = [
  track(
    '4iV5W9uYEdYUVa79Axb7Rh',
    'Young, Wild & Free',
    ['Snoop Dogg', 'Wiz Khalifa', 'Bruno Mars'],
    207_333,
  ),
  track(
    '1bV5qzK2dW8rF3mN6pQ9sT',
    'Young, Wild & Free (Live)',
    ['Wiz Khalifa'],
    250_000,
  ),
  track('6f9sD2kL4mN8pQ1rT5vW7x', 'Numb', ['Linkin Park'], 185_000),
  track('7g1tH3mJ5nP8rS2vW4xY6z', 'Numb (Live)', ['Linkin Park'], 210_000),
  track('3n3Ppam7vgaVa1iaRUc9Lp', 'Mr. Brightside', ['The Killers'], 222_973),
  track('0VjIjW4GlUZAMYd2vXMi3b', 'Blinding Lights', ['The Weeknd'], 200_040),
  track('7qiZfU4dY1lWllzX7mPBI3', 'Shape of You', ['Ed Sheeran'], 233_712),
  track('5ChkMS8OtdzJeqyybCc9R5', 'Billie Jean', ['Michael Jackson'], 293_827),
  track(
    '2cX8vL4nR6pT1yW3qS5mK7',
    'Long Test Track',
    ['Raptoru Fixtures'],
    601_000,
  ),
];
/** Everything the Lab's catalogue answers: the historical fixtures (Spotify V2 tests) and the Music Hub catalogue. */
export const SIM_CATALOG: Candidate[] = [
  ...SIM_CATALOG_HISTORICAL,
  ...LAB_CATALOG,
];

/** What plays when no request is queued (the broadcaster's own playlist: « external » tracks). */
const PLAYLIST = [
  track(
    '1SIMext0playlist0trak1',
    'Lofi Stream Beat',
    ['Raptoru Playlist'],
    180_000,
  ),
  track('1SIMext0playlist0trak2', 'Chill Loop', ['Raptoru Playlist'], 160_000),
  track(
    '1SIMext0playlist0trak3',
    'Late Night Drive',
    ['Raptoru Playlist'],
    200_000,
  ),
];

export class SpotifySim {
  private current: Candidate | null = PLAYLIST[0]!;
  private startedAt: number;
  private playlistIndex = 0;
  private readonly userQueue: Candidate[] = [];
  deviceActive = true;
  /** Next POST /me/player/queue answers this (Spotify used to answer 200: « maybe sent »). */
  queueAnswer: 204 | 200 | 403 | 500 = 204;
  private limitedUntil = 0;
  /** The 429 says `QUOTA_EXCEEDED` (Development Mode's quota, July 2026), not a short rate limit. */
  private limitQuota = false;
  readonly calls: string[] = [];
  /** Music Hub: the player (pause keeps the progress where it was). */
  playing = true;
  private pausedProgress = 0;
  volume = 60;
  /**
   * Like Spotify's Web API right after a player command: GET /me/player still answers the state from BEFORE the command
   * this many times (0: always fresh, the default).
   */
  staleReads = 0;
  private stale: { left: number; body: unknown } | null = null;
  /** The next player command (next / pause / play / seek / volume) is applied but answers this (Spotify's 502). */
  playerAnswer: 204 | 502 = 204;

  private progress() {
    return this.playing ? this.now() - this.startedAt : this.pausedProgress;
  }

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  private advance() {
    this.current =
      this.userQueue.shift() ??
      PLAYLIST[
        (this.playlistIndex = (this.playlistIndex + 1) % PLAYLIST.length)
      ]!;
    this.startedAt = this.now();
  }

  /** Plays on: tracks that reached their end give way to the queue, then the playlist. */
  private tick() {
    if (!this.playing) return;
    for (let n = 0; n < 50 && this.current; n++) {
      const end = this.startedAt + (this.current.duration_ms ?? 0);
      if (this.now() < end) return;
      const at = end;
      this.advance();
      this.startedAt = at;
    }
  }

  // ------------------------------------------------------------------ panel controls (Lab)

  /** The current track jumps to `msBeforeEnd` before its end. */
  seekNearEnd(msBeforeEnd = 3_000) {
    this.tick();
    if (this.current)
      this.startedAt =
        this.now() - Math.max(0, (this.current.duration_ms ?? 0) - msBeforeEnd);
  }
  /** The broadcaster presses « next » in the Spotify app: the queue, then the playlist, as Spotify would. */
  skipByHand() {
    this.tick();
    this.advance();
    if (!this.playing) this.pausedProgress = 0;
  }
  /** The broadcaster plays a track by hand (outside the requests). */
  playExternal() {
    this.current =
      PLAYLIST[
        (this.playlistIndex = (this.playlistIndex + 1) % PLAYLIST.length)
      ]!;
    this.startedAt = this.now();
  }
  /** Music Hub (SMTC): Spotify Desktop closed by hand — Windows has no session, the Web API no active device. */
  closeApp(closed: boolean) {
    this.tick();
    this.appClosed = closed;
    this.deviceActive = !closed;
  }
  appClosed = false;
  /** The broadcaster plays the same track again from its start (a new occurrence). */
  replay() {
    this.tick();
    if (!this.current) return;
    this.startedAt = this.now();
    if (!this.playing) this.pausedProgress = 0;
  }
  /** Pause / resume in the Spotify app (not through Raptoru). */
  pauseByHand() {
    this.tick();
    if (this.playing) {
      this.pausedProgress = this.now() - this.startedAt;
      this.playing = false;
    } else {
      this.startedAt = this.now() - this.pausedProgress;
      this.playing = true;
    }
  }
  /**
   * What Windows would say (SMTC, smtc.ts): read from this state, never through `fetch` (it is not a Web API call and is
   * never counted as one). Spotify gives Windows the artists in one line and no track id.
   */
  local() {
    this.tick();
    if (this.appClosed || !this.current) return null;
    const c = this.current;
    return {
      title: c.name,
      artist: c.artists.map((a) => a.name).join(', '),
      album: c.album?.name ?? null,
      playing: this.playing,
      position_ms: Math.min(this.progress(), c.duration_ms ?? 0),
      end_ms: c.duration_ms ?? 0,
      // The cover's bytes, as Windows hands them (here the simulated SVG).
      cover: c.album?.images?.[0]?.url
        ? decodeURIComponent(
            c.album.images[0].url.replace(/^data:image\/svg\+xml,/, ''),
          )
        : null,
    };
  }
  rateLimit(seconds: number, quota = false) {
    this.limitedUntil = this.now() + seconds * 1000;
    this.limitQuota = quota;
  }
  view() {
    this.tick();
    return {
      device_active: this.deviceActive,
      queue_answer: this.queueAnswer,
      limited: this.limitedUntil > this.now(),
      current: this.current
        ? `${this.current.name} — ${this.current.artists.map((a) => a.name).join(', ')}`
        : null,
      progress_ms: this.current ? this.progress() : null,
      playing: this.playing,
      volume: this.volume,
      app_closed: this.appClosed,
      queue: this.userQueue.map((t) => t.name),
      calls: this.calls.length,
    };
  }

  // ------------------------------------------------------------------ the fake Web API

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/v1\//, '');
    this.calls.push(`${method} ${path}`);
    if (this.calls.length > 1000) this.calls.splice(0, 500);
    const json = (
      status: number,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    if (this.limitedUntil > this.now())
      return json(
        429,
        this.limitQuota
          ? {
              error: { status: 429, message: 'Quota exceeded' },
              reason: 'QUOTA_EXCEEDED',
            }
          : { error: { status: 429, message: 'API rate limit exceeded' } },
        {
          'retry-after': String(
            Math.ceil((this.limitedUntil - this.now()) / 1000),
          ),
        },
      );
    this.tick();
    const device = {
      id: 'sim-device',
      name: 'PC (simulé)',
      type: 'Computer',
      is_active: this.deviceActive,
      is_restricted: false,
      volume_percent: this.volume,
    };
    if (method === 'GET' && path === 'search') {
      const words = normalizeText(url.searchParams.get('q'))
        .split(' ')
        .filter((w) => w.length > 1);
      const hay = (t: Candidate) =>
        normalizeText(`${t.name} ${t.artists.map((a) => a.name).join(' ')}`);
      // The Music Hub catalogue answers a search as you type (every word starts a word of the title or the artists);
      // when it has nothing, the historical fixtures keep their loose matching (Spotify V2's tests).
      const starts = (t: Candidate) =>
        words.length > 0 &&
        words.every((w) =>
          hay(t)
            .split(' ')
            .some((x) => x.startsWith(w)),
        );
      const lab = LAB_CATALOG.filter(starts);
      const items = (
        lab.length
          ? lab
          : SIM_CATALOG_HISTORICAL.filter((t) =>
              words.some((w) => hay(t).includes(w)),
            )
      ).slice(0, 10);
      return json(200, { tracks: { items } });
    }
    const tr = /^tracks\/([A-Za-z0-9]+)$/.exec(path);
    if (method === 'GET' && tr) {
      const t = [...SIM_CATALOG, ...PLAYLIST].find((c) => c.id === tr[1]);
      return t
        ? json(200, t)
        : json(404, { error: { status: 404, message: 'Not found' } });
    }
    if (method === 'GET' && path === 'me')
      return json(200, {
        id: 'sim',
        display_name: 'Simulateur',
        product: 'premium',
      });
    if (method === 'GET' && path === 'me/player/devices')
      return json(200, { devices: [device] });
    const reading = () => ({
      device,
      is_playing: this.playing,
      progress_ms: this.progress(),
      currently_playing_type: 'track',
      item: this.current,
    });
    if (method === 'GET' && path === 'me/player') {
      if (this.stale && this.stale.left > 0) {
        this.stale.left--;
        return json(200, this.stale.body);
      }
      if (!this.deviceActive || !this.current)
        return new Response(null, { status: 204 });
      return json(200, reading());
    }
    // A player command: the state before it stays visible for `staleReads` readings; `playerAnswer` once.
    if (
      this.deviceActive &&
      ((method === 'POST' && path === 'me/player/next') ||
        (method === 'PUT' &&
          [
            'me/player/pause',
            'me/player/play',
            'me/player/seek',
            'me/player/volume',
          ].includes(path)))
    ) {
      this.stale =
        this.staleReads > 0 && this.current
          ? { left: this.staleReads, body: reading() }
          : null;
      const answer = this.playerAnswer;
      this.playerAnswer = 204;
      if (answer === 502) {
        // Applied once (the same command, not a second one: the call is recorded once).
        await this.fetch(input, init);
        this.calls.pop();
        return json(502, { error: { status: 502, message: 'Bad gateway' } });
      }
    }
    if (method === 'GET' && path === 'me/player/queue')
      return json(200, {
        currently_playing: this.current,
        queue: [...this.userQueue, ...PLAYLIST].slice(0, 20),
      });
    if (!this.deviceActive)
      return json(404, { error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } });
    if (method === 'POST' && path === 'me/player/queue') {
      const id = /^spotify:track:([A-Za-z0-9]{22})$/.exec(
        url.searchParams.get('uri') ?? '',
      )?.[1];
      const t = SIM_CATALOG.find((c) => c.id === id);
      if (!t)
        return json(400, {
          error: { status: 400, message: 'Invalid track uri' },
        });
      const answer = this.queueAnswer;
      this.queueAnswer = 204;
      if (answer === 500) return json(500, { error: { status: 500 } });
      if (answer === 403)
        return json(403, {
          error: {
            status: 403,
            message: 'Player command failed: Restriction violated',
          },
        });
      this.userQueue.push(t);
      return answer === 204
        ? new Response(null, { status: 204 })
        : json(200, {});
    }
    if (method === 'POST' && path === 'me/player/next') {
      this.advance();
      if (!this.playing) this.pausedProgress = 0;
      return new Response(null, { status: 204 });
    }
    if (method === 'PUT' && path === 'me/player/pause') {
      if (this.playing) {
        this.pausedProgress = this.now() - this.startedAt;
        this.playing = false;
      }
      return new Response(null, { status: 204 });
    }
    if (method === 'PUT' && path === 'me/player/play') {
      if (!this.playing) {
        this.startedAt = this.now() - this.pausedProgress;
        this.playing = true;
      }
      return new Response(null, { status: 204 });
    }
    if (method === 'PUT' && path === 'me/player/seek') {
      const p = Number(url.searchParams.get('position_ms'));
      if (!Number.isInteger(p) || p < 0)
        return json(400, {
          error: { status: 400, message: 'Invalid position' },
        });
      if (this.playing) this.startedAt = this.now() - p;
      else this.pausedProgress = p;
      return new Response(null, { status: 204 });
    }
    if (method === 'PUT' && path === 'me/player/volume') {
      const v = Number(url.searchParams.get('volume_percent'));
      if (!Number.isInteger(v) || v < 0 || v > 100)
        return json(400, { error: { status: 400, message: 'Invalid volume' } });
      this.volume = v;
      return new Response(null, { status: 204 });
    }
    return json(404, { error: { status: 404, message: 'Not simulated' } });
  };
}
