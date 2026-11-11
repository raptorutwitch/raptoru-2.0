import { randomUUID } from 'node:crypto';
import type { LabActor, LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it, vi } from 'vitest';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { editWallet } from '../src/lab-moderation/store.js';
import {
  CHAT_ADJUST_MAX,
  parseAdminWallet,
  WalletAdminChat,
} from '../src/wallet/admin-chat.js';
import type { LoginLookup } from '../src/mini-games/twitch-login.js';
import { setup } from './helpers.js';

// Post-live 11/11: the moderators' Jetons commands of the chat (`!addpoints` / `!removepoints`, aliases `!crediter` /
// `!debiter`) are ONE call to the moderation's `wallet_adjust`: same permission (« Portefeuille »), same economy,
// same audit and the same idempotency as the extension's Portefeuille. Lab test wallet only.

const CH = '900100';
type Role = LabChatMessage['chatter']['role'];
const who = (id: string, login: string, role: Role) => ({
  id,
  login,
  display_name: login,
  role,
});
const broadcaster = who(CH, 'raptoru_lab', 'broadcaster');
const supermod = who('900108', 'grobinou', 'moderator');
const granted = who('900102', 'lab_modo', 'moderator');
const plainMod = who('900107', 'modo_b', 'moderator');
const viewer = who('900101', 'lab_viewer', 'viewer');
const target = { id: '900200', login: 'aouh', display_name: 'Aouh' };

let n = 0;
const msg = (
  chatter: ReturnType<typeof who>,
  text: string,
  id = `tw-${++n}`,
): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter,
  source: 'twitch',
});
const ext = (c: ReturnType<typeof who>): LabActor => ({
  ...c,
  via: 'extension',
});

async function lab(lookup: LoginLookup | null = async (login) =>
  login === target.login ? target : null) {
  const core = await setup();
  core.clock.set(new Date('2026-11-11T20:00:00Z'));
  const m = new LabModerationService(
    core.db,
    core.clock,
    core.ttsLab,
    core.soundLab,
    core.bonkLab,
    core.raffleLab,
  );
  const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
  // The team: seen through the extension (D4), then named / granted by the broadcaster.
  for (const c of [supermod, granted, plainMod]) await m.whoami(CH, ext(c));
  await m.act(CH, {
    actor: studio,
    command: { action: 'set_staff', viewer_id: supermod.id, role: 'supermod' },
  });
  await m.act(CH, {
    actor: studio,
    command: {
      action: 'set_permission',
      viewer_id: granted.id,
      permission: 'wallet',
      granted: true,
    },
  });
  await editWallet(core.db, core.clock.now(), CH, target.id, 'set', { tokens: 1_000 }, 'test');
  const spy = vi.fn(lookup ?? (async () => null));
  const chat = new WalletAdminChat(core.db, core.clock, m, lookup ? spy : null);
  const tokens = async (id = target.id) =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, id],
        )
      )[0]?.tokens ?? 0,
    );
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'wallet-admin:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const audit = () =>
    core.db.query<{ actor: string; role: string; reason: string | null; after: { applied: number } }>(
      `select actor, role, reason, after from lab_moderation_audit where action = 'wallet_adjust' order by id`,
    );
  return { core, m, chat, spy, tokens, replies, audit };
}

describe('!addpoints / !removepoints: parsing', () => {
  it('reads both orders, the reason, and nothing else', () => {
    expect(parseAdminWallet('!addpoints @Aouh 500 bravo pour le dessin')).toEqual({
      kind: 'adjust', sign: 1, login: 'aouh', amount: 500, reason: 'bravo pour le dessin',
    });
    expect(parseAdminWallet('!crediter 500 aouh')).toMatchObject({ kind: 'adjust', sign: 1, login: 'aouh' });
    expect(parseAdminWallet('!DEBITER @aouh 20')).toMatchObject({ kind: 'adjust', sign: -1, amount: 20 });
    expect(parseAdminWallet('!removepoints @aouh 1')).toMatchObject({ sign: -1, amount: 1 });
    expect(parseAdminWallet('!addpointsx @aouh 5')).toBeNull();
    expect(parseAdminWallet('salut !addpoints @aouh 5')).toBeNull();
  });
  it('never accepts a sign, a decimal, a suffix, zero, or a missing / malformed target', () => {
    for (const t of [
      '!addpoints @aouh -5',
      '!addpoints @aouh +5',
      '!addpoints @aouh 1.5',
      '!addpoints @aouh 1,5',
      '!addpoints @aouh 10k',
      '!addpoints @aouh 0',
      '!addpoints @aouh',
      '!addpoints 500',
      '!addpoints @a 500',
      '!addpoints @aouh!! 500',
      '!addpoints',
    ])
      expect(parseAdminWallet(t)?.kind, t).toBe('usage');
    expect(parseAdminWallet(`!addpoints @aouh ${CHAT_ADJUST_MAX + 1}`)?.kind).toBe('too_much');
    expect(parseAdminWallet('!addpoints @aouh 99999999999999999999999')?.kind).toBe('too_much');
  });
});

describe('!addpoints / !removepoints: the moderation’s wallet_adjust', () => {
  it('the broadcaster credits: the balance moves once, the chat says it, the audit keeps who / why', async () => {
    const t = await lab();
    const out = await t.chat.chat(msg(broadcaster, '!addpoints @Aouh 500 cadeau du live'));
    expect(out.outcome).toBe('wallet_credited');
    expect(await t.tokens()).toBe(1_500);
    expect(await t.replies()).toEqual(['@raptoru_lab - 500 Jetons crédités à @Aouh (solde : 1 500).']);
    expect(await t.audit()).toMatchObject([
      { actor: 'raptoru_lab', role: 'broadcaster', reason: 'cadeau du live', after: { applied: 500 } },
    ]);
  });

  it('a supermod and a moderator granted « Portefeuille » may; a plain moderator and a viewer may not', async () => {
    const t = await lab();
    expect((await t.chat.chat(msg(supermod, '!crediter @aouh 100'))).outcome).toBe('wallet_credited');
    expect((await t.chat.chat(msg(granted, '!debiter @aouh 50'))).outcome).toBe('wallet_debited');
    expect((await t.chat.chat(msg(plainMod, '!addpoints @aouh 1000'))).outcome).toBe('wallet_forbidden');
    expect((await t.chat.chat(msg(viewer, '!addpoints @aouh 1000'))).outcome).toBe('wallet_forbidden');
    expect(await t.tokens()).toBe(1_050);
    const r = await t.replies();
    expect(r[2]).toBe('@modo_b - permission « Portefeuille » requise.');
    expect(r[3]).toBe('@lab_viewer - commande réservée à l’équipe de modération.');
  });

  it('a viewer is refused before anything is asked to Twitch', async () => {
    const t = await lab();
    await t.chat.chat(msg(viewer, '!addpoints @aouh 1000'));
    expect(t.spy).not.toHaveBeenCalled();
  });

  it('a redelivered Twitch message moves nothing more and answers once', async () => {
    const t = await lab();
    const once = msg(broadcaster, '!addpoints @aouh 300', 'tw-same');
    await t.chat.chat(once);
    await t.chat.chat(once);
    await t.chat.chat({ ...once });
    expect(await t.tokens()).toBe(1_300);
    expect(await t.replies()).toHaveLength(1);
    expect(await t.audit()).toHaveLength(1);
  });

  it('unknown login, Twitch down, invalid amount, too much: nothing moves, an explicit answer', async () => {
    const t = await lab(async (login) => {
      if (login === 'panne') throw new Error('twitch_users_503');
      return login === target.login ? target : null;
    });
    expect((await t.chat.chat(msg(broadcaster, '!addpoints @inconnu 10'))).outcome).toBe('wallet_unknown');
    expect((await t.chat.chat(msg(broadcaster, '!addpoints @panne 10'))).outcome).toBe('wallet_lookup_failed');
    expect((await t.chat.chat(msg(broadcaster, '!addpoints @aouh -10'))).outcome).toBe('wallet_usage');
    expect((await t.chat.chat(msg(broadcaster, `!addpoints @aouh ${CHAT_ADJUST_MAX + 1}`))).outcome).toBe(
      'wallet_too_much',
    );
    expect(await t.tokens()).toBe(1_000);
    expect(await t.audit()).toHaveLength(0);
  });

  it('a removal never goes below 0 and says what it really took; then « already 0 »', async () => {
    const t = await lab();
    expect((await t.chat.chat(msg(broadcaster, '!removepoints @aouh 5000'))).outcome).toBe('wallet_debited');
    expect(await t.tokens()).toBe(0);
    expect((await t.chat.chat(msg(broadcaster, '!removepoints @aouh 5'))).outcome).toBe('wallet_nothing');
    expect(await t.replies()).toEqual([
      '@raptoru_lab - 1 000 Jetons retirés à @Aouh sur 5 000 demandés (solde : 0).',
      '@raptoru_lab - le solde de @Aouh est déjà à 0 · rien n’a été retiré.',
    ]);
  });

  it('nobody but the broadcaster adjusts their own wallet — in the chat AND in the extension', async () => {
    const t = await lab(async (login) => (login === supermod.login ? { id: supermod.id, login: supermod.login, display_name: supermod.login } : null));
    expect((await t.chat.chat(msg(supermod, '!addpoints @grobinou 1000'))).outcome).toBe('wallet_self');
    await expect(
      t.m.act(CH, {
        actor: ext(supermod),
        command: { action: 'wallet_adjust', viewer_id: supermod.id, currency: 'tokens', delta: 1000 },
        idempotency_key: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'self_adjust_forbidden' });
    expect(await t.tokens(supermod.id)).toBe(0);
  });

  it('without Twitch: a single known viewer is the target; two accounts with that login are refused', async () => {
    const t = await lab(null);
    await t.core.db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, 'aouh', 'Aouh') on conflict do nothing`,
      [target.id],
    );
    expect((await t.chat.chat(msg(broadcaster, '!addpoints @aouh 10'))).outcome).toBe('wallet_credited');
    await t.core.db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('900999', 'aouh', 'Aouh (ancien)')`,
    );
    expect((await t.chat.chat(msg(broadcaster, '!addpoints @aouh 10'))).outcome).toBe('wallet_ambiguous');
    expect(await t.tokens()).toBe(1_010);
  });
});

describe('Portefeuille: « Trouver un viewer » (post-live 11/11)', () => {
  it('`@pseudo` or `pseudo`, every account with a wallet (not only the moderation’s), the exact login first', async () => {
    const t = await lab();
    await t.core.db.query(
      `insert into viewers (twitch_user_id, login, display_name) values
         ('900300', 'aouh', 'Aouh'), ('900301', 'aouhbis', 'AouhBis'), ('900302', 'zaouhz', 'ZaouhZ')`,
    );
    for (const q of ['@aouh', 'aouh', '  @AOUH ']) {
      const found = await t.m.search(CH, q);
      expect(found[0], q).toMatchObject({ viewer_id: '900300', login: 'aouh', display_name: 'Aouh' });
      expect(found.map((f) => f.viewer_id).sort()).toEqual(['900300', '900301', '900302']);
    }
    expect(await t.m.search(CH, '@personne')).toEqual([]);
    // One line per Twitch account, even when the moderation already knows it.
    await t.m.whoami(CH, { id: '900300', login: 'aouh', display_name: 'Aouh', role: 'viewer', via: 'extension' });
    expect((await t.m.search(CH, 'aouh')).filter((f) => f.viewer_id === '900300')).toHaveLength(1);
  });
});
