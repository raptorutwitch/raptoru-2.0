import { describe, expect, it, vi } from 'vitest';
import { buildCatalog } from '../src/chatbox/catalog.js';
import { ChatboxRelay } from '../src/chatbox/relay.js';
import {
  commandWord,
  currentTrigger,
  withTrigger,
  withTriggerParams,
} from '../src/chatbox/trigger.js';
import { LabChatRouter } from '../src/lab-chat/router.js';

// Chatbox Raptoru — the Core's part (docs/CHATBOX.md § 5.1, § 6.3): the relay (memory only) enriches the bot's events,
// ties LeCroupier_'s own messages to the chat step that sent them (never their text, except an announcement Twitch
// returns without id), resumes Studio where it stopped; the router runs every module inside the message's trigger;
// the catalogue lists every command once, aliases together.

const clock = { now: () => new Date('2026-11-23T10:00:00Z') };
const msg = (over: Record<string, unknown> = {}) => ({
  type: 'msg' as const,
  message_id: 'm1',
  at: 1,
  user: {
    id: '42',
    login: 'mimi',
    name: 'Mimi',
    color: '#ff69b4',
    badges: [{ set: 'moderator', version: '1' }],
  },
  fragments: [{ t: 'text' as const, text: 'salut' }],
  ...over,
});

function relayWith(rows: (sql: string, params: unknown[]) => unknown[]) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) =>
    rows(sql, params),
  );
  const relay = new ChatboxRelay({
    db: { query } as never,
    clock,
    channelId: '83603689',
    badgeImages: {
      load: async () => new Map([['moderator/1', 'https://img/mod.png']]),
    },
    sleep: async () => {},
  });
  return { relay, query };
}

describe('chatbox relay', () => {
  it('adds the badge images and the Raptoru staff role; keeps the events with a cursor', async () => {
    const { relay } = relayWith((sql) =>
      sql.includes('lab_staff') ? [{ viewer_id: '42' }] : [],
    );
    const seen: unknown[] = [];
    relay.listen((e) => seen.push(e));
    await relay.ingest({ channel_id: '83603689', events: [msg()] });
    expect(seen).toEqual([
      {
        seq: 1,
        type: 'msg',
        message: {
          id: 'm1',
          at: 1,
          user: {
            id: '42',
            login: 'mimi',
            name: 'Mimi',
            color: '#ff69b4',
            badges: [
              { set: 'moderator', version: '1', url: 'https://img/mod.png' },
            ],
            staff: 'supermod',
          },
          fragments: [{ t: 'text', text: 'salut' }],
        },
      },
    ]);
    expect(relay.cursor).toBe(1);
  });

  it("ties LeCroupier_'s own message to its chat step (family, command answered), once the bot's ACK is written", async () => {
    let tries = 0;
    const { relay } = relayWith((sql) => {
      if (!sql.includes('twitch_message_id')) return [];
      tries++;
      return tries < 2
        ? []
        : [
            {
              origin: 'mini_game',
              kind: 'action',
              params: { trigger: { message_id: 'v1', command: 'rb' } },
            },
          ];
    });
    const seen: { message?: { croupier?: unknown } }[] = [];
    relay.listen((e) => seen.push(e as never));
    await relay.ingest({
      channel_id: '83603689',
      events: [msg({ message_id: 'own1', own: true })],
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.message!.croupier).toEqual({
      family: 'mini_game:action',
      command: 'rb',
    });
  });

  it("an announcement (no Twitch id) by its exact text; the bot's direct answer by its own tag; else not categorised", async () => {
    const { relay, query } = relayWith((sql) =>
      sql.includes("params->>'text'")
        ? [{ origin: 'module:level_up', kind: 'action', params: {} }]
        : [],
    );
    const seen: { message?: { croupier?: unknown } }[] = [];
    relay.listen((e) => seen.push(e as never));
    await relay.ingest({
      channel_id: '83603689',
      events: [
        msg({
          message_id: 'a1',
          own: true,
          kind: 'announcement',
          fragments: [{ t: 'text', text: 'Niveau 25 !' }],
        }),
        msg({ message_id: 'b1', own: true, answered: 'daily' }),
        msg({ message_id: 'c1', own: true }),
      ],
    });
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    const byId = Object.fromEntries(
      seen.map((e) => [(e.message as { id: string }).id, e.message!.croupier]),
    );
    expect(byId).toEqual({
      a1: { family: 'module:level_up:action', command: null },
      b1: { family: 'bot:reply', command: 'daily' },
      c1: { family: null, command: null },
    });
    expect(
      query.mock.calls.some(
        ([sql, p]) =>
          String(sql).includes("params->>'text'") &&
          (p as unknown[])[1] === 'Niveau 25 !',
      ),
    ).toBe(true);
  });

  it('moderation empties the snapshot; Studio resumes after its cursor, or resets after a restart / too old', async () => {
    const { relay } = relayWith(() => []);
    await relay.ingest({
      channel_id: '83603689',
      events: [msg({ message_id: 'x' }), msg({ message_id: 'y' })],
    });
    await relay.ingest({
      channel_id: '83603689',
      events: [{ type: 'delete', message_id: 'x' }],
    });
    expect(relay.snapshot().map((m) => m.id)).toEqual(['y']);
    expect(relay.since(relay.boot, 1)!.map((e) => e.seq)).toEqual([2, 3]);
    expect(relay.since('another-boot', 1)).toBeNull();
    expect(relay.since(relay.boot, 99)).toBeNull();
    await relay.ingest({
      channel_id: '83603689',
      events: [{ type: 'clear_user', user_id: '42' }],
    });
    expect(relay.snapshot()).toEqual([]);
  });

  it("the Lab's simulated chat is shown as plain text with its badges' roles", async () => {
    const { relay } = relayWith(() => []);
    await relay.simulated({
      message_id: 's1',
      text: '!roue',
      chatter: { id: '7', login: 'v', display_name: 'V', badges: ['vip'] },
    });
    expect(relay.snapshot()[0]).toMatchObject({
      id: 's1',
      user: { badges: [{ set: 'vip', url: null }] },
      fragments: [{ t: 'text', text: '!roue' }],
    });
  });
});

describe('trigger: the chat message a module answers', () => {
  it('commandWord: « ! » + a letter or a digit; reactions are never commands', () => {
    expect(commandWord('!RB')).toBe('rb');
    expect(commandWord('!solde @x')).toBe('solde');
    for (const t of ['!!!!!', '!?!?', '! salut', 'salut'])
      expect(commandWord(t)).toBeNull();
  });

  it('the router runs every module inside the trigger; the steps they write carry it; the observer sees the message', async () => {
    const seen: unknown[] = [];
    const observed: unknown[] = [];
    const router = new LabChatRouter(
      [
        {
          name: 'random_ban',
          chat: async () => {
            seen.push(
              currentTrigger(),
              withTriggerParams({ mode: 'normal', text: 'ok' }),
            );
            return { outcome: 'accepted' };
          },
        },
      ],
      (m, handled) =>
        observed.push([m.message_id, handled.map((h) => h.module)]),
    );
    await router.message({
      channel_id: '900100',
      message_id: 'v1',
      text: '!rb',
      chatter: { id: '1', login: 'a', display_name: 'A', role: 'viewer' },
      source: 'simulator',
    });
    expect(seen).toEqual([
      { message_id: 'v1', command: 'rb' },
      {
        mode: 'normal',
        text: 'ok',
        trigger: { message_id: 'v1', command: 'rb' },
      },
    ]);
    expect(observed).toEqual([['v1', ['random_ban']]]);
    expect(withTriggerParams({ a: 1 })).toEqual({ a: 1 });
    expect(
      await withTrigger({ message_id: 'z', command: null }, async () =>
        currentTrigger(),
      ),
    ).toEqual({ message_id: 'z', command: null });
  });
});

describe('trigger closed after the answer', () => {
  it("a timer a module starts while answering writes later WITHOUT that message's trigger", async () => {
    let later: unknown = 'not run';
    await withTrigger({ message_id: 'v9', command: 'roue' }, async () => {
      expect(currentTrigger()).toEqual({ message_id: 'v9', command: 'roue' });
      setTimeout(
        () =>
          (later = withTriggerParams({ mode: 'announce', text: 'Level Up' })),
        5,
      );
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(later).toEqual({ mode: 'announce', text: 'Level Up' });
  });
});

describe('command catalogue', () => {
  it('Commands V2 (aliases together), the modules, the bot, the discovered words: each word once', async () => {
    const db = {
      query: async () => [
        {
          command_id: 'c-1',
          name: 'discord',
          enabled: true,
          config: { aliases: ['dc'], category: 'Infos' },
        },
      ],
    };
    const list = await buildCatalog({
      db: db as never,
      channelId: '83603689',
      reserved: async () => [
        { word: 'join', module: 'raffle' },
        { word: 'tts', module: 'TTS' },
        { word: 'objectif', module: 'Objectif de la soirée' },
      ],
      discovered: new Map([
        ['nouvelle', 'mini_games'],
        ['dc', 'commands'],
      ]),
    });
    const words = list.flatMap((c) => c.words);
    expect(new Set(words).size).toBe(words.length);
    expect(list.find((c) => c.key === 'v2:c-1')).toMatchObject({
      words: ['discord', 'dc'],
      module: 'Commandes : Infos',
      source: 'commands_v2',
    });
    expect(list.find((c) => c.words.includes('solde'))!.words).toEqual([
      'solde',
      'balance',
      'compte',
    ]);
    expect(list.find((c) => c.words.includes('join'))).toMatchObject({
      module: 'Tombola',
      source: 'module',
    });
    expect(list.find((c) => c.words.includes('nouvelle'))).toMatchObject({
      key: 'found:nouvelle',
      source: 'discovered',
    });
    for (const w of [
      'rb',
      'tts',
      'fxcam',
      'daily',
      'roue',
      'song',
      'caution',
      'votekick',
      'duel',
      'addpoints',
    ])
      expect(words, w).toContain(w);
  });
});
