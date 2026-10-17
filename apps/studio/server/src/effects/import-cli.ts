// Effects player (P0.1) — one-off import of the effect sounds into Studio's storage, by COPY (originals only read: never
// moved, converted or modified; the copy's hash is checked).
//   npx tsx apps/studio/server/src/effects/import-cli.ts [--from "<…\Documents\Rendu Audacity>"] [--runtime "<runtimeDir>"]
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EFFECT_SOUNDS } from '@raptoru/schemas';
import { AlertMediaStore } from '../alerts/media-store.js';
import { paths } from '../test-lab/local-env.js';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const from = arg('from') ?? join(homedir(), 'Documents', 'Rendu Audacity');
const store = await AlertMediaStore.open(
  join(arg('runtime') ?? paths.runtimeDir, 'effects', 'media'),
);
const names = EFFECT_SOUNDS.map((s) => s.file);
console.table(
  await store.import(names.map((name) => ({ name, from: join(from, name) }))),
);
console.log(`store: ${store.dir}`);
const missing = store
  .status(names)
  .filter((s) => !s.available)
  .map((s) => s.name);
if (missing.length) {
  console.log('missing:', missing.join(', '));
  process.exitCode = 1;
}
