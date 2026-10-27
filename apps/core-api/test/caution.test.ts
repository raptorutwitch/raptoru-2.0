import type { CautionSanction, LabChatMessage } from '@raptoru/schemas';
import { CAUTION_EXEC } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  CautionService,
  type CautionMutes,
  type NamedMutes,
} from '../src/caution/service.js';
import { cautionMutePrice, cautionPrice } from '@raptoru/schemas';
import { labEconomy } from '../src/economy/economy.js';
import { chatRouter } from '../src/lab-chat/games.js';
import { createCore } from '../src/app.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { createTestDb, FakeClock, setup } from './helpers.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { SHADOW_MODES } from '../src/loyalty/engine.js';

// Caution (docs/CAUTION.md) — Core on a real Postgres (PGlite), the Twitch executor played by its reports: quote,
// `oui` / `non` by the payer only, a fresh read before the debit, the debit and « releasing » together, refunded
// exactly once on a certain failure, « uncertain » kept to verify, one open caution per channel, the broadcaster's
// mute, restarts and lost executors.

const CH = '83603689';
const BROADCASTER = { id: CH, login: 'raptoru_', name: 'Raptoru_' };
const user = (n: number) => ({
  id: String(9000 + n),
  login: `viewer${n}`,
  name: `Viewer${n}`,
});
const PAYER = user(1);
const TARGET = user(2);
const OTHER = user(3);
const EXEC = { executor_id: 'bot-1', login: 'lecroupier_' };
let n = 0;

async function lab(opts: { mutes?: CautionMutes | NamedMutes[] } = {}) {
  const core = await setup();
  core.clock.set(new Date('2026-10-23T20:00:00Z'));
  const make = () =>
    new CautionService(
      core.db,
      core.clock,
      labEconomy,
      () => CH,
      opts.mutes ?? null,
    );
  let caution = make();
  const msg = (
    u: { id: string; login: string; name: string },
    text: string,
    id = `tw-${++n}`,
    source: 'twitch' | 'simulator' = 'twitch',
  ): LabChatMessage => ({
    channel_id: CH,
    message_id: id,
    text,
    chatter: { id: u.id, login: u.login, display_name: u.name, role: 'viewer' },
    source,
  });
  const say = (u: typeof PAYER, text: string, id?: string) =>
    caution.chat(msg(u, text, id));
  const claim = (can = { read: true, release: true }) =>
    caution.claim(CH, {
      ...EXEC,
      can_read: can.read,
      can_release: can.release,
      missing: [],
    });
  const timeoutFor = (ms: number): CautionSanction => ({
    kind: 'timeout',
    ends_at: new Date(core.clock.now().getTime() + ms).toISOString(),
  });
  /** `!caution viewer2` → read → quoted (the target timed out for `ms`). */
  async function quoted(ms = 8 * 60_000 - 31_000, payer = PAYER) {
    await claim(); // the executor is seen (ready)
    expect((await say(payer, `!caution @${TARGET.name}`)).outcome).toBe(
      'checking',
    );
    const job = (await claim()).job!;
    expect(job).toMatchObject({ phase: 'quote', target_login: 'viewer2' });
    const q = await caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: TARGET,
      sanction: timeoutFor(ms),
    });
    return { id: job.request_id, q };
  }
  /** `oui` → the release job (the re-read). */
  async function confirmed(payer = PAYER) {
    expect((await say(payer, 'oui')).outcome).toBe('confirmed');
    const job = (await claim()).job!;
    expect(job.phase).toBe('release');
    return job;
  }
  const tokens = async (u = PAYER) =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, u.id],
        )
      )[0]?.tokens ?? 0,
    );
  const give = (u: typeof PAYER, amount: number) =>
    editWallet(
      core.db,
      core.clock.now(),
      CH,
      u.id,
      'set',
      { tokens: amount },
      'test',
    );
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'caution:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const row = async (id: string) =>
    (
      await core.db.query<{
        status: string;
        money: string;
        reason: string | null;
      }>(
        'select status, money, reason from caution_requests where request_id = $1',
        [id],
      )
    )[0]!;
  const ledger = async () =>
    (
      await core.db.query<{ kind: string; amount: string }>(
        `select kind, amount from lab_wallet_ledger where module_id = 'caution' order by id`,
      )
    ).map((r) => ({ kind: r.kind, amount: Number(r.amount) }));
  return {
    core,
    get caution() {
      return caution;
    },
    restart: () => (caution = make()),
    say,
    msg,
    claim,
    timeoutFor,
    quoted,
    confirmed,
    tokens,
    give,
    replies,
    row,
    ledger,
  };
}

describe('Caution: the normal payment', () => {
  it('quote → `oui` → re-read → debit + releasing → released; one debit, SAMMI texts', async () => {
    const l = await lab();
    await l.give(PAYER, 10_000);
    const { id, q } = await l.quoted();
    expect(q).toEqual({ status: 'quoted', price: 8000 });
    const job = await l.confirmed();
    expect(await l.tokens()).toBe(10_000); // nothing debited before the re-read
    const go = await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: l.timeoutFor(7 * 60_000),
    });
    expect(go).toEqual({ proceed: true, target_id: TARGET.id });
    expect(await l.tokens()).toBe(2_000);
    expect(await l.row(id)).toMatchObject({
      status: 'releasing',
      money: 'debited',
    });
    await l.caution.result(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'released',
    });
    expect(await l.row(id)).toMatchObject({
      status: 'released',
      money: 'debited',
    });
    expect(await l.replies()).toEqual([
      'viewer2 est banni encore 8 minutes. Le libérer coûte 8 000 jetons, @viewer1. Oui ou non ?',
      '@viewer1 a libéré viewer2 pour 8 000 jetons !',
    ]);
    expect(await l.ledger()).toEqual([{ kind: 'debit', amount: -8000 }]);
  });

  it('help (throttled), own caution, others’ `oui` / `non` and answers without a quote stay silent', async () => {
    const l = await lab();
    expect((await l.say(PAYER, '!caution')).outcome).toBe('help');
    expect((await l.say(PAYER, '!caution')).outcome).toBe('help_throttled');
    expect((await l.say(PAYER, '!caution viewer1')).outcome).toBe('self');
    expect((await l.say(OTHER, 'oui')).outcome).toBe('ignored');
    await l.quoted();
    expect((await l.say(OTHER, 'oui')).outcome).toBe('ignored');
    expect((await l.say(OTHER, 'non')).outcome).toBe('ignored');
    expect((await l.say(PAYER, 'non')).outcome).toBe('cancelled');
    expect(await l.replies()).toEqual([
      'Lève le ban de quelqu’un en payant pour lui - !caution "pseudo"',
      'viewer1, tu ne peux pas payer ta propre caution',
      expect.stringContaining(
        'Le libérer coûte 8 000 jetons, @viewer1. Oui ou non ?',
      ),
      'Caution annulée par viewer1. Aucun jeton débité.',
    ]);
  });

  it('refusals at the quote: unknown, no timeout, permanent ban, ended — nothing debited', async () => {
    const l = await lab();
    await l.claim();
    const run = async (
      target: typeof TARGET | null,
      sanction: CautionSanction,
    ) => {
      await l.say(PAYER, '!caution viewer2');
      const job = (await l.claim()).job!;
      return l.caution.check(job.request_id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        target,
        sanction,
      });
    };
    expect(await run(null, { kind: 'none' })).toMatchObject({
      reason: 'unknown_target',
    });
    expect(await run(TARGET, { kind: 'none' })).toMatchObject({
      reason: 'no_timeout',
    });
    expect(await run(TARGET, { kind: 'permanent' })).toMatchObject({
      reason: 'permanent',
    });
    expect(await run(TARGET, l.timeoutFor(-1000))).toMatchObject({
      reason: 'ended',
    });
    expect(await run(PAYER, { kind: 'none' })).toMatchObject({
      reason: 'self',
    });
    expect(await l.replies()).toEqual([
      'viewer1, utilisateur Twitch introuvable : viewer2 Vérifie le pseudo',
      "viewer2 n'a aucun timeout actif",
      'Le ban permanent de viewer2 ne peut pas être racheté',
      'Le timeout de viewer2 est déjà terminé.',
      'viewer1, tu ne peux pas payer ta propre caution',
    ]);
    expect(await l.ledger()).toEqual([]);
  });
});

describe('Caution: money is safe', () => {
  it('not enough Jetons: refused at the debit, nothing debited, a new caution can start', async () => {
    const l = await lab();
    await l.give(PAYER, 3_000);
    const { id } = await l.quoted();
    const job = await l.confirmed();
    expect(
      await l.caution.recheck(id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        sanction: l.timeoutFor(7 * 60_000),
      }),
    ).toEqual({ proceed: false, reason: 'debit_refused' });
    expect(await l.row(id)).toMatchObject({
      status: 'refused',
      reason: 'insufficient',
      money: 'none',
    });
    expect((await l.replies()).at(-1)).toBe(
      'viewer1, tu es trop pauvre pour payer cette caution ptdr bouge de là. Il faut 8 000 jetons et tu en as 3 000.',
    );
    expect(await l.tokens()).toBe(3_000);
    expect((await l.say(OTHER, '!caution viewer2')).outcome).toBe('checking');
  });

  it('the timeout ended, was lifted or became permanent before the re-read: nothing debited', async () => {
    for (const [sanction, reason] of [
      [{ kind: 'none' }, 'no_longer'],
      [{ kind: 'permanent' }, 'now_permanent'],
    ] as const) {
      const l = await lab();
      await l.give(PAYER, 10_000);
      const { id } = await l.quoted();
      const job = await l.confirmed();
      await l.caution.recheck(id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        sanction,
      });
      expect(await l.row(id)).toMatchObject({
        status: 'refused',
        reason,
        money: 'none',
      });
      expect(await l.tokens()).toBe(10_000);
    }
  });

  it('a timeout extended after the quote: re-quote asked; shortened: the quoted price', async () => {
    let l = await lab();
    await l.give(PAYER, 50_000);
    let { id } = await l.quoted(5 * 60_000);
    let job = await l.confirmed();
    await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: l.timeoutFor(20 * 60_000),
    });
    expect(await l.row(id)).toMatchObject({
      status: 'refused',
      reason: 'extended',
    });
    expect(await l.tokens()).toBe(50_000);
    l = await lab();
    await l.give(PAYER, 50_000);
    ({ id } = await l.quoted(5 * 60_000));
    job = await l.confirmed();
    await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: l.timeoutFor(60_000),
    });
    expect(await l.tokens()).toBe(45_000);
  });

  it('a late `oui` (after 30 s): expired, told once; an unanswered quote expires silently', async () => {
    const l = await lab();
    await l.quoted();
    l.core.clock.advance(30_000);
    expect((await l.say(PAYER, 'oui')).outcome).toBe('expired');
    expect((await l.replies()).at(-1)).toBe(
      'Cette proposition de caution a expiré. Relance !caution @pseudo.',
    );
    await l.quoted();
    l.core.clock.advance(31_000);
    await l.claim(); // the executor still there
    const before = (await l.replies()).length;
    expect((await l.say(OTHER, '!caution viewer2')).outcome).toBe('checking'); // the old one swept, silently
    expect((await l.replies()).length).toBe(before);
  });
});

describe('Caution: concurrency', () => {
  it('two `!caution` at once (two payers): one opens, the other is told', async () => {
    const l = await lab();
    await l.claim();
    const out = await Promise.all([
      l.say(PAYER, '!caution viewer2'),
      l.say(OTHER, '!caution viewer2'),
    ]);
    expect(out.map((o) => o.outcome).sort()).toEqual(['busy', 'checking']);
    expect(
      Number(
        (
          await l.core.db.query<{ n: string }>(
            'select count(*) as n from caution_requests',
          )
        )[0]!.n,
      ),
    ).toBe(1);
  });

  it('`oui` twice (two messages, and one delivered twice): confirmed once, one debit, one release', async () => {
    const l = await lab();
    await l.give(PAYER, 10_000);
    const { id } = await l.quoted();
    const out = await Promise.all([
      l.say(PAYER, 'oui', 'tw-oui-a'),
      l.say(PAYER, 'oui', 'tw-oui-b'),
      l.say(PAYER, 'oui', 'tw-oui-a'),
    ]);
    expect(
      out.map((o) => o.outcome).filter((o) => o === 'confirmed'),
    ).toHaveLength(1);
    const job = (await l.claim()).job!;
    const rep = {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: l.timeoutFor(7 * 60_000),
    };
    const [a, b] = await Promise.all([
      l.caution.recheck(id, rep),
      l.caution.recheck(id, rep),
    ]);
    expect(a).toEqual(b); // the repeated report gets the same answer
    const done = {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'released' as const,
    };
    await Promise.all([l.caution.result(id, done), l.caution.result(id, done)]);
    expect(await l.ledger()).toEqual([{ kind: 'debit', amount: -8000 }]);
    expect(
      (await l.replies()).filter((t) => t.includes('a libéré')),
    ).toHaveLength(1);
  });

  it('an old attempt (an executor replaced meanwhile) is refused', async () => {
    const l = await lab();
    const { id } = await l.quoted();
    await l.say(PAYER, 'oui');
    const first = (await l.claim()).job!;
    l.core.clock.advance(CAUTION_EXEC.readLeaseMs + 1);
    const second = (await l.claim()).job!; // the read offered again (nothing debited)
    expect(second.attempt_id).not.toBe(first.attempt_id);
    await expect(
      l.caution.recheck(id, {
        ...EXEC,
        attempt_id: first.attempt_id,
        sanction: l.timeoutFor(60_000),
      }),
    ).rejects.toMatchObject({ code: 'not_current_attempt' });
  });
});

describe('Caution: Twitch failures, lost executors, restarts', () => {
  async function releasing(l: Awaited<ReturnType<typeof lab>>) {
    await l.give(PAYER, 10_000);
    const { id } = await l.quoted();
    const job = await l.confirmed();
    await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: l.timeoutFor(7 * 60_000),
    });
    return { id, job };
  }

  it('Twitch refuses the unban: refunded exactly once (a repeated report refunds nothing more)', async () => {
    const l = await lab();
    const { id, job } = await releasing(l);
    const rep = {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'not_applied' as const,
      error: 'Twitch 403',
    };
    await l.caution.result(id, rep);
    await l.caution.result(id, rep);
    expect(await l.tokens()).toBe(10_000);
    expect(await l.row(id)).toMatchObject({
      status: 'failed',
      money: 'refunded',
      reason: 'not_applied',
    });
    expect(await l.ledger()).toEqual([
      { kind: 'debit', amount: -8000 },
      { kind: 'refund', amount: 8000 },
    ]);
    expect((await l.replies()).at(-1)).toBe(
      'La libération de viewer2 a échoué : viewer1 a été remboursé de 8 000 jetons.',
    );
  });

  it('the timeout had already ended when the unban arrived: refunded once', async () => {
    const l = await lab();
    const { id, job } = await releasing(l);
    await l.caution.result(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'not_banned',
    });
    expect(await l.tokens()).toBe(10_000);
    expect((await l.replies()).at(-1)).toBe(
      "viewer2 n'était plus en timeout : viewer1 a été remboursé de 8 000 jetons.",
    );
  });

  it('an unknown outcome: « to verify », never refunded automatically; the bot’s journal settles it later', async () => {
    const l = await lab();
    const { id, job } = await releasing(l);
    await l.caution.result(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'uncertain',
      error: 'Twitch 503',
    });
    expect(await l.row(id)).toMatchObject({
      status: 'uncertain',
      money: 'to_verify',
    });
    expect(await l.tokens()).toBe(2_000);
    // The journal's check after a restart: certainly not lifted → refunded once.
    await l.caution.result(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'not_applied',
      verified: true,
    });
    expect(await l.tokens()).toBe(10_000);
    expect(await l.row(id)).toMatchObject({
      status: 'failed',
      money: 'refunded',
    });
  });

  it('the executor vanishes after the debit (no answer): « uncertain », to verify, no refund', async () => {
    const l = await lab();
    const { id } = await releasing(l);
    l.core.clock.advance(CAUTION_EXEC.releaseLeaseMs + 1);
    await l.claim(); // any claim sweeps
    expect(await l.row(id)).toMatchObject({
      status: 'uncertain',
      money: 'to_verify',
    });
    expect((await l.replies()).at(-1)).toBe(
      'Libération de viewer2 à vérifier par la modération (8 000 jetons payés par viewer1).',
    );
    expect(await l.tokens()).toBe(2_000);
  });

  it('Twitch unreadable at the quote or the re-read: nothing debited, said once', async () => {
    const l = await lab();
    await l.claim();
    await l.say(PAYER, '!caution viewer2');
    let job = (await l.claim()).job!;
    await l.caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      error: 'Twitch 500',
    });
    expect((await l.replies()).at(-1)).toBe(
      'Impossible de vérifier viewer2 pour le moment · aucun jeton débité.',
    );
    await l.give(PAYER, 10_000);
    const { id } = await l.quoted();
    job = await l.confirmed();
    await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      error: 'network',
    });
    expect(await l.row(id)).toMatchObject({
      status: 'failed',
      reason: 'twitch_unreadable',
      money: 'none',
    });
    expect(await l.tokens()).toBe(10_000);
  });

  it('bot absent: `!caution` refused at once; bot gone after the request: failed at the pickup deadline', async () => {
    const l = await lab();
    expect((await l.say(PAYER, '!caution viewer2')).outcome).toBe(
      'unavailable',
    );
    await l.claim();
    await l.say(PAYER, '!caution viewer2');
    l.core.clock.advance(CAUTION_EXEC.pickupMs + 1);
    await l.claim(); // the sweep
    const r = (
      await l.core.db.query<{ status: string; reason: string }>(
        'select status, reason from caution_requests order by seq desc limit 1',
      )
    )[0]!;
    expect(r).toEqual({ status: 'failed', reason: 'executor_absent' });
  });

  it('a read lost 3 times (before any debit): offered again, then failed', async () => {
    const l = await lab();
    await l.claim();
    await l.say(PAYER, '!caution viewer2');
    for (let i = 0; i < CAUTION_EXEC.maxAttempts; i++) {
      expect((await l.claim()).job?.phase).toBe('quote');
      l.core.clock.advance(CAUTION_EXEC.readLeaseMs + 1);
    }
    expect((await l.claim()).job).toBeNull();
    expect((await l.replies()).at(-1)).toBe(
      'Caution indisponible pour le moment · aucun jeton débité.',
    );
  });

  it('Core restarted in the middle (new process, same database): the caution goes on', async () => {
    const l = await lab();
    await l.give(PAYER, 10_000);
    const { id } = await l.quoted();
    l.restart();
    await l.claim(); // the executor seen by the new process
    const job = await l.confirmed();
    l.restart();
    await l.caution.recheck(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: l.timeoutFor(7 * 60_000),
    });
    l.restart();
    await l.caution.result(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'released',
    });
    expect(await l.row(id)).toMatchObject({ status: 'released' });
    expect(await l.tokens()).toBe(2_000);
  });

  it('missing Twitch right to unban: refused at the release claim, nothing debited', async () => {
    const l = await lab();
    await l.give(PAYER, 10_000);
    const { id } = await l.quoted();
    await l.say(PAYER, 'oui');
    expect((await l.claim({ read: true, release: false })).job).toBeNull();
    expect(await l.row(id)).toMatchObject({
      status: 'failed',
      reason: 'missing_scope_release',
      money: 'none',
    });
  });

  it('Studio’s simulator: real reads, the release simulated by Core (no unban job), said as a test', async () => {
    const l = await lab();
    await l.give(PAYER, 10_000);
    await l.claim();
    await l.caution.chat(
      l.msg(PAYER, '!caution viewer2', 'sim-1', 'simulator'),
    );
    let job = (await l.claim()).job!;
    expect(job.mode).toBe('dry_run');
    await l.caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: TARGET,
      sanction: l.timeoutFor(60_000),
    });
    await l.say(PAYER, 'oui');
    job = (await l.claim()).job!;
    expect(
      await l.caution.recheck(job.request_id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        sanction: l.timeoutFor(50_000),
      }),
    ).toEqual({ proceed: false, reason: 'dry_run' });
    expect(await l.row(job.request_id)).toMatchObject({
      status: 'released',
      reason: 'dry_run',
    });
    expect((await l.replies()).at(-1)).toMatch(/^\[test\] /);
  });
});

describe('Caution: the broadcaster’s Votekick mute', () => {
  function mutes(endsInMs: number | null) {
    const ended: string[] = [];
    let at: Date | null = null;
    const m: CautionMutes & { ended: string[]; start(now: Date): void } = {
      ended,
      start: (now) =>
        (at = endsInMs === null ? null : new Date(now.getTime() + endsInMs)),
      active: async () =>
        at && !ended.length ? { id: 'mute:vk-1', endsAt: at } : null,
      end: async (_q, _c, id) => void ended.push(id),
    };
    return m;
  }

  it('priced on the seconds left; `oui` debits and ends the mute in one go (no Twitch call)', async () => {
    const m = mutes(65_000);
    const l = await lab({ mutes: m });
    m.start(l.core.clock.now());
    await l.give(OTHER, 5_000);
    await l.claim();
    await l.say(OTHER, '!caution raptoru_');
    const job = (await l.claim()).job!;
    await l.caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: BROADCASTER,
      sanction: { kind: 'none' },
    });
    // 27/10: an OBS mute costs 300 Jetons per started 10 s (65 s → 7 × 300).
    expect((await l.replies()).at(-1)).toBe(
      'raptoru_ est réduit au silence (Votekick) encore 65 secondes. Le libérer coûte 2 100 jetons, @viewer3. Oui ou non ?',
    );
    expect((await l.say(OTHER, 'oui')).outcome).toBe('released');
    expect(m.ended).toEqual(['mute:vk-1']);
    expect(await l.tokens(OTHER)).toBe(2_900);
    expect((await l.claim()).job).toBeNull(); // nothing for the executor
  });

  it('not muted: told; the mute ended before `oui`: nothing debited', async () => {
    const none = mutes(null);
    let l = await lab({ mutes: none });
    await l.claim();
    await l.say(OTHER, '!caution raptoru_');
    let job = (await l.claim()).job!;
    await l.caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: BROADCASTER,
      sanction: { kind: 'none' },
    });
    expect((await l.replies()).at(-1)).toBe(
      "raptoru_ n'est pas actuellement réduit au silence.",
    );
    const m = mutes(10_000);
    l = await lab({ mutes: m });
    m.start(l.core.clock.now());
    await l.give(OTHER, 5_000);
    await l.claim();
    await l.say(OTHER, '!caution raptoru_');
    job = (await l.claim()).job!;
    await l.caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: BROADCASTER,
      sanction: { kind: 'none' },
    });
    l.core.clock.advance(10_000);
    expect((await l.say(OTHER, 'oui')).outcome).toBe('mute_over');
    expect(await l.tokens(OTHER)).toBe(5_000);
    expect(m.ended).toEqual([]);
  });
});

describe('Caution: the streamer’s OBS mutes — Votekick and Random Ban (V3, 27/10)', () => {
  /** A fake mute source: running from start() for `endsInMs`, ended by a caution (recorded). */
  function source(id: string, endsInMs: number) {
    const ended: string[] = [];
    let at: Date | null = null;
    const m: CautionMutes & { ended: string[]; start(now: Date): void } = {
      ended,
      start: (now) => (at = new Date(now.getTime() + endsInMs)),
      active: async () => (at && !ended.length ? { id, endsAt: at } : null),
      end: async (_q, _c, x) => void ended.push(x),
    };
    return m;
  }
  async function two(vkMs: number | null, rbMs: number | null) {
    const vk = source('mute:vk-1', vkMs ?? 0);
    const rb = source('rb:00000000-0000-4000-8000-000000000001', rbMs ?? 0);
    const l = await lab({
      mutes: [
        { kind: 'votekick', label: 'Votekick', source: vk },
        { kind: 'random_ban', label: 'Random Ban', source: rb },
      ],
    });
    if (vkMs !== null) vk.start(l.core.clock.now());
    if (rbMs !== null) rb.start(l.core.clock.now());
    await l.give(OTHER, 20_000);
    await l.claim();
    const ask = async (text: string) => {
      const out = await l.say(OTHER, text);
      if (out.outcome !== 'checking') return out;
      const job = (await l.claim()).job!;
      await l.caution.check(job.request_id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        target: BROADCASTER,
        sanction: { kind: 'none' },
      });
      return out;
    };
    return { l, vk, rb, ask };
  }

  it('the price: 300 per started 10 s (60 s → 1 800, 120 s → 3 600, 300 s → 9 000); Twitch timeouts unchanged', () => {
    expect(cautionMutePrice(60)).toBe(1_800);
    expect(cautionMutePrice(120)).toBe(3_600);
    expect(cautionMutePrice(300)).toBe(9_000);
    expect(cautionMutePrice(41)).toBe(1_500);
    expect(cautionMutePrice(0)).toBe(0);
    expect(cautionPrice(60)).toBe(1_000);
    expect(cautionPrice(61)).toBe(2_000);
  });

  it('the Random Ban mute alone: priced on the seconds left, `oui` ends it — and only it', async () => {
    const t = await two(null, 60_000);
    await t.ask('!caution raptoru_');
    expect((await t.l.replies()).at(-1)).toBe(
      'raptoru_ est réduit au silence (Random Ban) encore 60 secondes. Le libérer coûte 1 800 jetons, @viewer3. Oui ou non ?',
    );
    t.l.core.clock.advance(5_000); // the price is the quote's
    expect((await t.l.say(OTHER, 'oui')).outcome).toBe('released');
    expect(t.rb.ended).toEqual(['rb:00000000-0000-4000-8000-000000000001']);
    expect(t.vk.ended).toEqual([]);
    expect(await t.l.tokens(OTHER)).toBe(20_000 - 1_800);
  });

  it('both running: never chosen for the payer — he is asked to name one; then only that one ends', async () => {
    const t = await two(120_000, 60_000);
    await t.ask('!caution raptoru_');
    expect((await t.l.replies()).at(-1)).toBe(
      'raptoru_ est réduit au silence par Votekick (120 s) et Random Ban (60 s) : précise !caution raptoru_ votekick ou !caution raptoru_ rb',
    );
    expect(await t.l.tokens(OTHER)).toBe(20_000);
    await t.ask('!caution raptoru_ votekick');
    expect((await t.l.replies()).at(-1)).toContain(
      '(Votekick) encore 120 secondes. Le libérer coûte 3 600 jetons',
    );
    expect((await t.l.say(OTHER, 'oui')).outcome).toBe('released');
    expect(t.vk.ended).toEqual(['mute:vk-1']);
    expect(t.rb.ended).toEqual([]); // the Random Ban mute goes on
    await t.ask('!caution raptoru_ rb');
    expect((await t.l.replies()).at(-1)).toContain('(Random Ban) encore 60');
    expect((await t.l.say(OTHER, 'oui')).outcome).toBe('released');
    expect(t.rb.ended).toEqual(['rb:00000000-0000-4000-8000-000000000001']);
    expect(await t.l.tokens(OTHER)).toBe(20_000 - 3_600 - 1_800);
  });

  it('a named mute not running: told, nothing quoted; an unknown second word is not a command', async () => {
    const t = await two(null, 30_000);
    await t.ask('!caution raptoru_ votekick');
    expect((await t.l.replies()).at(-1)).toBe(
      "raptoru_ n'a pas de mute Votekick en cours.",
    );
    expect((await t.l.say(OTHER, '!caution raptoru_ bonjour')).outcome).toBe(
      'ignored',
    );
  });

  it('the mute over before `oui`: nothing debited, nothing ended', async () => {
    const t = await two(null, 20_000);
    await t.ask('!caution raptoru_');
    t.l.core.clock.advance(20_000);
    expect((await t.l.say(OTHER, 'oui')).outcome).toBe('mute_over');
    expect(t.rb.ended).toEqual([]);
    expect(await t.l.tokens(OTHER)).toBe(20_000);
  });

  it('`oui` delivered twice: one debit, one end', async () => {
    const t = await two(null, 60_000);
    await t.ask('!caution raptoru_');
    const id = 'tw-oui-1';
    expect((await t.l.say(OTHER, 'oui', id)).outcome).toBe('released');
    await t.l.say(OTHER, 'oui', id);
    expect(t.rb.ended).toHaveLength(1);
    expect(await t.l.tokens(OTHER)).toBe(20_000 - 1_800);
  });
});

describe('Caution in the chat router', () => {
  it('the main Core answers `!caution` only with cautionChat; `oui` (plain text) reaches it', async () => {
    const db = await createTestDb();
    const clock = new FakeClock(new Date('2026-10-23T20:00:00Z'));
    const off = createCore(
      db,
      clock,
      new DevFakeCreditProvider(),
      SHADOW_MODES,
    );
    expect(off.chat.chatModules.some((m) => m.name === 'caution')).toBe(false);
    const on = createCore(
      db,
      clock,
      new DevFakeCreditProvider(),
      SHADOW_MODES,
      null,
      labEconomy,
      {
        broadcasterId: CH,
        cautionChat: true,
      },
    );
    const router = chatRouter(on.raffleLab, on.chat.chatModules);
    await on.caution.claim(CH, {
      ...EXEC,
      can_read: true,
      can_release: true,
      missing: [],
    });
    const m = (text: string): LabChatMessage => ({
      channel_id: CH,
      message_id: `r-${++n}`,
      text,
      chatter: {
        id: PAYER.id,
        login: PAYER.login,
        display_name: PAYER.name,
        role: 'viewer',
      },
      source: 'twitch',
    });
    expect(
      (await router.message(m('!caution viewer2'))).handled,
    ).toContainEqual({ module: 'caution', outcome: 'checking' });
    const job = (
      await on.caution.claim(CH, {
        ...EXEC,
        can_read: true,
        can_release: true,
        missing: [],
      })
    ).job!;
    await on.caution.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: TARGET,
      sanction: {
        kind: 'timeout',
        ends_at: new Date(clock.now().getTime() + 60_000).toISOString(),
      },
    });
    expect((await router.message(m('non'))).handled).toContainEqual({
      module: 'caution',
      outcome: 'cancelled',
    });
  });
});
