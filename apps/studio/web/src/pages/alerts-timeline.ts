import { esc, ic } from '../ds/ds.js';
import { type AlertVariantInfo, type Clip, clipsOf } from './alerts-model.js';
import type { VariantLook } from './alerts-place.js';
import { waveOf, waveSvg } from './alerts-media.js';

// Alertes : la timeline. Une règle en vraies secondes, une piste Vidéo, une piste Son qui montre le vrai fichier, une piste Texte
// dont chaque bloc se déplace et se règle par ses poignées d'entrée et de sortie. Les pentes aux extrémités d'un bloc sont ses
// transitions : on les tire aussi. Rien n'est relu ici : le bloc suit la souris, la page rejoue l'image à la fin du geste.

export interface TimelineView {
  v: AlertVariantInfo;
  look: VariantLook;
  /** Longueur de la règle (ms). */
  length: number;
  /** Fin de la vidéo sur la règle (ms). */
  videoMs: number;
  sel: string | null;
  color: string;
  marks: { at: number; action: string }[];
}

const pct = (t: number, len: number) => (len ? (t / len) * 100 : 0);

function ticks(len: number) {
  const s = len / 1000;
  const step = s > 14 ? 1000 : s > 7 ? 500 : 250;
  const label = s > 14 ? 2000 : s > 7 ? 1000 : 500;
  const out: string[] = [];
  for (let t = 0; t <= len; t += step) {
    const big = t % label === 0;
    out.push(
      `<i class="${big ? 's' : ''}" style="left:${pct(t, len)}%"${big ? ` data-l="${t / 1000}"` : ''}></i>`,
    );
  }
  return out.join('');
}

/** Les pentes d'entrée et de sortie, dans le bloc. */
const ramps = (enterMs: number, exitMs: number, span: number) =>
  `<em class="alr-ramp in" style="width:${pct(enterMs, span)}%" data-fx="in"></em><em class="alr-ramp out" style="width:${pct(exitMs, span)}%" data-fx="out"></em>`;

const clipHtml = (c: Clip, t: TimelineView) =>
  `<div class="alr-clip t ${t.sel === 'text' ? 'sel' : ''}" data-clip="${c.key}" style="left:${pct(Math.min(c.in, t.length), t.length)}%;width:${pct(Math.max(0, Math.min(c.end, t.length) - c.in), t.length)}%" title="Glisser pour déplacer">${ramps(c.enterMs, c.exitMs, c.end - c.in)}<u class="l" data-edge="in" aria-label="Entrée du texte"></u><span>${esc(c.label)}</span><u class="r" data-edge="out" aria-label="Sortie du texte"></u></div>`;

export function tracksHtml(t: TimelineView) {
  const { v, look, length, videoMs } = t;
  // Une vidéo en boucle tourne jusqu'à la fin de l'alerte.
  const span = v.loop ? length : videoMs;
  const name = v.audio ?? v.video ?? '';
  const wave = name ? waveOf(name) : null;
  const clips = clipsOf(v, look);
  const mediaEnter = look.mediaEnter
    ? look.mediaEnter.kind === 'cut'
      ? 0
      : look.mediaEnter.ms
    : (v.videoFade?.in ?? 0);
  const mediaExit = look.mediaExit
    ? look.mediaExit.kind === 'cut'
      ? 0
      : look.mediaExit.ms
    : (v.videoFade?.out ?? 0);
  const sound = wave
    ? `<div class="alr-clip a ${t.sel === 'sound' ? 'sel' : ''}" data-track="sound" style="left:0;width:${pct(Math.min(wave.ms, length), length)}%">${waveSvg(wave.peaks)}</div>`
    : `<div class="alr-clip a none ${t.sel === 'sound' ? 'sel' : ''}" data-track="sound" style="left:0;width:100%"><span>${v.audio ? 'Son non lu' : 'Pas de son'}</span></div>`;
  return `<span class="alr-tn r"></span><div class="alr-tracks" style="--c:var(--${t.color})">
      <div class="alr-rul" data-rul tabindex="0" role="slider" aria-label="Instant de l’alerte" aria-valuemin="0" aria-valuemax="${length}" aria-valuenow="0">${ticks(length)}${t.marks.map((m) => `<b style="left:${pct(m.at, length)}%"></b>`).join('')}</div>
      <div class="alr-trk"><div class="alr-clip v ${t.sel === 'media' ? 'sel' : ''} ${v.loop ? 'loop' : ''}" data-track="media" style="left:0;width:${pct(span, length)}%">${ramps(mediaEnter, mediaExit, span)}<span>${esc(v.video ?? 'Aucune vidéo')}</span></div></div>
      <div class="alr-trk">${sound}</div>
      <div class="alr-trk">${clips.map((c) => clipHtml(c, t)).join('') || '<span class="alr-trk__none">Pas de texte</span>'}</div>
      <i class="alr-ph" data-ph></i>
    </div>
    <span class="alr-tn">Vidéo</span><span class="alr-tn">Son</span><span class="alr-tn">Texte</span>`;
}

export const transportHtml = (
  playing: boolean,
  disabled: boolean,
  o: { dirty: boolean; others: number; volume: number },
) =>
  `<button type="button" class="d-play ${playing ? '' : 'go'}" data-a="play" aria-label="${playing ? 'Arrêter' : 'Jouer l’aperçu'}" ${disabled ? 'disabled' : ''}>${ic(playing ? 'stop' : 'play')}</button>
  <span class="alr-tc" data-tc></span>
  <button type="button" class="d-ib" data-step="-1" aria-label="Image précédente">${ic('back')}</button>
  <button type="button" class="d-ib" data-step="1" aria-label="Image suivante">${ic('chev')}</button>
  <button type="button" class="d-btn ghost sm" data-a="overlap" ${disabled ? 'disabled' : ''}>${ic('layers')}Superposer</button>
  <span class="d-sp"></span>
  ${o.dirty ? `<span class="alr-dirty"><i class="d-dot w"></i>Non enregistré</span><button type="button" class="d-btn ghost sm" data-a="revert">Annuler</button><button type="button" class="d-btn sm pri" data-a="save">Enregistrer</button>` : o.others ? `<span class="alr-dirty"><i class="d-dot w"></i>${o.others} variante${o.others > 1 ? 's' : ''} non enregistrée${o.others > 1 ? 's' : ''}</span>` : ''}
  <span class="alr-vol">${ic('vol')}<input class="d-range" type="range" min="0" max="100" value="${o.volume}" data-vol aria-label="Volume de l’aperçu"></span>`;

type ClipDrag =
  | { kind: 'clip'; clip: Clip; rect: DOMRect; x: number }
  | { kind: 'in'; clip: Clip; rect: DOMRect }
  | { kind: 'out'; clip: Clip; rect: DOMRect };
export type TimelineDrag =
  | { kind: 'scrub'; rect: DOMRect }
  | ClipDrag
  /** Une pente : celle d'un bloc de texte, ou celle de la vidéo (`clip` nul). */
  | { kind: 'fx'; side: 'in' | 'out'; clip: Clip | null; rect: DOMRect };

const MIN_CLIP = 120;

/** La nouvelle position d'un bloc au cours d'un geste. Renvoie [entrée, fin] bornés à la règle. */
export function dragClip(
  d: ClipDrag,
  atMs: number,
  length: number,
): [number, number] {
  const { clip } = d;
  if (d.kind === 'in')
    return [Math.max(0, Math.min(atMs, clip.end - MIN_CLIP)), clip.end];
  if (d.kind === 'out')
    return [clip.in, Math.min(length, Math.max(atMs, clip.in + MIN_CLIP))];
  const span = clip.end - clip.in;
  const start = Math.max(0, Math.min(length - span, clip.in + (atMs - d.x)));
  return [start, start + span];
}
