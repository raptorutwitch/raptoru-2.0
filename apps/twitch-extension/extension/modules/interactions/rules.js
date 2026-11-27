// Règles de Chaos V2 affichées au viewer et appliquées par le Core (module chaos, docs/chaos/CONTRAT_LOT2.md § 1) :
// file, délais, charges, remboursements, phrases « Conditions », crédits. Le faux Core du Lab (lab-modules/interactions/
// model.js) les applique à l'identique ; le vrai Core les vérifie côté serveur.
import { ENGINE, SLOTS, durationRange, effectById, presetOf } from './catalog.js';

export const QUEUE_MAX = 3; // 3 demandes en attente au plus
export const QUEUE_TTL_S = 180; // une demande jamais démarrée après 3 min est remboursée intégralement
export const VIEWER_COOLDOWN_S = 60; // un viewer ne relance pas le même effet avant 1 min après sa fin
export const REFUND_BEFORE = 0.25; // proposition : arrêté avant 25 % de sa durée → remboursement proposé d'office
/**
 * Achats « à charges » (préréglage avec `charges`, ex. Un clignement) : quatre plafonds distincts.
 *  - charges du viewer : `charges.max` au plus, une revient toutes les `charges.rechargeS` s (catalog.js) ;
 *  - demandes acceptées : BURST.maxPending en attente au plus, tous viewers confondus ;
 *  - cadence réelle : une à la fois (le même effet ne joue jamais deux fois), BURST.gapS entre deux ;
 *  - sécurité : BURST.perMinute déclenchements par minute glissante pour tout le chat (deux viewers ne cumulent pas).
 * Le moteur garde ses propres protections (photosensibilité, effets actifs) ; rien ici ne les contourne.
 */
export const BURST = Object.freeze({ maxPending: 10, gapS: 0.5, perMinute: 20 });

/**
 * Remboursements (EXTENSION_INTERACTIONS.md § 10 bis). Jamais démarré, quelle qu'en soit la raison : TOUT est rendu
 * (Jetons, ou le crédit utilisé, ou la charge). Démarré puis interrompu par une panne : politique distincte,
 * réglable et tracée (rendu s'il a joué moins de `interruptedBelow` de sa durée). Arrêté par la modération : rendu
 * d'office avant `stoppedBelow`, sinon au choix du modérateur.
 */
export const REFUND_POLICY = Object.freeze({ notStarted: 'full', interruptedBelow: 0.5, stoppedBelow: REFUND_BEFORE });
/** Studio déconnecté : les demandes en attente sont rendues s'il ne revient pas dans ce délai. */
export const STUDIO_GRACE_S = 30;
/** Échecs avant démarrage que le Core devra reconnaître (codes du moteur / de Studio) : tous remboursés intégralement. */
export const FAILURES = Object.freeze({
  studio_offline: 'Studio déconnecté',
  engine_unavailable: 'Moteur indisponible',
  effect_refused: 'Effet refusé par le moteur',
  capture_unavailable: 'Image du jeu indisponible',
  trigger_error: 'Erreur au déclenchement',
  network: 'Liaison perdue avec Studio',
  no_ack: 'Démarrage jamais confirmé',
  queue_expired: 'Jamais démarré en 3 min',
});

export const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** Ce qu'un crédit permet, en une ligne : « 20 s au plus · Dense au plus ». */
export function creditTerms(credit) {
  const e = effectById(credit.effect);
  const k = credit.constraints ?? {};
  const parts = [];
  if (k.maxS) parts.push(`${k.maxS} s au plus`);
  if (k.levels?.length) parts.push(k.levels.map((l) => e.levels?.find((x) => x.id === l)?.label ?? l).join(' ou '));
  if (k.presets?.length) parts.push(k.presets.map((p) => e.presets?.find((x) => x.id === p)?.label ?? p).join(' ou '));
  return parts.join(' · ') || 'tous les réglages';
}

/** Ce qui empêche ce réglage d'être payé avec ce crédit, ou null. */
export function creditMismatch(credit, e, c) {
  const k = credit.constraints ?? {};
  if (credit.effect !== e.id) return `Ce crédit est pour ${effectById(credit.effect).label}.`;
  if (k.maxS && c.duration > k.maxS) return `Ton crédit couvre ${k.maxS} s au plus.`;
  if (k.levels?.length && !k.levels.includes(c.level)) return `Ton crédit couvre : ${creditTerms(credit)}.`;
  if (k.presets?.length && !k.presets.includes(c.style)) return `Ton crédit couvre : ${creditTerms(credit)}.`;
  return null;
}

/**
 * « Conditions » d'un réglage, en phrases courtes (fiche, lien jaune) : durée, compatibilité, file ou charges, délai,
 * remboursement, particularité de l'effet. Ce qui EMPÊCHE un achat n'est jamais ici seulement : la fiche le dit en clair.
 */
export function conditionsFor(e, c, capS = ENGINE.safetyDurationS) {
  const r = durationRange(e, c, capS);
  const charges = presetOf(e, c)?.charges;
  const out = [];
  const capped = !r.fixed && r.max === capS && capS < Math.min(e.duration.max, ENGINE.maxDurationS);
  out.push(['stopwatch', r.fixed ? `Durée fixe : ${r.def} s.` : `De ${r.min} à ${r.max} s${capped ? ' (plafond de ce live)' : ''}.`]);
  out.push(['layers', `${SLOTS[e.slot].rule}. Le même effet ne joue jamais deux fois à la fois : le tien passe juste après.`]);
  if (charges)
    out.push(['bolt', `${charges.max} charges ; une revient toutes les ${charges.rechargeS} s. Les clignements passent l’un après l’autre, ${BURST.perMinute} par minute au plus pour tout le chat.`]);
  else out.push(['queue', `File de ${QUEUE_MAX} demandes, une seule en attente par viewer. ${VIEWER_COOLDOWN_S / 60} min avant de relancer le même effet.`]);
  out.push(['refund', `Pas démarré (panne de Studio ou du moteur, refus, file de plus de ${QUEUE_TTL_S / 60} min) : tout est rendu. Interrompu par une panne : rendu s’il a joué moins de la moitié. Arrêté par la modération avant ${REFUND_BEFORE * 100} % : rendu. Payé avec un crédit : le crédit revient.`]);
  if (e.note) out.push(['info', e.note]);
  return out.map(([icon, text]) => ({ icon, text }));
}
