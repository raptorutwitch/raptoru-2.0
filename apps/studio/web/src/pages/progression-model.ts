// Progression : ce qui se teste sans navigateur. La courbe n'est calculée ici que pour montrer un réglage pas encore appliqué ;
// après « Appliquer », le Core recalcule les niveaux avec sa propre formule (core-api/src/progression/service.ts, xpForLevel).
import { esc } from '../http.js';

export interface Rules {
  xp_per_minute: number;
  message_xp: number;
  message_cooldown_s: number;
  message_min_chars: number;
  live_only: boolean;
  curve_base: number;
  curve_exponent: number;
  excluded_logins?: string[];
}

export const curveXp = (
  level: number,
  r: Pick<Rules, 'curve_base' | 'curve_exponent'>,
) =>
  level <= 1 ? 0 : Math.round(r.curve_base * (level - 1) ** r.curve_exponent);

/** La courbe du Core qui passe par deux points tirés à la souris, dans les limites qu'il accepte. */
export function fitCurve(
  a: { level: number; xp: number },
  b: { level: number; xp: number },
) {
  const ya = Math.max(1, a.xp);
  const yb = Math.max(ya + 1, b.xp);
  const raw = Math.log(yb / ya) / Math.log((b.level - 1) / (a.level - 1));
  const curve_exponent = Math.round(Math.min(3, Math.max(1, raw)) * 100) / 100;
  const curve_base = Math.round(
    Math.min(100_000, Math.max(1, yb / (b.level - 1) ** curve_exponent)),
  );
  return { curve_base, curve_exponent };
}

/** Les heures de présence seule pour une quantité d'XP ; null si la présence ne rapporte rien. */
export const hoursFor = (xp: number, perMinute: number) =>
  perMinute > 0 ? xp / perMinute / 60 : null;

/** Refonte H14 : les paliers du Daily (Jetons par stream d'affilée ; le dernier se répète). */
export interface DailySteps {
  steps: number[];
  default_steps: number[];
  bounds: { max_steps: number; max_value: number };
  /** Fixe (décision H14) : montrée, jamais modifiée. */
  reset_time: string;
}

export const dailyLabel = (i: number, last: boolean) =>
  `${i + 1}${i ? 'e' : 'er'} stream${last ? ' et suivants' : ''}`;

/** Une marche par stream d'affilée : on tire sa hauteur, ou on écrit le montant dessous. */
export function dailyHtml(d: DailySteps | null) {
  if (!d) return '<p class="d-empty">Paliers indisponibles sur ce profil.</p>';
  const top = Math.max(1, ...d.steps, ...d.default_steps);
  const changed = d.steps.join(',') !== d.default_steps.join(',');
  return `<div class="pg-steps" data-steps style="--n:${d.steps.length}">${d.steps
    .map(
      (v, i) =>
        `<div class="pg-step"><button type="button" class="pg-grip" data-dgrip="${i}" style="--h:${(v / top) * 100}%" aria-label="Tirer le montant : ${esc(dailyLabel(i, i === d.steps.length - 1))}"><b>${v.toLocaleString('fr-FR')}</b></button><label class="d-fld"><input type="number" min="0" max="${d.bounds.max_value}" step="1" value="${v}" data-daily-step="${i}" aria-label="${esc(dailyLabel(i, i === d.steps.length - 1))}, en Jetons"></label><small>${i + 1}${i === d.steps.length - 1 ? ' +' : ''}</small></div>`,
    )
    .join('')}</div>
    <p class="d-note">Jetons reçus avec <code>!daily</code> selon le nombre de streams d’affilée. Le dernier palier se répète. Remise à zéro fixe : <b>${esc(d.reset_time)}</b>. De 1 à ${d.bounds.max_steps} paliers, ${d.bounds.max_value.toLocaleString('fr-FR')} Jetons au plus chacun, jamais en baisse d’un palier au suivant.${changed ? ` Paliers modifiés (d’origine : ${d.default_steps.join(' · ')}).` : ''}</p>`;
}

/** Une clé par intention : la même jusqu'à ce que l'envoi réussisse, un nouvel essai ne compte jamais deux fois. */
export const requestId = () =>
  `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Un identifiant lisible depuis un nom affiché : minuscules, chiffres, tirets. */
export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
