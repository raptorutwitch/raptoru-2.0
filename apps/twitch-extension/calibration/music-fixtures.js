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
  item(27, 'Néon Sauvage', ['Lune Rouge'], m(3, 31), 'Néons'),
  item(
    28,
    'Néon Sauvage (Remix)',
    ['Lune Rouge', 'DJ Orbite'],
    m(3, 58),
    'Néons Remixés',
  ),
  item(
    29,
    'Néon Sauvage (Nightcore)',
    ['Kairo Station'],
    m(2, 49),
    'Nightcore Vol. 3',
  ),
  item(
    30,
    'Néon Sauvage (Slowed + Reverb)',
    ['Café Cassette'],
    m(4, 22),
    'Ralenti',
  ),
  item(
    31,
    'Néon Sauvage (Sped Up)',
    ['Lune Rouge'],
    m(2, 41),
    'Néon Sauvage (Sped Up)',
  ),
  item(
    32,
    'Néon Sauvage (Acoustique)',
    ['Ava Solène'],
    m(3, 40),
    'Reprises au salon',
    { art: false },
  ),
  item(33, 'Néon Sauvage — Live', ['Lune Rouge'], m(4, 5), 'Néons — Live'),
  item(
    34,
    'Néon Sauvage (Instrumental)',
    ['Lune Rouge'],
    m(3, 31),
    'Néons (Instrumentals)',
  ),
  item(35, 'Néon Sauvage', ['Les Phares'], m(3, 12), 'Reprises'),
  item(
    36,
    'Néon Sauvage (Version Longue)',
    ['Lune Rouge'],
    m(11, 2),
    'Néons — Deluxe',
  ),
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

/** What each calibration role may do (Core's answer: lab-moderation grades, « music.player » = supermods). */
const CAN = {
  viewer: { moderate: false, refund: false, player: false, open_close: false },
  moderator: { moderate: true, refund: true, player: false, open_close: false },
  supermod: { moderate: true, refund: true, player: true, open_close: true },
};

/**
 * The module's state for a role (viewer, moderator, supermod), its progress counted from `startedAt` (the track loops
 * on its length).
 */
export function musicState(startedAt, clock, role = 'moderator') {
  const team = role !== 'viewer';
  const playing = MUSIC_CATALOG[0];
  const progress = (clock() - startedAt) % playing.duration_ms;
  const left = playing.duration_ms - progress;
  const queue = [
    entry(4, 1, 'Viewer_B', false, {
      eta_ms: left,
      source: 'reward',
      viewer_id: '1002',
    }),
    entry(26, 2, 'Toi (calibration)', true, {
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
    queue: team
      ? queue
      : queue.map(
          // A viewer never sees who paid what (Core sends the team's fields to the team only).
          ({ viewer_id, viewer_login, payment, price_tokens, ...rest }) => rest,
        ),
    // Your request being added by Studio (Core lists it in `pending` for its owner, for the whole team).
    pending: [
      {
        ...entry(12, null, 'Toi (calibration)', true, { viewer_id: '5555' }),
        request_id: '00000000-0000-4000-8000-000000000099',
        track_id: id(12),
        title: null,
        artists: [],
        image_url: null,
        state: 'SEARCHING',
      },
    ].map((e) => (team ? e : (({ viewer_id, viewer_login, payment, price_tokens, ...rest }) => rest)(e))),
    me: {
      pending: 2,
      max_pending: 3,
      cooldown_left_ms: 0,
      balance: 12_000,
      requests: [
        {
          request_id: queue[1].request_id,
          state: 'QUEUED',
          title: queue[1].title,
          artists: queue[1].artists,
          image_url: queue[1].image_url,
          cancellable: true,
          payment: 'tokens',
        },
        {
          // Being added by Studio: withdrawable too (Music Hub V2).
          request_id: '00000000-0000-4000-8000-000000000099',
          state: 'SEARCHING',
          title: null,
          artists: [],
          image_url: null,
          cancellable: true,
          payment: 'tokens',
        },
      ],
      history: [
        {
          request_id: '00000000-0000-4000-8000-000000000098',
          state: 'CANCELED',
          title: 'Comète',
          artists: ['Ava Solène'],
          payment: 'tokens',
          refunded: true,
          ended_at: new Date(startedAt - m(20, 0)).toISOString(),
          reason: 'VIEWER_CANCEL', // your own withdrawal: nothing to tell
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
    team,
    can: CAN[role] ?? CAN.viewer,
  };
}

/** « Musiques de la soirée »: the requests played since the (calibration) live began, newest first, 20 per page. */
export function musicHistory(startedAt, before = null) {
  const live = startedAt - m(150, 0);
  const all = Array.from({ length: 26 }, (_, k) => {
    const c = MUSIC_CATALOG[(k + 3) % MUSIC_CATALOG.length];
    return {
      at: new Date(startedAt - m(4 + k * 5, 10)).toISOString(),
      title: c.title,
      artists: c.artists,
      image_url: c.image_url,
      requested_by: ['Viewer_B', 'Viewer_C', 'Toi (calibration)', 'Viewer_D'][k % 4],
      own: k % 4 === 2,
      state: 'PLAYED',
    };
  });
  const rest = before ? all.filter((h) => h.at < before) : all;
  const items = rest.slice(0, 20);
  return {
    since: new Date(live).toISOString(),
    live: true,
    items,
    next: rest.length > 20 ? items[items.length - 1].at : null,
  };
}

/** A search: every word starts a word of the title or the artists (the Lab simulator's rule). */
export function musicSearch(query) {
  const link = /(?:track[:/])([A-Za-z0-9]{22})/.exec(String(query ?? ''));
  if (
    /^(?:spotify:|https?:\/\/|www\.|open\.spotify\.com\/)/i.test(
      String(query ?? '').trim(),
    ) &&
    !link
  )
    return Promise.reject(
      Object.assign(new Error('invalid_reference'), {
        code: 'invalid_reference',
      }),
    );
  if (link)
    return {
      status: 'done',
      search_id: '00000000-0000-4000-8000-0000000000ab',
      provider: 'lab',
      items: MUSIC_CATALOG.filter((i) => i.id === link[1]),
    };
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
      ).slice(0, 10)
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
