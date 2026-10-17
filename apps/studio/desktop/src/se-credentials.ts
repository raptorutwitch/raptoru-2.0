import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { SecretBox } from './obs-credentials.js';

// StreamElements token for the real donations (alerts, Lab), remembered by Electron main like the OBS password: only
// encrypted by the OS (safeStorage: DPAPI on Windows), never in plain text. Handed to the Studio server after each
// start; the server keeps it in memory only.

export interface SeConnection {
  token_type: 'jwt' | 'apikey';
  token: string;
  /** StreamElements channel id (not a secret), optional. */
  room: string;
}

interface Stored {
  token_type: SeConnection['token_type'];
  room: string;
  /** base64 of safeStorage.encryptString(token). */
  token_enc: string;
}

/** Saves it. Without OS encryption nothing is written (false): never plain text. */
export async function saveSeConnection(
  file: string,
  box: SecretBox,
  c: SeConnection,
): Promise<boolean> {
  if (!box.isEncryptionAvailable()) return false;
  const stored: Stored = {
    token_type: c.token_type,
    room: c.room,
    token_enc: box.encryptString(c.token).toString('base64'),
  };
  await writeFile(`${file}.tmp`, JSON.stringify(stored), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
  return true;
}

/** The remembered connection, or null (none, unreadable, or encryption unavailable). */
export async function loadSeConnection(
  file: string,
  box: SecretBox,
): Promise<SeConnection | null> {
  try {
    const s = JSON.parse(await readFile(file, 'utf8')) as Stored;
    if (!['jwt', 'apikey'].includes(s.token_type) || !s.token_enc) return null;
    if (!box.isEncryptionAvailable()) return null;
    return {
      token_type: s.token_type,
      room: typeof s.room === 'string' ? s.room : '',
      token: box.decryptString(Buffer.from(s.token_enc, 'base64')),
    };
  } catch {
    return null;
  }
}

export async function forgetSeConnection(file: string): Promise<void> {
  await unlink(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e;
  });
}
