// `!tts` from the chat on a real Postgres with real pools: two Core instances receive the same Twitch message (bot
// retry, two deliveries) while the extension buys a TTS for the same viewer — one TTS, one debit, one chat answer.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LabChatMessage } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { TtsChat } from '../src/tts-lab/chat.js';
import { TtsLabService } from '../src/tts-lab/tts-lab-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '900100';

describe.skipIf(!isLocal)('!tts from the chat on a real Postgres', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await unlock?.();
  });

  it('the same message twice on two Cores + the extension at the same time: one TTS, one debit, one answer', async () => {
    const clock = new FakeClock(new Date('2026-10-22T20:00:00Z'));
    const ttsA = new TtsLabService(a, clock);
    const ttsB = new TtsLabService(b, clock);
    await ttsA.heartbeat({
      studio_instance_id: 'studio-A',
      player_ready: true,
    });
    await editWallet(
      a,
      clock.now(),
      CH,
      '900201',
      'set',
      { tokens: 50_000 },
      'test',
    );
    const msg: LabChatMessage = {
      channel_id: CH,
      message_id: 'tw-race-1',
      text: '!tts coucou les amis',
      chatter: {
        id: '900201',
        login: 'alice',
        display_name: 'Alice',
        role: 'viewer',
      },
      source: 'twitch',
    };
    const chatA = new TtsChat(a, clock, ttsA);
    const chatB = new TtsChat(b, clock, ttsB);
    const results = await Promise.allSettled([
      chatA.chat(msg),
      chatB.chat(msg),
      chatA.chat(msg),
      ttsB.admit({
        idempotency_key: 'ext-race-1',
        channel_id: CH,
        viewer: { id: '900201', display_name: 'Alice' },
        lab_session_id: 'ext-staging',
        text: 'depuis l’extension',
        payment_method: 'tokens',
      }),
    ]);
    // Never an unexpected failure: the extension's purchase is either admitted or refused « viewer_busy ».
    for (const r of results.slice(0, 3)) expect(r.status).toBe('fulfilled');
    const ext = results[3]!;
    if (ext.status === 'rejected')
      expect((ext.reason as { code: string }).code).toBe('viewer_busy');
    const interactions = await a.query<{ n: string }>(
      'select count(*) as n from tts_lab_interactions',
    );
    expect(Number(interactions[0]!.n)).toBe(1);
    const tokens = await a.query<{ tokens: number }>(
      'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
      [CH, '900201'],
    );
    expect(Number(tokens[0]!.tokens)).toBe(50_000 - 7500);
    const debits = await a.query<{ n: string }>(
      `select count(*) as n from lab_wallet_ledger where kind = 'debit'`,
    );
    expect(Number(debits[0]!.n)).toBe(1);
    // At most one chat answer for the message: none when the chat one won (it plays next: the voice is the answer),
    // « busy » when the extension won the race.
    const answers = await a.query<{ n: string }>(
      `select count(*) as n from cmd_steps where idempotency_key = 'tts:msg:tw-race-1'`,
    );
    expect(Number(answers[0]!.n)).toBeLessThanOrEqual(1);
  });
});
