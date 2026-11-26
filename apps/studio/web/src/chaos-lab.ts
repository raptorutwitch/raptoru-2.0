// Chaos Lab (npm run chaos:lab) : la page Studio › Chaos seule, servie par un banc local indépendant de toute instance de
// Studio (son propre port, son propre dossier de réglages). Exactement le même module de page et la même API que Studio.
import './style.css';
import './ds/ds.css';
import './pages/chaos.css';
import { mountChaosPage } from './pages/chaos.js';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML =
  '<div class="cl-bar">Chaos Lab · banc de test local (aucun Jeton, aucun viewer, aucune source OBS)</div><main class="cl-main"></main>';
const style = document.createElement('style');
style.textContent = `body{background:var(--void);min-height:100vh}
.cl-bar{padding:8px 16px;font-size:12px;color:var(--ink3);border-bottom:1px solid var(--hair)}
.cl-main{max-width:1400px;margin:0 auto;padding:8px 12px 24px}`;
document.head.append(style);
mountChaosPage(app.querySelector<HTMLElement>('.cl-main')!).setVisible(true);
