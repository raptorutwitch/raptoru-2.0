import { confirmBox, esc, fmt, ic, run, toast } from '../ds/ds.js';
import { getJson, postJson } from '../http.js';

// Studio › Chaos › Tarifs : la fourchette de prix (minimum, maximum) de chaque effet acheté depuis l'extension. Le Core
// est l'autorité : il vérifie, enregistre (réglages de module de la chaîne), calcule chaque devis et revérifie le prix à
// l'achat. Ce panneau n'invente aucun prix : son aperçu applique la place dans la fourchette que le Core donne pour
// chaque préréglage × force × durée (contrôles fins à leur valeur par défaut) aux montants en cours de saisie.

interface PreviewLine {
  style: string | null;
  level: string | null;
  durations: number[];
  shares: number[];
}
interface EffectPrice {
  id: string;
  label: string;
  min: number;
  max: number;
  default_min: number;
  default_max: number;
  custom: boolean;
  updated_at: string | null;
  updated_by: string | null;
  cap_share: number;
  preview: PreviewLine[];
}
interface Prices {
  bounds: { min: number; max: number; step: number };
  cap_s: number;
  effects: EffectPrice[];
}

/** Les noms que voient les viewers (catalogue de l'extension) ; un identifiant inconnu reste affiché tel quel. */
const NAMES: Record<string, string> = {
  rotate180: '180°',
  horizontal: 'Gauche ↔ droite',
  vertical: 'Haut ↔ bas',
  alterne: 'Alternance',
  leger: 'Léger',
  secousse: 'Secousse',
  vibration: 'Vibration',
  rafales: 'Par rafales',
  seisme: 'Séisme',
  impact: 'Impact',
  progressif: 'Progressif',
  brutal: 'Coup de zoom',
  pulsations: 'Pulsations',
  aller_retour: 'Zoom et dézoom',
  intermittent: 'Intermittent',
  pompette: 'Pompette',
  ivre: 'Ivre',
  ivre_mort: 'Ivre mort',
  vertige: 'Vertige',
  marque: 'Marqué',
  extreme: 'Extrême',
  naturel: 'Naturel',
  ponctuel: 'Un clignement',
  serie: 'Répétés',
  lent: 'Lent',
  fatigue: 'Somnolence',
  resistance: 'Lutte contre le sommeil',
  ferme: 'Yeux fermés',
  court: 'Court',
  intense: 'Intense',
  longue: 'Rémanence longue',
  nappes: 'Nappes',
  dense: 'Dense',
  constant: 'Constant',
  pulse: 'Pulsé',
  vague: 'Vague',
  constante: 'Constante',
  progressive: 'Progressive',
  intermittente: 'Intermittente',
  nb: 'Noir et blanc',
  film_noir: 'Film noir',
  sepia: 'Sépia',
  inversion: 'Négatif',
  delave: 'Délavé',
  sature: 'Saturé',
  rouge: 'Monochrome',
  legere: 'VHS légère',
  abimee: 'VHS abîmée',
  tracking: 'Tracking instable',
  glitch_bref: 'Glitch bref',
  glitch_violent: 'Glitch violent',
};
const LEVELS: Record<string, Record<string, string>> = {
  blink: { leger: 'Mi-closes', marque: 'Presque', extreme: 'Complètement' },
  fog: { marque: 'Marqué', dense: 'Dense', extreme: 'Occultant' },
};
const nameOf = (id: string | null) => (id ? (NAMES[id] ?? id) : '');
const levelName = (effect: string, id: string | null) =>
  id ? (LEVELS[effect]?.[id] ?? nameOf(id)) : '';

/** Même arrondi que le Core (catalog.ts `roundPrice`) : à 50 Jetons. */
const price = (lo: number, hi: number, share: number) =>
  Math.round((lo + (hi - lo) * share) / 50) * 50;
/** Espace fine insécable entre un nombre et son unité (comme chaos-perf.ts). */
const NB = ' ';
const J = (n: number) => `${fmt(n)}${NB}Jetons`;

const ERRORS: Record<string, string> = {
  min_above_max: 'Le minimum dépasse le maximum : rien n’a changé.',
  price_not_rounded:
    'Les montants vont par pas de 50 Jetons : rien n’a changé.',
  price_out_of_bounds: 'Entre 50 et 1 000 000 Jetons : rien n’a changé.',
  invalid_price: 'Montant invalide : rien n’a changé.',
  unknown_effect: 'Effet inconnu du serveur.',
  module_settings_unavailable:
    'Le serveur ne peut pas enregistrer de réglages pour l’instant.',
  core_unavailable:
    'Serveur injoignable : enregistrement non confirmé. Les tarifs sont relus dès son retour.',
  lab_core_unavailable:
    'Serveur injoignable : enregistrement non confirmé. Les tarifs sont relus dès son retour.',
};

export function mountPricesPanel(el: HTMLElement) {
  let st: Prices | null = null;
  let readError = false;
  let open = false;
  let pick = '';
  /** Saisie en cours par effet (non enregistrée) ; effacée quand le Core confirme. */
  const draft = new Map<string, { min: string; max: string }>();
  const pv = { style: '', level: '', dur: 10 };

  async function load() {
    try {
      st = await getJson<Prices>('/api/chaos-prices');
      readError = false;
    } catch {
      readError = true;
    }
    if (open) paint();
  }

  const eff = (id: string) => st?.effects.find((e) => e.id === id) ?? null;
  function typed(e: EffectPrice) {
    const d = draft.get(e.id);
    return { min: d?.min ?? String(e.min), max: d?.max ?? String(e.max) };
  }
  /** Le refus que le Core ferait, dit avant d'envoyer (le Core revérifie tout). */
  function check(e: EffectPrice): { lo: number; hi: number } | string {
    const b = st!.bounds;
    const t = typed(e);
    const lo = Number(t.min);
    const hi = Number(t.max);
    if (
      !t.min.trim() ||
      !t.max.trim() ||
      !Number.isInteger(lo) ||
      !Number.isInteger(hi)
    )
      return 'Montants entiers seulement.';
    if (lo < b.min || hi > b.max)
      return `Entre ${fmt(b.min)} et ${fmt(b.max)} Jetons.`;
    if (lo % b.step || hi % b.step) return `Par pas de ${b.step} Jetons.`;
    if (lo > hi) return 'Le minimum dépasse le maximum.';
    return { lo, hi };
  }

  function rowHtml(e: EffectPrice) {
    const t = typed(e);
    const dirty = t.min !== String(e.min) || t.max !== String(e.max);
    const ok = check(e);
    const when = e.updated_at
      ? `modifié ${new Date(e.updated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`
      : '';
    return `<div class="cx-price${pick === e.id ? ' is-open' : ''}" data-price="${esc(e.id)}">
      <button type="button" class="cx-price__name" data-price-pick="${esc(e.id)}" aria-expanded="${pick === e.id}">${esc(e.label)}</button>
      <label class="d-fld cx-price__in" title="Prix du réglage le plus doux, sur sa durée la plus courte"><input type="number" inputmode="numeric" step="50" min="50" max="1000000" data-pmin value="${esc(t.min)}" aria-label="Prix minimum de ${esc(e.label)}"><span>min</span></label>
      <label class="d-fld cx-price__in" title="Prix du réglage le plus sévère, sur sa durée la plus longue (60 s)"><input type="number" inputmode="numeric" step="50" min="50" max="1000000" data-pmax value="${esc(t.max)}" aria-label="Prix maximum de ${esc(e.label)}"><span>max</span></label>
      <span class="cx-price__now">${fmt(e.min)} – ${fmt(e.max)}${e.custom ? ` <span class="d-faint">· personnalisé${when ? `, ${esc(when)}` : ''}</span>` : ' <span class="d-faint">· par défaut</span>'}</span>
      <span class="cx-price__acts">
        <button type="button" class="d-btn sm ${dirty ? 'pri' : 'ghost'}" data-price-save="${esc(e.id)}" ${dirty && typeof ok !== 'string' ? '' : 'disabled'}>Enregistrer</button>
        <button type="button" class="d-btn ghost sm" data-price-reset="${esc(e.id)}" ${e.custom ? '' : 'disabled'} title="Défaut : ${fmt(e.default_min)} – ${fmt(e.default_max)}">Par défaut</button>
      </span>
      <p class="cx-price__msg" data-price-msg>${dirty ? (typeof ok === 'string' ? `<span class="cx-price__bad">${esc(ok)}</span>` : 'Non enregistré : l’aperçu suit ta saisie, l’extension garde les tarifs en vigueur.') : ''}</p>
      ${pick === e.id ? `<div class="cx-price__pv" data-pv>${previewHtml(e)}</div>` : ''}
    </div>`;
  }

  function line(e: EffectPrice) {
    return (
      e.preview.find(
        (l) => (l.style ?? '') === pv.style && (l.level ?? '') === pv.level,
      ) ?? e.preview[0]!
    );
  }

  /** Aperçu : préréglage, force, durée → prix, avec les montants saisis (ou ceux en vigueur s'ils sont invalides). */
  function previewHtml(e: EffectPrice) {
    const ok = check(e);
    const [lo, hi] = typeof ok === 'string' ? [e.min, e.max] : [ok.lo, ok.hi];
    const l = line(e);
    const i = Math.max(0, l.durations.indexOf(pv.dur));
    const d = l.durations[i]!;
    const styles = [...new Set(e.preview.map((x) => x.style))];
    const levels = [...new Set(e.preview.map((x) => x.level))];
    const sel = (
      attr: string,
      ids: (string | null)[],
      cur: string,
      name: (id: string | null) => string,
    ) =>
      ids.length > 1 || ids[0]
        ? `<label class="d-fld"><select ${attr}>${ids.map((id) => `<option value="${esc(id ?? '')}" ${(id ?? '') === cur ? 'selected' : ''}>${esc(name(id))}</option>`).join('')}</select></label>`
        : '';
    const cap = st!.cap_s;
    const at = (s: number) => {
      const k = l.durations.indexOf(s);
      return k < 0 ? null : price(lo, hi, l.shares[k]!);
    };
    const marks = [...new Set([l.durations[0]!, 10, 30, l.durations.at(-1)!])]
      .filter((s) => at(s) !== null)
      .map((s) => `<span>${s}${NB}s <b>${fmt(at(s))}</b></span>`)
      .join('');
    return `<div class="cx-price__ctl">
        ${sel('data-pv-style', styles, pv.style, nameOf)}
        ${sel('data-pv-level', levels, pv.level, (id) => levelName(e.id, id))}
        ${
          l.durations.length > 1
            ? `<input type="range" data-pv-dur min="0" max="${l.durations.length - 1}" step="1" value="${i}" aria-label="Durée"><span class="cx-price__dur">${d}${NB}s</span>`
            : `<span class="cx-price__dur">${d}${NB}s (durée fixe)</span>`
        }
        <strong class="cx-price__val">${J(price(lo, hi, l.shares[i]!))}</strong>
      </div>
      <p class="cx-price__marks">${marks}</p>
      <p class="d-faint cx-help">Dès ${J(lo)} (réglage le plus doux, durée la plus courte) · ${J(hi)} au plus sévère sur 60${NB}s · avec la Sécurité à ${cap}${NB}s, jusqu’à ${J(price(lo, hi, e.cap_share))}. ${d > cap ? `<b>${d}${NB}s n’est pas proposé tant que la Sécurité reste à ${cap}${NB}s.</b> ` : ''}Réglages fins (zoom, flou, taille des pixels…) à leur valeur par défaut : les pousser monte le prix, jamais au-delà du maximum.</p>`;
  }

  function paint() {
    if (!st) {
      el.innerHTML = `<header><h2>${ic('coin')}Tarifs</h2></header><p class="d-faint">${readError ? 'Tarifs illisibles : serveur injoignable. Nouvel essai à la prochaine ouverture.' : 'Lecture des tarifs…'}</p>`;
      return;
    }
    el.innerHTML = `<header><h2>${ic('coin')}Tarifs</h2><span class="d-faint">Prix d’une activation : min = réglage le plus doux et le plus court, max = le plus sévère sur 60${NB}s</span></header>
      ${readError ? '<p class="d-note">Serveur injoignable : les tarifs affichés sont peut-être dépassés.</p>' : ''}
      <div class="cx-prices__list">${st.effects.map(rowHtml).join('')}</div>
      <p class="d-faint cx-help">Le serveur vérifie et enregistre chaque fourchette, calcule chaque devis et revérifie le prix à l’achat : un viewer qui confirme un ancien prix est refusé sans être débité et voit le nouveau. Les achats déjà faits gardent leur prix ; un remboursement rend ce qui a été débité.</p>`;
  }

  /** Après une saisie : la ligne (boutons, message) et l'aperçu, sans redessiner les champs (le curseur reste). */
  function repaintRow(id: string) {
    const e = eff(id);
    const box = el.querySelector<HTMLElement>(
      `[data-price="${CSS.escape(id)}"]`,
    );
    if (!e || !box) return;
    const t = typed(e);
    const dirty = t.min !== String(e.min) || t.max !== String(e.max);
    const ok = check(e);
    const btn = box.querySelector<HTMLButtonElement>('[data-price-save]')!;
    btn.disabled = !dirty || typeof ok === 'string';
    btn.classList.toggle('pri', dirty);
    btn.classList.toggle('ghost', !dirty);
    box.querySelector<HTMLElement>('[data-price-msg]')!.innerHTML = dirty
      ? typeof ok === 'string'
        ? `<span class="cx-price__bad">${esc(ok)}</span>`
        : 'Non enregistré : l’aperçu suit ta saisie, l’extension garde les tarifs en vigueur.'
      : '';
    const p = box.querySelector<HTMLElement>('[data-pv]');
    if (p) p.innerHTML = previewHtml(e);
  }

  function choose(id: string) {
    const e = eff(id);
    pick = pick === id ? '' : id;
    if (e && pick) {
      const first = e.preview[0]!;
      pv.style = first.style ?? '';
      pv.level = first.level ?? '';
      pv.dur = first.durations.includes(10) ? 10 : first.durations[0]!;
    }
    paint();
  }

  async function save(btn: HTMLElement, id: string) {
    const e = eff(id);
    if (!e) return;
    const ok = check(e);
    if (typeof ok === 'string') return toast(ok, { bad: true });
    const done = await run(
      btn,
      async () => {
        st = await postJson<Prices>('/api/chaos-prices', {
          effect: id,
          min: ok.lo,
          max: ok.hi,
        });
        draft.delete(id);
      },
      `${e.label} : ${fmt(ok.lo)} – ${fmt(ok.hi)} Jetons enregistré. L’extension suit dans les secondes qui viennent.`,
      ERRORS,
    );
    // Refusé ou sans réponse : ce qui s'affiche est relu sur le serveur (jamais une valeur supposée enregistrée).
    if (!done) await load();
    else paint();
  }

  async function reset(btn: HTMLElement, id: string) {
    const e = eff(id);
    if (!e) return;
    const yes = await confirmBox({
      title: `Tarifs par défaut pour ${e.label} ?`,
      body: `${fmt(e.min)} – ${fmt(e.max)} Jetons sera remplacé par ${fmt(e.default_min)} – ${fmt(e.default_max)} Jetons. Les achats déjà faits gardent leur prix.`,
      yes: 'Restaurer',
      danger: false,
    });
    if (!yes) return;
    const done = await run(
      btn,
      async () => {
        st = await postJson<Prices>('/api/chaos-prices', {
          effect: id,
          reset: true,
        });
        draft.delete(id);
      },
      `${e.label} : tarifs par défaut rétablis (${fmt(e.default_min)} – ${fmt(e.default_max)} Jetons).`,
      ERRORS,
    );
    if (!done) await load();
    else paint();
  }

  el.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.pricePick) choose(b.dataset.pricePick);
    else if (b.dataset.priceSave) void save(b, b.dataset.priceSave);
    else if (b.dataset.priceReset) void reset(b, b.dataset.priceReset);
  });
  el.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    const id = t.closest<HTMLElement>('[data-price]')?.dataset.price;
    const e = id ? eff(id) : null;
    if (!e) return;
    if (t.matches('[data-pmin], [data-pmax]')) {
      const cur = typed(e);
      draft.set(e.id, {
        min: t.matches('[data-pmin]') ? t.value : cur.min,
        max: t.matches('[data-pmax]') ? t.value : cur.max,
      });
      return repaintRow(e.id);
    }
    if (t.matches('[data-pv-dur]')) {
      pv.dur = line(e).durations[Number(t.value)] ?? pv.dur;
      return repaintRow(e.id);
    }
  });
  el.addEventListener('change', (ev) => {
    const t = ev.target as HTMLSelectElement;
    const id = t.closest<HTMLElement>('[data-price]')?.dataset.price;
    const e = id ? eff(id) : null;
    if (!e || !t.matches('[data-pv-style], [data-pv-level]')) return;
    if (t.matches('[data-pv-style]')) pv.style = t.value;
    else pv.level = t.value;
    const l = line(e);
    if (!l.durations.includes(pv.dur))
      pv.dur = l.durations.includes(10) ? 10 : l.durations[0]!;
    repaintRow(e.id);
  });
  // Entrée dans un montant = Enregistrer.
  el.addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLElement;
    if (ev.key !== 'Enter' || !t.matches('[data-pmin], [data-pmax]')) return;
    const box = t.closest<HTMLElement>('[data-price]');
    const btn = box?.querySelector<HTMLButtonElement>('[data-price-save]');
    if (btn && !btn.disabled) void save(btn, box!.dataset.price!);
  });

  function toggle(on: boolean) {
    open = on;
    el.hidden = !on;
    if (on) {
      paint();
      void load();
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
  return { toggle: () => toggle(!open) };
}
