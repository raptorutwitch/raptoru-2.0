/* global document, performance, window */
// Twitch alerts V1 (A2) — the Studio preview: the SAME engine as the OBS source, driven by the Studio tab through
// postMessage (same origin only). It never touches Core's queue (no claim, no report): play / stop / seek / volume.
// `seek` freezes the alert at one instant (timeline ±0.01 s / image by image), without sound.
// Families (17/10/2026): the edited alert has its own layer, stacked by its family like in the OBS source; `overlay`
// plays other families' variants at the same time in temporary layers (overlap test, local only, never the queue).
import { createAlertEngine } from './engine.js';
import { familyLayer, familyOf, pickNameColor } from './timeline.js';

const stage = document.getElementById('stage');
const mediaUrl = (name) => `media/${encodeURIComponent(name)}`;
const layer = (family) => {
  const el = document.createElement('div');
  el.className = 'alert-layer';
  el.dataset.family = family;
  el.style.zIndex = String(familyLayer(family));
  stage.append(el);
  return el;
};
const mainLayer = layer('follow');
const engine = createAlertEngine({ stage: mainLayer, mediaUrl });
const stack = (variant) => {
  const family = familyOf(variant.type);
  mainLayer.dataset.family = family;
  mainLayer.style.zIndex = String(familyLayer(family));
};

/** Overlap test: one temporary engine per other family, destroyed at its end or on Stop. */
const extras = new Map();
const dropExtra = (family) => {
  const x = extras.get(family);
  if (!x) return;
  extras.delete(family);
  x.engine.destroy();
  x.layer.remove();
};
function overlay(items, volume) {
  const used = [engine.nameColor];
  for (const { variant, data, placement } of items) {
    const family = familyOf(variant.type);
    if (family === mainLayer.dataset.family) continue; // one alert per family, as in OBS
    dropExtra(family);
    const x = { layer: layer(family) };
    x.engine = createAlertEngine({ stage: x.layer, mediaUrl });
    extras.set(family, x);
    const nameColor = pickNameColor(used);
    used.push(nameColor);
    void x.engine
      .play(variant, data || {}, { volume, placement, nameColor })
      .then(() => extras.get(family) === x && dropExtra(family));
  }
}
let run = 0;

const tell = (msg) =>
  window.parent.postMessage(
    { source: 'alerts-preview', ...msg },
    window.location.origin,
  );

window.addEventListener('message', async (ev) => {
  if (ev.origin !== window.location.origin || ev.source !== window.parent)
    return;
  const m = ev.data || {};
  if (m.type === 'stop') {
    for (const f of [...extras.keys()]) dropExtra(f);
    return engine.stop('stopped');
  }
  if (m.type === 'overlay') return overlay(m.items || [], m.volume);
  // Calibration editor: moves the current image / alert at once (unsaved values, preview only).
  if (m.type === 'place') return engine.place(m.placement);
  if (!m.variant) return;
  stack(m.variant);
  if (m.type === 'seek') {
    const id = ++run;
    try {
      const frame = await engine.seek(
        m.variant,
        m.data || {},
        m.ms,
        m.placement,
      );
      if (frame) tell({ type: 'frame', run: id, ...frame });
    } catch (e) {
      tell({
        type: 'state',
        run: id,
        state: 'ended',
        reason: e.message || 'video-error',
        ms: 0,
      });
    }
    return;
  }
  if (m.type !== 'play') return;
  const id = ++run;
  tell({ type: 'state', run: id, state: 'loading' });
  const startedAt = performance.now();
  const { reason } = await engine.play(m.variant, m.data || {}, {
    volume: m.volume,
    placement: m.placement,
    onStarted: () => tell({ type: 'state', run: id, state: 'playing' }),
  });
  tell({
    type: 'state',
    run: id,
    state: 'ended',
    reason,
    ms: Math.round(performance.now() - startedAt),
  });
});

tell({ type: 'ready' });
