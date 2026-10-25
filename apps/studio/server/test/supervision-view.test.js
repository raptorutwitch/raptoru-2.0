import { describe, expect, it } from 'vitest';
import {
  renderBanner,
  renderHistory,
} from '../../web/src/supervision-banner.ts';

describe('banner and history rendering', () => {
  const base = {
    id: 'i1',
    signal: 'soundboard',
    label: 'Soundboard',
    cause: 'player_offline',
    value: 'Lecteur absent',
    hint: 'Vérifier la source <b>',
    action: 'manual',
    startedAt: '2026-10-22T20:40:00Z',
    confirmedAt: '2026-10-22T20:40:30Z',
    acknowledged: false,
  };
  it('nothing to show → empty', () => {
    expect(
      renderBanner({ now: '2026-10-22T20:41:00Z', incidents: [], history: [] }),
    ).toBe('');
  });
  it('ongoing: alert, duration, action required, escaped hint, no « Vu »', () => {
    const html = renderBanner({
      now: '2026-10-22T20:52:30Z',
      incidents: [{ ...base, endedAt: null }],
      history: [],
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('12 min 30 s');
    expect(html).toContain('Action requise');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('data-sup-ack');
  });
  it('ended and not acknowledged: green with « Vu »; acknowledged: gone', () => {
    const ended = { ...base, endedAt: '2026-10-22T20:53:00Z' };
    expect(
      renderBanner({
        now: '2026-10-22T20:54:00Z',
        incidents: [ended],
        history: [],
      }),
    ).toContain('data-sup-ack="i1"');
    expect(
      renderBanner({
        now: '2026-10-22T20:54:00Z',
        incidents: [{ ...ended, acknowledged: true }],
        history: [],
      }),
    ).toBe('');
  });
  it('history: newest first, bounded, honest when empty', () => {
    expect(renderHistory([])).toContain('Aucune coupure');
    const h = Array.from({ length: 20 }, (_, i) => ({
      at: '2026-10-22T20:40:00Z',
      signal: 's',
      label: `M${i}`,
      kind: 'micro',
      text: 'microcoupure',
    }));
    expect(renderHistory(h).match(/<li/g)).toHaveLength(15);
  });
});
