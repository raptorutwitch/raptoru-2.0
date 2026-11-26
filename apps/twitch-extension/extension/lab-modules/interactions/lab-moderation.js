// LAB ONLY — la modération des effets dans la VRAIE console de modération (D4, shared/moderation-v2.js), sans Core :
//  0. le solde de la session de démo (en-tête) = celui du faux Core de Chaos : un achat se voit tout de suite ;
//  1. une source de démo (module-registry.js registerDemoSource) : avec ?ixRole=mod, la session de démo devient celle
//     d'un modérateur sur la console D4 (`moderation_v2`), et ses lectures `/moderation/v2/*` reçoivent des données
//     fictives minimales (TTS, Sons, Bonk, Tombola presque vides). Toute commande D4 est refusée (« pas disponible dans
//     ce test ») : rien ne fait croire qu'elle agit sur le live ;
//  2. la section « FX » (registerModerationSection) : une ligne de plus dans la navigation de la console, sa vue
//     (moderation-fx.js) sur le faux Core partagé (store.js).
// Contrat de branchement (Core, lot 2) : docs/chaos/EXTENSION_INTERACTIONS.md § 9.
import { registerDemoSource, registerModerationSection } from '../../shared/module-registry.js';
import { loadStyles } from '../../app/styles.js';
import { lab, getMock, subscribe } from './store.js';
import { glyph } from '../../modules/interactions/glyphs.js';

const FX_COLOR = '#b8405c';
const ALL_GRANTS = ['modules', 'perms', 'sensitive', 'wallet', 'words'];
const notAvailable = () => Promise.reject(Object.assign(new Error('not_available'), { code: 'not_available' }));

function moderatorSession(s) {
  if (!s || typeof s !== 'object') return s;
  return { ...s, role: 'moderator', moderation_v2: true, moderation: { ...(s.moderation ?? {}), tts: { ...(s.moderation?.tts ?? {}), can_moderate: true } } };
}

function overview() {
  const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
  const bonk = (id, name, s) => ({ interaction_id: `lab-bonk-${id}`, viewer_id: `lab-${id}`, viewer_display_name: name, module: 'bonk', created_at: ago(s), emote: null });
  return {
    me: { role: 'moderator', actor: { id: '42', display_name: 'Toi' }, viewer_id: '42', grants: ALL_GRANTS, permissions: [] },
    global: { paused: false, refused: 0 },
    tts: { module_state: 'active', current: null, waiting: [] },
    soundboard: { module_state: 'active', playing: [], waiting: [] },
    bonk: { module_state: 'active', recent: [bonk(1, 'Kiwi_57', 40), bonk(2, 'PtitChef', 130)] },
    raffle: { module_state: 'active', recent_entries: [] },
    raffle_v2: { round: null },
  };
}

const EMPTY = {
  team: { members: [] },
  words: { words: [] },
  restrictions: { active: [], history: [] },
  audit: { audit: [] },
  ledger: { items: [] },
  interactions: { items: [] },
  search: { viewers: [] },
};

function labSession(s) {
  if (!s || typeof s !== 'object') return s;
  let out = s;
  if (typeof s.wallet?.points === 'number') {
    const balance = getMock().snapshot(Date.now()).balance;
    out = { ...out, wallet: { ...s.wallet, points: balance, available: balance - (s.wallet.reserved ?? 0) } };
  }
  return lab.role === 'mod' ? moderatorSession(out) : out;
}

registerDemoSource((method, path, body, next) => {
  if (path === '/session' || path === '/state') return next().then(labSession);
  if (lab.role !== 'mod' || !path.startsWith('/moderation/v2/')) return next();
  if (method !== 'GET') return notAvailable();
  const route = path.slice('/moderation/v2/'.length).split(/[/?]/u)[0];
  if (route === 'overview') return Promise.resolve(overview());
  if (EMPTY[route]) return Promise.resolve(structuredClone(EMPTY[route]));
  return notAvailable();
});

function summary() {
  const s = getMock().snapshot(Date.now());
  const st = s.status === 'open' ? 'active' : s.status === 'paused' ? 'paused' : 'disabled';
  const waiting = s.queue.length + s.burst.length;
  const parts = [s.active.length ? `${s.active.length} à l’écran` : '', waiting ? `${waiting} en attente` : ''].filter(Boolean);
  return { st, text: st === 'active' ? parts.join(' · ') || 'Calme' : st === 'paused' ? 'Achats suspendus' : 'Fermé' };
}

registerModerationSection({
  key: 'chaos',
  label: 'FX',
  color: FX_COLOR,
  get icon() {
    return glyph(globalThis.document, 'chaos', '').outerHTML;
  },
  summary,
  mount({ document, repaint }) {
    const host = document.createElement('div');
    host.className = 'ix-fxhost';
    let view = null;
    let unsub = null;
    let gone = false;
    void Promise.all([loadStyles(['modules/interactions/moderation-fx.css']), import('../../modules/interactions/moderation-fx.js')]).then(([, m]) => {
      if (gone) return;
      view = m.createFxModeration({ document, getMock, capS: () => lab.cap, repaint, lab: true });
      host.replaceChildren(view.node);
      view.paint();
      // Chaque seconde (temps restant, file) : seulement le contenu de la section, et seulement s'il est affiché.
      unsub = subscribe(() => host.isConnected && view.paint());
      repaint();
    });
    return {
      node: host,
      headEnd: () => view?.headEnd() ?? '',
      action: (name) => view?.action(name),
      paint: () => view?.paint(),
      destroy: () => {
        gone = true;
        unsub?.();
        view?.destroy();
      },
    };
  },
});
