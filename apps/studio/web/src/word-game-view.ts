import type { WordGameState } from '@raptoru/schemas';

// Jeu des mots V1 — Studio panel, pure view (docs/WORD_GAME_PARITY.md § 14). Everything shown comes from
// Core's state (relayed by Studio); nothing is decided here. Kept apart from the DOM to be tested alone.
// The clear words are hidden by default (Studio can be on screen during the live): only what the chat saw.
// The streamer can reveal one word at a time (« Voir la réponse »): a local, per-word choice of the tab.

export type WordGamePanel =
  | (WordGameState & {
      player_url?: string;
      /** Volume of the winning sound, 0–100 % (Studio setting). */
      sound_volume?: number;
      /** Which Core runs the game (lot 9): Lab Core (test wallet) or the main Core. */
      environment?: 'lab' | 'production';
      /** Local time (ms) when this state was read: the ages go on between two polls. */
      fetched_at?: number;
    })
  | { enabled: false };

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** 75 → « 1:15 », 3 725 → « 1:02:05 ». */
export function ageLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** The revealed words still active (a word that left the list forgets its reveal). */
export function keepRevealed(
  revealed: ReadonlySet<string>,
  s: WordGamePanel | null,
): Set<string> {
  const active = new Set(
    s && 'live' in s ? s.active.map((w) => w.occurrence_id) : [],
  );
  return new Set([...revealed].filter((id) => active.has(id)));
}

/**
 * The panel's HTML. `now` (ms) ages the words between two polls; `busy` disables the buttons while an
 * action is in flight; `error` is the last refused call, if any; `revealed` holds the occurrence ids
 * whose answer the streamer chose to see.
 */
export function wordGameView(
  s: WordGamePanel | null,
  now: number,
  busy = false,
  error: string | null = null,
  revealed: ReadonlySet<string> = new Set(),
): string {
  if (!s)
    return `<section class="wg"><p class="wg-muted">Chargement…</p></section>`;
  if (!('live' in s))
    return `<section class="wg"><h1>Jeu des mots</h1><p class="wg-muted">Indisponible : aucun Core connecté (Core Lab non démarré, ou profil Production non connecté).</p></section>`;
  const off = !s.live || busy;
  // Refonte H8: the durable switch (an older Core without it: treated as ON, the historical behaviour).
  const enabled = s.enabled !== false;
  const status = !enabled
    ? `<span class="wg-chip wg-chip--off">Désactivé (réglage)</span>${s.live ? '<span class="wg-chip wg-chip--live">En live</span>' : ''}`
    : s.live
      ? `<span class="wg-chip wg-chip--live">En live</span><span class="wg-chip ${s.stopped ? 'wg-chip--stop' : 'wg-chip--on'}">${s.stopped ? 'Arrêté pour ce live' : 'Actif'}</span>`
      : `<span class="wg-chip wg-chip--off">Hors live</span><span class="wg-chip wg-chip--off">Jeu à l’arrêt</span>`;
  const settings = s.interval
    ? `<div class="wg-settings">
      <button type="button" class="wg-btn ${enabled ? '' : 'wg-btn--primary'}" data-action="${enabled ? 'disable' : 'enable'}" ${busy ? 'disabled' : ''}>${enabled ? 'Désactiver le jeu' : 'Activer le jeu'}</button>
      <span class="wg-muted">${enabled ? 'Activé : un mot apparaît automatiquement pendant chaque live.' : 'Désactivé : aucun mot automatique, même après un redémarrage ou un nouveau live. Les mots déjà affichés restent trouvables jusqu’à la fin du live.'}</span>
      <label class="wg-field">Un mot toutes les <input type="number" min="1" max="60" step="1" value="${Math.round(s.interval.min_s / 60)}" data-interval="min" aria-label="Intervalle minimal en minutes"></label>
      <label class="wg-field">à <input type="number" min="1" max="60" step="1" value="${Math.round(s.interval.max_s / 60)}" data-interval="max" aria-label="Intervalle maximal en minutes"> min</label>
      <button type="button" class="wg-btn" data-action="interval" ${busy ? 'disabled' : ''}>Enregistrer l’intervalle</button>
      <span class="wg-muted">Au hasard entre les deux (par défaut 5 à 15 min), de 1 à 60 min. « Arrêter » ne vaut que pour le live en cours.</span>
    </div>`
    : '';
  const next =
    s.live && s.next_word_at
      ? `<p class="wg-muted">Prochain mot dans ~${esc(ageLabel((Date.parse(s.next_word_at) - now) / 1000))}</p>`
      : '';
  const drift = (now - (s.fetched_at ?? now)) / 1000;
  const words = s.active.length
    ? `<ul class="wg-list">${s.active
        .map((w) => {
          const shown = revealed.has(w.occurrence_id);
          return `<li class="wg-word${w.golden ? ' wg-word--gold' : ''}"><span class="wg-shuffled">${w.golden ? '🔸 ' : ''}${esc(w.shuffled)}${w.golden ? ' 🔸' : ''}</span>${shown ? `<span class="wg-answer" title="Réponse">${esc(w.word)}</span>` : ''}<span class="wg-age" title="Âge du mot">${esc(ageLabel(w.age_seconds + drift))}</span>${w.golden ? '<span class="wg-tag">doré</span>' : ''}${w.source === 'manual' ? '<span class="wg-tag">manuel</span>' : ''}<button type="button" class="wg-btn wg-btn--ghost" data-reveal="${esc(w.occurrence_id)}" aria-pressed="${shown}">${shown ? 'Masquer' : 'Voir la réponse'}</button></li>`;
        })
        .join('')}</ul>`
    : `<p class="wg-muted">${s.live ? 'Aucun mot en cours.' : 'Aucun mot : le jeu ne tourne que pendant un live.'}</p>`;
  const streak = s.streak.holder_id
    ? `<p><strong>${esc(s.streak.holder_name)}</strong> · ${s.streak.count} mot${s.streak.count > 1 ? 's' : ''} d’affilée</p>`
    : `<p class="wg-muted">Aucune série en cours.</p>`;
  const recent = s.recent.length
    ? `<ul class="wg-list">${s.recent
        .map(
          (r) =>
            `<li class="wg-win"><time>${esc(time(r.created_at))}</time><strong>${esc(r.viewer_display_name)}</strong><span>${esc(r.words.map((w) => w.word).join(', '))}</span><span class="wg-gain">+${r.total} jetons</span></li>`,
        )
        .join('')}</ul>`
    : `<p class="wg-muted">Aucune trouvaille pour l’instant.</p>`;
  const player = s.player_url
    ? `<p class="wg-muted wg-obs">Son OBS (source navigateur) : <code>${esc(s.player_url)}</code> <button type="button" class="wg-btn wg-btn--ghost" data-action="copy">Copier</button></p>`
    : '';
  const volume =
    typeof s.sound_volume === 'number'
      ? `<label class="wg-volume">Volume du son de bonne réponse <input type="range" min="0" max="100" step="5" value="${s.sound_volume}" data-volume aria-label="Volume du son de bonne réponse"><output>${s.sound_volume} %</output></label>`
      : '';
  return `<section class="wg">
    <header class="rs-page-head rs-head-row"><div><h1>Jeu des mots</h1><p>Des mots mélangés à retrouver dans le chat pendant le live.</p></div><div class="wg-status">${status}${s.environment === 'production' ? '<span class="wg-chip wg-chip--on">Core principal</span>' : '<span class="wg-chip wg-chip--off">Core Lab · portefeuille de test</span>'}</div></header>
    <div class="wg-actions">
      <button type="button" class="wg-btn" data-action="${s.stopped ? 'start' : 'stop'}" ${off ? 'disabled' : ''}>${s.stopped ? 'Reprendre' : 'Arrêter'}</button>
      <button type="button" class="wg-btn wg-btn--primary" data-action="new_word" ${off ? 'disabled' : ''}>Nouveau mot</button>
      ${s.live ? '' : '<span class="wg-muted">Actions disponibles pendant un live.</span>'}
    </div>
    ${error ? `<p class="wg-error">${esc(error)}</p>` : ''}
    ${enabled ? next : ''}
    <div class="wg-cols">
      <div class="rs-panel">
        <h2>Mots actifs <span class="wg-count">${s.active.length}</span></h2>
        ${words}
        <h2>Série</h2>
        ${streak}
        <h2>Dernières trouvailles</h2>
        ${recent}
      </div>
      <div class="rs-panel">
        <h2>${settings ? 'Réglages' : 'Son'}</h2>
        ${settings}
        ${volume}
        ${player}
      </div>
    </div>
  </section>`;
}
