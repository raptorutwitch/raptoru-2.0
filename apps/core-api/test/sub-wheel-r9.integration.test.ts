// Roue du Sub V2, lot R9 on a real Postgres, two Cores on two pools (plan § 12, P13–P14): two messages of one viewer at
// once → ONE invitation, ONE message from LeCroupier_; the chat answer and « !roue oui » at once → each tour requested
// once, nothing credited. Counter-proof: without the viewer lock and the unique invitation, two invitations.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
import { randomUUID } from 'node:crypto';
import type { LabChatMessage } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { SubWheelChat } from '../src/sub-wheel/chat.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock, setup } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';
import { barrier, tampered } from './sw-race.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const T0 = new Date('2026-10-22T20:00:00Z');

describe.skipIf(!isLocal)('Roue du Sub V2 — R9, real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  let a: Db, b: Db;
  let clock: FakeClock;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    b = createPgDb(url!);
    pools.push(a, b);
  }, LOCK_WAIT_MS);
  beforeEach(async () => {
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    clock = new FakeClock(T0);
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  const wheel = (db: Db) =>
    new SubWheelService(
      db,
      clock,
      () => 0,
      coreWalletEconomy(new WalletService(db)),
    );
  const chat = (db: Db) => new SubWheelChat(db, clock, wheel(db));
  const n = async (sql: string) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );
  const viewers = (k: number) => Array.from({ length: k }, (_, i) => `98${i}`);
  const msg = (v: string, text: string): LabChatMessage => ({
    channel_id: CH,
    message_id: randomUUID(),
    text,
    chatter: { id: v, login: `v${v}`, display_name: `V${v}`, role: 'viewer' },
    source: 'twitch',
  });
  /** Each viewer: two manual tours (months 4 and 5, off live), then the live, invitations ON. */
  const ready = async (vs: string[]) => {
    const w = wheel(a);
    await w.setEnabled(CH, true);
    await w.setMode(CH, 'v2', 'test');
    for (const v of vs)
      for (const months of [4, 5])
        await w.acquire({
          channelId: CH,
          source: 'message',
          sourceEventId: randomUUID(),
          occurredAt: new Date(
            T0.getTime() - months * 86_400_000,
          ).toISOString(),
          viewer: { id: v, login: `v${v}`, name: `V${v}` },
          type: 'resub',
          tier: 1,
          months,
          isGift: false,
        });
    const c = await setup({ db: a, clock });
    await c.streams.online({ streamId: 's1', startedAt: T0 });
    await w.setInvitations(CH, true, 'test');
    // RV2-1: an invitation needs LeCroupier_ to be able to say it (« Sortie chat » ON).
    await a.query(
      `insert into cmd_channels (channel_id, chat_output) values ($1, true)
       on conflict (channel_id) do update set chat_output = true`,
      [CH],
    );
  };
  /** The chat executor delivered every invitation message (RV2-1: answerable only once delivered). */
  const delivered = () =>
    a.query(
      "update cmd_steps set status = 'succeeded', finished_at = updated_at where origin = 'sub_wheel' and status = 'queued'",
    );

  for (const round of [1, 2, 3]) {
    it(`two messages of one viewer at once on two Cores: ONE invitation, ONE message — 20 viewers (round ${round})`, async () => {
      const vs = viewers(20);
      await ready(vs);
      const [ca, cb] = [chat(a), chat(b)];
      await Promise.all(
        vs.flatMap((v) => [ca.chat(msg(v, 'salut')), cb.chat(msg(v, 'yo'))]),
      );
      expect(await n('sw_invitations')).toBe(20);
      expect(await n("cmd_steps where origin = 'sub_wheel'")).toBe(20);
    });

    it(`the chat answer and « !roue oui » at once on two Cores: each tour requested once, no credit (round ${round})`, async () => {
      const vs = viewers(20);
      await ready(vs);
      for (const v of vs) await chat(a).chat(msg(v, 'salut'));
      await delivered();
      const [ca, cb] = [chat(a), chat(b)];
      await Promise.all(
        vs.flatMap((v) => [
          ca.chat(msg(v, 'oui')),
          cb.chat(msg(v, '!roue oui')),
        ]),
      );
      expect(await n("sw_spins where status = 'requested'")).toBe(40);
      expect(await n("sw_invitations where status = 'accepted'")).toBe(20);
      expect(await n("wallet_transactions where source = 'sub_wheel'")).toBe(0);
    });
  }

  it('counter-proof — without the viewer lock and the unique invitation, two messages make two invitations', async () => {
    const vs = viewers(10);
    await ready(vs);
    await a.query(
      'alter table sw_invitations drop constraint sw_invitations_channel_id_session_key_viewer_id_key',
    );
    const pause = barrier(2);
    const o = {
      noViewerLock: true,
      delayOn: [/insert into sw_invitations/, 50] as [RegExp, number],
      pause,
    };
    const [ca, cb] = [
      new SubWheelChat(tampered(a, o), clock, wheel(a)),
      new SubWheelChat(tampered(b, o), clock, wheel(b)),
    ];
    await Promise.all(
      vs.flatMap((v) => [ca.chat(msg(v, 'salut')), cb.chat(msg(v, 'yo'))]),
    );
    expect(await n('sw_invitations')).toBeGreaterThan(10);
  });
});
