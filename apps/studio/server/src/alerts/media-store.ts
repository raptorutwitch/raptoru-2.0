import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

// Twitch alerts V1 (A2) — the alert media in Studio's own storage (<runtimeDir>/alerts/media, under the data root: it
// survives Studio updates and is never in Git). Same principle as the Tombola launch sounds: content-addressed copies
// (`<sha256>.<ext>`), never a path into the legacy folders at run time. The manifest maps each legacy file name (the
// catalogue's `video` / `audio`) to its copy. Importing only READS the originals and checks the copy's hash.

/** The media the catalogue uses, by legacy name (docs/TWITCH_ALERTS_PARITY_2026-10.md § 3 and A2 raid). */
export const ALERT_MEDIA = [
  'Alerte follow Discord monsieur.webm',
  'Alerte follow Eren.webm',
  'Dofus Ebène Son.webm',
  'Dofus Eliatrope Son.webm',
  'Dofus Emeraude Son.webm',
  'Eren Sub Glitch.webm',
  'Alerte Sub 1.webm',
  'Alerte Sub 5.webm',
  'Alerte Sub 10.webm',
  'Alerte Sub 20.webm',
  'Alerte Bits.webm',
  'MoneyTest.webm',
  'son_follow_discord.mp3',
  'son_follow_eren.mp3',
  'Eren Voiceline Sub.mp3',
  'Son Alerte Don.mp3',
  'Raid Titan.webm',
  'Raptoru_Alerte_Raid_Sound.mp3',
] as const;

/** Where the catalogue's files are kept on the streamer's PC: what the Lab offers to import from, when they exist. */
export const USUAL_FOLDERS = [
  join(homedir(), 'Videos', 'Alertes Twitch Pour Claude', 'Version webm'),
  join(homedir(), 'Documents', 'Twitch', 'Alertes', 'Raid'),
  join(
    homedir(),
    'Documents',
    'Raptoru 2.0 - Livraisons',
    '2026-10-31-halloween-alertes',
  ),
];

/** Studio's settings file: names the data folder of the installed Studio. Read only. */
export const STUDIO_CONFIG = join(
  process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
  'Raptoru Studio',
  'studio.json',
);

/** Where a media can come from: a usual folder (exact names) or the installed Studio's copies (hashed names). */
export interface MediaOrigin {
  id: string;
  label: string;
  path: string;
  /** The installed Studio's own storage: only read, and imported on an explicit confirmation. */
  reserve: boolean;
  files: Map<string, { from: string; sha256?: string }>;
}

const nameKey = (n: string) => n.normalize('NFC').toLowerCase();

async function folderFiles(dir: string, names: readonly string[]) {
  const onDisk = new Map(
    (await readdir(dir).catch(() => [] as string[])).map((f) => [
      nameKey(f),
      f,
    ]),
  );
  const files: MediaOrigin['files'] = new Map();
  for (const name of names) {
    const f = onDisk.get(nameKey(name));
    if (f) files.set(name, { from: join(dir, f) });
  }
  return files;
}

async function reserveOrigin(
  config: string,
  ownDir: string,
  names: readonly string[],
): Promise<MediaOrigin | null> {
  try {
    const { dataRoot } = JSON.parse(await readFile(config, 'utf8')) as {
      dataRoot?: string;
    };
    if (!dataRoot) return null;
    const dir = join(
      dataRoot,
      'apps',
      'studio',
      'server',
      '.runtime',
      'alerts',
      'media',
    );
    if (resolve(dir) === resolve(ownDir)) return null;
    const { files: manifest } = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    ) as Manifest;
    const files: MediaOrigin['files'] = new Map();
    for (const name of names) {
      const e = manifest[name];
      if (e && existsSync(join(dir, e.file)))
        files.set(name, { from: join(dir, e.file), sha256: e.sha256 });
    }
    return {
      id: 'reserve',
      label: 'Copie du Studio installé',
      path: dir,
      reserve: true,
      files,
    };
  } catch {
    return null; // no installed Studio on this PC, or an unreadable manifest: nothing to offer.
  }
}

/** The places on this PC that hold catalogue media, and which ones each holds. Only reads; never copies anything. */
export async function findMediaOrigins(
  names: readonly string[],
  ownDir: string,
  o: { folders?: readonly string[]; config?: string } = {},
) {
  const origins: MediaOrigin[] = [];
  for (const path of o.folders ?? USUAL_FOLDERS) {
    if (!existsSync(path) || resolve(path) === resolve(ownDir)) continue;
    origins.push({
      id: `folder:${origins.length}`,
      label: path.includes('halloween')
        ? 'Livraison Halloween'
        : basename(path),
      path,
      reserve: false,
      files: await folderFiles(path, names),
    });
  }
  const reserve = await reserveOrigin(o.config ?? STUDIO_CONFIG, ownDir, names);
  if (reserve) origins.push(reserve);
  return origins;
}

const TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
};

export interface MediaEntry {
  sha256: string;
  bytes: number;
  file: string;
  source: string;
  imported_at: string;
}

interface Manifest {
  files: Record<string, MediaEntry>;
}

const sha256 = (path: string) =>
  new Promise<string>((ok, ko) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => ok(h.digest('hex')))
      .on('error', ko);
  });

export class AlertMediaStore {
  private manifest: Manifest = { files: {} };

  private constructor(readonly dir: string) {}

  static async open(dir: string) {
    const store = new AlertMediaStore(dir);
    await mkdir(dir, { recursive: true });
    try {
      store.manifest = JSON.parse(
        await readFile(join(dir, 'manifest.json'), 'utf8'),
      ) as Manifest;
    } catch {
      /* first run: empty */
    }
    return store;
  }

  /** The stored copy of a legacy media name, or null when it is missing (never imported, or its file is gone). */
  path(name: string): string | null {
    const e = this.manifest.files[name];
    if (!e) return null;
    const p = join(this.dir, e.file);
    return existsSync(p) ? p : null;
  }

  contentType(name: string) {
    return TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
  }

  /** Availability of each catalogue media (Studio diagnostic). */
  status(names: readonly string[] = ALERT_MEDIA) {
    return names.map((name) => {
      const e = this.manifest.files[name];
      return {
        name,
        available: this.path(name) !== null,
        ...(e ? { bytes: e.bytes, sha256: e.sha256, source: e.source } : {}),
      };
    });
  }

  /**
   * Copies each source file into the store (content-addressed; an identical file already stored is not copied
   * again). The copy's hash must equal the original's; the originals are only read.
   */
  async import(entries: { name: string; from: string; sha256?: string }[]) {
    const report: {
      name: string;
      result: 'copied' | 'unchanged' | 'missing' | 'corrupt';
      from?: string;
    }[] = [];
    for (const { name, from, sha256: expected } of entries) {
      if (!existsSync(from)) {
        report.push({ name, result: 'missing' });
        continue;
      }
      const hash = await sha256(from);
      if (expected && hash !== expected) {
        report.push({ name, result: 'corrupt', from });
        continue;
      }
      const file = `${hash}${extname(name).toLowerCase()}`;
      const target = join(this.dir, file);
      let result: 'copied' | 'unchanged' = 'unchanged';
      if (!existsSync(target) || (await sha256(target)) !== hash) {
        await copyFile(from, `${target}.tmp`);
        if ((await sha256(`${target}.tmp`)) !== hash)
          throw new Error(`copy of ${name} does not match its original`);
        await rename(`${target}.tmp`, target);
        result = 'copied';
      }
      this.manifest.files[name] = {
        sha256: hash,
        bytes: (await stat(target)).size,
        file,
        source: from,
        imported_at: new Date().toISOString(),
      };
      report.push({ name, result, from });
    }
    await writeFile(
      join(this.dir, 'manifest.json.tmp'),
      JSON.stringify(this.manifest, null, 2),
    );
    await rename(
      join(this.dir, 'manifest.json.tmp'),
      join(this.dir, 'manifest.json'),
    );
    return report;
  }
}
