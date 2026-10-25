#!/usr/bin/env node
// CI change detection (docs/CICD.md § CI): which parts of the monorepo a change touches → which CI jobs run.
//
//   node scripts/ci/changes.mjs --event <github event> --base <sha> --head <sha>
//
// - pull request: only the parts touched (and what depends on them: schemas → every app, the extension → Studio);
// - push to main and manual runs: everything, except a documentation-only push (then only the format check). Every
//   deployable commit of main therefore has complete results, which the deployment gate reads (scripts/delivery);
// - a change to the shared configuration (lockfile, Node version, Turborepo, lint / format, workflows) runs everything.
// Prints the decision as JSON and appends it to $GITHUB_OUTPUT when set. No dependency.

import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const PARTS = [
  'code',
  'core',
  'bot',
  'studio',
  'extension',
  'e2e',
  'tooling',
  'images',
];

const GLOBAL = [
  /^package(-lock)?\.json$/,
  /^turbo\.json$/,
  /^tsconfig\.base\.json$/,
  /^\.node-version$/,
  /^eslint\.config\.js$/,
  /^\.prettier(rc\.json|ignore)$/,
  /^\.dockerignore$/,
  /^\.github\//,
];
const DOC = (f) => /^docs\//.test(f) || /\.md$/i.test(f);

/** The parts a single file touches. */
function partsOf(f) {
  if (DOC(f)) return [];
  if (/^packages\/schemas\//.test(f))
    return ['code', 'core', 'bot', 'studio', 'extension', 'e2e', 'images'];
  if (/^(apps\/core-api|supabase)\//.test(f))
    return ['code', 'core', 'e2e', 'images'];
  if (/^apps\/twitch-bot\//.test(f)) return ['code', 'bot', 'images'];
  if (/^apps\/studio\//.test(f)) return ['code', 'studio', 'e2e'];
  // Studio packages the Extension Lab and its E2E serves the extension pages.
  if (/^apps\/twitch-extension\//.test(f))
    return ['code', 'extension', 'studio', 'e2e'];
  if (/^scripts\//.test(f)) return ['code', 'tooling'];
  return ['code'];
}

export function classify(files, { event, base }) {
  const all = Object.fromEntries(PARTS.map((p) => [p, true]));
  const none = Object.fromEntries(PARTS.map((p) => [p, false]));
  if (event === 'workflow_dispatch' || event === 'schedule')
    return { ...all, reason: 'manual run: everything' };
  if (!base || /^0+$/.test(base))
    return { ...all, reason: 'no comparable base: everything' };
  if (files === null) return { ...all, reason: 'diff unavailable: everything' };
  if (files.some((f) => GLOBAL.some((g) => g.test(f))))
    return { ...all, reason: 'shared configuration changed: everything' };
  const docsOnly = files.every(DOC);
  if (event === 'push')
    return docsOnly
      ? { ...none, reason: 'documentation only: format check' }
      : { ...all, reason: 'push to main: everything' };
  const out = { ...none };
  for (const f of files) for (const p of partsOf(f)) out[p] = true;
  return {
    ...out,
    reason: docsOnly
      ? 'documentation only: format check'
      : 'pull request: parts touched',
  };
}

function changedFiles(base, head) {
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : '';
  };
  const event = arg('event');
  const base = arg('base');
  const head = arg('head') || 'HEAD';
  const files = base && !/^0+$/.test(base) ? changedFiles(base, head) : [];
  const decision = classify(files, { event, base });
  console.log(
    JSON.stringify(
      { event, base, head, files: files?.length ?? null, ...decision },
      null,
      2,
    ),
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      PARTS.map((p) => `${p}=${decision[p]}`).join('\n') +
        `\nreason=${decision.reason}\n`,
    );
}
