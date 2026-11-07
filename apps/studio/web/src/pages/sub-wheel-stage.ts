import { SUB_WHEEL, subWheelAmount, subWheelLayout } from '@raptoru/schemas';
import { esc, fmt } from '../ds/ds.js';

// La roue au repos : reproduction fidèle de buildWheelSVG (apps/studio/server/effects-player/wheel.js), mêmes dimensions, couleurs et
// textes, avec la même table de gains que le Core (@raptoru/schemas). Ses couleurs sont celles de l'overlay, pas des jetons de Studio.
// L'animation d'essai, elle, est le vrai wheel.js : voir `playReal`. wheel.js n'est pas modifié : il fait partie de la version du
// lecteur d'OBS, un ajout obligerait à recharger la source.

export type Tier = 1 | 2 | 3;

function wheelColor(val: number) {
  if (val >= 25000) return '#d4af37';
  if (val >= 10000) return '#c0932a';
  if (val >= 5000) return '#8a2be2';
  if (val >= 3000) return '#8a3a8a';
  if (val >= 2000) return '#b54a4a';
  if (val >= 1500) return '#c95a3f';
  if (val >= 1000) return '#c97a3f';
  if (val >= 750) return '#b8a23f';
  if (val >= 500) return '#7ba23f';
  if (val >= 300) return '#4a8c4a';
  if (val >= 200) return '#2d8a87';
  return '#3a6ea5';
}
const multColor = (mult: number) =>
  mult >= 5 ? '#ff4444' : mult >= 3 ? '#ff9900' : '#00cfff';

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** La roue, segments et gains de base, comme l'overlay l'affiche. */
export function wheelSvg(months: number) {
  const layout = subWheelLayout(months);
  const cx = 196;
  const cy = 196;
  const r = 172;
  const rOuter = 179;
  const a = 360 / layout.length;
  const pt = (rad: number, deg: number) => {
    const t = (deg * Math.PI) / 180;
    return `${(cx + rad * Math.cos(t)).toFixed(2)} ${(cy + rad * Math.sin(t)).toFixed(2)}`;
  };
  const parts = layout.map(({ val, mult }, i) => {
    const s = i * a - 90;
    const e = (i + 1) * a - 90;
    const mid = (i + 0.5) * a - 90;
    const rot = (i + 0.5) * a;
    const at = pt(r * 0.68, mid)
      .split(' ')
      .map(Number) as [number, number];
    const [tx, ty] = at;
    const fs = val >= 10000 ? 16 : val >= 5000 ? 18 : val >= 1000 ? 19 : 20;
    let g = `<path d="M ${cx} ${cy} L ${pt(r, s)} A ${r} ${r} 0 0 1 ${pt(r, e)} Z" fill="${wheelColor(val)}" stroke="#1a1a1a" stroke-width="2"/>`;
    if (mult > 1) {
      const [bx, by] = pt((r + rOuter) / 2, mid).split(' ');
      g += `<path d="M ${pt(r + 2, s)} A ${r + 2} ${r + 2} 0 0 1 ${pt(r + 2, e)} L ${pt(rOuter, e)} A ${rOuter} ${rOuter} 0 0 0 ${pt(rOuter, s)} Z" fill="${multColor(mult)}" opacity=".88"/>
        <text x="${bx}" y="${by}" fill="#fff" font-size="11" font-weight="900" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rot}, ${bx}, ${by})" paint-order="stroke" stroke="#000" stroke-width="2">×${mult}</text>`;
    }
    g += `<text x="${tx}" y="${mult > 1 ? ty - 6 : ty}" fill="#fff" font-size="${fs}" font-weight="900" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rot}, ${tx}, ${ty})" paint-order="stroke" stroke="#000" stroke-width="3" stroke-linejoin="round">${val >= 1000 ? `${val / 1000}k` : val}</text>`;
    if (mult > 1)
      g += `<text x="${tx}" y="${ty + 10}" fill="${multColor(mult)}" font-size="11" font-weight="900" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rot}, ${tx}, ${ty})" paint-order="stroke" stroke="#000" stroke-width="2">×${mult}</text>`;
    return `<g data-part="${i}">${g}</g>`;
  });
  return `<svg class="whl-svg" viewBox="0 0 392 392" aria-hidden="true"><g data-spin><circle cx="${cx}" cy="${cy}" r="${rOuter + 6}" fill="#0d0d10"/><circle cx="${cx}" cy="${cy}" r="${rOuter + 4}" fill="#1a1a1a" stroke="#d4af37" stroke-width="3"/>${parts.join('')}</g></svg>`;
}

/** L'angle qui amène une part sous le repère, comme le fait l'overlay en fin de tirage. */
export const partAngle = (months: number, part: number) => {
  const a = 360 / subWheelLayout(months).length;
  return 360 - (part * a + a / 2);
};

/** Ce que la roue peut donner, du plus gros gain au plus petit. Le montant vient de la même formule que le Core. */
export function gainsView(months: number, tier: Tier) {
  const layout = subWheelLayout(months);
  const rows = layout
    .map((seg, i) => ({
      seg,
      i,
      amount: subWheelAmount(months, tier, i),
    }))
    .sort((x, y) => y.amount - x.amount || x.i - y.i);
  return `<div class="whl-gh"><span class="d-lb">Ce qu’elle peut donner</span></div>
    <div class="whl-gl">${rows
      .map(
        ({ seg, i, amount }) =>
          `<button type="button" class="whl-g ${seg.val * seg.mult >= 10000 ? 'top' : ''}" data-part-btn="${i}" style="--c:${wheelColor(seg.val)}" aria-label="Montrer la part de ${fmt(amount)} jetons"><i></i><b>${fmt(amount)}</b>${seg.mult > 1 ? `<small style="color:${multColor(seg.mult)}">×${seg.mult}</small>` : ''}</button>`,
      )
      .join('')}</div>
    <p class="d-note">${layout.length} parts, chacune a la même chance. Gains et chances sont fixes : le serveur tire une seule fois, avant l’animation.${tier > 1 ? ` Tier ${tier} : gains × ${SUB_WHEEL.tierCoef[tier]}.` : ''}</p>`;
}

/** La tranche de la roue dans l'adresse des tiers : la table change à 4, 12 et 20 mois. */
export const BANDS = [
  ['1', '1 à 3 mois'],
  ['4', '4 à 11'],
  ['12', '12 à 19'],
  ['20', '20 et +'],
] as const;
export const bandOf = (months: number) =>
  months >= 20 ? '20' : months >= 12 ? '12' : months >= 4 ? '4' : '1';

let realCss: string | null = null;
/**
 * Le vrai overlay, ici, sans passer par le Core ni par OBS : le wheel.js et les styles que charge la source OBS, chargés tels quels.
 * Le segment est choisi au hasard pour le spectacle : rien n'est tiré, rien n'est crédité.
 */
export async function playReal(
  host: HTMLElement,
  spin: { months: number; tier: Tier; name: string; part: number },
) {
  if (realCss === null) {
    const html = await (await fetch('/effects/player.html')).text();
    const from = html.indexOf('/* === ROUE === */');
    const to = html.indexOf('#panel {', from);
    if (from < 0 || to < 0) throw new Error('wheel_styles_missing');
    realCss = html.slice(from, to);
    const style = document.createElement('style');
    style.textContent = realCss;
    document.head.append(style);
  }
  const url = '/effects/wheel.js';
  const { playWheel } = (await import(/* @vite-ignore */ url)) as {
    playWheel(
      stage: HTMLElement,
      s: Record<string, unknown>,
      sounds: { incr: string; fin: string },
    ): Promise<void>;
  };
  await playWheel(
    host,
    {
      name: spin.name,
      type: 'resub',
      tier: spin.tier,
      months: spin.months,
      layout: subWheelLayout(spin.months),
      segment: spin.part,
      amount: subWheelAmount(spin.months, spin.tier, spin.part),
    },
    { incr: '/effects/media/sw-incr', fin: '/effects/media/sw-fin' },
  );
}

export const bannerView = (name: string, month: string, tier: Tier) =>
  `<div class="whl-ban"><span><small>mois</small><b>${esc(month)}</b></span><strong>${esc(name)}</strong><span><small>tier</small><b>T${tier}</b></span></div>`;
