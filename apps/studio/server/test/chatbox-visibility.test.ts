import { describe, expect, it } from 'vitest';
import { DemoRunner } from '../src/chatbox/demo.js';
import { PARITY, SPECIALS } from '../src/chatbox/parity.js';
import {
  type ChatboxMessage,
  commandName,
  decide,
  DEFAULT_RULES,
  familyInfo,
  roleOf,
  type Rules,
} from '../src/chatbox/visibility.js';

// Chatbox Raptoru — the visibility manager (docs/CHATBOX.md § 6) and the roles (§ 6.5, the Aouh case).

const demo = new DemoRunner(() => {});
const msg = (id: string) =>
  demo.message([...PARITY, ...SPECIALS].find((c) => c.id === id)!.message);
const rules = (patch: (r: Rules) => void = () => {}) => {
  const r = structuredClone(DEFAULT_RULES);
  patch(r);
  return r;
};

describe('commands', () => {
  it('« ! » followed by a letter or a digit is a command; reactions never are', () => {
    expect(commandName('!roue')).toBe('roue');
    expect(commandName('  !Roue du sub')).toBe('roue');
    expect(commandName('!8ball')).toBe('8ball');
    expect(commandName('!éclair')).toBe('éclair');
    for (const t of ['!!!!!', '!?!?', '! salut', 'salut !roue', '!', '!!roue'])
      expect(commandName(t)).toBeNull();
  });

  it('a recognised Raptoru command is hidden by default; `!!!!!` and `!?!?` stay; an unknown one stays by default', () => {
    expect(decide(msg('P19a'), rules()).mode).toBe('hide');
    expect(decide(msg('P19b'), rules()).mode).toBe('normal');
    expect(decide(msg('P19c'), rules()).mode).toBe('normal');
    expect(decide(msg('P19d'), rules())).toMatchObject({
      mode: 'normal',
      reason: 'commande inconnue !uptime',
    });
  });

  it('external commands are hidden when listed; unknown policy and Raptoru policy are settable', () => {
    expect(
      decide(
        msg('P19d'),
        rules((r) => (r.commands.external = ['uptime'])),
      ).mode,
    ).toBe('hide');
    expect(
      decide(
        msg('P19d'),
        rules((r) => (r.commands.unknown = 'hide')),
      ).mode,
    ).toBe('hide');
    expect(
      decide(
        msg('P19a'),
        rules((r) => (r.commands.raptoru = 'normal')),
      ).mode,
    ).toBe('normal');
  });
});

describe('accounts', () => {
  it('Nightbot and StreamElements hidden by default, by login until their id is known', () => {
    expect(decide(msg('P19e'), rules()).mode).toBe('hide');
  });

  it('a rule bound to an id follows the account, not the login', () => {
    const m = msg('P01');
    const r = rules((x) =>
      x.accounts.push({ id: m.user.id, login: 'ancien_pseudo', mode: 'hide' }),
    );
    expect(decide(m, r).mode).toBe('hide');
    const other = { ...m, user: { ...m.user, id: '1' } };
    expect(
      decide(
        other,
        rules((x) =>
          x.accounts.push({ id: '2', login: m.user.login, mode: 'hide' }),
        ),
      ).mode,
    ).toBe('normal');
  });

  it('« normal » is an exception: always shown, even a command', () => {
    const m = msg('P19a');
    expect(
      decide(
        m,
        rules((r) =>
          r.accounts.push({
            id: m.user.id,
            login: m.user.login,
            mode: 'normal',
          }),
        ),
      ).mode,
    ).toBe('normal');
  });

  it("« highlight » highlights with the viewer's name as tag", () => {
    const m = msg('P01');
    expect(
      decide(
        m,
        rules((r) =>
          r.accounts.push({
            id: m.user.id,
            login: m.user.login,
            mode: 'highlight',
          }),
        ),
      ),
    ).toMatchObject({
      mode: 'highlight',
      label: m.user.name,
    });
  });
});

describe('LeCroupier_ catalogue', () => {
  it('everything hidden by default (ordinary messages, technical feedback, uncategorised)', () => {
    for (const id of ['C01', 'C02', 'C03', 'C04', 'C05'])
      expect(decide(msg(id), rules()).mode).toBe('hide');
  });

  it('a category, then a family that overrides it', () => {
    const r = rules((x) => (x.croupier.categories.level_up = 'highlight'));
    expect(decide(msg('C04'), r)).toMatchObject({
      mode: 'highlight',
      label: 'Annonce',
    });
    const g = rules((x) => {
      x.croupier.categories.games = 'normal';
      x.croupier.families['mini_game:reply'] = 'hide';
    });
    expect(decide(msg('C03'), g).mode).toBe('hide');
  });

  it('the uncategorised fallback has its own setting', () => {
    expect(
      decide(
        msg('C05'),
        rules((r) => (r.croupier.fallback = 'normal')),
      ).mode,
    ).toBe('normal');
  });

  it('families come from the emitting step (origin, kind, command), never from the text', () => {
    expect(familyInfo('commands:reply:roue')).toEqual({
      category: 'commands',
      label: 'Réponse à !roue',
    });
    expect(familyInfo('commands:refusal:slot')).toEqual({
      category: 'errors',
      label: 'Refus de !slot',
    });
    expect(familyInfo('mini_game:reply').category).toBe('games');
    expect(familyInfo('raffle:refusal').category).toBe('errors');
    expect(familyInfo('module:level_up').category).toBe('level_up');
    expect(familyInfo('module:casino').category).toBe('casino');
    expect(familyInfo('anniversaire.souhait')).toEqual({
      category: 'other',
      label: 'anniversaire.souhait',
    });
  });
});

describe('special messages', () => {
  it('announcements and channel-points highlights are highlighted by default; first messages are normal', () => {
    expect(decide(msg('S01'), rules())).toMatchObject({
      mode: 'highlight',
      label: 'Annonce',
    });
    expect(decide(msg('S02'), rules())).toMatchObject({
      mode: 'highlight',
      label: 'Mis en avant',
    });
    expect(decide(msg('S03'), rules()).mode).toBe('normal');
    expect(
      decide(
        msg('S01'),
        rules((r) => (r.special.announcement = 'hide')),
      ).mode,
    ).toBe('hide');
  });
});

describe('roles (the Aouh case)', () => {
  const user = (
    badges: string[],
    staff: ChatboxMessage['user']['staff'] = null,
  ) => ({
    id: '1',
    login: 'x',
    name: 'x',
    color: null,
    badges: badges.map((set) => ({ set, version: '1', url: null })),
    staff,
  });

  it('a Lead Moderator (badge lead_moderator, no moderator badge) gets the green bar', () => {
    expect(roleOf(user(['lead_moderator', 'subscriber']))).toBe('moderator');
    expect(roleOf(msg('P12b').user)).toBe('moderator');
  });

  it('a Raptoru supermod or moderator confirmed by the Core gets it without any Twitch badge', () => {
    expect(roleOf(user([], 'supermod'))).toBe('moderator');
    expect(roleOf(user([], 'moderator'))).toBe('moderator');
    expect(roleOf(msg('P12c').user)).toBe('moderator');
  });

  it('priority broadcaster > moderation > VIP; badges coexist', () => {
    expect(roleOf(user(['broadcaster', 'moderator', 'vip']))).toBe(
      'broadcaster',
    );
    expect(roleOf(user(['vip', 'moderator']))).toBe('moderator');
    expect(roleOf(user(['vip', 'subscriber']))).toBe('vip');
    expect(roleOf(user(['subscriber']))).toBeNull();
  });
});

describe('command catalogue rules (docs/CHATBOX.md § 6.2)', () => {
  const rb = { key: 'module:rb', label: 'Random Ban' };
  const solde = { key: 'module:solde', label: 'Solde de Jetons' };
  const catalogue = new Map([
    ['rb', rb],
    ['solde', solde],
    ['balance', solde],
    ['compte', solde],
  ]);
  const lookup = (w: string) => catalogue.get(w) ?? null;
  const viewer = (text: string) => ({
    ...msg('P01'),
    fragments: [{ t: 'text' as const, text }],
  });
  const croupier = (command: string | null) => ({
    ...msg('C03'),
    croupier: { family: 'mini_game:action', command },
  });

  it('a known command is hidden by default, any of its aliases follows the same setting', () => {
    expect(decide(viewer('!rb'), rules(), lookup)).toMatchObject({
      mode: 'hide',
      reason: 'commande Random Ban (!rb)',
    });
    const shown = rules(
      (r) => (r.commands.rules['module:solde'] = { message: 'normal' }),
    );
    for (const w of ['!solde', '!balance', '!compte @duc'])
      expect(decide(viewer(w), shown, lookup).mode).toBe('normal');
    expect(decide(viewer('!!!!!'), rules(), lookup).mode).toBe('normal');
  });

  it("the viewer's message and LeCroupier_'s answer are set independently", () => {
    const r = rules(
      (x) =>
        (x.commands.rules['module:rb'] = {
          message: 'hide',
          reply: 'highlight',
        }),
    );
    expect(decide(viewer('!rb'), r, lookup).mode).toBe('hide');
    expect(decide(croupier('rb'), r, lookup)).toMatchObject({
      mode: 'highlight',
      reason: 'réponse du Croupier à Random Ban',
    });
    // No answer setting: the Croupier's catalogue decides (everything hidden by default).
    expect(decide(croupier('solde'), r, lookup).mode).toBe('hide');
    const games = rules((x) => (x.croupier.categories.games = 'normal'));
    expect(decide(croupier('solde'), games, lookup).mode).toBe('normal');
  });
});
