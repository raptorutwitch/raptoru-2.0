// Studio › Boutique : ce que « Enregistrer » envoie pour un objet, le contrôle d'un cadre, les dates en heure de Paris et la clé
// d'un don. Pur et testé (cosmetics-payload.test.ts, studio-truth.test.ts) : aucun DOM ici.

/** Les champs propres à un objet : exactement CosmeticItemInput du Core (strict). */
export const ITEM_FIELDS = [
  'reward_id',
  'kind',
  'label',
  'description',
  'rarity',
  'category',
  'unlock_level',
  'sort',
  'status',
  'style',
  'image_id',
  'event_key',
] as const;

/**
 * Un objet ouvert depuis le catalogue porte aussi les champs d'affichage de la liste (active, image, owners, offers) : jamais
 * renvoyés (31/10 : « invalid_request » à chaque modification). Un champ absent prend la valeur par défaut du Core.
 */
export function itemPayload(edit: Record<string, unknown>) {
  return Object.fromEntries(
    ITEM_FIELDS.filter((k) => edit[k] !== undefined).map((k) => [k, edit[k]]),
  );
}

/**
 * Le contrôle de l'atelier avant l'envoi (le Core revérifie format, taille et poids) : le cercle de l'avatar reste transparent
 * (la décoration peut mordre 12 px sur 512) et le bord de 8 px reste vide. Pur, sur des pixels RGBA.
 */
export function frameProblemsOf(px: Uint8ClampedArray, w: number, h: number) {
  if (w !== h) return ['le cadre doit être carré'];
  const alpha = (x: number, y: number) => px[(y * w + x) * 4 + 3]!;
  const k = w / 512;
  const inner = (160 - 12) * k;
  const margin = Math.max(1, Math.round(8 * k));
  let opaqueCenter = 0;
  let centerPx = 0;
  let edge = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2);
      if (d < inner) {
        centerPx++;
        if (alpha(x, y) > 24) opaqueCenter++;
      } else if (
        (x < margin || y < margin || x >= w - margin || y >= h - margin) &&
        alpha(x, y) > 24
      )
        edge++;
    }
  const out: string[] = [];
  if (opaqueCenter > centerPx * 0.01)
    out.push(
      'le centre n’est pas transparent : l’avatar serait caché (cercle central de 62,5 %, 12 px de recouvrement au plus sur 512)',
    );
  if (edge > 0)
    out.push(
      'des pixels touchent le bord : laisse 8 px vides de chaque côté (sur une toile de 512)',
    );
  return out;
}

/** Heure de Paris (datetime-local) ↔ un instant avec son décalage, quel que soit le changement d'heure. */
export function parisToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return (
      Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t
    );
  };
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  const off = Math.round(offsetAt(t) / 60000);
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${sign}${hh}:${mm}`;
}
export function isoToParis(iso: string | null): string {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/**
 * La clé d'un don (refonte P0-2) : l'intention du formulaire et ce qui est donné. Même intention, même don → même clé (un nouvel
 * essai ne crédite jamais deux fois) ; autre viewer ou autre objet → autre clé. 120 caractères au plus (limite du Core).
 */
export function awardKey(
  intent: string,
  viewer: string,
  item: { kind: string; reward_id?: string; amount?: number },
) {
  const what = `${viewer}|${item.kind}|${item.reward_id ?? item.amount ?? ''}`;
  let h = 5381;
  for (let i = 0; i < what.length; i++)
    h = ((h * 33) ^ what.charCodeAt(i)) >>> 0;
  return `studio-${intent}-${h.toString(36)}`;
}

/** L'état d'une offre, en mots : ce que voient ses dates, le Core restant seul juge d'un achat. */
export function offerState(
  o: {
    enabled: boolean;
    opens_at: string | null;
    closes_at: string | null;
  },
  now: number,
): { tone: 'ok' | 'warn' | 'off'; text: string } {
  if (!o.enabled) return { tone: 'off', text: 'Arrêtée' };
  if (o.opens_at && Date.parse(o.opens_at) > now)
    return { tone: 'warn', text: 'Pas encore ouverte' };
  if (o.closes_at && Date.parse(o.closes_at) <= now)
    return { tone: 'off', text: 'Terminée' };
  return { tone: 'ok', text: 'En vente' };
}
