import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ChaosObsCursor } from '../src/chaos/obs-cursor.js';

// Curseur d'OBS pendant un effet à curseur dessiné (docs/chaos/CURSEUR_OBS.md) : « Capturer le curseur » de la source
// coupé pendant l'effet, valeur d'avant rétablie à la fin ; rien d'autre n'est demandé à OBS. OBS simulé.

const dir = mkdtempSync(join(tmpdir(), 'chaos-obs-cursor-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const D1 = '\\\\.\\DISPLAY1';
const D2 = '\\\\.\\DISPLAY2';
const CURSOR_FX = new Set([
  'mirror',
  'flip',
  'zoom',
  'shake',
  'drunk',
  'tunnel',
]);

class FakeObs {
  connected = true;
  kind = 'monitor_capture';
  settings: Record<string, unknown> = { monitor_id: 'X', method: 1 };
  calls: { type: string; data: Record<string, unknown> }[] = [];
  async request(type: string, data: object): Promise<Record<string, unknown>> {
    const d = data as Record<string, unknown>;
    this.calls.push({ type, data: d });
    if (!this.connected) throw new Error('OBS non connecté');
    if (d.inputName !== undefined && d.inputName !== 'Écran')
      throw new Error(`source inattendue : ${String(d.inputName)}`);
    if (type === 'GetInputSettings')
      return { inputKind: this.kind, inputSettings: { ...this.settings } };
    if (type === 'GetInputDefaultSettings')
      return { defaultInputSettings: { capture_cursor: true, method: 0 } };
    if (type === 'SetInputSettings') {
      Object.assign(this.settings, d.inputSettings as object);
      return {};
    }
    throw new Error(`requête inattendue : ${type}`);
  }
  sets() {
    return this.calls
      .filter((c) => c.type === 'SetInputSettings')
      .map(
        (c) => (c.data.inputSettings as Record<string, unknown>).capture_cursor,
      );
  }
}

let n = 0;
function rig(opts: { enabled?: boolean; obs?: FakeObs; file?: string } = {}) {
  const obs = opts.obs ?? new FakeObs();
  const file = opts.file ?? join(dir, `c${++n}.json`);
  const c = new ChaosObsCursor(
    file,
    () => obs,
    () => ({ source: 'Écran', device: D1 }),
    async (effect) => CURSOR_FX.has(effect),
    () => {},
    Date.now,
    40,
  );
  return { obs, c, file };
}
const ev = (
  event: string,
  id: string,
  effect = 'mirror',
  device = D1,
  extra: Record<string, unknown> = {},
) => ({
  event: `effect.${event}`,
  request_id: id,
  effect,
  target: { kind: 'screen', device, input: null },
  outputs: { screen: true, obs: false },
  ...extra,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Chaos › curseur d’OBS pendant les effets à curseur dessiné', () => {
  it('désactivé par défaut : aucune requête à OBS, même pendant un miroir', async () => {
    const { obs, c } = rig();
    await c.load();
    c.onEngineEvent(ev('accepted', 'a'));
    c.onEngineEvent(ev('started', 'a'));
    await wait(30);
    c.onEngineEvent(ev('ended', 'a'));
    await wait(80);
    expect(obs.calls).toEqual([]);
  });

  it('miroir : coupé au départ, valeur d’avant rétablie à la fin ; seule « Capturer le curseur » de « Écran » change', async () => {
    const { obs, c, file } = rig();
    await c.load();
    await c.setEnabled(true);
    c.onEngineEvent(ev('accepted', 'a'));
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(false));
    expect(JSON.parse(readFileSync(file, 'utf8')).saved).toMatchObject({
      source: 'Écran',
      key: 'capture_cursor',
      previous: true,
    });
    c.onEngineEvent(ev('started', 'a'));
    c.onEngineEvent(ev('ended', 'a'));
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(true));
    expect(obs.sets()).toEqual([false, true]);
    // Valeur absente des réglages (défaut d'OBS) : lue dans les réglages par défaut du type de source.
    expect(obs.calls.map((x) => x.type)).toEqual([
      'GetInputSettings',
      'GetInputDefaultSettings',
      'SetInputSettings',
      'SetInputSettings',
    ]);
    for (const s of obs.calls.filter((x) => x.type === 'SetInputSettings')) {
      expect(s.data.overlay).toBe(true); // fusion : la source n'est ni remise à zéro ni recréée
      expect(Object.keys(s.data.inputSettings as object)).toEqual([
        'capture_cursor',
      ]);
    }
    expect(obs.settings).toMatchObject({ monitor_id: 'X', method: 1 });
    await vi.waitFor(() =>
      expect(JSON.parse(readFileSync(file, 'utf8')).saved).toBeNull(),
    );
  });

  it('effets sans curseur dessiné, autre écran, sortie OBS (filtres) : rien ne change', async () => {
    const { obs, c } = rig();
    await c.setEnabled(true);
    c.onEngineEvent(ev('accepted', 'b', 'blink'));
    c.onEngineEvent(ev('accepted', 'v', 'vhs'));
    c.onEngineEvent(ev('accepted', 'o', 'mirror', D2));
    c.onEngineEvent(
      ev('accepted', 'f', 'flip', D1, { outputs: { screen: true, obs: true } }),
    );
    c.onEngineEvent(
      ev('accepted', 'w', 'flip', D1, {
        target: { device: D1, input: 'invert_xy' },
      }),
    );
    await wait(80);
    expect(obs.calls).toEqual([]);
  });

  it('effets simultanés puis enchaînés : une seule coupure, rétabli après le dernier', async () => {
    const { obs, c } = rig();
    await c.setEnabled(true);
    c.onEngineEvent(ev('accepted', 'a', 'mirror'));
    c.onEngineEvent(ev('accepted', 'b', 'zoom'));
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(false));
    c.onEngineEvent(ev('ended', 'a'));
    await wait(80);
    expect(obs.settings.capture_cursor).toBe(false); // b dessine encore son curseur
    c.onEngineEvent(ev('ended', 'b'));
    await wait(10);
    c.onEngineEvent(ev('accepted', 'c', 'shake')); // enchaîné dans le délai : pas de seconde coupure
    await wait(80);
    expect(obs.settings.capture_cursor).toBe(false);
    c.onEngineEvent(ev('canceled', 'c'));
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(true));
    expect(obs.sets()).toEqual([false, true]);
  });

  it('STOP ALL et arrêt du moteur : rétabli tout de suite, sans attendre la fin des effets', async () => {
    const { obs, c } = rig();
    await c.setEnabled(true);
    c.onEngineEvent(ev('accepted', 'a'));
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(false));
    await c.releaseAll();
    expect(obs.settings.capture_cursor).toBe(true);
    c.onEngineEvent(ev('ended', 'a')); // la fin arrive ensuite : rien de plus
    await wait(80);
    expect(obs.sets()).toEqual([false, true]);
  });

  it('curseur déjà coupé par Antoni : laissé tel quel, rien à rétablir', async () => {
    const obs = new FakeObs();
    obs.settings.capture_cursor = false;
    const { c } = rig({ obs });
    await c.setEnabled(true);
    c.onEngineEvent(ev('accepted', 'a'));
    await wait(40);
    c.onEngineEvent(ev('ended', 'a'));
    await wait(100);
    expect(obs.sets()).toEqual([]);
    expect(obs.settings.capture_cursor).toBe(false);
  });

  it('OBS déconnecté pendant l’effet : rétabli à la reconnexion ; OBS redémarré curseur rétabli pendant l’effet : recoupé', async () => {
    const { obs, c } = rig();
    c.start();
    await c.setEnabled(true);
    c.onEngineEvent(ev('accepted', 'a'));
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(false));
    // OBS redémarre pendant l'effet sans avoir enregistré la coupure : il revient avec le curseur capturé.
    obs.connected = false;
    await wait(1100);
    obs.settings.capture_cursor = true;
    obs.connected = true;
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(false), {
      timeout: 3000,
    });
    // Fin pendant une nouvelle coupure d'OBS : rétabli dès son retour.
    obs.connected = false;
    c.onEngineEvent(ev('ended', 'a'));
    await wait(200);
    obs.connected = true;
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(true), {
      timeout: 3000,
    });
    c.stop();
  });

  it('Studio redémarré pendant un effet : la valeur gardée sur disque est rétablie à la première connexion', async () => {
    const file = join(dir, 'restart.json');
    const first = rig({ file });
    await first.c.setEnabled(true);
    first.c.onEngineEvent(ev('accepted', 'a'));
    await vi.waitFor(() =>
      expect(first.obs.settings.capture_cursor).toBe(false),
    );
    // Studio s'arrête net (aucune fin d'effet reçue) ; OBS garde la coupure.
    const second = rig({ file, obs: first.obs });
    await second.c.load();
    expect(second.c.status().pending_restore).toBe('Écran');
    second.c.start();
    await vi.waitFor(
      () => expect(first.obs.settings.capture_cursor).toBe(true),
      { timeout: 3000 },
    );
    // Fichier écrit juste après la requête à OBS : attendu, pas lu au vol.
    await vi.waitFor(() =>
      expect(JSON.parse(readFileSync(file, 'utf8')).saved).toBeNull(),
    );
    second.c.stop();
  });

  it('désactiver pendant un effet rétablit la valeur ; aucun fichier tant que rien n’est réglé', async () => {
    const { obs, c, file } = rig();
    expect(existsSync(file)).toBe(false);
    await c.setEnabled(true);
    c.onEngineEvent(ev('accepted', 'a'));
    await vi.waitFor(() => expect(obs.settings.capture_cursor).toBe(false));
    await c.setEnabled(false);
    expect(obs.settings.capture_cursor).toBe(true);
  });
});
