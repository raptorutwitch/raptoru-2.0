// Music Hub (docs/music/MUSIC_HUB_STATE.md) — the ENTRY of the extension's music module (shell v2): what the Hub needs,
// nothing else. The view (view.js) and its sheet (music.css) load when the module is opened (app/lazy-views.js).
// Offered only when the Core says so (session.music.offered: the Lab, « Demandes depuis l'extension » on in Studio).
import { registerSessionModule } from '../../shared/module-registry.js';

registerSessionModule({
  id: 'music',
  card: (state) => ({
    id: 'music',
    label: 'Musique',
    icon: '🎵',
    description: state?.music?.open
      ? 'Choisis la prochaine musique du stream'
      : 'Les demandes sont fermées pour le moment',
  }),
  available: ({ state }) => state?.music?.offered === true,
  // The view draws its own player at the top: no host intro above it (every pixel counts at 65 %).
  intro: false,
  lazy: {
    load: () => import('./view.js'),
    styles: ['modules/music/music.css'],
  },
  // A new session while the module is open: the view re-reads its own state (absorbed, no host redraw).
  onState: (view, next) => view.onState?.(next) === true,
});
