import type { LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { chatRouter } from '../src/lab-chat/games.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { TTS_HELP_COOLDOWN_MS } from '../src/tts-lab/chat.js';
import { count, setup } from './helpers.js';

// `!tts <message>` in the chat (docs/CHAT_COMMANDS.md): the extension's TTS purchase (TtsLabService.admit) for the chat
// author, once per Twitch message, answered on the durable chat queue. Same price, controls and refusals as the
// extension; invalid forms do nothing at all.

const CH = '900100';
const STUDIO_ACTOR = {
  id: 'antoni',
  role: 'broadcaster' as const,
  via: 'studio' as const,
};
const STUDIO = 'studio-A';
const alice = {
  id: '900201',
  login: 'alice',
  display_name: 'Alice',
  role: 'viewer' as const,
};
const bob = {
  id: '900202',
  login: 'bob',
  display_name: 'Bob',
  role: 'viewer' as const,
};
let n = 0;
const msg = (
  text: string,
  chatter = alice,
  id = `tw-${++n}`,
): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter,
  source: 'twitch',
});

async function lab(tokens = 100_000) {
  const core = await setup();
  await core.ttsLab.heartbeat({
    studio_instance_id: STUDIO,
    player_ready: true,
  });
  for (const v of [alice, bob])
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      v.id,
      'set',
      { tokens },
      'test',
    );
  const router = chatRouter(core.raffleLab, core.chat.chatModules);
  const tokensOf = async (id: string) =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, id],
        )
      )[0]?.tokens,
    );
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'tts:msg:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const interactions = () => count(core.db, 'tts_lab_interactions');
  return { core, router, tokensOf, replies, interactions };
}

describe('!tts in the chat', () => {
  it('a valid message buys the extension TTS: same price (tier), random cast by Core, the author pays', async () => {
    const l = await lab();
    const out = await l.router.message(msg('!tts coucou les amis @Bob'));
    expect(out.handled).toEqual([
      { module: 'tts', outcome: 'tts_queued', replayed: false },
    ]);
    const [row] = await l.core.db.query<{
      viewer_id: string;
      message: string;
      simulated_cost: number;
      character_id: string;
      lab_session_id: string;
    }>(
      'select viewer_id, message, simulated_cost, character_id, lab_session_id from tts_lab_interactions',
    );
    // The author pays, never the @mentioned viewer: the mention is only text.
    expect(row).toMatchObject({
      viewer_id: alice.id,
      message: 'coucou les amis @Bob',
      simulated_cost: 7500,
      lab_session_id: 'chat',
    });
    expect(row!.character_id).toBeTruthy();
    expect(await l.tokensOf(alice.id)).toBe(100_000 - 7500);
    expect(await l.tokensOf(bob.id)).toBe(100_000);
    // Next in line: no success message (the voice is the answer).
    expect(await l.replies()).toEqual([]);
  });

  it('a TTS that waits behind another one: one short message with its position (nothing said when it plays next)', async () => {
    const l = await lab();
    await l.router.message(msg('!tts premier', alice));
    await l.router.message(msg('!tts deuxième', bob));
    expect(await l.replies()).toEqual(['@Bob - TTS en file, position 2.']);
    expect(await l.tokensOf(bob.id)).toBe(100_000 - 7500);
  });

  it('the price follows the length like in the extension (tier 81–150 → 11 250)', async () => {
    const l = await lab();
    await l.router.message(msg(`!tts ${'a'.repeat(100)}`));
    expect(await l.tokensOf(alice.id)).toBe(100_000 - 11_250);
  });

  it('the same Twitch message delivered twice: one TTS, one debit, one answer', async () => {
    const l = await lab();
    const m = msg('!tts une seule fois');
    await l.router.message(m);
    const again = await l.router.message(m);
    expect(again.handled).toEqual([
      { module: 'tts', outcome: 'tts_replayed', replayed: true },
    ]);
    expect(await l.interactions()).toBe(1);
    expect(await l.tokensOf(alice.id)).toBe(100_000 - 7500);
    expect(await l.replies()).toHaveLength(0);
  });

  it('`!tts` alone: the help with the first tier price, free, nothing admitted; at most once per 30 s per viewer', async () => {
    const l = await lab();
    expect((await l.router.message(msg('!tts'))).handled).toEqual([
      { module: 'tts', outcome: 'tts_help' },
    ]);
    expect((await l.router.message(msg('  !TTS  '))).handled).toEqual([
      { module: 'tts', outcome: 'tts_help_throttled' },
    ]);
    expect(await l.replies()).toEqual([
      '@Alice - Écris ton message après la commande - 7 500 Jetons',
    ]);
    expect(await l.interactions()).toBe(0);
    expect(await l.tokensOf(alice.id)).toBe(100_000);
    l.core.clock.advance(TTS_HELP_COOLDOWN_MS);
    expect((await l.router.message(msg('!tts'))).handled).toEqual([
      { module: 'tts', outcome: 'tts_help' },
    ]);
  });

  it('invalid forms are not commands: no debit, no TTS, no answer', async () => {
    const l = await lab();
    for (const text of [
      'Salut !tts coucou',
      '!ttscoucou',
      'tts coucou',
      '!tt coucou',
      'coucou !tts',
    ])
      expect((await l.router.message(msg(text))).handled).toEqual([]);
    expect(await l.interactions()).toBe(0);
    expect(await l.tokensOf(alice.id)).toBe(100_000);
    expect(await l.replies()).toEqual([]);
  });

  it('not enough Jetons: the real price, balance and gap; nothing debited, nothing admitted, no cooldown', async () => {
    const l = await lab(1200);
    await l.router.message(msg('!tts coucou'));
    expect(await l.replies()).toEqual([
      '@Alice - Il te faut 7 500 Jetons pour utiliser TTS. Solde : 1 200 Jetons (il te manque 6 300).',
    ]);
    expect(await l.interactions()).toBe(0);
    expect(await l.tokensOf(alice.id)).toBe(1200);
    // No cooldown consumed: with Jetons, the next message goes through at once.
    await editWallet(
      l.core.db,
      l.core.clock.now(),
      CH,
      alice.id,
      'set',
      { tokens: 10_000 },
      'test',
    );
    expect(
      (await l.router.message(msg('!tts coucou'))).handled[0],
    ).toMatchObject({ outcome: 'tts_queued' });
  });

  it('same refusals as the extension (busy, cooldown, blocked, paused, disabled), before any debit', async () => {
    const l = await lab();
    const tts = l.core.ttsLab;
    const expectNothingPaid = async () => {
      expect(await l.interactions()).toBe(1);
      expect(await l.tokensOf(alice.id)).toBe(100_000 - 7500);
    };
    await l.router.message(msg('!tts premier'));
    // One TTS at a time per viewer (the extension's rule).
    await l.router.message(msg('!tts deuxième'));
    // Moderation cooldown, block, pause, disable: Bob tries each time.
    const until = new Date(l.core.clock.now().getTime() + 90_000).toISOString();
    await tts.moderate(CH, {
      action: 'set_viewer_cooldown',
      actor: 'mod',
      viewer_id: bob.id,
      until,
    });
    await l.router.message(msg('!tts trop tôt', bob));
    await tts.moderate(CH, {
      action: 'set_viewer_cooldown',
      actor: 'mod',
      viewer_id: bob.id,
      until: null,
    });
    await tts.moderate(CH, {
      action: 'block_viewer',
      actor: 'mod',
      viewer_id: bob.id,
      until: null,
    });
    await l.router.message(msg('!tts bloqué', bob));
    await tts.moderate(CH, {
      action: 'unblock_viewer',
      actor: 'mod',
      viewer_id: bob.id,
    });
    await tts.moderate(CH, { action: 'pause', actor: 'mod' });
    await l.router.message(msg('!tts en pause', bob));
    await tts.moderate(CH, { action: 'disable', actor: 'mod' });
    await l.router.message(msg('!tts désactivé', bob));
    expect(await l.replies()).toEqual([
      '@Alice - Ton TTS précédent n’est pas encore terminé.',
      '@Bob - Prochain TTS dans 1 min 30 · rien n’a été débité.',
      '@Bob - TTS indisponible pour ton compte.',
      '@Bob - TTS en pause · rien n’a été débité.',
      '@Bob - TTS désactivé.',
    ]);
    await expectNothingPaid();
    expect(await l.tokensOf(bob.id)).toBe(100_000);
  });

  it('player offline: refused, nothing debited', async () => {
    const l = await lab();
    await l.core.ttsLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: false,
    });
    await l.router.message(msg('!tts coucou'));
    expect(await l.replies()).toEqual([
      '@Alice - TTS indisponible pour le moment.',
    ]);
    expect(await l.interactions()).toBe(0);
    expect(await l.tokensOf(alice.id)).toBe(100_000);
  });

  it('chat and extension at the same time for one viewer: one TTS admitted, one refused, one debit', async () => {
    const l = await lab();
    const [fromChat, fromExt] = await Promise.allSettled([
      l.router.message(msg('!tts depuis le chat')),
      l.core.ttsLab.admit({
        idempotency_key: 'ext-key-1',
        channel_id: CH,
        viewer: { id: alice.id, display_name: 'Alice' },
        lab_session_id: 'ext-staging',
        text: 'depuis l’extension',
        payment_method: 'tokens',
      }),
    ]);
    expect(fromChat.status).toBe('fulfilled');
    expect(await l.interactions()).toBe(1);
    expect(await l.tokensOf(alice.id)).toBe(100_000 - 7500);
    if (fromExt.status === 'fulfilled')
      expect(await l.replies()).toEqual([
        '@Alice - Ton TTS précédent n’est pas encore terminé.',
      ]);
    else expect((fromExt.reason as { code: string }).code).toBe('viewer_busy');
  });

  it('!tts is reserved for the TTS: Commands V2 refuses it as a command word', async () => {
    const l = await lab();
    // What Studio's Commands V2 tab shows as taken (and what the admission ignores at chat time).
    const list = await l.core.chat.commands.list(CH, STUDIO_ACTOR);
    expect(list.reserved_words).toContainEqual(
      expect.objectContaining({ word: 'tts', module: 'TTS' }),
    );
    const out = await l.router.message(msg('!tts coucou'));
    expect(out.handled.map((h) => h.module)).toEqual(['tts']);
  });
});
