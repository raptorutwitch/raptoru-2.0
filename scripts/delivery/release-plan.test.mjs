import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relevant, releasePlan, PATHS } from './release-plan.mjs';

const line = (plan, c) => plan.find((x) => x.component === c);

test('only what changes a component counts: no docs, no tests', () => {
  assert.deepEqual(
    relevant(
      [
        'apps/core-api/src/chaos/service.ts',
        'apps/core-api/test/chaos.test.ts',
        'apps/core-api/README.md',
        'docs/CICD.md',
        'apps/studio/server/e2e/casino.e2e.ts',
        'packages/schemas/src/chaos.ts',
      ],
      PATHS.core,
    ),
    ['apps/core-api/src/chaos/service.ts', 'packages/schemas/src/chaos.ts'],
  );
});

test('everything up to date: nothing to do, the extension needs no ZIP', () => {
  const plan = releasePlan({
    coreFiles: [],
    botFiles: [],
    studioFiles: ['docs/x.md'],
    studioTag: 'studio-v0.1.45',
    extension: { commits: 0, ok: false, problems: [] },
  });
  assert.equal(
    plan.every((x) => !x.todo),
    true,
  );
  assert.match(line(plan, 'Extension').text, /aucun ZIP/);
});

test('a release to make: Core with its migration, Studio, extension inventory to validate', () => {
  const plan = releasePlan({
    coreFiles: ['apps/core-api/src/x.ts', 'supabase/migrations/2026_x.sql'],
    migrations: ['2026_x.sql'],
    botFiles: ['apps/core-api/src/x.ts'],
    studioFiles: [
      'apps/studio/web/src/pages/casino.ts',
      'apps/twitch-extension/extension/app/panel.js',
    ],
    studioTag: 'studio-v0.1.45',
    extension: {
      commits: 58,
      ok: false,
      inventoryName: 'release-inventory/INVENTAIRE-094c4c52508f.md',
      problems: ['line « Validé par Antoni : oui » missing'],
    },
  });
  assert.equal(line(plan, 'Core').todo, true);
  assert.match(line(plan, 'Core').text, /2026_x\.sql.*--backup-now/);
  assert.equal(line(plan, 'Bot').todo, false);
  assert.equal(
    line(releasePlan({ botFiles: ['packages/schemas/src/chaos.ts'] }), 'Bot')
      .todo,
    false,
  );
  assert.equal(
    line(releasePlan({ botFiles: ['apps/twitch-bot/src/x.ts'] }), 'Bot').todo,
    true,
  );
  assert.equal(line(plan, 'Studio').todo, true);
  assert.match(line(plan, 'Studio').text, /studio-v0\.1\.45/);
  assert.equal(line(plan, 'Extension').todo, true);
  assert.match(line(plan, 'Extension').text, /58 commit.*Validé par Antoni/);
});

test('validated inventory: the ZIP comes from the CI, Twitch stays manual; unknown states never claim « à jour »', () => {
  const plan = releasePlan({
    extension: { commits: 3, ok: true, problems: [], inventoryName: 'x' },
  });
  assert.match(line(plan, 'Extension').text, /artefact.*SHA-256.*manuelle/);
  assert.match(line(plan, 'Core').text, /inconnu/);
  assert.match(line(plan, 'Studio').text, /inconnu/);
});
