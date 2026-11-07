// La scène « Sur le stream » : le VRAI overlay de la Tombola (raffle-overlay), celui que charge OBS, dans une iframe en pixels
// 1920 × 1080 mise à l'échelle, sur le damier. Rien n'est redessiné ici. L'overlay vit dans le coin haut droit de l'image :
// `zoom` cadre ce coin pour que le bloc reste lisible dans une petite scène.
//
// - en direct : `preview_url`, il lit le Core comme OBS, sans jouer le son ;
// - en préparation : `&demo=1`, il n'affiche que l'instantané que Studio lui envoie (la prochaine manche).

export interface Stage {
  /** Charge l'overlay à cette adresse ; `null` le décharge (page cachée : plus aucun relevé). */
  load(url: string | null): void;
  /** Mode préparation : l'instantané à afficher. */
  show(snapshot: unknown): void;
  /** Le nombre de lignes que prend le message personnalisé sur l'overlay, 0 sans message. */
  hintLines(): number;
}

export function mountStage(host: HTMLElement, zoom: number): Stage {
  const fit = document.createElement('div');
  fit.className = 'd-scn__fit';
  const frame = document.createElement('iframe');
  frame.className = 'tb-frame';
  frame.title = 'Overlay de la Tombola';
  frame.tabIndex = -1;
  fit.append(frame);
  host.append(fit);
  const scale = () => {
    const w = host.clientWidth;
    const s = (w / 1920) * zoom;
    fit.style.transform = `translateX(${w - 1920 * s}px) scale(${s})`;
  };
  new ResizeObserver(scale).observe(host);
  scale();

  let src = 'about:blank';
  let last: unknown = null;
  const post = () => {
    if (last) frame.contentWindow?.postMessage(last, location.origin);
  };
  frame.addEventListener('load', post);
  return {
    load(url) {
      const next = url ?? 'about:blank';
      if (next === src) return;
      src = next;
      frame.src = next;
    },
    show(snapshot) {
      last = snapshot;
      post();
    },
    hintLines() {
      const el = frame.contentDocument?.querySelector('#hint .hint');
      return el
        ? Math.round(el.getBoundingClientRect().height / (13 * 1.3))
        : 0;
    },
  };
}
