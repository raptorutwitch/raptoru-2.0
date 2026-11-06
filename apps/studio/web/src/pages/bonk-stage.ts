// L'essai du Bonk dans Studio : le VRAI moteur de l'overlay (`bonk-overlay/engine`, son CSS, ses sons d'impact), monté à
// l'échelle sur la scène. Rien n'est redessiné ici : une seule façon d'afficher un Bonk. L'essai reste local : ni Core, ni
// paiement, ni historique, et le renderer de la source OBS n'est jamais concurrencé. Son CSS vit dans une ombre : ses règles
// (`html`, `body`, `#stage`) ne touchent pas la page.

interface Scene {
  setTarget(t: {
    mode: 'manual' | 'fullscreen';
    rect?: { x: number; y: number; w: number; h: number };
  }): void;
  play(o: { id: string; image: HTMLImageElement }): Promise<unknown>;
}
interface Engine {
  createScene(o: {
    stage: HTMLElement;
    audio: unknown;
    document: Document;
  }): Scene;
  createAudioPlayer(): unknown;
  css: string;
}

let loading: Promise<Engine> | null = null;
/** Les modules de l'overlay, servis par Studio : aucune copie, aucun second moteur. */
function loadEngine() {
  return (loading ??= (async () => {
    const url = (p: string) => p;
    const [scene, audio, css] = await Promise.all([
      import(/* @vite-ignore */ url('/bonk-lab/engine/scene.js')),
      import(/* @vite-ignore */ url('/bonk-lab/engine/audio.js')),
      fetch('/bonk-lab/overlay.css').then((r) => {
        if (!r.ok) throw new Error('overlay_unavailable');
        return r.text();
      }),
    ]);
    return { ...scene, ...audio, css } as Engine;
  })().catch((e) => {
    loading = null;
    throw e;
  }));
}

export type Aim = () => Parameters<Scene['setTarget']>[0];

/** `aim` : la cible à l'instant du tir, celle qu'on est en train de régler, enregistrée ou non. */
export async function mountBonkStage(host: HTMLElement, aim: Aim) {
  const m = await loadEngine();
  const fit = document.createElement('div');
  fit.className = 'd-scn__fit bk-fit';
  const shadow = fit.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${m.css}</style><div id="stage"></div>`;
  host.append(fit);
  const scale = () => {
    fit.style.transform = `scale(${host.clientWidth / 1920})`;
  };
  new ResizeObserver(scale).observe(host);
  scale();
  const scene = m.createScene({
    stage: shadow.getElementById('stage')!,
    audio: m.createAudioPlayer(),
    document,
  });
  return {
    async shot(src: string) {
      const image = new Image();
      image.referrerPolicy = 'no-referrer';
      image.src = src;
      await image.decode();
      scene.setTarget(aim());
      await scene.play({ id: crypto.randomUUID(), image });
    },
  };
}
