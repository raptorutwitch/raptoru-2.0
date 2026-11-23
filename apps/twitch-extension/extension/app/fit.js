// Composant vidéo : une échelle uniforme pour le Casino (choix d'Antoni du 22/11, docs/CASINO.md § 6). Twitch donne au
// composant une iframe de 3:2 à 65 % de la hauteur du lecteur (console : hauteur cible 65 % depuis le 22/11, 60 %
// avant ; « Dimensions automatiques » désactivées) : ≈ 563 × 376 dans un lecteur normal, ≈ 1141 × 761 en plein écran. Tant qu'un écran du Casino est affiché
// (.cz-host) et que l'iframe est plus petite que la référence (651 × 434, la disposition validée), la page entière est
// réduite d'un bloc (CSS zoom) au lieu de basculer vers les dispositions compactes : même interface, juste plus petite.
// Au-dessus de la référence, rien ne change (pas d'agrandissement). Sous MIN, l'échelle s'arrête et les dispositions
// compactes reprennent le relais. Les autres modules gardent leur propre adaptation (plusieurs mesurent la fenêtre en vh).
export const BASE_W = 651;
export const BASE_H = 434;
export const MIN = 0.6;

/** L'échelle pour une iframe de w × h : 1 à partir de la référence, MIN au plus petit. */
export const scaleFor = (w, h) => Math.max(MIN, Math.min(1, w / BASE_W, h / BASE_H));

export function fitVideoComponent(win = window) {
  const root = win.document.documentElement;
  let last = null;
  const apply = () => {
    const casino = !!win.document.querySelector('.cz-host');
    const raw = casino ? scaleFor(win.innerWidth, win.innerHeight) : 1;
    const z = raw < 0.995 ? Math.round(raw * 1000) / 1000 : 1;
    if (z === last) return;
    last = z;
    root.style.zoom = z < 1 ? String(z) : '';
    root.dataset.scale = String(Math.round(z * 100));
    // app/layout.js remesure la composition (la fenêtre ÷ le zoom).
    win.dispatchEvent(new win.Event('raptoru:scale'));
  };
  win.addEventListener('resize', apply);
  // Le Casino s'ouvre et se ferme dans le panneau : on suit la présence de son écran.
  new win.MutationObserver(apply).observe(win.document.body ?? root, { childList: true, subtree: true });
  apply();
}
