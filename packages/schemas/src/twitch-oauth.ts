/** Approved consent profiles. Runtime feature switches never change these permissions. */
export const TWITCH_OAUTH_PROFILES = {
  bot: {
    expectedUserId: '1239040922',
    login: 'lecroupier_',
    scopes: [
      'user:read:chat',
      'user:write:chat',
      'moderator:read:chatters',
      'moderator:read:followers',
      'moderator:manage:announcements',
      'moderator:manage:banned_users',
    ],
  },
  broadcaster: {
    expectedUserId: '83603689',
    login: 'raptoru_',
    scopes: [
      'bits:read',
      'channel:read:subscriptions',
      'moderator:read:followers',
      'moderation:read',
      'channel:read:redemptions',
      'channel:manage:redemptions',
    ],
  },
} as const;

export type TwitchOAuthRole = keyof typeof TWITCH_OAUTH_PROFILES;

/** Twitch accepts the management permission for redemption reads, too. */
export function hasTwitchScope(
  scopes: readonly string[],
  required: string,
): boolean {
  return (
    scopes.includes(required) ||
    (required === 'channel:read:redemptions' &&
      scopes.includes('channel:manage:redemptions'))
  );
}

export function missingTwitchScopes(
  scopes: readonly string[],
  required: readonly string[],
): string[] {
  return required.filter((scope) => !hasTwitchScope(scopes, scope));
}

export type TwitchTokenValidationCode =
  | 'wrong_client'
  | 'wrong_account'
  | 'not_user_token'
  | 'missing_scopes'
  | 'invalid_token_info';

const MESSAGES: Record<TwitchTokenValidationCode, string> = {
  wrong_client: 'Ce jeton appartient à une autre application Twitch.',
  wrong_account: 'Ce jeton appartient à un autre compte Twitch.',
  not_user_token: 'Une autorisation utilisateur Twitch est nécessaire.',
  missing_scopes:
    'L’autorisation Twitch ne contient pas les droits nécessaires.',
  invalid_token_info: 'La réponse de validation Twitch est invalide.',
};

/** Messages deliberately exclude upstream bodies, credentials and token values. */
export class TwitchTokenValidationError extends Error {
  constructor(readonly code: TwitchTokenValidationCode) {
    super(MESSAGES[code]);
    this.name = 'TwitchTokenValidationError';
  }
}

export interface ValidatedTwitchTokenInfo {
  clientId: string;
  userId: string;
  login: string;
  scopes: string[];
  expiresIn: number;
}

export function validateTwitchTokenInfo(
  info: unknown,
  expected: {
    clientId: string;
    expectedUserId: string;
    requiredScopes: readonly string[];
  },
): ValidatedTwitchTokenInfo {
  if (!info || typeof info !== 'object')
    throw new TwitchTokenValidationError('invalid_token_info');
  const value = info as Record<string, unknown>;
  if (typeof value.client_id !== 'string')
    throw new TwitchTokenValidationError('invalid_token_info');
  if (value.client_id !== expected.clientId)
    throw new TwitchTokenValidationError('wrong_client');
  if (
    typeof value.user_id !== 'string' ||
    !/^\d+$/.test(value.user_id) ||
    typeof value.login !== 'string' ||
    !value.login
  )
    throw new TwitchTokenValidationError('not_user_token');
  if (value.user_id !== expected.expectedUserId)
    throw new TwitchTokenValidationError('wrong_account');
  if (
    typeof value.expires_in !== 'number' ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === 'string')
  )
    throw new TwitchTokenValidationError('invalid_token_info');
  if (missingTwitchScopes(value.scopes, expected.requiredScopes).length)
    throw new TwitchTokenValidationError('missing_scopes');
  return {
    clientId: value.client_id,
    userId: value.user_id,
    login: value.login,
    scopes: [...value.scopes],
    expiresIn: value.expires_in,
  };
}
