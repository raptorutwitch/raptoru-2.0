import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rotatingLog } from '../src/rotating-log.js';

// ASTRA-P2-023: the Studio server log is bounded during a session, the latest lines always kept.
describe('Studio server log file', () => {
  it('previous session → .1 at the first line; past the cap a fresh file, the full one → .1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-log-'));
    const file = join(dir, 'logs', 'studio-server.log');
    const write = rotatingLog(file, 100);
    write('first line of the session'); // creates logs/
    writeFileSync(`${file}.1`, 'stale');
    // A new Electron session: the previous log becomes .1.
    const next = rotatingLog(file, 100);
    next('session 2 line 1');
    expect(readFileSync(`${file}.1`, 'utf8')).toBe(
      'first line of the session\n',
    );
    for (let i = 2; i <= 12; i++) next(`session 2 line ${i}`); // ~17 bytes each: crosses 100 bytes
    const current = readFileSync(file, 'utf8');
    const previous = readFileSync(`${file}.1`, 'utf8');
    expect(Buffer.byteLength(current)).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(previous)).toBeLessThanOrEqual(100);
    expect(current.trim().split('\n').at(-1)).toBe('session 2 line 12'); // latest line kept
    expect(existsSync(`${file}.2`)).toBe(false); // never more than two files
  });
});
