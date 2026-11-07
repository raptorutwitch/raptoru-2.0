import {
  confirmBox,
  copy,
  esc,
  grp,
  ic,
  run,
  seg,
  sw,
  toast,
  type Page,
} from '../ds/ds.js';
import {
  ApiError,
  getJson,
  labOnMainCore,
  postJson,
  STUDIO_HEADERS,
  tryGetJson,
} from '../http.js';
import type { AlertsState, BallonPools } from './alerts-model.js';

// Alertes : le panneau Sources. D'où viennent les alertes (Twitch, StreamElements), où elles partent (source OBS, dock), avec quels
// fichiers (médias) et quel profil. Chaque source coupée dit quoi faire. Le mode ACTIF demande une confirmation : les vrais
// événements seraient alors joués par la source OBS de ce Studio.

export interface SeJournalEntry {
  at: string;
  topic: string;
  tip_id: string | null;
  name: string | null;
  amount: string | null;
  currency: string | null;
  message: string | null;
  status: string | null;
  approved: string | null;
  decision: 'test' | 'queued' | 'duplicate' | 'ignored' | 'error';
  detail: string;
}

export interface SeStatus {
  mode: 'off' | 'test' | 'active';
  token: { present: boolean; type: string | null };
  state: string;
  state_label: string;
  room: string | null;
  topics: { topic: string; subscribed: boolean; error: string | null }[];
  error: string | null;
  last_event: SeJournalEntry | null;
  journal: SeJournalEntry[];
  environment?: 'lab' | 'production';
  resumed_from_active?: boolean;
}

interface SeBridge {
  connect(
    tokenType: string,
    token: string,
    room: string,
  ): Promise<{ ok: boolean; error?: string; remembered?: boolean }>;
  forget(): Promise<unknown>;
}

export interface TwitchState {
  mode: 'off' | 'test' | 'active';
  ingestion_enabled: boolean;
  ingestion_running: boolean;
  token_login: string | null;
  follow_scope: boolean;
  environment?: 'lab' | 'production';
  available?: boolean;
  resumed_from_active?: boolean;
  managed_by?: 'production_bot';
  bot?: {
    mode: 'off' | 'test' | 'active';
    subscriptions: string[];
    refused: string[];
    pending: number;
    reported_at: string;
    age_ms: number;
  } | null;
  last_twitch_event_at?: string | null;
  max_age_ms?: number | null;
}

export interface DockInfo {
  available: boolean;
  reason: string | null;
  url: string | null;
  clients?: number;
  feed?: { state: string; error: string | null };
}

export interface MediaEntry {
  name: string;
  available: boolean;
  bytes?: number;
  source?: string;
  variants?: string[];
  found_in?: string[];
}
export interface MediaOrigin {
  id: string;
  label: string;
  path: string;
  reserve: boolean;
  count: number;
}
export interface MediaView {
  can_import: boolean;
  store_dir?: string;
  origins: MediaOrigin[];
  media: MediaEntry[];
}

interface HalloweenAdmin {
  settings: {
    rules: {
      halloween_alerts?: boolean;
      halloween_ballon?: BallonPools;
    };
  };
}

const note = (t: string, bad = false) =>
  `<p class="d-note${bad ? ' bad' : ''}">${t}</p>`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

// --- Twitch ----------------------------------------------------------------------------------------------------------------

/** Le bouton Actif dit quel monde il alimente. */
export const activeLabel = (env?: string) =>
  env === 'production' ? 'Actif · Production' : 'Actif · Lab';

/** Profil Production : le dernier rapport du bot de production au Core. */
export function productionStatusView(s: TwitchState) {
  const b = s.bot;
  const fresh =
    s.max_age_ms == null
      ? note(
          'Fraîcheur des animations : désactivée (toutes les alertes sont jouées, même en retard).',
        )
      : note(
          `Fraîcheur des animations : ${Math.round(s.max_age_ms / 1000)} s (plus ancienne : gardée dans l’historique, non jouée ; les gains restent versés).`,
        );
  const last = s.last_twitch_event_at
    ? note(
        `Dernier événement Twitch réel reçu : ${esc(when(s.last_twitch_event_at))}.`,
      )
    : note('Aucun événement Twitch réel reçu.');
  if (!b)
    return `${note('Indisponible : aucun rapport du bot de production depuis le démarrage du serveur (bot arrêté, alertes et jeux du chat OFF, ou bot non mis à jour).', true)}${last}${fresh}`;
  const stale = b.age_ms > 3 * 60_000;
  const state = stale
    ? note(
        `Bot de production sans nouvelles depuis ${Math.round(b.age_ms / 60_000)} min (dernier rapport ${esc(when(b.reported_at))}).`,
        true,
      )
    : b.mode === 'active'
      ? note(
          'Réception active : les vrais événements sont mis en file et joués par la source OBS de ce Studio.',
        )
      : b.mode === 'test'
        ? note(
            'Réception en TEST : événements reçus et journalisés par le bot, jamais mis en file.',
          )
        : note(
            'Réception inactive (OFF sur le bot de production) : aucun événement Twitch réel n’arrive.',
          );
  return [
    state,
    note('Mode réglé sur le bot de production, pas depuis Studio.'),
    b.subscriptions.length
      ? note(`Abonnements : ${esc(b.subscriptions.join(', '))}.`)
      : '',
    b.refused.length
      ? note(`Refusés par Twitch : ${esc(b.refused.join(', '))}.`, true)
      : '',
    b.subscriptions.includes('channel.follow')
      ? note('Follows : reçus.')
      : note(
          'Follows : non reçus (le bot n’a pas le droit de lire les follows).',
        ),
    b.pending
      ? note(
          `${b.pending} alerte(s) en attente dans le bot (serveur injoignable ?) : renvoyées automatiquement, jamais en double.`,
          true,
        )
      : '',
    last,
    fresh,
  ].join('');
}

const TWITCH_HINT: Record<TwitchState['mode'], string> = {
  off: 'Off : aucun abonnement aux événements d’alerte, rien n’est lu.',
  test: 'Test : reçus et notés dans le journal, jamais mis en file. Rien ne s’affiche dans OBS.',
  active:
    'Actif : mis en file. La source OBS de ce Studio les joue, y compris dans une scène de live.',
};

/** Les lignes d'état sous le choix du mode. */
export function twitchStatusView(s: TwitchState | null, error: string | null) {
  if (error) return note(esc(error), true);
  if (!s) return note('Chargement…');
  if (s.managed_by === 'production_bot') return productionStatusView(s);
  if (s.available === false)
    return note(
      'Indisponible dans ce profil : le bot Twitch de production n’est pas encore raccordé aux alertes (aucun événement Twitch réel n’arrive ici).',
      true,
    );
  return [
    s.resumed_from_active
      ? note(
          'Actif n’est jamais repris automatiquement au démarrage de Studio : mode Test (observation). Choisis Actif à nouveau pour jouer les vrais événements.',
          true,
        )
      : '',
    s.ingestion_enabled
      ? s.ingestion_running
        ? note(
            `Lecture de Twitch activée (compte ${esc(s.token_login ?? '?')}).`,
          )
        : note(
            'Lecture de Twitch activée mais arrêtée : voir la page Simulation.',
            true,
          )
      : note(
          'Lecture de Twitch coupée (page Simulation) : aucun événement réel n’arrive, quel que soit le mode.',
        ),
    s.follow_scope
      ? note('Follows : reçus.')
      : note(
          'Follows : non reçus (le bot n’a pas le droit de lire les follows).',
        ),
  ].join('');
}

// --- StreamElements ----------------------------------------------------------------------------------------------------------

const DECISION: Record<SeJournalEntry['decision'], string> = {
  test: 'TEST · reçu',
  queued: 'Mis en file',
  duplicate: 'Doublon',
  ignored: 'Ignoré',
  error: 'Erreur',
};
const time = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Une ligne du journal : tout ce qui vient du donateur est échappé. */
export function seEntryView(e: SeJournalEntry) {
  const amount =
    e.amount !== null
      ? `${esc(e.amount)} ${esc(e.currency ?? '')}`
      : 'montant inconnu';
  return `<div class="alr-j ${e.decision === 'error' ? 'bad' : ''}"><div class="alr-j__t"><b>${esc(DECISION[e.decision])}</b><span>${esc(time(e.at))}</span></div>
    <div>${e.name !== null ? esc(e.name) : '<i>sans nom</i>'} · ${amount}</div>
    ${e.message ? `<div class="alr-j__m">${esc(e.message)}</div>` : ''}
    ${e.detail ? `<small>${esc(e.detail)}</small>` : ''}
    <small>${esc(e.topic)}${e.status ? ` · ${esc(e.status)}` : ''}${e.approved ? ` · ${esc(e.approved)}` : ''}${e.tip_id ? ` · ${esc(e.tip_id)}` : ''}</small></div>`;
}

/** Le bloc d'état. */
export function seStatusView(s: SeStatus | null, error: string | null) {
  if (error) return note(esc(error), true);
  if (!s) return note('Chargement…');
  const ok = s.state === 'connected';
  const bad = s.state === 'auth_failed' || s.state === 'reconnecting';
  const topics = s.topics
    .map(
      (t) =>
        `${esc(t.topic)} : ${t.subscribed ? 'abonné' : t.error ? `refusé (${esc(t.error)})` : 'en attente'}`,
    )
    .join(' · ');
  const last = s.last_event
    ? note(
        `Dernier don reçu : ${esc(time(s.last_event.at))}, ${esc(s.last_event.name ?? 'sans nom')}, ${esc(s.last_event.amount ?? '?')} ${esc(s.last_event.currency ?? '')} → ${esc(DECISION[s.last_event.decision])}.`,
      )
    : note('Aucun don reçu pour l’instant.');
  return [
    s.resumed_from_active
      ? note(
          'Profil Lab : Actif n’est pas repris au démarrage de Studio, mode Test (observation). Choisis Actif à nouveau pour jouer les vrais événements. En profil Production, Ouvert est repris.',
          true,
        )
      : '',
    note(
      `Compte : ${s.token.present ? `jeton enregistré (${s.token.type === 'apikey' ? 'Overlay Token' : 'JWT'})` : 'non connecté'}${s.room ? ` · chaîne ${esc(s.room)}` : ''}`,
    ),
    `<p class="d-note${bad ? ' bad' : ok ? ' alr-ok' : ''}">${esc(s.state_label)}</p>`,
    s.mode !== 'off' && s.token.present ? note(topics) : '',
    s.error ? note(esc(s.error), true) : '',
    last,
  ].join('');
}

const SE_HINT: Record<SeStatus['mode'], string> = {
  off: 'Off : aucune connexion à StreamElements.',
  test: 'Test : chaque don reçu est noté dans le journal, jamais mis en file, rien dans OBS.',
  active:
    'Actif : les dons confirmés sont mis en file (famille Don). La source OBS de ce Studio les joue.',
};

// --- Source OBS, dock, médias -----------------------------------------------------------------------------------------------

/** La ligne de la source OBS. */
export function sourceView(s: Pick<AlertsState, 'source'> | null) {
  const src = s?.source;
  if (!src) return '';
  if (!src.seen)
    return src.ago_ms === null
      ? note(
          'Aucune source OBS connectée depuis le démarrage de Studio. Ajoute cette adresse en source navigateur 1920 × 1080.',
          true,
        )
      : note(
          `Source OBS silencieuse depuis ${Math.round(src.ago_ms / 1000)} s (OBS fermé, source masquée avec « Arrêter la source quand elle n’est pas visible », ou adresse différente).`,
          true,
        );
  return src.current
    ? '<p class="d-note alr-ok">Source OBS connectée, à jour.</p>'
    : note(
        'Source OBS connectée, ancienne version : elle se rechargera seule dès qu’aucune alerte ne joue.',
      );
}

const FEED: Record<string, string> = {
  live: 'Flux en direct',
  connecting: 'Connexion…',
  stale: 'Serveur injoignable (dernière version affichée)',
  idle: 'En pause (aucun dock ouvert)',
};

/** Le dock OBS : l'adresse porte la clé, masquée par défaut. */
export function dockPanelView(
  info: DockInfo | null,
  error: string | null,
  shown = false,
) {
  if (error) return note(`Dock indisponible : ${esc(error)}`, true);
  if (!info) return note('Chargement…');
  if (!info.available)
    return note(
      `Dock indisponible${info.reason === 'port_in_use' ? ' : son port est déjà utilisé (fermer l’autre Studio ou régler DOCK_PORT)' : info.reason === 'no_core' ? ' : aucun serveur pour ce profil' : ''}.`,
      true,
    );
  const masked = info.url ? info.url.replace(/#key=.*/, '#key=••••••••') : '';
  return `<div class="alr-url"><label class="d-fld"><input type="text" readonly data-dock-url value="${esc(shown ? info.url : masked)}" aria-label="Adresse du dock OBS"></label><button type="button" class="d-btn sm" data-s="dock-copy">${ic('copy')}Copier</button></div>
    <div class="alr-url"><button type="button" class="d-btn ghost sm" data-s="dock-show">${shown ? 'Masquer' : 'Afficher'}</button><button type="button" class="d-btn ghost sm" data-s="dock-key">Nouvelle clé</button></div>
    ${note('OBS → Docks → Docks de navigateur personnalisés : nom « Raptoru », adresse collée. Le dock affiche les événements reçus et rejoue une alerte sur demande (animation seulement, jamais l’événement). Il fonctionne tant que Studio est ouvert.')}
    ${note(`${esc(FEED[info.feed?.state ?? ''] ?? 'État inconnu')}${info.feed?.error ? ` (${esc(info.feed.error)})` : ''} · ${info.clients ?? 0} dock(s) ouvert(s)`)}`;
}

type ImportLine = {
  name: string;
  result: 'copied' | 'unchanged' | 'missing' | 'corrupt';
};
export interface ImportReport {
  lines: ImportLine[];
  where: string;
}

const whyMissing = (x: MediaEntry) => {
  if (x.found_in?.length) return `Trouvé : ${x.found_in.join(', ')}.`;
  if (x.name === 'Raid Titan.webm')
    return 'Absent des dossiers : il se fabrique depuis « Titan Avi 4.avi ». Utilise la copie du Studio installé, ou l’outil d’import.';
  return 'Introuvable ici. Indique le dossier qui le contient, ou remplace-le depuis l’aperçu.';
};

const reportView = (r: ImportReport | null) => {
  if (!r) return '';
  const n = (k: ImportLine['result']) =>
    r.lines.filter((x) => x.result === k).length;
  const bad = r.lines.filter(
    (x) => x.result === 'missing' || x.result === 'corrupt',
  );
  const parts = [
    `${n('copied')} copié(s)`,
    `${n('unchanged')} déjà là`,
    ...(n('missing') ? [`${n('missing')} absent(s)`] : []),
    ...(n('corrupt') ? [`${n('corrupt')} refusé(s)`] : []),
  ];
  return `<p class="d-note ${bad.length ? 'bad' : 'alr-ok'}">${esc(r.where)} : ${parts.join(', ')}.</p>${
    n('corrupt')
      ? note(
          'Refusé : le fichier ne correspond plus à son empreinte enregistrée. Il n’a pas été copié.',
          true,
        )
      : ''
  }`;
};

/** Les médias : ce que le catalogue attend, où chaque fichier a été trouvé sur ce PC, ce qui manque et quoi faire. */
export function mediaPanelView(
  m: MediaView | null,
  fallback: AlertsState['media'],
  folder: string,
  report: ImportReport | null,
) {
  const list: MediaEntry[] = m?.media ?? fallback;
  const missing = list.filter((x) => !x.available);
  const head = `<p class="d-note${missing.length ? ' bad' : ' alr-ok'}">${list.length - missing.length} sur ${list.length} médias présents.</p>`;
  if (!m?.can_import) {
    const names = missing.length
      ? `<details class="d-acc" ${missing.length < 6 ? 'open' : ''}><summary>${missing.length} média(s) manquant(s)</summary><ul class="alr-miss-l">${missing.map((x) => `<li>${esc(x.name)}${x.variants?.length ? `<small>${x.variants.length} variante(s)</small>` : ''}</li>`).join('')}</ul></details>`
      : '';
    return `${head}${names}${note('Une alerte dont le média manque n’est pas jouée à moitié : elle est notée en échec, ou la variante habituelle la remplace pour Halloween.')}`;
  }
  const folders = m.origins.filter((o) => !o.reserve);
  const reachable = missing.filter((x) =>
    x.found_in?.some((f) => folders.some((o) => o.label === f)),
  ).length;
  const originRow = (o: MediaOrigin) =>
    `<li class="alr-orig"><div><b>${esc(o.label)}</b><small title="${esc(o.path)}">${o.reserve ? 'Lecture seule, empreinte vérifiée' : esc(o.path)}</small></div><span>${o.count} fichier${o.count > 1 ? 's' : ''}</span><button type="button" class="d-btn sm" data-s="media-origin" data-origin="${esc(o.id)}" ${o.count ? '' : 'disabled'}>Importer</button></li>`;
  const missList = missing.length
    ? `<details class="d-acc" ${missing.length < 6 ? 'open' : ''}><summary>${missing.length} média(s) manquant(s) : raisons</summary><ul class="alr-miss-l col">${missing.map((x) => `<li><b>${esc(x.name)}</b><small>${esc(whyMissing(x))}</small></li>`).join('')}</ul></details>`
    : '';
  const present = list.filter((x) => x.available);
  const okList = present.length
    ? `<details class="d-acc"><summary>${present.length} média(s) dans le Lab</summary><ul class="alr-miss-l">${present.map((x) => `<li>${esc(x.name)}${x.variants?.length ? `<small>${x.variants.length} variante(s)</small>` : ''}</li>`).join('')}</ul></details>`
    : '';
  return `${head}
    ${reachable ? `<div class="alr-url"><button type="button" class="d-btn sm pri" data-s="media-all">${ic('upload')}Importer les ${reachable} fichiers trouvés</button></div>` : ''}
    ${reportView(report)}
    <ul class="alr-origs">${m.origins.map(originRow).join('')}</ul>
    ${missList}${okList}
    <details class="d-acc"><summary>Autre dossier</summary>
      <div class="d-row col" data-k="dossier importer média fichiers"><label class="d-fld alr-line"><input type="text" data-folder value="${esc(folder)}" placeholder="C:\\...\\Version webm" aria-label="Dossier des médias" spellcheck="false"></label></div>
      <div class="alr-url"><button type="button" class="d-btn sm" data-s="media-import">${ic('upload')}Importer ce dossier</button></div>
    </details>
    ${note(`Tes fichiers sont seulement lus, jamais déplacés. Les copies vont dans les données du Lab : ${m.store_dir ?? ''}. Rien ne va en Production.`)}`;
}

// --- Le panneau ----------------------------------------------------------------------------------------------------------------

export interface Sources {
  read(): Promise<void>;
  paint(): void;
  twitch(): TwitchState | null;
  media(): MediaView | null;
  pools(): BallonPools | null;
  /** Changer le mode Twitch depuis l'en-tête. */
  setTwitch(mode: TwitchState['mode']): Promise<void>;
}

export function mountSources(
  p: Page,
  d: {
    state(): AlertsState | null;
    /** Un média vient d'entrer : la page relit le catalogue. */
    onMedia(): void;
    /** Les tirages Ballon ont changé. */
    onRules(): void;
  },
): Sources {
  const bridge = (window as unknown as { raptoruStudio?: { se?: SeBridge } })
    .raptoruStudio?.se;
  let twitch: TwitchState | null = null;
  let twitchError: string | null = null;
  let se: SeStatus | null = null;
  let seError: string | null = null;
  let seOff = false;
  let dock: DockInfo | null = null;
  let dockError: string | null = null;
  let dockShown = false;
  let media: MediaView | null = null;
  let folder = '';
  let report: ImportReport | null = null;
  let seResult = '';
  let admin: HalloweenAdmin | null = null;

  const typing = () =>
    p.panel.body.contains(document.activeElement) &&
    !!document.activeElement?.matches('input,textarea,select');

  function paint() {
    if (typing()) return;
    const st = d.state();
    const url = st?.player_url ?? '';
    const masked = url.replace(/#.*/, '#••••••••');
    const managed = twitch?.managed_by === 'production_bot';
    const twSeg = managed
      ? ''
      : seg(
          'data-tw2',
          [
            ['off', 'Off'],
            ['test', 'Test'],
            ['active', 'Actif'],
          ],
          twitch?.mode ?? 'off',
          'block',
        );
    const seBody = seOff
      ? note(
          'Les dons StreamElements n’existent qu’en Production : le Lab ne contacte jamais StreamElements. Teste un don avec la famille Don.',
        )
      : `${seg(
          'data-se-mode',
          [
            ['off', 'Off'],
            ['test', 'Test'],
            ['active', 'Actif'],
          ],
          se?.mode ?? 'off',
          'block',
        )}${note(esc(SE_HINT[se?.mode ?? 'off']))}${seStatusView(se, seError)}
        <details class="d-acc" data-k="streamelements jeton token connecter compte"><summary>Connecter le compte StreamElements</summary>
        ${
          bridge
            ? `<div class="d-row"><span>Type de jeton</span><label class="d-fld alr-wide"><select data-se-type aria-label="Type de jeton"><option value="jwt">JWT Token</option><option value="apikey">Overlay Token</option></select></label></div>
              <div class="d-row col"><span>Jeton (copié depuis StreamElements)</span><label class="d-fld alr-line"><input type="password" autocomplete="off" spellcheck="false" data-se-token aria-label="Jeton StreamElements"></label></div>
              <div class="d-row col"><span>Identifiant de chaîne (facultatif)</span><label class="d-fld alr-line"><input type="text" autocomplete="off" spellcheck="false" data-se-room aria-label="Identifiant de chaîne"></label></div>
              <div class="alr-url"><button type="button" class="d-btn sm" data-s="se-connect">Enregistrer</button><button type="button" class="d-btn ghost sm" data-s="se-forget">Oublier le jeton</button></div>
              ${note('Chiffré par Windows sur cet ordinateur, jamais affiché ni renvoyé à la page.')}`
            : note(
                'Disponible uniquement dans l’application Raptoru Studio.',
                true,
              )
        }${seResult ? note(esc(seResult)) : ''}</details>
        <details class="d-acc" data-k="journal dons historique"><summary>Journal des dons (50 derniers)</summary>${se?.journal.length ? se.journal.map(seEntryView).join('') : note('Vide.')}</details>`;
    const rules = admin?.settings.rules;
    const halloween = rules
      ? `<div class="d-row"><span>Profil Halloween actif</span>${sw(rules.halloween_alerts === true, 'data-hw', 'Profil Halloween', { gold: true })}</div>
        ${note(rules.halloween_alerts ? 'Les familles en Auto jouent leur variante Halloween. Bits, Raid et Don ne changent pas.' : 'Les familles en Auto jouent leurs alertes habituelles.')}`
      : note('Profil Halloween illisible ici : voir la page Halloween.');
    p.panel.set(
      [
        grp(
          'Source OBS',
          'eye',
          `<div class="d-row col" data-k="adresse source navigateur url"><div class="alr-url"><label class="d-fld"><input type="text" readonly value="${esc(masked)}" aria-label="Adresse de la source OBS"></label><button type="button" class="d-btn sm" data-s="copy">${ic('copy')}Copier</button></div></div>
          ${sourceView(st)}
          ${note('Source navigateur 1920 × 1080, fond transparent. Seule consommatrice de la file.')}`,
          'obs',
        ),
        grp(
          'Événements Twitch',
          'bolt',
          `<div class="d-row col" data-k="twitch off test actif réception">${twSeg}${note(esc(TWITCH_HINT[twitch?.mode ?? 'off']))}${twitchStatusView(twitch, twitchError)}</div>`,
          'twitch',
        ),
        grp(
          'Dons StreamElements',
          'coin',
          `<div class="d-row col" data-k="streamelements dons">${seBody}</div>`,
          'dons streamelements',
        ),
        grp(
          'Médias',
          'image',
          `<div class="d-row col" data-k="médias fichiers vidéos sons importer">${mediaPanelView(media, st?.media ?? [], folder, report)}</div>`,
          'médias',
        ),
        grp(
          'Profil Halloween',
          'pumpkin',
          `<div class="d-row col" data-k="halloween profil">${halloween}</div>`,
          'halloween',
        ),
        grp(
          'Dock OBS',
          'layers',
          `<div class="d-row col" data-k="dock obs clé">${dockPanelView(dock, dockError, dockShown)}</div>`,
          'dock',
        ),
      ].join(''),
    );
  }

  const readTwitch = async () => {
    try {
      twitch = await getJson<TwitchState>('/api/alerts/twitch');
      twitchError = null;
    } catch (e) {
      twitchError = `Mode des événements Twitch indisponible : ${(e as Error).message}`;
    }
  };
  const readSe = async () => {
    if (seOff) return;
    try {
      se = await getJson<SeStatus>('/api/alerts/se');
      seError = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) seOff = true;
      else
        seError = `Dons StreamElements indisponibles : ${(e as Error).message}`;
    }
  };
  const readDock = async () => {
    try {
      dock = await getJson<DockInfo>('/api/dock');
      dockError = null;
    } catch (e) {
      dockError = (e as Error).message;
    }
  };
  const readMedia = async () => {
    media = await tryGetJson<MediaView>('/api/alerts/media');
  };
  const readAdmin = async () => {
    admin = await tryGetJson<HalloweenAdmin>('/api/halloween/admin');
  };

  const setTwitch = async (mode: TwitchState['mode']) => {
    if (mode === twitch?.mode) return;
    if (twitch?.available === false)
      return void toast('Indisponible dans ce profil.', { bad: true });
    if (
      mode === 'active' &&
      !(await confirmBox({
        title: 'Jouer les vrais événements ?',
        body: 'Les vrais follows, subs, subgifts, Bits et raids seront joués par la source OBS de ce Studio. Si cette source est dans une scène de live, ils s’afficheront à l’écran.',
        yes: activeLabel(twitch?.environment),
        no: 'Rester comme ça',
        danger: false,
      }))
    ) {
      paint();
      return;
    }
    await run(null, async () => {
      twitch = await postJson<TwitchState>('/api/alerts/twitch', { mode });
      twitchError = null;
    });
    paint();
  };

  const setSeMode = async (mode: string) => {
    if (mode === se?.mode) return;
    if (
      mode === 'active' &&
      !(await confirmBox({
        title: 'Jouer les vrais dons ?',
        body: 'Les vrais dons StreamElements confirmés seront joués par la source OBS de ce Studio. Les alertes StreamElements d’origine restent actives : si cette source est dans une scène de live, le don s’affichera deux fois.',
        yes: activeLabel(se?.environment),
        no: 'Rester comme ça',
        danger: false,
      }))
    ) {
      paint();
      return;
    }
    await run(null, async () => {
      se = await postJson<SeStatus>('/api/alerts/se/mode', { mode });
    });
    paint();
  };

  const body = p.panel.body;
  body.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const tw = t.closest<HTMLElement>('[data-tw2]')?.dataset.tw2;
    if (tw) return void setTwitch(tw as TwitchState['mode']);
    const sm = t.closest<HTMLElement>('[data-se-mode]')?.dataset.seMode;
    if (sm) return void setSeMode(sm);
    const btn = t.closest<HTMLElement>('[data-s]');
    const a = btn?.dataset.s;
    if (!a) return;
    if (a === 'copy')
      return copy(d.state()?.player_url ?? '', 'Adresse copiée');
    if (a === 'dock-copy' && dock?.url) return copy(dock.url, 'Adresse copiée');
    if (a === 'dock-show') {
      dockShown = !dockShown;
      return paint();
    }
    if (a === 'dock-key')
      return void confirmBox({
        title: 'Nouvelle clé du dock ?',
        body: 'Les docks ouverts se ferment : il faudra recoller la nouvelle adresse dans OBS.',
        yes: 'Changer la clé',
      }).then(async (yes) => {
        if (!yes) return;
        await run(
          btn,
          async () => {
            const res = await fetch('/api/dock/key', {
              method: 'POST',
              headers: STUDIO_HEADERS,
            });
            dock = (await res.json()) as DockInfo;
            dockShown = false;
          },
          'Nouvelle clé prête.',
        );
        paint();
      });
    const importing = (body: object, where: string) =>
      void run(
        btn,
        async () => {
          const r = await postJson<{ report: ImportLine[] }>(
            '/api/alerts/media/import',
            body,
          );
          report = { lines: r.report, where };
          await readMedia();
          d.onMedia();
          (document.activeElement as HTMLElement | null)?.blur();
          paint();
        },
        undefined,
        {
          folder_not_found: 'Ce dossier n’existe pas.',
          origin_not_found: 'Cet emplacement a disparu : recharge la page.',
          bad_path: 'Donne le chemin complet du dossier.',
          lab_only: 'L’import n’existe que dans le Lab.',
        },
      );
    if (a === 'media-import') {
      folder =
        body.querySelector<HTMLInputElement>('[data-folder]')?.value.trim() ??
        '';
      return importing({ folder }, 'Dossier importé');
    }
    if (a === 'media-all') return importing({ origin: 'all' }, 'Import');
    if (a === 'media-origin') {
      const o = media?.origins.find((x) => x.id === btn.dataset.origin);
      if (!o) return;
      if (!o.reserve) return importing({ origin: o.id }, o.label);
      return void confirmBox({
        title: 'Importer depuis le Studio installé ?',
        body: `Studio lit ${o.count} fichiers dans ${o.path} et les copie dans le Lab. Rien n’y est modifié. Un fichier dont l’empreinte ne correspond pas est refusé.`,
        yes: 'Importer',
        no: 'Annuler',
        danger: false,
      }).then((yes) => {
        if (yes) importing({ origin: o.id }, o.label);
      });
    }
    if (a === 'se-forget' && bridge)
      return void bridge.forget().then(async () => {
        seResult = 'Jeton oublié.';
        await readSe();
        paint();
      });
    if (a === 'se-connect' && bridge) {
      const token = body.querySelector<HTMLInputElement>('[data-se-token]');
      return void bridge
        .connect(
          body.querySelector<HTMLSelectElement>('[data-se-type]')!.value,
          token?.value ?? '',
          body.querySelector<HTMLInputElement>('[data-se-room]')?.value ?? '',
        )
        .then(async (out) => {
          if (token) token.value = ''; // jamais gardé dans la page
          seResult = out.ok
            ? out.remembered
              ? 'Jeton enregistré (chiffré).'
              : 'Jeton accepté pour cette session, mais pas mémorisé : chiffrement Windows indisponible.'
            : `Refusé : ${out.error === 'invalid_token' ? 'jeton invalide (vide, trop court ou avec des espaces)' : out.error === 'invalid_room' ? 'identifiant de chaîne invalide (24 caractères hexadécimaux)' : (out.error ?? 'erreur')}.`;
          (document.activeElement as HTMLElement | null)?.blur();
          await readSe();
          paint();
        });
    }
  });
  body.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.folder !== undefined) folder = t.value;
    if (t.dataset.hw !== undefined)
      void run(
        null,
        async () => {
          await postJson('/api/halloween/admin/settings', {
            rules: { halloween_alerts: t.checked },
          });
          await readAdmin();
          d.onRules();
          paint();
        },
        t.checked
          ? 'Alertes Halloween actives pour les vrais événements.'
          : 'Alertes habituelles rétablies.',
      );
  });
  body.addEventListener('focusout', () => setTimeout(paint, 0));

  return {
    async read() {
      // Le Lab sur le Core principal ne contacte jamais StreamElements.
      if (await labOnMainCore()) seOff = true;
      await Promise.all([
        readTwitch(),
        readSe(),
        readDock(),
        readMedia(),
        readAdmin(),
      ]);
      paint();
    },
    paint,
    twitch: () => twitch,
    media: () => media,
    pools: () => admin?.settings.rules.halloween_ballon ?? null,
    setTwitch,
  };
}
