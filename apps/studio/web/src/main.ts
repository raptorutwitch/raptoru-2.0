import './style.css';
import { mountTestLab } from './test-lab.js';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <header class="topbar">
      <strong>Raptoru Studio</strong>
      <nav><button class="tab active" type="button">Test Lab <em>temporaire</em></button></nav>
    </header>
    <main id="tab"></main>`;
  mountTestLab(app.querySelector<HTMLElement>('#tab')!);
}
