import { describe, expect, it } from 'vitest';
import { feedHtml, mergeFeed } from '../../web/src/activity-feed.ts';

const label = (id: string) => id.toUpperCase();

describe('the Activité feed', () => {
  const items = mergeFeed(
    [
      {
        at: '2026-11-06T10:00:00Z',
        signal: 's',
        label: 'Bonk',
        kind: 'down',
        text: 'panne',
      },
    ],
    [
      {
        module_id: 'coffre_mystere',
        action: 'ouvrir',
        viewer: { display_name: 'Nina' },
        amount: 150,
        status: 'refunded',
        created_at: '2026-11-06T11:00:00Z',
      },
    ],
    [
      {
        created_at: '2026-11-06T09:00:00Z',
        actor: 'studio',
        module_id: null,
        action: 'set_staff',
        reason: null,
      },
    ],
    label,
  );

  it('merges the three sources, newest first, with where to read more', () => {
    expect(items.map((i) => i.kind)).toEqual([
      'module',
      'incident',
      'moderation',
    ]);
    expect(items[0]).toMatchObject({
      title: 'COFFRE_MYSTERE',
      text: 'Nina · ouvrir · 150 Jetons · remboursé',
      page: 'coffre-mystere',
    });
  });

  it('filters, and says what it could not read instead of showing an empty history', () => {
    const html = feedHtml(items, 'incident', (p) => `/?p=${p}`, [
      'audit de modération',
    ]);
    expect(html).toContain('Bonk');
    expect(html).not.toContain('Nina');
    expect(html).toContain('Non lu : audit de modération.');
  });

  it('escapes what comes from viewers', () => {
    const [x] = mergeFeed(
      [],
      [
        {
          module_id: 'a',
          action: 'b',
          viewer: { display_name: '<img src=x>' },
          amount: 0,
          status: 'done',
          created_at: '2026-11-06T11:00:00Z',
        },
      ],
      [],
      label,
    );
    expect(feedHtml([x!], 'all', (p) => p, [])).not.toContain('<img');
  });
});
