import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The production entry (src/index.ts) is not booted by the tests (they assemble createApp themselves): a service it
// forgets to pass leaves its routes unmounted in production only (30/10: the cosmetic shop). Its wiring, checked here.
const index = readFileSync(
  join(import.meta.dirname, '..', 'src', 'index.ts'),
  'utf8',
);

describe('src/index.ts passes the services whose routes production needs', () => {
  it.each([
    ['cosmetics: core.cosmetics'],
    ['progression: core.progression'],
    ['eventShop: core.eventShop'],
    ['siteToken: config.SITE_TOKEN'],
  ])('%s', (line) => expect(index).toContain(line));
});
