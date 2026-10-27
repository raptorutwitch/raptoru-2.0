// Random Ban V2 — Studio section (pure part, tested): who times out and whether it can, the fixed rules, the last
// Random Bans with what really happened, the tests (never a real timeout). Every Twitch name is escaped.

export interface RbView {
  request_id: string;
  source: 'channel_points' | 'chat' | 'test';
  mode: 'real' | 'dry_run' | 'animation';
  buyer: { id: string; name: string };
  status:
    | 'queued'
    | 'searching'
    | 'timeout_requested'
    | 'confirmed'
    | 'flop'
    | 'failed'
    | 'uncertain'
    | 'simulated';
  target: { id: string; name: string | null; is_sub: boolean | null } | null;
  duration_s: number | null;
  error: string | null;
  refund: 'none' | 'needed' | 'to_verify';
  stats: {
    chatters?: number;
    candidates?: number;
    follow_checks?: number;
  } | null;
  animation: string | null;
  animation_status: string;
  created_at: string;
  /** V3: the streamer drawn — his mic muted (no Twitch timeout). */
  streamer_mute?: boolean;
  /** « Test Caution Random Ban »: a test mute Caution may end (real Jetons). */
  caution_test?: boolean;
  /** V3 trace: why the streamer was or was not the target. */
  streamer_decision?: StreamerDecision | null;
}

export interface StreamerDecision {
  decision: string;
  draw?: number;
  studio_age_ms?: number | null;
  obs_failed?: string;
}

/** The streamer decisions, read by the streamer. */
export const STREAMER_DECISION: Record<string, string> = {
  drawn: 'tiré',
  not_drawn: 'éligible, pas tiré',
  no_streamer: 'inconnu de ce Core',
  dry_run: 'tirage à blanc (jamais le streamer)',
  studio_silent: 'Studio non vu par le Core',
  obs_not_ready: 'OBS non connecté',
  mic_held: 'micro déjà tenu par un autre effet',
  votekick_mute: 'mute Votekick en cours',
  streamer_muted: 'mute Random Ban déjà en cours',
};

export function streamerDecisionText(d: StreamerDecision | null | undefined) {
  if (!d) return '';
  const label = STREAMER_DECISION[d.decision] ?? d.decision;
  const draw = d.draw !== undefined ? ` (tirage ${d.draw}/1000)` : '';
  const age =
    d.decision === 'studio_silent'
      ? d.studio_age_ms === null || d.studio_age_ms === undefined
        ? ' (jamais vu)'
        : ` (vu il y a ${Math.round(d.studio_age_ms / 1000)} s)`
      : '';
  const obs = d.obs_failed ? ` · mute impossible : ${d.obs_failed}` : '';
  return `Streamer : ${label}${draw}${age}${obs}`;
}

export interface RbState {
  rules: {
    duration_sub_s: number;
    duration_non_sub_s: number;
    buyer_weight?: number;
    streamer_per_mille?: number;
    streamer_mute_s?: number;
  };
  /** V3 trace over the last real Random Bans. */
  streamer_trace?: {
    requests: number;
    traced: number;
    by_decision: Record<string, number>;
    eligible: number;
    drawn: number;
    obs_failed: number;
    eligible_since_last_drawn: number;
    luck_pct: number;
  } | null;
  /** V3: what Studio said about the mic (Core's view), and its own. */
  studio?: { obs_ready: boolean; mic_held: boolean } | null;
  mic?: { input: string; obs_connected: boolean; held_by: string[] } | null;
  mute_error?: string | null;
  executor: {
    login: string;
    can_search: boolean;
    can_timeout: boolean;
    missing: string[];
  } | null;
  recent: RbView[];
  animations_error?: string | null;
  effects: {
    connected: boolean;
    audio: boolean;
    current: boolean;
    media: { id: string; label: string; available: boolean }[];
  } | null;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const chip = (cls: string, text: string, title = '') =>
  `<span class="cp-chip cp-chip--${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;

const STATUS: Record<RbView['status'], string> = {
  queued: 'En attente',
  searching: 'Recherche d’une cible',
  timeout_requested: 'Timeout demandé',
  confirmed: 'Timeout confirmé',
  flop: 'Flop',
  failed: 'Échec',
  uncertain: 'Résultat incertain',
  simulated: 'Simulation',
};

const ANIMATION: Record<string, string> = {
  ban_classic: 'classique',
  ban_rm: 'Rick & Morty',
  ban_rm_mirror: 'Rick & Morty (miroir)',
  ban_nuage_complet: 'nuage complet',
  ban_nuage_complet_mirror: 'nuage complet (miroir)',
  ban_waterbending: 'waterbending',
  ban_waterbending_mirror: 'waterbending (miroir)',
  ban_nuage2: 'nuage 2',
  ban_nuage2_mirror: 'nuage 2 (miroir)',
  ban_csc: 'CSC',
  flop: 'flop',
};

const ANIMATION_STATUS: Record<string, string> = {
  pending: 'à afficher',
  playing: 'en cours',
  completed: 'affichée',
  failed: 'non affichée',
  unknown: 'affichage non confirmé',
  skipped: 'non affichée (trop tard)',
};

/** Readable reasons (Core / executor codes; Twitch messages kept as they are). */
export function rbError(e: string | null) {
  if (!e) return '';
  if (e.startsWith('missing_scope_timeout'))
    return `LeCroupier_ n’a pas le droit de timeout (${e.split(': ')[1] ?? ''})`;
  if (e.startsWith('missing_scope_search'))
    return `droits Twitch insuffisants pour chercher une cible (${e.split(': ')[1] ?? ''})`;
  return (
    {
      executor_absent:
        'exécuteur Twitch absent (adaptateur Twitch du Lab arrêté ?) : rien n’a été fait',
      executor_lost: 'exécuteur Twitch perdu avant tout timeout',
      no_answer_after_timeout_request:
        'pas de réponse après la demande de timeout : vérifier sur Twitch',
      verified_after_ambiguous_answer:
        'confirmé dans la liste des bannis après une réponse ambiguë',
    }[e] ?? e
  );
}

/** The tab section. */
export function randomBanView(s: RbState | null, error: string | null) {
  if (error) return `<p class="cp-error">${esc(error)}</p>`;
  if (!s) return '<p class="cp-muted">Chargement…</p>';
  const e = s.executor;
  const executor = !e
    ? chip(
        'warn',
        'Exécuteur Twitch : absent',
        'L’adaptateur Twitch du Lab (Ingestion chat Twitch) doit tourner',
      )
    : `${chip(e.can_search ? 'ok' : 'warn', `Recherche : ${e.can_search ? 'prête' : 'impossible'}`)} ${chip(
        e.can_timeout ? 'ok' : 'warn',
        `Timeouts par ${e.login} : ${e.can_timeout ? 'autorisés' : 'droit manquant'}`,
      )}${e.missing.length ? `<br><small class="cp-muted">Droits Twitch manquants : ${esc(e.missing.join(', '))}</small>` : ''}`;
  const missing = (s.effects?.media ?? []).filter((m) => !m.available);
  const player = !s.effects
    ? chip('warn', 'Lecteur d’effets indisponible')
    : !s.effects.connected
      ? chip('warn', 'Lecteur d’effets : non ouvert')
      : !s.effects.current
        ? chip('warn', 'Lecteur d’effets : à recharger')
        : chip('ok', 'Animations : lecteur d’effets prêt');
  const rows = s.recent
    .map((r) => {
      const who =
        r.status === 'flop'
          ? 'aucun follower éligible'
          : r.streamer_mute && r.target
            ? `micro de ${esc(r.target.name)} coupé ${r.duration_s ?? ''} s (${r.caution_test ? 'test Caution : libérable par !caution, jetons réels' : r.mode === 'real' && r.source === 'test' ? 'test du micro' : 'streamer tiré'})`
            : r.target
              ? `${esc(r.target.name)}${r.target.id === r.buyer.id ? ' (CSC)' : ''}${r.duration_s ? ` · ${r.duration_s / 60} min${r.target.is_sub ? ' (abonné)' : ''}` : ''}`
              : '—';
      const refund =
        r.refund === 'needed'
          ? '<br><b>Remboursement nécessaire</b> (non effectué : récompense créée par SAMMI)'
          : r.refund === 'to_verify'
            ? '<br><b>Vérifier sur Twitch</b> avant tout remboursement'
            : '';
      const anim = r.animation
        ? `${ANIMATION[r.animation] ?? r.animation} — ${ANIMATION_STATUS[r.animation_status] ?? r.animation_status}`
        : '';
      const stats = [
        r.stats && r.stats.chatters !== undefined
          ? `${r.stats.chatters ?? 0} chatters, ${r.stats.candidates ?? 0} candidats, ${r.stats.follow_checks ?? 0} follows vérifiés`
          : '',
        streamerDecisionText(r.streamer_decision),
      ]
        .filter(Boolean)
        .join(' · ');
      return `<tr class="cp-row--${r.status === 'confirmed' || r.status === 'flop' || r.status === 'simulated' ? 'done' : r.status === 'failed' ? 'failed' : 'pending'}">
        <td>${esc(new Date(r.created_at).toLocaleTimeString('fr-FR'))}</td>
        <td>${r.mode === 'real' ? '' : '<i>Test</i> '}${esc(r.buyer.name)}</td>
        <td><b>${STATUS[r.status]}</b>${r.mode === 'dry_run' ? ' <small>(à blanc)</small>' : ''}<br><small>${who}</small></td>
        <td><small>${esc(rbError(r.error))}${refund}${anim ? `<br>Animation : ${esc(anim)}` : ''}${stats ? `<br>${esc(stats)}` : ''}</small></td></tr>`;
    })
    .join('');
  const held = s.mic?.held_by ?? [];
  const mic = !s.mic
    ? ''
    : !s.mic.obs_connected
      ? chip('warn', 'Mute du streamer : OBS non connecté (jamais tiré)')
      : held.length
        ? chip(
            'warn',
            `« ${s.mic.input} » tenu par : ${held.map((h) => h.split(':')[0]).join(', ')}`,
            'Le streamer n’est pas tiré tant qu’un autre effet coupe son micro',
          )
        : chip('ok', `Mute du streamer : prêt (« ${s.mic.input} »)`);
  const t = s.streamer_trace;
  const trace =
    t && t.traced
      ? `<p class="cp-muted"><b>Suivi du streamer</b> (${t.traced} Random Ban réels suivis) : éligible ${t.eligible} fois, tiré ${t.drawn} fois${
          t.obs_failed ? `, mute impossible ${t.obs_failed} fois` : ''
        }. Depuis le dernier tirage gagnant : ${t.eligible_since_last_drawn} tirage(s) éligible(s) perdu(s) — ${
          t.luck_pct >= 5
            ? `${t.luck_pct} % de chances par simple malchance (normal)`
            : `seulement ${t.luck_pct} % de chances par simple malchance (à signaler)`
        }.${
          Object.entries(t.by_decision).filter(
            ([k]) => k !== 'drawn' && k !== 'not_drawn',
          ).length
            ? ` Inéligible : ${Object.entries(t.by_decision)
                .filter(([k]) => k !== 'drawn' && k !== 'not_drawn')
                .map(([k, n]) => `${STREAMER_DECISION[k] ?? k} × ${n}`)
                .join(', ')}.`
            : ''
        }</p>`
      : '';
  const v3 =
    s.rules.buyer_weight !== undefined
      ? ` L’acheteur est tiré ${Math.round(1 / s.rules.buyer_weight)} fois moins souvent qu’un autre (jamais impossible ; seul éligible, il est tiré). ${
          s.rules.streamer_per_mille
            ? `Le streamer est tiré ${s.rules.streamer_per_mille / 10} % des fois : son micro est coupé ${s.rules.streamer_mute_s} s dans OBS (jamais de timeout), seulement si OBS est connecté et qu’aucun autre effet ne coupe déjà son micro ; libérable par !caution (300 jetons par tranche de 10 s restantes).`
            : 'Streamer jamais tiré ici (inconnu de ce Core).'
        }`
      : '';
  return `<div class="cp-status">${executor} ${player} ${mic}${s.animations_error ? ` ${chip('warn', 'Animations : Core injoignable', s.animations_error)}` : ''}${s.mute_error ? ` ${chip('warn', 'Mute du streamer : erreur', s.mute_error)}` : ''}</div>
    ${missing.length ? `<p class="cp-error">Médias non importés : ${esc(missing.map((m) => m.label).join(', '))}</p>` : ''}
    <p class="cp-muted">Règles fixes : une cible au hasard parmi les chatters présents (lurkers compris) qui suivent la
      chaîne ; ni le streamer, ni les modérateurs, ni les déjà bannis ; VIP et acheteur possibles (CSC). Timeout par
      LeCroupier_ : ${s.rules.duration_sub_s / 60} min pour un abonné, ${s.rules.duration_non_sub_s / 60} min sinon. Aucun éligible : flop, rien
      n’est remboursé. Activation : règle « Ban aléatoire » ci-dessus (Interaction native « Random Ban »).${esc(v3)}</p>
    ${trace}
    <div class="cp-buttons">
      <label class="cp-inline">Animation <select data-f="rb-outcome"><option value="ban">ban (au hasard)</option><option value="csc">CSC</option><option value="flop">flop</option></select></label>
      <button type="button" data-act="rb-animation" title="Joue l’animation dans OBS, aucun appel Twitch">Tester l’animation</button>
      <button type="button" data-act="rb-dry-run" title="Vraie recherche sur Twitch (lecture seule), jamais de timeout">Tirage à blanc</button>
      <button type="button" data-act="rb-caution-test" title="Vraie sanction de 60 s sur ton compte, libérable par !caution raptoru_ : les jetons du payeur sont réellement débités">Test Caution Random Ban</button>
      <button type="button" data-act="rb-streamer-mute" title="Coupe vraiment ton micro dans OBS 60 s, rien d’autre (ni Twitch, ni jetons, ni chat, ni animation)">Tester le mute du streamer</button>
    </div>
    ${rows ? `<table class="cp-history"><thead><tr><th>Heure</th><th>Acheteur</th><th>Résultat</th><th>Détail</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="cp-muted">Aucun Random Ban.</p>'}`;
}
