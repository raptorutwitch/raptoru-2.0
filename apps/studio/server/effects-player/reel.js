/* global setTimeout */
// Random Ban « Le Viseur » (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 5) — the reel of the effects player. Loaded by
// player.js only for a reel / a dodge. It SHOWS what Core already decided: the strip (an order Core shuffled, the drawn
// target at `stop`, the predicted viewer never right next to it) scrolls, slows down and stops ON the target —
// « Tiré au sort : Kiwi ». « BANNI » is never written here: the ban video plays only after Twitch confirmed (Core hands
// it out next). A dodge (Twitch refused the timeout) is its own short card. No image is fetched: avatars are initials
// on a colour drawn from the Twitch id, the same for a viewer every time.

const STYLE_ID = 'rb-reel-style';
const CSS = `
.rbr{position:absolute;left:50%;top:14%;transform:translateX(-50%) scale(.96);opacity:0;transition:opacity .35s,transform .35s;
  font-family:'Montserrat','Segoe UI',system-ui,sans-serif;color:#3b1530;text-align:center;pointer-events:none}
.rbr.on{opacity:1;transform:translateX(-50%) scale(1)}
.rbr__band{display:inline-block;margin-bottom:14px;padding:8px 22px;border-radius:999px;background:#1a1024e6;color:#f4d3dc;
  font-weight:800;font-size:30px;letter-spacing:.02em;box-shadow:0 8px 30px #0008}
.rbr__band b{color:#ffffff}
.rbr__win{position:relative;width:820px;height:168px;margin:0 auto;border-radius:28px;overflow:hidden;
  background:linear-gradient(180deg,#f8e1e7,#f1c6d2);box-shadow:0 14px 50px #000a, inset 0 0 0 4px #e58aa6}
.rbr__strip{position:absolute;top:24px;left:0;display:flex;gap:16px;will-change:transform}
.rbr__av{flex:none;width:120px;height:120px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:44px;
  color:#fff;text-shadow:0 2px 6px #0006;box-shadow:inset 0 0 0 4px #ffffff88}
.rbr__sight{position:absolute;left:50%;top:50%;width:148px;height:148px;transform:translate(-50%,-50%);border-radius:50%;
  border:6px solid #a3244f;box-shadow:0 0 0 4px #ffffffaa, 0 0 26px #a3244f88}
.rbr__sight::before,.rbr__sight::after{content:'';position:absolute;background:#a3244f}
.rbr__sight::before{left:50%;top:-22px;bottom:-22px;width:6px;transform:translateX(-50%)}
.rbr__sight::after{top:50%;left:-22px;right:-22px;height:6px;transform:translateY(-50%)}
.rbr__res{margin-top:16px;min-height:52px;font-weight:900;font-size:40px;color:#ffffff;text-shadow:0 4px 18px #000c;opacity:0;
  transform:translateY(8px);transition:opacity .3s,transform .3s}
.rbr__res.on{opacity:1;transform:none}
.rbr--dodge .rbr__res{font-size:56px;color:#ffe7f0}
@media (prefers-reduced-motion: reduce){.rbr,.rbr__res{transition:none}}
`;

const PALETTE = [
  '#e58aa6',
  '#b56cd6',
  '#6c8be0',
  '#4bb3a5',
  '#e0a24b',
  '#d0626e',
  '#7b6ce0',
  '#58a65c',
];
const colour = (id) =>
  PALETTE[
    [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) %
      PALETTE.length
  ];
const initials = (name) =>
  String(name || '?')
    .replace(/[_\d]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  doc.head.append(s);
}

const text = (doc, tag, cls, value) => {
  const n = doc.createElement(tag);
  n.className = cls;
  n.textContent = value;
  return n;
};

/**
 * reel = { trigger, target: { id, name }, items: [{ id, name }], stop, self, wish, duration_ms }.
 * Resolves once the card left the screen.
 */
export async function playReel(stage, reel, o = {}) {
  const doc = stage.ownerDocument;
  ensureStyle(doc);
  const reduced =
    o.reducedMotion ??
    doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
    false;
  const root = doc.createElement('div');
  root.className = 'rbr';
  const band = doc.createElement('div');
  band.className = 'rbr__band';
  band.append('🎲 Random Ban de ', text(doc, 'b', '', reel.trigger));
  if (reel.wish) band.append(` · 🎯 vise ${reel.wish}`);
  const win = doc.createElement('div');
  win.className = 'rbr__win';
  const strip = doc.createElement('div');
  strip.className = 'rbr__strip';
  const items =
    Array.isArray(reel.items) && reel.items.length ? reel.items : [reel.target];
  const stop =
    Number.isInteger(reel.stop) && reel.stop >= 0 && reel.stop < items.length
      ? reel.stop
      : items.length - 1;
  for (const it of items) {
    const av = text(doc, 'div', 'rbr__av', initials(it.name));
    av.style.background = colour(it.id);
    av.title = it.name;
    strip.append(av);
  }
  win.append(strip, doc.createElement('div'));
  win.lastChild.className = 'rbr__sight';
  const res = text(
    doc,
    'div',
    'rbr__res',
    reel.self
      ? `CSC ! ${reel.target.name} s’est tiré lui-même`
      : `Tiré au sort : ${reel.target.name}`,
  );
  root.append(band, win, res);
  stage.append(root);
  const STEP = 136; // avatar 120 + gap 16
  const centre = (i) => 820 / 2 - (i * STEP + 60);
  const total = Math.max(
    1500,
    Math.min(8000, Number(reel.duration_ms) || 4500),
  );
  await wait(30);
  root.classList.add('on');
  if (reduced || items.length === 1) {
    strip.style.transform = `translateX(${centre(stop)}px)`;
    await wait(Math.min(1200, total / 3));
  } else {
    // Ease-out (cubic): fast, then slower and slower until the target sits in the sight.
    strip.style.transform = `translateX(${centre(0)}px)`;
    await wait(250);
    const spin = total - 600;
    strip.style.transition = `transform ${spin}ms cubic-bezier(.12,.72,.18,1)`;
    strip.style.transform = `translateX(${centre(stop)}px)`;
    await wait(spin);
  }
  res.classList.add('on');
  stage.dataset.reelLanded = String(reel.target.id);
  await wait(1400);
  root.classList.remove('on');
  await wait(380);
  root.remove();
}

/** dodge = { trigger, banned }: Twitch refused the timeout after the reel — « Esquivé ! », the buyer is refunded. */
export async function playDodge(stage, d) {
  const doc = stage.ownerDocument;
  ensureStyle(doc);
  const root = doc.createElement('div');
  root.className = 'rbr rbr--dodge';
  const band = doc.createElement('div');
  band.className = 'rbr__band';
  band.append(
    `${d.banned} a esquivé le Random Ban de `,
    text(doc, 'b', '', d.trigger),
  );
  const res = text(doc, 'div', 'rbr__res', 'Esquivé !');
  root.append(band, res);
  stage.append(root);
  await wait(30);
  root.classList.add('on');
  res.classList.add('on');
  await wait(2200);
  root.classList.remove('on');
  await wait(380);
  root.remove();
}
