import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Studio's copy of the Soundboard files published to Core (docs/SOUNDBOARD.md § Ajouter un son). A file's name is the
// SHA-256 of its bytes: a copy is never stale, and a download is kept only if its bytes match its name. The player and
// the Studio page read the local copy; a missing one is fetched from Core once (concurrent readers share it).

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export class SoundFiles {
  private readonly loading = new Map<string, Promise<Buffer>>();
  constructor(
    private readonly dir: string,
    private readonly fromCore: (fileId: string) => Promise<Buffer>,
  ) {}

  /** Kept after a publication or a download: exactly the bytes named `fileId`, written atomically. */
  async put(fileId: string, bytes: Buffer) {
    if (sha256(bytes) !== fileId) throw new Error('file_mismatch');
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${fileId}.wav`);
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  }

  async get(fileId: string): Promise<Buffer> {
    try {
      return await readFile(join(this.dir, `${fileId}.wav`));
    } catch {
      /* not here yet: from Core */
    }
    let pending = this.loading.get(fileId);
    if (!pending) {
      pending = this.fromCore(fileId)
        .then(async (bytes) => {
          await this.put(fileId, bytes);
          return bytes;
        })
        .finally(() => this.loading.delete(fileId));
      this.loading.set(fileId, pending);
    }
    return pending;
  }
}

/**
 * The original file of each extract published from this Studio, kept on this PC only (never sent to Core), so that a
 * sound can be re-cut later from its whole original with its handles where they were — not from its already cut
 * extract. Keyed by the published file; an original shared by several cuts is stored once. Best effort: without it,
 * the editor re-cuts the published extract.
 */
export interface SoundCut {
  name: string;
  start_ms: number;
  end_ms: number;
}
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const CUT_ID = /^[0-9a-f]{64}$/;

export class SoundSources {
  constructor(private readonly dir: string) {}

  async put(fileId: string, cut: SoundCut, bytes: Buffer) {
    if (!CUT_ID.test(fileId)) throw new Error('invalid_file');
    const source = sha256(bytes);
    await mkdir(join(this.dir, 'originals'), { recursive: true });
    await mkdir(join(this.dir, 'cuts'), { recursive: true });
    const original = join(this.dir, 'originals', source);
    const tmp = `${original}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, original);
    const meta = join(this.dir, 'cuts', `${fileId}.json`);
    await writeFile(`${meta}.tmp`, JSON.stringify({ ...cut, source }));
    await rename(`${meta}.tmp`, meta);
  }

  async get(fileId: string): Promise<{ cut: SoundCut; bytes: Buffer } | null> {
    if (!CUT_ID.test(fileId)) return null;
    try {
      const meta = JSON.parse(
        await readFile(join(this.dir, 'cuts', `${fileId}.json`), 'utf8'),
      ) as SoundCut & { source: string };
      const bytes = await readFile(join(this.dir, 'originals', meta.source));
      if (sha256(bytes) !== meta.source) return null;
      return {
        cut: { name: meta.name, start_ms: meta.start_ms, end_ms: meta.end_ms },
        bytes,
      };
    } catch {
      return null;
    }
  }
}
