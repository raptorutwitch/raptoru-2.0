import { describe, expect, it } from 'vitest';
import {
  spotifyView,
  type SpRequest,
  type SpState,
} from '../../web/src/spotify-view.js';

// Spotify V2 — the Studio section « Musique » (pure render): escaped texts, Lab simulator only in the Lab, the
// connection only in Production, uncertain requests to settle, refunds explained.

const req = (over: Partial<SpRequest> = {}): SpRequest => ({
  request_id: '00000000-0000-4000-8000-000000000001',
  source: 'twitch',
  viewer: { id: '1', login: 'viewer<b>', name: 'V' },
  input: '<script>x</script>',
  state: 'QUEUED',
  reason: 'QUEUED',
  track: {
    id: 'a'.repeat(22),
    uri: `spotify:track:${'a'.repeat(22)}`,
    title: 'Numb',
    artists: ['Linkin Park'],
    duration_ms: 185_000,
  },
  confidence: 'HIGH',
  confirmation: 'http_204',
  received_at: new Date(0).toISOString(),
  queued_at: new Date(0).toISOString(),
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
  studio: null,
  current: null,
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
  twitch_actions: [],
  managed_rewards: [],
  connection: {
    auth: 'needs_reauth',
    client_id: null,
    account: null,
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

describe('Studio « Musique » section', () => {
  it('escapes every viewer text', () => {
    const html = spotifyView(state(), null);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('viewer<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('Production: the connection and the redirect URI, never the simulator', () => {
    const html = spotifyView(state(), null);
    expect(html).toContain('reconnexion nécessaire');
    expect(html).toContain('http://127.0.0.1:4100/api/spotify/oauth/callback');
    expect(html).toContain('data-act="sp-connect"');
    expect(html).not.toContain('Simulateur (Lab)');
  });

  it('Lab: the simulator and its controls, no connection form', () => {
    const html = spotifyView(
      state({
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
      }),
      null,
    );
    expect(html).toContain('Simulateur (Lab)');
    expect(html).toContain('data-act="sp-simulate"');
    expect(html).not.toContain('data-act="sp-connect"');
  });

  it('uncertain requests can be settled; without Raptoru’s reward, refunds are said impossible', () => {
    const html = spotifyView(state(), null);
    expect(html).toContain('data-decision="refund"');
    expect(html).toContain('data-decision="keep"');
    expect(html).toContain('remboursement impossible');
    expect(html).toContain('data-act="sp-reward"');
    expect(html).toContain('aucun titre assez proche');
  });

  it('a rate limit is visible with its end', () => {
    const html = spotifyView(
      state({
        api: {
          limited_until: new Date(0).toISOString(),
          quota_exceeded: true,
          calls_last_minute: 0,
          rate_high: false,
          backoff_until: null,
        },
      }),
      null,
    );
    expect(html).toContain('Quota Spotify dépassé');
  });
});
