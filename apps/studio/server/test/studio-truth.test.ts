import { describe, expect, it } from 'vitest';
import { runNowConfirm } from '../../web/src/channel-points-view.ts';
import { cpBlocker, liveHtml, regieHtml } from '../../web/src/shell/regie.ts';
import { botStatusProvider } from '../src/control-center/bot.js';
import { readSignals } from '../src/supervision/signals.js';

// Refonte F1 — vérité des états : jamais de vert sur une intention seule, un échec Production visible, une action
// réelle jamais présentée comme un test.

const href = (id: string) => `/?p=${id}`;
const green = (html: string, text: string) =>
  new RegExp(`class="rs-state is-ok">[^<]*${text}`).test(html);

describe('Régie: intention ≠ constat', () => {
  it('channel points ON with OBS down: not green, the reason and the consequence', () => {
    const blocker = cpBlocker({ obs: { connected: false } });
    const html = regieHtml({
      sup: null,
      supOk: true,
      cp: { enabled: true, rules: 2, blocker },
      message: '',
      href,
    });
    expect(html).toContain('OBS non connecté à Studio');
    expect(html).toContain('les actions OBS et les sons attendent');
    expect(html).not.toContain('rs-state is-ok">Automatisations');
  });
  it('channel points ON and executable: green; effects player absent: not green', () => {
    expect(
      cpBlocker({
        obs: { connected: true },
        effects: { connected: true, audio: true },
      }),
    ).toBeNull();
    expect(
      cpBlocker({ obs: { connected: true }, effects: { connected: false } }),
    ).toBe('lecteur d’effets absent');
    const ok = regieHtml({
      sup: null,
      supOk: true,
      cp: { enabled: true, rules: 1, blocker: null },
      message: '',
      href,
    });
    expect(green(ok, 'Automatisations actives et exécutables')).toBe(true);
  });
  it('no incident says what is followed and what is not', () => {
    const html = regieHtml({
      sup: { now: '', incidents: [], history: [] },
      supOk: true,
      cp: null,
      message: '',
      href,
    });
    expect(html).toContain('Aucun incident sur les éléments suivis');
    expect(html).toContain('Non suivis ici');
    expect(html).not.toContain('Aucun incident confirmé en cours.');
  });
  it('queues: unknown alert source, absent TTS player, Spotify not connected are never green', () => {
    const html = liveHtml(
      {
        tombola: 'none',
        alerts: { playing: 0, queued: 0, source: null },
        tts: {
          state: 'active',
          current: null,
          waiting: null,
          ready: false,
        },
        spotify: {
          admission: 'open',
          current: null,
          queue: 0,
          connected: false,
        },
      },
      'production',
      href,
    );
    expect(html).not.toContain('is-ok');
    expect(html).toContain('Activé, lecteur absent');
    expect(html).toContain('File non lisible ici.');
    expect(html).toContain('Spotify n’est pas connecté à Studio');
  });
});

describe('Échec du profil Production (P0-7)', () => {
  it('start_failed is a manual incident of the link, never « nothing runs »', () => {
    const [s] = readSignals(
      {
        link: { state: 'start_failed', detail: 'journal d’un autre profil' },
        tts: null,
        sound: null,
        bonk: null,
      },
      Date.now(),
    );
    expect(s).toMatchObject({
      id: 'core-link',
      level: 'error',
      cause: 'start_failed',
      action: 'manual',
    });
  });
  it('the bot tile reads « unknown » with the cause, not « Profil Lab »', async () => {
    const s = await botStatusProvider(null, undefined, 'boom').read();
    expect(s.level).toBe('unknown');
    expect(s.summary).toContain('profil Production n’a pas démarré');
    expect(s.facts[0]).toMatchObject({ value: 'boom' });
    const lab = await botStatusProvider(null).read();
    expect(lab.summary).toContain('Profil Lab');
  });
});

describe('« Exécuter maintenant (réel) » (H11)', () => {
  it('lists each action as real or dry', () => {
    const text = runNowConfirm([
      { type: 'obs_scene', scene: 'Fictive' },
      { type: 'credits', currency: 'credits_tts', amount: 2 },
      { type: 'interaction', interaction: 'random_ban' },
    ]);
    expect(text).toContain('Passer sur la scène « Fictive » : RÉEL');
    expect(text).toContain('à blanc (aucun crédit versé)');
    expect(text).toContain('à blanc (vraie recherche Twitch, aucun timeout)');
  });
});

describe('« Donner » (Boutique): one key per intent (P0-2)', () => {
  it('same intent and gift → same key; another viewer, item or intent → another', async () => {
    const { awardKey } = await import('../../web/src/cosmetics.ts');
    const g = { kind: 'jetons', amount: 500 };
    const k = awardKey('11111111-1111-4111-8111-111111111111', '4242', g);
    expect(awardKey('11111111-1111-4111-8111-111111111111', '4242', g)).toBe(k);
    expect(k.length).toBeLessThanOrEqual(120);
    expect(
      awardKey('11111111-1111-4111-8111-111111111111', '4243', g),
    ).not.toBe(k);
    expect(
      awardKey('11111111-1111-4111-8111-111111111111', '4242', {
        kind: 'jetons',
        amount: 501,
      }),
    ).not.toBe(k);
    expect(
      awardKey('22222222-2222-4222-8222-222222222222', '4242', g),
    ).not.toBe(k);
  });
});
