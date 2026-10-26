import type { LabChatMessage } from '@raptoru/schemas';
import {
  VOTEKICK,
  VOTEKICK_EXEC,
  VotekickSettingsUpdate,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { CautionService } from '../src/caution/service.js';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { AvatarCache } from '../src/raffle-lab/avatars.js';
import { VotekickService } from '../src/votekick/service.js';
import { setup } from './helpers.js';

// Votekick V2 in the database (docs/VOTEKICK_V2.md § 9): the Twitch executor played by its reports, Studio by its mute
// reports. The sanction always goes to the person the verdict names (target or initiator), never twice; the
// broadcaster is muted (never timed out) and a paid Caution ends his mute.

const CH = '83603689';
const BROADCASTER = { id: CH, login: 'raptoru_', name: 'Raptoru_' };
const user = (k: number) => ({
  id: String(7000 + k),
  login: `viewer${k}`,
  name: `Viewer${k}`,
});
const INIT = user(1);
const TARGET = user(2);
const V3 = user(3);
const V4 = user(4);
const V5 = user(5);
const EXEC = { executor_id: 'bot-1', login: 'lecroupier_' };
let n = 0;

async function lab(coin: 0 | 1 = 0) {
  const core = await setup();
  core.clock.set(new Date('2026-10-23T20:00:00Z'));
  const make = () =>
    new VotekickService(
      core.db,
      core.clock,
      () => CH,
      () => coin,
    );
  let vk = make();
  const msg = (
    u: { id: string; login: string; name: string },
    text: string,
    source: 'twitch' | 'simulator' = 'twitch',
    role: 'viewer' | 'moderator' | 'broadcaster' = 'viewer',
  ): LabChatMessage => ({
    channel_id: CH,
    message_id: `tw-${++n}`,
    text,
    chatter: { id: u.id, login: u.login, display_name: u.name, role },
    source,
  });
  const say = (u: typeof INIT, text: string) => vk.chat(msg(u, text));
  const claim = (can = { read: true, timeout: true }) =>
    vk.claim(CH, {
      ...EXEC,
      can_read: can.read,
      can_timeout: can.timeout,
      missing: [],
    });
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string; mode: string } }>(
        `select params from cmd_steps where idempotency_key like 'votekick:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const vote = async () =>
    (
      await core.db.query<{
        vote_id: string;
        status: string;
        outcome: string | null;
        punished_id: string | null;
        duration_s: number | null;
        applied: string | null;
        reason: string | null;
        sanction: string | null;
      }>('select * from votekick_votes order by created_at desc limit 1')
    )[0]!;
  /** `!votekick viewer2` by INIT → read → the 60 s vote open. */
  async function opened(target = TARGET, moderator = false) {
    await claim(); // the executor is seen (ready)
    expect((await say(INIT, `!votekick @${target.name}`)).outcome).toBe(
      'checking',
    );
    const job = (await claim()).job!;
    expect(job).toMatchObject({
      phase: 'check',
      target_login: target.login.toLowerCase(),
    });
    return vk.check(job.vote_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target,
      moderator,
    });
  }
  const end = async () => {
    core.clock.advance(VOTEKICK.voteMs + VOTEKICK.finishGraceMs);
    await vk.tick();
  };
  return {
    core,
    get vk() {
      return vk;
    },
    restart: () => (vk = make()),
    msg,
    say,
    claim,
    replies,
    vote,
    opened,
    end,
  };
}

describe('Votekick: settings (Studio) — Core decides the vote’s length', () => {
  it('defaults (60 s, range 15–300) until saved; saved values read back; bad values refused by the schema', async () => {
    const l = await lab();
    expect(await l.vk.settings(CH)).toEqual({
      vote_seconds: 60,
      default_vote_seconds: 60,
      min_vote_seconds: 15,
      max_vote_seconds: 300,
      updated_at: null,
    });
    const saved = await l.vk.saveSettings(CH, { vote_seconds: 90 }, 'studio');
    expect(saved).toMatchObject({
      vote_seconds: 90,
      updated_at: l.core.clock.now().toISOString(),
    });
    expect(await l.vk.settings(CH)).toEqual(saved);
    expect((await l.vk.settings('999')).vote_seconds).toBe(60); // another channel: its own
    for (const bad of [14, 301, 30.5, '45', null])
      expect(
        VotekickSettingsUpdate.safeParse({ vote_seconds: bad }).success,
      ).toBe(false);
    expect(
      VotekickSettingsUpdate.safeParse({ vote_seconds: 60, extra: 1 }).success,
    ).toBe(false);
    for (const ok of [15, 300])
      expect(
        VotekickSettingsUpdate.safeParse({ vote_seconds: ok }).success,
      ).toBe(true);
  });

  it('a new vote opens with the saved length: ends_at, chat text, overlay dur; votes counted until it, refused at it', async () => {
    const l = await lab();
    await l.vk.saveSettings(CH, { vote_seconds: 30 });
    const t0 = l.core.clock.now().getTime();
    expect(await l.opened()).toEqual({ outcome: 'opened' });
    const row = (
      await l.core.db.query<{ opened_at: Date; ends_at: Date }>(
        'select opened_at, ends_at from votekick_votes order by created_at desc limit 1',
      )
    )[0]!;
    expect(
      new Date(row.ends_at).getTime() - new Date(row.opened_at).getTime(),
    ).toBe(30_000);
    expect((await l.replies()).at(-1)).toBe(
      '⚖️ Votekick lancé contre viewer2 par viewer1 ! Votez !kick ou !save pendant 30 secondes',
    );
    expect(await l.vk.overlay(CH)).toMatchObject({
      action: 'live',
      dur: 30,
      ends: t0 + 30_000,
    });
    l.core.clock.advance(29_999);
    expect((await l.say(V3, '!kick')).outcome).toBe('counted');
    l.core.clock.advance(1);
    expect((await l.say(V4, '!kick')).outcome).toBe('no_vote');
  });

  it('an open vote keeps the length it opened with; the next one takes the new length', async () => {
    const l = await lab();
    expect(await l.opened()).toEqual({ outcome: 'opened' });
    await l.vk.saveSettings(CH, { vote_seconds: 20 });
    expect(await l.vk.overlay(CH)).toMatchObject({ action: 'live', dur: 60 });
    l.core.clock.advance(30_000);
    expect((await l.say(V3, '!kick')).outcome).toBe('counted'); // 30 s in: still open (its own 60 s)
    await l.end();
    expect((await l.vote()).status).toBe('done');
  });

  it('a Core before its migration (no votekick_settings) still opens 60 s votes', async () => {
    const l = await lab();
    await l.core.db.query('drop table votekick_settings');
    expect(await l.opened()).toEqual({ outcome: 'opened' });
    expect(await l.vk.overlay(CH)).toMatchObject({ action: 'live', dur: 60 });
  });
});

describe('Votekick: opening a vote', () => {
  it('read → open 60 s, announced, cooldown recorded; the overlay shows it live', async () => {
    const l = await lab();
    expect(await l.opened()).toEqual({ outcome: 'opened' });
    expect((await l.replies()).at(-1)).toBe(
      '⚖️ Votekick lancé contre viewer2 par viewer1 ! Votez !kick ou !save pendant 60 secondes',
    );
    const ev = await l.vk.overlay(CH);
    expect(ev).toMatchObject({
      action: 'live',
      target: 'viewer2',
      initiator: 'viewer1',
      yes: 1,
      no: 0,
      seq: 1,
    });
    expect((await l.say(V3, '!votekick viewer4')).outcome).toBe('busy');
    expect((await l.replies()).at(-1)).toBe('Un Votekick est déjà en cours.');
  });

  it('the target’s Twitch picture reaches the overlay (live, then the verdict) once fetched aside; none → empty', async () => {
    const l = await lab();
    const PIC = `https://static-cdn.jtvnw.net/jtv_user_pictures/${TARGET.id}-profile_image-300x300.png`;
    const looked: string[][] = [];
    const cache = new AvatarCache(l.core.db, l.core.clock, async (ids) => {
      looked.push(ids);
      return ids.map((id) => ({
        id,
        profile_image_url: id === TARGET.id ? PIC : '',
      }));
    });
    const pending: Promise<unknown>[] = [];
    l.vk.attachAvatars({
      ensure: (ids) => {
        const p = cache.ensure(ids);
        pending.push(p);
        return p;
      },
    });
    expect(await l.opened()).toEqual({ outcome: 'opened' });
    await Promise.all(pending); // fired aside at the opening, never awaited by the vote
    expect(looked).toEqual([[TARGET.id]]);
    expect(await l.vk.overlay(CH)).toMatchObject({
      action: 'live',
      target: 'viewer2',
      avatar: PIC,
    });
    await l.say(V3, '!kick');
    await l.say(V4, '!kick');
    await l.end();
    expect(await l.vk.overlay(CH)).toMatchObject({
      action: 'result',
      avatar: PIC,
    });
    // Known and fresh: not looked up again. A viewer Twitch has no picture for: '' (the overlay's fallback).
    l.core.clock.advance(2 * 3600_000);
    expect(await l.opened(V5)).toEqual({ outcome: 'opened' });
    await Promise.all(pending);
    expect(looked).toEqual([[TARGET.id], [V5.id]]);
    expect(await l.vk.overlay(CH)).toMatchObject({
      action: 'live',
      target: 'viewer5',
      avatar: '',
    });
  });

  it('refusals: unknown target, moderator, self (same id), Twitch / moderators unreadable', async () => {
    let l = await lab();
    await l.claim();
    await l.say(INIT, '!votekick nobody');
    let job = (await l.claim()).job!;
    await l.vk.check(job.vote_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: null,
      moderator: false,
    });
    expect((await l.replies()).at(-1)).toBe('Utilisateur Twitch introuvable.');
    expect(await l.opened(V3, true)).toEqual({ outcome: 'moderator' });
    expect((await l.replies()).at(-1)).toBe(
      'Tu ne peux pas cibler un modérateur',
    );
    // A renamed login resolving to the initiator himself.
    await l.say(INIT, '!votekick oldname');
    job = (await l.claim()).job!;
    await l.vk.check(job.vote_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: INIT,
      moderator: false,
    });
    expect((await l.replies()).at(-1)).toBe(
      'Tu ne peux pas lancer un Votekick contre toi-même. (espèce d’aw)',
    );
    l = await lab();
    await l.claim();
    await l.say(INIT, '!votekick viewer2');
    job = (await l.claim()).job!;
    await l.vk.check(job.vote_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      error: 'Twitch 500',
      stage: 'moderators',
    });
    expect((await l.replies()).at(-1)).toBe(
      'Impossible de vérifier les modérateurs Twitch. Votekick annulé par sécurité',
    );
    // Nothing opened by a refusal: no cooldown.
    expect(await l.opened()).toEqual({ outcome: 'opened' });
  });

  it('self by login, help (throttled), no executor → nothing opened', async () => {
    const l = await lab();
    expect((await l.say(INIT, '!votekick viewer1')).outcome).toBe('self');
    expect((await l.say(INIT, '!votekick')).outcome).toBe('help');
    expect((await l.say(INIT, '!votekick')).outcome).toBe('help_throttled');
    expect((await l.say(INIT, '!votekick viewer2')).outcome).toBe(
      'unavailable',
    );
    expect((await l.replies()).at(-1)).toBe(
      'Impossible de vérifier cette cible Twitch. Réessaie dans quelques secondes',
    );
    expect((await l.core.db.query('select 1 from votekick_votes')).length).toBe(
      0,
    );
  });

  it('cooldown: one launch per hour per initiator, from the opening (even without quorum)', async () => {
    const l = await lab();
    await l.opened();
    await l.end();
    expect((await l.vote()).outcome).toBe('no_quorum');
    expect((await l.say(INIT, '!votekick viewer3')).outcome).toBe('cooldown');
    expect((await l.replies()).at(-1)).toBe(
      '@viewer1 tu as déjà lancé un Votekick récemment',
    );
    l.core.clock.advance(VOTEKICK.initiatorCooldownMs);
    await l.claim(); // the executor shows itself again
    expect((await l.say(INIT, '!votekick viewer3')).outcome).toBe('checking');
  });

  it('a replayed `!votekick` (same Twitch message) opens nothing new', async () => {
    const l = await lab();
    await l.claim();
    const m = l.msg(INIT, '!votekick viewer2');
    expect((await l.vk.chat(m)).outcome).toBe('checking');
    expect((await l.vk.chat(m)).outcome).toBe('replayed');
  });
});

describe('Votekick: ballots', () => {
  it('exact commands only; the initiator cannot vote; a change of mind counts once; a late vote is ignored', async () => {
    const l = await lab();
    await l.opened();
    expect((await l.say(INIT, '!kick')).outcome).toBe('initiator');
    expect((await l.replies()).at(-1)).toBe(
      "@viewer1 l'initiateur ne peut pas voter dans son propre procès",
    );
    expect((await l.say(V3, '!KICK')).outcome).toBe('ignored');
    expect((await l.say(V3, '!kick')).outcome).toBe('counted');
    expect((await l.say(V3, '!kick')).outcome).toBe('same');
    expect((await l.say(V3, '!save')).outcome).toBe('changed');
    expect(await l.vk.overlay(CH)).toMatchObject({ yes: 1, no: 1, seq: 3 });
    l.core.clock.advance(VOTEKICK.voteMs);
    expect((await l.say(V4, '!kick')).outcome).toBe('no_vote');
  });
});

describe('Votekick: verdicts and the sanction on the RIGHT person', () => {
  it('KICK majority → the target, timeout claimed once, confirmed', async () => {
    const l = await lab();
    await l.opened();
    await l.say(V3, '!kick');
    await l.say(V4, '!kick');
    await l.say(V5, '!save');
    await l.end();
    let v = await l.vote();
    expect(v).toMatchObject({
      status: 'sanctioning',
      outcome: 'target_timeout',
      punished_id: TARGET.id,
    });
    const job = (await l.claim()).job!;
    expect(job).toMatchObject({
      phase: 'timeout',
      target_id: TARGET.id,
      target_login: 'viewer2',
      seconds: v.duration_s,
    });
    expect((await l.claim()).job).toBeNull(); // never handed twice
    await l.vk.timeoutResult(job.vote_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'confirmed',
    });
    v = await l.vote();
    expect(v).toMatchObject({ status: 'done', applied: 'confirmed' });
    await expect(
      l.vk.timeoutResult(job.vote_id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        event: 'refused',
      }),
    ).rejects.toMatchObject({ code: 'not_sanctioning' });
    const ev = await l.vk.overlay(CH);
    expect(ev).toMatchObject({
      action: 'result',
      outcome: 'target_timeout',
      punished: 'viewer2',
    });
    l.core.clock.advance(VOTEKICK.resultMs);
    expect((await l.vk.overlay(CH)).action).toBe('clear');
  });

  it('Perfect (only the target saves himself) ×2; Backfire → the INITIATOR', async () => {
    let l = await lab();
    await l.opened();
    await l.say(V3, '!kick');
    await l.say(V4, '!kick');
    await l.say(TARGET, '!save');
    await l.end();
    expect(await l.vote()).toMatchObject({
      outcome: 'target_timeout_perfect',
      punished_id: TARGET.id,
      duration_s: 2 * 6 * 60, // 3 KICK → 6 min, ×2
    });
    l = await lab();
    await l.opened();
    await l.say(V3, '!save');
    await l.say(V4, '!save');
    await l.end();
    expect(await l.vote()).toMatchObject({
      outcome: 'backfire',
      punished_id: INIT.id,
    });
    expect((await l.claim()).job).toMatchObject({ target_id: INIT.id });
  });

  it('coin flip on a tie of 4: coin 1 → the initiator', async () => {
    const l = await lab(1);
    await l.opened();
    await l.say(V3, '!kick');
    await l.say(V4, '!save');
    await l.say(V5, '!save');
    await l.end();
    expect(await l.vote()).toMatchObject({
      outcome: 'coinflip_initiator',
      punished_id: INIT.id,
    });
  });

  it('timeout refused by Twitch: told; never claimed: not sent; claimed and lost: uncertain (never retried)', async () => {
    let l = await lab();
    await l.opened();
    await l.say(V3, '!kick');
    await l.say(V4, '!kick');
    await l.end();
    const job = (await l.claim()).job!;
    await l.vk.timeoutResult(job.vote_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'refused',
    });
    expect((await l.replies()).at(-1)).toBe(
      'Twitch a refusé le timeout de viewer2 (Votekick).',
    );
    l = await lab();
    await l.opened();
    await l.say(V3, '!kick');
    await l.say(V4, '!kick');
    await l.end();
    l.core.clock.advance(VOTEKICK_EXEC.timeoutLeaseMs);
    await l.vk.tick();
    expect(await l.vote()).toMatchObject({ applied: 'not_sent' });
    expect((await l.replies()).at(-1)).toBe(
      'Timeout de viewer2 impossible pour le moment (Votekick).',
    );
    l = await lab();
    await l.opened();
    await l.say(V3, '!kick');
    await l.say(V4, '!kick');
    await l.end();
    expect((await l.claim()).job).not.toBeNull(); // claimed, never reported
    l.core.clock.advance(VOTEKICK_EXEC.timeoutLeaseMs);
    await l.vk.tick();
    expect(await l.vote()).toMatchObject({ applied: 'uncertain' });
    expect((await l.claim()).job).toBeNull();
  });

  it('a stale attempt is refused (409); a timeout without the right is never sent', async () => {
    const l = await lab();
    await l.opened();
    await l.say(V3, '!kick');
    await l.say(V4, '!kick');
    await l.end();
    expect((await l.claim({ read: true, timeout: false })).job).toBeNull();
    expect(await l.vote()).toMatchObject({
      applied: 'not_sent',
      reason: 'missing_scope_timeout',
    });
  });
});

describe('Votekick: lost executor, restart, simulator', () => {
  it('a `!votekick` the executor never picks up fails after the pickup delay (nothing opened)', async () => {
    const l = await lab();
    await l.claim();
    await l.say(INIT, '!votekick viewer2');
    l.core.clock.advance(VOTEKICK_EXEC.pickupMs);
    await l.vk.tick();
    expect(await l.vote()).toMatchObject({
      status: 'failed',
      reason: 'executor_absent',
    });
  });

  it('a read lost 3 times fails; a lost read is offered again', async () => {
    const l = await lab();
    await l.claim();
    await l.say(INIT, '!votekick viewer2');
    for (let k = 0; k < VOTEKICK_EXEC.maxAttempts; k++) {
      expect((await l.claim()).job).not.toBeNull();
      l.core.clock.advance(VOTEKICK_EXEC.readLeaseMs);
      await l.vk.tick();
    }
    expect(await l.vote()).toMatchObject({
      status: 'failed',
      reason: 'read_lost',
    });
  });

  it('Core restarted mid-vote: the vote is in the database, finished on time', async () => {
    const l = await lab();
    await l.opened();
    await l.say(V3, '!kick');
    l.restart();
    await l.say(V4, '!kick');
    await l.end();
    expect(await l.vote()).toMatchObject({
      outcome: 'target_timeout_perfect',
    });
  });

  it('simulator (dry run): target from the simulated chat, timeout simulated (never handed to Twitch)', async () => {
    const l = await lab();
    await l.vk.chat(l.msg(TARGET, 'salut', 'simulator'));
    expect(
      (await l.vk.chat(l.msg(INIT, '!votekick viewer2', 'simulator'))).outcome,
    ).toBe('opened');
    await l.vk.chat(l.msg(V3, '!kick', 'simulator'));
    await l.vk.chat(l.msg(V4, '!kick', 'simulator'));
    await l.end();
    expect(await l.vote()).toMatchObject({
      punished_id: TARGET.id,
      applied: 'simulated',
    });
    expect((await l.claim()).job).toBeNull();
  });
});

describe('Votekick: the broadcaster is muted in OBS, never timed out; his Caution ends the mute', () => {
  async function muted() {
    const l = await lab();
    await l.opened(BROADCASTER);
    await l.say(V3, '!kick');
    await l.say(V4, '!kick');
    await l.end();
    const v = await l.vote();
    expect(v).toMatchObject({
      status: 'done',
      sanction: 'obs_mute',
      punished_id: CH,
    });
    expect((await l.claim()).job).toBeNull(); // no Twitch timeout for the broadcaster
    const task = await l.vk.studio(CH);
    expect(task.mute).toMatchObject({ status: 'pending', seconds: 60 });
    expect(task.overlay).toMatchObject({
      action: 'result',
      outcome: 'broadcaster_muted',
      mute_seconds: 60, // 3 KICK, Perfect: 12 min → 720 / 12 s
    });
    return { l, muteId: task.mute!.mute_id };
  }

  it('Studio starts it, the time counts from there; ended on time; a second votekick on him is refused meanwhile', async () => {
    const { l, muteId } = await muted();
    await l.vk.muteReport(CH, muteId, { event: 'started' });
    expect((await l.vk.studio(CH)).mute).toMatchObject({ status: 'active' });
    // Another viewer targets him while muted: refused (no second vote on a muted broadcaster).
    await l.claim();
    await l.vk.chat(l.msg(V3, '!votekick raptoru_'));
    const again = (await l.claim()).job!;
    expect(
      await l.vk.check(again.vote_id, {
        ...EXEC,
        attempt_id: again.attempt_id,
        target: BROADCASTER,
        moderator: false,
      }),
    ).toEqual({ outcome: 'already_muted' });
    l.core.clock.advance(60_000);
    // The mute ends at its time (here long past): ended by the tick, Studio restores OBS.
    await l.vk.tick();
    expect((await l.vk.studio(CH)).mute).toMatchObject({
      status: 'ended',
      end_reason: 'expired',
    });
  });

  it('Studio absent: never muted, told; nothing pretends he is muted', async () => {
    const { l } = await muted();
    l.core.clock.advance(VOTEKICK_EXEC.mutePickupMs);
    await l.vk.tick();
    expect((await l.vk.studio(CH)).mute).toMatchObject({ status: 'failed' });
    expect((await l.replies()).at(-1)).toBe(
      'Mute du streamer impossible pour le moment (OBS).',
    );
    expect(await l.vote()).toMatchObject({ applied: 'not_muted' });
  });

  it('Caution on the real mute: priced on its seconds left, `oui` debits once and ends it (Studio sees « caution »)', async () => {
    const { l, muteId } = await muted();
    await l.vk.muteReport(CH, muteId, { event: 'started' });
    l.core.clock.advance(5_000);
    const caution = new CautionService(
      l.core.db,
      l.core.clock,
      labEconomy,
      () => CH,
      l.vk,
    );
    await editWallet(
      l.core.db,
      l.core.clock.now(),
      CH,
      V5.id,
      'set',
      { tokens: 5_000 },
      'test',
    );
    const exec = { ...EXEC, can_read: true, can_release: true, missing: [] };
    await caution.claim(CH, exec);
    await caution.chat(l.msg(V5, '!caution raptoru_'));
    const job = (await caution.claim(CH, exec)).job!;
    await caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: BROADCASTER,
      sanction: { kind: 'none' },
    });
    expect(
      (
        await l.core.db.query<{ params: { text: string } }>(
          `select params from cmd_steps where idempotency_key like 'caution:%' order by seq_global`,
        )
      ).at(-1)!.params.text,
    ).toBe(
      'raptoru_ est réduit au silence encore 55 secondes. Le libérer coûte 1 000 jetons, @viewer5. Oui ou non ?',
    );
    expect((await caution.chat(l.msg(V5, 'oui'))).outcome).toBe('released');
    expect((await caution.chat(l.msg(V5, 'oui'))).outcome).not.toBe('released');
    expect((await l.vk.studio(CH)).mute).toMatchObject({
      status: 'ended',
      end_reason: 'caution',
    });
    const debits = await l.core.db.query(
      `select 1 from lab_wallet_ledger where module_id = 'caution' and kind = 'debit'`,
    );
    expect(debits.length).toBe(1);
  });
});
