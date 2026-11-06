import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Soundboard categories: how the streamer sorts the bank in Studio, one file per profile next to its journal (like the
// Bonk target). Only Studio reads them: the viewers' catalog, prices and purchases stay the Core's.

const SOUND_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const MAX_CATEGORY = 24;

export class SoundLibrary {
  private current: Record<string, string> = {};
  private chain: Promise<unknown> = Promise.resolve();
  private constructor(private readonly file: string) {}

  static async open(file: string) {
    const lib = new SoundLibrary(file);
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as {
        categories?: Record<string, unknown>;
      };
      for (const [id, name] of Object.entries(saved.categories ?? {}))
        if (SOUND_ID.test(id) && typeof name === 'string' && name)
          lib.current[id] = name.slice(0, MAX_CATEGORY);
    } catch {
      /* none or unreadable: no categories yet */
    }
    return lib;
  }

  get categories() {
    return this.current;
  }

  /** `category` empty or null: the sound leaves its category. Writes are atomic and never overlap. */
  set(soundId: unknown, category: unknown) {
    if (typeof soundId !== 'string' || !SOUND_ID.test(soundId))
      throw new Error('invalid_sound');
    if (category !== null && typeof category !== 'string')
      throw new Error('invalid_category');
    const name = category?.trim() ?? '';
    if (name.length > MAX_CATEGORY) throw new Error('invalid_category');
    const next = { ...this.current };
    if (name) next[soundId] = name;
    else delete next[soundId];
    this.current = next;
    const write = async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(
        `${this.file}.tmp`,
        JSON.stringify({ categories: this.current }),
        { mode: 0o600 },
      );
      await rename(`${this.file}.tmp`, this.file);
    };
    const done = this.chain.then(write, write);
    this.chain = done.catch(() => {});
    return done.then(() => this.current);
  }
}
