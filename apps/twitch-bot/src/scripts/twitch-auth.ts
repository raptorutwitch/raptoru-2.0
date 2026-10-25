// Importable OAuth flow. Only a direct CLI invocation starts the callback listener.
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TWITCH_OAUTH_PROFILES,
  TwitchTokenValidationError,
  validateTwitchTokenInfo,
  type TwitchOAuthRole,
} from '@raptoru/schemas';
import {
  authorizationScopes,
  loadTwitchAppConfig,
  twitchTokenPathsConflict,
  type TwitchAppConfig,
} from '../config.js';
import {
  AuthError,
  fileTokenStore,
  requestToken,
  sameTokenVersion,
  TokenStoreError,
  TwitchAuth,
  TWITCH_AUTHORIZE_URL,
  validateAccessToken,
  type TokenStore,
} from '../twitch/auth.js';

const DEFAULT_REDIRECT_URI = 'http://localhost:3789/callback';
const TIMEOUT_MS = 5 * 60 * 1000;

export type TwitchAuthorizationEvent =
  | { type: 'authorization'; url: string; role: TwitchOAuthRole }
  | { type: 'complete'; role: TwitchOAuthRole }
  | {
      type: 'renewed';
      role: TwitchOAuthRole;
      /** False: the stored access token was still valid, nothing rewritten. */
      refreshed: boolean;
      expires_at: string | null;
    }
  | { type: 'error'; code: string; message: string };

export class TwitchAuthorizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CallbackOptions {
  redirectUri: string;
  state: string;
  timeoutMs: number;
  onListening(): void;
  /** Tests inject a fake listener; no network is needed to exercise the callback. */
  serverFactory?: typeof createServer;
}

export function waitForAuthorizationCode({
  redirectUri,
  state,
  timeoutMs,
  onListening,
  serverFactory = createServer,
}: CallbackOptions): Promise<string> {
  const redirect = new URL(redirectUri);
  if (
    redirect.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) ||
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    redirect.search
  )
    throw new TwitchAuthorizationError(
      'invalid_redirect',
      'Le retour OAuth doit utiliser une adresse locale HTTP.',
    );
  return new Promise<string>((resolveCode, reject) => {
    const servers: Server[] = [];
    let settled = false;
    const finish = (error?: TwitchAuthorizationError, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const server of servers) {
        server.close();
      }
      if (error) reject(error);
      else resolveCode(code!);
    };
    const timer = setTimeout(
      () =>
        finish(
          new TwitchAuthorizationError(
            'timeout',
            'L’autorisation Twitch a expiré. Recommence.',
          ),
        ),
      timeoutMs,
    );
    const handler: import('node:http').RequestListener = (req, res) => {
      let incoming: URL;
      try {
        incoming = new URL(req.url ?? '/', redirectUri);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (incoming.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const validState = incoming.searchParams.get('state') === state;
      const code = incoming.searchParams.get('code');
      const denied = incoming.searchParams.has('error');
      const ok = validState && !!code && !denied;
      res.writeHead(ok ? 200 : 400, {
        'content-type': 'text/plain; charset=utf-8',
      });
      // Received is not success: the account, client and granted permissions still need validation.
      res.end(
        ok
          ? 'Raptoru : retour Twitch reçu. Vérification en cours dans Studio.'
          : 'Raptoru : autorisation refusée ou invalide.',
      );
      if (!validState)
        finish(
          new TwitchAuthorizationError(
            'state_mismatch',
            'Le retour OAuth est invalide. Recommence.',
          ),
        );
      else if (denied)
        finish(
          new TwitchAuthorizationError(
            'authorization_denied',
            'L’autorisation Twitch a été refusée.',
          ),
        );
      else if (!code)
        finish(
          new TwitchAuthorizationError(
            'missing_code',
            'Le retour OAuth ne contient pas de code.',
          ),
        );
      else finish(undefined, code);
    };
    const hosts =
      redirect.hostname === '127.0.0.1'
        ? ['127.0.0.1']
        : redirect.hostname === '[::1]'
          ? ['::1']
          : ['127.0.0.1', '::1'];
    void Promise.all(
      hosts.map(
        (host) =>
          new Promise<boolean>((listening, failed) => {
            const server = serverFactory(handler);
            servers.push(server);
            server.once('error', (error: NodeJS.ErrnoException) => {
              if (
                error.code === 'EADDRNOTAVAIL' ||
                error.code === 'EAFNOSUPPORT'
              )
                listening(false);
              else
                failed(
                  new TwitchAuthorizationError(
                    error.code === 'EADDRINUSE'
                      ? 'port_busy'
                      : 'callback_unavailable',
                    error.code === 'EADDRINUSE'
                      ? 'Le port du retour Twitch est déjà utilisé. Ferme l’autre autorisation puis réessaie.'
                      : 'Le retour local Twitch est indisponible.',
                  ),
                );
            });
            server.listen(Number(redirect.port || 80), host, () => {
              if (settled) server.close();
              listening(true);
            });
          }),
      ),
    )
      .then((ready) => {
        if (settled) return;
        if (!ready.some(Boolean))
          finish(
            new TwitchAuthorizationError(
              'callback_unavailable',
              'Le retour local Twitch est indisponible.',
            ),
          );
        else onListening();
      })
      .catch((error: TwitchAuthorizationError) => finish(error));
  });
}

export interface TwitchAuthorizationOptions {
  role: TwitchOAuthRole;
  config: TwitchAppConfig;
  redirectUri?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  store?: TokenStore;
  waitForCode?: (options: CallbackOptions) => Promise<string>;
  emit(event: TwitchAuthorizationEvent): void;
}

/** No environment reads or listener until explicitly invoked. Never opens a browser itself. */
export async function runTwitchAuthorization(
  options: TwitchAuthorizationOptions,
): Promise<void> {
  const { role, config, emit } = options;
  if (twitchTokenPathsConflict(config))
    throw new TwitchAuthorizationError(
      'token_path_conflict',
      'Les fichiers des autorisations bot et broadcaster doivent être distincts.',
    );
  const profile = TWITCH_OAUTH_PROFILES[role];
  const scopes = authorizationScopes(role);
  const store =
    options.store ??
    fileTokenStore(
      role === 'bot'
        ? config.TWITCH_TOKEN_FILE
        : config.TWITCH_BROADCASTER_TOKEN_FILE,
    );
  // Refuse a stale consent attempt if another process changes the grant while the page is open.
  const before = await store.load();
  const state = randomUUID();
  const redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI;
  const authorizeUrl = new URL(TWITCH_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.TWITCH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    force_verify: 'true',
  }).toString();
  const code = await (options.waitForCode ?? waitForAuthorizationCode)({
    redirectUri,
    state,
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
    onListening: () =>
      emit({ type: 'authorization', url: authorizeUrl.toString(), role }),
  });
  const exchanged = await requestToken(
    {
      client_id: config.TWITCH_CLIENT_ID,
      client_secret: config.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    },
    options.fetch,
  );
  if (!exchanged.ok)
    throw new TwitchAuthorizationError(
      'exchange_failed',
      'Twitch a refusé l’échange du code OAuth. Recommence.',
    );
  if (!exchanged.token.refresh_token)
    throw new TwitchAuthorizationError(
      'missing_refresh_token',
      'Twitch n’a pas fourni d’autorisation renouvelable.',
    );
  const info = await validateAccessToken(
    exchanged.token.access_token,
    options.fetch,
  );
  if (!info)
    throw new TwitchAuthorizationError(
      'invalid_token',
      'Twitch a refusé le nouveau jeton.',
    );
  const checked = validateTwitchTokenInfo(info, {
    clientId: config.TWITCH_CLIENT_ID,
    expectedUserId: profile.expectedUserId,
    requiredScopes: scopes,
  });
  // Fixed consent profiles require both explicit read AND manage grants; runtime reads accept either.
  if (scopes.some((scope) => !checked.scopes.includes(scope)))
    throw new TwitchTokenValidationError('missing_scopes');
  const next = {
    accessToken: exchanged.token.access_token,
    refreshToken: exchanged.token.refresh_token,
    scopes: checked.scopes,
    expiresAt: Date.now() + checked.expiresIn * 1000,
    userId: checked.userId,
    login: checked.login,
    revision: randomUUID(),
  };
  if (store.saveIfCurrent) await store.saveIfCurrent(before, next);
  else {
    const save = async (locked: TokenStore) => {
      if (!sameTokenVersion(await locked.load(), before))
        throw new TokenStoreError('store_conflict');
      await locked.save(next);
    };
    if (store.withLock) await store.withLock(save);
    else await save(store);
  }
  emit({ type: 'complete', role });
}

/**
 * Studio « Vérifier » (23/10): the stored grant made usable again WITHOUT a new consent, through the very path the bot
 * runs at start (TwitchAuth: validate, refresh on 401 or near expiry, rotated refresh token kept, new grant validated
 * before it is saved, under the file lock every consumer shares). A refused refresh is final: no retry, the caller
 * asks for a reauthorization. Never logs a token.
 */
export async function runTwitchRenewal(options: {
  role: TwitchOAuthRole;
  config: TwitchAppConfig;
  store?: TokenStore;
  fetch?: typeof fetch;
  now?: () => number;
  emit(event: TwitchAuthorizationEvent): void;
}): Promise<void> {
  const { role, config } = options;
  const auth = new TwitchAuth({
    clientId: config.TWITCH_CLIENT_ID,
    clientSecret: config.TWITCH_CLIENT_SECRET,
    expectedUserId: TWITCH_OAUTH_PROFILES[role].expectedUserId,
    store:
      options.store ??
      fileTokenStore(
        role === 'bot'
          ? config.TWITCH_TOKEN_FILE
          : config.TWITCH_BROADCASTER_TOKEN_FILE,
      ),
    // Scopes are judged by Studio against the consent profile; this only makes the grant usable.
    requiredScopes: [],
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
    log: () => {},
  });
  await auth.init();
  // Valid but about to expire: renewed now rather than left to the next consumer.
  await auth.getAccessToken();
  const status = auth.status();
  options.emit({
    type: 'renewed',
    role,
    refreshed: status.lastRefreshAt !== null,
    expires_at: status.expiresAt,
  });
}

/** Never forward raw system/Twitch/fetch exceptions to stdout. */
export function authorizationErrorEvent(
  error: unknown,
): TwitchAuthorizationEvent & { type: 'error' } {
  if (
    error instanceof TwitchAuthorizationError ||
    error instanceof TwitchTokenValidationError ||
    error instanceof TokenStoreError ||
    error instanceof AuthError
  )
    return { type: 'error', code: error.code, message: error.message };
  return {
    type: 'error',
    code: 'authorization_failed',
    message: 'L’autorisation Twitch n’a pas abouti. Réessaie.',
  };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const studio = args.includes('--studio');
  const emit = (event: TwitchAuthorizationEvent) => {
    if (studio) console.log(JSON.stringify(event));
    else if (event.type === 'authorization') {
      console.log(
        `Compte attendu : ${TWITCH_OAUTH_PROFILES[event.role].login}`,
      );
      console.log(
        `Scopes requested: ${TWITCH_OAUTH_PROFILES[event.role].scopes.join(' ')}`,
      );
      console.log(event.url);
    } else if (event.type === 'complete')
      console.log('Autorisation Twitch vérifiée et enregistrée.');
    else if (event.type === 'renewed')
      console.log(
        event.refreshed
          ? 'Jeton Twitch renouvelé.'
          : 'Jeton Twitch encore valide.',
      );
    else console.error(event.message);
  };
  try {
    const role = args.includes('--broadcaster') ? 'broadcaster' : 'bot';
    if (args.includes('--renew'))
      await runTwitchRenewal({ role, config: loadTwitchAppConfig(), emit });
    else
      await runTwitchAuthorization({
        role,
        config: loadTwitchAppConfig(),
        redirectUri: process.env.TWITCH_REDIRECT_URI,
        emit,
      });
  } catch (error) {
    emit(authorizationErrorEvent(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
