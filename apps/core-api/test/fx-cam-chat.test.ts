import { randomUUID } from 'node:crypto';
import { CP_RULES } from '../src/channel-points/service.js';
import type { LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { chatRouter } from '../src/lab-chat/games.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// `!fxcam <effet>` in the chat (docs/CHAT_COMMANDS.md): the channel points FX Cam (same action, Studio job, effect
// report, expiry), paid 1 500 Jetons by the chat author; redemption + job + debit atomic, once per Twitch message,
// refunded once when the action failed for sure, never when its outcome is unknown.

const CH = '83603689';
const REWARD = 'reward-fxcam';
const STUDIO = 'studio-1';
const alice = {
  id: '9001',
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

async function lab(
  tokens = 100_000,
  { ruleEnabled = true, automations = true } = {},
) {
  const core = await setup();
  core.clock.set(new Date('2026-10-22T20:00:00Z'));
  const cp = core.channelPoints;
  await cp.syncRewards({
    channel_id: CH,
    rewards: [{ id: REWARD, title: 'FX cam', cost: 2000, is_enabled: true }],
  });
  await cp.setEnabled(CH, automations, 'test');
  await cp.saveRule(CH, REWARD, {
    enabled: ruleEnabled,
    actions: [{ type: 'interaction', interaction: 'fx_cam' }],
  });
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    alice.id,
    'set',
    { tokens },
    'test',
  );
  const router = chatRouter(core.raffleLab, core.chat.chatModules);
  const studioPolls = () => cp.claim(CH, STUDIO);
  const tokensOf = async () =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, alice.id],
        )
      )[0]?.tokens,
    );
  const chatRedemptions = () =>
    core.db.query<{
      status: string;
      reason: string | null;
      user_input: string;
      results: { status: string }[];
    }>(
      `select status, reason, user_input, results from cp_redemptions where source = 'chat' order by received_at`,
    );
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'fx:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  return { core, cp, router, studioPolls, tokensOf, chatRedemptions, replies };
}

describe('!fxcam in the chat', () => {
  it('`!fxcam drunk`: a chat redemption + its Studio job + 1 500 Jetons, together; Studio runs it; done, no refund', async () => {
    const l = await lab();
    await l.studioPolls();
    const out = await l.router.message(msg('!fxcam drunk'));
    expect(out.handled).toEqual([
      { module: 'fx_cam', outcome: 'fx_queued', replayed: false },
    ]);
    expect(await l.tokensOf()).toBe(100_000 - 1500);
    expect(await l.chatRedemptions()).toMatchObject([
      { status: 'pending', user_input: 'drunk' },
    ]);
    expect(await l.replies()).toEqual([
      '@Alice — 📸 FX Cam « drunk » en file (1 500 Jetons).',
    ]);
    // Studio: the same job as a channel points FX Cam (the resolved effect only).
    const job = (await l.cp.claim(CH, STUDIO))!;
    expect(job.actions).toEqual([
      {
        index: 0,
        action: { type: 'interaction', interaction: 'fx_cam', effect: 'drunk' },
      },
    ]);
    await l.cp.ack(job.job_id, {
      consumer_id: STUDIO,
      attempt_id: job.attempt_id,
      event: 'started',
    });
    await l.cp.ack(job.job_id, {
      consumer_id: STUDIO,
      attempt_id: job.attempt_id,
      event: 'completed',
      results: [{ index: 0, ok: true, playing: true }],
    });
    await l.cp.effectReport(job.job_id, {
      consumer_id: STUDIO,
      index: 0,
      event: 'completed',
    });
    expect(await l.chatRedemptions()).toMatchObject([
      { status: 'done', reason: null },
    ]);
    expect(await l.tokensOf()).toBe(98_500);
  });

  it('exact catalog ids only (case ignored); extra words or a sentence are not commands; unknown id or none: the list, free', async () => {
    const l = await lab();
    await l.studioPolls();
    for (const text of [
      '!fxcam drunk salut',
      'Salut !fxcam drunk',
      '!fxcamdrunk',
      '!fx cam drunk',
    ])
      expect((await l.router.message(msg(text))).handled).toEqual([]);
    expect((await l.router.message(msg('!fxcam'))).handled).toEqual([
      { module: 'fx_cam', outcome: 'fx_help' },
    ]);
    expect((await l.router.message(msg('!fxcam ivre'))).handled).toEqual([
      { module: 'fx_cam', outcome: 'fx_help_throttled' },
    ]);
    expect(await l.replies()).toEqual([
      '@Alice — Effets FX Cam : prison, bighead, pixel, drunk, glitch, rage — 1 500 Jetons (ex. !fxcam prison).',
    ]);
    l.core.clock.advance(30_000);
    await l.studioPolls();
    await l.router.message(msg('!fxcam ivre'));
    expect((await l.replies())[1]).toBe(
      '@Alice — Effet « ivre » inconnu. Effets FX Cam : prison, bighead, pixel, drunk, glitch, rage — 1 500 Jetons (ex. !fxcam prison).',
    );
    expect(await l.chatRedemptions()).toEqual([]);
    expect(await l.tokensOf()).toBe(100_000);
    expect(
      (await l.router.message(msg('  !FXCAM GLITCH '))).handled[0],
    ).toMatchObject({ outcome: 'fx_queued' });
  });

  it('the same Twitch message twice: one redemption, one job, one debit, one answer', async () => {
    const l = await lab();
    await l.studioPolls();
    const m = msg('!fxcam pixel');
    await l.router.message(m);
    expect((await l.router.message(m)).handled).toEqual([
      { module: 'fx_cam', outcome: 'fx_replayed', replayed: true },
    ]);
    expect(await l.chatRedemptions()).toHaveLength(1);
    expect(
      Number(
        (
          await l.core.db.query<{ n: string }>(
            `select count(*) as n from cp_jobs where source = 'chat'`,
          )
        )[0]!.n,
      ),
    ).toBe(1);
    expect(await l.tokensOf()).toBe(98_500);
    expect(await l.replies()).toHaveLength(1);
  });

  it('not enough Jetons: price, balance, gap; no redemption, no job', async () => {
    const l = await lab(1000);
    await l.studioPolls();
    await l.router.message(msg('!fxcam rage'));
    expect(await l.replies()).toEqual([
      '@Alice — Il te faut 1 500 Jetons pour utiliser FX Cam. Solde : 1 000 Jetons (il te manque 500).',
    ]);
    expect(await l.chatRedemptions()).toEqual([]);
    expect(await l.tokensOf()).toBe(1000);
  });

  it('refused before any debit: Studio not polling, automations OFF, FX Cam rule off, Raptoru paused', async () => {
    const unavailable =
      '@Alice — FX Cam indisponible pour le moment · rien n’a été débité.';
    let l = await lab();
    await l.router.message(msg('!fxcam drunk')); // Studio never polled
    expect(await l.replies()).toEqual([unavailable]);
    l = await lab(100_000, { automations: false });
    await l.studioPolls();
    await l.router.message(msg('!fxcam drunk'));
    expect(await l.replies()).toEqual([unavailable]);
    l = await lab(100_000, { ruleEnabled: false });
    await l.studioPolls();
    await l.router.message(msg('!fxcam drunk'));
    expect(await l.replies()).toEqual([unavailable]);
    l = await lab();
    await l.studioPolls();
    await l.core.db.query(
      `insert into lab_global_state (channel_id, paused, paused_at, paused_by, updated_at) values ($1, true, now(), 'mod', now())`,
      [CH],
    );
    await l.router.message(msg('!fxcam drunk'));
    expect(await l.replies()).toEqual([
      '@Alice — Raptoru en pause · rien n’a été débité.',
    ]);
    expect(await l.chatRedemptions()).toEqual([]);
    expect(await l.tokensOf()).toBe(100_000);
  });

  it('Studio reports a failure (nothing played): refunded once, told once', async () => {
    const l = await lab();
    await l.studioPolls();
    await l.router.message(msg('!fxcam prison'));
    const job = (await l.cp.claim(CH, STUDIO))!;
    await l.cp.ack(job.job_id, {
      consumer_id: STUDIO,
      attempt_id: job.attempt_id,
      event: 'failed',
      error: 'obs_unreachable',
    });
    expect(await l.tokensOf()).toBe(100_000);
    expect(await l.chatRedemptions()).toMatchObject([
      { status: 'failed', reason: 'jetons_refunded' },
    ]);
    await l.core.chat.fxCamChat!.settle(CH);
    expect(await l.tokensOf()).toBe(100_000);
    expect((await l.replies()).slice(1)).toEqual([
      '@Alice — FX Cam impossible pour le moment · 1 500 Jetons remboursés.',
    ]);
  });

  it('Studio gone before starting it (never started, 3 attempts): failed for sure, refunded once', async () => {
    const l = await lab();
    await l.studioPolls();
    await l.router.message(msg('!fxcam bighead'));
    for (let i = 0; i < CP_RULES.maxAttempts; i++) {
      await l.cp.claim(CH, STUDIO);
      l.core.clock.advance(CP_RULES.claimLeaseMs + 1000);
    }
    await l.cp.claim(CH, STUDIO); // the sweep expires it (studio_absent)
    expect(await l.chatRedemptions()).toMatchObject([
      { status: 'failed', reason: 'jetons_refunded' },
    ]);
    expect(await l.tokensOf()).toBe(100_000);
  });

  it('started but never reported (may have played): never refunded automatically, « à vérifier »', async () => {
    const l = await lab();
    await l.studioPolls();
    await l.router.message(msg('!fxcam glitch'));
    const job = (await l.cp.claim(CH, STUDIO))!;
    await l.cp.ack(job.job_id, {
      consumer_id: STUDIO,
      attempt_id: job.attempt_id,
      event: 'started',
    });
    l.core.clock.advance(CP_RULES.runMarginMs + 1000);
    await l.cp.claim(CH, STUDIO);
    expect(await l.chatRedemptions()).toMatchObject([
      {
        status: 'failed',
        reason: 'jetons_to_verify',
        results: [{ status: 'unknown' }],
      },
    ]);
    expect(await l.tokensOf()).toBe(98_500);
    expect(await l.replies()).toHaveLength(1);
  });

  it('a Twitch FX Cam redemption and a chat one together: two jobs in turn, only the chat one paid in Jetons', async () => {
    const l = await lab();
    await l.studioPolls();
    await Promise.all([
      l.router.message(msg('!fxcam drunk')),
      l.cp.receive({
        channel_id: CH,
        source: 'twitch',
        redemption_id: randomUUID(),
        reward: { id: REWARD, title: 'FX cam', cost: 2000 },
        user: { id: '9100', login: 'cp_user', display_name: 'CP_User' },
        user_input: 'rage',
        redeemed_at: l.core.clock.now().toISOString(),
      }),
    ]);
    expect(
      Number(
        (
          await l.core.db.query<{ n: string }>(
            `select count(*) as n from cp_jobs where status = 'queued'`,
          )
        )[0]!.n,
      ),
    ).toBe(2);
    expect(await l.tokensOf()).toBe(98_500);
    // One job in flight per channel: the second waits.
    expect(await l.cp.claim(CH, STUDIO)).not.toBeNull();
    expect(await l.cp.claim(CH, STUDIO)).toBeNull();
  });
});
