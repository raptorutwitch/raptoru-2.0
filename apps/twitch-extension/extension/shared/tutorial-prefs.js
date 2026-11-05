// « Ne plus afficher » of a tutorial (global or a module's), kept on this device (moved from ui.js).

const TUTORIAL_DISABLED_PREFIX = 'raptoru-live:tutorial-disabled:';
/** Tutoriel du module Bonk (bonk-tour.js) : même préférence « Ne plus afficher » que le tutoriel global. */
export const BONK_TUTORIAL = { id: 'bonk', version: 1 };

function tutorialPreferenceKey(tutorial) {
  return `${TUTORIAL_DISABLED_PREFIX}${tutorial?.id ?? 'core'}:v${tutorial?.version ?? 1}`;
}

export function readTutorialDisabled(tutorial) {
  try { return localStorage.getItem(tutorialPreferenceKey(tutorial)) === '1'; } catch { return false; }
}

export function writeTutorialDisabled(tutorial, disabled) {
  try {
    const key = tutorialPreferenceKey(tutorial);
    if (disabled) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch { /* stockage facultatif */ }
}
