import { describe, expect, it } from 'vitest';
import { STUDIO_PROTOCOL } from '../src/studio/installations.js';

// A new Core must never cut off a Studio still installed (docs/CICD.md § 0). Every published Studio up to 0.1.45 speaks
// protocol 1 (apps/studio/server/src/prod-transport/core-client.ts STUDIO_PROTOCOL_VERSION). Remove a version from
// this list only once no installed Studio uses it any more — the Core then answers 426 « Mise à jour requise ».
const PUBLISHED_STUDIO_PROTOCOLS = [1];

describe('Studio ↔ Core protocol', () => {
  it('the Core still accepts every protocol a published Studio speaks', () => {
    for (const v of PUBLISHED_STUDIO_PROTOCOLS)
      expect(STUDIO_PROTOCOL.supported).toContain(v);
    expect(STUDIO_PROTOCOL.supported).toContain(STUDIO_PROTOCOL.current);
  });
});
