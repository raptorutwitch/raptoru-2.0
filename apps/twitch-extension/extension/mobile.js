// Viewer mobile : même logique métier que l'overlay, mise en page dédiée.

import { createClient, errorLabel, isDemo, sessionFailureState } from './shared/api.js';
import { createModulePanel } from './shared/ui.js';

let token = null;
let refreshTimer = null;
let refreshInFlight = null;
const REFRESH_INTERVAL_MS = 15000;
const OPEN_RAFFLE_REFRESH_INTERVAL_MS = 5000;
const REFRESH_ERROR_INTERVAL_MS = 15000;
const client = createClient({ getToken: () => token });
const panel = createModulePanel({
  root: document.getElementById('panel'),
  client,
  onRefresh: refresh,
  // Same option as the video component (overlay.js): a module opened at start (Studio comparison view).
  initialModule: new URLSearchParams(window.location.search).get('demoModule'),
});

function scheduleRefresh(delay = REFRESH_INTERVAL_MS) {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, delay);
}

function visibleRefreshDelay() {
  // Une page active doit constater une ouverture SAMMI rapidement, même si
  // la dernière réponse indiquait encore une tombola fermée. Les iframes
  // cachées conservent le polling lent pour ne pas augmenter la charge.
  return document.visibilityState === 'visible'
    ? OPEN_RAFFLE_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;
}

async function refresh() {
  if (refreshInFlight) return refreshInFlight;
  if (document.visibilityState === 'hidden') {
    scheduleRefresh(REFRESH_ERROR_INTERVAL_MS);
    return;
  }
  refreshInFlight = (async () => {
    let nextDelay = visibleRefreshDelay();
    try {
      const session = await client.refresh();
      panel.setState(session);
      nextDelay = visibleRefreshDelay();
    } catch (error) {
      nextDelay = document.visibilityState === 'visible'
        ? OPEN_RAFFLE_REFRESH_INTERVAL_MS : REFRESH_ERROR_INTERVAL_MS;
      const failedState = sessionFailureState(panel.state, error);
      if (failedState) panel.setState(failedState);
      panel.setError(errorLabel(error?.code), refresh);
    } finally {
      refreshInFlight = null;
      scheduleRefresh(nextDelay);
    }
  })();
  return refreshInFlight;
}

document.getElementById('refresh').addEventListener('click', refresh);

// Le mobile passe beaucoup de temps en arrière-plan : on relit au retour plutôt
// que de maintenir un polling qui viderait la batterie.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && token) refresh();
});
// Twitch peut remettre l'iframe en avant-plan sans rappeler onAuthorized.
// Ces événements couvrent pause/reprise, retour d'un autre onglet et sortie
// du mode économie d'énergie sur mobile.
window.addEventListener('pageshow', () => { if (token) refresh(); });
window.addEventListener('focus', () => { if (token) refresh(); });

const twitch = window.Twitch?.ext;
// Sur hôte local, le helper Twitch peut se charger sans jamais appeler
// onAuthorized. Comme pour la vue composant, le mode demo doit donc gagner
// afin que le panneau reste testable hors live et sans faux ecran vide.
if (isDemo()) {
  refresh();
} else if (twitch) {
  twitch.onAuthorized((auth) => {
    client.resetSession();
    token = auth.token;
    refresh();
  });
  twitch.listen?.('broadcast', () => refresh());
}
