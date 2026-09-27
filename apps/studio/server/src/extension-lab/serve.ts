import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { TWITCH_EXT_MOCK_PATH } from './twitch-mock.js';

// Serves the production extension (apps/twitch-extension/extension) under /ext/ for the Extension
// Lab, byte for byte, except two substitutions made on the fly:
// - the Twitch helper <script> becomes the local helper simulation;
// - shared/runtime-config.js points to the Lab EBS (/ext-lab/api).
// The CSP only allows this origin: a lab frame cannot call the production EBS or any other host.

export const EXT_PREFIX = '/ext/';
export const LAB_API_PREFIX = '/ext-lab/api';
const TWITCH_HELPER =
  /<script src="https:\/\/extension-files\.twitch\.tv\/helper\/v1\/twitch-ext\.min\.js"><\/script>/;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export const LAB_RUNTIME_CONFIG_JS = `// Extension Lab (Raptoru Studio): local Lab EBS, fictitious jetons. Never uploaded.
export const RUNTIME = Object.freeze({
  mode: 'connected',
  apiBase: '${LAB_API_PREFIX}',
  siteUrl: '',
  buildId: 'extension-lab',
});
`;

export const EXTENSION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Twitch CDN images only (emotes/avatars of the Bonk Lab catalog); still no network calls.
  "img-src 'self' data: blob: https://static-cdn.jtvnw.net https://cdn.7tv.app https://cdn.betterttv.net https://cdn.frankerfacez.com",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
].join('; ');

export interface ExtensionFile {
  status: number;
  contentType: string;
  body: Buffer | string;
}

/** Resolves /ext/<path> to the served content (with the lab substitutions), or 404. */
export async function extensionFile(
  extensionDir: string,
  pathname: string,
): Promise<ExtensionFile> {
  const rel = normalize(
    decodeURIComponent(pathname.slice(EXT_PREFIX.length)),
  ).replace(/^([/\\])+/, '');
  if (!rel || rel.startsWith('..') || /(^|[\\/])\.\.([\\/]|$)/.test(rel))
    return { status: 404, contentType: 'text/plain', body: 'not found' };
  const type = MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream';
  if (rel.replace(/\\/g, '/') === 'shared/runtime-config.js')
    return { status: 200, contentType: type, body: LAB_RUNTIME_CONFIG_JS };
  try {
    const content = await readFile(join(extensionDir, rel));
    if (extname(rel) === '.html') {
      const html = content.toString('utf8');
      if (!TWITCH_HELPER.test(html))
        return {
          status: 500,
          contentType: 'text/plain',
          body: `${rel}: Twitch helper script not found, cannot run in the lab`,
        };
      return {
        status: 200,
        contentType: type,
        body: html.replace(
          TWITCH_HELPER,
          `<script src="${TWITCH_EXT_MOCK_PATH}"></script>`,
        ),
      };
    }
    return { status: 200, contentType: type, body: content };
  } catch {
    return { status: 404, contentType: 'text/plain', body: 'not found' };
  }
}
