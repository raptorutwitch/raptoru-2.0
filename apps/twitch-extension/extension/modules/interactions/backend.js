// Source des données d'Interactions › Chaos. En Production : le Core (core-backend.js : devis, achats, file, crédits,
// tous calculés et vérifiés côté serveur). En Lab : le faux Core de la maquette (lab-modules/interactions), qui
// s'enregistre ici avant l'ouverture du module (setLabBackend) ; il n'est jamais embarqué dans un paquet.
// Forme commune : { mock: { snapshot(t), quote(effect, choice, t, viewer?, pay), buy(...) → valeur ou Promise },
//   subscribe(fn) → stop, changed(), capS()?, lab?, scenarios?, reset()?, localPlay? }.
import { createCoreBackend } from './core-backend.js';

let labFactory = null;

export function setLabBackend(factory) {
  labFactory = factory;
}

export const hasLabBackend = () => Boolean(labFactory);

/** `getState()` : le dernier état de session vu par la vue (solde de l'en-tête, rôle). */
export function createBackend(ctx, getState) {
  return labFactory ? labFactory(ctx) : createCoreBackend(ctx, getState);
}
