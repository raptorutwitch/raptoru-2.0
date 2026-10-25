#!/usr/bin/env node
// État de la livraison (docs/CICD.md « Traçabilité ») — read-only, from the live sources, never from a document:
// - main: its commit and the result of its CI;
// - Core and bot: the commit Coolify deployed, the one each service reports itself (GET /v1/ops/status), the
//   previous finished deployment (rollback target), the migrations main would bring and whether the bot lags;
// - Studio: the latest public release and draft of raptoru-studio-releases, the studio-v* tags of this repository,
//   and on this PC the installed version (build-info.json);
// - the live state.
//   node scripts/delivery/status.mjs            (GITHUB_TOKEN / gh login, COOLIFY_TOKEN / ~/.raptoru, OPS_TOKEN / ~/.raptoru)
// Writes Markdown to $GITHUB_STEP_SUMMARY when set. No dependency, no write anywhere.

import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describeSources, liveCheck } from './live-guard.mjs';

const { fetch, AbortSignal } = globalThis;
const HOME = join(homedir(), '.raptoru');
const fileText = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim() : '');
const env = {
  ...process.env,
  COOLIFY_URL: process.env.COOLIFY_URL || 'http://62.84.187.170:8000',
  COOLIFY_TOKEN:
    process.env.COOLIFY_TOKEN || fileText(join(HOME, 'coolify-token.txt')),
  OPS_URL: process.env.OPS_URL || 'https://core.raptoru.fr/v1/ops/status',
  OPS_TOKEN: process.env.OPS_TOKEN || fileText(join(HOME, 'ops-token.txt')),
  TWITCH_CHANNEL_ID: process.env.TWITCH_CHANNEL_ID || '83603689',
};
const REPO = process.env.GITHUB_REPOSITORY || 'raptorutwitch/raptoru-2.0';
const RELEASES = 'raptorutwitch/raptoru-studio-releases';
const APPS = {
  core: '3m7cputub9wt7nwx2k78cme3',
  bot: 'hdbljqmwoq5364w0ypqmz46p',
};
const short = (s) => (s ? String(s).slice(0, 12) : '—');
const git = (...a) => {
  try {
    return execFileSync('git', a, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};
const ghToken =
  process.env.GITHUB_TOKEN ||
  (() => {
    try {
      return execFileSync('gh', ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  })();
async function get(url, headers = {}) {
  try {
    const r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? await r.json() : { error: `HTTP ${r.status}` };
  } catch (e) {
    return { error: String(e.message ?? e).slice(0, 80) };
  }
}
const github = (path) =>
  get(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
    accept: 'application/vnd.github+json',
    ...(ghToken ? { authorization: `Bearer ${ghToken}` } : {}),
  });
const coolify = (path) =>
  env.COOLIFY_TOKEN &&
  (env.COOLIFY_URL.startsWith('https://') ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.COOLIFY_ALLOW_INSECURE_HTTP === 'true')
    ? get(`${env.COOLIFY_URL}/api/v1${path}`, {
        authorization: `Bearer ${env.COOLIFY_TOKEN}`,
        accept: 'application/json',
      })
    : Promise.resolve({
        error: 'Coolify non configuré (COOLIFY_URL https / COOLIFY_TOKEN)',
      });

const lines = [];
const say = (s = '') => lines.push(s);

git('fetch', '-q', 'origin', 'main');
const main =
  git('rev-parse', 'origin/main') ||
  (await github(`/repos/${REPO}/commits/main`)).sha;
const ci = await github(
  `/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${main}&branch=main&per_page=1`,
);
const run = ci.workflow_runs?.[0];
say(
  `## État de la livraison — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
);
say();
say(
  `- **main** : \`${short(main)}\` — CI : ${run ? `${run.status === 'completed' ? run.conclusion : run.status} (${run.html_url})` : (ci.error ?? 'aucune exécution')}`,
);

const live = await liveCheck(env);
const ops = live.ops.status;
say(`- **Live** : ${live.verdict} — ${describeSources(live.sources)}`);
say();
say(
  '| Service | Déployé (Coolify) | Rapporté par le service | Précédent (retour arrière) | Retard sur main |',
);
say('|---|---|---|---|---|');
const deployed = {};
for (const [name, uuid] of Object.entries(APPS)) {
  const d = await coolify(`/deployments/applications/${uuid}?skip=0&take=10`);
  const list = Array.isArray(d) ? d : (d.deployments ?? []);
  const finished = list.filter((x) => x.status === 'finished');
  const running = list.find((x) =>
    ['queued', 'in_progress'].includes(x.status),
  );
  deployed[name] = finished[0]?.commit ?? null;
  const previous = finished.find(
    (x) => x.commit !== finished[0]?.commit,
  )?.commit;
  const reported = name === 'core' ? ops?.commit : ops?.bot?.version;
  const behind =
    deployed[name] && main
      ? git('rev-list', '--count', `${deployed[name]}..${main}`)
      : '';
  say(
    `| ${name} | ${d.error ? d.error : `\`${short(deployed[name])}\`${running ? ` (déploiement ${running.status})` : ''}`} | ${reported ? `\`${short(reported)}\`` : ops ? 'non rapporté' : (live.ops.error ?? '—')} | ${previous ? `\`${short(previous)}\`` : '—'} | ${behind === '' ? '—' : `${behind} commit(s)`} |`,
  );
}
if (deployed.core && main) {
  const added = git(
    'diff',
    '--name-only',
    '--diff-filter=A',
    deployed.core,
    main,
    '--',
    'supabase/migrations',
  )
    .split('\n')
    .filter(Boolean)
    .map((f) => f.split('/').pop());
  say();
  say(
    `- **Migrations** que main apporterait au Core : ${added.length ? added.join(', ') + ' (mode explicite requis au déploiement)' : 'aucune'}`,
  );
}
if (deployed.core && deployed.bot && deployed.core !== deployed.bot)
  say(
    `- **Bot** sur \`${short(deployed.bot)}\`, Core sur \`${short(deployed.core)}\` (le bot suit le Core quand ses fichiers changent)`,
  );
if (ops?.bot)
  say(
    `- **Bot** : ${ops.bot.state}, vu ${ops.bot.last_seen_at ?? '—'}, santé ${JSON.stringify(ops.bot.health)}`,
  );

const releases = await github(`/repos/${RELEASES}/releases?per_page=20`);
const published = Array.isArray(releases)
  ? releases.filter((r) => !r.draft)
  : [];
const drafts = Array.isArray(releases) ? releases.filter((r) => r.draft) : [];
const tags = await github(`/repos/${REPO}/git/matching-refs/tags/studio-v`);
say();
say(
  `- **Studio publié** : ${published[0] ? `${published[0].tag_name} (${published[0].published_at?.slice(0, 10)})` : (releases.error ?? 'aucun')}${drafts.length ? ` · brouillon(s) : ${drafts.map((r) => r.tag_name).join(', ')}` : ''}`,
);
say(
  `- **Studio construit par la CI** (étiquettes studio-v*) : ${Array.isArray(tags) && tags.length ? tags.map((t) => t.ref.replace('refs/tags/', '')).join(', ') : 'aucune'}`,
);
const local = join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'Raptoru Studio',
  'resources',
  'app',
  'build-info.json',
);
if (process.platform === 'win32' && existsSync(local)) {
  const b = JSON.parse(readFileSync(local, 'utf8'));
  say(
    `- **Studio installé sur ce PC** : ${b.version} (\`${short(b.sha)}\`, construit ${b.built_at?.slice(0, 16)})`,
  );
} else
  say(
    '- **Studio installé** : visible seulement sur le PC (lancer ce script sur le PC, ou Studio → À propos)',
  );

const text = lines.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
