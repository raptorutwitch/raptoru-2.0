import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_CONFIG,
  loadDailyConfig,
  saveDailySteps,
} from '../src/daily/config.js';
import {
  MODULE_SETTINGS,
  ModuleSettings,
} from '../src/module-settings/service.js';
import { setup } from './helpers.js';

// Refonte H10 / H12 / H14 — module settings and Daily steps: today's values by default, bounds enforced by the Core
// whatever Studio sends, persisted, never the odds nor the prize tables. Fictional channel.

const CH = '900555';

describe('module settings', () => {
  it('defaults are what the Core applies today; persisted across a restart (new instance)', async () => {
    const core = await setup();
    const s = new ModuleSettings(core.db, core.clock);
    const list = await s.list(CH);
    expect(Object.fromEntries(list.map((x) => [x.key, x.value]))).toEqual({
      'random_ban.price': 25_000,
      'fx_cam.price': 1_500,
      'bonk.price': 200,
      'bonk.cooldown_s': 0,
    });
    await s.set(CH, 'random_ban.price', 30_000, 'test');
    const again = new ModuleSettings(core.db, core.clock);
    expect(await again.get(core.db, CH, 'random_ban.price')).toBe(30_000);
    expect(await again.get(core.db, '900556', 'random_ban.price')).toBe(25_000); // per channel
  });
  it('refused: below / above bounds, not an integer, unknown key (never odds or prize tables)', async () => {
    const core = await setup();
    const s = new ModuleSettings(core.db, core.clock);
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );
    const b = MODULE_SETTINGS['bonk.price'];
    expect(await code(s.set(CH, 'bonk.price', b.min - 1, 't'))).toBe(
      'out_of_bounds',
    );
    expect(await code(s.set(CH, 'bonk.price', b.max + 1, 't'))).toBe(
      'out_of_bounds',
    );
    expect(await code(s.set(CH, 'bonk.price', 250.5, 't'))).toBe(
      'out_of_bounds',
    );
    expect(await code(s.set(CH, 'bonk.price', '250', 't'))).toBe(
      'out_of_bounds',
    );
    expect(await code(s.set(CH, 'roulette.win_chance', 90, 't'))).toBe(
      'unknown_setting',
    );
    expect(await s.get(core.db, CH, 'bonk.price')).toBe(200);
  });
  it('!rb really charges the new price (the chat reader is the settings)', async () => {
    const core = await setup();
    await core.moduleSettings.set(CH, 'random_ban.price', 12_000, 'test');
    expect(await core.moduleSettings.chatPrices().price(CH, 'random_ban')).toBe(
      12_000,
    );
    expect(await core.moduleSettings.chatPrices().price(CH, 'fx_cam')).toBe(
      1_500,
    );
  });
});

describe('Daily steps (H14)', () => {
  it('saved, read back, bounded; a decreasing or oversized table refused; nothing stored on refusal', async () => {
    const core = await setup();
    expect(await loadDailyConfig(core.db)).toEqual(DEFAULT_DAILY_CONFIG);
    await saveDailySteps(core.db, [600, 800, 1000]);
    expect((await loadDailyConfig(core.db)).reward.steps).toEqual([
      600, 800, 1000,
    ]);
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );
    expect(await code(saveDailySteps(core.db, [800, 600]))).toBe(
      'invalid_steps',
    );
    expect(await code(saveDailySteps(core.db, []))).toBe('invalid_steps');
    expect(await code(saveDailySteps(core.db, [20_001]))).toBe('invalid_steps');
    expect(await code(saveDailySteps(core.db, Array(31).fill(100)))).toBe(
      'invalid_steps',
    );
    expect((await loadDailyConfig(core.db)).reward.steps).toEqual([
      600, 800, 1000,
    ]);
  });
});
