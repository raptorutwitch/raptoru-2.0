import { describe, expect, it } from 'vitest';
import {
  chatTimeline,
  chatView,
  stepState,
} from '../../web/src/sim-chat-view.ts';

// Studio « Simulation » chat: received messages (Core's memory) and LeCroupier_'s real answers (cmd_steps)
// in one conversation; honest send states; local clear; no duplicate.

const T = Date.parse('2026-10-16T20:00:00.000Z');
const iso = (s) => new Date(T + s * 1000).toISOString();
const inMsg = (id, s, text, over = {}) => ({
  seq: s,
  message_id: id,
  received_at: iso(s),
  source: 'simulator',
  chatter: { id: '1', display_name: 'Alice', role: 'viewer' },
  text,
  handled: [],
  ...over,
});
const step = (id, s, text, over = {}) => ({
  step_id: id,
  origin: 'mini_game',
  kind: 'action',
  status: 'queued',
  params: { mode: 'normal', text },
  created_at: iso(s),
  available_at: iso(s),
  ...over,
});

describe('timeline', () => {
  it('messages and answers in time order, the viewer message before its answer', () => {
    const items = chatTimeline(
      [inMsg('m2', 5, '!slots'), inMsg('m1', 1, '!roulette 100')],
      [
        step('s2', 5, '@Alice 🍒 🍒 🍈 tu perds 20 Jetons 😳'),
        step('s1', 1, 'Alice gagne 100 Jetons…'),
      ],
    );
    expect(items.map((i) => i.key)).toEqual([
      'in:m1',
      'out:s1',
      'in:m2',
      'out:s2',
    ]);
  });

  it('re-reading the same data never duplicates; steps without text are not shown', () => {
    const inbox = [inMsg('m1', 1, 'a'), inMsg('m1', 1, 'a')];
    const steps = [
      step('s1', 2, 'x'),
      step('s1', 2, 'x'),
      step('s3', 3, '', { params: {} }),
    ];
    expect(chatTimeline(inbox, steps).map((i) => i.key)).toEqual([
      'in:m1',
      'out:s1',
    ]);
  });

  it('« Vider l’affichage » hides what came before, nothing else', () => {
    const items = chatTimeline(
      [inMsg('m1', 1, 'a'), inMsg('m2', 10, 'b')],
      [step('s1', 2, 'x')],
      T + 5000,
    );
    expect(items.map((i) => i.key)).toEqual(['in:m2']);
  });
});

describe('send states (never « envoyé » without Twitch’s proof)', () => {
  const SIMULATED = { label: 'Simulé · non envoyé sur Twitch', tone: 'off' };

  it('output OFF: an answer never taken reads « Simulé », queued or expired (Core keeps its status)', () => {
    expect(stepState(step('s', 0, 'x'), false, T)).toEqual(SIMULATED);
    expect(
      stepState(
        step('s', 0, 'x', { status: 'expired', attempt_count: 0 }),
        false,
        T,
      ),
    ).toEqual(SIMULATED);
    expect(
      stepState(step('s', 0, 'x', { status: 'expired' }), false, T),
    ).toEqual(SIMULATED);
  });

  it('a real failure is never hidden behind « Simulé »', () => {
    // Taken by the executor, then expired: a real failure, even with the output OFF now.
    expect(
      stepState(
        step('s', 0, 'x', { status: 'expired', attempt_count: 1 }),
        false,
        T,
      ).label,
    ).toBe('expiré · jamais envoyé');
    // Expired while the output is ON: the sending was supposed to work.
    expect(
      stepState(
        step('s', 0, 'x', { status: 'expired', attempt_count: 0 }),
        true,
        T,
      ).label,
    ).toBe('expiré · jamais envoyé');
    expect(
      stepState(step('s', 0, 'x', { status: 'failed' }), false, T).tone,
    ).toBe('bad');
    expect(
      stepState(step('s', 0, 'x', { status: 'unknown' }), false, T).tone,
    ).toBe('bad');
    // Already taken by the executor when the output went OFF: shown as it is.
    expect(
      stepState(step('s', 0, 'x', { status: 'claimed' }), false, T).label,
    ).toBe('envoi en cours');
  });

  it('output ON: waiting, sending, sent, expired, skipped, failed', () => {
    expect(stepState(step('s', 2, 'x'), true, T).label).toBe('envoi dans 2 s');
    expect(
      stepState(step('s', 0, 'x', { status: 'claimed' }), true, T).label,
    ).toBe('envoi en cours');
    expect(
      stepState(step('s', 0, 'x', { status: 'succeeded' }), true, T),
    ).toEqual({
      label: 'envoyé sur Twitch',
      tone: 'ok',
    });
    expect(
      stepState(step('s', 0, 'x', { status: 'expired' }), true, T).label,
    ).toBe('expiré · jamais envoyé');
    expect(
      stepState(
        step('s', 0, 'x', {
          status: 'skipped',
          error: { code: 'me_unsupported' },
        }),
        true,
        T,
      ).label,
    ).toBe('non envoyé (me_unsupported)');
    expect(
      stepState(step('s', 0, 'x', { status: 'failed' }), true, T).tone,
    ).toBe('bad');
  });
});

describe('conversation', () => {
  const html = chatView(
    chatTimeline(
      [
        inMsg('m1', 1, '!roulette 100', {
          handled: [{ module: 'mini_games', outcome: 'mini_game_played' }],
        }),
        inMsg('m2', 3, 'angle', {
          source: 'twitch',
          chatter: { id: '2', display_name: 'Bob', role: 'moderator' },
          handled: [{ module: 'word_game', outcome: 'word_game_win' }],
        }),
        inMsg('m3', 5, '!join', {
          handled: [{ module: 'raffle', outcome: 'joined' }],
        }),
        inMsg('m4', 7, '!lurk', {
          handled: [{ module: 'commands', outcome: 'accepted' }],
        }),
      ],
      [
        step(
          's1',
          1,
          'Alice gagne 100 Jetons à la roulette et possède maintenant 12100 Jetons ! 😎',
        ),
        step('s2', 3, 'Bob a trouvé le mot angle', {
          origin: 'word_game',
          mode: 'announce',
        }),
        step('s3', 7, 'Bon lurk !', {
          origin: 'commands',
          status: 'succeeded',
        }),
      ],
    ),
    false,
    T,
  );

  it('viewers with simulated / Twitch tags and role; the modules’ outcomes under each message', () => {
    expect(html).toContain('sc-src--sim');
    expect(html).toContain('<span class="sc-src sc-src--twitch">Twitch</span>');
    expect(html).toContain('<span class="sc-tag">modo</span>');
    expect(html).toContain('Mini-jeux : partie jouée');
    expect(html).toContain('Jeu des mots : mot trouvé');
    expect(html).toContain('Tombola : inscrit');
    expect(html).toContain('Commandes : acceptée');
  });

  it('LeCroupier_’s answers are Core’s texts, with their origin and their real send state', () => {
    expect(html).toContain(
      'Alice gagne 100 Jetons à la roulette et possède maintenant 12100 Jetons ! 😎',
    );
    expect(html).toContain(
      '<span class="sc-src sc-src--bot">Jeu des mots</span>',
    );
    expect(html).toContain('<span class="sc-src sc-src--bot">Commandes</span>');
    expect(html.match(/LeCroupier_/g)).toHaveLength(3);
    expect(html).toContain('Simulé · non envoyé sur Twitch');
    expect(html).toContain('title="Statut Core : queued"'); // the technical status stays readable
    expect(html).toContain('envoyé sur Twitch'); // the one Twitch acknowledged
  });

  it('chat text is escaped; empty conversation explains what to do', () => {
    expect(
      chatView(chatTimeline([inMsg('x', 1, '<img src=x>')], []), false, T),
    ).toContain('&lt;img src=x&gt;');
    expect(chatView([], false, T)).toContain('Aucun message');
  });
});
