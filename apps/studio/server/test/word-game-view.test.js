import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  keepRevealed,
  wordGameView,
} from '../../web/src/word-game-view.ts';

// Jeu des mots V1 — Studio panel view (Lot 4): what the streamer sees, from Core's state only
// (docs/WORD_GAME_PARITY.md § 14). The clear words never appear (only what the chat saw).

const NOW = Date.parse('2026-10-16T20:10:00.000Z');
const state = (over = {}) => ({
  channel_id: '900400',
  live: true,
  session_id: 's-1',
  running: true,
  stopped: false,
  next_word_at: new Date(NOW + 125_000).toISOString(),
  active: [],
  streak: { holder_id: null, holder_name: null, count: 0 },
  recent: [],
  fetched_at: NOW,
  ...over,
});
const word = (over = {}) => ({
  occurrence_id: 'jdm-1',
  word: 'angle',
  shuffled: 'lagne',
  golden: false,
  source: 'cycle',
  created_at: new Date(NOW - 75_000).toISOString(),
  age_seconds: 75,
  ...over,
});
const button = (html, action) =>
  new RegExp(
    `<button[^>]*data-action="${action}"([^>]*)>([^<]*)</button>`,
  ).exec(html);

describe('panel view: volume of the winning sound', () => {
  it('a 0–100 % slider with the saved value; absent when Studio sends none', () => {
    const html = wordGameView(state({ sound_volume: 40 }), NOW);
    expect(html).toMatch(
      /<input type="range" min="0" max="100" step="5" value="40" data-volume/,
    );
    expect(html).toContain('<output>40 %</output>');
    expect(wordGameView(state(), NOW)).not.toContain('data-volume');
  });
});

describe('panel view', () => {
  it('loading and unavailable (no Lab Core / Production profile)', () => {
    expect(wordGameView(null, NOW)).toContain('Chargement');
    expect(wordGameView({ enabled: false }, NOW)).toContain('Indisponible');
  });

  it('offline: « Hors live », actions disabled, explained', () => {
    const html = wordGameView(
      state({
        live: false,
        running: false,
        session_id: null,
        next_word_at: null,
      }),
      NOW,
    );
    expect(html).toContain('Hors live');
    expect(html).toContain('Actions disponibles pendant un live');
    expect(button(html, 'stop')[1]).toContain('disabled');
    expect(button(html, 'new_word')[1]).toContain('disabled');
    expect(html).toContain('le jeu ne tourne que pendant un live');
  });

  it('live and active: « En live » + « Actif », Arrêter and Nouveau mot enabled, next word', () => {
    const html = wordGameView(state(), NOW);
    expect(html).toContain('En live');
    expect(html).toContain('Actif');
    expect(button(html, 'stop')).toMatchObject({ 1: ' ', 2: 'Arrêter' });
    expect(button(html, 'new_word')[1]).not.toContain('disabled');
    expect(html).toContain('Prochain mot dans ~2:05');
  });

  it('stopped: « Arrêté », the toggle becomes Reprendre (start), Nouveau mot still enabled', () => {
    const html = wordGameView(
      state({ stopped: true, running: false, next_word_at: null }),
      NOW,
    );
    expect(html).toContain('Arrêté');
    expect(button(html, 'start')[2]).toBe('Reprendre');
    expect(button(html, 'stop')).toBeNull();
    expect(button(html, 'new_word')[1]).not.toContain('disabled');
    expect(html).not.toContain('Prochain mot');
  });

  it('busy (action in flight): buttons disabled', () => {
    const html = wordGameView(state(), NOW, true);
    expect(button(html, 'stop')[1]).toContain('disabled');
    expect(button(html, 'new_word')[1]).toContain('disabled');
  });

  it('active words: shuffled form, age (ticking between polls), golden and manual marks, never the clear word', () => {
    const html = wordGameView(
      state({
        active: [
          word({
            occurrence_id: 'jdm-2',
            shuffled: 'quiner',
            word: 'requin',
            golden: true,
            age_seconds: 3725,
          }),
          word({ source: 'manual' }),
        ],
      }),
      NOW + 5000,
    );
    expect(html).toContain('🔸 quiner 🔸');
    expect(html).toContain('doré');
    expect(html).toContain('lagne');
    expect(html).toContain('manuel');
    expect(html).toContain('1:02:10');
    expect(html).toContain('1:20');
    expect(html).not.toContain('requin');
    expect(html).not.toContain('>angle<');
    expect(html).toContain('Mots actifs <span class="wg-count">2</span>');
  });

  it('a new word (manual) appears in the active list', () => {
    const before = wordGameView(state(), NOW);
    expect(before).toContain('Aucun mot en cours.');
    const after = wordGameView(
      state({ active: [word({ source: 'manual', age_seconds: 0 })] }),
      NOW,
    );
    expect(after).toContain('lagne');
    expect(after).toContain('0:00');
  });

  it('streak and recent wins (viewer, word, gain, time)', () => {
    const html = wordGameView(
      state({
        streak: { holder_id: '1', holder_name: 'Alice', count: 3 },
        recent: [
          {
            message_id: 'tw-1',
            viewer_id: '1',
            viewer_display_name: 'Alice',
            words: [
              { word: 'angle', points: 1500, fast: true, golden: false },
              { word: 'requin', points: 600, fast: false, golden: false },
            ],
            combo: 500,
            breaker: 0,
            total: 2600,
            created_at: '2026-10-16T20:09:30.000Z',
          },
        ],
      }),
      NOW,
    );
    expect(html).toContain('<strong>Alice</strong> · 3 mots d’affilée');
    expect(html).toContain('angle, requin');
    expect(html).toContain('+2600 jetons');
    expect(html).toMatch(/<time>\d{2}:\d{2}:30<\/time>/);
    expect(wordGameView(state(), NOW)).toContain('Aucune série en cours.');
    expect(wordGameView(state(), NOW)).toContain(
      'Aucune trouvaille pour l’instant.',
    );
  });

  it('escapes what comes from the chat', () => {
    const html = wordGameView(
      state({ streak: { holder_id: '1', holder_name: '<b>x</b>', count: 1 } }),
      NOW,
    );
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('« Voir la réponse »: hidden by default, revealed for that line only, « Masquer » hides it again', () => {
    const st = state({
      active: [
        word({ occurrence_id: 'jdm-1', word: 'angle', shuffled: 'lagne' }),
        word({ occurrence_id: 'jdm-2', word: 'requin', shuffled: 'quiner' }),
      ],
    });
    const reveal = (html, id) =>
      new RegExp(
        `<button[^>]*data-reveal="${id}" aria-pressed="(true|false)">([^<]*)</button>`,
      ).exec(html);
    const hidden = wordGameView(st, NOW);
    expect(hidden).not.toContain('angle');
    expect(hidden).not.toContain('requin');
    expect(reveal(hidden, 'jdm-1').slice(1)).toEqual([
      'false',
      'Voir la réponse',
    ]);
    expect(reveal(hidden, 'jdm-2').slice(1)).toEqual([
      'false',
      'Voir la réponse',
    ]);
    const one = wordGameView(st, NOW, false, null, new Set(['jdm-1']));
    expect(one).toContain(
      '<span class="wg-answer" title="Réponse">angle</span>',
    );
    expect(one).not.toContain('requin');
    expect(reveal(one, 'jdm-1').slice(1)).toEqual(['true', 'Masquer']);
    expect(reveal(one, 'jdm-2').slice(1)).toEqual(['false', 'Voir la réponse']);
    // Hidden again: the same view as before.
    expect(wordGameView(st, NOW, false, null, new Set())).toBe(hidden);
    // Reveal buttons stay usable offline / while an action runs (local display only).
    expect(reveal(wordGameView(st, NOW, true, null), 'jdm-1')[0]).not.toContain(
      'disabled',
    );
  });

  it('a word that leaves the list forgets its reveal; no state → nothing revealed', () => {
    const st = state({ active: [word({ occurrence_id: 'jdm-2' })] });
    expect([...keepRevealed(new Set(['jdm-1', 'jdm-2']), st)]).toEqual([
      'jdm-2',
    ]);
    expect([...keepRevealed(new Set(['jdm-1']), null)]).toEqual([]);
    expect([...keepRevealed(new Set(['jdm-1']), { enabled: false })]).toEqual(
      [],
    );
  });

  it('the answer is escaped', () => {
    const html = wordGameView(
      state({ active: [word({ occurrence_id: 'jdm-1', word: '<b>x</b>' })] }),
      NOW,
      false,
      null,
      new Set(['jdm-1']),
    );
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('age labels', () => {
    expect([0, 9, 75, 600, 3725].map(ageLabel)).toEqual([
      '0:00',
      '0:09',
      '1:15',
      '10:00',
      '1:02:05',
    ]);
  });
});
