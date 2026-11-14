import type { CautionSanction, LabChatMessage } from '@raptoru/schemas';
import { CAUTION_EXEC } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { CautionService, poolShares } from '../src/caution/service.js';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// Caution collective (docs/CAUTION.md § 9, 14/11): the payer's `!groupe` opens 30 s of free sign-ups (`!oui`, once per
// account, `!non` to leave), closed by Core's clock; at least two participants, each at most the cap told at the
// opening; the real price at the fresh Twitch read, shared to the Jeton; the participants without enough Jetons set
// aside; every debit or none; a failed release refunds every participant once. Lab wallet, fictional viewers.

const CH = '83603689';
const user = (n: number) => ({
  id: String(9300 + n),
  login: `sauveteur${n}`,
  name: `Sauveteur${n}`,
});
const PAYER = user(1);
const TARGET = { id: '9399', login: 'pika', name: 'Pika' };
const EXEC = { executor_id: 'bot-1', login: 'lecroupier_' };
let n = 0;

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-11-14T20:00:00Z'));
  const make = () =>
    new CautionService(core.db, core.clock, labEconomy, () => CH, null);
  let caution = make();
  const msg = (
    u: { id: string; login: string; name: string },
    text: string,
    role: 'viewer' | 'moderator' = 'viewer',
    id = `tw-${++n}`,
  ): LabChatMessage => ({
    channel_id: CH,
    message_id: id,
    text,
    chatter: { id: u.id, login: u.login, display_name: u.name, role },
    source: 'twitch',
  });
  const say = async (
    u: { id: string; login: string; name: string },
    text: string,
    role: 'viewer' | 'moderator' = 'viewer',
    id?: string,
  ) => (await caution.chat(msg(u, text, role, id))).outcome;
  const claim = () =>
    caution.claim(CH, {
      ...EXEC,
      can_read: true,
      can_release: true,
      missing: [],
    });
  const timeoutFor = (ms: number): CautionSanction => ({
    kind: 'timeout',
    ends_at: new Date(core.clock.now().getTime() + ms).toISOString(),
  });
  /** `!caution pika` → read → quoted for a timeout of `ms`, then the payer's `!groupe`. */
  async function pool(ms = 8 * 60_000 - 31_000) {
    await claim();
    expect(await say(PAYER, '!caution pika')).toBe('checking');
    const job = (await claim()).job!;
    const q = await caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: TARGET,
      sanction: timeoutFor(ms),
    });
    expect(await say(PAYER, '!groupe')).toBe('pooling');
    return { id: job.request_id, price: (q as { price: number }).price };
  }
  /** The 30 s pass; the executor's next claim closes the pool and takes the re-read. */
  async function close() {
    core.clock.advance(CAUTION_EXEC.poolMs);
    return (await claim()).job;
  }
  const give = (u: { id: string }, tokens: number) =>
    editWallet(core.db, core.clock.now(), CH, u.id, 'set', { tokens }, 'test');
  const tokens = async (u: { id: string }) =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, u.id],
        )
      )[0]?.tokens ?? 0,
    );
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'caution:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const row = async (id: string) =>
    (
      await core.db.query<{ status: string; money: string; reason: string }>(
        'select status, money, reason from caution_requests where request_id = $1',
        [id],
      )
    )[0]!;
  const ledger = async () =>
    (
      await core.db.query<{ viewer_id: string; kind: string; amount: string }>(
        `select viewer_id, kind, amount from lab_wallet_ledger where module_id = 'caution' order by id`,
      )
    ).map((r) => ({
      viewer: r.viewer_id,
      kind: r.kind,
      amount: Number(r.amount),
    }));
  return {
    core,
    get caution() {
      return caution;
    },
    restart: () => (caution = make()),
    say,
    claim,
    timeoutFor,
    pool,
    close,
    give,
    tokens,
    replies,
    row,
    ledger,
  };
}

describe('Caution collective', () => {
  it('shares: as even as possible, the first by sign-up pay one more, the sum exactly the price', () => {
    expect(poolShares(15_000, 5)).toEqual([3000, 3000, 3000, 3000, 3000]);
    expect(poolShares(7_000, 3)).toEqual([2334, 2333, 2333]);
    for (const [p, k] of [
      [1, 2],
      [9_999, 7],
      [100_001, 4],
    ] as const)
      expect(poolShares(p, k).reduce((a, b) => a + b, 0)).toBe(p);
  });

  it('`!groupe` → 30 s of silent sign-ups (once each, `!non` leaves) → the real price shared → released; nothing before the closing', async () => {
    const l = await lab();
    const [a, b, c, d] = [user(2), user(3), user(4), user(5)];
    for (const u of [a, b, c, d]) await l.give(u, 10_000);
    const { id, price } = await l.pool();
    expect(price).toBe(8_000);
    expect(await l.row(id)).toMatchObject({ status: 'pooling' });
    expect(await l.say(a, '!oui')).toBe('pool_joined');
    expect(await l.say(a, '!oui')).toBe('pool_already'); // once per account
    expect(await l.say(b, '!oui')).toBe('pool_joined');
    expect(await l.say(d, '!oui')).toBe('pool_joined');
    expect(await l.say(d, '!non')).toBe('pool_left');
    expect(await l.say(c, 'oui')).toBe('ignored'); // a bare « oui » is not a sign-up
    l.core.clock.advance(CAUTION_EXEC.poolMs - 1);
    expect(await l.say(c, '!oui')).toBe('pool_joined'); // the last millisecond still counts
    // Nobody paid anything yet; the payer's individual answer is closed (never two payments).
    expect(await l.say(PAYER, 'oui')).toBe('ignored');
    expect(await l.ledger()).toEqual([]);
    const job = await l.close();
    expect(job).toMatchObject({ phase: 'release' });
    // The fresh read: 7 minutes left → 7 000 (not the quoted 8 000), shared by 3 to the Jeton.
    const go = await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job!.attempt_id,
      sanction: l.timeoutFor(7 * 60_000),
    });
    expect(go).toEqual({ proceed: true, target_id: TARGET.id });
    expect(await l.ledger()).toEqual([
      { viewer: a.id, kind: 'debit', amount: -2334 },
      { viewer: b.id, kind: 'debit', amount: -2333 },
      { viewer: c.id, kind: 'debit', amount: -2333 },
    ]);
    expect(await l.tokens(d)).toBe(10_000);
    // A replayed re-read never debits again.
    await expect(
      l.caution.recheck(id, {
        ...EXEC,
        attempt_id: job!.attempt_id,
        sanction: l.timeoutFor(7 * 60_000),
      }),
    ).resolves.toBeDefined();
    expect((await l.ledger()).length).toBe(3);
    await l.caution.result(id, {
      ...EXEC,
      attempt_id: job!.attempt_id,
      event: 'released',
    });
    expect(await l.row(id)).toMatchObject({
      status: 'released',
      money: 'debited',
    });
    expect(await l.replies()).toEqual([
      'pika est banni encore 8 minutes. Le libérer coûte 8 000 jetons, @sauveteur1. Oui ou non ? (!groupe : à plusieurs)',
      "Caution collective pour pika ! 30 s pour rejoindre avec !oui · prix partagé, 4 000 jetons max chacun · rien n'est débité avant la fin.",
      '3 sauveteurs ! Caution de 7 000 jetons, soit 2 333 à 2 334 chacun. Libération de pika…',
      'pika est libre ! Caution payée à 3. Merci les sauveteurs !',
    ]);
  });

  it('a participant without enough Jetons is set aside (the others within the cap); too few able to pay: nothing debited', async () => {
    const l = await lab();
    const [a, b, c] = [user(2), user(3), user(4)];
    await l.give(a, 5_000);
    await l.give(b, 5_000);
    await l.give(c, 100);
    const { id } = await l.pool();
    for (const u of [a, b, c]) await l.say(u, '!oui');
    const job = await l.close();
    await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job!.attempt_id,
      sanction: l.timeoutFor(7 * 60_000),
    });
    expect(await l.ledger()).toEqual([
      { viewer: a.id, kind: 'debit', amount: -3500 },
      { viewer: b.id, kind: 'debit', amount: -3500 },
    ]);
    expect((await l.replies()).at(-1)).toBe(
      '2 sauveteurs ! Caution de 7 000 jetons, soit 3 500 chacun (1 sans assez de jetons, écarté). Libération de pika…',
    );

    const m = await lab();
    await m.give(a, 5_000);
    await m.give(b, 100);
    const p = await m.pool();
    await m.say(a, '!oui');
    await m.say(b, '!oui');
    const j = await m.close();
    expect(
      await m.caution.recheck(p.id, {
        ...EXEC,
        attempt_id: j!.attempt_id,
        sanction: m.timeoutFor(7 * 60_000),
      }),
    ).toMatchObject({ proceed: false });
    expect(await m.row(p.id)).toMatchObject({
      status: 'refused',
      money: 'none',
      reason: 'pool_insufficient',
    });
    expect(await m.ledger()).toEqual([]);
    expect((await m.replies()).at(-1)).toBe(
      'Caution collective annulée : pas assez de participants avec assez de jetons. Aucun jeton débité.',
    );
  });

  it('nobody, or one participant alone: cancelled at the closing, nothing debited, the channel free again', async () => {
    const l = await lab();
    const { id } = await l.pool();
    expect(await l.close()).toBeNull();
    expect(await l.row(id)).toMatchObject({
      status: 'cancelled',
      reason: 'pool_empty',
    });
    const { id: id2 } = await l.pool();
    await l.give(user(2), 50_000);
    await l.say(user(2), '!oui');
    // Closed by the next chat message too (the bot may be away): a late `!oui` never joins.
    l.core.clock.advance(CAUTION_EXEC.poolMs);
    expect(await l.say(user(3), '!oui')).toBe('ignored');
    expect(await l.row(id2)).toMatchObject({
      status: 'cancelled',
      reason: 'pool_alone',
    });
    expect(await l.ledger()).toEqual([]);
  });

  it('`!annuler`: a moderator closes the pool (nothing was debited); a viewer cannot; only the payer opens it', async () => {
    const l = await lab();
    const { id } = await l.pool();
    const mod = user(8);
    expect(await l.say(user(2), '!annuler')).toBe('ignored');
    expect(await l.say(user(2), '!groupe')).toBe('ignored');
    expect(await l.say(mod, '!annuler', 'moderator')).toBe('pool_cancelled');
    expect(await l.row(id)).toMatchObject({
      status: 'cancelled',
      reason: 'pool_cancelled_by_moderator',
    });
    expect((await l.replies()).at(-1)).toBe(
      'Caution collective pour pika annulée par la modération. Aucun jeton débité.',
    );
  });

  it('a Core restart during the 30 s keeps the sign-ups; a replayed message signs up once; the target cannot pay', async () => {
    const l = await lab();
    const [a, b] = [user(2), user(3)];
    await l.give(a, 10_000);
    await l.give(b, 10_000);
    const { id } = await l.pool();
    expect(await l.say(a, '!oui', 'viewer', 'same-msg')).toBe('pool_joined');
    l.restart();
    expect(await l.say(a, '!oui', 'viewer', 'same-msg')).toBe('pool_already');
    expect(await l.say(TARGET, '!oui')).toBe('ignored');
    await l.say(b, '!oui');
    const job = await l.close();
    expect(job).toMatchObject({ phase: 'release' });
    await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job!.attempt_id,
      sanction: l.timeoutFor(5 * 60_000),
    });
    expect(await l.ledger()).toEqual([
      { viewer: a.id, kind: 'debit', amount: -2500 },
      { viewer: b.id, kind: 'debit', amount: -2500 },
    ]);
  });

  it('the timeout ended or lifted by a moderator: at the re-read nothing is debited; after the debit, every participant refunded once', async () => {
    const l = await lab();
    const [a, b] = [user(2), user(3)];
    await l.give(a, 10_000);
    await l.give(b, 10_000);
    const { id } = await l.pool();
    await l.say(a, '!oui');
    await l.say(b, '!oui');
    const job = await l.close();
    expect(
      await l.caution.recheck(id, {
        ...EXEC,
        attempt_id: job!.attempt_id,
        sanction: { kind: 'none' },
      }),
    ).toMatchObject({ proceed: false });
    expect(await l.ledger()).toEqual([]);

    const m = await lab();
    await m.give(a, 10_000);
    await m.give(b, 10_000);
    const p = await m.pool();
    await m.say(a, '!oui');
    await m.say(b, '!oui');
    const j = await m.close();
    await m.caution.recheck(p.id, {
      ...EXEC,
      attempt_id: j!.attempt_id,
      sanction: m.timeoutFor(6 * 60_000),
    });
    // Twitch: no longer banned at the unban → refunded, reported twice: once.
    for (let i = 0; i < 2; i++)
      await m.caution.result(p.id, {
        ...EXEC,
        attempt_id: j!.attempt_id,
        event: 'not_banned',
      });
    expect(await m.row(p.id)).toMatchObject({
      status: 'failed',
      money: 'refunded',
    });
    expect(await m.tokens(a)).toBe(10_000);
    expect(await m.tokens(b)).toBe(10_000);
    expect((await m.ledger()).filter((x) => x.kind !== 'debit').length).toBe(2);
    expect((await m.replies()).at(-1)).toBe(
      "pika n'était plus en timeout : les 2 participants sont remboursés.",
    );
  });

  it('the individual caution is unchanged: `oui` (or `!oui`) from the payer pays alone', async () => {
    const l = await lab();
    await l.give(PAYER, 10_000);
    await l.claim();
    await l.say(PAYER, '!caution pika');
    const job = (await l.claim()).job!;
    await l.caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: TARGET,
      sanction: l.timeoutFor(3 * 60_000),
    });
    expect(await l.say(PAYER, '!oui')).toBe('confirmed');
  });
});
