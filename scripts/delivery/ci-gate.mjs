// CI gate (docs/CICD.md): a commit is deployable only when the CI proved it on main.
// - the « CI » workflow run of the push of this exact SHA to main concluded success, and the jobs the component needs
//   ran and succeeded (a skipped job proves nothing);
// - a documentation-only commit has no such jobs: the nearest first-parent ancestor (≤ 30 commits) with a complete
//   successful run is accepted when nothing but documentation changed between the two.
// GitHub API with GITHUB_TOKEN (Actions) or the local `gh` login; the token is never printed. No dependency.

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const { fetch, AbortSignal } = globalThis;

export const REQUIRED = {
  core: ['quality', 'core', 'e2e', 'images'],
  'core-staging': ['quality', 'core', 'e2e', 'images'],
  bot: ['quality', 'bot', 'images'],
};
const DOC = (f) => /^docs\//.test(f) || /\.md$/i.test(f);

function token(env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

async function gh(path, tok) {
  const r = await fetch(`${tok.base}${path}`, {
    headers: {
      authorization: `Bearer ${tok.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`GitHub ${path.split('?')[0]} → ${r.status}`);
  return r.json();
}

/** Required jobs of the latest CI run of `sha` (push to main): { ok, run, missing } or null when there is no run. */
async function runOf(repo, sha, need, tok) {
  const runs =
    (
      await gh(
        `/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=10`,
        tok,
      )
    ).workflow_runs ?? [];
  const run = runs.sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )[0];
  if (!run) return null;
  if (run.status !== 'completed')
    return { ok: false, run, missing: [`run ${run.status}`] };
  const jobs =
    (await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, tok))
      .jobs ?? [];
  const missing = need.filter(
    (n) => !jobs.some((j) => j.name === n && j.conclusion === 'success'),
  );
  return {
    ok: run.conclusion === 'success' && missing.length === 0,
    run,
    missing,
  };
}

/**
 * @returns {Promise<{ ok: boolean, reason: string, url?: string }>}
 * git: a function (...args) → stdout (the repository holding sha, fetched).
 */
export async function ciGate({ repo, sha, component, git, env = process.env }) {
  const need = REQUIRED[component];
  if (!need)
    return { ok: false, reason: `composant inconnu pour la CI : ${component}` };
  const tok = {
    token: token(env),
    base: env.GITHUB_API_URL || 'https://api.github.com',
  };
  if (!tok.token)
    return {
      ok: false,
      reason:
        'pas d’accès à GitHub (GITHUB_TOKEN ou gh auth login) : la CI ne peut pas être vérifiée',
    };
  const own = await runOf(repo, sha, need, tok);
  if (own?.ok)
    return {
      ok: true,
      reason: `CI réussie sur ${sha.slice(0, 12)} (${need.join(', ')})`,
      url: own.run.html_url,
    };
  if (own && !own.missing.every((m) => need.includes(m)))
    return {
      ok: false,
      reason: `CI de ${sha.slice(0, 12)} : ${own.missing.join(', ')}`,
      url: own.run.html_url,
    };
  if (own && own.run.conclusion !== 'success')
    return {
      ok: false,
      reason: `CI de ${sha.slice(0, 12)} en échec (${own.run.conclusion})`,
      url: own.run.html_url,
    };
  // No run, or a run without the component's jobs (documentation-only push): nearest proven ancestor.
  const ancestors = git(
    'rev-list',
    '--first-parent',
    '--max-count=30',
    `${sha}~1`,
  )
    .split('\n')
    .filter(Boolean);
  for (const a of ancestors) {
    const changed = git('diff', '--name-only', a, sha)
      .split('\n')
      .filter(Boolean);
    if (!changed.every(DOC))
      return {
        ok: false,
        reason: `aucune CI complète sur ${sha.slice(0, 12)} et du code a changé depuis le dernier commit prouvé (${changed.find((f) => !DOC(f))})`,
      };
    const r = await runOf(repo, a, need, tok);
    if (r?.ok)
      return {
        ok: true,
        reason: `${sha.slice(0, 12)} ne change que de la documentation depuis ${a.slice(0, 12)}, dont la CI est réussie`,
        url: r.run.html_url,
      };
  }
  return {
    ok: false,
    reason: `aucune CI réussie pour ${sha.slice(0, 12)} (ni ancêtre documentaire)`,
  };
}
