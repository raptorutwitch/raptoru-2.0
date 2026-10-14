import './style.css';
import './extension-lab.css';
import './sound-config.css';
import './studio-home.css';
import './moderation.css';
import './tombola.css';
import './commands.css';
import './bonk-target.css';
import { mountExtensionLab } from './extension-lab.js';
import { mountTestLab } from './test-lab.js';
import { mountSoundConfig } from './sound-config.js';
import { mountUpdateWidget } from './update.js';
import { mountStudioHome } from './studio-home.js';
import { mountModeration } from './moderation.js';
import { mountTombola } from './tombola.js';
import { mountCommands } from './commands.js';

type TabId =
  | 'studio'
  | 'moderation'
  | 'tombola'
  | 'commands'
  | 'test-lab'
  | 'extension-lab'
  | 'soundboard';
const TAB_KEY = 'raptoru-studio-tab';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <header class="topbar">
      <strong class="brand">Raptoru Studio</strong>
      <nav class="tabs">
        <button class="tab" type="button" data-tab="studio">Studio <em>runtime</em></button>
        <button class="tab" type="button" data-tab="moderation">Modération <em>Core</em></button>
        <button class="tab" type="button" data-tab="tombola">Tombola <em>Core</em></button>
        <button class="tab" type="button" data-tab="commands">Commandes <em>Core</em></button>
        <button class="tab" type="button" data-tab="test-lab">Test Lab <em>services</em></button>
        <button class="tab" type="button" data-tab="extension-lab">Extension Lab <em>preview</em></button>
        <button class="tab" type="button" data-tab="soundboard">Soundboard <em>config</em></button>
      </nav>
      <div class="update-widget"></div>
      <span class="topbar-safety">Local uniquement · aucun crédit réel</span>
    </header>
    <main id="tab-studio"></main>
    <main id="tab-moderation" hidden></main>
    <main id="tab-tombola" class="tab-flush" hidden></main>
    <main id="tab-commands" hidden></main>
    <main id="tab-test-lab" hidden></main>
    <main id="tab-extension-lab" class="tab-full" hidden></main>
    <main id="tab-soundboard" hidden></main>`;
  const home = mountStudioHome(app.querySelector<HTMLElement>('#tab-studio')!);
  mountTestLab(app.querySelector<HTMLElement>('#tab-test-lab')!);
  const moderation = mountModeration(
    app.querySelector<HTMLElement>('#tab-moderation')!,
  );
  const tombola = mountTombola(app.querySelector<HTMLElement>('#tab-tombola')!);
  const commands = mountCommands(
    app.querySelector<HTMLElement>('#tab-commands')!,
  );
  const extensionLab = mountExtensionLab(
    app.querySelector<HTMLElement>('#tab-extension-lab')!,
  );
  const soundConfig = mountSoundConfig(
    app.querySelector<HTMLElement>('#tab-soundboard')!,
  );
  mountUpdateWidget(app.querySelector<HTMLElement>('.update-widget')!);

  const show = (tab: TabId) => {
    for (const button of app.querySelectorAll<HTMLElement>('[data-tab]'))
      button.classList.toggle('active', button.dataset.tab === tab);
    app.querySelector<HTMLElement>('#tab-studio')!.hidden = tab !== 'studio';
    home.setVisible(tab === 'studio');
    app.querySelector<HTMLElement>('#tab-moderation')!.hidden =
      tab !== 'moderation';
    moderation.setVisible(tab === 'moderation');
    app.querySelector<HTMLElement>('#tab-tombola')!.hidden = tab !== 'tombola';
    tombola.setVisible(tab === 'tombola');
    app.querySelector<HTMLElement>('#tab-commands')!.hidden =
      tab !== 'commands';
    commands.setVisible(tab === 'commands');
    app.querySelector<HTMLElement>('#tab-test-lab')!.hidden =
      tab !== 'test-lab';
    app.querySelector<HTMLElement>('#tab-extension-lab')!.hidden =
      tab !== 'extension-lab';
    app.querySelector<HTMLElement>('#tab-soundboard')!.hidden =
      tab !== 'soundboard';
    soundConfig.setVisible(tab === 'soundboard');
    // The lab fills the window below the top bar (no page scroll).
    document.documentElement.style.setProperty(
      '--topbar-h',
      `${app.querySelector<HTMLElement>('.topbar')!.offsetHeight}px`,
    );
    document.body.classList.toggle('lab-open', tab === 'extension-lab');
    extensionLab.setVisible(tab === 'extension-lab');
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* private mode: tab not remembered */
    }
  };
  app.querySelector('.tabs')!.addEventListener('click', (ev) => {
    const tab = (ev.target as HTMLElement).closest<HTMLElement>('[data-tab]')
      ?.dataset.tab as TabId | undefined;
    if (tab) show(tab);
  });
  // ?tab=extension-lab (deep link) wins over the remembered tab.
  let initial: TabId = 'studio';
  try {
    const remembered = localStorage.getItem(TAB_KEY);
    if (
      remembered === 'extension-lab' ||
      remembered === 'moderation' ||
      remembered === 'tombola' ||
      remembered === 'commands' ||
      remembered === 'soundboard' ||
      remembered === 'test-lab'
    )
      initial = remembered;
  } catch {
    /* ignore */
  }
  const asked = new URLSearchParams(location.search).get('tab');
  if (
    asked === 'studio' ||
    asked === 'moderation' ||
    asked === 'tombola' ||
    asked === 'commands' ||
    asked === 'test-lab' ||
    asked === 'extension-lab' ||
    asked === 'soundboard'
  )
    initial = asked;
  show(initial);
}
