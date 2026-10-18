// Effects player — one-off import of the effect media into Studio's storage, by COPY (originals only read: never moved,
// converted or modified; the copy's hash is checked). Sounds (P0.1) from the SAMMI sound folder, videos (P0.2) from the
// legacy overlay folder; Random Ban V2: its videos from the legacy overlay folder, the flop trumpet from Downloads.
//   npx tsx apps/studio/server/src/effects/import-cli.ts [--from "<…\Documents\Rendu Audacity>"]
//     [--videos-from "<…\Videos\Alertes Twitch Pour Claude\Version webm>"] [--downloads-from "<…\Downloads>"]
//     [--runtime "<runtimeDir>"]
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  EFFECT_SOUNDS,
  EFFECT_VIDEOS,
  INTERACTION_MEDIA,
  RANDOM_BAN_MEDIA,
} from '@raptoru/schemas';
import { AlertMediaStore } from '../alerts/media-store.js';
import { paths } from '../test-lab/local-env.js';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const from = arg('from') ?? join(homedir(), 'Documents', 'Rendu Audacity');
const videosFrom =
  arg('videos-from') ??
  join(homedir(), 'Videos', 'Alertes Twitch Pour Claude', 'Version webm');
const downloadsFrom = arg('downloads-from') ?? join(homedir(), 'Downloads');
const store = await AlertMediaStore.open(
  join(arg('runtime') ?? paths.runtimeDir, 'effects', 'media'),
);
const entries = [
  ...EFFECT_SOUNDS.map((s) => ({ name: s.file, from: join(from, s.file) })),
  ...EFFECT_VIDEOS.map((v) => ({
    name: v.file,
    from: join(videosFrom, v.file),
  })),
  ...INTERACTION_MEDIA.map((m) => ({
    name: m.file,
    from: join(videosFrom, m.file),
  })),
  ...RANDOM_BAN_MEDIA.map((m) => ({
    name: m.file,
    from: join(m.from === 'downloads' ? downloadsFrom : videosFrom, m.file),
  })),
];
console.table(await store.import(entries));
console.log(`store: ${store.dir}`);
const missing = store
  .status(entries.map((e) => e.name))
  .filter((s) => !s.available)
  .map((s) => s.name);
if (missing.length) {
  console.log('missing:', missing.join(', '));
  process.exitCode = 1;
}
