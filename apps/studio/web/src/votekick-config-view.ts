// Votekick — Studio settings section (pure part, tested): the vote length (Core's, applied to the NEXT votes; an
// older Core shows the fixed 60 s, read only) and the launch sound (Studio's, played once by the effects player when a
// vote really opens). Every name is escaped. Later settings (cooldowns, sanction lengths) get their own rows here.

export interface VotekickLaunchSound {
  enabled: boolean;
  sound: string | null;
  sound_name: string | null;
  volume: number;
}

export interface VotekickSettings {
  available: boolean;
  vote_seconds: number;
  error?: string;
  limits: { min: number; max: number; default: number };
  launch_sound: VotekickLaunchSound | null;
  sounds: { id: string; label: string; available: boolean }[];
  player: { connected: boolean; audio: boolean; current: boolean } | null;
}

export interface VotekickUi {
  error: string | null;
  notice: string | null;
  busy: boolean;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const chip = (cls: string, text: string) =>
  `<span class="cp-chip cp-chip--${cls}">${esc(text)}</span>`;

export const VOTEKICK_ERRORS: Record<string, string> = {
  invalid_settings: 'Réglage refusé : vérifie la durée et le volume.',
  invalid_body: 'Réglage refusé par le Core : vérifie la durée.',
  core_outdated:
    'Le Core ne connaît pas encore ce réglage (mise à jour du Core à venir) : durée fixe de 60 s.',
  core_unavailable: 'Core indisponible : rien n’a été enregistré.',
  launch_sound_unavailable: 'Son de lancement indisponible dans ce Studio.',
  effects_unavailable: 'Lecteur d’effets absent : import impossible.',
  uploads_unavailable: 'Import de sons indisponible dans ce Studio.',
  empty_file: 'Fichier vide.',
  sound_too_large: 'Fichier trop lourd (5 Mo maximum).',
  unsupported_audio: 'Format non reconnu (MP3, WAV ou OGG).',
};

export const votekickError = (code: string) => VOTEKICK_ERRORS[code] ?? code;

/** The sound list: none, the effect sounds present, and the saved imported sound (or one just imported). */
function soundOptions(s: VotekickSettings, sel: VotekickLaunchSound) {
  const opts = [`<option value="">— aucun son —</option>`];
  if (sel.sound?.startsWith('upload:'))
    opts.push(
      `<option value="${esc(sel.sound)}" selected>Importé : ${esc(sel.sound_name ?? 'son')}</option>`,
    );
  for (const x of s.sounds)
    if (x.available || x.id === sel.sound)
      opts.push(
        `<option value="${esc(x.id)}"${x.id === sel.sound ? ' selected' : ''}>${esc(x.label)}${x.available ? '' : ' (fichier absent)'}</option>`,
      );
  return opts.join('');
}

/** The section; `draft` is the launch sound being edited (an imported sound not yet saved). */
export function votekickConfigView(
  s: VotekickSettings | null,
  ui: VotekickUi,
  draft: VotekickLaunchSound | null = null,
) {
  if (!s)
    return ui.error
      ? `<p class="cp-error">${esc(ui.error)}</p>`
      : '<p class="cp-muted">Chargement…</p>';
  const sel = draft ??
    s.launch_sound ?? {
      enabled: false,
      sound: null,
      sound_name: null,
      volume: 80,
    };
  const p = s.player;
  const player = !p
    ? chip('warn', 'Lecteur d’effets absent : aucun son ne sera joué')
    : !p.connected
      ? chip(
          'warn',
          'Lecteur d’effets non connecté dans OBS : le son ne sera pas joué',
        )
      : !p.audio
        ? chip(
            'warn',
            'Lecteur d’effets muet : clique dans la source OBS « Effets »',
          )
        : chip('ok', 'Lecteur d’effets prêt');
  const dis = ui.busy ? ' disabled' : '';
  return `<form class="vk-config" data-role="vk-form">
    <fieldset class="cp-action"${dis}>
      <label class="cp-inline">Durée du vote
        <input type="number" name="vote_seconds" min="${s.limits.min}" max="${s.limits.max}" step="1" required
          value="${s.vote_seconds}"${s.available ? '' : ' disabled'}> s</label>
      <small class="cp-muted">${s.limits.min} à ${s.limits.max} s (par défaut ${s.limits.default} s). S’applique aux prochains
        votes ; un vote déjà ouvert garde sa durée.</small>
      ${s.available ? '' : `<p class="cp-error">${esc(votekickError(s.error ?? 'core_outdated'))}</p>`}
    </fieldset>
    <fieldset class="cp-action"${dis}>
      <label class="cp-inline"><input type="checkbox" name="enabled"${sel.enabled ? ' checked' : ''}>
        Son au lancement d’un vote</label>
      <label class="cp-inline">Son <select name="sound">${soundOptions(s, sel)}</select></label>
      <label class="cp-inline">ou importer <input type="file" name="file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"></label>
      <label class="cp-inline">Volume <input type="range" name="volume" min="0" max="100" step="1" value="${sel.volume}">
        <output name="volume_out">${sel.volume}</output> %</label>
      <button type="button" data-act="vk-preview"${sel.sound ? '' : ' disabled'}>Pré-écouter (ici seulement)</button>
      <div>${player}</div>
      <small class="cp-muted">Joué une seule fois quand un vote s’ouvre vraiment (jamais pour un !votekick refusé, jamais
        rejoué après une reconnexion ou un redémarrage de Studio). Si le son ne peut pas être joué, le vote continue.</small>
    </fieldset>
    <div class="cp-buttons"><button type="submit"${dis}>Enregistrer</button>
      ${ui.notice ? `<span class="cp-chip cp-chip--ok">${esc(ui.notice)}</span>` : ''}</div>
    ${ui.error ? `<p class="cp-error">${esc(ui.error)}</p>` : ''}
  </form>`;
}
