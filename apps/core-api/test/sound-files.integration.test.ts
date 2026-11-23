// Soundboard: sounds added in Studio (docs/SOUNDBOARD.md § Ajouter un son) on a real Postgres, two Cores on two pools
// (PGlite serializes every transaction): one live sound per extract, one sound per id, one purchase per key — decided
// by the database, whatever the interleaving. Every race runs 3 times.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration (the database is wiped).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { SoundLabService } from '../src/sound-lab/sound-lab-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const ROUNDS = [1, 2, 3];

function wav(ms: number, seed: number) {
  const data = Buffer.alloc(Math.round(44.1 * ms) * 2);
  for (let i = 0; i < data.length / 2; i++)
    data.writeInt16LE(((i * 29 + seed * 113) % 1600) - 800, i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFFxxxxWAVEfmt ', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(44100, 24);
  h.writeUInt32LE(88200, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]).toString('base64');
}
const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 'ok' : (r.reason as { code?: string }).code;

describe.skipIf(!isLocal)(
  'Soundboard sounds added in Studio — real Postgres',
  () => {
    let unlock: (() => Promise<void>) | undefined;
    let a: Db, b: Db;
    let sa: SoundLabService, sb: SoundLabService;
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      b = createPgDb(url!);
    }, LOCK_WAIT_MS);
    beforeEach(async () => {
      await a.query('drop schema public cascade; create schema public;');
      await migrate(a, 'all');
      const clock = new FakeClock(new Date());
      sa = new SoundLabService(a, clock);
      sb = new SoundLabService(b, clock);
    });
    afterAll(async () => {
      await a?.close();
      await b?.close();
      await unlock?.();
    });

    it.each(ROUNDS)(
      'two Cores publish the same extract as two sounds at once: one wins (round %i)',
      async (round) => {
        const file = await sa.uploadFile(wav(600, round));
        const req = (id: string) => ({
          id,
          label: id,
          file_id: file.file_id,
          token_cost: 500,
          credit_cost: 1,
        });
        const results = await Promise.allSettled([
          sa.createSound(req('a-aaaaaa')),
          sb.createSound(req('b-bbbbbb')),
        ]);
        expect(results.map(outcome).sort()).toEqual(['duplicate_file', 'ok']);
        const live = await a.query(
          'select sound_id from sound_lab_sounds where file_id = $1 and deleted_at is null',
          [file.file_id],
        );
        expect(live).toHaveLength(1);
      },
    );

    it.each(ROUNDS)(
      'the same publication sent twice at once (double click, retry): one sound (round %i)',
      async (round) => {
        const file = await sa.uploadFile(wav(700, round));
        const req = {
          id: 'clic-cccccc',
          label: 'Clic',
          file_id: file.file_id,
          token_cost: 500,
          credit_cost: 1,
        };
        const results = await Promise.allSettled([
          sa.createSound(req),
          sb.createSound(req),
          sa.uploadFile(wav(700, round)),
        ]);
        expect(results.map(outcome)).toEqual(['ok', 'ok', 'ok']);
        expect(
          await a.query(
            "select 1 from sound_lab_sounds where sound_id = 'clic-cccccc'",
          ),
        ).toHaveLength(1);
        expect(
          await a.query('select 1 from sound_files where file_id = $1', [
            file.file_id,
          ]),
        ).toHaveLength(1);
      },
    );

    it.each(ROUNDS)(
      'an added sound bought twice with the same key on two Cores: one purchase, one debit (round %i)',
      async (round) => {
        const file = await sa.uploadFile(wav(500, round));
        await sa.createSound({
          id: 'achat-dddddd',
          label: 'Achat',
          file_id: file.file_id,
          token_cost: 300,
          credit_cost: 1,
        });
        await sa.heartbeat({
          studio_instance_id: 'studio-A',
          player_ready: true,
        });
        const buy = (s: SoundLabService) =>
          s.admit({
            idempotency_key: `k-${round}`,
            channel_id: '900100',
            viewer: { id: '900101', display_name: 'Viewer Lab' },
            lab_session_id: 'lab-1',
            sound_id: 'achat-dddddd',
            payment_method: 'tokens',
          });
        const [x, y] = await Promise.all([buy(sa), buy(sb)]);
        expect(x.interaction.interaction_id).toBe(y.interaction.interaction_id);
        expect([x.replayed, y.replayed].sort()).toEqual([false, true]);
        expect(x.interaction.sound_url).toBe(`sound-files/${file.file_id}.wav`);
        expect(
          await a.query(
            "select 1 from sound_lab_interactions where requested_sound_id = 'achat-dddddd'",
          ),
        ).toHaveLength(1);
        const debits = await a.query<{ amount: number }>(
          "select amount from lab_wallet_ledger where viewer_id = '900101' and kind = 'debit' and module_id = 'soundboard'",
        );
        expect(debits.map((d) => Number(d.amount))).toEqual([-300]);
      },
    );
  },
);
