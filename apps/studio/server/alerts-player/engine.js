/* global document, performance, window, SpeechSynthesisUtterance, setTimeout, clearTimeout, fetch, TextDecoder */
// Twitch alerts V1 (A2) — the alert engine, ONE implementation for the OBS player and the Studio preview. Port of the
// legacy page `Twitch_Alerts.html` (playAlert, createLetters, showSubgift, showBits, showDonation, Eren subtitles,
// finishAlert) driven by a frozen variant (Core) instead of the page's own table. Viewer data is untrusted: it is only
// ever inserted with textContent. No queue here: the caller (player = Core queue, preview = Studio tab) decides.
import {
  donationSizes,
  dofusFontSize,
  endPlan,
  fill,
  formatAmount,
  giftCounterDuration,
  pickNameColor,
  schedule,
  templateParts,
  textParts,
  visualLengthMs,
} from './timeline.js';

export function createAlertEngine({ stage, mediaUrl, log = () => {} }) {
  stage.textContent = '';
  const video = document.createElement('video');
  video.id = 'alertVideo';
  video.playsInline = true;
  const audio = document.createElement('audio');
  audio.id = 'alertAudio';
  const text = document.createElement('div');
  text.id = 'pseudoText';
  const subtitle = document.createElement('div');
  subtitle.id = 'erenSubtitle';
  subtitle.className = 'eren-subtitle';
  // Calibration (17/10/2026): two full-stage placement layers. `alertPlace` carries the whole animation (video + its
  // texts), `textPlace` the texts relative to it. Only these wrappers get the calibration transform: the elements'
  // own CSS animations (centring, slides, fades, Dofus, bits entrance) are untouched.
  const alertPlace = document.createElement('div');
  alertPlace.id = 'alertPlace';
  const textPlace = document.createElement('div');
  textPlace.id = 'textPlace';
  textPlace.append(text, subtitle);
  alertPlace.append(video, textPlace);
  stage.append(alertPlace, audio);

  /** Offset (stage px) + uniform scale from the stage's top-left corner; anything invalid draws as before. */
  const transformOf = (p) => {
    const n = (v, d, min, max) =>
      Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d;
    const x = n(p?.x, 0, -3840, 3840);
    const y = n(p?.y, 0, -3840, 3840);
    const s = n(p?.scale, 1, 0.1, 5);
    return x === 0 && y === 0 && s === 1
      ? ''
      : `translate(${x}px, ${y}px) scale(${s})`;
  };
  /** Applies a variant's placement ({ media, text }); none = the uncalibrated layout. */
  let parts = {};
  /** Text blocks placed on their own (`data-part`, e.g. the bits badge / sentence), around their own centre. */
  const placeParts = () => {
    for (const el of text.querySelectorAll('[data-part]'))
      el.style.transform = transformOf(parts[el.dataset.part]);
  };
  const place = (placement) => {
    alertPlace.style.transform = transformOf(placement?.media);
    textPlace.style.transform = transformOf(placement?.text);
    parts = placement?.parts ?? {};
    placeParts();
  };

  let current = null;
  let seekToken = 0;
  /** The viewer-name colour of the current alert (a new one per play; the preview timeline keeps the last one). */
  let nameColor = pickNameColor(null);
  stage.style.setProperty('--name-color', nameColor);
  /** Real time while playing (the seek uses a virtual clock instead). */
  const realClock = { clock: () => performance.now(), live: true };

  /** Drops every running / frozen CSS animation of the stage (their end state applies). */
  const clearAnimations = () =>
    stage.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  /** Legacy TTS volume 1; the preview's volume slider applies to it too. */
  let ttsVolume = 1;

  const resetText = () => {
    text.className = '';
    text.textContent = '';
    text.removeAttribute('style');
    subtitle.className = 'eren-subtitle';
    subtitle.textContent = '';
    subtitle.style.fontSize = '';
  };

  /** Shrinks a zone's font until its content fits (legacy loops). */
  const fit = (prop, start, min = 16) => {
    const content = text.firstElementChild;
    let size = start;
    text.style.setProperty(prop, size + 'px');
    while (
      content &&
      size > min &&
      (content.scrollWidth > text.clientWidth - 8 ||
        content.scrollHeight > text.clientHeight - 2)
    ) {
      size -= 1;
      text.style.setProperty(prop, size + 'px');
    }
  };

  const spans = (parts, wrapperClass) => {
    const wrap = document.createElement('span');
    wrap.className = wrapperClass;
    for (const [cls, value] of parts) {
      const s = document.createElement('span');
      if (cls) s.className = cls;
      s.textContent = value;
      wrap.append(s);
    }
    return wrap;
  };

  function showText(v, data, later, ctx) {
    if (v.textStyle === 'pseudo-classic') {
      text.textContent = '';
      text.append(spans(textParts(v, data), 'classic-content'));
      text.className = 'pseudo-classic show';
      text.style.top = v.textTop || '';
      return;
    }
    if (v.textStyle === 'pseudo-dofus') {
      const value = fill(v.text, data);
      text.textContent = '';
      for (const ch of value) {
        const s = document.createElement('span');
        s.className = 'letter';
        s.textContent = ch === ' ' ? ' ' : ch;
        text.append(s);
      }
      text.className = 'pseudo-dofus show';
      const base = v.maxFontSize || 44;
      const size = dofusFontSize(value.length, base);
      text.style.fontSize = size + 'px';
      text.style.top = `calc(${v.textTop} + ${(base - size) * 0.5}px)`;
      [...text.children].forEach((letter, index) =>
        later(
          () => {
            letter.classList.add('sweeping');
            later(() => letter.classList.remove('sweeping'), 200);
          },
          700 + index * 50,
        ),
      );
      return;
    }
    if (v.textStyle === 'pseudo-don') {
      const title = formatAmount(data.amount, data.currency) || 'don';
      const pseudo = String(data.pseudo ?? '');
      const message = String(data.message ?? '').trim();
      const sizes = donationSizes(pseudo, title, message);
      const b = v.textBox;
      const set = (k, val) => text.style.setProperty(k, val);
      set('--don-top', b.top);
      set('--don-left', b.left);
      set('--don-width', b.width);
      set('--don-height', b.height);
      set('--don-enter-duration', b.enterDuration + 'ms');
      set('--don-exit-duration', b.exitDuration + 'ms');
      set('--don-message-delay', b.messageDelay + 'ms');
      set('--don-message-lines', String(b.messageLines));
      set('--don-padding', b.padding);
      set('--don-name-size', sizes.name + 'px');
      set('--don-amount-size', sizes.amount + 'px');
      set('--don-message-size', sizes.message + 'px');
      const box = document.createElement('div');
      box.className = 'don-text-box';
      const line = spans(
        [
          ['don-name', pseudo],
          ['don-amount', title],
        ],
        'don-line-main',
      );
      const msg = document.createElement('div');
      msg.className = 'don-message';
      msg.textContent = message;
      box.append(line, msg);
      text.textContent = '';
      text.append(box);
      text.className = 'pseudo-don show' + (message ? '' : ' no-message');
      if (ctx.live) speak(v, pseudo, title, message, later);
      return;
    }
    // Zone texts: gifts, bits, raid.
    const zoneVar = {
      'pseudo-subgift': 'gift',
      'pseudo-bits': 'bits',
      'pseudo-zone': 'zone',
    }[v.textStyle];
    if (!zoneVar) return;
    const z = v.zone ?? { x: 600, y: 700, w: 720, h: 130 };
    text.style.setProperty(`--${zoneVar}-x`, z.x + 'px');
    text.style.setProperty(`--${zoneVar}-y`, z.y + 'px');
    text.style.setProperty(`--${zoneVar}-w`, z.w + 'px');
    text.style.setProperty(`--${zoneVar}-h`, z.h + 'px');
    const fadeMs = Math.max(
      1,
      (v.hideAt ?? 0) - (v.fadeOutAt ?? (v.hideAt ?? 0) - 350),
    );
    text.style.setProperty(`--${zoneVar}-fade-duration`, fadeMs + 'ms');
    const targeted = v.type === 'gift_targeted' && data.recipient;
    const wrapper = {
      gift: targeted ? 'gift-content gift-targeted-content' : 'gift-content',
      bits: 'bits-content',
      zone: 'zone-content',
    }[zoneVar];
    text.textContent = '';
    const pieces = textParts(v, data);
    const cut = pieces.findIndex(([cls]) => cls === 'bits-break');
    if (zoneVar === 'bits' && cut >= 0) {
      // Two blocks, each calibratable: the « × N » badge (top) and the sentence (bottom).
      const content = document.createElement('span');
      content.className = wrapper;
      const badge = spans(pieces.slice(0, cut), 'bits-line');
      badge.dataset.part = 'bitsBadge';
      const message = spans(pieces.slice(cut + 1), 'bits-line');
      message.dataset.part = 'bitsMessage';
      content.append(badge, message);
      text.append(content);
    } else text.append(spans(pieces, wrapper));
    text.className = v.textStyle + ' show';
    const counter = text.querySelector('.gift-count');
    const count = Math.max(1, Math.round(Number(data.count) || 1));
    // Sized with the final number in place: a long name must not push « × 20 » out of the bar as the counter grows.
    if (counter) counter.textContent = String(count);
    fit(
      `--${zoneVar}-font-size`,
      v.maxFontSize ?? (zoneVar === 'gift' ? 48 : Math.min(54, z.h)),
    );
    placeParts(); // after the fit: a moved block must not shrink the text
    if (counter) {
      const total = giftCounterDuration(count);
      const startedAt = ctx.clock();
      let previous = -1;
      const tick = () => {
        if (!counter.isConnected) return;
        const progress = Math.min(1, (ctx.clock() - startedAt) / total);
        const value = Math.min(
          count,
          Math.floor((1 - Math.pow(1 - progress, 3)) * count),
        );
        if (value !== previous) {
          counter.textContent = String(value);
          counter.classList.remove('tick');
          void counter.offsetWidth;
          counter.classList.add('tick');
          previous = value;
        }
        if (progress < 1) later(tick, 32);
        else counter.textContent = String(count);
      };
      tick();
    }
  }

  function speak(v, pseudo, amount, message, later) {
    if (!v.tts || !window.speechSynthesis) return;
    const sentence = fill(message ? v.tts.template : v.tts.templateNoMessage, {
      pseudo,
      amount,
      message,
    });
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(sentence);
      u.lang = v.tts.lang;
      u.volume = ttsVolume;
      later(() => window.speechSynthesis.speak(u), 0);
    } catch (e) {
      log('tts', e);
    }
  }

  function showSubtitle(v, data, index) {
    const s = v.subtitles[index];
    subtitle.textContent = '';
    subtitle.append(
      spans(templateParts(s.text, data, { pseudo: 'alert-name' }), ''),
    );
    subtitle.style.fontSize = '48px';
    let size = 48;
    while (subtitle.scrollWidth > 1740 && size > 36) {
      size -= 2;
      subtitle.style.fontSize = size + 'px';
    }
    subtitle.className = 'eren-subtitle show';
  }

  /** One text step of the variant's schedule (timeline.js). */
  function applyStep(v, data, step, later, ctx) {
    switch (step.action) {
      case 'text-show':
        return showText(v, data, later, ctx);
      case 'text-fade':
      case 'text-hide':
        text.className = v.textStyle + ' hide';
        return;
      case 'text-clear':
        text.className = '';
        text.textContent = '';
        return;
      case 'subtitle-show':
        return showSubtitle(v, data, step.index);
      case 'subtitle-tremble':
        subtitle.className = 'eren-subtitle tremble';
        return;
      case 'subtitle-out':
        subtitle.className = 'eren-subtitle out';
        return;
      case 'video-fade-out':
        video.classList.remove('money-visible');
        video.classList.add('money-fading-out');
        return;
    }
  }

  /** Video class / fade / loop of a variant (play and seek). */
  function dressVideo(v) {
    video.className = v.style || 'default';
    video.classList.toggle('money-fade', Boolean(v.videoFade));
    video.loop = Boolean(v.loop);
    video.playbackRate = 1;
    if (v.videoFade) {
      video.style.setProperty('--money-fade-in', v.videoFade.in + 'ms');
      video.style.setProperty('--money-fade-out', v.videoFade.out + 'ms');
    }
  }

  /** Stops the current alert at once (preview Stop, a new alert replacing it); clears a frozen timeline image. */
  function stop(reason = 'stopped') {
    seekToken++;
    if (current) return current.finish(reason);
    if (reason === 'stopped') window.speechSynthesis?.cancel();
    video.pause();
    audio.pause();
    video.style.visibility = 'hidden';
    resetText();
    clearAnimations();
  }

  /**
   * Plays one variant with its data. Resolves { reason } when the alert is over: 'video-ended', 'audio-ended',
   * 'duration' (success) or 'video-error', 'video-play-error', 'no-media', 'timeout', 'stopped'.
   * `onStarted` fires when the video really starts playing.
   */
  function play(v, data = {}, { volume, onStarted, placement } = {}) {
    stop('replaced');
    place(placement); // fixed for the whole alert (the OBS source gets the saved values with the claim)
    nameColor = pickNameColor(nameColor);
    stage.style.setProperty('--name-color', nameColor);
    ttsVolume = Math.min(1, Math.max(0, volume ?? 1));
    return new Promise((resolve) => {
      const timers = new Set();
      const later = (fn, ms) => {
        const id = setTimeout(
          () => {
            timers.delete(id);
            fn();
          },
          Math.max(0, Number(ms) || 0),
        );
        timers.add(id);
      };
      let done = false;
      const plan = endPlan(v);
      const finish = (reason) => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        timers.clear();
        // A sound that plays on (keepAudio) was already waited for: the alert ends with everything stopped.
        video.pause();
        audio.pause();
        // The donation TTS may outlive its alert (legacy); only an explicit Stop cuts it.
        if (reason === 'stopped') window.speechSynthesis?.cancel();
        video.style.visibility = 'hidden';
        video.classList.remove('money-visible', 'money-fading-out');
        video.onended = video.oncanplay = video.onerror = audio.onended = null;
        resetText();
        if (current?.finish === finish) current = null;
        resolve({ reason });
      };
      current = { finish };
      resetText();
      if (!v.video) return finish('no-media');

      const vol = Math.min(1, Math.max(0, volume ?? v.volume ?? 0.5));
      dressVideo(v);
      clearAnimations();
      video.style.visibility = 'hidden';
      video.muted = Boolean(v.audio); // an external sound replaces the video's own (legacy)
      video.volume = vol;
      video.src = mediaUrl(v.video);
      if (v.audio) {
        audio.src = mediaUrl(v.audio);
        audio.volume = vol;
        audio.load();
      } else audio.removeAttribute('src');

      for (const step of schedule(v))
        later(() => applyStep(v, data, step, later, realClock), step.at);

      video.oncanplay = () => {
        video.oncanplay = null;
        video.style.visibility = 'visible';
        video.classList.add('entered'); // media entrance (bits), from its first visible image
        if (v.videoFade) {
          void video.offsetWidth;
          video.classList.add('money-visible');
        }
        video
          .play()
          .then(() => onStarted?.())
          .catch((e) => {
            log('video-play-error', e);
            finish('video-play-error');
          });
        if (v.audio) audio.play().catch((e) => log('audio', e));
      };
      video.onerror = () => finish('video-error');
      video.onended = () => {
        if (!plan.waitVideoEnd) return;
        if (plan.keepAudio && !audio.ended && !audio.paused) {
          video.style.visibility = 'hidden';
          audio.onended = () => finish('audio-ended');
          return;
        }
        finish('video-ended');
      };
      if (plan.imposedMs) later(() => finish('duration'), plan.imposedMs);
      later(() => finish('timeout'), plan.safetyMs);
      video.load();
    });
  }

  /** Waits for one media event (rejects on the media's error). */
  const once = (el, ok) =>
    new Promise((resolve, reject) => {
      const done = (e) => {
        el.removeEventListener(ok, done);
        el.removeEventListener('error', done);
        if (e.type === 'error') reject(new Error('video-error'));
        else resolve();
      };
      el.addEventListener(ok, done);
      el.addEventListener('error', done);
    });

  /**
   * Whether the timeline may jump inside a media. The legacy VP8 + alpha files (Bits, MoneyTest: a single keyframe)
   * cannot: Chromium's jump errors, or after an earlier jump silently shows a corrupt image (and a test jump is not
   * a reliable probe). So the WebM header is read once per file: VP8 → decoded from its start instead.
   */
  const seekable = new Map();
  const probeSeek = (src) => {
    if (!seekable.has(src))
      seekable.set(
        src,
        fetch(src, { headers: { range: 'bytes=0-4095' } })
          .then((r) => r.arrayBuffer())
          .then((b) => !new TextDecoder('latin1').decode(b).includes('V_VP8'))
          .catch(() => false),
      );
    return seekable.get(src);
  };

  /**
   * Timeline fallback: plays the video muted from its start and pauses on the image
   * shown at `target` (s), within one image. Preview only: the OBS source never seeks.
   */
  async function decodeTo(v, target, token) {
    const half = 0.5 / (v.fps || 24);
    // Always from image 0 (the only keyframe), on a reloaded decoder.
    const src = video.getAttribute('src');
    video.removeAttribute('src');
    video.load();
    video.src = src;
    video.load();
    await once(video, 'loadeddata');
    if (token !== seekToken || half >= target) return;
    video.muted = true;
    video.playbackRate = 2;
    await new Promise((resolve) => {
      const onFrame = (_, meta) => {
        if (token !== seekToken || meta.mediaTime + half >= target) {
          video.pause();
          return resolve();
        }
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      video.onended = resolve;
      video.play().catch(resolve);
    });
    video.onended = null;
    video.playbackRate = 1;
  }

  /**
   * Studio preview timeline: the alert FROZEN at `ms` — the real video image, the texts as the same schedule leaves
   * them at that instant, each CSS animation paused at its own progress. No sound, no queue, no timer: the steps run
   * on a virtual clock. Resolves { ms, lengthMs, videoMs, marks }, or null when a newer seek / play replaced it.
   */
  async function seek(v, data = {}, ms = 0, placement) {
    stop('replaced');
    place(placement);
    const token = seekToken;
    if (!v.video) return { ms, lengthMs: 0, videoMs: 0, marks: [] };
    dressVideo(v);
    clearAnimations();
    video.muted = true;
    const src = mediaUrl(v.video);
    if (video.getAttribute('src') !== src || video.error) {
      video.src = src;
      video.load();
    }
    if (video.readyState < 1) await once(video, 'loadedmetadata');
    if (token !== seekToken) return null;
    const videoMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
    const at = Math.max(0, Number(ms) || 0);
    const past = !v.loop && videoMs > 0 && at >= videoMs;
    const target =
      (v.loop && videoMs ? at % videoMs : Math.min(at, videoMs)) / 1000;
    if (Math.abs(video.currentTime - target) > 1e-4 || video.readyState < 2) {
      if (!(await probeSeek(src))) await decodeTo(v, target, token);
      else if (token === seekToken)
        try {
          video.currentTime = target;
          await once(video, 'seeked');
        } catch {
          seekable.set(src, Promise.resolve(false));
          await decodeTo(v, target, token);
        }
      if (token !== seekToken) return null;
    }
    // After its end a video stays on its last image under an imposed duration, else it is gone (as in play).
    video.style.visibility =
      past && endPlan(v).waitVideoEnd ? 'hidden' : 'visible';

    // Virtual clock: every step (and nested delay) due by `at` runs in time order; each animation keeps its start.
    resetText();
    let now = 0;
    let seq = 0;
    const ctx = { clock: () => now, live: false };
    const queue = [];
    const startedAt = new Map();
    const later = (fn, delay) => {
      const due = now + Math.max(0, Number(delay) || 0);
      if (due <= at) queue.push({ due, seq: seq++, fn });
    };
    for (const step of schedule(v))
      later(() => applyStep(v, data, step, later, ctx), step.at);
    later(() => video.classList.add('entered'), 0);
    if (v.videoFade) later(() => video.classList.add('money-visible'), 0);
    // Running animations are moved to the virtual time first: a transition started by a later step (MoneyTest
    // fade-out after its fade-in) then starts from the value it really has at that instant.
    const advance = (t) => {
      for (const a of stage.getAnimations({ subtree: true })) {
        if (!startedAt.has(a)) startedAt.set(a, t);
        a.pause();
        a.currentTime = t - startedAt.get(a);
      }
    };
    while (queue.length) {
      queue.sort((x, y) => x.due - y.due || x.seq - y.seq);
      const task = queue.shift();
      advance(task.due);
      now = task.due;
      task.fn();
      advance(now);
    }
    advance(at);
    return {
      ms: at,
      lengthMs: visualLengthMs(v, videoMs),
      videoMs,
      marks: schedule(v).map((step) => ({ at: step.at, action: step.action })),
    };
  }

  return { play, stop, seek, place, video, audio };
}
