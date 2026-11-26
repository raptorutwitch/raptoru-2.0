// LAB ONLY — un seul faux Core par page (model.js), partagé par la vue Interactions et la section FX de la console de
// modération : un achat du viewer apparaît aussitôt côté modération, une action de modération aussitôt côté viewer. Il
// avance chaque seconde, vue fermée ou non (comme le vrai Core), et survit à un rechargement de la page
// (sessionStorage) : achats en cours, file, crédits et charges se retrouvent. Le futur Core garde tout cela en base ;
// favoris, ordre et derniers réglages restent dans le navigateur (prefs.js). Réglages Lab lus dans l'adresse.
import { everySecond } from '../../app/store.js';
import { ENGINE, usePriceGrid } from './catalog.js';
import { SCENARIOS, createChaosMock } from './model.js';

const KEY = 'raptoru-lab:interactions:mock:v1';
const query = new URLSearchParams(globalThis.location?.search ?? '');

/** Réglages de la maquette : scénario, rôle simulé (le Core vérifiera le vrai), plafond Sécurité, effets à venir. */
export const lab = {
  scenario: SCENARIOS[query.get('ixScenario')] ? query.get('ixScenario') : 'normal',
  role: query.get('ixRole') === 'mod' ? 'mod' : 'viewer',
  cap: query.get('ixCap') === '60' ? 60 : ENGINE.safetyDurationS,
  planned: query.get('ixPlanned') === '1',
  // Grille de prix : les fourchettes retenues le 28/11 (défaut), l'ancienne maquette ou la proposition du 28/11.
  prices: ['maquette', 'proposee'].includes(query.get('ixPrices')) ? query.get('ixPrices') : 'fourchettes',
};
usePriceGrid(lab.prices);

let mock = null;
let stop = null;
const subs = new Set();
const read = () => {
  try {
    return globalThis.sessionStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
};
function save() {
  try {
    globalThis.sessionStorage?.setItem(KEY, mock.exportState());
  } catch {
    /* navigation privée, stockage plein : l'état vit seulement dans la page */
  }
}
const fresh = (restore) => createChaosMock({ scenario: lab.scenario, simulate: lab.scenario !== 'calme', capS: lab.cap, restore });

export function getMock() {
  if (!mock) {
    mock = fresh(read());
    mock.setCap(lab.cap);
  }
  stop ??= everySecond((t) => {
    mock.tick(t);
    save();
    for (const fn of subs) fn(t);
  });
  return mock;
}

/** Après un achat ou une action : enregistré et redessiné partout tout de suite (sans attendre la seconde suivante). */
export function changed() {
  if (!mock) return;
  save();
  const t = Date.now();
  for (const fn of subs) fn(t);
}

/** Lab : scénario changé ou « recommencer » : un faux Core neuf. */
export function resetMock() {
  mock = fresh(null);
  mock.setCap(lab.cap);
  changed();
  return mock;
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
