import { describe, expect, it } from 'vitest';
import { runNowConfirm } from '../../web/src/pages/rewards-model.ts';
import {
  automationHtml,
  cpBlocker,
  healthHtml,
  liveHtml,
} from '../../web/src/shell/regie.ts';
import { botStatusProvider } from '../src/control-center/bot.js';
import { readSignals } from '../src/supervision/signals.js';

// Refonte F1 — vérité des états : jamais de vert sur une intention seule, un échec Production visible, une action
// réelle jamais présentée comme un test.

const href = (id: string) => `/?p=${id}`;
const green = (html: string, text: string) =>
  new RegExp(`data-tone="ok"><i></i><span>[^<]*${text}`).test(html);

describe('Régie: intention ≠ constat', () => {
  it('channel points ON with OBS down: not green, the reason and the consequence', () => {
    const blocker = cpBlocker({ obs: { connected: false } });
    const html = automationHtml({ enabled: true, rules: 2, blocker });
    expect(html).toContain('OBS non connecté à Studio');
    expect(html).toContain('les actions OBS et les sons attendent');
    expect(green(html, 'Automatisations')).toBe(false);
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
    const ok = automationHtml({ enabled: true, rules: 1, blocker: null });
    expect(green(ok, 'Automatisations actives et exécutables')).toBe(true);
  });
  it('no incident says what is followed and what is not', () => {
    const html = healthHtml(
      { now: '', incidents: [], history: [] },
      true,
      href,
    );
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
          admission: 'AUTH_NOT_CONFIGURED',
          current: null,
          queue: 0,
        },
      },
      'production',
      href,
    );
    expect(html).not.toContain('data-tone="ok"');
    expect(html).toContain('Ouvert, lecteur absent');
    expect(html).toContain('File non lisible ici.');
    expect(html).toContain('Demandes refusées : Spotify non connecté à Studio');
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
    const { awardKey } = await import('../../web/src/pages/shop-model.ts');
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

describe('Alertes « Vider la file » (H3)', () => {
  it('offered in the Régie only when alerts wait, with its real scope', async () => {
    const { CLEAR_QUEUE_CONFIRM, LIVE_ACTIONS, clearedText } =
      await import('../../web/src/shell/regie.ts');
    const with3 = liveHtml(
      {
        tombola: 'none',
        alerts: { playing: 1, queued: 3, source: true },
        tts: 'off',
        spotify: null,
      },
      'production',
      href,
    );
    expect(with3).toContain('data-live="alerts-clear"');
    expect(with3).toContain('Plus jouée après 30 min');
    const none = liveHtml(
      {
        tombola: 'none',
        alerts: { playing: 0, queued: 0, source: true },
        tts: 'off',
        spotify: null,
      },
      'production',
      href,
    );
    expect(none).not.toContain('data-live="alerts-clear"');
    expect(LIVE_ACTIONS['alerts-clear']!.confirm).toBe(CLEAR_QUEUE_CONFIRM);
    expect(CLEAR_QUEUE_CONFIRM).toContain('Celle déjà en lecture se termine');
    expect(clearedText(2, 1)).toBe(
      '2 alerte(s) en attente retirée(s) · 1 déjà prise(s) par le lecteur : elle(s) se termine(nt) normalement.',
    );
  });
});

describe('Défis: the engine as it is (H16)', () => {
  it('off on purpose is not an outage; ON is green only with a recent good pass; absent sources said', async () => {
    const { engineState } = await import('../../web/src/challenges-model.ts');
    const now = Date.parse('2026-11-05T20:00:00Z');
    const ok = {
      status: 'done',
      started_at: '2026-11-05T19:59:30Z',
      finished_at: '2026-11-05T19:59:31Z',
    };
    const off = engineState({ enabled: false, every_s: 60 }, null, [], now);
    expect(off.text).toContain('Comptage automatique coupé');
    expect(off.tone).toBe('off');
    expect(engineState({ enabled: true, every_s: 60 }, ok, [], now).tone).toBe(
      'ok',
    );
    expect(
      engineState(
        { enabled: true, every_s: 60 },
        { ...ok, finished_at: '2026-11-05T19:40:00Z' },
        [],
        now,
      ).text,
    ).toContain('aucun passage récent');
    expect(
      engineState(
        { enabled: true, every_s: 60 },
        { ...ok, status: 'failed', error: 'boom' },
        [],
        now,
      ).tone,
    ).toBe('down');
    expect(
      engineState(undefined, null, [{ label: 'Daily', available: false }], now)
        .missing,
    ).toContain('Jamais comptés ici (source absente) : Daily');
  });
});

describe('Réglages des modules (H10 / H12) and Daily steps (H14) — views', () => {
  it('a setting shows its bounds and default, says when it was changed; unavailable Core said', async () => {
    const { settingsPanelHtml } =
      await import('../../web/src/module-settings.ts');
    const s = [
      {
        key: 'bonk.price',
        label: 'Prix d’un Bonk',
        unit: 'Jetons',
        value: 350,
        default: 200,
        min: 10,
        max: 100_000,
      },
      {
        key: 'bonk.cooldown_s',
        label: 'Délai',
        unit: 's',
        value: 0,
        default: 0,
        min: 0,
        max: 600,
      },
    ];
    const html = settingsPanelHtml('Prix et limites du Bonk', s, [
      'bonk.price',
      'bonk.cooldown_s',
    ]);
    expect(html).toContain('De 10 à 100');
    expect(html).toContain('par défaut 200 · <b>modifié</b>');
    expect(html).toContain('data-ms-save="bonk.cooldown_s"');
    expect(html).toContain(
      'Les probabilités et les gains ne se règlent pas ici',
    );
    expect(settingsPanelHtml('X', null, ['bonk.price'])).toContain(
      'Réglages indisponibles',
    );
  });
  it('Daily: one field per step, the last repeats, fixed reset time shown, never editable', async () => {
    const { dailyHtml } =
      await import('../../web/src/pages/progression-model.ts');
    const html = dailyHtml({
      steps: [500, 700, 900],
      default_steps: [500, 700, 900],
      bounds: { max_steps: 30, max_value: 20_000 },
      reset_time: '16:00 (heure de Paris)',
    });
    expect(html.match(/data-daily-step=/g)).toHaveLength(3);
    expect(html).toContain('3e stream et suivants');
    expect(html).toContain(
      'Remise à zéro fixe : <b>16:00 (heure de Paris)</b>',
    );
    expect(html).not.toContain('modifiés');
    expect(dailyHtml(null)).toContain('Paliers indisponibles');
  });
  it("the curve shown before « Appliquer » is the Core's formula; two dragged points stay within its limits", async () => {
    const { curveXp, fitCurve } =
      await import('../../web/src/pages/progression-model.ts');
    const { xpForLevel } =
      await import('../../../core-api/src/progression/service.ts');
    const rules = { curve_base: 60, curve_exponent: 1.6 };
    for (const level of [1, 2, 10, 42, 250])
      expect(curveXp(level, rules)).toBe(xpForLevel(level, rules as never));
    const fit = fitCurve({ level: 30, xp: 13_000 }, { level: 100, xp: 67_000 });
    expect(curveXp(100, fit)).toBeGreaterThan(66_000);
    expect(curveXp(100, fit)).toBeLessThan(68_000);
    const flat = fitCurve({ level: 30, xp: 5 }, { level: 100, xp: 5 });
    expect(flat.curve_exponent).toBeGreaterThanOrEqual(1);
    expect(flat.curve_base).toBeGreaterThanOrEqual(1);
  });
});
