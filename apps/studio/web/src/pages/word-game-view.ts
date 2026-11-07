import type { WordGameState } from '@raptoru/schemas';
import { STEP } from '../commands-model.js';
import { esc, fmt, grp, ic, pp, stateChip } from '../ds/ds.js';

// Jeu des mots : la vue, pure, séparée du DOM pour être testée seule (docs/WORD_GAME_PARITY.md § 14). Tout vient de l'état du
// Core, rien n'est décidé ici. Le jeu n'a pas d'overlay : son écran, c'est le chat, et le plateau montre les mots tels que le
// chat les lit. Les mots en clair restent cachés (Studio peut être à l'écran pendant le live) : un mot à la fois, à la demande.

export type WordGamePanel =
  | (WordGameState & {
      player_url?: string;
      /** Volume du son de bonne réponse, 0 à 100 % (réglage de Studio). */
      sound_volume?: number;
      /** Le Core qui fait tourner le jeu : portefeuille de test ou Jetons réels. */
      environment?: 'lab' | 'production';
      /** Heure locale de lecture : l'âge des mots continue entre deux relevés. */
      fetched_at?: number;
    })
  | { enabled: false };
type Word = WordGameState['active'][number];

export interface ChatStep {
  step_id: string;
  origin?: string;
  params: { mode?: string; text?: string };
  status: string;
  created_at: string;
}

/** 75 → « 1:15 », 3 725 → « 1:02:05 ». */
export function ageLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
/** L'âge d'un mot maintenant, entre deux relevés. */
export const wordAge = (w: Word, now: number, fetchedAt = now) =>
  ageLabel(w.age_seconds + (now - fetchedAt) / 1000);

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Les réponses montrées encore actives : un mot qui quitte le plateau oublie sa réponse. */
export function keepRevealed(
  revealed: ReadonlySet<string>,
  s: WordGamePanel | null,
): Set<string> {
  const active = new Set(
    s && 'live' in s ? s.active.map((w) => w.occurrence_id) : [],
  );
  return new Set([...revealed].filter((id) => active.has(id)));
}

/** Un mot tel que le chat le lit : ses lettres mélangées, et sa réponse si le streamer a choisi de la voir. */
export function wordTile(w: Word, shown: boolean) {
  const chat = w.golden ? `🔸 ${w.shuffled} 🔸` : `-> ${w.shuffled} <-`;
  return `<article class="wg-w d-in ${w.golden ? 'gold' : ''}" aria-label="${esc(chat)}">
    <div class="wg-tiles" aria-hidden="true">${[...w.shuffled].map((c, i) => `<span style="--i:${i}">${esc(c)}</span>`).join('')}</div>
    <footer><time data-age="${esc(w.occurrence_id)}" title="Âge du mot"></time>${w.golden ? '<span class="d-tag gold">doré</span>' : ''}${w.source === 'manual' ? '<span class="d-tag off">manuel</span>' : ''}${shown ? `<span class="wg-answer" title="Réponse">${esc(w.word)}</span>` : ''}<span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-reveal="${esc(w.occurrence_id)}" aria-pressed="${shown}">${shown ? 'Masquer' : 'Voir la réponse'}</button></footer>
  </article>`;
}

const winLine = (
  r: Extract<WordGamePanel, { live: boolean }>['recent'][number],
) =>
  `<li class="wg-win d-in">${pp(r.viewer_display_name, 26)}<div><b>${esc(r.viewer_display_name)}</b><time>${esc(time(r.created_at))}</time><span class="wg-found">${r.words.map((w) => `<i class="${w.golden ? 'gold' : ''}" title="${esc(`${w.points} Jetons${w.fast ? ', rapide' : ''}${w.golden ? ', doré' : ''}`)}">${w.fast ? ic('bolt') : ''}${esc(w.word)}</i>`).join(', ')}</span>${r.combo ? `<small>combo +${fmt(r.combo)}</small>` : ''}${r.breaker ? `<small>casse la série +${fmt(r.breaker)}</small>` : ''}</div><strong class="d-num ${r.words.some((w) => w.golden) ? 'gold' : ''}">+${fmt(r.total)} Jetons</strong></li>`;

export const chatLine = (x: ChatStep) => {
  const [label, tone] = STEP[x.status] ?? [x.status, 'off' as const];
  return `<li class="wg-l ${x.params.mode === 'announce' ? 'ann' : ''} d-in"><div><b>LeCroupier_</b> ${esc(x.params.text ?? '')}</div>${x.status === 'succeeded' ? '' : `<small class="d-tag ${tone}">${esc(label)}</small>`}</li>`;
};

const RULE_MAX = 60;
export const ruleX = (min: number) =>
  ((Math.min(RULE_MAX, Math.max(1, min)) - 1) / (RULE_MAX - 1)) * 100;
export const ruleMin = (x: number) =>
  Math.round(1 + (Math.min(100, Math.max(0, x)) / 100) * (RULE_MAX - 1));

/** La règle graduée : on tire les deux bornes, le prochain mot tombe au hasard entre les deux. */
export function ruleHtml(min: number, max: number) {
  const ticks = [1, 5, 10, 15, 20, 30, 45, 60]
    .map((t) => `<span class="wg-tick" style="left:${ruleX(t)}%">${t}</span>`)
    .join('');
  const hand = (k: 'min' | 'max', v: number) =>
    `<button type="button" class="wg-h" data-h="${k}" style="left:${ruleX(v)}%" aria-label="Intervalle ${k === 'min' ? 'minimal' : 'maximal'} : ${v} minutes"><b>${v}</b></button>`;
  return `<i class="wg-band" style="left:${ruleX(min)}%;width:${ruleX(max) - ruleX(min)}%"></i>${ticks}${hand('min', min)}${hand('max', max)}<i class="wg-next" data-nextmark hidden></i>`;
}

type Live = Extract<WordGamePanel, { live: boolean }>;

/** Les zones de la page. `now` fait vivre le compte à rebours ; `busy` : une action en cours. */
export function wgZones(
  s: WordGamePanel | null,
  now: number,
  busy = false,
  error: string | null = null,
  revealed: ReadonlySet<string> = new Set(),
) {
  if (!s || !('live' in s))
    return {
      state: stateChip(s ? 'r' : 'w', s ? 'Indisponible' : 'Chargement…'),
      env: '',
      transport: '',
      next: '',
      error: error ? `<p class="d-note bad">${esc(error)}</p>` : '',
      board: [] as { key: string; html: string }[],
      boardEmpty: s
        ? '<div class="d-empty">Indisponible : serveur injoignable, ou profil Production non connecté.</div>'
        : '<div class="d-skel" style="height:180px"></div>',
      count: '',
      interval: '',
      streak: '',
      wins: '',
      panel: '',
    };
  const live = s as Live;
  const off = !live.live || busy;
  // Un Core sans interrupteur durable : traité comme allumé, le comportement historique.
  const enabled = live.enabled !== false;
  const state = !enabled
    ? stateChip('off', live.live ? 'Fermé · En live' : 'Fermé')
    : live.live
      ? live.stopped
        ? stateChip('w', 'En live · Arrêté pour ce live')
        : stateChip('live', 'En live · Ouvert')
      : stateChip('off', 'Hors live · Jeu à l’arrêt');
  const seenIn =
    live.next_word_at && enabled && live.live
      ? (Date.parse(live.next_word_at) - now) / 1000
      : null;
  return {
    state,
    env: `<span class="d-tag ${live.environment === 'production' ? 'warn' : 'off'}">${live.environment === 'production' ? 'Vrais Jetons' : 'Jetons de test'}</span>`,
    transport: `<button type="button" class="d-btn" data-action="${live.stopped ? 'start' : 'stop'}" ${off ? 'disabled' : ''}>${live.stopped ? 'Reprendre' : 'Arrêter'}</button>
      <button type="button" class="d-btn pri" data-action="new_word" ${off ? 'disabled' : ''}>Nouveau mot</button>`,
    next:
      seenIn !== null
        ? `Prochain mot dans ~${esc(ageLabel(seenIn))}`
        : live.live
          ? ''
          : 'Actions disponibles pendant un live.',
    error: error ? `<p class="d-note bad">${esc(error)}</p>` : '',
    board: live.active.map((w) => ({
      key: w.occurrence_id,
      html: wordTile(w, revealed.has(w.occurrence_id)),
    })),
    boardEmpty: `<div class="d-empty">${live.live ? 'Aucun mot en cours.' : 'Aucun mot : le jeu ne tourne que pendant un live.'}</div>`,
    count: `Mots actifs <span class="wg-count">${live.active.length}</span>`,
    interval: live.interval ? 'on' : '',
    streak: live.streak.holder_id
      ? `${pp(live.streak.holder_name ?? '', 26)}<p><strong>${esc(live.streak.holder_name)}</strong> · ${live.streak.count} mot${live.streak.count > 1 ? 's' : ''} d’affilée</p>`
      : '<p class="d-faint">Aucune série en cours.</p>',
    wins: live.recent.length
      ? `<ul>${live.recent.map(winLine).join('')}</ul>`
      : '<p class="d-faint">Aucune trouvaille pour l’instant.</p>',
    panel: panelHtml(live, enabled, busy),
  };
}

function panelHtml(s: Live, enabled: boolean, busy: boolean) {
  const game = s.interval
    ? grp(
        'Le jeu',
        'puzzle',
        `<div class="d-row col" data-k="activer désactiver interrupteur durable jeu"><span>${enabled ? 'Ouvert : un mot apparaît tout seul pendant chaque live.' : 'Fermé : aucun mot automatique, même après un redémarrage ou un nouveau live. Les mots déjà affichés restent trouvables jusqu’à la fin du live.'}</span><button type="button" class="d-btn ${enabled ? '' : 'pri'} sm" data-action="${enabled ? 'disable' : 'enable'}" ${busy ? 'disabled' : ''}>${enabled ? 'Fermer le jeu' : 'Ouvrir le jeu'}</button></div>
         <p class="d-note" data-k="arrêter live">« Arrêter » ne vaut que pour le live en cours.</p>`,
        'jeu',
      )
    : '';
  const sound =
    typeof s.sound_volume === 'number'
      ? `<div class="d-row col" data-k="volume son bonne réponse"><span>Volume du son de bonne réponse</span><span class="wg-vol"><input type="range" min="0" max="100" step="5" value="${s.sound_volume}" data-volume class="d-range" aria-label="Volume du son de bonne réponse"><output>${s.sound_volume} %</output></span></div>`
      : '';
  const obs = s.player_url
    ? `<div class="d-row col" data-k="source obs navigateur adresse url"><label class="d-fld"><input type="text" readonly value="${esc(s.player_url)}" aria-label="Adresse de la source OBS"></label><button type="button" class="d-btn sm" data-action="copy">${ic('copy')}Copier l’adresse</button><small>Source navigateur OBS : elle ne joue que le son, le jeu n’a pas d’image.</small></div>`
    : '';
  return `${game}${sound || obs ? grp('Son', 'sound', `${sound}${obs}`, 'obs') : ''}`;
}
