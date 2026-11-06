// La forme d'onde d'un son : décodée une fois depuis le vrai fichier, gardée en mémoire. Deux décodages au plus à la fois :
// la banque se dessine en arrière-plan sans gêner l'écoute.

/** Résolution gardée : celle de la grande forme d'onde. Les lignes de la banque en prennent une sur quatre. */
export const WAVE_POINTS = 360;

/** Le pic de chaque tranche, sans normaliser : un son faible se voit faible. */
export function peaksOf(data: Float32Array, n: number) {
  const out = new Array<number>(n).fill(0);
  const step = data.length / n;
  for (let i = 0; i < n; i++) {
    const end = Math.min(data.length, Math.ceil((i + 1) * step));
    let top = 0;
    for (let j = Math.floor(i * step); j < end; j++)
      top = Math.max(top, Math.abs(data[j]!));
    out[i] = Math.min(1, top);
  }
  return out;
}

/** Le tracé SVG : une barre verticale par pic, centrée, au moins visible. */
export function wavePath(peaks: readonly number[], h: number) {
  return peaks
    .map((a, i) => {
      const half = Math.max(0.5, (a * h) / 2);
      return `M${i} ${(h / 2 - half).toFixed(1)}V${(h / 2 + half).toFixed(1)}`;
    })
    .join('');
}

export function waveSvg(peaks: readonly number[], cls = '') {
  const h = 40;
  return `<svg class="${cls}" viewBox="0 0 ${peaks.length} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${wavePath(peaks, h)}"/></svg>`;
}

const cache = new Map<string, Promise<number[] | null>>();
let running = 0;
const waiting: (() => void)[] = [];

async function decode(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('media_missing');
  const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(
    await r.arrayBuffer(),
  );
  return peaksOf(audio.getChannelData(0), WAVE_POINTS);
}

/** Les pics d'un fichier, ou null s'il est illisible : la page le dit, elle n'invente pas de tracé. */
export function wave(url: string) {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<number[] | null>((res) => {
      const go = () => {
        running += 1;
        void decode(url)
          .then(res, () => res(null))
          .finally(() => {
            running -= 1;
            waiting.shift()?.();
          });
      };
      if (running < 2) go();
      else waiting.push(go);
    });
    cache.set(url, p);
  }
  return p;
}
