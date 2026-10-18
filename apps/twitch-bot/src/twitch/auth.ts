import { randomUUID } from 'node:crypto';
import {
  TwitchTokenValidationError,
  validateTwitchTokenInfo,
  type TwitchTokenValidationCode,
} from '@raptoru/schemas';
import { sameTokenVersion, TokenStoreError } from './token-store.js';
export {
  fileTokenStore,
  sameTokenVersion,
  TokenStoreError,
} from './token-store.js';

// Twitch user-token lifecycle (official OAuth authorization code flow + refresh tokens).
// Reusable by any Twitch feature of the bot; knows nothing about presence, Daily or chat.
//
// - one refresh at a time (concurrent callers share it);
// - proactive refresh shortly before expiry, reactive refresh after a Helix 401;
// - a rejected refresh is final for this process: no refresh loop, callers get an AuthError;
// - tokens are never logged.

export const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
export const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  /** Epoch ms. */
  expiresAt: number;
  userId: string;
  login: string;
  /** Changes on a refresh or a new authorization; legacy token files have no revision. */
  revision?: string;
  /** Preserves refresh rotation if Twitch validation is temporarily unavailable after the exchange. */
  pendingRefreshToken?: string;
}

export interface TokenStore {
  load(): Promise<StoredToken | null>;
  save(token: StoredToken): Promise<void>;
  /** Locked operations use an unlocked store to avoid recursively acquiring the same lock. */
  withLock?<T>(operation: (store: TokenStore) => Promise<T>): Promise<T>;
  saveIfCurrent?(
    expected: StoredToken | null,
    token: StoredToken,
  ): Promise<void>;
}

export type AuthErrorCode =
  | 'no_token'
  | 'missing_scopes'
  | 'refresh_rejected'
  | 'invalid_token'
  | 'twitch_unavailable'
  | 'store_conflict'
  | 'invalid_store'
  | TwitchTokenValidationCode;

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[];
}

export interface TwitchAuthOptions {
  clientId: string;
  clientSecret: string;
  expectedUserId: string;
  store: TokenStore;
  requiredScopes: readonly string[];
  fetch?: typeof fetch;
  now?: () => number;
  log?: (...args: unknown[]) => void;
  /** Refresh this long before expiry. */
  refreshMarginMs?: number;
  /** Called once for an error that needs user action; never for network/429/5xx trouble. */
  onFailure?: (code: AuthErrorCode) => void;
}

export interface AuthStatus {
  state: 'ready' | 'pending_validation' | 'failed' | 'uninitialized';
  login: string | null;
  userId: string | null;
  scopes: string[];
  expiresAt: string | null;
  hasRefreshToken: boolean;
  lastRefreshAt: string | null;
  lastValidatedAt: string | null;
  error: string | null;
}

/** POST to the Twitch token endpoint (authorization_code or refresh_token grant). */
export async function requestToken(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; token: TokenResponse }
  | { ok: false; status: number; message: string; retryAfterMs?: number }
> {
  let res: Response;
  try {
    res = await fetchImpl(TWITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AuthError(
      'twitch_unavailable',
      'Twitch est injoignable. Réessaie plus tard.',
    );
  }
  if (!res.ok) {
    // Upstream messages can echo request parameters. Only the HTTP status leaves this layer.
    const retryAfter = res.headers.get('retry-after');
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const retryAfterMs =
      Number.isFinite(seconds) && seconds >= 0
        ? seconds * 1000
        : retryAfter
          ? Math.max(0, Date.parse(retryAfter) - Date.now())
          : NaN;
    return {
      ok: false,
      status: res.status,
      message: `Twitch HTTP ${res.status}`,
      ...(Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}),
    };
  }
  let token: TokenResponse;
  try {
    token = (await res.json()) as TokenResponse;
    if (
      !token ||
      typeof token.access_token !== 'string' ||
      !token.access_token ||
      (token.refresh_token !== undefined &&
        typeof token.refresh_token !== 'string') ||
      (token.expires_in !== undefined &&
        (typeof token.expires_in !== 'number' ||
          !Number.isFinite(token.expires_in) ||
          token.expires_in <= 0))
    )
      throw new Error();
  } catch {
    throw new AuthError(
      'invalid_token_info',
      'La réponse OAuth Twitch est invalide.',
    );
  }
  return { ok: true, token };
}

/** GET /oauth2/validate: null when Twitch says the token is invalid (401). */
export async function validateAccessToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  let res: Response;
  try {
    res = await fetchImpl(TWITCH_VALIDATE_URL, {
      headers: { authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AuthError(
      'twitch_unavailable',
      'La validation Twitch est temporairement indisponible.',
    );
  }
  if (res.status === 401) return null;
  if (!res.ok)
    throw new AuthError(
      'twitch_unavailable',
      `token validation failed (HTTP ${res.status})`,
    );
  try {
    return (await res.json()) as {
      client_id: string;
      login: string;
      user_id: string;
      expires_in: number;
      scopes: string[] | null;
    };
  } catch {
    throw new AuthError(
      'invalid_token_info',
      'La réponse de validation Twitch est invalide.',
    );
  }
}

export class TwitchAuth {
  private token: StoredToken | null = null;
  private refreshing: Promise<StoredToken> | null = null;
  private failure: AuthError | null = null;
  private lastRefreshAt: number | null = null;
  private lastValidatedAt: number | null = null;
  private refreshRetryAt = 0;
  private storedSnapshot: StoredToken | null = null;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly log: (...args: unknown[]) => void;
  private readonly margin: number;

  constructor(private readonly options: TwitchAuthOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? console.log;
    this.margin = options.refreshMarginMs ?? 10 * 60 * 1000;
  }

  /** Loads, validates (refreshing if needed) and checks scopes. Throws AuthError when unusable. */
  async init(): Promise<AuthStatus> {
    let stored: StoredToken | null;
    try {
      stored = await this.options.store.load();
    } catch {
      throw this.fail(
        'invalid_store',
        'Le stockage du jeton Twitch est invalide ou inaccessible.',
      );
    }
    if (!stored)
      throw this.fail(
        'no_token',
        'no Twitch token stored: run `npm run twitch:auth -w @raptoru/twitch-bot`',
      );
    this.token = stored;
    this.storedSnapshot = stored;
    await this.validate();
    return this.status();
  }

  /** Twitch requires hourly validation of user tokens; also detects revoked tokens and lost scopes. */
  async validate(): Promise<void> {
    this.throwIfFailed();
    const current = this.requireToken();
    if (current.pendingRefreshToken) {
      await this.refresh();
      return;
    }
    let info: Awaited<ReturnType<typeof validateAccessToken>>;
    try {
      info = await validateAccessToken(current.accessToken, this.fetch);
    } catch (error) {
      // A refresh may have completed while this GET was in flight. Its newer grant takes precedence.
      if (this.token !== current) return;
      if (error instanceof AuthError && error.code === 'invalid_token_info')
        throw this.fail(error.code, error.message);
      throw error;
    }
    if (this.token !== current) return;
    if (!info) {
      await this.refresh();
      return;
    }
    this.token = this.acceptInfo(current, info);
  }

  /** Current access token, refreshed first if it is about to expire. */
  async getAccessToken(): Promise<string> {
    this.throwIfFailed();
    if (this.lastValidatedAt === null) await this.validate();
    const token = this.requireToken();
    if (
      token.pendingRefreshToken ||
      token.expiresAt - this.now() <= this.margin
    )
      return (await this.refresh()).accessToken;
    return token.accessToken;
  }

  /** For Helix: after a 401, refresh once. Returns false when no new token could be obtained. */
  async handleUnauthorized(rejectedAccessToken: string): Promise<boolean> {
    if (this.failure) return false;
    if (this.token && this.token.accessToken !== rejectedAccessToken)
      return true; // already refreshed
    try {
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /** Single-flight refresh; the new token is persisted before being used. */
  refresh(): Promise<StoredToken> {
    this.throwIfFailed();
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  status(): AuthStatus {
    return {
      state: this.failure
        ? 'failed'
        : this.token &&
            (this.token.pendingRefreshToken || this.lastValidatedAt === null)
          ? 'pending_validation'
          : this.token
            ? 'ready'
            : 'uninitialized',
      login: this.token?.login ?? null,
      userId: this.token?.userId ?? null,
      scopes: this.token?.scopes ?? [],
      expiresAt: this.token
        ? new Date(this.token.expiresAt).toISOString()
        : null,
      hasRefreshToken: Boolean(this.token?.refreshToken),
      lastRefreshAt:
        this.lastRefreshAt === null
          ? null
          : new Date(this.lastRefreshAt).toISOString(),
      lastValidatedAt:
        this.lastValidatedAt === null
          ? null
          : new Date(this.lastValidatedAt).toISOString(),
      error: this.failure?.message ?? null,
    };
  }

  private async doRefresh(): Promise<StoredToken> {
    const refreshLocked = async (store: TokenStore): Promise<StoredToken> => {
      let current = this.requireToken();
      // Another process may have refreshed or reauthorized since init. Never overwrite its grant.
      const disk = await store.load();
      if (!disk)
        throw this.fail(
          'store_conflict',
          'Le jeton Twitch a disparu. Recommence l’autorisation.',
        );
      if (!sameTokenVersion(disk, this.storedSnapshot)) {
        const info = await this.readInfo(disk.accessToken);
        if (info && !disk.pendingRefreshToken) {
          current = this.acceptInfo(disk, info);
          this.token = current;
          this.storedSnapshot = disk;
          return current;
        }
        // The newer token can legitimately have expired while this process was idle.
        current = disk;
      }
      if (this.now() < this.refreshRetryAt)
        throw new AuthError(
          'twitch_unavailable',
          'Twitch limite les renouvellements. Réessaie après le délai indiqué.',
        );
      let result;
      try {
        result = await requestToken(
          {
            grant_type: 'refresh_token',
            refresh_token: current.pendingRefreshToken ?? current.refreshToken,
            client_id: this.options.clientId,
            client_secret: this.options.clientSecret,
          },
          this.fetch,
        );
      } catch (error) {
        if (error instanceof AuthError && error.code === 'invalid_token_info')
          throw this.fail(error.code, error.message);
        throw new AuthError(
          'twitch_unavailable',
          'Le renouvellement Twitch est temporairement indisponible.',
        );
      }
      if (!result.ok) {
        if (result.status === 429)
          this.refreshRetryAt =
            this.now() + Math.max(250, result.retryAfterMs ?? 5000);
        if (result.status >= 500 || result.status === 429) {
          throw new AuthError(
            'twitch_unavailable',
            `token refresh failed (HTTP ${result.status})`,
          );
        }
        throw this.fail(
          'refresh_rejected',
          'Twitch a refusé le renouvellement. Recommence l’autorisation.',
        );
      }
      const candidate: StoredToken = {
        ...current,
        accessToken: result.token.access_token,
        refreshToken:
          result.token.refresh_token ||
          current.pendingRefreshToken ||
          current.refreshToken,
        scopes: result.token.scope ?? current.scopes,
        expiresAt: this.now() + (result.token.expires_in ?? 3600) * 1000,
        revision: randomUUID(),
      };
      delete candidate.pendingRefreshToken;
      // Validate the actual grant before saving it or allowing a Helix call to use it.
      let info: Awaited<ReturnType<typeof validateAccessToken>>;
      try {
        info = await this.readInfo(candidate.accessToken);
      } catch (error) {
        if (error instanceof AuthError && error.code === 'twitch_unavailable') {
          // Retain only the rotated refresh credential. The unvalidated access token is never exposed.
          const pending = {
            ...current,
            pendingRefreshToken: candidate.refreshToken,
            revision: randomUUID(),
          };
          await store.save(pending);
          this.token = pending;
          this.storedSnapshot = pending;
        }
        throw error;
      }
      if (!info)
        throw this.fail(
          'invalid_token',
          'Twitch refuse le jeton nouvellement renouvelé.',
        );
      const next = this.acceptInfo(candidate, info);
      await store.save(next);
      this.token = next;
      this.storedSnapshot = next;
      this.lastRefreshAt = this.now();
      this.log(
        `[twitch-auth] token refreshed for ${next.login}, valid ${Math.round((next.expiresAt - this.now()) / 60000)} min`,
      );
      return next;
    };
    try {
      return this.options.store.withLock
        ? await this.options.store.withLock(refreshLocked)
        : await refreshLocked(this.options.store);
    } catch (error) {
      if (error instanceof TokenStoreError) {
        if (error.code === 'store_busy')
          throw new AuthError('twitch_unavailable', error.message);
        throw this.fail(error.code, error.message);
      }
      throw error;
    }
  }

  private acceptInfo(token: StoredToken, info: unknown): StoredToken {
    try {
      const checked = validateTwitchTokenInfo(info, this.options);
      this.lastValidatedAt = this.now();
      return {
        ...token,
        scopes: checked.scopes,
        userId: checked.userId,
        login: checked.login,
        expiresAt: this.now() + checked.expiresIn * 1000,
      };
    } catch (error) {
      if (error instanceof TwitchTokenValidationError)
        throw this.fail(error.code, error.message);
      throw this.fail(
        'invalid_token_info',
        'La réponse de validation Twitch est invalide.',
      );
    }
  }

  private async readInfo(accessToken: string) {
    try {
      return await validateAccessToken(accessToken, this.fetch);
    } catch (error) {
      if (error instanceof AuthError && error.code === 'invalid_token_info')
        throw this.fail(error.code, error.message);
      throw error;
    }
  }

  private requireToken(): StoredToken {
    if (!this.token)
      throw new AuthError('no_token', 'TwitchAuth not initialized');
    return this.token;
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }

  private fail(code: AuthErrorCode, message: string): AuthError {
    if (this.failure) return this.failure;
    this.failure = new AuthError(code, message);
    this.log(`[twitch-auth] ${message}`);
    this.options.onFailure?.(code);
    return this.failure;
  }
}
