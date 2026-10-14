// Noms d'une ligne trop longs (Soundboard, participants Tombola — profil compact-video validé le
// 14/10/2026) : statiques avec « … » au repos ; au survol ou au focus clavier de leur carte / ligne, le
// texte défile localement (pause, aller, pause, retour : keyframes rl-marquee de soundboard.css). Un seul
// texte bouge à la fois ; seul le texte bouge, jamais la carte.
// Dette UX connue : le défilement reste un peu saccadé ; à reprendre plus tard.
const SPEED = 45; // px/s pendant l'aller (40 % de la boucle)

/** Mesure le débordement à l'entrée du pointeur / du focus dans un élément `item` de `root`. */
export function hoverMarquee(root, item, text) {
  const arm = (event) => {
    const host = event.target.closest?.(item);
    const node = host && root.contains(host) ? host.querySelector(text) : null;
    if (!node) return;
    // Déjà mesuré pour ce texte et cette largeur : rien (pas de relance au passage d'un enfant à l'autre).
    const key = `${node.textContent}|${node.clientWidth}`;
    if (node.dataset.marquee === key) return;
    node.dataset.marquee = key;
    node.classList.remove('rl-marquee');
    const overflow = node.scrollWidth - node.clientWidth;
    if (overflow <= 1) return;
    const distance = overflow + 6;
    node.style.setProperty('--mq-d', `${distance}px`);
    node.style.setProperty('--mq-t', `${Math.max(2.8, distance / SPEED / 0.4).toFixed(2)}s`);
    node.classList.add('rl-marquee');
  };
  root.addEventListener('pointerover', arm);
  root.addEventListener('focusin', arm);
}
