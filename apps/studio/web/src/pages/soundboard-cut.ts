// L'extrait d'un son, sans DOM (docs/SOUNDBOARD.md § Ajouter un son) : bornes de la sélection, fondu anti-clic, mono si
// les deux canaux sont identiques, encodage WAV PCM 16 bits — exactement ce que le Core vérifie puis publie.

/** Un extrait : entre 0,1 s et 20 s (SOUND_FILE_RULES du Core). */
export const CUT = { minS: 0.1, maxS: 20, rate: 44100, fadeS: 0.004 } as const;

/** La sélection ramenée dans les bornes, la poignée déplacée gardant sa place autant que possible. */
export function clampCut(
  start: number,
  end: number,
  duration: number,
  moved: 'start' | 'end' = 'end',
): { start: number; end: number } {
  const min = Math.min(CUT.minS, duration);
  let s = Math.max(0, Math.min(start, duration - min));
  let e = Math.min(duration, Math.max(end, min));
  if (moved === 'start') {
    if (e - s < min) e = Math.min(duration, s + min);
    if (e - s > CUT.maxS) e = s + CUT.maxS;
  } else {
    if (e - s < min) s = Math.max(0, e - min);
    if (e - s > CUT.maxS) s = e - CUT.maxS;
  }
  return { start: round(s), end: round(e) };
}
const round = (s: number) => Math.round(s * 1000) / 1000;

/** Deux canaux à peu près identiques (un son mono enregistré en stéréo) : un seul suffit, deux fois plus léger. */
export function sameChannels(channels: Float32Array[], tolerance = 0.01) {
  if (channels.length < 2) return true;
  const [l, r] = channels as [Float32Array, Float32Array];
  for (let i = 0; i < l.length; i++)
    if (Math.abs(l[i]! - r[i]!) > tolerance) return false;
  return true;
}

/** Fondu de quelques millisecondes aux deux bouts : une coupe au milieu d'une onde ne claque pas. */
export function fadeEdges(channels: Float32Array[], rate: number) {
  const n = Math.min(
    Math.round(CUT.fadeS * rate),
    Math.floor((channels[0]?.length ?? 0) / 2),
  );
  for (const c of channels)
    for (let i = 0; i < n; i++) {
      const g = i / n;
      c[i]! *= g;
      c[c.length - 1 - i]! *= g;
    }
}

/** Le fichier publié : RIFF/WAVE, PCM 16 bits, canaux entrelacés. */
export function encodeWav(channels: Float32Array[], rate: number): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const k = channels.length;
  const data = frames * k * 2;
  const out = new DataView(new ArrayBuffer(44 + data));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  out.setUint32(4, 36 + data, true);
  text(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, k, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * k * 2, true);
  out.setUint16(32, k * 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, data, true);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < k; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![i]!));
      out.setInt16(at, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
      at += 2;
    }
  return new Uint8Array(out.buffer);
}

/** Le nom proposé : celui du fichier, sans extension ni caractères de contrôle. */
export function nameFromFile(file: string) {
  return (
    Array.from(file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' '))
      .filter((ch) => ch >= ' ' && ch !== '<' && ch !== '>')
      .join('')
      .trim()
      .slice(0, 40) || 'Nouveau son'
  );
}

/** L'identifiant d'un nouveau son : lisible, unique (suffixe aléatoire), choisi une fois par fenêtre. */
export function soundIdFor(label: string, random = Math.random) {
  const slug =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36)
      .replace(/-+$/, '') || 'son';
  const hex = Array.from({ length: 6 }, () =>
    Math.floor(random() * 16).toString(16),
  ).join('');
  return `${slug}-${hex}`;
}
