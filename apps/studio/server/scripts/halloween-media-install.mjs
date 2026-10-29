#!/usr/bin/env node
// Halloween media install (docs/HALLOWEEN.md § 5) — puts the converted media (halloween-import.mjs) where the INSTALLED
// Studio reads them, independently of any worktree: <dataRoot>/apps/studio/server/.runtime/halloween/media, dataRoot
// being the one the installed Studio declares (%APPDATA%/Raptoru Studio/studio.json). Also makes the durable delivery
// bundle (--to <dir>). Never touches the originals; never deletes a file; every copy is checked (SHA-256) and lands
// under a temporary name first, the manifest last — a half-done install leaves Studio with the media it had.
//
//   node apps/studio/server/scripts/halloween-media-install.mjs [--from <dir>] [--to <dir> | --data-root <dir>] [--check]
//
// --from: a folder with manifest.json + <id>.webm (default: this checkout's import output). If it holds a
//         SHA256SUMS.txt (a delivery bundle), every file is verified against it before anything is copied.
// --to:   the target folder itself (a delivery bundle); otherwise the installed Studio's media folder.
// --check: compares only, writes nothing (exit 1 when something is missing or different).

import process from 'node:process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MEDIA_SUBDIR = join(
  'apps',
  'studio',
  'server',
  '.runtime',
  'halloween',
  'media',
);
const FILE = /^[a-z0-9][a-z0-9-]{0,39}\.webm$/;

export const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** The installed Studio's data folder, as it declares it (null when no installed Studio is configured). */
export function installedDataRoot(env = process.env) {
  const file = join(env.APPDATA ?? '', 'Raptoru Studio', 'studio.json');
  if (!env.APPDATA || !existsSync(file)) return null;
  const root = JSON.parse(readFileSync(file, 'utf8')).dataRoot;
  return typeof root === 'string' && root ? root : null;
}

const readSums = (dir) => {
  const path = join(dir, 'SHA256SUMS.txt');
  if (!existsSync(path)) return null;
  return new Map(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((l) => /^([0-9a-f]{64}) [ *](.+)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[2], m[1]]),
  );
};

/**
 * Copies / checks the media of `from` into `to`. Returns { copied, same, problems, total } — problems is empty when
 * `to` now holds exactly the media of `from` (extra files in `to` are left untouched).
 */
export function installMedia({ from, to, check = false }) {
  const src = resolve(from);
  const dst = resolve(to);
  if (src.toLowerCase() === dst.toLowerCase())
    throw new Error('source et destination identiques');
  const manifestPath = join(src, 'manifest.json');
  if (!existsSync(manifestPath))
    throw new Error(
      `pas de manifest.json dans ${src} (lancer d'abord halloween-import.mjs)`,
    );
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sums = readSums(src);
  const problems = [];
  const copied = [];
  const same = [];
  const out = [];
  if (!check) mkdirSync(dst, { recursive: true });
  for (const m of manifest.media ?? []) {
    if (!FILE.test(m.file ?? '')) {
      problems.push(`${m.id} : nom de fichier refusé (${m.file})`);
      continue;
    }
    const from = join(src, m.file);
    if (!existsSync(from)) {
      problems.push(`${m.id} : fichier absent de la source`);
      continue;
    }
    const hash = sha256(from);
    if (sums && sums.get(m.file) !== hash) {
      problems.push(
        `${m.id} : la source ne correspond pas à SHA256SUMS.txt (fichier abîmé ?)`,
      );
      continue;
    }
    const target = join(dst, m.file);
    if (existsSync(target) && sha256(target) === hash) {
      same.push(m.id);
      out.push({ ...m, sha256: hash });
      continue;
    }
    if (check) {
      problems.push(
        `${m.id} : ${existsSync(target) ? 'différent' : 'absent'} dans la destination`,
      );
      continue;
    }
    const part = `${target}.part`;
    copyFileSync(from, part);
    if (sha256(part) !== hash) {
      rmSync(part, { force: true });
      problems.push(
        `${m.id} : copie corrompue (refaite au prochain lancement)`,
      );
      continue;
    }
    renameSync(part, target);
    copied.push(m.id);
    out.push({ ...m, sha256: hash });
  }
  if (!check && out.length) {
    // The manifest last, under a temporary name: Studio reads either the previous one or the complete new one.
    const tmp = join(dst, 'manifest.json.part');
    writeFileSync(
      tmp,
      JSON.stringify(
        { ...manifest, installed_at: new Date().toISOString(), media: out },
        null,
        2,
      ),
    );
    renameSync(tmp, join(dst, 'manifest.json'));
    writeFileSync(
      join(dst, 'SHA256SUMS.txt'),
      out.map((m) => `${m.sha256}  ${m.file}`).join('\n') + '\n',
    );
  }
  return { copied, same, problems, total: (manifest.media ?? []).length };
}

function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const check = process.argv.includes('--check');
  const from = arg('from') ?? join(ROOT, MEDIA_SUBDIR);
  let to = arg('to');
  if (!to) {
    const root = arg('data-root') ?? installedDataRoot();
    if (!root)
      throw new Error(
        'Studio installé introuvable (%APPDATA%\\Raptoru Studio\\studio.json) : préciser --data-root ou --to',
      );
    to = join(root, MEDIA_SUBDIR);
  }
  console.log(
    `${check ? 'Vérification' : 'Installation'} : ${resolve(from)} → ${resolve(to)}`,
  );
  const r = installMedia({ from, to, check });
  console.log(
    `${r.total} médias : ${r.copied.length} copiés, ${r.same.length} déjà identiques, ${r.problems.length} problème(s)`,
  );
  if (r.problems.length) {
    console.log(`- ${r.problems.join('\n- ')}`);
    process.exitCode = 1;
  } else if (!check && !process.argv.includes('--to'))
    console.log(
      'Dans Studio : onglet Halloween › « Recharger les médias » (ou redémarrer Studio).',
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (e) {
    console.error(`Échec : ${e.message}`);
    process.exitCode = 1;
  }
}
