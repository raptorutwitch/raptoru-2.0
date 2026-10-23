import type { LabChatMessage } from '@raptoru/schemas';
import { VOTEKICK, VOTEKICK_EXEC } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { memoryRbJournal } from '../../twitch-bot/src/random-ban-executor.js';
import { HelixError } from '../../twitch-bot/src/twitch/helix.js';
import {
  createVotekickExecutor,
  type VotekickTwitch,
} from '../../twitch-bot/src/votekick-executor.js';
import { votekickRoutes } from '../src/http/votekick-routes.js';
import { HttpError } from '../src/http/server.js';
import { VotekickService } from '../src/votekick/service.js';
import { setup } from './helpers.js';

// Votekick end to end (docs/VOTEKICK_V2.md § 9): the real Core service behind its real HTTP routes (body validation
// included), the real bot executor with its journal, a SIMULATED Twitch (users, moderators, list of bans, Ban User with
// failure switches — never a real call). The timeout always lands on the user the verdict names, at most once.

const CH = '83603689';
const INIT = { id: '9001', login: 'viewer1', name: 'Viewer1' };
const TARGET = { id: '9002', login: 'viewer2', name: 'Viewer2' };
const MOD = { id: '9009', login: 'modo', name: 'Modo' };
const voters = ['9101', '9102', '9103'].map((id) => ({
  id,
  login: `v${id}`,
  name: `V${id}`,
}));

type BanMode =
  | 'ok'
  | 'forbidden'
  | 'server_error_applied'
  | 'server_error_not_applied'
  | 'hang';

function simTwitch(now: () => number) {
  const bans = new Map<string, number>();
  const t: {
    bans: Map<string, number>;
    calls: { id: string; seconds: number }[];
    mode: BanMode;
    port: VotekickTwitch;
  } = {
    bans,
    calls: [] as { id: string; seconds: number }[],
    mode: 'ok' as BanMode,
    port: {
      user: async (login: string) =>
        [INIT, TARGET, MOD, ...voters].find((u) => u.login === login) ?? null,
      moderators: async (ids: string[]) => ids.filter((id) => id === MOD.id),
      bans: async (ids: string[]) =>
        ids
          .filter((id) => (bans.get(id) ?? 0) > now())
          .map((id) => ({
            user_id: id,
            expires_at: new Date(bans.get(id)!).toISOString(),
          })),
      ban: async (id: string, seconds: number) => {
        t.calls.push({ id, seconds });
        switch (t.mode) {
          case 'ok':
            bans.set(id, now() + seconds * 1000);
            return;
          case 'forbidden':
            throw new HelixError(403, 'not a moderator');
          case 'server_error_applied':
            bans.set(id, now() + seconds * 1000);
            throw new HelixError(500, 'oops');
          case 'server_error_not_applied':
            throw new HelixError(500, 'oops');
          case 'hang':
            return new Promise<void>(() => {});
        }
      },
    },
  };
  return t;
}

async function chain() {
  const core = await setup();
  core.clock.set(new Date('2026-10-23T20:00:00Z'));
  const now = () => core.clock.now().getTime();
  const vk = new VotekickService(
    core.db,
    core.clock,
    () => CH,
    () => 0,
  );
  const routes = votekickRoutes(vk);
  const coreCall = async (path: string, body: unknown) => {
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
  const journal = memoryRbJournal();
  const executor = () =>
    createVotekickExecutor({
      core: coreCall,
      channelId: CH,
      broadcasterId: CH,
      executorId: 'lab-chat-1',
      login: 'lecroupier_',
      botScopes: ['moderator:manage:banned_users'],
      broadcasterScopes: ['moderation:read'],
      twitch: twitch.port,
      journal,
      pause: async () => {},
      now,
      log: () => {},
    });
  let bot = executor();
  let n = 0;
  const msg = (u: typeof INIT, text: string): LabChatMessage => ({
    channel_id: CH,
    message_id: `tw-${++n}`,
    text,
    chatter: { id: u.id, login: u.login, display_name: u.name, role: 'viewer' },
    source: 'twitch',
  });
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'votekick:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const applied = async () =>
    (
      await core.db.query<{ applied: string | null; status: string }>(
        'select applied, status from votekick_votes order by created_at desc limit 1',
      )
    )[0]!;
  /** A full vote against `target` with `kicks` KICK voters, ended; the executor gets the timeout job. */
  async function verdict(target = TARGET, kicks = 2) {
    await bot.tick(); // seen by Core
    await vk.chat(msg(INIT, `!votekick ${target.login}`));
    await bot.tick(); // check
    for (const v of voters.slice(0, kicks)) await vk.chat(msg(v, '!kick'));
    core.clock.advance(VOTEKICK.voteMs + VOTEKICK.finishGraceMs);
    await vk.tick();
  }
  return {
    core,
    vk,
    twitch,
    journal,
    get bot() {
      return bot;
    },
    restartBot: () => (bot = executor()),
    msg,
    replies,
    applied,
    verdict,
  };
}

describe('Votekick chain: Core ↔ bot ↔ simulated Twitch', () => {
  it('opened, decided, the target timed out ONCE for the verdict duration; nothing left in the journal', async () => {
    const c = await chain();
    await c.verdict();
    await c.bot.tick();
    expect(c.twitch.calls).toEqual([{ id: TARGET.id, seconds: 2 * 6 * 60 }]);
    expect(await c.applied()).toEqual({ applied: 'confirmed', status: 'done' });
    await c.bot.tick();
    expect(c.twitch.calls).toHaveLength(1);
    expect(c.journal.entries()).toEqual([]);
  });

  it('a moderator target: refused at the check, nobody timed out', async () => {
    const c = await chain();
    await c.bot.tick();
    await c.vk.chat(c.msg(INIT, '!votekick modo'));
    await c.bot.tick();
    expect((await c.replies()).at(-1)).toBe(
      'Tu ne peux pas cibler un modérateur',
    );
    expect(c.twitch.calls).toEqual([]);
  });

  it('Twitch 403: refused and told; 500 but applied: confirmed (verified); 500 not applied: refused (verified)', async () => {
    let c = await chain();
    c.twitch.mode = 'forbidden';
    await c.verdict();
    await c.bot.tick();
    expect(await c.applied()).toMatchObject({ applied: 'refused' });
    expect((await c.replies()).at(-1)).toBe(
      'Twitch a refusé le timeout de viewer2 (Votekick).',
    );
    c = await chain();
    c.twitch.mode = 'server_error_applied';
    await c.verdict();
    await c.bot.tick();
    expect(await c.applied()).toMatchObject({ applied: 'confirmed' });
    c = await chain();
    c.twitch.mode = 'server_error_not_applied';
    await c.verdict();
    await c.bot.tick();
    expect(await c.applied()).toMatchObject({ applied: 'refused' });
    expect(c.twitch.calls).toHaveLength(1); // a 5xx is never sent again
  });

  it('the bot dies during Ban User: Core marks it uncertain; the restarted bot settles its journal, never bans again', async () => {
    const c = await chain();
    c.twitch.mode = 'hang';
    await c.verdict();
    void c.bot.tick(); // hangs inside Ban User (journal written first)
    await new Promise((r) => setTimeout(r, 20));
    expect(c.journal.entries()).toMatchObject([
      { state: 'about_to_timeout', target_id: TARGET.id },
    ]);
    c.core.clock.advance(VOTEKICK_EXEC.timeoutLeaseMs);
    await c.vk.tick();
    expect(await c.applied()).toMatchObject({ applied: 'uncertain' });
    c.twitch.mode = 'ok';
    c.restartBot();
    await c.bot.tick(); // recovery: reported (Core already decided), entry removed
    expect(c.journal.entries()).toEqual([]);
    expect(c.twitch.calls).toHaveLength(1);
  });

  it('Backfire: the INITIATOR is timed out, never the target', async () => {
    const c = await chain();
    await c.bot.tick();
    await c.vk.chat(c.msg(INIT, '!votekick viewer2'));
    await c.bot.tick();
    await c.vk.chat(c.msg(voters[0]!, '!save'));
    await c.vk.chat(c.msg(voters[1]!, '!save'));
    c.core.clock.advance(VOTEKICK.voteMs + VOTEKICK.finishGraceMs);
    await c.vk.tick();
    await c.bot.tick();
    expect(c.twitch.calls.map((x: { id: string }) => x.id)).toEqual([INIT.id]);
  });
});
