import { randomUUID } from 'node:crypto';
import {
  LabModerationCommand,
  type LabActor,
  type LabChatMessage,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { ChannelPointsService } from '../src/channel-points/service.js';
import { CpTwitchActions } from '../src/channel-points/twitch-actions.js';
import { chatRouter } from '../src/lab-chat/games.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { editWallet, LabForbiddenError } from '../src/lab-moderation/store.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { setup } from './helpers.js';

// Random Ban in the moderation (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 8): the existing D4 permissions, audit, blocks
// and personal cooldowns; Random Ban's own history, « À vérifier », cancel, manual refund, bonus revocation, pause —
// every money movement once, every intervention audited with its author and reason.

const CH = '83603689';
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const ext = (
  id: string,
  role: LabActor['role'],
  login = `u${id}`,
): LabActor => ({
  id,
  login,
  display_name: login,
  role,
  via: 'extension',
});
const mod = ext('900102', 'moderator', 'modo');
const viewer = ext('900101', 'viewer', 'lab_viewer');
const ALICE = {
  id: '9001',
  login: 'alice',
  display_name: 'Alice',
  role: 'viewer' as const,
};
const KIWI = { id: '990001', login: 'kiwi', name: 'Kiwi' };
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
let n = 0;
const msg = (text: string): LabChatMessage => ({
  channel_id: CH,
  message_id: `tw-${++n}`,
  text,
  chatter: ALICE,
  source: 'twitch',
});

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-11-12T20:00:00Z'));
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    ALICE.id,
    'set',
    { tokens: 1_000_000 },
    'test',
  );
  const rb = core.randomBan;
  rb.candidates = async () => [KIWI];
  const m = rb.moderation!;
  const router = chatRouter(core.raffleLab, core.chat.chatModules);
  const d4 = new LabModerationService(
    core.db,
    core.clock,
    core.ttsLab,
    core.soundLab,
    core.bonkLab,
    new RaffleLabService(core.db, core.clock),
    core.economy,
  );
  const d4act = (command: Record<string, unknown>, actor: LabActor = studio) =>
    d4.act(CH, { actor, command: LabModerationCommand.parse(command) });
  const say = async (text: string) =>
    (await router.message(msg(text))).handled[0]?.outcome;
  const tokens = async (id = ALICE.id) =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, id],
        )
      )[0]?.tokens ?? 0,
    );
  const last = async () =>
    (
      await core.db.query<{
        request_id: string;
        status: string;
        refund: string;
      }>(
        'select request_id, status, refund from rb_requests order by seq desc limit 1',
      )
    )[0]!;
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'rb:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const audits = (action: string) =>
    core.db.query<{
      actor: string;
      reason: string;
      interaction_id: string | null;
    }>(
      'select actor, reason, interaction_id from lab_moderation_audit where action = $1',
      [action],
    );
  const forbidden = async (p: Promise<unknown>) => {
    try {
      await p;
      return false;
    } catch (e) {
      return e instanceof LabForbiddenError;
    }
  };
  await rb.claim(CH, EXEC);
  return { core, rb, m, say, tokens, last, replies, audits, forbidden, d4act };
}

describe('Random Ban moderation', () => {
  it('cancel a queued !rb: canceled, Jetons back once, the chat told; a viewer may not; never twice', async () => {
    const l = await lab();
    // Two in the queue: the first is being searched, the second still waits.
    await l.say('!rb');
    await l.rb.claim(CH, EXEC);
    await l.say('!rb');
    const queued = await l.last();
    expect(queued.status).toBe('queued');
    expect(
      await l.forbidden(
        l.m.act(CH, viewer, {
          action: 'cancel',
          request_id: queued.request_id,
          reason: 'x',
        }),
      ),
    ).toBe(true);
    await l.m.act(CH, mod, {
      action: 'cancel',
      request_id: queued.request_id,
      reason: 'demande en double',
    });
    expect(await l.last()).toMatchObject({
      status: 'canceled',
      refund: 'none',
    });
    expect(await l.tokens()).toBe(1_000_000 - 25_000);
    await expect(
      l.m.act(CH, mod, {
        action: 'cancel',
        request_id: queued.request_id,
        reason: 'encore',
      }),
    ).rejects.toMatchObject({ code: 'not_cancelable' });
    expect(await l.tokens()).toBe(1_000_000 - 25_000);
    expect(await l.replies()).toContain(
      '@Alice - Random Ban annulé par la modération · 25 000 Jetons remboursés.',
    );
    expect(await l.audits('random_ban.cancel')).toMatchObject([
      {
        actor: 'modo',
        reason: 'demande en double',
        interaction_id: queued.request_id,
      },
    ]);
    // A canceled request gives its charge back (the one being searched still uses one).
    expect((await l.rb.buyerState(CH, ALICE.id)).charges.available).toBe(2);
  });

  it('a request being searched cannot be canceled (the executor holds it)', async () => {
    const l = await lab();
    await l.say('!rb');
    const c = (await l.rb.claim(CH, EXEC)).request!;
    await expect(
      l.m.act(CH, mod, {
        action: 'cancel',
        request_id: c.request_id,
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: 'not_cancelable' });
  });

  it('refund an uncertain result: « refund.manual » only (a plain moderator may not), once', async () => {
    const l = await lab();
    await l.say('!rb');
    const c = (await l.rb.claim(CH, EXEC)).request!;
    await l.rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: KIWI,
      is_sub: false,
      stats: { chatters: 1, candidates: 1, follow_checks: 1 },
    });
    await l.rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'uncertain',
    });
    const before = await l.tokens();
    expect(
      await l.forbidden(
        l.m.act(CH, mod, {
          action: 'refund_uncertain',
          request_id: c.request_id,
          reason: 'vérifié',
        }),
      ),
    ).toBe(true);
    await l.m.act(CH, studio, {
      action: 'refund_uncertain',
      request_id: c.request_id,
      reason: 'vérifié sur Twitch',
    });
    expect(await l.tokens()).toBe(before + 25_000);
    await expect(
      l.m.act(CH, studio, {
        action: 'refund_uncertain',
        request_id: c.request_id,
        reason: 'encore',
      }),
    ).rejects.toMatchObject({ code: 'not_refundable' });
    expect(await l.tokens()).toBe(before + 25_000);
  });

  it('revoke a Sniper bonus: wallet.admin, taken back once, `revoked`, audited', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban_ext.enabled', 1, 'test');
    await l.core.modules.viewer(CH, 'random_ban_ext', 'launch', {
      viewer: { id: ALICE.id, display_name: 'Alice' },
      idempotency_key: 'intent-revoke-1',
      input: { expected_price: 25_000, wish_id: KIWI.id },
    });
    const c = (await l.rb.claim(CH, EXEC)).request!;
    await l.rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: KIWI,
      is_sub: false,
      stats: { chatters: 1, candidates: 1, follow_checks: 1 },
    });
    await l.rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'confirmed',
    });
    const paid = await l.tokens();
    expect(
      await l.forbidden(
        l.m.act(CH, mod, {
          action: 'revoke_bonus',
          request_id: c.request_id,
          reason: 'multicompte',
        }),
      ),
    ).toBe(true);
    await l.m.act(CH, studio, {
      action: 'revoke_bonus',
      request_id: c.request_id,
      reason: 'multicompte',
    });
    expect(await l.tokens()).toBe(paid - 2_000);
    await expect(
      l.m.act(CH, studio, {
        action: 'revoke_bonus',
        request_id: c.request_id,
        reason: 'encore',
      }),
    ).rejects.toMatchObject({ code: 'no_bonus' });
    expect(await l.tokens()).toBe(paid - 2_000);
    expect(await l.audits('random_ban.revoke_bonus')).toHaveLength(1);
  });

  it('pause: no purchase (nothing debited), the executor takes nothing; resume', async () => {
    const l = await lab();
    await l.m.act(CH, mod, { action: 'pause', reason: 'raid en cours' });
    expect(await l.say('!rb')).toBe('rb_refused');
    expect(await l.tokens()).toBe(1_000_000);
    expect((await l.replies()).at(-1)).toBe(
      '@Alice - Random Ban en pause pour le moment · rien n’a été débité.',
    );
    await l.m.act(CH, mod, { action: 'resume', reason: 'fini' });
    expect(await l.say('!rb')).toBe('rb_queued');
    expect((await l.m.history(CH, mod)).paused).toBe(false);
  });

  it('D4 block and personal cooldown with module « random_ban »: !rb refused before any debit', async () => {
    const l = await lab();
    await l.d4act({
      action: 'block_viewer',
      viewer_id: ALICE.id,
      module: 'random_ban',
      duration_s: 600,
      reason: 'abus',
    });
    expect(await l.say('!rb')).toBe('rb_refused');
    expect((await l.replies()).at(-1)).toBe(
      '@Alice - Random Ban indisponible pour ton compte · rien n’a été débité.',
    );
    await l.d4act({
      action: 'unblock_viewer',
      viewer_id: ALICE.id,
      module: 'random_ban',
      reason: 'ok',
    });
    // One refusal line per viewer every 5 min: the next one is told after that.
    l.core.clock.advance(5 * 60_000);
    await l.rb.claim(CH, EXEC);
    await l.d4act({
      action: 'set_cooldown',
      viewer_id: ALICE.id,
      module: 'random_ban',
      delay_s: 900,
      span: 3600,
      reason: 'calme-toi',
    });
    expect(await l.say('!rb')).toBe('rb_queued');
    expect(await l.say('!rb')).toBe('rb_refused');
    expect((await l.replies()).at(-1)).toBe(
      '@Alice - Random Ban bloqué pour toi encore 15 min · rien n’a été débité.',
    );
    expect(await l.tokens()).toBe(1_000_000 - 25_000);
  });

  it('channel points under a moderation block: no Random Ban, points back on a Raptoru reward, told after Twitch', async () => {
    const l = await lab();
    const twitch = new CpTwitchActions(l.core.db, l.core.clock);
    const cp = new ChannelPointsService(
      l.core.db,
      l.core.clock,
      l.core.soundLab,
      l.rb,
      undefined,
      undefined,
      twitch,
    );
    await cp.syncRewards({
      channel_id: CH,
      rewards: [
        { id: 'reward-rb', title: 'Random Ban', cost: 3000, is_enabled: true },
      ],
    });
    await l.core.db.query(`update cp_rewards set managed_by_raptoru = true`);
    await cp.saveRule(CH, 'reward-rb', {
      enabled: true,
      actions: [{ type: 'interaction', interaction: 'random_ban' }],
    });
    await cp.setEnabled(CH, true, 'test');
    await l.d4act({
      action: 'block_viewer',
      viewer_id: ALICE.id,
      module: 'random_ban',
      duration_s: 600,
      reason: 'abus',
    });
    const r = await cp.receive({
      channel_id: CH,
      source: 'twitch',
      redemption_id: randomUUID(),
      reward: { id: 'reward-rb', title: 'Random Ban', cost: 3000 },
      user: { id: ALICE.id, login: 'alice', display_name: 'Alice' },
      twitch_status: 'unfulfilled',
      redeemed_at: l.core.clock.now().toISOString(),
    });
    expect(r.redemption.results[0]!.error).toContain(
      'Random Ban indisponible pour ton compte',
    );
    expect((await l.core.db.query('select 1 from rb_requests')).length).toBe(0);
    const { action } = await twitch.claim(CH);
    await twitch.report(CH, action!.action_id, {
      attempt_id: action!.attempt_id,
      outcome: 'done',
    });
    expect((await l.replies()).at(-1)).toBe(
      '@Alice - Random Ban indisponible pour ton compte · points remboursés.',
    );
  });

  it('history (team only) and « À vérifier »: an uncertain result and a request stuck for more than 2 min', async () => {
    const l = await lab();
    expect(await l.forbidden(l.m.history(CH, viewer))).toBe(true);
    await l.say('!rb');
    const c = (await l.rb.claim(CH, EXEC)).request!;
    await l.rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: KIWI,
      is_sub: false,
      stats: { chatters: 1, candidates: 1, follow_checks: 1 },
    });
    await l.rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'uncertain',
    });
    const h = await l.m.history(CH, mod);
    expect(h.requests[0]).toMatchObject({
      source: 'chat',
      status: 'uncertain',
      price_paid: 25_000,
      buyer: { name: 'Alice' },
    });
    const rec = await l.m.reconciliation(CH, mod);
    expect(rec.items.map((i) => i.why)).toEqual(['timeout_incertain']);
  });

  it('refill_charges (any moderator): the viewer’s charges full again, audited; a viewer may not', async () => {
    const l = await lab();
    for (let i = 0; i < 3; i++) await l.say('!rb');
    expect((await l.rb.buyerState(CH, ALICE.id)).charges.available).toBe(0);
    const cmd = {
      action: 'refill_charges' as const,
      viewer_id: ALICE.id,
      reason: 'geste',
    };
    expect(await l.forbidden(l.m.act(CH, viewer, cmd))).toBe(true);
    await l.m.act(CH, mod, cmd);
    expect((await l.rb.buyerState(CH, ALICE.id)).charges.available).toBe(3);
    expect(await l.audits('random_ban.refill_charges')).toMatchObject([
      { actor: 'modo', reason: 'geste' },
    ]);
  });
});
