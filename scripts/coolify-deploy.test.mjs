// coolify-deploy.mjs against a fake Coolify (local HTTP) and a throwaway git repository with its origin:
//   node --test scripts/coolify-deploy.test.mjs
// Covers the migration guards (absent authorisation, pre-applied path, verifier refusing, token without
// « read:sensitive », refused permissions), the writes allowed (only the app's SHA and post-deployment command,
// restored), and the bot deployed only after the Core.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = fileURLToPath(new URL('./coolify-deploy.mjs', import.meta.url));
const CORE = '3m7cputub9wt7nwx2k78cme3';
const BOT = 'hdbljqmwoq5364w0ypqmz46p';
const DB = '4jaqdyvzlelgwkyvuxhjy4mr';
const tmp = mkdtempSync(join(tmpdir(), 'coolify-deploy-'));
const repo = join(tmp, 'repo');
const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const scopes = (files) =>
  `export const PROD_MIGRATIONS: readonly string[] = Object.freeze([\n${files.map((f) => `  '${f}',`).join('\n')}\n]);\n`;
let OLD;
let NEW;

// Fake Coolify: state per test, every request recorded.
let st;
const reset = () => {
  st = {
    calls: [],
    deny: new Set(), // "METHOD path-prefix" → 403
    logsHidden: true,
    verifierLine: null,
    truncate: false,
    backupAt: new Date().toISOString(),
    apps: {
      [CORE]: { uuid: CORE, name: 'raptoru-core', git_branch: 'main', git_commit_sha: OLD, status: 'running:healthy', post_deployment_command: null, current: OLD },
      [BOT]: { uuid: BOT, name: 'raptoru-bot', git_branch: 'main', git_commit_sha: OLD, status: 'running:healthy', post_deployment_command: null, current: OLD },
    },
    deps: {},
  };
};
const server = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace('/api/v1', '');
  st.calls.push({ method: req.method, path, body: body ? JSON.parse(body) : null });
  const send = (code, json) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  };
  if (path === '/health') return send(200, { status: 'ok' });
  if (req.headers.authorization !== 'Bearer test-token') return send(401, { message: 'Unauthenticated.' });
  for (const d of st.deny) {
    const [m, p] = d.split(' ');
    if (req.method === m && path.startsWith(p)) return send(403, { message: 'Missing ability' });
  }
  let m;
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
    return send(200, a);
  }
  if ((m = /^\/deployments\/applications\/(\w+)$/.exec(path))) {
    const a = st.apps[m[1]];
    return send(200, { count: 1, deployments: [{ deployment_uuid: `dep-${a.uuid}-old`, status: 'finished', commit: a.current }] });
  }
  if ((m = /^\/deployments\/([\w-]+)$/.exec(path))) {
    const d = st.deps[m[1]] ?? { deployment_uuid: m[1], status: 'finished', commit: OLD, logs: '[]' };
    const out = { ...d };
    if (st.logsHidden) delete out.logs;
    return send(200, out);
  }
  if (path === `/databases/${DB}/backups`)
    return send(200, [{ executions: [{ status: 'success', created_at: st.backupAt, size: 1 }] }]);
  if (path === '/deploy' && req.method === 'POST') {
    const { uuid } = JSON.parse(body);
    const a = st.apps[uuid];
    const id = `dep-${uuid}-new`;
    a.current = a.git_commit_sha;
    const logs = [{ output: 'Starting deployment' }];
    if (a.post_deployment_command) {
      logs.push({ command: a.post_deployment_command, hidden: true });
      if (st.verifierLine) logs.push({ output: st.verifierLine });
    }
    st.deps[id] = { deployment_uuid: id, status: 'finished', commit: a.git_commit_sha, logs: JSON.stringify(logs) };
    return send(200, { deployments: [{ deployment_uuid: id, resource_uuid: uuid }] });
  }
  send(404, { path });
});

let base;
function run(...args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: repo,
      env: {
        ...process.env,
        COOLIFY_URL: base,
        COOLIFY_TOKEN_FILE: join(tmp, 'token.txt'),
        COOLIFY_DEPLOY_JOURNAL: join(tmp, 'journal.log'),
        COOLIFY_HEALTH_URLS: `${base}/health`,
        COOLIFY_POLL_MS: '5',
        COOLIFY_HEALTH_TIMEOUT_MS: '200',
      },
    });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('close', (code) => resolve({ code, out }));
  });
}
const writes = () => st.calls.filter((c) => c.method !== 'GET');
const verdict = (out) => /VERDICT : (\S+)/.exec(out)?.[1];

before(async () => {
  mkdirSync(join(repo, 'apps/core-api/src/db'), { recursive: true });
  mkdirSync(join(repo, 'supabase/migrations'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(repo, 'supabase/migrations/a.sql'), 'create table a (x int);');
  writeFileSync(join(repo, 'apps/core-api/src/db/migration-scopes.ts'), scopes(['a.sql']));
  g('add', '-A');
  g('commit', '-qm', 'old');
  OLD = g('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'supabase/migrations/b.sql'), 'create table if not exists b (x int);');
  writeFileSync(join(repo, 'apps/core-api/src/db/migration-scopes.ts'), scopes(['a.sql', 'b.sql']));
  g('add', '-A');
  g('commit', '-qm', 'new');
  NEW = g('rev-parse', 'HEAD');
  execFileSync('git', ['init', '-q', '--bare', join(tmp, 'origin.git')]);
  g('remote', 'add', 'origin', join(tmp, 'origin.git'));
  g('push', '-q', 'origin', 'main');
  writeFileSync(join(tmp, 'token.txt'), 'test-token\n');
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
    const r = await run('deploy', 'core', NEW, '--migrations-preapplied', '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /preuve indispensable inaccessible.*champ logs masqué.*read:sensitive/s);
    assert.deepEqual(writes(), []);
  });

  it('deployment detail refused (403): BLOQUÉ, nothing written', async () => {
    st.logsHidden = false;
    st.deny.add(`GET /deployments/dep-${CORE}-old`);
    const r = await run('deploy', 'core', NEW, '--migrations-approved', '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /preuve indispensable inaccessible.*\(Coolify GET .*403/);
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
    const r = await run('deploy', 'core', NEW, '--migrations-preapplied', '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.match(r.out, /sauvegarde de la base trop ancienne/);
    assert.deepEqual(writes(), []);
  });

  it('both migration options: BLOQUÉ', async () => {
    st.logsHidden = false;
    const r = await run('deploy', 'core', NEW, '--migrations-approved', '--migrations-preapplied', '--go');
    assert.equal(verdict(r.out), 'BLOQUÉ');
    assert.deepEqual(writes(), []);
  });

  it('pre-applied, verifier OK: DÉPLOYÉ; only the SHA and the post-deployment command written, then restored', async () => {
    st.logsHidden = false;
    st.verifierLine = `RAPTORU-MIGRATIONS ${JSON.stringify({ ok: true, recorded: [], conforming: ['b.sql'], applied: ['b.sql'], problems: [] })}`;
    const dry = await run('deploy', 'core', NEW, '--migrations-preapplied');
    assert.equal(verdict(dry.out), 'PRÊT');
    assert.deepEqual(writes(), []);
    const r = await run('deploy', 'core', NEW, '--migrations-preapplied', '--go');
    assert.equal(verdict(r.out), 'DÉPLOYÉ', r.out);
    assert.match(r.out, /enregistrées par le migrateur : b\.sql/);
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
    assert.match(w[0].body.post_deployment_command, /^node --input-type=module -e '.*\["b\.sql"\]/);
    assert.equal(w[2].body.uuid, CORE);
    assert.equal(st.apps[CORE].post_deployment_command, null);
    assert.equal(st.apps[BOT].git_commit_sha, OLD);
    assert.ok(!st.calls.some((c) => /envs|restart|stop|start|databases\/.+\/(?!backups)/.test(c.path)));
  });

  it('pre-applied, verifier refuses (partial schema): ÉCHEC with its reasons, command restored', async () => {
    st.logsHidden = false;
    st.verifierLine = `RAPTORU-MIGRATIONS ${JSON.stringify({ ok: false, recorded: [], conforming: [], applied: [], problems: ['b.sql : b absent'] })}`;
    const r = await run('deploy', 'core', NEW, '--migrations-preapplied', '--go');
    assert.equal(verdict(r.out), 'ÉCHEC');
    assert.match(r.out, /NON conformes : b\.sql : b absent/);
    assert.match(r.out, /Retour : node scripts\/coolify-deploy\.mjs deploy core [0-9a-f]{40} --rollback --go/);
    assert.equal(st.apps[CORE].post_deployment_command, null);
  });

  it('pre-applied, verifier output missing from the log: ÉCHEC (nothing proven)', async () => {
    st.logsHidden = false;
    const r = await run('deploy', 'core', NEW, '--migrations-preapplied', '--go');
    assert.equal(verdict(r.out), 'ÉCHEC');
    assert.match(r.out, /résultat du vérificateur absent/);
  });

  it('Coolify cuts the command: BLOQUÉ before the SHA changes, command restored', async () => {
    st.logsHidden = false;
    st.truncate = true;
    const r = await run('deploy', 'core', NEW, '--migrations-preapplied', '--go');
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

  it('Core already on the target: deployed without any post-deployment command, Core untouched', async () => {
    st.apps[CORE].current = NEW;
    st.apps[CORE].git_commit_sha = NEW;
    const r = await run('deploy', 'bot', NEW, '--go');
    assert.equal(verdict(r.out), 'DÉPLOYÉ', r.out);
    assert.match(r.out, /celles du Core dans la plage \(b\.sql\)/);
    assert.deepEqual(
      writes().map((c) => `${c.method} ${c.path} ${Object.keys(c.body).join(',')}`),
      [`PATCH /applications/${BOT} git_commit_sha`, `POST /deploy uuid,force`],
    );
    assert.equal(writes()[1].body.uuid, BOT);
  });
});
