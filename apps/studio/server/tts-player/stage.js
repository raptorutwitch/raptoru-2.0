/* global document, setTimeout, clearTimeout, requestAnimationFrame */
// TTS V2 character stage (OBS overlay 1920×1080). Port of the validated prototype
// `prototypes/tts-v2-player/stage.js` (itself the legacy TTS_System.html sequence): enter → speech
// (mouth + motion, bubble, subtitles) → back to idle → outroHold → exit. The voice drives it from
// outside: the stage only knows « a word was just spoken » (pulse) and start / end.
import {
  MOTION_PRESETS,
  assetUrl,
  subtitlePages,
} from '/ext/shared/tts-characters.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isVideo = (file) => /\.(webm|mp4)$/i.test(file);

function media(base, file, loop, onError) {
  let el;
  if (isVideo(file)) {
    el = document.createElement('video');
    Object.assign(el, {
      muted: true,
      playsInline: true,
      loop: loop !== false,
      autoplay: true,
      preload: 'auto',
    });
  } else {
    el = document.createElement('img');
    el.alt = '';
  }
  el.addEventListener('error', () => onError(file), { once: true });
  el.src = assetUrl(base, file);
  return el;
}
const play = (el, restart) => {
  if (el && el.tagName === 'VIDEO') {
    if (restart) el.currentTime = 0;
    const p = el.play();
    if (p) p.catch(() => {});
  }
};
const pause = (el) => {
  if (el && el.tagName === 'VIDEO') el.pause();
};

export class CharacterStage {
  /** @param {HTMLElement} root @param {{assetBase:string, onMediaError?:(file:string)=>void}} options */
  constructor(root, options) {
    this.assetBase = options.assetBase;
    this.onMediaError = options.onMediaError || (() => {});
    this.root = root;
    root.classList.add('tts-stage');
    root.innerHTML =
      '<div class="tts-avatar"></div><div class="tts-bubble"><span class="tts-bubble__who"></span><span class="tts-bubble__text"></span></div>';
    this.avatar = root.querySelector('.tts-avatar');
    this.bubble = root.querySelector('.tts-bubble');
    this.who = root.querySelector('.tts-bubble__who');
    this.text = root.querySelector('.tts-bubble__text');
    this.profile = null;
    this.layers = {};
    this.session = 0;
    this.timers = new Set();
    this.state = 'empty';
    this.mouthHoldMs = 350;
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }
  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  /** Mounts the character (invisible): media, position, bubble, motion. */
  load(profile, { mouthHoldMs } = {}) {
    this.reset();
    this.profile = profile;
    this.mouthHoldMs = mouthHoldMs ?? profile.timing.mouthHoldMs;
    const a = this.avatar;
    a.style.setProperty('--avatar-scale', profile.stage.scale);
    a.style.setProperty('--avatar-x', `${profile.stage.offsetX}px`);
    a.style.setProperty('--avatar-dy', `${profile.stage.offsetY}px`);
    const preset = profile.talkMotion.preset;
    const defaults = MOTION_PRESETS[preset] || {};
    a.classList.add(`motion-${preset}`);
    a.style.setProperty(
      '--talk-px',
      `${profile.talkMotion.amplitudePx || defaults.defaultAmplitudePx || 0}px`,
    );
    a.style.setProperty('--talk-ms', `${defaults.durationMs || 280}ms`);
    const b = this.bubble.style;
    b.setProperty('--bubble-left', profile.bubble.left);
    b.setProperty('--bubble-bottom', `${profile.bubble.bottom}px`);
    b.setProperty('--bubble-width', `${profile.bubble.width}px`);
    this.root.style.setProperty('--accent', profile.accent);
    this.root.dataset.character = profile.id;

    const idle = media(
      this.assetBase,
      profile.assets.idle,
      true,
      this.onMediaError,
    );
    idle.classList.add('is-on');
    a.append(idle);
    this.layers.idle = idle;
    if (profile.renderMode === 'layered') {
      const mouth = media(
        this.assetBase,
        profile.assets.mouth,
        true,
        this.onMediaError,
      );
      a.append(mouth);
      this.layers.mouth = mouth;
      play(idle, true);
      play(mouth, true);
    } else {
      const talking = media(
        this.assetBase,
        profile.assets.talking,
        true,
        this.onMediaError,
      );
      a.append(talking);
      this.layers.talking = talking;
      play(idle, true);
    }
    this.state = 'loaded';
    return this;
  }

  /** Entry (legacy afficherScene) then introLead wait. */
  async enter() {
    if (!this.profile) return;
    const session = ++this.session;
    const a = this.avatar;
    a.classList.remove('is-exiting');
    a.classList.add('is-prep');
    void a.offsetHeight;
    requestAnimationFrame(() => {
      a.classList.remove('is-prep');
      a.classList.add('is-visible');
    });
    this.state = 'entering';
    await wait(this.profile.timing.introLeadMs);
    if (session === this.session) this.state = 'idle';
  }

  /** Mouth open / closed + motion (legacy ouvrirBouche / fermerBouche). */
  setTalking(on) {
    const p = this.profile;
    if (!p) return;
    this.avatar.classList.toggle(
      'is-talking',
      on && p.talkMotion.preset !== 'none',
    );
    if (p.renderMode === 'layered') {
      this.layers.mouth.classList.toggle('is-on', on);
      if (on) play(this.layers.mouth, false);
    } else {
      const show = on ? this.layers.talking : this.layers.idle;
      const hide = on ? this.layers.idle : this.layers.talking;
      if (!show.classList.contains('is-on')) {
        hide.classList.remove('is-on');
        pause(hide);
        show.classList.add('is-on');
        play(show, true);
      }
    }
    this.talking = on;
    if (this.state !== 'exiting') this.state = on ? 'talking' : 'idle';
  }

  /** A word was just spoken: mouth open, closed after mouthHoldMs without a word. */
  pulse() {
    this.setTalking(true);
    clearTimeout(this.mouthTimer);
    this.mouthTimer = setTimeout(
      () => this.setTalking(false),
      this.mouthHoldMs,
    );
  }

  /** Bubble: pseudo + paginated subtitles, shown after bubbleDelay (legacy). */
  showBubble(pseudo, message, estimatedMs) {
    const p = this.profile;
    const pages = subtitlePages(message, p.bubble.subtitleChars);
    const len = Array.from(String(message || '')).length;
    this.who.textContent = pseudo || '';
    this.bubble.classList.toggle('is-compact', len > 85 || pages.length > 1);
    const perPage = clamp(
      (estimatedMs || Math.max(2500, len * 85)) / pages.length,
      1200,
      3200,
    );
    let i = 0;
    const next = () => {
      this.text.textContent = pages[i];
      i += 1;
      if (i < pages.length) this.later(next, perPage);
    };
    next();
    this.later(
      () => this.bubble.classList.add('is-shown'),
      p.timing.bubbleDelayMs,
    );
  }
  hideBubble() {
    this.bubble.classList.remove('is-shown');
  }

  /** End of speech: back to idle, outroHold pause, exit (legacy aLaFin + sortirScene). */
  async finish() {
    clearTimeout(this.mouthTimer);
    this.setTalking(false);
    await wait(this.profile ? this.profile.timing.outroHoldMs : 0);
    await this.exit();
  }

  async exit() {
    if (!this.profile) return;
    const session = ++this.session;
    this.clearTimers();
    clearTimeout(this.mouthTimer);
    this.setTalking(false);
    this.hideBubble();
    this.avatar.classList.remove('is-visible', 'is-talking');
    this.avatar.classList.add('is-exiting');
    this.state = 'exiting';
    await wait(380);
    if (session === this.session) {
      this.reset();
      this.state = 'hidden';
    }
  }

  /** Immediate stop (moderation): mouth closed, idle, exit. */
  async stop() {
    this.clearTimers();
    await this.exit();
  }

  reset() {
    this.session += 1;
    this.clearTimers();
    clearTimeout(this.mouthTimer);
    this.hideBubble();
    for (const el of this.avatar.querySelectorAll('video')) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.avatar.className = 'tts-avatar';
    this.avatar.innerHTML = '';
    this.avatar.removeAttribute('style');
    delete this.root.dataset.character;
    this.layers = {};
    this.profile = null;
    this.talking = false;
    this.state = 'empty';
  }
}
