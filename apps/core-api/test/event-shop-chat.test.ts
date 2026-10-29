import { randomUUID } from 'node:crypto';
import type { LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { EVENT_CHAT_HELP_COOLDOWN_MS } from '../src/event-shop/chat.js';
import { chatRouter } from '../src/lab-chat/games.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// Halloween shop in the chat (docs/HALLOWEEN.md): `!peur`, `!bonbons` on the main Core's chat games — silent while the
// event is closed, the same rules as the extension, one purchase per Twitch message.

const CH = '83603689';
const alice = {
  id: '9101',
  login: 'alice',
  display_name: 'Alice',
  role: 'viewer' as const,
};
let n = 0;
const msg = (text: string, id = `tw-${++n}`): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: alice,
  source: 'twitch',
});

async function lab({ open = true, ready = true } = {}) {
  const core = await setup();
  core.clock.set(new Date('2026-10-31T20:00:00Z'));
  const shop = core.eventShop;
  if (open)
    await shop.updateSettings(CH, {
      enabled: true,
      rules: { viewer_gap_ms: 0, conversion_rate: 100 },
    });
  if (ready)
    await shop.heartbeat({
      studio_instance_id: 'studio-1',
      channel_id: CH,
      engine_ready: true,
      media: ['foxy', 'golden-freddy'],
    });
  await shop.grant(
    {
      idempotency_key: randomUUID(),
      channel_id: CH,
      viewer: alice.id,
      amount: 15,
      reason: 'grant',
    },
    'test',
  );
  const router = chatRouter(core.raffleLab, core.chat.chatModules);
  const say = (text: string, id?: string) => router.message(msg(text, id));
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'evs:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const balance = async () => (await shop.viewerState(CH, alice.id)).balance;
  return { core, shop, say, replies, balance };
}

describe('Halloween shop in the chat', () => {
  it('closed: !peur and !bonbons stay silent', async () => {
    const { say, replies } = await lab({ open: false });
    expect((await say('!peur blink')).handled).toEqual([]);
    expect((await say('!bonbons')).handled).toEqual([]);
    expect(await replies()).toEqual([]);
  });

  it('!peur <effet>: bought once per Twitch message, the balance answered', async () => {
    const { say, replies, balance } = await lab();
    const out = await say('!peur blink', 'tw-blink');
    expect(out.handled[0]).toMatchObject({
      module: 'event_shop',
      outcome: 'event_bought',
    });
    const after = await balance();
    expect(after).toBeLessThan(15);
    // The same Twitch message again (adapter retry): nothing more debited, no second answer.
    await say('!peur blink', 'tw-blink');
    expect(await balance()).toBe(after);
    expect(await replies()).toHaveLength(1);
    expect((await replies())[0]).toContain('Clignement');
  });

  it('refusals cost nothing and say why: one at a time, offline overlay, not enough Bonbons', async () => {
    const { say, replies, balance } = await lab();
    await say('!peur blink');
    const left = await balance();
    expect((await say('!peur fog')).handled[0]?.outcome).toBe(
      'event_refused:busy',
    );
    expect(await balance()).toBe(left);
    expect((await replies()).at(-1)).toContain('rien n’a été débité');

    const off = await lab({ ready: false });
    expect((await off.say('!peur blink')).handled[0]?.outcome).toBe(
      'event_refused:engine_offline',
    );
  });

  it('!peur foxy names its screamer; !peur screamer picks one available', async () => {
    const { say, shop } = await lab();
    const out = await say('!peur foxy');
    expect(out.handled[0]?.outcome).toBe('event_bought');
    const admin = await shop.admin(CH);
    expect(admin.purchases[0]?.item_id).toBe('s-foxy');
    await shop.stopAll(CH);
    const random = await say('!peur screamer');
    expect(random.handled[0]?.outcome).toMatch(/^event_(bought|refused)/);
  });

  it('!bonbons: the balance (throttled); !bonbons <n>: Jetons exchanged within the hourly cap', async () => {
    const { say, replies, balance, core } = await lab();
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      alice.id,
      'set',
      { tokens: 10_000 },
      'test',
    );
    await say('!bonbons');
    expect((await replies())[0]).toContain('15 Bonbons');
    expect((await say('!bonbons')).handled[0]?.outcome).toBe(
      'event_help_throttled',
    );
    core.clock.advance(EVENT_CHAT_HELP_COOLDOWN_MS);
    expect((await say('!bonbons 3')).handled[0]?.outcome).toBe(
      'event_converted',
    );
    expect(await balance()).toBe(18);
    expect((await say('!bonbons 50')).handled[0]?.outcome).toBe(
      'event_refused:conversion_cap',
    );
    expect(await balance()).toBe(18);
  });

  it('!peur alone: the menu, with the prices', async () => {
    const { say, replies } = await lab();
    await say('!peur');
    const menu = (await replies())[0]!;
    expect(menu).toContain('blink 2');
    expect(menu).toContain('!peur screamer');
  });
});
