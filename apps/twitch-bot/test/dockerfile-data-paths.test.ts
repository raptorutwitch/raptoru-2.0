import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Incident 23/10 (Caution): the image runs as `node` in /app (owned by root), so a journal or outbox left at its
// relative default is not writable — the Caution executor journaled nothing, never unbanned and stopped answering
// Core. Every durable file of the production bot must be set by the image to the writable /data volume.

const config = readFileSync(
  new URL('../src/config.ts', import.meta.url),
  'utf8',
);
const dockerfile = readFileSync(
  new URL('../Dockerfile', import.meta.url),
  'utf8',
);

describe('bot image: durable files on /data', () => {
  const keys = [...config.matchAll(/^\s+([A-Z_]+_(?:JOURNAL|OUTBOX)_FILE):/gm)]
    .map((m) => m[1]!)
    .filter((k) => !k.startsWith('LAB_')); // the Lab adapter never runs in the image

  it('finds the production journals and outboxes', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'RANDOM_BAN_JOURNAL_FILE',
        'CAUTION_JOURNAL_FILE',
        'VOTEKICK_JOURNAL_FILE',
        'ALERTS_OUTBOX_FILE',
      ]),
    );
  });

  it.each(keys)('%s is set to /data by the Dockerfile', (key) => {
    expect(dockerfile).toMatch(new RegExp(`\\n\\s+${key}=/data/\\S+`));
  });
});
