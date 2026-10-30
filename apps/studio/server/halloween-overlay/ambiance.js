// « Ambiance Halloween » OBS source (docs/HALLOWEEN.md § 6 bis) — decor for the viewers, never on the streamer's
// screen: the spider around the webcam (loop), bats crossing now and then, a dark vignette at the edges. Studio decides
// (switches, interval, « bats now »); this page asks every 2 s. Studio unreachable for 15 s, or the switch off: the page
// shows nothing at all. One OBS source can show some layers only: ?layers=spider (or bats,vignette…).

const TOKEN = decodeURIComponent(location.hash.slice(1));
const LAYERS = new Set(
  (new URLSearchParams(location.search).get('layers') ?? 'spider,bats,vignette')
    .split(',')
    .map((x) => x.trim()),
);
const vignette = document.getElementById('vignette');
const spider = document.getElementById('spider');
const bats = document.getElementById('bats');
const notice = document.getElementById('notice');

const POLL_MS = 2000;
const GONE_MS = 15000;
let lastOk = 0;
let batsEpoch = null;
let stopEpoch = null;
let nextFlight = 0;
let flying = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (el, on) => (el.style.opacity = on ? '1' : '0');

function setSource(v, url) {
  if (!url) {
    delete v.dataset.src;
    if (v.getAttribute('src')) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    return;
  }
  if (v.dataset.src !== url) {
    v.dataset.src = url;
    v.src = url;
  }
}

async function fly() {
  if (flying || !bats.getAttribute('src')) return;
  flying = true;
  try {
    bats.currentTime = 0;
    show(bats, true);
    await bats.play().catch(() => {});
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 8000);
      bats.addEventListener('ended', () => (clearTimeout(t), resolve()), {
        once: true,
      });
    });
  } finally {
    show(bats, false);
    flying = false;
  }
}

function stopFlight() {
  bats.pause();
  show(bats, false);
}

function apply(s) {
  const a = s.settings;
  const on = a.enabled;
  // Vignette.
  const vOn = on && a.vignette && LAYERS.has('vignette');
  vignette.style.opacity = vOn ? String(a.vignette_strength) : '0';
  vignette.classList.toggle('on', vOn);
  // Spider: loaded only while shown (a 4 min 50 loop costs nothing when hidden).
  const sOn = on && a.spider && LAYERS.has('spider') && !!s.media.spider;
  setSource(spider, sOn ? s.media.spider : null);
  if (sOn) void spider.play().catch(() => {});
  show(spider, sOn);
  // Bats.
  const bOn = on && a.bats && LAYERS.has('bats') && !!s.media.bats;
  setSource(bats, bOn ? s.media.bats : null);
  if (!bOn) {
    stopFlight();
    nextFlight = 0;
  } else {
    // « Bats now » from Studio (never on the first answer: a reload replays nothing).
    if (batsEpoch !== null && s.bats_epoch !== batsEpoch) void fly();
    const every = a.bats_every_min * 60_000;
    if (!every) nextFlight = 0;
    else if (!nextFlight || nextFlight - Date.now() > every * 1.2)
      nextFlight = Date.now() + every * (0.8 + Math.random() * 0.4);
    else if (Date.now() >= nextFlight) {
      nextFlight = Date.now() + every * (0.8 + Math.random() * 0.4);
      void fly();
    }
  }
  if (stopEpoch !== null && s.stop_epoch !== stopEpoch) stopFlight();
  batsEpoch = s.bats_epoch;
  stopEpoch = s.stop_epoch;
}

function hideAll() {
  vignette.style.opacity = '0';
  show(spider, false);
  spider.pause();
  stopFlight();
}

async function loop() {
  if (!TOKEN) {
    notice.hidden = false;
    notice.textContent =
      'Ambiance Halloween : URL incomplète (copie-la depuis Raptoru Studio › Halloween).';
    return;
  }
  for (;;) {
    try {
      const res = await fetch('/halloween/ambiance/state', {
        headers: { 'x-overlay-token': TOKEN },
        cache: 'no-store',
      });
      if (res.status === 401) {
        hideAll();
        notice.hidden = false;
        notice.textContent =
          'Ambiance Halloween : clé refusée — recopie l’URL depuis Raptoru Studio.';
        await sleep(5000);
        continue;
      }
      notice.hidden = true;
      apply(await res.json());
      lastOk = Date.now();
    } catch {
      // Studio closed or restarting: after a while, nothing stays on the stream.
      if (Date.now() - lastOk > GONE_MS) hideAll();
    }
    await sleep(POLL_MS);
  }
}

void loop();
