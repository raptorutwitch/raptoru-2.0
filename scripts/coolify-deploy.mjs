#!/usr/bin/env node
// Deployment of the Core / the bot through the Coolify API (docs/CICD.md « Déployer Core / bot »). No dependency.
// Used locally and by the « Déployer » GitHub workflow (.github/workflows/deploy.yml), same rules everywhere.
//
//   node scripts/coolify-deploy.mjs status  <app>
//   node scripts/coolify-deploy.mjs plan    <app> <sha>                      read-only: checks + plan
//   node scripts/coolify-deploy.mjs deploy  <app> <sha> [options]            → DRY-RUN (plan + the calls it would make)
//   node scripts/coolify-deploy.mjs deploy  <app> <sha> --go [options]       → the real deployment
//   <app>: core | bot | core+bot (the Core, then the bot) | core-staging
//   --rollback               deploy an older commit (migrations are never reverted)
//   --redeploy               rebuild the commit already deployed
//   --migrations-approved    the range's migrations are run by the deployment (post-deployment command)
//   --migrations-preapplied  they were applied by hand beforehand: the new container checks them on the real database,
//                            then its migrator records them (coolify-verify-migrations.mjs)
//   --auto-rollback          on a failed verification, redeploy the previous commit — only when the range has no
//                            migration and the channel is not live
//   --allow-single-live-source  accept « offline » from one source when the others are unknown (explicit arbitration)
//   --skip-ci-gate           local emergencies only (refused in GitHub Actions)
//
// Before any write: an exact 40-character SHA on origin/<branch>; the CI proved it on main (scripts/delivery/
// ci-gate.mjs) — unless Coolify's history shows it already ran in Production (a rollback); no deployment in progress;
// the application's required variables exist (names only, never values); the channel is NOT live (scripts/delivery/
// live-guard.mjs: checked at planning, right before the first write, and again before the bot of core+bot); a
// migration only with an explicit mode, a database backup < 60 min and a token able to read the deployment log.
// After: Coolify's deployment finished on that commit, the application running:healthy, /health and /ready, the Core
// reporting that commit and the bot holding the lease with that version and Twitch / EventSub up (GET /v1/ops/status),
// no fatal line in the startup logs. Tokens come from the environment (COOLIFY_TOKEN, OPS_TOKEN) or files under
// ~/.raptoru, are never printed, and are refused over plain HTTP in GitHub Actions.

import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { verifierCommand } from './coolify-verify-migrations.mjs';
import { ciGate } from './delivery/ci-gate.mjs';
import {
  describeSources,
  liveCheck,
  opsStatus,
} from './delivery/live-guard.mjs';

const { fetch, AbortSignal } = globalThis;
const HOME = join(homedir(), '.raptoru');
const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
const COOLIFY = process.env.COOLIFY_URL ?? 'http://62.84.187.170:8000';
const fileText = (p) =>
  p && existsSync(p) ? readFileSync(p, 'utf8').trim() : '';
const TOKEN_FILE =
  process.env.COOLIFY_TOKEN_FILE ??
  [
    join(HOME, 'coolify-token.txt'),
    join(HOME, 'coolify-staging-token.txt'),
  ].find(existsSync);
const token = process.env.COOLIFY_TOKEN?.trim() || fileText(TOKEN_FILE);
// Read-only ops status of the Core (live state, commit, bot lease): OPS_TOKEN or ~/.raptoru/ops-token.txt.
const OPS_ENV = {
  ...process.env,
  OPS_URL: process.env.OPS_URL ?? 'https://core.raptoru.fr/v1/ops/status',
  OPS_TOKEN:
    process.env.OPS_TOKEN?.trim() || fileText(join(HOME, 'ops-token.txt')),
  TWITCH_CHANNEL_ID: process.env.TWITCH_CHANNEL_ID ?? '83603689',
};
const JOURNAL =
  process.env.COOLIFY_DEPLOY_JOURNAL ?? join(HOME, 'deploy-journal.log');
const SUMMARY = process.env.DELIVERY_SUMMARY_FILE;
const POLL_MS = Number(process.env.COOLIFY_POLL_MS ?? 5_000);
const DEPLOY_TIMEOUT_MS = Number(
  process.env.COOLIFY_DEPLOY_TIMEOUT_MS ?? 20 * 60_000,
);
const HEALTH_TIMEOUT_MS = Number(
  process.env.COOLIFY_HEALTH_TIMEOUT_MS ?? 3 * 60_000,
);
const BOT_TIMEOUT_MS = Number(process.env.BOT_VERIFY_TIMEOUT_MS ?? 4 * 60_000);
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
    scope: 'prod',
    // Files whose change may need the BOT redeployed too (never done by « core »: reported).
    botPaths: ['apps/twitch-bot/', 'packages/schemas/'],
    required: [
      'DATABASE_URL',
      'BOT_SECRET',
      'STUDIO_SECRET',
      'TWITCH_CHANNEL_ID',
    ],
    verify: 'core',
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
    scope: 'staging',
    botPaths: [],
    required: ['DATABASE_URL', 'BOT_SECRET', 'STUDIO_SECRET'],
    verify: null,
  },
  bot: {
    uuid: 'hdbljqmwoq5364w0ypqmz46p',
    name: 'raptoru-bot',
    health: [],
    database: null,
    migrate: null,
    botPaths: [],
    required: [
      'CORE_API_URL',
      'BOT_SECRET',
      'TWITCH_CLIENT_ID',
      'TWITCH_CLIENT_SECRET',
      'TWITCH_BROADCASTER_ID',
    ],
    verify: 'bot',
    // Its range's migrations are the Core's: deployed only once the Core runs this commit or a later one.
    after: 'core',
  },
};

const SECRETS = [
  token,
  OPS_ENV.OPS_TOKEN,
  process.env.TWITCH_CLIENT_SECRET,
  process.env.GITHUB_TOKEN,
].filter((s) => s && s.length >= 8);
const redact = (s) =>
  SECRETS.reduce((t, x) => t.split(x).join('***'), String(s));
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
    throw blocked(
      'aucun jeton Coolify (COOLIFY_TOKEN ou ~/.raptoru/coolify-token.txt)',
    );
  if (
    IN_ACTIONS &&
    !COOLIFY.startsWith('https://') &&
    process.env.COOLIFY_ALLOW_INSECURE_HTTP !== 'true'
  )
    throw blocked(
      `Coolify en HTTP non chiffré (${COOLIFY}) : le jeton ne part pas en clair depuis GitHub. Mettre Coolify derrière HTTPS (COOLIFY_URL https://…) — ou, arbitrage explicite, la variable COOLIFY_ALLOW_INSECURE_HTTP=true`,
    );
  const r = await fetch(`${COOLIFY}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
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
      `application inconnue « ${key} » (${Object.keys(APPS).join(', ')}, core+bot)`,
    );
  const a = await api('GET', `/applications/${app.uuid}`);
  if (a?.uuid !== app.uuid || a?.name !== app.name)
    throw blocked(
      `l'UUID ${app.uuid} n'est pas ${app.name} (trouvé : ${a?.name})`,
    );
  return { app, a };
}

const repoSlug = () =>
  process.env.GITHUB_REPOSITORY ??
  (/github\.com[:/](.+?)(\.git)?$/.exec(
    git('remote', 'get-url', 'origin'),
  )?.[1] ||
    'raptorutwitch/raptoru-2.0');

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
    // Already ran in Production (Coolify's history): the provenance of a rollback target.
    previouslyDeployed: recent.some(
      (d) => d.status === 'finished' && d.commit === sha,
    ),
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
  if (app.after) {
    const first = APPS[app.after];
    const ahead = (await deployments(first, 10)).find(
      (d) => d.status === 'finished',
    )?.commit;
    p.coreMigrations = p.migrations;
    p.migrations = [];
    if (!ahead || !(ahead === sha || isAncestor(sha, ahead)))
      problems.push(
        `${first.name} doit d'abord tourner sur ${sha.slice(0, 12)} ou après (actuellement ${ahead?.slice(0, 12) ?? 'inconnu'})`,
      );
  }
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
  if (opts.migrationsApproved && opts.migrationsPreapplied)
    problems.push(
      "--migrations-approved et --migrations-preapplied s'excluent",
    );
  const approved = opts.migrationsApproved || opts.migrationsPreapplied;
  if (p.migrations.length && !approved)
    problems.push(
      `migration(s) à appliquer : ${p.migrations.join(', ')} — autorisation spécifique requise (--migrations-approved, ou --migrations-preapplied si elles ont déjà été appliquées à la main)`,
    );
  if (!p.migrations.length && approved)
    problems.push(
      'mode de migration donné mais aucune migration dans la plage : retirer l’option',
    );
  if (p.migrations.length && approved) {
    // Coolify marks a deployment « finished » even when its post-deployment command fails (checked on 4.4.7): the
    // migrator's / verifier's result is read only from the deployment log, which Coolify hides from a token without
    // « read:sensitive » (the field is then absent, or the call refused).
    let detail = null;
    let refused = null;
    if (recent[0])
      detail = await api(
        'GET',
        `/deployments/${recent[0].deployment_uuid}`,
      ).catch((e) => ((refused = e.message), null));
    if (!detail || !('logs' in detail))
      problems.push(
        `preuve indispensable inaccessible : journal des déploiements illisible (${refused ?? (recent[0] ? 'champ logs masqué' : 'aucun déploiement à lire')}) — le jeton Coolify n'a pas la permission « read:sensitive » : la sortie du ${opts.migrationsPreapplied ? 'vérificateur' : 'migrateur'} ne pourrait pas être contrôlée. Créer dans Coolify (Keys & Tokens) un jeton read + write + deploy + read:sensitive, puis relancer`,
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
  // Required variables, by name only (values are never read).
  const envs = await api('GET', `/applications/${app.uuid}/envs`).catch(
    () => null,
  );
  if (!Array.isArray(envs))
    problems.push(
      'variables de l’application illisibles (permission du jeton Coolify)',
    );
  else {
    const names = new Set(envs.filter((e) => !e.is_preview).map((e) => e.key));
    const missing = app.required.filter((k) => !names.has(k));
    if (missing.length)
      problems.push(
        `variable(s) requise(s) absente(s) dans Coolify : ${missing.join(', ')}`,
      );
    p.opsToken = names.has('OPS_TOKEN');
  }
  // The CI proved this commit on main — or it already ran in Production (rollback).
  if (opts.skipCiGate && IN_ACTIONS)
    problems.push('--skip-ci-gate est refusé dans GitHub Actions');
  else if (opts.skipCiGate)
    p.ci = {
      ok: true,
      reason: 'CI NON vérifiée (--skip-ci-gate, arbitrage local)',
    };
  else if (p.previouslyDeployed)
    p.ci = {
      ok: true,
      reason: `${sha.slice(0, 12)} a déjà tourné en Production (historique Coolify)`,
    };
  else {
    p.ci = await ciGate({ repo: repoSlug(), sha, component: key, git }).catch(
      (e) => ({
        ok: false,
        reason: `CI non vérifiable : ${e.message}`,
      }),
    );
    if (!p.ci.ok) problems.push(`CI : ${p.ci.reason}`);
  }
  // Never during a live (checked again right before the first write).
  p.live = await liveCheck(OPS_ENV, { allowSingle: opts.allowSingle });
  if (!p.live.ok) problems.push(`live : ${p.live.verdict} — ${p.live.reason}`);
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

const rollbackCommand = (p) =>
  `node scripts/coolify-deploy.mjs deploy ${p.key} ${p.current ?? '<sha>'}${p.direction === 'avance' ? ' --rollback' : ''} --go`;

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
  if (p.coreMigrations?.length)
    out(
      `Migrations : celles du Core dans la plage (${p.coreMigrations.join(', ')}) — portées par le Core, déployé avant`,
    );
  if (p.bot.length)
    out(
      `⚠ Bot        : fichiers lus par le bot modifiés (le bot n'est PAS redéployé ici) :\n  ${p.bot.join('\n  ')}`,
    );
  if (p.kept?.length)
    out(
      `⚠ Rollback   : migration(s) déjà appliquée(s), NON annulée(s) (contraintes / colonnes restent) : ${p.kept.join(', ')}`,
    );
  if (p.ci)
    out(
      `CI           : ${p.ci.ok ? 'OK' : 'NON'} — ${p.ci.reason}${p.ci.url ? ` (${p.ci.url})` : ''}`,
    );
  if (p.live)
    out(
      `Live         : ${p.live.verdict} — ${describeSources(p.live.sources)}`,
    );
  out(`Retour       : ${rollbackCommand(p)}`);
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
  if (SUMMARY)
    try {
      appendFileSync(
        SUMMARY,
        `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      );
    } catch {
      /* summary optional */
    }
}

/** After the deployment: the Core reports the commit / the bot holds the lease with it and Twitch up. */
async function verifyRunning(app, sha, problems, notes) {
  if (!app.verify) return;
  if (!OPS_ENV.OPS_TOKEN) {
    notes.push(
      'vérification par GET /v1/ops/status impossible (OPS_TOKEN absent) : commit et bail non prouvés',
    );
    return;
  }
  const until =
    Date.now() + (app.verify === 'bot' ? BOT_TIMEOUT_MS : HEALTH_TIMEOUT_MS);
  let last;
  for (;;) {
    last = await opsStatus(OPS_ENV);
    const s = last.status;
    if (s && app.verify === 'core') {
      if (s.commit === null) {
        notes.push(
          'le Core ne rapporte pas son commit (SOURCE_COMMIT absent) : commit non prouvé',
        );
        return;
      }
      if (s.commit === sha)
        return void notes.push(`le Core rapporte ${sha.slice(0, 12)}`);
    }
    if (s?.bot && app.verify === 'bot') {
      const b = s.bot;
      const fresh =
        b.last_seen_at && Date.now() - Date.parse(b.last_seen_at) < 60_000;
      const versionOk =
        b.version &&
        (sha.startsWith(b.version) || b.version.startsWith(sha.slice(0, 12)));
      const h = b.health ?? {};
      if (
        b.state === 'active' &&
        versionOk &&
        fresh &&
        h.eventSubBot !== false &&
        h.eventSubBroadcaster !== false &&
        h.broadcasterToken !== false
      )
        return void notes.push(
          `bot actif en ${String(b.version).slice(0, 12)} : EventSub bot ${h.eventSubBot}, EventSub diffuseur ${h.eventSubBroadcaster}, jeton diffuseur ${h.broadcasterToken}`,
        );
    }
    if (Date.now() > until) break;
    await sleep(POLL_MS);
  }
  const s = last?.status;
  problems.push(
    !s
      ? `statut ops illisible après le déploiement (${last?.error})`
      : app.verify === 'core'
        ? `le Core rapporte le commit ${s.commit ?? 'inconnu'} ≠ ${sha.slice(0, 12)}`
        : `bot non confirmé : état ${s.bot?.state}, version ${s.bot?.version ?? '—'}, vu ${s.bot?.last_seen_at ?? 'jamais'}, santé ${JSON.stringify(s.bot?.health ?? null)}`,
  );
}

/** Startup logs: a fatal line fails the deployment; other error lines are reported. */
async function scanLogs(app, problems, notes) {
  const r = await api('GET', `/applications/${app.uuid}/logs?lines=200`).catch(
    (e) => ({ error: e.message }),
  );
  if (r?.error || typeof r?.logs !== 'string') {
    notes.push(
      `journaux d'exécution illisibles (${r?.error ?? 'champ logs absent'})`,
    );
    return;
  }
  const lines = r.logs.split('\n').map((l) => redact(l));
  const fatal = lines.filter((l) =>
    /\b(FATAL|uncaughtException|unhandledRejection|UnhandledPromiseRejection)\b|^Error: |npm ERR!/i.test(
      l,
    ),
  );
  const errors = lines.filter((l) => /\bERROR\b/.test(l) && !fatal.includes(l));
  if (fatal.length)
    problems.push(
      `ligne(s) fatale(s) au démarrage :\n    ${fatal.slice(-5).join('\n    ')}`,
    );
  if (errors.length)
    notes.push(
      `${errors.length} ligne(s) ERROR dans les journaux récents (dernière : ${errors.at(-1).slice(0, 160)})`,
    );
}

async function deploy(key, sha, opts) {
  const { app, a, p } = await plan(key, sha, opts);
  printPlan(p);
  if (p.problems.length) throw blocked(p.problems.join(' ; '));
  const migrate = p.migrations.length > 0;
  const verify = migrate && opts.migrationsPreapplied;
  // Tests only (staging): a harmless post-deployment command to check its execution and its output in the log.
  const postCommand = verify
    ? verifierCommand(p.migrations, app.scope)
    : migrate
      ? app.migrate
      : key !== 'core'
        ? (process.env.COOLIFY_TEST_POST_COMMAND ?? null)
        : null;
  const calls = [
    ...(postCommand
      ? [
          `PATCH /applications/${app.uuid} {post_deployment_command: "${verify ? `<vérificateur des migrations préappliquées : ${p.migrations.join(', ')}, ${postCommand.length} caractères>` : postCommand}"} (relu ensuite)`,
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
    `GET   ${app.health.join(' , ') || '(pas d’URL de santé)'} · GET /v1/ops/status · journaux d'exécution`,
  ];
  if (!opts.go) {
    out(
      `\nDRY-RUN — aucun appel d'écriture. Appels prévus :\n  ${calls.join('\n  ')}`,
    );
    out('\nVERDICT : PRÊT (ajouter --go après le GO Production)');
    journal({
      app: app.name,
      from: p.current,
      to: sha,
      result: 'PRÊT',
      dryRun: true,
    });
    return 'PRÊT';
  }
  // Last live check, right before the first write.
  const now = await liveCheck(OPS_ENV, { allowSingle: opts.allowSingle });
  if (!now.ok)
    throw blocked(
      `live juste avant d'écrire : ${now.verdict} — ${now.reason} (${describeSources(now.sources)})`,
    );
  const t0 = Date.now();
  let dep;
  let started = false;
  try {
    if (postCommand) {
      await api('PATCH', `/applications/${app.uuid}`, {
        post_deployment_command: postCommand,
      });
      // Read back before anything else changes: a command Coolify cut or refused never runs.
      const saved = await api('GET', `/applications/${app.uuid}`);
      if (saved.post_deployment_command !== postCommand)
        throw blocked(
          `commande post-déploiement non enregistrée telle quelle par Coolify (${String(saved.post_deployment_command ?? '').length}/${postCommand.length} caractères) : rien déployé`,
        );
    }
    await api('PATCH', `/applications/${app.uuid}`, { git_commit_sha: sha });
    const check = await api('GET', `/applications/${app.uuid}`);
    if (check.git_commit_sha !== sha)
      throw new Stop(
        'ÉCHEC',
        `SHA non enregistré par Coolify (${check.git_commit_sha})`,
      );
    const res = await api('POST', '/deploy', { uuid: app.uuid, force: false });
    started = true;
    const ds = (res?.deployments ?? []).filter(
      (d) => d.resource_uuid === app.uuid || !d.resource_uuid,
    );
    if (ds.length !== 1 || !ds[0].deployment_uuid)
      throw new Stop(
        'ÉCHEC',
        `réponse de déploiement inattendue : ${JSON.stringify(res).slice(0, 300)}`,
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
  } catch (e) {
    if (!started || !(e instanceof Stop)) throw e;
    dep = { status: 'inconnu', deployment_uuid: null };
    out(`⚠ ${e.message}`);
  } finally {
    if (postCommand)
      await api('PATCH', `/applications/${app.uuid}`, {
        post_deployment_command: a.post_deployment_command ?? null,
      }).catch((e) =>
        out(`⚠ commande post-déploiement NON rétablie : ${e.message}`),
      );
  }
  const problems = [];
  const notes = [];
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
    if (verify) {
      const line = logs.find((l) => l.startsWith('RAPTORU-MIGRATIONS '));
      let r = null;
      try {
        r = line && JSON.parse(line.slice('RAPTORU-MIGRATIONS '.length));
      } catch {
        /* reported below */
      }
      migrationOut = r
        ? [
            `déjà enregistrées : ${r.recorded.join(', ') || '—'}`,
            `conformes sur la base : ${r.conforming.join(', ') || '—'}`,
            `enregistrées par le migrateur : ${r.applied.join(', ') || '—'}`,
            ...r.problems.map((x) => `✗ ${x}`),
          ]
        : migrationOut;
      if (!r)
        problems.push(
          "résultat du vérificateur absent du journal du déploiement : rien n'est prouvé",
        );
      else if (!r.ok)
        problems.push(
          `migrations préappliquées NON conformes : ${r.problems.join(' ; ')}`,
        );
    } else if (
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
  // Running and healthy, then the public health URLs, then what the services say of themselves.
  let state;
  let h = [];
  if (dep.status === 'finished') {
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
    await verifyRunning(app, sha, problems, notes);
    await scanLogs(app, problems, notes);
  }
  let result = problems.length ? 'ÉCHEC' : 'DÉPLOYÉ';
  out(`\nÉtat Coolify : ${state ?? '—'}`);
  for (const x of h) out(`Santé ${x.ok ? 'OK ' : 'KO '} ${x.url} → ${x.text}`);
  for (const n of notes) out(`Vérification : ${n}`);
  if (migrationOut)
    out(`Migrateur :\n  ${migrationOut.join('\n  ') || '(rien)'}`);
  if (problems.length) {
    out(`\nProblèmes :\n  ${problems.join('\n  ')}`);
    if (dep.status !== 'finished') out(logs.slice(-15).join('\n'));
  }
  out(
    `\nVERDICT : ${result} — ${app.name} @ ${sha.slice(0, 12)} (déploiement ${dep.deployment_uuid ?? '?'}, ${Math.round((Date.now() - t0) / 1000)} s)`,
  );
  out(`Retour : ${rollbackCommand(p)}`);
  journal({
    app: app.name,
    from: p.current,
    to: sha,
    result,
    deployment: dep.deployment_uuid,
    migrations: p.migrations,
    ...(verify ? { mode: 'preapplied' } : {}),
    problems,
    notes,
  });
  if (result === 'ÉCHEC' && opts.autoRollback && !opts.nested)
    result = await autoRollback(key, p, opts);
  return result;
}

/** Redeploys the previous commit after a failed verification — only when that is known to be safe. */
async function autoRollback(key, p, opts) {
  const why =
    p.direction !== 'avance' || !p.current
      ? 'pas de commit précédent connu dont on prolonge l’historique'
      : p.migrations.length
        ? `la plage contient des migrations (${p.migrations.join(', ')}) : un retour de code sur un schéma migré n'est pas sûr automatiquement`
        : null;
  if (why) {
    out(
      `\nRetour arrière automatique NON lancé : ${why}. Décision manuelle : ${rollbackCommand(p)}`,
    );
    return 'ÉCHEC';
  }
  const l = await liveCheck(OPS_ENV, { allowSingle: opts.allowSingle });
  if (!l.ok) {
    out(
      `\nRetour arrière automatique NON lancé : live ${l.verdict} (${l.reason}). Décision manuelle : ${rollbackCommand(p)}`,
    );
    return 'ÉCHEC';
  }
  out(
    `\n=== Retour arrière automatique vers ${p.current.slice(0, 12)} (aucune migration dans la plage, hors live) ===`,
  );
  const r = await deploy(key, p.current, {
    ...opts,
    rollback: true,
    redeploy: false,
    migrationsApproved: false,
    migrationsPreapplied: false,
    nested: true,
  }).catch(
    (e) => (
      out(`\nRetour arrière : ${e.verdict ?? 'ÉCHEC'} — ${redact(e.message)}`),
      'ÉCHEC'
    ),
  );
  out(
    `\nRetour arrière : ${r === 'DÉPLOYÉ' ? `effectué, ${p.app} est revenu sur ${p.current.slice(0, 12)}` : 'EN ÉCHEC — intervention manuelle'}`,
  );
  return r === 'DÉPLOYÉ' ? 'ÉCHEC-RETOUR-OK' : 'ÉCHEC';
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
  const l = await liveCheck(OPS_ENV);
  out(`  live : ${l.verdict} — ${describeSources(l.sources)}`);
  if (l.ops.status) {
    const s = l.ops.status;
    out(
      `  Core rapporte : commit ${s.commit ?? 'inconnu'} · bot ${s.bot?.state ?? '—'} ${s.bot?.version ?? ''}`,
    );
  }
}

/** The bot's plan of core+bot, as if the Core already ran the target (it is deployed first). */
async function planBotAfterCore(sha, opts) {
  const { p } = await plan('bot', sha, opts);
  p.problems = p.problems.filter(
    (x) => !x.startsWith(`${APPS.core.name} doit d'abord`),
  );
  printPlan(p);
  out(
    p.problems.length
      ? `\nVERDICT : BLOQUÉ — ${p.problems.join(' ; ')}`
      : '\nVERDICT : PRÊT (après le Core)',
  );
  return p.problems.length ? 'BLOQUÉ' : 'PRÊT';
}

const [cmd, key, sha, ...rest] = process.argv.slice(2);
const opts = {
  go: rest.includes('--go'),
  rollback: rest.includes('--rollback'),
  migrationsApproved: rest.includes('--migrations-approved'),
  migrationsPreapplied: rest.includes('--migrations-preapplied'),
  redeploy: rest.includes('--redeploy'),
  autoRollback: rest.includes('--auto-rollback'),
  allowSingle: rest.includes('--allow-single-live-source'),
  skipCiGate: rest.includes('--skip-ci-gate'),
};
const unknown = rest.filter(
  (x) =>
    x.startsWith('--') &&
    !/^--(go|rollback|migrations-approved|migrations-preapplied|redeploy|auto-rollback|allow-single-live-source|skip-ci-gate)$/.test(
      x,
    ),
);
try {
  if (unknown.length)
    throw blocked(`option(s) inconnue(s) : ${unknown.join(' ')}`);
  if (cmd === 'status') await status(key ?? 'core');
  else if (cmd === 'plan') {
    if (key === 'core+bot') out('=== core ===');
    const { p } = await plan(key === 'core+bot' ? 'core' : key, sha, opts);
    printPlan(p);
    out(
      p.problems.length
        ? `\nVERDICT : BLOQUÉ — ${p.problems.join(' ; ')}`
        : '\nVERDICT : PRÊT',
    );
    if (p.problems.length) process.exitCode = 1;
    if (key === 'core+bot') {
      out('\n=== bot ===');
      if ((await planBotAfterCore(sha, opts)) !== 'PRÊT') process.exitCode = 1;
    }
  } else if (cmd === 'deploy' && key === 'core+bot') {
    out('=== 1/2 Core ===');
    const core = await deploy('core', sha, {
      ...opts,
      redeploy: opts.redeploy,
    }).catch((e) => {
      // A Core already on the target is fine for core+bot: only the bot remains.
      if (/déjà déployé/.test(e.message) && !/;/.test(e.message))
        return 'IDENTIQUE';
      throw e;
    });
    if (core !== 'DÉPLOYÉ' && core !== 'IDENTIQUE' && core !== 'PRÊT') {
      out(
        `\nVERDICT : ${core} — le bot n'est PAS déployé (le Core n'est pas sur ${sha.slice(0, 12)})`,
      );
      process.exitCode = 1;
    } else if (core === 'PRÊT') {
      out('\n=== 2/2 bot (plan, après le Core) ===');
      if ((await planBotAfterCore(sha, opts)) !== 'PRÊT') process.exitCode = 1;
    } else {
      out('\n=== 2/2 bot ===');
      await deploy('bot', sha, opts);
    }
  } else if (cmd === 'deploy') {
    const r = await deploy(key, sha, opts);
    if (!['DÉPLOYÉ', 'PRÊT'].includes(r)) process.exitCode = 1;
  } else {
    out(
      'usage : status <app> | plan <app> <sha> | deploy <app> <sha> [--go] [--rollback] [--migrations-approved | --migrations-preapplied] [--redeploy] [--auto-rollback] [--allow-single-live-source] [--skip-ci-gate]   (app : core | bot | core+bot | core-staging)',
    );
    process.exitCode = 2;
  }
} catch (e) {
  out(`\nVERDICT : ${e.verdict ?? 'ÉCHEC'} — ${redact(e.message)}`);
  journal({
    app: key,
    to: sha,
    result: e.verdict ?? 'ÉCHEC',
    problems: [redact(e.message)],
  });
  process.exitCode = 1;
}
