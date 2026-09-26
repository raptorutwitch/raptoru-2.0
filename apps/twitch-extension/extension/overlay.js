// Overlay desktop : onglet discret au bord du player, tiroir dépliable.

import { createClient, errorLabel, isDemo, sessionFailureState } from './shared/api.js';
import { notificationCount } from './shared/experience.js';
import {
  installTimeoutDebugLifecycle,
  summarizeTimeoutContext,
  summarizeTimeoutJwt,
  timeoutDebugMetadata,
  traceTimeoutDebug,
} from './shared/timeout-debug.js';
import { createModulePanel } from './shared/ui.js';

const toggle = document.getElementById('toggle');
const drawer = document.getElementById('drawer');
const dock = document.querySelector('.dock');
const closeBtn = document.getElementById('close');
const count = document.getElementById('dock-count');
const query = new URLSearchParams(window.location.search);
const initialModule = query.get('demoModule');
const isStudio = query.get('studio') === '1';
const isComponentView = query.get('anchor') === 'component'
  || /(?:^|\/)video_component\.html$/i.test(window.location.pathname);

let token = null;
let refreshInFlight = null;
let refreshTimer = null;
const REFRESH_INTERVAL_MS = 15000;
const OPEN_REFRESH_INTERVAL_MS = 5000;
const REFRESH_ERROR_INTERVAL_MS = 15000;
const client = createClient({ getToken: () => token });
const panel = createModulePanel({
  root: document.getElementById('panel'),
  client,
  onRefresh: refresh,
  initialModule,
  onNotificationChange: () => {
    const attentionCount = notificationCount(panel.state);
    count.hidden = attentionCount === 0;
    count.textContent = String(attentionCount);
  },
});
const traceDom = installTimeoutDebugLifecycle({
  isComponentView,
  getOpen: () => !drawer.hidden,
});
traceTimeoutDebug('extension.script.loaded', {
  path: window.location.pathname,
  document_ready_state: document.readyState,
  twitch_helper_present: Boolean(window.Twitch?.ext),
  runtime: timeoutDebugMetadata(),
});

function setOpen(open) {
  drawer.hidden = !open;
  dock.hidden = open;
  toggle.setAttribute('aria-expanded', String(open));
  if (!open) panel.collapse();
  traceTimeoutDebug('ui.set_open', {
    open: Boolean(open),
    is_component_view: isComponentView,
    drawer_hidden: Boolean(drawer.hidden),
    dock_hidden: Boolean(dock.hidden),
  });
  traceDom('setOpen');
}

function refresh() {
  if (refreshInFlight) return refreshInFlight;
  if (document.visibilityState === 'hidden') return Promise.resolve();
  traceTimeoutDebug('app.refresh.start', { is_component_view: isComponentView, drawer_open: !drawer.hidden });
  refreshInFlight = (async () => {
    let nextDelay = drawer.hidden ? REFRESH_INTERVAL_MS : OPEN_REFRESH_INTERVAL_MS;
    try {
      const session = await client.refresh();
      panel.setState(session);
      traceTimeoutDebug('app.refresh.success', {
        identity_shared: session?.identity_shared === true,
        interactions_available: session?.interactions?.available !== false,
        module_ids: Array.isArray(session?.modules) ? session.modules.map((module) => module.id) : [],
      });
      const attentionCount = notificationCount(session);
      count.hidden = attentionCount === 0;
      count.textContent = String(attentionCount);
    } catch (error) {
      traceTimeoutDebug('app.refresh.failure', {
        error_name: error?.name ? String(error.name) : null,
        error_code: String(error?.code ?? error?.message ?? 'unknown').slice(0, 160),
      });
      const failedState = sessionFailureState(panel.state, error);
      if (failedState) panel.setState(failedState);
      panel.setError(errorLabel(error?.code), refresh);
      // La panne reste visible dans le feedback du panneau ; le polling ne
      // transforme pas un incident transitoire en entrée persistante.
      nextDelay = REFRESH_ERROR_INTERVAL_MS;
      const attentionCount = notificationCount(panel.state);
      count.hidden = attentionCount === 0;
      count.textContent = String(attentionCount);
    } finally {
      refreshInFlight = null;
      if (!isStudio) {
        clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(refresh, nextDelay);
      }
    }
  })();
  return refreshInFlight;
}

toggle.addEventListener('click', () => {
  setOpen(true);
  if (token || isDemo()) void refresh();
});
closeBtn.addEventListener('click', () => {
  if (isComponentView && window.Twitch?.ext?.actions?.minimize) {
    window.Twitch.ext.actions.minimize();
    return;
  }
  setOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !drawer.hidden) setOpen(false);
});

const twitch = window.Twitch?.ext;
traceTimeoutDebug('twitch.helper.ready', {
  available: Boolean(twitch),
  helper_version: twitch?.version || null,
  helper_environment: twitch?.environment || null,
  callback_methods: ['onAuthorized', 'onContext', 'onVisibilityChanged', 'onError', 'onHighlightChanged']
    .filter((name) => typeof twitch?.[name] === 'function'),
  app_callbacks: ['onAuthorized', 'onVisibilityChanged', 'listen:broadcast', 'actions.minimize'],
  app_uses_configuration_callback: false,
  app_uses_feature_callback: false,
});
if (isComponentView) {
  // Twitch fournit déjà le petit bouton violet et ouvre cette page dans sa
  // fenêtre de composant. La vue doit donc afficher directement son contenu,
  // sans attendre un second clic sur notre dock interne.
  document.body.classList.add('component-view');
  setOpen(true);
}

if (isDemo()) {
  // Sur hôte local, le helper Twitch peut exister sans jamais appeler
  // onAuthorized. Le mode aperçu doit donc toujours gagner.
  refresh();
} else if (twitch) {
  let authorizedCount = 0;
  let previousTokenExp = null;
  twitch.onAuthorized((auth) => {
    const claims = summarizeTimeoutJwt(auth?.token);
    authorizedCount += 1;
    traceTimeoutDebug('twitch.onAuthorized', {
      callback_count: authorizedCount,
      token_present: Boolean(auth?.token),
      token_length: auth?.token ? String(auth.token).length : 0,
      channel_id: auth?.channelId || claims.channel_id || null,
      user_id: claims.user_id,
      opaque_user_id: auth?.userId || claims.opaque_user_id || null,
      role: claims.role,
      token_exp: claims.exp,
      previous_token_exp: previousTokenExp,
      token_exp_changed: previousTokenExp !== null && claims.exp !== previousTokenExp,
      claims_parseable: claims.parseable,
    });
    if (claims.exp !== null && claims.exp !== undefined) previousTokenExp = claims.exp;
    client.resetSession();
    token = auth.token;
    if (isComponentView) setOpen(true);
    refresh();
  });
  twitch.onContext?.((context, changedFields) => {
    traceTimeoutDebug('twitch.onContext', {
      context: summarizeTimeoutContext(context),
      changed_fields: Array.isArray(changedFields) ? changedFields.map(String) : [],
    });
  });
  twitch.onError?.((error) => {
    traceTimeoutDebug('twitch.onError', {
      error_name: error?.name ? String(error.name) : null,
      error_message: error?.message || error || '',
    });
  });
  twitch.onHighlightChanged?.((highlighted) => {
    traceTimeoutDebug('twitch.onHighlightChanged', { highlighted: Boolean(highlighted) });
  });
  twitch.onVisibilityChanged((visible, context) => {
    traceTimeoutDebug('twitch.onVisibilityChanged', {
      visible: Boolean(visible),
      context: summarizeTimeoutContext(context),
    });
    if (!visible) {
      // En vue Component, Twitch possède déjà la visibilité de l'iframe. Ne
      // pas cacher notre drawer ici : le dock est volontairement masqué dans
      // cette vue, donc setOpen(false) rendrait le composant complètement vide
      // sur un simple signal de visibilité sans rapport avec la modération.
      if (!isComponentView) setOpen(false);
      return;
    }
    if (isComponentView) setOpen(true);
    if (token) refresh();
  });
  // Un push serveur (nouvelle redemption reçue par EventSub) ne fait que
  // déclencher une relecture authentifiée : on ne fait jamais confiance au
  // contenu du message pour l'affichage.
  twitch.listen?.('broadcast', () => {
    traceTimeoutDebug('twitch.listen.broadcast');
    refresh();
  });

  // Twitch peut suspendre l'iframe pendant une pause, une minimisation ou un
  // changement d'onglet sans rappeler onAuthorized à la reprise.
  const resume = () => {
    if (document.visibilityState === 'hidden') return;
    traceTimeoutDebug('app.resume', { document_visibility: document.visibilityState });
    if (isComponentView) setOpen(true);
    if (token) refresh();
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);
}
