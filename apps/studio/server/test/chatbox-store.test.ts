import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  builtinSettings,
  DEFAULT_PLACEMENTS,
} from '../src/chatbox/settings.js';
import { ChatboxStore } from '../src/chatbox/store.js';

// Chatbox Raptoru — what Studio keeps (docs/CHATBOX.md § 5.3): persistent after a restart, one profile never touches the
// others, presets, repair of a damaged file, and « Origine » = the widgets' values × their OBS scale (parity § 7).

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'raptoru-chatbox-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('chatbox store', () => {
  it('starts on « Modernisée » for the three profiles, at the historical placements', async () => {
    const s = await ChatboxStore.open(dir);
    for (const p of ['just-chatting', 'react', 'dessin'] as const) {
      expect(s.state.profiles[p].base).toBe('modernisee');
      expect(s.state.profiles[p].settings).toEqual(
        builtinSettings('modernisee', p),
      );
    }
    expect(s.state.placements['just-chatting']).toEqual({
      x: 1264,
      y: 61,
      w: 577,
      h: 962,
      zoom: 1,
    });
    expect(s.token).toMatch(/^[a-f0-9]{32}$/);
  });

  it('saving one profile never touches the two others; everything survives a restart', async () => {
    const s = await ChatboxStore.open(dir);
    const before = structuredClone(s.state.profiles);
    const react = builtinSettings('modernisee', 'react');
    react.presence.seconds = 12;
    react.card.opacity = 0.4;
    await s.saveProfile('react', react);
    await s.setPlacement('ps5', { x: 10, y: 300, w: 470, h: 500, zoom: 1 });
    expect(s.state.profiles['just-chatting']).toEqual(before['just-chatting']);
    expect(s.state.profiles.dessin).toEqual(before.dessin);
    const again = await ChatboxStore.open(dir);
    expect(again.token).toBe(s.token);
    expect(again.state.profiles.react.settings.presence.seconds).toBe(12);
    expect(again.state.placements.ps5).toEqual({
      x: 10,
      y: 300,
      w: 470,
      h: 500,
      zoom: 1,
    });
    expect(again.repaired).toEqual([]);
  });

  it('refuses invalid settings (the saved ones stay)', async () => {
    const s = await ChatboxStore.open(dir);
    const bad = { ...builtinSettings('origine', 'dessin'), maxMessages: 9999 };
    await expect(s.saveProfile('dessin', bad)).rejects.toThrow(
      'invalid_settings',
    );
    await expect(s.saveProfile('nope', bad)).rejects.toThrow('unknown_profile');
    expect(s.state.profiles.dessin.base).toBe('modernisee');
  });

  it("presets: apply « Origine », save, rename, delete one of the streamer's own", async () => {
    const s = await ChatboxStore.open(dir);
    await s.applyPreset('react', 'origine');
    expect(s.state.profiles.react).toEqual({
      base: 'origine',
      settings: builtinSettings('origine', 'react'),
    });
    const mine = builtinSettings('origine', 'react');
    mine.textShadow = 0.8;
    const p = await s.savePreset('react', '  Soirée film  ', mine);
    expect(p.name).toBe('Soirée film');
    expect(s.state.profiles.react.base).toBe(p.id);
    await s.renamePreset('react', p.id, 'Film');
    const again = await ChatboxStore.open(dir);
    expect(again.state.presets.react).toEqual([
      { id: p.id, name: 'Film', settings: mine },
    ]);
    expect(again.presetSettings('react', p.id).textShadow).toBe(0.8);
    await again.deletePreset('react', p.id);
    expect(again.state.presets.react).toEqual([]);
    expect(again.state.profiles.react.settings.textShadow).toBe(0.8);
    expect(again.state.profiles.react.base).toBe('modernisee');
    expect(again.state.presets['just-chatting']).toEqual([]);
  });

  it('an account rule known by login binds its stable id at the first message', async () => {
    const s = await ChatboxStore.open(dir);
    expect(await s.bindAccount('NightBot', '19264788')).toBe(true);
    expect(await s.bindAccount('nightbot', '1')).toBe(false);
    const again = await ChatboxStore.open(dir);
    expect(
      again.state.rules.accounts.find((a) => a.login === 'nightbot'),
    ).toEqual({
      id: '19264788',
      login: 'nightbot',
      mode: 'hide',
    });
  });

  it('rules: invalid refused, one rule per account kept', async () => {
    const s = await ChatboxStore.open(dir);
    const r = structuredClone(s.state.rules);
    r.accounts.push(
      { id: '5', login: 'a', mode: 'hide' },
      { id: '5', login: 'a', mode: 'highlight' },
    );
    await s.setRules(r);
    expect(s.state.rules.accounts.filter((a) => a.id === '5')).toEqual([
      { id: '5', login: 'a', mode: 'highlight' },
    ]);
    await expect(
      s.setRules({ ...r, special: { announcement: 'loud' } }),
    ).rejects.toThrow('invalid_rules');
  });

  it('Croupier families met are kept (ids only, never a message) and listed with their category', async () => {
    let t = 1_000;
    const s = await ChatboxStore.open(dir, () => t);
    await s.noteFamily('module:level_up');
    t += 120_000;
    await s.noteFamily('module:level_up');
    expect(s.catalogue()).toEqual([
      {
        id: 'module:level_up',
        category: 'level_up',
        label: 'Annonce Level Up',
        first: 1_000,
        last: 121_000,
      },
    ]);
    const raw = await readFile(join(dir, 'chatbox.json'), 'utf8');
    expect(raw).not.toContain('Bravo');
  });

  it('a damaged group is repaired from its preset, the rest kept; an unreadable file is set aside', async () => {
    const s = await ChatboxStore.open(dir);
    const jc = builtinSettings('modernisee', 'just-chatting');
    jc.text.size = 30;
    await s.saveProfile('just-chatting', jc);
    const raw = JSON.parse(await readFile(join(dir, 'chatbox.json'), 'utf8'));
    raw.profiles['just-chatting'].settings.card = { style: 'neon' };
    raw.placements.waiting = { x: 'left' };
    await writeFile(join(dir, 'chatbox.json'), JSON.stringify(raw));
    const repaired = await ChatboxStore.open(dir);
    expect(repaired.state.profiles['just-chatting'].settings.text.size).toBe(
      30,
    );
    expect(repaired.state.profiles['just-chatting'].settings.card).toEqual(
      jc.card,
    );
    expect(repaired.state.placements.waiting).toEqual(
      DEFAULT_PLACEMENTS.waiting,
    );
    expect(repaired.repaired).toEqual([
      'profil just-chatting',
      'emplacement waiting',
    ]);
    await writeFile(join(dir, 'chatbox.json'), '{ broken');
    const fresh = await ChatboxStore.open(dir);
    expect(fresh.repaired).toEqual(['fichier illisible (mis de côté)']);
    expect(fresh.state.profiles.react.base).toBe('modernisee');
  });
});

describe('« Origine » = the StreamElements widgets on stream (parity § 7)', () => {
  const o = (p: 'just-chatting' | 'react' | 'dessin') =>
    builtinSettings('origine', p);
  it('sizes = widget code × OBS scale of the main scene', () => {
    expect([
      o('just-chatting').name.size,
      o('just-chatting').text.size,
    ]).toEqual([20, 26.2]);
    expect([o('react').name.size, o('react').text.size]).toEqual([19.4, 20.6]);
    expect([o('dessin').name.size, o('dessin').text.size]).toEqual([
      23.3, 24.3,
    ]);
    expect(o('just-chatting').emote.solo).toEqual([
      92.4, 80.1, 70.8, 63.1, 57, 52.4,
    ]);
    expect(o('react').emote.solo).toEqual([36.4]);
    expect(o('dessin').emote.solo).toEqual([61.4, 58.7, 56.1, 53.4, 50.8]);
  });
  it('behaviours: presence, delays, animations, role bars, latest, message caps', () => {
    expect(o('just-chatting').presence.mode).toBe('permanent');
    expect([o('react').presence.seconds, o('dessin').presence.seconds]).toEqual(
      [10, 15],
    );
    expect([
      o('just-chatting').enter.duration,
      o('react').enter.duration,
      o('dessin').enter.duration,
    ]).toEqual([620, 1300, 1300]);
    expect([
      o('just-chatting').roles.bar,
      o('react').roles.bar,
      o('dessin').roles.bar,
    ]).toEqual([0, 3.6, 4.2]);
    expect(o('react').latest).toEqual({
      enabled: true,
      others: 0.88,
      dimText: true,
    });
    expect([
      o('just-chatting').maxMessages,
      o('react').maxMessages,
      o('dessin').maxMessages,
    ]).toEqual([50, 50, 65]);
    expect(o('dessin').opacity).toBe(0.908);
  });
  it('« Modernisée » keeps each identity and never dims the text', () => {
    const m = (p: 'just-chatting' | 'react' | 'dessin') =>
      builtinSettings('modernisee', p);
    expect(m('just-chatting').presence.mode).toBe('permanent');
    expect([m('react').presence.seconds, m('dessin').presence.seconds]).toEqual(
      [10, 15],
    );
    for (const p of ['just-chatting', 'react', 'dessin'] as const) {
      expect(m(p).latest.dimText).toBe(false);
      expect(m(p).opacity).toBe(1);
      expect(m(p).roles.bar).toBeGreaterThan(0);
    }
  });
});
