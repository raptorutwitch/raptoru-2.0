// Assembles the exact content of the packaged app in stage/app (then packed by electron-builder):
// compiled dist folders only, the SQL migrations, and the production dependencies. Never any .env,
// token or runtime file: local data stays in the Raptoru folder (see src/main.ts).
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = join(desktopDir, '..', '..', '..');
const stage = join(desktopDir, 'stage');
const app = join(stage, 'app');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(stage, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// Same relative layout as the repository, so every relative path in the code keeps working.
const copies = [
  'apps/core-api/dist',
  'apps/core-api/package.json',
  'apps/twitch-bot/dist',
  'apps/twitch-bot/package.json',
  'apps/studio/server/dist',
  'apps/studio/server/bonk-overlay',
  'apps/studio/server/package.json',
  'apps/studio/web/dist',
  'apps/studio/desktop/dist',
  'apps/studio/desktop/package.json',
  // Production extension served by the Extension Lab (package.json: ES module type).
  'apps/twitch-extension/extension',
  'apps/twitch-extension/package.json',
  'supabase/migrations',
];
for (const path of copies) {
  const from = join(repo, path);
  if (!existsSync(from))
    throw new Error(`missing ${path}: run the build first`);
  cpSync(from, join(app, path), { recursive: true });
}

// @raptoru/schemas is a workspace package: pack a real copy of its build.
const schemasCopy = join(stage, 'schemas');
cpSync(join(repo, 'packages/schemas/dist'), join(schemasCopy, 'dist'), {
  recursive: true,
});
writeFileSync(
  join(schemasCopy, 'package.json'),
  JSON.stringify(
    {
      ...readJson(join(repo, 'packages/schemas/package.json')),
      version: '0.0.0',
      dependencies: {},
    },
    null,
    2,
  ),
);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) =>
  execFileSync(npm, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
run(['pack', '--pack-destination', '..'], schemasCopy); // relative: the repo path contains a space

const version = (name) =>
  readJson(join(repo, 'node_modules', name, 'package.json')).version;
const desktop = readJson(join(desktopDir, 'package.json'));
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'raptoru-studio',
      productName: 'Raptoru Studio',
      description: 'Raptoru Studio (local control panel)',
      version: desktop.version ?? '0.1.0',
      private: true,
      type: 'module',
      main: 'apps/studio/desktop/dist/main.js',
      dependencies: {
        pg: version('pg'),
        zod: version('zod'),
        'electron-updater': version('electron-updater'),
        '@raptoru/schemas': 'file:../raptoru-schemas-0.0.0.tgz',
      },
    },
    null,
    2,
  ),
);
run(
  [
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
    '--workspaces=false',
    '--install-links',
  ],
  app,
);

// Safety net: nothing secret or local may be in the package.
const forbidden =
  /(^\.env($|\.(?!example$))|twitch-tokens|^\.runtime$|processes\.json)/i;
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (forbidden.test(name))
      throw new Error(`refusing to package ${relative(app, full)}`);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
console.log(
  `staged ${walk(app).length} files in ${relative(repo, app)} (no .env, no token, no runtime file)`,
);
