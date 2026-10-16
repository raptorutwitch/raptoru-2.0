/* global document, performance, window */
// Twitch alerts V1 (A2) — the Studio preview: the SAME engine as the OBS source, driven by the Studio tab through
// postMessage (same origin only). It never touches Core's queue (no claim, no report): play / stop / seek / volume.
// `seek` freezes the alert at one instant (timeline ±0.01 s / image by image), without sound.
import { createAlertEngine } from './engine.js';

const engine = createAlertEngine({
  stage: document.getElementById('stage'),
  mediaUrl: (name) => `media/${encodeURIComponent(name)}`,
});
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
  if (m.type === 'stop') return engine.stop('stopped');
  if (!m.variant) return;
  if (m.type === 'seek') {
    const id = ++run;
    try {
      const frame = await engine.seek(m.variant, m.data || {}, m.ms);
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
