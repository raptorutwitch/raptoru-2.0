import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import {
  LAB_MIGRATIONS,
  LEGACY_LAB_IN_PROD,
  MAIN_CORE_LAB_MIGRATIONS,
  STAGING_EXTRA_LAB_MIGRATIONS,
  MIGRATION_SCOPES,
  MigrationScopeError,
  PROD_MIGRATIONS,
  selectMigrations,
  type MigrationScopes,
} from '../src/db/migration-scopes.js';
import { createPgliteDb } from './helpers.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const sqlFiles = async () =>
  (await readdir(DEFAULT_MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

/** The 17 migrations that existed when the boundary was introduced (LF-normalized SHA-256). */
const EXISTING: Record<string, string> = {
  '20260924120000_daily.sql':
    'dce37b3af21640c3b76f9c14063641436ecb11d625a977468fdd2635d4a3622f',
  '20260925120000_presence.sql':
    '08d9894f613342ea79268b309ac77111179856cb239267d3312cd60b9a31521e',
  '20260926120000_wallet.sql':
    '6f3d2dad3001819908a087be8da580c746cab8b520a78605f944645d1a1e412d',
  '20260927120000_loyalty_engine.sql':
    'f57ec227be569e42b0142aa7d94ca1fed5eb8861828d61d2205acb7405220704',
  '20260928120000_daily_wallet.sql':
    '5bdc6e43327e7f51e259a7dd63223fcb9935bd1e36fafacb0686ded3c86bdf6d',
  '20260929120000_bonk_lab.sql':
    'ba2a34a7a7638f77eda4d8239d128fc4007534a70e3a66f04e918edf9fbf16ce',
  '20260930120000_bonk_lab_twitch.sql':
    '00b2fb873ec1f4d9f797c47c0c81237104167d09866c8817cef62f32eecf953b',
  '20261001120000_bonk_lab_third_party.sql':
    'e1631ae950751cf8b97ef899e18b3baae302bf2b762e52cae777277d4dbb2111',
  '20261002120000_sound_lab.sql':
    '63545677053d9eacdba7155939b3710d057a4610959e91593eb370ce280277be',
  '20261003120000_sound_lab_custom_label.sql':
    'eb94a3cd3206d3f57e3e24dad5f5cc977b935feb9cef01c327a05049c46f9970',
  '20261004120000_tts_lab.sql':
    '7e90acfba053dc7878e3f8d2ffa182bf915460b5298267db94406e78842e6002',
  '20261005120000_lab_moderation.sql':
    '3f4c125cb03beab19d0f2e52e7912751efca9aadaa43ebf400e71596f5a3ff58',
  '20261006120000_tts_lab_cooldown_clear.sql':
    '1de09f17fcc136ff1a7a57e86dafc3ff3b8637ac91cce2e1576f1a773379c9f1',
  '20261007120000_moderation_d4.sql':
    '20ac9d7869e11edf5fec16bfd1c2648bfd5803dd24d5c2e3f0f1c273bd440283',
  '20261008120000_raffle_v2.sql':
    'b469c4f63360bd2c9ff192c0bc96d62f5342c7e43a7c080193553a65867191a4',
  '20261009120000_raffle_scheduler.sql':
    '4b7b06e47acfdeccfc0086535f1ac4d928f5017b6a282b495ceac77c906d97c6',
  '20261010120000_raffle_round_labels.sql':
    '8156374e54534eef50062b50972d4ba797123ccf3f35fe27840431da98714c15',
};
const LAST_EXISTING = '20261010120000_raffle_round_labels.sql';

/** *.sql names written in a launcher script. */
async function namesIn(file: string) {
  const text = await readFile(join(REPO, file), 'utf8');
  return [
    ...text.matchAll(/'(?:supabase\/migrations\/)?(\d{14}_[a-z0-9_]+\.sql)'/g),
  ].map((m) => m[1]!);
}

describe('Lab / prod migration boundary', () => {
  it('every migration of the folder is classified, in exactly one scope', async () => {
    for (const f of await sqlFiles()) {
      const inProd = PROD_MIGRATIONS.includes(f);
      const inLab = LAB_MIGRATIONS.includes(f);
      expect(inProd !== inLab, f).toBe(true);
    }
    expect(() => selectMigrations(Object.keys(EXISTING), 'all')).not.toThrow();
  });

  it('prod path: the existing migrations are selected exactly as before (all 17, name order)', async () => {
    const existing = (await sqlFiles()).filter((f) => f <= LAST_EXISTING);
    expect(existing).toEqual(Object.keys(EXISTING).sort());
    expect(selectMigrations(existing, 'prod')).toEqual(existing);
  });

  it('prod path: a post-boundary Lab migration only when the main Core list names it (lot 8)', async () => {
    const files = await sqlFiles();
    const prod = selectMigrations(files, 'prod');
    for (const f of LAB_MIGRATIONS.filter(
      (x) => !LEGACY_LAB_IN_PROD.includes(x),
    ))
      expect(prod.includes(f), f).toBe(MAIN_CORE_LAB_MIGRATIONS.includes(f));
    // Never the Lab's own alerts / channel points / Random Ban / Roue du Sub schema (production has its own).
    for (const f of [
      '20261022120000_alerts_lab.sql',
      '20261025120000_channel_points_lab.sql',
      '20261026120000_random_ban_lab.sql',
      '20261027120000_sub_wheel_lab.sql',
      '20261105120000_caution_lab.sql',
      '20261106120000_votekick_lab.sql',
      '20261107120000_votekick_settings_lab.sql',
    ])
      expect(prod).not.toContain(f);
    // Rule check with a future Lab migration (the boundary does not depend on today's list).
    const future: MigrationScopes = {
      ...MIGRATION_SCOPES,
      lab: [...LAB_MIGRATIONS, '20991231000000_future_lab.sql'],
    };
    const withFuture = [...files, '20991231000000_future_lab.sql'];
    expect(selectMigrations(withFuture, 'prod', future)).not.toContain(
      '20991231000000_future_lab.sql',
    );
    expect(selectMigrations(withFuture, 'lab', future)).toContain(
      '20991231000000_future_lab.sql',
    );
  });

  it('the frozen legacy list is exactly the Lab migrations that existed before the boundary', () => {
    expect([...LEGACY_LAB_IN_PROD]).toEqual(
      LAB_MIGRATIONS.filter((f) => f <= LAST_EXISTING),
    );
  });

  it('Lab path: exactly the Lab migrations, in order (never Daily / Presence / Wallet / Loyalty)', async () => {
    const lab = selectMigrations(await sqlFiles(), 'lab');
    expect(lab).toEqual([...LAB_MIGRATIONS].sort());
    for (const f of PROD_MIGRATIONS) expect(lab).not.toContain(f);
  });

  it('the Lab launchers apply exactly LAB_MIGRATIONS, in order', async () => {
    expect(
      await namesIn('apps/studio/server/src/runtime/local-runtime.ts'),
    ).toEqual([...LAB_MIGRATIONS]);
    expect(await namesIn('apps/studio/server/scripts/bonk-lab.mjs')).toEqual([
      ...LAB_MIGRATIONS,
    ]);
    // The package copies the whole folder; its presence check only lists Lab files.
    for (const f of await namesIn('apps/studio/desktop/scripts/stage.mjs'))
      expect(LAB_MIGRATIONS).toContain(f);
  });

  it('an unclassified migration stops every path before anything is applied (fail closed)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-scope-'));
    await copyFile(
      join(DEFAULT_MIGRATIONS_DIR, PROD_MIGRATIONS[0]!),
      join(dir, PROD_MIGRATIONS[0]!),
    );
    await writeFile(
      join(dir, '20991231000000_mystery.sql'),
      'create table mystery (id int);',
    );
    for (const scope of ['prod', 'lab', 'all'] as const)
      expect(() =>
        selectMigrations(['20991231000000_mystery.sql'], scope),
      ).toThrow(MigrationScopeError);
    const db = createPgliteDb(new PGlite());
    await expect(migrate(db, 'prod', dir)).rejects.toThrow(
      /unclassified migration 20991231000000_mystery\.sql/,
    );
    // Nothing applied, not even the schema_migrations table.
    expect(
      await db.query(
        "select 1 from pg_tables where tablename in ('schema_migrations', 'mystery', 'daily_claims')",
      ),
    ).toEqual([]);
  });

  it('prod migrator on a real database: Lab migration of the future skipped, prod ones applied', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-scope-db-'));
    for (const f of PROD_MIGRATIONS)
      await copyFile(join(DEFAULT_MIGRATIONS_DIR, f), join(dir, f));
    await writeFile(
      join(dir, '20991231000000_future_lab.sql'),
      'create table future_lab_only (id int);',
    );
    const scopes: MigrationScopes = {
      ...MIGRATION_SCOPES,
      lab: [...LAB_MIGRATIONS, '20991231000000_future_lab.sql'],
    };
    const db = createPgliteDb(new PGlite());
    expect(await migrate(db, 'prod', dir, scopes)).toEqual([
      ...PROD_MIGRATIONS,
    ]);
    expect(
      await db.query(
        "select 1 from pg_tables where tablename = 'future_lab_only'",
      ),
    ).toEqual([]);
    expect(await migrate(db, 'lab', dir, scopes)).toEqual([
      '20991231000000_future_lab.sql',
    ]);
    expect(
      (
        await db.query(
          "select 1 from pg_tables where tablename = 'future_lab_only'",
        )
      ).length,
    ).toBe(1);
  });

  it('an already applied migration is never re-run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-scope-twice-'));
    for (const f of PROD_MIGRATIONS)
      await copyFile(join(DEFAULT_MIGRATIONS_DIR, f), join(dir, f));
    const db = createPgliteDb(new PGlite());
    expect(await migrate(db, 'prod', dir)).toEqual([...PROD_MIGRATIONS]);
    expect(await migrate(db, 'prod', dir)).toEqual([]);
  });

  it('no existing migration was rewritten (content pinned, LF-normalized)', async () => {
    for (const [file, hash] of Object.entries(EXISTING)) {
      const text = (
        await readFile(join(DEFAULT_MIGRATIONS_DIR, file), 'utf8')
      ).replace(/\r\n/g, '\n');
      expect(createHash('sha256').update(text).digest('hex'), file).toBe(hash);
    }
  });
});

describe('main Core scope (lot 8): blank, existing and upgraded databases', () => {
  const OLD_PROD: MigrationScopes = { ...MIGRATION_SCOPES, mainCore: [] };
  it('prod = the production files + the explicit main Core Lab list; staging adds nothing more', async () => {
    const files = await readdir(DEFAULT_MIGRATIONS_DIR);
    const prod = selectMigrations(files, 'prod');
    const old = selectMigrations(files, 'prod', OLD_PROD);
    expect(old.length).toBe(29);
    expect(prod.filter((f) => !old.includes(f))).toEqual([
      ...MAIN_CORE_LAB_MIGRATIONS,
    ]);
    expect(selectMigrations(files, 'staging')).toEqual(prod);
    // Name order kept: the main Core files interleave with the production ones by date.
    expect(prod).toEqual([...prod].sort());
  });

  it('a blank database: everything once; again: nothing', async () => {
    const db = createPgliteDb(new PGlite());
    expect((await migrate(db, 'prod')).length).toBe(44);
    expect(await migrate(db, 'prod')).toEqual([]);
    for (const t of ['cmd_steps', 'word_game_words', 'mini_game_duels'])
      expect(
        (await db.query('select 1 from pg_tables where tablename = $1', [t]))
          .length,
        t,
      ).toBe(1);
  });

  const CAUTION = '20261105130000_caution.sql';
  const VOTEKICK = '20261106130000_votekick.sql';
  const SETTINGS = '20261107130000_votekick_settings.sql';
  // Before Caution and Votekick: their files not in the production selection (classified Lab here, so the folder
  // stays valid).
  const withoutCaution = PROD_MIGRATIONS.filter(
    (f) => f !== CAUTION && f !== VOTEKICK && f !== SETTINGS,
  );
  const labWithCaution = [...LAB_MIGRATIONS, CAUTION, VOTEKICK, SETTINGS];
  it('the production database of 22/10 (39 files): the winner announcements, the chat source, then Caution, once', async () => {
    const db = createPgliteDb(new PGlite());
    const NEW = '20261031140000_cmd_steps_win_announcements_lab.sql';
    const CHAT = '20261104120000_cp_redemptions_chat_source_lab.sql';
    const before = {
      ...MIGRATION_SCOPES,
      prod: withoutCaution,
      lab: labWithCaution,
      mainCore: MAIN_CORE_LAB_MIGRATIONS.filter((f) => f !== NEW && f !== CHAT),
    };
    expect((await migrate(db, 'prod', undefined, before)).length).toBe(39);
    expect(await migrate(db, 'prod')).toEqual([
      NEW,
      CHAT,
      CAUTION,
      VOTEKICK,
      SETTINGS,
    ]);
    expect(await migrate(db, 'prod')).toEqual([]);
  });

  it('the production database of 23/10 (41 files, FX Cam applied): Caution and Votekick only, once', async () => {
    const db = createPgliteDb(new PGlite());
    const before = {
      ...MIGRATION_SCOPES,
      prod: withoutCaution,
      lab: labWithCaution,
    };
    expect((await migrate(db, 'prod', undefined, before)).length).toBe(41);
    expect(await migrate(db, 'prod')).toEqual([CAUTION, VOTEKICK, SETTINGS]);
    expect(await migrate(db, 'prod')).toEqual([]);
  });

  it('the production database of 24/10 (Caution and Votekick applied, 43 files): votekick_settings only, once', async () => {
    const db = createPgliteDb(new PGlite());
    const before = {
      ...MIGRATION_SCOPES,
      prod: PROD_MIGRATIONS.filter((f) => f !== SETTINGS),
      lab: [...LAB_MIGRATIONS, SETTINGS],
    };
    expect((await migrate(db, 'prod', undefined, before)).length).toBe(43);
    expect(await migrate(db, 'prod')).toEqual([SETTINGS]);
    expect(await migrate(db, 'prod')).toEqual([]);
  });

  it('a database migrated by the previous production selection: only the main Core files, once', async () => {
    const db = createPgliteDb(new PGlite());
    expect((await migrate(db, 'prod', undefined, OLD_PROD)).length).toBe(29);
    expect(await migrate(db, 'prod')).toEqual([...MAIN_CORE_LAB_MIGRATIONS]);
    expect(await migrate(db, 'prod')).toEqual([]);
  });

  it('a staging database (the four extras already there): the others only, never the four again', async () => {
    const db = createPgliteDb(new PGlite());
    const OLD_STAGING: MigrationScopes = {
      ...OLD_PROD,
      stagingExtra: STAGING_EXTRA_LAB_MIGRATIONS,
    };
    expect((await migrate(db, 'staging', undefined, OLD_STAGING)).length).toBe(
      33,
    );
    expect(await migrate(db, 'prod')).toEqual(
      MAIN_CORE_LAB_MIGRATIONS.filter(
        (f) => !STAGING_EXTRA_LAB_MIGRATIONS.includes(f),
      ),
    );
  });
});
