import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local files of the other apps, read server-side only. Values never leave this process except
// the few non-secret flags/IDs explicitly picked by the Test Lab.

export const REPO_ROOT =
  process.env.RAPTORU_ROOT ??
  fileURLToPath(new URL('../../../../../', import.meta.url));

export const paths = {
  coreDir: join(REPO_ROOT, 'apps', 'core-api'),
  botDir: join(REPO_ROOT, 'apps', 'twitch-bot'),
  coreEnv: join(REPO_ROOT, 'apps', 'core-api', '.env'),
  botEnv: join(REPO_ROOT, 'apps', 'twitch-bot', '.env'),
  tokenFile: join(REPO_ROOT, 'apps', 'twitch-bot', '.twitch-tokens.json'),
  broadcasterTokenFile: join(
    REPO_ROOT,
    'apps',
    'twitch-bot',
    '.twitch-tokens.broadcaster.json',
  ),
  runtimeDir: join(REPO_ROOT, 'apps', 'studio', 'server', '.runtime'),
};

export type EnvFile = Record<string, string>;

export function readEnvFile(path: string): EnvFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const env: EnvFile = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

export interface TokenFileSummary {
  present: boolean;
  login: string | null;
  userId: string | null;
  scopes: string[];
  expiresAt: string | null;
  hasRefreshToken: boolean;
}

/** Non-secret view of the Twitch token file. */
export function readTokenSummary(path = paths.tokenFile): TokenFileSummary {
  try {
    const t = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return {
      present: true,
      login: typeof t.login === 'string' ? t.login : null,
      userId: typeof t.userId === 'string' ? t.userId : null,
      scopes: Array.isArray(t.scopes) ? t.scopes.map(String) : [],
      expiresAt:
        typeof t.expiresAt === 'number'
          ? new Date(t.expiresAt).toISOString()
          : null,
      hasRefreshToken:
        typeof t.refreshToken === 'string' && t.refreshToken.length > 0,
    };
  } catch {
    return {
      present: false,
      login: null,
      userId: null,
      scopes: [],
      expiresAt: null,
      hasRefreshToken: false,
    };
  }
}

const SECRET_KEYS = /SECRET|TOKEN|PASSWORD|DATABASE_URL/;

/** Every secret value known locally (env secrets, DB password, OAuth tokens), for redaction. */
export function collectSecrets(): string[] {
  const values: string[] = [];
  for (const env of [readEnvFile(paths.coreEnv), readEnvFile(paths.botEnv)]) {
    for (const [key, value] of Object.entries(env)) {
      if (!value || !SECRET_KEYS.test(key)) continue;
      values.push(value);
      const password = /^[a-z]+:\/\/[^:/]+:([^@]+)@/i.exec(value)?.[1];
      if (password) values.push(password);
    }
  }
  try {
    const t = JSON.parse(readFileSync(paths.tokenFile, 'utf8')) as Record<
      string,
      unknown
    >;
    for (const key of ['accessToken', 'refreshToken']) {
      if (typeof t[key] === 'string') values.push(t[key]);
    }
  } catch {
    /* no token file */
  }
  try {
    const b = JSON.parse(
      readFileSync(paths.broadcasterTokenFile, 'utf8'),
    ) as Record<string, unknown>;
    for (const key of ['accessToken', 'refreshToken']) {
      if (typeof b[key] === 'string') values.push(b[key]);
    }
  } catch {
    /* no broadcaster token */
  }
  return values.filter((v) => v.length >= 6);
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  // Generic safety net for anything that looks like an OAuth/bearer value.
  return out.replace(/(Bearer|OAuth)\s+[A-Za-z0-9._~+/-]{10,}/g, '$1 ***');
}
