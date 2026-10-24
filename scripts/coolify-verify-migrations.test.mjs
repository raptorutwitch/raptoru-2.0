// The pre-applied migrations verifier, run exactly as Coolify runs it (sh -c '<command>' in the Core's folder),
// against a real PostgreSQL 17 (Production's image) in Docker:
//   node --test scripts/coolify-verify-migrations.test.mjs
// RAPTORU_CORE_ROOT: a built checkout of the target commit (apps/core-api/dist, node_modules, supabase/migrations).

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifierCommand } from './coolify-verify-migrations.mjs';

const ROOT = process.env.RAPTORU_CORE_ROOT ?? 'C:/Users/Antoni/Documents/rs-vk';
const pg = createRequire(join(ROOT, 'apps/core-api/package.json'))('pg');
const CAUTION = '20261105130000_caution.sql';
const VOTEKICK = '20261106130000_votekick.sql';
// Spotify V2 (24/10): a file made only of ALTER TABLE (cmd_steps origin widened to « music »).
const MUSIC = '20261108140000_cmd_steps_music_lab.sql';
const NAME = `raptoru-verify-test-${process.pid}`;
const PORT = 55_000 + (process.pid % 1000);
const base = `postgres://raptoru:test@127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'verify-mig-'));
const allDir = join(ROOT, 'supabase/migrations');
// The database as Production had it before the GO: every migration except the two.
const beforeDir = join(tmp, 'before');
cpSync(allDir, beforeDir, { recursive: true });
rmSync(join(beforeDir, CAUTION));
rmSync(join(beforeDir, VOTEKICK));
// The database as Production had it before the Spotify GO's second file: everything but the music origin.
const hasMusic = readdirSync(allDir).includes(MUSIC);
const beforeMusicDir = join(tmp, 'before-music');
cpSync(allDir, beforeMusicDir, { recursive: true });
rmSync(join(beforeMusicDir, MUSIC), { force: true });

const sql = (f) => readFileSync(join(allDir, f), 'utf8');
let n = 0;

async function database(dir = beforeDir) {
  const name = `s${++n}`;
  const admin = new pg.Client(`${base}/postgres`);
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = `${base}/${name}`;
  const env = { ...process.env, DATABASE_URL: url };
  execFileSync('node', ['apps/core-api/dist/scripts/migrate.js'], {
    cwd: ROOT,
    env: { ...env, MIGRATIONS_DIR: dir },
  });
  const c = new pg.Client(url);
  await c.connect();
  return {
    url,
    exec: (q) => c.query(q),
    rows: async (q) => (await c.query(q)).rows,
    close: () => c.end(),
    verify(expected) {
      const r = spawnSync('sh', ['-c', verifierCommand(expected, 'prod')], {
        cwd: ROOT,
        env: { ...env, MIGRATIONS_DIR: allDir },
        encoding: 'utf8',
      });
      const line = r.stdout.split('\n').find((l) => l.startsWith('RAPTORU-MIGRATIONS '));
      assert.ok(line, `no result line:\n${r.stdout}\n${r.stderr}`);
      return { code: r.status, ...JSON.parse(line.slice(19)) };
    },
  };
}
const recorded = async (db) =>
  (await db.rows('select name from schema_migrations')).map((r) => r.name);
const tables = async (db) =>
  (
    await db.rows(
      // The two files' tables (votekick_settings, 24/10, comes from a later file already in the « before » database).
      "select table_name from information_schema.tables where table_schema = 'public' and (table_name like 'votekick%' or table_name like 'caution%') and table_name <> 'votekick_settings' order by 1",
    )
  ).map((r) => r.table_name);

before(async () => {
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', NAME, '-e', 'POSTGRES_USER=raptoru', '-e', 'POSTGRES_PASSWORD=test',
    '-p', `${PORT}:5432`, 'postgres:17-alpine',
  ]);
  for (let i = 0; ; i++) {
    const c = new pg.Client(`${base}/postgres`);
    try {
      await c.connect();
      await c.end();
      break;
    } catch (e) {
      if (i > 60) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
});
after(() => {
  spawnSync('docker', ['rm', '-f', NAME]);
  rmSync(tmp, { recursive: true, force: true });
});

describe('pre-applied migrations, verified on a real PostgreSQL 17', () => {
  it('absent: refused, nothing written (no table, nothing recorded)', async () => {
    const db = await database();
    const before = await recorded(db);
    const r = db.verify([CAUTION, VOTEKICK]);
    assert.equal(r.code, 1);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /caution_requests absent/);
    assert.match(r.problems.join(), /votekick_votes absent/);
    assert.deepEqual(r.applied, []);
    assert.deepEqual(await recorded(db), before);
    assert.deepEqual(await tables(db), []);
    await db.close();
  });

  it('partial: an index missing, a column of another type → refused, nothing written', async () => {
    const db = await database();
    await db.exec(sql(CAUTION));
    await db.exec(sql(VOTEKICK));
    await db.exec('drop index votekick_one_mute');
    await db.exec('alter table caution_requests alter column channel_id type varchar(40)');
    const before = await recorded(db);
    const r = db.verify([CAUTION, VOTEKICK]);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /votekick_one_mute absent/);
    assert.match(r.problems.join(), /caution_requests différent/);
    assert.deepEqual(await recorded(db), before);
    assert.deepEqual(
      (await db.rows("select 1 from pg_namespace where nspname = 'raptoru_verify'")).length,
      0,
    );
    await db.close();
  });

  it('partial: only one of the two files applied → refused for the other one', async () => {
    const db = await database();
    await db.exec(sql(CAUTION));
    const r = db.verify([CAUTION, VOTEKICK]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.conforming, [CAUTION]);
    assert.match(r.problems.join(), /votekick/);
    assert.ok(!(await recorded(db)).includes(CAUTION));
    await db.close();
  });

  it('pre-applied by hand (as on 23/10): conforming, then recorded by the migrator with their checksum', async () => {
    const db = await database();
    await db.exec(`begin; ${sql(CAUTION)} ${sql(VOTEKICK)} commit;`);
    const r = db.verify([CAUTION, VOTEKICK]);
    assert.equal(r.code, 0);
    assert.equal(r.ok, true, r.problems.join());
    assert.deepEqual(r.conforming, [CAUTION, VOTEKICK]);
    assert.deepEqual(r.applied, [CAUTION, VOTEKICK]);
    const rows = await db.rows(
      `select name, checksum from schema_migrations where name in ('${CAUTION}', '${VOTEKICK}')`,
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => /^[0-9a-f]{64}$/.test(x.checksum)));
    // Run again (a redeploy): already recorded, nothing applied.
    const again = db.verify([CAUTION, VOTEKICK]);
    assert.equal(again.ok, true);
    assert.deepEqual(again.recorded, [CAUTION, VOTEKICK]);
    assert.deepEqual(again.applied, []);
    await db.close();
  });

  it('already applied by the migrator: ok, nothing applied', async () => {
    const db = await database();
    execFileSync('node', ['apps/core-api/dist/scripts/migrate.js'], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: db.url, MIGRATIONS_DIR: allDir },
    });
    const r = db.verify([CAUTION, VOTEKICK]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.recorded, [CAUTION, VOTEKICK]);
    assert.deepEqual(r.applied, []);
    await db.close();
  });

  it('recorded with another checksum: refused', async () => {
    const db = await database();
    await db.exec(`begin; ${sql(CAUTION)} ${sql(VOTEKICK)} commit;`);
    await db.exec(
      `insert into schema_migrations (name, checksum) values ('${CAUTION}', 'x'), ('${VOTEKICK}', 'y')`,
    );
    const r = db.verify([CAUTION, VOTEKICK]);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /autre empreinte/);
    await db.close();
  });

  it('a pending file not authorised: refused before any write (no unauthorised migration)', async () => {
    const db = await database();
    await db.exec(sql(CAUTION));
    const r = db.verify([CAUTION]);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), new RegExp(`${VOTEKICK} non enregistrée et non autorisée`));
    assert.deepEqual(r.applied, []);
    assert.ok(!(await recorded(db)).includes(CAUTION));
    assert.deepEqual(await tables(db), ['caution_requests']);
    await db.close();
  });

  it('an ALTER-only file (cmd_steps origin « music »): refused while missing, conforming once applied by hand', { skip: !hasMusic }, async () => {
    const db = await database(beforeMusicDir);
    const missing = db.verify([MUSIC]);
    assert.equal(missing.ok, false);
    assert.match(missing.problems.join(), /modifierait public\.cmd_steps/);
    assert.ok(!(await recorded(db)).includes(MUSIC));
    await db.exec(sql(MUSIC));
    const r = db.verify([MUSIC]);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.deepEqual(r.conforming, [MUSIC]);
    assert.deepEqual(r.applied, [MUSIC]);
    assert.ok((await recorded(db)).includes(MUSIC));
    await db.close();
  });

  it('the command is one line without single quote (Coolify: sh -c, newlines flattened)', () => {
    const c = verifierCommand([CAUTION, VOTEKICK], 'prod');
    assert.ok(!c.includes('\n'));
    assert.equal(c.split("'").length, 3);
    assert.ok(readdirSync(allDir).includes(VOTEKICK));
  });
});
