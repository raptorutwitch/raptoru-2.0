// Halloween — « Chaos » card (docs/HALLOWEEN.md § 4 bis): the screen effects that capture the game window and redraw
// it over itself (écran retourné, flou). The streamer chooses the game window, the duration and the intensity, and
// tests for free on his own screen (no Core, no Bonbon). What the card shows is the engine's real state: the windows
// Electron can capture right now and the window the last effect really captured.

export interface ChaosStatus {
  settings: { capture_window: string | null };
  windows?: string[];
  last_capture?: { at: string; name: string } | null;
}

export interface ChaosChoice {
  flipMode: 'rotate' | 'mirror' | 'vertical';
  flipSeconds: number;
  blurIntensity: 'low' | 'medium' | 'high';
  blurSeconds: number;
}

export const CHAOS_DEFAULT: ChaosChoice = {
  flipMode: 'rotate',
  flipSeconds: 10,
  blurIntensity: 'medium',
  blurSeconds: 6,
};

const FLIP_MODES: [ChaosChoice['flipMode'], string][] = [
  ['rotate', 'Retourné (tête en bas)'],
  ['mirror', 'Miroir (gauche ↔ droite)'],
  ['vertical', 'Inversé (haut ↔ bas)'],
];
const BLUR_LEVELS: [ChaosChoice['blurIntensity'], string][] = [
  ['low', 'Faible'],
  ['medium', 'Moyen'],
  ['high', 'Fort'],
];

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const opt = (v: string, label: string, on: boolean) =>
  `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;

/** The params a test (or a catalogue item) sends to the overlay (pure, tested). */
export function chaosParams(effect: 'flip' | 'blur', c: ChaosChoice) {
  return effect === 'flip'
    ? { mode: c.flipMode, durationMs: Math.round(c.flipSeconds * 1000) }
    : {
        intensity: c.blurIntensity,
        durationMs: Math.round(c.blurSeconds * 1000),
      };
}

export function chaosCard(s: ChaosStatus | null, c: ChaosChoice) {
  if (!s) return '<p class="hw-hint">Chargement…</p>';
  const wanted = s.settings.capture_window;
  const windows = s.windows ?? [];
  const missing = wanted && !windows.includes(wanted);
  const options = [
    opt('', 'Automatique (la fenêtre au premier plan)', !wanted),
    ...(missing ? [opt(wanted, `${wanted} (fermée)`, true)] : []),
    ...windows.map((w) => opt(w, w, w === wanted)),
  ].join('');
  const last = s.last_capture
    ? `Dernière capture : <b>${esc(s.last_capture.name)}</b> à ${new Date(s.last_capture.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    : 'Aucune capture depuis le démarrage de Studio.';
  return `<p class="hw-hint">L’image de la fenêtre du jeu est capturée puis redessinée par-dessus, retournée ou floue :
    tu continues à jouer (souris et clavier vont au jeu) et OBS montre la même chose aux viewers. Rien n’est modifié dans
    Windows ; STOP ALL (<kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>F12</kbd>) rend l’écran aussitôt. Jeu en <b>fenêtré sans
    bordure</b> sur l’écran de l’overlay.</p>
    <div class="hw-form">
      <label>Fenêtre du jeu <select data-set="capture_window">${options}</select></label>
    </div>
    <div class="hw-form">
      <label>Écran retourné <select data-chaos="flipMode">${FLIP_MODES.map(([v, l]) => opt(v, l, v === c.flipMode)).join('')}</select></label>
      <label>Durée (s) <input type="number" min="3" max="60" step="1" value="${c.flipSeconds}" data-chaos="flipSeconds"/></label>
      <button type="button" class="hw-small" data-chaos-test="flip">Tester</button>
    </div>
    <div class="hw-form">
      <label>Flou <select data-chaos="blurIntensity">${BLUR_LEVELS.map(([v, l]) => opt(v, l, v === c.blurIntensity)).join('')}</select></label>
      <label>Durée (s) <input type="number" min="2" max="30" step="1" value="${c.blurSeconds}" data-chaos="blurSeconds"/></label>
      <button type="button" class="hw-small" data-chaos-test="blur">Tester</button>
    </div>
    <p class="hw-hint">${last}</p>`;
}

/** Reads one changed field into the choice (bounded like the overlay's own limits). */
export function readChaos(
  c: ChaosChoice,
  field: string,
  value: string,
): ChaosChoice {
  const n = (v: string, lo: number, hi: number, d: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  if (field === 'flipMode' && FLIP_MODES.some(([v]) => v === value))
    return { ...c, flipMode: value as ChaosChoice['flipMode'] };
  if (field === 'blurIntensity' && BLUR_LEVELS.some(([v]) => v === value))
    return { ...c, blurIntensity: value as ChaosChoice['blurIntensity'] };
  if (field === 'flipSeconds')
    return { ...c, flipSeconds: n(value, 3, 60, c.flipSeconds) };
  if (field === 'blurSeconds')
    return { ...c, blurSeconds: n(value, 2, 30, c.blurSeconds) };
  return c;
}
