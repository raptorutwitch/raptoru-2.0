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
  // Music Hub V2: the module's header says what it is for (the Hub card keeps the short « Musique »).
  headLabel: 'Prochaine musique',
  // The view starts with its search field: no host intro above it (every pixel counts at 65 %).
  intro: false,
  lazy: {
    load: () => import('./view.js'),
    styles: ['modules/music/music.css'],
  },
  // A new session while the module is open: absorbed (no host redraw); the view re-reads its own state only when the
  // session's music summary changed (open / closed, queue size) — never one more reading per host refresh.
  // A new balance is NOT absorbed: the host redraws its header wallet (12/11: the balance stayed frozen while open).
  onState: (view, next, previous) => {
    const absorbed = view.onState?.(next, previous) === true;
    return absorbed && JSON.stringify(next?.wallet ?? null) === JSON.stringify(previous?.wallet ?? null);
  },
});
