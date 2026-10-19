// Opening balances import (docs/ECONOMY_MIGRATION.md). Dry run by default: prints the plan, writes nothing.
//   npm run wallet:opening-import -w @raptoru/core-api -- <snapshot.json>                 (plan)
//   npm run wallet:opening-import -w @raptoru/core-api -- <snapshot.json> --apply=<id>    (apply: the import id typed again)
//   npm run wallet:opening-import -w @raptoru/core-api -- <snapshot.json> --verify        (control, any time after)
// Exit code 1 when blocked or when the verification finds any difference.
import { readFile } from 'node:fs/promises';
import { createPgDb } from '../db/db.js';
import {
  applyOpeningImport,
  OpeningImportError,
  planOpeningImport,
  readOpeningSnapshot,
  verifyOpeningImport,
} from '../wallet/opening-import.js';

const file = process.argv[2];
const coreUrl = process.env.DATABASE_URL;
if (!file || !coreUrl)
  throw new Error(
    'usage: <snapshot.json> [--apply=<import_id>|--verify] ; DATABASE_URL required',
  );
const applyArg = process.argv.find((a) => a.startsWith('--apply'));
const verify = process.argv.includes('--verify');

const { snapshot, sha256 } = readOpeningSnapshot(await readFile(file, 'utf8'));
const db = createPgDb(coreUrl);
let failed: boolean;
try {
  if (verify) {
    const v = await verifyOpeningImport(db, snapshot);
    console.log(JSON.stringify(v, null, 2));
    failed = !v.ok;
  } else if (applyArg) {
    if (applyArg !== `--apply=${snapshot.import_id}`)
      throw new Error(
        `--apply must repeat the import id: --apply=${snapshot.import_id}`,
      );
    const plan = await applyOpeningImport(db, snapshot, sha256);
    const v = await verifyOpeningImport(db, snapshot);
    console.log(
      JSON.stringify({ mode: 'apply', sha256, plan, verification: v }, null, 2),
    );
    failed = !v.ok;
  } else {
    const plan = await planOpeningImport(db, snapshot, sha256);
    console.log(JSON.stringify({ mode: 'dry-run', sha256, plan }, null, 2));
    failed = plan.status === 'blocked';
  }
} catch (e) {
  if (!(e instanceof OpeningImportError)) throw e;
  console.error(JSON.stringify({ refused: e.blocking }, null, 2));
  failed = true;
} finally {
  await db.close();
}
process.exitCode = failed ? 1 : 0;
