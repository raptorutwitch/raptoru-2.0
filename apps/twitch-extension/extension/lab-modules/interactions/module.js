// LAB ONLY — module « Interactions » : Chaos V2 côté viewer, Bonk et la Régie (docs/chaos/EXTENSION_INTERACTIONS.md).
// Maquette navigable branchée sur un faux Core (model.js) : jamais embarquée dans un paquet (scripts/package.mjs retire
// lab-modules/), chargée seulement si le runtime l'autorise (Lab, banc) ET que la page demande ?labModules=interactions.
// Entrée seulement (carte du Hub, disponibilité) ; la vue et sa feuille arrivent à l'ouverture.
import { registerSessionModule } from '../../shared/module-registry.js';

registerSessionModule({
  id: 'interactions',
  card: () => ({
    id: 'interactions',
    label: 'Interactions',
    icon: '✦',
    description: 'Chaos et Bonk : agis sur le stream',
  }),
  available: ({ state }) => Boolean(state),
  hubFirst: true,
  // Bonk vit dans ce module (sous-module) : sa carte quitte le Hub tant que ce module est proposé.
  groups: ['bonk'],
  intro: false,
  bodyData: { ix: '1' },
  // Le sélecteur Chaos · Bonk · Régie prend la place du titre dans l'en-tête de l'extension.
  headClass: 'ix-head',
  headAfter: (view) => view.headbar(),
  rendered: (view, ctx) => view.rendered?.(ctx),
  onState: (view, next) => view.onState?.(next) === true,
  lazy: {
    load: () => import('./view.js'),
    styles: ['lab-modules/interactions/interactions.css'],
  },
});
