// Halloween (docs/HALLOWEEN.md) — Studio's tab: the overlay engine (state, screen, volume, safe mode, local tests,
// STOP ALL) and the Core's shop (open / closed, rules, catalogue, Bonbons grants, what was bought). Every button here
// acts for real: a local test plays on the streamer's screen (an explicit click), the shop controls write the Core.

import {
  type ChaosObs,
  type ChaosStatus,
  CHAOS_DEFAULT,
  chaosCard,
  chaosParams,
  readChaos,
} from './halloween-chaos.js';
import {
  ambianceCard,
  ambiancePatch,
  type AmbianceStatus,
} from './halloween-ambiance.js';
import {
  alertTest,
  halloweenAlertsCard,
  togglePool,
  type CatalogVariant,
  type HalloweenAlertRules,
} from './halloween-alerts.js';
import { mountViewerFinder } from './halloween-viewer.js';
import {
  cauldronCard,
  cauldronFromForm,
  type CauldronSettings,
  type CauldronState,
  DEFAULT_CAULDRON,
} from './halloween-cauldron.js';

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

type Json = Record<string, unknown>;

interface Status {
  environment: string | null;
  core: { connected: boolean; error: string | null } | null;
  engine_ready: boolean;
  page: { connected: boolean; ready: boolean };
  settings: {
    overlay_enabled: boolean;
    display_id: number | null;
    volume: number;
    safe_mode: boolean;
    obs_chaos_source?: string | null;
  };
  chaos?: ChaosStatus['chaos'];
  ambiance?: AmbianceStatus['ambiance'];
  cauldron?: { url: string; connected: boolean };
  displays: {
    id: number;
    label: string;
    bounds: { width: number; height: number };
    primary: boolean;
  }[];
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

export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const KIND: Record<string, string> = {
  screamer: 'Screamer',
  apparition: 'Apparition',
  effect: 'Effet',
};
const STATUS: Record<string, string> = {
  queued: 'en attente',
  executing: 'en cours',
  completed: 'joué',
  failed: 'échec',
  unknown: 'fin inconnue',
};
const LEDGER: Record<string, string> = {
  grant: 'attribution manuelle',
  remove: 'retrait manuel',
  sub_reward: 'sub',
  gift_reward: 'subgift',
  convert: 'conversion (ancienne)',
  presence: 'présence',
  bits_reward: 'Bits',
  donation_reward: 'don',
  purchase: 'achat',
  refund: 'remboursement',
  raffle: 'tombola',
};
const EFFECT_LABEL: Record<string, string> = {
  blink: 'Clignement',
  fog: 'Brouillard',
  glitch: 'Signal corrompu',
  tunnel: 'Vision tunnel',
  eyes: 'Yeux dans le noir',
  silhouette: 'Silhouette',
  flip: 'Écran retourné',
  blur: 'Flou',
};
/**
 * Rules shown in the panel, by section (units for people: seconds, euros). `scale`: stored = shown × scale;
 * `same`: empty = the sub's amount (stored null).
 */
type Rule = {
  key: string;
  label: string;
  hint: string;
  scale?: number;
  step?: number;
  same?: boolean;
};
const RULE_GROUPS: { title: string; hint: string; rules: Rule[] }[] = [
  {
    title: 'Présence',
    hint: 'Minutes de présence validées pendant le live (comme la fidélité : bots exclus, pas le streamer). Événement fermé : rien n’est compté.',
    rules: [
      {
        key: 'presence_every_min',
        label: 'Toutes les … minutes de présence',
        hint: '0 = désactivé',
      },
      { key: 'presence_bonbons', label: 'Bonbons par palier', hint: '' },
    ],
  },
  {
    title: 'Récompenses Twitch',
    hint: 'Payées une seule fois par événement Twitch (un resub n’est jamais payé deux fois).',
    rules: [
      { key: 'sub_reward', label: 'Sub', hint: 'l’abonné' },
      {
        key: 'prime_reward',
        label: 'Sub Prime',
        hint: 'vide = comme un sub',
        same: true,
      },
      {
        key: 'resub_reward',
        label: 'Resub (message de réabonnement)',
        hint: 'vide = comme un sub',
        same: true,
      },
      {
        key: 'gift_giver_per_sub',
        label: 'Donateur, par sub offert',
        hint: 'anonyme : rien',
      },
      {
        key: 'gift_recipient',
        label: 'Bénéficiaire d’un sub offert',
        hint: '',
      },
      {
        key: 'bits_step',
        label: 'Bits : un palier tous les … Bits',
        hint: '0 = désactivé',
      },
      { key: 'bits_bonbons', label: 'Bits : Bonbons par palier', hint: '' },
    ],
  },
  {
    title: 'Dons (StreamElements)',
    hint: 'En euros seulement. Le pseudo tapé par le donateur doit correspondre exactement à un seul viewer Twitch connu, sinon personne n’est payé (voir le journal). StreamElements doit être en mode « actif » dans Studio.',
    rules: [
      {
        key: 'donation_per_euro',
        label: 'Bonbons par euro entier',
        hint: '0 = désactivé',
      },
      {
        key: 'donation_min_cents',
        label: 'Don minimum (€)',
        hint: '',
        scale: 100,
        step: 0.5,
      },
    ],
  },
  {
    title: 'Achats et limites',
    hint: 'Prix et récupération de chaque effet : catalogue ci-dessous. Cadeaux / retraits : « Bonbons » (motif Cadeau ou Tombola). Tombolas en Bonbons : onglet Tombola, monnaie « bonbons » (événement ouvert).',
    rules: [
      {
        key: 'viewer_gap_ms',
        label: 'Attente entre deux achats d’un viewer (s)',
        scale: 1000,
        hint: '',
      },
      {
        key: 'screamer_gap_ms',
        label: 'Écart minimal entre deux screamers (s)',
        scale: 1000,
        hint: '',
      },
      {
        key: 'screamers_per_hour',
        label: 'Screamers maximum par heure',
        hint: '0 = screamers fermés',
      },
      {
        key: 'dock_reveal_ms',
        label: 'Dock OBS : afficher l’achat après (s)',
        scale: 1000,
        hint: 'compté depuis le début réel de l’effet ; 0 = dès qu’il commence',
      },
    ],
  },
];
const RULES = RULE_GROUPS.flatMap((g) => g.rules);

/** The rules typed in the panel, as the Core stores them (pure, tested). */
export function rulesFromInputs(values: Record<string, string>) {
  const rules: Record<string, number | null> = {};
  for (const def of RULES) {
    const raw = (values[def.key] ?? '').trim();
    rules[def.key] =
      def.same && raw === ''
        ? null
        : Math.max(0, Math.round((Number(raw) || 0) * (def.scale ?? 1)));
  }
  return rules;
}
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

/** Engine state in words (pure, tested). */
export function engineState(s: Status | null): {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
} {
  if (!s) return { tone: 'warn', text: 'Chargement…' };
  if (!s.settings.overlay_enabled)
    return { tone: 'warn', text: 'Overlay désactivé' };
  if (!s.page.connected)
    return { tone: 'bad', text: 'Overlay absent (fenêtre non ouverte)' };
  if (!s.page.ready)
    return { tone: 'bad', text: 'Overlay incapable de lire les vidéos' };
  if (s.core && !s.core.connected)
    return {
      tone: 'warn',
      // Lab: the local Core is started by Studio (onglet Studio › Runtime local), its error is shown there.
      text:
        s.environment === 'lab'
          ? 'Overlay prêt · Core Lab injoignable (achats suspendus) — voir l’onglet Studio › Runtime local'
          : 'Overlay prêt · Core de Production injoignable (achats suspendus)',
    };
  return {
    tone: 'ok',
    text: s.core
      ? 'Prêt · les achats sont joués'
      : 'Prêt · tests locaux seulement (aucun Core)',
  };
}

export function overlayCard(s: Status | null) {
  if (!s) return '<p class="hw-hint">Chargement…</p>';
  const st = engineState(s);
  const displays = s.displays.length
    ? s.displays
        .map(
          (d) =>
            `<option value="${d.id}"${(s.settings.display_id ?? s.displays.find((x) => x.primary)?.id) === d.id ? ' selected' : ''}>${esc(d.label)} — ${d.bounds.width}×${d.bounds.height}${d.primary ? ' (principal)' : ''}</option>`,
        )
        .join('')
    : '<option value="">Écran principal</option>';
  const tests = [
    ...s.effects.map(
      (e) =>
        `<button type="button" class="hw-chip" data-test-effect="${esc(e)}">${esc(EFFECT_LABEL[e] ?? e)}</button>`,
    ),
    ...s.media.map(
      (m) =>
        `<button type="button" class="hw-chip ${m.kind === 'screamer' ? 'scream' : ''}" data-test-media="${esc(m.id)}" title="${esc(m.kind)}${m.duration_ms ? ` · ${(m.duration_ms / 1000).toFixed(1)} s` : ''}">${esc(m.label)}</button>`,
    ),
  ].join('');
  return `<div class="hw-state ${st.tone}"><span class="hw-dot"></span>${esc(st.text)}</div>
    ${s.current ? `<p class="hw-now">En cours : <b>${esc(s.current.label)}</b> · ${esc(s.current.viewer)} · ${esc(s.current.state)}</p>` : ''}
    <div class="hw-form">
      <label class="hw-check"><input type="checkbox" data-set="overlay_enabled"${s.settings.overlay_enabled ? ' checked' : ''}/> Overlay actif</label>
      <label>Écran <select data-set="display_id">${displays}</select></label>
      <label>Volume <input type="range" min="0" max="100" step="5" value="${Math.round(s.settings.volume * 100)}" data-set="volume"/> <span>${Math.round(s.settings.volume * 100)} %</span></label>
      <label class="hw-check"><input type="checkbox" data-set="safe_mode"${s.settings.safe_mode ? ' checked' : ''}/> Mode sûr (photosensibilité : pas de « signal corrompu »)</label>
    </div>
    <p class="hw-hint">${s.media.length} médias · <button type="button" class="hw-link" data-act="reload">Recharger les médias</button> · STOP ALL global : <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>F12</kbd></p>
    <details class="hw-tests"><summary>Tester sur mon écran (joue réellement, sans achat)</summary><div class="hw-chips">${tests}</div></details>
    <ul class="hw-log">${s.events
      .slice(0, 8)
      .map(
        (e) =>
          `<li class="${e.level === 'error' ? 'bad' : ''}"><time>${time(e.at)}</time> ${esc(e.text)}</li>`,
      )
      .join('')}</ul>`;
}

export function shopCard(a: Admin | null, error: string | null) {
  if (error)
    return `<p class="hw-hint bad">Boutique indisponible : ${esc(error)}</p>`;
  if (!a) return '<p class="hw-hint">Chargement…</p>';
  const r = a.settings.rules;
  const testersOnly = r.extension_audience === 'testers';
  const testers = r.extension_testers ?? [];
  const shown = (x: Rule) => {
    const v = (r as Record<string, number | null | undefined>)[x.key];
    return v == null ? (x.same ? '' : 0) : v / (x.scale ?? 1);
  };
  const rules = RULE_GROUPS.map(
    (g) =>
      `<fieldset class="hw-rules"><legend>${esc(g.title)}</legend><p class="hw-hint">${esc(g.hint)}</p>${g.rules
        .map(
          (x) =>
            `<label><span>${esc(x.label)}${x.hint ? ` <small>${esc(x.hint)}</small>` : ''}</span><input type="number" min="0" step="${x.step ?? 1}" data-rule="${x.key}" value="${shown(x)}"${x.same ? ' placeholder="comme un sub"' : ''}/></label>`,
        )
        .join('')}</fieldset>`,
  ).join('');
  return `<div class="hw-open ${a.settings.enabled ? 'on' : ''}">
      <div><b>Boutique ${a.settings.enabled ? 'OUVERTE' : 'fermée'}</b> <small>saison ${esc(a.settings.season)}</small>
        <p class="hw-hint">${a.settings.enabled ? 'Les viewers voient « Événements », gagnent et dépensent des Bonbons ; !peur et !bonbons répondent, !solde montre les Bonbons.' : 'Fermé : rien n’est vendu ni gagné ; module et commandes masqués ; les soldes sont gardés pour une prochaine édition. Fermer rembourse les achats pas encore joués.'}</p></div>
      <button type="button" class="${a.settings.enabled ? '' : 'primary'}" data-act="toggle-shop">${a.settings.enabled ? 'Fermer la boutique' : 'Ouvrir la boutique'}</button>
    </div>
    <div class="hw-access"><b>Module « Événements » dans l'extension</b>
      <div class="seg"><button type="button" data-audience="all" class="${testersOnly ? '' : 'on'}">Tous les viewers</button><button type="button" data-audience="testers" class="${testersOnly ? 'on' : ''}">Testeurs seulement</button></div>
      <p class="hw-hint">${testersOnly ? `${testers.length} testeur${testers.length > 1 ? 's' : ''} (ajouter / retirer : « Trouver un viewer »). Les autres ne voient pas le module ; le chat (!peur, !bonbons) et les gains restent ouverts à tous.` : 'Tous les viewers de l’extension publiée voient le module pendant l’événement.'}</p></div>
    ${rules}
    <button type="button" class="primary" data-act="save-rules">Enregistrer les règles</button>`;
}

/**
 * The catalogue. `onPc`: the media ids this Studio holds (null: not known yet). An enabled item whose video is not on
 * this PC cannot be sold (the Core refuses it, media_missing): it is flagged, with how to install the media.
 */
export function catalogueCard(a: Admin | null, onPc: string[] | null = null) {
  if (!a) return '';
  const missing = onPc
    ? a.items.filter(
        (i) => i.enabled && i.media_id && !onPc.includes(i.media_id),
      )
    : [];
  const warn = missing.length
    ? `<p class="hw-warn">⚠ ${missing.length} vidéo${missing.length > 1 ? 's' : ''} du catalogue absente${missing.length > 1 ? 's' : ''} de ce PC (non vendue${missing.length > 1 ? 's' : ''}) : ${missing
        .slice(0, 6)
        .map((i) => esc(i.label))
        .join(
          ', ',
        )}${missing.length > 6 ? '…' : ''}. Installer les médias : <code>halloween-media-install.mjs</code> (docs/HALLOWEEN.md § 5), puis « Recharger les médias ».</p>`
    : '';
  const rows = a.items
    .map(
      (
        i,
      ) => `<tr data-item="${esc(i.item_id)}" class="${i.enabled ? '' : 'off'}">
      <td><input type="checkbox" data-field="enabled"${i.enabled ? ' checked' : ''} aria-label="Activé"/></td>
      <td><input type="text" maxlength="40" data-field="label" value="${esc(i.label)}"/></td>
      <td><span class="hw-kind ${i.kind}">${KIND[i.kind]}</span>${missing.includes(i) ? ' <small class="hw-missing">absent du PC</small>' : ''}</td>
      <td><input type="number" min="1" max="100000" data-field="price" value="${i.price}"/></td>
      <td><input type="number" min="0" max="86400" data-field="cooldown" value="${Math.round(i.cooldown_ms / 1000)}"/></td>
      <td><button type="button" class="hw-small" ${i.media_id ? `data-test-media="${esc(i.media_id)}"` : `data-test-effect="${esc(i.effect)}"`}>Tester</button></td>
    </tr>`,
    )
    .join('');
  return `${warn}<table class="hw-table"><thead><tr><th>On</th><th>Nom affiché</th><th>Type</th><th>Prix (Bonbons)</th><th>Cooldown (s)</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hw-hint">Chaque changement est enregistré dans le Core dès que tu quittes le champ.</p>`;
}

export function bonbonsCard(a: Admin | null) {
  if (!a) return '';
  const purchases = a.purchases
    .slice(0, 12)
    .map(
      (p) =>
        `<li><time>${time(p.created_at)}</time> <b>${esc(p.viewer.name)}</b> · ${esc(p.label)} · ${p.price} 🍬 · <span class="hw-st ${esc(p.status)}">${esc(STATUS[p.status] ?? p.status)}${p.refund_status === 'refunded' ? ' · remboursé' : ''}</span>${p.error ? ` <small>(${esc(p.error)})</small>` : ''}</li>`,
    )
    .join('');
  const ledger = a.ledger
    .slice(0, 14)
    .map(
      (l) =>
        `<li><time>${time(l.created_at)}</time> <b>${esc(l.viewer.name)}</b> ${l.amount > 0 ? '+' : ''}${l.amount} 🍬 <small>${esc(LEDGER[l.kind] ?? l.kind)} → ${l.balance_after}</small></li>`,
    )
    .join('');
  return `<p class="hw-hint">${a.totals.bonbons} Bonbons en circulation · ${a.totals.wallets} viewers</p>
    <form class="hw-grant" data-form="grant">
      <input name="viewer" required maxlength="64" placeholder="Pseudo Twitch" aria-label="Pseudo"/>
      <input name="amount" required type="number" min="-100000" max="100000" step="1" placeholder="Bonbons (+/-)" aria-label="Bonbons"/>
      <select name="reason" aria-label="Motif"><option value="grant">Cadeau</option><option value="raffle">Tombola</option></select>
      <input name="note" maxlength="200" placeholder="Note (facultatif)" aria-label="Note"/>
      <button type="submit" class="primary">Attribuer</button>
    </form>
    <div class="hw-cols"><div><h4>Achats</h4><ul class="hw-log">${purchases || '<li class="hw-hint">Aucun achat.</li>'}</ul></div>
    <div><h4>Mouvements</h4><ul class="hw-log">${ledger || '<li class="hw-hint">Aucun mouvement.</li>'}</ul></div></div>`;
}

/** What an error means for the streamer (the Core's codes stay readable for the rest). */
export function errorText(code: string) {
  if (code === 'core_unavailable') return 'aucun Core pour ce profil';
  if (code === 'core_unreachable' || /fetch failed/i.test(code))
    return 'Core injoignable — en Lab, voir l’onglet Studio › Runtime local (le Core local démarre-t-il ?)';
  return code;
}

export function mountHalloween(root: HTMLElement) {
  let status: Status | null = null;
  let admin: Admin | null = null;
  let adminError: string | null = null;
  let alertCatalog: CatalogVariant[] | null = null;
  let cauldron: CauldronState | null = null;
  const cauldronOf = (): CauldronSettings | null =>
    admin
      ? {
          ...DEFAULT_CAULDRON,
          ...((admin.settings.rules as Record<string, unknown>).cauldron as
            Partial<CauldronSettings> | undefined),
        }
      : null;
  const saveCauldron = (patch: Partial<CauldronSettings>, ok: string) =>
    act(
      () =>
        call('/api/halloween/admin/settings', {
          rules: { cauldron: { ...cauldronOf()!, ...patch } },
        }),
      ok,
    );
  const hwRules = () =>
    (admin?.settings.rules ?? null) as HalloweenAlertRules | null;
  let visible = false;
  let flash = '';
  let chaos = CHAOS_DEFAULT;
  let chaosObs: ChaosObs | null = null;
  root.innerHTML = `<div class="hw">
    <header class="hw-head"><h2>🎃 Halloween</h2><span class="hw-flash" data-role="flash"></span>
      <button type="button" class="hw-stop" data-act="stop" title="Arrête immédiatement tout effet (Ctrl+Maj+F12)">STOP ALL</button></header>
    <div class="hw-grid">
      <section class="card"><h3>Overlay sur mon écran</h3><div data-role="overlay"></div></section>
      <section class="card"><h3>Chaos — écran retourné et flou</h3><div data-role="chaos"></div></section>
      <section class="card"><h3>Ambiance OBS (pour les viewers)</h3><div data-role="ambiance"></div></section>
      <section class="card"><h3>Chaudron des subs <em>Lab</em></h3><div data-role="cauldron"></div></section>
      <section class="card wide"><h3>Alertes Halloween (Twitch)</h3><div data-role="hw-alerts"></div></section>
      <section class="card"><h3>Boutique</h3><div data-role="shop"></div></section>
      <section class="card wide"><h3>Catalogue</h3><div data-role="catalogue"></div></section>
      <section class="card wide"><h3>Trouver un viewer</h3><div data-role="viewer"></div></section>
      <section class="card wide"><h3>Bonbons</h3><div data-role="bonbons"></div></section>
    </div></div>`;
  const part = (role: string) =>
    root.querySelector<HTMLElement>(`[data-role="${role}"]`)!;
  const say = (text: string) => {
    flash = text;
    part('flash').textContent = flash;
    setTimeout(() => {
      if (flash === text) part('flash').textContent = '';
    }, 4000);
  };
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new Error(String(out.error ?? `HTTP ${res.status}`));
    return out;
  };
  // A part is redrawn only when its content changed and nothing in it is being edited: no blinking, a typed value or
  // an open « Tester » section stays as it is between two refreshes.
  // Being edited = a text field, a number, a list or a text area in focus there (a clicked button keeps the focus too,
  // but must never freeze its card).
  const editing = (role: string) => {
    const el = document.activeElement;
    return (
      !!el &&
      part(role).contains(el) &&
      el.matches(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), select, textarea',
      )
    );
  };
  const painted = new Map<string, string>();
  const paint = (role: string, html: string) => {
    if (painted.get(role) === html || editing(role)) return;
    const el = part(role);
    const open = [...el.querySelectorAll('details')].map((d) => d.open);
    el.innerHTML = html;
    el.querySelectorAll('details').forEach((d, i) => {
      if (open[i]) d.open = true;
    });
    painted.set(role, html);
  };
  const renderStatus = () => {
    paint('overlay', overlayCard(status));
    paint('chaos', chaosCard(status, chaos, chaosObs));
    paint('ambiance', ambianceCard(status));
  };
  const renderAdmin = () => {
    paint('shop', shopCard(admin, adminError));
    paint(
      'catalogue',
      catalogueCard(admin, status ? status.media.map((m) => m.id) : null),
    );
    paint('bonbons', bonbonsCard(admin));
    paint(
      'hw-alerts',
      halloweenAlertsCard(hwRules(), alertCatalog, adminError),
    );
    paint(
      'cauldron',
      cauldronCard(cauldronOf(), cauldron, status?.cauldron ?? null),
    );
  };
  const loadStatus = async () => {
    try {
      status = (await call('/api/halloween/status')) as unknown as Status;
    } catch {
      status = null;
    }
    renderStatus();
  };
  const loadAdmin = async () => {
    try {
      admin = (await call('/api/halloween/admin')) as unknown as Admin;
      adminError = null;
    } catch (e) {
      adminError = errorText((e as Error).message);
    }
    // Chaos in OBS: the screen captures and the filters on the chosen one (OBS absent: nothing to show).
    chaosObs = await call('/api/halloween/obs').then(
      (r) => r as unknown as ChaosObs,
      () => null,
    );
    renderStatus();
    // The Halloween alert variants and whether their media are on this PC (the Alerts tab's catalogue).
    alertCatalog = await call('/api/alerts/catalog').then(
      (r) => (r.variants as CatalogVariant[]) ?? null,
      () => null,
    );
    cauldron = await call('/api/halloween/cauldron').then(
      (r) => r as unknown as CauldronState,
      () => null,
    );
    renderAdmin();
  };
  const act = async (
    fn: () => Promise<Json>,
    ok: string | ((out: Json) => string),
  ) => {
    let done = false;
    try {
      const out = await fn();
      say(typeof ok === 'string' ? ok : ok(out));
      done = true;
    } catch (e) {
      say(`Refusé : ${errorText((e as Error).message)}`);
    }
    await Promise.all([loadStatus(), loadAdmin()]);
    return done;
  };

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const a = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const media =
      t.closest<HTMLElement>('[data-test-media]')?.dataset.testMedia;
    const effect =
      t.closest<HTMLElement>('[data-test-effect]')?.dataset.testEffect;
    const chaosTest = t.closest<HTMLElement>('[data-chaos-test]')?.dataset
      .chaosTest as 'flip' | 'blur' | undefined;
    if (a === 'stop')
      void act(() => call('/api/halloween/stop', {}), 'Tout est arrêté.');
    else if (a === 'cauldron-toggle' && admin)
      void saveCauldron(
        { enabled: !cauldronOf()!.enabled },
        cauldronOf()!.enabled ? 'Chaudron désactivé.' : 'Chaudron activé.',
      );
    else if (
      a === 'cauldron-start' &&
      admin &&
      confirm(
        'Repartir de zéro maintenant ? Seuls les abonnements à partir de maintenant compteront.',
      )
    )
      void saveCauldron(
        { since: new Date().toISOString(), adjust: 0 },
        'Chaudron : nouveau départ, 0 abonnement.',
      );
    else if (a === 'cauldron-fix' && admin) {
      const input = part('cauldron').querySelector<HTMLInputElement>(
        '[data-role="cauldron-fix"]',
      );
      const d = Math.round(Number(input?.value));
      if (!d) say('Indique une correction (+ ou −).');
      else
        void saveCauldron(
          { adjust: cauldronOf()!.adjust + d },
          `Chaudron corrigé de ${d > 0 ? '+' : ''}${d}.`,
        );
    } else if (a === 'cauldron-test-sub' || a === 'cauldron-test-goal')
      void act(
        () =>
          call('/api/halloween/cauldron/test', {
            kind: a === 'cauldron-test-goal' ? 'goal' : 'sub',
          }),
        'Test envoyé au chaudron (le compteur ne bouge pas).',
      );
    else if (a === 'chaos-obs-prepare')
      void act(
        () => call('/api/halloween/obs/prepare', {}),
        (out: Json) =>
          (out.created as string[] | undefined)?.length
            ? `${(out.created as string[]).length} filtre(s) OBS créé(s), coupés.`
            : 'Filtres OBS déjà prêts.',
      );
    else if (a === 'toggle-hw-alerts' && admin) {
      const on = hwRules()?.halloween_alerts === true;
      void act(
        () =>
          call('/api/halloween/admin/settings', {
            rules: { halloween_alerts: !on },
          }),
        on
          ? 'Alertes habituelles rétablies.'
          : 'Alertes Halloween actives pour les vrais événements.',
      );
    } else if (t.closest('[data-alert-test]')) {
      const body = alertTest(
        t.closest<HTMLElement>('[data-alert-test]')!.dataset.alertTest!,
      );
      if (body)
        void act(
          () => call('/api/alerts/test', body),
          'Alerte de test envoyée à la source OBS « Alertes ».',
        );
    } else if (a === 'ambiance-bats')
      void act(
        () => call('/api/halloween/ambiance/bats', {}),
        'Vol de chauves-souris lancé.',
      );
    else if (chaosTest)
      void act(
        () =>
          call('/api/halloween/test', {
            effect: chaosTest,
            params: chaosParams(chaosTest, chaos),
          }),
        'Test envoyé à l’overlay.',
      );
    else if (a === 'reload')
      void act(
        () => call('/api/halloween/media/reload', {}),
        'Médias rechargés.',
      );
    else if (t.closest('[data-audience]') && admin)
      void act(
        () =>
          call('/api/halloween/admin/settings', {
            rules: {
              extension_audience:
                t.closest<HTMLElement>('[data-audience]')!.dataset.audience,
            },
          }),
        'Accès à l’extension enregistré.',
      );
    else if (a === 'toggle-shop' && admin)
      void act(
        () =>
          call('/api/halloween/admin/settings', {
            enabled: !admin!.settings.enabled,
          }),
        admin.settings.enabled
          ? (out: Json) =>
              `Événement fermé : soldes gardés${Number(out.refunded) ? `, ${Number(out.refunded)} achat(s) en attente remboursé(s)` : ''}.`
          : 'Événement ouvert.',
      );
    else if (a === 'save-rules') {
      const values: Record<string, string> = {};
      for (const input of part('shop').querySelectorAll<HTMLInputElement>(
        '[data-rule]',
      ))
        values[input.dataset.rule!] = input.value;
      const rules = rulesFromInputs(values);
      void act(
        () => call('/api/halloween/admin/settings', { rules }),
        'Règles enregistrées.',
      );
    } else if (media || effect)
      void act(
        () =>
          call('/api/halloween/test', media ? { media_id: media } : { effect }),
        'Test envoyé à l’overlay.',
      );
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.ballon && admin) {
      const [kind, n] = t.dataset.ballon.split(':');
      void act(
        () =>
          call('/api/halloween/admin/settings', {
            rules: {
              halloween_ballon: togglePool(
                hwRules()?.halloween_ballon,
                kind as 'sub' | 'prime' | 'resub',
                Number(n),
                t.checked,
              ),
            },
          }),
        'Ballons enregistrés.',
      );
      return;
    }
    if (t.dataset.ambiance) {
      const patch = ambiancePatch(t.dataset.ambiance, t);
      if (patch)
        void act(
          () => call('/api/halloween/settings', { ambiance: patch }),
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
      void act(
        () => call('/api/halloween/settings', { [set]: value }),
        'Réglage enregistré.',
      );
      return;
    }
    const row = t.closest<HTMLElement>('[data-item]');
    const field = t.dataset.field;
    if (row && field) {
      const patch =
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
        () => call(`/api/halloween/admin/items/${row.dataset.item}`, patch),
        'Catalogue enregistré.',
      );
    }
  });
  // « Trouver un viewer »: its own card (never redrawn by the refresh); « Créditer » fills the credit form below.
  const finder = mountViewerFinder(
    part('viewer'),
    call,
    (id, name) => {
      const form = part('bonbons').querySelector<HTMLFormElement>(
        '[data-form="grant"]',
      );
      if (!form) return;
      (form.elements.namedItem('viewer') as HTMLInputElement).value = id;
      delete form.dataset.key;
      say(`Créditer ${name} : indique le montant.`);
      (form.elements.namedItem('amount') as HTMLInputElement).focus();
    },
    errorText,
    {
      is: (id) =>
        admin?.settings.rules.extension_audience === 'testers'
          ? (admin.settings.rules.extension_testers ?? []).includes(id)
          : null,
      toggle: (id) => {
        const list = admin?.settings.rules.extension_testers ?? [];
        const on = !list.includes(id);
        return act(
          () =>
            call('/api/halloween/admin/settings', {
              rules: {
                extension_testers: on
                  ? [...list, id]
                  : list.filter((x) => x !== id),
              },
            }),
          on ? 'Ajouté aux testeurs de l’extension.' : 'Retiré des testeurs.',
        );
      },
    },
  );
  // One credit entry = one idempotency key, kept until it succeeds (a double click or a retry never credits twice);
  // changing a field makes it a new entry.
  root.addEventListener('input', (ev) => {
    const form = (ev.target as HTMLElement).closest<HTMLFormElement>(
      '[data-form="grant"]',
    );
    if (form) delete form.dataset.key;
  });
  root.addEventListener('submit', (ev) => {
    const cf = (ev.target as HTMLElement).closest<HTMLFormElement>(
      '[data-form="cauldron"]',
    );
    if (cf && admin) {
      ev.preventDefault();
      const f = new FormData(cf);
      const next = cauldronFromForm(cauldronOf()!, {
        title: String(f.get('title') ?? ''),
        goal: String(f.get('goal') ?? ''),
        count_resubs: f.get('count_resubs') === 'on',
      });
      void saveCauldron(next, 'Chaudron enregistré.');
      return;
    }
    const form = (ev.target as HTMLElement).closest<HTMLFormElement>(
      '[data-form="grant"]',
    );
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.sending) return;
    const f = new FormData(form);
    const amount = Math.round(Number(f.get('amount')));
    if (!amount) return say('Montant non nul requis.');
    const who = String(f.get('viewer')).trim();
    // An explicit confirmation (a typo in the amount is caught here; a mistake is corrected by a new movement).
    if (
      !form.dataset.key &&
      !confirm(
        `${amount > 0 ? 'Donner' : 'Retirer'} ${Math.abs(amount)} Bonbons ${amount > 0 ? 'à' : 'de'} ${who} ?`,
      )
    )
      return;
    form.dataset.key ??= crypto.randomUUID();
    form.dataset.sending = '1';
    void act(
      () =>
        call('/api/halloween/admin/grant', {
          idempotency_key: form.dataset.key,
          viewer: String(f.get('viewer')).trim(),
          amount,
          reason: f.get('reason') === 'raffle' ? 'raffle' : 'grant',
          ...(String(f.get('note') ?? '').trim()
            ? { note: String(f.get('note')).trim() }
            : {}),
        }),
      (out) =>
        `${amount > 0 ? '+' : ''}${amount} Bonbons attribués${out.replayed ? ' (déjà fait : rien de plus)' : ''} · solde ${String(out.balance ?? '?')}.`,
    ).then((done) => {
      delete form.dataset.sending;
      // Failed (or unknown): the same entry keeps its key — sending it again can never credit twice.
      if (!done) return;
      form.reset();
      delete form.dataset.key;
      finder.refresh();
    });
  });

  setInterval(() => {
    if (visible) void loadStatus();
  }, 1500);
  setInterval(() => {
    if (visible) void loadAdmin();
  }, 5000);
  return {
    setVisible(v: boolean) {
      visible = v;
      if (v) void Promise.all([loadStatus(), loadAdmin()]);
    },
  };
}
