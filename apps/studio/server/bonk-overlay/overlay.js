/* global document, location, fetch, crypto, Image, setTimeout, setInterval, AbortSignal */
import { createAudioPlayer } from './engine/audio.js';
import { createScene } from './engine/scene.js';

// Bonk renderer. Transport unchanged (poll, renderer ACKs, URL checks); the visual and the sound are
// the VNext engine (engine/: trajectory families, sizes, impacts, density, adaptive sound).
// No catalog fetching, SAMMI, viewer progression or combos.
const renderer = crypto.randomUUID();
const token = location.hash.slice(1);
const stage = document.getElementById('stage');
const scene = createScene({ stage, audio: createAudioPlayer(), document });
const seen = new Set();
const twemojiUrl =
  /^assets\/twemoji\/svg\/[0-9a-f]{1,6}(-[0-9a-f]{1,6}){0,9}\.svg$/;
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
  // Only the URL shapes built by Core: the local Twemoji, or one CDN template per provider.
  // Anything else fails explicitly (never substituted by another image).
  const cdnUrl = {
    twitch:
      /^https:\/\/static-cdn\.jtvnw\.net\/emoticons\/v2\/[A-Za-z0-9_]{1,64}\/(static|animated)\/dark\/3\.0$/,
    '7tv': /^https:\/\/cdn\.7tv\.app\/emote\/[0-9A-Za-z]{24,26}\/4x\.webp$/,
    bttv: /^https:\/\/cdn\.betterttv\.net\/emote\/[0-9a-f]{24}\/3x$/,
    ffz: /^https:\/\/cdn\.frankerfacez\.com\/emote\/[0-9]{1,10}\/(animated\/)?[124]$/,
  };
  const src =
    i.provider === 'unicode' && twemojiUrl.test(i.emote_url)
      ? '/ext/' + i.emote_url
      : Object.hasOwn(cdnUrl, i.provider) &&
          cdnUrl[i.provider].test(i.emote_url)
        ? i.emote_url
        : null;
  if (!src || i.test_mode !== true || i.payment_mode !== 'simulated') {
    await ack(i, 'failed');
    return;
  }
  image.referrerPolicy = 'no-referrer';
  image.src = src;
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
  let shown;
  try {
    shown = await scene.play({ id: i.interaction_id, image });
  } catch {
    await ack(i, 'failed');
    return;
  }
  await shown.started;
  const started = ack(i, 'started');
  // Completion acknowledgement is ordered after started, even if the first response was lost.
  void shown.finished.then(async () => {
    await started;
    await ack(i, 'completed');
  });
  await started;
}
// Studio « Tester » preview: renderer only. No Core, no wallet, no delivery journal, no ACK: the shots
// come from Studio's memory and are only drawn. Local stagger (not the Salves cadence, lot 5).
async function showPreview(shot) {
  if (!twemojiUrl.test(String(shot.emote_url))) return;
  const image = new Image();
  image.src = '/ext/' + shot.emote_url;
  try {
    await image.decode();
  } catch {
    return;
  }
  void scene.play({ id: shot.preview_id, image }).catch(() => {});
}
setInterval(
  () =>
    void call('preview', {})
      .then(({ shots }) =>
        (shots ?? []).forEach((shot, n) =>
          setTimeout(() => void showPreview(shot), n * 180),
        ),
      )
      .catch(() => {}),
  250,
);
setInterval(() => void call('heartbeat', {}).catch(() => {}), 1500);
// After an OBS refresh, the previous page still counts as the live renderer for a few seconds and
// this first heartbeat is refused (renderer_already_connected). It must not stop the page: the
// interval keeps announcing us, and `next` simply returns nothing until we are the renderer.
await call('heartbeat', {}).catch(() => {});
while (true) {
  try {
    const { interaction } = await call('next', {});
    if (interaction) await play(interaction);
  } catch {
    /* Core/Studio exposes offline/unknown. Never invent success or replay effects. */
  }
  await sleep(100);
}
