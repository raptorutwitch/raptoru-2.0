import { beforeEach, describe, expect, it } from 'vitest';
import {
  hostModules,
  loadHostModules,
  registerViewerModule,
  resetHostModulesForTests,
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
