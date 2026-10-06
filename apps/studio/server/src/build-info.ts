import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './test-lab/local-env.js';

// Which Studio is running, for the Studio page (« À propos ») and the logs: the version and the source
// commit. The packaged app carries build-info.json (written by desktop/scripts/stage.mjs); a dev
// run (`npm run studio`) reads the desktop version and asks git, and says it is a dev build.

export interface BuildInfo {
  version: string;
  /** Short source commit (null when unknown). */
  sha: string | null;
  packaged: boolean;
  builtAt: string | null;
}

let cached: BuildInfo | null = null;

export function buildInfo(root = REPO_ROOT): BuildInfo {
  if (cached) return cached;
  try {
    const b = JSON.parse(
      readFileSync(join(root, 'build-info.json'), 'utf8'),
    ) as { version?: string; sha?: string; built_at?: string };
    cached = {
      version: String(b.version ?? '?'),
      sha: b.sha ? String(b.sha).slice(0, 12) : null,
      packaged: true,
      builtAt: b.built_at ?? null,
    };
  } catch {
    let version = '?';
    try {
      version = String(
        JSON.parse(
          readFileSync(
            join(root, 'apps', 'studio', 'desktop', 'package.json'),
            'utf8',
          ),
        ).version,
      );
    } catch {
      /* unknown */
    }
    let sha: string | null = null;
    try {
      sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim();
    } catch {
      /* not a git checkout */
    }
    cached = { version, sha, packaged: false, builtAt: null };
  }
  return cached;
}
