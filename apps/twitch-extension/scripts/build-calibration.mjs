// Hosted Test package for the Video Component geometry calibration (never production, never staging):
//   npm run build:calibration -w @raptoru/twitch-extension
// docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md. Same extension/ files as the other packages (the real
// Hub, CSS, carousel, module views), except:
// - shared/runtime-config.js, generated here: mode 'demo' (no Twitch authorization awaited, no Twitch
//   listen) + `fixtureCall` = calibration/adapter.js, so every answer of the client comes from local
//   anonymised fixtures (no apiBase: no request can leave), environment 'calibration' (badge);
// - video_component.html gets the calibration HUD (calibration/hud.js + hud.css, fixed overlay) and the
//   « compact-video » density prototype (calibration/compact-video.css + .js, not validated);
// - panel.html, mobile.html, config.html become a static « Calibration build — Video Component only ».
// Packaged like build-staging.mjs (files at the root, STORED, [A-Za-z0-9._/-] names, no .md). Refuses
// to finish if a packaged file names a Raptoru endpoint (legacy, staging Core, /v1/ext, local hosts).
// Writes release/raptoru-live-CALIBRATION-video-component-<sha>.zip and prints its SHA-256.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'extension');
const calibration = join(root, 'calibration');
// Staged outside the repository (never linted, formatted or committed): only the ZIP stays.
const out = mkdtempSync(join(tmpdir(), 'raptoru-ext-calibration-'));
const releaseDir = join(root, 'release');
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const sha = git('rev-parse', '--short=12', 'HEAD');
if (git('status', '--porcelain', '--', 'extension', 'calibration').length > 0)
  throw new Error(
    'extension/ or calibration/ has uncommitted changes: commit first (the build id must name its source)',
  );
const buildId = `calibration-${sha}-${new Date().toISOString().slice(0, 10)}`;

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
for (const file of files(src)) {
  const rel = relative(src, file);
  if (/(^|[\\/])(\.env[^\\/]*|twitch-ext-mock\.js|[^\\/]*\.map)$/i.test(rel))
    throw new Error(`refusing to package ${rel}`);
}

cpSync(src, out, { recursive: true });
mkdirSync(join(out, 'calibration'));
for (const name of [
  'adapter.js',
  'fixtures.js',
  'hud.js',
  'hud.css',
  'compact-video.css',
  'compact-video.js',
])
  copyFileSync(join(calibration, name), join(out, 'calibration', name));

// Twitch upload: documentation files are not assets (e.g. assets/tts/PROVENANCE.md).
for (const file of files(out)) if (/\.md$/i.test(file)) rmSync(file);

// Twitch upload: file names limited to [A-Za-z0-9._/-] (same rule as build-staging.mjs): a staged
// asset with another character is renamed and every staged text file naming it is rewritten.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const renames = new Map();
for (const file of files(out)) {
  const base = file.split(/[\\/]/).pop();
  if (SAFE_NAME.test(base)) continue;
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-');
  const target = join(dirname(file), safe);
  if (renames.has(base) || files(dirname(file)).includes(target))
    throw new Error(`cannot rename ${base}: ${safe} already exists`);
  renameSync(file, target);
  renames.set(base, safe);
}
const textual = /\.(js|mjs|html|css|json|txt|svg)$/i;
const mentions = new Map([...renames.keys()].map((b) => [b, 0]));
for (const file of files(out)) {
  if (!textual.test(file) || !renames.size) continue;
  let text = readFileSync(file, 'utf8');
  let changed = false;
  for (const [from, to] of renames) {
    const parts = text.split(from);
    if (parts.length === 1) continue;
    mentions.set(from, mentions.get(from) + parts.length - 1);
    text = parts.join(to);
    changed = true;
  }
  if (changed) writeFileSync(file, text);
}
for (const [from, n] of mentions)
  if (!n)
    throw new Error(
      `renamed asset ${from} is referenced nowhere: check the rename`,
    );

writeFileSync(
  join(out, 'shared', 'runtime-config.js'),
  `// Généré par scripts/build-calibration.mjs : build CALIBRATION du Video Component, jamais Production ni
// staging. Réponses = fixtures locales anonymisées (calibration/adapter.js) ; aucune URL d'API.
import { calibrationCall } from '../calibration/adapter.js';

export const RUNTIME = Object.freeze({
  mode: 'demo',
  environment: 'calibration',
  apiBase: '',
  siteUrl: '',
  buildId: ${JSON.stringify(buildId)},
  fixtureCall: calibrationCall,
});
`,
);

// HUD on the Video Component only: one stylesheet, one module, after the page's own.
const insertOnce = (text, anchor, insert) => {
  if (text.split(anchor).length !== 2)
    throw new Error(`video_component.html: anchor ${anchor} not found once`);
  return text.replace(anchor, `${insert}\n${anchor}`);
};
const videoPage = join(out, 'video_component.html');
let video = readFileSync(videoPage, 'utf8');
video = insertOnce(
  video,
  '</head>',
  '  <link rel="stylesheet" href="calibration/compact-video.css">\n  <link rel="stylesheet" href="calibration/hud.css">',
);
video = insertOnce(
  video,
  '</body>',
  '  <script type="module" src="calibration/compact-video.js"></script>\n  <script type="module" src="calibration/hud.js"></script>',
);
writeFileSync(videoPage, video);

// The other surfaces exist (console paths) but carry no Raptoru logic in this build.
for (const page of ['panel.html', 'mobile.html', 'config.html'])
  copyFileSync(join(calibration, 'placeholder.html'), join(out, page));

const packaged = files(out).sort();
for (const page of [
  'video_component.html',
  'panel.html',
  'mobile.html',
  'config.html',
])
  if (!packaged.includes(join(out, page)))
    throw new Error(`missing page ${page}`);

// No Raptoru endpoint anywhere in the package, not even in a comment: the guarantee stays mechanical.
const FORBIDDEN = /raptoru\.fr|core-staging|\/v1\/ext|localhost|127\.0\.0\.1/i;
const urls = new Map();
for (const file of packaged) {
  if (!textual.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  const hit = FORBIDDEN.exec(text);
  if (hit)
    throw new Error(
      `${hit[0]} found in ${relative(out, file)}: refusing the calibration package`,
    );
  for (const url of text.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [])
    urls.set(url, [
      ...(urls.get(url) ?? []),
      relative(out, file).split('\\').join('/'),
    ]);
}

// Minimal ZIP writer (STORED entries like the packages Twitch accepted, fixed timestamp).
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const locals = [];
const centrals = [];
let offset = 0;
for (const file of packaged) {
  const name = Buffer.from(relative(out, file).split('\\').join('/'), 'utf8');
  const data = readFileSync(file);
  if (!/^[A-Za-z0-9._/-]+$/.test(name.toString('utf8')))
    throw new Error(`unsafe name in the package: ${name}`);
  const crc = crc32(data);
  const head = (central) => {
    const b = Buffer.alloc(central ? 46 : 30);
    let p = 0;
    const u32 = (v) => ((p = b.writeUInt32LE(v >>> 0, p)), undefined);
    const u16 = (v) => ((p = b.writeUInt16LE(v, p)), undefined);
    u32(central ? 0x02014b50 : 0x04034b50);
    if (central) u16(20); // made by
    u16(20); // version needed
    u16(0x0800); // UTF-8 names
    u16(0); // stored
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(crc);
    u32(data.length);
    u32(data.length);
    u16(name.length);
    u16(0); // extra
    if (central) {
      u16(0); // comment
      u16(0); // disk
      u16(0); // internal attrs
      u32(0); // external attrs
      u32(offset);
    }
    return b;
  };
  const local = Buffer.concat([head(false), name, data]);
  centrals.push(Buffer.concat([head(true), name]));
  locals.push(local);
  offset += local.length;
}
const central = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(packaged.length, 8);
end.writeUInt16LE(packaged.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, central, end]);

mkdirSync(releaseDir, { recursive: true });
const zipName = `raptoru-live-CALIBRATION-video-component-${sha}.zip`;
writeFileSync(join(releaseDir, zipName), zip);
rmSync(out, { recursive: true, force: true });
const zipSha256 = createHash('sha256').update(zip).digest('hex');
writeFileSync(
  join(releaseDir, `${zipName}.sha256`),
  `${zipSha256}  ${zipName}\n`,
);
console.log(
  [
    `twitch-extension CALIBRATION: ${packaged.length} files, ${(zip.length / 1024 / 1024).toFixed(1)} MB`,
    '  data     local fixtures (calibration/adapter.js), no apiBase',
    `  buildId  ${buildId}`,
    `  zip      ${join(releaseDir, zipName)}`,
    `  sha256   ${zipSha256}`,
    '  URL literals in the package (none is a Raptoru endpoint):',
    ...[...urls].map(([url, where]) => {
      const files = [...new Set(where)];
      return `    ${url}  ← ${files.length > 4 ? `${files.length} files (${files[0]}, …)` : files.join(', ')}`;
    }),
    '  → Hosted Test only. Never the production upload.',
  ].join('\n'),
);
