// Halloween alert profile (docs/HALLOWEEN.md § 14) — converts the Halloween alert media and puts them in Studio's alert
// media storage (the same store as the usual alerts, by the names the Core's Halloween variants use). The originals in
// `Stream PROJET\Halloween` are only READ; the converted copies are written to a temporary folder first.
//
//   npx tsx apps/studio/server/src/alerts/halloween-import-cli.ts --ffmpeg "<ffmpeg.exe>"
//        [--source "<Stream PROJET\Halloween>"] [--runtime "<runtimeDir>"] [--out "<folder for the converted copies>"]
//
// - Miss Minute (follow): her video (its own track is silent) with « Hello… » muxed in from 0 s: one file, in sync.
// - The Ballon (sub / Prime / resub): the 4 burst animations (VP9 + alpha, silent) and « Le Ballon V2 » (the MP3 as is).
// - Jerry (gifts): the 4 animations named by their threshold (1, 5, 10, 20) and the slowed « My Ordinary Life » (the
//   MP3 as is: a local copy for the streamer's own use, never in Git).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../test-lab/local-env.js';
import { AlertMediaStore } from './media-store.js';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ffmpeg = arg('ffmpeg');
if (!ffmpeg) {
  console.error(
    'usage: --ffmpeg <ffmpeg.exe> [--source <dir>] [--runtime <dir>] [--out <dir>]',
  );
  process.exit(2);
}
const SRC =
  arg('source') ?? 'C:/Users/Antoni/Documents/Stream PROJET/Halloween';
const ALERTE = join(SRC, 'Alerte');
const OUT = arg('out') ?? mkdtempSync(join(tmpdir(), 'halloween-alerts-'));
mkdirSync(OUT, { recursive: true });

const run = (args: string[]) =>
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const VP9_ALPHA = [
  '-c:v',
  'libvpx-vp9',
  '-pix_fmt',
  'yuva420p',
  '-b:v',
  '0',
  '-crf',
  '30',
  '-row-mt',
  '1',
  '-auto-alt-ref',
  '0',
];

/** name in the store → how it is made. */
const MEDIA: { name: string; make: (out: string) => void }[] = [
  {
    name: 'Halloween Follow Miss Minute.webm',
    make: (out) =>
      run([
        '-i',
        join(
          SRC,
          "Séquence d'images/Miss Minute Screamer/Miss Minute Halloween.mov",
        ),
        '-i',
        join(SRC, "Séquence d'images/Miss Minute Screamer/Hello Audio.mp3"),
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        ...VP9_ALPHA,
        '-c:a',
        'libopus',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        out,
      ]),
  },
  ...[1, 2, 3, 4].map((n) => ({
    name: `Halloween Ballon ${n}.webm`,
    make: (out: string) =>
      run([
        '-i',
        join(ALERTE, `Alerte sub Balloon/Ballon variante ${n}.mov`),
        ...VP9_ALPHA,
        '-an',
        out,
      ]),
  })),
  {
    name: 'Halloween Ballon V2.mp3',
    make: (out) =>
      copyFileSync(
        join(ALERTE, 'Alerte sub Balloon/Ballon Halloween V2.mp3'),
        out,
      ),
  },
  ...(
    [
      [1, 'Doofus Jerry Subgift.mov'],
      [5, 'Doofus Jerry subgift 5.mov'],
      [10, 'Doffus Jerry 10 gift.mov'],
      [20, 'Doofus Jerry subgift 20.mov'],
    ] as const
  ).map(([n, file]) => ({
    name: `Halloween Jerry ${n}.webm`,
    make: (out: string) =>
      run(['-i', join(ALERTE, file), ...VP9_ALPHA, '-an', out]),
  })),
  {
    name: 'Halloween Jerry Musique.mp3',
    make: (out) =>
      copyFileSync(join(ALERTE, '(Slowed) My Ordinary Life Gift.mp3'), out),
  },
];

const store = await AlertMediaStore.open(
  join(arg('runtime') ?? paths.runtimeDir, 'alerts', 'media'),
);
const entries: { name: string; from: string }[] = [];
for (const m of MEDIA) {
  const out = join(OUT, m.name);
  if (!existsSync(out)) {
    m.make(out);
    console.log(`+ ${m.name}`);
  } else console.log(`= ${m.name} (déjà converti dans ${OUT})`);
  entries.push({ name: m.name, from: out });
}
const report = await store.import(entries);
for (const r of report) console.log(`${r.result.padEnd(9)} ${r.name}`);
console.log(
  `\n${report.length} médias d'alertes Halloween dans ${store.dir} (copies converties : ${OUT})`,
);
