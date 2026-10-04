import { describe, expect, it } from 'vitest';
import {
  canCreate,
  canEdit,
  canRemove,
  canSetOnCreate,
  cooldownMin,
  counts,
  groups,
  NO_CATEGORY,
  reapply,
  stateOf,
  visible,
  whoSentence,
  whoShort,
} from '../extension/shared/commands-v2-model.js';

// « Modération › Commandes » (phase E): what the extension shows editable comes from Core's /me
// (role + rights); Core still checks every change. Pure view model.

const MOD = {
  role: 'moderator',
  rights: { toggle: true, reply: true, aliases: false, audience: false, exclusions: false, cooldown: { allowed: true, min_seconds: 10 }, quota: false, listed: false, volume: { allowed: true, min: 20, max: 90 }, create: false, remove: false },
};
const SUPER = {
  role: 'supermod',
  rights: { toggle: true, reply: true, aliases: true, audience: true, exclusions: true, cooldown: { allowed: true, min_seconds: 0 }, quota: true, listed: true, volume: { allowed: true, min: 0, max: 100 }, create: true, remove: true },
};
const BOSS = { role: 'broadcaster', rights: null };
const cmd = (name, o = {}, extra = {}) => ({
  command_id: name,
  kind: 'custom',
  owner_module: null,
  locked_fields: [],
  version: 1,
  issues: [],
  config: {
    name,
    aliases: [],
    description: '',
    category: null,
    appearance: { icon: 'chat', color: '#000000' },
    enabled: true,
    listed: true,
    audience: { groups: ['everyone'], allow: [], deny: [] },
    cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'viewer' },
    quota: { enabled: false, max: 4, window: 'hour', scope: 'global' },
    reply: { mode: 'normal', text: 'x', to: 'none' },
    args: [],
    actions: [],
    reply_first: false,
    when: 'always',
    refuse: { mode: 'silent', text: '' },
    team_lock: false,
    ...o,
  },
  ...extra,
});

describe('commands — editable fields per role (display of Core rights)', () => {
  it('moderator: toggle, reply, cooldown (min 10 s); the rest read-only with a reason', () => {
    const c = cmd('hug');
    expect(['enabled', 'reply', 'cooldown'].map((f) => canEdit(MOD, c, f).ok)).toEqual([true, true, true]);
    expect(canEdit(MOD, c, 'aliases')).toEqual({ ok: false, why: 'Non délégué aux modérateurs' });
    expect(canEdit(MOD, c, 'audience.groups').ok).toBe(false);
    expect(canEdit(MOD, c, 'listed').ok).toBe(false);
    expect(canEdit(MOD, c, 'category')).toEqual({ ok: false, why: 'Réglable dans Studio par le streamer' });
    expect(cooldownMin(MOD)).toBe(10);
    expect([canCreate(MOD), canRemove(MOD, c).ok]).toEqual([false, false]);
  });
  it('name (canonical trigger): the streamer only — shown locked with a reason to the team', () => {
    const c = cmd('testcmd');
    expect(canEdit(BOSS, c, 'name').ok).toBe(true);
    expect(canEdit(SUPER, c, 'name')).toEqual({ ok: false, why: 'Seul le streamer peut renommer une commande' });
    expect(canEdit(MOD, c, 'name').ok).toBe(false);
    const sys = cmd('ticket', {}, { kind: 'system', owner_module: 'raffle', locked_fields: ['name'] });
    expect(canEdit(BOSS, sys, 'name')).toEqual({ ok: false, why: 'Verrouillé par le module Tombola' });
  });
  it('supermod: audience, exclusions, quota, listed, create, delete', () => {
    const c = cmd('hug');
    expect(['aliases', 'audience.groups', 'audience.deny', 'quota', 'listed'].every((f) => canEdit(SUPER, c, f).ok)).toBe(true);
    expect([canCreate(SUPER), canRemove(SUPER, c).ok, cooldownMin(SUPER)]).toEqual([true, true, 0]);
    expect(canSetOnCreate(SUPER, 'category')).toBe(true);
    expect(canSetOnCreate(MOD, 'audience.groups')).toBe(false);
  });
  it('streamer: everything, except what a module locks; the team never edits a locked command', () => {
    const sys = cmd('ticket', {}, { kind: 'system', owner_module: 'raffle', locked_fields: ['name', 'actions'] });
    expect(canEdit(BOSS, sys, 'enabled').ok).toBe(true);
    expect(canEdit(BOSS, sys, 'name')).toEqual({ ok: false, why: 'Verrouillé par le module Tombola' });
    expect(canRemove(BOSS, sys).ok).toBe(false);
    const locked = cmd('nuke', { team_lock: true });
    expect(canEdit(SUPER, locked, 'enabled')).toEqual({ ok: false, why: 'Commande verrouillée par le streamer' });
    expect(canEdit(BOSS, locked, 'enabled').ok).toBe(true);
  });
});

describe('commands — list (V6.3): grouping, filters, counters, states', () => {
  const cats = [
    { category_id: 'fun', name: 'Fun', icon: 'sparkles', color: '#f2c65f', position: 1 },
    { category_id: 'infos', name: 'Infos', icon: 'help', color: '#a855f7', position: 0 },
  ];
  const all = [
    cmd('hug', { category: 'fun', aliases: ['calin'] }),
    cmd('lurk', { category: 'fun', enabled: false }),
    cmd('discord', { category: 'infos' }),
    cmd('brb', { listed: false }),
    cmd('old', {}, { issues: [{ code: 'word_reserved', word: 'join', module: 'raffle' }] }),
  ];
  const ui = (o = {}) => ({ side: 'all', cat: 'all', group: true, q: '', ...o });

  it('grouped by category in the streamer’s order, « Sans catégorie » last; a chosen category is flat', () => {
    expect(groups(visible(all, cats, ui()), cats, ui()).map(([k, l]) => [k.name, l.map((x) => x.c.config.name)])).toEqual([
      ['Infos', ['discord']],
      ['Fun', ['hug', 'lurk']],
      [NO_CATEGORY.name, ['brb', 'old']],
    ]);
    expect(groups(visible(all, cats, ui({ cat: 'fun' })), cats, ui({ cat: 'fun' }))[0][0]).toBeNull();
    expect(groups(visible(all, cats, ui({ group: false })), cats, ui({ group: false }))[0][0]).toBeNull();
  });
  it('search by name / alias; state filters; counters follow category and search', () => {
    expect(visible(all, cats, ui({ q: '!cal' }))).toEqual([{ c: all[0], via: 'calin' }]);
    expect(visible(all, cats, ui({ side: 'check' })).map((x) => x.c.config.name)).toEqual(['old']);
    expect(counts(all, cats, ui())).toEqual({ all: 5, check: 1, off: 1, hidden: 1 });
    expect(counts(all, cats, ui({ cat: 'fun' }))).toEqual({ all: 2, check: 0, off: 1, hidden: 0 });
  });
  it('state: the switch is only « enabled »; issues are secondary', () => {
    expect(stateOf(all[4])).toMatchObject({ key: 'reserved', tone: 'bad' });
    expect(stateOf(all[1])).toMatchObject({ key: 'off' });
    expect(stateOf(cmd('a', {}, { issues: [{ code: 'last_send_failed', status: 'expired', error: 'expired', at: '' }] }))).toMatchObject({ label: 'Envoi expiré' });
  });
  it('access wording: groups OR, everyone exclusive, deny named, no streamer bypass', () => {
    expect(whoShort({ groups: ['vips', 'subs'], allow: ['aouh'], deny: ['troll'] })).toBe('VIP + Abonnés + aouh · sauf troll');
    expect(whoSentence({ groups: ['mods'], allow: [], deny: [] })).toContain('uniquement s’il en fait partie');
  });
});

describe('commands — 409', () => {
  it('my changes re-applied on the current version; fields changed on both sides named', () => {
    const base = cmd('a').config;
    const r = reapply(base, { ...base, description: 'moi', listed: false }, { ...base, description: 'Studio', enabled: false });
    expect(r.draft).toMatchObject({ description: 'moi', listed: false, enabled: false });
    expect(r.both).toEqual(['description']);
  });
});
