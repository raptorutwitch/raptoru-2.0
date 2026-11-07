import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hostModules,
  loadHostModules,
  registerSessionModule,
  registerViewerModule,
  resetHostModulesForTests,
  sessionModule,
  sessionModules,
  viewerModuleView,
} from '../extension/shared/module-registry.js';
import {
  createIntent,
  createPurchaseButton,
  isRetryable,
} from '../extension/shared/purchase.js';
import { coffreHistoryHtml } from '../extension/shared/coffre-mystere.js';
import { moduleJournalHtml } from '../extension/shared/module-moderation.js';

// Architecture socle, extension side: the registry (server-listed AND known modules only), the purchase per intent
// (one key until the server decided), the demo view's pure part. A tiny fake DOM: no browser needed.

function fakeDocument() {
  const make = (tag) => {
    const n = {
      tag,
      children: [],
      listeners: {},
      className: '',
      textContent: '',
      disabled: false,
      append: (...c) => n.children.push(...c),
      addEventListener: (type, fn) => (n.listeners[type] = fn),
    };
    return n;
  };
  return { createElement: make };
}

describe('viewer module registry', () => {
  beforeEach(() => resetHostModulesForTests());
  it('shows only the modules the server lists AND this build knows; an older server shows none', async () => {
    registerViewerModule('coffre_mystere', () => ({}), { icon: '🎁' });
    registerViewerModule('inconnu_du_serveur', () => ({}));
    registerViewerModule('coupe', () => ({})); // known, but switched off on the server (older server listing it)
    let redraws = 0;
    await loadHostModules(
      {
        moduleCatalog: async () => ({
          modules: [
            {
              id: 'coffre_mystere',
              label: 'Coffre',
              description: 'd',
              enabled: true,
              actions: [],
            },
            {
              id: 'pas_de_vue_ici',
              label: 'X',
              description: 'd',
              enabled: true,
              actions: [],
            },
            {
              id: 'coupe',
              label: 'Coupé',
              description: 'd',
              enabled: false,
              actions: [],
            },
          ],
        }),
      },
      () => redraws++,
      1_000_000,
    );
    expect(hostModules().map((m) => [m.id, m.icon, m.host])).toEqual([
      ['coffre_mystere', '🎁', true],
    ]);
    expect(redraws).toBe(1);
    expect(viewerModuleView('pas_de_vue_ici')).toBeNull();
    resetHostModulesForTests();
    await loadHostModules({}, () => redraws++); // no moduleCatalog: older client / server
    expect(hostModules()).toEqual([]);
  });
});

describe('purchase per intent', () => {
  it('one key until the server decided: kept after a network failure, new after a success or a final refusal', () => {
    const i = createIntent();
    const k1 = i.key();
    expect(i.key()).toBe(k1);
    i.close();
    expect(i.key()).not.toBe(k1);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ code: 'timeout' })).toBe(true);
    expect(isRetryable({ status: 409, code: 'insufficient_tokens' })).toBe(
      false,
    );
  });
  it('two taps, never two sends in parallel; a timeout retried with the SAME key; a success closes the intent', async () => {
    const keys = [];
    const prices = [];
    let fail = true;
    const results = [];
    const btn = createPurchaseButton({
      document: fakeDocument(),
      run: async (key, price) => {
        keys.push(key);
        prices.push(price);
        if (fail)
          throw Object.assign(new Error('timeout'), { code: 'timeout' });
        return { ok: true };
      },
      onResult: (r) => results.push(r.ok),
    });
    btn.update({ label: 'Ouvrir', price: 100, available: true });
    const button = btn.node.children[0];
    const click = () => button.listeners.click();
    await click(); // first tap: price shown, nothing sent
    expect(keys).toEqual([]);
    expect(button.textContent).toBe('Confirmer (100 Jetons) ?');
    const p = click();
    await click(); // double click while sending: ignored
    await p;
    await click();
    fail = false;
    await click(); // retry after the timeout
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(results).toEqual([false, true]);
    expect(prices).toEqual([100, 100]); // the confirmed price travels with the intent (the server refuses a change)
    await click();
    await click();
    expect(keys[2]).not.toBe(keys[0]);
  });
  it('unavailable from the server: disabled, the reason in words', () => {
    const btn = createPurchaseButton({
      document: fakeDocument(),
      run: async () => ({}),
    });
    btn.update({
      label: 'Ouvrir',
      price: 100,
      available: false,
      reason: 'stream_offline',
    });
    expect(btn.node.children[0].disabled).toBe(true);
    expect(btn.node.children[1].textContent).toContain('pendant le live');
  });
});

describe('Coffre mystère (démonstration B) — viewer history', () => {
  it('escapes and says each state', () => {
    expect(coffreHistoryHtml([])).toContain('Aucun coffre');
    const html = coffreHistoryHtml([
      { status: 'queued', result: { item: '<b>clé</b>' } },
      { status: 'refunded', result: { item: 'plume' } },
    ]);
    expect(html).toContain('&lt;b&gt;clé&lt;/b&gt;');
    expect(html).toContain('en route vers le stream');
    expect(html).toContain('remboursé');
  });
});

describe('module moderation panel (host, generic)', () => {
  const rows = [
    {
      activity_id: 'a1',
      viewer: { display_name: '<i>Zoé</i>' },
      action: 'ouvrir',
      amount: 100,
      status: 'queued',
    },
    {
      activity_id: 'a2',
      viewer: { display_name: 'Max' },
      action: 'ouvrir',
      amount: 100,
      status: 'refunded',
      reason: 'test',
    },
    {
      activity_id: 'a3',
      viewer: null,
      action: 'ajouter',
      amount: 0,
      status: 'done',
    },
  ];
  it('a refund button only on a paid, not yet refunded row, and only when the policy allows it', () => {
    const html = moduleJournalHtml(rows, { refund: 'moderator' });
    expect(html.match(/data-refund=/g)).toHaveLength(1);
    expect(html).toContain('data-refund="a1"');
    expect(html).toContain('&lt;i&gt;Zoé&lt;/i&gt;');
    expect(html).toContain('« test »');
    expect(moduleJournalHtml(rows, { refund: 'never' })).not.toContain(
      'data-refund',
    );
    expect(moduleJournalHtml([], { refund: 'moderator' })).toContain(
      'Rien dans le journal',
    );
  });
});

describe('session modules (registered by their own files, no branch in ui.js)', () => {
  beforeEach(() => resetHostModulesForTests());
  it('keeps the registration order; availability and card come from the module, never from ui.js', () => {
    registerSessionModule({
      id: 'a',
      card: () => ({ id: 'a' }),
      available: ({ state }) => state.a === true,
      view: () => ({}),
    });
    registerSessionModule({
      id: 'b',
      card: (state) => ({ id: 'b', label: state.title }),
      available: () => true,
      hubFirst: true,
      view: () => ({}),
    });
    expect(sessionModules().map((m) => m.id)).toEqual(['a', 'b']);
    expect(sessionModule('a').available({ state: { a: false } })).toBe(false);
    expect(sessionModule('b').card({ title: 'Halloween' })).toEqual({
      id: 'b',
      label: 'Halloween',
    });
    expect(sessionModule('inconnu')).toBeNull();
  });
});

describe('the real session modules register themselves', () => {
  it('Commandes (no intro, not in the Panel), Roue du Sub (team flag), Événements (first, edition title)', async () => {
    // Fresh module instances: the views register into the registry instance read below (ui.js's import order).
    vi.resetModules();
    const reg = await import('../extension/shared/module-registry.js');
    await import('../extension/shared/commands-public.js');
    await import('../extension/shared/sub-wheel-ext.js');
    await import('../extension/shared/events-shop.js');
    const { sessionModule, sessionModules } = reg;
    expect(sessionModules().map((m) => m.id)).toEqual([
      'commands',
      'sub_wheel',
      'event_shop',
    ]);
    const doc = (panel) => ({
      body: { classList: { contains: (c) => panel && c === 'panel-view' } },
    });
    const cmd = sessionModule('commands');
    expect(cmd.intro).toBe(false);
    expect(cmd.bodyData).toEqual({ cmdPub: '1' });
    expect(
      cmd.available({
        state: { commands_public: true },
        client: { commandsPublic() {} },
        document: doc(false),
      }),
    ).toBe(true);
    expect(
      cmd.available({
        state: { commands_public: true },
        client: { commandsPublic() {} },
        document: doc(true),
      }),
    ).toBe(false);
    expect(
      sessionModule('sub_wheel').available({
        state: { sub_wheel: true },
        client: {},
      }),
    ).toBe(false); // older client
    const shop = sessionModule('event_shop');
    expect(shop.hubFirst).toBe(true);
    expect(
      shop.card({ event_shop: { edition: { title: 'Halloween 2026' } } })
        .description,
    ).toContain('Halloween 2026');
    expect(
      shop.available({
        state: { event_shop: { enabled: false } },
        client: { eventsState() {} },
      }),
    ).toBe(false);
  });
});

describe('module variants (TTS V2, Tombola V2 take over their module when the session says so)', () => {
  it('the real variants register themselves and match only when the session offers them', async () => {
    vi.resetModules();
    const reg = await import('../extension/shared/module-registry.js');
    await import('../extension/shared/tts-v2.js');
    await import('../extension/shared/tombola-v2.js');
    const env = (module, client = {}) => ({
      module,
      client,
      state: {},
      document: {},
    });
    expect(
      reg.moduleVariant(
        env({ id: 'tts', tts_v2: { rules: {} } }, { ttsBuy() {} }),
      )?.id,
    ).toBe('tts');
    expect(
      reg.moduleVariant(env({ id: 'tts', tts_v2: null }, { ttsBuy() {} })),
    ).toBeNull(); // V1 form
    expect(reg.moduleVariant(env({ id: 'tts', tts_v2: {} }, {}))).toBeNull(); // older client
    const tombola = reg.moduleVariant(
      env({ id: 'raffle_join', raffle_v2: true }, { raffleState() {} }),
    );
    expect(tombola).toMatchObject({
      id: 'raffle_join',
      ownHeader: true,
      intro: false,
      screenClass: 'jdm-module-screen--tmbv2',
    });
    expect(
      reg.moduleVariant(
        env({ id: 'raffle_join', raffle_v2: false }, { raffleState() {} }),
      ),
    ).toBeNull();
  });
  it('TTS V2 absorbs a state where only its part changed, and lets the host redraw otherwise', async () => {
    vi.resetModules();
    const reg = await import('../extension/shared/module-registry.js');
    await import('../extension/shared/tts-v2.js');
    const def = reg.moduleVariant({
      module: { id: 'tts', tts_v2: {} },
      client: { ttsBuy() {} },
    });
    const seen = [];
    const view = { update: (mod) => seen.push(mod) };
    const base = {
      wallet: { available: 10 },
      modules: [{ id: 'tts', tts_v2: { a: 1 } }, { id: 'bonk' }],
    };
    const onlyTts = {
      ...base,
      modules: [{ id: 'tts', tts_v2: { a: 2 } }, { id: 'bonk' }],
    };
    expect(def.onState(view, onlyTts, base)).toBe(true);
    expect(seen).toEqual([{ id: 'tts', tts_v2: { a: 2 } }]);
    expect(
      def.onState(view, { ...onlyTts, wallet: { available: 9 } }, base),
    ).toBe(false); // the balance: host redraws
  });
});
