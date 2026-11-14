import type { CautionSanction, LabChatMessage } from '@raptoru/schemas';
import { cautionMutePrice, cautionPrice } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// Caution on the module host (architecture/MIGRATIONS.md, adapter): the H10 rates really applied to the quote, a quote
// keeping the price it announced even if Studio changes the rate before « oui » (ONE debit of the quoted price), the
// SAMMI prices by default, the supervision from the real executor. Fictional channel and viewers, Lab wallet.

const CH = '83603689';
const user = (k: number) => ({
  id: String(9100 + k),
  login: `cv${k}`,
  name: `Cv${k}`,
});
const PAYER = user(1);
const TARGET = user(2);
const EXEC = { executor_id: 'bot-1', login: 'lecroupier_' };
let n = 0;

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-10-23T20:00:00Z'));
  const c = core.caution;
  const msg = (u: typeof PAYER, text: string): LabChatMessage => ({
    channel_id: CH,
    message_id: `cm-${++n}`,
    text,
    chatter: { id: u.id, login: u.login, display_name: u.name, role: 'viewer' },
    source: 'twitch',
  });
  const claim = () =>
    c.claim(CH, { ...EXEC, can_read: true, can_release: true, missing: [] });
  const timeoutFor = (ms: number): CautionSanction => ({
    kind: 'timeout',
    ends_at: new Date(core.clock.now().getTime() + ms).toISOString(),
  });
  const quote = async (ms: number) => {
    await claim();
    expect((await c.chat(msg(PAYER, `!caution @${TARGET.name}`))).outcome).toBe(
      'checking',
    );
    const job = (await claim()).job!;
    const q = await c.check(job.request_id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      target: TARGET,
      sanction: timeoutFor(ms),
    });
    return { id: job.request_id, q };
  };
  const pay = async (id: string, ms: number) => {
    expect((await c.chat(msg(PAYER, 'oui'))).outcome).toBe('confirmed');
    const job = (await claim()).job!;
    return c.recheck(id, {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: timeoutFor(ms),
    });
  };
  const tokens = async () =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, PAYER.id],
        )
      )[0]?.tokens ?? 0,
    );
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    PAYER.id,
    'set',
    { tokens: 20_000 },
    'test',
  );
  const set = (key: string, value: number) =>
    core.moduleSettings.set(CH, `caution.${key}`, value, 'test');
  return { core, quote, pay, tokens, set };
}

describe('Caution on the module host (adapter)', () => {
  it('defaults = SAMMI and the 27/10 decision: 1 000 per started minute, 300 per started 10 s of mute', async () => {
    expect([cautionPrice(61), cautionMutePrice(61)]).toEqual([2_000, 2_100]);
    const l = await lab();
    const { q } = await l.quote(8 * 60_000 - 31_000);
    expect(q).toEqual({ status: 'quoted', price: 8_000 });
  });

  it('the rate set in Studio prices the next quote; a quote keeps its price when the rate changes before « oui »', async () => {
    const l = await lab();
    await l.set('price_per_minute', 500);
    const { id, q } = await l.quote(8 * 60_000 - 31_000);
    expect(q).toEqual({ status: 'quoted', price: 4_000 });
    await l.set('price_per_minute', 2_000); // raised while the payer reads the quote
    const go = await l.pay(id, 7 * 60_000);
    expect(go).toEqual({ proceed: true, target_id: TARGET.id }); // never « prolongé » because of a rate
    expect(await l.tokens()).toBe(16_000); // ONE debit, the quoted price
  });

  it('14/11: a Random Ban timeout costs 3 000 per started minute; any other timeout, or a Random Ban extended by the moderation, the general rate', async () => {
    const l = await lab();
    const rb = async (confirmedAgoMs: number, durationS: number) =>
      l.core.db.query(
        `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name,
           status, target_id, target_login, target_name, duration_s, created_at, updated_at, ended_at)
         values (gen_random_uuid(), $1, 'chat', $2, 'real', '9999', 'acheteur', 'Acheteur', 'confirmed', $3, $4, $5, $6,
           $7, $7, $7)`,
        [
          CH,
          `chat:${++n}`,
          TARGET.id,
          TARGET.login,
          TARGET.name,
          durationS,
          new Date(l.core.clock.now().getTime() - confirmedAgoMs),
        ],
      );
    // A moderator's 4-minute timeout: 1 000 per minute.
    expect((await l.quote(4 * 60_000)).q).toEqual({
      status: 'quoted',
      price: 4_000,
    });
    await l.core.clock.advance(31_000); // the quote expires
    // A Random Ban of 5 min confirmed 1 min ago: 4 min left (Twitch's end within a few seconds of ours).
    await rb(60_000, 300);
    const { id, q } = await l.quote(4 * 60_000 - 3_000);
    expect(q).toEqual({ status: 'quoted', price: 12_000 });
    // The price announced is the price debited (ONE debit).
    expect(await l.pay(id, 4 * 60_000 - 5_000)).toEqual({
      proceed: true,
      target_id: TARGET.id,
    });
    expect(await l.tokens()).toBe(8_000);
    // Extended to 20 min by the moderation: no longer the Random Ban's end — the general rate.
    const l2 = await lab();
    await l2.core.db.query(
      `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name,
         status, target_id, target_login, target_name, duration_s, created_at, updated_at, ended_at)
       values (gen_random_uuid(), $1, 'chat', 'chat:x', 'real', '9999', 'a', 'A', 'confirmed', $2, $3, $3, 300, $4, $4, $4)`,
      [CH, TARGET.id, TARGET.login, l2.core.clock.now()],
    );
    expect((await l2.quote(20 * 60_000)).q).toEqual({
      status: 'quoted',
      price: 20_000,
    });
  });

  it('supervision: waiting without the Twitch executor, ready once it reports; bounds refused', async () => {
    const l = await lab();
    expect(await l.core.modules.status(CH, 'caution')).toMatchObject({
      observed: 'waiting',
    });
    await l.core.caution.claim(CH, {
      ...EXEC,
      can_read: true,
      can_release: true,
      missing: [],
    });
    expect(await l.core.modules.status(CH, 'caution')).toMatchObject({
      observed: 'ready',
    });
    await expect(l.set('price_per_minute', 0)).rejects.toMatchObject({
      code: 'out_of_bounds',
    });
  });
});
