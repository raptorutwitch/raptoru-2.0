import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  liveCsv,
  offscreenCsv,
  PerfError,
  PerfLab,
  reportHtml,
} from '../src/chaos/perf.js';

// Chaos Performance Lab (docs/chaos/PERFORMANCE_LAB.md), avec le vrai moteur quand il est construit. Rien ne
// s'affiche : banc hors écran en très petite taille (--smoke, permis même pendant un jeu : charge négligeable) et
// télémétrie passive ; l'effet d'une « mesure en jeu » passe par un faux pilote (aucun effet réel déclenché).

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', '..');
const REAL =
  process.env.CHAOS_ENGINE_EXE ??
  join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe');

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const until = async (f: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (f()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return f();
};

function lab(calls: { cmd: string; args?: Record<string, unknown> }[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'chaos-perf-'));
  const p = new PerfLab(REAL, dir, (cmd, args) => {
    calls.push({ cmd, args });
    return Promise.resolve({ ok: true });
  });
  cleanup.push(() => {
    p.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return { p, dir };
}

describe.runIf(process.platform === 'win32' && existsSync(REAL))(
  'Chaos Performance Lab (vrai moteur, rien d’affiché)',
  () => {
    it('matériel : carte graphique, processeur, mémoire, écrans', async () => {
      const { p } = lab();
      const s = await p.sysinfo();
      expect(
        String((s.gpu as Record<string, unknown>).name).length,
      ).toBeGreaterThan(2);
      expect(Number(s.memory_mb)).toBeGreaterThan(1000);
      expect(Array.isArray(s.screens)).toBe(true);
    }, 30_000);

    it('banc hors écran : référence, chaque effet (Marqué, Extrême), mesures GPU et CPU, synthèse, exports, rapport gardé', async () => {
      const { p, dir } = lab();
      p.startOffscreen({ width: 160, height: 90, frames: 8, smoke: true });
      expect(() =>
        p.startOffscreen({ width: 160, height: 90, smoke: true }),
      ).toThrow(PerfError);
      await expect(p.startLive({ effect: 'blink' })).rejects.toThrow(/banc/);
      expect(
        await until(() => p.state().offscreen.status !== 'running', 60_000),
      ).toBe(true);
      const st = p.state().offscreen;
      expect(st.status).toBe('done');
      const ids = st.results.map((r) => r.id);
      expect(ids[0]).toBe('reference');
      for (const id of [
        'blink@extreme',
        'fog@extreme',
        'drunk@marque',
        'flip',
        'color',
      ])
        expect(ids).toContain(id);
      for (const r of st.results) {
        expect(['ok', 'partial']).toContain(r.status);
        expect(typeof r.gpu_ms_p50).toBe('number');
        expect(typeof r.cpu_ms_p50).toBe('number');
      }
      const fog = st.results.find((r) => r.id === 'fog@extreme')!;
      expect(typeof fog.gpu_ms_over_reference).toBe('number');
      expect(st.summary).toMatchObject({
        cheapest: expect.any(Array),
        costliest: expect.any(Array),
      });
      expect(st.progress).toMatchObject({
        done: st.results.length,
        total: st.results.length,
      });
      const csv = offscreenCsv(st).split('\r\n');
      expect(csv[0]).toMatch(/^id;label;kind;level;status/);
      expect(csv.length).toBe(st.results.length + 1);
      expect(reportHtml(st, [], null)).toContain('Brouillard');
      // Rapport gardé pour la prochaine ouverture de Studio.
      expect(
        JSON.parse(
          readFileSync(join(dir, 'perf', 'offscreen-last.json'), 'utf8'),
        ).status,
      ).toBe('done');
    }, 90_000);

    it('annulation : le banc s’arrête tout de suite, plus aucun résultat ensuite', async () => {
      const { p } = lab();
      p.startOffscreen({ width: 160, height: 90, frames: 2000, smoke: true });
      expect(
        await until(() => p.state().offscreen.results.length >= 1, 30_000),
      ).toBe(true);
      p.cancelOffscreen();
      const n = p.state().offscreen.results.length;
      await new Promise((r) => setTimeout(r, 1500));
      expect(p.state().offscreen.status).toBe('cancelled');
      expect(p.state().offscreen.results.length).toBeLessThanOrEqual(n + 1);
      // Un nouveau banc peut repartir : le précédent n'occupe plus rien.
      expect(() =>
        p.startOffscreen({ width: 160, height: 90, frames: 4, smoke: true }),
      ).not.toThrow();
      expect(
        await until(() => p.state().offscreen.status === 'done', 60_000),
      ).toBe(true);
    }, 120_000);

    it('mesure en jeu : référence, effet déclenché par la mesure puis arrêté, retour ; écarts par processus ; images/s non mesurées', async () => {
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      const { p } = lab(calls);
      await p.startLive({
        effect: 'blink',
        label: 'Clignement',
        reference_s: 1,
        effect_s: 1,
        after_s: 1,
      });
      await expect(p.startLive({ effect: 'fog' })).rejects.toThrow(PerfError);
      expect(() =>
        p.startOffscreen({ width: 160, height: 90, smoke: true }),
      ).toThrow(/mesure en jeu/);
      expect(
        await until(() => p.state().live.status !== 'running', 15_000),
      ).toBe(true);
      expect(p.state().live.status).toBe('done');
      expect(calls.map((c) => c.cmd)).toEqual([
        'effect.activate',
        'effect.stop',
      ]);
      expect(calls[0]!.args).toMatchObject({
        effect: 'blink',
        kind: 'manual',
        duration_ms: 1000,
      });
      const r = p.state().live_results[0]!;
      expect(r.effect).toBe('blink');
      expect(r.game_fps).toBeNull();
      const phases = r.phases as Record<string, Record<string, unknown>>;
      for (const ph of ['reference', 'effect', 'after'])
        expect(Number(phases[ph]!.samples)).toBeGreaterThan(0);
      expect(r.deltas).toHaveProperty('game_gpu_pct');
      expect(liveCsv(p.state().live_results).split('\r\n')).toHaveLength(2);
    }, 30_000);

    it('arrêt immédiat d’une mesure en jeu : l’effet est arrêté, rien n’est gardé', async () => {
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      const { p } = lab(calls);
      await p.startLive({
        effect: 'fog',
        reference_s: 1,
        effect_s: 5,
        after_s: 5,
      });
      expect(await until(() => calls.length === 1, 5000)).toBe(true);
      await p.stopLive();
      expect(p.state().live.status).toBe('cancelled');
      expect(calls.map((c) => c.cmd)).toEqual([
        'effect.activate',
        'effect.stop',
      ]);
      await new Promise((r) => setTimeout(r, 1500));
      expect(calls).toHaveLength(2);
      expect(p.state().live_results).toHaveLength(0);
    }, 20_000);
  },
);
