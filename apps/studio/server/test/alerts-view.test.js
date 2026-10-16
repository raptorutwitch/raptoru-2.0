import { describe, expect, it } from 'vitest';
import {
  formView,
  PRESETS,
  previewData,
  queueView,
  testEvent,
} from '../../web/src/alerts-view.ts';
import { alertData } from '../../../core-api/src/alerts/rules.ts';
import { AlertEventInput } from '@raptoru/schemas';

// Twitch alerts V1 (A2) — Studio tab « Alertes », pure part: the fake data presets make valid Core events, the
// preview shows exactly the data Core would give the OBS source, and hostile viewer text is always escaped.

const TYPES = [
  'follow',
  'sub',
  'gift_community',
  'gift_targeted',
  'bits',
  'donation',
  'raid',
];

describe('fake data → test event / preview data', () => {
  it('every preset makes a valid Core event for every category, previewed like Core renders it', () => {
    for (const [name, preset] of Object.entries(PRESETS))
      for (const type of TYPES) {
        const ev = {
          channel_id: '900400',
          source: 'simulation',
          source_event_id: 'x',
          ...testEvent(type, preset.data),
        };
        const parsed = AlertEventInput.safeParse(ev);
        expect(parsed.success, `${name}/${type}`).toBe(true);
        expect(previewData(ev), `${name}/${type}`).toEqual(
          alertData(parsed.data),
        );
      }
  });

  it('anonymous gifts read « Un généreux anonyme »; amounts keep their decimals', () => {
    const anon = testEvent('gift_community', PRESETS.anonymous.data);
    expect(anon).toMatchObject({ anonymous: true, count: 5 });
    expect(anon.actor).toBeUndefined();
    expect(previewData(anon).pseudo).toBe('Un généreux anonyme');
    const don = testEvent('donation', {
      ...PRESETS.normal.data,
      amount: '12,5',
    });
    expect(don.amount).toEqual({
      value: 125,
      decimal_place: 1,
      currency: 'EUR',
    });
    expect(previewData(don)).toMatchObject({ amount: '12.5', currency: 'EUR' });
  });
});

describe('escaping', () => {
  it('hostile preset values never become markup in the form or the queue', () => {
    const hostile = PRESETS.hostile.data;
    const form = formView('donation', hostile);
    expect(form).not.toContain('<img');
    expect(form).not.toContain('<script');
    expect(form).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const queue = queueView(
      {
        in_flight: [],
        queued: [
          {
            alert_id: 'a',
            type: 'raid',
            variant_id: 'raid_default',
            data: { pseudo: hostile.pseudo },
            status: 'queued',
            attempts: 1,
            created_at: null,
            failure: { message: '<script>x</script>' },
          },
        ],
        recent: [],
        media: [],
        player_url: '',
        preview_url: '',
      },
      null,
    );
    expect(queue).not.toContain('<img');
    expect(queue).not.toContain('<script');
    expect(queue).toContain('En attente (1)');
  });
});
