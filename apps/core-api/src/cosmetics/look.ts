// Boutique cosmétique — THE stylesheet of every title and badge look (docs/COSMETIC_SHOP.md), served by the Core
// (GET /v1/cosmetics/style.css) and loaded as is by raptoru.fr and Studio's preview: the preview is the site's rendering.
// A look is data (CosmeticStyle): the page sets `rc-title` / `rc-badge`, `rc-grad` when there is a gradient, `rc-fx-<effect>`
// and the CSS variables --rc-color, --rc-from, --rc-to, --rc-angle, --rc-weight from the checked values. Nothing typed by a
// person ever becomes CSS. Motion stops for viewers who ask for less (prefers-reduced-motion).

export const COSMETICS_CSS = `/* Raptoru — titres et badges (Boutique cosmétique V1). Généré par le Core. */
.rc-title{font-weight:var(--rc-weight,700);color:var(--rc-color,inherit);display:inline-block}
.rc-title.rc-grad{background-image:linear-gradient(var(--rc-angle,90deg),var(--rc-from),var(--rc-to));-webkit-background-clip:text;background-clip:text;color:transparent}
.rc-fx-glow{text-shadow:0 0 6px var(--rc-color,currentColor),0 0 14px var(--rc-color,currentColor)}
.rc-title.rc-grad.rc-fx-glow{text-shadow:none;filter:drop-shadow(0 0 6px var(--rc-from,currentColor))}
.rc-fx-shine{background-image:linear-gradient(110deg,var(--rc-from,var(--rc-color,#fff)) 40%,#fff 50%,var(--rc-to,var(--rc-color,#fff)) 60%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:rc-shine 3s linear infinite}
.rc-fx-pulse{animation:rc-pulse 2s ease-in-out infinite}
.rc-fx-rainbow{background-image:linear-gradient(90deg,#ff5a5a,#ffb84d,#fff04d,#4dff88,#4dc3ff,#b84dff,#ff5a5a);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:rc-rainbow 5s linear infinite}
.rc-fx-sparkle::after{content:'\\2726';margin-left:.25em;color:var(--rc-color,#ffe27a);display:inline-block;animation:rc-pulse 1.4s ease-in-out infinite}
.rc-badge{display:inline-flex;align-items:center;justify-content:center;width:var(--rc-size,24px);height:var(--rc-size,24px);border-radius:50%;box-shadow:0 0 0 2px var(--rc-color,transparent);font-size:10px;line-height:1;vertical-align:middle;overflow:hidden;background:rgba(255,255,255,.06)}
.rc-badge img{width:100%;height:100%;object-fit:contain;display:block}
.rc-badge.rc-fx-glow{box-shadow:0 0 0 2px var(--rc-color,transparent),0 0 10px var(--rc-color,transparent)}
.rc-badge.rc-fx-sparkle::after,.rc-badge.rc-fx-shine,.rc-badge.rc-fx-rainbow{background-image:none;color:inherit;animation:none;content:none}
@keyframes rc-shine{from{background-position:100% 0}to{background-position:-150% 0}}
@keyframes rc-rainbow{from{background-position:0 0}to{background-position:300% 0}}
@keyframes rc-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.75;transform:scale(1.06)}}
@media (prefers-reduced-motion:reduce){.rc-fx-shine,.rc-fx-pulse,.rc-fx-rainbow,.rc-fx-sparkle::after{animation:none}}
`;
