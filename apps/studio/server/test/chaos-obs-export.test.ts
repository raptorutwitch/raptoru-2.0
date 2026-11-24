import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

// Effets Chaos exportés en filtres OBS pour la source gameplay (docs/chaos/OBS_SOURCE_GAMEPLAY.md) : le shader du
// filtre est celui du moteur, réécrit mécaniquement, et la logique image par image devient une partition PNG. Rien ne
// s'affiche. Le contrôle dans le vrai moteur d'OBS (libobs installée, sans fenêtre) ne tourne que si OBS et
// chaos-obs-check.exe sont présents.

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', '..');
const REAL =
  process.env.CHAOS_ENGINE_EXE ??
  join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe');
const CHECK = join(dirname(REAL), 'chaos-obs-check.exe');
const OBS = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs.dll';
const run = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), 'chaos-obs-export-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Filter {
  name: string;
  shader: string;
  kind: 'filter' | 'overlay';
  effect_file: string;
  activation: Record<string, number | string>;
  track_rows: number;
}
interface Manifest {
  refusal: string | null;
  frames: number;
  total_ms: number;
  filters: Filter[];
}

async function exportFx(effect: string, variant: string, extra: string[] = []) {
  const out = join(dir, `${effect}-${variant}`);
  let code = 0;
  try {
    await run(
      REAL,
      [
        '--obs-export',
        effect,
        variant,
        '--out',
        out,
        '--w',
        '320',
        '--h',
        '180',
        '--duration-ms',
        '3000',
        ...extra,
      ],
      { windowsHide: true, timeout: 60_000 },
    );
  } catch (e) {
    code = (e as { code?: number }).code ?? -1;
  }
  const m = JSON.parse(
    readFileSync(join(out, 'manifest.json'), 'utf8'),
  ) as Manifest;
  return { out, code, m };
}

describe.runIf(process.platform === 'win32' && existsSync(REAL))(
  'Chaos → filtres OBS sur la source gameplay (export du moteur)',
  () => {
    it('retournement, clignement, brouillard, écran ivre : filtres générés depuis les shaders du moteur, partition complète', async () => {
      const cases: [string, string, string[]][] = [
        ['flip', '-', ['filter']],
        ['blink', 'ferme', ['overlay']],
        ['fog', '-', ['overlay']],
        ['drunk', '-', ['filter', 'filter']],
      ];
      for (const [effect, variant, kinds] of cases) {
        const { code, m } = await exportFx(effect, variant);
        expect(code, effect).toBe(0);
        expect(m.refusal, effect).toBeNull();
        expect(
          m.filters.map((f) => f.kind),
          effect,
        ).toEqual(kinds);
        expect(m.frames).toBe(Math.ceil((m.total_ms * 60) / 1000) + 1);
        for (const f of m.filters) {
          const text = readFileSync(f.effect_file, 'utf8');
          // Effet complet pour obs-shaderfilter : technique OBS, aucune constante du moteur en cbuffer, textures d'OBS.
          expect(text).toContain('technique Draw');
          expect(text).toContain('PSChaos');
          expect(text).not.toMatch(/\bcbuffer\b|\bsrc\.|\bsmp\b/);
          expect(existsSync(String(f.activation.chaos_track))).toBe(true);
          expect(f.activation.chaos_frames).toBe(m.frames);
          // Au moins une constante varie (entrée, sortie ou animation) : elle vient de la partition.
          expect(f.track_rows, `${effect} ${f.shader}`).toBeGreaterThan(0);
        }
      }
    });

    it('flash : refusé tant que l’image retenue n’est pas exportée (aucun fichier de filtre)', async () => {
      const { code, m } = await exportFx('flash', '-');
      expect(code).toBe(3);
      expect(m.refusal).toMatch(/image retenue/);
      expect(m.filters).toEqual([]);
    });

    it.runIf(existsSync(CHECK) && existsSync(OBS))(
      'dans le vrai moteur d’OBS installé (sans fenêtre) : compile, suit le moteur, webcam et alerte intactes, fin seule',
      async () => {
        const { out } = await exportFx('blink', 'ferme', ['--refs', '1.5']);
        const report = join(dir, 'obs-check');
        // libobs écrit son journal sur la sortie standard : le rapport se lit dans report.json.
        await run(CHECK, [out, '--out', report], {
          windowsHide: true,
          timeout: 120_000,
        });
        const r = JSON.parse(
          readFileSync(join(report, 'report.json'), 'utf8'),
        ) as {
          ok: boolean;
          effects: {
            compile_errors: string[];
            shots: {
              jeu_vs_moteur: { mean: number };
              webcam_vs_avant: { max: number };
              alerte_vs_avant: { max: number };
            }[];
            temps_reel: { ok: boolean };
          }[];
        };
        const e = r.effects[0];
        expect(e.compile_errors).toEqual([]);
        expect(e.shots[0].jeu_vs_moteur.mean).toBeLessThanOrEqual(1);
        expect(e.shots[0].webcam_vs_avant.max).toBeLessThanOrEqual(1);
        expect(e.shots[0].alerte_vs_avant.max).toBeLessThanOrEqual(1);
        expect(e.temps_reel.ok).toBe(true);
        expect(r.ok).toBe(true);
      },
      150_000,
    );
  },
);
