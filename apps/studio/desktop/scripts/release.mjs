// Raptoru Studio release pipeline — one command, local, deterministic.
//
//   npm run studio:release              bump patch → check → package → verify → publish → verify public → commit
//   npm run studio:release -- --dry-run everything except publishing and committing; the version bump is undone
//
// Never pushes the source repository. Uses the local `gh` authentication (no token is written
// anywhere). Publishes only 3 assets to the public releases repo: installer, blockmap, latest.yml.
// The GitHub Release is created as a DRAFT (invisible to electron-updater), checked, then made
// public, then downloaded anonymously and compared byte for byte. Any failure stops everything
// and rolls back what this run created (draft/release, version bump).
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import console from 'node:console';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// --- fixed expectations ---------------------------------------------------------------------------
const RELEASES_REPO = {
  owner: 'raptorutwitch',
  repo: 'raptoru-studio-releases',
};
const SOURCE_BRANCH = 'main';
const PRODUCT = 'Raptoru Studio';

const DRY_RUN = process.argv.includes('--dry-run');
const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(desktopDir, '..', '..', '..');
const releaseDir = join(desktopDir, 'release');
const pkgPath = join(desktopDir, 'package.json');
const lockPath = join(root, 'package-lock.json');
const repoSlug = `${RELEASES_REPO.owner}/${RELEASES_REPO.repo}`;

// --- tiny helpers ---------------------------------------------------------------------------------
const t0 = Date.now();
const say = (msg) =>
  console.log(
    `[studio:release +${((Date.now() - t0) / 1000).toFixed(0)}s] ${msg}`,
  );
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    shell: cmd === 'npm' && process.platform === 'win32',
    ...opts,
  });
const git = (...args) => run('git', args).trim();
const gh = (...args) => run('gh', args).trim();
const sha = (algo, data) => createHash(algo).update(data).digest('base64');
const fail = (message) => {
  throw new Error(message);
};

/** State used by the rollback. */
const state = {
  originalPkg: null, // exact bytes, restored without git (git checkout would rewrite line endings)
  originalLock: null,
  bumped: false,
  committed: false,
  draftCreated: false,
  published: false,
  version: null,
  stagingDir: null,
};

let currentStep = '';
async function step(name, fn) {
  currentStep = name;
  say(`▶ ${name}`);
  const result = await fn();
  say(`✓ ${name}`);
  return result;
}

// --- 1. preflight -----------------------------------------------------------------------------------
function preflight() {
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (rootPkg.name !== 'raptoru')
    fail(`unexpected workspace (${rootPkg.name})`);
  const top = git('rev-parse', '--show-toplevel')
    .replace(/\//g, '\\')
    .toLowerCase();
  if (top !== root.replace(/\//g, '\\').replace(/\\$/, '').toLowerCase())
    fail(`not the Raptoru 2.0 repository root (${top})`);
  const branch = git('branch', '--show-current');
  if (branch !== SOURCE_BRANCH)
    fail(`branch is ${branch}, expected ${SOURCE_BRANCH}`);
  const dirty = git('status', '--porcelain');
  if (dirty) fail(`working tree is dirty:\n${dirty}`);

  const builder = JSON.parse(
    readFileSync(join(desktopDir, 'electron-builder.json'), 'utf8'),
  );
  const pub = builder.publish ?? {};
  if (
    pub.provider !== 'github' ||
    pub.owner !== RELEASES_REPO.owner ||
    pub.repo !== RELEASES_REPO.repo
  )
    fail(`electron-builder.json publish target is not ${repoSlug}`);

  gh('auth', 'status'); // throws if gh is not logged in
  const visibility = gh(
    'repo',
    'view',
    repoSlug,
    '--json',
    'visibility',
    '--jq',
    '.visibility',
  );
  if (visibility !== 'PUBLIC')
    fail(`${repoSlug} must be public (updates are downloaded anonymously)`);
}

// --- 2. version -------------------------------------------------------------------------------------
function nextVersion() {
  const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) fail(`unsupported version ${current}`);
  const next = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  const releases = JSON.parse(
    gh(
      'release',
      'list',
      '-R',
      repoSlug,
      '--limit',
      '100',
      '--json',
      'tagName,isDraft',
    ),
  );
  if (releases.some((r) => r.tagName === `v${next}`))
    fail(
      `v${next} already exists on ${repoSlug} (draft or published): resolve it first`,
    );
  const published = releases.filter((r) => !r.isDraft).map((r) => r.tagName);
  if (published.length && !published.includes(`v${current}`))
    say(
      `⚠ current version v${current} is not a published release (published: ${published.join(', ')})`,
    );
  return { current, next };
}

function bump(next) {
  state.originalPkg = readFileSync(pkgPath);
  state.originalLock = readFileSync(lockPath);
  const pkgText = state.originalPkg.toString('utf8');
  const bumped = pkgText.replace(
    /("version":\s*")\d+\.\d+\.\d+(")/,
    `$1${next}$2`,
  );
  if (bumped === pkgText)
    fail('could not bump apps/studio/desktop/package.json');
  const lock = JSON.parse(state.originalLock.toString('utf8'));
  const entry = lock.packages?.['apps/studio/desktop'];
  if (!entry) fail('package-lock.json has no apps/studio/desktop entry');
  entry.version = next;
  const eol = state.originalLock.toString('utf8').includes('\r\n')
    ? '\r\n'
    : '\n';
  writeFileSync(pkgPath, bumped);
  writeFileSync(
    lockPath,
    JSON.stringify(lock, null, 2).replace(/\n/g, eol) + eol,
  );
  state.bumped = true;
}

function restoreVersion() {
  if (!state.bumped || state.committed) return;
  writeFileSync(pkgPath, state.originalPkg);
  writeFileSync(lockPath, state.originalLock);
  state.bumped = false;
}

// --- 3/4. validation and package ----------------------------------------------------------------------
function validate() {
  run('npm', ['run', 'check'], { inherit: true });
}

function packageStudio() {
  rmSync(releaseDir, { recursive: true, force: true });
  run('npm', ['run', 'studio:package'], { inherit: true });
}

// --- 5. artifact verification -------------------------------------------------------------------------
/** Minimal parser for electron-builder's latest.yml (known flat shape, single file). */
function parseLatestYml(text) {
  const top = (key) =>
    (new RegExp(`^${key}: '?([^'\\r\\n]+)'?\\r?$`, 'm').exec(text) ?? [])[1];
  const inFile = (key) =>
    (new RegExp(`^\\s+-?\\s*${key}: (.+?)\\r?$`, 'm').exec(text) ?? [])[1];
  return {
    version: top('version'),
    path: top('path'),
    sha512: top('sha512'),
    fileUrl: inFile('url'),
    fileSha512: inFile('sha512'),
    fileSize: Number(inFile('size')),
    fileCount: (text.match(/^\s+- url:/gm) ?? []).length,
  };
}

/** Secret values from the local .env and token files, only to prove they are not in the package. */
function localSecrets() {
  const values = new Set();
  for (const file of ['apps/core-api/.env', 'apps/twitch-bot/.env']) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m =
        /^([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|KEY|DATABASE_URL)[A-Z0-9_]*)=(.+)$/.exec(
          line.trim(),
        );
      if (m && m[3].trim().length >= 12)
        values.add(m[3].trim().replace(/^["']|["']$/g, ''));
    }
  }
  for (const file of [
    '.twitch-tokens.json',
    '.twitch-tokens.broadcaster.json',
  ]) {
    const p = join(root, 'apps', 'twitch-bot', file);
    if (!existsSync(p)) continue;
    const t = JSON.parse(readFileSync(p, 'utf8'));
    for (const v of [t.accessToken, t.refreshToken])
      if (typeof v === 'string' && v.length >= 12) values.add(v);
  }
  return [...values];
}

function verifyArtifacts(version) {
  const exeName = `${PRODUCT} Setup ${version}.exe`;
  const expected = [exeName, `${exeName}.blockmap`, 'latest.yml'];
  const present = readdirSync(releaseDir).filter((f) =>
    statSync(join(releaseDir, f)).isFile(),
  );
  for (const f of expected)
    if (!present.includes(f)) fail(`missing artifact ${f}`);
  const extraInstallers = present.filter(
    (f) => f.endsWith('.exe') && f !== exeName,
  );
  if (extraInstallers.length)
    fail(`unexpected installers in release/: ${extraInstallers.join(', ')}`);

  const exe = readFileSync(join(releaseDir, exeName));
  const yml = parseLatestYml(
    readFileSync(join(releaseDir, 'latest.yml'), 'utf8'),
  );
  const hyphenated = `${PRODUCT.replace(/ /g, '-')}-Setup-${version}.exe`;
  const exeSha512 = sha('sha512', exe);
  if (yml.version !== version)
    fail(`latest.yml version ${yml.version} ≠ ${version}`);
  if (yml.fileCount !== 1)
    fail(`latest.yml lists ${yml.fileCount} files, expected 1`);
  if (yml.fileUrl !== hyphenated || yml.path !== hyphenated)
    fail(
      `latest.yml points to ${yml.fileUrl}/${yml.path}, expected ${hyphenated}`,
    );
  if (yml.fileSize !== exe.length)
    fail(`latest.yml size ${yml.fileSize} ≠ installer ${exe.length}`);
  if (yml.fileSha512 !== exeSha512 || yml.sha512 !== exeSha512)
    fail('latest.yml sha512 ≠ installer');

  const blockmap = JSON.parse(
    gunzipSync(readFileSync(join(releaseDir, `${exeName}.blockmap`))),
  );
  if (blockmap.version !== '2' || !blockmap.files?.length)
    fail('invalid blockmap');

  const app = join(releaseDir, 'win-unpacked', 'resources', 'app');
  const embedded = [
    JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version,
    JSON.parse(
      readFileSync(
        join(app, 'apps', 'studio', 'desktop', 'package.json'),
        'utf8',
      ),
    ).version,
  ];
  if (embedded.some((v) => v !== version))
    fail(`embedded version ${embedded.join('/')} ≠ ${version}`);
  const updateYml = readFileSync(
    join(releaseDir, 'win-unpacked', 'resources', 'app-update.yml'),
    'utf8',
  );
  if (
    !updateYml.includes(`owner: ${RELEASES_REPO.owner}`) ||
    !updateYml.includes(`repo: ${RELEASES_REPO.repo}`)
  )
    fail('app-update.yml does not point to the releases repo');
  if (
    !existsSync(
      join(app, 'apps', 'twitch-extension', 'extension', 'panel.html'),
    )
  )
    fail('Extension Lab files missing from the package');

  // Secrets: no secret-looking file, and no local secret value inside any packaged text file.
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(join(releaseDir, 'win-unpacked', 'resources'));
  const forbidden = files.filter((f) =>
    /(^|[\\/])(\.env(\.(?!example$)[^\\/]*)?|\.twitch-tokens[^\\/]*|\.loyalty-outbox\.json[^\\/]*|processes\.json)$/i.test(
      f,
    ),
  );
  if (forbidden.length)
    fail(
      `secret/runtime files packaged: ${forbidden.map((f) => relative(releaseDir, f)).join(', ')}`,
    );
  const secrets = localSecrets();
  const textFiles = files.filter((f) =>
    /\.(js|mjs|cjs|json|html|css|yml|yaml|md|txt|map)$/i.test(f),
  );
  for (const f of textFiles) {
    const content = readFileSync(f, 'utf8');
    if (secrets.some((s) => content.includes(s)))
      fail(`a local secret value was found in ${relative(releaseDir, f)}`);
  }

  return {
    exeName,
    hyphenated,
    size: exe.length,
    sha512: exeSha512,
    sha256: {
      exe: createHash('sha256').update(exe).digest('hex'),
      blockmap: createHash('sha256')
        .update(readFileSync(join(releaseDir, `${exeName}.blockmap`)))
        .digest('hex'),
      yml: createHash('sha256')
        .update(readFileSync(join(releaseDir, 'latest.yml')))
        .digest('hex'),
    },
    scanned: {
      files: files.length,
      textFiles: textFiles.length,
      secretValues: secrets.length,
    },
  };
}

// --- 6/7. publish and public verification ----------------------------------------------------------------
function releaseNotes(version) {
  const head = git('rev-parse', '--short', 'HEAD');
  const lastRelease = git(
    'log',
    '--grep=^chore: release Raptoru Studio',
    '--format=%h',
    '-1',
  );
  const changes = lastRelease
    ? git(
        'log',
        '--format=- %s',
        `${lastRelease}..HEAD`,
        '--',
        'apps/studio',
        'apps/twitch-extension/extension',
      )
    : '';
  return [
    `Raptoru Studio ${version} (source ${head}, dépôt source privé).`,
    '',
    changes
      ? `Changements Studio depuis la release précédente :\n${changes}`
      : 'Mise à jour Raptoru Studio.',
    '',
    'Installeur Windows x64 et flux de mise à jour (latest.yml). Aucun code source.',
  ].join('\n');
}

function stageAssets(version, info) {
  state.stagingDir = mkdtempSync(join(tmpdir(), 'raptoru-studio-release-'));
  const assets = [
    [info.exeName, info.hyphenated],
    [`${info.exeName}.blockmap`, `${info.hyphenated}.blockmap`],
    ['latest.yml', 'latest.yml'],
  ].map(([from, to]) => {
    copyFileSync(join(releaseDir, from), join(state.stagingDir, to));
    return to;
  });
  return assets;
}

function publishDraft(version, assets) {
  const tag = `v${version}`;
  state.draftCreated = true;
  run('gh', [
    'release',
    'create',
    tag,
    '-R',
    repoSlug,
    '--draft',
    '--target',
    'main',
    '--title',
    `${PRODUCT} ${version}`,
    '--notes',
    releaseNotes(version),
    ...assets.map((a) => join(state.stagingDir, a)),
  ]);
  const remote = JSON.parse(
    gh('release', 'view', tag, '-R', repoSlug, '--json', 'assets,isDraft'),
  );
  if (!remote.isDraft) fail('release is not a draft');
  const names = remote.assets.map((a) => a.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...assets].sort()))
    fail(`draft assets ${names.join(', ')} ≠ ${assets.join(', ')}`);
  for (const a of remote.assets) {
    const local = statSync(join(state.stagingDir, a.name)).size;
    if (a.size !== local)
      fail(`draft asset ${a.name}: ${a.size} bytes ≠ local ${local}`);
    if (a.state && a.state !== 'uploaded')
      fail(`draft asset ${a.name} state ${a.state}`);
  }
  gh('release', 'edit', tag, '-R', repoSlug, '--draft=false', '--latest');
  state.published = true;
}

async function verifyPublic(version, assets) {
  const tag = `v${version}`;
  for (const name of assets) {
    // Anonymous download (like the installed app), with a few retries for CDN propagation.
    let buf = null;
    for (let i = 0; i < 6 && !buf; i++) {
      const res = await globalThis.fetch(
        `https://github.com/${repoSlug}/releases/download/${tag}/${name}`,
        { redirect: 'follow' },
      );
      if (res.ok) buf = Buffer.from(await res.arrayBuffer());
      else await sleep(3000);
    }
    if (!buf) fail(`public asset ${name} not downloadable`);
    const local = readFileSync(join(state.stagingDir, name));
    if (!buf.equals(local))
      fail(`public asset ${name} differs from the local file`);
  }
  const latest = await (
    await globalThis.fetch(
      `https://github.com/${repoSlug}/releases/latest/download/latest.yml`,
    )
  ).text();
  if (parseLatestYml(latest).version !== version)
    fail(
      `"latest" release does not serve ${version} yet (got ${parseLatestYml(latest).version})`,
    );
}

function commitVersion(version) {
  git('add', relative(root, pkgPath), relative(root, lockPath));
  git(
    'commit',
    '-m',
    `chore: release Raptoru Studio ${version}`,
    '-m',
    `Published to ${repoSlug} (v${version}) by npm run studio:release.`,
  );
  state.committed = true;
}

// --- rollback ---------------------------------------------------------------------------------------------
function rollback() {
  const report = [];
  if (state.version && (state.draftCreated || state.published)) {
    const tag = `v${state.version}`;
    try {
      run('gh', [
        'release',
        'delete',
        tag,
        '-R',
        repoSlug,
        '--yes',
        '--cleanup-tag',
      ]);
      report.push(
        `GitHub release ${tag} ${state.published ? '(was public)' : '(draft)'} deleted, tag removed`,
      );
    } catch (e) {
      report.push(
        `⚠ could NOT delete release ${tag} on ${repoSlug}: ${e.message.split('\n')[0]} — check it manually before anything else`,
      );
    }
  }
  if (state.bumped && !state.committed) {
    restoreVersion();
    report.push(
      'version bump undone (package.json and package-lock.json restored byte for byte)',
    );
  }
  return report;
}

// --- main ---------------------------------------------------------------------------------------------------
async function main() {
  say(
    DRY_RUN
      ? 'DRY RUN: nothing will be published or committed'
      : `release to ${repoSlug}`,
  );
  await step(
    'preflight (workspace, branch, clean tree, publish target, gh auth)',
    preflight,
  );
  const { current, next } = await step('next version', nextVersion);
  state.version = next;
  say(`version ${current} → ${next}`);
  await step(`bump to ${next}`, () => bump(next));
  await step('validation (npm run check)', validate);
  await step('package (npm run studio:package)', packageStudio);
  const info = await step(
    'verify artifacts (names, version, size, sha512, blockmap, secrets)',
    () => verifyArtifacts(next),
  );
  say(
    `installer ${info.exeName}: ${info.size} bytes, sha512 ${info.sha512.slice(0, 16)}…`,
  );
  say(
    `secret scan: ${info.scanned.files} packaged files, ${info.scanned.textFiles} text files checked against ${info.scanned.secretValues} local secret values`,
  );
  const assets = await step(
    'stage assets (hyphenated names expected by latest.yml)',
    () => stageAssets(next, info),
  );

  if (DRY_RUN) {
    await step('dry run: undo version bump', () => restoreVersion());
    if (git('status', '--porcelain'))
      fail('working tree not clean after the dry run');
    say(
      `DRY RUN OK — would publish v${next} to ${repoSlug}: ${assets.join(', ')}`,
    );
    return;
  }
  await step(`publish v${next} as draft, verify, then make it public`, () =>
    publishDraft(next, assets),
  );
  await step(
    'verify public assets (anonymous download, byte-identical, latest = new version)',
    () => verifyPublic(next, assets),
  );
  await step('commit version bump (local only, never pushed)', () =>
    commitVersion(next),
  );
  say(
    `RELEASE OK — ${PRODUCT} ${next} is live on https://github.com/${repoSlug}/releases/tag/v${next}`,
  );
  say(
    'Installed Studio apps will offer it via "Rechercher une mise à jour" (and the startup check).',
  );
}

try {
  await main();
} catch (error) {
  console.error(
    `\n[studio:release] ✗ FAILED at step: ${currentStep}\n${error.message}`,
  );
  const wasBumped = state.bumped;
  const report = DRY_RUN
    ? (restoreVersion(), wasBumped ? ['dry run: version bump undone'] : [])
    : rollback();
  for (const line of report)
    console.error(`[studio:release] rollback: ${line}`);
  console.error(
    '[studio:release] installed Studio untouched; source repository not pushed.',
  );
  process.exitCode = 1;
} finally {
  if (state.stagingDir)
    rmSync(state.stagingDir, { recursive: true, force: true });
}
