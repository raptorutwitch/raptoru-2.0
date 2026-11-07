import './style.css';
import { mountModuleHost } from './module-host.js';
import './bonk-target.css';
import './shell/frame.css';
import './ds/ds.css';
import './mod/mod.css';
import './pages/tts.css';
import './pages/alerts.css';
import './pages/spotify.css';
import './pages/sub-wheel.css';
import './pages/commands.css';
import './pages/word-game.css';
import './pages/mini-games.css';
import './pages/regie.css';
import './pages/centre.css';
import './pages/hubs.css';
import './pages/labo.css';
import './pages/labo-extension.css';
import './pages/systeme.css';
import './pages/rewards.css';
import './pages/sanctions.css';
import './pages/moderation.css';
import './pages/soundboard.css';
import './pages/bonk.css';
import './pages/tombola.css';
import './pages/player-card.css';
import './pages/progression.css';
import './pages/shop.css';
import './pages/challenges.css';
import './pages/halloween.css';
import { mountExtensionLab } from './pages/labo-extension.js';
import { mountTestLab } from './pages/labo-tests.js';
import { mountBonkPage } from './pages/bonk.js';
import { mountSoundboardPage } from './pages/soundboard.js';
import { mountTtsPage } from './pages/tts.js';
import { mountSpotifyPage } from './pages/spotify.js';
import { mountSubWheelPage } from './pages/sub-wheel.js';
import { mountUpdateWidget } from './update.js';
import { mountSysteme } from './pages/systeme.js';
import { mountModeration } from './pages/moderation.js';
import { mountTombolaPage } from './pages/tombola.js';
import { mountCommandsPage } from './pages/commands.js';
import { mountWordGamePage } from './pages/word-game.js';
import { mountMiniGamesPage } from './pages/mini-games.js';
import { mountSimulation } from './simulation.js';
import { mountSimulationPage } from './pages/simulation.js';
import { mountAlerts } from './pages/alerts.js';
import { mountRewardsPage } from './pages/rewards.js';
import { mountEffectsPage } from './pages/effects.js';
import { mountRandomBanPage } from './pages/sanctions-random-ban.js';
import { mountCautionPage } from './pages/sanctions-caution.js';
import { mountVotekickPage } from './pages/sanctions-votekick.js';
import { mountHalloweenPage } from './pages/halloween.js';
import { mountProgressionPage } from './pages/progression.js';
import { mountShopPage } from './pages/shop.js';
import { mountChallengesPage } from './pages/challenges.js';
import { mountShell, shellHtml } from './shell/shell.js';
import { VIEW_IDS, type ViewId } from './shell/registry.js';

// Raptoru Studio : la coque (shell/) possède la navigation ; chaque vue est montée UNE seule fois ici, dans son conteneur
// `#tab-<id>`, et la coque l'affiche. Mêmes instances, mêmes relevés, mêmes lecteurs. `?tab=<id>` reste un alias exact.

interface View {
  setVisible?(visible: boolean): void;
  /** Une vue qui porte plusieurs pages (Récompenses Twitch et ses modules) n'en montre qu'une. */
  setFocus?(focus: string | null): void;
}

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  const CLASS: Partial<Record<ViewId, string>> = {
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
    studio: mountSysteme(el('studio')),
    'test-lab': mountTestLab(el('test-lab')),
    moderation: mountModeration(el('moderation')),
    tombola: mountTombolaPage(el('tombola')),
    commands: mountCommandsPage(el('commands')),
    'word-game': mountWordGamePage(el('word-game')),
    'mini-games': mountMiniGamesPage(el('mini-games')),
    alerts: mountAlerts(el('alerts')),
    'channel-points': mountRewardsPage(el('channel-points')),
    effects: mountEffectsPage(el('effects')),
    'random-ban': mountRandomBanPage(el('random-ban')),
    caution: mountCautionPage(el('caution')),
    votekick: mountVotekickPage(el('votekick')),
    halloween: mountHalloweenPage(el('halloween')),
    progression: mountProgressionPage(el('progression')),
    shop: mountShopPage(el('shop')),
    challenges: mountChallengesPage(el('challenges')),
    simulation: mountSimulationPage(el('simulation')),
    'extension-lab': mountExtensionLab(el('extension-lab')),
    soundboard: mountSoundboardPage(el('soundboard')),
    tts: mountTtsPage(el('tts')),
    spotify: mountSpotifyPage(el('spotify')),
    'sub-wheel': mountSubWheelPage(el('sub-wheel')),
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
  };
  mountShell(app, { showView });
}
