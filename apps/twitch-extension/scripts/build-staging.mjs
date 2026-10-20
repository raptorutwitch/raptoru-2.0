// Hosted Test package of the extension for the STAGING Core (never the production upload):
//   npm run build:staging -w @raptoru/twitch-extension
// With --production (npm run build:production): the same package for the production Core (core.raptoru.fr), no
// environment (no badge), written as raptoru-live-PRODUCTION-<sha>.zip — the version submitted to Twitch review.
// - the same extension/ files as the production package (what is tested is what is uploaded later),
//   except shared/runtime-config.js, generated here: apiBase = the staging Core's viewer frontier,
//   environment 'staging' (a « STAGING · test » badge on every surface), build id = source commit;
// - refuses to finish if any packaged file still names the legacy (raptoru.fr/api or the site);
// - packages like the archives Twitch accepted (production 2026-09-20, Hosted Test 2026-09-10): files
//   at the root, STORED entries, file names in [A-Za-z0-9._/-] only (the staged copy renames the TTS
//   assets whose names have spaces and rewrites their references), no documentation file;
// - writes release/raptoru-live-STAGING-hosted-test-<sha>.zip and prints its SHA-256. Upload it ONLY
//   as a Hosted Test version.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import {
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
import process from 'node:process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const PRODUCTION = process.argv.includes('--production');
const STAGING_API = PRODUCTION
  ? 'https://core.raptoru.fr/v1/ext'
  : 'https://core-staging.raptoru.fr/v1/ext';
const LABEL = PRODUCTION ? 'PRODUCTION' : 'STAGING';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'extension');
// Staged outside the repository (never linted, formatted or committed): only the ZIP stays.
const out = mkdtempSync(join(tmpdir(), 'raptoru-ext-staging-'));
const releaseDir = join(root, 'release');
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const sha = git('rev-parse', '--short=12', 'HEAD');
const dirty = git('status', '--porcelain', '--', 'extension').length > 0;
if (dirty)
  throw new Error(
    'extension/ has uncommitted changes: commit first (the build id must name its source)',
  );
const builtAt = new Date().toISOString();
const buildId = `${LABEL.toLowerCase()}-${sha}-${builtAt.slice(0, 10)}`;

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

// Twitch upload: documentation files are not assets (e.g. assets/tts/PROVENANCE.md).
for (const file of files(out)) if (/\.md$/i.test(file)) rmSync(file);

// Twitch upload: file names limited to [A-Za-z0-9._/-] like every accepted package. A staged asset
// with another character (spaces in the TTS assets) is renamed, and every staged text file that
// names it is rewritten; the extension sources and the Studio players keep the original names.
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
const textFile = /\.(js|mjs|html|css|json|txt|svg)$/i;
const mentions = new Map([...renames.keys()].map((b) => [b, 0]));
for (const file of files(out)) {
  if (!textFile.test(file) || !renames.size) continue;
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
  `// Configuration publique du build ${LABEL} (scripts/build-staging.mjs). Aucun secret.
export const RUNTIME = Object.freeze({
  mode: 'connected',
${PRODUCTION ? '' : "  environment: 'staging',\n"}  apiBase: ${JSON.stringify(STAGING_API)},
  siteUrl: '',
  buildId: ${JSON.stringify(buildId)},
});
`,
);

// Nothing may still point at the legacy: its EBS (raptoru.fr/api) or its site. The staging Core's
// own host (core-staging.raptoru.fr) is allowed.
const LEGACY = /(?<![\w.-])raptoru\.fr/i;
const packaged = files(out).sort();
const textual = /\.(js|mjs|html|css|json|txt|svg|md)$/i;
for (const file of packaged)
  if (textual.test(file) && LEGACY.test(readFileSync(file, 'utf8')))
    throw new Error(
      `legacy URL found in ${relative(out, file)}: refusing the ${LABEL} package`,
    );
const runtime = readFileSync(join(out, 'shared', 'runtime-config.js'), 'utf8');
if (
  !runtime.includes(STAGING_API) ||
  runtime.includes("environment: 'staging'") === PRODUCTION
)
  throw new Error(`${LABEL} runtime config missing`);

// Minimal ZIP writer (STORED entries like the packages Twitch accepted, fixed timestamp): files at the
// archive root, forward slashes, every name checked.
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
  const body = data;
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
    u32(body.length);
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
  const local = Buffer.concat([head(false), name, body]);
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
const zipName = PRODUCTION
  ? `raptoru-live-PRODUCTION-${sha}.zip`
  : `raptoru-live-STAGING-hosted-test-${sha}.zip`;
writeFileSync(join(releaseDir, zipName), zip);
rmSync(out, { recursive: true, force: true });
const zipSha256 = createHash('sha256').update(zip).digest('hex');
writeFileSync(
  join(releaseDir, `${zipName}.sha256`),
  `${zipSha256}  ${zipName}\n`,
);
console.log(
  [
    `twitch-extension ${LABEL}: ${packaged.length} files, ${(zip.length / 1024 / 1024).toFixed(1)} MB`,
    `  apiBase  ${STAGING_API}`,
    `  buildId  ${buildId}`,
    `  zip      ${join(releaseDir, zipName)}`,
    `  sha256   ${zipSha256}`,
    PRODUCTION
      ? '  → production version: upload, Hosted Test, then submit for review.'
      : '  → Hosted Test only. Never the production upload.',
  ].join('\n'),
);
