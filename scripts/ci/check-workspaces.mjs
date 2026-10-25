#!/usr/bin/env node
// Workspace and manifest coherence (docs/CICD.md § CI), checked by the CI before anything is built:
// - the root `workspaces` list is exactly the directories holding a package.json (apps/*, apps/studio/*, packages/*);
// - package-lock.json agrees with every workspace manifest (name, version);
// - every Dockerfile copies every workspace manifest (its `npm ci` checks the whole lockfile: a missing one breaks the
//   image Coolify builds, only at deployment time);
// - one Node version: .node-version = every Dockerfile's `FROM node:` = what the workflows install;
// - every `npm run <script>` / `npm test -w <workspace>` of the workflows exists;
// - Studio's update feed: electron-builder.json publishes where the release script and the release workflow expect.
// Exit 1 with the list of problems. No dependency.

import console from 'node:console';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function check(root) {
  const problems = [];
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const json = (p) => JSON.parse(read(p));
  const pkg = json('package.json');
  const lock = json('package-lock.json');

  const found = [];
  for (const parent of ['apps', 'apps/studio', 'packages']) {
    if (!existsSync(join(root, parent))) continue;
    for (const d of readdirSync(join(root, parent), { withFileTypes: true }))
      if (
        d.isDirectory() &&
        existsSync(join(root, parent, d.name, 'package.json'))
      )
        found.push(`${parent}/${d.name}`);
  }
  const declared = [...pkg.workspaces].sort();
  const actual = found.filter((w) => w !== 'apps/studio').sort();
  if (JSON.stringify(declared) !== JSON.stringify(actual))
    problems.push(
      `workspaces: declared ${declared.join(', ')} ≠ found ${actual.join(', ')}`,
    );

  const manifests = {};
  for (const ws of declared) {
    const m = json(`${ws}/package.json`);
    manifests[ws] = m;
    const l = lock.packages?.[ws];
    if (!l) problems.push(`package-lock.json: no entry for ${ws}`);
    else {
      if (l.name !== undefined && l.name !== m.name)
        problems.push(
          `package-lock.json: ${ws} is « ${l.name} », manifest « ${m.name} »`,
        );
      if ((l.version ?? null) !== (m.version ?? null))
        problems.push(
          `package-lock.json: ${ws} version ${l.version} ≠ manifest ${m.version} (npm install to resync)`,
        );
    }
  }

  const node = existsSync(join(root, '.node-version'))
    ? read('.node-version').trim()
    : null;
  if (!node || !/^\d+\.\d+\.\d+$/.test(node))
    problems.push('.node-version: an exact version (x.y.z) is required');
  for (const ws of declared) {
    const df = `${ws}/Dockerfile`;
    if (!existsSync(join(root, df))) continue;
    const text = read(df);
    for (const other of declared)
      if (!text.includes(`${other}/package.json`))
        problems.push(
          `${df}: does not copy ${other}/package.json (its npm ci needs every workspace manifest)`,
        );
    for (const m of text.matchAll(/^FROM node:([^\s-]+)/gm))
      if (m[1] !== node)
        problems.push(`${df}: FROM node:${m[1]} ≠ .node-version ${node}`);
  }

  const wfDir = join(root, '.github', 'workflows');
  const workflows = existsSync(wfDir)
    ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))
    : [];
  const byName = Object.fromEntries(
    Object.values(manifests).map((m) => [m.name, m]),
  );
  for (const f of workflows) {
    const text = readFileSync(join(wfDir, f), 'utf8');
    // A job reading the CI results (deployment / publication gate) needs « actions: read » (else GitHub answers 403).
    for (const job of text.split(/\n(?= {2}[\w-]+:\n)/).slice(1)) {
      const name = /^ {2}([\w-]+):/.exec(job)?.[1];
      if (
        /(ci-gate|coolify-deploy|status)\.mjs/.test(job) &&
        !/actions: read/.test(job)
      )
        problems.push(
          `${f}: job « ${name} » reads the CI results without « actions: read »`,
        );
    }
    if (/node-version:\s/.test(text))
      problems.push(
        `${f}: use node-version-file: .node-version, not a literal node-version`,
      );
    for (const m of text.matchAll(
      /npm (?:run ([\w:.-]+)|test)((?:\s+-w\s+[@\w/.-]+)*)/g,
    )) {
      const script = m[1] ?? 'test';
      const targets = [...m[2].matchAll(/-w\s+([@\w/.-]+)/g)].map((x) => x[1]);
      if (!targets.length) {
        if (!pkg.scripts?.[script])
          problems.push(`${f}: npm run ${script} — no such root script`);
      } else
        for (const t of targets) {
          const ws = byName[t];
          if (!ws) problems.push(`${f}: -w ${t} — no such workspace`);
          else if (!ws.scripts?.[script])
            problems.push(`${f}: ${t} has no « ${script} » script`);
        }
    }
  }

  const desktop = 'apps/studio/desktop';
  if (existsSync(join(root, desktop, 'electron-builder.json'))) {
    const pub = json(`${desktop}/electron-builder.json`).publish ?? {};
    const target = `${pub.owner}/${pub.repo}`;
    if (pub.provider !== 'github')
      problems.push('electron-builder.json: publish.provider must be github');
    const release = read(`${desktop}/scripts/release.mjs`);
    if (
      !release.includes(`owner: '${pub.owner}'`) ||
      !release.includes(`repo: '${pub.repo}'`)
    )
      problems.push(
        `release.mjs does not publish to ${target} (electron-builder.json)`,
      );
    for (const f of workflows) {
      const text = readFileSync(join(wfDir, f), 'utf8');
      const m = /STUDIO_RELEASES_REPO:\s*([\w.-]+\/[\w.-]+)/.exec(text);
      if (m && m[1] !== target)
        problems.push(
          `${f}: STUDIO_RELEASES_REPO ${m[1]} ≠ electron-builder.json ${target}`,
        );
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const problems = check(root);
  for (const p of problems) console.log(`✗ ${p}`);
  console.log(
    problems.length
      ? `${problems.length} problem(s)`
      : 'workspaces and manifests: OK',
  );
  process.exitCode = problems.length ? 1 : 0;
}
