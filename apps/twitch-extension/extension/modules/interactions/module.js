// Module « Interactions » : Chaos V2 côté viewer (effets de stream achetés en Jetons) et Bonk ; la section FX de la
// console de modération pour l'équipe. Spécification : docs/chaos/EXTENSION_INTERACTIONS.md ; contrat avec le Core :
// docs/chaos/CONTRAT_LOT2.md. Proposé seulement quand la session le dit (`state.chaos.enabled`, décidé par le Core :
// `chaos.enabled` + drapeau `CHAOS_EXTENSION`), ou en Lab avec le faux Core de la maquette (backend.js).
// Entrée seulement (carte du Hub, disponibilité, section FX) ; la vue et sa feuille arrivent à l'ouverture.
import { registerModerationSection, registerSessionModule } from '../../shared/module-registry.js';
import { loadStyles } from '../../app/styles.js';
import { hasLabBackend } from './backend.js';

const FX_COLOR = '#b8405c';
const CHAOS_ICON =
  '<svg class="ix-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5L10 13l-6.5-2L10 9Z"/></svg>';

registerSessionModule({
  id: 'interactions',
  card: () => ({
    id: 'interactions',
    label: 'Interactions',
    icon: '✦',
    description: 'Chaos et Bonk : agis sur le stream',
  }),
  available: ({ state }) => state?.chaos?.enabled === true || (hasLabBackend() && Boolean(state)),
  hubFirst: true,
  // Bonk vit dans ce module (sous-module) : sa carte quitte le Hub tant que ce module est proposé.
  groups: ['bonk'],
  intro: false,
  bodyData: { ix: '1' },
  // Le sélecteur Chaos · Bonk prend la place du titre dans l'en-tête de l'extension.
  headClass: 'ix-head',
  headAfter: (view) => view.headbar(),
  rendered: (view, ctx) => view.rendered?.(ctx),
  // Bouclier de l'en-tête (modérateurs) : la section de la console qui correspond à l'onglet ouvert.
  moderationSection: (view) => view?.moderationSection?.() ?? 'chaos',
  // Absorbé (pas de redessin de l'hôte), sauf si le solde change : l'en-tête doit le montrer.
  onState: (view, next, prev) => view.onState?.(next, prev) === true,
  lazy: {
    load: () => import('./view.js'),
    styles: ['modules/interactions/interactions.css'],
  },
});

// Section « FX » de la console de modération (D4) sur le Core : présente seulement si l'overview du Core contient
// `chaos`. En Lab, lab-modules/interactions/lab-moderation.js la remplace par celle du faux Core.
registerModerationSection({
  key: 'chaos',
  label: 'FX',
  color: FX_COLOR,
  icon: CHAOS_ICON,
  available: (overview) => overview?.chaos?.enabled === true,
  summary: (overview) => {
    const c = overview?.chaos ?? {};
    const waiting = (c.queue?.length ?? 0) + (c.burst?.length ?? 0);
    const st = c.module_state === 'paused' ? 'paused' : 'active';
    const parts = [c.active?.length ? `${c.active.length} à l’écran` : '', waiting ? `${waiting} en attente` : ''].filter(Boolean);
    return { st, text: st === 'paused' ? 'Achats suspendus' : parts.join(' · ') || 'Calme' };
  },
  mount({ document, client, repaint, overview }) {
    const host = document.createElement('div');
    host.className = 'ix-fxhost';
    let view = null;
    let gone = false;
    void Promise.all([loadStyles(['modules/interactions/moderation-fx.css']), import('./moderation-fx.js'), import('./fx-core.js')]).then(([, m, core]) => {
      if (gone) return;
      const fx = core.createFxCore({ client, overview });
      view = m.createFxModeration({ document, getMock: fx.getMock, capS: fx.capS, repaint });
      host.replaceChildren(view.node);
      view.paint();
      repaint();
    });
    return {
      node: host,
      headEnd: () => view?.headEnd() ?? '',
      action: (name) => view?.action(name),
      paint: () => view?.paint(),
      destroy: () => {
        gone = true;
        view?.destroy();
      },
    };
  },
});
