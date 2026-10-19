// Historical Crédits TTS / Soundboard → two opening snapshots (docs/ECONOMY_MIGRATION.md § 15). Reads one private
// export of the legacy table ext_channel_point_redemptions, writes two files; touches no database. Refuses (exit 1)
// anything in flight, unknown or not matching the export's declared totals. The files are then planned / applied /
// verified with wallet:opening-import like the Jetons.
//   npm run wallet:credits-from-legacy -w @raptoru/core-api -- <legacy-export.json> --import-prefix=<id> [--out-dir=<dir>]
// Without --out-dir: validation only (prints the summary).
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  convertLegacyCredits,
  LegacyCreditsError,
} from '../wallet/legacy-credits-to-opening.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const arg = (k: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const importPrefix = arg('import-prefix');
if (!file || !importPrefix)
  throw new Error(
    'usage: <legacy-export.json> --import-prefix=<id> [--out-dir=<dir>]',
  );
try {
  const r = convertLegacyCredits({
    exportText: await readFile(file, 'utf8'),
    importPrefix,
  });
  const dir = arg('out-dir');
  const written: string[] = [];
  if (dir)
    for (const s of r.snapshots) {
      const out = join(dir, `${s.snapshot.import_id}.json`);
      await writeFile(out, s.text, { flag: 'wx' }); // never overwrites an existing file
      written.push(out);
    }
  console.log(JSON.stringify({ written, ...r.summary }, null, 2));
} catch (e) {
  if (!(e instanceof LegacyCreditsError)) throw e;
  console.error(JSON.stringify({ refused: e.blocking }, null, 2));
  process.exitCode = 1;
}
