import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Viewer OAuth tokens at rest (public Core): AES-256-GCM with EXT_TOKEN_KEY, stored as
// `enc:v1:<iv>.<tag>.<ciphertext>` (base64url). Without a key (local Lab Core) a token is stored as
// before; a plain value is always readable. An encrypted value without the right key is unreadable
// (null): the viewer is asked to reconnect, nothing else.

const PREFIX = 'enc:v1:';

export function sealToken(value: string, key: Buffer | null): string {
  if (!key) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return (
    PREFIX +
    [iv, cipher.getAuthTag(), data]
      .map((b) => b.toString('base64url'))
      .join('.')
  );
}

export function openToken(stored: string, key: Buffer | null): string | null {
  if (!stored.startsWith(PREFIX)) return stored;
  if (!key) return null;
  const [iv, tag, data] = stored
    .slice(PREFIX.length)
    .split('.')
    .map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}
