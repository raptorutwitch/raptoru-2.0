#!/usr/bin/env node
// Assisted deployment through the Coolify API (docs/REPRISE.md « Déploiement assisté »). No dependency.
//
//   node scripts/coolify-deploy.mjs status  <app>
//   node scripts/coolify-deploy.mjs plan    <app> <sha>                      read-only: checks + plan
//   node scripts/coolify-deploy.mjs deploy  <app> <sha> [--migrations-approved] [--rollback]
//                                           → DRY-RUN (prints the plan and the API calls it would make)
//   node scripts/coolify-deploy.mjs deploy  <app> <sha> --go [...]           → the real deployment
//   --redeploy: rebuild the commit already deployed (restart with a fresh image)
//
// Rules: one application per call, an exact 40-character SHA that exists on origin/<the app's branch>; never the bot
// when the Core is deployed; a migration only with --migrations-approved AND a database backup < 60 min, run once by
// the deployment's post-deployment command (restored afterwards); a rollback is an explicit deploy of an older SHA
// (--rollback), migrations never reverted. The token is read from a file outside the repository and never printed.

import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const { fetch, AbortSignal } = globalThis;
const HOME = join(homedir(), '.raptoru');
const COOLIFY = process.env.COOLIFY_URL ?? 'http://62.84.187.170:8000';
const TOKEN_FILE =
  process.env.COOLIFY_TOKEN_FILE ??
  [
    join(HOME, 'coolify-token.txt'),
    join(HOME, 'coolify-staging-token.txt'),
  ].find(existsSync);
const JOURNAL =
  process.env.COOLIFY_DEPLOY_JOURNAL ?? join(HOME, 'deploy-journal.log');
const POLL_MS = Number(process.env.COOLIFY_POLL_MS ?? 5_000);
const DEPLOY_TIMEOUT_MS = Number(
  process.env.COOLIFY_DEPLOY_TIMEOUT_MS ?? 20 * 60_000,
);
const HEALTH_TIMEOUT_MS = Number(
  process.env.COOLIFY_HEALTH_TIMEOUT_MS ?? 3 * 60_000,
);
const BACKUP_MAX_AGE_MS = 60 * 60_000;
// Tests only: health URLs of a local fake (comma separated).
const HEALTH_OVERRIDE =
  process.env.COOLIFY_HEALTH_URLS?.split(',').filter(Boolean);

/** The applications this script may deploy (Coolify UUIDs are not secrets). */
const APPS = {
  core: {
    uuid: '3m7cputub9wt7nwx2k78cme3',
    name: 'raptoru-core',
    health: ['https://core.raptoru.fr/health', 'https://core.raptoru.fr/ready'],
    database: '4jaqdyvzlelgwkyvuxhjy4mr',
    migrate: 'node apps/core-api/dist/scripts/migrate.js',
    // Files whose change may need the BOT redeployed too (never done here: reported).
    botPaths: ['apps/twitch-bot/', 'packages/schemas/'],
  },
  'core-staging': {
    uuid: 'leadrn7q8x0efkc9u6nxtdic',
    name: 'raptoru-core-staging',
    health: [
      'https://core-staging.raptoru.fr/health',
      'https://core-staging.raptoru.fr/ready',
    ],
    database: 'q4doguxsgguj31vgbejud1tz',
    migrate:
      'MIGRATION_SCOPE=staging node apps/core-api/dist/scripts/migrate.js',
    botPaths: [],
  },
  bot: {
    uuid: 'hdbljqmwoq5364w0ypqmz46p',
    name: 'raptoru-bot',
    health: [],
    database: null,
    migrate: null,
    botPaths: [],
  },
};

const token = TOKEN_FILE ? readFileSync(TOKEN_FILE, 'utf8').trim() : '';
const redact = (s) => (token ? String(s).split(token).join('***') : String(s));
const out = (...a) => console.log(...a.map(redact));
class Stop extends Error {
  constructor(verdict, message) {
    super(message);
    this.verdict = verdict;
  }
}
const blocked = (m) => new Stop('BLOQUÉ', m);

async function api(method, path, body) {
  if (!token)
    throw blocked('aucun jeton Coolify (~/.raptoru/coolify-token.txt)');
  const r = await fetch(`${COOLIFY}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!r.ok)
    throw new Stop(
      r.status === 401 || r.status === 403 ? 'BLOQUÉ' : 'ÉCHEC',
      `Coolify ${method} ${path} → ${r.status} ${redact(JSON.stringify(json)).slice(0, 300)}`,
    );
  return json;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const isAncestor = (a, b) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

async function health(urls) {
  if (HEALTH_OVERRIDE && urls.length) urls = HEALTH_OVERRIDE;
  const res = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8_000) });
      const t = (await r.text()).slice(0, 120);
      res.push({
        url: u,
        ok: r.ok && !/"status":"(not_ready|error)"/.test(t),
        text: `${r.status} ${t}`,
      });
    } catch (e) {
      res.push({ url: u, ok: false, text: String(e.message ?? e) });
    }
  }
  return res;
}

async function deployments(app, take = 5) {
  const d = await api(
    'GET',
    `/deployments/applications/${app.uuid}?skip=0&take=${take}`,
  );
  return Array.isArray(d) ? d : (d?.deployments ?? []);
}

/** The application, checked to be the expected one. */
async function application(key) {
  const app = APPS[key];
  if (!app)
    throw blocked(
      `application inconnue « ${key} » (${Object.keys(APPS).join(', ')})`,
    );
  const a = await api('GET', `/applications/${app.uuid}`);
  if (a?.uuid !== app.uuid || a?.name !== app.name)
    throw blocked(
      `l'UUID ${app.uuid} n'est pas ${app.name} (trouvé : ${a?.name})`,
    );
  return { app, a };
}

async function plan(key, sha, opts) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? ''))
    throw blocked('SHA attendu : 40 caractères hexadécimaux exacts');
  const { app, a } = await application(key);
  const branch = a.git_branch;
  git('fetch', '-q', 'origin', branch);
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
  } catch {
    throw blocked(`le commit ${sha} est inconnu (pas sur origin)`);
  }
  if (!isAncestor(sha, `origin/${branch}`))
    throw blocked(`${sha.slice(0, 12)} n'est pas sur origin/${branch}`);
  const recent = await deployments(app, 10);
  const running = recent.find((d) =>
    ['queued', 'in_progress'].includes(d.status),
  );
  const live = recent.find((d) => d.status === 'finished');
  const current = live?.commit ?? null;
  const p = {
    key,
    app: app.name,
    uuid: app.uuid,
    branch,
    configured: a.git_commit_sha,
    status: a.status,
    current,
    target: sha,
    busy: running ? `${running.deployment_uuid} (${running.status})` : null,
    direction: !current
      ? 'inconnu'
      : current === sha
        ? 'identique'
        : isAncestor(current, sha)
          ? 'avance'
          : isAncestor(sha, current)
            ? 'rollback'
            : 'divergent',
    files: [],
    migrations: [],
    bot: [],
  };
  if (current && current !== sha) {
    try {
      git('cat-file', '-e', `${current}^{commit}`);
      const range =
        p.direction === 'rollback'
          ? `${sha}..${current}`
          : `${current}..${sha}`;
      p.commits = git('log', '--oneline', range).split('\n').filter(Boolean);
      p.files = git('diff', '--name-status', current, sha)
        .split('\n')
        .filter(Boolean);
      // A migration added on the way forward that the app's migrator selects (src/db/migration-scopes.ts at the target).
      const selected = selection(
        git('show', `${sha}:apps/core-api/src/db/migration-scopes.ts`),
        key,
      );
      p.migrations =
        p.direction === 'rollback'
          ? []
          : p.files
              .filter((l) => /^A\s+supabase\/migrations\/.+\.sql$/.test(l))
              .map((l) => l.split(/\s+/)[1].split('/').pop())
              .filter((f) => selected.has(f));
      p.kept =
        p.direction === 'rollback'
          ? p.files
              .filter((l) => /^D\s+supabase\/migrations\/.+\.sql$/.test(l))
              .map((l) => l.split(/\s+/)[1].split('/').pop())
              .filter((f) =>
                selection(
                  git(
                    'show',
                    `${current}:apps/core-api/src/db/migration-scopes.ts`,
                  ),
                  key,
                ).has(f),
              )
          : [];
      p.bot = p.files.filter((l) =>
        app.botPaths.some((b) => l.split(/\s+/)[1].startsWith(b)),
      );
    } catch {
      p.files = ['(commit actuel introuvable localement : faire git fetch)'];
    }
  }
  const problems = [];
  if (p.busy) problems.push(`un déploiement est déjà en cours : ${p.busy}`);
  if (p.direction === 'identique' && !opts.redeploy)
    problems.push(
      'ce commit est déjà déployé (--redeploy pour le reconstruire)',
    );
  if (p.direction === 'divergent')
    problems.push('le commit cible ne prolonge pas le commit déployé');
  if (p.direction === 'rollback' && !opts.rollback)
    problems.push('commit plus ancien que le déployé : ajouter --rollback');
  if (p.migrations.length && !app.migrate)
    problems.push('migrations sur une application sans migrateur');
  if (p.migrations.length && !opts.migrationsApproved)
    problems.push(
      `migration(s) à appliquer : ${p.migrations.join(', ')} — autorisation spécifique requise (--migrations-approved)`,
    );
  if (p.migrations.length && opts.migrationsApproved) {
    // Coolify marks a deployment « finished » even when its post-deployment command fails (checked on 4.4.7): the
    // migration is verified only through the deployment log, which the token must be allowed to read.
    const detail = recent[0]
      ? await api('GET', `/deployments/${recent[0].deployment_uuid}`).catch(
          () => null,
        )
      : null;
    if (!detail || !('logs' in detail))
      problems.push(
        `journal des déploiements illisible avec ce jeton : migration non vérifiable — la lancer à la main (Coolify → ${app.name} → Terminal : ${app.migrate}) ou utiliser un jeton avec lecture des journaux`,
      );
    const backup = await lastBackup(app);
    p.backup = backup;
    if (
      !backup ||
      Date.now() - Date.parse(backup.created_at) > BACKUP_MAX_AGE_MS
    )
      problems.push(
        `sauvegarde de la base trop ancienne (${backup?.created_at ?? 'aucune'}) : Coolify → base → Backups → Backup now, puis relancer`,
      );
  }
  if (a.post_deployment_command)
    problems.push(
      `une commande post-déploiement est déjà configurée dans Coolify (${a.post_deployment_command}) : à vérifier`,
    );
  p.problems = problems;
  return { app, a, p };
}

/** The files the app's migrator applies: the production selection (+ the staging extras for the staging Core). */
function selection(scopes, key) {
  const list = (name) =>
    [
      ...(
        new RegExp(
          `export const ${name}[^=]*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`,
        ).exec(scopes)?.[1] ?? ''
      ).matchAll(/'([^']+\.sql)'/g),
    ].map((m) => m[1]);
  return new Set([
    ...list('PROD_MIGRATIONS'),
    ...list('LEGACY_LAB_IN_PROD'),
    ...list('MAIN_CORE_LAB_MIGRATIONS'),
    ...(key === 'core-staging' ? list('STAGING_EXTRA_LAB_MIGRATIONS') : []),
  ]);
}

async function lastBackup(app) {
  if (!app.database) return null;
  const configs = await api('GET', `/databases/${app.database}/backups`);
  const ex = (Array.isArray(configs) ? configs : [])
    .flatMap((c) => c.executions ?? [])
    .filter((e) => e.status === 'success')
    .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
  return ex[0] ? { created_at: ex[0].created_at, size: ex[0].size } : null;
}

function printPlan(p) {
  out(
    `Application  : ${p.app} (${p.uuid}), branche ${p.branch}, état ${p.status}`,
  );
  out(`Déployé      : ${p.current ?? 'inconnu'}`);
  out(`Cible        : ${p.target}  [${p.direction}]`);
  if (p.commits?.length) out(`Commits      :\n  ${p.commits.join('\n  ')}`);
  if (p.files.length)
    out(
      `Fichiers (${p.files.length}) :\n  ${p.files.slice(0, 40).join('\n  ')}${p.files.length > 40 ? '\n  …' : ''}`,
    );
  out(
    `Migrations   : ${p.migrations.length ? p.migrations.join(', ') : 'aucune'}`,
  );
  if (p.backup)
    out(`Sauvegarde   : ${p.backup.created_at} (${p.backup.size} octets)`);
  if (p.bot.length)
    out(
      `⚠ Bot        : fichiers lus par le bot modifiés (le bot n'est PAS redéployé ici) :\n  ${p.bot.join('\n  ')}`,
    );
  if (p.kept?.length)
    out(
      `⚠ Rollback   : migration(s) déjà appliquée(s), NON annulée(s) (contraintes / colonnes restent) : ${p.kept.join(', ')}`,
    );
  out(
    `Retour       : node scripts/coolify-deploy.mjs deploy ${p.key} ${p.current ?? '<sha>'}${p.direction === 'avance' ? ' --rollback' : ''} --go`,
  );
}

function journal(entry) {
  try {
    appendFileSync(
      JOURNAL,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  } catch {
    /* journal optional */
  }
}

async function deploy(key, sha, opts) {
  const { app, a, p } = await plan(key, sha, opts);
  printPlan(p);
  if (p.problems.length) throw blocked(p.problems.join(' ; '));
  const migrate = p.migrations.length > 0;
  // Tests only (staging): a harmless post-deployment command to check its execution and its output in the log.
  const postCommand = migrate
    ? app.migrate
    : key !== 'core'
      ? (process.env.COOLIFY_TEST_POST_COMMAND ?? null)
      : null;
  const calls = [
    ...(postCommand
      ? [
          `PATCH /applications/${app.uuid} {post_deployment_command: "${postCommand}"}`,
        ]
      : []),
    `PATCH /applications/${app.uuid} {git_commit_sha: "${sha}"}`,
    `POST  /deploy {uuid: "${app.uuid}", force: false}`,
    'GET   /deployments/<deployment_uuid> (suivi)',
    ...(postCommand
      ? [
          `PATCH /applications/${app.uuid} {post_deployment_command: null} (toujours rétabli)`,
        ]
      : []),
    `GET   ${app.health.join(' , ')}`,
  ];
  if (!opts.go) {
    out(
      `\nDRY-RUN — aucun appel d'écriture. Appels prévus :\n  ${calls.join('\n  ')}`,
    );
    out('\nVERDICT : PRÊT (ajouter --go après le GO Production)');
    return 'PRÊT';
  }
  const t0 = Date.now();
  let dep;
  try {
    if (postCommand)
      await api('PATCH', `/applications/${app.uuid}`, {
        post_deployment_command: postCommand,
      });
    await api('PATCH', `/applications/${app.uuid}`, { git_commit_sha: sha });
    const check = await api('GET', `/applications/${app.uuid}`);
    if (check.git_commit_sha !== sha)
      throw new Stop(
        'ÉCHEC',
        `SHA non enregistré par Coolify (${check.git_commit_sha})`,
      );
    const started = await api('POST', '/deploy', {
      uuid: app.uuid,
      force: false,
    });
    const ds = (started?.deployments ?? []).filter(
      (d) => d.resource_uuid === app.uuid || !d.resource_uuid,
    );
    if (ds.length !== 1 || !ds[0].deployment_uuid)
      throw new Stop(
        'ÉCHEC',
        `réponse de déploiement inattendue : ${JSON.stringify(started).slice(0, 300)}`,
      );
    const depUuid = ds[0].deployment_uuid;
    out(`\nDéploiement ${depUuid} lancé`);
    let last = '';
    for (;;) {
      dep = await api('GET', `/deployments/${depUuid}`);
      if (dep.status !== last)
        out(`  ${new Date().toISOString().slice(11, 19)} ${dep.status}`);
      last = dep.status;
      if (!['queued', 'in_progress'].includes(dep.status)) break;
      if (Date.now() - t0 > DEPLOY_TIMEOUT_MS)
        throw new Stop(
          'ÉCHEC',
          `toujours ${dep.status} après ${DEPLOY_TIMEOUT_MS / 60_000} min`,
        );
      await sleep(POLL_MS);
    }
  } finally {
    if (postCommand)
      await api('PATCH', `/applications/${app.uuid}`, {
        post_deployment_command: a.post_deployment_command ?? null,
      }).catch((e) =>
        out(`⚠ commande post-déploiement NON rétablie : ${e.message}`),
      );
  }
  const problems = [];
  if (dep.status !== 'finished') problems.push(`déploiement ${dep.status}`);
  if (dep.commit && dep.commit !== sha)
    problems.push(`commit déployé ${dep.commit} ≠ ${sha}`);
  const logs = parseLogs(dep.logs);
  let migrationOut = null;
  if (postCommand) {
    migrationOut = logs
      .filter((l) =>
        /applied:|already up to date|migrat|post-deployment|raptoru-probe/i.test(
          l,
        ),
      )
      .slice(-6);
    if (
      migrate &&
      !migrationOut.some((l) => /applied:|already up to date/.test(l))
    )
      problems.push(
        'sortie du migrateur non trouvée dans le journal du déploiement : vérifier',
      );
    if (
      migrate &&
      logs.some((l) =>
        /Error:|ERROR:|migration failed|Post-deployment command failed/i.test(
          l,
        ),
      )
    )
      problems.push('erreur dans la sortie du migrateur (voir le journal)');
  }
  // Running and healthy, then the public health URLs.
  let state;
  let h;
  const until = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    state = (await api('GET', `/applications/${app.uuid}`)).status;
    h = await health(app.health);
    if (
      (state === 'running:healthy' || !app.health.length) &&
      h.every((x) => x.ok)
    )
      break;
    if (Date.now() > until) break;
    await sleep(POLL_MS);
  }
  if (state !== 'running:healthy') problems.push(`état Coolify ${state}`);
  for (const x of h) if (!x.ok) problems.push(`${x.url} → ${x.text}`);
  const result = problems.length ? 'ÉCHEC' : 'DÉPLOYÉ';
  out(`\nÉtat Coolify : ${state}`);
  for (const x of h) out(`Santé ${x.ok ? 'OK ' : 'KO '} ${x.url} → ${x.text}`);
  if (migrationOut)
    out(`Migrateur :\n  ${migrationOut.join('\n  ') || '(rien)'}`);
  if (problems.length) {
    out(`\nProblèmes :\n  ${problems.join('\n  ')}`);
    if (dep.status !== 'finished') out(logs.slice(-15).join('\n'));
  }
  out(
    `\nVERDICT : ${result} — ${app.name} @ ${sha.slice(0, 12)} (déploiement ${dep.deployment_uuid ?? '?'}, ${Math.round((Date.now() - t0) / 1000)} s)`,
  );
  out(
    `Retour : node scripts/coolify-deploy.mjs deploy ${key} ${p.current}${p.direction === 'avance' ? ' --rollback' : ''} --go`,
  );
  journal({
    app: app.name,
    from: p.current,
    to: sha,
    result,
    deployment: dep.deployment_uuid,
    migrations: p.migrations,
  });
  return result;
}

function parseLogs(raw) {
  let entries = raw;
  if (typeof raw === 'string') {
    try {
      entries = JSON.parse(raw);
    } catch {
      return raw.split('\n');
    }
  }
  return (Array.isArray(entries) ? entries : [])
    .map((e) => redact(`${e.output ?? e.command ?? ''}`.trim()))
    .filter(Boolean);
}

async function status(key) {
  const { app, a } = await application(key);
  out(
    `${app.name} (${app.uuid}) — ${a.status}, branche ${a.git_branch}, SHA configuré ${a.git_commit_sha}`,
  );
  for (const d of await deployments(app, 5))
    out(
      `  ${d.created_at}  ${d.status.padEnd(11)} ${d.commit}  ${d.deployment_uuid}`,
    );
  for (const x of await health(app.health))
    out(`  santé ${x.ok ? 'OK' : 'KO'} ${x.url} → ${x.text}`);
  if (app.database) {
    const b = await lastBackup(app);
    out(`  dernière sauvegarde réussie : ${b?.created_at ?? 'aucune'}`);
  }
}

const [cmd, key, sha, ...rest] = process.argv.slice(2);
const opts = {
  go: rest.includes('--go'),
  rollback: rest.includes('--rollback'),
  migrationsApproved: rest.includes('--migrations-approved'),
  redeploy: rest.includes('--redeploy'),
};
try {
  if (cmd === 'status') await status(key ?? 'core');
  else if (cmd === 'plan') {
    const { p } = await plan(key, sha, opts);
    printPlan(p);
    out(
      p.problems.length
        ? `\nVERDICT : BLOQUÉ — ${p.problems.join(' ; ')}`
        : '\nVERDICT : PRÊT',
    );
  } else if (cmd === 'deploy') await deploy(key, sha, opts);
  else {
    out(
      'usage : status <app> | plan <app> <sha> | deploy <app> <sha> [--go] [--rollback] [--migrations-approved]',
    );
    process.exitCode = 2;
  }
} catch (e) {
  out(`\nVERDICT : ${e.verdict ?? 'ÉCHEC'} — ${redact(e.message)}`);
  process.exitCode = 1;
}
