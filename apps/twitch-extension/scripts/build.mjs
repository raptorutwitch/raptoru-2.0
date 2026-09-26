// Twitch upload package: dist/ = extension/ exactly (static files, no bundler), after checks.
// The Extension Lab never modifies extension/: it substitutes the Twitch helper and the runtime
// config while serving (apps/studio/server/src/extension-lab), so what is tested locally is the
// same code that is uploaded.
import console from 'node:console';
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'extension');
const dist = join(root, 'dist');

// Paths declared in the Twitch developer console (asset hosting).
const ENTRY_POINTS = [
  'panel.html',
  'mobile.html',
  'video_component.html',
  'config.html',
];
for (const entry of ENTRY_POINTS) {
  if (!existsSync(join(src, entry)))
    throw new Error(`missing entry point ${entry}`);
}

// The uploaded package must talk to the production EBS through HTTPS, never to a lab.
const runtime = readFileSync(join(src, 'shared', 'runtime-config.js'), 'utf8');
if (
  !/mode:\s*'connected'/.test(runtime) ||
  !/apiBase:\s*"https:\/\//.test(runtime)
) {
  throw new Error('shared/runtime-config.js is not a production config');
}

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
for (const file of files(src)) {
  const rel = relative(src, file);
  if (/(^|[\\/])(\.env[^\\/]*|twitch-ext-mock\.js|[^\\/]*\.map)$/i.test(rel)) {
    throw new Error(`refusing to package ${rel}`);
  }
}

rmSync(dist, { recursive: true, force: true });
cpSync(src, dist, { recursive: true });
console.log(
  `twitch-extension: ${files(dist).length} files in dist/ (upload as a zip)`,
);
