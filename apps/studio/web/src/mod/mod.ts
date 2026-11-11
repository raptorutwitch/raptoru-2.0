// La modération dans Studio : les mêmes lectures et les mêmes commandes du Core que la console de l'extension, avec Studio pour
// acteur (le streamer). Aucune règle ici : le Core vérifie les droits, décide, enregistre et audite. Chaque module (TTS, Sons,
// Bonk, Tombola) ouvre depuis ses propres écrans le même détail d'une demande et la même fiche viewer ; la page Modération les
// reçoit dans sa colonne de droite (`setModHost`), les autres pages dans un tiroir.
import {
  ago,
  choiceBox,
  confirmBox,
  drawer,
  dur,
  errText,
  esc,
  fld,
  fmt,
  hhmm,
  ic,
  menu,
  patch,
  pop,
  pp,
  seg,
  toast,
  type Drawer,
} from '../ds/ds.js';
import { ApiError, STUDIO_HEADERS } from '../http.js';

/** `music`: Music Hub purchases (post-live 11/11) — in the history and refundable, never a desk module. */
export type ModModule = 'tts' | 'soundboard' | 'bonk' | 'raffle' | 'music';
export interface ModItem {
  interaction_id: string;
  module?: ModModule;
  viewer_id: string;
  viewer_display_name: string;
  message?: string;
  detail?: string;
  sound_label?: string;
  emote_glyph?: string;
  emote_id?: string;
  emote_url?: string;
  status: string;
  status_key?: string;
  refund_status?: string;
  review_status?: string;
  review_hits?: { word: string; start: number; end: number }[];
  reviewed_by?: string;
  simulated_cost?: number;
  cost?: number;
  payment_method?: string;
  estimated_duration_ms?: number;
  duration_ms?: number;
  created_at: string;
  completed_at?: string;
  stopped_at?: string;
  channel_sequence?: number;
  cast?: { character_id: string; voice_profile_id: string };
  delivery?: {
    attempt_id?: string;
    started_at?: string | null;
    completed_at?: string | null;
  };
  error?: { code: string; message?: string } | null;
  actions?: { action: string; actor: string; created_at?: string }[];
  movements?: { kind: string; amount: number }[];
}

export const MODS: Record<
  ModModule,
  { label: string; unit: string; units: string }
> = {
  tts: { label: 'TTS', unit: 'demande', units: 'demandes' },
  soundboard: { label: 'Soundboard', unit: 'son', units: 'sons' },
  bonk: { label: 'Bonk', unit: 'bonk', units: 'bonks' },
  raffle: { label: 'Tombola', unit: 'ticket', units: 'tickets' },
  music: { label: 'Musique', unit: 'demande', units: 'demandes' },
};
export const SCOPE: Record<string, string> = {
  all: 'Tout Raptoru',
  tts: 'TTS',
  soundboard: 'Soundboard',
  bonk: 'Bonk',
  raffle: 'Tombola',
  music: 'Musique',
};
const STATUS: Record<string, string> = {
  queued: 'En attente',
  accepted: 'En attente',
  starting: 'En cours',
  playing: 'En cours',
  executing: 'En cours',
  completed: 'Terminé',
  failed: 'Échec',
  execution_unknown: 'Non confirmé',
  cancelled: 'Retiré',
};
export const statusText = (i: ModItem) =>
  i.refund_status === 'refunded' ? 'Remboursé' : (STATUS[i.status] ?? i.status);
const OPEN = ['queued', 'accepted', 'starting', 'playing', 'executing'];
export const isLive = (i: ModItem) => OPEN.includes(i.status);
export const isPlaying = (i: ModItem) =>
  ['starting', 'playing', 'executing'].includes(i.status) ||
  (i.module === 'soundboard' && !!i.delivery?.attempt_id && isLive(i));
export const pending = (i: ModItem) =>
  i.review_status === 'pending' && isLive(i);
export const money = (i: ModItem) => {
  const c = i.simulated_cost ?? i.cost ?? 0;
  return Number(c) === 0 && i.module === 'raffle'
    ? 'gratuit'
    : `${fmt(c)} ${i.payment_method === 'credits' ? 'cr' : 'J'}`;
};
/** Le total d'une file, Jetons et crédits séparés. */
export const sumCost = (items: ModItem[]) => {
  const of = (credits: boolean) =>
    items
      .filter((i) => (i.payment_method === 'credits') === credits)
      .reduce((a, i) => a + Number(i.simulated_cost ?? i.cost ?? 0), 0);
  const t = of(false);
  const c = of(true);
  return (
    [t ? `${fmt(t)} J` : '', c ? `${fmt(c)} cr` : '']
      .filter(Boolean)
      .join(' + ') || '0 J'
  );
};
/** Surligne les mots trouvés par le Core (positions dans le message d'origine). */
export function marked(text: string, hits?: ModItem['review_hits']) {
  if (!hits?.length) return esc(text);
  let out = '';
  let at = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start < at) continue;
    out += `${esc(text.slice(at, h.start))}<mark>${esc(text.slice(h.start, h.end))}</mark>`;
    at = h.end;
  }
  return out + esc(text.slice(at));
}
export const actorName = (a: unknown) =>
  /^studio(:|$)/.test(String(a))
    ? 'Studio'
    : String(a) === 'system'
      ? 'Automatique'
      : String(a ?? '');
/** L'heure, précédée du jour quand ce n'est plus aujourd'hui. */
export const when = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? hhmm(iso)
    : `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${hhmm(iso)}`;
};

/** Les permissions accordées à un modérateur (mêmes noms que le Core, qui seul les vérifie). */
export const PERMS: Record<string, readonly [string, string]> = {
  wallet: [
    'Portefeuille',
    'Créditer, débiter ou rembourser des Jetons et crédits.',
  ],
  modules: ['Fermer un module', 'Passer un module en « Fermé ».'],
  globalPause: ['Pause globale', 'Refuser toutes les nouvelles interactions.'],
  perms: ['Gérer les permissions', 'Accorder ces permissions aux autres mods.'],
  sensitive: [
    'Sanctions sensibles',
    'Bloquer tout Raptoru, ou plus d’une heure.',
  ],
  words: ['Mots surveillés', 'Modifier la liste de surveillance TTS.'],
  raffle: [
    'Gérer la Tombola',
    '+ temps, pause, tirage immédiat, ajout manuel.',
  ],
  subWheelDraw: [
    'Roue du Sub · Tirer',
    'Demander le tirage d’un tour en attente.',
  ],
  subWheelGrant: [
    'Roue du Sub · Accorder',
    'Accorder un tour, décider des tours « À vérifier ».',
  ],
};
export const ROLE: Record<string, string> = {
  broadcaster: 'Streamer',
  supermod: 'Supermod',
  moderator: 'Mod',
  viewer: 'Viewer',
};
const ACTION: Record<string, string> = {
  module_paused: 'Mise en pause',
  module_active: 'Reprise',
  module_disabled: 'Fermeture',
  stop: 'Arrêté',
  stop_all: 'Stop tous les sons',
  cancel: 'Retiré',
  purge: 'File vidée',
  refund: 'Remboursement',
  allow: 'Laissé passer',
  block_viewer: 'Blocage',
  unblock_viewer: 'Déblocage',
  cooldown_set: 'Cooldown personnel',
  cooldown_clear: 'Cooldown retiré',
  cooldown_running_clear: 'Cooldown TTS effacé',
  global_pause: 'Pause globale',
  global_resume: 'Pause globale levée',
  set_permission: 'Permission',
  set_staff: 'Rôle d’équipe',
  note_add: 'Note',
  word_add: 'Mot ajouté',
  word_remove: 'Mot retiré',
  wallet_adjust: 'Portefeuille ajusté (admin)',
  raffle_open: 'Tombola ouverte',
  raffle_close: 'Tombola fermée',
  raffle_draw: 'Tirage Tombola',
  raffle_extend: 'Tombola · + temps',
  raffle_pause: 'Tombola · pause',
  raffle_resume: 'Tombola · reprise',
  raffle_cancel: 'Tombola · annulation',
  raffle_add_participant: 'Tombola · ajout manuel',
  raffle_remove_participant: 'Tombola · retrait',
  raffle_no_participants: 'Tombola · aucun participant',
  raffle_config: 'Réglages Tombola',
  scheduler_start: 'Tombola · automatique lancé',
  scheduler_stop: 'Tombola · automatique arrêté',
  scheduler_pause: 'Tombola · automatique en pause',
  scheduler_resume: 'Tombola · automatique repris',
  config_update: 'Réglages TTS',
  config_reset: 'Réglages TTS (origine)',
  lab_wallet_set: 'Portefeuille de test défini',
  lab_wallet_adjust: 'Portefeuille de test ajusté',
  lab_wallet_reset: 'Portefeuille de test réinitialisé',
  sw_mode: 'Roue du Sub · mode',
  sw_draw_request: 'Roue du Sub · tirage demandé',
  sw_grant: 'Roue du Sub · tour accordé',
  sw_review_distinct: 'Roue du Sub · deux mois distincts',
  sw_review_merge: 'Roue du Sub · doublon fusionné',
  sw_review_unresolved: 'Roue du Sub · laissé en attente',
};
export const actionLabel = (a: string) => ACTION[a] ?? a;

const MOD_ERRORS: Record<string, string> = {
  already_refunded: 'Déjà remboursé.',
  not_terminal: 'Arrête ou retire d’abord cette demande.',
  nothing_playing: 'Rien en cours de lecture.',
  not_open: 'Cette demande n’est plus dans la file.',
  not_pending: 'Cette demande n’attend plus de vérification.',
  unsupported: 'Action sans objet pour ce module.',
  target_is_staff: 'Un membre de l’équipe ne peut pas être sanctionné.',
  target_not_editable: 'Supermods et streamer ont déjà toutes les permissions.',
  self_edit: 'Tu ne peux pas modifier tes propres permissions.',
  not_in_team: 'Cette personne n’est pas dans l’équipe.',
  word_exists: 'Ce mot est déjà dans la liste.',
  word_not_found: 'Mot introuvable.',
  nothing_to_debit: 'Solde déjà à 0.',
  wallet_full: 'Solde au maximum.',
  raffle_already_open: 'Une tombola est déjà ouverte.',
  no_open_raffle: 'Aucune tombola ouverte.',
  nothing_to_draw: 'Aucune tombola à tirer.',
  viewer_blocked: 'Viewer bloqué de la Tombola.',
  already_joined: 'Déjà inscrit à cette manche.',
  not_a_participant: 'Ne participe pas à cette manche.',
  invalid_phase: 'Impossible à ce stade de la manche.',
  self_refund: 'Tu ne peux pas rembourser ton propre achat.',
  refund_not_allowed: 'Ce module ne rembourse pas.',
  nothing_to_refund: 'Rien à rembourser.',
  idempotency_conflict: 'Action déjà engagée autrement : relis la demande.',
  interaction_not_found: 'Demande introuvable.',
};
/** Les refus dits dans les mots du streamer ; un refus de droits nomme la permission qui manque. */
export function modErr(e: unknown) {
  const x = e as ApiError;
  if (x.code === 'forbidden') {
    const g = String(
      x.details?.grant ??
        String(x.details?.permission ?? '').replace(/^grant\./, ''),
    );
    if (PERMS[g]) return `Permission « ${PERMS[g][0]} » requise.`;
    return `Action réservée${x.details?.needs === 'broadcaster' ? ' au streamer' : ''}.`;
  }
  return errText(e, MOD_ERRORS);
}

async function call<T>(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: STUDIO_HEADERS }).catch(
    () => {
      throw new ApiError(0, 'network_error');
    },
  );
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(res.status, String(body.error ?? res.status), body);
  return body as T;
}
export const modGet = <T = Record<string, unknown>>(path: string) =>
  call<T>(`/api/lab/${path}`);
/** Une commande du Core. `key` : l'intention (le même clic rejoué n'applique l'argent qu'une fois). */
export const modAct = (command: Record<string, unknown>, key?: string) =>
  call<Record<string, unknown>>('/api/lab/actions', {
    method: 'POST',
    body: JSON.stringify(key ? { command, idempotency_key: key } : { command }),
  });

const listeners = new Set<() => void>();
/** Une page s'abonne pour relire son état dès qu'une action de modération aboutit. */
export function onModChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const modChanged = () => {
  for (const l of listeners) l();
};
/** Lance la commande, dit le résultat, prévient les pages ouvertes. */
export async function act(
  btn: HTMLElement | null,
  command: Record<string, unknown>,
  done: string,
  key?: string,
) {
  btn?.classList.add('is-busy');
  let ok = false;
  try {
    await modAct(command, key);
    toast(done);
    ok = true;
  } catch (e) {
    toast(modErr(e), { bad: true });
  }
  btn?.classList.remove('is-busy');
  modChanged();
  return ok;
}

/** Ce que le Core dit du rôle de Studio. Sans lecture, rien n'est verrouillé d'avance : le Core refuse lui-même. */
let me: { role: string; grants: string[] } | null = null;
export const setModMe = (m: typeof me) => {
  me = m ?? me;
};
export const granted = (g: string) => !me || me.grants.includes(g);

const names = new Map<string, string>();
/** Mémorise les pseudos vus : l'audit ne porte que des identifiants. */
export const learn = (id: string | null | undefined, name?: string | null) => {
  if (id && name) names.set(id, name);
};
export const nameOf = (id: string) => names.get(id) ?? id;
/** Va chercher les pseudos encore inconnus de cette liste ; `then` seulement si au moins un est apparu. */
export function learnMissing(ids: (string | null)[], then: () => void) {
  const missing = [...new Set(ids)].filter(
    (id): id is string => !!id && !names.has(id),
  );
  if (!missing.length) return;
  void Promise.all(
    missing.slice(0, 12).map((id) =>
      modGet<Card>(`viewers/${id}?music=1`).then(
        (c) => names.set(id, c.display_name),
        () => names.set(id, id),
      ),
    ),
  ).then(then);
}

export interface SearchHit {
  viewer_id: string;
  display_name: string;
  role?: string;
  restriction?: 'block' | 'cooldown' | null;
}
export async function searchViewers(q: string) {
  const { viewers } = await modGet<{ viewers: SearchHit[] }>(
    `search?q=${encodeURIComponent(q.trim().slice(0, 40))}`,
  );
  for (const v of viewers) learn(v.viewer_id, v.display_name);
  return viewers;
}

// --- Où s'ouvre un détail ---------------------------------------------------------------------------------------------

export interface Sheet {
  el: HTMLElement;
  set: Drawer['set'];
  close(): void;
  isOpen(): boolean;
  onClose(fn: () => void): void;
}
type SheetInit = {
  kicker?: string;
  title: string;
  body: string;
  foot?: string;
};
let host: ((o: SheetInit) => Sheet) | null = null;
/** Une page peut recevoir les détails dans sa propre colonne, à la place du tiroir. */
export const setModHost = (h: typeof host) => {
  host = h;
};
/** Écrit dans une colonne de détail faite comme un tiroir ; rien si rien n'a changé. */
export function patchSheet(el: HTMLElement, x: Partial<SheetInit>) {
  const q = (s: string) => el.querySelector<HTMLElement>(s)!;
  if (x.kicker !== undefined) q('[data-k]').textContent = x.kicker;
  if (x.title !== undefined) q('[data-t]').textContent = x.title;
  if (x.body !== undefined) patch(q('[data-b]'), x.body);
  if (x.foot !== undefined) {
    patch(q('[data-f]'), x.foot);
    q('[data-f]').hidden = !x.foot;
  }
}
function sheet(o: SheetInit): Sheet {
  if (host) return host(o);
  const d = drawer(o);
  return {
    el: d.el,
    set: d.set,
    close: d.close,
    isOpen: () => d.el.open,
    onClose: (fn) => d.el.addEventListener('close', fn),
  };
}

// D'un détail à l'autre (fiche → demande → mouvement), le retour remonte le fil au lieu de tout fermer.
let here: (() => void) | null = null;
const trail: (() => void)[] = [];
let goingBack = false;
export const resetTrail = () => {
  here = null;
  trail.length = 0;
};
function visit(s: Sheet, reopen: () => void) {
  if (here && !goingBack) trail.push(here);
  goingBack = false;
  here = reopen;
  s.onClose(() => {
    if (here === reopen) resetTrail();
  });
  if (!trail.length) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'd-ib';
  b.ariaLabel = 'Retour';
  b.innerHTML = ic('back');
  b.onclick = () => {
    goingBack = true;
    trail.pop()!();
  };
  s.el.querySelector('header')?.prepend(b);
}

// --- Le verbe d'une ligne ---------------------------------------------------------------------------------------------

/** La commande qui retire ou coupe une demande, avec sa clé d'intention : le même geste rejoué n'agit qu'une fois. */
export function removal(i: ModItem, module: ModModule, refund: boolean) {
  return {
    command:
      isPlaying(i) && module === 'tts'
        ? { action: 'stop_current', module: 'tts', refund }
        : {
            action: 'cancel',
            module,
            interaction_id: i.interaction_id,
            refund,
          },
    key: `remove:${i.interaction_id}:${refund}`,
  };
}
/** Laisser passer une demande retenue sur un mot surveillé. */
export const allow = (btn: HTMLElement | null, i: ModItem) =>
  act(
    btn,
    { action: 'allow', module: 'tts', interaction_id: i.interaction_id },
    `Demande de ${i.viewer_display_name} laissée passer`,
  );
export const removeItem = (
  btn: HTMLElement | null,
  i: ModItem,
  module: ModModule,
  refund: boolean,
  verb = isPlaying(i) ? 'Coupé' : 'Retiré',
) => {
  const { command, key } = removal(i, module, refund);
  return act(
    btn,
    command,
    `${verb} ${refund ? 'et remboursé' : 'sans remboursement'} · ${i.viewer_display_name}`,
    key,
  );
};

/** « Passer et rembourser » / « Passer sans rembourser » : jamais une croix ambiguë. `refuse` : le mot d'une demande à vérifier. */
export function removeMenu(
  anchor: HTMLElement,
  i: ModItem,
  module: ModModule,
  o: { refuse?: boolean } = {},
) {
  const p = isPlaying(i);
  const verb = o.refuse ? 'Refuser' : p ? 'Couper' : 'Retirer';
  const done = o.refuse ? 'Refusé' : undefined;
  menu(anchor, `${esc(i.viewer_display_name)} · ${esc(money(i))}`, [
    pending(i) && {
      label: 'Laisser passer',
      icon: 'check',
      kind: 'ok',
      run: () => void allow(anchor, i),
    },
    module !== 'bonk' &&
      module !== 'raffle' && {
        label: `${verb} et rembourser`,
        icon: 'refund',
        run: () => void removeItem(anchor, i, module, true, done),
      },
    module !== 'bonk' &&
      module !== 'raffle' && {
        label: `${verb} sans rembourser`,
        icon: p ? 'stop' : 'trash',
        kind: 'bad',
        run: () => void removeItem(anchor, i, module, false, done),
      },
    '-',
    { label: 'Voir le détail', icon: 'info', run: () => openItem(i, module) },
    {
      label: 'Fiche du viewer',
      icon: 'user',
      run: () => openViewer(i.viewer_id),
    },
  ]);
}

export function blockMenu(
  anchor: HTMLElement,
  vid: string,
  name: string,
  m: ModModule,
) {
  const apply = (s: number) =>
    void act(
      anchor,
      { action: 'block_viewer', viewer_id: vid, module: m, duration_s: s },
      `${name} · ${MODS[m].label} bloqué ${dur(s)}`,
    );
  menu(anchor, `Bloquer ${esc(name)}`, [
    { label: `${MODS[m].label} · 1 min`, icon: 'ban', run: () => apply(60) },
    { label: `${MODS[m].label} · 5 min`, icon: 'ban', run: () => apply(300) },
    {
      label: 'Autre durée…',
      icon: 'more',
      run: () => blockForm(anchor, vid, name, m),
    },
  ]);
}

const UNIT = [
  ['s', 's'],
  ['min', 'min'],
  ['h', 'h'],
] as const;
const toSecs = (v: number, u: string) =>
  Math.max(1, Math.round(v || 0)) * (u === 'h' ? 3600 : u === 'min' ? 60 : 1);
const SEG_MOD = [
  ['tts', 'TTS'],
  ['soundboard', 'Sons'],
  ['bonk', 'Bonk'],
] as const;

/** Blocage complet : portée, durée, raison. Tout Raptoru ou plus d'une heure : le Core exige « Sanctions sensibles ». */
export function blockForm(
  anchor: HTMLElement,
  vid: string,
  name: string,
  m: string,
) {
  const s = { module: SCOPE[m] ? m : 'tts', d: '300', cv: 10, cu: 'min' };
  const DUR = [
    ['30', '30 s'],
    ['60', '1 min'],
    ['300', '5 min'],
    ['3600', '1 h'],
    ['forever', 'Sans fin'],
    ['custom', 'Autre'],
  ] as const;
  const secs = () =>
    s.d === 'forever'
      ? null
      : s.d === 'custom'
        ? toSecs(s.cv, s.cu)
        : Number(s.d);
  const locked = () => {
    const t = secs();
    return (
      (s.module === 'all' || t === null || t > 3600) && !granted('sensitive')
    );
  };
  const sees = () => {
    const t = secs();
    return `${ic('lock')}${s.module === 'all' ? 'Interactions indisponibles' : `${esc(SCOPE[s.module])} indisponible`}${t ? ` · ${dur(t)}` : ''}`;
  };
  const body = () => `<h3>Bloquer ${esc(name)}</h3>
    <div class="d-lb">Sur</div>${seg(
      'data-bm',
      Object.entries(SCOPE).map(
        ([k, l]) =>
          [k, k === 'all' ? 'Tout' : k === 'soundboard' ? 'Sons' : l] as const,
      ),
      s.module,
      'block',
    )}
    <div class="d-lb">Durée</div>${seg('data-bd', DUR, s.d, 'block')}
    ${s.d === 'custom' ? `<div class="m-custom">${fld('data-bc', s.cv, '', 'min="1" aria-label="Durée"')}${seg('data-bu', UNIT, s.cu)}</div>` : ''}
    <textarea class="d-area" data-br style="min-height:48px" placeholder="Raison (équipe seulement, facultatif)" maxlength="200"></textarea>
    <p class="m-sees"><small>Le viewer verra</small><span data-bs>${sees()}</span></p>
    ${locked() ? `<p class="d-note bad">${ic('lock')} Tout Raptoru, sans fin ou plus d’une heure : permission « Sanctions sensibles ».</p>` : ''}
    <p class="d-note">Aucune sanction Twitch : le viewer perd seulement l’accès à l’interaction.</p>
    <button type="button" class="d-btn pri" data-go ${locked() ? 'disabled' : ''}>Bloquer${secs() ? ` ${dur(secs()!)}` : ''}</button>`;
  const el = pop(anchor, body(), undefined, { cls: 'd-form m-form' });
  const draw = () => {
    const reason =
      el.querySelector<HTMLTextAreaElement>('[data-br]')?.value ?? '';
    el.innerHTML = body();
    el.querySelector<HTMLTextAreaElement>('[data-br]')!.value = reason;
  };
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-bc]')) return;
    s.cv = Number(t.value) || 1;
    el.querySelector('[data-bs]')!.innerHTML = sees();
    el.querySelector('[data-go]')!.textContent = `Bloquer ${dur(secs()!)}`;
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const bm = t.closest<HTMLElement>('[data-bm]')?.dataset.bm;
    const bd = t.closest<HTMLElement>('[data-bd]')?.dataset.bd;
    const bu = t.closest<HTMLElement>('[data-bu]')?.dataset.bu;
    if (bm) s.module = bm;
    if (bd) s.d = bd;
    if (bu) s.cu = bu;
    if (bm || bd || bu) return draw();
    if (!t.closest('[data-go]')) return;
    const time = secs();
    const reason =
      el.querySelector<HTMLTextAreaElement>('[data-br]')?.value.trim() ||
      undefined;
    el.hidePopover();
    void act(
      anchor,
      {
        action: 'block_viewer',
        viewer_id: vid,
        module: s.module,
        duration_s: time,
        reason,
      },
      `${name} · ${SCOPE[s.module]} bloqué${time ? ` ${dur(time)}` : ''}`,
    );
  });
}

export function cooldownForm(
  anchor: HTMLElement,
  vid: string,
  name: string,
  m: string,
) {
  const s = {
    module: ['tts', 'soundboard', 'bonk'].includes(m) ? m : 'tts',
    d: '300',
    cv: 2,
    cu: 'min',
    span: '3600',
    sv: 3,
    su: 'h',
  };
  const delay = () => (s.d === 'custom' ? toSecs(s.cv, s.cu) : Number(s.d));
  const span = () =>
    s.span === 'stream'
      ? ('stream' as const)
      : s.span === 'custom'
        ? Math.max(60, toSecs(s.sv, s.su))
        : Number(s.span);
  const sum = () => {
    const u = { tts: 'deux TTS', soundboard: 'deux sons', bonk: 'deux bonks' }[
      s.module
    ];
    const t = span();
    return `Attente de <b>${dur(delay())}</b> entre ${u} <b>${t === 'stream' ? 'jusqu’à la fin du stream' : `pendant ${dur(t)}`}</b>.`;
  };
  const body = () => `<h3>Délai de ${esc(name)}</h3>
    <div class="d-lb">Module</div>${seg('data-cm', SEG_MOD, s.module, 'block')}
    <div class="d-lb">Délai imposé</div>${seg(
      'data-cd',
      [
        ['30', '30 s'],
        ['60', '1 min'],
        ['180', '3 min'],
        ['300', '5 min'],
        ['custom', 'Autre'],
      ],
      s.d,
      'block',
    )}
    ${s.d === 'custom' ? `<div class="m-custom">${fld('data-cv', s.cv, '', 'min="1" aria-label="Délai"')}${seg('data-cu', UNIT, s.cu)}</div>` : ''}
    <div class="d-lb">Pendant</div>${seg(
      'data-cs',
      [
        ['900', '15 min'],
        ['3600', '1 h'],
        ['7200', '2 h'],
        ['stream', 'Ce stream'],
        ['custom', 'Autre'],
      ],
      s.span,
      'block',
    )}
    ${s.span === 'custom' ? `<div class="m-custom">${fld('data-sv', s.sv, '', 'min="1" aria-label="Durée"')}${seg('data-su', UNIT.slice(1), s.su)}</div>` : ''}
    <p class="d-note" data-sum>${sum()}</p>
    <button type="button" class="d-btn pri" data-go>Appliquer</button>`;
  const el = pop(anchor, body(), undefined, { cls: 'd-form m-form' });
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-cv]')) s.cv = Number(t.value) || 1;
    if (t.matches('[data-sv]')) s.sv = Number(t.value) || 1;
    el.querySelector('[data-sum]')!.innerHTML = sum();
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pick = (k: string) => t.closest<HTMLElement>(`[data-${k}]`)?.dataset;
    const cm = pick('cm')?.cm;
    const cd = pick('cd')?.cd;
    const cs = pick('cs')?.cs;
    const cu = pick('cu')?.cu;
    const su = pick('su')?.su;
    if (cm) s.module = cm;
    if (cd) s.d = cd;
    if (cs) s.span = cs;
    if (cu) s.cu = cu;
    if (su) s.su = su;
    if (cm || cd || cs || cu || su) {
      el.innerHTML = body();
      return;
    }
    if (!t.closest('[data-go]')) return;
    el.hidePopover();
    void act(
      anchor,
      {
        action: 'set_cooldown',
        viewer_id: vid,
        module: s.module,
        delay_s: delay(),
        span: span(),
      },
      `${name} · cooldown ${SCOPE[s.module]} ${dur(delay())}`,
    );
  });
}

const WALLET: Record<string, string> = {
  tokens: 'Jetons',
  credits_tts: 'Crédits TTS',
  credits_soundboard: 'Crédits Sons',
};
const CUR: Record<string, string> = {
  tokens: 'J',
  credits_tts: 'cr TTS',
  credits_soundboard: 'cr Sons',
};

export function walletForm(
  anchor: HTMLElement,
  vid: string,
  name: string,
  sign: 1 | -1,
  bal: Card['wallet'] = {},
) {
  const key = crypto.randomUUID();
  const s = { cur: 'tokens', amount: 500, reason: '' };
  const after = () => {
    const now = Number((bal as Record<string, unknown>)[s.cur] ?? 0);
    return `Nouveau solde : <b>${fmt(Math.max(0, now + sign * s.amount))} ${CUR[s.cur]}</b>`;
  };
  const body = () => `<h3>${sign > 0 ? 'Créditer' : 'Débiter'} ${esc(name)}</h3>
    ${seg('data-wc', Object.entries(WALLET), s.cur, 'block')}
    ${fld('data-wa', s.amount, '', 'min="1" aria-label="Montant"')}
    <textarea class="d-area" data-wr style="min-height:48px" placeholder="Raison (ex. bug Soundboard)" maxlength="200">${esc(s.reason)}</textarea>
    <p class="d-note" data-res>${after()}</p>
    <p class="d-note">Mouvement réel sur le portefeuille de ce profil, tracé dans l’audit.</p>
    <button type="button" class="d-btn pri" data-go>${sign > 0 ? 'Créditer' : 'Débiter'}</button>`;
  const el = pop(anchor, body(), undefined, { cls: 'd-form m-form' });
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-wr]')) s.reason = t.value;
    if (t.matches('[data-wa]')) {
      s.amount = Math.abs(Math.round(Number(t.value) || 0));
      el.querySelector('[data-res]')!.innerHTML = after();
    }
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const wc = t.closest<HTMLElement>('[data-wc]')?.dataset.wc;
    if (wc) {
      s.cur = wc;
      el.innerHTML = body();
      return;
    }
    if (!t.closest('[data-go]') || !s.amount) return;
    el.hidePopover();
    void act(
      anchor,
      {
        action: 'wallet_adjust',
        viewer_id: vid,
        currency: s.cur,
        delta: sign * s.amount,
        reason: s.reason.trim() || undefined,
      },
      `${sign > 0 ? '+' : '−'} ${fmt(s.amount)} ${WALLET[s.cur]} · ${name}`,
      // Un autre montant ou une autre monnaie est une autre intention : une autre clé.
      `${key}:${s.cur}:${sign * s.amount}`,
    );
  });
}

function noteForm(anchor: HTMLElement, vid: string) {
  const el = pop(
    anchor,
    `<h3>Note interne</h3><textarea class="d-area" data-n maxlength="140" placeholder="Ex. spam TTS, averti. Visible par l’équipe seulement"></textarea><button type="button" class="d-btn pri" data-go>Ajouter</button>`,
    undefined,
    { cls: 'd-form' },
  );
  el.querySelector<HTMLElement>('[data-go]')!.onclick = () => {
    const text = el
      .querySelector<HTMLTextAreaElement>('[data-n]')!
      .value.trim();
    if (!text) return;
    el.hidePopover();
    void act(
      anchor,
      { action: 'add_note', viewer_id: vid, text },
      'Note ajoutée',
    );
  };
}

/** Retirer un blocage ou un cooldown : c'est la commande inverse de celle qui l'a posé. */
export const lift = (
  btn: HTMLElement | null,
  vid: string,
  kind: string,
  module: string,
  name: string,
) =>
  act(
    btn,
    kind === 'block'
      ? { action: 'unblock_viewer', viewer_id: vid, module }
      : { action: 'clear_cooldown', viewer_id: vid, module },
    `Restriction retirée · ${name}`,
  );

// --- Tombola : la manche en cours ------------------------------------------------------------------------------------

export const raffleAct = (
  btn: HTMLElement | null,
  command: Record<string, unknown>,
  done: string,
) => act(btn, { action: 'raffle', command }, done);

/** Inscription à la main. Un viewer bloqué est refusé ; le forcer est une décision à part, tracée, qui demande « Sanctions sensibles ». */
export async function raffleAdd(
  btn: HTMLElement | null,
  v: string,
  name: string,
  force = false,
): Promise<void> {
  try {
    await modAct({
      action: 'raffle',
      command: {
        action: 'add_participant',
        viewer_id: v,
        display_name: name,
        force,
        ...(force ? { reason: 'ajout forcé malgré le blocage' } : {}),
      },
    });
    toast(`${name} ajouté à la manche`);
  } catch (e) {
    const blocked = (e as ApiError).code === 'viewer_blocked';
    if (blocked && !force && granted('sensitive')) {
      const yes = await confirmBox({
        title: 'Viewer bloqué de la Tombola',
        body: `${name} est bloqué. Forcer son inscription ? L’action est tracée.`,
        yes: 'Forcer l’inscription',
        no: 'Annuler',
      });
      if (yes) return raffleAdd(btn, v, name, true);
      return;
    }
    toast(blocked ? `${name} est bloqué de la Tombola.` : modErr(e), {
      bad: true,
    });
  }
  modChanged();
}

/** Chercher un viewer pour l'ajouter à la manche. */
export function raffleAddForm(anchor: HTMLElement, joined: Set<string>) {
  const el = pop(
    anchor,
    `<h3>Ajouter un participant</h3><label class="d-fld">${ic('search')}<input type="text" data-q placeholder="Pseudo" aria-label="Pseudo" autocomplete="off"></label><div data-res class="m-res"></div><p class="d-note">Inscription à la main, tracée. Passe une pause ; un viewer bloqué est refusé.</p>`,
    undefined,
    { cls: 'd-form' },
  );
  const res = el.querySelector<HTMLElement>('[data-res]')!;
  const look = async (q: string) => {
    const list = await searchViewers(q).catch(() => []);
    res.innerHTML =
      list
        .map((x) =>
          joined.has(x.viewer_id)
            ? `<div class="m-line">${pp(x.display_name, 22)}<span class="m-cut">${esc(x.display_name)}</span><small>déjà inscrit</small></div>`
            : `<button type="button" class="m-line m-rowbtn" data-add="${esc(x.viewer_id)}" data-name="${esc(x.display_name)}">${pp(x.display_name, 22)}<span class="m-cut">${esc(x.display_name)}</span>${x.restriction === 'block' ? '<span class="d-tag bad">bloqué</span>' : ''}</button>`,
        )
        .join('') || '<p class="d-note">Aucun viewer.</p>';
  };
  void look('');
  let timer: ReturnType<typeof setTimeout>;
  el.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(() => void look(q), 180);
  });
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-add]');
    if (!b) return;
    el.hidePopover();
    void raffleAdd(anchor, b.dataset.add!, b.dataset.name!);
  });
}

// --- Détail d'une demande ---------------------------------------------------------------------------------------------

/** L'image d'un bonk : l'emote réelle quand elle est servie ici, sinon son signe. */
export const emoteHtml = (i: ModItem, size = 18) => {
  const url = String(i.emote_url ?? '');
  const src = /^(https:\/\/|\/ext)/.test(url)
    ? url
    : /^assets\//.test(url)
      ? `/ext/${url}`
      : '';
  return src
    ? `<img class="m-emote" src="${esc(src)}" alt="${esc(i.emote_glyph ?? i.emote_id ?? '')}" width="${size}" height="${size}">`
    : esc(i.emote_glyph ?? i.emote_id ?? i.detail ?? '');
};
const WHAT: Record<ModModule, (i: ModItem) => string> = {
  tts: () => 'Message TTS',
  soundboard: (i) => `Son « ${i.sound_label ?? i.detail ?? ''} »`,
  bonk: (i) => `Bonk ${i.emote_glyph ?? ''}`,
  raffle: () => 'Ticket tombola',
  music: (i) => `Musique · ${i.detail ?? ''}`,
};
export const whatOf = (i: ModItem, m: ModModule) => WHAT[m](i);
export const refundable = (i: ModItem, m: ModModule) =>
  !isLive(i) &&
  m !== 'raffle' &&
  i.refund_status !== 'refunded' &&
  (i.movements ?? []).some((v) => v.kind === 'debit' && Number(v.amount) !== 0);

function itemHtml(i: ModItem, m: ModModule, extra: string) {
  const hits = pending(i) ? (i.review_hits ?? []) : [];
  const text = i.message ?? (m === 'tts' ? i.detail : null);
  const words = [...new Set(hits.map((h) => h.word))];
  const err = i.error?.code ?? null;
  const showErr =
    err &&
    ![
      'cancelled_by_moderator',
      'stopped_by_moderator',
      'purged_by_moderator',
    ].includes(err);
  const endBy = (i.actions ?? []).find((a) =>
    ['cancel', 'stop', 'purge'].includes(a.action),
  );
  return `<button type="button" class="m-viewer" data-viewer>${pp(i.viewer_display_name, 32)}<b>${esc(i.viewer_display_name)}</b>${ic('chev')}</button>
    ${hits.length ? `<p class="d-tag warn" style="height:auto;padding:6px 8px;white-space:normal">${ic('eye')}À vérifier · contient ${esc(words.join(', '))}</p>` : ''}
    ${i.review_status === 'allowed' && i.reviewed_by ? `<p class="d-note">Laissée passer par ${esc(actorName(i.reviewed_by))}.</p>` : ''}
    ${text ? `<blockquote class="d-quote" data-full>${hits.length ? marked(text, hits) : esc(text)}</blockquote>` : ''}
    ${showErr ? `<p class="d-note bad">${esc(i.error?.message ?? err)} · ${i.refund_status === 'refunded' ? 'remboursé automatiquement' : 'non remboursé'}</p>` : ''}
    <dl class="d-kv">
      <dt>État</dt><dd>${esc(statusText(i))}</dd>
      <dt>Prix</dt><dd>${esc(money(i))}</dd>
      <dt>Demandé</dt><dd>${when(i.created_at)} · ${esc(ago(i.created_at))}</dd>
      ${endBy ? `<dt>Fin</dt><dd>${esc(actionLabel(endBy.action))} par ${esc(actorName(endBy.actor))}, ${i.refund_status === 'refunded' ? 'remboursé' : 'sans remboursement'}</dd>` : ''}
      ${extra}
    </dl>
    <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv">
      <dt>Module</dt><dd>${esc(m)}</dd><dt>Statut</dt><dd>${esc(i.status)}</dd><dt>Coût</dt><dd>${esc(i.simulated_cost ?? i.cost)} ${esc(i.payment_method ?? '')}</dd><dt>Référence</dt><dd>${esc(i.interaction_id)}</dd><dt>Viewer</dt><dd>${esc(i.viewer_id)}</dd>
      <dt>Erreur</dt><dd>${esc(err ?? '—')}</dd><dt>Créée</dt><dd>${esc(i.created_at)}</dd><dt>Finie</dt><dd>${esc(i.completed_at ?? i.delivery?.completed_at ?? '—')}</dd>${i.stopped_at ? `<dt>Arrêtée</dt><dd>${esc(i.stopped_at)}</dd>` : ''}
    </dl></details>`;
}
function itemFoot(i: ModItem, m: ModModule) {
  const live = isLive(i);
  const p = isPlaying(i);
  return `${pending(i) ? `<button type="button" class="d-btn pri sm" data-allow>${ic('check')}Laisser passer</button>` : ''}
    ${live && m !== 'raffle' && m !== 'bonk' && m !== 'music' ? `<button type="button" class="d-btn sm" data-rm="1">${ic('refund')}${p ? 'Couper et rembourser' : 'Retirer et rembourser'}</button><button type="button" class="d-btn bad sm" data-rm="0">${ic(p ? 'stop' : 'trash')}${p ? 'Couper sans rembourser' : 'Retirer sans rembourser'}</button>` : ''}
    ${refundable(i, m) ? `<button type="button" class="d-btn sm" data-refund>${ic('refund')}Rembourser</button>` : ''}
    ${m === 'music' ? '' : `<button type="button" class="d-btn ghost sm" data-block>${ic('ban')}Bloquer${ic('down')}</button>`}`;
}

let opened: { refresh(): void } | null = null;
/** Relire le détail ouvert, demande ou fiche (une page l'appelle à chaque relevé). */
export const refreshOpenItem = () => opened?.refresh();
function follow(s: Sheet, refresh: () => void) {
  const mine = { refresh };
  opened = mine;
  s.onClose(() => {
    if (opened === mine) opened = null;
  });
}

/**
 * Le détail d'une demande, ouvert ou passée : texte intégral et toutes les décisions possibles. `extra` : ce que le module
 * ajoute à la fiche (personnage, voix…), sous forme de lignes `<dt><dd>`.
 */
export function openItem(
  first: ModItem,
  module: ModModule,
  extra: (i: ModItem) => string = () => '',
) {
  let i: ModItem = { ...first, module };
  const s = sheet({ kicker: '', title: '', body: '' });
  const paint = () =>
    s.set({
      kicker: `${MODS[module].label} · ${ago(i.created_at)}`,
      title: WHAT[module](i),
      body: itemHtml(i, module, extra(i)),
      foot: itemFoot(i, module),
    });
  paint();
  const reload = async () => {
    const full = await modGet<ModItem>(
      `interactions/${i.interaction_id}?music=1`,
    ).catch(() => null);
    if (full && s.isOpen()) {
      i = { ...i, ...full, module };
      paint();
    }
  };
  void reload();
  follow(s, () => void reload());
  visit(s, () => openItem(i, module, extra));
  s.el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-viewer]')) return openViewer(i.viewer_id);
    const b = t.closest<HTMLElement>('button');
    if (t.closest('[data-allow]')) return void allow(b, i).then(reload);
    const rm = t.closest<HTMLElement>('[data-rm]')?.dataset.rm;
    if (rm !== undefined)
      return void removeItem(b, i, module, rm === '1').then(reload);
    if (t.closest('[data-refund]'))
      return void refundItem(b, i, module, reload);
    if (t.closest('[data-block]') && b)
      blockMenu(b, i.viewer_id, i.viewer_display_name, module);
  });
}
async function refundItem(
  btn: HTMLElement | null,
  i: ModItem,
  module: ModModule,
  then: () => void,
) {
  const yes = await confirmBox({
    title: 'Rembourser cette demande ?',
    body: `${money(i)} rendus à ${i.viewer_display_name}.`,
    yes: 'Rembourser',
    no: 'Annuler',
    danger: false,
  });
  if (!yes) return;
  await act(
    btn,
    { action: 'refund', module, interaction_id: i.interaction_id },
    'Remboursé',
    `refund:${i.interaction_id}`,
  );
  then();
}
/** Ouvrir une demande dont on n'a que la référence (un mouvement, une ligne d'audit). */
export async function openItemId(id: string) {
  try {
    const i = await modGet<ModItem>(`interactions/${id}?music=1`);
    openItem(i, i.module ?? 'tts');
  } catch (e) {
    toast(modErr(e), { bad: true });
  }
}

// --- Mouvements et audit ---------------------------------------------------------------------------------------------

export interface LedgerEntry {
  id: number;
  viewer_id: string;
  viewer_display_name?: string;
  kind: string;
  operation_type: string;
  label: string;
  visible_in_moderation_activity?: boolean;
  amount: number;
  currency: string;
  module_id?: string | null;
  interaction_id?: string | null;
  raffle_id?: string | null;
  actor?: string;
  reason?: string | null;
  created_at: string;
  refunded_by?: number | null;
  refund_of?: number | null;
}
export const signed = (e: LedgerEntry) =>
  `${e.amount > 0 ? '+' : '−'} ${fmt(Math.abs(e.amount))} ${CUR[e.currency] ?? e.currency}`;
const ledger = new Map<string, LedgerEntry>();
/** Toute lecture du grand livre sert aussi à suivre les liens entre un débit et son remboursement. */
export const rememberLedger = (items: LedgerEntry[] = []) => {
  for (const e of items) {
    ledger.set(String(e.id), e);
    learn(e.viewer_id, e.viewer_display_name);
  }
};
export function openLedger(e: LedgerEntry) {
  rememberLedger([e]);
  const link = (id: number, icon: 'refund' | 'coin', text: string) => {
    const o = ledger.get(String(id));
    return `<button type="button" class="m-viewer" data-led="${id}">${ic(icon)}<b>${esc(text)}${o ? ` · ${esc(signed(o))} à ${hhmm(o.created_at)}` : ''}</b>${ic('chev')}</button>`;
  };
  const s = sheet({
    kicker: 'Activité Jetons',
    title: e.label,
    body: `<div class="m-big ${e.amount > 0 ? 'm-plus' : ''}">${esc(signed(e))}</div>
    <dl class="d-kv"><dt>Source</dt><dd>${esc(e.label)}${e.reason && e.kind !== 'refund' ? ` · ${esc(e.reason)}` : ''}</dd>
      <dt>Statut</dt><dd>${e.refunded_by ? 'Débité puis remboursé' : e.amount > 0 ? 'Crédité' : 'Débité'}</dd><dt>Heure</dt><dd>${when(e.created_at)}</dd>
      ${e.actor && e.actor !== 'system' ? `<dt>Par</dt><dd>${esc(actorName(e.actor))}</dd>` : ''}</dl>
    <button type="button" class="m-viewer" data-viewer>${pp(nameOf(e.viewer_id), 28)}<b>${esc(e.viewer_display_name ?? nameOf(e.viewer_id))}</b>${ic('chev')}</button>
    ${e.interaction_id ? `<button type="button" class="m-viewer" data-ix>${ic('info')}<b>Interaction liée</b>${ic('chev')}</button>` : ''}
    ${e.refunded_by ? link(e.refunded_by, 'refund', 'Remboursé') : ''}
    ${e.refund_of ? link(e.refund_of, 'coin', 'Débit d’origine') : ''}
    <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv"><dt>Mouvement</dt><dd>${esc(e.id)}</dd><dt>Type</dt><dd>${esc(e.operation_type)}</dd><dt>Monnaie</dt><dd>${esc(e.currency)}</dd><dt>Créé</dt><dd>${esc(e.created_at)}</dd>${e.interaction_id ? `<dt>Référence</dt><dd>${esc(e.interaction_id)}</dd>` : ''}${e.raffle_id ? `<dt>Manche</dt><dd>${esc(e.raffle_id)}</dd>` : ''}</dl></details>`,
  });
  visit(s, () => openLedger(e));
  s.el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-viewer]')) return openViewer(e.viewer_id);
    if (t.closest('[data-ix]') && e.interaction_id)
      return void openItemId(e.interaction_id);
    const id = t.closest<HTMLElement>('[data-led]')?.dataset.led;
    if (id) void openLedgerId(Number(id), e.viewer_id);
  });
}
/** Un mouvement dont on n'a que le numéro (gain d'un gagnant de la Tombola) : la fiche du viewer le contient. */
export async function openLedgerId(id: number, viewer: string) {
  if (!ledger.has(String(id)))
    await modGet<Card>(`viewers/${viewer}`)
      .then((c) => rememberLedger(c.wallet_ledger))
      .catch(() => undefined);
  const e = ledger.get(String(id));
  if (e) openLedger(e);
  else toast('Mouvement introuvable.', { bad: true });
}

export interface AuditEntry {
  id: number | string;
  created_at: string;
  actor: string;
  role: string;
  module_id: string | null;
  action: string;
  viewer_id: string | null;
  interaction_id: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
}
export function openAudit(a: AuditEntry) {
  const s = sheet({
    kicker: `Audit · ${when(a.created_at)}`,
    title: actionLabel(a.action),
    body: `<dl class="d-kv"><dt>Par</dt><dd>${esc(actorName(a.actor))} (${esc(ROLE[a.role] ?? a.role)})</dd><dt>Module</dt><dd>${esc(SCOPE[a.module_id ?? ''] ?? a.module_id ?? '—')}</dd>${a.reason ? `<dt>Raison</dt><dd>${esc(a.reason)}</dd>` : ''}</dl>
    ${a.viewer_id ? `<button type="button" class="m-viewer" data-viewer style="margin-top:12px">${pp(nameOf(a.viewer_id), 28)}<b>${esc(nameOf(a.viewer_id))}</b>${ic('chev')}</button>` : ''}
    ${a.interaction_id && a.module_id !== 'raffle' ? `<button type="button" class="m-viewer" data-ix>${ic('info')}<b>Interaction liée</b>${ic('chev')}</button>` : ''}
    <details class="d-acc" open style="margin-top:12px"><summary>Avant et après</summary><dl class="d-kv"><dt>Avant</dt><dd>${esc(JSON.stringify(a.before ?? {}))}</dd><dt>Après</dt><dd>${esc(JSON.stringify(a.after ?? {}))}</dd></dl></details>`,
  });
  visit(s, () => openAudit(a));
  s.el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-viewer]') && a.viewer_id) openViewer(a.viewer_id);
    if (t.closest('[data-ix]') && a.interaction_id)
      void openItemId(a.interaction_id);
  });
}

// --- Fiche d'un viewer ---------------------------------------------------------------------------------------------------

export interface Card {
  display_name: string;
  role: string;
  staff?: boolean;
  first_seen?: string | null;
  last_seen?: string | null;
  today_count?: number;
  wallet?: {
    tokens?: number;
    credits_tts?: number | null;
    credits_soundboard?: number | null;
  };
  tts_cooldown_until?: string | null;
  notes?: { id: number; text: string; author?: string; created_at?: string }[];
  restrictions?: {
    kind: 'block' | 'cooldown';
    module: string;
    until: string | null;
    reason?: string;
    delay_s?: number;
  }[];
  activity?: (ModItem & { module: ModModule })[];
  wallet_ledger?: LedgerEntry[];
  raffle?: { joined: boolean; removed?: boolean; source?: string } | null;
  grants?: string[];
}
const SRC: Record<string, string> = {
  chat: 'Chat',
  extension: 'Extension',
  manual: 'À la main',
};
export const sourceText = (s?: string) => SRC[s ?? ''] ?? s ?? '';

const activityRow = (a: ModItem & { module: ModModule }) =>
  `<button type="button" class="m-line m-rowbtn" data-ix="${esc(a.interaction_id)}"><span class="d-tag off">${esc(MODS[a.module]?.label ?? a.module)}</span><span class="m-cut">${esc(a.detail ?? a.message ?? a.sound_label ?? '')}<small>${esc(statusText(a))} · ${when(a.created_at)}</small></span></button>`;

function cardHtml(id: string, v: Card) {
  const ls = v.restrictions ?? [];
  const led = (v.wallet_ledger ?? [])
    .filter((e) => e.visible_in_moderation_activity !== false)
    .slice(0, 6);
  const live = (v.activity ?? []).filter(isLive);
  const recent = (v.activity ?? []).filter((a) => !isLive(a)).slice(0, 6);
  const wait =
    v.tts_cooldown_until && Date.parse(v.tts_cooldown_until) > Date.now()
      ? v.tts_cooldown_until
      : null;
  const rp = v.raffle;
  return `<div class="m-card">${pp(v.display_name, 48)}<div><b>${esc(v.display_name)}</b><small>${esc(ROLE[v.role] ?? 'Viewer')}${ls.length ? ` · ${ls.length} restriction${ls.length > 1 ? 's' : ''}` : ''}</small></div></div>
    <div class="m-wallet"><span><b class="d-num">${fmt(v.wallet?.tokens)}</b><small>Jetons</small></span><span><b class="d-num">${v.wallet?.credits_tts == null ? '—' : fmt(v.wallet.credits_tts)}</b><small>Crédits TTS</small></span><span><b class="d-num">${v.wallet?.credits_soundboard == null ? '—' : fmt(v.wallet.credits_soundboard)}</b><small>Crédits Sons</small></span></div>
    ${
      ls.length || wait
        ? `<h4 class="d-lb m-h">Restrictions<button type="button" class="m-all" data-jump="restrictions">Gérer</button></h4>${ls
            .map(
              (l) =>
                `<div class="m-line">${ic(l.kind === 'block' ? 'ban' : 'clock')}<span>${l.kind === 'block' ? `Bloqué · ${esc(SCOPE[l.module] ?? l.module)}` : `Cooldown ${esc(SCOPE[l.module] ?? l.module)} · ${dur(l.delay_s ?? 0)}`}${l.reason ? ` · ${esc(l.reason)}` : ''}<small>${l.until ? `jusqu’à ${when(l.until)}` : 'jusqu’au déblocage'}</small></span><button type="button" class="d-btn ghost sm" data-lift="${esc(l.kind)}:${esc(l.module)}">Retirer</button></div>`,
            )
            .join('')}${
            wait
              ? `<div class="m-line">${ic('clock')}<span>Attente entre deux TTS<small>jusqu’à ${hhmm(wait)}</small></span><button type="button" class="d-btn ghost sm" data-lift="cooldown:tts">Effacer</button></div>`
              : ''
          }`
        : ''
    }
    ${
      rp
        ? `<div class="m-line">${ic('ticket')}<span>${rp.joined ? `Participe à la manche · ${esc(sourceText(rp.source))}` : rp.removed ? 'Retiré de la manche en cours' : 'Ne participe pas à la manche en cours'}</span>${rp.joined ? '<button type="button" class="d-btn ghost sm" data-raffle-out>Retirer</button>' : '<button type="button" class="d-btn ghost sm" data-raffle-in>Ajouter</button>'}</div>`
        : ''
    }
    <h4 class="d-lb m-h">Notes de l’équipe · ${v.notes?.length ?? 0}</h4>
    ${v.notes?.length ? v.notes.map((n) => `<p class="m-note">${esc(n.text)}<small>${when(n.created_at)} · ${esc(actorName(n.author))}</small></p>`).join('') : '<p class="d-note">Aucune note.</p>'}
    ${live.length ? `<h4 class="d-lb m-h">En ce moment</h4>${live.map(activityRow).join('')}` : ''}
    <h4 class="d-lb m-h">Activité récente<button type="button" class="m-all" data-jump="ix">Voir tout</button></h4>
    ${recent.length ? recent.map(activityRow).join('') : '<p class="d-note">Rien aujourd’hui.</p>'}
    <h4 class="d-lb m-h">Mouvements<button type="button" class="m-all" data-jump="j">Voir tout</button></h4>
    ${
      led.length
        ? led
            .map(
              (e) =>
                `<button type="button" class="m-line m-rowbtn" data-e="${esc(e.id)}"><span class="m-cut">${esc(e.label)}<small>${when(e.created_at)}${e.refunded_by ? ' · remboursé' : ''}</small></span><b class="d-num ${e.amount > 0 ? 'm-plus' : ''}">${esc(signed(e))}</b></button>`,
            )
            .join('')
        : '<p class="d-note">Aucun mouvement.</p>'
    }
    <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv"><dt>Identifiant</dt><dd>${esc(id)}</dd><dt>Premier passage</dt><dd>${v.first_seen ? new Date(v.first_seen).toLocaleDateString('fr-FR') : '—'}</dd><dt>Dernier passage</dt><dd>${when(v.last_seen)}</dd><dt>Aujourd’hui</dt><dd>${fmt(v.today_count)} interaction(s)</dd></dl></details>`;
}

/** Vers la page Modération, filtres posés (« Voir tout » d'une fiche ouverte depuis n'importe quelle page). */
export type ModJump = {
  tab: 'journal' | 'restrictions' | 'words' | 'others';
  sub?: 'ix' | 'j' | 'audit';
  viewer?: string;
  module?: string;
};
let jumper: ((j: ModJump) => void) | null = null;
export const onModJump = (fn: (j: ModJump) => void) => {
  jumper = fn;
};
export function modJump(j: ModJump) {
  jumper?.(j);
  document.querySelector<HTMLDialogElement>('dialog.d-drawer[open]')?.close();
  if (new URLSearchParams(location.search).get('p') === 'moderation') return;
  history.pushState({ p: 'moderation' }, '', '?p=moderation');
  dispatchEvent(new PopStateEvent('popstate'));
}

/** La fiche d'un viewer : solde, restrictions, notes, activité, et toutes les sanctions possibles. */
export function openViewer(id: string) {
  let card: Card | null = null;
  const name = () => card?.display_name ?? nameOf(id);
  const s = sheet({
    kicker: 'Viewer',
    title: nameOf(id),
    body: '<div class="d-skel" style="height:220px"></div>',
  });
  const foot = () =>
    `<button type="button" class="d-btn sm" data-b ${card?.staff ? 'disabled title="Membre de l’équipe"' : ''}>${ic('ban')}Bloquer</button><button type="button" class="d-btn sm" data-c ${card?.staff ? 'disabled' : ''}>${ic('clock')}Cooldown</button><button type="button" class="d-btn ghost sm" data-w="1">${ic('plus')}Créditer</button><button type="button" class="d-btn ghost sm" data-w="-1">${ic('minus')}Débiter</button><button type="button" class="d-btn ghost sm" data-n>${ic('note')}Note</button>`;
  const load = async () => {
    try {
      card = await modGet<Card>(`viewers/${id}`);
    } catch (e) {
      return s.set({ body: `<p class="d-note bad">${esc(modErr(e))}</p>` });
    }
    learn(id, card.display_name);
    rememberLedger(card.wallet_ledger);
    if (s.isOpen())
      s.set({
        kicker: ROLE[card.role] ?? 'Viewer',
        title: card.display_name,
        body: cardHtml(id, card),
        foot: foot(),
      });
  };
  void load();
  const off = onModChange(() => void load());
  s.onClose(() => off());
  follow(s, () => void load());
  visit(s, () => openViewer(id));
  // Le module d'où l'on sanctionne : celui de la demande en cours, sinon TTS.
  const ctx = () => card?.activity?.find(isLive)?.module ?? 'tts';
  s.el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b || !card) return;
    if (b.matches('[data-b]')) blockForm(b, id, name(), ctx());
    if (b.matches('[data-c]')) cooldownForm(b, id, name(), ctx());
    if (b.dataset.w)
      walletForm(b, id, name(), Number(b.dataset.w) as 1 | -1, card.wallet);
    if (b.matches('[data-n]')) noteForm(b, id);
    if (b.dataset.lift) {
      const [kind, module] = b.dataset.lift.split(':');
      void lift(b, id, kind!, module!, name());
    }
    if (b.dataset.jump) {
      const j = b.dataset.jump;
      modJump(
        j === 'restrictions'
          ? { tab: 'restrictions', viewer: id }
          : { tab: 'journal', sub: j as 'ix' | 'j', viewer: id },
      );
    }
    if (b.matches('[data-raffle-out]'))
      void raffleAct(
        b,
        {
          action: 'remove_participant',
          viewer_id: id,
          reason: 'retiré depuis Studio',
        },
        `${name()} retiré de la manche`,
      );
    if (b.matches('[data-raffle-in]')) void raffleAdd(b, id, name());
    if (b.dataset.ix) {
      const a = card.activity?.find((x) => x.interaction_id === b.dataset.ix);
      if (a)
        openItem(
          { ...a, message: a.module === 'tts' ? a.detail : undefined },
          a.module,
        );
    }
    if (b.dataset.e) {
      const led = card.wallet_ledger?.find((x) => String(x.id) === b.dataset.e);
      if (led) openLedger(led);
    }
  });
}

/** Purger une file : le remboursement se choisit, il n'est jamais implicite. */
export async function purge(
  btn: HTMLElement | null,
  m: ModModule,
  items: ModItem[],
) {
  const key = crypto.randomUUID();
  const pick = await choiceBox({
    title: `Vider la file ${MODS[m].label}`,
    body: `${items.length} ${items.length > 1 ? MODS[m].units : MODS[m].unit} retiré${items.length > 1 ? 's' : ''} d’un coup · ${sumCost(items)}.`,
    choices: [
      {
        v: 'refund',
        label: 'Vider et rembourser',
        sub: 'Chaque viewer retrouve ce qu’il a payé.',
      },
      { v: 'keep', label: 'Vider sans rembourser' },
    ],
    yes: 'Vider la file',
    danger: true,
  });
  if (!pick) return;
  await act(
    btn,
    { action: 'purge', module: m, refund: pick.v === 'refund' },
    `File ${MODS[m].label} vidée${pick.v === 'refund' ? ' et remboursée' : ''}`,
    `${key}:${pick.v}`,
  );
}

/** Tous les sons en cours d'un coup ; la file n'est pas touchée. */
export async function stopAll(btn: HTMLElement | null, items: ModItem[]) {
  const key = crypto.randomUUID();
  const pick = await choiceBox({
    title: 'Couper tous les sons',
    body: `${items.length} sons en cours. La file n’est pas touchée.`,
    choices: [
      { v: 'refund', label: 'Couper et rembourser', sub: sumCost(items) },
      { v: 'keep', label: 'Couper sans rembourser' },
    ],
    yes: 'Couper tout',
    danger: true,
  });
  if (!pick) return;
  await act(
    btn,
    { action: 'stop_all', module: 'soundboard', refund: pick.v === 'refund' },
    `${items.length} sons coupés`,
    `${key}:${pick.v}`,
  );
}

/** Ouvert, en pause, fermé : les demandes en attente se gardent par défaut. */
export async function setModuleState(
  btn: HTMLElement | null,
  m: ModModule,
  state: 'active' | 'paused' | 'disabled',
  waiting: ModItem[] = [],
) {
  // Déjà dans cet état : ni commande, ni ligne d'audit, ni question sur la file.
  if (btn?.getAttribute('aria-pressed') === 'true') return false;
  let keep = 'keep';
  if (state === 'disabled' || (state === 'paused' && waiting.length)) {
    const pick = await choiceBox({
      title:
        state === 'paused'
          ? `Mettre ${MODS[m].label} en pause`
          : `Fermer ${MODS[m].label}`,
      body: waiting.length
        ? `${waiting.length} ${waiting.length > 1 ? MODS[m].units : MODS[m].unit} en attente.`
        : 'Le module disparaît pour les viewers.',
      choices: waiting.length
        ? [
            {
              v: 'keep',
              label: 'Garder la file',
              sub: 'Elle reprendra au retour.',
            },
            {
              v: 'cancel_refund',
              label: 'Annuler et rembourser',
              sub: sumCost(waiting),
            },
            { v: 'cancel', label: 'Annuler sans rembourser' },
          ]
        : [],
      yes: state === 'paused' ? 'Mettre en pause' : 'Fermer',
    });
    if (!pick) return false;
    keep = pick.v || 'keep';
  }
  const label = {
    active: 'ouvert aux viewers',
    paused: 'en pause',
    disabled: 'fermé',
  }[state];
  return act(
    btn,
    { action: 'module_state', module: m, state, waiting: keep },
    `${MODS[m].label} ${label}`,
  );
}

/** La pause globale refuse les nouvelles interactions : elle ne coupe, ne purge et ne rembourse rien. */
export async function globalPause(btn: HTMLElement | null, paused: boolean) {
  if (paused) {
    const yes = await confirmBox({
      title: 'Pause globale ?',
      body: 'Raptoru refuse les nouvelles interactions (TTS, sons, bonks, tombola) pour toute la chaîne. Ce qui joue continue, aucune file n’est vidée, rien n’est remboursé.',
      yes: 'Activer la pause globale',
      no: 'Annuler',
    });
    if (!yes) return false;
  }
  return act(
    btn,
    { action: 'global_pause', paused },
    paused
      ? 'Pause globale : nouvelles interactions refusées'
      : 'Pause globale levée',
  );
}

export { toast };
