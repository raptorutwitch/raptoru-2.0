import { describe, expect, it } from 'vitest';
import {
  accentColor,
  analyze,
  buildCatalog,
  composeStacks,
  liftColor,
  nameColor,
  parse,
  soloSize,
  tokenize,
} from '../chatbox-player/engine.js';

// Chatbox Raptoru — the message engine against the parity matrix (docs/CHATBOX.md § 7): what the StreamElements widgets
// did must still happen (P01–P11), now from EventSub fragments.

const catalog = buildCatalog([
  {
    code: '199Pray',
    url: 'https://cdn.7tv.app/emote/a/3x.webp',
    provider: '7tv',
    zw: false,
  },
  {
    code: '199Jail',
    url: 'https://cdn.7tv.app/emote/b/3x.webp',
    provider: '7tv',
    zw: true,
  },
  {
    code: '199Sparkles',
    url: 'https://cdn.7tv.app/emote/c/3x.webp',
    provider: '7tv',
    zw: true,
  },
  {
    code: 'KEKW',
    url: 'https://cdn.betterttv.net/emote/d/3x',
    provider: 'bttv',
    zw: false,
  },
  {
    code: 'ZreknarF',
    url: 'https://cdn.frankerfacez.com/e/4',
    provider: 'ffz',
    zw: false,
  },
]);
const text = (t) => ({ t: 'text', text: t });
const stacks = (nodes) => nodes.filter((n) => n.type === 'stack');

describe('chatbox engine — parity', () => {
  it('P01: a Twitch emote fragment becomes a Twitch image (animated when it exists, static fallback)', () => {
    const [n] = stacks(
      composeStacks(
        tokenize(
          [text('Salut '), { t: 'emote', id: '25', text: 'Kappa' }],
          catalog,
        ),
      ),
    );
    expect(n.base.url).toBe(
      'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0',
    );
    expect(n.base.fallbackUrl).toBe(
      'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/3.0',
    );
  });

  it('P02: 7TV, BTTV, FFZ emotes are found by name inside text', () => {
    const { nodes } = parse(
      { fragments: [text('trop bien 199Pray KEKW ZreknarF !')] },
      catalog,
    );
    expect(stacks(nodes).map((s) => s.base.provider)).toEqual([
      '7tv',
      'bttv',
      'ffz',
    ]);
    expect(nodes.at(-1)).toEqual({ type: 'text', value: ' !' });
  });

  it('P03: zero-width emotes stack over the previous emote, several layers, the space between them dropped', () => {
    const { nodes } = parse(
      { fragments: [text('Au trou 199Pray 199Jail 199Sparkles et voilà')] },
      catalog,
    );
    const [s] = stacks(nodes);
    expect(s.base.code).toBe('199Pray');
    expect(s.overlays.map((o) => o.code)).toEqual(['199Jail', '199Sparkles']);
    expect(
      nodes.map((n) => (n.type === 'text' ? n.value : '[stack]')).join(''),
    ).toBe('Au trou [stack] et voilà');
  });

  it('P03: an orphan zero-width stays visible and becomes the base of the next ones (kept from the widgets)', () => {
    const { nodes } = parse(
      { fragments: [text('199Jail 199Sparkles')] },
      catalog,
    );
    const [s] = stacks(nodes);
    expect(s.orphan).toBe(true);
    expect(s.base.code).toBe('199Jail');
    expect(s.overlays.map((o) => o.code)).toEqual(['199Sparkles']);
  });

  it('P03: a word between an emote and a zero-width breaks the stack', () => {
    const { nodes } = parse(
      { fragments: [text('199Pray mdr 199Jail')] },
      catalog,
    );
    expect(stacks(nodes)).toHaveLength(2);
    expect(stacks(nodes)[1].orphan).toBe(true);
  });

  it('P05: Unicode emojis become Twemoji images per grapheme (flag, ZWJ sequence, skin tone)', () => {
    const { nodes } = parse({ fragments: [text('🔥 🇫🇷 👩‍🎨 👍🏽')] }, catalog);
    const urls = stacks(nodes).map((s) => s.base.url.split('/').at(-1));
    expect(urls).toEqual([
      '1f525.svg',
      '1f1eb-1f1f7.svg',
      '1f469-200d-1f3a8.svg',
      '1f44d-1f3fd.svg',
    ]);
    expect(stacks(nodes).every((s) => s.base.provider === 'unicode')).toBe(
      true,
    );
  });

  it('P06: emote-only messages (a zero-width stack counts as ONE emote); text or a mention makes it ordinary', () => {
    expect(
      analyze(parse({ fragments: [text('199Pray 199Jail')] }, catalog).nodes),
    ).toEqual({ emoteOnly: true, units: 1 });
    expect(
      analyze(parse({ fragments: [text('KEKW KEKW KEKW')] }, catalog).nodes),
    ).toEqual({ emoteOnly: true, units: 3 });
    expect(
      analyze(parse({ fragments: [text('KEKW lol')] }, catalog).nodes)
        .emoteOnly,
    ).toBe(false);
    expect(
      analyze(
        parse(
          { fragments: [{ t: 'mention', text: '@Mimi' }, text(' KEKW')] },
          catalog,
        ).nodes,
      ).emoteOnly,
    ).toBe(false);
  });

  it('P06: the solo size follows the profile list, its last value repeating (the three historical rules)', () => {
    const jc = [92.4, 80.1, 70.8, 63.1, 57, 52.4];
    expect([1, 2, 3, 6, 9].map((n) => soloSize(n, jc))).toEqual([
      92.4, 80.1, 70.8, 52.4, 52.4,
    ]);
    expect([1, 4].map((n) => soloSize(n, [36.4]))).toEqual([36.4, 36.4]);
    const dessin = [61.4, 58.7, 56.1, 53.4, 50.8];
    expect(soloSize(8, dessin)).toBe(50.8);
  });

  it('P04: a GIF fragment stays a GIF node', () => {
    const { nodes } = parse(
      {
        fragments: [
          { t: 'gif', url: 'https://media.giphy.com/x.gif', text: '[GIF]' },
        ],
      },
      catalog,
    );
    expect(nodes).toEqual([
      {
        type: 'gif',
        media: { url: 'https://media.giphy.com/x.gif', placeholder: '[GIF]' },
      },
    ]);
  });

  it("P11: the Twitch colour, else the widgets' palette picked from the login (always the same)", () => {
    expect(nameColor('mimi', '#FF69B4')).toBe('#FF69B4');
    expect(nameColor('pixel_boulanger', null)).toBe(
      nameColor('pixel_boulanger', ''),
    );
    expect(nameColor('pixel_boulanger', null)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('a very dark colour is lifted (hue kept), a readable one is untouched', () => {
    expect(liftColor('#ff69b4')).toBe('#ff69b4');
    const lifted = liftColor('#1c1c6e');
    expect(lifted).not.toBe('#1c1c6e');
    const [r, g, b] = [1, 3, 5].map((i) =>
      Number.parseInt(lifted.slice(i, i + 2), 16),
    );
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('announcement colours: Twitch colours toned, « primary » takes the profile accent', () => {
    expect(accentColor('blue', '#f2c14e')).toBe('#4fa3ff');
    expect(accentColor('primary', '#f2c14e')).toBe('#f2c14e');
  });
});
