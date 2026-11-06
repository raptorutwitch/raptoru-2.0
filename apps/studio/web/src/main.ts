import './style.css';
import { mountModuleHost } from './module-host.js';
import './shell/shell.css';
import './extension-lab.css';
import './sound-config.css';
import './studio-home.css';
import './control-center.css';
import './moderation.css';
import './tombola.css';
import './commands.css';
import './word-game.css';
import './bonk-target.css';
import './simulation.css';
import './alerts.css';
import './channel-points.css';
import './spotify.css';
import './sub-wheel.css';
import './halloween.css';
import './studio-theme.css';
import './shell/frame.css';
import './ds/ds.css';
import './mod/mod.css';
import './pages/tts.css';
import { mountExtensionLab } from './extension-lab.js';
import { mountTestLab } from './test-lab.js';
import { mountBonkPage, mountSoundPage } from './module-pages.js';
import { mountTtsPage } from './pages/tts.js';
import { mountUpdateWidget } from './update.js';
import { mountStudioHome } from './studio-home.js';
import { mountModeration } from './moderation.js';
import { mountTombola } from './tombola.js';
import { mountCommands } from './commands.js';
import { mountWordGame } from './word-game.js';
import { mountSimulation } from './simulation.js';
import { mountSimulationTab } from './simulation-tab.js';
import { mountAlerts } from './alerts-tab.js';
import { mountChannelPoints } from './channel-points.js';
import { mountHalloween } from './halloween.js';
import { mountProgression } from './progression.js';
import { mountCosmetics } from './cosmetics.js';
import { mountChallenges } from './challenges.js';
import { mountShell, shellHtml } from './shell/shell.js';
import { VIEW_IDS, type ViewId } from './shell/registry.js';

// Raptoru Studio — la refonte (docs/RAPTORU_STUDIO_UX_UI_2026-11-04.md) : le SHELL possède la navigation (six
// rubriques, Laboratoire, favoris, Ctrl+K, supervision compacte) ; chaque vue existante est montée UNE seule fois ici,
// dans son conteneur historique `#tab-<id>`, et le shell l'affiche. Mêmes instances, mêmes pollers, mêmes lecteurs :
// aucune vue n'est montée deux fois, aucune action n'est dupliquée. `?tab=<id>` reste un alias exact.

interface View {
  setVisible?(visible: boolean): void;
  /** Une vue qui porte plusieurs pages (Récompenses Twitch et ses modules) n'en montre qu'une. */
  setFocus?(focus: string | null): void;
}

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  const CLASS: Partial<Record<ViewId, string>> = {
    tombola: 'tab-flush',
    'extension-lab': 'tab-full',
  };
  app.innerHTML = shellHtml(
    VIEW_IDS.map(
      (id) =>
        `<main id="tab-${id}"${CLASS[id] ? ` class="${CLASS[id]}"` : ''} hidden></main>`,
    ).join(''),
  );
  const el = (id: ViewId) => app.querySelector<HTMLElement>(`#tab-${id}`)!;
  const views: Record<ViewId, View> = {
    studio: mountStudioHome(el('studio')),
    'test-lab': (mountTestLab(el('test-lab')), {}),
    moderation: mountModeration(el('moderation')),
    tombola: mountTombola(el('tombola')),
    commands: mountCommands(el('commands')),
    'word-game': mountWordGame(el('word-game')),
    alerts: mountAlerts(el('alerts')),
    'channel-points': mountChannelPoints(el('channel-points')),
    halloween: mountHalloween(el('halloween')),
    progression: mountProgression(el('progression')),
    shop: mountCosmetics(el('shop')),
    challenges: mountChallenges(el('challenges')),
    simulation: mountSimulationTab(el('simulation')),
    'extension-lab': mountExtensionLab(el('extension-lab')),
    soundboard: mountSoundPage(el('soundboard')),
    tts: mountTtsPage(el('tts')),
    bonk: mountBonkPage(el('bonk')),
    modules: mountModuleHost(el('modules')),
  };
  mountUpdateWidget(app.querySelector<HTMLElement>('.update-widget')!);
  // « Simulation de stream » : live, chat, sortie réelle, mini-jeux (depuis n'importe quelle page).
  mountSimulation(app.querySelector<HTMLElement>('.sim-widget')!);

  let shown: ViewId | null | undefined;
  const showView = (tab: ViewId | null, focus: string | null = null) => {
    if (tab) views[tab].setFocus?.(focus);
    if (tab === shown) return;
    shown = tab;
    for (const id of VIEW_IDS) {
      el(id).hidden = id !== tab;
      views[id].setVisible?.(id === tab);
    }
    // L'Extension Lab remplit la fenêtre sous la barre du haut (pas de défilement de page).
    document.body.classList.toggle('lab-open', tab === 'extension-lab');
  };
  mountShell(app, { showView });
}
