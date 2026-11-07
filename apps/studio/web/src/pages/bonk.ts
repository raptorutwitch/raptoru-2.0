import {
  confirmBox,
  copy,
  errText,
  esc,
  fld,
  fmt,
  grp,
  hhmm,
  ic,
  keyed,
  menu,
  page,
  panelBtn,
  patch,
  poller,
  pp,
  row,
  run,
  scrub,
  seg,
  viewersSeg,
  stateChip,
  toast,
} from '../ds/ds.js';
import { getJson, postJson, statusError, tryGetJson } from '../http.js';
import {
  blockMenu,
  emoteHtml,
  isLive,
  modGet,
  money,
  onModChange,
  openItem,
  openViewer,
  refreshOpenItem,
  setModuleState,
  statusText,
  type ModItem,
} from '../mod/mod.js';
import { loadSettings, type SettingView } from '../module-settings.js';
import { whenProfile } from '../module-frame.js';
import { setNavCount } from '../shell/shell.js';
import { mountBonkStage } from './bonk-stage.js';
import {
  CANVAS,
  DEFAULT_ZONE,
  dragZone,
  fromPixels,
  sameZone,
  toPixels,
  type Handle,
  type Zone,
} from './bonk-zone.js';

// Le Bonk : tout part de l'impact. La scène montre la capture d'OBS et la zone visée, qu'on déplace à la main ; un essai tire avec le
// vrai moteur de l'overlay sur la zone en cours de réglage, avant même de l'enregistrer. La cible vit dans Studio, le prix et le
// délai dans le Core : les deux se préparent, puis s'appliquent. Un Bonk parti ne se retire pas : le Core ne connaît que le
// remboursement d'un Bonk fini, depuis son détail.

type Mode = 'auto' | 'manual' | 'fullscreen';
interface Pinned {
  name: string;
  uuid: string | null;
}
interface Target {
  version: 2;
  mode: Mode;
  manual: Zone;
  auto: { pinned: Pinned | null };
}
interface Candidate {
  name: string;
  uuid: string | null;
  path: string[];
  rect: Zone;
  score: number;
  reliable: boolean;
  reasons: string[];
}
interface AutoView {
  status: keyof typeof AUTO;
  reason: string;
  scene: string | null;
  chosen: Candidate | null;
  candidates: Candidate[];
}
interface Status {
  enabled: boolean;
  obs?: boolean;
  obs_fictional?: boolean;
  obs_reconnecting?: boolean;
  obs_error?: string | null;
  ready?: boolean;
  sourceReady?: boolean;
  overlayUrl?: string;
  error?: string | null;
}
interface Queue {
  module_state: 'active' | 'paused' | 'disabled';
  recent: ModItem[];
}
interface Catalog {
  channel_display_name: string | null;
  emotes: { provider: string; id: string; name: string; url: string }[];
  errors: Record<string, string>;
}
interface ObsBridge {
  connect(
    port: number,
    password: string,
  ): Promise<{ ok?: boolean; error?: string; remembered?: boolean }>;
  forget(): Promise<unknown>;
  remembered(): Promise<{ port: number | null }>;
}

const STATES = [
  ['active', 'Ouvert'],
  ['paused', 'Pause'],
  ['disabled', 'Fermé'],
] as const;
const MODES = [
  ['auto', 'Auto'],
  ['manual', 'Manuel'],
  ['fullscreen', 'Plein écran'],
] as const;
const AUTO = {
  ready: 'Caméra trouvée',
  pinned_absent: 'Source préférée absente : zone manuelle',
  no_candidate: 'Aucune caméra fiable : zone manuelle',
  ambiguous: 'Plusieurs caméras possibles : choisis une source',
  obs_offline: 'OBS indisponible : zone manuelle',
  syncing: 'Lecture de la scène OBS…',
  stale: 'OBS ne répond plus : zone manuelle',
};
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const PRICE_KEYS = ['bonk.price', 'bonk.cooldown_s'];
/** Les mêmes emotes que l'essai sur OBS (`bonk-lab/runtime.ts`). */
const EMOJIS = [
  '1f600',
  '1f923',
  '1f60e',
  '1f525',
  '1f480',
  '1f44d',
  '1f4a5',
  '1f921',
];
const SHOTS = [
  [1, '1 Bonk'],
  [5, 'Rafale de 5'],
  [10, 'Salve de 10'],
] as const;
const PROVIDERS: Record<string, string> = {
  '7tv': '7TV',
  bttv: 'BTTV',
  ffz: 'FFZ',
};
const ERRORS: Record<string, string> = {
  obs_offline: 'OBS n’est pas connecté.',
  obs_auth_failed: 'Mot de passe OBS refusé.',
  invalid_obs_port: 'Port OBS invalide.',
  lab_obs_fictional: 'OBS est fictif dans le Lab : aucune connexion réelle.',
  overlay_not_ready: 'Source OBS pas prête : essai impossible sur OBS.',
  invalid_zone: 'Zone invalide.',
  invalid_mode: 'Mode invalide.',
  invalid_pinned: 'Source préférée invalide.',
  out_of_bounds: 'Valeur hors des bornes.',
  unknown_setting: 'Réglage inconnu.',
};
const sameSource = (a: Pinned | null, b: Pinned | null) =>
  a === b ||
  (!!a && !!b && (a.uuid && b.uuid ? a.uuid === b.uuid : a.name === b.name));
const sourceKey = (x: Pinned) => x.uuid ?? `name:${x.name}`;
const frac = (r: Zone): Zone => ({
  x: r.x / CANVAS.width,
  y: r.y / CANVAS.height,
  w: r.w / CANVAS.width,
  h: r.h / CANVAS.height,
});

export function mountBonkPage(root: HTMLElement) {
  const p = page(root, { title: 'Bonk', mod: 'bonk', panel: true });
  p.body.innerHTML = `<div class="bk">
    <section class="bk-main">
      <div class="d-scn bk-scn" data-scn>
        <span class="d-scn__tag">Scène OBS</span>
        <img class="bk-shot" data-shot alt="Capture de la scène OBS en cours" hidden>
        <div class="bk-autoz" data-autoz hidden><span data-autolabel></span></div>
        <div class="bk-zone d-vf" data-zone data-handle="move" tabindex="0" aria-label="Zone visée par les Bonk. Flèches : déplacer. Maj et flèches : redimensionner." hidden>
          <i class="bk-cross"></i><span class="bk-zsize" data-zsize></span>
          ${HANDLES.map((h) => `<span class="bk-h is-${h}" data-handle="${h}"></span>`).join('')}
        </div>
        <div class="bk-hint" data-z="hint"></div>
      </div>
      <div class="bk-bar" data-z="fire"></div>
      <div class="bk-bar bk-aimbar">
        <span class="d-lb">Cible</span>
        <span data-z="modes"></span>
        <div class="bk-ctx" data-ctx="auto" hidden>
          <span class="bk-astate" data-z="astate"></span>
          <label class="d-fld bk-pin"><select data-pin aria-label="Source préférée"></select></label>
          <button type="button" class="d-btn ghost sm" data-copyman>Copier vers Manuel</button>
        </div>
        <div class="bk-ctx" data-ctx="manual" hidden>
          ${(
            [
              ['x', 'X'],
              ['y', 'Y'],
              ['w', 'Largeur'],
              ['h', 'Hauteur'],
            ] as const
          )
            .map(
              ([k, l]) =>
                `<span class="bk-px" data-scrubbable><span class="d-lb" data-scrub>${l}</span>${fld(`data-px="${k}" aria-label="${l} de la zone, en pixels"`, '', 'px')}</span>`,
            )
            .join('')}
          <button type="button" class="d-btn ghost sm" data-resetzone>Réinitialiser</button>
        </div>
        <div class="bk-ctx" data-ctx="fullscreen" hidden><span class="bk-astate">Les Bonk visent toute l’image.</span></div>
        <span class="d-sp"></span>
        <span data-z="apply"></span>
      </div>
      <section class="bk-tarif" aria-label="Prix et délai">
        <div class="bk-thead"><span class="d-lb">Prix et délai</span><span data-z="tapply"></span></div>
        <div data-z="tarif"></div>
        <p class="bk-pay" data-z="pay"></p>
      </section>
    </section>
    <aside class="bk-side">
      <div class="bk-lhead"><span class="d-lb">Derniers Bonk</span><span class="bk-count" data-z="count"></span></div>
      <div class="bk-list d-scroll" data-z="list"></div>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const scn = p.body.querySelector<HTMLElement>('[data-scn]')!;
  const zone = p.body.querySelector<HTMLElement>('[data-zone]')!;
  const autoz = p.body.querySelector<HTMLElement>('[data-autoz]')!;
  const shotEl = p.body.querySelector<HTMLImageElement>('[data-shot]')!;
  const pinSel = p.body.querySelector<HTMLSelectElement>('[data-pin]')!;
  const bridge = (window as unknown as { raptoruStudio?: { obs?: ObsBridge } })
    .raptoruStudio?.obs;

  let status: Status | null = null;
  let q: Queue | null = null;
  let qError = '';
  let globalPaused = false;
  let production = false;
  let saved: Target | null = null;
  let draft: Target | null = null;
  let targetError = '';
  let auto: AutoView | null = null;
  let settings: SettingView[] | null | undefined;
  let prices: Record<string, number> = {};
  let catalog: Catalog | null = null;
  let catalogRead = false;
  let where: 'here' | 'obs' = 'here';
  /** L'emote de l'essai, choisie dans le catalogue ; sinon elles tournent. */
  let emote: { src: string; name: string } | null = null;
  let seq = 0;
  let shotNote = '';
  let wasObs = false;
  let port = 4455;
  let stage: ReturnType<typeof mountBonkStage> | null = null;
  let pins: { value: string; pinned: Pinned | null }[] = [];

  void whenProfile().then((v) => {
    production = v === 'production';
    paintPanel();
    paintPay();
  });
  void bridge
    ?.remembered()
    .then((r) => {
      if (r.port) port = r.port;
      paintPanel();
    })
    .catch(() => {});

  const dirty = () =>
    !!saved &&
    !!draft &&
    (saved.mode !== draft.mode ||
      !sameZone(saved.manual, draft.manual) ||
      !sameSource(saved.auto.pinned, draft.auto.pinned));
  /** Ce qu'un essai vise : la cible en cours de réglage, comme le vrai renderer la lirait. */
  const aim = () =>
    draft?.mode === 'fullscreen'
      ? { mode: 'fullscreen' as const }
      : {
          mode: 'manual' as const,
          rect:
            draft?.mode === 'auto' && auto?.chosen
              ? auto.chosen.rect
              : toPixels(draft?.manual ?? DEFAULT_ZONE),
        };
  const place = (el: HTMLElement, r: Zone) => {
    el.style.left = `${r.x * 100}%`;
    el.style.top = `${r.y * 100}%`;
    el.style.width = `${r.w * 100}%`;
    el.style.height = `${r.h * 100}%`;
  };

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  async function readTarget() {
    try {
      const r = await getJson<{ settings: Target }>('/api/bonk-lab/settings');
      saved = r.settings;
      targetError = '';
      if (!draft || !dirty()) draft = structuredClone(saved);
    } catch (e) {
      targetError = errText(e, ERRORS);
    }
    paintTarget();
  }
  async function readAuto() {
    auto = await tryGetJson<AutoView>('/api/bonk-lab/auto');
    paintTarget();
    paintPanel();
  }
  async function readShot() {
    try {
      const r = await getJson<{ image: string | null }>(
        '/api/bonk-lab/obs-screenshot',
      );
      shotEl.hidden = !r.image;
      if (r.image) shotEl.src = r.image;
      shotNote = r.image ? '' : 'OBS fictif : pas de capture dans le Lab.';
    } catch (e) {
      shotEl.hidden = true;
      shotNote = errText(e, ERRORS);
    }
    paintHint();
  }
  async function readPrices() {
    settings = await loadSettings();
    prices = Object.fromEntries(
      (settings ?? [])
        .filter((s) => PRICE_KEYS.includes(s.key))
        .map((s) => [s.key, s.value]),
    );
    paintTarif();
  }
  async function readCatalog(refresh = false) {
    catalog = await tryGetJson<Catalog>(
      `/api/bonk-lab/catalog${refresh ? '?refresh=1' : ''}`,
    );
    catalogRead = true;
    paintPanel();
  }
  async function readLive() {
    try {
      const o = await modGet<{ bonk: Queue; global?: { paused?: boolean } }>(
        'overview',
      );
      q = o.bonk;
      qError = '';
      globalPaused = !!o.global?.paused;
    } catch (e) {
      qError = errText(e);
    }
    status = await tryGetJson<Status>('/api/bonk-lab/status');
    if (status?.obs && !wasObs && !status.obs_fictional) void readShot();
    wasObs = !!status?.obs;
    if (draft?.mode === 'auto') void readAuto();
    const open = q?.recent.filter(isLive).length ?? 0;
    setNavCount('bonk', open ? String(open) : null);
    refreshOpenItem();
    paint();
  }
  const tick = poller(readLive, 2000);
  onModChange(() => tick.now());

  // --- Dessin -----------------------------------------------------------------------------------------------------------
  const obsText = (s: Status) =>
    s.obs_fictional
      ? 'OBS fictif du Lab'
      : s.obs_reconnecting
        ? 'Reconnexion à OBS…'
        : s.obs_error
          ? (ERRORS[s.obs_error] ?? s.obs_error)
          : s.obs
            ? s.sourceReady
              ? 'OBS connecté'
              : 'OBS connecté, source absente'
            : 'OBS déconnecté';
  function paintHead() {
    const st = q?.module_state ?? 'active';
    const err = status?.error ? statusError(status.error) : '';
    const chip = !q
      ? stateChip('w', qError || 'Lecture…')
      : globalPaused
        ? stateChip('w', 'Pause globale')
        : err
          ? stateChip('w', err)
          : !status?.enabled
            ? stateChip('off', 'Bonk non lancé')
            : !status.obs
              ? stateChip('w', obsText(status))
              : !status.ready
                ? stateChip(
                    'w',
                    status.sourceReady
                      ? 'Overlay OBS pas prêt'
                      : 'Source OBS absente',
                  )
                : st === 'paused'
                  ? stateChip('w', 'Pause')
                  : st === 'disabled'
                    ? stateChip('off', 'Fermé aux viewers')
                    : q.recent.some(isLive)
                      ? stateChip('live', 'Bonk en cours')
                      : stateChip('', 'Prêt');
    patch(p.state, chip);
    patch(
      p.actions,
      `${viewersSeg('data-state', STATES, st)}${panelBtn(p.panel.isOpen())}`,
    );
  }
  function paintHint() {
    const offline = status?.enabled && !status.obs && !status.obs_fictional;
    patch(
      z('hint'),
      offline
        ? `<span>${esc(status ? obsText(status) : '')}</span><button type="button" class="d-btn sm" data-open="connexion">Connecter OBS</button>`
        : shotEl.hidden && shotNote
          ? `<span>${esc(shotNote)}</span>`
          : targetError
            ? `<span>${esc(targetError)}</span>`
            : '',
    );
  }
  function paintFire() {
    patch(
      z('fire'),
      `<span class="d-lb">Essai</span>
      ${seg(
        'data-where',
        [
          ['here', 'Ici'],
          ['obs', 'Sur OBS'],
        ],
        where,
      )}
      ${SHOTS.map(([n, l]) => `<button type="button" class="d-btn ${n === 1 ? 'pri' : ''} sm" data-shoot="${n}">${n === 1 ? ic('hand') : ''}${l}</button>`).join('')}
      ${where === 'here' && emote ? `<button type="button" class="d-tag ok" data-noemote title="Revenir aux emotes variées"><img src="${esc(emote.src)}" alt="" referrerpolicy="no-referrer">${esc(emote.name)} ${ic('x')}</button>` : ''}
      <span class="bk-where">${where === 'here' ? 'Local : ni achat, ni historique.' : production ? 'Visible en direct si la source Bonk est dans la scène diffusée.' : 'Tiré par la source OBS : ni achat, ni historique.'}</span>
      <span class="d-sp"></span>
      <button type="button" class="d-ib" data-shotnow aria-label="Rafraîchir la capture d’OBS" title="Rafraîchir la capture d’OBS">${ic('repeat')}</button>`,
    );
  }
  function paintZone() {
    if (!draft) return;
    const mode = draft.mode;
    zone.hidden = mode !== 'manual';
    scn.classList.toggle('d-vf', mode === 'fullscreen');
    scn.classList.toggle('bk-all', mode === 'fullscreen');
    place(zone, draft.manual);
    const px = toPixels(draft.manual);
    p.body.querySelector<HTMLElement>('[data-zsize]')!.textContent =
      `${px.w} × ${px.h}`;
    for (const i of p.body.querySelectorAll<HTMLInputElement>('[data-px]'))
      if (document.activeElement !== i)
        i.value = String(px[i.dataset.px as keyof Zone]);
    const chosen = auto?.chosen;
    autoz.hidden = mode !== 'auto' || !chosen;
    if (chosen) {
      place(autoz, frac(chosen.rect));
      p.body.querySelector<HTMLElement>('[data-autolabel]')!.textContent =
        chosen.name;
    }
  }
  function paintPins() {
    if (!draft) return;
    const opts: { value: string; label: string; pinned: Pinned | null }[] = [
      { value: '', label: 'Automatique', pinned: null },
      ...(auto?.candidates ?? []).map((c) => {
        const pinned = { name: c.name, uuid: c.uuid };
        return {
          value: sourceKey(pinned),
          label: `${c.name}${c.reliable ? '' : ' (peu fiable seule)'}`,
          pinned,
        };
      }),
    ];
    const pin = draft.auto.pinned;
    if (pin && !opts.some((o) => sameSource(o.pinned, pin)))
      opts.push({
        value: sourceKey(pin),
        label: `${pin.name} (absente de la scène)`,
        pinned: pin,
      });
    pins = opts;
    const html = opts
      .map(
        (o) =>
          `<option value="${esc(o.value)}" ${o.value === (pin ? sourceKey(pin) : '') ? 'selected' : ''}>${esc(o.label)}</option>`,
      )
      .join('');
    if (document.activeElement !== pinSel && pinSel.dataset.sig !== html) {
      pinSel.dataset.sig = html;
      pinSel.innerHTML = html;
    }
  }
  function paintTarget() {
    if (!draft) return;
    patch(z('modes'), seg('data-mode', MODES, draft.mode));
    for (const c of p.body.querySelectorAll<HTMLElement>('[data-ctx]'))
      c.hidden = c.dataset.ctx !== draft.mode;
    patch(
      z('astate'),
      esc(
        auto
          ? `${AUTO[auto.status]}${auto.chosen ? ` · ${auto.chosen.name}` : ''}`
          : 'État Auto illisible',
      ),
    );
    p.body.querySelector<HTMLButtonElement>('[data-copyman]')!.disabled =
      !auto?.chosen;
    paintZone();
    paintPins();
    patch(
      z('apply'),
      dirty()
        ? `<span class="bk-apply"><span class="d-muted">Pas encore appliqué</span><button type="button" class="d-btn ghost sm" data-revert>Annuler</button><button type="button" class="d-btn pri sm" data-save>Enregistrer</button></span>`
        : '',
    );
  }
  const itemRow = (i: ModItem) => ({
    key: i.interaction_id,
    html: `<div class="bk-r d-in ${isLive(i) ? 'on' : ''}"><button type="button" class="bk-r__m" data-item="${esc(i.interaction_id)}">${pp(i.viewer_display_name, 28)}<b>${esc(i.viewer_display_name)}</b><span class="bk-em">${emoteHtml(i, 22)}</span><small>${esc(statusText(i))} · ${esc(money(i))} · ${hhmm(i.created_at)}</small></button><button type="button" class="d-ib bk-r__x" data-more="${esc(i.interaction_id)}" aria-label="Décider pour ${esc(i.viewer_display_name)}">${ic('more')}</button></div>`,
  });
  function paintList() {
    const list = q?.recent ?? [];
    const open = list.filter(isLive).length;
    patch(z('count'), open ? `${open} en cours` : '');
    keyed(
      z('list'),
      list.map(itemRow),
      `<div class="d-empty">${qError ? esc(qError) : 'Aucun Bonk pour l’instant.'}</div>`,
    );
  }
  function paintPay() {
    const help = settings?.find((s) => s.key === 'bonk.cooldown_s')?.help;
    patch(
      z('pay'),
      esc(
        `${production ? 'Paiement réel en Jetons, remboursé une seule fois si le Bonk n’est pas joué.' : 'Lab : coût simulé, aucun débit réel.'}${help ? ` Délai : ${help}.` : ''}`,
      ),
    );
  }
  /** Dessiné à la lecture seulement : une saisie n'est jamais réécrite. */
  function paintTarif() {
    const list = (settings ?? []).filter((s) => PRICE_KEYS.includes(s.key));
    z('tarif').innerHTML =
      settings === undefined
        ? '<div class="d-skel" style="height:64px"></div>'
        : list.length
          ? list
              .map(
                (s) =>
                  `<div class="bk-trow" data-scrubbable><span data-scrub>${esc(s.label)}<small>De ${fmt(s.min)} à ${fmt(s.max)}${s.value !== s.default ? ` · par défaut ${fmt(s.default)}` : ''}</small></span>${fld(`data-price="${esc(s.key)}" min="${s.min}" max="${s.max}" aria-label="${esc(s.label)}"`, s.value, s.unit === 'Jetons' ? 'J' : s.unit)}</div>`,
              )
              .join('')
          : '<p class="d-note">Prix et délai indisponibles sur ce profil.</p>';
    paintTapply();
    paintPay();
  }
  const pricesDirty = () =>
    (settings ?? []).some(
      (s) => PRICE_KEYS.includes(s.key) && prices[s.key] !== s.value,
    );
  function paintTapply() {
    patch(
      z('tapply'),
      pricesDirty()
        ? `<span class="bk-apply"><button type="button" class="d-btn ghost sm" data-prevert>Annuler</button><button type="button" class="d-btn pri sm" data-papply>Appliquer</button></span>`
        : '',
    );
  }
  function paintPanel() {
    // Une saisie en cours (mot de passe, port) n'est jamais écrasée par un relevé.
    const active = document.activeElement as HTMLInputElement | null;
    const typing =
      !!active?.matches?.('input') && p.panel.body.contains(active);
    const pw = p.panel.body.querySelector<HTMLInputElement>('[data-obspass]');
    if (typing || pw?.value) return;
    const fict = !!status?.obs_fictional;
    const off = !status?.enabled;
    const list = catalog?.emotes ?? [];
    const counts = Object.keys(PROVIDERS)
      .map(
        (k) =>
          `<span class="d-tag ${catalog?.errors?.[k] ? 'bad' : 'off'}" title="${esc(catalog?.errors?.[k] ?? '')}">${PROVIDERS[k]} ${catalog?.errors?.[k] ? 'en erreur' : list.filter((e) => e.provider === k).length}</span>`,
      )
      .join('');
    p.panel.set(`${grp(
      'Connexion OBS',
      'link',
      `${row('État', stateChip(status?.obs ? '' : 'w', status ? obsText(status) : 'Illisible'), 'obs websocket')}
       ${
         fict
           ? '<div class="d-row col" data-k="obs fictif connexion"><small>Dans le Lab, OBS est fictif : aucune connexion réelle n’est possible ni nécessaire.</small></div>'
           : `${row('Port', fld('data-obsport min="1" max="65535"', port), 'websocket')}
       <div class="d-row col bk-wide" data-k="mot de passe obs connexion"><label class="d-fld"><input type="password" data-obspass autocomplete="off" placeholder="Mot de passe OBS" aria-label="Mot de passe OBS"></label>
       <span class="bk-obsbtns"><button type="button" class="d-btn sm" data-connect ${off ? 'disabled' : ''}>Connecter</button><button type="button" class="d-btn ghost sm" data-disconnect ${status?.obs || status?.obs_reconnecting ? '' : 'disabled'}>Déconnecter</button></span>
       ${bridge ? '<small>Studio retient la connexion, mot de passe chiffré par le système.</small>' : ''}</div>`
       }`,
      'connexion',
    )}
    ${grp(
      'Source OBS',
      'eye',
      `${row('Overlay', stateChip(status?.ready ? '' : 'w', status?.ready ? 'Prêt' : status?.sourceReady ? 'En attente' : 'Absent'), 'source overlay')}
       <div class="d-row col bk-wide" data-k="adresse url source navigateur obs overlay"><label class="d-fld"><input type="text" readonly value="${esc(status?.overlayUrl ?? '')}" aria-label="URL de la source OBS Bonk"></label><button type="button" class="d-btn sm" data-copy>${ic('copy')}Copier l’adresse</button>
       <small>Source navigateur nommée exactement « Raptoru Bonk Lab »${production ? ' (nom historique, à garder tel quel)' : ''}, 1920 × 1080, dans une scène de test. Elle doit rester active ; ne l’ajoute pas à la scène diffusée.${production ? ' L’adresse change avec le profil : remets celle-ci après un changement de profil.' : ''}</small></div>`,
      'source',
    )}
    ${grp(
      'Cible automatique',
      'eye',
      `${row('État', `<span class="bk-pv">${esc(auto ? AUTO[auto.status] : 'Illisible')}</span>`, 'auto caméra')}
       ${auto?.scene ? row('Scène', `<span class="bk-pv">${esc(auto.scene)}</span>`, 'programme') : ''}
       <div class="d-row col" data-k="candidats détectés caméra sources auto"><details class="d-acc"><summary>Candidats détectés (${auto?.candidates.length ?? 0})</summary>${
         (auto?.candidates ?? [])
           .map(
             (c) =>
               `<p class="bk-cand"><b>${esc(c.name)}</b>${c.reliable ? '' : ' · peu fiable'}<small>${esc(c.path.join(' > '))} · score ${c.score}</small><small>${esc(c.reasons.join(' · '))} · ${Math.round(c.rect.w)} × ${Math.round(c.rect.h)} px en ${Math.round(c.rect.x)}, ${Math.round(c.rect.y)}</small></p>`,
           )
           .join('') ||
         '<p class="d-note">Aucun candidat visible dans la scène programme.</p>'
       }</details></div>`,
      'auto',
    )}
    ${grp(
      'Emotes et catalogues',
      'image',
      `<div class="d-row col" data-k="catalogue emotes 7tv bttv ffz twitch unicode">
       ${
         catalog
           ? `<div class="d-tags">${counts}</div>
              ${list.length ? `<div class="bk-wall d-scroll">${list.map((e, n) => `<button type="button" data-emote="${n}" title="${esc(e.name)} · ${esc(PROVIDERS[e.provider] ?? e.provider)}" aria-label="Essayer ${esc(e.name)}"><img src="${esc(e.url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>` : ''}
              <button type="button" class="d-btn sm" data-catalog>${ic('repeat')}Actualiser</button>`
           : `<small>${catalogRead ? 'Catalogue non disponible sur ce profil. L’essai utilise les emotes par défaut.' : 'Lecture du catalogue…'}</small>`
       }
       <small>Clique une emote pour l’essayer sur la scène. Emojis et emotes Twitch : chaque viewer choisit les siens dans l’extension.</small></div>`,
      'catalogues',
    )}`);
  }
  function paint() {
    paintHead();
    paintHint();
    paintFire();
    paintTarget();
    paintList();
    paintPanel();
  }

  // --- Agir -------------------------------------------------------------------------------------------------------------
  const edit = (next: Partial<Target>) => {
    if (!draft) return;
    draft = { ...draft, ...next };
    paintTarget();
    paintPanel();
  };
  async function saveTarget(b: HTMLElement) {
    if (!draft) return;
    const body = draft;
    const ok = await run(
      b,
      () =>
        postJson<{ settings: Target }>('/api/bonk-lab/settings', body).then(
          (r) => {
            saved = r.settings;
            draft = structuredClone(r.settings);
          },
        ),
      'Cible appliquée à l’overlay',
      ERRORS,
    );
    if (ok) void readAuto();
    paintTarget();
  }
  async function applyPrices(b: HTMLElement) {
    const list = (settings ?? []).filter(
      (s) => PRICE_KEYS.includes(s.key) && prices[s.key] !== s.value,
    );
    const send = (key: string, value: number) =>
      postJson('/api/module-settings', { key, value });
    const yes = await confirmBox({
      title:
        list.length > 1
          ? `Appliquer ${list.length} changements ?`
          : 'Appliquer ce changement ?',
      body: `${list.map((s) => `${s.label} : ${fmt(s.value)} → ${fmt(prices[s.key]!)}`).join(' · ')}. Appliqué aux prochains achats. Rien de ce qui est déjà payé ne change.`,
      yes: 'Appliquer',
      no: 'Annuler',
      danger: false,
    });
    if (!yes) return;
    const ok = await run(
      b,
      async () => {
        for (const s of list) await send(s.key, prices[s.key]!);
      },
      undefined,
      ERRORS,
    );
    await readPrices();
    if (ok)
      toast('Appliqué aux prochains achats', {
        undo: () =>
          void run(
            null,
            async () => {
              for (const s of list) await send(s.key, s.value);
            },
            'Valeurs précédentes rétablies',
            ERRORS,
          ).then(readPrices),
      });
  }
  async function shoot(b: HTMLElement, n: number) {
    if (where === 'obs') {
      await run(
        b,
        () => postJson('/api/bonk-lab/preview', { count: n }),
        undefined,
        ERRORS,
      );
      return;
    }
    stage ??= mountBonkStage(scn, aim);
    try {
      const st = await stage;
      for (let k = 0; k < n; k++) {
        const src =
          emote?.src ??
          `/ext/assets/twemoji/svg/${EMOJIS[seq++ % EMOJIS.length]}.svg`;
        // Le même étalement que l'essai de l'overlay.
        setTimeout(() => void st.shot(src).catch(() => {}), k * 180);
      }
    } catch {
      stage = null;
      toast('Moteur Bonk indisponible : essai impossible ici.', { bad: true });
    }
  }
  function connect(b: HTMLElement) {
    const pass = p.panel.body.querySelector<HTMLInputElement>('[data-obspass]');
    const portIn =
      p.panel.body.querySelector<HTMLInputElement>('[data-obsport]');
    const password = pass?.value ?? '';
    if (pass) pass.value = '';
    port = Number(portIn?.value) || port;
    if (!bridge)
      return void run(
        b,
        () => postJson('/api/bonk-lab/connect', { port, password }),
        undefined,
        ERRORS,
      ).then(() => tick.now());
    void run(
      b,
      async () => {
        const r = await bridge.connect(port, password);
        if (r.error) toast(ERRORS[r.error] ?? r.error, { bad: true });
        else
          toast(
            r.remembered
              ? 'Connexion OBS mémorisée'
              : 'Connexion OBS non mémorisée',
          );
      },
      undefined,
      ERRORS,
    ).then(() => tick.now());
  }
  async function disconnect(b: HTMLElement) {
    const yes = await confirmBox({
      title: 'Déconnecter OBS ?',
      body: 'Les Bonk ne pourront plus être joués tant qu’OBS n’est pas reconnecté.',
      yes: 'Déconnecter',
    });
    if (!yes) return;
    await run(
      b,
      () =>
        bridge ? bridge.forget() : postJson('/api/bonk-lab/disconnect', {}),
      'OBS déconnecté',
      ERRORS,
    );
    tick.now();
  }

  // --- La zone à la main ------------------------------------------------------------------------------------------------
  let drag: { handle: Handle; x: number; y: number; start: Zone } | null = null;
  zone.addEventListener('pointerdown', (e) => {
    if (!draft) return;
    drag = {
      handle: ((e.target as HTMLElement).dataset.handle ?? 'move') as Handle,
      x: e.clientX,
      y: e.clientY,
      start: draft.manual,
    };
    zone.setPointerCapture(e.pointerId);
    zone.classList.add('drag');
    e.preventDefault();
    zone.focus({ preventScroll: true });
  });
  zone.addEventListener('pointermove', (e) => {
    if (!drag || !draft) return;
    const r = scn.getBoundingClientRect();
    draft = {
      ...draft,
      manual: dragZone(
        drag.start,
        drag.handle,
        (e.clientX - drag.x) / r.width,
        (e.clientY - drag.y) / r.height,
      ),
    };
    paintZone();
  });
  const drop = () => {
    drag = null;
    zone.classList.remove('drag');
    paintTarget();
  };
  zone.addEventListener('pointerup', drop);
  zone.addEventListener('pointercancel', drop);
  zone.addEventListener('keydown', (e) => {
    if (!draft) return;
    const step = 0.01;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!d) return;
    e.preventDefault();
    edit({
      manual: dragZone(draft.manual, e.shiftKey ? 'se' : 'move', d[0]!, d[1]!),
    });
  });

  // --- Interaction ------------------------------------------------------------------------------------------------------
  const findItem = (id: string) =>
    q?.recent.find((i) => i.interaction_id === id);
  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    const st = b.dataset.state as 'active' | 'paused' | 'disabled' | undefined;
    // Le Core ne retire pas un Bonk déjà payé : aucune file à garder ou annuler ici.
    if (st) return void setModuleState(b, 'bonk', st);
    if (b.dataset.where) {
      where = b.dataset.where as typeof where;
      return paintFire();
    }
    if (b.dataset.shoot) return void shoot(b, Number(b.dataset.shoot));
    if (b.matches('[data-noemote]')) {
      emote = null;
      return paintFire();
    }
    if (b.matches('[data-shotnow]')) return void readShot();
    if (b.dataset.mode) return edit({ mode: b.dataset.mode as Mode });
    if (b.matches('[data-copyman]') && auto?.chosen)
      return edit({ mode: 'manual', manual: fromPixels(auto.chosen.rect) });
    if (b.matches('[data-resetzone]'))
      return edit({ manual: { ...DEFAULT_ZONE } });
    if (b.matches('[data-save]')) return void saveTarget(b);
    if (b.matches('[data-revert]')) {
      draft = saved && structuredClone(saved);
      paintTarget();
      return;
    }
    if (b.matches('[data-papply]')) return void applyPrices(b);
    if (b.matches('[data-prevert]')) return paintFromSaved();
    if (b.dataset.open) return p.panel.open(b.dataset.open);
    if (b.matches('[data-connect]')) return connect(b);
    if (b.matches('[data-disconnect]')) return void disconnect(b);
    if (b.matches('[data-copy]'))
      return copy(status?.overlayUrl ?? '', 'Adresse copiée');
    if (b.matches('[data-catalog]'))
      return void run(b, () => readCatalog(true));
    if (b.dataset.emote) {
      const c = catalog?.emotes[Number(b.dataset.emote)];
      if (!c) return;
      emote = { src: c.url, name: c.name };
      where = 'here';
      paintFire();
      void shoot(b, 1);
      return;
    }
    const item = b.dataset.item;
    if (item) {
      const i = findItem(item);
      if (i) openItem(i, 'bonk');
      return;
    }
    const more = b.dataset.more;
    if (more) {
      const i = findItem(more);
      if (!i) return;
      menu(b, esc(i.viewer_display_name), [
        {
          label: 'Voir le détail',
          icon: 'info',
          hint: 'Remboursement',
          run: () => openItem(i, 'bonk'),
        },
        {
          label: 'Fiche du viewer',
          icon: 'user',
          run: () => openViewer(i.viewer_id),
        },
        {
          label: 'Bloquer',
          icon: 'ban',
          run: () => blockMenu(b, i.viewer_id, i.viewer_display_name, 'bonk'),
        },
      ]);
    }
  });
  function paintFromSaved() {
    prices = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));
    paintTarif();
  }
  p.root.addEventListener('input', (e) => {
    const i = e.target as HTMLInputElement;
    if (i.dataset.price && i.value.trim() !== '') {
      prices[i.dataset.price] = Number(i.value);
      return paintTapply();
    }
    if (i.dataset.px && draft) {
      const px = toPixels(draft.manual);
      px[i.dataset.px as keyof Zone] = Number(i.value) || 0;
      draft = { ...draft, manual: fromPixels(px) };
      paintZone();
      paintTarget();
    }
  });
  pinSel.addEventListener('change', () => {
    const c = pins.find((o) => o.value === pinSel.value);
    edit({ auto: { pinned: c?.pinned ?? null } });
  });
  scrub(p.root, (i) => i.dispatchEvent(new Event('input', { bubbles: true })));
  paintFire();
  paintPay();
  paintTarif();

  return {
    setVisible(v: boolean) {
      if (v) {
        tick.start();
        void readTarget().then(readAuto);
        void readPrices();
        void readShot();
        if (!catalog) void readCatalog();
      } else tick.stop();
    },
  };
}
