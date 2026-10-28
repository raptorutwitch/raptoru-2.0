import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// A plain Node script (scripts/*.mjs, run without a build): imported by path, typed here.
const SCRIPT: string = '../scripts/halloween-media-install.mjs';
type Result = {
  copied: string[];
  same: string[];
  problems: string[];
  total: number;
};
const { installedDataRoot, installMedia } = (await import(SCRIPT)) as {
  installedDataRoot: (env: Record<string, string | undefined>) => string | null;
  installMedia: (o: { from: string; to: string; check?: boolean }) => Result;
};

// Halloween media install (docs/HALLOWEEN.md § 5): the converted media reach the installed Studio's folder, checked,
// without ever deleting a file; a delivery bundle is verified before it is used; a check writes nothing.

let base = '';
afterEach(() => rm(base, { recursive: true, force: true }));

async function source(files: Record<string, string>) {
  base = await mkdtemp(join(tmpdir(), 'hw-install-'));
  const from = join(base, 'from');
  await mkdir(from);
  for (const [name, body] of Object.entries(files))
    await writeFile(join(from, name), body);
  await writeFile(
    join(from, 'manifest.json'),
    JSON.stringify({
      version: 1,
      media: Object.keys(files).map((f) => ({
        id: f.replace('.webm', ''),
        file: f,
        kind: 'screamer',
      })),
    }),
  );
  return { from, to: join(base, 'to') };
}

describe('Halloween media install', () => {
  it('copies every media, writes the manifest and the checksums; a second run copies nothing', async () => {
    const { from, to } = await source({
      'foxy.webm': 'AAA',
      'bonnie.webm': 'BBB',
    });
    const r = installMedia({ from, to });
    expect(r).toMatchObject({
      copied: ['foxy', 'bonnie'],
      problems: [],
      total: 2,
    });
    const manifest = JSON.parse(
      await readFile(join(to, 'manifest.json'), 'utf8'),
    );
    expect(
      manifest.media.map((m: { sha256: string }) => m.sha256),
    ).toHaveLength(2);
    expect(await readFile(join(to, 'SHA256SUMS.txt'), 'utf8')).toContain(
      '  foxy.webm',
    );
    expect(readdirSync(to).some((f) => f.endsWith('.part'))).toBe(false);
    expect(installMedia({ from, to })).toMatchObject({
      copied: [],
      same: ['foxy', 'bonnie'],
    });
  });

  it('never deletes what the target already holds; --check writes nothing and reports', async () => {
    const { from, to } = await source({ 'foxy.webm': 'AAA' });
    await mkdir(to);
    await writeFile(join(to, 'other.webm'), 'keep me');
    expect(installMedia({ from, to, check: true }).problems).toEqual([
      'foxy : absent dans la destination',
    ]);
    expect(existsSync(join(to, 'foxy.webm'))).toBe(false);
    installMedia({ from, to });
    expect(await readFile(join(to, 'other.webm'), 'utf8')).toBe('keep me');
    expect(installMedia({ from, to, check: true }).problems).toEqual([]);
  });

  it('a delivery bundle is verified first: a damaged file is refused, the others installed', async () => {
    const { from, to } = await source({
      'foxy.webm': 'AAA',
      'bonnie.webm': 'BBB',
    });
    const bundle = join(base, 'bundle');
    installMedia({ from, to: bundle });
    await writeFile(join(bundle, 'bonnie.webm'), 'damaged');
    const r = installMedia({ from: bundle, to });
    expect(r.copied).toEqual(['foxy']);
    expect(r.problems[0]).toMatch(/^bonnie : la source ne correspond pas/);
  });

  it('refuses an odd file name and the same folder as source and target', async () => {
    const { from } = await source({ 'foxy.webm': 'AAA' });
    await writeFile(
      join(from, 'manifest.json'),
      JSON.stringify({ media: [{ id: 'x', file: '../evil.webm' }] }),
    );
    expect(installMedia({ from, to: join(base, 'to') }).problems[0]).toMatch(
      /nom de fichier refusé/,
    );
    expect(() => installMedia({ from, to: from })).toThrow(/identiques/);
  });

  it('finds the installed Studio data folder from its studio.json', async () => {
    base = await mkdtemp(join(tmpdir(), 'hw-appdata-'));
    await mkdir(join(base, 'Raptoru Studio'));
    await writeFile(
      join(base, 'Raptoru Studio', 'studio.json'),
      JSON.stringify({ dataRoot: 'C:/Data/Raptoru 2.0' }),
    );
    expect(installedDataRoot({ APPDATA: base })).toBe('C:/Data/Raptoru 2.0');
    expect(installedDataRoot({ APPDATA: join(base, 'none') })).toBeNull();
  });
});
