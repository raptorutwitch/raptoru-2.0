import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  forgetObsConnection,
  loadObsConnection,
  saveObsConnection,
  type SecretBox,
} from '../src/obs-credentials.js';

// Bonk VNext lot 0: the OBS connection is remembered by Electron main, the password only encrypted
// by the OS (safeStorage), never in plain text. Fake box: a reversible, non-trivial transformation.
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
  join(await mkdtemp(join(tmpdir(), 'studio-obs-')), 'obs-connection.json');

describe('OBS connection remembered by Electron main', () => {
  it('saves the port as is and the password encrypted only; restores both', async () => {
    const f = await file();
    expect(
      await saveObsConnection(f, box(), {
        port: 4455,
        password: 'mot-de-passe-obs',
      }),
    ).toBe(true);
    const raw = readFileSync(f, 'utf8');
    expect(raw).not.toContain('mot-de-passe-obs');
    expect(raw).not.toContain('sbo-essap');
    expect(JSON.parse(raw)).toEqual({
      port: 4455,
      password_enc: expect.any(String),
    });
    expect(await loadObsConnection(f, box())).toEqual({
      port: 4455,
      password: 'mot-de-passe-obs',
    });
  });

  it('without OS encryption: nothing is written (never plain text), and nothing is restored', async () => {
    const f = await file();
    expect(
      await saveObsConnection(f, box(false), { port: 4455, password: 'x' }),
    ).toBe(false);
    expect(existsSync(f)).toBe(false);
    await saveObsConnection(f, box(), { port: 4455, password: 'x' });
    expect(await loadObsConnection(f, box(false))).toBeNull();
  });

  it('OBS without a password: only the port is stored', async () => {
    const f = await file();
    await saveObsConnection(f, box(), { port: 4460, password: '' });
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ port: 4460 });
    expect(await loadObsConnection(f, box())).toEqual({
      port: 4460,
      password: '',
    });
  });

  it('missing, damaged or undecryptable file: nothing restored; forget removes it (and tolerates absence)', async () => {
    const f = await file();
    expect(await loadObsConnection(f, box())).toBeNull();
    writeFileSync(f, '{not json');
    expect(await loadObsConnection(f, box())).toBeNull();
    writeFileSync(f, JSON.stringify({ port: 4455, password_enc: 'AAAA' }));
    expect(await loadObsConnection(f, box())).toBeNull();
    await forgetObsConnection(f);
    expect(existsSync(f)).toBe(false);
    await forgetObsConnection(f);
  });
});
