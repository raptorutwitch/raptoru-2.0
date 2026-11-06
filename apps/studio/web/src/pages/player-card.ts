import { esc, pp } from '../ds/ds.js';

// Un viewer tel que raptoru.fr le dessine : la même géométrie (l'avatar occupe 62,5 % de l'emplacement du cadre), les mêmes
// habillages de titre, la feuille d'apparences du Core. Progression et Boutique montrent ainsi le résultat final, pas une
// imitation. Référence : public/app/card.js et cosmetics.js du site. Aucune règle ici : le Core dit ce qui est porté.

export interface Look {
  color?: string | null;
  gradient?: { from: string; to: string; angle: number } | null;
  effect?: string;
  weight?: 'normal' | 'bold';
}
export interface TitleLook {
  label: string;
  rarity?: string;
  style?: Look;
}
export interface BadgeLook {
  label: string;
  rarity?: string;
  image?: string | null;
}
export interface Wearer {
  name: string;
  avatar?: string | null;
  title?: TitleLook | null;
  badges?: BadgeLook[];
  frame?: string | null;
  banner?: string | null;
}

export const RARITIES = [
  'common',
  'rare',
  'epic',
  'legendary',
  'event',
] as const;
export const RARITY_FR: Record<string, string> = {
  common: 'Commun',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
  event: 'Événement',
};
const SKIN: Record<string, string> = {
  common: 'plaque',
  rare: 'plaque',
  epic: 'ruban',
  legendary: 'plaque',
  event: 'ruban',
};
const GEM: Record<string, string> = {
  common: '<circle cx="8" cy="8" r="4.5"/>',
  rare: '<path d="M8 2.5 13.5 8 8 13.5 2.5 8Z"/>',
  epic: '<path d="M8 2 13.2 5v6L8 14 2.8 11V5Z"/>',
  legendary:
    '<path d="M8 1.5 9.8 6.2 14.5 8 9.8 9.8 8 14.5 6.2 9.8 1.5 8 6.2 6.2Z"/>',
  event:
    '<path d="M8 1.8c.8 2.8 4.6 3.9 4.6 7.6a4.6 4.6 0 0 1-9.2 0c0-2 1.2-3.2 1.9-3.8 0 1.3.7 2 1.4 2 0-1.9-.4-3.9 1.3-5.8Z"/>',
};
const rarity = (r?: string) => (r && RARITY_FR[r] ? r : 'common');
export const gem = (r?: string) =>
  `<svg class="pc-gem" data-r="${rarity(r)}" viewBox="0 0 16 16" aria-hidden="true">${GEM[rarity(r)]}</svg>`;

/** La feuille d'apparences du Core, une fois : l'aperçu est le rendu du site. */
export function coreStyle() {
  if (document.querySelector('link[data-rc-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/cosmetics/style.css';
  link.dataset.rcStyle = '1';
  document.head.append(link);
}

/** L'image d'un objet, servie par Studio (le Core donne son adresse publique). */
export const imageUrl = (u?: string | null) =>
  u ? u.replace(/^\/v1\/cosmetics\/images\//, '/cosmetics/images/') : null;
export const imageOf = (id?: string | null) =>
  id ? `/cosmetics/images/${id}` : null;

/** L'apparence sur un élément : les classes et variables de la feuille du Core, jamais du HTML ni du CSS saisi. */
export function applyLook(
  el: HTMLElement,
  kind: 'title' | 'badge',
  style: Look,
) {
  for (const c of [...el.classList])
    if (c.startsWith('rc-')) el.classList.remove(c);
  el.classList.add(kind === 'title' ? 'rc-title' : 'rc-badge');
  if (kind === 'title' && style.gradient) el.classList.add('rc-grad');
  if (style.effect && style.effect !== 'none')
    el.classList.add(`rc-fx-${style.effect}`);
  const set = (k: string, v: string | null | undefined) =>
    v ? el.style.setProperty(k, v) : el.style.removeProperty(k);
  set('--rc-color', style.color ?? null);
  set('--rc-from', style.gradient?.from);
  set('--rc-to', style.gradient?.to);
  set('--rc-angle', style.gradient ? `${style.gradient.angle}deg` : null);
  set('--rc-weight', style.weight === 'normal' ? '400' : '700');
}

/** Après chaque dessin : chaque `[data-look]` reçoit son apparence. */
export function paintLooks(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-look]').forEach((el) => {
    let st: Look = {};
    try {
      st = JSON.parse(el.dataset.look || '{}') as Look;
    } catch {
      /* apparence illisible : le texte reste neutre */
    }
    applyLook(el, el.dataset.lookKind === 'badge' ? 'badge' : 'title', st);
  });
}
export const lookAttr = (style: Look | undefined, kind = 'title') =>
  `data-look="${esc(JSON.stringify(style ?? {}))}" data-look-kind="${kind}"`;

export function titleHtml(
  t: TitleLook | null | undefined,
  o: { size?: 'xs' | 's' | 'm' | 'l'; empty?: string } = {},
) {
  if (!t?.label)
    return o.empty ? `<span class="pc-none">${esc(o.empty)}</span>` : '';
  const r = rarity(t.rarity);
  return `<span class="pc-ttl sk-${SKIN[r]} sz-${o.size ?? 's'}" data-r="${r}" title="${esc(`Titre ${RARITY_FR[r]!.toLowerCase()} : ${t.label}`)}">${gem(r)}<span class="pc-ttl-t" ${lookAttr(t.style)}>${esc(t.label)}</span></span>`;
}

export function avatarHtml(
  name: string,
  size: number,
  o: { frame?: string | null; url?: string | null } = {},
) {
  const slot = Math.round(size / 0.625);
  return `<span class="pc-av" style="--av:${size}px;--slot:${slot}px">${pp(name, size, o.url)}${o.frame ? `<img class="pc-frame" src="${esc(o.frame)}" alt="">` : ''}</span>`;
}

export function badgesHtml(list: BadgeLook[] = [], max = 3, size = 20) {
  if (!list.length) return '';
  const more = list.length - max;
  return `<span class="pc-bdgs">${list
    .slice(0, max)
    .map((b) =>
      b.image
        ? `<img class="pc-bdg" src="${esc(b.image)}" alt="${esc(b.label)}" title="${esc(b.label)}" width="${size}" height="${size}">`
        : `<span class="pc-bdg-t" data-r="${rarity(b.rarity)}" title="${esc(b.label)}">${esc(b.label.slice(0, 2))}</span>`,
    )
    .join(
      '',
    )}${more > 0 ? `<span class="pc-bdg-more">+${more}</span>` : ''}</span>`;
}

/** L'en-tête du profil (`header`) ou la carte de survol d'une ligne de classement (`peek`). */
export function cardHtml(
  p: Wearer,
  o: {
    variant?: 'header' | 'peek';
    titleEmpty?: string;
    aside?: string;
  } = {},
) {
  const peek = o.variant === 'peek';
  return `<div class="pc-head${peek ? ' pc-peek' : ''}"><span class="pc-band${p.banner ? ' has-img' : ''}"${p.banner ? ` style="--banner:url('${esc(p.banner)}')"` : ''}></span>
    <div class="pc-id">${avatarHtml(p.name, peek ? 64 : 112, { frame: p.frame, url: p.avatar })}
      <div class="pc-txt"><b class="pc-name">${esc(p.name)}</b>${titleHtml(p.title, { size: peek ? 's' : 'l', empty: o.titleEmpty })}
        <div class="pc-badges">${badgesHtml(p.badges, 3, peek ? 20 : 26)}</div></div>
      ${o.aside ? `<div class="pc-aside">${o.aside}</div>` : ''}</div></div>`;
}

/** Une ligne de classement du site. `compact` : la liste serrée. */
export function rowHtml(
  p: Wearer,
  o: { rank: number; value: string; compact?: boolean },
) {
  const size = o.compact ? 30 : 38;
  return `<div class="pc-row${o.compact ? ' compact' : ''}"><span class="pc-rk">${o.rank}</span>${avatarHtml(p.name, size, { frame: p.frame, url: p.avatar })}<span class="pc-idn"><b>${esc(p.name)}</b>${titleHtml(p.title, { size: 'xs' })}${badgesHtml(p.badges, 3, 18)}</span><span class="pc-val">${esc(o.value)}</span></div>`;
}

/** Une place de podium : le cadre s'y voit à sa taille moyenne. */
export function podiumHtml(p: Wearer, value: string) {
  return `<div class="pc-pod">${p.banner ? `<span class="pc-pod-band" style="--banner:url('${esc(p.banner)}')"></span>` : '<span class="pc-pod-band"></span>'}${avatarHtml(p.name, 84, { frame: p.frame, url: p.avatar })}<b>${esc(p.name)}</b>${titleHtml(p.title, { size: 'xs' })}<span class="pc-val">${esc(value)}</span></div>`;
}
