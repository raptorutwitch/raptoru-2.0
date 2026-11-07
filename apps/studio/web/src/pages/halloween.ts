import {
  confirmBox,
  copy,
  errText,
  esc,
  fld,
  fmt,
  grp,
  ic,
  keyed,
  numrow,
  page,
  panelBtn,
  patch,
  poller,
  pp,
  row,
  seg,
  stateChip,
  sw,
  toast,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import {
  ALERT_TESTS,
  alertTest,
  ambiancePatch,
  BALLON_ALL,
  CHAOS_DEFAULT,
  chaosCard,
  chaosParams,
  engineState,
  errorText,
  layerUrl,
  readChaos,
  RULE_GROUPS,
  rulesFromInputs,
  togglePool,
  LAST_BALLON,
  type BallonPools,
  type CatalogVariant,
  type ChaosObs,
  type ChaosStatus,
  type HalloweenAlertRules,
  type Rule,
} from './halloween-model.js';
import {
  coreStyle,
  imageOf,
  paintLooks,
  titleHtml,
  type Look,
} from './player-card.js';

// Halloween : une page de saison. La scène montre ce que voient les viewers et le Chaos, la boutique Bonbons se tient d'une main,
// les alertes d'événement se testent, chaque Bonbon donné garde sa clé. Tout bouton agit pour de vrai : un test joue sur l'écran
// du streamer (clic explicite), les réglages de la boutique écrivent au Core. STOP ALL reste à portée, partout.

type Scene = 'stage' | 'shop' | 'alerts' | 'viewers';
interface Ambiance {
  settings: {
    enabled: boolean;
    spider: boolean;
    bats: boolean;
    bats_every_min: number;
    vignette: boolean;
    vignette_strength: number;
  };
  connected: boolean;
  url: string;
  spider_ready: boolean;
  bats_ready: boolean;
}
interface Status extends ChaosStatus {
  environment: string | null;
  core: { connected: boolean; error: string | null } | null;
  engine_ready: boolean;
  page: { connected: boolean; ready: boolean };
  settings: ChaosStatus['settings'] & {
    overlay_enabled: boolean;
    volume: number;
    safe_mode: boolean;
  };
  ambiance?: Ambiance;
  displays: NonNullable<ChaosStatus['displays']>;
  media: {
    id: string;
    label: string;
    kind: string;
    duration_ms: number | null;
  }[];
  effects: string[];
  current: {
    source: string;
    label: string;
    viewer: string;
    state: string;
  } | null;
  events: { at: string; text: string; level: string }[];
}
interface Item {
  item_id: string;
  kind: 'screamer' | 'apparition' | 'effect';
  media_id: string | null;
  effect: string | null;
  label: string;
  description: string;
  price: number;
  cooldown_ms: number;
  enabled: boolean;
}
interface Admin {
  settings: {
    season: string;
    enabled: boolean;
    rules: Record<string, number> & {
      extension_audience?: 'all' | 'testers';
      extension_testers?: string[];
    };
  };
  items: Item[];
  engine: { ready: boolean } | null;
  purchases: {
    purchase_id: string;
    label: string;
    price: number;
    viewer: { name: string };
    status: string;
    refund_status: string;
    error: string | null;
    created_at: string;
  }[];
  ledger: {
    id: number;
    viewer: { name: string };
    kind: string;
    amount: number;
    balance_after: number;
    reason: string | null;
    created_at: string;
  }[];
  totals: { wallets: number; bonbons: number };
}
interface ViewerHit {
  viewer_id: string;
  name: string;
  balance: number;
}
interface ViewerHistory {
  viewer_id: string;
  balance: number;
  purchases: {
    label: string;
    price: number;
    status: string;
    refund_status: string;
    error: string | null;
    created_at: string;
  }[];
  ledger: {
    kind: string;
    amount: number;
    balance_after: number;
    actor: string;
    reason: string | null;
    created_at: string;
  }[];
}
interface ShopItem {
  reward_id: string;
  kind: string;
  label: string;
  rarity: string;
  status: string;
  style: Look;
  image_id: string | null;
  event_key: string | null;
  owners: number;
  offers: {
    currency: string;
    price: number;
    enabled: boolean;
    event_key: string | null;
  }[];
}

const SCENES = [
  ['stage', 'Scène'],
  ['shop', 'Boutique'],
  ['alerts', 'Alertes'],
  ['viewers', 'Viewers'],
] as const;
const KIND_GROUP = [
  ['effect', 'Effets'],
  ['apparition', 'Apparitions'],
  ['screamer', 'Screamers'],
] as const;
const STATUS_FR: Record<string, string> = {
  queued: 'en attente',
  executing: 'à l’écran',
  completed: 'joué',
  failed: 'non joué',
  unknown: 'fin inconnue',
};
const LEDGER_FR: Record<string, string> = {
  grant: 'cadeau Studio',
  remove: 'retrait Studio',
  sub_reward: 'sub',
  gift_reward: 'sub offert',
  convert: 'conversion (ancienne)',
  presence: 'présence',
  bits_reward: 'Bits',
  donation_reward: 'don',
  purchase: 'achat',
  refund: 'remboursement',
  raffle: 'Tombola',
};
const EFFECT_FR: Record<string, string> = {
  blink: 'Clignement',
  fog: 'Brouillard',
  glitch: 'Signal corrompu',
  tunnel: 'Vision tunnel',
  eyes: 'Yeux dans le noir',
  silhouette: 'Silhouette',
  flip: 'Écran retourné',
  blur: 'Flou',
};
const BALLON_FR = ['Bonbons', 'Citrouilles', 'Bonbons maïs', 'Araignées'];
const BALLON_KINDS: [keyof BallonPools, string][] = [
  ['sub', 'Sub'],
  ['prime', 'Prime'],
  ['resub', 'Resub'],
];
const ERR: Record<string, string> = {
  overlay_absent: 'L’overlay n’est pas ouvert : le test ne peut pas jouer.',
  busy: 'Un effet joue déjà.',
  chaos_absent: 'La fenêtre Chaos est absente.',
  safe_mode: 'Mode sûr actif : pas de signal corrompu.',
  obs_offline: 'OBS n’est pas connecté.',
  no_obs_source: 'Choisis d’abord la capture d’écran OBS.',
  ambiance_off: 'L’ambiance ou les chauves-souris sont coupées.',
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const stamp = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const BAT =
  '<svg viewBox="0 0 24 12" aria-hidden="true"><path d="M12 3c.5-1 1-1.6 1.3-2l.5 1.6c2-.8 4.800-2 7.200-.6 1.300.800 2.200 2.300 3 4.500-1.400-1.200-2.700-1.300-3.700-.8-.5-1-1.300-1.400-2.500-.9-.5-.8-1.300-1-2.300-.5-.8.800-1.700 2.300-3.500 4.700-1.800-2.400-2.700-3.900-3.500-4.700-1-.5-1.800-.3-2.300.5-1.200-.5-2-.1-2.500.9-1-.5-2.300-.4-3.700.8.800-2.200 1.700-3.700 3-4.500 2.400-1.400 5.200-.2 7.200.6l.5-1.600c.3.400.8 1 1.300 2z"/></svg>';
const SPIDER =
  '<svg viewBox="0 0 48 60" aria-hidden="true"><path d="M24 0v28" stroke="currentColor" fill="none"/><ellipse cx="24" cy="38" rx="7" ry="9"/><circle cx="24" cy="27" r="4.500"/><path d="M18 32 6 24M18 37 3 37M18 42 6 52M30 32l12-8M30 37l15 0M30 42l12 10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

export function mountHalloweenPage(root: HTMLElement) {
  coreStyle();
  const p = page(root, { title: 'Halloween', mod: 'halloween', panel: true });
  p.body.innerHTML = `<div class="hw">
    <div class="hw-a" data-scene-z="stage">
      <section class="hw-left">
        <div class="d-scn d-vf hw-scn" data-z="scn"><span class="d-scn__tag">Ce que voient les viewers</span><div class="hw-world" data-z="world"></div></div>
        <div class="hw-now" data-z="now"></div>
        <div class="hw-tests" data-z="tests"></div>
      </section>
      <aside class="hw-right">
        <section class="hw-box" data-z="amb"></section>
        <section class="hw-box" data-z="chaos"></section>
      </aside>
    </div>
    <div class="hw-b" data-scene-z="shop" hidden>
      <section class="hw-left">
        <div class="hw-open" data-z="open"></div>
        <div class="hw-cat" data-z="cat"></div>
      </section>
      <aside class="hw-right">
        <section class="hw-box" data-z="access"></section>
        <section class="hw-box" data-z="titles"></section>
      </aside>
    </div>
    <div class="hw-c" data-scene-z="alerts" hidden data-z="alerts"></div>
    <div class="hw-d" data-scene-z="viewers" hidden>
      <section class="hw-left" data-role="viewer">
        <form class="hw-find" data-form="find"><label class="d-fld">${ic('search')}<input name="q" maxlength="64" placeholder="Pseudo Twitch ou id" aria-label="Viewer à trouver"></label><button class="d-btn">Chercher</button></form>
        <div class="hw-hits" data-z="hits"></div>
        <div class="hw-pick" data-z="picked"></div>
      </section>
      <aside class="hw-right">
        <form class="hw-box hw-grant" data-form="grant">
          <h3>${ic('gift')}Bonbons à la main</h3>
          <label class="d-fld"><input name="viewer" required maxlength="64" placeholder="Pseudo Twitch ou id" aria-label="Viewer"></label>
          <div class="hw-gr2"><label class="d-fld"><input name="amount" required type="number" min="-100000" max="100000" step="1" placeholder="+ ou −" aria-label="Bonbons"></label><label class="d-fld"><select name="reason" aria-label="Motif"><option value="grant">Cadeau</option><option value="raffle">Tombola</option></select></label></div>
          <label class="d-fld"><input name="note" maxlength="200" placeholder="Note (facultatif)" aria-label="Note"></label>
          <button class="d-btn pri">Attribuer</button>
          <p class="d-note" data-z="totals"></p>
        </form>
        <section class="hw-box"><h3>${ic('shop')}Derniers achats</h3><div data-z="buys"></div></section>
        <section class="hw-box"><h3>${ic('hist')}Mouvements</h3><div data-z="ledger"></div></section>
      </aside>
    </div>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const grantForm = p.body.querySelector<HTMLFormElement>(
    '[data-form="grant"]',
  )!;

  let scene: Scene = 'stage';
  let status: Status | null = null;
  let admin: Admin | null = null;
  let adminError = '';
  let chaos = CHAOS_DEFAULT;
  let chaosObs: ChaosObs | null = null;
  let alertCatalog: CatalogVariant[] | null = null;
  let titles: ShopItem[] | null = null;
  let hits: ViewerHit[] | null = null;
  let picked: { id: string; name: string; h: ViewerHistory | null } | null =
    null;
  let findError = '';
  let lastQuery = '';

  const rules = () =>
    (admin?.settings.rules ?? null) as HalloweenAlertRules | null;
  const testers = () => admin?.settings.rules.extension_testers ?? [];
  const testersOnly = () =>
    admin?.settings.rules.extension_audience === 'testers';

  /** Une zone n'est jamais réécrite pendant qu'on y écrit. */
  const soft = (el: HTMLElement, html: string) => {
    const a = document.activeElement;
    if (
      a &&
      el.contains(a) &&
      a.matches(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea',
      )
    )
      return;
    patch(el, html);
  };

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  async function readStatus() {
    status = await tryGetJson<Status>('/api/halloween/status');
    if (status?.chaos?.obs_connected && !chaosObs)
      chaosObs = await tryGetJson<ChaosObs>('/api/halloween/obs');
    paintLive();
  }
  async function readAdmin() {
    try {
      admin = await getJson<Admin>('/api/halloween/admin');
      adminError = '';
    } catch (e) {
      adminError = errorText(errText(e));
    }
    // OBS absent : rien à lire, on ne relance pas une requête refusée à chaque relevé.
    chaosObs = status?.chaos?.obs_connected
      ? await tryGetJson<ChaosObs>('/api/halloween/obs')
      : null;
    alertCatalog =
      (await tryGetJson<{ variants: CatalogVariant[] }>('/api/alerts/catalog'))
        ?.variants ?? null;
    titles = (await tryGetJson<ShopItem[]>('/api/cosmetics/items')) ?? titles;
    paintAdmin();
  }
  const fast = poller(readStatus, 1500);
  const slow = poller(readAdmin, 5000);
  const refresh = () => {
    fast.now();
    slow.now();
  };
  async function act(
    btn: HTMLElement | null,
    fn: () => Promise<unknown>,
    done: string | ((o: Record<string, unknown>) => string),
  ) {
    btn?.classList.add('is-busy');
    let ok = false;
    try {
      const out = (await fn()) as Record<string, unknown>;
      toast(typeof done === 'string' ? done : done(out));
      ok = true;
    } catch (e) {
      toast(errorText(errText(e, ERR)), { bad: true });
    }
    btn?.classList.remove('is-busy');
    refresh();
    return ok;
  }

  // --- Dessin -----------------------------------------------------------------------------------------------------------
  function paintHead() {
    const st = engineState(status);
    patch(
      p.state,
      stateChip(
        st.tone === 'ok' ? '' : st.tone === 'warn' ? 'w' : 'r',
        st.text,
      ),
    );
    patch(
      p.actions,
      `${seg('data-scene', SCENES, scene)}${panelBtn(p.panel.isOpen())}<button type="button" class="d-btn danger hw-stop" data-act="stop" title="Arrête aussitôt tout effet (Ctrl+Maj+F12)">${ic('stop')}STOP ALL</button>`,
    );
  }
  function paintStage() {
    const s = status;
    const a = s?.ambiance;
    const st = a?.settings;
    const on = !!st?.enabled;
    patch(
      z('world'),
      `${on && st?.vignette ? `<i class="hw-vig" style="--v:${st.vignette_strength}"></i>` : ''}
      ${on && st?.spider ? `<span class="hw-spider ${a?.spider_ready ? '' : 'miss'}">${SPIDER}</span>` : ''}
      ${on && st?.bats ? `<span class="hw-bats ${a?.bats_ready ? '' : 'miss'}"><i>${BAT}</i><i>${BAT}</i><i>${BAT}</i></span>` : ''}
      ${on ? '' : '<div class="hw-off"><b>Ambiance coupée</b><span>La source n’affiche rien.</span></div>'}`,
    );
    const c = s?.current;
    patch(
      z('now'),
      c
        ? `${pp(c.viewer, 24)}<b>${esc(c.label)}</b><span class="d-muted">${esc(c.viewer)} · ${esc(STATUS_FR[c.state] ?? c.state)}</span><span class="d-sp"></span><span class="d-tag warn">À l’écran</span>`
        : `<span class="d-faint">Aucun effet à l’écran.</span><span class="d-sp"></span><span class="d-faint">STOP ALL global : Ctrl + Maj + F12</span>`,
    );
    if (s) {
      const chips = (
        list: { key: string; label: string; attr: string; cls?: string }[],
      ) =>
        list
          .map(
            (x) =>
              `<button type="button" class="d-tag ${x.cls ?? ''}" ${x.attr}>${esc(x.label)}</button>`,
          )
          .join('');
      patch(
        z('tests'),
        `<div class="hw-line"><span class="d-lb">Tester sur mon écran</span><span class="d-faint">Joue réellement, sans achat</span></div>
        <div class="d-tags">${chips(s.effects.map((e) => ({ key: e, label: EFFECT_FR[e] ?? e, attr: `data-test-effect="${esc(e)}"` })))}${chips(s.media.map((m) => ({ key: m.id, label: m.label, attr: `data-test-media="${esc(m.id)}"`, cls: m.kind === 'screamer' ? 'bad' : '' })))}</div>
        <div class="hw-log">${
          s.events
            .slice(0, 5)
            .map(
              (e) =>
                `<div class="${e.level === 'error' ? 'bad' : ''}"><time>${time(e.at)}</time><span>${esc(e.text)}</span></div>`,
            )
            .join('') || ''
        }</div>`,
      );
    }
    if (a && st)
      soft(
        z('amb'),
        `<h3>${ic('eye')}Ambiance${sw(st.enabled, 'data-ambiance="enabled"', 'Ambiance active')}</h3>
        <p class="hw-st ${!st.enabled ? '' : a.connected ? 'ok' : 'bad'}"><i class="d-dot ${!st.enabled ? 'off' : a.connected ? '' : 'r'}"></i>${!st.enabled ? 'Coupée' : a.connected ? 'Source ouverte dans OBS' : 'Aucune source ouverte : ajoute-la dans OBS'}</p>
        ${row(a.spider_ready ? 'Araignée autour de la cam' : 'Araignée (média absent)', sw(st.spider, 'data-ambiance="spider"', 'Araignée', { disabled: !a.spider_ready }))}
        ${row(a.bats_ready ? 'Vols de chauves-souris' : 'Chauves-souris (média absent)', sw(st.bats, 'data-ambiance="bats"', 'Chauves-souris', { disabled: !a.bats_ready }))}
        ${numrow('Un vol toutes les', fld('data-ambiance="bats_every_min" min="0" max="120" step="1"', st.bats_every_min, 'min'))}
        ${row('Vignette sombre', sw(st.vignette, 'data-ambiance="vignette"', 'Vignette'))}
        <div class="d-row"><span>Intensité</span><input type="range" class="d-range hw-range" min="10" max="100" step="5" value="${Math.round(st.vignette_strength * 100)}" data-ambiance="vignette_strength" aria-label="Intensité de la vignette"></div>
        <button type="button" class="d-btn sm" data-act="ambiance-bats" ${st.enabled && st.bats ? '' : 'disabled'}>Lancer un vol maintenant</button>`,
      );
    soft(
      z('chaos'),
      `<h3>${ic('bolt')}Chaos</h3>${chaosCard(status, chaos, chaosObs)}`,
    );
  }
  function paintShop() {
    const a = admin;
    if (!a) {
      patch(
        z('open'),
        adminError
          ? `<div class="d-empty">${esc(adminError)}</div>`
          : '<div class="d-skel hw-sk"></div>',
      );
      return;
    }
    patch(
      z('open'),
      `<div class="hw-sign ${a.settings.enabled ? 'on' : ''}">${ic('pumpkin')}<div><b>Boutique ${a.settings.enabled ? 'ouverte' : 'fermée'}</b><small>${esc(a.settings.season)}</small></div></div>
      <p>${a.settings.enabled ? 'Les viewers voient « Événements », gagnent et dépensent des Bonbons. !peur et !bonbons répondent.' : 'Rien n’est vendu ni gagné, commandes masquées. Les soldes sont gardés.'}</p>
      <button type="button" class="d-btn ${a.settings.enabled ? 'bad' : 'pri'}" data-act="toggle-shop">${a.settings.enabled ? 'Fermer…' : 'Ouvrir la boutique'}</button>`,
    );
    const onPc = status ? status.media.map((m) => m.id) : null;
    const absent = (i: Item) =>
      !!onPc && i.enabled && !!i.media_id && !onPc.includes(i.media_id);
    const missing = a.items.filter(absent);
    soft(
      z('cat'),
      `${
        missing.length
          ? `<p class="d-note warn">${missing.length} vidéo${missing.length > 1 ? 's' : ''} absente${missing.length > 1 ? 's' : ''} de ce PC, non vendue${missing.length > 1 ? 's' : ''} : ${missing
              .slice(0, 5)
              .map((i) => esc(i.label))
              .join(
                ', ',
              )}${missing.length > 5 ? '…' : ''}. Installe les médias puis recharge-les dans les réglages.</p>`
          : ''
      }
      <div class="hw-rowh"><span></span><span>Nom affiché</span><span>Prix</span><span>Récupération</span><span></span></div>
      ${KIND_GROUP.map(([k, label]) => {
        const list = a.items.filter((i) => i.kind === k);
        return list.length
          ? `<small class="hw-g">${label}</small>${list
              .map(
                (i) =>
                  `<div class="hw-it ${i.enabled ? '' : 'off'}" data-item="${esc(i.item_id)}">${sw(i.enabled, 'data-field="enabled"', `Vendre ${i.label}`)}
                <span class="d-fld"><input type="text" maxlength="40" data-field="label" value="${esc(i.label)}" aria-label="Nom affiché"></span>
                ${fld('data-field="price" min="1" max="100000" aria-label="Prix"', i.price, 'Bonbons')}
                ${fld('data-field="cooldown" min="0" max="86400" aria-label="Récupération"', Math.round(i.cooldown_ms / 1000), 's')}
                <span class="hw-it__a">${absent(i) ? '<span class="d-tag warn">Absent</span>' : ''}<button type="button" class="d-btn ghost sm" ${i.media_id ? `data-test-media="${esc(i.media_id)}"` : `data-test-effect="${esc(i.effect)}"`}>Tester</button></span></div>`,
              )
              .join('')}`
          : '';
      }).join('')}
      <p class="d-note">Chaque changement est enregistré dès que tu quittes le champ.</p>`,
    );
    const only = testersOnly();
    const n = testers().length;
    patch(
      z('access'),
      `<h3>${ic('ext')}Dans l’extension</h3>${seg(
        'data-audience',
        [
          ['all', 'Tous les viewers'],
          ['testers', 'Testeurs seulement'],
        ],
        only ? 'testers' : 'all',
        'block',
      )}<p class="d-note">${only ? `${n} testeur${n > 1 ? 's' : ''} : ajoute ou retire depuis Viewers. Les autres ne voient pas le module ; le chat et les gains restent ouverts à tous.` : 'Tous les viewers de l’extension publiée voient le module pendant l’événement.'}</p>`,
    );
    const season = a.settings.season;
    const mine = (titles ?? []).filter(
      (t) =>
        t.event_key === season ||
        t.offers.some(
          (o) => o.currency === 'bonbons' || o.event_key === season,
        ),
    );
    patch(
      z('titles'),
      `<h3>${ic('star')}Titres d’événement</h3>
      ${
        mine.length
          ? mine
              .map((t) => {
                const o = t.offers.find((x) => x.currency === 'bonbons');
                return `<div class="hw-title">${
                  t.kind === 'title'
                    ? titleHtml({
                        label: t.label,
                        rarity: t.rarity,
                        style: t.style,
                      })
                    : `<span class="hw-thumb">${t.image_id ? `<img src="${esc(imageOf(t.image_id)!)}" alt="">` : ''}</span><b>${esc(t.label)}</b>`
                }<small>${o ? `${fmt(o.price)} Bonbons${o.enabled ? '' : ', arrêtée'}` : 'non vendu'}</small></div>`;
              })
              .join('')
          : `<p class="d-note">${titles ? 'Aucun objet lié à cet événement.' : 'Boutique indisponible.'}</p>`
      }
      <a class="d-btn sm" href="/?p=shop">Ouvrir la Boutique</a>`,
    );
    paintLooks(z('titles'));
  }
  function paintAlerts() {
    const r = rules();
    if (!r) {
      patch(
        z('alerts'),
        `<div class="d-empty">${adminError ? esc(adminError) : 'Lecture…'}</div>`,
      );
      return;
    }
    const on = r.halloween_alerts === true;
    const pools = { ...BALLON_ALL, ...(r.halloween_ballon ?? {}) };
    const hw = (alertCatalog ?? []).filter((v) => v.id.startsWith('hw_'));
    const missing = [...new Set(hw.flatMap((v) => v.missing ?? []))];
    const test = (key: string, label: string) =>
      ALERT_TESTS[key]
        ? `<button type="button" class="d-tag" data-alert-test="${key}">${label}</button>`
        : '';
    patch(
      z('alerts'),
      `<div class="hw-open"><div class="hw-sign ${on ? 'on' : ''}">${ic('bell')}<div><b>${on ? 'Profil Halloween actif' : 'Profil habituel'}</b><small>${on ? 'Les vrais follows, subs et subgifts jouent les alertes Halloween' : 'Les alertes normales sont jouées'}</small></div></div>
        <button type="button" class="d-btn ${on ? '' : 'pri'}" data-act="toggle-hw-alerts">${on ? 'Revenir aux alertes habituelles' : 'Activer les alertes Halloween'}</button></div>
      <div class="hw-who">
        <section><h3>Follow</h3><p>Miss Minute, « Hello… »</p><div class="d-tags">${test('follow', 'Tester')}</div></section>
        <section><h3>Sub, Prime, Resub</h3><p>Le Ballon, « Le Ballon V2 »</p><div class="d-tags">${test('sub', 'Sub')}${test('prime', 'Prime')}${test('resub', 'Resub')}</div></section>
        <section><h3>Subgift</h3><p>Jerry, « My Ordinary Life »</p><div class="d-tags">${test('gift1', '×1')}${test('gift5', '×5')}${test('gift10', '×10')}${test('gift20', '×20')}${test('targeted', 'À un viewer')}</div></section>
      </div>
      <div class="hw-ballon"><h3>Ballon tiré au hasard parmi</h3>
        <div class="hw-bg" style="--n:${BALLON_FR.length}"><span></span>${BALLON_FR.map((l) => `<small>${l}</small>`).join('')}
        ${BALLON_KINDS.map(([k, label]) => `<b>${label}</b>${[1, 2, 3, 4].map((n) => `<span ${pools[k].length === 1 && pools[k][0] === n ? `title="${esc(LAST_BALLON)}"` : ''}>${sw(pools[k].includes(n), `data-ballon="${k}:${n}"`, `${label} : ${BALLON_FR[n - 1]}`, { disabled: pools[k].length === 1 && pools[k][0] === n })}</span>`).join('')}`).join('')}</div></div>
      <p class="d-note ${missing.length ? 'warn' : ''}">${!alertCatalog ? 'État des médias indisponible.' : missing.length ? `Médias absents de ce PC, l’alerte habituelle sera jouée à la place : ${missing.map(esc).join(', ')}.` : `${hw.length} variantes Halloween, tous leurs médias sont sur ce PC.`}</p>
      <p class="d-note">Les tests sont gratuits, sans événement Twitch, joués par la source OBS « Alertes », même profil coupé. Raid, bits et dons ne changent pas. Placement du texte : page Alertes.</p>`,
    );
  }
  const log = (rows: string, empty: string) =>
    rows || `<p class="d-faint">${empty}</p>`;
  function paintViewers() {
    const a = admin;
    patch(
      z('totals'),
      a
        ? `${fmt(a.totals.bonbons)} Bonbons en circulation, ${fmt(a.totals.wallets)} viewers. Un nouvel essai ne crédite jamais deux fois.`
        : '',
    );
    patch(
      z('buys'),
      log(
        (a?.purchases ?? [])
          .slice(0, 12)
          .map(
            (x) =>
              `<div class="hw-e"><time>${time(x.created_at)}</time><b>${esc(x.viewer.name)}</b><span>${esc(x.label)}</span><small>${x.price} · ${esc(STATUS_FR[x.status] ?? x.status)}${x.refund_status === 'refunded' ? ', remboursé' : ''}</small></div>`,
          )
          .join(''),
        'Aucun achat.',
      ),
    );
    patch(
      z('ledger'),
      log(
        (a?.ledger ?? [])
          .slice(0, 14)
          .map(
            (l) =>
              `<div class="hw-e"><time>${time(l.created_at)}</time><b>${esc(l.viewer.name)}</b><span class="${l.amount < 0 ? 'neg' : 'pos'}">${l.amount > 0 ? '+' : ''}${l.amount}</span><small>${esc(LEDGER_FR[l.kind] ?? l.kind)} → ${l.balance_after}</small></div>`,
          )
          .join(''),
        'Aucun mouvement.',
      ),
    );
    paintFinder();
  }
  function paintFinder() {
    const box = z('hits');
    if (findError) patch(box, `<p class="d-note bad">${esc(findError)}</p>`);
    else if (hits)
      keyed(
        box,
        hits.map((h) => ({
          key: h.viewer_id,
          html: `<button type="button" class="hw-hit d-in ${picked?.id === h.viewer_id ? 'on' : ''}" data-pick="${esc(h.viewer_id)}" data-name="${esc(h.name)}">${pp(h.name, 26)}<b>${esc(h.name)}</b><small>${esc(h.viewer_id)}</small><span class="hw-n">${fmt(h.balance)}</span></button>`,
        })),
        '<p class="d-faint">Aucun viewer trouvé.</p>',
      );
    else
      patch(
        box,
        '<p class="d-faint">Ceux qui ont des Bonbons, puis tous les viewers vus par la chaîne.</p>',
      );
    if (!picked) return patch(z('picked'), '');
    const h = picked.h;
    const tester =
      testersOnly() && picked ? testers().includes(picked.id) : null;
    patch(
      z('picked'),
      `<div class="hw-vh">${pp(picked.name, 38)}<div><b>${esc(picked.name)}</b><small>${esc(h?.viewer_id ?? '')}</small></div><span class="d-sp"></span>
        <span class="hw-bal"><b class="hw-balance">${h ? fmt(h.balance) : '…'}</b><small>Bonbons</small></span>
        ${tester === null ? '' : `<button type="button" class="d-btn sm" data-tester aria-pressed="${tester}" ${h ? '' : 'disabled'}>${ic(tester ? 'check' : 'plus')}Testeur extension</button>`}
        <button type="button" class="d-btn pri sm" data-credit ${h ? '' : 'disabled'}>Créditer</button></div>
      ${
        h
          ? `<div class="hw-cols"><div><h3>Achats (${h.purchases.length})</h3>${log(
              h.purchases
                .map(
                  (x) =>
                    `<div class="hw-e"><time>${stamp(x.created_at)}</time><span>${esc(x.label)}</span><small>${x.price} · ${esc(STATUS_FR[x.status] ?? x.status)}${x.refund_status === 'refunded' ? ', remboursé' : ''}</small></div>`,
                )
                .join(''),
              'Aucun achat.',
            )}</div>
          <div><h3>Mouvements</h3>${log(
            h.ledger
              .map(
                (l) =>
                  `<div class="hw-e"><time>${stamp(l.created_at)}</time><span class="${l.amount < 0 ? 'neg' : 'pos'}">${l.amount > 0 ? '+' : ''}${l.amount}</span><small>${esc(LEDGER_FR[l.kind] ?? l.kind)}${l.reason ? ` · ${esc(l.reason)}` : ''} → ${l.balance_after}</small></div>`,
              )
              .join(''),
            'Aucun mouvement.',
          )}</div></div>`
          : ''
      }`,
    );
  }
  function paintPanel() {
    const s = status;
    const a = s?.ambiance;
    const r = admin?.settings.rules;
    const dflt =
      s?.settings.display_id ?? s?.displays.find((d) => d.primary)?.id;
    const shown = (x: Rule) => {
      const v = (r as Record<string, number | null | undefined> | undefined)?.[
        x.key
      ];
      return v == null ? (x.same ? '' : 0) : v / (x.scale ?? 1);
    };
    const urlRow = (label: string, url: string) =>
      `<div class="d-row"><span>${esc(label)}</span><button type="button" class="d-btn sm" data-copy-url="${esc(url)}">${ic('copy')}Copier</button></div>`;
    const html = `${
      s
        ? grp(
            'Overlay sur mon écran',
            'eye',
            `${row('Overlay actif', sw(s.settings.overlay_enabled, 'data-set="overlay_enabled"', 'Overlay actif'))}
            <div class="d-row" data-k="écran moniteur display"><span>Écran</span><label class="d-fld hw-sel"><select data-set="display_id" aria-label="Écran">${
              s.displays.length
                ? s.displays
                    .map(
                      (d) =>
                        `<option value="${d.id}" ${dflt === d.id ? 'selected' : ''}>${esc(d.label)} ${d.bounds.width}×${d.bounds.height}${d.primary ? ' (principal)' : ''}</option>`,
                    )
                    .join('')
                : '<option value="">Écran principal</option>'
            }</select></label></div>
            <div class="d-row" data-k="volume son"><span>Volume</span><input type="range" class="d-range hw-range" min="0" max="100" step="5" value="${Math.round(s.settings.volume * 100)}" data-set="volume" aria-label="Volume"></div>
            ${row('Mode sûr', sw(s.settings.safe_mode, 'data-set="safe_mode"', 'Mode sûr'), 'photosensibilité signal corrompu')}
            <div class="d-row col" data-k="médias recharger"><small>Mode sûr : pas de « signal corrompu », pour la photosensibilité. ${s.media.length} médias chargés.</small><button type="button" class="d-btn sm" data-act="reload">Recharger les médias</button></div>`,
            'overlay',
          )
        : ''
    }
    ${
      a
        ? grp(
            'Sources OBS',
            'layers',
            `${urlRow('Toute l’ambiance', a.url)}${urlRow('L’araignée seule', layerUrl(a.url, 'spider'))}${urlRow('Chauves-souris et vignette', layerUrl(a.url, 'bats,vignette'))}
            <div class="d-row col" data-k="source navigateur obs"><small>Source navigateur 1920 × 1080, au-dessus de la scène, pas sur l’écran du jeu : seuls les viewers la voient. 0 min : vols seulement sur le bouton.</small></div>`,
            'source ambiance',
          )
        : ''
    }
    ${RULE_GROUPS.map((g) =>
      grp(
        g.title,
        'coin',
        `${g.rules
          .map((x) =>
            numrow(
              x.label,
              fld(
                `data-rule="${x.key}" min="0" step="${x.step ?? 1}" ${x.same ? 'placeholder="comme un sub"' : ''}`,
                shown(x),
              ),
              x.hint,
            ),
          )
          .join(
            '',
          )}<div class="d-row col" data-k="${esc(g.hint.toLowerCase())}"><small>${esc(g.hint)}</small></div>`,
        'règles bonbons',
      ),
    ).join('')}
    ${r ? '<div class="hw-apply"><button type="button" class="d-btn pri sm" data-act="save-rules">Enregistrer les règles</button></div>' : ''}`;
    if (!p.panel.body.contains(document.activeElement)) p.panel.set(html);
  }
  function paintLive() {
    paintHead();
    if (scene === 'stage') paintStage();
    if (scene === 'shop') paintShop();
    paintPanel();
  }
  function paintAdmin() {
    if (scene === 'shop') paintShop();
    if (scene === 'alerts') paintAlerts();
    if (scene === 'viewers') paintViewers();
    paintPanel();
  }
  function paint() {
    for (const el of p.body.querySelectorAll<HTMLElement>('[data-scene-z]'))
      el.hidden = el.dataset.sceneZ !== scene;
    paintLive();
    paintAdmin();
  }

  // --- Viewers ----------------------------------------------------------------------------------------------------------
  async function readPicked(id: string) {
    try {
      const h = await getJson<ViewerHistory>(
        `/api/halloween/admin/viewers/${id}`,
      );
      if (picked?.id === id) picked.h = h;
      findError = '';
    } catch (e) {
      findError = errorText(errText(e));
    }
    paintFinder();
  }
  async function find(q: string) {
    lastQuery = q;
    try {
      hits = await getJson<ViewerHit[]>(
        `/api/halloween/admin/viewers?q=${encodeURIComponent(q)}`,
      );
      findError = '';
    } catch (e) {
      findError = errorText(errText(e));
    }
    paintFinder();
  }

  // --- Interaction ------------------------------------------------------------------------------------------------------
  /** L'aperçu du Chaos sur la scène, le temps du survol : rien n'est envoyé. */
  p.body.addEventListener('pointerover', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-chaos-test]',
    )?.dataset.chaosTest;
    z('world').dataset.chaos = k
      ? k === 'flip'
        ? chaos.flipMode
        : `blur-${chaos.blurIntensity}`
      : '';
  });
  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    const a = b.dataset.act;
    if (b.dataset.scene) {
      scene = b.dataset.scene as Scene;
      return paint();
    }
    if (a === 'stop')
      return void act(
        b,
        () => postJson('/api/halloween/stop', {}),
        'Tout est arrêté.',
      );
    if (b.dataset.chaosSet) {
      const [k, v] = b.dataset.chaosSet.split(':');
      chaos = readChaos(chaos, k!, v!);
      return paintStage();
    }
    if (b.dataset.chaosTest) {
      const fx = b.dataset.chaosTest as 'flip' | 'blur';
      return void act(
        b,
        () =>
          postJson('/api/halloween/test', {
            effect: fx,
            params: chaosParams(fx, chaos),
          }),
        'Test envoyé à l’overlay.',
      );
    }
    if (b.dataset.testMedia || b.dataset.testEffect)
      return void act(
        b,
        () =>
          postJson(
            '/api/halloween/test',
            b.dataset.testMedia
              ? { media_id: b.dataset.testMedia }
              : { effect: b.dataset.testEffect },
          ),
        'Test envoyé à l’overlay.',
      );
    if (a === 'chaos-obs-prepare')
      return void act(
        b,
        () => postJson('/api/halloween/obs/prepare', {}),
        (o) =>
          (o.created as string[] | undefined)?.length
            ? `${(o.created as string[]).length} filtre(s) OBS créé(s), coupés.`
            : 'Filtres OBS déjà prêts.',
      );
    if (a === 'ambiance-bats')
      return void act(
        b,
        () => postJson('/api/halloween/ambiance/bats', {}),
        'Vol de chauves-souris lancé.',
      );
    if (a === 'reload')
      return void act(
        b,
        () => postJson('/api/halloween/media/reload', {}),
        'Médias rechargés.',
      );
    if (b.dataset.copyUrl) return copy(b.dataset.copyUrl, 'Adresse copiée');
    if (a === 'toggle-hw-alerts' && admin) {
      const on = rules()?.halloween_alerts === true;
      return void act(
        b,
        () =>
          postJson('/api/halloween/admin/settings', {
            rules: { halloween_alerts: !on },
          }),
        on
          ? 'Alertes habituelles rétablies.'
          : 'Alertes Halloween actives pour les vrais événements.',
      );
    }
    if (b.dataset.alertTest) {
      const body = alertTest(b.dataset.alertTest);
      if (body)
        void act(
          b,
          () => postJson('/api/alerts/test', body),
          'Alerte de test envoyée à la source OBS « Alertes ».',
        );
      return;
    }
    if (b.dataset.audience && admin)
      return void act(
        b,
        () =>
          postJson('/api/halloween/admin/settings', {
            rules: { extension_audience: b.dataset.audience },
          }),
        'Accès à l’extension enregistré.',
      );
    if (a === 'toggle-shop' && admin) {
      const on = admin.settings.enabled;
      void (async () => {
        if (
          on &&
          !(await confirmBox({
            title: 'Fermer la boutique ?',
            body: 'Rien n’est plus vendu ni gagné. L’effet en cours s’arrête, les achats pas encore joués sont remboursés. Les soldes sont gardés pour une prochaine édition.',
            yes: 'Fermer la boutique',
            no: 'Garder ouverte',
          }))
        )
          return;
        await act(
          b,
          () => postJson('/api/halloween/admin/settings', { enabled: !on }),
          on
            ? (o) =>
                `Événement fermé, soldes gardés${Number(o.refunded) ? `, ${Number(o.refunded)} achat(s) en attente remboursé(s)` : ''}.`
            : 'Événement ouvert.',
        );
      })();
      return;
    }
    if (a === 'save-rules') {
      const values: Record<string, string> = {};
      for (const i of p.panel.body.querySelectorAll<HTMLInputElement>(
        '[data-rule]',
      ))
        values[i.dataset.rule!] = i.value;
      return void act(
        b,
        () =>
          postJson('/api/halloween/admin/settings', {
            rules: rulesFromInputs(values),
          }),
        'Règles enregistrées.',
      );
    }
    if (b.dataset.pick) {
      picked = {
        id: b.dataset.pick,
        name: b.dataset.name ?? b.dataset.pick,
        h: null,
      };
      paintFinder();
      return void readPicked(picked.id);
    }
    if (b.matches('[data-tester]') && picked) {
      const id = picked.id;
      const list = testers();
      const on = !list.includes(id);
      void act(
        b,
        () =>
          postJson('/api/halloween/admin/settings', {
            rules: {
              extension_testers: on
                ? [...list, id]
                : list.filter((x) => x !== id),
            },
          }),
        on ? 'Ajouté aux testeurs de l’extension.' : 'Retiré des testeurs.',
      );
      return;
    }
    if (b.matches('[data-credit]') && picked) {
      const f = grantForm.elements;
      (f.namedItem('viewer') as HTMLInputElement).value = picked.id;
      delete grantForm.dataset.key;
      (f.namedItem('amount') as HTMLInputElement).focus();
      toast(`Créditer ${picked.name} : indique le montant.`);
    }
  });
  p.root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.ballon && admin) {
      const [kind, n] = t.dataset.ballon.split(':');
      const next = togglePool(
        rules()?.halloween_ballon,
        kind as keyof BallonPools,
        Number(n),
        t.checked,
      );
      if (!next) {
        t.checked = true;
        return void toast(LAST_BALLON);
      }
      return void act(
        null,
        () =>
          postJson('/api/halloween/admin/settings', {
            rules: { halloween_ballon: next },
          }),
        'Ballons enregistrés.',
      );
    }
    if (t.dataset.ambiance) {
      const patchSet = ambiancePatch(t.dataset.ambiance, t);
      if (patchSet)
        void act(
          null,
          () => postJson('/api/halloween/settings', { ambiance: patchSet }),
          'Ambiance enregistrée.',
        );
      return;
    }
    if (t.dataset.chaos) {
      chaos = readChaos(chaos, t.dataset.chaos, t.value);
      return;
    }
    const set = t.dataset.set;
    if (set) {
      const value =
        set === 'obs_chaos_source'
          ? t.value || null
          : set === 'volume'
            ? Number(t.value) / 100
            : set === 'display_id'
              ? t.value === ''
                ? null
                : Number(t.value)
              : t.checked;
      return void act(
        null,
        () => postJson('/api/halloween/settings', { [set]: value }),
        'Réglage enregistré.',
      );
    }
    const line = t.closest<HTMLElement>('[data-item]');
    const field = t.dataset.field;
    if (line && field) {
      const body =
        field === 'enabled'
          ? { enabled: t.checked }
          : field === 'label'
            ? { label: t.value.trim().slice(0, 40) || undefined }
            : field === 'price'
              ? { price: Math.max(1, Math.round(Number(t.value) || 1)) }
              : {
                  cooldown_ms:
                    Math.max(0, Math.round(Number(t.value) || 0)) * 1000,
                };
      t.blur();
      void act(
        null,
        () => postJson(`/api/halloween/admin/items/${line.dataset.item}`, body),
        'Catalogue enregistré.',
      );
    }
  });
  // Une saisie = une clé d'idempotence, gardée jusqu'à la réussite : un double clic ou un nouvel essai ne crédite jamais deux
  // fois. Changer un champ en fait une nouvelle saisie.
  p.root.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).closest('[data-form="grant"]'))
      delete grantForm.dataset.key;
  });
  p.root.addEventListener('submit', (e) => {
    const f = e.target as HTMLFormElement;
    if (f.matches('[data-form="find"]')) {
      e.preventDefault();
      return void find(String(new FormData(f).get('q') ?? '').trim());
    }
    if (!f.matches('[data-form="grant"]')) return;
    e.preventDefault();
    if (f.dataset.sending) return;
    const data = new FormData(f);
    const amount = Math.round(Number(data.get('amount')));
    if (!amount) return toast('Montant non nul requis.', { bad: true });
    const who = String(data.get('viewer')).trim();
    const btn = f.querySelector<HTMLElement>('button');
    f.dataset.sending = '1';
    void (async () => {
      const same = !!f.dataset.key;
      // Une confirmation explicite : une faute de frappe se voit ici, une erreur se corrige par un nouveau mouvement.
      if (
        !same &&
        !(await confirmBox({
          title: `${amount > 0 ? 'Donner' : 'Retirer'} ${Math.abs(amount)} Bonbons ${amount > 0 ? 'à' : 'de'} ${picked?.id === who ? picked.name : who} ?`,
          body: 'Mouvement réel, gardé au journal.',
          yes: amount > 0 ? 'Donner' : 'Retirer',
          no: 'Annuler',
          danger: amount < 0,
        }))
      ) {
        delete f.dataset.sending;
        return;
      }
      f.dataset.key ??= crypto.randomUUID();
      const note = String(data.get('note') ?? '').trim();
      const ok = await act(
        btn,
        () =>
          postJson('/api/halloween/admin/grant', {
            idempotency_key: f.dataset.key,
            viewer: who,
            amount,
            reason: data.get('reason') === 'raffle' ? 'raffle' : 'grant',
            ...(note ? { note } : {}),
          }),
        (o) =>
          `${amount > 0 ? '+' : ''}${amount} Bonbons attribués${o.replayed ? ' (déjà fait : rien de plus)' : ''}, solde ${String(o.balance ?? '?')}.`,
      );
      delete f.dataset.sending;
      // Échec ou réponse perdue : la même saisie garde sa clé, renvoyer ne crédite jamais deux fois.
      if (!ok) return;
      f.reset();
      delete f.dataset.key;
      if (picked) void readPicked(picked.id);
      if (lastQuery) void find(lastQuery);
    })();
  });

  return {
    setVisible(v: boolean) {
      if (v) {
        fast.start();
        slow.start();
      } else {
        fast.stop();
        slow.stop();
      }
    },
  };
}
