import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  effectsView,
  historyView,
  rewardsView,
  statusView,
} from '../../web/src/channel-points-view.ts';

// Studio tab « Points de chaîne », pure views: Twitch texts escaped, readable French, no ids / JSON shown.

const base = {
  settings: { enabled: false },
  rewards: [],
  recent: [],
  jobs_waiting: 0,
  sounds: [{ id: 'eren', label: 'Eren cri', enabled: true }],
  environment: 'lab',
  obs: { connected: false, pending_reverts: 0 },
  twitch: { scope: false, adapter_running: true },
  effects: null,
  executor_error: null,
};

describe('Points de chaîne views', () => {
  it('status: switch OFF, missing Twitch authorization, OBS state; production says « bot de production »', () => {
    const lab = statusView(base, null);
    expect(lab).toContain('Automatisations : OFF');
    expect(lab).toContain('autorisation manquante');
    expect(lab).toContain('OBS non connecté');
    expect(statusView({ ...base, environment: 'production' }, null)).toContain(
      'bot de production',
    );
    expect(statusView(null, '<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('actions in plain French', () => {
    expect(actionLabel({ type: 'sound', sound_id: 'eren' }, base.sounds)).toBe(
      'Son « Eren cri »',
    );
    expect(
      actionLabel({
        type: 'obs_source',
        scene: 'Jeu',
        source: 'Creepy',
        visible: true,
        duration_ms: 2500,
      }),
    ).toBe('Afficher « Creepy » (scène « Jeu ») pendant 2,5 s');
    expect(
      actionLabel({
        type: 'obs_filter',
        source: 'Cam',
        filter: 'Flou',
        enabled: false,
      }),
    ).toBe('Désactiver le filtre « Flou » de « Cam »');
    expect(actionLabel({ type: 'obs_scene', scene: 'BRB' })).toBe(
      'Passer sur la scène « BRB »',
    );
  });

  it('rewards and history escape every Twitch text; reasons and results readable', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const s = {
      ...base,
      rewards: [
        {
          id: 'r1',
          title: hostile,
          cost: 2000,
          twitch_enabled: false,
          listed_by_twitch: true,
          rule: null,
        },
      ],
      recent: [
        {
          source: 'twitch',
          redemption_id: 'x',
          reward: { title: hostile, cost: 1 },
          user: { display_name: hostile },
          user_input: hostile,
          received_at: '2026-10-17T20:00:00Z',
          status: 'ignored',
          reason: 'automations_off',
          actions: [],
          results: [],
        },
        {
          source: 'simulation',
          redemption_id: 'y',
          reward: { title: 'Creepy', cost: 1 },
          user: { display_name: 'Test Studio' },
          user_input: null,
          received_at: '2026-10-17T20:00:01Z',
          status: 'partial',
          reason: null,
          actions: [
            { type: 'sound', sound_id: 'eren' },
            { type: 'obs_scene', scene: 'BRB' },
          ],
          results: [
            { index: 0, status: 'done' },
            { index: 1, status: 'failed', error: 'OBS non connecté' },
          ],
        },
      ],
    };
    const html = rewardsView(s, 'r1') + historyView(s);
    expect(html).not.toContain('<img');
    expect(html).toContain('désactivée sur Twitch');
    expect(html).toContain('automatisations désactivées');
    expect(html).toContain('✓ Son « Eren cri »');
    expect(html).toContain('✗ Passer sur la scène « BRB » — OBS non connecté');
    expect(html).toContain('Test Studio');
  });

  it('sounds: « en attente du lecteur » / « en cours de lecture » until the player confirms; readable reasons', () => {
    const row = (results) => ({
      source: 'twitch',
      redemption_id: 'z',
      reward: { title: 'Hello', cost: 1 },
      user: { display_name: 'V' },
      user_input: null,
      received_at: '2026-10-17T20:00:00Z',
      status: 'pending',
      reason: null,
      actions: [{ type: 'sound', sound_id: 'eren' }],
      results,
    });
    expect(
      historyView({
        ...base,
        recent: [row([{ index: 0, status: 'pending', progress: 'queued' }])],
      }),
    ).toContain('… Son « Eren cri » — en attente du lecteur Soundboard');
    expect(
      historyView({
        ...base,
        recent: [row([{ index: 0, status: 'pending', progress: 'playing' }])],
      }),
    ).toContain('en cours de lecture');
    expect(
      historyView({
        ...base,
        recent: [
          row([{ index: 0, status: 'failed', error: 'player_offline' }]),
        ],
      }),
    ).toContain(
      '✗ Son « Eren cri » — lecteur Soundboard non ouvert ou son non activé',
    );
    expect(
      historyView({
        ...base,
        recent: [
          row([
            { index: 0, status: 'unknown', error: 'playback_not_confirmed' },
          ]),
        ],
      }),
    ).toContain('? Son « Eren cri » — lecture non confirmée par le lecteur');
  });

  it('effect sounds: label with volume, player state chips, OBS URL, missing imports, readable failures', () => {
    const effects = {
      url: 'http://127.0.0.1:4100/effects/player.html#abc',
      connected: false,
      audio: false,
      playing: 0,
      sounds: [
        { id: 'tiens-bon', label: 'Tiens bon !', volume: 41, available: true },
        {
          id: 'glory-holes',
          label: 'Glory holes',
          volume: 100,
          available: false,
        },
      ],
      videos: [
        {
          id: 'fuck-you',
          label: 'NTM — Fuck You',
          volume: 10,
          available: true,
        },
      ],
    };
    expect(
      actionLabel(
        { type: 'effect_sound', sound_id: 'tiens-bon', volume: 41 },
        [],
        effects.sounds,
      ),
    ).toBe('Son d’effet « Tiens bon ! » (41 %)');
    expect(
      actionLabel(
        { type: 'effect_video', video_id: 'fuck-you', volume: 10 },
        [],
        [...effects.sounds, ...effects.videos],
      ),
    ).toBe('Vidéo d’effet « NTM — Fuck You » (10 %)');
    expect(actionLabel({ type: 'interaction', interaction: 'brb' })).toBe(
      'Interaction « BRB »',
    );
    expect(actionLabel({ type: 'interaction', interaction: 'creepy' })).toBe(
      'Interaction « Creepy »',
    );
    // FX Cam: the effect Core resolved from the viewer's text; the viewer's text itself escaped; unknown readable.
    expect(actionLabel({ type: 'interaction', interaction: 'fx_cam' })).toBe(
      'Interaction « FX Cam »',
    );
    const fx = historyView({
      ...base,
      recent: [
        {
          source: 'twitch',
          redemption_id: 'r1',
          reward: { title: 'FX cam', cost: 500 },
          user: { display_name: 'Viewer' },
          user_input: ' RAGE ',
          received_at: '2026-10-18T10:00:00.000Z',
          status: 'done',
          reason: null,
          actions: [
            { type: 'interaction', interaction: 'fx_cam', effect: 'rage' },
          ],
          results: [{ index: 0, status: 'done' }],
        },
        {
          source: 'twitch',
          redemption_id: 'r2',
          reward: { title: 'FX cam', cost: 500 },
          user: { display_name: 'Viewer' },
          user_input: '<b>feu</b>',
          received_at: '2026-10-18T10:00:01.000Z',
          status: 'failed',
          reason: null,
          actions: [{ type: 'interaction', interaction: 'fx_cam' }],
          results: [{ index: 0, status: 'failed', error: 'fx_cam_unknown' }],
        },
      ],
    });
    expect(fx).toContain('✓ FX Cam « rage »');
    expect(fx).toContain('« &lt;b&gt;feu&lt;/b&gt; »');
    expect(fx).toContain(
      '✗ Interaction « FX Cam » — effet inconnu (effets : prison, bighead, pixel, drunk, glitch, rage)',
    );
    expect(
      actionLabel({
        type: 'obs_scene',
        scene: 'Creepy Effect',
        duration_ms: 4200,
      }),
    ).toBe('Passer sur la scène « Creepy Effect » pendant 4,2 s, puis revenir');
    expect(statusView({ ...base, effects }, null)).toContain(
      'Lecteur d’effets : non ouvert',
    );
    expect(
      statusView({ ...base, effects: { ...effects, connected: true } }, null),
    ).toContain('son bloqué');
    expect(
      statusView(
        {
          ...base,
          effects: { ...effects, connected: true, audio: true, playing: 2 },
        },
        null,
      ),
    ).toContain('Lecteur d’effets : 2 en lecture');
    expect(statusView(base, null)).not.toContain('Lecteur d’effets');
    const panel = effectsView(effects);
    expect(panel).toContain(
      'value="http://127.0.0.1:4100/effects/player.html#abc"',
    );
    expect(panel).toContain(
      '2 / 3 média(s) importé(s) — à importer : Glory holes',
    );
    expect(effectsView(null)).toBe('');
    const history = historyView({
      ...base,
      effects,
      recent: [
        {
          source: 'twitch',
          redemption_id: 'r1',
          reward: { title: 'Tiens bon !', cost: 500 },
          user: { display_name: 'Viewer' },
          user_input: null,
          received_at: '2026-10-18T20:00:00Z',
          status: 'failed',
          reason: null,
          actions: [
            { type: 'effect_sound', sound_id: 'tiens-bon', volume: 41 },
          ],
          results: [
            { index: 0, status: 'failed', error: 'effects_player_offline' },
          ],
        },
        {
          source: 'twitch',
          redemption_id: 'r2',
          reward: { title: 'Tiens bon !', cost: 500 },
          user: { display_name: 'Viewer' },
          user_input: null,
          received_at: '2026-10-18T20:00:01Z',
          status: 'pending',
          reason: null,
          actions: [
            { type: 'effect_sound', sound_id: 'tiens-bon', volume: 41 },
          ],
          results: [{ index: 0, status: 'pending', progress: 'playing' }],
        },
      ],
    });
    expect(history).toContain(
      'lecteur d’effets non ouvert (source OBS absente)',
    );
    expect(history).toContain(
      'Son d’effet « Tiens bon ! » (41 %) — en cours de lecture',
    );
  });
});
