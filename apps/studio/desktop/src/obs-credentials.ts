import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

// OBS connection remembered by Electron main (Bonk VNext lot 0). The port is stored as is; the
// password only encrypted by the OS (Electron safeStorage: DPAPI on Windows), never in plain text.
// The Studio server never writes it: main hands it over after each server start.

export interface SecretBox {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface ObsConnection {
  port: number;
  password: string;
}

interface Stored {
  port: number;
  /** base64 of safeStorage.encryptString(password); absent = no password (OBS without auth). */
  password_enc?: string;
}

/** Saves the connection. Without OS encryption nothing is written (false): never plain text. */
export async function saveObsConnection(
  file: string,
  box: SecretBox,
  connection: ObsConnection,
): Promise<boolean> {
  if (!box.isEncryptionAvailable()) return false;
  const stored: Stored = {
    port: connection.port,
    ...(connection.password
      ? {
          password_enc: box
            .encryptString(connection.password)
            .toString('base64'),
        }
      : {}),
  };
  await writeFile(`${file}.tmp`, JSON.stringify(stored), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
  return true;
}

/** The remembered connection, or null (none, unreadable, or encryption unavailable). */
export async function loadObsConnection(
  file: string,
  box: SecretBox,
): Promise<ObsConnection | null> {
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as Stored;
    if (!Number.isInteger(stored.port)) return null;
    if (!stored.password_enc) return { port: stored.port, password: '' };
    if (!box.isEncryptionAvailable()) return null;
    return {
      port: stored.port,
      password: box.decryptString(Buffer.from(stored.password_enc, 'base64')),
    };
  } catch {
    return null;
  }
}

export async function forgetObsConnection(file: string): Promise<void> {
  await unlink(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e;
  });
}
