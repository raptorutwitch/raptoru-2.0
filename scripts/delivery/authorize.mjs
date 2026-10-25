#!/usr/bin/env node
// Who may deploy to Production from GitHub (docs/CICD.md « Sécurité »). The repository is private on GitHub Free:
// no protected environment, no required reviewer — so the « Déployer » workflow checks itself, before any secret is
// used:
// - a manual run (workflow_dispatch) of the workflow as it is on main (never a branch's modified copy);
// - the person who started it, and any re-run, is in DEPLOY_ACTORS and is an administrator of the repository
//   according to GitHub (not a name typed in a form);
// - an exact 40-character SHA, on origin/main;
// - for a real deployment, the confirmation « DEPLOY <component> <first 7 characters of the SHA> ».
// The confirmation is a guard against mistakes, not an authorisation: the authorisation is the GitHub identity and role.
// Exit 1 with the reasons. No dependency.

import { execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const { fetch, AbortSignal } = globalThis;

export async function authorize(env, { isOnMain }) {
  const problems = [];
  const actors = (env.DEPLOY_ACTORS || '')
    .split(/[\s,]+/)
    .map((a) => a.toLowerCase())
    .filter(Boolean);
  const actor = (env.GITHUB_ACTOR || '').toLowerCase();
  const triggering = (env.GITHUB_TRIGGERING_ACTOR || actor).toLowerCase();
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch')
    problems.push(
      `déclenchement ${env.GITHUB_EVENT_NAME} : seul un lancement manuel est accepté`,
    );
  if (env.GITHUB_REF !== 'refs/heads/main')
    problems.push(
      `workflow lancé depuis ${env.GITHUB_REF} : seulement depuis main (sa version vérifiée)`,
    );
  if (!actors.length)
    problems.push('DEPLOY_ACTORS vide : personne n’est autorisé');
  for (const who of new Set([actor, triggering]))
    if (!actors.includes(who))
      problems.push(`${who} n’est pas dans DEPLOY_ACTORS`);
  if (!problems.length) {
    for (const who of new Set([actor, triggering])) {
      const r = await fetch(
        `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/collaborators/${encodeURIComponent(who)}/permission`,
        {
          headers: {
            authorization: `Bearer ${env.GITHUB_TOKEN}`,
            accept: 'application/vnd.github+json',
          },
          signal: AbortSignal.timeout(15_000),
        },
      ).catch(() => null);
      const role = r?.ok ? (await r.json()).permission : null;
      if (role !== 'admin')
        problems.push(
          `${who} : rôle GitHub ${role ?? 'illisible'} (administrateur requis)`,
        );
    }
  }
  const sha = env.INPUT_SHA ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha))
    problems.push('SHA attendu : 40 caractères hexadécimaux exacts');
  else if (!isOnMain(sha))
    problems.push(`${sha.slice(0, 12)} n’est pas sur origin/main`);
  if (!['core', 'bot', 'core+bot'].includes(env.INPUT_COMPONENT))
    problems.push(`composant inconnu : ${env.INPUT_COMPONENT}`);
  if (env.INPUT_MODE === 'deploy') {
    const expected = `DEPLOY ${env.INPUT_COMPONENT} ${sha.slice(0, 7)}`;
    if ((env.INPUT_CONFIRM ?? '').trim() !== expected)
      problems.push(
        `confirmation attendue pour un déploiement réel : « ${expected} »`,
      );
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isOnMain = (sha) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], {
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  };
  const problems = await authorize(process.env, { isOnMain });
  for (const p of problems) console.log(`✗ ${p}`);
  console.log(
    problems.length
      ? 'NON AUTORISÉ'
      : `autorisé : ${process.env.GITHUB_ACTOR}, ${process.env.INPUT_MODE} ${process.env.INPUT_COMPONENT} ${process.env.INPUT_SHA}`,
  );
  process.exitCode = problems.length ? 1 : 0;
}
