/* global document, location, fetch, crypto, Image, Audio, setTimeout, setInterval, requestAnimationFrame, AbortSignal */
import { buildBonkTrajectory } from './bonk-v3-core.js';

// Thin Lab renderer. Trajectory/physics are copied unchanged from the canonical legacy engine.
// No catalog fetching, SAMMI, viewer progression or combos in this first slice.
const renderer = crypto.randomUUID();
const token = location.hash.slice(1);
const stage = document.getElementById('stage');
const seen = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(path, data) {
  const response = await fetch('/bonk-lab/renderer/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bonk-token': token },
    body: JSON.stringify({ renderer, ...data }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('renderer_request_failed');
  return response.json();
}
async function ack(i, event) {
  // Retry only the acknowledgement, never the visual effect. Bounded by Core execution lease.
  for (let n = 0; n < 20; n++) {
    try {
      await call('ack', {
        interaction_id: i.interaction_id,
        attempt_id: i.delivery.attempt_id,
        event,
      });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('ack_unconfirmed');
}
async function play(i) {
  if (seen.has(i.interaction_id)) return;
  seen.add(i.interaction_id);
  if (seen.size > 1000) seen.delete(seen.values().next().value);
  const image = new Image();
  image.className = 'projectile';
  // One trusted asset for the slice. No remote URL or user supplied URL is interpreted.
  if (
    i.emote_url !== 'assets/twemoji/svg/1f600.svg' ||
    i.test_mode !== true ||
    i.payment_mode !== 'simulated'
  ) {
    await ack(i, 'failed');
    return;
  }
  image.src = '/ext/' + i.emote_url;
  try {
    await Promise.race([
      image.decode(),
      sleep(3000).then(() => {
        throw new Error('image_timeout');
      }),
    ]);
  } catch {
    await ack(i, 'failed');
    return;
  }
  const trajectory = buildBonkTrajectory({
    impactX: 960,
    impactY: 400,
    size: 150,
    referenceId: i.interaction_id,
  });
  stage.append(image);
  const animation = image.animate(trajectory.keyframes, {
    duration: trajectory.duration,
    fill: 'both',
    easing: 'linear',
  });
  await animation.ready;
  let impact = false;
  const monitor = () => {
    if (!impact && Number(animation.currentTime) >= trajectory.impactMs) {
      impact = true;
      const ring = document.createElement('div');
      ring.className = 'impact';
      stage.append(ring);
      ring
        .animate(
          [
            { transform: 'scale(.3)', opacity: 1 },
            { transform: 'scale(1.6)', opacity: 0 },
          ],
          { duration: 250 },
        )
        .finished.finally(() => ring.remove());
      const audio = new Audio('/ext/assets/sounds/punch-2.mp3');
      audio.volume = 0.4;
      void audio.play().catch(() => {});
    }
    if (animation.playState !== 'finished' && image.isConnected)
      requestAnimationFrame(monitor);
  };
  requestAnimationFrame(monitor);
  const started = ack(i, 'started');
  // Completion acknowledgement is ordered after started, even if the first response was lost.
  void animation.finished
    .then(async () => {
      image.remove();
      await started;
      await ack(i, 'completed');
    })
    .catch(() => {
      image.remove();
      void ack(i, 'failed').catch(() => {});
    });
  setTimeout(() => image.remove(), trajectory.duration + 1000);
  await started;
}
setInterval(() => void call('heartbeat', {}).catch(() => {}), 1500);
await call('heartbeat', {});
while (true) {
  try {
    const { interaction } = await call('next', {});
    if (interaction) await play(interaction);
  } catch {
    /* Core/Studio exposes offline/unknown. Never invent success or replay effects. */
  }
  await sleep(100);
}
