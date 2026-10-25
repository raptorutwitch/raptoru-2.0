import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import {
  TWITCH_OAUTH_PROFILES,
  TwitchTokenValidationError,
  hasTwitchScope,
  validateTwitchTokenInfo,
  type TwitchOAuthRole,
  type ValidatedTwitchTokenInfo,
} from '@raptoru/schemas';

/** The dashboard never refreshes, rewrites, revokes or creates an authorization on its own. */
export interface TwitchConnectionsDeps {
  clientId: string;
  tokenFiles: Record<TwitchOAuthRole, string>;
  botDir: string;
  envFile: string;
  canAuthorize: () => { ok: boolean; reason?: string };
  /**
   * Production profile (incident 22/10, F1): these are THIS PC's token files, which the production bot (VPS) never
   * reads. Reauthorizing here would change nothing for it: refused, and the page says why. Lab keeps it.
   */
  production?: boolean;
  env?: NodeJS.ProcessEnv;
  nodePath?: string;
  fetch?: typeof fetch;
  spawn?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => ChildProcess;
  now?: () => number;
}

type Token = {
  fingerprint: string;
  accessToken: string | null;
  login: string | null;
  userId: string | null;
  scopes: string[];
  expiresAt: string | null;
  hasRefreshToken: boolean;
  pendingValidation: boolean;
  fileState: 'present' | 'missing' | 'unreadable';
};
type Check = {
  fingerprint: string;
  checkedAt: string;
  validatedAt: string | null;
  code: string;
  info?: ValidatedTwitchTokenInfo;
  expiresAt?: number;
  /** Set when « Vérifier » renewed the grant (refresh token) instead of asking for a reauthorization. */
  renewedAt?: string;
};
type Flow = {
  role: TwitchOAuthRole;
  state:
    'starting' | 'waiting' | 'complete' | 'error' | 'cancelled' | 'expired';
  authorization_url?: string;
  code?: string;
};

const ROLES: TwitchOAuthRole[] = ['bot', 'broadcaster'];
const PREFIX = '/api/twitch-connections';
const HOUR = 60 * 60_000;
const RENEW_TIMEOUT = 30_000;
/** Outcomes of the renewal CLI shown as they are; anything else reads « refresh_failed ». */
const RENEWAL_CODES = [
  'refresh_rejected',
  'invalid_token',
  'twitch_unavailable',
  'store_busy',
  'store_conflict',
  'invalid_store',
  'no_token',
  'wrong_client',
  'wrong_account',
  'not_user_token',
  'invalid_token_info',
];
const FLOW_TIMEOUT = 11 * 60_000;
const FEATURES: Record<TwitchOAuthRole, [string, string][]> = {
  bot: [
    ['Lecture du chat', 'user:read:chat'],
    ['Réponses dans le chat', 'user:write:chat'],
    ['Liste des chatters', 'moderator:read:chatters'],
    ['Follows', 'moderator:read:followers'],
    ['Annonces', 'moderator:manage:announcements'],
    ['Timeouts / Random Ban / futur Votekick', 'moderator:manage:banned_users'],
  ],
  broadcaster: [
    ['Bits', 'bits:read'],
    ['Abonnements', 'channel:read:subscriptions'],
    ['Follows', 'moderator:read:followers'],
    ['Lecture modération', 'moderation:read'],
    ['Réception des récompenses', 'channel:read:redemptions'],
    [
      'Gestion future des récompenses créées par Raptoru',
      'channel:manage:redemptions',
    ],
  ],
};

const safeScopes = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (s): s is string =>
              typeof s === 'string' && /^[a-z][a-z0-9:_]{1,100}$/.test(s),
          ),
        ),
      ].slice(0, 100)
    : [];
const identity = (value: unknown, pattern: RegExp) =>
  typeof value === 'string' && pattern.test(value) ? value : null;
const iso = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value > 0 &&
  value < 8.64e15
    ? new Date(value).toISOString()
    : null;

function readToken(file: string): Token {
  const empty = {
    accessToken: null,
    login: null,
    userId: null,
    scopes: [],
    expiresAt: null,
    hasRefreshToken: false,
    pendingValidation: false,
  };
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    const fileState =
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'missing'
        : 'unreadable';
    return { ...empty, fingerprint: fileState, fileState };
  }
  const fingerprint = createHash('sha256').update(raw).digest('hex');
  try {
    const t: unknown = JSON.parse(raw);
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error();
    const value = t as Record<string, unknown>;
    return {
      fingerprint,
      fileState: 'present',
      accessToken:
        typeof value.accessToken === 'string' && value.accessToken
          ? value.accessToken
          : null,
      login: identity(value.login, /^[a-zA-Z0-9_]{1,25}$/),
      userId: identity(value.userId, /^\d{1,32}$/),
      scopes: safeScopes(value.scopes),
      expiresAt: iso(value.expiresAt),
      hasRefreshToken:
        typeof value.refreshToken === 'string' && value.refreshToken.length > 0,
      pendingValidation:
        typeof value.pendingRefreshToken === 'string' &&
        value.pendingRefreshToken.length > 0,
    };
  } catch {
    return { ...empty, fingerprint, fileState: 'unreadable' };
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function bodyRole(req: IncomingMessage): Promise<TwitchOAuthRole> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (text.length > 4096) throw new Error('invalid_request');
  }
  const body: unknown = JSON.parse(text || '{}');
  const role =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).role
      : null;
  if (role !== 'bot' && role !== 'broadcaster') throw new Error('invalid_role');
  return role;
}

const PRODUCTION_REASON =
  'Profil Production : ces jetons sont ceux de ce PC. Le bot de Production (VPS) utilise ses propres copies : les réautoriser ici ne le répare pas. Réautorisation disponible en profil Lab.';

/** A short-lived controller: validated metadata stays in memory and is tied to the exact file content. */
export class TwitchConnections {
  private checks = new Map<TwitchOAuthRole, Check>();
  private child: ChildProcess | null = null;
  private flow: Flow | null = null;
  private flowTimer: ReturnType<typeof setTimeout> | undefined;
  private verifying: TwitchOAuthRole | null = null;

  constructor(private readonly d: TwitchConnectionsDeps) {}

  /** Remains true until the child has closed, including cancellation and callback processing. */
  get authorizing() {
    return this.child !== null;
  }

  private now() {
    return (this.d.now ?? Date.now)();
  }

  private tokenPathsConflict() {
    const files = ROLES.map((role) =>
      resolve(this.d.botDir, this.d.tokenFiles[role]),
    );
    return process.platform === 'win32'
      ? files[0]!.toLowerCase() === files[1]!.toLowerCase()
      : files[0] === files[1];
  }

  status() {
    const authorization = this.d.production
      ? { ok: false, reason: PRODUCTION_REASON }
      : this.d.canAuthorize();
    const pathsConflict = this.tokenPathsConflict();
    const now = this.now();
    return {
      accounts: ROLES.map((role) => {
        const profile = TWITCH_OAUTH_PROFILES[role];
        const token = readToken(this.d.tokenFiles[role]);
        let check = this.checks.get(role);
        if (check && check.fingerprint !== token.fingerprint) {
          this.checks.delete(role);
          check = undefined;
        }
        const scopes = check?.info?.scopes ?? token.scopes;
        // The consent profile is exact; individual runtime capabilities may accept alternatives.
        const missing = profile.scopes.filter(
          (scope) => !scopes.includes(scope),
        );
        const expired =
          check?.expiresAt !== undefined
            ? check.expiresAt <= now
            : token.expiresAt !== null && Date.parse(token.expiresAt) <= now;
        const renewable = expired && token.hasRefreshToken;
        const fresh =
          check?.validatedAt !== null &&
          check?.validatedAt !== undefined &&
          now - Date.parse(check.validatedAt) < HOUR &&
          !expired;
        const state =
          token.fileState !== 'present'
            ? token.fileState
            : token.pendingValidation
              ? 'pending_validation'
              : // An access token lives ≈ 4 h; with a refresh token it is renewed on use (bot, Lab) or by « Vérifier ».
                renewable && !check
                ? 'renewable'
                : !check
                  ? 'unverified'
                  : check.code !== 'ready' && check.code !== 'missing_scopes'
                    ? check.code
                    : expired
                      ? renewable
                        ? 'renewable'
                        : 'expired'
                      : !fresh
                        ? 'unverified'
                        : missing.length
                          ? 'missing_scopes'
                          : 'ready';
        return {
          role,
          expected: { login: profile.login, user_id: profile.expectedUserId },
          stored: {
            login: token.login,
            user_id: token.userId,
            expires_at: token.expiresAt,
            refresh_available: token.hasRefreshToken,
          },
          validated: check?.info
            ? { login: check.info.login, user_id: check.info.userId }
            : null,
          client_id: this.d.clientId || null,
          token_file: this.d.tokenFiles[role],
          state,
          stored_expired: expired,
          scopes,
          required_scopes: [...profile.scopes],
          missing_scopes: missing,
          checked_at: check?.checkedAt ?? null,
          renewed_at: check?.renewedAt ?? null,
          validated_at: check?.validatedAt ?? null,
          features: FEATURES[role].map(([label, scope]) => ({
            label,
            scope,
            scope_present: hasTwitchScope(scopes, scope),
          })),
        };
      }),
      roles_checked: false,
      authorization_allowed: authorization.ok && !pathsConflict,
      authorization_blocked_reason: pathsConflict
        ? 'Les comptes bot et streamer doivent utiliser deux fichiers de jetons distincts.'
        : authorization.ok
          ? null
          : (authorization.reason ??
            'Arrête les consommateurs Twitch avant de réautoriser.'),
      configured: Boolean(this.d.clientId),
      production: Boolean(this.d.production),
      busy: this.verifying ? 'verify' : this.child ? 'authorize' : null,
      flow: this.flow ? { ...this.flow } : null,
    };
  }

  /**
   * « Vérifier »: asks Twitch whether the stored access token works (GET /validate, no rewrite). An access token lives
   * ≈ 4 h: when Twitch refuses it and a refresh token is stored, the grant is renewed through the bot's own TwitchAuth
   * (`twitch-auth --renew`: shared file lock, rotated refresh token kept, new grant validated before it is saved) —
   * an expired access token is not a refused authorization (incident 23/10: daily reauthorizations for nothing).
   * Only a refused renewal asks for a reauthorization.
   */
  async verify(role: TwitchOAuthRole) {
    if (this.child || this.verifying) throw new Error('busy');
    if (!this.d.clientId) throw new Error('configuration_missing');
    this.verifying = role;
    try {
      const first = await this.validateOnce(role);
      const stored = readToken(this.d.tokenFiles[role]);
      if (
        // Refused access token, or a renewal a runtime left half-done (rotated refresh token kept, not yet validated).
        (first.code === 'invalid_token' || stored.pendingValidation) &&
        stored.hasRefreshToken &&
        existsSync(this.renewScript())
      ) {
        const outcome = await this.renew(role);
        if (outcome === 'renewed') {
          const after = await this.validateOnce(role);
          after.renewedAt = after.checkedAt;
        } else
          this.checks.set(role, {
            ...first,
            code: RENEWAL_CODES.includes(outcome) ? outcome : 'refresh_failed',
          });
      }
    } finally {
      this.verifying = null;
    }
  }

  private renewScript() {
    return join(this.d.botDir, 'dist', 'scripts', 'twitch-auth.js');
  }

  /** The bot's renewal CLI; only its allowlisted JSON outcome is kept (stderr / free text never reach the page). */
  private renew(role: TwitchOAuthRole): Promise<string> {
    return new Promise((done) => {
      const child = (this.d.spawn ?? nodeSpawn)(
        this.d.nodePath ?? process.execPath,
        [
          `--env-file-if-exists=${this.d.envFile}`,
          this.renewScript(),
          '--studio',
          '--renew',
          ...(role === 'broadcaster' ? ['--broadcaster'] : []),
        ],
        {
          cwd: this.d.botDir,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...this.d.env,
            TWITCH_CLIENT_ID: this.d.clientId,
            TWITCH_TOKEN_FILE: this.d.tokenFiles.bot,
            TWITCH_BROADCASTER_TOKEN_FILE: this.d.tokenFiles.broadcaster,
          },
        },
      );
      let outcome = 'refresh_failed';
      let buffer = '';
      child.stdout?.on('data', (chunk: Buffer | string) => {
        buffer = (buffer + String(chunk)).slice(-16_384);
        for (const line of buffer.split('\n')) {
          try {
            const e = JSON.parse(line) as Record<string, unknown>;
            if (e.type === 'renewed' && e.role === role) outcome = 'renewed';
            else if (e.type === 'error') outcome = String(e.code);
          } catch {
            /* partial or non-JSON line */
          }
        }
      });
      child.stderr?.on('data', () => {});
      const timer = setTimeout(() => {
        outcome = 'twitch_unavailable';
        child.kill();
      }, RENEW_TIMEOUT);
      timer.unref?.();
      child.once('error', () => {
        clearTimeout(timer);
        done('refresh_failed');
      });
      child.once('close', () => {
        clearTimeout(timer);
        done(outcome);
      });
    });
  }

  /** One GET /validate of the stored token: never refreshes, never rewrites the file. */
  private async validateOnce(role: TwitchOAuthRole): Promise<Check> {
    const token = readToken(this.d.tokenFiles[role]);
    const checkedAt = new Date(this.now()).toISOString();
    const previous = this.checks.get(role);
    const sameGrant = previous?.fingerprint === token.fingerprint;
    const check: Check = {
      ...(sameGrant ? previous : {}),
      fingerprint: token.fingerprint,
      checkedAt,
      validatedAt: sameGrant ? previous.validatedAt : null,
      code: 'invalid_token',
    };
    try {
      if (!token.accessToken) {
        check.code = 'no_token';
        return check;
      }
      // Deliberately GET /validate only: diagnosing an expired token must not refresh it or rewrite its file.
      const response = await (this.d.fetch ?? fetch)(
        'https://id.twitch.tv/oauth2/validate',
        {
          method: 'GET',
          headers: { authorization: `OAuth ${token.accessToken}` },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!response.ok) {
        check.code =
          response.status === 401 ? 'invalid_token' : 'twitch_unavailable';
        return check;
      }
      const profile = TWITCH_OAUTH_PROFILES[role];
      const info = validateTwitchTokenInfo(await response.json(), {
        clientId: this.d.clientId,
        expectedUserId: profile.expectedUserId,
        requiredScopes: [],
      });
      check.info = info;
      check.validatedAt = checkedAt;
      check.expiresAt = this.now() + info.expiresIn * 1000;
      check.code = profile.scopes.some((scope) => !info.scopes.includes(scope))
        ? 'missing_scopes'
        : 'ready';
    } catch (error) {
      check.code =
        error instanceof TwitchTokenValidationError
          ? error.code
          : 'twitch_unavailable';
    } finally {
      this.checks.set(role, check);
    }
    return check;
  }

  authorize(role: TwitchOAuthRole) {
    if (this.child || this.verifying) throw new Error('busy');
    if (this.d.production) throw new Error('production_profile');
    if (this.tokenPathsConflict()) throw new Error('token_path_conflict');
    if (!this.d.canAuthorize().ok) throw new Error('consumers_active');
    if (!this.d.clientId) throw new Error('configuration_missing');
    const script = join(this.d.botDir, 'dist', 'scripts', 'twitch-auth.js');
    if (!existsSync(script)) throw new Error('bot_not_built');
    const flow: Flow = { role, state: 'starting' };
    this.flow = flow;
    const child = (this.d.spawn ?? nodeSpawn)(
      this.d.nodePath ?? process.execPath,
      [
        `--env-file-if-exists=${this.d.envFile}`,
        script,
        '--studio',
        ...(role === 'broadcaster' ? ['--broadcaster'] : []),
      ],
      {
        cwd: this.d.botDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...this.d.env,
          TWITCH_CLIENT_ID: this.d.clientId,
          TWITCH_TOKEN_FILE: this.d.tokenFiles.bot,
          TWITCH_BROADCASTER_TOKEN_FILE: this.d.tokenFiles.broadcaster,
        },
      },
    );
    this.child = child;
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (this.child !== child || !['starting', 'waiting'].includes(flow.state))
        return;
      buffer += String(chunk);
      if (buffer.length > 16_384) {
        this.failFlow('invalid_cli_response');
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        if (!['starting', 'waiting'].includes(flow.state)) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.role !== role && event.type !== 'error') continue;
          if (event.type === 'authorization') {
            const url = new URL(String(event.url));
            if (
              url.origin !== 'https://id.twitch.tv' ||
              url.pathname !== '/oauth2/authorize' ||
              url.username ||
              url.password ||
              url.searchParams.get('client_id') !== this.d.clientId
            )
              throw new Error();
            flow.authorization_url = url.href;
            flow.state = 'waiting';
          } else if (event.type === 'complete') {
            flow.state = 'complete';
            delete flow.authorization_url;
            this.checks.delete(role);
          } else if (event.type === 'error') {
            // CLI messages / stderr may contain upstream text: only expose an allowlisted code.
            const codes = [
              'wrong_client',
              'wrong_account',
              'not_user_token',
              'missing_scopes',
              'invalid_token_info',
              'timeout',
              'state_mismatch',
              'authorization_denied',
              'missing_code',
              'port_busy',
              'callback_unavailable',
              'invalid_redirect',
              'exchange_failed',
              'missing_refresh_token',
              'invalid_token',
              'store_conflict',
              'invalid_store',
              'store_busy',
              'twitch_unavailable',
              'refresh_rejected',
            ];
            this.failFlow(
              codes.includes(String(event.code))
                ? String(event.code)
                : 'authorization_failed',
            );
          }
        } catch {
          this.failFlow('invalid_cli_response');
        }
      }
    });
    // Drain without logging: the child's stderr is never part of the safe dashboard projection.
    child.stderr?.on('data', () => {});
    child.once('error', () => this.failFlow('authorization_failed'));
    child.once('close', (code: number | null) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.flowTimer);
      if (flow.state === 'starting' || flow.state === 'waiting') {
        flow.state = 'error';
        flow.code = 'authorization_failed';
        delete flow.authorization_url;
      } else if (flow.state === 'complete' && code === 0) {
        // This GET belongs to the user's explicit reauthorization, never to dashboard loading.
        void this.verify(role).catch(() => undefined);
      } else if (flow.state === 'complete') {
        flow.state = 'error';
        flow.code = 'authorization_failed';
      }
    });
    this.flowTimer = setTimeout(() => this.cancel('expired'), FLOW_TIMEOUT);
    this.flowTimer.unref();
  }

  private failFlow(code: string) {
    if (this.flow) {
      this.flow.state = 'error';
      this.flow.code = code;
      delete this.flow.authorization_url;
    }
    this.releaseChild();
  }

  private releaseChild() {
    clearTimeout(this.flowTimer);
    this.child?.kill();
  }

  cancel(state: 'cancelled' | 'expired' = 'cancelled') {
    if (this.child && this.flow) {
      this.flow.state = state;
      delete this.flow.authorization_url;
    }
    this.releaseChild();
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    const closed = new Promise<void>((resolve) =>
      child.once('close', () => resolve()),
    );
    this.cancel();
    await closed;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`))
      return false;
    if (req.headers['x-raptoru-studio'] !== '1') {
      send(res, 403, { error: 'forbidden' });
      return true;
    }
    if (req.method === 'GET' && url.pathname === PREFIX) {
      send(res, 200, this.status());
      return true;
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    try {
      if (url.pathname === `${PREFIX}/cancel`) this.cancel();
      else if (url.pathname === `${PREFIX}/verify`)
        await this.verify(await bodyRole(req));
      else if (url.pathname === `${PREFIX}/authorize`)
        this.authorize(await bodyRole(req));
      else {
        send(res, 404, { error: 'not_found' });
        return true;
      }
      send(res, 200, this.status());
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const allowed = [
        'busy',
        'configuration_missing',
        'consumers_active',
        'bot_not_built',
        'invalid_request',
        'invalid_role',
        'token_path_conflict',
        'production_profile',
      ];
      send(res, code === 'busy' || code === 'consumers_active' ? 409 : 400, {
        error: allowed.includes(code) ? code : 'invalid_request',
      });
    }
    return true;
  }
}

export const createTwitchConnections = (d: TwitchConnectionsDeps) =>
  new TwitchConnections(d);
