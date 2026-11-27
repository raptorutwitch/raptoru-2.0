// Faux OBS (obs-websocket v5) pour les tests de la diffusion OBS de Chaos : une source « Écran » (capture d'écran,
// 2560 × 1440) avec un filtre V1 et un filtre étranger ; seules les requêtes utilisées sont simulées.
export interface F {
  filterName: string;
  filterKind: string;
  filterEnabled: boolean;
  filterIndex: number;
  filterSettings: Record<string, unknown>;
}

export class FakeObs {
  connected = true;
  log: [string, Record<string, unknown>][] = [];
  filters: F[] = [
    {
      filterName: 'Raptoru Chaos · Retourné',
      filterKind: 'shader_filter',
      filterEnabled: false,
      filterIndex: 0,
      filterSettings: { shader_text: 'v1' },
    },
    {
      filterName: 'Correction des couleurs',
      filterKind: 'color_filter_v2',
      filterEnabled: true,
      filterIndex: 1,
      filterSettings: { gamma: 0.1 },
    },
  ];
  private reindex() {
    this.filters.forEach((f, i) => (f.filterIndex = i));
  }
  private find(name: unknown) {
    const f = this.filters.find((x) => x.filterName === name);
    if (!f)
      throw Object.assign(new Error('introuvable'), { code: 600 }) as Error;
    return f;
  }
  async request(type: string, d: Record<string, unknown>) {
    if (!this.connected) throw new Error('obs_offline');
    this.log.push([type, d]);
    switch (type) {
      case 'GetVersion':
        return { obsVersion: '33.0.1', obsWebSocketVersion: '5.5.4' };
      case 'GetSourceFilterKindList':
        return { sourceFilterKinds: ['shader_filter', 'color_filter_v2'] };
      case 'GetInputList':
        return {
          inputs: [
            { inputName: 'Écran', inputKind: 'monitor_capture' },
            { inputName: 'Cam', inputKind: 'dshow_input' },
          ],
        };
      case 'GetSceneList':
        return { scenes: [{ sceneName: 'Scène Fullscreen' }] };
      case 'GetSceneItemList':
        return { sceneItems: [{ sourceName: 'Écran', sceneItemId: 7 }] };
      case 'GetSceneItemTransform':
        return {
          sceneItemTransform: { sourceWidth: 2560, sourceHeight: 1440 },
        };
      case 'GetSourceFilterList':
        return { filters: this.filters.map((f) => ({ ...f })) };
      case 'CreateSourceFilter':
        if (this.filters.some((f) => f.filterName === d.filterName))
          throw new Error('déjà là');
        this.filters.push({
          filterName: String(d.filterName),
          filterKind: String(d.filterKind),
          filterEnabled: true,
          filterIndex: this.filters.length,
          filterSettings: { ...(d.filterSettings as object) },
        });
        return {};
      case 'SetSourceFilterEnabled':
        this.find(d.filterName).filterEnabled = d.filterEnabled === true;
        return {};
      case 'SetSourceFilterSettings': {
        const f = this.find(d.filterName);
        f.filterSettings = {
          ...(d.overlay === false ? {} : f.filterSettings),
          ...(d.filterSettings as object),
        };
        return {};
      }
      case 'SetSourceFilterIndex': {
        const f = this.find(d.filterName);
        this.filters.splice(this.filters.indexOf(f), 1);
        this.filters.splice(Number(d.filterIndex), 0, f);
        this.reindex();
        return {};
      }
      case 'RemoveSourceFilter':
        this.filters.splice(this.filters.indexOf(this.find(d.filterName)), 1);
        this.reindex();
        return {};
    }
    throw new Error(`requête non simulée : ${type}`);
  }
}
