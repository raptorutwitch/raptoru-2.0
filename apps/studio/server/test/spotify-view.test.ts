import { describe, expect, it } from 'vitest';
import {
  spotifyView,
  type SpRequest,
  type SpState,
  type SpUi,
} from '../../web/src/spotify-view.js';

// Spotify V2 — the Studio section « Musique » (pure render): the main space « File musicale » (the request playing, the
// queue with each requester's limits, its moderation, the folded decisions), the playback's freshness in diagnostics, the secondary spaces (viewers' exceptions, settings, Raptoru's reward,
// connection and diagnostics, Lab simulator), escaped texts.

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
  tab: 'live',
  fields: {},
  who: [],
  now: NOW,
  ...over,
});
const idle = { error: null, watching: false, fast_lane: false };

describe('Studio « Musique » — main space', () => {
  it('« File musicale »: the request playing and its requester, the queue with « Retirer »; settings and reward live elsewhere', () => {
    const html = spotifyView(state(), null, ui());
    expect(html).toContain('File musicale');
    expect(html).toContain('Demandes ouvertes');
    expect(html).toMatch(
      /Numb — Linkin Park<\/b><small>@demandeur · demandée il y a 1 min/,
    );
    expect(html).toContain('data-act="sp-remove"');
    expect(html).toContain('data-act="sp-skip"');
    // No Spotify progress bar nor freshness here (diagnostics space).
    expect(html).not.toContain('sp-bar');
    expect(html).not.toContain('data-act="sp-refresh"');
    expect(html).not.toContain('data-act="sp-save"');
    expect(html).not.toContain('data-act="sp-reward"');
    expect(html).not.toContain('data-act="sp-connect"');
  });

  it('escapes every viewer text', () => {
    const html = spotifyView(state(), null, ui());
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('viewer<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('counters and each requester’s quota · cooldown · exception, from Core', () => {
    const html = spotifyView(
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
      null,
      ui(),
    );
    expect(html).toContain(
      '<b>1 en file</b> · 1 à vérifier · 12 aujourd’hui (9 jouées, 2 refusées, 1 annulée)',
    );
    expect(html).toContain('1/2 · encore 6 min (exception)');
  });

  it('the Core deployed before (no viewers, no today): « — », nothing invented', () => {
    const html = spotifyView(state(), null, ui());
    expect(html).toContain('aujourd’hui : —');
    expect(html).toMatch(/<td><small>—<\/small><\/td>/);
  });

  it('no request playing: no banner (never a playlist track), the skip stays at hand', () => {
    const html = spotifyView(state({ current: null }), null, ui());
    expect(html).not.toContain('sp-playing');
    expect(html).not.toContain('Numb — Linkin Park</b><small>@demandeur');
    expect(html).toContain('Passer la musique');
  });

  it('an uncertain addition still in the queue: one row with Retirer, Rembourser and Garder', () => {
    const uncertain = req({
      request_id: '00000000-0000-4000-8000-000000000002',
      state: 'UNKNOWN',
      reason: 'QUEUE_RESULT_UNKNOWN',
    });
    const html = spotifyView(
      state({ queue: [uncertain], to_verify: [uncertain] }),
      null,
      ui(),
    );
    expect(html.match(/000000000002/g)).toHaveLength(3);
    expect(html).toContain('à vérifier');
    // Being searched: listed, no action.
    const searching = spotifyView(
      state({
        queue: [],
        to_verify: [],
        in_progress: [req({ state: 'SEARCHING', track: null })],
      }),
      null,
      ui(),
    );
    expect(searching).toContain('recherche…');
    expect(searching).toContain('« &lt;script&gt;x&lt;/script&gt; »');
    expect(searching).not.toContain('data-act="sp-remove"');
  });

  it('the last decisions are folded, and stay open once opened', () => {
    expect(spotifyView(state(), null, ui())).toContain(
      '<details class="sp-more" data-fold="decisions"><summary>Dernières décisions (1)',
    );
    expect(
      spotifyView(state(), null, ui({ open: { decisions: true } })),
    ).toContain('data-fold="decisions" open>');
  });

  it('diagnostics: the last Spotify reading and « Actualiser », disabled while Spotify limits the calls', () => {
    const tech = spotifyView(
      state({ studio: playback(180_000), local: idle }),
      null,
      ui({ tab: 'tech' }),
    );
    expect(tech).toContain('Numb — Linkin Park');
    expect(tech).toContain('il y a 3 min');
    expect(tech).toMatch(/data-act="sp-refresh"\s+title/);
    const limited = spotifyView(
      state({
        api: {
          limited_until: new Date(NOW + 60_000).toISOString(),
          quota_exceeded: false,
          calls_last_minute: 0,
          rate_high: false,
          backoff_until: null,
        },
      }),
      null,
      ui({ tab: 'tech' }),
    );
    expect(limited).toMatch(/data-act="sp-refresh" disabled/);
    expect(limited).toContain('Spotify limite les appels');
  });

  it('uncertain requests can be refunded or kept (nothing sent to Twitch)', () => {
    const html = spotifyView(state(), null, ui());
    expect(html).toContain('data-decision="refund"');
    expect(html).toContain('data-decision="keep"');
    expect(html).toContain('non remboursable');
  });

  it('closed requests: one clear line and the button to open them', () => {
    const html = spotifyView(
      state({
        settings: { ...state().settings, enabled: false },
        admission: 'MODULE_DISABLED',
      }),
      null,
      ui(),
    );
    expect(html).toContain('Demandes fermées');
    expect(html).toContain('Ouvrir les demandes');
  });
});

describe('Studio « Musique » — secondary spaces', () => {
  it('Viewers: exceptions with the global value as fallback, and the way back to the global values', () => {
    const html = spotifyView(state(), null, ui({ tab: 'viewers' }));
    expect(html).toContain('@habitue');
    expect(html).toContain('global (10 min)');
    expect(html).toContain('data-act="sp-ov-reset"');
    expect(html).toContain('data-act="sp-ov-save"');
  });

  it('Réglages: the historical global settings, with the way back to them', () => {
    const html = spotifyView(state(), null, ui({ tab: 'settings' }));
    expect(html).toContain('data-act="sp-save"');
    expect(html).toContain('data-act="sp-historical"');
    expect(html).toContain('historique : 2');
  });

  it('Récompense Twitch: owner, permission, price and claims explained; creation only while none exists', () => {
    const html = spotifyView(state(), null, ui({ tab: 'reward' }));
    expect(html).toContain('L’application Twitch de Raptoru');
    expect(html).toContain('channel:manage:redemptions');
    expect(html).toContain('1 500 points');
    expect(html).toContain('value="Choisi la prochaine musique"');
    expect(html).toContain('ne valide jamais une réclamation');
    expect(html).toContain('data-act="sp-reward"');
    const made = spotifyView(
      state({
        managed_rewards: [
          {
            reward_id: 'r',
            title: 'Choisi la prochaine musique !',
            cost: 1000,
          },
        ],
      }),
      null,
      ui({ tab: 'reward' }),
    );
    expect(made).toContain('Récompense active');
    expect(made).toContain('Identifiant Twitch : <code>r</code>');
    expect(made).not.toContain('data-act="sp-reward"');
  });

  it('Production: connection and redirect URI in « Connexion et diagnostic », no simulator', () => {
    const html = spotifyView(state(), null, ui({ tab: 'tech' }));
    expect(html).toContain('http://127.0.0.1:4100/api/spotify/oauth/callback');
    expect(html).toContain('data-act="sp-connect"');
    expect(html).not.toContain('Simulateur (Lab)');
    // Asking for the simulator outside the Lab falls back on the main space.
    expect(spotifyView(state(), null, ui({ tab: 'sim' }))).toContain(
      'Dernières décisions',
    );
  });

  it('Lab: the simulator space, no connection form', () => {
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
    expect(spotifyView(lab, null, ui({ tab: 'sim' }))).toContain(
      'data-act="sp-simulate"',
    );
    expect(spotifyView(lab, null, ui({ tab: 'tech' }))).not.toContain(
      'data-act="sp-connect"',
    );
  });
});
