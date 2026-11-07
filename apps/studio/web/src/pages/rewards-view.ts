// Récompenses Twitch, les vues pures (testées) de la page reconstruite le 07/11 : la galerie de cartes, la fiche d'une récompense
// (Twitch → Raptoru → test → demandes) et le fil des demandes. Trois objets distincts, jamais mélangés :
//   1. la récompense créée sur Twitch (nom, coût, disponibilité : Studio la lit, ne la modifie pas) ;
//   2. les actions que Raptoru exécute (la règle du Core, seule chose réglée ici) ;
//   3. les demandes reçues et ce qui leur est arrivé (le journal du Core).
// Les textes viennent de Twitch : chacun est échappé.
import { esc, fmt, ic, pp, type IcName } from '../ds/ds.js';
import {
  actionIcon,
  actionLabel,
  effectItems,
  INTERACTIONS,
  isNotable,
  redemptionDetail,
  type CpActionView,
  type CpInteraction,
  type CpRedemption,
  type CpReward,
  type CpState,
} from './rewards-model.js';

/** La famille d'une action : sa teinte et son nom à l'écran. Les crédits TTS et Soundboard sont deux familles distinctes. */
export type Kind = 'fx' | 'obs' | 'sb' | 'tts' | 'music' | 'ban' | 'none';

export function kindOf(a: CpActionView | undefined): Kind {
  if (!a) return 'none';
  switch (a.type) {
    case 'effect_sound':
    case 'effect_video':
      return 'fx';
    case 'sound':
      return 'sb';
    case 'credits':
      return a.currency === 'credits_tts' ? 'tts' : 'sb';
    case 'obs_source':
    case 'obs_filter':
    case 'obs_scene':
      return 'obs';
    case 'interaction':
      return a.interaction === 'random_ban'
        ? 'ban'
        : a.interaction === 'song_request' || a.interaction === 'song_skip'
          ? 'music'
          : 'fx';
  }
}

/** Le titre d'une action dans la fiche : ce qu'elle est, sans ambiguïté (le détail vient dessous). */
export function actionTitle(a: CpActionView): string {
  switch (a.type) {
    case 'effect_sound':
      return 'Son d’effet';
    case 'effect_video':
      return 'Vidéo d’effet';
    case 'sound':
      return 'Son du Soundboard';
    case 'obs_source':
      return 'Source OBS';
    case 'obs_filter':
      return 'Filtre OBS';
    case 'obs_scene':
      return 'Scène OBS';
    case 'credits':
      return a.currency === 'credits_tts'
        ? 'Crédits TTS'
        : 'Crédits Soundboard';
    case 'interaction':
      return INTERACTIONS[a.interaction]?.label ?? 'Interaction';
  }
}

/** Ce qu'on peut ajouter, par famille. Chaque entrée crée une action du Core telle quelle (aucun type nouveau). */
export interface AddKind {
  id: string;
  group: string;
  label: string;
  hint: string;
  icon: IcName;
  make: () => CpActionView;
}
const inter = (interaction: CpInteraction): CpActionView => ({
  type: 'interaction',
  interaction,
});
export const ADD_KINDS: AddKind[] = [
  {
    id: 'credits_tts',
    group: 'Crédits pour le viewer',
    label: 'Crédits TTS',
    hint: 'Messages TTS sans Jetons',
    icon: 'mic',
    // Pas de nombre par défaut : le streamer le choisit, le Core refuse 0.
    make: () => ({ type: 'credits', currency: 'credits_tts', amount: 0 }),
  },
  {
    id: 'credits_sb',
    group: 'Crédits pour le viewer',
    label: 'Crédits Soundboard',
    hint: 'Sons du Soundboard sans Jetons',
    icon: 'wave',
    make: () => ({
      type: 'credits',
      currency: 'credits_soundboard',
      amount: 0,
    }),
  },
  {
    id: 'effect_sound',
    group: 'Sons et vidéos',
    label: 'Son d’effet',
    hint: 'Joué tout de suite par le lecteur d’effets',
    icon: 'vol',
    make: () => ({ type: 'effect_sound', sound_id: '', volume: 100 }),
  },
  {
    id: 'effect_video',
    group: 'Sons et vidéos',
    label: 'Vidéo d’effet',
    hint: 'Jouée tout de suite par le lecteur d’effets',
    icon: 'film',
    make: () => ({ type: 'effect_video', video_id: '', volume: 100 }),
  },
  {
    id: 'sound',
    group: 'Sons et vidéos',
    label: 'Son du Soundboard',
    hint: 'Passe par la file du Soundboard',
    icon: 'wave',
    make: () => ({ type: 'sound', sound_id: '' }),
  },
  ...(
    [
      ['creepy', 'Effet Prowler et scène Creepy, 4 s'],
      ['brb', 'Animation « We’ll be right back », micro coupé 6 s'],
      ['fx_cam', 'Le viewer écrit le nom d’un effet caméra'],
      ['color_cam', 'Le viewer écrit une couleur de cadre'],
      ['random_ban', 'Timeout d’un chatter tiré au hasard'],
      ['song_request', 'Le viewer écrit un titre ou un lien'],
      ['song_skip', 'Passe la musique en cours'],
    ] as [CpInteraction, string][]
  ).map(([id, hint]) => ({
    id,
    group: 'Interactions de Raptoru',
    label: INTERACTIONS[id].label,
    hint,
    icon: INTERACTIONS[id].icon,
    make: () => inter(id),
  })),
  {
    id: 'obs_source',
    group: 'OBS',
    label: 'Afficher ou masquer une source',
    hint: 'Avec une durée, revient seul',
    icon: 'eye',
    make: () => ({ type: 'obs_source', scene: '', source: '', visible: true }),
  },
  {
    id: 'obs_filter',
    group: 'OBS',
    label: 'Activer ou couper un filtre',
    hint: 'Avec une durée, revient seul',
    icon: 'filter',
    make: () => ({ type: 'obs_filter', source: '', filter: '', enabled: true }),
  },
  {
    id: 'obs_scene',
    group: 'OBS',
    label: 'Changer de scène',
    hint: 'Avec une durée, revient à la scène d’avant',
    icon: 'layers',
    make: () => ({ type: 'obs_scene', scene: '' }),
  },
];

/** Le sélecteur « Ajouter une action » : des tuiles par famille. */
export function addKindsHtml() {
  const groups = [...new Set(ADD_KINDS.map((k) => k.group))];
  return `<div class="rwk">${groups
    .map(
      (g) =>
        `<h3>${esc(g)}</h3><div class="rwk-g">${ADD_KINDS.filter(
          (k) => k.group === g,
        )
          .map(
            (k) =>
              `<button type="button" class="rwk-k k-${kindOf(k.make())}" data-kind="${k.id}">${ic(k.icon)}<span><b>${esc(k.label)}</b><small>${esc(k.hint)}</small></span></button>`,
          )
          .join('')}</div>`,
    )
    .join('')}</div>`;
}

// --- Disponibilité sur Twitch, état de la règle --------------------------------------------------------------------

/** La récompense telle que Twitch la présente (Studio ne fait que la lire). */
export function twitchState(r: CpReward): {
  tone: 'ok' | 'warn' | 'off';
  text: string;
} {
  if (r.twitch_enabled === true)
    return { tone: 'ok', text: 'Achetable sur Twitch' };
  if (r.twitch_enabled === false)
    // Le Core ne garde qu'un booléen (désactivée ou en pause, channel-points/service.ts syncRewards) : les deux sont possibles.
    return { tone: 'warn', text: 'Désactivée ou en pause sur Twitch' };
  return r.listed_by_twitch
    ? { tone: 'off', text: 'Plus listée par Twitch' }
    : { tone: 'off', text: 'Connue par un achat seulement' };
}

/** Ce que Raptoru en fait. */
export function ruleState(r: CpReward): {
  tone: 'on' | 'off' | 'none';
  text: string;
} {
  if (!r.rule?.actions.length)
    return { tone: 'none', text: 'Aucune action Raptoru' };
  return r.rule.enabled
    ? {
        tone: 'on',
        text: `${r.rule.actions.length} action${r.rule.actions.length > 1 ? 's' : ''} Raptoru`,
      }
    : { tone: 'off', text: 'Actions Raptoru coupées' };
}

// --- Filtres de la galerie -------------------------------------------------------------------------------------------

export type Filter = 'all' | 'linked' | 'none' | 'off' | 'twitch';
export const FILTERS: [Filter, string][] = [
  ['all', 'Toutes'],
  ['linked', 'Reliées'],
  ['none', 'Sans action'],
  ['off', 'Coupées'],
  ['twitch', 'Indisponibles sur Twitch'],
];
export const matches = (r: CpReward, f: Filter) =>
  f === 'all'
    ? true
    : f === 'linked'
      ? !!r.rule?.actions.length && r.rule.enabled
      : f === 'none'
        ? !r.rule?.actions.length
        : f === 'off'
          ? !!r.rule?.actions.length && !r.rule.enabled
          : r.twitch_enabled !== true;
export function filterRewards(list: CpReward[], f: Filter, find = '') {
  const q = find.trim().toLowerCase();
  return list.filter(
    (r) => matches(r, f) && (!q || r.title.toLowerCase().includes(q)),
  );
}

/** Les demandes d'une récompense (par identifiant, ou par titre pour un achat reçu avant que Twitch la liste). */
export const requestsOf = (s: CpState, r: CpReward) =>
  s.recent.filter((x) => x.reward.id === r.id || x.reward.title === r.title);

const STATUS: Record<CpRedemption['status'], [string, string, IcName]> = {
  ignored: ['Ignorée', 'off', 'minus'],
  pending: ['En cours', '', 'clock'],
  done: ['Exécutée', 'ok', 'check'],
  partial: ['Partielle', 'warn', 'warn'],
  failed: ['Échec', 'bad', 'x'],
};
export const statusOf = (x: CpRedemption) => STATUS[x.status];

const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const longTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

// --- La galerie ----------------------------------------------------------------------------------------------------

/** L'apparence de la récompense : coût en points, icône de ce qu'elle déclenche, teinte de sa famille. */
export function tile(r: CpReward, big = false) {
  const first = r.rule?.actions[0];
  return `<span class="rwt k-${kindOf(first)}${big ? ' is-big' : ''}" aria-hidden="true">${ic(first ? actionIcon(first) : 'gift')}<b class="d-num">${fmt(r.cost)}</b></span>`;
}

/** Une carte de la galerie. Le bouton couvre la carte ; l'interrupteur de la règle reste au-dessus. */
export function rewardCard(
  r: CpReward,
  s: CpState,
  o: { draft?: boolean } = {},
) {
  const tw = twitchState(r);
  const rule = ruleState(r);
  const acts = r.rule?.actions ?? [];
  const reqs = requestsOf(s, r);
  const last = reqs[0];
  const look = reqs.filter(isNotable).length;
  const fx = effectItems(s.effects);
  const chain = acts.length
    ? `<ul class="rwc-acts">${acts
        .slice(0, 3)
        .map(
          (a) =>
            `<li class="k-${kindOf(a)}" title="${esc(actionLabel(a, s.sounds, fx))}">${ic(actionIcon(a))}<span>${esc(actionTitle(a))}</span></li>`,
        )
        .join(
          '',
        )}${acts.length > 3 ? `<li class="rwc-more">+${acts.length - 3}</li>` : ''}</ul>`
    : `<p class="rwc-empty">${ic('plus')}Relier une action</p>`;
  const [label, , icon] = last ? statusOf(last) : ['', '', 'clock' as IcName];
  return `<article class="rwc is-${rule.tone}${tw.tone === 'ok' ? '' : ' is-unavailable'}" data-card="${esc(r.id)}">
    <button type="button" class="rwc-open" data-open="${esc(r.id)}" aria-label="Ouvrir « ${esc(r.title)} »"></button>
    ${tile(r)}
    <div class="rwc-b">
      <h3>${esc(r.title)}</h3>
      <p class="rwc-tw"><i class="d-dot ${tw.tone === 'ok' ? '' : tw.tone === 'warn' ? 'w' : 'off'}"></i>${esc(tw.text)}${r.user_input_required ? `<span class="rwc-in" title="Le viewer écrit un texte">${ic('chat')}texte</span>` : ''}</p>
      ${chain}
    </div>
    <footer class="rwc-f">
      ${
        acts.length
          ? `<label class="d-sw rwc-sw" title="${o.draft ? 'Changements en cours dans la fiche : ouvre-la pour les enregistrer' : rule.tone === 'on' ? 'Couper les actions Raptoru de cette récompense' : 'Rallumer les actions Raptoru de cette récompense'}"><input type="checkbox" data-rule-toggle="${esc(r.id)}" ${rule.tone === 'on' ? 'checked' : ''} ${o.draft ? 'disabled' : ''} aria-label="Actions Raptoru de « ${esc(r.title)} »"><i></i></label><span class="rwc-rs">${rule.tone === 'on' ? 'Actives' : 'Coupées'}</span>`
          : '<span class="rwc-rs">Rien ne se passe dans Raptoru</span>'
      }
      ${o.draft ? '<span class="d-tag warn">Pas enregistrée</span>' : ''}
      <span class="d-sp"></span>
      ${look ? `<span class="d-tag bad" title="Échec, retard ou remboursement">${look} à vérifier</span>` : ''}
      ${last ? `<span class="rwc-last is-${last.status}" title="Dernière demande : ${esc(label)}, ${esc(longTime(last.received_at))}">${ic(icon)}<span class="d-num">${clockOf(last.received_at)}</span></span>` : ''}
    </footer>
  </article>`;
}

export function galleryHtml(
  s: CpState,
  f: Filter,
  find: string,
  drafts: Set<string>,
) {
  const list = filterRewards(s.rewards, f, find);
  if (!list.length)
    return `<div class="d-empty">${find.trim() ? 'Aucune récompense ne porte ce nom.' : 'Aucune récompense dans ce filtre.'}</div>`;
  return list
    .map((r) => rewardCard(r, s, { draft: drafts.has(r.id) }))
    .join('');
}

export function filtersHtml(s: CpState, f: Filter) {
  return FILTERS.map(([id, label]) => {
    const n = s.rewards.filter((r) => matches(r, id)).length;
    if (id !== 'all' && id !== f && !n) return '';
    return `<button type="button" class="rwp-chip${id === f ? ' on' : ''}" data-filter="${id}" aria-pressed="${id === f}">${esc(label)}<b class="d-num">${n}</b></button>`;
  }).join('');
}

// --- Le fil des demandes -------------------------------------------------------------------------------------------

export function feedRow(x: CpRedemption) {
  const [label, tone, icon] = statusOf(x);
  const who =
    x.source === 'simulation'
      ? `<span class="rwq-av is-test">${ic('flask')}</span><b>Test Studio</b>`
      : `${pp(x.user.display_name, 22)}<b>${esc(x.user.display_name)}</b>`;
  return `<button type="button" class="rwq is-${x.status}" data-req="${esc(`${x.source}:${x.redemption_id}`)}">
    <span class="rwq-who">${who}</span>
    <time class="d-num" title="${esc(longTime(x.received_at))}">${clockOf(x.received_at)}</time>
    <span class="rwq-rw">${esc(x.reward.title)}</span>
    <span class="d-tag ${tone}">${ic(icon)}${label}</span>
  </button>`;
}

/** Le détail d'une demande : qui, quoi, ce qui s'est passé pour chaque action, et ce qu'on peut encore faire. */
export function requestHtml(x: CpRedemption, s: CpState, r: CpReward | null) {
  const [label, tone, icon] = statusOf(x);
  return `<div class="rwd">
    <div class="rwd-top">
      <span class="d-tag ${tone}">${ic(icon)}${label}</span>
      <span class="d-faint">${esc(longTime(x.received_at))}</span>
    </div>
    <dl class="rwd-facts">
      <dt>Viewer</dt><dd>${x.source === 'simulation' ? 'Test depuis Studio (aucun point dépensé)' : esc(x.user.display_name)}</dd>
      <dt>Récompense</dt><dd>${esc(x.reward.title)} · <span class="d-num">${fmt(x.reward.cost)}</span> pts</dd>
      ${x.user_input ? `<dt>Texte</dt><dd>« ${esc(x.user_input)} »</dd>` : ''}
      ${x.twitch_status === 'canceled' ? '<dt>Twitch</dt><dd>Annulée : points rendus au viewer, crédits repris.</dd>' : ''}
    </dl>
    <h3 class="d-lb">Ce que Raptoru a fait</h3>
    ${redemptionDetail(x, s)}
    <h3 class="d-lb">Remboursement</h3>
    <p class="rwd-note">Raptoru le demande lui-même à Twitch, une seule fois, quand rien de l’achat n’a eu lieu et que la récompense a été créée par Raptoru. Aucun remboursement manuel d’ici.</p>
    ${r ? `<button type="button" class="d-btn sm" data-open="${esc(r.id)}">${ic('arrow')}Voir la fiche de « ${esc(r.title)} »</button>` : ''}
  </div>`;
}
