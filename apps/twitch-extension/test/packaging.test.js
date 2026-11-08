/* global URL */
import { Buffer } from 'node:buffer';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  checkInventory,
  packageExtension,
  parseArgs,
  parsePublished,
  productionGate,
  runtimeConfigSource,
  zipStored,
} from '../scripts/package.mjs';
import { ALLOWED_API_BASES, TARGETS } from '../scripts/targets.mjs';
import { TWITCH_HELPER, verifyZip } from '../scripts/verify-package.mjs';
import { createClient, errorLabel } from '../extension/shared/api.js';

// Lot 0 « emballage verrouillé » (docs/extension/PLAN_REFONTE_EXTENSION_2026-11-08.md § 9, § 12.1).
const APP = fileURLToPath(new URL('..', import.meta.url));
const HEAD = 'f'.repeat(40);
const PUBLISHED = '0bf7907' + '0'.repeat(33);
const GAP = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];

/** git injected: HEAD, a clean (or dirty) tree, three extension commits since PUBLISHED. */
const fakeGit =
  ({ dirty = '' } = {}) =>
  (...args) => {
    if (args[0] === 'status') return dirty;
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return HEAD;
    if (args[0] === 'rev-parse' && args[1] === '--verify') return PUBLISHED;
    if (args[0] === 'rev-list') return GAP.join('\n');
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

/** A fake app root with PUBLISHED and, optionally, the inventory of the gap. */
function fakeRoot(inventory) {
  const root = mkdtempSync(join(tmpdir(), 'raptoru-pkg-test-'));
  writeFileSync(join(root, 'PUBLISHED'), '# présumé, non prouvé\n0bf7907\n');
  if (inventory !== undefined) {
    mkdirSync(join(root, 'release-inventory'));
    writeFileSync(
      join(root, 'release-inventory', `INVENTAIRE-${'a'.repeat(12)}.md`),
      inventory,
    );
  }
  return root;
}
const production =
  (root, git = fakeGit()) =>
  () =>
    packageExtension({ target: 'production', root, git });

describe('targets and arguments', () => {
  it('refuses an unknown or missing target, and an unknown shell', () => {
    expect(() => parseArgs(['--target', 'qa'])).toThrow(/unknown target qa/);
    expect(() => parseArgs(['--target', 'constructor'])).toThrow(
      /unknown target/,
    );
    expect(() => parseArgs([])).toThrow(/unknown target/);
    expect(() => parseArgs(['--target=staging', '--shell', 'v3'])).toThrow(
      /unknown shell/,
    );
    expect(() => packageExtension({ target: 'dev', git: fakeGit() })).toThrow(
      /unknown target dev/,
    );
    expect(parseArgs(['--target=production', '--check'])).toEqual({
      target: 'production',
      shell: 'legacy',
      check: true,
    });
  });

  it('refuses a forged apiBase (legacy server) for any target', () => {
    for (const target of Object.values(TARGETS))
      expect(() =>
        runtimeConfigSource(
          { ...target, apiBase: 'https://raptoru.fr/api' },
          { buildId: 'x', shell: 'legacy' },
        ),
      ).toThrow(/refused apiBase/);
    const staging = runtimeConfigSource(TARGETS.staging, {
      buildId: 'b',
      shell: 'v2',
    });
    expect(staging).toContain(
      'apiBase: "https://core-staging.raptoru.fr/v1/ext"',
    );
    expect(staging).toContain('shell: "v2"');
  });

  it('one allowed list: the targets, plus the Lab prefix served by Studio', () => {
    expect([...ALLOWED_API_BASES].sort()).toEqual(
      [
        '/ext-lab/api',
        TARGETS.production.apiBase,
        TARGETS.staging.apiBase,
      ].sort(),
    );
    const serve = readFileSync(
      join(APP, '../studio/server/src/extension-lab/serve.ts'),
      'utf8',
    );
    expect(serve).toContain("LAB_API_PREFIX = '/ext-lab/api'");
  });

  it('PUBLISHED ignores comment lines', () => {
    expect(parsePublished('# présumé, non prouvé\n\n0bf7907\n')).toBe(
      '0bf7907',
    );
    expect(() => parsePublished('# nothing\n')).toThrow();
  });
});

describe('production guard (§ 12.1)', () => {
  const valid = `# Inventaire\n- aaaaaaa première\n- \`bbbbbbb\` deuxième\n| ccccccc | troisième |\n\nValidé par Antoni : oui\n`;

  it('refuses a modified tree', () => {
    expect(
      production(
        fakeRoot(valid),
        fakeGit({ dirty: ' M extension/overlay.js' }),
      ),
    ).toThrow(/uncommitted changes/);
  });

  it('refuses without an inventory, naming the expected file', () => {
    expect(production(fakeRoot())).toThrow(
      /INVENTAIRE-aaaaaaaaaaaa\.md is missing/,
    );
  });

  it('refuses an inventory with a missing or an extra commit, naming them', () => {
    expect(
      production(fakeRoot('- aaaaaaa\n- bbbbbbb\nValidé par Antoni : oui\n')),
    ).toThrow(/missing from the inventory: ccccccc/);
    expect(production(fakeRoot(`${valid}- ddddddd ajouté\n`))).toThrow(
      /not in the gap: ddddddd/,
    );
  });

  it('refuses an inventory without the exact validation line', () => {
    expect(production(fakeRoot(valid.replace(': oui', ': non')))).toThrow(
      /Validé par Antoni : oui/,
    );
    expect(
      checkInventory(valid.replace('Validé', '- Validé'), GAP).validated,
    ).toBe(false);
  });

  it('accepts the exact gap, in any order', () => {
    const gate = productionGate({ root: fakeRoot(valid), git: fakeGit() });
    expect(gate).toMatchObject({ ok: true, problems: [], commits: GAP });
    expect(
      checkInventory(
        '- ccccccc\n- aaaaaaa\n- bbbbbbb\nValidé par Antoni : oui',
        GAP,
      ).ok,
    ).toBe(true);
  });
});

describe('verify-package', () => {
  const page = (extra = '') =>
    `<!doctype html><head><script src="${TWITCH_HELPER}"></script>${extra}</head>`;
  const entries = (overrides = {}) => {
    const files = {
      'build-manifest.json': JSON.stringify({
        target: 'staging',
        commit: HEAD,
        dirty: false,
        apiBase: TARGETS.staging.apiBase,
      }),
      'shared/runtime-config.js': runtimeConfigSource(TARGETS.staging, {
        buildId: 'b',
        shell: 'legacy',
      }),
      'panel.html': page('<script type="module" src="mobile.js"></script>'),
      'mobile.html': page(),
      'video_component.html': page(),
      'config.html': page(),
      ...overrides,
    };
    return Object.entries(files).map(([name, text]) => ({
      name,
      data: Buffer.from(text),
    }));
  };

  it('a well-formed package passes', () => {
    expect(verifyZip(zipStored(entries())).errors).toEqual([]);
  });

  it('detects an inline script, a legacy URL, a mock, a missing page, a non-helper first script', () => {
    const { errors } = verifyZip(
      zipStored(
        entries({
          'config.html': page('<script>alert(1)</script>'),
          'shared/old.js': 'fetch("https://raptoru.fr/api/session")',
          'twitch-ext-mock.js': '',
          'video_component.html': '<script src="overlay.js"></script>',
        }).filter((e) => e.name !== 'mobile.html'),
      ),
    );
    expect(errors.join('\n')).toMatch(/inline script in config\.html/);
    expect(errors.join('\n')).toMatch(
      /legacy URL raptoru\.fr\/api in shared\/old\.js/,
    );
    expect(errors.join('\n')).toMatch(/forbidden file twitch-ext-mock\.js/);
    expect(errors.join('\n')).toMatch(/missing page mobile\.html/);
    expect(errors.join('\n')).toMatch(
      /video_component\.html: the first <script> is not the Twitch helper/,
    );
  });

  it('calibration: any Raptoru or local endpoint URL is refused, a bare hostname comparison is not', () => {
    const calibration = (extra) =>
      entries({
        'build-manifest.json': JSON.stringify({
          target: 'calibration',
          commit: HEAD,
          dirty: false,
          apiBase: '',
        }),
        'shared/runtime-config.js': runtimeConfigSource(TARGETS.calibration, {
          buildId: 'c',
          shell: 'legacy',
        }),
        'shared/x.js': extra,
      });
    expect(
      verifyZip(zipStored(calibration("host === '127.0.0.1'"))).errors,
    ).toEqual([]);
    for (const url of [
      'http://127.0.0.1:4100/v',
      '//localhost:3000',
      'https://core.raptoru.fr/v1/ext',
    ])
      expect(verifyZip(zipStored(calibration(url))).errors.join('\n')).toMatch(
        /calibration package/,
      );
  });

  it('detects an apiBase that is not the target one, and an unknown target', () => {
    const forged = entries({
      'shared/runtime-config.js':
        'export const RUNTIME = { mode: \'connected\', apiBase: "https://core.raptoru.fr/v1/ext" };',
    });
    expect(verifyZip(zipStored(forged)).errors.join('\n')).toMatch(
      /not the staging config/,
    );
    const unknown = entries({
      'build-manifest.json': JSON.stringify({
        target: 'toString',
        commit: HEAD,
        dirty: false,
      }),
    });
    expect(verifyZip(zipStored(unknown)).errors.join('\n')).toMatch(
      /unknown target toString/,
    );
  });

  it('refuses a Lab-only module or a runtime that allows them (extension/lab-modules)', () => {
    const lab = entries({ 'lab-modules/demo/module.js': 'export {};' });
    expect(verifyZip(zipStored(lab)).errors.join('\n')).toMatch(
      /forbidden file lab-modules\/demo\/module\.js/,
    );
    const allowing = entries({
      'shared/runtime-config.js': runtimeConfigSource(TARGETS.staging, {
        buildId: 'b',
        shell: 'v2',
      }).replace('});', '  labModules: true,\n});'),
    });
    expect(verifyZip(zipStored(allowing)).errors.join('\n')).toMatch(
      /not the staging config/,
    );
  });
});

describe('Lab-only modules never packaged', () => {
  it('every target drops extension/lab-modules (the real packager, on a copy of the pages)', () => {
    const root = fakeRoot();
    const ext = join(root, 'extension');
    const helper = `<!doctype html><head><script src="${TWITCH_HELPER}"></script><script type="module" src="app/boot.js"></script></head><body></body>`;
    mkdirSync(join(ext, 'shared'), { recursive: true });
    mkdirSync(join(ext, 'lab-modules', 'demo'), { recursive: true });
    for (const name of ['panel.html', 'mobile.html', 'video_component.html', 'config.html'])
      writeFileSync(join(ext, name), helper);
    writeFileSync(join(ext, 'shared', 'runtime-config.js'), 'export const RUNTIME = {};');
    writeFileSync(join(ext, 'lab-modules', 'demo', 'module.js'), 'export {};');
    for (const target of ['staging', 'production']) {
      const r = packageExtension({ target, shell: 'v2', check: true, root, git: fakeGit() });
      expect(r.fileCount).toBe(6); // 4 pages, runtime-config, build-manifest: no lab-modules
    }
  });

  it('the source runtime and the package runtimes never allow them', () => {
    const source = readFileSync(join(APP, 'extension', 'shared', 'runtime-config.js'), 'utf8');
    expect(source).not.toMatch(/labModules/);
    for (const target of Object.values(TARGETS))
      expect(runtimeConfigSource(target, { buildId: 'b', shell: 'v2' })).not.toMatch(/labModules/);
  });
});

describe('source and runtime guard', () => {
  it('no raptoru.fr/api anywhere under extension/', () => {
    const walk = (dir) =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const hits = walk(join(APP, 'extension'))
      .filter((f) => /\.(js|html|css|json|svg|md|txt)$/i.test(f))
      .filter((f) => /raptoru\.fr\/api/i.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('an unconfigured source or an unknown apiBase never reaches the network', async () => {
    const fetchImpl = vi.fn();
    for (const apiBase of [
      undefined,
      '',
      'https://raptoru.fr/api',
      'https://evil.example/v1/ext',
    ]) {
      const api = createClient({
        getToken: () => 'tok',
        apiBase,
        demoMode: false,
        fetchImpl,
      });
      await expect(api.session()).rejects.toMatchObject({
        code: 'unconfigured_build',
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(errorLabel('unconfigured_build')).toMatch(/^Version non configurée/);
  });
});
