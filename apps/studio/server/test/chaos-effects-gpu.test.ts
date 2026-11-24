import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

// Propriétés visuelles des effets, mesurées par le vrai moteur HORS ÉCRAN (`--measure` : couverture de chaque pixel,
// rendu sur fond noir puis blanc ; rien ne s'affiche, très petite taille). Elles gardent ce que les essais d'Antoni ont
// demandé : paupières fermées = écran entièrement masqué (à toutes les proportions d'écran), brouillard par niveaux
// avec des trouées, tunnel en vrai dégradé.

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', '..');
const REAL =
  process.env.CHAOS_ENGINE_EXE ??
  join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe');
const run = promisify(execFile);

interface Shot {
  t_ms: number;
  min: number;
  mean: number;
  covered95: number;
  covered999: number;
  visible30: number;
  cells_masked90: number;
  cells_clear40: number;
  radial: number[];
}
async function measure(
  effect: string,
  variant: string,
  times: string,
  o: { level?: string; w?: number; h?: number } = {},
): Promise<Shot[]> {
  const args = [
    '--measure',
    effect,
    variant,
    times,
    '--w',
    String(o.w ?? 192),
    '--h',
    String(o.h ?? 108),
  ];
  if (o.level) args.push('--level', o.level);
  const { stdout } = await run(REAL, args, {
    windowsHide: true,
    timeout: 60_000,
  });
  return (JSON.parse(stdout) as { shots: Shot[] }).shots;
}

describe.runIf(process.platform === 'win32' && existsSync(REAL))(
  'effets Chaos : propriétés mesurées hors écran (vrai moteur)',
  () => {
    it('ciblage « écran » de chaque écran branché : tout l’écran, une seule surface par écran (mode E si une fenêtre l’occupe, sinon C)', async () => {
      const { stdout } = await run(REAL, ['--resolve-screens'], {
        windowsHide: true,
        timeout: 30_000,
      });
      const screens = (
        JSON.parse(stdout) as {
          screens: {
            device: string;
            kind?: string;
            key?: string;
            mode?: string;
            error?: string;
            monitor: { x: number };
          }[];
        }
      ).screens;
      expect(screens.length).toBeGreaterThanOrEqual(1);
      for (const s of screens) {
        expect(s.error, s.device).toBeUndefined();
        expect(s.key).toBe(`screen:${s.device}`);
        expect(
          s.kind === 'screen' ? 'E' : s.kind === 'monitor' ? 'C' : '?',
        ).toBe(s.mode);
      }
      // Rangés de gauche à droite, comme dans la fiche.
      const xs = screens.map((s) => s.monitor.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    }, 30_000);

    it('clignement : au plus fort de chaque variante, plus aucun pixel visible (occlusion 100 %)', async () => {
      for (const v of [
        'naturel',
        'rapide',
        'lent',
        'ferme',
        'serie',
        'fatigue',
        'resistance',
        'irregulier',
      ]) {
        const [peak] = await measure('blink', v, 'peak', { w: 128, h: 72 });
        expect(peak!.covered999, `clignement ${v}`).toBe(1);
        expect(peak!.min, `clignement ${v}`).toBeGreaterThanOrEqual(0.999);
      }
    }, 120_000);

    it('clignement fermé : occlusion totale à toutes les proportions d’écran (16:9, 21:9, 4:3, 16:10, portrait)', async () => {
      for (const [w, h] of [
        [192, 108],
        [344, 144],
        [160, 120],
        [160, 100],
        [108, 192],
      ] as const) {
        const [s] = await measure('blink', 'ferme', '2000', { w, h });
        expect(s!.covered999, `${w}×${h}`).toBe(1);
      }
    }, 60_000);

    it('clignement léger : les paupières ne se ferment qu’à moitié (le jeu reste en partie visible)', async () => {
      const [peak] = await measure('blink', 'naturel', 'peak', {
        level: 'leger',
        w: 128,
        h: 72,
      });
      expect(peak!.covered999).toBeLessThan(0.9);
      expect(peak!.visible30).toBeGreaterThan(0.05);
    }, 60_000);

    it('brouillard : quatre niveaux d’occlusion croissante ; Occultant cache des régions entières et laisse des trouées', async () => {
      const mean: Record<string, number> = {};
      const shots: Record<string, Shot[]> = {};
      for (const l of ['leger', 'marque', 'dense', 'extreme']) {
        shots[l] = await measure('fog', 'nappes', '6000,10000,14000', {
          level: l,
        });
        mean[l] = shots[l].reduce((x, s) => x + s.mean, 0) / shots[l].length;
      }
      expect(mean.leger!).toBeLessThan(mean.marque!);
      expect(mean.marque!).toBeLessThan(mean.dense!);
      expect(mean.dense!).toBeLessThan(mean.extreme! + 0.02);
      expect(Math.max(...shots.leger!.map((s) => s.covered95))).toBe(0);
      expect(
        Math.min(...shots.extreme!.map((s) => s.covered999)),
      ).toBeGreaterThan(0.4);
      expect(
        Math.max(...shots.extreme!.map((s) => s.cells_clear40)),
      ).toBeGreaterThan(0);
      // Jamais un aplat : même au plus dense, des écarts de couverture (nappes, bords, trouées).
      for (const s of shots.extreme!) expect(s.mean).toBeLessThan(0.99);
    }, 120_000);

    it('vision tunnel : zone nette, puis ombre qui s’épaissit avec la distance, périphérie presque noire (Extrême)', async () => {
      const [s] = await measure('tunnel', 'focus', '4000', {
        level: 'extreme',
        w: 320,
        h: 180,
      });
      const r = s!.radial;
      expect(r[0]!).toBeLessThan(0.05);
      for (let i = 2; i < 14; i++)
        expect(r[i]!).toBeGreaterThanOrEqual(r[i - 1]! - 0.02);
      expect(r[13]!).toBeGreaterThan(0.85);
      // Un vrai dégradé : plusieurs paliers intermédiaires entre la zone nette et l'ombre.
      expect(
        r.filter((x) => x > 0.15 && x < 0.8).length,
      ).toBeGreaterThanOrEqual(3);
    }, 60_000);
  },
);
