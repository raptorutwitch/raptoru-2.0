import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  masterChip,
  mediaCount,
  statusView,
} from '../../web/src/pages/rewards-model.ts';
import {
  ADD_KINDS,
  actionTitle,
  feedRow,
  filterRewards,
  filtersHtml,
  galleryHtml,
  kindOf,
  requestHtml,
  requestsOf,
  rewardCard,
  ruleState,
  twitchState,
} from '../../web/src/pages/rewards-view.ts';

/** The requests as the page shows them: the feed row, then its detail panel. */
const historyView = (s) =>
  s.recent.map((x) => feedRow(x) + requestHtml(x, s, null)).join('');
const rewardsView = (s) => galleryHtml(s, 'all', '', new Set());

// Page Récompenses Twitch, pure views: Twitch texts escaped, readable French, no ids / JSON shown.

const q = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One action's line of a redemption: its fate, its label, its reason. */
const line = (kind, label, note = '') =>
  new RegExp(
    `rw-res is-${kind}"><svg.*?</svg><span>${q(label)}${note ? `<small>${q(note)}` : ''}`,
  );

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
    expect(masterChip(base, null, null)).toContain('Automatisations coupées');
    // ON but not executable: never green on an intention.
    const on = { ...base, settings: { enabled: true } };
    expect(masterChip(on, null, 'OBS non connecté à Studio')).toContain(
      'Actives, OBS non connecté à Studio',
    );
    expect(masterChip(on, null, null)).toContain('Automatisations actives');
    expect(masterChip(null, 'Core injoignable', null)).toContain(
      'Core injoignable',
    );
    // The Lab has no Twitch: fictional, never shown as a failure.
    expect(lab).toContain('Twitch : fictif (Lab)');
    expect(lab).toContain('OBS non connecté (normal dans le Lab)');
    expect(statusView({ ...base, environment: 'local' }, null)).toContain(
      'autorisation manquante',
    );
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
    expect(
      actionLabel({ type: 'credits', currency: 'credits_tts', amount: 3 }),
    ).toBe('Accorder 3 Crédit(s) TTS au viewer');
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
    expect(html).toContain('Désactivée ou en pause sur Twitch');
    expect(html).toContain('automatisations désactivées');
    expect(html).toMatch(line('done', 'Son « Eren cri »'));
    expect(html).toMatch(
      line('failed', 'Passer sur la scène « BRB »', 'OBS non connecté'),
    );
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
    ).toMatch(
      line('pending', 'Son « Eren cri »', 'en attente du lecteur Soundboard'),
    );
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
    ).toMatch(
      line(
        'failed',
        'Son « Eren cri »',
        'lecteur Soundboard non ouvert ou son non activé',
      ),
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
    ).toMatch(
      line(
        'unknown',
        'Son « Eren cri »',
        'lecture non confirmée par le lecteur',
      ),
    );
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
    expect(fx).toMatch(line('done', 'FX Cam « rage »'));
    // Couleur Cam: the colour applied (drawn by Core for « aléatoire »); unknown readable.
    expect(
      actionLabel({
        type: 'interaction',
        interaction: 'color_cam',
        color: 'bleu ciel',
      }),
    ).toBe('Couleur Cam « bleu ciel »');
    const color = historyView({
      ...base,
      recent: [
        {
          source: 'twitch',
          redemption_id: 'c1',
          reward: { title: 'Couleur Cam', cost: 100 },
          user: { display_name: 'Viewer' },
          user_input: 'pourpre',
          received_at: '2026-10-18T10:00:00.000Z',
          status: 'failed',
          reason: null,
          actions: [{ type: 'interaction', interaction: 'color_cam' }],
          results: [{ index: 0, status: 'failed', error: 'color_cam_unknown' }],
        },
      ],
    });
    expect(color).toMatch(
      line(
        'failed',
        'Interaction « Couleur Cam »',
        'couleur inconnue, aucun remboursement possible',
      ),
    );
    expect(fx).toContain('« &lt;b&gt;feu&lt;/b&gt; »');
    expect(fx).toMatch(
      line(
        'failed',
        'Interaction « FX Cam »',
        'effet inconnu (effets : prison, bighead, pixel, drunk, glitch, rage)',
      ),
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
    expect(mediaCount(effects)).toEqual({
      have: 2,
      total: 3,
      missing: ['Glory holes'],
    });
    expect(mediaCount(null)).toEqual({ have: 0, total: 0, missing: [] });
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
    expect(history).toMatch(
      line(
        'pending',
        'Son d’effet « Tiens bon ! » (41 %)',
        'en cours de lecture',
      ),
    );
  });
});

describe('Récompenses page (rebuilt 07/11): Twitch reward, Raptoru actions, requests kept apart', () => {
  const reward = (id, title, actions, extra = {}) => ({
    id,
    title,
    cost: 500,
    twitch_enabled: true,
    listed_by_twitch: true,
    rule: actions ? { enabled: true, actions, version: 1 } : null,
    ...extra,
  });
  const sb = { type: 'credits', currency: 'credits_soundboard', amount: 2 };
  const tts = { type: 'credits', currency: 'credits_tts', amount: 3 };

  it('the shared « credits » type reads as two different things: Crédits TTS and Crédits Soundboard', () => {
    expect(actionTitle(sb)).toBe('Crédits Soundboard');
    expect(actionTitle(tts)).toBe('Crédits TTS');
    expect(kindOf(sb)).toBe('sb');
    expect(kindOf(tts)).toBe('tts');
    const html = galleryHtml(
      { ...base, rewards: [reward('a', 'Crédit Soundboard', [sb])] },
      'all',
      '',
      new Set(),
    );
    expect(html).toContain('Crédits Soundboard');
    expect(html).not.toContain('Crédits TTS');
  });

  it('every action offered by « Ajouter une action » is a Core action as is (no new type)', () => {
    const types = new Set([
      'sound',
      'effect_sound',
      'effect_video',
      'obs_source',
      'obs_filter',
      'obs_scene',
      'credits',
      'interaction',
    ]);
    for (const k of ADD_KINDS) expect(types).toContain(k.make().type);
    expect(ADD_KINDS.find((k) => k.id === 'credits_sb').make()).toEqual({
      type: 'credits',
      currency: 'credits_soundboard',
      amount: 0,
    });
    expect(actionLabel(ADD_KINDS[0].make())).toContain('nombre à choisir');
  });

  it('filters, Twitch availability, rule state; a pending draft locks the card switch', () => {
    const s = {
      ...base,
      rewards: [
        reward('a', 'Reliée', [sb]),
        reward('b', 'Vide', null),
        reward('c', 'Coupée', [tts], {
          rule: { enabled: false, actions: [tts], version: 2 },
        }),
        reward('d', 'Pause', [tts], { twitch_enabled: false }),
      ],
    };
    expect(filterRewards(s.rewards, 'linked').map((r) => r.id)).toEqual([
      'a',
      'd',
    ]);
    expect(filterRewards(s.rewards, 'none').map((r) => r.id)).toEqual(['b']);
    expect(filterRewards(s.rewards, 'off').map((r) => r.id)).toEqual(['c']);
    expect(filterRewards(s.rewards, 'twitch').map((r) => r.id)).toEqual(['d']);
    expect(filterRewards(s.rewards, 'all', 'coup').map((r) => r.id)).toEqual([
      'c',
    ]);
    expect(twitchState(s.rewards[3]).text).toBe('Désactivée ou en pause sur Twitch');
    expect(ruleState(s.rewards[2]).text).toBe('Actions Raptoru coupées');
    expect(ruleState(s.rewards[1]).text).toBe('Aucune action Raptoru');
    const locked = rewardCard(s.rewards[0], s, { draft: true });
    expect(locked).toMatch(/data-rule-toggle="a"[^>]*disabled/);
    expect(locked).toContain('Pas enregistrée');
    expect(filtersHtml(s, 'all')).toContain('data-filter="none"');
  });

  it('a request: feed row and detail escape Twitch texts; refunds are never manual', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const x = {
      source: 'twitch',
      redemption_id: 'r9',
      reward: { id: 'a', title: hostile, cost: 500 },
      user: { display_name: hostile },
      user_input: hostile,
      twitch_status: 'canceled',
      received_at: '2026-11-07T20:00:00Z',
      status: 'done',
      reason: null,
      actions: [sb],
      results: [{ index: 0, status: 'done' }],
    };
    const s = { ...base, recent: [x], rewards: [reward('a', hostile, [sb])] };
    const html = feedRow(x) + requestHtml(x, s, s.rewards[0]);
    expect(html).not.toContain('<img');
    expect(html).toContain('Annulée : points rendus au viewer');
    expect(html).toContain('Aucun remboursement manuel');
    expect(requestsOf(s, s.rewards[0])).toHaveLength(1);
  });
});
