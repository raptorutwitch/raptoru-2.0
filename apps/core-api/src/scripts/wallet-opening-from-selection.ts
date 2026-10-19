// Selection manifest → opening snapshot (docs/ECONOMY_MIGRATION.md § 11). Reads two private files, writes one; touches
// no database. Refuses (exit 1) any manifest that is not validated, complete and identical to the raw export.
//   npm run wallet:opening-from-selection -w @raptoru/core-api -- <manifest.json> <raw-export.json> \
//     --import-id=<id> [--currency=main] [--source=streamelements] [--out=<opening.json>]
// Without --out: validation only (prints the summary).
import { readFile, writeFile } from 'node:fs/promises';
import {
  convertSelection,
  SelectionConversionError,
} from '../wallet/selection-to-opening.js';

const [manifest, raw] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'));
const arg = (k: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const importId = arg('import-id');
if (!manifest || !raw || !importId)
  throw new Error(
    'usage: <manifest.json> <raw-export.json> --import-id=<id> [--currency=main] [--source=streamelements] [--out=<file>]',
  );
try {
  const r = convertSelection({
    manifestText: await readFile(manifest, 'utf8'),
    rawText: await readFile(raw, 'utf8'),
    importId,
    currencyId: arg('currency') ?? 'main',
    source: arg('source') ?? 'streamelements',
  });
  const out = arg('out');
  if (out) await writeFile(out, r.text, { flag: 'wx' }); // never overwrites an existing file
  console.log(JSON.stringify({ written: out ?? null, ...r.summary }, null, 2));
} catch (e) {
  if (!(e instanceof SelectionConversionError)) throw e;
  console.error(JSON.stringify({ refused: e.blocking }, null, 2));
  process.exitCode = 1;
}
