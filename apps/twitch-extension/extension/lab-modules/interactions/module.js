// LAB ONLY — maquette « Interactions » (docs/chaos/EXTENSION_INTERACTIONS.md) : le module embarqué
// (modules/interactions) branché sur un FAUX Core (model.js, store.js) au lieu du Core ; panneau Lab ; « Jouer sur mon
// PC » quand Studio Lab sert la page ; section FX de la console de modération et session de démo d'un modérateur
// (?ixRole=mod). Jamais embarqué (scripts/package.mjs retire lab-modules/), chargé seulement si le runtime l'autorise
// (Lab, banc) ET que la page demande ?labModules=interactions.
import '../../modules/interactions/module.js';
import { setLabBackend } from '../../modules/interactions/backend.js';
import { SCENARIOS } from './model.js';
import { changed, getMock, lab, resetMock, subscribe } from './store.js';
import { createLocalPlay } from './local-play.js';
// La section FX sur le faux Core (remplace celle du Core) et la session de démo d'un modérateur.
import './lab-moderation.js';

setLabBackend((ctx) => ({
  mock: getMock(),
  lab,
  scenarios: SCENARIOS,
  reset: () => ({ mock: resetMock() }),
  subscribe,
  changed,
  localPlay: createLocalPlay({ win: ctx.document.defaultView }),
}));
