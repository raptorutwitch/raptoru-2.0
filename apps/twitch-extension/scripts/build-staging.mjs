// Hosted Test package of the extension for the STAGING Core (never the production upload):
//   npm run build:staging -w @raptoru/twitch-extension
// - the same extension/ files as the production package (what is tested is what is uploaded later),
//   except shared/runtime-config.js, generated here: apiBase = the staging Core's viewer frontier,
//   environment 'staging' (a « STAGING · test » badge on every surface), build id = source commit;
// - refuses to finish if any packaged file still names the legacy (raptoru.fr/api or the site);
// - writes release/raptoru-live-STAGING-hosted-test-<sha>.zip (files at the root, as Twitch expects)
//   and prints its SHA-256. Upload it ONLY as a Hosted Test version.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const STAGING_API = 'https://core-staging.raptoru.fr/v1/ext';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'extension');
const out = join(root, 'dist-staging');
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
const buildId = `staging-${sha}-${builtAt.slice(0, 10)}`;

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

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
writeFileSync(
  join(out, 'shared', 'runtime-config.js'),
  `// Configuration publique du build STAGING (Hosted Test) — Core staging, paiement simulé. Aucun secret.
// Généré par scripts/build-staging.mjs : jamais le build Production.
export const RUNTIME = Object.freeze({
  mode: 'connected',
  environment: 'staging',
  apiBase: ${JSON.stringify(STAGING_API)},
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
      `legacy URL found in ${relative(out, file)}: refusing the staging package`,
    );
const runtime = readFileSync(join(out, 'shared', 'runtime-config.js'), 'utf8');
if (
  !runtime.includes(STAGING_API) ||
  !runtime.includes("environment: 'staging'")
)
  throw new Error('staging runtime config missing');

// Minimal ZIP writer (deflate, fixed timestamp): files at the archive root, forward slashes.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const locals = [];
const centrals = [];
let offset = 0;
for (const file of packaged) {
  const name = Buffer.from(relative(out, file).split('\\').join('/'), 'utf8');
  const data = readFileSync(file);
  const deflated = deflateRawSync(data, { level: 9 });
  const stored = deflated.length >= data.length;
  const body = stored ? data : deflated;
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
    u16(stored ? 0 : 8);
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
const zipName = `raptoru-live-STAGING-hosted-test-${sha}.zip`;
writeFileSync(join(releaseDir, zipName), zip);
const zipSha256 = createHash('sha256').update(zip).digest('hex');
writeFileSync(
  join(releaseDir, `${zipName}.sha256`),
  `${zipSha256}  ${zipName}\n`,
);
console.log(
  [
    `twitch-extension STAGING: ${packaged.length} files, ${(zip.length / 1024 / 1024).toFixed(1)} MB`,
    `  apiBase  ${STAGING_API}`,
    `  buildId  ${buildId}`,
    `  zip      ${join(releaseDir, zipName)}`,
    `  sha256   ${zipSha256}`,
    '  → Hosted Test only. Never the production upload.',
  ].join('\n'),
);
