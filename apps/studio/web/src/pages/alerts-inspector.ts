import { esc, fld, ic, numrow, row, seg, sw } from '../ds/ds.js';
import {
  type AlertVariantInfo,
  ballonOf,
  LAST_BALLON,
  type BallonPools,
  BITS_MINIMUM,
  canEditText,
  chance,
  type Family,
  type FakeData,
  familyEvent,
  followed,
  formView,
  type FxKey,
  isHalloween,
  MODES,
  type FamilyMode,
  playsText,
  PRESETS,
  TRANSITIONS,
  triggerOf,
  type VariantSettings,
  variantName,
  weightOf,
} from './alerts-model.js';
import type { Box, Place, VariantLook } from './alerts-place.js';
import { thumbOf } from './alerts-media.js';

// Alertes : l'inspecteur montre ce qu'on a sélectionné. Rien de sélectionné : la famille, ses variantes et les tests. Le texte :
// sa taille, sa couleur, sa place, ses temps et ses transitions. Toute l'alerte : sa place dans la source OBS. Le son : son volume.

/** Mêmes couleurs que NAME_COLORS du moteur (vérifié par un test) : le pseudo prend l'une d'elles au hasard par défaut. */
export const NAME_COLORS = [
  '#6ee7ff',
  '#ff91d7',
  '#ffb38a',
  '#7ef0b4',
  '#c3a6ff',
  '#8fc4ff',
];

export interface InspectorView {
  family: Family;
  variants: AlertVariantInfo[];
  cur: AlertVariantInfo | null;
  settings: VariantSettings | null;
  pools: BallonPools | null;
  mode: FamilyMode;
  presetKey: string;
  fake: FakeData;
  look: VariantLook;
  /** Les variantes dont un réglage n'est pas enregistré. */
  unsaved: string[];
  canReplace: boolean;
  /** La sélection, et sa place. */
  sel: string | null;
  selLabel: string;
  place: Place;
  box: Box | null;
  sharedBy: string[];
}

const seconds = (ms: number) => (ms / 1000).toFixed(2);

const fxRows = (label: string, key: FxKey, look: VariantLook) => {
  const t = look[key];
  const kind = t?.kind ?? 'origin';
  return `${row(
    label,
    `<label class="d-fld alr-wide"><select data-fx-kind="${key}" aria-label="${esc(label)}">${TRANSITIONS.map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`,
  )}${t && t.kind !== 'cut' ? numrow(`Durée (${label.toLowerCase()})`, fld(`data-fx-ms="${key}" min="0" max="5000" step="10"`, t.ms, 'ms')) : ''}`;
};

const placeRows = (o: InspectorView) => {
  const b = o.box;
  return `${numrow('Horizontal', fld('data-pos="x" step="1"', b ? Math.round(b.x) : '', 'px', b ? '' : 'disabled'))}${numrow('Vertical', fld('data-pos="y" step="1"', b ? Math.round(b.y) : '', 'px', b ? '' : 'disabled'))}<div class="d-row"><span>Taille</span><span class="alr-size"><input class="d-range" type="range" min="10" max="500" step="1" value="${Math.round(o.place.scale * 100)}" data-size aria-label="Taille"><b>${Math.round(o.place.scale * 100)} %</b></span></div>`;
};

function textPane(o: InspectorView) {
  const v = o.cur!;
  const look = o.look;
  const color = look.nameColor ?? '';
  const swatches = NAME_COLORS.map(
    (c) =>
      `<button type="button" class="${color === c ? 'on' : ''}" style="--c:${c}" data-color="${c}" aria-label="Couleur ${c}"></button>`,
  ).join('');
  const wording = !canEditText(v)
    ? `<p class="d-note">Phrase composée par le style de cette alerte : ${esc(v.textStyle === 'pseudo-bits' ? '× Bits, puis « pseudo me permet de manger ! »' : v.textStyle === 'pseudo-don' ? 'pseudo, montant et message du don' : v.type === 'gift_targeted' ? 'le destinataire seul' : 'pseudo × nombre de subs')}.</p>`
    : v.textStyle === 'eren-subs'
      ? (v.subtitles ?? [])
          .map(
            (s, i) =>
              `<div class="d-row col"><span>Sous-titre ${i + 1}</span><label class="d-fld alr-line"><input type="text" maxlength="160" data-sub-text="${i}" value="${esc(look.subtitles?.[i]?.text ?? s.text)}" aria-label="Sous-titre ${i + 1}"></label></div>`,
          )
          .join('')
      : `<div class="d-row col"><span>Phrase</span><label class="d-fld alr-line"><input type="text" maxlength="160" data-text value="${esc(look.text ?? v.text ?? '')}" aria-label="Phrase"></label></div>`;
  const clips =
    v.textStyle === 'eren-subs'
      ? ''
      : `${numrow('Apparaît à', fld('data-at="show" step="0.05" min="0"', seconds(look.showAt ?? v.showAt ?? 0), 's'))}${numrow('Disparaît à', fld('data-at="hide" step="0.05" min="0"', seconds(look.hideAt ?? v.hideAt ?? 0), 's'))}`;
  return `<section class="d-grp"><h3>${ic('note')}${esc(o.selLabel)}<button type="button" class="d-ib alr-close" data-unsel aria-label="Fermer">${ic('x')}</button></h3>
      ${wording}
      <div class="d-row col"><span>Couleur du pseudo</span><span class="alr-colors"><button type="button" class="alr-auto ${color ? '' : 'on'}" data-color="" title="Une couleur au hasard à chaque alerte">Auto</button>${swatches}</span></div>
      ${placeRows(o)}
    </section>
    <section class="d-grp"><h3>${ic('clock')}Entrée et sortie</h3>${clips}${fxRows('Entrée', 'textEnter', look)}${fxRows('Sortie', 'textExit', look)}
      <p class="d-note">D’origine : l’animation propre à ce style. Tire aussi les pentes sur la timeline.</p></section>
    <div class="alr-reset"><button type="button" class="d-btn sm" data-a="reset-text">Rétablir le texte d’origine</button></div>`;
}

function mediaPane(o: InspectorView) {
  const v = o.cur!;
  return `<section class="d-grp"><h3>${ic('film')}Toute l’alerte<button type="button" class="d-ib alr-close" data-unsel aria-label="Fermer">${ic('x')}</button></h3>
      <p class="d-note">Déplace la vidéo et ses textes ensemble à l’intérieur de la source OBS. La source elle-même se place dans OBS, cette page ne la touche pas.</p>
      ${placeRows(o)}
    </section>
    <section class="d-grp"><h3>${ic('clock')}Entrée et sortie</h3>${fxRows('Entrée', 'mediaEnter', o.look)}${fxRows('Sortie', 'mediaExit', o.look)}
      <p class="d-note">${v.videoFade ? 'D’origine : le fondu de cette vidéo.' : 'D’origine : la vidéo arrive et part d’elle-même.'} La durée de l’alerte ne change pas.</p></section>
    <div class="alr-reset"><button type="button" class="d-btn sm" data-a="reset-media">Rétablir la place d’origine</button></div>`;
}

function soundPane(o: InspectorView) {
  const v = o.cur!;
  const vol = Math.round((o.look.volume ?? v.volume ?? 0.5) * 100);
  return `<section class="d-grp"><h3>${ic('sound')}Son<button type="button" class="d-ib alr-close" data-unsel aria-label="Fermer">${ic('x')}</button></h3>
      <dl class="d-kv"><dt>Fichier</dt><dd>${esc(v.audio ?? `Son de la vidéo`)}</dd>${v.keepAudio ? '<dt>Fin</dt><dd>Continue après la vidéo</dd>' : ''}${v.tts ? '<dt>Voix</dt><dd>Le don est lu à voix haute</dd>' : ''}</dl>
      <div class="d-row"><span>Volume dans OBS</span><span class="alr-size"><input class="d-range" type="range" min="0" max="100" value="${vol}" data-obs-vol aria-label="Volume dans OBS"><b>${vol} %</b></span></div>
      <p class="d-note">Le curseur de la timeline ne règle que l’aperçu.</p></section>`;
}

const thumb = (v: AlertVariantInfo) => {
  const src = v.video ? thumbOf(v.video) : null;
  return `<button type="button" class="alr-thumb" aria-label="Voir ${esc(variantName(v.id))}">${src ? `<img src="${src}" alt="" width="176" height="99">` : ''}</button>`;
};

function variantRow(o: InspectorView, v: AlertVariantInfo) {
  const f = o.family.id;
  const b = ballonOf(v.id);
  const name = `${variantName(v.id)}${o.unsaved.includes(v.id) ? ' •' : ''}`;
  const on = v.id === o.cur?.id;
  const miss = v.missing.length
    ? '<span class="d-tag warn">Média manquant</span>'
    : '';
  if (f === 'follow' && followed(v.id)) {
    const inDraw = (o.settings?.follow ?? [v.id]).includes(v.id);
    const c = chance(o.settings, v.id);
    return `<div class="alr-var ${on ? 'on' : ''}" data-var="${esc(v.id)}">${thumb(v)}<p><span>${esc(name)}</span><em data-wp="${esc(v.id)}">${inDraw ? `${c} %` : 'hors tirage'}</em></p>
      <div class="alr-var__b">${miss || `<input class="d-range" type="range" min="1" max="100" value="${weightOf(o.settings, v.id)}" data-w="${esc(v.id)}" aria-label="Poids de ${esc(name)}" ${inDraw ? '' : 'disabled'}>`}<span class="d-sp"></span>${sw(inDraw, `data-follow="${esc(v.id)}"`, `${name} dans le tirage`)}</div></div>`;
  }
  if (b) {
    const pool = o.pools?.[b.kind] ?? [1, 2, 3, 4];
    const last = pool.length === 1 && pool[0] === b.n;
    return `<div class="alr-var ${on ? 'on' : ''}" data-var="${esc(v.id)}">${thumb(v)}<p><span>${esc(name)}</span><em>Halloween</em></p>
      <div class="alr-var__b">${miss}<span class="d-sp"></span>${o.pools ? `<span ${last ? `title="${esc(LAST_BALLON)}"` : ''}>${sw(pool.includes(b.n), `data-ballon="${b.kind}:${b.n}"`, `${name} dans le tirage`, { disabled: last })}</span>` : ''}</div></div>`;
  }
  return `<div class="alr-var ${on ? 'on' : ''}" data-var="${esc(v.id)}">${thumb(v)}<p><span>${esc(name)}</span>${isHalloween(v) ? '<em>Halloween</em>' : ''}</p>
    <div class="alr-var__b">${miss || `<small>${esc(triggerOf(v))}</small>`}</div></div>`;
}

const detailRow = (k: string, v: unknown) => `<dt>${k}</dt><dd>${esc(v)}</dd>`;

function details(v: AlertVariantInfo, o: InspectorView) {
  const s = (ms?: number) => (ms === undefined ? '' : `${seconds(ms)} s`);
  return `<details class="d-acc"><summary>Détails de ${esc(variantName(v.id))}</summary><dl class="d-kv">
    ${detailRow('Déclencheur', triggerOf(v))}
    ${v.type === 'bits' ? detailRow('Seuil', `${BITS_MINIMUM} Bits`) : ''}
    ${detailRow('Priorité', v.priority ?? 0)}
    ${detailRow('Vidéo', v.video ?? 'Aucune')}
    ${detailRow('Son', v.audio ?? 'Celui de la vidéo')}
    ${detailRow('Volume', `${Math.round((o.look.volume ?? v.volume ?? 0.5) * 100)} %`)}
    ${v.duration ? detailRow('Durée imposée', s(v.duration + 300)) : v.mediaMs ? detailRow('Durée', s(v.mediaMs)) : ''}
    ${v.loop ? detailRow('Vidéo', 'En boucle') : ''}
    ${v.keepAudio ? detailRow('Fin', 'Attend la fin du son') : ''}
    ${v.text ? detailRow('Gabarit', v.text) : ''}
    ${v.fps ? detailRow('Cadence', `${v.fps} images/s`) : ''}
    ${v.provisional ? detailRow('État', 'Provisoire, à caler') : ''}
    ${o.sharedBy.length > 1 ? detailRow('Partagée par', o.sharedBy.join(', ')) : ''}
    ${detailRow('Référence', v.id)}
  </dl></details>`;
}

function familyPane(o: InspectorView) {
  const f = o.family;
  const usual = o.variants.filter((v) => !isHalloween(v));
  const hw = o.variants.filter(isHalloween);
  const modes = MODES.filter(([m]) => m !== 'halloween' || f.halloween);
  const v = o.cur;
  const title = f.id === 'follow' ? 'Tirage au sort' : 'Variantes';
  const type = v ? String(familyEvent(f.id, v, o.fake).type) : f.id;
  return `<section class="d-grp"><h3>Quand ${esc(f.label)} arrive</h3>${seg('data-mode', modes, o.mode, 'block')}
      <p class="d-note ${o.mode === 'off' ? 'bad' : ''}">${esc(playsText(o.mode, f.usual, f.halloween))}</p></section>
    <section class="d-grp"><h3>${title}</h3>${usual.map((x) => variantRow(o, x)).join('')}${hw.length ? `<p class="d-lb alr-sub">Halloween</p>${o.pools && hw.some((x) => ballonOf(x.id)) ? '<p class="d-note">Les cases choisissent les Ballons du tirage. Ce choix reste enregistré quand le profil Halloween est coupé ; il ne sert que lorsqu’il est actif.</p>' : ''}${hw.map((x) => variantRow(o, x)).join('')}` : ''}
      ${v && o.canReplace ? `<div class="alr-reset"><button type="button" class="d-btn ghost sm" data-a="replace">${ic('upload')}Remplacer le média</button></div>` : ''}
      ${v ? details(v, o) : ''}</section>
    <section class="d-grp"><h3>Tester avec</h3><div class="d-tags">${Object.entries(
      PRESETS,
    )
      .map(
        ([k, p]) =>
          `<button type="button" class="d-tag ${o.presetKey === k ? '' : 'off'}" data-preset="${k}">${esc(p.label)}</button>`,
      )
      .join('')}</div>${formView(type, o.fake)}</section>`;
}

export function inspectorHtml(o: InspectorView) {
  if (!o.cur) return '<div class="d-empty">Catalogue indisponible.</div>';
  if (o.sel === 'media') return mediaPane(o);
  if (o.sel === 'sound') return soundPane(o);
  if (o.sel) return textPane(o);
  return familyPane(o);
}
