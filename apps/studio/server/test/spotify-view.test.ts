import { describe, expect, it } from 'vitest';
import { simBar, spotifyPanel } from '../../web/src/pages/spotify-panel.js';
import {
  alertsView,
  countsView,
  etas,
  historyRows,
  nowView,
  openingView,
  queueRows,
  stateView,
  timeView,
  verifyNote,
  type SpRequest,
  type SpState,
  type SpUi,
} from '../../web/src/pages/spotify-view.js';

// Spotify V2 — the Studio page (pure render): what plays, the queue with each requester's limits, its decisions, the last
// decisions, the playback's freshness; the panel (quotas, viewers' exceptions, Raptoru's reward, connection and technical
// details, Lab simulator); escaped texts.

const NOW = Date.parse('2026-10-25T20:00:00Z');
const TRACK = {
  id: 'a'.repeat(22),
  uri: `spotify:track:${'a'.repeat(22)}`,
  title: 'Numb',
  artists: ['Linkin Park'],
  duration_ms: 185_000,
};
const req = (over: Partial<SpRequest> = {}): SpRequest => ({
  request_id: '00000000-0000-4000-8000-000000000001',
  source: 'twitch',
  viewer: { id: '1', login: 'viewer<b>', name: 'V' },
  input: '<script>x</script>',
  state: 'QUEUED',
  reason: 'QUEUED',
  track: TRACK,
  confidence: 'HIGH',
  confirmation: 'http_204',
  received_at: new Date(NOW - 60_000).toISOString(),
  queued_at: new Date(NOW - 60_000).toISOString(),
  playback_started_at: null,
  ended_at: null,
  canceled_by: null,
  removed_by: null,
  skipped_by: null,
  auto_skip: false,
  auto_skip_result: null,
  twitch_status: null,
  ...over,
});
const playback = (ageMs: number, progress_ms = 60_000) => ({
  fresh: true,
  status: { device: { name: 'PC', type: 'Computer' } },
  playback: {
    observed_at: new Date(NOW - ageMs).toISOString(),
    track: TRACK,
    progress_ms,
    is_playing: true,
  },
});

const state = (over: Partial<SpState> = {}): SpState => ({
  environment: 'production',
  settings: {
    enabled: true,
    max_pending_per_viewer: 2,
    viewer_cooldown_seconds: 600,
    max_duration_seconds: 600,
    cancel_grace_seconds: 10,
  },
  admission: 'ready',
  studio: playback(2_000),
  current: req({
    state: 'PLAYING',
    viewer: { id: '2', login: 'demandeur', name: 'D' },
  }),
  queue: [req()],
  in_progress: [],
  to_verify: [req({ state: 'UNKNOWN', reason: 'QUEUE_RESULT_UNKNOWN' })],
  recent: [
    req({
      state: 'FAILED',
      reason: 'NOT_FOUND',
      track: null,
      twitch_status: 'unmanaged',
    }),
  ],
  overrides: [
    {
      viewer_login: 'habitue',
      max_pending_per_viewer: 4,
      viewer_cooldown_seconds: null,
      updated_at: new Date(NOW).toISOString(),
    },
  ],
  twitch_actions: [],
  managed_rewards: [],
  connection: {
    auth: 'ok',
    client_id: '0123456789abcdef0123456789abcdef',
    account: { name: 'Raptoru', product: 'premium' },
    redirect_uri: 'http://127.0.0.1:4100/api/spotify/oauth/callback',
    simulated: false,
  },
  api: {
    limited_until: null,
    quota_exceeded: false,
    calls_last_minute: 3,
    rate_high: false,
    backoff_until: null,
  },
  local: { error: null, watching: true, fast_lane: false },
  sim: null,
  ...over,
});
const ui = (over: Partial<SpUi> = {}): SpUi => ({
  fields: {},
  who: [],
  now: NOW,
  ...over,
});
const idle = { error: null, watching: false, fast_lane: false };
/** What the page shows outside its panel. */
const live = (s: SpState, u = ui()) =>
  [
    stateView(s),
    openingView(s),
    alertsView(s),
    nowView(s, u),
    countsView(s),
    verifyNote(s),
    queueRows(s, u)
      .map((r) => r.html)
      .join(''),
    historyRows(s)
      .map((r) => r.html)
      .join(''),
  ].join('');

describe('Studio Spotify — what plays and the queue', () => {
  it('the request playing and its requester, the queue with its removal; quotas, reward and connection live in the panel', () => {
    const html = live(state());
    expect(html).toContain('Demandes ouvertes');
    expect(html).toContain('Numb');
    expect(html).toContain('@demandeur · demandée il y a 1 min');
    expect(html).toContain('data-act="sp-remove"');
    expect(html).toContain('data-act="sp-skip"');
    // A fresh reading needs no « Actualiser ».
    expect(html).not.toContain('data-act="sp-refresh"');
    expect(html).not.toContain('data-act="sp-save"');
    expect(html).not.toContain('data-act="sp-reward"');
    expect(html).not.toContain('data-act="sp-connect"');
  });

  it('escapes every viewer text', () => {
    const html = live(state());
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('viewer<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('counters and each requester’s quota · cooldown · exception, from Core', () => {
    const html = live(
      state({
        viewers: [
          {
            viewer_id: '1',
            login: 'viewer<b>',
            pending: 1,
            max_pending: 2,
            cooldown_left_ms: 5 * 60_000 + 10_000,
            override: true,
          },
        ],
        today: {
          received: 12,
          played: 9,
          refused: 2,
          canceled: 1,
          removed: 0,
          refunded: 0,
        },
      }),
    );
    expect(html).toContain(
      '<b>1 en file</b> · 1 à vérifier · 12 aujourd’hui (9 jouées, 2 refusées, 1 annulée)',
    );
    expect(html).toContain('1/2 · encore 6 min (exception)');
  });

  it('the Core deployed before (no viewers, no today): « — », nothing invented', () => {
    const html = live(state());
    expect(html).toContain('aujourd’hui : —');
    expect(html).toMatch(/spo-quota"[^>]*>—</);
  });

  it('no request playing: a playlist track never gets a requester, the skip stays at hand', () => {
    const html = live(state({ current: null }));
    expect(html).toContain('Hors demandes');
    expect(html).toContain('Numb');
    expect(html).not.toContain('@demandeur');
    expect(html).toContain('Passer la musique');
  });

  it('a stale reading says its age and offers « Actualiser », nothing plays on by itself; none at all says so', () => {
    const stale = nowView(
      state({ current: null, studio: playback(180_000) }),
      ui(),
    );
    expect(stale).toContain('Dernier titre relevé');
    expect(stale).toContain('Lu il y a 3 min');
    expect(stale).toContain('data-act="sp-refresh"');
    expect(stale).not.toContain('spo-eq');
    const none = nowView(state({ current: null, studio: null }), ui());
    expect(none).toContain('Aucune lecture relevée');
  });

  it('the cover Studio saw, else a neutral mark (never another track’s)', () => {
    const url = 'https://i.scdn.co/image/abc';
    expect(nowView(state({ covers: { [TRACK.id]: url } }), ui())).toContain(
      `src="${url}"`,
    );
    expect(nowView(state(), ui())).toContain('spo-cov--none');
  });

  it('the wait of each track: what is left of the current one, then those before it; unknown without a reading', () => {
    const second = req({
      request_id: '00000000-0000-4000-8000-000000000002',
    });
    const s = state({ queue: [req(), second] });
    const { list, end } = etas(s, NOW);
    // 185 s, 60 s read 2 s ago.
    expect(list.get(req().request_id)).toBe(123_000);
    expect(list.get(second.request_id)).toBe(123_000 + 185_000);
    expect(end).toBe(123_000 + 2 * 185_000);
    expect(timeView(s, ui())).toContain('2 titres');
    expect(timeView(state({ studio: null }), ui())).toContain('fin inconnue');
  });

  it('an uncertain addition still in the queue: one row with Retirer, Rembourser and Garder', () => {
    const uncertain = req({
      request_id: '00000000-0000-4000-8000-000000000002',
      state: 'UNKNOWN',
      reason: 'QUEUE_RESULT_UNKNOWN',
    });
    const rows = queueRows(
      state({ queue: [uncertain], to_verify: [uncertain] }),
      ui(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.html.match(/000000000002/g)).toHaveLength(3);
    expect(rows[0]!.html).toContain('à vérifier');
    // Being searched: listed, no action.
    const [searching] = queueRows(
      state({
        queue: [],
        to_verify: [],
        in_progress: [req({ state: 'SEARCHING', track: null })],
      }),
      ui(),
    );
    expect(searching!.html).toContain('recherche…');
    expect(searching!.html).toContain('« &lt;script&gt;x&lt;/script&gt; »');
    expect(searching!.html).not.toContain('data-act="sp-remove"');
  });

  it('the last decisions: why it was refused, and what happened on Twitch', () => {
    const [row] = historyRows(state());
    expect(row!.html).toContain('Refusée');
    expect(row!.html).toContain('aucun titre assez proche');
    expect(row!.html).toContain('non remboursable');
  });

  it('uncertain requests can be refunded or kept (nothing sent to Twitch)', () => {
    const html = live(state());
    expect(html).toContain('data-decision="refund"');
    expect(html).toContain('data-decision="keep"');
    expect(verifyNote(state())).toContain('Spotify n’a pas confirmé l’ajout');
  });

  it('closed requests: one clear line and the button to open them; open but refused: the reason', () => {
    const closed = state({
      settings: { ...state().settings, enabled: false },
      admission: 'MODULE_DISABLED',
    });
    expect(stateView(closed)).toContain('Demandes fermées');
    expect(openingView(closed)).toContain('Ouvrir les demandes');
    const refused = state({ admission: 'NO_DEVICE' });
    expect(stateView(refused)).toContain('ouvertes mais refusées');
    expect(openingView(refused)).toContain('aucun appareil Spotify actif');
    expect(openingView(state())).toBe('');
  });
});

describe('Studio Spotify — the panel', () => {
  it('technical details: the last Spotify reading and « Actualiser », disabled while Spotify limits the calls', () => {
    const tech = spotifyPanel(
      state({ studio: playback(180_000), local: idle }),
      ui(),
    );
    expect(tech).toContain('Numb — Linkin Park');
    expect(tech).toContain('il y a 3 min');
    expect(tech).toMatch(/data-act="sp-refresh"\s+title/);
    const limited = state({
      api: {
        limited_until: new Date(NOW + 60_000).toISOString(),
        quota_exceeded: false,
        calls_last_minute: 0,
        rate_high: false,
        backoff_until: null,
      },
    });
    expect(spotifyPanel(limited, ui())).toMatch(
      /data-act="sp-refresh" disabled/,
    );
    expect(alertsView(limited)).toContain('Spotify limite les appels');
  });

  it('exceptions: the global value as fallback, and the way back to the global values', () => {
    const html = spotifyPanel(state(), ui());
    expect(html).toContain('@habitue');
    expect(html).toContain('global (10 min)');
    expect(html).toContain('data-act="sp-ov-reset"');
    expect(html).toContain('data-act="sp-ov-save"');
  });

  it('quotas: the historical global settings, with the way back to them; what is typed is kept', () => {
    const html = spotifyPanel(state(), ui());
    expect(html).toContain('data-act="sp-save"');
    expect(html).toContain('data-act="sp-historical"');
    expect(html).toContain('historique : 2');
    expect(
      spotifyPanel(state(), ui({ fields: { 'set-pending': '7' } })),
    ).toContain('value="7"');
  });

  it('the end of a live is said: a fixed rule, not a setting', () => {
    expect(spotifyPanel(state(), ui())).toContain('Fin du live');
  });

  it('Twitch reward: owner, permission, price and claims explained; creation only while none exists', () => {
    const html = spotifyPanel(state(), ui());
    expect(html).toContain('L’application Twitch de Raptoru');
    expect(html).toContain('channel:manage:redemptions');
    expect(html).toContain('1 500 points');
    expect(html).toContain('value="Choisi la prochaine musique"');
    expect(html).toContain('ne valide jamais une réclamation');
    expect(html).toContain('data-act="sp-reward"');
    const made = spotifyPanel(
      state({
        managed_rewards: [
          {
            reward_id: 'r',
            title: 'Choisi la prochaine musique !',
            cost: 1000,
          },
        ],
      }),
      ui(),
    );
    expect(made).toContain('Récompense active');
    expect(made).toContain('Identifiant Twitch : <code>r</code>');
    expect(made).not.toContain('data-act="sp-reward"');
  });

  it('Production: connection and redirect URI, no simulator', () => {
    const html = spotifyPanel(state(), ui());
    expect(html).toContain('http://127.0.0.1:4100/api/spotify/oauth/callback');
    expect(html).toContain('data-act="sp-connect"');
    expect(html).not.toContain('data-act="sp-simulate"');
    expect(simBar(state(), ui())).toBe('');
  });

  it('Lab: the simulator, no connection form', () => {
    const lab = state({
      environment: 'lab',
      connection: {
        auth: 'ok',
        client_id: null,
        account: null,
        redirect_uri: '',
        simulated: true,
      },
      sim: {
        device_active: true,
        queue_answer: 204,
        limited: false,
        current: 'Chill Loop',
        progress_ms: 1000,
        queue: [],
        calls: 4,
      },
    });
    expect(simBar(lab, ui())).toContain('data-act="sp-simulate"');
    expect(simBar(lab, ui())).toContain('data-act="sp-chat"');
    expect(spotifyPanel(lab, ui())).not.toContain('data-act="sp-connect"');
  });
});

describe('Studio Spotify — Music Hub (the extension on the same queue)', () => {
  const MH = {
    enabled: true,
    max_pending_per_viewer: 2,
    viewer_cooldown_seconds: 600,
    max_duration_seconds: 600,
    cancel_grace_seconds: 10,
    extension_enabled: true,
    extension_price_tokens: 500,
    no_duplicates: true,
    player_controls: true,
  };
  const tokens = req({
    request_id: '00000000-0000-4000-8000-000000000009',
    source: 'extension',
    payment: 'tokens',
    price_tokens: 500,
  });

  it('a Core without Music Hub: no extension group, no player controls, the reward rows unchanged', () => {
    const s = state();
    expect(spotifyPanel(s, ui())).not.toContain('data-sp-flag');
    expect(nowView(s, ui())).not.toContain('data-act="sp-play"');
    expect(queueRows(s, ui())[0]!.html).not.toContain('data-keep');
  });

  it('the panel: extension switch, price, duplicates, player controls; Production says the extension is not open yet', () => {
    const html = spotifyPanel(state({ settings: MH }), ui());
    for (const f of ['extension_enabled', 'no_duplicates', 'player_controls'])
      expect(html).toContain(`data-sp-flag="${f}"`);
    expect(html).toContain('data-act="sp-ext-price"');
    expect(html).toContain('n’ont d’effet que dans le Lab');
    expect(
      spotifyPanel(state({ settings: MH, environment: 'lab' }), ui()),
    ).not.toContain('n’ont d’effet que dans le Lab');
  });

  it('player controls: pause while it plays, resume when paused, the volume read from Spotify', () => {
    const s = state({ settings: MH });
    s.studio!.playback!.volume_percent = 70;
    expect(nowView(s, ui())).toContain('data-play="pause"');
    expect(nowView(s, ui())).toMatch(/data-vol value="70"/);
    s.studio!.playback!.is_playing = false;
    expect(nowView(s, ui())).toContain('data-play="resume"');
  });

  it('the queue: what each request cost; « sans rembourser » only for Jetons, never for the reward’s points', () => {
    const s = state({ settings: MH, queue: [req(), tokens], to_verify: [] });
    const [points, ext] = queueRows(s, ui());
    expect(points!.html).toContain('>points<');
    expect(points!.html).not.toContain('data-keep');
    expect(ext!.html).toContain('◆ 500 Jetons');
    expect(ext!.html).toContain('data-keep="1"');
  });

  it('the history: the extension tag and what happened to the Jetons', () => {
    const s = state({
      recent: [
        {
          ...tokens,
          state: 'REMOVED_BY_MOD',
          removed_by: 'studio',
          refund_status: 'kept',
        },
        {
          ...tokens,
          request_id: '00000000-0000-4000-8000-000000000010',
          state: 'CANCELED',
          canceled_by: '1',
          refund_status: 'refunded',
        },
      ],
    });
    const html = historyRows(s)
      .map((r) => r.html)
      .join('');
    expect(html).toContain('>Extension<');
    expect(html).toContain('Jetons gardés');
    expect(html).toContain('Jetons remboursés');
  });
});

describe('Spotify page — the OBS music card settings (Music Hub V2)', () => {
  it('« Overlay OBS »: on/off, per event, alert sound (or silent), volume, duration, position, preview; absent without the effects player', async () => {
    const { spotifyPanel } =
      await import('../../web/src/pages/spotify-panel.ts');
    const base = { fields: {}, who: [], now: Date.now() };
    const s = state();
    expect(spotifyPanel(s, base)).not.toContain('Overlay OBS');
    const html = spotifyPanel(s, {
      ...base,
      overlay: {
        config: {
          enabled: true,
          on_request: true,
          on_start: false,
          sound: 'tiens-bon',
          sound_name: null,
          volume: 40,
          duration_s: 6,
          position: 'bottom-left',
        },
        available: false,
        sounds: [{ id: 'tiens-bon', label: 'Tiens bon !', available: true }],
      },
    });
    expect(html).toContain('Overlay OBS');
    for (const k of [
      'enabled',
      'on_request',
      'on_start',
      'sound',
      'volume',
      'duration_s',
      'position',
    ])
      expect(html).toContain(`data-ov="${k}"`);
    expect(html).toMatch(/<option value="tiens-bon" selected>/);
    expect(html).toMatch(/<option value="bottom-left" selected>/);
    expect(html).toContain('Aucun son (carte silencieuse)');
    expect(html).toContain('data-act="sp-ov-preview" disabled');
    expect(html).toContain('Lecteur d’effets indisponible');
    expect(html).toContain('ne diffuse jamais la musique');
  });
});
