// Migrations applied BEFORE the Core is deployed (by hand, in one transaction): checked on the real database by the
// new Core's container (Coolify post-deployment command), then recorded by the Core's own migrator. Used by
// coolify-deploy.mjs --migrations-preapplied.
//
// verifyMigrations() is shipped as source inside the command (verifierCommand): it must stay self-contained (no
// outer reference), without single quotes and without // comments (Coolify runs the command through sh -c '…'
// and flattens its newlines).
//
// Per expected file:
// - already recorded in schema_migrations → its checksum must be the file's;
// - not recorded → conformity on the real database, inside a transaction always rolled back: the file is replayed
//   into a scratch schema (search_path raptoru_verify, public), each object it creates must exist in public with the
//   same definition (columns, types, defaults, NOT NULL, constraints, indexes), and the replay must change nothing in
//   public. Then only the Core's migrator runs; it must apply exactly those files, recorded with their checksum.
// A file of the migrator's scope that is neither recorded nor expected stops everything before any write.

export async function verifyMigrations({
  db,
  files,
  sqlOf,
  checksum,
  expected,
  migrate,
}) {
  const res = {
    ok: false,
    recorded: [],
    conforming: [],
    applied: [],
    problems: [],
  };
  const recordedSums = async () =>
    new Map(
      (await db.query("select name, checksum from schema_migrations")).map(
        (r) => [r.name, r.checksum],
      ),
    );
  const describe = async (q, schema) => {
    const rows = await q.query(
      `select c.relname as name, c.relkind as kind,
        coalesce((select string_agg(a.attname || $$ $$ || format_type(a.atttypid, a.atttypmod)
            || case when a.attnotnull then $$ not null$$ else $$$$ end
            || coalesce($$ default $$ || pg_get_expr(d.adbin, d.adrelid), $$$$), $$, $$ order by a.attnum)
          from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), $$$$)
        || $$ | $$ || coalesce((select string_agg(pg_get_constraintdef(k.oid), $$ ; $$ order by pg_get_constraintdef(k.oid))
          from pg_constraint k where k.conrelid = c.oid), $$$$)
        || $$ | $$ || coalesce(case when c.relkind = $$i$$ then pg_get_indexdef(c.oid) end, $$$$) as def
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ($$r$$, $$p$$, $$i$$, $$S$$, $$v$$, $$m$$)`,
      [schema],
    );
    return new Map(
      rows.map((r) => [
        r.name,
        `${r.kind} ${r.def.split(`${schema}.`).join("")}`,
      ]),
    );
  };
  const conformity = async (sql) => {
    const rollback = {};
    try {
      await db.tx(async (q) => {
        await q.query("set local lock_timeout = 5000");
        await q.query("set local statement_timeout = 60000");
        const before = await describe(q, "public");
        await q.query("create schema raptoru_verify");
        await q.query("set local search_path to raptoru_verify, public");
        await q.query(sql);
        const fresh = await describe(q, "raptoru_verify");
        const after = await describe(q, "public");
        const diff = [];
        if (!fresh.size) diff.push("ne crée aucun objet vérifiable");
        for (const [name, def] of fresh) {
          const real = before.get(name);
          if (!real) diff.push(`${name} absent`);
          else if (real !== def) diff.push(`${name} différent`);
        }
        for (const [name, def] of after)
          if (before.get(name) !== def)
            diff.push(`le rejeu modifierait public.${name}`);
        for (const name of before.keys())
          if (!after.has(name)) diff.push(`le rejeu supprimerait public.${name}`);
        rollback.diff = diff;
        throw rollback;
      });
    } catch (e) {
      if (e !== rollback) throw e;
    }
    return rollback.diff;
  };

  const sums = await recordedSums();
  for (const f of files)
    if (!sums.has(f) && !expected.includes(f))
      res.problems.push(`${f} non enregistrée et non autorisée`);
  for (const f of expected) {
    if (!files.includes(f)) {
      res.problems.push(`${f} hors du périmètre du migrateur`);
      continue;
    }
    const sql = await sqlOf(f);
    if (sums.has(f)) {
      if (sums.get(f) === checksum(sql)) res.recorded.push(f);
      else res.problems.push(`${f} enregistrée avec une autre empreinte`);
      continue;
    }
    const diff = await conformity(sql);
    if (diff.length) res.problems.push(`${f} : ${diff.join(", ")}`);
    else res.conforming.push(f);
  }
  if (res.problems.length) return res;
  if (res.conforming.length) {
    res.applied = await migrate();
    if ([...res.applied].sort().join() !== [...res.conforming].sort().join())
      res.problems.push(`le migrateur a appliqué : ${res.applied.join(", ") || "rien"}`);
    const after = await recordedSums();
    for (const f of res.conforming)
      if (after.get(f) !== checksum(await sqlOf(f)))
        res.problems.push(`${f} non enregistrée par le migrateur`);
  }
  res.ok = !res.problems.length;
  return res;
}

/** The post-deployment command (one line, no single quote) run in the new Core container (cwd = /app). */
export function verifierCommand(expected, scope) {
  const source = `${verifyMigrations}`;
  const code = `
    const { pathToFileURL } = await import("node:url");
    const d = pathToFileURL(process.cwd() + "/apps/core-api/dist/db/").href;
    const { createPgDb } = await import(d + "db.js");
    const { selectMigrations } = await import(d + "migration-scopes.js");
    const m = await import(d + "migrate.js");
    const { readdir, readFile } = await import("node:fs/promises");
    const scope = ${JSON.stringify(scope)};
    const dir = process.env.MIGRATIONS_DIR ?? m.DEFAULT_MIGRATIONS_DIR;
    const db = createPgDb(process.env.DATABASE_URL);
    try {
      const r = await (${source})({
        db,
        files: selectMigrations(await readdir(dir), scope),
        sqlOf: (f) => readFile(dir + "/" + f, "utf8"),
        checksum: m.migrationChecksum,
        expected: ${JSON.stringify(expected)},
        migrate: () => m.migrate(db, scope, dir),
      });
      console.log("RAPTORU-MIGRATIONS " + JSON.stringify(r));
      if (!r.ok) process.exitCode = 1;
    } finally {
      await db.close();
    }`;
  const line = code.replace(/\s*\n\s*/g, ' ').trim();
  if (line.includes("'") || /(^|[^:])\/\//.test(line))
    throw new Error('verifier command: single quote or // comment');
  return `node --input-type=module -e '${line}'`;
}
