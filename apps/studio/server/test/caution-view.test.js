import { describe, expect, it } from 'vitest';
import { cautionView } from '../../web/src/caution-view.ts';

// Caution — Studio section, pure view: names escaped, the Jetons' fate said plainly (debited / refunded / to verify,
// never « refunded » when it is not), missing rights readable, a test shown as a test.

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
    const html = cautionView(base, null);
    expect(html).toContain('Lecture des bannis : prête');
    expect(html).toContain('Levées par lecroupier_ : droit manquant');
    expect(html).toContain('moderator:manage:banned_users');
    expect(html).toContain('Aucune caution.');
  });

  it('says what happened to the Jetons, the « to verify » ones stand out', () => {
    const html = cautionView(
      {
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
      },
      null,
    );
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
    const html = cautionView(
      {
        ...base,
        recent: [
          row({
            mode: 'dry_run',
            payer: { name: '<img src=x>' },
            target: { name: '"x"' },
          }),
        ],
      },
      null,
    );
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('<i>Test</i>');
  });
});
