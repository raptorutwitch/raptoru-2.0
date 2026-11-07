import type { LabChatMessage } from '@raptoru/schemas';
import { VOTEKICK, votekickMinutes } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

// Votekick on the module host (architecture/MIGRATIONS.md, adapter): parity with the SAMMI rules by default, the H10
// settings (initiator's delay, sanction range) really applied by the engine, the supervision from the real executor.
// Fictional channel and viewers; the Twitch executor played by its reports.

const CH = '83603689';
const user = (k: number) => ({
  id: String(7100 + k),
  login: `vk${k}`,
  name: `Vk${k}`,
});
const INIT = user(1);
const TARGET = user(2);
const EXEC = { executor_id: 'bot-1', login: 'lecroupier_' };
let n = 0;

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-10-23T20:00:00Z'));
  const vk = core.votekick;
  const msg = (u: typeof INIT, text: string): LabChatMessage => ({
    channel_id: CH,
    message_id: `vkm-${++n}`,
    text,
    chatter: { id: u.id, login: u.login, display_name: u.name, role: 'viewer' },
    source: 'twitch',
  });
  const claim = () =>
    vk.claim(CH, { ...EXEC, can_read: true, can_timeout: true, missing: [] });
  const open = async () => {
    await claim();
    expect(
      (await vk.chat(msg(INIT, `!votekick @${TARGET.name}`))).outcome,
    ).toBe('checking');
    const job = (await claim()).job!;
    await vk.check(job.vote_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: TARGET,
      moderator: false,
    });
  };
  const kicks = async (k: number) => {
    for (let i = 3; i < 3 + k; i++) await vk.chat(msg(user(i), '!kick'));
  };
  const end = async () => {
    core.clock.advance(VOTEKICK.voteMs + VOTEKICK.finishGraceMs);
    await vk.tick();
  };
  const last = async () =>
    (
      await core.db.query<{ outcome: string; duration_s: number }>(
        'select outcome, duration_s from votekick_votes order by created_at desc limit 1',
      )
    )[0]!;
  const set = (key: string, value: number) =>
    core.moduleSettings.set(CH, `votekick.${key}`, value, 'test');
  return { core, vk, msg, claim, open, kicks, end, last, set };
}

describe('Votekick on the module host (adapter)', () => {
  it('defaults = the SAMMI rules: 3 KICK (initiator + 2) → 6 min; the range function is the same curve', async () => {
    expect(votekickMinutes(3)).toBe(6);
    expect(votekickMinutes(3, { minMinutes: 5, maxMinutes: 30 })).toBe(6);
    const l = await lab();
    await l.open();
    await l.kicks(2);
    await l.end();
    expect(await l.last()).toMatchObject({
      outcome: 'target_timeout_perfect',
      duration_s: 6 * 2 * 60,
    });
  });

  it('the sanction range set in Studio is the one the verdict applies; an inverted range is read in order', async () => {
    const l = await lab();
    await l.set('sanction_min_minutes', 10);
    await l.set('sanction_max_minutes', 20);
    await l.open();
    await l.kicks(2);
    await l.end();
    // round(10 + (3 − 2) × 10 / 18) = 11 min, Perfect ×2.
    expect(await l.last()).toMatchObject({
      outcome: 'target_timeout_perfect',
      duration_s: 11 * 2 * 60,
    });
    expect(votekickMinutes(3, { minMinutes: 20, maxMinutes: 10 })).toBe(11);
  });

  it('the initiator’s delay set in Studio is the one recorded at the opening', async () => {
    const l = await lab();
    await l.set('initiator_cooldown_min', 10);
    await l.open();
    await l.end();
    expect((await l.vk.chat(l.msg(INIT, '!votekick vk3'))).outcome).toBe(
      'cooldown',
    );
    l.core.clock.advance(10 * 60_000);
    await l.claim();
    expect((await l.vk.chat(l.msg(INIT, '!votekick vk3'))).outcome).toBe(
      'checking',
    ); // 10 min, not 1 h
  });

  it('supervision: never ready without the Twitch executor; ready once it reports; bounds refused', async () => {
    const l = await lab();
    const before = await l.core.modules.status(CH, 'votekick');
    expect(before).toMatchObject({ observed: 'waiting' });
    await l.claim();
    expect(await l.core.modules.status(CH, 'votekick')).toMatchObject({
      observed: 'ready',
    });
    const cat = (await l.core.modules.catalog(CH)).modules.find(
      (m) => m.id === 'votekick',
    )!;
    expect(cat.settings).toEqual([
      'votekick.initiator_cooldown_min',
      'votekick.sanction_min_minutes',
      'votekick.sanction_max_minutes',
    ]);
    await expect(l.set('sanction_max_minutes', 0)).rejects.toMatchObject({
      code: 'out_of_bounds',
    });
  });
});
