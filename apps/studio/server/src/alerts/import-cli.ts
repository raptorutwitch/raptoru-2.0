// Twitch alerts V1 (A2) — one-off import of the legacy alert media into Studio's storage (originals only read).
//   npx tsx apps/studio/server/src/alerts/import-cli.ts --legacy "<…\Version webm>" --raid "<…\Alertes\Raid>"
//     [--raid-webm "<converted Raid Titan.webm>"] [--ffmpeg "<ffmpeg.exe>"] [--runtime "<runtimeDir>"]
// The raid AVI (raw BGRA with alpha) is converted with the verified settings when --ffmpeg is given and no
// --raid-webm: VP9, yuva420p (alpha kept), CRF 28, no audio (the separate MP3 is copied as is).
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../test-lab/local-env.js';
import { ALERT_MEDIA, AlertMediaStore } from './media-store.js';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const legacy = arg('legacy');
const raid = arg('raid');
if (!legacy || !raid) {
  console.error(
    'usage: --legacy <Version webm folder> --raid <Raid folder> [--raid-webm <file>] [--ffmpeg <exe>]',
  );
  process.exit(2);
}
let raidWebm = arg('raid-webm');
const ffmpeg = arg('ffmpeg');
if (!raidWebm && ffmpeg) {
  raidWebm = join(mkdtempSync(join(tmpdir(), 'raid-')), 'Raid Titan.webm');
  execFileSync(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    join(raid, 'Titan Avi 4.avi'),
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-b:v',
    '0',
    '-crf',
    '28',
    '-row-mt',
    '1',
    '-auto-alt-ref',
    '0',
    '-an',
    raidWebm,
  ]);
}
const store = await AlertMediaStore.open(
  join(arg('runtime') ?? paths.runtimeDir, 'alerts', 'media'),
);
const sources: Record<string, string> = {};
for (const name of ALERT_MEDIA) sources[name] = join(legacy, name);
sources['Raptoru_Alerte_Raid_Sound.mp3'] = join(
  raid,
  'Raptoru_Alerte_Raid_Sound.mp3',
);
if (raidWebm) sources['Raid Titan.webm'] = raidWebm;
else delete sources['Raid Titan.webm'];
const report = await store.import(
  Object.entries(sources).map(([name, from]) => ({ name, from })),
);
console.table(report);
console.log(`store: ${store.dir}`);
const missing = store
  .status()
  .filter((s) => !s.available)
  .map((s) => s.name);
if (missing.length) console.log('missing:', missing.join(', '));
