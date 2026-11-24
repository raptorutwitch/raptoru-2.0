import { describe, expect, it } from 'vitest';
import { ChaosObsRelay, RELAY_PREFIX } from '../src/chaos/obs-relay.js';

// Relais anti-coupure du curseur d'OBS (docs/chaos/CURSEUR_OBS.md § 5) : une capture sans curseur du même écran, hors
// du cadre, en bas de chaque scène qui contient « Écran ». OBS simulé : scènes, éléments, réglages ; journal des requêtes.

interface Item {
  sourceName: string;
  sceneItemId: number;
  sceneItemIndex: number;
  sceneItemEnabled: boolean;
  locked?: boolean;
  transform?: Record<string, number>;
}

class SceneObs {
  connected = true;
  calls: { type: string; data: Record<string, unknown> }[] = [];
  inputs = new Map<string, { kind: string; settings: Record<string, unknown> }>(
    [
      [
        'Écran',
        {
          kind: 'monitor_capture',
          settings: { monitor_id: 'M1', method: 0, capture_cursor: true },
        },
      ],
      ['Webcam', { kind: 'dshow_input', settings: {} }],
    ],
  );
  scenes = new Map<string, Item[]>([
    [
      'Scène Fullscreen',
      [
        {
          sourceName: 'Fond',
          sceneItemId: 1,
          sceneItemIndex: 0,
          sceneItemEnabled: true,
        },
        {
          sourceName: 'Écran',
          sceneItemId: 2,
          sceneItemIndex: 1,
          sceneItemEnabled: true,
        },
        {
          sourceName: 'Webcam',
          sceneItemId: 3,
          sceneItemIndex: 2,
          sceneItemEnabled: true,
        },
      ],
    ],
    [
      'Scène PS5',
      [
        {
          sourceName: 'Écran',
          sceneItemId: 1,
          sceneItemIndex: 0,
          sceneItemEnabled: false,
        },
      ],
    ],
    [
      'Pause',
      [
        {
          sourceName: 'Image',
          sceneItemId: 1,
          sceneItemIndex: 0,
          sceneItemEnabled: true,
        },
      ],
    ],
  ]);
  private next = 50;
  async request(type: string, data: object): Promise<Record<string, unknown>> {
    const d = data as Record<string, unknown>;
    this.calls.push({ type, data: d });
    if (!this.connected) throw new Error('OBS non connecté');
    const item = () => {
      const it = this.scenes
        .get(String(d.sceneName))
        ?.find((i) => i.sceneItemId === d.sceneItemId);
      if (!it) throw new Error('élément introuvable');
      return it;
    };
    switch (type) {
      case 'GetInputSettings': {
        const i = this.inputs.get(String(d.inputName));
        if (!i) throw new Error('source introuvable');
        return { inputKind: i.kind, inputSettings: { ...i.settings } };
      }
      case 'GetSceneList':
        return {
          currentProgramSceneName: 'Scène Fullscreen',
          scenes: [...this.scenes.keys()].map((sceneName) => ({ sceneName })),
        };
      case 'GetSceneItemList':
        return {
          sceneItems: [...(this.scenes.get(String(d.sceneName)) ?? [])],
        };
      case 'CreateInput': {
        this.inputs.set(String(d.inputName), {
          kind: String(d.inputKind),
          settings: { ...(d.inputSettings as object) },
        });
        return this.add(
          String(d.sceneName),
          String(d.inputName),
          d.sceneItemEnabled === true,
        );
      }
      case 'CreateSceneItem':
        if (!this.inputs.has(String(d.sourceName)))
          throw new Error('source introuvable');
        return this.add(
          String(d.sceneName),
          String(d.sourceName),
          d.sceneItemEnabled === true,
        );
      case 'SetSceneItemTransform':
        item().transform = d.sceneItemTransform as Record<string, number>;
        return {};
      case 'SetSceneItemIndex': {
        const list = this.scenes.get(String(d.sceneName))!;
        const it = item();
        list.splice(list.indexOf(it), 1);
        list.splice(Number(d.sceneItemIndex), 0, it);
        list.forEach((x, i) => (x.sceneItemIndex = i));
        return {};
      }
      case 'SetSceneItemLocked':
        item().locked = d.sceneItemLocked === true;
        return {};
      case 'SetSceneItemEnabled':
        item().sceneItemEnabled = d.sceneItemEnabled === true;
        return {};
      case 'SetInputSettings':
        Object.assign(
          this.inputs.get(String(d.inputName))!.settings,
          d.inputSettings as object,
        );
        return {};
      case 'RemoveSceneItem': {
        const list = this.scenes.get(String(d.sceneName))!;
        list.splice(list.indexOf(item()), 1);
        return {};
      }
      case 'RemoveInput':
        if (!this.inputs.delete(String(d.inputName)))
          throw new Error('source introuvable');
        for (const [k, v] of this.scenes)
          this.scenes.set(
            k,
            v.filter((i) => i.sourceName !== d.inputName),
          );
        return {};
    }
    throw new Error(`requête inattendue : ${type}`);
  }
  private add(scene: string, source: string, enabled: boolean) {
    const list = this.scenes.get(scene)!;
    const it: Item = {
      sourceName: source,
      sceneItemId: this.next++,
      sceneItemIndex: list.length,
      sceneItemEnabled: enabled,
    };
    list.push(it); // OBS ajoute en haut de la scène
    return { sceneItemId: it.sceneItemId };
  }
}

const relay = RELAY_PREFIX + 'Écran';

describe('Chaos › relais anti-coupure du curseur d’OBS', () => {
  it('aperçu : rien n’est modifié ; scènes de la source, réglages copiés (même écran, même méthode, sans curseur)', async () => {
    const obs = new SceneObs();
    const r = new ChaosObsRelay(
      () => obs,
      () => 'Écran',
    );
    const p = await r.plan();
    expect(p).toMatchObject({
      relay,
      exists: false,
      scenes: ['Scène Fullscreen'],
      missing: ['Scène Fullscreen'],
      settings: { monitor_id: 'M1', method: 0, capture_cursor: false },
    });
    expect(obs.calls.every((c) => c.type.startsWith('Get'))).toBe(true);
  });

  it('préparer : relais caché le temps d’être placé hors du cadre, en bas, verrouillé ; puis affiché ; rien d’autre touché', async () => {
    const obs = new SceneObs();
    const r = new ChaosObsRelay(
      () => obs,
      () => 'Écran',
    );
    const res = await r.prepare();
    expect(res.added).toEqual(['Scène Fullscreen']);
    // « Scène PS5 » : « Écran » y est masquée → pas de relais, aucune capture de l'écran du PC n'y tourne.
    expect(obs.scenes.get('Scène PS5')!.map((i) => i.sourceName)).toEqual([
      'Écran',
    ]);
    for (const sc of ['Scène Fullscreen']) {
      const items = obs.scenes.get(sc)!;
      const it = items.find((i) => i.sourceName === relay)!;
      expect(it).toMatchObject({
        sceneItemIndex: 0,
        sceneItemEnabled: true,
        locked: true,
      });
      expect(it.transform).toEqual({
        positionX: -4000,
        positionY: -4000,
        scaleX: 0.002,
        scaleY: 0.002,
      });
      // Placé avant d'être affiché : aucune image de la capture pleine taille dans le stream.
      const mine = obs.calls.filter(
        (c) => c.data.sceneName === sc && c.data.sceneItemId === it.sceneItemId,
      );
      expect(mine.map((c) => c.type)).toEqual([
        'SetSceneItemTransform',
        'SetSceneItemIndex',
        'SetSceneItemLocked',
        'SetSceneItemEnabled',
      ]);
    }
    expect(obs.calls.filter((c) => c.type === 'CreateInput')).toHaveLength(1);
    expect(obs.calls.find((c) => c.type === 'CreateInput')?.data).toMatchObject(
      {
        inputKind: 'monitor_capture',
        sceneItemEnabled: false,
        inputSettings: { monitor_id: 'M1', method: 0, capture_cursor: false },
      },
    );
    // Les autres éléments gardent leur ordre relatif, « Écran » et ses réglages sont intacts.
    expect(
      obs.scenes.get('Scène Fullscreen')!.map((i) => i.sourceName),
    ).toEqual([relay, 'Fond', 'Écran', 'Webcam']);
    expect(obs.inputs.get('Écran')!.settings).toEqual({
      monitor_id: 'M1',
      method: 0,
      capture_cursor: true,
    });
    expect(obs.scenes.get('Pause')!.map((i) => i.sourceName)).toEqual([
      'Image',
    ]);
    expect(obs.calls.some((c) => c.type === 'SetInputSettings')).toBe(false);
    expect((await r.status()).ready).toBe(true);
  });

  it('idempotent : une seconde préparation ne crée rien ; une scène ajoutée plus tard est complétée', async () => {
    const obs = new SceneObs();
    const r = new ChaosObsRelay(
      () => obs,
      () => 'Écran',
    );
    await r.prepare();
    obs.calls = [];
    expect((await r.prepare()).added).toEqual([]);
    expect(obs.calls.some((c) => c.type.startsWith('Create'))).toBe(false);
    obs.scenes.set('Scène Dessin', [
      {
        sourceName: 'Écran',
        sceneItemId: 9,
        sceneItemIndex: 0,
        sceneItemEnabled: true,
      },
    ]);
    expect((await r.status()).missing).toEqual(['Scène Dessin']);
    expect((await r.prepare()).added).toEqual(['Scène Dessin']);
    expect(obs.calls.filter((c) => c.type === 'CreateInput')).toHaveLength(0);
  });

  it('relais posé là où « Écran » est masquée (ou devenue masquée) : retiré par « Préparer », jamais ajouté', async () => {
    const obs = new SceneObs();
    const r = new ChaosObsRelay(
      () => obs,
      () => 'Écran',
    );
    await r.prepare();
    // Antoni masque « Écran » dans « Scène Fullscreen » : le relais y capturerait l'écran pour rien.
    obs.scenes
      .get('Scène Fullscreen')!
      .find((i) => i.sourceName === 'Écran')!.sceneItemEnabled = false;
    const st = await r.status();
    expect(st).toMatchObject({ ready: false, extra: ['Scène Fullscreen'] });
    const res = await r.prepare();
    expect(res.removed_from).toEqual(['Scène Fullscreen']);
    for (const v of obs.scenes.values())
      expect(v.some((i) => i.sourceName === relay)).toBe(false);
    expect(
      obs.scenes.get('Scène Fullscreen')!.map((i) => i.sourceName),
    ).toEqual(['Fond', 'Écran', 'Webcam']);
  });

  it('« Écran » déplacée sur un autre écran : le relais suit au prochain « Préparer » ; retirer = retour arrière complet', async () => {
    const obs = new SceneObs();
    const r = new ChaosObsRelay(
      () => obs,
      () => 'Écran',
    );
    await r.prepare();
    obs.inputs.get('Écran')!.settings.monitor_id = 'M2';
    expect((await r.status()).same_screen).toBe(false);
    await r.prepare();
    expect(obs.inputs.get(relay)!.settings.monitor_id).toBe('M2');
    expect(await r.remove()).toEqual({ removed: true });
    expect([...obs.inputs.keys()]).toEqual(['Écran', 'Webcam']);
    for (const v of obs.scenes.values())
      expect(v.some((i) => i.sourceName === relay)).toBe(false);
  });

  it('refus clairs : OBS déconnecté, source qui n’est pas une capture d’écran', async () => {
    const obs = new SceneObs();
    obs.connected = false;
    await expect(
      new ChaosObsRelay(
        () => obs,
        () => 'Écran',
      ).prepare(),
    ).rejects.toThrow(/OBS non connecté/);
    expect(
      (
        await new ChaosObsRelay(
          () => obs,
          () => 'Écran',
        ).status()
      ).ready,
    ).toBe(false);
    obs.connected = true;
    await expect(
      new ChaosObsRelay(
        () => obs,
        () => 'Webcam',
      ).prepare(),
    ).rejects.toThrow(/pas une capture d'écran/);
  });
});
