import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SecretBox } from '../src/obs-credentials.js';
import {
  forgetSeConnection,
  loadSeConnection,
  saveSeConnection,
} from '../src/se-credentials.js';

// StreamElements token (real donations, Lab): kept by Electron main encrypted by the OS only, like the OBS password.
const box = (available = true): SecretBox => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) =>
    Buffer.from(`enc:${[...plain].reverse().join('')}`, 'utf8'),
  decryptString: (encrypted) => {
    const text = encrypted.toString('utf8');
    if (!text.startsWith('enc:')) throw new Error('cannot decrypt');
    return [...text.slice(4)].reverse().join('');
  },
});
const file = async () =>
  join(await mkdtemp(join(tmpdir(), 'studio-se-')), 'se-connection.json');
const TOKEN = 'eyJhbGciOi.secret-part-of-the-token.sig';

describe('StreamElements token remembered by Electron main', () => {
  it('stores the token encrypted only, restores it; forget removes it', async () => {
    const f = await file();
    const c = { token_type: 'jwt' as const, token: TOKEN, room: '' };
    expect(await saveSeConnection(f, box(), c)).toBe(true);
    expect(readFileSync(f, 'utf8')).not.toContain('secret-part');
    expect(await loadSeConnection(f, box())).toEqual(c);
    await forgetSeConnection(f);
    expect(existsSync(f)).toBe(false);
    await forgetSeConnection(f); // already gone: fine
  });

  it('no OS encryption: nothing written, nothing restored; corrupt file: nothing', async () => {
    const f = await file();
    expect(
      await saveSeConnection(f, box(false), {
        token_type: 'apikey',
        token: TOKEN,
        room: '',
      }),
    ).toBe(false);
    expect(existsSync(f)).toBe(false);
    await saveSeConnection(f, box(), {
      token_type: 'jwt',
      token: TOKEN,
      room: '',
    });
    expect(await loadSeConnection(f, box(false))).toBeNull();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(f, '{oops');
    expect(await loadSeConnection(f, box())).toBeNull();
  });
});
