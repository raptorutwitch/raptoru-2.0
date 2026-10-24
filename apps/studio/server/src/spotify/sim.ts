import { normalizeText, type Candidate } from './search.js';

// Spotify V2 — the Lab's Spotify (CLAUDE.md: the Lab tests end to end without external services). A fake Web API
// answering the few endpoints Raptoru uses, plugged in place of `fetch` in the ONE gate (api.ts): same pacing, cache
// and 429 handling as for real. Explicit and isolated: never the real account, never the real queue. The panel drives
// it (end of track, a track outside the requests, no device, a 429, a 200 instead of 204).

const track = (
  id: string,
  name: string,
  artists: string[],
  duration_ms: number,
): Candidate => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: artists.map((name) => ({ name })),
  duration_ms,
});

export const SIM_CATALOG: Candidate[] = [
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
  readonly calls: string[] = [];

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
  /** The broadcaster plays a track by hand (outside the requests). */
  playExternal() {
    this.current =
      PLAYLIST[
        (this.playlistIndex = (this.playlistIndex + 1) % PLAYLIST.length)
      ]!;
    this.startedAt = this.now();
  }
  rateLimit(seconds: number) {
    this.limitedUntil = this.now() + seconds * 1000;
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
      progress_ms: this.current ? this.now() - this.startedAt : null,
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
        { error: { status: 429, message: 'API rate limit exceeded' } },
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
    };
    if (method === 'GET' && path === 'search') {
      const words = normalizeText(url.searchParams.get('q'))
        .split(' ')
        .filter((w) => w.length > 1);
      const items = SIM_CATALOG.filter((t) => {
        const hay = normalizeText(
          `${t.name} ${t.artists.map((a) => a.name).join(' ')}`,
        );
        return words.some((w) => hay.includes(w));
      }).slice(0, 10);
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
    if (method === 'GET' && path === 'me/player') {
      if (!this.deviceActive || !this.current)
        return new Response(null, { status: 204 });
      return json(200, {
        device,
        is_playing: true,
        progress_ms: this.now() - this.startedAt,
        currently_playing_type: 'track',
        item: this.current,
      });
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
      return new Response(null, { status: 204 });
    }
    return json(404, { error: { status: 404, message: 'Not simulated' } });
  };
}
