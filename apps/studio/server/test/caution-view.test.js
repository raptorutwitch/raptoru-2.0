import { describe, expect, it } from 'vitest';
import {
  cautionDetail,
  cautionLocks,
  cautionOpen,
  cautionRow,
  toVerifyText,
} from '../../web/src/pages/sanctions-model.ts';

// Caution — Studio page, pure parts: names escaped, the Jetons' fate said plainly (debited / refunded / to verify,
// never « refunded » when it is not), missing rights readable, a test shown as a test.

const cautionView = (s) =>
  [
    cautionLocks(s),
    toVerifyText(s.to_verify),
    ...s.recent.map(cautionRow),
    ...s.recent.map(cautionDetail),
  ].join('');

const base = {
  executor: {
    login: 'lecroupier_',
    can_read: true,
    can_release: false,
    missing: ['lecroupier_: moderator:manage:banned_users'],
  },
  ready: true,
  to_verify: 0,
  recent: [],
};
const row = (over) => ({
  request_id: 'r1',
  status: 'released',
  mode: 'real',
  payer: { name: 'Viewer1' },
  target_input: 'viewer2',
  target: { name: 'Viewer2' },
  kind: 'timeout',
  price: 8000,
  reason: null,
  error: null,
  money: 'debited',
  created_at: '2026-10-23T20:00:00Z',
  ...over,
});

describe('Caution Studio section', () => {
  it('shows what the executor can do and the missing right', () => {
    const html = cautionView(base);
    expect(html).toContain('Lecture des bannis : prête');
    expect(html).toContain('Levées par lecroupier_ : droit manquant');
    expect(html).toContain('moderator:manage:banned_users');
  });

  it('says what happened to the Jetons, the « to verify » ones stand out', () => {
    const html = cautionView({
      ...base,
      to_verify: 1,
      recent: [
        row({}),
        row({
          request_id: 'r2',
          status: 'failed',
          reason: 'not_applied',
          money: 'refunded',
        }),
        row({
          request_id: 'r3',
          status: 'uncertain',
          money: 'to_verify',
          error: 'Twitch 503',
        }),
        row({
          request_id: 'r4',
          status: 'refused',
          reason: 'insufficient',
          money: 'none',
        }),
      ],
    });
    expect(html).toContain('1 caution(s) à vérifier');
    expect(html).toContain('8 000 jetons');
    expect(html).toContain('débité puis remboursé');
    expect(html).toContain(
      '<b>débité · À VÉRIFIER sur Twitch (aucun remboursement automatique)</b>',
    );
    expect(html).toContain('Jetons insuffisants');
    expect(html).toContain('aucun jeton débité');
  });

  it('escapes Twitch names and marks a simulator caution as a test', () => {
    const html = cautionView({
      ...base,
      recent: [
        row({
          mode: 'dry_run',
          payer: { name: '<img src=x>' },
          target: { name: '"x"' },
        }),
      ],
    });
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('sx-test">Test</i>');
  });
  it('a bot silent for 15 s or more is never shown « prête » (the Core refuses the caution)', () => {
    const html = cautionView({
      ...base,
      ready: false,
      executor: { ...base.executor, can_release: true, seen_ms_ago: 42_000 },
    });
    expect(html).toContain('aucun signal depuis 42 s');
    expect(html).not.toContain('prête');
    expect(html).not.toContain('autorisées');
    const fresh = cautionView({
      ...base,
      executor: { ...base.executor, seen_ms_ago: 3_000 },
    });
    expect(fresh).toContain('Lecture des bannis : prête');
  });
  it('a caution in progress is told apart from a finished one', () => {
    expect(cautionOpen(row({ status: 'quoted', money: 'none' }))).toBe(true);
    expect(cautionOpen(row({ status: 'releasing' }))).toBe(true);
    expect(cautionOpen(row({ status: 'released' }))).toBe(false);
    expect(cautionOpen(row({ status: 'uncertain' }))).toBe(false);
  });
});
