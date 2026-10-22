// Noms d'une ligne trop longs (Soundboard, participants Tombola — profil compact-video validé le
// 14/10/2026) : statiques avec « … » au repos ; au survol ou au focus clavier de leur carte / ligne, le
// texte défile localement (pause, aller, pause, retour : keyframes rl-marquee de soundboard.css). Un seul
// texte bouge à la fois ; seul le texte bouge, jamais la carte.
// Dette UX connue : le défilement reste un peu saccadé ; à reprendre plus tard.
const SPEED = 45; // px/s pendant l'aller (40 % de la boucle)

/**
 * Mesure le débordement à l'entrée du pointeur / du focus dans un élément `item` de `root`. `inner` (facultatif) :
 * sous-élément de `text` qui porte lui-même l'ellipse (Soundboard) et dont on mesure le débordement.
 */
export function hoverMarquee(root, item, text, inner = null) {
  const arm = (event) => {
    const host = event.target.closest?.(item);
    const node = host && root.contains(host) ? host.querySelector(text) : null;
    if (!node) return;
    // Déjà mesuré pour ce texte et cette largeur : rien (pas de relance au passage d'un enfant à l'autre).
    const key = `${node.textContent}|${node.clientWidth}`;
    if (node.dataset.marquee === key) return;
    node.dataset.marquee = key;
    node.classList.remove('rl-marquee');
    const box = (inner && node.querySelector(inner)) || node;
    const overflow = box.scrollWidth - box.clientWidth;
    if (overflow <= 1) return;
    const distance = overflow + 6;
    node.style.setProperty('--mq-d', `${distance}px`);
    node.style.setProperty('--mq-t', `${Math.max(2.8, distance / SPEED / 0.4).toFixed(2)}s`);
    // Un seul aller (Soundboard) : ~70 px/s, ni trop lent ni brusque.
    node.style.setProperty('--mq-s', `${Math.min(3, Math.max(0.5, distance / 70)).toFixed(2)}s`);
    node.classList.add('rl-marquee');
  };
  root.addEventListener('pointerover', arm);
  root.addEventListener('focusin', arm);
}
