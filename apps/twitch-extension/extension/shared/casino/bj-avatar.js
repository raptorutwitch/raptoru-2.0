// Casino V1 — the blackjack's avatars: the Twitch picture the Core cached (`profile_image_url`), else a drawn initial
// on a colour of the viewer (no network, no data: URL). A picture that fails to load becomes that initial: the game
// never depends on an image (prototypes/casino-blackjack/src/avatar.js, adapted to the extension's CSP).
const PALETTE = [['#ff8a5c', '#c2410c'], ['#7cc8ff', '#1d4ed8'], ['#8ef0b4', '#15803d'], ['#c8a0ff', '#6d28d9'], ['#ffd36b', '#b45309'], ['#ff8fb8', '#be185d'], ['#7ee7e0', '#0f766e'], ['#f9a8d4', '#7e22ce']];
const hash = (t) => [...String(t)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function initialHTML(user, name, cls) {
  const [a, b] = PALETTE[hash(user) % PALETTE.length];
  const letter = esc((String(name ?? '?').trim()[0] ?? '?').toUpperCase());
  return `<span class="${cls} av-fb" style="background:linear-gradient(135deg,${a},${b})" aria-hidden="true">${letter}</span>`;
}
/** An avatar: the Twitch picture when it is a safe https URL, else the drawn initial. */
export function avatarHTML(p, cls = 'av') {
  const ok = typeof p.avatar === 'string' && /^https:\/\/static-cdn\.jtvnw\.net\//.test(p.avatar);
  if (!ok) return initialHTML(p.user, p.name, cls);
  return `<img class="${cls}" src="${esc(p.avatar)}" data-user="${esc(p.user)}" data-name="${esc(p.name)}" alt="" loading="lazy" decoding="async" draggable="false">`;
}
/** Once on the root (capture): a broken picture becomes the drawn initial. */
export function repairAvatars(root, signal) {
  root.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img?.tagName !== 'IMG' || img.dataset.user === undefined) return;
      const t = img.ownerDocument.createElement('template');
      t.innerHTML = initialHTML(img.dataset.user, img.dataset.name, img.className);
      img.replaceWith(t.content.firstElementChild);
    },
    { capture: true, signal },
  );
}
