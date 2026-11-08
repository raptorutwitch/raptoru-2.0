// The only way to package the Twitch extension (docs/extension/PLAN_REFONTE_EXTENSION_2026-11-08.md § 9
// lot 0, § 12.1):
//   node scripts/package.mjs --target production|staging|calibration [--shell legacy|v2] [--check]
// - targets and their apiBase are frozen in scripts/targets.mjs; the source shared/runtime-config.js is
//   unconfigured and replaced here (the Lab replaces it while serving);
// - same extension/ files for every target, packaged like the archives Twitch accepted: files at the
//   root, STORED entries, names in [A-Za-z0-9._/-] (assets renamed, references rewritten), no .md;
// - refuses a modified tree (the build id names its source commit), forbidden files, any legacy URL;
// - calibration: mode demo + local fixtures, HUD on the Video Component, placeholder pages elsewhere;
// - production: refuses without release-inventory/INVENTAIRE-<last extension commit>.md listing exactly
//   the extension commits since PUBLISHED and carrying « Validé par Antoni : oui »;
// - embeds build-manifest.json (+ build-inventory.txt in production), re-verifies the zip with
//   verify-package.mjs, writes release/<zip> and its .sha256. --check: every verification, no zip
//   written; in production a missing/invalid inventory is reported without failing (CI).
// Never uploads anything: uploading and submitting stay manual, in the Twitch console, after GO.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { ALLOWED_API_BASES, SHELLS, TARGETS } from './targets.mjs';
import {
  CALIBRATION_FORBIDDEN,
  LEGACY,
  TEXTUAL,
  VALIDATION_LINE,
  verifyZip,
} from './verify-package.mjs';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const gitIn =
  (cwd) =>
  (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export function parseArgs(argv) {
  const opts = { target: null, shell: 'legacy', check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=', 2);
    const value = () => inline ?? argv[++i];
    if (flag === '--target') opts.target = value();
    else if (flag === '--shell') opts.shell = value();
    else if (flag === '--check') opts.check = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!Object.hasOwn(TARGETS, opts.target ?? ''))
    throw new Error(
      `unknown target ${opts.target}: --target ${Object.keys(TARGETS).join('|')}`,
    );
  if (!SHELLS.includes(opts.shell))
    throw new Error(`unknown shell ${opts.shell}: --shell ${SHELLS.join('|')}`);
  return opts;
}

/** PUBLISHED: the commit believed served by Twitch; `#` lines are comments. */
export function parsePublished(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length !== 1 || !/^[0-9a-f]{7,40}$/.test(lines[0]))
    throw new Error('PUBLISHED must hold exactly one commit sha');
  return lines[0];
}

/**
 * Inventory of a production package: one line per commit, starting with its sha (`- 8a2f113 …`,
 * `` - `8a2f113` … ``, `| 8a2f113 | … |`), plus the exact line « Validé par Antoni : oui ».
 */
export function checkInventory(text, commits) {
  const lines = text.split(/\r?\n/);
  const listed = lines
    .map((l) => /^\s*(?:[-*|]\s*)?`?([0-9a-f]{7,40})`?(?=[\s|]|$)/.exec(l)?.[1])
    .filter(Boolean);
  const extra = listed.filter((s) => !commits.some((c) => c.startsWith(s)));
  const missing = commits
    .filter((c) => !listed.some((s) => c.startsWith(s)))
    .map((c) => c.slice(0, 7));
  const validated = lines.some(
    (l) => l.normalize('NFC').trim() === VALIDATION_LINE,
  );
  return {
    extra,
    missing,
    validated,
    ok: !extra.length && !missing.length && validated,
  };
}

/** Generated shared/runtime-config.js; refuses any apiBase that is not the target's frozen one. */
export function runtimeConfigSource(target, { buildId, shell }) {
  const frozen = TARGETS[target.name];
  if (
    !frozen ||
    target.apiBase !== frozen.apiBase ||
    (target.apiBase && !ALLOWED_API_BASES.includes(target.apiBase))
  )
    throw new Error(
      `refused apiBase ${JSON.stringify(target.apiBase)} for target ${target.name}`,
    );
  const calibration = frozen.name === 'calibration';
  return `// Généré par scripts/package.mjs, cible ${frozen.label}. Configuration publique, aucun secret.
${calibration ? "// Réponses = fixtures locales anonymisées (calibration/adapter.js) ; aucune URL d'API.\nimport { calibrationCall } from '../calibration/adapter.js';\n\n" : ''}export const RUNTIME = Object.freeze({
  mode: '${frozen.mode}',
${frozen.environment ? `  environment: '${frozen.environment}',\n` : ''}  apiBase: ${JSON.stringify(frozen.apiBase)},
  siteUrl: '',
  buildId: ${JSON.stringify(buildId)},
  shell: ${JSON.stringify(shell)},
${calibration ? '  fixtureCall: calibrationCall,\n' : ''}});
`;
}

/** Minimal ZIP writer: STORED entries like the packages Twitch accepted, fixed timestamp. */
export function zipStored(entries) {
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name: path, data } of entries) {
    if (!/^[A-Za-z0-9._/-]+$/.test(path))
      throw new Error(`unsafe name in the package: ${path}`);
    const name = Buffer.from(path, 'utf8');
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
      u16(0); // time
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
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });

/** § 12.1: extension commits since PUBLISHED, and the inventory that must list them. */
export function productionGate({ root, git }) {
  const published = git(
    'rev-parse',
    '--verify',
    `${parsePublished(readFileSync(join(root, 'PUBLISHED'), 'utf8'))}^{commit}`,
  );
  const commits = git('rev-list', `${published}..HEAD`, '--', 'extension')
    .split(/\s+/)
    .filter(Boolean);
  const source = (commits[0] ?? published).slice(0, 12);
  const inventoryName = `release-inventory/INVENTAIRE-${source}.md`;
  const path = join(root, inventoryName);
  const inventory = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const check = inventory === null ? null : checkInventory(inventory, commits);
  const problems =
    inventory === null
      ? [`${inventoryName} is missing`]
      : [
          ...(check.missing.length
            ? [`commits missing from the inventory: ${check.missing.join(' ')}`]
            : []),
          ...(check.extra.length
            ? [
                `commits in the inventory but not in the gap: ${check.extra.join(' ')}`,
              ]
            : []),
          ...(check.validated ? [] : [`line « ${VALIDATION_LINE} » missing`]),
        ];
  return {
    published,
    commits,
    inventoryName,
    inventory,
    problems,
    ok: !problems.length,
  };
}

export function packageExtension({
  target: targetName,
  shell = 'legacy',
  check = false,
  root = ROOT,
  git = gitIn(root),
}) {
  if (!Object.hasOwn(TARGETS, targetName ?? ''))
    throw new Error(`unknown target ${targetName}`);
  const target = TARGETS[targetName];
  if (!SHELLS.includes(shell)) throw new Error(`unknown shell ${shell}`);
  const calibration = target.name === 'calibration';
  const src = join(root, 'extension');

  const commit = git('rev-parse', 'HEAD');
  const sha = commit.slice(0, 12);
  const dirty = git(
    'status',
    '--porcelain',
    '--',
    'extension',
    'calibration',
    'scripts',
    'PUBLISHED',
  );
  if (dirty)
    throw new Error(
      `uncommitted changes, commit first (the build id must name its source):\n${dirty}`,
    );

  const gate = productionGate({ root, git });
  const published7 = gate.published.slice(0, 7);
  if (target.name === 'production' && !gate.ok && !check)
    throw new Error(
      `production refused: ${gate.commits.length} extension commits since PUBLISHED ${published7}\n  ${gate.problems.join('\n  ')}`,
    );

  const builtAt = new Date().toISOString();
  const buildId = `${target.name}-${sha}-${builtAt.slice(0, 10)}`;
  for (const file of files(src)) {
    const rel = relative(src, file);
    if (/(^|[\\/])(\.env[^\\/]*|twitch-ext-mock\.js|[^\\/]*\.map)$/i.test(rel))
      throw new Error(`refusing to package ${rel}`);
  }

  // Staged outside the repository (never linted, formatted or committed): only the ZIP stays.
  const out = mkdtempSync(join(tmpdir(), `raptoru-ext-${target.name}-`));
  try {
    cpSync(src, out, { recursive: true });
    // Lab-only modules (extension/lab-modules, docs/extension/SOCLE.md) never leave the machine.
    rmSync(join(out, 'lab-modules'), { recursive: true, force: true });
    if (calibration) {
      mkdirSync(join(out, 'calibration'));
      for (const name of ['adapter.js', 'fixtures.js', 'hud.js', 'hud.css'])
        copyFileSync(
          join(root, 'calibration', name),
          join(out, 'calibration', name),
        );
    }

    // Twitch upload: documentation files are not assets (e.g. assets/tts/PROVENANCE.md).
    for (const file of files(out)) if (/\.md$/i.test(file)) rmSync(file);

    // Twitch upload: file names limited to [A-Za-z0-9._/-] like every accepted package. A staged asset
    // with another character (spaces in the TTS assets) is renamed, and every staged text file that
    // names it is rewritten; the extension sources and the Studio players keep the original names.
    const renames = new Map();
    for (const file of files(out)) {
      const base = file.split(/[\\/]/).pop();
      if (/^[A-Za-z0-9._-]+$/.test(base)) continue;
      const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-');
      const renamed = join(dirname(file), safe);
      if (renames.has(base) || files(dirname(file)).includes(renamed))
        throw new Error(`cannot rename ${base}: ${safe} already exists`);
      renameSync(file, renamed);
      renames.set(base, safe);
    }
    const mentions = new Map([...renames.keys()].map((b) => [b, 0]));
    for (const file of files(out)) {
      if (!/\.(js|mjs|html|css|json|txt|svg)$/i.test(file) || !renames.size)
        continue;
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
      runtimeConfigSource(target, { buildId, shell }),
    );

    if (calibration) {
      // No endpoint at all in this package: the (unused, mode demo) runtime guard allows none.
      writeFileSync(
        join(out, 'shared', 'runtime-guard.js'),
        `// Généré par scripts/package.mjs, cible CALIBRATION : aucune API autorisée (fixtures locales).
export const ALLOWED_API_BASES = Object.freeze([]);

export const isAllowedApiBase = () => false;
`,
      );
      // HUD on the Video Component only: one stylesheet, one module, after the page's own.
      const insertOnce = (text, anchor, insert) => {
        if (text.split(anchor).length !== 2)
          throw new Error(
            `video_component.html: anchor ${anchor} not found once`,
          );
        return text.replace(anchor, `${insert}\n${anchor}`);
      };
      const videoPage = join(out, 'video_component.html');
      let video = readFileSync(videoPage, 'utf8');
      video = insertOnce(
        video,
        '</head>',
        '  <link rel="stylesheet" href="calibration/hud.css">',
      );
      video = insertOnce(
        video,
        '</body>',
        '  <script type="module" src="calibration/hud.js"></script>',
      );
      writeFileSync(videoPage, video);
      // The other surfaces exist (console paths) but carry no Raptoru logic in this build.
      for (const page of ['panel.html', 'mobile.html', 'config.html'])
        copyFileSync(
          join(root, 'calibration', 'placeholder.html'),
          join(out, page),
        );
    }

    // Nothing may point at the legacy (raptoru.fr/api, the site); calibration: no Raptoru endpoint at
    // all, not even in a comment. URL literals of the calibration package are listed in the report.
    const urls = new Map();
    for (const file of files(out)) {
      if (!TEXTUAL.test(file)) continue;
      const rel = relative(out, file).split('\\').join('/');
      const text = readFileSync(file, 'utf8');
      const hit = (calibration ? CALIBRATION_FORBIDDEN : LEGACY).exec(text);
      if (hit)
        throw new Error(
          `${hit[0]} found in ${rel}: refusing the ${target.label} package`,
        );
      if (calibration)
        for (const url of text.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [])
          urls.set(url, [...new Set([...(urls.get(url) ?? []), rel])]);
    }

    const embedInventory = target.name === 'production' && gate.ok;
    const manifest = {
      target: target.name,
      commit,
      dirty: false,
      apiBase: target.apiBase,
      shell,
      builtAt,
      buildId,
      published: published7,
      commitsSincePublished: gate.commits.length,
      inventory: embedInventory ? gate.inventoryName : null,
    };
    writeFileSync(
      join(out, 'build-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    if (embedInventory)
      writeFileSync(join(out, 'build-inventory.txt'), gate.inventory);

    const zip = zipStored(
      files(out)
        .sort()
        .map((file) => ({
          name: relative(out, file).split('\\').join('/'),
          data: readFileSync(file),
        })),
    );
    const verified = verifyZip(zip);
    // --check in production: the inventory is reported by the gate, not a verification failure here.
    const errors = verified.errors.filter(
      (e) => !(check && !embedInventory && /build-inventory\.txt/.test(e)),
    );
    if (errors.length)
      throw new Error(`package verification failed:\n  ${errors.join('\n  ')}`);

    const suffix = shell === 'legacy' ? '' : `-shell-${shell}`;
    const zipName = {
      production: `raptoru-live-PRODUCTION-${sha}-depuis-${published7}-${gate.commits.length}-commits${suffix}.zip`,
      staging: `raptoru-live-STAGING-hosted-test-${sha}${suffix}.zip`,
      calibration: `raptoru-live-CALIBRATION-video-component-${sha}${suffix}.zip`,
    }[target.name];
    const zipPath = join(root, 'release', zipName);
    const sha256 = createHash('sha256').update(zip).digest('hex');
    if (!check) {
      mkdirSync(dirname(zipPath), { recursive: true });
      writeFileSync(zipPath, zip);
      writeFileSync(`${zipPath}.sha256`, `${sha256}  ${zipName}\n`);
    }
    return {
      target,
      manifest,
      gate,
      fileCount: verified.fileCount,
      size: zip.length,
      zipPath: check ? null : zipPath,
      zipName,
      sha256,
      urls,
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function report(r, check) {
  const { target, manifest, gate } = r;
  return [
    `twitch-extension ${target.label}${check ? ' --check' : ''}: ${r.fileCount} files, ${(r.size / 1024 / 1024).toFixed(1)} MB, shell ${manifest.shell}`,
    `  apiBase   ${target.apiBase || '(none: local fixtures, calibration/adapter.js)'}`,
    `  buildId   ${manifest.buildId}`,
    `  published ${manifest.published} (PUBLISHED, presumed) · ${gate.commits.length} extension commits since`,
    target.name === 'production'
      ? `  inventory ${gate.inventoryName}: ${gate.ok ? 'valid, embedded as build-inventory.txt' : `INVALID\n    ${gate.problems.join('\n    ')}`}`
      : null,
    `  zip       ${r.zipPath ?? `(--check: nothing written) ${r.zipName}`}`,
    `  sha256    ${r.sha256}`,
    '  verify    OK (scripts/verify-package.mjs)',
    ...(r.urls.size
      ? [
          '  URL literals in the package (none is a Raptoru endpoint):',
          ...[...r.urls].map(
            ([url, where]) =>
              `    ${url}  ← ${where.length > 4 ? `${where.length} files (${where[0]}, …)` : where.join(', ')}`,
          ),
        ]
      : []),
    {
      production:
        '  → production version: upload, Hosted Test, then submit for review — only after GO.',
      staging: '  → Hosted Test only. Never the production upload.',
      calibration: '  → Hosted Test only. Never the production upload.',
    }[target.name],
  ]
    .filter((line) => line !== null)
    .join('\n');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    console.log(report(packageExtension(opts), opts.check));
  } catch (error) {
    console.error(`twitch-extension package REFUSED: ${error.message}`);
    process.exit(1);
  }
}
