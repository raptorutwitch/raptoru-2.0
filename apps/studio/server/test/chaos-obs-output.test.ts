import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ChaosObsOutput,
  type ChaosObsPlan,
  V2_PREFIX,
} from '../src/chaos/obs-output.js';
import { type F, FakeObs } from './fixtures/fake-obs.js';

// Diffusion OBS (mode C, docs/chaos/MODE_C.md) : préparation idempotente des filtres « Raptoru Chaos V2 », sessions
// d'activation (réglages → activation au départ → recalage → coupure), STOP ALL, perte d'OBS et réconciliation. OBS et le
// moteur sont simulés ; aucun autre filtre que les V2 n'est jamais modifié.

const dir = mkdtempSync(join(tmpdir(), 'chaos-obs-out-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PLAN: ChaosObsPlan = {
  version: 'v1',
  dir: 'C:/chaos/obs/fx',
  effects: {
    mirror: {
      label: 'Miroir',
      available: true,
      reason: null,
      warnings: [],
      filters: [
        {
          key: 'mirror:transform',
          name: `${V2_PREFIX}Miroir`,
          shader: 'transform',
          kind: 'filter',
          effect_file: 'C:/chaos/obs/fx/transform-aa.effect',
          order: 0,
        },
      ],
    },
    blink: {
      label: 'Clignement',
      available: true,
      reason: null,
      warnings: [],
      filters: [
        {
          key: 'blink:eyelids@calque',
          name: `${V2_PREFIX}Clignement`,
          shader: 'eyelids',
          kind: 'overlay',
          effect_file: 'C:/chaos/obs/fx/eyelids-calque-bb.effect',
          order: 2,
        },
      ],
    },
    drunk: {
      label: 'Écran ivre',
      available: true,
      reason: null,
      warnings: [],
      filters: [
        {
          key: 'drunk:transform',
          name: `${V2_PREFIX}Écran ivre · cadrage`,
          shader: 'transform',
          kind: 'filter',
          effect_file: 'C:/chaos/obs/fx/transform-aa.effect',
          order: 1,
        },
      ],
    },
    flash: {
      label: 'Flash',
      available: false,
      reason: 'image retenue',
      warnings: [],
      filters: [],
    },
  },
};

function setup(name: string) {
  const obs = new FakeObs();
  const engine: [string, unknown][] = [];
  const out = new ChaosObsOutput(
    join(dir, `${name}.json`),
    () => obs,
    async (cmd, args) => {
      engine.push([cmd, args]);
      if (cmd === 'obs.plan') return structuredClone(PLAN);
      return {};
    },
  );
  return { obs, engine, out };
}
const v1 = (obs: FakeObs) =>
  obs.filters
    .filter((f) => !f.filterName.startsWith(V2_PREFIX))
    .map((f) => ({ ...f, filterIndex: undefined }));
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('Chaos › Diffusion OBS (mode C)', () => {
  it('préparation : filtres V2 créés désactivés, passe avant calque, sauvegarde, idempotente ; V1 et filtres étrangers intacts', async () => {
    const { obs, out } = setup('prepare');
    await out.setConfig({ source: 'Écran', device: '\\\\.\\DISPLAY1' });
    const before = v1(obs);
    const pv = await out.preview();
    expect(pv.create).toEqual([
      `${V2_PREFIX}Miroir`,
      `${V2_PREFIX}Écran ivre · cadrage`,
      `${V2_PREFIX}Clignement`,
    ]);
    expect(pv.untouched).toEqual([
      'Raptoru Chaos · Retourné',
      'Correction des couleurs',
    ]);
    expect(pv.unavailable).toEqual([
      { effect: 'flash', reason: 'image retenue' },
    ]);
    const r = await out.prepare(join(dir, 'backups'));
    expect(r.created).toHaveLength(3);
    expect(existsSync(r.backup)).toBe(true);
    expect(
      (JSON.parse(readFileSync(r.backup, 'utf8')) as { filters: F[] }).filters,
    ).toHaveLength(2);
    const v2 = obs.filters.filter((f) => f.filterName.startsWith(V2_PREFIX));
    expect(v2.every((f) => !f.filterEnabled)).toBe(true);
    expect(
      v2.every((f) => f.filterSettings.override_entire_effect === true),
    ).toBe(true);
    // Ordre : passes sur l'image, puis calques ; les filtres existants gardent leur place, en tête.
    expect(obs.filters.map((f) => f.filterName)).toEqual([
      'Raptoru Chaos · Retourné',
      'Correction des couleurs',
      `${V2_PREFIX}Miroir`,
      `${V2_PREFIX}Écran ivre · cadrage`,
      `${V2_PREFIX}Clignement`,
    ]);
    expect(v1(obs)).toEqual(before);
    const again = await out.prepare(join(dir, 'backups'));
    expect(again.created).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(obs.filters).toHaveLength(5);
    // Retour arrière : seuls les V2 partent.
    const rm = await out.remove();
    expect(rm.removed).toHaveLength(3);
    expect(v1(obs)).toEqual(before);
  });

  it('sorties d’une activation : écran + OBS si tout est prêt, sinon écran seul et la raison (ou refus en « OBS uniquement »)', async () => {
    const { obs, out } = setup('outputs');
    expect((await out.outputsFor('mirror')).outputs).toEqual(['screen']); // filtres non préparés
    await out.setConfig({ source: 'Écran', device: '\\\\.\\DISPLAY1' });
    expect((await out.outputsFor('mirror')).note).toMatch(/à préparer/);
    await out.prepare(join(dir, 'backups'));
    const ok = await out.outputsFor('mirror');
    expect(ok).toEqual({
      outputs: ['screen', 'obs'],
      obs: { device: '\\\\.\\DISPLAY1', width: 2560, height: 1440 },
    });
    const flash = await out.outputsFor('flash');
    expect(flash.outputs).toEqual(['screen']);
    expect(flash.note).toMatch(/pas de version OBS/);
    await out.setConfig({ mode: 'obs' });
    expect((await out.outputsFor('mirror')).outputs).toEqual(['obs']);
    obs.connected = false;
    await expect(out.outputsFor('mirror')).rejects.toThrow(/OBS non connecté/);
    await out.setConfig({ mode: 'screen' });
    expect(await out.outputsFor('mirror')).toEqual({ outputs: ['screen'] });
  });

  it('session : réglages avant le départ, activation au départ, recalage à l’arrêt anticipé, coupure à la fin ; rien d’autre touché', async () => {
    const { obs, out } = setup('session');
    await out.setConfig({ source: 'Écran', device: '\\\\.\\DISPLAY1' });
    await out.prepare(join(dir, 'backups'));
    await out.status(true);
    const before = v1(obs);
    obs.log = [];
    const filters = [
      {
        key: 'mirror:transform',
        settings: { chaos_track: 'a.png', chaos_frames: 200, chaos_t_base: 0 },
      },
    ];
    out.onEngineEvent({
      event: 'effect.obs',
      phase: 'prepare',
      request_id: 'r1',
      effect: 'mirror',
      filters,
    });
    await settle();
    const m = () =>
      obs.filters.find((f) => f.filterName === `${V2_PREFIX}Miroir`)!;
    expect(m().filterEnabled).toBe(false);
    expect(m().filterSettings.chaos_track).toBe('a.png');
    out.onEngineEvent({
      event: 'effect.started',
      request_id: 'r1',
      outputs: { screen: true, obs: true },
    });
    await settle();
    expect(m().filterEnabled).toBe(true);
    out.onEngineEvent({
      event: 'effect.obs',
      phase: 'retime',
      why: 'stop',
      request_id: 'r1',
      effect: 'mirror',
      filters: [
        {
          key: 'mirror:transform',
          settings: {
            chaos_track: 'b.png',
            chaos_frames: 30,
            chaos_t_base: 1.2,
          },
        },
      ],
    });
    await settle();
    expect(m().filterSettings).toMatchObject({
      chaos_track: 'b.png',
      chaos_t_base: 1.2,
    });
    expect(m().filterEnabled).toBe(true);
    out.onEngineEvent({ event: 'effect.ended', request_id: 'r1' });
    await settle();
    expect(m().filterEnabled).toBe(false);
    expect(obs.log.map(([t]) => t)).toEqual([
      'SetSourceFilterSettings',
      'SetSourceFilterEnabled',
      'SetSourceFilterSettings',
      'SetSourceFilterEnabled',
    ]);
    expect(v1(obs)).toEqual(before);
  });

  it('STOP ALL, arrêt d’urgence : seuls les filtres V2 actifs sont coupés (un filtre V1 ou étranger actif reste actif)', async () => {
    const { obs, out } = setup('stopall');
    await out.setConfig({ source: 'Écran', device: '\\\\.\\DISPLAY1' });
    await out.prepare(join(dir, 'backups'));
    for (const f of obs.filters) f.filterEnabled = true; // y compris le V1 « Retourné »
    expect((await out.disableAll('STOP ALL')).disabled).toBe(3);
    expect(
      obs.filters.filter((f) => f.filterEnabled).map((f) => f.filterName),
    ).toEqual(['Raptoru Chaos · Retourné', 'Correction des couleurs']);
    for (const f of obs.filters)
      if (f.filterName.startsWith(V2_PREFIX)) f.filterEnabled = true;
    out.onEngineEvent({ event: 'engine.emergency_stop' });
    await settle();
    expect(
      obs.filters.filter(
        (f) => f.filterName.startsWith(V2_PREFIX) && f.filterEnabled,
      ),
    ).toEqual([]);
  });

  it('protection anti-double refusée par Windows : la sortie OBS est coupée et l’incident affiché', async () => {
    const { obs, out } = setup('blocked');
    await out.setConfig({ source: 'Écran', device: '\\\\.\\DISPLAY1' });
    await out.prepare(join(dir, 'backups'));
    await out.status(true);
    out.onEngineEvent({
      event: 'effect.obs',
      phase: 'prepare',
      request_id: 'r2',
      effect: 'blink',
      filters: [{ key: 'blink:eyelids@calque', settings: {} }],
    });
    out.onEngineEvent({
      event: 'effect.obs',
      phase: 'blocked',
      request_id: 'r2',
      effect: 'blink',
      reason: 'exclusion_failed',
    });
    out.onEngineEvent({
      event: 'effect.started',
      request_id: 'r2',
      outputs: { screen: true, obs: false },
    });
    await settle();
    expect(
      obs.filters.find((f) => f.filterName === `${V2_PREFIX}Clignement`)!
        .filterEnabled,
    ).toBe(false);
    expect(out.lastIncident?.message).toMatch(/anti-double impossible/);
    const st = await out.status(true);
    expect((st.sessions as { state: string }[])[0]!.state).toBe('failed');
  });

  it('OBS perdu pendant un effet : le moteur cesse d’exclure le calque ; à la reconnexion, aucun filtre V2 ne reste actif', async () => {
    const { obs, out, engine } = setup('lost');
    await out.setConfig({ source: 'Écran', device: '\\\\.\\DISPLAY1' });
    await out.prepare(join(dir, 'backups'));
    await out.status(true);
    out.start();
    await new Promise((r) => setTimeout(r, 1100)); // premier relevé : connecté
    out.onEngineEvent({
      event: 'effect.obs',
      phase: 'prepare',
      request_id: 'r3',
      effect: 'mirror',
      filters: [{ key: 'mirror:transform', settings: {} }],
    });
    out.onEngineEvent({
      event: 'effect.started',
      request_id: 'r3',
      outputs: { obs: true },
    });
    await settle();
    obs.connected = false;
    await new Promise((r) => setTimeout(r, 1100));
    expect(
      engine.some(
        ([c, a]) =>
          c === 'effect.obs_lost' &&
          (a as { request_id: string }).request_id === 'r3',
      ),
    ).toBe(true);
    // OBS relancé avec le filtre resté actif dans sa collection : coupé à la reconnexion.
    obs.connected = true;
    await new Promise((r) => setTimeout(r, 1100));
    out.stop();
    expect(
      obs.filters.filter(
        (f) => f.filterName.startsWith(V2_PREFIX) && f.filterEnabled,
      ),
    ).toEqual([]);
  });

  it('plan du moteur changé depuis la préparation : la session échoue proprement (moteur prévenu, rien activé)', async () => {
    const { obs, out, engine } = setup('stale');
    await out.setConfig({ source: 'Écran', device: '\\\\.\\DISPLAY1' });
    await out.prepare(join(dir, 'backups'));
    await out.status(true);
    out.onEngineEvent({
      event: 'effect.obs',
      phase: 'prepare',
      request_id: 'r4',
      effect: 'zoom',
      filters: [{ key: 'zoom:transform', settings: {} }],
    });
    out.onEngineEvent({
      event: 'effect.started',
      request_id: 'r4',
      outputs: { obs: true },
    });
    await settle();
    expect(engine.some(([c]) => c === 'effect.obs_lost')).toBe(true);
    expect(
      obs.filters.filter(
        (f) => f.filterEnabled && f.filterName.startsWith(V2_PREFIX),
      ),
    ).toEqual([]);
  });
});
