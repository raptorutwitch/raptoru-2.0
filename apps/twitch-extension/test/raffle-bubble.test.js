// Bulle « Tombola » (app/raffle-bubble.js) : inscription sur place par la même action que la page Tombola, une
// intention à la fois, refus du Core lisibles, jamais sans identité partagée, « Inscrit » puis disparition.
import { describe, expect, it, vi } from 'vitest';
import {
  createRaffleBubble,
  JOINED_SHOWN_MS,
  raffleBubbleView,
} from '../extension/app/raffle-bubble.js';

/** A tiny DOM: what the bubble uses (create, classes, attributes, children, click listeners). */
function fakeDocument() {
  const timers = [];
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      title: '',
      type: '',
      disabled: false,
      attrs: {},
      children: [],
      listeners: {},
      classList: {
        add: (c) => {
          node.className = `${node.className} ${c}`.trim();
        },
        remove: (c) => {
          node.className = node.className
            .split(' ')
            .filter((x) => x !== c)
            .join(' ');
        },
      },
      setAttribute: (k, v) => {
        node.attrs[k] = String(v);
      },
      append: (...c) => node.children.push(...c),
      replaceChildren: (...c) => {
        node.children = c;
      },
      addEventListener: (type, fn) => {
        (node.listeners[type] ??= []).push(fn);
      },
      click: () => {
        if (!node.disabled)
          for (const fn of node.listeners.click ?? [])
            fn({ stopPropagation() {} });
      },
    };
    return node;
  };
  return {
    createElement: make,
    defaultView: { setTimeout: (fn, ms) => timers.push({ fn, ms }) },
    timers,
  };
}
const all = (node) => [
  node,
  ...node.children.flatMap((c) => (c && typeof c === 'object' ? all(c) : [])),
];
const find = (node, cls) =>
  all(node).find((n) => n.className?.split(' ').includes(cls)) ?? null;
const text = (node) =>
  all(node)
    .map((n) => n.textContent)
    .join('');

function setup({
  join = vi.fn(async () => ({ joined: true })),
  identityShared = true,
} = {}) {
  const document = fakeDocument();
  let t = 1_000_000;
  const changed = vi.fn();
  const refreshed = vi.fn();
  const open = vi.fn();
  const bubble = createRaffleBubble({
    document,
    icon: () => document.createElement('svg'),
    join,
    open,
    changed,
    refreshed,
    now: () => t,
  });
  const input = {
    raffle: { open: true, window_id: 'r1', joined: false },
    offered: true,
    active: true,
    onRaffle: false,
    identityShared,
  };
  return {
    bubble,
    input,
    join,
    open,
    changed,
    refreshed,
    document,
    advance: (ms) => {
      t += ms;
    },
  };
}
const flush = () => new Promise((r) => globalThis.setTimeout(r, 0));

describe('bulle Tombola — ce qu’elle montre', () => {
  const base = {
    offered: true,
    active: true,
    joined: false,
    onRaffle: false,
    identityShared: true,
    windowId: 'r1',
    local: null,
    now: 0,
  };
  it('cachée : module absent, tombola fermée, déjà inscrit (Core), sur la page Tombola', () => {
    expect(raffleBubbleView({ ...base, offered: false })).toBeNull();
    expect(raffleBubbleView({ ...base, active: false })).toBeNull();
    expect(raffleBubbleView({ ...base, joined: true })).toBeNull();
    expect(raffleBubbleView({ ...base, onRaffle: true })).toBeNull();
  });
  it('« Rejoindre » seulement avec l’identité Twitch partagée (sinon le parcours de la page Tombola)', () => {
    expect(raffleBubbleView(base)).toEqual({ mode: 'open', canJoin: true });
    expect(raffleBubbleView({ ...base, identityShared: false })).toEqual({
      mode: 'open',
      canJoin: false,
    });
  });
  it('refus : réessayer seulement quand c’est utile ; une nouvelle tombola repart de zéro', () => {
    const err = (code) =>
      raffleBubbleView({
        ...base,
        local: { windowId: 'r1', status: 'error', code },
      });
    expect(err('raffle_closed')).toMatchObject({
      mode: 'error',
      canJoin: false,
      message: 'Fermée',
    });
    expect(err('viewer_blocked')).toMatchObject({
      canJoin: false,
      message: 'Indisponible',
    });
    expect(err('extension_join_disabled')).toMatchObject({
      canJoin: false,
      message: 'Par le chat',
    });
    expect(err('identity_required')).toMatchObject({ canJoin: false });
    expect(err('network_error')).toMatchObject({
      mode: 'error',
      canJoin: true,
      message: 'Échec',
    });
    expect(err('raffle_paused')).toMatchObject({
      canJoin: true,
      message: 'En pause',
    });
    expect(
      raffleBubbleView({
        ...base,
        windowId: 'r2',
        local: { windowId: 'r1', status: 'error', code: 'raffle_closed' },
      }),
    ).toEqual({ mode: 'open', canJoin: true });
  });
  it('après l’inscription : « Inscrit » quelques secondes, puis rien', () => {
    const local = { windowId: 'r1', status: 'joined', at: 0 };
    expect(
      raffleBubbleView({ ...base, joined: true, local, now: 100 }),
    ).toEqual({ mode: 'joined' });
    expect(
      raffleBubbleView({
        ...base,
        joined: true,
        local,
        now: JOINED_SHOWN_MS + 1,
      }),
    ).toBeNull();
    expect(
      raffleBubbleView({
        ...base,
        joined: false,
        local,
        now: JOINED_SHOWN_MS + 1,
      }),
    ).toBeNull();
  });
});

describe('bulle Tombola — inscription sur place', () => {
  it('un clic = une inscription : pendant la requête le bouton attend, un double clic ne réinscrit pas ; « Inscrit » puis disparition', async () => {
    let resolve;
    const join = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const s = setup({ join });
    const node = s.bubble.render(s.input);
    expect(text(node)).toContain('Tombola');
    const btn = find(node, 'jdm-raffle-chip__join');
    expect(btn.textContent).toBe('Rejoindre');
    btn.click();
    btn.click(); // the same button before the redraw: the controller refuses a second intent
    const busy = find(s.bubble.render(s.input), 'jdm-raffle-chip__join');
    expect(busy.disabled).toBe(true);
    expect(busy.attrs['aria-busy']).toBe('true');
    busy.click();
    expect(join).toHaveBeenCalledTimes(1);
    resolve({ joined: true, duplicate: false });
    await flush();
    expect(s.refreshed).toHaveBeenCalledTimes(1);
    const joined = s.bubble.render({
      ...s.input,
      raffle: { ...s.input.raffle, joined: true },
    });
    expect(text(joined)).toContain('Inscrit');
    expect(find(joined, 'jdm-raffle-chip__join')).toBeNull();
    expect(s.document.timers.some((x) => x.ms >= JOINED_SHOWN_MS)).toBe(true);
    s.advance(JOINED_SHOWN_MS + 10);
    expect(
      s.bubble.render({
        ...s.input,
        raffle: { ...s.input.raffle, joined: true },
      }),
    ).toBeNull();
  });

  it('déjà inscrit (le Core rejoue l’inscription) : comme une réussite, aucune seconde inscription', async () => {
    const s = setup({
      join: vi.fn(async () => ({
        joined: true,
        duplicate: true,
        already_joined: true,
      })),
    });
    find(s.bubble.render(s.input), 'jdm-raffle-chip__join').click();
    await flush();
    expect(text(s.bubble.render(s.input))).toContain('Inscrit');
  });

  it('échec réseau : retour court et « Réessayer », qui relance l’inscription et réussit', async () => {
    const join = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('x'), { code: 'network_error' }),
      )
      .mockResolvedValueOnce({ joined: true });
    const s = setup({ join });
    find(s.bubble.render(s.input), 'jdm-raffle-chip__join').click();
    await flush();
    const failed = s.bubble.render(s.input);
    expect(find(failed, 'jdm-raffle-chip__msg').textContent).toBe('Échec');
    const retry = find(failed, 'jdm-raffle-chip__join');
    expect(retry.textContent).toBe('Réessayer');
    retry.click();
    await flush();
    expect(join).toHaveBeenCalledTimes(2);
    expect(text(s.bubble.render(s.input))).toContain('Inscrit');
  });

  it('tombola fermée par le Core : « Fermée », plus de bouton ; fermée pendant la requête : la bulle disparaît sans erreur', async () => {
    let reject;
    const s = setup({
      join: vi.fn(
        () =>
          new Promise((_, r) => {
            reject = r;
          }),
      ),
    });
    find(s.bubble.render(s.input), 'jdm-raffle-chip__join').click();
    // The raffle closes while the request runs: the next state hides the bubble.
    expect(s.bubble.render({ ...s.input, active: false })).toBeNull();
    reject(Object.assign(new Error('x'), { code: 'raffle_closed' }));
    await flush();
    expect(s.bubble.render({ ...s.input, active: false })).toBeNull();
    // Still open on this screen (state not refreshed yet): the refusal, no retry.
    const closed = s.bubble.render(s.input);
    expect(find(closed, 'jdm-raffle-chip__msg').textContent).toBe('Fermée');
    expect(find(closed, 'jdm-raffle-chip__join')).toBeNull();
  });

  it('identité non partagée : pas de « Rejoindre », seulement l’accès à la page Tombola (parcours Twitch)', () => {
    const s = setup({ identityShared: false });
    const node = s.bubble.render(s.input);
    expect(find(node, 'jdm-raffle-chip__join')).toBeNull();
    find(node, 'jdm-raffle-chip__open').click();
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(s.join).not.toHaveBeenCalled();
  });
});
