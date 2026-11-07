import { describe, expect, it } from 'vitest';
import {
  confirmFor,
  simButton,
  simPanel,
  simStates,
  writesRealChat,
} from '../../web/src/simulation-view.ts';

// Studio Lab — « Simulation de stream » panel: effective states of the existing services, their buttons,
// and the confirmation before anything that would make LeCroupier_ write in the real chat.

const ALL_OFF = {
  stream: null,
  ingress: {
    enabled: false,
    running: false,
    blocked: null,
    token_login: 'lecroupier_',
  },
  output: { enabled: false, write_scope: true, executor_absent: true },
};
const button = (html, action) =>
  new RegExp(`<button[^>]*data-sim="${action}"[^>]*>([^<]*)</button>`).exec(
    html,
  )?.[1];

describe('states', () => {
  it('everything off: grey dots, nothing about the real chat, the « on » buttons', () => {
    expect(simStates(ALL_OFF).map((s) => s.tone)).toEqual([
      'off',
      'off',
      'off',
    ]);
    const html = simPanel(ALL_OFF);
    expect(html).not.toContain('Écrit dans le vrai chat');
    expect(button(html, 'stream_start')).toBe('Démarrer');
    expect(button(html, 'ingress_on')).toBe('Activer');
    expect(button(html, 'output_on')).toBe('Activer');
    expect(html).not.toContain('Mini-jeux');
    expect(writesRealChat(ALL_OFF)).toBe(false);
  });

  it('everything on: live (simulation), chat connected, output warns', () => {
    const s = {
      stream: { source: 'simulated', started_at: '2026-10-16T19:05:00.000Z' },
      ingress: {
        enabled: true,
        running: true,
        blocked: null,
        token_login: 'lecroupier_',
      },
      output: { enabled: true, write_scope: true, executor_absent: false },
    };
    expect(simStates(s).map((x) => x.tone)).toEqual(['on', 'on', 'warn']);
    const html = simPanel(s);
    expect(html).toContain('En direct (simulation) depuis');
    expect(html).toContain('Activée · connectée (lecroupier_)');
    expect(html).toContain('Activée · écrit dans le vrai chat');
    expect(html).toContain('Écrit dans le vrai chat');
    expect(button(html, 'stream_end')).toBe('Terminer');
    expect(button(html, 'ingress_off')).toBe('Désactiver');
    expect(button(html, 'output_off')).toBe('Désactiver');
  });

  it('a real Twitch live cannot be ended from Studio; ingestion starting shows « démarrage »', () => {
    const html = simPanel({
      ...ALL_OFF,
      stream: { source: 'twitch', started_at: '2026-10-16T19:05:00.000Z' },
      ingress: {
        enabled: true,
        running: false,
        blocked: null,
        token_login: null,
      },
    });
    expect(html).toContain('En direct (Twitch)');
    expect(button(html, 'stream_end')).toBeUndefined();
    expect(html).toContain('Activée · démarrage…');
  });

  it('unavailable services (Production profile / no Lab Core) show as such, without buttons', () => {
    const html = simPanel({
      stream: undefined,
      ingress: null,
      output: null,
    });
    expect(html).toContain('Indisponible (profil Lab uniquement)');
    expect(html.match(/data-sim="/g)).toBeNull();
    expect(
      simStates({ ingress: null, output: null }).map((s) => s.tone),
    ).toEqual(['na', 'na', 'na']);
  });

  it('busy disables the buttons; errors and the ingestion block message are escaped', () => {
    expect(simPanel(ALL_OFF, true)).toMatch(/data-sim="output_on" disabled/);
    const html = simPanel(
      {
        ...ALL_OFF,
        ingress: {
          enabled: false,
          running: false,
          blocked: { message: '<b>jeton</b>' },
          token_login: null,
        },
      },
      false,
      '<i>refus</i>',
    );
    expect(html).toContain('&lt;b&gt;jeton&lt;/b&gt;');
    expect(html).toContain('&lt;i&gt;refus&lt;/i&gt;');
    expect(button(html, 'ingress_on')).toBeUndefined();
  });

  it('the sidebar entry: a link to the page, one dot per service, the live said', () => {
    const html = simButton(ALL_OFF);
    expect(html).toContain('data-page="simulation"');
    expect(html.match(/sim-dot--off/g)).toHaveLength(3);
    expect(simButton(null)).toContain('Simulation');
    expect(
      simButton({
        ...ALL_OFF,
        stream: { source: 'simulated', started_at: '2026-10-16T19:05:00.000Z' },
      }),
    ).toContain('Live fictif en cours');
  });
});

describe('confirmations (writing in the real chat)', () => {
  it('turning the real output on always asks', () => {
    expect(confirmFor('output_on', ALL_OFF)).toContain('VRAI chat');
  });

  it('output off: starting a live or the ingestion asks nothing', () => {
    for (const a of ['stream_start', 'ingress_on', 'output_off', 'stream_end'])
      expect(confirmFor(a, ALL_OFF)).toBeNull();
  });

  it('output on: live and ingestion ask; turning things off never asks', () => {
    const s = { ...ALL_OFF, output: { enabled: true } };
    for (const a of ['stream_start', 'ingress_on'])
      expect(confirmFor(a, s)).toContain('VRAI chat');
    for (const a of ['stream_end', 'ingress_off', 'output_off'])
      expect(confirmFor(a, s)).toBeNull();
  });
});
