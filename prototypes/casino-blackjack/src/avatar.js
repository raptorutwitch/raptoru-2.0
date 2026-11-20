// Blackjack (prototype) — les avatars. Prototype : des visuels de remplacement (dégradé + initiale), générés ici.
// Extension : l'URL Twitch (`profile_image_url`, lue et mise en cache par le Core) ; si elle manque ou ne charge pas,
// ce même visuel de remplacement — le jeu ne dépend jamais de la disponibilité d'une image.
const PALETTE = [['#ff8a5c', '#c2410c'], ['#7cc8ff', '#1d4ed8'], ['#8ef0b4', '#15803d'], ['#c8a0ff', '#6d28d9'], ['#ffd36b', '#b45309'], ['#ff8fb8', '#be185d'], ['#7ee7e0', '#0f766e'], ['#f9a8d4', '#7e22ce']];
const hash = (t) => [...String(t)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Le visuel de remplacement (data URL SVG, aucun réseau). */
export function fallbackAvatar(user, name) {
  const [a, b] = PALETTE[hash(user) % PALETTE.length];
  const letter = (String(name ?? '?').trim()[0] ?? '?').toUpperCase().replace(/[<&>"']/g, '?');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><circle cx="20" cy="20" r="20" fill="url(#g)"/><text x="20" y="26.5" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="18" fill="#fff">${letter}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
/** Une image d'avatar : l'URL fournie si elle est sûre, sinon le remplacement ; une erreur de chargement → remplacement. */
export function avatarHTML(p, cls = 'av') {
  const fb = fallbackAvatar(p.user, p.name);
  const src = typeof p.avatar === 'string' && /^(https:\/\/|data:image\/)/.test(p.avatar) ? p.avatar : fb;
  return `<img class="${cls}" src="${src.replace(/"/g, '%22')}" data-fb="${fb}" alt="" loading="lazy" decoding="async" draggable="false">`;
}
/** À brancher une fois sur la racine (capture) : une image d'avatar cassée prend le remplacement. */
export function repairAvatars(root, signal) {
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (img?.tagName === 'IMG' && img.dataset.fb && img.src !== img.dataset.fb) img.src = img.dataset.fb;
  }, { capture: true, signal });
}
