import type { LabActor } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { ModuleSettings } from '../src/module-settings/service.js';
import { COFFRE_SHOW_MS } from '../src/modules/coffre-mystere.js';
import { ModuleHost } from '../src/modules/host.js';
import { MODULES } from '../src/modules/index.js';
import { checkModule, type ModuleDefinition } from '../src/modules/kit.js';
import { setup } from './helpers.js';
import { openCanonicalLive } from './live.js';

// The module host (architecture socle) and its two demonstrations: the shared path every module gets — catalog,
// settings, admin, viewer payment, idempotency, refusals before debit, journal, refund of the original debit, expiry,
// permissions. Lab test wallet, fictional channel and viewers.

const CH = '900321';
const V = { id: '900322', display_name: 'Viewer Fictif' };
const studio: LabActor = { id: 'studio', role: 'broadcaster', via: 'studio' };
const mod: LabActor = {
  id: '900323',
  role: 'moderator',
  via: 'extension',
  display_name: 'Modo Fictif',
};
const viewerActor: LabActor = { id: V.id, role: 'viewer', via: 'extension' };
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; message: string }) => e.code ?? e.message,
  );

async function lab(tokens = 1_000) {
  const core = await setup();
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    V.id,
    'set',
    { tokens },
    'test',
  );
  const host = core.modules;
  const tokensOf = async () =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, V.id],
        )
      )[0]!.tokens,
    );
  const open = (key: string, input: unknown = null) =>
    host.viewer(CH, 'coffre_mystere', 'ouvrir', {
      viewer: V,
      idempotency_key: key,
      input,
    });
  const enable = () =>
    core.moduleSettings.set(CH, 'coffre_mystere.enabled', 1, 'test');
  return { core, host, tokensOf, open, enable };
}

describe('module contract (automatic checks)', () => {
  it('every module of the list passes the checks; ids unique', () => {
    for (const m of MODULES) expect(checkModule(m), m.id).toEqual([]);
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
  });
  it('a lying declaration is refused: capability without implementation, paid action without moderation policy, bad id', () => {
    const bad: ModuleDefinition = {
      id: 'X bad',
      label: 'x',
      description: 'x',
      category: 'jeux',
      capabilities: ['admin', 'wallet', 'viewer'],
      viewer: {
        jouer: {
          label: 'Jouer',
          price: async () => 10,
          run: async () => ({ status: 'done', result: null }),
        },
      },
    };
    const p = checkModule(bad);
    expect(p).toContain('X bad: identifiant invalide');
    expect(p).toContain(
      'X bad: capacité « admin » déclarée sans implémentation',
    );
    expect(p).toContain(
      'X bad: actions viewer sans politique de modération explicite',
    );
    expect(p).toContain('X bad: « live » implémenté mais non déclaré');
    expect(p).toContain('X bad: « history » implémenté mais non déclaré');
  });
});

describe('démonstration A — Objectif de soirée (simple admin module)', () => {
  it('catalog, default setting, admin actions persisted across a restart, status from state and setting, history', async () => {
    const { core, host } = await lab();
    const cat = (await host.catalog(CH)).modules.find(
      (m) => m.id === 'objectif_soiree',
    )!;
    expect(cat).toMatchObject({
      lab_only: true,
      enabled: true,
      settings: ['objectif_soiree.cible'],
    });
    await host.admin(CH, 'objectif_soiree', 'ajouter', {
      actor: studio,
      input: { points: 30 },
    });
    await core.moduleSettings.set(CH, 'objectif_soiree.cible', 40, 'test');
    // A restarted Core (new host, same database) reads the same state.
    const again = new ModuleHost(MODULES, {
      db: core.db,
      clock: core.clock,
      economy: core.economy,
      settings: new ModuleSettings(core.db, core.clock),
    });
    await again.admin(CH, 'objectif_soiree', 'ajouter', {
      actor: studio,
      input: { points: 15 },
    });
    expect(await again.status(CH, 'objectif_soiree')).toMatchObject({
      observed: 'ready',
      summary: '45 / 40 points · objectif atteint',
    });
    expect(
      (await host.activity(CH, { module: 'objectif_soiree' })).items.map(
        (i) => [i.action, i.ended_by],
      ),
    ).toEqual([
      ['ajouter', 'studio'],
      ['ajouter', 'studio'],
    ]);
  });
  it('admin refused to a moderator (no permission declared = broadcaster only); invalid input refused', async () => {
    const { host } = await lab();
    expect(
      await code(
        host.admin(CH, 'objectif_soiree', 'ajouter', {
          actor: mod,
          input: { points: 1 },
        }),
      ),
    ).toMatch(/forbidden/);
    expect(
      await code(
        host.admin(CH, 'objectif_soiree', 'ajouter', {
          actor: studio,
          input: { points: 0 },
        }),
      ),
    ).toBe('invalid_points');
  });
});

describe('démonstration B — Coffre mystère (paid viewer module)', () => {
  it('OFF by default: refused before any debit; ON: paid once per intent (replay = first answer, other payload = conflict)', async () => {
    const t = await lab();
    expect(await code(t.open('k-0000001'))).toBe('module_disabled');
    expect(await t.tokensOf()).toBe(1_000);
    await t.enable();
    const first = await t.open('k-0000002');
    expect(first.activity).toMatchObject({
      status: 'queued',
      amount: 100,
      result: { item: 'clé fictive' },
    });
    expect((await t.open('k-0000002')).replayed).toBe(true);
    expect(await code(t.open('k-0000002', { autre: 1 }))).toBe(
      'idempotency_conflict',
    );
    expect(await t.tokensOf()).toBe(900);
  });
  it('insufficient Jetons, too many waiting, a blocked viewer: refused, nothing paid, nothing recorded', async () => {
    const t = await lab(150);
    await t.enable();
    await t.open('k-1000001');
    expect(await code(t.open('k-1000002'))).toBe('insufficient_tokens');
    await editWallet(
      t.core.db,
      t.core.clock.now(),
      CH,
      V.id,
      'set',
      { tokens: 1_000 },
      'test',
    );
    await t.open('k-1000003');
    expect(await code(t.open('k-1000004'))).toBe('too_many_waiting');
    expect(
      (await t.host.activity(CH, { module: 'coffre_mystere' })).items,
    ).toHaveLength(2);
    expect(await t.tokensOf()).toBe(900); // balance set to 1 000, then one chest
  });
  it('the fictional player shows it (done) or fails (refunded once, the original debit); expiry refunds once', async () => {
    const t = await lab();
    await t.enable();
    await t.open('k-2000001');
    await t.open('k-2000002');
    await t.host.admin(CH, 'coffre_mystere', 'lecteur_fictif', {
      actor: studio,
      input: {},
    });
    await t.host.admin(CH, 'coffre_mystere', 'lecteur_fictif', {
      actor: studio,
      input: { echec: true },
    });
    const items = (
      await t.host.activity(CH, { module: 'coffre_mystere' })
    ).items.filter((i) => i.action === 'ouvrir');
    expect(items.map((i) => i.status).sort()).toEqual(['done', 'refunded']);
    expect(await t.tokensOf()).toBe(900);
    await t.open('k-2000003');
    t.core.clock.advance(COFFRE_SHOW_MS + 1);
    await t.host.tick();
    await t.host.tick(); // twice: never refunded twice
    expect(await t.tokensOf()).toBe(900);
  });
  it('moderation: a moderator refunds the original debit once with a reason; a viewer cannot; audited', async () => {
    const t = await lab();
    await t.enable();
    const { activity } = await t.open('k-3000001');
    expect(
      await code(
        t.host.refund(CH, {
          actor: viewerActor,
          activity_id: activity.activity_id,
          reason: 'x',
        }),
      ),
    ).toMatch(/forbidden/);
    const r = await t.host.refund(CH, {
      actor: mod,
      activity_id: activity.activity_id,
      reason: 'coffre bloqué',
    });
    expect(r).toMatchObject({
      refunded: 100,
      activity: { status: 'refunded', ended_by: 'Modo Fictif' },
    });
    expect(
      await code(
        t.host.refund(CH, {
          actor: mod,
          activity_id: activity.activity_id,
          reason: 'encore',
        }),
      ),
    ).toBe('already_refunded');
    expect(await t.tokensOf()).toBe(1_000);
    const audit = await t.core.db.query(
      "select action from lab_moderation_audit where action = 'coffre_mystere.refund'",
    );
    expect(audit).toHaveLength(1);
  });
  it('viewer state: availability and price from the server (never a purchase it cannot honour), own history', async () => {
    const t = await lab();
    expect(
      (await t.host.viewerState(CH, 'coffre_mystere', V)).actions[0],
    ).toMatchObject({
      available: false,
      unavailable_reason: 'module_disabled',
      price: 100,
    });
    await t.enable();
    await t.core.moduleSettings.set(CH, 'coffre_mystere.prix', 250, 'test');
    await t.open('k-4000001');
    const s = await t.host.viewerState(CH, 'coffre_mystere', V);
    expect(s.actions[0]).toMatchObject({ available: true, price: 250 });
    expect(s.recent).toHaveLength(1);
    expect(await t.tokensOf()).toBe(750);
  });
});

describe('the host on the canonical economy (Production)', () => {
  const sample: ModuleDefinition = {
    id: 'echantillon',
    label: 'Échantillon',
    description: 'Module payant d’essai (tests).',
    category: 'jeux',
    capabilities: [
      'viewer',
      'wallet',
      'live',
      'history',
      'moderation',
      'settings',
    ],
    settings: {
      prix: { label: 'Prix', unit: 'Jetons', default: 50, min: 1, max: 1_000 },
    },
    moderation: { visible: true, refund: 'never', note: 'test' },
    viewer: {
      jouer: {
        label: 'Jouer',
        price: (ctx, q, ch) => ctx.setting(q, ch, 'prix'),
        run: async () => ({ status: 'done', result: null }),
      },
    },
  };
  it('Lab-only modules are not mounted; a paid action follows the canonical live (H1); refund policy « never » respected', async () => {
    const core = await setup();
    const economy = coreWalletEconomy(core.wallet.wallet);
    const settings = new ModuleSettings(core.db, core.clock);
    const host = new ModuleHost([...MODULES, sample], {
      db: core.db,
      clock: core.clock,
      economy,
      settings,
    });
    expect(host.ids).toEqual(['echantillon']);
    await settings.set(CH, 'echantillon.enabled', 1, 'test');
    await core.wallet.wallet.credit({
      key: 'fund-mod-1',
      viewer: {
        twitchUserId: V.id,
        login: 'fictif',
        displayName: V.display_name,
      },
      amount: 500,
      source: 'test',
    });
    const play = (k: string) =>
      host.viewer(CH, 'echantillon', 'jouer', {
        viewer: V,
        idempotency_key: k,
      });
    expect(await code(play('c-0000001'))).toBe('stream_offline');
    await openCanonicalLive(core.db, core.clock);
    const { activity } = await play('c-0000002');
    expect((await core.wallet.wallet.getWallet(V.id))!.balance).toBe(450);
    expect(
      await code(
        host.refund(CH, {
          actor: mod,
          activity_id: activity.activity_id,
          reason: 'x',
        }),
      ),
    ).toBe('refund_not_allowed');
  });
});
