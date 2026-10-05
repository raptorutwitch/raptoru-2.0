// ASTRA-P1-019 lot 2 — Studio profiles (D6: one app, Lab by default, Production explicit): boot plan,
// persistence, safe fallback, pairing view without secret, main-process-only switch, isolation of
// journals and players between the two profiles.
import { createServer, request, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every Studio path of this file (the Lab runtime's journal included) lives in a throw-away data root:
// the developer's real Lab runtime directory is never read nor written.
vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');
  process.env.RAPTORU_DATA_ROOT = mkdtempSync(
    j(tmpdir(), 'raptoru-profile-test-'),
  );
});
import { BonkRuntime } from '../src/bonk-lab/runtime.js';
import { BonkWorker, type CoreCall } from '../src/bonk-lab/worker.js';
import { loadOrCreateInstallation } from '../src/prod-transport/installation.js';
import {
  bootPlan,
  PRODUCTION_ENV,
  profileFiles,
  readProfileChoice,
  writeProfileChoice,
} from '../src/prod-transport/profile.js';
import {
  createProductionRuntimes,
  handleProfileApi,
  stateFromCode,
  type ProfileApiDeps,
} from '../src/prod-transport/production.js';
import { setup } from '../../../core-api/test/helpers.js';
import { paths } from '../src/test-lab/local-env.js';
import { certSha256, tempDir, type Cleanups } from './prod-fixture.js';

const cleanups: Cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const CA = join(
  import.meta.dirname,
  'fixtures',
  'tls',
  'localhost-test-only.crt',
);
const ORIGIN = 'https://127.0.0.1:4443';
const validEnv = {
  [PRODUCTION_ENV.url]: ORIGIN,
  [PRODUCTION_ENV.ca]: CA,
};
const MAIN = 'm'.repeat(64);

async function chooseProduction(dir: string) {
  await writeProfileChoice(profileFiles(dir).profile, 'production');
}

describe('Studio profile boot plan', () => {
  it('Lab by default: the Lab Core starts, no Production', async () => {
    const dir = await tempDir(cleanups);
    expect(await bootPlan(dir, validEnv)).toMatchObject({
      selected: 'lab',
      effective: 'lab',
      notice: null,
      startLabCore: true,
      production: null,
    });
  });

  it('Production chosen explicitly and valid: restored, never starts the Lab Core, identity bound to that Core', async () => {
    const dir = await tempDir(cleanups);
    await chooseProduction(dir);
    expect((await readProfileChoice(profileFiles(dir).profile)).choice).toBe(
      'production',
    );
    const plan = await bootPlan(dir, validEnv);
    expect(plan).toMatchObject({
      effective: 'production',
      startLabCore: false,
      notice: null,
    });
    expect(plan.production!.installation.binding).toEqual({
      coreOrigin: ORIGIN,
      caSha256: certSha256,
    });
    // Restarted: same identity.
    const again = await bootPlan(dir, validEnv);
    expect(again.production!.installation.installationId).toBe(
      plan.production!.installation.installationId,
    );
  });

  it.each([
    ['not configured', {}, /non configuré/],
    [
      'http://',
      { [PRODUCTION_ENV.url]: 'http://127.0.0.1:4443' },
      /HTTPS obligatoire/,
    ],
    ['invalid URL', { [PRODUCTION_ENV.url]: 'https://' }, /invalide/],
    ['a path', { [PRODUCTION_ENV.url]: `${ORIGIN}/api` }, /origine seule/],
    [
      'missing CA',
      { ...validEnv, [PRODUCTION_ENV.ca]: join(CA, 'nope.pem') },
      /illisible/,
    ],
    [
      'network CA path',
      { ...validEnv, [PRODUCTION_ENV.ca]: '\\\\server\\share\\ca.pem' },
      /chemin réseau/,
    ],
    [
      'not a PEM',
      {
        ...validEnv,
        [PRODUCTION_ENV.ca]: join(import.meta.dirname, 'prod-profile.test.ts'),
      },
      /PEM attendu/,
    ],
  ])(
    'invalid configuration (%s): Lab with the reason, no connection',
    async (_, env, reason) => {
      const dir = await tempDir(cleanups);
      await chooseProduction(dir);
      const plan = await bootPlan(dir, env);
      expect(plan).toMatchObject({
        selected: 'production',
        effective: 'lab',
        startLabCore: true,
        production: null,
      });
      expect(plan.notice).toMatch(reason);
      // No identity created for an unusable configuration.
      expect(await readdir(dir)).not.toContain('production');
    },
  );

  it('damaged choice file: Lab with the reason', async () => {
    const dir = await tempDir(cleanups);
    await writeFile(profileFiles(dir).profile, '{oops');
    expect(await bootPlan(dir, validEnv)).toMatchObject({
      effective: 'lab',
      notice: 'Choix de profil invalide : profil Lab',
    });
  });

  it('damaged identity: Lab with the reason, the file is never replaced', async () => {
    const dir = await tempDir(cleanups);
    await chooseProduction(dir);
    const files = profileFiles(dir);
    await mkdir(files.productionDir, { recursive: true });
    await writeFile(files.identity, '{"version":1}');
    const plan = await bootPlan(dir, validEnv);
    expect(plan.effective).toBe('lab');
    expect(plan.notice).toMatch(/Identité Studio illisible/);
    expect(await readFile(files.identity, 'utf8')).toBe('{"version":1}');
  });

  it('identity bound to another Core: Lab with the reason (the credential is never sent elsewhere)', async () => {
    const dir = await tempDir(cleanups);
    await chooseProduction(dir);
    await loadOrCreateInstallation(profileFiles(dir).identity, {
      coreOrigin: 'https://core.example',
      caSha256: null,
    });
    const plan = await bootPlan(dir, validEnv);
    expect(plan.effective).toBe('lab');
    expect(plan.notice).toMatch(/liée à un autre Core/);
  });

  it('state shown for each transport cause (never a generic network error)', () => {
    expect(
      Object.fromEntries(
        [
          null,
          'studio_unauthorized',
          'studio_revoked',
          'protocol_incompatible',
          'tls_rejected',
          'identity_mismatch',
          'core_unreachable',
          'redirect_refused',
        ].map((c) => [String(c), stateFromCode(c)]),
      ),
    ).toEqual({
      null: 'connected',
      studio_unauthorized: 'not_paired',
      studio_revoked: 'revoked',
      protocol_incompatible: 'update_required',
      tls_rejected: 'tls_invalid',
      identity_mismatch: 'identity_mismatch',
      core_unreachable: 'core_unreachable',
      redirect_refused: 'core_unreachable',
    });
  });
});

/** The profile API behind a real HTTP request (headers as the page / Electron main send them). */
async function api(deps: ProfileApiDeps) {
  const server = createServer(async (req: IncomingMessage, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const body = async () => {
      let raw = '';
      for await (const c of req) raw += String(c);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    };
    if (
      !(await handleProfileApi(
        req,
        new URL(req.url!, 'http://x'),
        body,
        reply,
        deps,
      ))
    )
      reply(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (path: string, body?: unknown, main: string | null = MAIN) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(main ? { 'x-raptoru-main': main } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
      body: (await res.json()) as Record<string, any>,
    };
  };
}

describe('profile API (pairing view, main-only switch)', () => {
  it('shows installation id and pairing code, never the secret; the code is not a credential', async () => {
    const dir = await tempDir(cleanups);
    await chooseProduction(dir);
    const plan = await bootPlan(dir, validEnv);
    const call = await api({
      plan,
      runtimeDir: dir,
      env: { ...validEnv, RAPTORU_MAIN_TOKEN: MAIN },
      link: null,
      busy: () => false,
    });
    const status = await call('/api/profile');
    const secret = JSON.parse(
      await readFile(profileFiles(dir).identity, 'utf8'),
    ).secret as string;
    expect(JSON.stringify(status.body)).not.toContain(secret);
    expect(status.body.production).toMatchObject({
      installation_id: plan.production!.installation.installationId,
      pairing_code: plan.production!.installation.pairingCode,
      core_origin: ORIGIN,
      custom_ca: true,
      state: 'connecting',
    });
    // The operator registers the code in Core, but it never authenticates.
    const core = await setup();
    await core.studioInstallations.register(
      status.body.production.pairing_code,
      'PC test',
    );
    const [id, digest] = String(status.body.production.pairing_code).split('.');
    await expect(
      core.studioInstallations.authenticate(`Bearer rsi_${id}.${digest}`),
    ).rejects.toThrow('studio_unauthorized');
  });

  it('switching is reserved to Electron main (token), refused while something executes, validated before saving', async () => {
    const dir = await tempDir(cleanups);
    const plan = await bootPlan(dir, validEnv);
    let busy = false;
    let stopped = 0;
    const deps = {
      plan,
      runtimeDir: dir,
      env: { ...validEnv, RAPTORU_MAIN_TOKEN: MAIN },
      link: null,
      busy: () => busy,
      stopWorkers: () => {
        stopped++;
      },
    };
    const call = await api(deps);
    for (const main of [null, 'x'.repeat(64)])
      expect(
        (await call('/api/profile/select', { profile: 'production' }, main))
          .status,
      ).toBe(403);
    busy = true;
    expect(
      (await call('/api/profile/select', { profile: 'production' })).body.error,
    ).toBe('execution_in_progress');
    busy = false;
    const bad = await api({
      ...deps,
      env: { [PRODUCTION_ENV.url]: 'http://x', RAPTORU_MAIN_TOKEN: MAIN },
    });
    expect(
      (await bad('/api/profile/select', { profile: 'production' })).body.error,
    ).toBe('https_required');
    expect((await readProfileChoice(profileFiles(dir).profile)).choice).toBe(
      'lab',
    ); // nothing saved
    expect(
      await call('/api/profile/select', { profile: 'production' }),
    ).toEqual({
      status: 200,
      body: { ok: true, profile: 'production', restart_required: true },
    });
    expect((await readProfileChoice(profileFiles(dir).profile)).choice).toBe(
      'production',
    );
    expect(stopped).toBe(1); // workers stopped: nothing claimed before the restart
    // Without an Electron main (no token in the environment), nothing can switch.
    const bare = await api({ ...deps, env: validEnv });
    expect(
      (await bare('/api/profile/select', { profile: 'lab' })).body.error,
    ).toBe('main_process_required');
  });

  it('regeneration: explicit, Lab profile only, the old identity and journals are archived (never deleted)', async () => {
    const dir = await tempDir(cleanups);
    await chooseProduction(dir);
    const prod = await bootPlan(dir, validEnv);
    const before = await readFile(profileFiles(dir).identity, 'utf8');
    const inProd = await api({
      plan: prod,
      runtimeDir: dir,
      env: { ...validEnv, RAPTORU_MAIN_TOKEN: MAIN },
      link: null,
      busy: () => false,
    });
    expect((await inProd('/api/profile/regenerate', {})).body.error).toBe(
      'lab_profile_required',
    );
    const labPlan = {
      ...prod,
      effective: 'lab' as const,
      production: null,
      startLabCore: true,
    };
    const inLab = await api({
      plan: labPlan,
      runtimeDir: dir,
      env: { ...validEnv, RAPTORU_MAIN_TOKEN: MAIN },
      link: null,
      busy: () => false,
    });
    const out = await inLab('/api/profile/regenerate', {});
    expect(out.body.archived).toMatch(/^production\.replaced-\d+$/);
    expect(
      await readFile(
        join(dir, out.body.archived, 'studio-installation.json'),
        'utf8',
      ),
    ).toBe(before);
    expect((await inLab('/api/profile')).body.production.identity).toBe('none');
    const next = await bootPlan(dir, validEnv); // profile reset to Lab by the regeneration
    expect(next.effective).toBe('lab');
  });
});

describe('isolation between Lab and Production', () => {
  const noCore: CoreCall = () =>
    Promise.reject(new Error('no core in this test'));

  it('a Lab worker never reads a Production journal; Production never adopts a Lab journal with pending work', async () => {
    const dir = await tempDir(cleanups);
    const files = profileFiles(dir);
    expect(files.journal('bonk')).not.toBe(
      join(dir, 'bonk-lab', 'journal.json'),
    );
    const studioId = '00000000-0000-4000-8000-000000000001';
    await BonkWorker.open(files.journal('bonk'), noCore, {
      base: '/v1/studio/bonk',
      studioId,
    });
    await expect(
      BonkWorker.open(files.journal('bonk'), noCore),
    ).rejects.toThrow('journal_profile_mismatch');
    // A Lab journal holding claimed work.
    const labJournal = join(dir, 'bonk-lab', 'journal.json');
    await mkdir(join(dir, 'bonk-lab'), { recursive: true });
    await writeFile(
      labJournal,
      JSON.stringify({
        studio: 'lab-random',
        session: 's',
        token: 't',
        entries: [{}],
      }),
    );
    await expect(
      BonkWorker.open(labJournal, noCore, {
        base: '/v1/studio/bonk',
        studioId,
      }),
    ).rejects.toThrow('journal_profile_mismatch');
  });

  it('players: a Lab player token never makes the Production runtime ready, and the reverse', async () => {
    const dir = await tempDir(cleanups);
    const origin = 'http://127.0.0.1:4100';
    await chooseProduction(dir);
    const plan = await bootPlan(dir, validEnv);
    const production = await createProductionRuntimes(
      origin,
      dir,
      plan.production!,
    );
    process.env.BONK_LAB_CORE_URL = 'http://127.0.0.1:1';
    process.env.BONK_LAB_SECRET = 'lab-secret';
    cleanups.push(async () => {
      delete process.env.BONK_LAB_CORE_URL;
      delete process.env.BONK_LAB_SECRET;
    });
    const lab = await BonkRuntime.create(origin); // Lab journal under the throw-away data root
    expect(paths.runtimeDir.startsWith(process.env.RAPTORU_DATA_ROOT!)).toBe(
      true,
    );
    expect(production.bonk.production).toBe(true);
    expect(lab.production).toBe(false);
    expect(production.bonk.worker.token).not.toBe(lab.worker.token);
    const heartbeat = async (runtime: BonkRuntime, token: string) => {
      const server = createServer(
        (req, res) => void runtime.handle(req, res, new URL(req.url!, origin)),
      );
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as AddressInfo).port;
      // node:http, not fetch: fetch never sends a custom Host header (the runtime checks it).
      const out = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port,
              path: '/bonk-lab/renderer/heartbeat',
              method: 'POST',
              headers: {
                host: '127.0.0.1:4100',
                'x-bonk-token': token,
                'content-type': 'application/json',
              },
            },
            (res) => {
              let raw = '';
              res.on('data', (c) => (raw += String(c)));
              res.on('end', () =>
                resolve({ status: res.statusCode!, body: raw }),
              );
            },
          );
          req.on('error', reject);
          req.end(JSON.stringify({ renderer: 'renderer-x' }));
        },
      );
      await new Promise((r) => server.close(r));
      return out;
    };
    expect(await heartbeat(production.bonk, lab.worker.token)).toEqual({
      status: 403,
      body: '{"error":"forbidden"}',
    });
    expect(await heartbeat(lab, production.bonk.worker.token)).toEqual({
      status: 403,
      body: '{"error":"forbidden"}',
    });
    production.bonk.worker.setObs(true, true);
    expect(production.bonk.worker.ready).toBe(false); // the Lab overlay did not count
    // Its own token is accepted (the 403 above is the token, not the request shape).
    expect(
      (await heartbeat(production.bonk, production.bonk.worker.token)).status,
    ).toBe(200);
    expect(production.bonk.worker.ready).toBe(true);
    for (const r of [production.bonk, production.sound, production.tts, lab])
      r.stop();
  });
});
