import type { LabActor } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { ModuleSettings } from '../src/module-settings/service.js';
import { COFFRE_SHOW_MS } from '../src/modules/coffre-mystere.js';
import { ModuleHost, PLAYER_LEASE_MS } from '../src/modules/host.js';
import type { ModuleDefinition } from '../src/modules/kit.js';
import { setup } from './helpers.js';

// Consolidation of the module host (review of 05/11): an OBS player's claim protects the action it shows from the expiry,
// one failing module never hides the others, a hung periodic job never stacks nor blocks the others, a moderator never
// refunds their own purchase. Fictional channel and viewers, Lab wallet.

const CH = '900341';
const V = { id: '900342', display_name: 'Viewer Fictif' };
const studio: LabActor = { id: 'studio', role: 'broadcaster', via: 'studio' };

async function lab() {
  const core = await setup();
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    V.id,
    'set',
    { tokens: 1_000 },
    'test',
  );
  await core.moduleSettings.set(CH, 'coffre_mystere.enabled', 1, 'test');
  let k = 0;
  const buy = () =>
    core.modules.viewer(CH, 'coffre_mystere', 'ouvrir', {
      viewer: V,
      idempotency_key: `intent-${++k}-robust`,
    });
  const tokens = async () =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, V.id],
        )
      )[0]!.tokens,
    );
  return { core, buy, tokens };
}

describe('module host — consolidation', () => {
  it('a claimed action is its player’s until the lease ends: shown late, never also refunded; an abandoned claim expires', async () => {
    const { core, buy, tokens } = await lab();
    const shown = (await buy()).activity.activity_id;
    core.clock.advance(COFFRE_SHOW_MS - 5_000);
    const claim = await core.modules.claim(CH, 'coffre_mystere', 'obs-a');
    expect(claim.items.map((i) => i.activity_id)).toEqual([shown]);
    expect(
      (await core.modules.claim(CH, 'coffre_mystere', 'obs-b')).items,
    ).toEqual([]); // never two players
    core.clock.advance(10_000); // past the expiry, inside the lease
    await core.modules.tick();
    // Another player cannot report it while obs-a's lease runs.
    await expect(
      core.modules.report(CH, 'coffre_mystere', {
        activity_id: shown,
        status: 'failed',
        player: 'obs-b',
      }),
    ).rejects.toMatchObject({ code: 'claimed_by_another_player' });
    const done = await core.modules.report(CH, 'coffre_mystere', {
      activity_id: shown,
      player: 'obs-a',
      status: 'done',
    });
    expect(done.activity.status).toBe('done');
    expect(await tokens()).toBe(900); // shown and paid: no refund
    // A player that died: once its lease is over, the expiry fails and refunds the action once.
    const lost = (await buy()).activity.activity_id;
    await core.modules.claim(CH, 'coffre_mystere', 'obs-a');
    core.clock.advance(COFFRE_SHOW_MS + PLAYER_LEASE_MS);
    await core.modules.tick();
    const rows = (await core.modules.activity(CH, { module: 'coffre_mystere' }))
      .items;
    expect(rows.find((r) => r.activity_id === lost)?.status).toBe('refunded');
    expect(await tokens()).toBe(900);
  });

  it('one failing module never hides the others (catalog) and a hung job never stacks nor holds the others back (tick)', async () => {
    const core = await setup();
    let ticks = 0;
    let release: () => void = () => {};
    const broken: ModuleDefinition = {
      id: 'casse_prix',
      label: 'Cassé',
      description: 'son prix échoue',
      category: 'outils',
      capabilities: ['viewer', 'wallet', 'live', 'history', 'moderation'],
      moderation: { visible: true, refund: 'never', note: 'test' },
      viewer: {
        payer: {
          label: 'Payer',
          price: async () => {
            throw new Error('prix illisible');
          },
          run: async () => ({ status: 'done', result: null }),
        },
      },
    };
    const hung: ModuleDefinition = {
      id: 'bloque',
      label: 'Bloqué',
      description: 'son travail périodique ne finit pas',
      category: 'outils',
      capabilities: ['tick'],
      tick: () => {
        ticks++;
        // Hangs the first time only (until released).
        return ticks === 1
          ? new Promise<void>((r) => (release = r))
          : Promise.resolve();
      },
    };
    let fine = 0;
    const healthy: ModuleDefinition = {
      id: 'sain',
      label: 'Sain',
      description: 'travaille normalement',
      category: 'outils',
      capabilities: ['tick'],
      tick: async () => {
        fine++;
      },
    };
    const host = new ModuleHost([broken, hung, healthy], {
      db: core.db,
      clock: core.clock,
      economy: labEconomy,
      settings: new ModuleSettings(core.db, core.clock),
    });
    const cat = (await host.catalog(CH)).modules;
    expect(cat.map((m) => m.id)).toEqual(['casse_prix', 'bloque', 'sain']);
    expect(cat[0]).toMatchObject({
      enabled: false,
      viewer: [],
      status: { observed: 'unknown' },
    });
    void host.tick(); // « bloque » hangs
    await new Promise((r) => setTimeout(r, 0)); // the healthy jobs of that pass finish
    await host.tick();
    await host.tick();
    expect(ticks).toBe(1); // never stacked
    expect(fine).toBe(3); // the others kept working
    release();
    await new Promise((r) => setTimeout(r, 0));
    await host.tick();
    expect(ticks).toBe(2);
  });

  it('a moderator refunds a viewer’s purchase with a reason, never their own (extension)', async () => {
    const { core, buy } = await lab();
    const bought = (await buy()).activity.activity_id;
    const self: LabActor = { id: V.id, role: 'moderator', via: 'extension' };
    await core.db
      .query(
        `insert into lab_staff (channel_id, viewer_id, role, grants) values ($1, $2, 'moderator', '{}')
       on conflict (channel_id, viewer_id) do update set role = 'moderator'`,
        [CH, V.id],
      )
      .catch(() => undefined);
    await expect(
      core.modules.refund(CH, {
        actor: self,
        activity_id: bought,
        reason: 'moi',
      }),
    ).rejects.toMatchObject({
      code: 'self_refund',
    });
    const out = await core.modules.refund(CH, {
      actor: studio,
      activity_id: bought,
      reason: 'jamais montré',
    });
    expect(out.refunded).toBe(100);
  });
});
