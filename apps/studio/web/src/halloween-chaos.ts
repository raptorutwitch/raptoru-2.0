// Halloween — « Chaos » card (docs/HALLOWEEN.md § 4 bis): écran retourné / miroir / inversé and flou on the WHOLE
// monitor chosen for the overlay (whatever application is in front), duration and intensity, free tests on the
// streamer's own screen (no Core, no Bonbon), and the OBS part that shows the same effect to the viewers. What the card
// shows is the engine's real state: the Chaos window answering, OBS connected, the filters present on the chosen
// screen capture, and the last effect really played.

export interface ChaosStatus {
  settings: { display_id: number | null; obs_chaos_source?: string | null };
  displays?: {
    id: number;
    label: string;
    bounds: { width: number; height: number };
    primary: boolean;
  }[];
  chaos?: {
    connected: boolean;
    obs_source: string | null;
    obs_connected: boolean;
    last: { at: string; screen: string; obs: string } | null;
  };
}

export interface ChaosObs {
  sources: string[];
  source: string | null;
  filters: Record<string, { present: boolean; enabled: boolean }> | null;
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
  ['rotate', 'Retourné (rotation 180°)'],
  ['mirror', 'Miroir horizontal (gauche ↔ droite)'],
  ['vertical', 'Retournement vertical (haut ↔ bas)'],
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

/** The OBS part in words (pure, tested). */
export function obsLine(s: ChaosStatus, obs: ChaosObs | null) {
  if (!s.chaos?.obs_connected)
    return 'OBS non connecté à Studio : l’effet est sur ton écran seulement (les viewers voient l’écran normal).';
  if (!s.settings.obs_chaos_source)
    return 'Choisis la capture d’écran OBS : sans elle, les viewers voient l’écran normal.';
  if (!obs?.filters) return 'Lecture des filtres OBS…';
  const missing = Object.values(obs.filters).filter((f) => !f.present).length;
  return missing
    ? `${missing} filtre(s) OBS à préparer (bouton ci-dessous, hors live : OBS les crée puis Studio les coupe aussitôt).`
    : 'Filtres OBS prêts : les viewers voient le même effet.';
}

export function chaosCard(
  s: ChaosStatus | null,
  c: ChaosChoice,
  obs: ChaosObs | null,
) {
  if (!s) return '<p class="hw-hint">Chargement…</p>';
  const display =
    s.displays?.find((d) => d.id === s.settings.display_id) ??
    s.displays?.find((d) => d.primary);
  const screen = display
    ? `${display.label} (${display.bounds.width}×${display.bounds.height})`
    : 'écran principal';
  const state = s.chaos?.connected
    ? `<div class="hw-state ok"><span class="hw-dot"></span>Prêt sur tout l’écran « ${esc(screen)} »</div>`
    : '<div class="hw-state bad"><span class="hw-dot"></span>Fenêtre Chaos absente (overlay désactivé, ou Studio lancé hors application)</div>';
  const sources = obs?.sources ?? [];
  const chosen = s.settings.obs_chaos_source ?? '';
  const sourceOptions = [
    opt('', '— aucune (effet sur ton écran seulement) —', !chosen),
    ...(chosen && !sources.includes(chosen)
      ? [opt(chosen, `${chosen} (introuvable dans OBS)`, true)]
      : []),
    ...sources.map((x) => opt(x, x, x === chosen)),
  ].join('');
  const last = s.chaos?.last
    ? `Dernier effet : ${esc(s.chaos.last.screen)} à ${new Date(s.chaos.last.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · OBS ${esc(s.chaos.last.obs)}`
    : 'Aucun effet depuis le démarrage de Studio.';
  return `${state}
    <p class="hw-hint">Tout l’écran choisi pour l’overlay (« Écran » ci-contre) est capturé puis redessiné retourné ou flou, quelle que soit l’application devant, même si tu changes de fenêtre. Tu continues à jouer normalement (souris et clavier passent). Rien n’est modifié dans Windows ; STOP ALL (<kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>F12</kbd>) rend l’écran aussitôt.</p>
    <div class="hw-form">
      <label>Écran retourné <select data-chaos="flipMode">${FLIP_MODES.map(([v, l]) => opt(v, l, v === c.flipMode)).join('')}</select></label>
      <label>Durée (s) <input type="number" min="3" max="60" step="1" value="${c.flipSeconds}" data-chaos="flipSeconds"/></label>
      <button type="button" class="hw-small" data-chaos-test="flip"${s.chaos?.connected ? '' : ' disabled'}>Tester</button>
    </div>
    <div class="hw-form">
      <label>Flou <select data-chaos="blurIntensity">${BLUR_LEVELS.map(([v, l]) => opt(v, l, v === c.blurIntensity)).join('')}</select></label>
      <label>Durée (s) <input type="number" min="2" max="30" step="1" value="${c.blurSeconds}" data-chaos="blurSeconds"/></label>
      <button type="button" class="hw-small" data-chaos-test="blur"${s.chaos?.connected ? '' : ' disabled'}>Tester</button>
    </div>
    <h4>Pour les viewers (OBS)</h4>
    <div class="hw-form">
      <label>Capture d’écran OBS <select data-set="obs_chaos_source"${s.chaos?.obs_connected ? '' : ' disabled'}>${sourceOptions}</select></label>
      <button type="button" class="hw-small" data-act="chaos-obs-prepare"${s.chaos?.obs_connected && chosen ? '' : ' disabled'}>Préparer les filtres OBS</button>
    </div>
    <p class="hw-hint">${esc(obsLine(s, obs))}</p>
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
