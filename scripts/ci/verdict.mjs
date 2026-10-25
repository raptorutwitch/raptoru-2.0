#!/usr/bin/env node
// CI verdict (docs/CICD.md): one line per job in the run's summary; fails when a job failed or was cancelled
// (a skipped job — part not touched — is fine). RESULTS = toJSON(needs) of the workflow. No dependency.
import console from 'node:console';
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const needs = JSON.parse(process.env.RESULTS ?? '{}');
const icon = { success: '✅', skipped: '⏭️', failure: '❌', cancelled: '🚫' };
const summary = [
  '| Job | Résultat |',
  '|---|---|',
  ...Object.entries(needs).map(
    ([job, r]) => `| ${job} | ${icon[r.result] ?? ''} ${r.result} |`,
  ),
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
console.log(summary);
const bad = Object.entries(needs).filter(([, r]) =>
  ['failure', 'cancelled'].includes(r.result),
);
if (bad.length) {
  console.error(`Échec : ${bad.map(([j]) => j).join(', ')}`);
  process.exitCode = 1;
}
