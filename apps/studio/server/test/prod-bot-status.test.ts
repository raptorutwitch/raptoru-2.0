// Centre de contrôle (lot 3), end to end on this machine: Studio in the Production profile reads the bot's status from
// a real Core server (HTTPS, paired installation credential) — the same path as core.raptoru.fr, nothing simulated
// between the provider and the Core's BotInstanceService.
import { afterEach, describe, expect, it } from 'vitest';
import { botStatusProvider } from '../src/control-center/bot.js';
import { pairedStudio, type Cleanups } from './prod-fixture.js';

const cleanups: Cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const lease = (instanceId: string, host: string) => ({
  instanceId,
  host,
  version: '45ae1c8',
  startedAt: new Date().toISOString(),
  health: {
    eventSubBot: true,
    eventSubBroadcaster: true,
    broadcasterToken: true,
  },
  flags: { CHAT_GAMES: true, ALERTS_MODE: 'active' },
});

describe('bot status through the Production transport', () => {
  it('Non suivi → Actif (VPS) → standby listed → Arrêté → Core down: Inconnu', async () => {
    const { core, net, client } = await pairedStudio(cleanups);
    const bot = botStatusProvider(client());

    expect(await bot.read()).toMatchObject({ state: 'Non suivi' });

    await core.botInstances.lease(lease('vps-abc-1', 'vps'));
    const active = await bot.read();
    expect(active).toMatchObject({ level: 'ok', state: 'Actif' });
    expect(active.summary).toContain('VPS Contabo');

    await core.botInstances.lease(lease('pc-AntoniPC-7', 'pc')); // refused: waits
    const both = await bot.read();
    expect(both.level).toBe('warn');
    expect(both.facts.some((f) => f.label === 'Instance en attente')).toBe(
      true,
    );

    await core.botInstances.release('vps-abc-1');
    core.clock.advance(3 * 60_000); // the waiting one gave up too
    expect(await bot.read()).toMatchObject({ level: 'off' });

    await net.down();
    expect(await bot.read()).toMatchObject({
      level: 'unknown',
      state: 'Inconnu',
    });
  });
});
