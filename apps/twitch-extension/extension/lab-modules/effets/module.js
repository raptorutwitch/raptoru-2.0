// LAB ONLY — module « Effets live » : Chaos V2 côté viewer, avec Bonk dedans (docs/chaos/EXTENSION_EFFETS_LIVE.md).
// Maquette navigable branchée sur un faux Core (model.js) : jamais embarquée dans un paquet (scripts/package.mjs retire
// lab-modules/), chargée seulement si le runtime l'autorise (Lab, banc) ET que la page demande ?labModules=1.
// Entrée seulement (carte du Hub, disponibilité) ; la vue et sa feuille arrivent à l'ouverture.
import { registerSessionModule } from '../../shared/module-registry.js';

registerSessionModule({
  id: 'effets_live',
  card: () => ({
    id: 'effets_live',
    label: 'Effets live',
    icon: '✨',
    description: 'Secoue l’écran du stream',
  }),
  available: ({ state }) => Boolean(state),
  hubFirst: true,
  // Bonk vit dans ce module (onglet) : sa carte quitte le Hub tant que ce module est proposé.
  groups: ['bonk'],
  intro: false,
  bodyData: { fx: '1' },
  rendered: (view, ctx) => view.rendered?.(ctx),
  onState: (view, next) => view.onState?.(next) === true,
  lazy: {
    load: () => import('./view.js'),
    styles: ['lab-modules/effets/effets.css'],
  },
});
