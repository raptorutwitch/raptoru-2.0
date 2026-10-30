// Halloween overlay page (docs/HALLOWEEN.md) — loaded by Studio's transparent, click-through, always-on-top window
// over the streamer's screen. It asks Studio what to play (long-poll), plays ONE thing at a time and reports
// started / ended / failed. STOP ALL (a new stop epoch) drops everything at once. Nothing here decides a purchase.
// Safety: no strobe (no full-screen luminance change faster than a blink), volume from Studio, the glitch effect is
// refused in safe mode, every play has a hard deadline after which it is removed whatever happens.

const TOKEN = decodeURIComponent(location.hash.slice(1));
/** « chaos »: the Chaos window (screen effects only); otherwise the overlay (everything else). */
const ROLE = new URLSearchParams(location.search).get('role');
const stage = document.getElementById('stage');
const notice = document.getElementById('notice');
const CAN_PLAY =
  document
    .createElement('video')
    .canPlayType('video/webm; codecs="vp9, opus"') !== '';

let epoch = -1;
let settings = { volume: 0.8, safe_mode: false };
/** The play running now: { id, cancel() }. */
let running = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, cls) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  stage.append(e);
  return e;
};
const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-overlay-token': TOKEN,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401)
    throw Object.assign(new Error('bad_token'), { status: 401 });
  return res.json();
}
const report = (delivery_id, event, error, detail) =>
  api('/halloween/overlay/report', {
    delivery_id,
    event,
    ...(error ? { error } : {}),
    ...(detail ? { detail } : {}),
  }).catch(() => {});

/** Every layer of the current play goes; the stage is empty again. */
function clearStage() {
  for (const v of stage.querySelectorAll('video')) {
    v.pause();
    // A captured window: its capture ends here too (nothing keeps capturing the game after a play).
    for (const t of v.srcObject?.getTracks?.() ?? []) t.stop();
    v.srcObject = null;
    v.removeAttribute('src');
    v.load();
  }
  stage.replaceChildren();
}

function stopAll() {
  running?.cancel();
  running = null;
  clearStage();
}

/** Animates `fn(progress 0..1)` for `ms`; resolves when done or cancelled. */
function animate(ms, fn, cancelled) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (t) => {
      if (cancelled()) return resolve(false);
      const p = Math.min(1, (t - t0) / ms);
      fn(p);
      if (p < 1) requestAnimationFrame(frame);
      else resolve(true);
    };
    requestAnimationFrame(frame);
  });
}
const ease = {
  in: (p) => p * p * p,
  out: (p) => 1 - (1 - p) ** 3,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
};

// --- media (screamers, apparitions) ----------------------------------------------------------------------------------

async function playMedia(d, ctx) {
  if (!d.media) throw new Error('no_media');
  if (!CAN_PLAY) throw new Error('webm_unsupported');
  const v = el('video', 'fx-video');
  v.preload = 'auto';
  v.playsInline = true;
  v.volume = clamp(
    settings.volume * clamp(d.params?.volume, 0, 1, 1),
    0,
    1,
    0.8,
  );
  v.style.opacity = '0';
  v.src = d.media;
  ctx.onCancel(() => {
    v.pause();
    v.remove();
  });
  // Loaded enough to play through without a stall (the jump scare must not stutter).
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('load_timeout')), 5000);
    ctx.onCancel(() => (clearTimeout(t), resolve()));
    v.addEventListener('canplaythrough', () => (clearTimeout(t), resolve()), {
      once: true,
    });
    v.addEventListener(
      'error',
      () => (clearTimeout(t), reject(new Error('decode_error'))),
      { once: true },
    );
  });
  if (ctx.cancelled()) return;
  await v.play().catch(() => {
    throw new Error('play_refused');
  });
  v.style.opacity = '1';
  ctx.started();
  const hard = (Number(d.duration_ms) || 15000) + 3000;
  await new Promise((resolve) => {
    const t = setTimeout(resolve, hard);
    v.addEventListener('ended', () => (clearTimeout(t), resolve()), {
      once: true,
    });
    v.addEventListener('error', () => (clearTimeout(t), resolve()), {
      once: true,
    });
    ctx.onCancel(() => (clearTimeout(t), resolve()));
  });
  // A soft exit for apparitions; screamers cut (their own last frame ends them).
  if (d.kind === 'apparition' && !ctx.cancelled()) {
    await animate(220, (p) => (v.style.opacity = String(1 - p)), ctx.cancelled);
  }
  v.pause();
  v.remove();
}

// --- drawn effects ---------------------------------------------------------------------------------------------------

async function blink(d, ctx) {
  const total = clamp(d.params?.durationMs, 300, 5000, 800);
  const close = Math.round((total * 220) / 800);
  const hold = Math.round((total * 300) / 800);
  const open = total - close - hold;
  const top = el('div', 'fx-lid top');
  const bottom = el('div', 'fx-lid bottom');
  ctx.started();
  const set = (k) => {
    top.style.transform = `translateY(${-100 + k * 100}%)`;
    bottom.style.transform = `translateY(${100 - k * 100}%)`;
  };
  await animate(close, (p) => set(ease.in(p)), ctx.cancelled);
  await sleep(hold);
  if (!ctx.cancelled())
    await animate(open, (p) => set(1 - ease.out(p)), ctx.cancelled);
  top.remove();
  bottom.remove();
}

async function fog(d, ctx) {
  const total = clamp(d.params?.durationMs, 2000, 30000, 9000);
  const f = el('div', 'fx-fog');
  ctx.started();
  const peak = clamp(d.params?.opacity, 0.2, 0.95, 0.72);
  await animate(
    1400,
    (p) => (f.style.opacity = String(peak * ease.out(p))),
    ctx.cancelled,
  );
  await sleep(Math.max(0, total - 2800));
  if (!ctx.cancelled())
    await animate(
      1400,
      (p) => (f.style.opacity = String(peak * (1 - ease.inOut(p)))),
      ctx.cancelled,
    );
  f.remove();
}

async function tunnel(d, ctx) {
  const total = clamp(d.params?.durationMs, 1500, 20000, 6000);
  const t = el('div', 'fx-tunnel');
  ctx.started();
  const paint = (r) => {
    t.style.background = `radial-gradient(circle at 50% 50%, transparent ${r}vmax, rgba(0,0,0,0.6) ${r + 6}vmax, rgba(0,0,0,0.97) ${r + 16}vmax)`;
  };
  const wide = 90;
  const narrow = clamp(d.params?.radius, 6, 40, 16);
  await animate(
    1100,
    (p) => paint(wide - (wide - narrow) * ease.inOut(p)),
    ctx.cancelled,
  );
  await sleep(Math.max(0, total - 2200));
  if (!ctx.cancelled())
    await animate(
      1100,
      (p) => paint(narrow + (wide - narrow) * ease.inOut(p)),
      ctx.cancelled,
    );
  t.remove();
}

async function eyes(d, ctx) {
  const total = clamp(d.params?.durationMs, 2000, 15000, 5000);
  const dark = el('div', 'fx-dark');
  const pair = el('div', 'fx-eyes');
  pair.append(
    Object.assign(document.createElement('span'), { className: 'fx-eye l' }),
  );
  pair.append(
    Object.assign(document.createElement('span'), { className: 'fx-eye r' }),
  );
  // Somewhere near a corner, never over the centre of the action.
  const left = Math.random() < 0.5;
  pair.style.left = left ? `${4 + Math.random() * 14}vw` : 'auto';
  pair.style.right = left ? 'auto' : `${4 + Math.random() * 14}vw`;
  pair.style.top = `${8 + Math.random() * 56}vh`;
  ctx.started();
  await animate(
    1200,
    (p) => (dark.style.opacity = String(ease.out(p))),
    ctx.cancelled,
  );
  await animate(
    600,
    (p) => (pair.style.opacity = String(ease.out(p))),
    ctx.cancelled,
  );
  await sleep(Math.max(0, total * 0.35));
  pair.classList.add('blink');
  await sleep(Math.max(300, total * 0.25));
  if (!ctx.cancelled())
    await animate(
      900,
      (p) => {
        pair.style.opacity = String(1 - p);
        dark.style.opacity = String(1 - ease.inOut(p));
      },
      ctx.cancelled,
    );
  dark.remove();
  pair.remove();
}

const SILHOUETTE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600"><defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#050307"/><stop offset="1" stop-color="#000"/></radialGradient></defs><path fill="url(#g)" d="M150 40c-38 0-64 30-64 72 0 30 14 54 32 66-42 10-78 38-92 84-12 42-18 120-22 190-2 44 0 92 0 148h292c0-56 2-104 0-148-4-70-10-148-22-190-14-46-50-74-92-84 18-12 32-36 32-66 0-42-26-72-64-72z"/><ellipse cx="128" cy="108" rx="7" ry="4" fill="#d8d0ff" opacity=".55"/><ellipse cx="172" cy="108" rx="7" ry="4" fill="#d8d0ff" opacity=".55"/></svg>`,
  );

async function silhouette(d, ctx) {
  const total = clamp(d.params?.durationMs, 1500, 15000, 4000);
  const img = el('img', 'fx-silhouette');
  img.src = SILHOUETTE;
  img.alt = '';
  const fromLeft = Math.random() < 0.5;
  img.style[fromLeft ? 'left' : 'right'] = '0';
  const hidden = fromLeft ? -100 : 100;
  const peek = fromLeft ? -45 : 45;
  img.style.transform = `translateX(${hidden}%)`;
  ctx.started();
  await animate(
    900,
    (p) =>
      (img.style.transform = `translateX(${hidden + (peek - hidden) * ease.out(p)}%)`),
    ctx.cancelled,
  );
  await sleep(Math.max(0, total - 1500));
  if (!ctx.cancelled())
    await animate(
      600,
      (p) =>
        (img.style.transform = `translateX(${peek + (hidden - peek) * ease.in(p)}%)`),
      ctx.cancelled,
    );
  img.remove();
}

async function glitch(d, ctx) {
  if (settings.safe_mode) throw new Error('safe_mode');
  const total = clamp(d.params?.durationMs, 800, 6000, 2500);
  const noise = el('canvas', 'fx-noise');
  noise.width = 320;
  noise.height = 180;
  noise.style.width = '100%';
  noise.style.height = '100%';
  const g = noise.getContext('2d');
  const bands = Array.from({ length: 5 }, () => el('div', 'fx-band'));
  ctx.started();
  const colors = [
    'rgba(255,0,60,0.55)',
    'rgba(0,255,220,0.5)',
    'rgba(140,90,255,0.5)',
  ];
  const t0 = performance.now();
  // ~11 changes per second, bands under a quarter of the screen: a glitch, never a strobe.
  while (!ctx.cancelled() && performance.now() - t0 < total) {
    const img = g.createImageData(320, 180);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (const b of bands) {
      const h = 1 + Math.random() * 5;
      b.style.top = `${Math.random() * (100 - h)}vh`;
      b.style.height = `${h}vh`;
      b.style.background = colors[Math.floor(Math.random() * colors.length)];
      b.style.transform = `translateX(${(Math.random() - 0.5) * 12}vw)`;
    }
    await sleep(90);
  }
  noise.remove();
  for (const b of bands) b.remove();
}

// --- screen effects (Chaos) : the whole monitor, captured and redrawn over itself ---------------------------------
// Played only by the CHAOS window (this page with ?role=chaos): Electron main answers getDisplayMedia with the monitor
// this window covers and excludes the window itself from every capture (Windows' display affinity) — so it never sees
// itself (no loop), whatever application is in front, and the image stays right when the streamer changes window.
// Nothing in Windows changes: when the play ends (or STOP ALL, or Studio closes) the capture stops and the real screen
// is there again. Mouse and keyboard keep going to what is underneath (the window is click-through). OBS cannot see
// this window either: Studio shows the viewers the same effect with filters on OBS's screen capture.

async function captureScreen(ctx) {
  if (!navigator.mediaDevices?.getDisplayMedia)
    throw new Error('capture_unsupported');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60 } },
      audio: false,
    });
  } catch {
    throw new Error('no_screen_capture');
  }
  const stop = () => stream.getTracks().forEach((t) => t.stop());
  if (ctx.cancelled()) {
    stop();
    return null;
  }
  ctx.onCancel(stop);
  const v = el('video', 'fx-capture');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  ctx.onCancel(() => (v.srcObject = null));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('capture_timeout')), 4000);
    ctx.onCancel(() => (clearTimeout(t), resolve()));
    v.addEventListener('playing', () => (clearTimeout(t), resolve()), {
      once: true,
    });
    v.play().catch(() => (clearTimeout(t), reject(new Error('play_refused'))));
  });
  return {
    v,
    stop,
    name: String(stream.getVideoTracks()[0]?.label ?? '').slice(0, 80),
  };
}

const FLIP = {
  rotate: (k) => `rotate(${180 * k}deg)`,
  mirror: (k) => `scaleX(${1 - 2 * k})`,
  vertical: (k) => `scaleY(${1 - 2 * k})`,
};

async function flip(d, ctx) {
  const total = clamp(d.params?.durationMs, 3000, 60000, 10000);
  const turn = FLIP[d.params?.mode] ?? FLIP.rotate;
  const g = await captureScreen(ctx);
  if (!g) return;
  ctx.started(g.name);
  await animate(
    700,
    (p) => (g.v.style.transform = turn(ease.inOut(p))),
    ctx.cancelled,
  );
  await sleep(Math.max(0, total - 1400));
  if (!ctx.cancelled())
    await animate(
      700,
      (p) => (g.v.style.transform = turn(1 - ease.inOut(p))),
      ctx.cancelled,
    );
  g.stop();
  g.v.remove();
}

/** Blur radius in px at 1080p (faible / moyen / fort, or a number). */
const BLUR = { low: 4, medium: 10, high: 22 };

async function blur(d, ctx) {
  const total = clamp(d.params?.durationMs, 2000, 30000, 6000);
  const level = d.params?.intensity;
  const px =
    (BLUR[level] ?? clamp(level, 2, 40, BLUR.medium)) *
    (window.innerHeight / 1080);
  const g = await captureScreen(ctx);
  if (!g) return;
  ctx.started(g.name);
  // Slightly enlarged while blurred: the blurred edges never let the sharp screen show through.
  const set = (k) => {
    g.v.style.filter = `blur(${(px * k).toFixed(2)}px)`;
    g.v.style.transform = `scale(${1 + (k * px * 3) / window.innerHeight})`;
  };
  await animate(500, (p) => set(ease.out(p)), ctx.cancelled);
  await sleep(Math.max(0, total - 1100));
  if (!ctx.cancelled())
    await animate(600, (p) => set(1 - ease.inOut(p)), ctx.cancelled);
  g.stop();
  g.v.remove();
}

const EFFECTS = { blink, fog, tunnel, eyes, silhouette, glitch, flip, blur };

// --- one play ------------------------------------------------------------------------------------------------------

async function run(d) {
  stopAll();
  let cancelled = false;
  let started = false;
  const cancelHooks = [];
  const ctx = {
    cancelled: () => cancelled,
    onCancel: (fn) => cancelHooks.push(fn),
    started: (detail) => {
      if (started) return;
      started = true;
      void report(d.delivery_id, 'started', undefined, detail);
    },
  };
  const me = {
    id: d.delivery_id,
    cancel() {
      cancelled = true;
      for (const fn of cancelHooks.splice(0)) fn();
    },
  };
  running = me;
  // Whatever happens, nothing stays on screen past this deadline.
  const deadline = setTimeout(
    () => me.cancel(),
    Math.min(90000, (Number(d.duration_ms) || 15000) + 20000),
  );
  try {
    if (d.media) await playMedia(d, ctx);
    else {
      const fx = EFFECTS[d.effect];
      if (!fx) throw new Error('unknown_effect');
      await fx(d, ctx);
    }
    if (!cancelled) await report(d.delivery_id, 'ended');
  } catch (e) {
    if (!cancelled)
      await report(
        d.delivery_id,
        'failed',
        String(e?.message ?? e).slice(0, 80),
      );
  } finally {
    clearTimeout(deadline);
    if (running === me) {
      running = null;
      clearStage();
    }
  }
}

async function loop() {
  if (!TOKEN) {
    notice.hidden = false;
    notice.textContent =
      'Overlay Halloween : ouvert sans sa clé (à ouvrir depuis Raptoru Studio).';
    return;
  }
  for (;;) {
    try {
      const r = await api(
        `/halloween/overlay/next?wait=1&ready=${CAN_PLAY ? 1 : 0}&epoch=${epoch}${ROLE === 'chaos' ? '&role=chaos' : ''}`,
      );
      if (r.stop_epoch !== epoch) {
        if (epoch !== -1) stopAll();
        epoch = r.stop_epoch;
      }
      settings = r.settings ?? settings;
      if (r.delivery) void run(r.delivery);
    } catch (e) {
      if (e?.status === 401) {
        notice.hidden = false;
        notice.textContent =
          'Overlay Halloween : clé refusée — relance l’overlay depuis Raptoru Studio.';
        await sleep(5000);
      } else await sleep(1000);
    }
  }
}

void loop();
