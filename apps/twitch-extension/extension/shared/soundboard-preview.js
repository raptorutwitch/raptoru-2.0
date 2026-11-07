// Soundboard — the viewer's LOCAL preview (extracted from ui.js, docs/studio-refonte/architecture/MIGRATIONS.md). It owns
// its state (the audio element, the sound being heard, the volume) and its resource (one Audio at a time, stopped and
// rewound when replaced or when the Soundboard closes). A preview is never a purchase: nothing is sent, nothing is paid.
// Twitch requires an extension's audio to start muted: the volume is 0 until the viewer raises it (kept locally).

const PREVIEW_VOLUME_KEY = 'raptoru-live:soundboard-preview-volume';

/** The preview URLs of a sound (one per variant, or its own). */
export function soundPreviewUrls(sound) {
  const variants = Array.isArray(sound?.variants) ? sound.variants : [];
  const urls = variants.length ? variants.map((variant) => variant?.preview_url) : [sound?.preview_url];
  return urls.filter(Boolean).map(String);
}

/** One of them at random (a sound with variants previews a random one, as it plays one at random). */
export function chooseSoundPreviewUrl(sound, random = Math.random) {
  const urls = soundPreviewUrls(sound);
  if (!urls.length) return null;
  const raw = Number(random());
  const bounded = Number.isFinite(raw) ? raw : 0;
  const index = Math.min(urls.length - 1, Math.max(0, Math.floor(bounded * urls.length)));
  return urls[index];
}

export function clampPreviewVolume(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function readPreviewVolume(storage) {
  try {
    const saved = Number(storage?.getItem(PREVIEW_VOLUME_KEY));
    // Twitch exige que l'audio d'une extension soit coupé par défaut.
    // Le viewer peut l'activer explicitement avec le curseur avant l'aperçu.
    return Number.isFinite(saved) ? clampPreviewVolume(saved) : 0;
  } catch {
    return 0;
  }
}

/**
 * `root()` → the element holding the sound cards (their ▶ buttons show which one is heard). `notice(text)` per play:
 * the Soundboard's bar message (volume at 0, preview unavailable).
 */
export function createSoundPreview({
  document,
  root,
  storage = globalThis.localStorage,
  AudioCtor = globalThis.Audio,
  log = console,
}) {
  let audio = null;
  let restore = null;
  let soundId = null;
  let volume = readPreviewVolume(storage);

  function syncButtons() {
    const host = root();
    if (!host) return;
    for (const button of host.querySelectorAll('.sbx-card__play')) {
      if (button.disabled) continue;
      const active = Boolean(soundId) && button.dataset.soundId === soundId;
      const label = button.dataset.soundLabel || 'ce son';
      button.classList.toggle('is-previewing', active);
      button.closest('.sbx-card')?.classList.toggle('is-previewing', active);
      button.setAttribute('aria-pressed', String(active));
      button.title = active ? 'Arrêter l’aperçu' : 'Écouter (aperçu, rien n’est envoyé)';
      button.setAttribute('aria-label', active ? `Arrêter l’aperçu de ${label}` : `Écouter ${label}`);
    }
  }

  function stop() {
    const playing = audio;
    const done = restore;
    audio = null;
    restore = null;
    soundId = null;
    try {
      playing?.pause();
      if (playing) playing.currentTime = 0;
    } catch {
      /* le nettoyage audio reste best-effort */
    }
    done?.();
    syncButtons();
  }

  async function play(sound, trigger = null, { notice = () => {} } = {}) {
    if (!soundPreviewUrls(sound).length) return;
    if (!volume) {
      notice('Monte le volume des aperçus (🔊 en haut) pour écouter.');
      return;
    }
    let mine = null;
    const id = String(sound.id);
    const ended = () => {
      trigger?.classList.remove('is-previewing');
      if (restore === ended) {
        restore = null;
        if (audio === mine) audio = null;
        if (soundId === id) soundId = null;
      }
      syncButtons();
    };
    const previewUrl = chooseSoundPreviewUrl(sound);
    try {
      stop();
      mine = new AudioCtor();
      audio = mine;
      mine.preload = 'auto';
      mine.src = new URL(String(previewUrl), document.baseURI).href;
      mine.volume = volume / 100;
      restore = ended;
      soundId = id;
      syncButtons();
      mine.addEventListener('ended', ended, { once: true });
      await mine.play();
    } catch (error) {
      if (audio !== mine) {
        ended();
        return;
      }
      const mediaCode = Number(mine?.error?.code || 0);
      const errorCode = mediaCode ? `MEDIA_${mediaCode}` : String(error?.name || 'AUDIO_ERROR');
      log.warn('[Raptoru Live] sound_preview_failed', {
        code: errorCode,
        source: String(previewUrl || ''),
        message: String(error?.message || mine?.error?.message || 'preview_failed').slice(0, 180),
      });
      stop();
      notice(`Aperçu indisponible (${errorCode}). Rien n’a été envoyé.`);
    }
  }

  return {
    play,
    stop,
    syncButtons,
    /** The sound being heard (its id), or null. */
    get soundId() {
      return soundId;
    },
    get volume() {
      return volume;
    },
    /** Kept locally (never sent); applied at once to the preview being heard. */
    setVolume(value) {
      volume = clampPreviewVolume(value);
      try {
        storage?.setItem(PREVIEW_VOLUME_KEY, String(volume));
      } catch {
        /* stockage facultatif */
      }
      if (audio) audio.volume = volume / 100;
    },
  };
}
