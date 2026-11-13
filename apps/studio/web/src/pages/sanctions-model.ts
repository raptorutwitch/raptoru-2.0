// Interactions à sanction : la partie pure (testée). Random Ban, Caution, Votekick lisent ce que le Core a décidé et disent ce qui
// s'est vraiment passé : qui, combien, et le sort des Jetons. Jamais de remboursement annoncé s'il n'a pas eu lieu, jamais de vert
// sur une intention, un test toujours marqué comme tel. Chaque nom vient de Twitch : il est échappé.
import { dur, esc, fmt, hhmm } from '../ds/ds.js';

/** Un verrou : ce qui permet, ou empêche, d'appliquer une sanction. */
export const lock = (tone: '' | 'w' | 'r' | 'off', text: string, note = '') =>
  `<div class="sx-lock"><i class="d-dot ${tone}"></i><span>${esc(text)}${note ? `<small>${esc(note)}</small>` : ''}</span></div>`;

const clockS = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR');

// --- Random Ban ----------------------------------------------------------------------------------------------------------

export interface RbView {
  request_id: string;
  source: 'channel_points' | 'chat' | 'test' | 'extension';
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
    | 'simulated'
    | 'canceled';
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
  /** Mini-jeux: the Jetons price paid and its tier; the Sniper prediction and its decision. */
  price_paid?: number | null;
  series_level?: number | null;
  wish?: {
    id: string | null;
    name: string | null;
    text?: string | null;
  } | null;
  sniper?: string;
  /** Points de chaîne (Twitch) : le rachat, remboursable par Raptoru si la récompense est la sienne. */
  redemption_id?: string | null;
  sniper_bonus?: number;
  /** Le streamer tiré : son micro coupé, jamais de timeout Twitch. */
  streamer_mute?: boolean;
  /** Une sanction de test que Caution peut lever, avec de vrais Jetons. */
  caution_test?: boolean;
  /** Pourquoi le streamer a été, ou non, la cible. */
  streamer_decision?: StreamerDecision | null;
}

export interface StreamerDecision {
  decision: string;
  draw?: number;
  studio_age_ms?: number | null;
  obs_failed?: string;
}

export interface RbState {
  rules: {
    duration_sub_s: number;
    duration_non_sub_s: number;
    buyer_weight?: number;
    streamer_per_mille?: number;
    streamer_mute_s?: number;
  };
  /** Le suivi sur les derniers Random Ban réels. */
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
  /** Ce que Studio a dit du micro (vu par le Core), et le sien. */
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

export const STREAMER_DECISION: Record<string, string> = {
  drawn: 'tiré',
  not_drawn: 'éligible, pas tiré',
  no_streamer: 'streamer inconnu sur ce profil',
  dry_run: 'tirage à blanc (jamais le streamer)',
  studio_silent: 'Studio silencieux',
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

const RB_STATUS: Record<RbView['status'], [string, string]> = {
  queued: ['En attente', ''],
  searching: ['Recherche d’une cible', ''],
  timeout_requested: ['Timeout demandé', 'warn'],
  confirmed: ['Timeout confirmé', 'bad'],
  flop: ['Flop', 'off'],
  failed: ['Échec', 'warn'],
  uncertain: ['Résultat incertain', 'warn'],
  simulated: ['Simulation', 'off'],
  canceled: ['Annulé (modération)', 'off'],
};
const RB_SOURCE: Record<RbView['source'], string> = {
  channel_points: 'Points de chaîne',
  chat: 'Chat (!rb)',
  test: 'Test Studio',
  extension: 'Extension (Mini-jeux)',
};

const SNIPER: Record<string, string> = {
  armed: 'en attente du résultat',
  hit: 'réussi · prime versée',
  miss: 'raté',
  glory: 'raté · pour la gloire',
  glory_hit: 'réussi · pour la gloire (sans prime)',
  void: 'sans effet',
  unresolved: 'pronostic à vérifier (aucun compte sûr)',
  revoked: 'réussi · prime retirée',
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

/** Les raisons lisibles (codes du Core et de l'exécuteur ; les messages de Twitch restent tels quels). */
export function rbError(e: string | null) {
  if (!e) return '';
  if (e.startsWith('missing_scope_timeout'))
    return `LeCroupier_ n’a pas le droit de timeout (${e.split(': ')[1] ?? ''})`;
  if (e.startsWith('missing_scope_search'))
    return `droits Twitch insuffisants pour chercher une cible (${e.split(': ')[1] ?? ''})`;
  return (
    {
      executor_absent: 'bot Twitch absent : rien n’a été fait',
      executor_lost: 'bot Twitch perdu avant tout timeout',
      no_answer_after_timeout_request:
        'pas de réponse après la demande de timeout : vérifier sur Twitch',
      verified_after_ambiguous_answer:
        'confirmé dans la liste des bannis après une réponse ambiguë',
    }[e] ?? e
  );
}

const rbWho = (r: RbView) =>
  r.status === 'flop'
    ? 'aucun follower éligible'
    : r.streamer_mute && r.target
      ? `micro de ${esc(r.target.name)} coupé ${r.duration_s ?? ''} s (${r.caution_test ? 'test Caution : libérable par !caution, jetons réels' : r.mode === 'real' && r.source === 'test' ? 'test du micro' : 'streamer tiré'})`
      : r.target
        ? `${esc(r.target.name)}${r.target.id === r.buyer.id ? ' (CSC)' : ''}${r.duration_s ? ` · ${r.duration_s / 60} min${r.target.is_sub ? ' (abonné)' : ''}` : ''}`
        : 'aucune cible';
const rbRefund = (r: RbView) =>
  r.refund === 'needed'
    ? '<b>Remboursement nécessaire</b> (non effectué : récompense créée par SAMMI)'
    : r.refund === 'to_verify'
      ? '<b>Vérifier sur Twitch</b> avant tout remboursement'
      : '';
const rbAnimation = (r: RbView) =>
  r.animation
    ? `${ANIMATION[r.animation] ?? r.animation} · ${ANIMATION_STATUS[r.animation_status] ?? r.animation_status}`
    : '';
const rbStats = (r: RbView) =>
  r.stats && r.stats.chatters !== undefined
    ? `${r.stats.chatters ?? 0} chatters, ${r.stats.candidates ?? 0} candidats, ${r.stats.follow_checks ?? 0} follows vérifiés`
    : '';

/** Une demande dans le suivi. Ce qui appelle une action (remboursement dû, à vérifier) se lit sans ouvrir la ligne. */
export function rbRow(r: RbView) {
  // A status or a source this Studio does not know yet (a newer Core) is shown as it is, never a broken page.
  const [label, tone] = RB_STATUS[r.status] ?? [r.status, ''];
  const test = r.mode !== 'real' || r.source === 'test';
  return `<button type="button" class="sx-l d-in" data-rq="${esc(r.request_id)}">
    <time>${esc(clockS(r.created_at))}</time>
    <span class="sx-who">${test ? '<i class="sx-test">Test</i> ' : ''}${esc(r.buyer.name)}</span>
    <span class="sx-what">${rbWho(r)}${r.refund !== 'none' ? `<small class="sx-due">${rbRefund(r)}</small>` : ''}</span>
    <span class="sx-end"><span class="d-tag ${tone}">${label}</span>${r.mode === 'dry_run' ? ' <small>(à blanc)</small>' : ''}</span>
  </button>`;
}

/** Le détail complet d'une demande. */
export function rbDetail(r: RbView) {
  const kv = (k: string, v: string) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : '');
  return `<dl class="d-kv">
    ${kv('Acheteur', esc(r.buyer.name))}
    ${kv('Origine', RB_SOURCE[r.source] ?? esc(r.source))}
    ${kv('Prix payé', Number.isInteger(r.price_paid) ? `${r.price_paid!.toLocaleString('fr-FR')} Jetons${r.series_level ? ` (palier ${r.series_level + 1})` : ''}` : '')}
    ${kv('Sniper', r.wish ? `vise ${esc(r.wish.name ?? `« ${r.wish.text ?? r.wish.id ?? '?'} »`)} · ${esc(SNIPER[r.sniper ?? ''] ?? r.sniper ?? '')}${r.sniper_bonus ? ` (+${r.sniper_bonus.toLocaleString('fr-FR')})` : ''}` : '')}
    ${kv('Mode', r.mode === 'real' ? 'Réel' : r.mode === 'dry_run' ? 'À blanc' : 'Animation seule')}
    ${kv('Résultat', rbWho(r))}
    ${kv('Remboursement', rbRefund(r))}
    ${kv('Raison', esc(rbError(r.error)))}
    ${kv('Animation', esc(rbAnimation(r)))}
    ${kv('Recherche', esc(rbStats(r)))}
    ${kv('Streamer', esc(streamerDecisionText(r.streamer_decision).replace('Streamer : ', '')))}
  </dl>
  <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv"><dt>Référence</dt><dd>${esc(r.request_id)}</dd><dt>Statut</dt><dd>${esc(r.status)}</dd><dt>Demandé</dt><dd>${esc(r.created_at)}</dd></dl></details>`;
}

/** Ce qui permet de sanctionner : l'exécuteur Twitch, le lecteur d'effets, le micro du streamer. */
export function rbLocks(s: RbState) {
  const e = s.executor;
  const missing = (s.effects?.media ?? []).filter((m) => !m.available);
  const held = s.mic?.held_by ?? [];
  return [
    !e
      ? lock(
          'r',
          'Bot Twitch : absent',
          'Le bot ne répond pas : aucun timeout possible.',
        )
      : `${lock(e.can_search ? '' : 'w', `Recherche : ${e.can_search ? 'prête' : 'impossible'}`)}${lock(e.can_timeout ? '' : 'r', `Timeouts par ${e.login} : ${e.can_timeout ? 'autorisés' : 'droit manquant'}`, e.missing.length ? `Droits Twitch manquants : ${e.missing.join(', ')}` : '')}`,
    !s.effects
      ? lock('w', 'Lecteur d’effets indisponible')
      : !s.effects.connected
        ? lock(
            'w',
            'Lecteur d’effets : non ouvert',
            'Une sanction reste appliquée, sans animation.',
          )
        : !s.effects.current
          ? lock('w', 'Lecteur d’effets : à recharger')
          : lock('', 'Animations : lecteur d’effets prêt'),
    missing.length
      ? lock(
          'w',
          `${missing.length} média${missing.length > 1 ? 's' : ''} non importé${missing.length > 1 ? 's' : ''}`,
          missing.map((m) => m.label.replace('Random Ban — ', '')).join(', '),
        )
      : '',
    !s.mic
      ? ''
      : !s.mic.obs_connected
        ? lock(
            'w',
            'Mute du streamer : OBS non connecté',
            'Le streamer n’est jamais tiré tant qu’OBS est absent.',
          )
        : held.length
          ? lock(
              'w',
              `« ${s.mic.input} » tenu par : ${held.map((h) => h.split(':')[0]).join(', ')}`,
              'Le streamer n’est pas tiré tant qu’un autre effet coupe son micro.',
            )
          : lock('', `Mute du streamer : prêt (« ${s.mic.input} »)`),
    s.animations_error
      ? lock('w', 'Animations : serveur injoignable', s.animations_error)
      : '',
    s.mute_error ? lock('w', 'Mute du streamer : erreur', s.mute_error) : '',
  ].join('');
}

/** Le barème du tirage, lu dans les règles du Core. `per10s` : le tarif de sourdine réglé dans Caution. */
export function rbDraw(s: RbState, per10s = 300) {
  const r = s.rules;
  const min = (x: number) => x / 60;
  const lane = (who: string, how: string, out: string) =>
    `<div class="sx-lane"><div><b>${esc(who)}</b><small>${esc(how)}</small></div><span>${esc(out)}</span></div>`;
  const pm = r.streamer_per_mille ?? 0;
  return `${
    pm
      ? `<div class="sx-odds" role="img" aria-label="Le streamer est tiré ${pm / 10} % des fois"><i style="width:${pm / 10}%"></i></div><div class="sx-oddsl"><span>Viewers</span><span>Streamer ${pm / 10} %</span></div>`
      : ''
  }
  ${lane(
    'Un viewer présent',
    'Lurkers et VIP compris, s’il suit la chaîne. Ni le streamer, ni les modérateurs, ni les déjà bannis.',
    `${min(r.duration_sub_s)} min pour un abonné, ${min(r.duration_non_sub_s)} min sinon`,
  )}
  ${
    r.buyer_weight !== undefined
      ? lane(
          'L’acheteur',
          `Tiré ${Math.round(1 / r.buyer_weight)} fois moins souvent qu’un autre, jamais impossible ; seul éligible, il est tiré.`,
          'Même sanction : CSC',
        )
      : ''
  }
  ${
    r.buyer_weight === undefined
      ? ''
      : pm
        ? lane(
            'Le streamer',
            `Tiré ${pm / 10} % des fois, seulement si OBS est connecté et qu’aucun autre effet ne coupe déjà son micro. Jamais de timeout.`,
            `Micro coupé ${r.streamer_mute_s} s dans OBS, libérable par !caution (${per10s} jetons par tranche de 10 s restantes)`,
          )
        : lane('Le streamer', 'Inconnu sur ce profil.', 'Jamais tiré ici')
  }
  ${lane('Personne d’éligible', 'Aucun follower présent ne convient.', 'Flop : rien n’est remboursé')}`;
}

/** Le suivi du streamer sur les Random Ban réels. */
export function rbTrace(s: RbState) {
  const t = s.streamer_trace;
  if (!t?.traced) return '';
  const other = Object.entries(t.by_decision).filter(
    ([k]) => k !== 'drawn' && k !== 'not_drawn',
  );
  return `${t.traced} Random Ban réels suivis : éligible ${t.eligible} fois, tiré ${t.drawn} fois${t.obs_failed ? `, mute impossible ${t.obs_failed} fois` : ''}. Depuis le dernier tirage gagnant : ${t.eligible_since_last_drawn} tirage(s) éligible(s) perdu(s), ${
    t.luck_pct >= 5
      ? `${t.luck_pct} % de chances par simple malchance (normal)`
      : `seulement ${t.luck_pct} % de chances par simple malchance (à signaler)`
  }.${other.length ? ` Inéligible : ${other.map(([k, n]) => `${STREAMER_DECISION[k] ?? k} × ${n}`).join(', ')}.` : ''}`;
}

// --- Caution -------------------------------------------------------------------------------------------------------------

export interface CautionView {
  request_id: string;
  status:
    | 'checking'
    | 'quoting'
    | 'quoted'
    | 'confirmed'
    | 'rechecking'
    | 'releasing'
    | 'released'
    | 'refused'
    | 'cancelled'
    | 'expired'
    | 'failed'
    | 'uncertain';
  mode: 'real' | 'dry_run';
  payer: { name: string };
  target_input: string;
  target: { name: string | null } | null;
  kind: 'timeout' | 'mute' | null;
  price: number | null;
  reason: string | null;
  error: string | null;
  money: 'none' | 'debited' | 'refunded' | 'to_verify';
  created_at: string;
}

export interface CautionState {
  executor: {
    login: string;
    can_read: boolean;
    can_release: boolean;
    missing: string[];
    /** Âge du dernier signal du bot (horloge du Core) : un bot muet n'est pas « prêt ». */
    seen_ms_ago?: number;
  } | null;
  ready: boolean;
  to_verify: number;
  recent: CautionView[];
}

const CT_STATUS: Record<CautionView['status'], [string, string]> = {
  checking: ['Lecture Twitch en attente', ''],
  quoting: ['Lecture Twitch', ''],
  quoted: ['Devis envoyé (30 s)', ''],
  confirmed: ['« oui » reçu', ''],
  rechecking: ['Revérification avant paiement', ''],
  releasing: ['Payé · levée en cours', 'warn'],
  released: ['Libéré', 'ok'],
  refused: ['Refusé', 'off'],
  cancelled: ['Annulé par le payeur', 'off'],
  expired: ['Devis expiré', 'off'],
  failed: ['Échec', 'bad'],
  uncertain: ['Levée incertaine', 'warn'],
};
export const cautionOpen = (c: CautionView) =>
  [
    'checking',
    'quoting',
    'quoted',
    'confirmed',
    'rechecking',
    'releasing',
  ].includes(c.status);

const CT_REASON: Record<string, string> = {
  unknown_target: 'pseudo introuvable',
  self: 'sa propre caution',
  no_timeout: 'aucun timeout actif',
  permanent: 'ban permanent (non rachetable)',
  ended: 'timeout déjà terminé',
  not_muted: 'streamer non muté',
  mute_over: 'mute terminé avant le paiement',
  insufficient: 'Jetons insuffisants',
  wallet_unavailable: 'portefeuille indisponible',
  no_longer: 'plus en timeout au moment de payer',
  now_permanent: 'devenu un ban permanent',
  extended: 'timeout prolongé : nouveau devis demandé',
  twitch_unreadable: 'Twitch illisible',
  executor_absent: 'bot Twitch absent',
  executor_lost: 'bot Twitch perdu (avant tout paiement)',
  missing_scope_read: 'droit Twitch manquant (lecture des bannis)',
  missing_scope_release: 'droit Twitch manquant (levée)',
  not_applied: 'levée refusée par Twitch',
  not_banned: 'timeout terminé avant la levée',
  dry_run: 'simulation (aucun appel Twitch)',
  quote_expired: 'pas de réponse en 30 s',
  cancelled: 'annulé',
};
const CT_MONEY: Record<CautionView['money'], string> = {
  none: 'aucun jeton débité',
  debited: 'débité',
  refunded: 'débité puis remboursé',
  to_verify: 'débité · À VÉRIFIER sur Twitch (aucun remboursement automatique)',
};

export function cautionLocks(s: CautionState) {
  const e = s.executor;
  // Des droits n'ont de sens que sur un bot vivant (`executorReady` du Core : un signal de moins de 15 s).
  const silent = e?.seen_ms_ago !== undefined && e.seen_ms_ago >= 15_000;
  return !e
    ? lock(
        'r',
        'Bot Twitch : absent',
        'Une caution est refusée, aucun jeton débité.',
      )
    : silent
      ? lock(
          'r',
          `Exécuteur Twitch : aucun signal depuis ${Math.round(e.seen_ms_ago! / 1000)} s`,
          'Caution refusée, aucun jeton débité.',
        )
      : `${lock(e.can_read ? '' : 'w', `Lecture des bannis : ${e.can_read ? 'prête' : 'impossible'}`)}${lock(e.can_release ? '' : 'r', `Levées par ${e.login} : ${e.can_release ? 'autorisées' : 'droit manquant'}`, e.missing.length ? `Droits Twitch manquants : ${e.missing.join(', ')}` : '')}`;
}

export const toVerifyText = (n: number) => `${n} caution(s) à vérifier`;

/** Une caution : le sort des Jetons se lit sur la ligne. */
export function cautionRow(r: CautionView) {
  const [label, tone] = CT_STATUS[r.status];
  const who = r.target?.name ?? r.target_input;
  const money =
    r.money === 'to_verify'
      ? `<b>${esc(CT_MONEY[r.money])}</b>`
      : esc(CT_MONEY[r.money]);
  return `<button type="button" class="sx-l d-in ${r.money === 'to_verify' ? 'is-due' : ''}" data-rq="${esc(r.request_id)}">
    <time>${esc(clockS(r.created_at))}</time>
    <span class="sx-who">${r.mode === 'dry_run' ? '<i class="sx-test">Test</i> ' : ''}${esc(r.payer.name)}</span>
    <span class="sx-what">${esc(who)}${r.kind === 'mute' ? ' (mute)' : ''}${r.price !== null ? ` · ${fmt(r.price)} jetons` : ''}<small class="${r.money === 'to_verify' ? 'sx-due' : ''}">${money}${r.reason ? ` · ${esc(CT_REASON[r.reason] ?? r.reason)}` : ''}</small></span>
    <span class="sx-end"><span class="d-tag ${tone}">${label}</span></span>
  </button>`;
}

export function cautionDetail(r: CautionView) {
  const kv = (k: string, v: string) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : '');
  return `<dl class="d-kv">
    ${kv('Payeur', esc(r.payer.name))}
    ${kv('Pour', esc(r.target?.name ?? r.target_input))}
    ${kv('Sanction', r.kind === 'mute' ? 'Sourdine du streamer' : r.kind === 'timeout' ? 'Timeout Twitch' : '')}
    ${kv('Prix', r.price !== null ? `${fmt(r.price)} jetons` : '')}
    ${kv('Jetons', esc(CT_MONEY[r.money]))}
    ${kv('Raison', esc(r.reason ? (CT_REASON[r.reason] ?? r.reason) : ''))}
    ${kv('Erreur', esc(r.error ?? ''))}
    ${kv('Mode', r.mode === 'dry_run' ? 'Test, aucun appel Twitch' : 'Réel')}
  </dl>
  <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv"><dt>Référence</dt><dd>${esc(r.request_id)}</dd><dt>Statut</dt><dd>${esc(r.status)}</dd><dt>Demandée</dt><dd>${esc(r.created_at)}</dd></dl></details>`;
}

// --- Votekick ------------------------------------------------------------------------------------------------------------

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
export interface VoteView {
  vote_id: string;
  mode: 'real' | 'dry_run';
  status:
    | 'checking'
    | 'reading'
    | 'open'
    | 'sanctioning'
    | 'done'
    | 'refused'
    | 'failed';
  initiator: string;
  target: string;
  kick: number | null;
  save: number | null;
  outcome: string | null;
  punished: string | null;
  minutes: number | null;
  sanction: 'none' | 'twitch_timeout' | 'obs_mute' | null;
  applied: string | null;
  reason: string | null;
  error: string | null;
  created_at: string;
}
export interface VotekickLive {
  core: {
    executor?: {
      login: string;
      ready: boolean;
      can_read: boolean;
      can_timeout: boolean;
      missing: string[];
    } | null;
    overlay?: VoteOverlay;
    mute?: VoteMute | null;
    recent?: VoteView[];
    error?: string;
  };
  overlay: VoteOverlay;
  obs_mute: { id: string; endsAt: number } | null;
  last_restore: { id: string; ok: boolean; mismatches: string[] } | null;
  error: string | null;
}
export interface VoteOverlay {
  action: string;
  target?: string;
  initiator?: string;
  yes?: number;
  no?: number;
  ends?: number;
  dur?: number;
  outcome?: string;
  punished?: string;
  minutes?: number;
  mute_seconds?: number;
}
export interface VoteMute {
  mute_id: string;
  status: 'pending' | 'active' | 'ended' | 'failed';
  seconds: number;
  ends_at: string | null;
  end_reason: 'expired' | 'caution' | null;
}

export const VOTEKICK_ERRORS: Record<string, string> = {
  invalid_settings: 'Réglage refusé : vérifie la durée et le volume.',
  invalid_body: 'Réglage refusé : vérifie la durée.',
  core_outdated:
    'Réglage pas encore disponible sur ce serveur : durée fixe de 60 s.',
  core_unavailable: 'Serveur indisponible : rien n’a été enregistré.',
  launch_sound_unavailable: 'Son de lancement indisponible dans ce Studio.',
  effects_unavailable: 'Lecteur d’effets absent : import impossible.',
  uploads_unavailable: 'Import de sons indisponible dans ce Studio.',
  empty_file: 'Fichier vide.',
  sound_too_large: 'Fichier trop lourd (5 Mo maximum).',
  unsupported_audio: 'Format non reconnu (MP3, WAV ou OGG).',
};
export const votekickError = (code: string) => VOTEKICK_ERRORS[code] ?? code;

/** La liste de sons : aucun, les sons d'effet présents, le son importé enregistré ou tout juste importé. */
function soundOptions(s: VotekickSettings, sel: VotekickLaunchSound) {
  const opts = ['<option value="">Aucun son</option>'];
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

/** Le formulaire ; `draft` : le son en cours d'édition (un son importé pas encore enregistré). */
export function votekickForm(
  s: VotekickSettings | null,
  ui: VotekickUi,
  draft: VotekickLaunchSound | null = null,
) {
  if (!s)
    return ui.error
      ? `<p class="d-note bad">${esc(ui.error)}</p>`
      : '<div class="d-skel" style="height:180px"></div>';
  const sel = draft ??
    s.launch_sound ?? {
      enabled: false,
      sound: null,
      sound_name: null,
      volume: 80,
    };
  const p = s.player;
  const player = !p
    ? lock('w', 'Lecteur d’effets absent : aucun son ne sera joué')
    : !p.connected
      ? lock(
          'w',
          'Lecteur d’effets non connecté dans OBS : le son ne sera pas joué',
        )
      : !p.audio
        ? lock(
            'w',
            'Lecteur d’effets muet : clique dans la source OBS « Effets »',
          )
        : lock('', 'Lecteur d’effets prêt');
  const dis = ui.busy ? ' disabled' : '';
  return `<form class="vk-form" data-role="vk-form">
    <fieldset${dis}>
      <legend class="d-lb">Durée du vote</legend>
      <div class="vk-len">
        <input class="d-range vk-rule" type="range" data-vs min="${s.limits.min}" max="${s.limits.max}" step="5" value="${s.vote_seconds}"${s.available ? '' : ' disabled'} aria-label="Durée du vote">
        <label class="d-fld"><input type="number" name="vote_seconds" min="${s.limits.min}" max="${s.limits.max}" step="1" required value="${s.vote_seconds}"${s.available ? '' : ' disabled'} aria-label="Durée du vote en secondes"><span>s</span></label>
      </div>
      <small>${s.limits.min} à ${s.limits.max} s, ${s.limits.default} s par défaut. S’applique aux prochains votes ; un vote déjà ouvert garde sa durée.</small>
      ${s.available ? '' : `<p class="d-note bad">${esc(votekickError(s.error ?? 'core_outdated'))}</p>`}
    </fieldset>
    <fieldset${dis}>
      <legend class="d-lb">Son de lancement</legend>
      <div class="d-row"><span>Son au lancement d’un vote</span><span class="d-sw"><input type="checkbox" role="switch" name="enabled"${sel.enabled ? ' checked' : ''} aria-label="Son au lancement d’un vote"><i></i></span></div>
      <div class="vk-sound">
        <label class="d-fld"><select name="sound" aria-label="Son">${soundOptions(s, sel)}</select></label>
        <button type="button" class="d-btn sm" data-act="vk-preview"${sel.sound ? '' : ' disabled'} title="Ici seulement, jamais dans le stream">Écouter ici</button>
        <label class="d-btn sm vk-file">Importer<input type="file" name="file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" aria-label="Importer un son"></label>
      </div>
      <div class="d-row"><span>Volume</span><span class="vk-vol"><input class="d-range" type="range" name="volume" min="0" max="100" step="1" value="${sel.volume}" aria-label="Volume"><output name="volume_out">${sel.volume}</output> %</span></div>
      ${player}
      <small>Joué une seule fois quand un vote s’ouvre vraiment : jamais pour un !votekick refusé, jamais rejoué après une reconnexion ou un redémarrage de Studio. Si le son ne peut pas être joué, le vote continue.</small>
    </fieldset>
    <div class="vk-save"><button type="submit" class="d-btn pri sm"${dis}>Enregistrer</button>
      ${ui.notice ? `<span class="d-tag ok">${esc(ui.notice)}</span>` : ''}</div>
    ${ui.error ? `<p class="d-note bad">${esc(ui.error)}</p>` : ''}
  </form>`;
}

const OUTCOME: Record<string, string> = {
  no_quorum: 'Pas assez de votes',
  no_timeout: 'Sauvé',
  target_timeout: 'Cible exclue',
  target_timeout_perfect: 'Perfect : cible exclue',
  coinflip_target: 'Pile ou face : cible exclue',
  coinflip_initiator: 'Pile ou face : lanceur exclu',
  backfire: 'Backfire : lanceur exclu',
  broadcaster_muted: 'Streamer en sourdine',
};
const VOTE_STATUS: Record<VoteView['status'], [string, string]> = {
  checking: ['Vérification', ''],
  reading: ['Lecture Twitch', ''],
  open: ['Vote ouvert', 'warn'],
  sanctioning: ['Sanction en cours', 'warn'],
  done: ['Terminé', 'off'],
  refused: ['Refusé', 'off'],
  failed: ['Échec', 'bad'],
};
const APPLIED: Record<string, string> = {
  confirmed: 'timeout confirmé',
  refused: 'timeout refusé par Twitch',
  uncertain: 'résultat incertain : vérifier sur Twitch',
  not_sent: 'timeout non envoyé',
  simulated: 'simulé, rien envoyé à Twitch',
  muted: 'micro coupé dans OBS',
  not_muted: 'micro non coupé',
};

const VOTE_REASON: Record<string, string> = {
  unknown_target: 'pseudo introuvable',
  self: 'contre lui-même',
  moderator: 'cible modérateur',
  already_muted: 'streamer déjà en sourdine',
  mods_unreadable: 'modérateurs illisibles sur Twitch',
  twitch_unreadable: 'Twitch illisible',
  executor_absent: 'bot Twitch absent',
  read_lost: 'lecture Twitch perdue',
};

export function voteRow(r: VoteView) {
  const [label, tone] = VOTE_STATUS[r.status];
  const sanction =
    r.minutes && r.punished
      ? ` · ${esc(r.punished)} ${r.sanction === 'obs_mute' ? 'en sourdine' : `exclu ${r.minutes} min`}`
      : '';
  return `<button type="button" class="sx-l d-in" data-rq="${esc(r.vote_id)}">
    <time>${esc(clockS(r.created_at))}</time>
    <span class="sx-who">${r.mode === 'dry_run' ? '<i class="sx-test">Test</i> ' : ''}${esc(r.initiator)}</span>
    <span class="sx-what">contre ${esc(r.target)}${r.kick !== null ? ` · ${r.kick} KICK, ${r.save ?? 0} SAVE` : ''}<small>${r.outcome ? esc(OUTCOME[r.outcome] ?? r.outcome) : r.reason ? esc(VOTE_REASON[r.reason] ?? r.reason) : ''}${sanction}${r.applied ? ` · ${esc(APPLIED[r.applied] ?? r.applied)}` : ''}</small></span>
    <span class="sx-end"><span class="d-tag ${tone}">${label}</span></span>
  </button>`;
}
export function voteDetail(r: VoteView) {
  const kv = (k: string, v: string) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : '');
  return `<dl class="d-kv">
    ${kv('Lancé par', esc(r.initiator))}
    ${kv('Cible', esc(r.target))}
    ${kv('Votes', r.kick !== null ? `${r.kick} KICK, ${r.save ?? 0} SAVE` : '')}
    ${kv('Verdict', esc(r.outcome ? (OUTCOME[r.outcome] ?? r.outcome) : ''))}
    ${kv('Sanctionné', esc(r.punished ?? ''))}
    ${kv('Durée', r.minutes ? `${r.minutes} min` : '')}
    ${kv('Application', esc(r.applied ? (APPLIED[r.applied] ?? r.applied) : ''))}
    ${kv('Raison', esc(r.reason ? (VOTE_REASON[r.reason] ?? r.reason) : ''))}
    ${kv('Erreur', esc(r.error ?? ''))}
    ${kv('Mode', r.mode === 'dry_run' ? 'Test, chat simulé' : 'Réel')}
  </dl>
  <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv"><dt>Référence</dt><dd>${esc(r.vote_id)}</dd><dt>Statut</dt><dd>${esc(r.status)}</dd><dt>Demandé</dt><dd>${esc(r.created_at)}</dd></dl></details>`;
}

/** Ce qui permet de sanctionner après un vote : l'exécuteur, puis la tâche de mute du streamer. */
export function voteLocks(v: VotekickLive | null, error?: string | null) {
  const e = v?.core.executor;
  const err = v?.core.error ?? v?.error;
  if (!v) return lock(error ? 'r' : 'w', error ?? 'Lecture…');
  const m = v.core.mute;
  const r = v.last_restore;
  return [
    err ? lock('r', 'Serveur injoignable', err) : '',
    !e
      ? lock(
          'r',
          'Bot Twitch : absent',
          'Un vote réel ne s’ouvre pas sans lui.',
        )
      : !e.ready
        ? lock('r', 'Bot Twitch : aucun signal récent')
        : `${lock(e.can_read ? '' : 'w', `Lecture des modérateurs : ${e.can_read ? 'prête' : 'impossible'}`)}${lock(e.can_timeout ? '' : 'r', `Timeouts par ${e.login} : ${e.can_timeout ? 'autorisés' : 'droit manquant'}`, e.missing.length ? `Droits Twitch manquants : ${e.missing.join(', ')}` : '')}`,
    !m
      ? lock('off', 'Tâche de mute : aucune')
      : m.status === 'active'
        ? lock(
            'r',
            'Tâche de mute : micro coupé',
            m.ends_at
              ? `Jusqu’à ${hhmm(m.ends_at)}, durée ${dur(m.seconds)}.`
              : dur(m.seconds),
          )
        : m.status === 'pending'
          ? lock('w', 'Tâche de mute : en attente de Studio', dur(m.seconds))
          : m.status === 'failed'
            ? lock('w', 'Tâche de mute : échec', 'Le micro n’a pas été coupé.')
            : lock(
                'off',
                `Tâche de mute : terminée (${m.end_reason === 'caution' ? 'libérée par une caution' : 'temps écoulé'})`,
              ),
    r
      ? r.ok
        ? lock('off', 'Dernier mute : OBS rétabli')
        : lock('w', 'Dernier mute : OBS non rétabli', r.mismatches.join(', '))
      : '',
  ].join('');
}

/** Le résultat à l'écran, dit en mots ; rien quand aucun vote n'est en cours. */
export const overlayOutcome = (o: VoteOverlay) =>
  o.outcome ? (OUTCOME[o.outcome] ?? o.outcome) : '';
