import { describe, expect, it } from 'vitest';
import { randomBanView, rbError } from '../../web/src/random-ban-view.ts';

// Random Ban V2 — Studio section, pure view: names escaped, refund owed said (never claimed done), missing rights
// readable, the fixed rules shown, tests never presented as real.

const base = {
  rules: { duration_sub_s: 180, duration_non_sub_s: 300 },
  executor: {
    login: 'lecroupier_',
    can_search: true,
    can_timeout: false,
    missing: ['lecroupier_: moderator:manage:banned_users'],
  },
  recent: [],
  effects: {
    connected: true,
    audio: true,
    current: true,
    media: [{ id: 'rb-csc', label: 'Random Ban — CSC', available: false }],
  },
};
const row = (over) => ({
  request_id: 'r',
  source: 'channel_points',
  mode: 'real',
  buyer: { id: '1', name: 'Buyer' },
  status: 'confirmed',
  target: { id: '2', name: '<b>T</b>', is_sub: true },
  duration_s: 180,
  error: null,
  refund: 'none',
  stats: { chatters: 10, candidates: 6, follow_checks: 3 },
  animation: 'ban_rm_mirror',
  animation_status: 'completed',
  created_at: '2026-10-18T20:00:00.000Z',
  ...over,
});

describe('Random Ban view', () => {
  it('executor rights, missing media, rules, results with escaped names, refund owed, CSC, tests marked', () => {
    const html = randomBanView(
      {
        ...base,
        recent: [
          row({}),
          row({
            status: 'failed',
            error: 'Twitch 400 : may not be put in a timeout',
            refund: 'needed',
            animation: null,
            animation_status: 'none',
          }),
          row({
            status: 'uncertain',
            error: 'no_answer_after_timeout_request',
            refund: 'to_verify',
          }),
          row({
            target: { id: '1', name: 'Buyer', is_sub: false },
            duration_s: 300,
            animation: 'ban_csc',
          }),
          row({
            status: 'flop',
            target: null,
            duration_s: null,
            animation: 'flop',
          }),
          row({ mode: 'dry_run', status: 'simulated', source: 'test' }),
        ],
      },
      null,
    );
    expect(html).toContain('Timeouts par lecroupier_ : droit manquant');
    expect(html).toContain('moderator:manage:banned_users');
    expect(html).toContain('Médias non importés : Random Ban — CSC');
    expect(html).toContain('3 min pour un abonné, 5 min sinon');
    expect(html).toContain('&lt;b&gt;T&lt;/b&gt; · 3 min (abonné)');
    expect(html).not.toContain('<b>T</b>');
    expect(html).toContain('Rick &amp; Morty (miroir) — affichée');
    expect(html).toContain(
      '<b>Remboursement nécessaire</b> (non effectué : récompense créée par SAMMI)',
    );
    expect(html).toContain(
      '<b>Vérifier sur Twitch</b> avant tout remboursement',
    );
    expect(html).toContain('Buyer (CSC) · 5 min');
    expect(html).toContain('aucun follower éligible');
    expect(html).toContain('(à blanc)');
    expect(html).toContain('Tirage à blanc');
    expect(rbError('executor_absent')).toContain('exécuteur Twitch absent');
    expect(randomBanView({ ...base, executor: null }, null)).toContain(
      'Exécuteur Twitch : absent',
    );
  });
});
