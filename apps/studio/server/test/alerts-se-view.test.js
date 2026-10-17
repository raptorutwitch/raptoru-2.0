import { describe, expect, it } from 'vitest';
import { seEntryView, seStatusView } from '../../web/src/alerts-se.ts';
import { activeLabel, twitchStatusView } from '../../web/src/alerts-twitch.ts';
import { sourceView } from '../../web/src/alerts-view.ts';

// Studio tab « Alertes », pure views of the real-event sections: donor texts always escaped, states readable.

const entry = (over = {}) => ({
  at: '2026-10-17T20:00:00.000Z',
  topic: 'channel.tips',
  tip_id: 't1',
  name: '<img src=x onerror=alert(1)>',
  amount: '4.2',
  currency: 'USD',
  message: '<script>x</script>',
  status: 'success',
  approved: 'allowed',
  decision: 'test',
  detail: 'mode TEST : non mis en file',
  ...over,
});

describe('Dons StreamElements views', () => {
  it('journal line: donor name and message escaped, decision readable', () => {
    const html = seEntryView(entry());
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('TEST · reçu');
    expect(html).toContain('4.2 USD');
    expect(seEntryView(entry({ name: null, message: null }))).toContain(
      'sans nom',
    );
  });

  it('status: account, state, refused topic, error and last tip', () => {
    const html = seStatusView(
      {
        mode: 'test',
        token: { present: true, type: 'apikey' },
        state: 'auth_failed',
        state_label: 'Jeton refusé par StreamElements : reconnecte ton compte.',
        room: null,
        topics: [
          {
            topic: 'channel.tips',
            subscribed: false,
            error: 'err_unauthorized',
          },
          { topic: 'channel.tips.moderation', subscribed: false, error: null },
        ],
        error: 'StreamElements refuse l’abonnement aux dons',
        last_event: entry({ decision: 'ignored', name: '<b>' }),
        journal: [],
      },
      null,
    );
    expect(html).toContain('Overlay Token');
    expect(html).toContain('al-error');
    expect(html).toContain('refusé (err_unauthorized)');
    expect(html).toContain('&lt;b&gt;');
    expect(seStatusView(null, 'boom <x>')).toContain('boom &lt;x&gt;');
  });

  it('Twitch section unchanged by it', () => {
    expect(
      twitchStatusView(
        {
          mode: 'off',
          ingestion_enabled: false,
          ingestion_running: false,
          token_login: null,
          follow_scope: true,
        },
        null,
      ),
    ).toContain('Follows : reçus');
  });

  it('environment and safety: ACTIVE names its Core, a resumed ACTIVE is said, Twitch unavailable in Production', () => {
    expect(activeLabel('lab')).toBe('ACTIVE · Core Lab');
    expect(activeLabel('production')).toBe('ACTIVE · Core production');
    const base = {
      mode: 'test',
      ingestion_enabled: true,
      ingestion_running: true,
      token_login: 'x',
      follow_scope: true,
    };
    expect(
      twitchStatusView({ ...base, resumed_from_active: true }, null),
    ).toContain('jamais repris automatiquement');
    expect(
      twitchStatusView(
        { ...base, environment: 'production', available: false },
        null,
      ),
    ).toContain('bot Twitch de production n’est pas encore raccordé');
    expect(
      seStatusView(
        {
          mode: 'test',
          token: { present: false, type: null },
          state: 'no_token',
          state_label: 'x',
          room: null,
          topics: [],
          error: null,
          last_event: null,
          journal: [],
          resumed_from_active: true,
        },
        null,
      ),
    ).toContain('jamais repris automatiquement');
  });

  it('OBS source line', () => {
    expect(
      sourceView({ source: { seen: false, ago_ms: null, current: null } }),
    ).toContain('Aucune source OBS');
    expect(
      sourceView({ source: { seen: false, ago_ms: 12000, current: true } }),
    ).toContain('silencieuse depuis 12 s');
    expect(
      sourceView({ source: { seen: true, ago_ms: 300, current: true } }),
    ).toContain('connectée, à jour');
    expect(
      sourceView({ source: { seen: true, ago_ms: 300, current: false } }),
    ).toContain('se rechargera seule');
  });
});
