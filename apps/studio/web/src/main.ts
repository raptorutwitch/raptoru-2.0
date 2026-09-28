import './style.css';
import './extension-lab.css';
import './sound-config.css';
import { mountExtensionLab } from './extension-lab.js';
import { mountTestLab } from './test-lab.js';
import { mountSoundConfig } from './sound-config.js';
import { mountUpdateWidget } from './update.js';

type TabId = 'test-lab' | 'extension-lab' | 'soundboard';
const TAB_KEY = 'raptoru-studio-tab';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <header class="topbar">
      <strong class="brand">Raptoru Studio</strong>
      <nav class="tabs">
        <button class="tab" type="button" data-tab="test-lab">Test Lab <em>services</em></button>
        <button class="tab" type="button" data-tab="extension-lab">Extension Lab <em>preview</em></button>
        <button class="tab" type="button" data-tab="soundboard">Soundboard <em>config</em></button>
      </nav>
      <div class="update-widget"></div>
      <span class="topbar-safety">Local uniquement · aucun crédit réel</span>
    </header>
    <main id="tab-test-lab"></main>
    <main id="tab-extension-lab" class="tab-full" hidden></main>
    <main id="tab-soundboard" hidden></main>`;
  mountTestLab(app.querySelector<HTMLElement>('#tab-test-lab')!);
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
  let initial: TabId = 'test-lab';
  try {
    const remembered = localStorage.getItem(TAB_KEY);
    if (remembered === 'extension-lab' || remembered === 'soundboard')
      initial = remembered;
  } catch {
    /* ignore */
  }
  const asked = new URLSearchParams(location.search).get('tab');
  if (
    asked === 'test-lab' ||
    asked === 'extension-lab' ||
    asked === 'soundboard'
  )
    initial = asked;
  show(initial);
}
