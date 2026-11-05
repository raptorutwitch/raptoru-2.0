import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

// Supervision adapters of historical modules (architecture/MIGRATIONS.md): they only READ — never green on a switch or
// a deployment alone — and a module switched off is said off. Fictional channel.

const CH = '900351';

describe('status adapters (Random Ban, Jeu des mots, Boutique d’événement)', () => {
  it('Random Ban: waiting until its bot executor reports search + timeout rights; then ready', async () => {
    const core = await setup();
    expect(await core.modules.status(CH, 'random_ban')).toMatchObject({ intention: 'on', observed: 'waiting' });
    await core.randomBan.claim(CH, {
      executor_id: 'bot-1',
      login: 'lecroupier_',
      can_search: true,
      can_timeout: true,
      missing: [],
    });
    expect(await core.modules.status(CH, 'random_ban')).toMatchObject({ observed: 'ready', reasons: [] });
  });

  it('Jeu des mots: its own switch and the live, read from its service', async () => {
    const core = await setup();
    const s = await core.modules.status(CH, 'word_game');
    expect(s).toMatchObject({ intention: 'on', observed: 'waiting', reasons: ['Aucun live ouvert sur la chaîne.'] });
    await core.chat.wordGame.act(CH, { action: 'settings', enabled: false });
    expect(await core.modules.status(CH, 'word_game')).toMatchObject({ intention: 'off' }); // its own switch, read
  });

  it('Boutique d’événement: off by default; on without a ready overlay is waiting, never ready', async () => {
    const core = await setup();
    expect(await core.modules.status(CH, 'event_shop')).toMatchObject({ intention: 'off' });
    await core.db.query(
      `insert into event_shop_settings (channel_id, season, enabled, rules, updated_at) values ($1, 'halloween-2026', true, '{}', $2)`,
      [CH, core.clock.now()],
    );
    expect(await core.modules.status(CH, 'event_shop')).toMatchObject({ intention: 'on', observed: 'waiting' });
    await core.db.query(
      `insert into event_shop_studios (channel_id, studio_instance_id, engine_ready, media, seen_at) values ($1, 's1', true, '[]', $2)`,
      [CH, core.clock.now()],
    );
    expect(await core.modules.status(CH, 'event_shop')).toMatchObject({ observed: 'ready' });
    core.clock.advance(11_000);
    expect(await core.modules.status(CH, 'event_shop')).toMatchObject({ observed: 'waiting' });
  });
});
