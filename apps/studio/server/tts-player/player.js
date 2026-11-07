/* global document, location, fetch, crypto, window, setTimeout, clearTimeout, setInterval, clearInterval, performance, AbortSignal, SpeechSynthesisUtterance, URLSearchParams */

// TTS V2 local player (Lab) — OBS browser source 1920×1080 or Studio preview. Plays ONE TTS at a
// time, exactly as decided by Core (cast { character_id, voice_profile_id } chosen at admission):
// never re-drawn here. Voice sequence ported from the legacy TTS_System.html:
//   « <pseudo> a dit. » narrator (ACK `started` at its first audible onstart: that is when the
//   cooldown starts) → character entry → introLead → message in 180-char chunks (rate/pitch with
//   the profile variation) → mouth on each word boundary → back to idle → outroHold → exit →
//   ACK `completed`. Nothing is ever replayed: a TTS handed to this page is either proven (ACK)
//   or left to Studio/Core as execution_unknown.
import { CHARACTERS_BY_ID, resolveCast } from '/ext/shared/tts-characters.js';
import { CharacterStage } from './stage.js';
import {
  continuousSpeech,
  narratorVoice,
  splitSpeech,
  stableRandom,
  vary,
  voiceFor,
} from './speech.js';

const params = new URLSearchParams(location.search);
const PREVIEW = params.get('preview') === '1';
const MUTED = params.get('mute') === '1'; // tests: same sequence, silent utterances
const player = crypto.randomUUID();
const token = location.hash.slice(1);
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const enable = document.getElementById('enable');
const synth = window.speechSynthesis;
const START_TIMEOUT_MS = 8000;
/**
 * End guard (ASTRA-P2-028), mirroring Core's playing lease (rules playing_lease_factor = 2,
 * playing_lease_margin_ms = 30 s by default): a reading that started but never reports its end
 * releases the player — no ACK: it may have been heard, so Core's lease turns it into
 * execution_unknown (never replayed, no certain refund) — and the next TTS can play.
 */
const END_FACTOR = 2;
const END_MARGIN_MS = 30_000;
/** Resolvers of the utterances in flight: an abandoned reading stops waiting for them. */
const inFlight = new Set();
const VARIANT_MOUTH_HOLD_MS = 330; // legacy VARIANTE_BOURRE.pauseSeuil
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seen = new Set();
let voices = [];
let gapMs = 1500;
let session = 0;
let current = null; // { id, stop() }
let mediaError = null;

document.body.classList.toggle('is-preview', PREVIEW);
hud.hidden = !PREVIEW;
const say = (text) => {
  status.textContent = text;
  document.body.dataset.status = text;
};

const stage = new CharacterStage(document.getElementById('stage'), {
  assetBase: '/ext/',
  onMediaError: (file) => {
    mediaError = file;
  },
});

// --- Studio link ------------------------------------------------------------------------------------

async function call(path, data) {
  const response = await fetch('/tts-lab/player/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tts-token': token },
    body: JSON.stringify({ player, ...data }),
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'player_request_failed');
  return body;
}
async function heartbeat() {
  try {
    const reply = await call('heartbeat', { voices: voices.length });
    gapMs = Number(reply.transition_gap_ms ?? gapMs);
    document.body.dataset.module = reply.module_state;
    if (!current)
      say(
        voices.length
          ? idleText(reply.module_state)
          : 'Aucune voix Web Speech disponible.',
      );
  } catch (e) {
    if (e.message === 'player_already_connected')
      say('Un autre player TTS est déjà actif (OBS ou Studio).');
    else say('Studio indisponible.');
  }
}
const idleText = (state) =>
  state === 'paused'
    ? 'TTS en pause.'
    : state === 'disabled'
      ? 'TTS désactivé.'
      : 'Prêt · en attente de TTS.';
/** Où en est la lecture : Studio montre le même mot que la source OBS. Sans réponse attendue, rien ne dépend de ce signal. */
function report(i, phase, char = 0) {
  void fetch('/tts-lab/player/progress', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tts-token': token },
    body: JSON.stringify({
      player,
      interaction_id: i.interaction_id,
      phase,
      char,
    }),
    signal: AbortSignal.timeout(1000),
  }).catch(() => {});
}
async function ack(i, event, error) {
  // Retry only the acknowledgement, never the reading. Bounded by the Core lease.
  for (let n = 0; n < 20; n++) {
    try {
      await call('ack', {
        interaction_id: i.interaction_id,
        attempt_id: i.delivery.attempt_id,
        event,
        ...(error ? { error } : {}),
      });
      return;
    } catch {
      await sleep(500);
    }
  }
}

// --- voices (legacy chargerVoix / chercherVoix / choisirVoix) --------------------------------------

function loadVoices() {
  voices = synth ? synth.getVoices() : [];
  document.body.dataset.voices = String(voices.length);
}
if (synth) synth.addEventListener('voiceschanged', loadVoices);
loadVoices();

// --- one reading --------------------------------------------------------------------------------------

function utter(text, { voice, lang, rate, pitch }) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  if (voice) u.voice = voice;
  u.rate = rate;
  u.pitch = pitch;
  u.volume = MUTED ? 0 : 1;
  return u;
}
/** Speaks one utterance; resolves 'end' or rejects with the speech error. */
function speak(u, { onstart, onboundary, sid }) {
  return new Promise((resolve, reject) => {
    const settle = (fn) => (v) => {
      inFlight.delete(abandon);
      fn(v);
    };
    const abandon = settle(resolve);
    inFlight.add(abandon);
    u.onstart = () => sid === session && onstart && onstart();
    u.onboundary = (e) =>
      sid === session && onboundary && onboundary(e && e.charIndex);
    u.onend = () => settle(resolve)('end');
    u.onerror = (e) =>
      settle(reject)(
        Object.assign(new Error((e && e.error) || 'speech_error'), {
          speech: true,
        }),
      );
    synth.speak(u);
  });
}

async function play(i) {
  if (seen.has(i.interaction_id)) return;
  seen.add(i.interaction_id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  const sid = ++session;
  let started = false;
  let startedAck = null;
  let continuousTimer = null;
  let endGuard = null;
  let lastBoundary = 0;
  const alive = () => sid === session;
  current = { id: i.interaction_id };
  document.body.dataset.playing = i.interaction_id;
  const fail = async (code, message) => {
    if (!alive()) return;
    session += 1; // drops every late callback of this reading
    clearInterval(continuousTimer);
    if (synth) synth.cancel();
    await stage.stop();
    if (startedAck) await startedAck;
    await ack(i, 'failed', { code, message });
    say(`Échec TTS (${code}).`);
  };

  try {
    const cast = resolveCast(i.cast);
    if (i.test_mode !== true || i.payment_mode !== 'simulated')
      return await fail('invalid_interaction', 'lab only');
    if (!cast.ok) return await fail('invalid_cast', cast.error);
    if (!synth || !voices.length)
      return await fail('speech_unavailable', 'no Web Speech voice');
    const voice = voiceFor(voices, cast.voice);
    // Strict voice (drunk variant): Core promised this voice, so no silent substitute; nothing was
    // heard, the viewer is refunded by Core.
    if (!voice)
      return await fail(
        'voice_unavailable',
        `voice ${cast.voice.id} missing on this machine`,
      );
    const character = CHARACTERS_BY_ID[cast.character.id];
    mediaError = null;
    stage.load(character, {
      mouthHoldMs:
        cast.category === 'variant' ? VARIANT_MOUTH_HOLD_MS : undefined,
    });
    const random = stableRandom(i.interaction_id);
    const rate = vary(
      cast.voice.rate,
      cast.voice.variationRate,
      0.1,
      10,
      random,
    );
    const pitch = vary(
      cast.voice.pitch,
      cast.voice.variationPitch,
      0,
      2,
      random,
    );
    const pseudo = i.viewer_display_name;
    say(`${pseudo} a dit…`);

    // Nothing audible within the timeout (voice engine stuck): a clean, refunded failure.
    const startTimer = setTimeout(() => {
      if (!started) void fail('start_timeout', 'speech did not start');
    }, START_TIMEOUT_MS);
    const markStarted = () => {
      if (started) return;
      started = true;
      clearTimeout(startTimer);
      startedAck = ack(i, 'started');
      endGuard = setTimeout(
        () => {
          if (!alive()) return;
          // Started, no end ever reported: silence, drop late callbacks, free the player, no ACK.
          session += 1;
          clearInterval(continuousTimer);
          if (synth) synth.cancel();
          void stage.stop();
          for (const release of [...inFlight]) release('abandoned');
          say('TTS interrompu : fin non signalée (résultat inconnu).');
        },
        Math.max(0, Number(i.estimated_duration_ms) || 0) * END_FACTOR +
          END_MARGIN_MS,
      );
    };

    synth.cancel();
    await speak(
      utter(`${pseudo} a dit.`, {
        voice: narratorVoice(voices),
        lang: 'fr-FR',
        rate: 1,
        pitch: 1,
      }),
      {
        sid,
        onstart: markStarted,
      },
    ).catch((e) => {
      throw Object.assign(e, { narrator: true });
    });
    if (!alive()) return;
    if (mediaError) return await fail('media_missing', mediaError);

    await stage.enter();
    if (!alive()) return;
    const continuous = continuousSpeech(i.message);
    const chunks = splitSpeech(i.message);
    let offset = 0;
    let lastReport = 0;
    for (let k = 0; k < chunks.length; k++) {
      if (!alive()) return;
      const base = offset;
      offset += chunks[k].length;
      await speak(
        utter(chunks[k], { voice, lang: cast.voice.lang, rate, pitch }),
        {
          sid,
          onstart:
            k === 0
              ? () => {
                  markStarted();
                  stage.showBubble(pseudo, i.message);
                  report(i, 'speaking');
                  lastBoundary = performance.now();
                  stage.pulse();
                  // Legacy lancerParoleContinue: repetitive text keeps the mouth open between words.
                  continuousTimer = setInterval(() => {
                    if (!alive()) return clearInterval(continuousTimer);
                    if (continuous && performance.now() - lastBoundary > 450)
                      stage.setTalking(true);
                  }, 220);
                  say(`${character.displayName} lit le message de ${pseudo}…`);
                }
              : undefined,
          onboundary: (char) => {
            lastBoundary = performance.now();
            stage.pulse();
            if (typeof char !== 'number') return;
            stage.spokenAt(base + char);
            if (lastBoundary - lastReport > 200) {
              lastReport = lastBoundary;
              report(i, 'speaking', base + char);
            }
          },
        },
      );
    }
    if (!alive()) return;
    clearInterval(continuousTimer);
    report(i, 'finished');
    await stage.finish();
    if (!alive()) return;
    await startedAck;
    await ack(i, 'completed');
    say(`${character.displayName} a fini.`);
  } catch (e) {
    if (e && e.speech)
      await fail(e.narrator ? 'narrator_error' : 'speech_error', e.message);
    else
      await fail('player_error', String((e && e.message) || e).slice(0, 200));
  } finally {
    clearInterval(continuousTimer);
    clearTimeout(endGuard);
    if (current && current.id === i.interaction_id) current = null;
    delete document.body.dataset.playing;
  }
}

/**
 * Moderation stop (Core already cancelled it): silence and exit now, then prove it with `stopped`
 * (Studio proposes the order again until then). Idempotent: already silent, it only proves it.
 */
async function stop(id, attemptId) {
  if (current && current.id === id) await silence();
  void ack(
    { interaction_id: id, delivery: { attempt_id: attemptId } },
    'stopped',
  );
}
async function silence() {
  session += 1;
  if (synth) synth.cancel();
  await stage.stop();
  current = null;
  delete document.body.dataset.playing;
  say('TTS arrêté par la modération.');
}

// Browsers may require a gesture before speech: the Studio preview offers it (OBS does not need it).
enable.hidden = !PREVIEW;
enable.addEventListener('click', () => {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  synth.speak(u);
  loadVoices();
  enable.hidden = true;
  void heartbeat();
});

setInterval(() => void heartbeat(), 1500);
await heartbeat();
let freeAt = 0; // end of the breathing gap after the previous TTS
while (true) {
  try {
    // A new TTS is only accepted when this page is free (Studio marks it sent when handing it out);
    // stop commands are still received during a reading.
    const accept = !current && performance.now() >= freeAt;
    const { command } = await call('next', { accept });
    if (command && 'stop' in command)
      await stop(command.stop, command.attempt_id);
    else if (command && 'play' in command)
      void play(command.play).finally(() => {
        freeAt = performance.now() + gapMs;
      });
  } catch {
    /* Studio unavailable: never invent a result. */
  }
  await sleep(current ? 300 : 200);
}
