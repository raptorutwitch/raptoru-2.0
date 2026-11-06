import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The production entry (src/index.ts) is not booted by the tests (they assemble createApp themselves): a service it
// forgets to pass leaves its routes unmounted in production only (30/10: the cosmetic shop). Its wiring, checked here.
const src = (file: string) =>
  readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8');
const index = src('index.ts');
// The HTTP assembly lives in main-server.ts: the one function of Production's entry and the Lab.
const assembly = src('main-server.ts');

describe('the main Core assembly passes the services whose routes production needs', () => {
  it.each([
    ['cosmetics: core.cosmetics'],
    ['progression: core.progression'],
    ['eventShop: core.eventShop'],
    ['siteToken: config.SITE_TOKEN'],
  ])('%s', (line) => expect(assembly).toContain(line));

  it('the entry uses that assembly', () =>
    expect(index).toContain('createMainServer(core, db, systemClock, config)'));
});
