import type { LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  createCautionExecutor,
  memoryCautionJournal,
  type CautionJournal,
  type CautionTwitch,
} from '../../twitch-bot/src/caution-executor.js';
import { HelixError } from '../../twitch-bot/src/twitch/helix.js';
import { CautionService, type CautionMutes } from '../src/caution/service.js';
import {
  coreWalletEconomy,
  labEconomy,
  type EconomyPort,
} from '../src/economy/economy.js';
import { cautionRoutes } from '../src/http/caution-routes.js';
import { HttpError } from '../src/http/server.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// Caution end to end (docs/CAUTION.md): the real Core service behind its real HTTP routes (body validation included),
// the real bot executor with its journal, a SIMULATED Twitch (users, list of bans, Unban User with failure switches —
// never a real call). Run on the Lab test wallet AND the canonical Wallet (the Jetons after the cutover).

const CH = '83603689';
const PAYER = { id: '9001', login: 'viewer1', name: 'Viewer1' };
const TARGET = { id: '9002', login: 'viewer2', name: 'Viewer2' };
const BROADCASTER = { id: CH, login: 'raptoru_', name: 'Raptoru_' };

type UnbanMode =
  | 'ok'
  | 'forbidden' // 403: not applied
  | 'server_error_listed' // 500, still listed: uncertain
  | 'server_error_lifted' // 500 but it was lifted: released (verified)
  | 'not_banned' // 400: the timeout ended by itself
  | 'never_sent' // network unreachable each time, still listed: not applied
  | 'hang'; // never answers (the bot dies during the call)

/** A small simulated Twitch: users, the list of bans (expires_at '' = permanent), Unban User and its calls. */
function simTwitch(now: () => number) {
  const bans = new Map<string, string>();
  const t: {
    bans: Map<string, string>;
    unbans: string[];
    unban: UnbanMode;
    unreadable: boolean;
    port: CautionTwitch;
  } = {
    bans,
    unbans: [] as string[],
    unban: 'ok' as UnbanMode,
    unreadable: false,
    port: {
      user: async (login: string) =>
        [PAYER, TARGET, BROADCASTER].find((u) => u.login === login) ?? null,
      bans: async (ids: string[]) => {
        if (t.unreadable) throw new HelixError(503, 'unavailable');
        return ids
          .filter((id) => bans.has(id))
          .map((id) => ({ user_id: id, expires_at: bans.get(id)! }))
          .filter((b) => !b.expires_at || Date.parse(b.expires_at) > now());
      },
      unban: async (id: string) => {
        t.unbans.push(id);
        switch (t.unban) {
          case 'ok':
            bans.delete(id);
            return;
          case 'forbidden':
            throw new HelixError(403, 'not a moderator');
          case 'server_error_listed':
            throw new HelixError(500, 'oops');
          case 'server_error_lifted':
            bans.delete(id);
            throw new HelixError(500, 'oops');
          case 'not_banned':
            bans.delete(id);
            throw new HelixError(
              400,
              'The user specified in the user_id field is not banned.',
            );
          case 'never_sent':
            throw Object.assign(new Error('fetch failed'), {
              cause: { code: 'ECONNREFUSED' },
            });
          case 'hang':
            return new Promise<void>(() => {});
        }
      },
    },
  };
  return t;
}

const ECONOMIES = ['lab', 'canonical'] as const;

async function chain(
  kind: (typeof ECONOMIES)[number],
  mutes: CautionMutes | null = null,
) {
  const core = await setup();
  core.clock.set(new Date('2026-10-23T20:00:00Z'));
  const now = () => core.clock.now().getTime();
  const economy: EconomyPort =
    kind === 'lab' ? labEconomy : coreWalletEconomy(core.wallet.wallet);
  const caution = new CautionService(
    core.db,
    core.clock,
    economy,
    () => CH,
    mutes,
  );
  const routes = cautionRoutes(caution);
  let coreDown = false;
  /** The bot's HTTP client to Core, through the real routes. */
  const coreCall = async (path: string, body: unknown) => {
    if (coreDown) throw new Error('core unreachable');
    for (const r of routes) {
      const m = r.method === 'POST' ? r.pattern.exec(path) : null;
      if (!m) continue;
      try {
        const out = await r.handle({
          params: m.slice(1),
          body,
          url: new URL(`http://core${path}`),
        } as never);
        return { status: 200, body: out };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, body: e.body };
        throw e;
      }
    }
    return { status: 404, body: null };
  };
  const twitch = simTwitch(now);
  const executor = (journal: CautionJournal = memoryCautionJournal()) =>
    createCautionExecutor({
      core: coreCall,
      channelId: CH,
      broadcasterId: CH,
      executorId: 'bot-lecroupier',
      login: 'lecroupier_',
      botScopes: ['moderator:manage:banned_users'],
      broadcasterScopes: ['moderation:read'],
      twitch: twitch.port,
      journal,
      pause: async () => {},
      now,
      log: () => {},
    });
  let n = 0;
  const say = (u: typeof PAYER, text: string) =>
    caution.chat({
      channel_id: CH,
      message_id: `tw-${++n}`,
      text,
      chatter: {
        id: u.id,
        login: u.login,
        display_name: u.name,
        role: 'viewer',
      },
      source: 'twitch',
    } satisfies LabChatMessage);
  const fund = async (amount: number) => {
    if (kind === 'lab')
      await editWallet(
        core.db,
        core.clock.now(),
        CH,
        PAYER.id,
        'set',
        { tokens: amount },
        'test',
      );
    else
      await core.wallet.wallet.credit({
        key: `fund-${++n}`,
        viewer: {
          twitchUserId: PAYER.id,
          login: PAYER.login,
          displayName: PAYER.name,
        },
        amount,
        source: 'test',
      });
  };
  const balance = async () =>
    kind === 'lab'
      ? Number(
          (
            await core.db.query<{ tokens: number }>(
              'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
              [CH, PAYER.id],
            )
          )[0]?.tokens ?? 0,
        )
      : ((await core.wallet.wallet.getWallet(PAYER.id))?.balance ?? 0);
  const last = async () =>
    (
      await core.db.query<{
        status: string;
        money: string;
        reason: string | null;
      }>(
        'select status, money, reason from caution_requests order by seq desc limit 1',
      )
    )[0]!;
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'caution:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  /** `!caution viewer2` → the bot reads → quoted. */
  async function quoted(ex = executor(), minutes = 8) {
    twitch.bans.set(
      TARGET.id,
      new Date(now() + minutes * 60_000 - 31_000).toISOString(),
    );
    await ex.tick(); // seen by Core (idle claim)
    expect((await say(PAYER, '!caution @viewer2')).outcome).toBe('checking');
    expect(await ex.tick()).toBe('worked');
    expect(await last()).toMatchObject({ status: 'quoted' });
    return ex;
  }
  return {
    core,
    caution,
    twitch,
    executor,
    say,
    fund,
    balance,
    last,
    replies,
    quoted,
    setCoreDown: (v: boolean) => (coreDown = v),
  };
}

describe.each(ECONOMIES)('Caution end to end (%s wallet)', (kind) => {
  it('paid, lifted once on Twitch, released; the payer debited once', async () => {
    const c = await chain(kind);
    await c.fund(10_000);
    const ex = await c.quoted();
    expect((await c.say(PAYER, 'oui')).outcome).toBe('confirmed');
    expect(c.twitch.unbans).toEqual([]); // nothing before the re-read and the debit
    await ex.tick();
    expect(c.twitch.unbans).toEqual([TARGET.id]);
    expect(c.twitch.bans.has(TARGET.id)).toBe(false);
    expect(await c.last()).toMatchObject({
      status: 'released',
      money: 'debited',
    });
    expect(await c.balance()).toBe(2_000);
    expect((await c.replies()).at(-1)).toBe(
      '@viewer1 a libéré viewer2 pour 8 000 jetons !',
    );
    expect(await ex.tick()).toBe('idle');
  });

  it('Twitch refuses the unban (403): refunded exactly once', async () => {
    const c = await chain(kind);
    await c.fund(10_000);
    const ex = await c.quoted();
    c.twitch.unban = 'forbidden';
    await c.say(PAYER, 'oui');
    await ex.tick();
    await ex.tick();
    expect(await c.last()).toMatchObject({
      status: 'failed',
      money: 'refunded',
      reason: 'not_applied',
    });
    expect(await c.balance()).toBe(10_000);
    expect(c.twitch.bans.has(TARGET.id)).toBe(true);
  });

  it('Twitch 500 and still listed: « uncertain », the Jetons stay (to verify), never refunded automatically', async () => {
    const c = await chain(kind);
    await c.fund(10_000);
    const ex = await c.quoted();
    c.twitch.unban = 'server_error_listed';
    await c.say(PAYER, 'oui');
    await ex.tick();
    expect(await c.last()).toMatchObject({
      status: 'uncertain',
      money: 'to_verify',
    });
    expect(await c.balance()).toBe(2_000);
  });
});

describe('Caution end to end: Twitch answers and interruptions (Lab wallet)', () => {
  it('Twitch 500 but the list shows it lifted: released (verified), no refund', async () => {
    const c = await chain('lab');
    await c.fund(10_000);
    const ex = await c.quoted();
    c.twitch.unban = 'server_error_lifted';
    await c.say(PAYER, 'oui');
    await ex.tick();
    expect(await c.last()).toMatchObject({
      status: 'released',
      money: 'debited',
    });
  });

  it('the timeout ended by itself at the unban (400): refunded once', async () => {
    const c = await chain('lab');
    await c.fund(10_000);
    const ex = await c.quoted();
    c.twitch.unban = 'not_banned';
    await c.say(PAYER, 'oui');
    await ex.tick();
    expect(await c.last()).toMatchObject({
      status: 'failed',
      money: 'refunded',
      reason: 'not_banned',
    });
    expect(await c.balance()).toBe(10_000);
  });

  it('Twitch unreachable (the unban never left), still listed: not applied, refunded once', async () => {
    const c = await chain('lab');
    await c.fund(10_000);
    const ex = await c.quoted();
    c.twitch.unban = 'never_sent';
    await c.say(PAYER, 'oui');
    await ex.tick();
    expect(c.twitch.unbans).toHaveLength(3);
    expect(await c.last()).toMatchObject({
      status: 'failed',
      money: 'refunded',
    });
    expect(await c.balance()).toBe(10_000);
  });

  it('the timeout lifted by a moderator between the quote and `oui`: nothing debited, no unban', async () => {
    const c = await chain('lab');
    await c.fund(10_000);
    const ex = await c.quoted();
    c.twitch.bans.delete(TARGET.id);
    await c.say(PAYER, 'oui');
    await ex.tick();
    expect(await c.last()).toMatchObject({
      status: 'refused',
      reason: 'no_longer',
      money: 'none',
    });
    expect(c.twitch.unbans).toEqual([]);
    expect(await c.balance()).toBe(10_000);
  });

  it('the list of bans unreadable at the re-read: nothing debited, no unban', async () => {
    const c = await chain('lab');
    await c.fund(10_000);
    const ex = await c.quoted();
    c.twitch.unreadable = true;
    await c.say(PAYER, 'oui');
    await ex.tick();
    expect(await c.last()).toMatchObject({
      status: 'failed',
      reason: 'twitch_unreadable',
      money: 'none',
    });
    expect(c.twitch.unbans).toEqual([]);
  });

  it('the bot dies during the unban: the restarted bot settles it from the list (lifted → released)', async () => {
    const c = await chain('lab');
    await c.fund(10_000);
    const journal = memoryCautionJournal();
    const ex = await c.quoted(c.executor(journal));
    c.twitch.unban = 'hang';
    await c.say(PAYER, 'oui');
    void ex.tick(); // stays inside Unban User
    await new Promise((r) => setTimeout(r, 20));
    expect(journal.entries()).toMatchObject([{ state: 'about_to_release' }]);
    expect(await c.last()).toMatchObject({
      status: 'releasing',
      money: 'debited',
    });
    c.twitch.bans.delete(TARGET.id); // the unban had in fact reached Twitch
    const restarted = c.executor(journal);
    await restarted.recover();
    expect(journal.entries()).toEqual([]);
    expect(await c.last()).toMatchObject({ status: 'released' });
  });

  it('the bot dies during the unban, still listed: « uncertain », never refunded automatically', async () => {
    const c = await chain('lab');
    await c.fund(10_000);
    const journal = memoryCautionJournal();
    const ex = await c.quoted(c.executor(journal));
    c.twitch.unban = 'hang';
    await c.say(PAYER, 'oui');
    void ex.tick();
    await new Promise((r) => setTimeout(r, 20));
    await c.executor(journal).recover();
    expect(await c.last()).toMatchObject({
      status: 'uncertain',
      money: 'to_verify',
    });
    expect(await c.balance()).toBe(2_000);
  });

  it('Core unreachable when the bot reports: the journal keeps the outcome and delivers it once Core is back', async () => {
    const c = await chain('lab');
    await c.fund(10_000);
    const journal = memoryCautionJournal();
    const ex = await c.quoted(c.executor(journal));
    await c.say(PAYER, 'oui');
    // Core goes down right after answering « proceed » (the unban happens, the report is lost).
    const realTick = ex.tick;
    const go = c.caution.recheck.bind(c.caution);
    c.caution.recheck = async (...a) => {
      const out = await go(...a);
      c.setCoreDown(true);
      return out;
    };
    await realTick();
    expect(c.twitch.unbans).toEqual([TARGET.id]);
    expect(journal.entries()).toMatchObject([
      { state: 'done', outcome: { event: 'released' } },
    ]);
    expect(await c.last()).toMatchObject({ status: 'releasing' });
    c.setCoreDown(false);
    await ex.tick();
    expect(journal.entries()).toEqual([]);
    expect(await c.last()).toMatchObject({ status: 'released' });
    expect(await c.balance()).toBe(2_000);
  });

  it('the broadcaster’s mute: the bot only reads the user; `oui` ends the mute in Core, never an unban', async () => {
    const ended: string[] = [];
    const mutes: CautionMutes = {
      active: async () =>
        ended.length
          ? null
          : {
              id: 'mute:vk',
              endsAt: new Date(Date.parse('2026-10-23T20:00:50Z')),
            },
      end: async (_q, _c, id) => void ended.push(id),
    };
    const c = await chain('lab', mutes);
    await editWallet(
      c.core.db,
      c.core.clock.now(),
      CH,
      PAYER.id,
      'set',
      { tokens: 5_000 },
      'test',
    );
    const ex = c.executor();
    await ex.tick();
    await c.say(PAYER, '!caution raptoru_');
    await ex.tick();
    expect((await c.replies()).at(-1)).toContain(
      'raptoru_ est réduit au silence encore 50 secondes',
    );
    expect((await c.say(PAYER, 'oui')).outcome).toBe('released');
    expect(ended).toEqual(['mute:vk']);
    expect(c.twitch.unbans).toEqual([]);
    expect(await ex.tick()).toBe('idle');
  });
});
