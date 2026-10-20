// Historical Crédits TTS / Soundboard → two opening snapshots (docs/ECONOMY_MIGRATION.md §§ 15, 18). Reads one private
// export of the legacy table ext_channel_point_redemptions (legacy-credits-export.sql), writes files; touches no
// database. Refuses (exit 1) anything in flight, unknown, not matching the export's declared totals, or a finite
// legacy expiry without the decision (--expiry=permanent). The files are then planned / applied / verified with
// wallet:opening-import like the Jetons.
//   npm run wallet:credits-from-legacy -w @raptoru/core-api -- <legacy-export.json> --import-prefix=<id> [--expiry=permanent] [--out-dir=<dir>]
//   npm run wallet:credits-from-legacy -w @raptoru/core-api -- <legacy-export.json> --inventory [--out-dir=<dir>]
// Without --out-dir: validation / counts only (printed). --inventory writes the per-viewer list ONLY into --out-dir
// (a protected folder outside the repository); the printed part holds counts only.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  convertLegacyCredits,
  inventoryLegacyCredits,
  LegacyCreditsError,
} from '../wallet/legacy-credits-to-opening.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const arg = (k: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const importPrefix = arg('import-prefix');
const inventory = process.argv.includes('--inventory');
const expiry = arg('expiry');
const dir = arg('out-dir');
if (
  !file ||
  (!inventory && !importPrefix) ||
  (expiry !== undefined && expiry !== 'permanent')
)
  throw new Error(
    'usage: <legacy-export.json> (--import-prefix=<id> [--expiry=permanent] | --inventory) [--out-dir=<dir>]',
  );
const text = await readFile(file, 'utf8');
if (inventory) {
  const r = inventoryLegacyCredits(text);
  const written: string[] = [];
  if (dir) {
    const out = join(
      dir,
      `inventory-private-${r.public.sha256.slice(0, 12)}.json`,
    );
    await writeFile(out, JSON.stringify(r.private, null, 2), { flag: 'wx' });
    written.push(out);
  }
  console.log(JSON.stringify({ written, ...r.public }, null, 2));
} else
  try {
    const r = convertLegacyCredits({
      exportText: text,
      importPrefix: importPrefix!,
      expiry: expiry === 'permanent' ? 'permanent' : 'refuse',
    });
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
