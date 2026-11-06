// Alertes : ce qui se lit des vrais fichiers, à la demande. Les vidéos alpha peuvent faire 3840 px de large : une vignette est
// une image figée, calculée une fois par une seule vidéo à la fois, jamais une vidéo vivante dans la liste. Le son affiché est
// celui du vrai fichier. Rien n'est gardé au-delà de la session.

const url = (name: string) => `/alerts/media/${encodeURIComponent(name)}`;
const W = 176;
const H = 99;

const thumbs = new Map<string, string | null>();
const waves = new Map<string, { peaks: number[]; ms: number } | null>();
/** Une seule lecture à la fois, dans l'ordre des demandes : une file pour les vignettes, une pour les sons, plus rapides. */
const queue = () => {
  let line: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>) => {
    const run = line.then(job, job);
    line = run.catch(() => {});
    return run;
  };
};
const thumbLine = queue();
const waveLine = queue();

const once = (el: HTMLVideoElement, ok: string, ms = 6000) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(() => done(new Event('error')), ms);
    const done = (e: Event) => {
      clearTimeout(t);
      el.removeEventListener(ok, done);
      el.removeEventListener('error', done);
      if (e.type === 'error') rej(new Error('video-error'));
      else res();
    };
    el.addEventListener(ok, done);
    el.addEventListener('error', done);
  });

/** Les WebM VP8 + alpha d'origine n'ont qu'une image clé : un saut y est faux (même constat que le moteur). */
const canSeek = async (src: string) => {
  const r = await fetch(src, { headers: { range: 'bytes=0-4095' } });
  const b = await r.arrayBuffer();
  return !new TextDecoder('latin1').decode(b).includes('V_VP8');
};

async function grab(name: string, atMs: number) {
  const src = url(name);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = src;
  try {
    await once(v, 'loadeddata');
    const at = Math.min(atMs / 1000, (v.duration || 1) * 0.9);
    if (await canSeek(src)) {
      v.currentTime = at;
      await once(v, 'seeked');
    } else {
      v.playbackRate = 4;
      await new Promise<void>((res) => {
        const step: VideoFrameRequestCallback = (_, m) =>
          m.mediaTime >= at ? res() : void v.requestVideoFrameCallback(step);
        v.requestVideoFrameCallback(step);
        v.onended = () => res();
        v.play().catch(() => res());
      });
      v.pause();
    }
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const r = Math.min(W / v.videoWidth, H / v.videoHeight);
    const w = v.videoWidth * r;
    const h = v.videoHeight * r;
    c.getContext('2d')!.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
    return c.toDataURL('image/webp', 0.7);
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

/** La vignette déjà prête, ou undefined. */
export const thumbOf = (name: string) => thumbs.get(name);
/** Demande une vignette ; `done` est appelé quand elle arrive. */
export function askThumb(name: string, atMs: number, done: () => void) {
  if (thumbs.has(name)) return;
  thumbs.set(name, null);
  void thumbLine(() => grab(name, atMs)).then(
    (img) => {
      thumbs.set(name, img);
      done();
    },
    () => {},
  );
}

const PEAKS = 180;
async function decode(name: string) {
  const r = await fetch(url(name));
  if (!r.ok) throw new Error('media');
  const ctx = new OfflineAudioContext(1, 1, 22050);
  const buf = await ctx.decodeAudioData(await r.arrayBuffer());
  const d = buf.getChannelData(0);
  const size = Math.max(1, Math.floor(d.length / PEAKS));
  const peaks: number[] = [];
  for (let i = 0; i < PEAKS; i++) {
    let top = 0;
    for (let j = i * size; j < (i + 1) * size && j < d.length; j += 32)
      top = Math.max(top, Math.abs(d[j]!));
    peaks.push(top);
  }
  const max = Math.max(...peaks) || 1;
  return { peaks: peaks.map((p) => p / max), ms: buf.duration * 1000 };
}

export const waveOf = (name: string) => waves.get(name);
/** Le vrai son d'un fichier ; une vidéo sans piste son reste `null`. */
export function askWave(name: string, done: () => void) {
  if (waves.has(name)) return;
  waves.set(name, null);
  void waveLine(() => decode(name)).then(
    (w) => {
      waves.set(name, w);
      done();
    },
    () => {},
  );
}

/** Un fichier remplacé ou importé : on le relira. */
export function forgetMedia(name?: string) {
  if (name) {
    thumbs.delete(name);
    waves.delete(name);
    return;
  }
  thumbs.clear();
  waves.clear();
}

export const waveSvg = (peaks: number[]) =>
  `<svg viewBox="0 0 ${peaks.length * 3} 20" preserveAspectRatio="none" aria-hidden="true">${peaks
    .map((p, i) => {
      const h = Math.max(1, p * 18);
      return `<rect x="${i * 3}" y="${10 - h / 2}" width="2" height="${h}"/>`;
    })
    .join('')}</svg>`;
