// La modération dans Studio : les mêmes lectures et les mêmes commandes du Core que la console de l'extension, avec Studio pour
// acteur (le streamer). Aucune règle ici : le Core vérifie les droits, décide, enregistre et audite. Chaque module (TTS, Sons,
// Bonk, Tombola) ouvre depuis ses propres écrans le même détail d'une demande et la même fiche viewer.
import {
  ago,
  choiceBox,
  drawer,
  dur,
  esc,
  fld,
  fmt,
  hhmm,
  ic,
  menu,
  pop,
  pp,
  run,
  seg,
  toast,
  type Drawer,
} from '../ds/ds.js';
import { ApiError, STUDIO_HEADERS } from '../http.js';

export type ModModule = 'tts' | 'soundboard' | 'bonk' | 'raffle';
export interface ModItem {
  interaction_id: string;
  module?: ModModule;
  viewer_id: string;
  viewer_display_name: string;
  message?: string;
  detail?: string;
  sound_label?: string;
  emote_glyph?: string;
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
  created_at: string;
  completed_at?: string;
  stopped_at?: string;
  channel_sequence?: number;
  cast?: { character_id: string; voice_profile_id: string };
  delivery?: {
    attempt_id?: string;
    started_at?: string;
    completed_at?: string;
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
};
export const SCOPE: Record<string, string> = {
  all: 'Tout Raptoru',
  tts: 'TTS',
  soundboard: 'Soundboard',
  bonk: 'Bonk',
  raffle: 'Tombola',
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
export const pending = (i: ModItem) => i.review_status === 'pending';
export const money = (i: ModItem) => {
  const c = i.simulated_cost ?? i.cost ?? 0;
  return Number(c) === 0 && i.module === 'raffle'
    ? 'gratuit'
    : `${fmt(c)} ${i.payment_method === 'credits' ? 'cr' : 'J'}`;
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
};

export async function modGet<T = Record<string, unknown>>(path: string) {
  const res = await fetch(`/api/lab/${path}`, { headers: STUDIO_HEADERS });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(res.status, String(body.error ?? res.status), body);
  return body as T;
}
/** Une commande du Core. `key` : l'intention (le même clic rejoué n'applique l'argent qu'une fois). */
export async function modAct(command: Record<string, unknown>, key?: string) {
  const res = await fetch('/api/lab/actions', {
    method: 'POST',
    headers: STUDIO_HEADERS,
    body: JSON.stringify(key ? { command, idempotency_key: key } : { command }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(res.status, String(body.error ?? res.status), body);
  return body;
}

const listeners = new Set<() => void>();
/** Une page s'abonne pour relire son état dès qu'une action de modération aboutit. */
export function onModChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** Lance la commande, dit le résultat, prévient les pages ouvertes. */
export async function act(
  btn: HTMLElement | null,
  command: Record<string, unknown>,
  done: string,
  key?: string,
) {
  const ok = await run(btn, () => modAct(command, key), done, MOD_ERRORS);
  for (const l of listeners) l();
  return ok;
}

// --- Le verbe d'une ligne ---------------------------------------------------------------------------------------------

/** « Passer et rembourser » / « Passer sans rembourser » : jamais une croix ambiguë. */
export function removeMenu(anchor: HTMLElement, i: ModItem, module: ModModule) {
  const p = isPlaying(i);
  const verb = p ? 'Couper' : 'Retirer';
  const remove = (refund: boolean) => {
    const command =
      p && module === 'tts'
        ? { action: 'stop_current', module: 'tts', refund }
        : {
            action: 'cancel',
            module,
            interaction_id: i.interaction_id,
            refund,
          };
    void act(
      anchor,
      command,
      `${p ? 'Coupé' : 'Retiré'} ${refund ? 'et remboursé' : 'sans remboursement'} · ${i.viewer_display_name}`,
    );
  };
  menu(anchor, `${esc(i.viewer_display_name)} · ${esc(money(i))}`, [
    pending(i) && {
      label: 'Laisser passer',
      icon: 'check',
      kind: 'ok',
      run: () =>
        void act(
          anchor,
          { action: 'allow', module: 'tts', interaction_id: i.interaction_id },
          `Demande de ${i.viewer_display_name} laissée passer`,
        ),
    },
    { label: `${verb} et rembourser`, icon: 'refund', run: () => remove(true) },
    {
      label: `${verb} sans rembourser`,
      icon: p ? 'stop' : 'trash',
      kind: 'bad',
      run: () => remove(false),
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

/** Blocage complet : portée, durée, raison. Tout Raptoru ou plus d'une heure : le Core exige « Sanctions sensibles ». */
export function blockForm(
  anchor: HTMLElement,
  vid: string,
  name: string,
  m: string,
) {
  const s = { module: SCOPE[m] ? m : 'tts', d: '300', custom: 10 };
  const DUR = [
    ['60', '1 min'],
    ['300', '5 min'],
    ['3600', '1 h'],
    ['forever', 'Sans fin'],
    ['custom', 'Autre'],
  ] as const;
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
    ${s.d === 'custom' ? fld('data-bc', s.custom, 'min', 'min="1" max="43200"') : ''}
    <textarea class="d-area" data-br style="min-height:48px" placeholder="Raison (équipe seulement, facultatif)" maxlength="200"></textarea>
    <p class="d-note">Aucune sanction Twitch : le viewer perd seulement l’accès à l’interaction.</p>
    <button type="button" class="d-btn pri" data-go>Bloquer</button>`;
  const el = pop(anchor, body(), undefined, { cls: 'd-form' });
  const draw = () => {
    const reason =
      el.querySelector<HTMLTextAreaElement>('[data-br]')?.value ?? '';
    el.innerHTML = body();
    el.querySelector<HTMLTextAreaElement>('[data-br]')!.value = reason;
  };
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-bc]')) s.custom = Number(t.value) || 1;
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const bm = t.closest<HTMLElement>('[data-bm]')?.dataset.bm;
    const bd = t.closest<HTMLElement>('[data-bd]')?.dataset.bd;
    if (bm) s.module = bm;
    if (bd) s.d = bd;
    if (bm || bd) return draw();
    if (!t.closest('[data-go]')) return;
    const secs =
      s.d === 'forever' ? null : s.d === 'custom' ? s.custom * 60 : Number(s.d);
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
        duration_s: secs,
        reason,
      },
      `${name} · ${SCOPE[s.module]} bloqué${secs ? ` ${dur(secs)}` : ''}`,
    );
  });
}

function cooldownForm(
  anchor: HTMLElement,
  vid: string,
  name: string,
  m: string,
) {
  const s = {
    module: ['tts', 'soundboard', 'bonk'].includes(m) ? m : 'tts',
    d: 300,
    span: '3600',
  };
  const body = () => `<h3>Cooldown de ${esc(name)}</h3>
    <div class="d-lb">Module</div>${seg(
      'data-cm',
      [
        ['tts', 'TTS'],
        ['soundboard', 'Sons'],
        ['bonk', 'Bonk'],
      ],
      s.module,
      'block',
    )}
    <div class="d-lb">Délai imposé</div>${seg(
      'data-cd',
      [
        ['30', '30 s'],
        ['60', '1 min'],
        ['180', '3 min'],
        ['300', '5 min'],
      ],
      String(s.d),
      'block',
    )}
    <div class="d-lb">Pendant</div>${seg(
      'data-cs',
      [
        ['900', '15 min'],
        ['3600', '1 h'],
        ['7200', '2 h'],
        ['stream', 'Ce stream'],
      ],
      s.span,
      'block',
    )}
    <button type="button" class="d-btn pri" data-go>Appliquer</button>`;
  const el = pop(anchor, body(), undefined, { cls: 'd-form' });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const cm = t.closest<HTMLElement>('[data-cm]')?.dataset.cm;
    const cd = t.closest<HTMLElement>('[data-cd]')?.dataset.cd;
    const cs = t.closest<HTMLElement>('[data-cs]')?.dataset.cs;
    if (cm) s.module = cm;
    if (cd) s.d = Number(cd);
    if (cs) s.span = cs;
    if (cm || cd || cs) {
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
        delay_s: s.d,
        span: s.span === 'stream' ? 'stream' : Number(s.span),
      },
      `${name} · cooldown ${SCOPE[s.module]} ${dur(s.d)}`,
    );
  });
}

function walletForm(
  anchor: HTMLElement,
  vid: string,
  name: string,
  sign: 1 | -1,
) {
  const key = crypto.randomUUID();
  const s = { cur: 'tokens', amount: 500 };
  const CUR: Record<string, string> = {
    tokens: 'Jetons',
    credits_tts: 'Crédits TTS',
    credits_soundboard: 'Crédits Sons',
  };
  const body = () => `<h3>${sign > 0 ? 'Créditer' : 'Débiter'} ${esc(name)}</h3>
    ${seg('data-wc', Object.entries(CUR), s.cur, 'block')}
    ${fld('data-wa', s.amount, '', 'min="1"')}
    <textarea class="d-area" data-wr style="min-height:48px" placeholder="Raison (ex. bug Soundboard)" maxlength="200"></textarea>
    <p class="d-note">Mouvement réel sur le Wallet de ce profil, tracé dans l’audit.</p>
    <button type="button" class="d-btn pri" data-go>${sign > 0 ? 'Créditer' : 'Débiter'}</button>`;
  const el = pop(anchor, body(), undefined, { cls: 'd-form' });
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-wa]'))
      s.amount = Math.abs(Math.round(Number(t.value) || 0));
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
    const reason =
      el.querySelector<HTMLTextAreaElement>('[data-wr]')?.value.trim() ||
      undefined;
    el.hidePopover();
    void act(
      anchor,
      {
        action: 'wallet_adjust',
        viewer_id: vid,
        currency: s.cur,
        delta: sign * s.amount,
        reason,
      },
      `${sign > 0 ? '+' : '−'} ${fmt(s.amount)} ${CUR[s.cur]} · ${name}`,
      // Un autre montant ou une autre monnaie est une autre intention : une autre clé.
      `${key}:${s.cur}:${sign * s.amount}`,
    );
  });
}

function noteForm(anchor: HTMLElement, vid: string) {
  const el = pop(
    anchor,
    `<h3>Note interne</h3><textarea class="d-area" data-n maxlength="140" placeholder="Visible par l’équipe seulement"></textarea><button type="button" class="d-btn pri" data-go>Ajouter</button>`,
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

// --- Détail d'une demande ---------------------------------------------------------------------------------------------

const WHAT: Record<ModModule, (i: ModItem) => string> = {
  tts: () => 'Message TTS',
  soundboard: (i) => `Son « ${i.sound_label ?? i.detail ?? ''} »`,
  bonk: (i) => `Bonk ${i.emote_glyph ?? ''}`,
  raffle: () => 'Ticket tombola',
};
const refundable = (i: ModItem, m: ModModule) =>
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
      <dt>Demandé</dt><dd>${hhmm(i.created_at)} · ${esc(ago(i.created_at))}</dd>
      ${endBy ? `<dt>Fin</dt><dd>${esc(actorName(endBy.actor))}, ${i.refund_status === 'refunded' ? 'remboursé' : 'sans remboursement'}</dd>` : ''}
      ${extra}
    </dl>
    <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv">
      <dt>Statut</dt><dd>${esc(i.status)}</dd><dt>Référence</dt><dd>${esc(i.interaction_id)}</dd><dt>Viewer</dt><dd>${esc(i.viewer_id)}</dd>
      <dt>Erreur</dt><dd>${esc(err ?? '—')}</dd><dt>Créée</dt><dd>${esc(i.created_at)}</dd><dt>Finie</dt><dd>${esc(i.completed_at ?? i.delivery?.completed_at ?? '—')}</dd>
    </dl></details>`;
}
function itemFoot(i: ModItem, m: ModModule) {
  const live = isLive(i);
  const p = isPlaying(i);
  return `${pending(i) ? `<button type="button" class="d-btn pri sm" data-allow>${ic('check')}Laisser passer</button>` : ''}
    ${live && m !== 'raffle' && m !== 'bonk' ? `<button type="button" class="d-btn sm" data-rm="1">${ic('refund')}${p ? 'Couper et rembourser' : 'Retirer et rembourser'}</button><button type="button" class="d-btn bad sm" data-rm="0">${ic(p ? 'stop' : 'trash')}${p ? 'Couper sans rembourser' : 'Retirer sans rembourser'}</button>` : ''}
    ${refundable(i, m) ? `<button type="button" class="d-btn sm" data-refund>${ic('refund')}Rembourser</button>` : ''}
    <button type="button" class="d-btn ghost sm" data-block>${ic('ban')}Bloquer${ic('down')}</button>`;
}

let openedItem: { refresh(): void } | null = null;
/** Relire le détail ouvert (une page l'appelle à chaque relevé). */
export const refreshOpenItem = () => openedItem?.refresh();

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
  const paint = (d: Drawer) =>
    d.set({
      kicker: `${MODS[module].label} · ${ago(i.created_at)}`,
      title: WHAT[module](i),
      body: itemHtml(i, module, extra(i)),
      foot: itemFoot(i, module),
    });
  const d = drawer({
    kicker: '',
    title: '',
    body: '',
    onClose: () => {
      openedItem = null;
    },
  });
  paint(d);
  const reload = async () => {
    const full = await modGet<ModItem>(
      `interactions/${i.interaction_id}`,
    ).catch(() => null);
    if (full && d.el.open) {
      i = { ...i, ...full, module };
      paint(d);
    }
  };
  void reload();
  openedItem = { refresh: () => void reload() };
  d.el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-viewer]')) return openViewer(i.viewer_id);
    const b = t.closest<HTMLElement>('button');
    if (t.closest('[data-allow]'))
      return void act(
        b,
        { action: 'allow', module: 'tts', interaction_id: i.interaction_id },
        `Demande de ${i.viewer_display_name} laissée passer`,
      ).then(reload);
    const rm = t.closest<HTMLElement>('[data-rm]')?.dataset.rm;
    if (rm !== undefined) {
      const refund = rm === '1';
      return void act(
        b,
        isPlaying(i) && module === 'tts'
          ? { action: 'stop_current', module: 'tts', refund }
          : {
              action: 'cancel',
              module,
              interaction_id: i.interaction_id,
              refund,
            },
        `${isPlaying(i) ? 'Coupé' : 'Retiré'} ${refund ? 'et remboursé' : 'sans remboursement'} · ${i.viewer_display_name}`,
      ).then(reload);
    }
    if (t.closest('[data-refund]'))
      return void act(
        b,
        { action: 'refund', module, interaction_id: i.interaction_id },
        'Remboursé',
      ).then(reload);
    if (t.closest('[data-block]') && b)
      blockMenu(b, i.viewer_id, i.viewer_display_name, module);
  });
}

// --- Fiche d'un viewer ---------------------------------------------------------------------------------------------------

interface Card {
  display_name: string;
  role: string;
  staff?: boolean;
  first_seen?: string;
  today_count?: number;
  wallet?: {
    tokens?: number;
    credits_tts?: number | null;
    credits_soundboard?: number | null;
  };
  notes?: { id: number; text: string; author?: string; created_at?: string }[];
  restrictions?: {
    kind: 'block' | 'cooldown';
    module: string;
    until: string | null;
    reason?: string;
    delay_s?: number;
  }[];
  activity?: (ModItem & { module: ModModule })[];
  wallet_ledger?: {
    id: number;
    label: string;
    amount: number;
    currency: string;
    created_at: string;
    visible_in_moderation_activity?: boolean;
  }[];
  raffle?: { joined: boolean; removed?: boolean; source?: string } | null;
  grants?: string[];
}
const ROLE: Record<string, string> = {
  broadcaster: 'Streamer',
  supermod: 'Supermod',
  moderator: 'Mod',
  viewer: 'Viewer',
};
const CUR: Record<string, string> = {
  tokens: 'J',
  credits_tts: 'cr TTS',
  credits_soundboard: 'cr Sons',
};

function cardHtml(id: string, v: Card) {
  const ls = v.restrictions ?? [];
  const led = (v.wallet_ledger ?? [])
    .filter((e) => e.visible_in_moderation_activity !== false)
    .slice(0, 6);
  const recent = (v.activity ?? []).filter((a) => !isLive(a)).slice(0, 6);
  return `<div class="m-card">${pp(v.display_name, 48)}<div><b>${esc(v.display_name)}</b><small>${esc(ROLE[v.role] ?? 'Viewer')}${ls.length ? ` · ${ls.length} restriction${ls.length > 1 ? 's' : ''}` : ''}</small></div></div>
    <div class="m-wallet"><span><b class="d-num">${fmt(v.wallet?.tokens)}</b><small>Jetons</small></span><span><b class="d-num">${v.wallet?.credits_tts == null ? '—' : fmt(v.wallet.credits_tts)}</b><small>Crédits TTS</small></span><span><b class="d-num">${v.wallet?.credits_soundboard == null ? '—' : fmt(v.wallet.credits_soundboard)}</b><small>Crédits Sons</small></span></div>
    ${
      ls.length
        ? `<h4 class="d-lb m-h">Restrictions</h4>${ls
            .map(
              (l) =>
                `<div class="m-line">${ic(l.kind === 'block' ? 'ban' : 'clock')}<span>${l.kind === 'block' ? `Bloqué · ${esc(SCOPE[l.module] ?? l.module)}` : `Cooldown ${esc(SCOPE[l.module] ?? l.module)} · ${dur(l.delay_s ?? 0)}`}${l.reason ? ` · ${esc(l.reason)}` : ''}<small>${l.until ? `jusqu’à ${hhmm(l.until)}` : 'jusqu’au déblocage'}</small></span><button type="button" class="d-btn ghost sm" data-lift="${esc(l.kind)}:${esc(l.module)}">Retirer</button></div>`,
            )
            .join('')}`
        : ''
    }
    ${v.raffle?.joined ? `<div class="m-line">${ic('ticket')}<span>Participe à la manche en cours</span><button type="button" class="d-btn ghost sm" data-raffle-out>Retirer</button></div>` : ''}
    ${v.notes?.length ? `<h4 class="d-lb m-h">Notes de l’équipe</h4>${v.notes.map((n) => `<p class="m-note">${esc(n.text)}</p>`).join('')}` : ''}
    <h4 class="d-lb m-h">Activité récente</h4>
    ${
      recent.length
        ? recent
            .map(
              (a) =>
                `<button type="button" class="m-line m-rowbtn" data-ix="${esc(a.interaction_id)}"><span class="d-tag off">${esc(MODS[a.module]?.label ?? a.module)}</span><span class="m-cut">${esc(a.detail ?? a.message ?? a.sound_label ?? '')}<small>${esc(statusText(a))} · ${hhmm(a.created_at)}</small></span></button>`,
            )
            .join('')
        : '<p class="d-note">Rien aujourd’hui.</p>'
    }
    <h4 class="d-lb m-h">Mouvements</h4>
    ${
      led.length
        ? led
            .map(
              (e) =>
                `<div class="m-line"><span class="m-cut">${esc(e.label)}<small>${hhmm(e.created_at)}</small></span><b class="d-num ${e.amount > 0 ? 'm-plus' : ''}">${e.amount > 0 ? '+' : '−'} ${fmt(Math.abs(e.amount))} ${esc(CUR[e.currency] ?? e.currency)}</b></div>`,
            )
            .join('')
        : '<p class="d-note">Aucun mouvement.</p>'
    }
    <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv"><dt>Identifiant</dt><dd>${esc(id)}</dd><dt>Premier passage</dt><dd>${v.first_seen ? new Date(v.first_seen).toLocaleDateString('fr-FR') : '—'}</dd><dt>Aujourd’hui</dt><dd>${fmt(v.today_count)} interaction(s)</dd></dl></details>`;
}

/** La fiche d'un viewer : solde, restrictions, notes, activité, et toutes les sanctions possibles. */
export function openViewer(id: string) {
  let card: Card | null = null;
  const name = () => card?.display_name ?? id;
  const d = drawer({
    kicker: 'Viewer',
    title: id,
    body: '<div class="d-skel" style="height:220px"></div>',
  });
  const foot = () =>
    `<button type="button" class="d-btn sm" data-b ${card?.staff ? 'disabled title="Membre de l’équipe"' : ''}>${ic('ban')}Bloquer</button><button type="button" class="d-btn sm" data-c ${card?.staff ? 'disabled' : ''}>${ic('clock')}Cooldown</button><button type="button" class="d-btn ghost sm" data-w="1">${ic('plus')}Créditer</button><button type="button" class="d-btn ghost sm" data-w="-1">${ic('minus')}Débiter</button><button type="button" class="d-btn ghost sm" data-n>${ic('note')}Note</button>`;
  const load = async () => {
    try {
      card = await modGet<Card>(`viewers/${id}`);
    } catch {
      return d.set({
        body: '<p class="d-note bad">Fiche illisible : Core injoignable.</p>',
      });
    }
    if (d.el.open)
      d.set({
        kicker: ROLE[card.role] ?? 'Viewer',
        title: card.display_name,
        body: cardHtml(id, card),
        foot: foot(),
      });
  };
  void load();
  const off = onModChange(() => void load());
  d.el.addEventListener('close', () => off());
  d.el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b || !card) return;
    if (b.matches('[data-b]')) blockForm(b, id, name(), 'tts');
    if (b.matches('[data-c]')) cooldownForm(b, id, name(), 'tts');
    if (b.dataset.w) walletForm(b, id, name(), Number(b.dataset.w) as 1 | -1);
    if (b.matches('[data-n]')) noteForm(b, id);
    if (b.dataset.lift) {
      const [kind, module] = b.dataset.lift.split(':');
      void act(
        b,
        kind === 'block'
          ? { action: 'unblock_viewer', viewer_id: id, module }
          : { action: 'clear_cooldown', viewer_id: id, module },
        `Restriction retirée · ${name()}`,
      );
    }
    if (b.matches('[data-raffle-out]'))
      void act(
        b,
        {
          action: 'raffle',
          command: {
            action: 'remove_participant',
            viewer_id: id,
            reason: 'retiré depuis Studio',
          },
        },
        `${name()} retiré de la manche`,
      );
    if (b.dataset.ix) {
      const a = card.activity?.find((x) => x.interaction_id === b.dataset.ix);
      if (a)
        openItem(
          { ...a, message: a.module === 'tts' ? a.detail : undefined },
          a.module,
        );
    }
  });
}

/** Purger une file : le remboursement se choisit, il n'est jamais implicite. */
export async function purge(
  btn: HTMLElement | null,
  m: ModModule,
  items: ModItem[],
) {
  const pick = await choiceBox({
    title: `Vider la file ${MODS[m].label}`,
    body: `${items.length} ${items.length > 1 ? MODS[m].units : MODS[m].unit} retiré${items.length > 1 ? 's' : ''} d’un coup.`,
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
  );
}

/** Ouvert, en pause, désactivé : les demandes en attente se gardent par défaut. */
export async function setModuleState(
  btn: HTMLElement | null,
  m: ModModule,
  state: 'active' | 'paused' | 'disabled',
  waiting: ModItem[] = [],
) {
  let keep = 'keep';
  if (state !== 'active' && waiting.length) {
    const pick = await choiceBox({
      title:
        state === 'paused'
          ? `Mettre ${MODS[m].label} en pause`
          : `Désactiver ${MODS[m].label}`,
      body: `${waiting.length} ${waiting.length > 1 ? MODS[m].units : MODS[m].unit} en attente.`,
      choices: [
        {
          v: 'keep',
          label: 'Garder la file',
          sub: 'Elle reprendra au retour.',
        },
        { v: 'cancel_refund', label: 'Annuler et rembourser' },
        { v: 'cancel', label: 'Annuler sans rembourser' },
      ],
      yes: state === 'paused' ? 'Mettre en pause' : 'Désactiver',
    });
    if (!pick) return false;
    keep = pick.v;
  }
  const label = {
    active: 'ouvert aux viewers',
    paused: 'en pause',
    disabled: 'désactivé',
  }[state];
  return act(
    btn,
    { action: 'module_state', module: m, state, waiting: keep },
    `${MODS[m].label} ${label}`,
  );
}

export { toast };
