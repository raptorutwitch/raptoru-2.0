// The streamer's audio choice for the Soundboard player, kept across a page reload (Ctrl+R in Studio reloads the
// embedded player and used to forget « Activer le son »). 'on': enabled by a click, restored at load when the browser
// allows audio without a new gesture (Electron does by default). 'off': cut on purpose (« Couper le son »), never
// re-enabled by a reload. No choice yet: the player waits for the first click, as before.

export const AUDIO_CHOICE_KEY = 'raptoru.soundboard.audio';

/** 'on' | 'off' | null — a storage that throws (private mode, blocked site data) reads as no choice. */
export function readChoice(storage) {
  try {
    const v = storage?.getItem(AUDIO_CHOICE_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function writeChoice(storage, value) {
  try {
    storage?.setItem(AUDIO_CHOICE_KEY, value);
  } catch {
    /* not persisted: the next reload simply asks again */
  }
}

/**
 * State to take at load: 'enabled' (audio restored without a click), 'needs_click' (was on, the browser refuses
 * audio without a gesture), 'off' (cut on purpose), 'waiting' (never enabled). `unlock()` resolves to true when
 * the page may play audio now; it is only tried for a remembered 'on'.
 */
export async function restoreAudio(choice, unlock) {
  if (choice === 'off') return 'off';
  if (choice !== 'on') return 'waiting';
  try {
    return (await unlock()) ? 'enabled' : 'needs_click';
  } catch {
    return 'needs_click';
  }
}
