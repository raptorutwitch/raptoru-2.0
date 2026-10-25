// node --test scripts/ci/changes.test.mjs — the CI's job selection.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, PARTS } from './changes.mjs';

const BASE = 'a'.repeat(40);
const on = (d) => PARTS.filter((p) => d[p]);
const pr = (...files) => classify(files, { event: 'pull_request', base: BASE });

describe('CI change detection', () => {
  it('a pull request runs the parts it touches, and what depends on them', () => {
    assert.deepEqual(on(pr('apps/core-api/src/app.ts')), [
      'code',
      'core',
      'e2e',
      'images',
    ]);
    assert.deepEqual(on(pr('supabase/migrations/x.sql')), [
      'code',
      'core',
      'e2e',
      'images',
    ]);
    assert.deepEqual(on(pr('apps/twitch-bot/src/index.ts')), [
      'code',
      'bot',
      'images',
    ]);
    assert.deepEqual(on(pr('apps/studio/web/src/main.ts')), [
      'code',
      'studio',
      'e2e',
    ]);
    assert.deepEqual(on(pr('apps/twitch-extension/extension/shared/ui.js')), [
      'code',
      'studio',
      'extension',
      'e2e',
    ]);
    assert.deepEqual(on(pr('scripts/coolify-deploy.mjs')), ['code', 'tooling']);
    assert.deepEqual(on(pr('packages/schemas/src/index.ts')), [
      'code',
      'core',
      'bot',
      'studio',
      'extension',
      'e2e',
      'images',
    ]);
  });

  it('documentation only: nothing but the format check, on a pull request and on main', () => {
    assert.deepEqual(on(pr('docs/REPRISE.md', 'README.md')), []);
    assert.deepEqual(
      on(classify(['docs/ROADMAP.md'], { event: 'push', base: BASE })),
      [],
    );
  });

  it('main, manual runs, shared configuration and an unknown base: everything', () => {
    const everything = PARTS;
    assert.deepEqual(
      on(classify(['apps/twitch-bot/src/a.ts'], { event: 'push', base: BASE })),
      everything,
    );
    assert.deepEqual(
      on(classify([], { event: 'workflow_dispatch', base: '' })),
      everything,
    );
    assert.deepEqual(
      on(classify(['docs/x.md'], { event: 'push', base: '0'.repeat(40) })),
      everything,
    );
    assert.deepEqual(
      on(classify(null, { event: 'pull_request', base: BASE })),
      everything,
    );
    for (const f of [
      'package-lock.json',
      '.node-version',
      'turbo.json',
      '.github/workflows/ci.yml',
      'eslint.config.js',
    ])
      assert.deepEqual(on(pr(f)), everything, f);
  });
});
