// coolify-deploy.mjs against fakes — Coolify, the Core's GET /v1/ops/status and the GitHub Actions API (local HTTP)
// — and a throwaway git repository with its origin:
//   node --test scripts/coolify-deploy.test.mjs
// Covers: the migration guards (absent authorisation, pre-applied path, verifier refusing, token without
// « read:sensitive », refused permissions); the writes allowed (only the app's SHA and post-deployment command,
// restored); the bot only after the Core; the CI gate (no run, failed run, documentation-only commit, rollback to a
// commit already in Production); the live guard (live, a single source, Twitch unknown, live appearing right before the
// write, between the Core and the bot); a wrong SHA; a deployment already running; missing variables; Coolify over
// HTTP from GitHub Actions; the verification after the deployment (health, the Core's commit, the bot's lease and
// Twitch health, a fatal log line) and the automatic rollback (only without migration); no secret ever printed.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = fileURLToPath(new URL('./coolify-deploy.mjs', import.meta.url));
const CORE = '3m7cputub9wt7nwx2k78cme3';
const BOT = 'hdbljqmwoq5364w0ypqmz46p';
const DB = '4jaqdyvzlelgwkyvuxhjy4mr';
const COOLIFY_TOKEN = 'test-token-coolify-0123456789';
const OPS_TOKEN = 'test-token-ops-0123456789abcdef';
const GH_TOKEN = 'test-token-github-0123456789';
const tmp = mkdtempSync(join(tmpdir(), 'coolify-deploy-'));
const repo = join(tmp, 'repo');
const g = (...a) =>
  execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const scopes = (files) =>
  `export const PROD_MIGRATIONS: readonly string[] = Object.freeze([\n${files.map((f) => `  '${f}',`).join('\n')}\n]);\n`;
// OLD → NEW (adds migration b.sql) → CODE (code only) → DOCS (documentation only) → UNPROVEN (code, no CI).
let OLD, NEW, CODE, DOCS, UNPROVEN;
// As GitHub names them: the matrix job « images » appears once per application.
const ALL_JOBS = [
  'quality',
  'core',
  'e2e',
  'images (core-api)',
  'images (twitch-bot)',
  'bot',
  'verdict',
];
const REQUIRED_ENVS = {
  [CORE]: [
    'DATABASE_URL',
    'BOT_SECRET',
    'STUDIO_SECRET',
    'TWITCH_CHANNEL_ID',
    'OPS_TOKEN',
  ],
  [BOT]: [
    'CORE_API_URL',
    'BOT_SECRET',
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'TWITCH_BROADCASTER_ID',
  ],
};

// Fakes: state per test, every request recorded.
let st;
const reset = () => {
  st = {
    calls: [],
    deny: new Set(), // "METHOD path-prefix" → 403
    logsHidden: true,
    verifierLine: null,
    truncate: false,
    backupAt: new Date().toISOString(),
    healthy: true,
    busy: false,
    live: { session: false, helix: false },
    // ops/status answers live from this call number on (live appearing during the run).
    liveFromCall: null,
    opsCalls: 0,
    opsDown: false,
    coreCommit: null, // override of the commit the Core reports
    botHealth: {
      eventSubBot: true,
      eventSubBroadcaster: true,
      broadcasterToken: true,
    },
    runtimeLogs: '[core-api] listening on :3000',
    envs: JSON.parse(JSON.stringify(REQUIRED_ENVS)),
    // CI runs per sha: { conclusion, jobs: { name: conclusion } }.
    ci: {},
    apps: {
      [CORE]: {
        uuid: CORE,
        name: 'raptoru-core',
        git_branch: 'main',
        git_commit_sha: OLD,
        status: 'running:healthy',
        post_deployment_command: null,
        current: OLD,
        history: [],
      },
      [BOT]: {
        uuid: BOT,
        name: 'raptoru-bot',
        git_branch: 'main',
        git_commit_sha: OLD,
        status: 'running:healthy',
        post_deployment_command: null,
        current: OLD,
        history: [],
      },
    },
    deps: {},
  };
  for (const sha of [OLD, NEW, CODE])
    st.ci[sha] = {
      conclusion: 'success',
      jobs: Object.fromEntries(ALL_JOBS.map((j) => [j, 'success'])),
    };
  // A documentation-only push: the CI succeeded but skipped every component job.
  st.ci[DOCS] = {
    conclusion: 'success',
    jobs: {
      quality: 'success',
      core: 'skipped',
      e2e: 'skipped',
      'images (core-api)': 'skipped',
      'images (twitch-bot)': 'skipped',
      bot: 'skipped',
      verdict: 'success',
    },
  };
};
const server = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace('/api/v1', '');
  st.calls.push({
    method: req.method,
    path,
    body: body ? JSON.parse(body) : null,
  });
  const send = (code, j) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(j));
  };
  if (path === '/health')
    return send(st.healthy ? 200 : 503, {
      status: st.healthy ? 'ok' : 'error',
    });
  if (path === '/ops/status') {
    if (req.headers.authorization !== `Bearer ${OPS_TOKEN}`)
      return send(401, { error: 'unauthorized' });
    if (st.opsDown) return send(503, {});
    st.opsCalls += 1;
    const live =
      st.liveFromCall !== null && st.opsCalls >= st.liveFromCall
        ? { session: true, helix: true }
        : st.live;
    const bot = st.apps[BOT];
    return send(200, {
      service: 'core-api',
      commit: st.coreCommit ?? st.apps[CORE].current,
      now: new Date().toISOString(),
      live: {
        session: { live: live.session },
        helix:
          live.helix === null
            ? { live: null, error: 'twitch_streams_503' }
            : { live: live.helix },
      },
      bot: {
        state: 'active',
        version: bot.current.slice(0, 12),
        last_seen_at: new Date().toISOString(),
        health: st.botHealth,
        standby: 0,
      },
      migrations: [],
    });
  }
  if (path.startsWith('/gh/')) {
    if (req.headers.authorization !== `Bearer ${GH_TOKEN}`)
      return send(401, {});
    if (/\/actions\/workflows\/ci\.yml\/runs$/.test(path)) {
      const sha = url.searchParams.get('head_sha');
      const r = st.ci[sha];
      return send(200, {
        workflow_runs: r
          ? [
              {
                id: sha,
                status: 'completed',
                conclusion: r.conclusion,
                created_at: '2026-10-25T00:00:00Z',
                html_url: `https://ci/${sha.slice(0, 7)}`,
              },
            ]
          : [],
      });
    }
    const m = /\/actions\/runs\/(\w+)\/jobs$/.exec(path);
    if (m)
      return send(200, {
        jobs: Object.entries(st.ci[m[1]].jobs).map(([name, conclusion]) => ({
          name,
          conclusion,
        })),
      });
    return send(404, {});
  }
  if (req.headers.authorization !== `Bearer ${COOLIFY_TOKEN}`)
    return send(401, { message: 'Unauthenticated.' });
  for (const d of st.deny) {
    const [mm, p] = d.split(' ');
    if (req.method === mm && path.startsWith(p))
      return send(403, { message: 'Missing ability' });
  }
  let m;
  if ((m = /^\/applications\/(\w+)\/envs$/.exec(path)))
    return send(
      200,
      (st.envs[m[1]] ?? []).map((key) => ({
        key,
        value: 'secret-value-never-read',
        is_preview: false,
      })),
    );
  if (/^\/applications\/\w+\/logs$/.test(path))
    return send(200, { logs: st.runtimeLogs });
  if ((m = /^\/applications\/(\w+)$/.exec(path))) {
    const a = st.apps[m[1]];
    if (!a) return send(404, {});
    if (req.method === 'PATCH') {
      const b = JSON.parse(body);
      if (st.truncate && b.post_deployment_command)
        b.post_deployment_command = b.post_deployment_command.slice(0, 255);
      Object.assign(a, b);
      return send(200, { uuid: a.uuid });
    }
    const view = { ...a };
    delete view.history;
    delete view.current;
    return send(200, view);
  }
  if ((m = /^\/deployments\/applications\/(\w+)$/.exec(path))) {
    const a = st.apps[m[1]];
    const list = [
      ...(st.busy
        ? [
            {
              deployment_uuid: 'dep-busy',
              status: 'in_progress',
              commit: a.current,
            },
          ]
        : []),
      {
        deployment_uuid: `dep-${a.uuid}-current`,
        status: 'finished',
        commit: a.current,
      },
      ...a.history.map((c, i) => ({
        deployment_uuid: `dep-${a.uuid}-h${i}`,
        status: 'finished',
        commit: c,
      })),
    ];
    return send(200, { count: list.length, deployments: list });
  }
  if ((m = /^\/deployments\/([\w-]+)$/.exec(path))) {
    const d = st.deps[m[1]] ?? {
      deployment_uuid: m[1],
      status: 'finished',
      commit: OLD,
      logs: '[]',
    };
    const o = { ...d };
    if (st.logsHidden) delete o.logs;
    return send(200, o);
  }
  if (path === `/databases/${DB}/backups`)
    return send(200, [
      {
        executions: [{ status: 'success', created_at: st.backupAt, size: 1 }],
      },
    ]);
  if (path === '/deploy' && req.method === 'POST') {
    const { uuid } = JSON.parse(body);
    const a = st.apps[uuid];
    const id = `dep-${uuid}-${st.calls.length}`;
    a.history.unshift(a.current);
    a.current = a.git_commit_sha;
    const logs = [{ output: 'Starting deployment' }];
    if (a.post_deployment_command) {
      logs.push({ command: a.post_deployment_command, hidden: true });
      if (st.verifierLine) logs.push({ output: st.verifierLine });
    }
    st.deps[id] = {
      deployment_uuid: id,
      status: 'finished',
      commit: a.git_commit_sha,
      logs: JSON.stringify(logs),
    };
    return send(200, {
      deployments: [{ deployment_uuid: id, resource_uuid: uuid }],
    });
  }
  send(404, { path });
});

let base;
function run(...args) {
  const extra = typeof args.at(-1) === 'object' ? args.pop() : {};
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: repo,
      env: {
        ...process.env,
        GITHUB_ACTIONS: '',
        COOLIFY_URL: base,
        COOLIFY_TOKEN: '',
        COOLIFY_TOKEN_FILE: join(tmp, 'token.txt'),
        COOLIFY_DEPLOY_JOURNAL: join(tmp, 'journal.log'),
        COOLIFY_HEALTH_URLS: `${base}/health`,
        COOLIFY_POLL_MS: '5',
        COOLIFY_HEALTH_TIMEOUT_MS: '200',
        BOT_VERIFY_TIMEOUT_MS: '200',
        OPS_URL: `${base}/ops/status`,
        OPS_TOKEN,
        TWITCH_CLIENT_ID: '',
        OBS_WS_URL: '',
        GITHUB_API_URL: `${base}/gh`,
        GITHUB_TOKEN: GH_TOKEN,
        GITHUB_REPOSITORY: 'owner/repo',
        ...extra,
      },
    });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('close', (code) => resolve({ code, out }));
  });
}
const writes = () => st.calls.filter((c) => c.method !== 'GET');
const deploys = () => st.calls.filter((c) => c.path === '/deploy');
const verdict = (out) => /VERDICT : (\S+)/.exec(out)?.[1];
const commit = (msg, files) => {
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(join(repo, f, '..'), { recursive: true });
    writeFileSync(join(repo, f), t);
  }
  g('add', '-A');
  g('commit', '-qm', msg);
  return g('rev-parse', 'HEAD');
};
const at = (uuid, sha) => {
  st.apps[uuid].current = sha;
  st.apps[uuid].git_commit_sha = sha;
};

before(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  OLD = commit('old', {
    'supabase/migrations/a.sql': 'create table a (x int);',
    'apps/core-api/src/db/migration-scopes.ts': scopes(['a.sql']),
  });
  NEW = commit('new', {
    'supabase/migrations/b.sql': 'create table if not exists b (x int);',
    'apps/core-api/src/db/migration-scopes.ts': scopes(['a.sql', 'b.sql']),
  });
  CODE = commit('code', { 'apps/core-api/src/x.ts': 'export const x = 1;\n' });
  DOCS = commit('docs', { 'docs/NOTE.md': '# note\n' });
  UNPROVEN = commit('unproven', {
    'apps/core-api/src/x.ts': 'export const x = 2;\n',
  });
  execFileSync('git', ['init', '-q', '--bare', join(tmp, 'origin.git')]);
  g('remote', 'add', 'origin', join(tmp, 'origin.git'));
  g('push', '-q', 'origin', 'main');
  writeFileSync(join(tmp, 'token.txt'), `${COOLIFY_TOKEN}\n`);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(reset);

describe('Core with a migration in the range', () => {
  it('no authorisation: BLOQUÉ, nothing written', async () => {
    const r = await run('deploy', 'core', NEW, '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /b\.sql — autorisation spécifique requise/);
    assert.deepEqual(writes(), []);
  });

  it('token without read:sensitive (logs hidden): BLOQUÉ with the exact missing proof, nothing written', async () => {
    const r = await run(
      'deploy',
      'core',
      NEW,
      '--migrations-preapplied',
      '--go',
    );
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(
      r.out,
      /preuve indispensable inaccessible.*champ logs masqué.*read:sensitive/s,
    );
    assert.deepEqual(writes(), []);
  });

  it('deployment detail refused (403): BLOQUÉ, nothing written', async () => {
    st.logsHidden = false;
    st.deny.add(`GET /deployments/dep-${CORE}-current`);
    const r = await run('deploy', 'core', NEW, '--migrations-approved', '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(
      r.out,
      /preuve indispensable inaccessible.*\(Coolify GET .*403/,
    );
    assert.deepEqual(writes(), []);
  });

  it('API permission refused on the application: BLOQUÉ', async () => {
    st.deny.add(`GET /applications/${CORE}`);
    const r = await run('plan', 'core', NEW);
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /403/);
    assert.deepEqual(writes(), []);
  });

  it('backup older than 60 min: BLOQUÉ even when pre-applied', async () => {
    st.logsHidden = false;
    st.backupAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    const r = await run(
      'deploy',
      'core',
      NEW,
      '--migrations-preapplied',
      '--go',
    );
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /sauvegarde de la base trop ancienne/);
    assert.deepEqual(writes(), []);
  });

  it('both migration options: BLOQUÉ', async () => {
    st.logsHidden = false;
    const r = await run(
      'deploy',
      'core',
      NEW,
      '--migrations-approved',
      '--migrations-preapplied',
      '--go',
    );
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.deepEqual(writes(), []);
  });

  it('pre-applied, verifier OK: DÉPLOYÉ; only the SHA and the post-deployment command written, then restored', async () => {
    st.logsHidden = false;
    st.verifierLine = `RAPTORU-MIGRATIONS ${JSON.stringify({ ok: true, recorded: [], conforming: ['b.sql'], applied: ['b.sql'], problems: [] })}`;
    const dry = await run('deploy', 'core', NEW, '--migrations-preapplied');
    assert.equal(verdict(dry.out), 'PRÊT');
    assert.deepEqual(writes(), []);
    const r = await run(
      'deploy',
      'core',
      NEW,
      '--migrations-preapplied',
      '--go',
    );
    assert.equal(verdict(r.out), 'DÉPLOYÉ', r.out);
    assert.match(r.out, /enregistrées par le migrateur : b\.sql/);
    assert.match(r.out, /le Core rapporte [0-9a-f]{12}/);
    const w = writes();
    assert.deepEqual(
      w.map((c) => `${c.method} ${c.path} ${Object.keys(c.body).join(',')}`),
      [
        `PATCH /applications/${CORE} post_deployment_command`,
        `PATCH /applications/${CORE} git_commit_sha`,
        `POST /deploy uuid,force`,
        `PATCH /applications/${CORE} post_deployment_command`,
      ],
    );
    assert.match(
      w[0].body.post_deployment_command,
      /^node --input-type=module -e '.*\["b\.sql"\]/,
    );
    assert.equal(w[2].body.uuid, CORE);
    assert.equal(st.apps[CORE].post_deployment_command, null);
    assert.equal(st.apps[BOT].git_commit_sha, OLD);
    assert.ok(!w.some((c) => /envs|restart|stop|start|databases/.test(c.path)));
  });

  it('pre-applied, verifier refuses (partial schema): ÉCHEC with its reasons, command restored, no automatic rollback', async () => {
    st.logsHidden = false;
    st.verifierLine = `RAPTORU-MIGRATIONS ${JSON.stringify({ ok: false, recorded: [], conforming: [], applied: [], problems: ['b.sql : b absent'] })}`;
    const r = await run(
      'deploy',
      'core',
      NEW,
      '--migrations-preapplied',
      '--auto-rollback',
      '--go',
    );
    assert.equal(verdict(r.out), 'ÉCHEC');
    assert.match(r.out, /NON conformes : b\.sql : b absent/);
    assert.match(
      r.out,
      /Retour : node scripts\/coolify-deploy\.mjs deploy core [0-9a-f]{40} --rollback --go/,
    );
    assert.match(
      r.out,
      /Retour arrière automatique NON lancé : la plage contient des migrations/,
    );
    assert.equal(deploys().length, 1);
    assert.equal(st.apps[CORE].post_deployment_command, null);
  });

  it('pre-applied, verifier output missing from the log: ÉCHEC (nothing proven)', async () => {
    st.logsHidden = false;
    const r = await run(
      'deploy',
      'core',
      NEW,
      '--migrations-preapplied',
      '--go',
    );
    assert.equal(verdict(r.out), 'ÉCHEC');
    assert.match(r.out, /résultat du vérificateur absent/);
  });

  it('Coolify cuts the command: BLOQUÉ before the SHA changes, command restored', async () => {
    st.logsHidden = false;
    st.truncate = true;
    const r = await run(
      'deploy',
      'core',
      NEW,
      '--migrations-preapplied',
      '--go',
    );
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /non enregistrée telle quelle/);
    assert.equal(st.apps[CORE].git_commit_sha, OLD);
    assert.ok(!st.calls.some((c) => c.path === '/deploy'));
    assert.equal(st.apps[CORE].post_deployment_command, null);
  });
});

describe('bot', () => {
  it('Core not yet on the target: BLOQUÉ, nothing written', async () => {
    const r = await run('deploy', 'bot', NEW, '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /raptoru-core doit d'abord tourner sur/);
    assert.deepEqual(writes(), []);
  });

  it('Core already on the target: deployed without any post-deployment command, Core untouched; lease and Twitch health checked', async () => {
    at(CORE, NEW);
    const r = await run('deploy', 'bot', NEW, '--go');
    assert.equal(verdict(r.out), 'DÉPLOYÉ', r.out);
    assert.match(r.out, /celles du Core dans la plage \(b\.sql\)/);
    assert.match(r.out, /bot actif en [0-9a-f]{12} : EventSub bot true/);
    assert.deepEqual(
      writes().map(
        (c) => `${c.method} ${c.path} ${Object.keys(c.body).join(',')}`,
      ),
      [`PATCH /applications/${BOT} git_commit_sha`, `POST /deploy uuid,force`],
    );
    assert.equal(writes()[1].body.uuid, BOT);
  });

  it('EventSub down after the deployment: ÉCHEC', async () => {
    at(CORE, NEW);
    st.botHealth = {
      eventSubBot: true,
      eventSubBroadcaster: false,
      broadcasterToken: true,
    };
    const r = await run('deploy', 'bot', NEW, '--go');
    assert.equal(verdict(r.out), 'ÉCHEC');
    assert.match(r.out, /bot non confirmé.*eventSubBroadcaster":false/);
  });
});

describe('CI gate', () => {
  it('a commit without CI run on main: BLOQUÉ, nothing written', async () => {
    at(CORE, CODE);
    const r = await run('deploy', 'core', UNPROVEN, '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(
      r.out,
      /CI : aucune CI complète sur [0-9a-f]{12} et du code a changé/,
    );
    assert.deepEqual(writes(), []);
  });

  it('a failed CI run: BLOQUÉ', async () => {
    at(CORE, NEW);
    st.ci[CODE] = {
      conclusion: 'failure',
      jobs: { quality: 'success', core: 'failure' },
    };
    const r = await run('plan', 'core', CODE);
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /CI : CI de [0-9a-f]{12}/);
  });

  it('one variant of a matrix job failed (the bot image): BLOQUÉ', async () => {
    at(CORE, NEW);
    st.ci[CODE].jobs['images (twitch-bot)'] = 'failure';
    const r = await run('plan', 'core', CODE);
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /CI : .*images/);
  });

  it('a documentation-only commit on top of a proven one: accepted (dry-run PRÊT)', async () => {
    at(CORE, NEW);
    const r = await run('deploy', 'core', DOCS);
    assert.equal(verdict(r.out), 'PRÊT', r.out);
    assert.match(r.out, /ne change que de la documentation depuis/);
  });

  it('a rollback to a commit already run in Production needs no CI (its provenance is Coolify’s history)', async () => {
    at(CORE, CODE);
    st.apps[CORE].history = [OLD];
    st.ci = {};
    const r = await run('deploy', 'core', OLD, '--rollback');
    assert.equal(verdict(r.out), 'PRÊT', r.out);
    assert.match(r.out, /a déjà tourné en Production/);
  });

  it('--skip-ci-gate is refused in GitHub Actions', async () => {
    at(CORE, NEW);
    const r = await run('plan', 'core', CODE, '--skip-ci-gate', {
      GITHUB_ACTIONS: 'true',
      COOLIFY_ALLOW_INSECURE_HTTP: 'true',
    });
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /--skip-ci-gate est refusé dans GitHub Actions/);
  });
});

describe('live guard', () => {
  it('live (EventSub session): BLOQUÉ, nothing written', async () => {
    at(CORE, NEW);
    st.live = { session: true, helix: false };
    const r = await run('deploy', 'core', CODE, '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /live : LIVE — en live selon core-session/);
    assert.deepEqual(writes(), []);
  });

  it('Twitch unknown (Helix 503) and one offline source: BLOQUÉ; accepted only with the explicit arbitration', async () => {
    at(CORE, NEW);
    st.live = { session: false, helix: null };
    const r = await run('deploy', 'core', CODE, '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /UNKNOWN — une seule source sûre \(core-session\)/);
    assert.deepEqual(writes(), []);
    const ok = await run(
      'deploy',
      'core',
      CODE,
      '--go',
      '--allow-single-live-source',
    );
    assert.equal(verdict(ok.out), 'DÉPLOYÉ', ok.out);
  });

  it('the Core unreachable: every source unknown, BLOQUÉ even with the arbitration', async () => {
    at(CORE, NEW);
    st.opsDown = true;
    const r = await run(
      'deploy',
      'core',
      CODE,
      '--go',
      '--allow-single-live-source',
    );
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /aucune source ne confirme le hors-live/);
    assert.deepEqual(writes(), []);
  });

  it('live starting between the plan and the first write: BLOQUÉ, nothing written', async () => {
    at(CORE, NEW);
    st.liveFromCall = 2; // the plan's check sees offline, the check right before writing sees live
    const r = await run('deploy', 'core', CODE, '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /live juste avant d'écrire : LIVE/);
    assert.deepEqual(writes(), []);
  });

  it('core+bot: live starting after the Core: the Core deployed, the bot NOT', async () => {
    at(CORE, NEW);
    at(BOT, NEW);
    st.liveFromCall = 4; // plan, pre-write and post-deployment checks of the Core offline; the bot's plan sees live
    const r = await run('deploy', 'core+bot', CODE, '--go');
    assert.match(r.out, /=== 2\/2 bot ===/);
    assert.equal(st.apps[CORE].current, CODE);
    assert.equal(st.apps[BOT].current, NEW);
    assert.match(r.out, /live : LIVE/);
    assert.equal(deploys().length, 1);
  });

  it('core+bot offline: the Core, then the bot, each verified', async () => {
    at(CORE, NEW);
    at(BOT, NEW);
    const r = await run('deploy', 'core+bot', CODE, '--go');
    assert.equal(st.apps[CORE].current, CODE);
    assert.equal(st.apps[BOT].current, CODE);
    assert.deepEqual(
      deploys().map((c) => c.body.uuid),
      [CORE, BOT],
    );
    assert.equal((r.out.match(/VERDICT : DÉPLOYÉ/g) ?? []).length, 2, r.out);
  });
});

describe('preconditions and verification', () => {
  it('a wrong SHA (short, or not on origin/main): BLOQUÉ', async () => {
    assert.match(
      (await run('plan', 'core', CODE.slice(0, 12))).out,
      /SHA attendu : 40 caractères/,
    );
    assert.match(
      (await run('plan', 'core', 'f'.repeat(40))).out,
      /commit f{40} est inconnu/,
    );
  });

  it('a deployment already running: BLOQUÉ', async () => {
    at(CORE, NEW);
    st.busy = true;
    const r = await run('deploy', 'core', CODE, '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /un déploiement est déjà en cours : dep-busy/);
    assert.deepEqual(writes(), []);
  });

  it('a required variable missing in Coolify: BLOQUÉ (names only)', async () => {
    at(CORE, NEW);
    st.envs[CORE] = st.envs[CORE].filter((k) => k !== 'STUDIO_SECRET');
    const r = await run('plan', 'core', CODE);
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(
      r.out,
      /variable\(s\) requise\(s\) absente\(s\) dans Coolify : STUDIO_SECRET/,
    );
    assert.doesNotMatch(r.out, /secret-value-never-read/);
  });

  it('Coolify over plain HTTP from GitHub Actions: BLOQUÉ before any call carrying the token', async () => {
    const r = await run('plan', 'core', CODE, { GITHUB_ACTIONS: 'true' });
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /HTTP non chiffré/);
    assert.ok(!st.calls.some((c) => c.path.startsWith('/applications')));
  });

  it('health KO after the deployment, no migration: ÉCHEC then automatic rollback to the previous commit', async () => {
    at(CORE, NEW);
    st.healthy = false;
    const first = run('deploy', 'core', CODE, '--go', '--auto-rollback');
    // The rollback deployment comes back healthy.
    const timer = setInterval(() => {
      if (deploys().length === 1 && st.apps[CORE].current === CODE)
        st.healthy = deploys().length > 1;
      if (deploys().length > 1) st.healthy = true;
    }, 1);
    const r = await first;
    clearInterval(timer);
    assert.match(r.out, /Problèmes :/);
    assert.match(r.out, /Retour arrière automatique vers [0-9a-f]{12}/);
    assert.deepEqual(
      deploys().map((c) => c.body.uuid),
      [CORE, CORE],
    );
    assert.equal(st.apps[CORE].current, NEW);
    assert.match(r.out, /Retour arrière : effectué/);
  });

  it('the Core reports another commit, or a fatal line in the startup logs: ÉCHEC', async () => {
    at(CORE, NEW);
    st.coreCommit = NEW;
    const r = await run('deploy', 'core', CODE, '--go');
    assert.equal(verdict(r.out), 'ÉCHEC');
    assert.match(r.out, /le Core rapporte le commit [0-9a-f]{40} ≠/);
    reset();
    at(CORE, NEW);
    st.runtimeLogs =
      '[core-api] listening on :3000\nError: connect ECONNREFUSED 10.0.0.2:5432';
    const r2 = await run('deploy', 'core', CODE, '--go');
    assert.equal(verdict(r2.out), 'ÉCHEC');
    assert.match(r2.out, /ligne\(s\) fatale\(s\) au démarrage/);
  });

  it('no token ever printed', async () => {
    at(CORE, NEW);
    st.runtimeLogs = `[core-api] listening\nERROR leaked ${COOLIFY_TOKEN} and ${OPS_TOKEN}`;
    const r = await run('deploy', 'core', CODE, '--go');
    for (const t of [COOLIFY_TOKEN, OPS_TOKEN, GH_TOKEN])
      assert.ok(!r.out.includes(t), t);
  });
});
