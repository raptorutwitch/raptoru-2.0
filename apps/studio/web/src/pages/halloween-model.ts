// Halloween (docs/HALLOWEEN.md) : ce qui se teste sans navigateur. Les réglages tels que le Core les garde, l'état du moteur en
// mots, le Chaos, l'ambiance, les alertes d'événement. Aucun DOM ici.
import { esc } from '../http.js';

export interface ChaosStatus {
  settings: { display_id: number | null; obs_chaos_source?: string | null };
  displays?: {
    id: number;
    label: string;
    bounds: { width: number; height: number };
    primary: boolean;
  }[];
  chaos?: {
    connected: boolean;
    obs_source: string | null;
    obs_connected: boolean;
    last: { at: string; screen: string; obs: string } | null;
  };
}
export interface ChaosObs {
  sources: string[];
  source: string | null;
  filters: Record<string, { present: boolean; enabled: boolean }> | null;
}
export interface ChaosChoice {
  flipMode: 'rotate' | 'mirror' | 'vertical';
  flipSeconds: number;
  blurIntensity: 'low' | 'medium' | 'high';
  blurSeconds: number;
}
export const CHAOS_DEFAULT: ChaosChoice = {
  flipMode: 'rotate',
  flipSeconds: 10,
  blurIntensity: 'medium',
  blurSeconds: 6,
};
export const FLIP_MODES: [ChaosChoice['flipMode'], string][] = [
  ['rotate', 'Retourné'],
  ['mirror', 'Miroir'],
  ['vertical', 'Vertical'],
];
export const BLUR_LEVELS: [ChaosChoice['blurIntensity'], string][] = [
  ['low', 'Faible'],
  ['medium', 'Moyen'],
  ['high', 'Fort'],
];

/** Les paramètres qu'un test envoie à l'overlay. */
export function chaosParams(effect: 'flip' | 'blur', c: ChaosChoice) {
  return effect === 'flip'
    ? { mode: c.flipMode, durationMs: Math.round(c.flipSeconds * 1000) }
    : {
        intensity: c.blurIntensity,
        durationMs: Math.round(c.blurSeconds * 1000),
      };
}

/** La partie OBS, en mots. */
export function obsLine(s: ChaosStatus, obs: ChaosObs | null) {
  if (!s.chaos?.obs_connected)
    return 'OBS non connecté à Studio : l’effet est sur ton écran seulement (les viewers voient l’écran normal).';
  if (!s.settings.obs_chaos_source)
    return 'Choisis la capture d’écran OBS : sans elle, les viewers voient l’écran normal.';
  if (!obs?.filters) return 'Lecture des filtres OBS…';
  const missing = Object.values(obs.filters).filter((f) => !f.present).length;
  return missing
    ? `${missing} filtre(s) OBS à préparer (bouton ci-dessous, hors live : OBS les crée puis Studio les coupe aussitôt).`
    : 'Filtres OBS prêts : les viewers voient le même effet.';
}

const opt = (v: string, label: string, on: boolean) =>
  `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
const segHtml = (
  field: string,
  list: readonly (readonly [string, string])[],
  cur: string,
) =>
  `<span class="d-seg block" style="--n:${list.length};--i:${Math.max(
    0,
    list.findIndex(([k]) => k === cur),
  )}" role="group">${list
    .map(
      ([k, l]) =>
        `<button type="button" data-chaos-set="${field}:${k}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${esc(l)}</button>`,
    )
    .join('')}</span>`;

/** Le Chaos : l'état réel de la fenêtre et d'OBS, écran retourné et flou, leurs tests gratuits, la partie viewers. */
export function chaosCard(
  s: ChaosStatus | null,
  c: ChaosChoice,
  obs: ChaosObs | null,
) {
  if (!s) return '<div class="d-skel hw-sk"></div>';
  const display =
    s.displays?.find((d) => d.id === s.settings.display_id) ??
    s.displays?.find((d) => d.primary);
  const screen = display
    ? `${display.label} (${display.bounds.width}×${display.bounds.height})`
    : 'écran principal';
  const on = !!s.chaos?.connected;
  const sources = obs?.sources ?? [];
  const chosen = s.settings.obs_chaos_source ?? '';
  const options = [
    opt('', 'Aucune : effet sur ton écran seulement', !chosen),
    ...(chosen && !sources.includes(chosen)
      ? [opt(chosen, `${chosen} (introuvable dans OBS)`, true)]
      : []),
    ...sources.map((x) => opt(x, x, x === chosen)),
  ].join('');
  const last = s.chaos?.last
    ? `Dernier effet : ${esc(s.chaos.last.screen)} à ${new Date(s.chaos.last.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, OBS ${esc(s.chaos.last.obs)}.`
    : 'Aucun effet depuis le démarrage de Studio.';
  const test = (k: string) =>
    `<button type="button" class="d-btn sm" data-chaos-test="${k}" ${on ? '' : 'disabled'}>Tester</button>`;
  return `<p class="hw-st ${on ? 'ok' : 'bad'}"><i class="d-dot ${on ? '' : 'r'}"></i>${on ? `Prêt sur tout l’écran « ${esc(screen)} »` : 'Fenêtre Chaos absente : overlay coupé, ou Studio lancé hors application'}</p>
    <div class="hw-chaos"><span>Écran retourné</span>${segHtml('flipMode', FLIP_MODES, c.flipMode)}<label class="d-fld"><input type="number" min="3" max="60" step="1" value="${c.flipSeconds}" data-chaos="flipSeconds" aria-label="Durée de l’écran retourné"><span>s</span></label>${test('flip')}</div>
    <div class="hw-chaos"><span>Flou</span>${segHtml('blurIntensity', BLUR_LEVELS, c.blurIntensity)}<label class="d-fld"><input type="number" min="2" max="30" step="1" value="${c.blurSeconds}" data-chaos="blurSeconds" aria-label="Durée du flou"><span>s</span></label>${test('blur')}</div>
    <div class="d-row"><span>Capture OBS</span><label class="d-fld hw-sel"><select data-set="obs_chaos_source" aria-label="Capture d’écran OBS" ${s.chaos?.obs_connected ? '' : 'disabled'}>${options}</select></label></div>
    <div class="hw-obs"><p class="d-note">${esc(obsLine(s, obs))}</p><button type="button" class="d-btn sm" data-act="chaos-obs-prepare" ${s.chaos?.obs_connected && chosen ? '' : 'disabled'}>Préparer les filtres OBS</button></div>
    <p class="d-note">${last} Souris et clavier passent, rien n’est modifié dans Windows. STOP ALL rend l’écran aussitôt.</p>`;
}

/** Un champ changé, borné comme l'overlay. */
export function readChaos(
  c: ChaosChoice,
  field: string,
  value: string,
): ChaosChoice {
  const n = (v: string, lo: number, hi: number, d: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  if (field === 'flipMode' && FLIP_MODES.some(([v]) => v === value))
    return { ...c, flipMode: value as ChaosChoice['flipMode'] };
  if (field === 'blurIntensity' && BLUR_LEVELS.some(([v]) => v === value))
    return { ...c, blurIntensity: value as ChaosChoice['blurIntensity'] };
  if (field === 'flipSeconds')
    return { ...c, flipSeconds: n(value, 3, 60, c.flipSeconds) };
  if (field === 'blurSeconds')
    return { ...c, blurSeconds: n(value, 2, 30, c.blurSeconds) };
  return c;
}

// --- Ambiance -------------------------------------------------------------------------------------------------------------

/** L'adresse de la source pour certains calques seulement (le jeton reste après le #). */
export function layerUrl(url: string, layers: string) {
  const [base, token] = url.split('#');
  return `${base}?layers=${layers}#${token ?? ''}`;
}
/** Un contrôle changé → le réglage envoyé. */
export function ambiancePatch(
  field: string,
  input: { checked: boolean; value: string },
) {
  if (field === 'bats_every_min')
    return {
      bats_every_min: Math.min(
        120,
        Math.max(0, Math.round(Number(input.value) || 0)),
      ),
    };
  if (field === 'vignette_strength')
    return {
      vignette_strength: Math.min(1, Math.max(0.1, Number(input.value) / 100)),
    };
  if (['enabled', 'spider', 'bats', 'vignette'].includes(field))
    return { [field]: input.checked };
  return null;
}

// --- Alertes d'événement --------------------------------------------------------------------------------------------------

export interface BallonPools {
  sub: number[];
  prime: number[];
  resub: number[];
}
export interface HalloweenAlertRules {
  halloween_alerts?: boolean;
  halloween_ballon?: BallonPools;
}
export interface CatalogVariant {
  id: string;
  missing?: string[];
}
export const BALLON_ALL: BallonPools = {
  sub: [1, 2, 3, 4],
  prime: [1, 2, 3, 4],
  resub: [1, 2, 3, 4],
};
/** Les tests gratuits : un événement simulé chacun, variante Halloween forcée. */
export const ALERT_TESTS: Record<string, Record<string, unknown>> = {
  follow: { type: 'follow' },
  sub: { type: 'sub', tier: '1000' },
  prime: { type: 'sub', tier: 'prime' },
  resub: { type: 'resub', tier: '1000', months: 13 },
  gift1: { type: 'gift_community', count: 1 },
  gift5: { type: 'gift_community', count: 5 },
  gift10: { type: 'gift_community', count: 10 },
  gift20: { type: 'gift_community', count: 20 },
  targeted: {
    type: 'gift_targeted',
    recipient: { display_name: 'Viewer Chanceux', login: 'viewer_chanceux' },
  },
};
export function alertTest(key: string) {
  const t = ALERT_TESTS[key];
  if (!t) return null;
  return {
    ...t,
    actor: { display_name: 'Testeur Halloween', login: 'testeur_halloween' },
    test_profile: 'halloween',
  };
}
/** Une case du Ballon : la même règle que la page Alertes (null = elle viderait le tirage). */
export { togglePool, LAST_BALLON } from './alerts-model.js';

// --- Règles de la boutique ------------------------------------------------------------------------------------------------

/** `scale` : gardé = affiché × scale ; `same` : vide = le montant du sub (gardé null). */
export interface Rule {
  key: string;
  label: string;
  hint: string;
  scale?: number;
  step?: number;
  same?: boolean;
}
export const RULE_GROUPS: { title: string; hint: string; rules: Rule[] }[] = [
  {
    title: 'Présence',
    hint: 'Minutes de présence validées pendant le live (bots exclus, pas le streamer). Événement fermé : rien n’est compté.',
    rules: [
      {
        key: 'presence_every_min',
        label: 'Toutes les … minutes',
        hint: '0 = désactivé',
      },
      { key: 'presence_bonbons', label: 'Bonbons par palier', hint: '' },
    ],
  },
  {
    title: 'Récompenses Twitch',
    hint: 'Payées une seule fois par événement Twitch : un resub n’est jamais payé deux fois.',
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
        label: 'Resub',
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
        label: 'Bits : un palier tous les',
        hint: '0 = désactivé',
      },
      { key: 'bits_bonbons', label: 'Bits : Bonbons par palier', hint: '' },
    ],
  },
  {
    title: 'Dons',
    hint: 'En euros seulement. Le pseudo tapé par le donateur doit correspondre exactement à un seul viewer Twitch connu, sinon personne n’est payé. StreamElements doit être actif dans Studio.',
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
    hint: 'Prix et récupération de chaque effet : dans le catalogue. Tombolas en Bonbons : page Tombola, événement ouvert.',
    rules: [
      {
        key: 'viewer_gap_ms',
        label: 'Attente entre deux achats (s)',
        scale: 1000,
        hint: 'tous les achats',
      },
      {
        key: 'viewer_screamer_gap_ms',
        label: 'Entre deux screamers d’un viewer (s)',
        scale: 1000,
        hint: '0 = désactivé',
      },
      {
        key: 'screamer_gap_ms',
        label: 'Écart minimal entre screamers (s)',
        scale: 1000,
        hint: 'tous viewers confondus',
      },
      {
        key: 'screamers_per_hour',
        label: 'Screamers maximum par heure',
        hint: '0 = screamers fermés',
      },
      {
        key: 'dock_reveal_ms',
        label: 'Dock OBS : montrer l’achat après (s)',
        scale: 1000,
        hint: 'depuis le début de l’effet ; 0 = aussitôt',
      },
    ],
  },
];
const RULES = RULE_GROUPS.flatMap((g) => g.rules);

/** Les règles écrites dans le panneau, telles que le Core les garde. */
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

// --- Moteur ---------------------------------------------------------------------------------------------------------------

export interface EngineView {
  environment: string | null;
  core: { connected: boolean; error: string | null } | null;
  page: { connected: boolean; ready: boolean };
  settings: { overlay_enabled: boolean };
}
/** L'état du moteur en mots. */
export function engineState(s: EngineView | null): {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
} {
  if (!s) return { tone: 'warn', text: 'Lecture…' };
  if (!s.settings.overlay_enabled)
    return { tone: 'warn', text: 'Overlay coupé' };
  if (!s.page.connected) return { tone: 'bad', text: 'Overlay absent' };
  if (!s.page.ready)
    return { tone: 'bad', text: 'Overlay incapable de lire les vidéos' };
  if (s.core && !s.core.connected)
    return { tone: 'warn', text: 'Overlay prêt, achats suspendus' };
  return {
    tone: 'ok',
    text: s.core
      ? 'Prêt, les achats sont joués'
      : 'Prêt, tests locaux seulement',
  };
}
export function errorText(code: string) {
  if (code === 'core_unavailable') return 'Raptoru indisponible sur ce profil.';
  if (code === 'core_unreachable' || /fetch failed/i.test(code))
    return 'Raptoru injoignable.';
  return code;
}
