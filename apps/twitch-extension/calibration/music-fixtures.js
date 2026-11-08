// Music Hub (docs/music/MUSIC_HUB_STATE.md) — calibration fixtures of the music module: a fictional catalogue (the
// Lab simulator's kind: versions of a title, a too-long track, an unplayable one, no cover), a queue mixing the reward
// and the extension, a track playing, the moderator's view. Read-only like every calibration answer: a request, a
// withdrawal or a moderation is refused « not_available » (the Lab runs the real path).

const cover = (seed) => {
  const hue = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3"><rect width="3" height="3" fill="hsl(${hue} 45% 32%)"/><circle cx="1" cy="1.2" r="1.2" fill="hsl(${(hue + 40) % 360} 55% 50%)"/></svg>`)}`;
};
const id = (n) => `LABMUSIC${String(n).padStart(14, '0')}`;
const m = (min, sec) => (min * 60 + sec) * 1000;
const item = (n, title, artists, ms, album, o = {}) => ({
  id: id(n),
  uri: `spotify:track:${id(n)}`,
  title,
  artists,
  album,
  duration_ms: ms,
  image_url: o.art === false ? null : cover(id(n)),
  playable: o.playable !== false,
  too_long: ms > 600_000,
});

export const MUSIC_CATALOG = [
  item(1, 'Nuit Blanche', ['Lune Rouge'], m(3, 42), 'Néons'),
  item(
    2,
    'Nuit Blanche (Live à Lyon)',
    ['Lune Rouge'],
    m(4, 58),
    'Néons — Live',
  ),
  item(
    3,
    'Nuit Blanche (Remix Club)',
    ['Lune Rouge', 'DJ Orbite'],
    m(5, 31),
    'Néons Remixés',
  ),
  item(4, 'Nuit Blanche', ['Les Phares'], m(2, 57), 'Marées'),
  item(
    6,
    'Comète (Acoustique)',
    ['Ava Solène'],
    m(3, 4),
    'Ciel Ouvert — Sessions',
    { art: false },
  ),
  item(14, 'Odyssée Intégrale', ['Orchestre Halcyon'], m(12, 30), 'Odyssée'),
  item(16, 'Session Perdue', ['Lune Rouge'], m(3, 10), 'Inédits', {
    playable: false,
  }),
  item(
    26,
    'Un titre au nom vraiment très long pour vérifier que rien ne déborde du panneau',
    ['Artiste au nom tout aussi long que le titre'],
    m(3, 33),
    'Tests de mise en page',
  ),
];

const entry = (n, position, by, own, o = {}) => {
  const c =
    MUSIC_CATALOG.find((i) => i.id === id(n)) ??
    item(n, `Titre ${n}`, ['Artiste'], m(3, 0), null);
  return {
    request_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    position,
    track_id: c.id,
    title: c.title,
    artists: c.artists,
    duration_ms: c.duration_ms,
    album: c.album,
    image_url: c.image_url,
    requested_by: by,
    own,
    state: 'QUEUED',
    eta_ms: o.eta_ms ?? null,
    source: o.source ?? 'extension',
    viewer_id: o.viewer_id ?? '1001',
    viewer_login: by.toLowerCase(),
    payment: o.source === 'reward' ? 'channel_points' : 'tokens',
    price_tokens: o.source === 'reward' ? null : 500,
  };
};

/** The module's state, its progress counted from `startedAt` (the track loops on its length). */
export function musicState(startedAt, clock) {
  const playing = MUSIC_CATALOG[0];
  const progress = (clock() - startedAt) % playing.duration_ms;
  const left = playing.duration_ms - progress;
  const queue = [
    entry(4, 1, 'Viewer_B', false, {
      eta_ms: left,
      source: 'reward',
      viewer_id: '1002',
    }),
    entry(26, 2, 'Mod_Test', true, {
      eta_ms: left + m(2, 57),
      viewer_id: '5555',
    }),
    entry(6, 3, 'Viewer_C', false, {
      eta_ms: left + m(6, 30),
      viewer_id: '1003',
    }),
  ];
  return {
    admission: 'ready',
    open: true,
    extension_enabled: true,
    price_tokens: 500,
    rules: {
      max_pending_per_viewer: 2,
      viewer_cooldown_seconds: 600,
      max_duration_seconds: 600,
      cancel_grace_seconds: 10,
      no_duplicates: true,
    },
    player: {
      connected: true,
      reason: null,
      device: 'PC du stream (simulé)',
      controls: true,
      is_playing: true,
      volume_percent: 60,
    },
    now_playing: {
      kind: 'request',
      title: playing.title,
      artists: playing.artists,
      duration_ms: playing.duration_ms,
      progress_ms: progress,
      is_playing: true,
      requested_by: 'Viewer_A',
      request_id: '00000000-0000-4000-8000-000000000001',
      own: false,
      album: playing.album,
      image_url: playing.image_url,
    },
    queue,
    pending: [],
    me: {
      pending: 1,
      max_pending: 2,
      cooldown_left_ms: 0,
      balance: 12_000,
      requests: [
        {
          request_id: queue[1].request_id,
          state: 'QUEUED',
          title: queue[1].title,
          cancellable: true,
          payment: 'tokens',
        },
      ],
    },
    recent: [
      {
        title: 'Pixel Rain',
        artists: ['Kairo Station'],
        requested_by: 'Viewer_D',
        image_url: cover(id(7)),
      },
      {
        title: 'Velours',
        artists: ['Mira'],
        requested_by: 'Viewer_B',
        image_url: cover(id(10)),
      },
    ],
    team: true,
  };
}

/** A search: every word starts a word of the title or the artists (the Lab simulator's rule). */
export function musicSearch(query) {
  const words = String(query ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const hay = (i) =>
    `${i.title} ${i.artists.join(' ')}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/);
  const items = words.length
    ? MUSIC_CATALOG.filter((i) =>
        words.every((w) => hay(i).some((x) => x.startsWith(w))),
      )
    : [];
  return {
    status: 'done',
    search_id: '00000000-0000-4000-8000-0000000000aa',
    provider: 'lab',
    items,
  };
}

export const MUSIC_SUMMARY = {
  offered: true,
  open: true,
  admission: 'ready',
  queue_count: 3,
  price_tokens: 500,
};
