import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { StoredToken, TokenStore } from './auth.js';

export class TokenStoreError extends Error {
  constructor(
    readonly code: 'store_busy' | 'store_conflict' | 'invalid_store',
  ) {
    super(
      code === 'store_busy'
        ? 'Le stockage Twitch est verrouillé. Arrête les consommateurs avant de réessayer ou de retirer un verrou abandonné.'
        : code === 'store_conflict'
          ? 'Le jeton Twitch a changé pendant l’opération. Recommence l’autorisation.'
          : 'Le stockage du jeton Twitch est invalide ou inaccessible.',
    );
  }
}

/** Also supports legacy files without a revision. Never compares/logs a credential hash. */
export function sameTokenVersion(
  left: StoredToken | null,
  right: StoredToken | null,
): boolean {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.accessToken === right.accessToken &&
      left.refreshToken === right.refreshToken &&
      left.pendingRefreshToken === right.pendingRefreshToken &&
      left.revision === right.revision &&
      left.userId === right.userId &&
      left.login === right.login &&
      left.expiresAt === right.expiresAt &&
      JSON.stringify(left.scopes) === JSON.stringify(right.scopes))
  );
}

function parseToken(text: string): StoredToken {
  try {
    const value = JSON.parse(text) as StoredToken;
    if (
      !value ||
      typeof value.accessToken !== 'string' ||
      !value.accessToken ||
      typeof value.refreshToken !== 'string' ||
      !value.refreshToken ||
      !Array.isArray(value.scopes) ||
      !value.scopes.every((scope) => typeof scope === 'string') ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      typeof value.userId !== 'string' ||
      !/^\d+$/.test(value.userId) ||
      typeof value.login !== 'string' ||
      !value.login ||
      (value.revision !== undefined && typeof value.revision !== 'string') ||
      (value.pendingRefreshToken !== undefined &&
        (typeof value.pendingRefreshToken !== 'string' ||
          !value.pendingRefreshToken))
    )
      throw new Error();
    return value;
  } catch {
    throw new TokenStoreError('invalid_store');
  }
}

/** Cooperative process lock: refresh and new authorizations use this same lock. */
export function fileTokenStore(
  path: string,
  options: { lockTimeoutMs?: number } = {},
): TokenStore {
  const lockPath = `${path}.lock`;
  const unlocked: TokenStore = {
    async load() {
      try {
        return parseToken(await readFile(path, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        if (error instanceof TokenStoreError) throw error;
        throw new TokenStoreError('invalid_store');
      }
    },
    async save(token) {
      const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
      try {
        await writeFile(tmp, JSON.stringify(token, null, 2), {
          encoding: 'utf8',
          mode: 0o600,
        });
        for (let attempt = 0; ; attempt++) {
          try {
            await rename(tmp, path);
            return;
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (
              attempt >= 10 ||
              !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')
            )
              throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 20 * (attempt + 1)),
            );
          }
        }
      } catch {
        throw new TokenStoreError('invalid_store');
      } finally {
        await unlink(tmp).catch(() => {});
      }
    },
  };
  const withLock: NonNullable<TokenStore['withLock']> = async (operation) => {
    const started = Date.now();
    let lock: Awaited<ReturnType<typeof open>>;
    for (;;) {
      try {
        lock = await open(lockPath, 'wx', 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
          throw new TokenStoreError('invalid_store');
        // Never unlink another process's lock. PID checks/time-based eviction have a TOCTOU race.
        // After a crash an operator stops all consumers before removing the abandoned lock.
        if (Date.now() - started >= (options.lockTimeoutMs ?? 30_000))
          throw new TokenStoreError('store_busy');
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
    try {
      return await operation(unlocked);
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => {});
    }
  };
  return {
    load: unlocked.load,
    save: (token) => withLock((store) => store.save(token)),
    withLock,
    saveIfCurrent: (expected, token) =>
      withLock(async (store) => {
        if (!sameTokenVersion(await store.load(), expected))
          throw new TokenStoreError('store_conflict');
        await store.save(token);
      }),
  };
}
