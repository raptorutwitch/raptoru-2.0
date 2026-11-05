import { describe, expect, it } from 'vitest';
import {
  ordered,
  readiness,
  readinessHtml,
  summary,
  type ReadinessInput,
} from '../../web/src/readiness.ts';

// Refonte F4 — « Prêt pour le live »: each check green AND red, off on purpose never an outage, an unreadable route
// « non vérifié », an intention ON without its dependency never green. Fictional states only.

const okSignals = [
  {
    id: 'core-link',
    label: 'Studio ↔ Core',
    level: 'ok',
    value: 'Connecté',
    hint: null,
  },
  { id: 'tts', label: 'TTS', level: 'ok', value: 'Prêt (3 voix)', hint: null },
  {
    id: 'soundboard',
    label: 'Soundboard',
    level: 'ok',
    value: 'Prêt',
    hint: null,
  },
  { id: 'bonk', label: 'Bonk', level: 'ok', value: 'Prêt', hint: null },
];
const flags = { CHAT_GAMES: true, CHAT_GAMES_OUTPUT: true };
const ready: ReadinessInput = {
  profile: { effective: 'production', production: { state: 'connected' } },
  modules: [
    {
      id: 'bot',
      level: 'ok',
      state: 'Actif',
      summary: 'Bot actif sur le VPS.',
      hint: null,
      data: {
        flags,
        health: {
          eventSubBot: true,
          eventSubBroadcaster: true,
          broadcasterToken: true,
        },
      },
    },
    {
      id: 'interactions',
      level: 'ok',
      state: 'Prêt',
      summary: '',
      hint: null,
      data: { signals: okSignals },
    },
  ],
  channelPoints: {
    settings: { enabled: true },
    obs: { connected: true },
    effects: { connected: true, audio: true, current: true },
    executor_error: null,
  },
  alerts: { queued: [], source: { seen: true } },
  se: { mode: 'active', state: 'connected' },
  wheel: { settings: { enabled: true }, animations_waiting: null },
  games: { enabled: true },
  spotify: { admission: 'ready' },
};
const byId = (i: ReadinessInput) =>
  Object.fromEntries(readiness(i).map((c) => [c.id, c]));

describe('Prêt pour le live', () => {
  it('all ready: everything checkable is green; the served extension is « non vérifié », never invented', () => {
    const c = byId(ready);
    for (const id of [
      'core',
      'bot',
      'twitch-chat',
      'twitch-broadcaster',
      'obs',
      'effects',
      'soundboard',
      'tts',
      'bonk',
      'alerts',
      'se',
      'cp',
      'wheel',
      'games',
      'chat-output',
      'spotify',
    ])
      expect(c[id]?.level, id).toBe('ok');
    expect(c.extension).toMatchObject({
      level: 'unknown',
      state: 'Non vérifié',
    });
    expect(summary(readiness(ready)).text).toContain(
      'Aucun problème détecté, mais 1 point(s) non vérifié(s)',
    );
  });

  it('each dependency down turns its line red with the consequence and where to fix it', () => {
    const c = byId({
      ...ready,
      modules: [
        {
          ...ready.modules![0]!,
          data: {
            flags: { CHAT_GAMES: false, CHAT_GAMES_OUTPUT: false },
            health: {
              eventSubBot: false,
              eventSubBroadcaster: false,
              broadcasterToken: false,
            },
          },
        },
        {
          ...ready.modules![1]!,
          data: {
            signals: okSignals.map((s) =>
              s.id === 'tts'
                ? { ...s, level: 'error', value: 'Lecteur absent' }
                : s,
            ),
          },
        },
      ],
      channelPoints: {
        settings: { enabled: true },
        obs: { connected: false },
        effects: { connected: false },
      },
      alerts: { queued: [1, 2], source: { seen: false } },
      se: { mode: 'active', state: 'auth_failed', state_label: 'Jeton refusé' },
      wheel: {
        settings: { enabled: true },
        animations_waiting: 'Lecteur d’effets non ouvert',
      },
      spotify: { admission: 'STUDIO_UNAVAILABLE' },
    });
    for (const id of [
      'twitch-chat',
      'twitch-broadcaster',
      'twitch-token',
      'obs',
      'effects',
      'tts',
      'alerts',
      'se',
      'cp',
      'wheel',
      'games',
      'chat-output',
      'spotify',
    ])
      expect(c[id]?.level, id).toBe('error');
    expect(c.obs!.consequence).toContain('expirés après 2 min');
    expect(c.alerts!.consequence).toContain('(2)');
    expect(c.games).toMatchObject({
      state: 'Bloqués par le serveur',
      fix: { page: 'centre' },
    });
    expect(c.cp!.state).toBe('Activés, en attente'); // the intention ON is never green without OBS
  });

  it('off on purpose is « off », never an outage, and folded at the end', () => {
    const input = {
      ...ready,
      channelPoints: { ...ready.channelPoints!, settings: { enabled: false } },
      se: { mode: 'off' },
      wheel: { settings: { enabled: false } },
      games: { enabled: false },
      spotify: { admission: 'MODULE_DISABLED' },
    };
    const c = byId(input);
    for (const id of ['cp', 'se', 'wheel', 'games', 'spotify']) {
      expect(c[id]?.level, id).toBe('off');
      expect(c[id]?.consequence, id).toBeNull();
    }
    const list = ordered(readiness(input));
    expect(list.at(-1)!.level).toBe('off');
    expect(readinessHtml(readiness(input), (p) => `/?p=${p}`)).toContain(
      'Coupé volontairement (5)',
    );
  });

  it('a route that does not answer is « non vérifié », never green nor red; TEST mode of donations is a warning', () => {
    const c = byId({
      ...ready,
      modules: null,
      channelPoints: null,
      alerts: null,
      wheel: null,
      games: null,
      spotify: null,
      se: { mode: 'test' },
    });
    for (const id of [
      'bot',
      'obs',
      'effects',
      'alerts',
      'wheel',
      'games',
      'spotify',
    ])
      expect(c[id]?.level, id).toBe('unknown');
    expect(c.se).toMatchObject({ level: 'warn', state: 'Mode TEST' });
  });

  it('Lab profile: says the list does not check the stream; no Production-only lines', () => {
    const c = byId({ ...ready, profile: { effective: 'lab' } });
    expect(c.core).toMatchObject({ level: 'warn', state: 'Profil Lab' });
    expect(c['twitch-chat']).toBeUndefined();
    expect(c.se).toBeUndefined();
    expect(c['chat-output']).toBeUndefined();
  });

  it('a Production start failure is red, first', () => {
    const list = ordered(
      readiness({
        ...ready,
        profile: {
          effective: 'production',
          production: {
            state: 'start_failed',
            detail: 'journal d’un autre profil',
          },
        },
      }),
    );
    expect(list[0]).toMatchObject({
      id: 'core',
      level: 'error',
      why: 'journal d’un autre profil',
    });
  });

  it('what is ready is folded after what needs attention: problems and « non vérifié » stay in sight', () => {
    const checks = readiness({ ...ready, alerts: null });
    const html = readinessHtml(checks, (p) => `/?p=${p}`);
    const okCount = checks.filter((x) => x.level === 'ok').length;
    expect(okCount).toBeGreaterThan(0);
    expect(html).toContain(
      `<details class="rs-ready-ok"><summary>Prêt (${okCount})</summary>`,
    );
    const folded = html.slice(html.indexOf('rs-ready-ok'));
    expect(folded).not.toContain('data-check="alerts"'); // the unchecked one is above, in sight
    expect(html.indexOf('data-check="alerts"')).toBeLessThan(
      html.indexOf('rs-ready-ok'),
    );
    // All ready: nothing but the summary and the folded list.
    const allOk = readiness(ready).filter(
      (x) => x.level === 'ok' || x.level === 'off',
    );
    expect(readinessHtml(allOk, (p) => `/?p=${p}`)).toContain(
      '<ul class="rs-ready-list"></ul>',
    );
  });

  it('the panel never offers an action button (read only)', () => {
    const html = readinessHtml(readiness(ready), (p) => `/?p=${p}`);
    expect(html).not.toContain('<button');
    expect(html).toContain('Lecture seule');
  });

  it('Jeu des mots (H8): OFF on purpose folded, ON says its interval; unreadable → non vérifié', () => {
    expect(
      byId({ ...ready, wordGame: { enabled: false } })['word-game'],
    ).toMatchObject({ level: 'off' });
    expect(
      byId({
        ...ready,
        wordGame: { enabled: true, interval: { min_s: 300, max_s: 900 } },
      })['word-game'],
    ).toMatchObject({
      level: 'ok',
      why: 'Un mot toutes les 5 à 15 min pendant le live.',
    });
    expect(byId({ ...ready, wordGame: null })['word-game']).toMatchObject({
      level: 'unknown',
    });
  });
});
