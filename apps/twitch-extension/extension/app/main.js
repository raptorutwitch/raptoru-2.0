// Shell v2 — the ONE viewer entry of every surface (plan § 1.2 app/boot + app/store): replaces the logic written
// twice in overlay.js (video component) and mobile.js (panel, mobile). Same behaviour, same Twitch callbacks:
//   - Twitch helper: onAuthorized (always the latest JWT), listen('broadcast') → authenticated re-read, never trust
//     the message; onVisibilityChanged / visibilitychange / pageshow / focus → re-read on resume.
//   - Session poller: one timer, paused while the page is hidden; 5 s while the viewer looks at the panel, 15 s
//     otherwise and after an error (the cadences of the historical entries).
//   - Grey-screen guard: no helper → a recoverable error at once; no onAuthorized within 10 s → the same.
//   - Video component: Twitch owns the iframe; the drawer is always open there; ✕ minimizes the component.
import { createClient, errorLabel, isDemo, sessionFailureState } from '../shared/api.js';
import { notificationCount } from '../shared/experience.js';
import {
  installTimeoutDebugLifecycle,
  summarizeTimeoutContext,
  summarizeTimeoutJwt,
  timeoutDebugMetadata,
  traceTimeoutDebug,
} from '../shared/timeout-debug.js';
import { installDblclickGuard } from '../shared/dblclick-guard.js';
import { mountEnvironmentBadge } from '../shared/env-badge.js';
import { createModulePanel } from './panel.js';
import { createPoller } from './store.js';

export function startViewer({ surface }) {
  mountEnvironmentBadge();
  installDblclickGuard(); // a double-click on OUR controls never asks the player for full screen
  const video = surface === 'video';
  const query = new URLSearchParams(window.location.search);
  const isStudio = query.get('studio') === '1';
  const drawer = document.getElementById('drawer');
  const dock = document.querySelector('.dock');
  const count = document.getElementById('dock-count');
  const isOpen = () => !drawer || !drawer.hidden;

  let token = null;
  const client = createClient({ getToken: () => token });
  const showCount = (state) => {
    if (!count) return;
    const n = notificationCount(state);
    count.hidden = n === 0;
    count.textContent = String(n);
  };
  const panel = createModulePanel({
    root: document.getElementById('panel'),
    client,
    onRefresh: () => poller.now(),
    initialModule: query.get('demoModule'),
    onNotificationChange: () => showCount(panel.state),
  });
  const traceDom = video ? installTimeoutDebugLifecycle({ isComponentView: true, getOpen: isOpen }) : () => {};
  traceTimeoutDebug('extension.script.loaded', {
    path: window.location.pathname,
    shell: 'v2',
    surface,
    document_ready_state: document.readyState,
    twitch_helper_present: Boolean(window.Twitch?.ext),
    runtime: timeoutDebugMetadata(),
  });

  const poller = createPoller({
    // Studio previews refresh on demand only (as overlay.js did).
    auto: !isStudio,
    interval: (failed) => (failed ? 15_000 : document.visibilityState === 'visible' && isOpen() ? 5_000 : 15_000),
    async run() {
      traceTimeoutDebug('app.refresh.start', { surface, drawer_open: isOpen() });
      try {
        const session = await client.refresh();
        panel.setState(session);
        traceTimeoutDebug('app.refresh.success', {
          identity_shared: session?.identity_shared === true,
          interactions_available: session?.interactions?.available !== false,
          module_ids: Array.isArray(session?.modules) ? session.modules.map((m) => m.id) : [],
        });
        showCount(session);
        return true;
      } catch (error) {
        traceTimeoutDebug('app.refresh.failure', {
          error_name: error?.name ? String(error.name) : null,
          error_code: String(error?.code ?? error?.message ?? 'unknown').slice(0, 160),
        });
        const failedState = sessionFailureState(panel.state, error);
        if (failedState) panel.setState(failedState);
        panel.setError(errorLabel(error?.code), () => poller.now());
        showCount(panel.state);
        return false;
      }
    },
  });

  function setOpen(open) {
    if (!drawer) return;
    drawer.hidden = !open;
    if (dock) dock.hidden = open;
    document.getElementById('toggle')?.setAttribute('aria-expanded', String(open));
    if (!open) panel.collapse();
    traceDom('setOpen');
  }

  if (video) {
    // Twitch shows its own purple button and opens this page in the component frame: content at once.
    document.body.classList.add('component-view');
    setOpen(true);
    document.getElementById('toggle')?.addEventListener('click', () => {
      setOpen(true);
      if (token || isDemo()) void poller.now();
    });
    document.getElementById('close')?.addEventListener('click', () => {
      if (window.Twitch?.ext?.actions?.minimize) window.Twitch.ext.actions.minimize();
      else setOpen(false);
    });
  } else {
    // Panel / mobile: « Actualiser » lives in Préférences; the page button stays wired for older layouts.
    document.getElementById('refresh')?.addEventListener('click', () => poller.now());
  }

  const twitch = window.Twitch?.ext;
  traceTimeoutDebug('twitch.helper.ready', {
    available: Boolean(twitch),
    helper_version: twitch?.version || null,
    helper_environment: twitch?.environment || null,
  });

  if (isDemo()) {
    // A local host may load the helper without ever calling onAuthorized: the preview always wins.
    void poller.now();
  } else if (twitch) {
    let previousTokenExp = null;
    twitch.onAuthorized((auth) => {
      const claims = summarizeTimeoutJwt(auth?.token);
      traceTimeoutDebug('twitch.onAuthorized', {
        token_present: Boolean(auth?.token),
        role: claims.role,
        token_exp_changed: previousTokenExp !== null && claims.exp !== previousTokenExp,
      });
      if (claims.exp !== null && claims.exp !== undefined) previousTokenExp = claims.exp;
      client.resetSession();
      token = auth.token;
      if (video) setOpen(true);
      void poller.now();
    });
    twitch.onContext?.((context, changed) => traceTimeoutDebug('twitch.onContext', {
      context: summarizeTimeoutContext(context),
      changed_fields: Array.isArray(changed) ? changed.map(String) : [],
    }));
    twitch.onError?.((error) => traceTimeoutDebug('twitch.onError', { error_message: error?.message || error || '' }));
    twitch.onVisibilityChanged?.((visible) => {
      traceTimeoutDebug('twitch.onVisibilityChanged', { visible: Boolean(visible) });
      // The component's iframe visibility belongs to Twitch: never close our drawer there (empty component).
      if (!visible) return;
      if (video) setOpen(true);
      if (token) void poller.now();
    });
    // A server push only triggers an authenticated re-read: its content is never displayed.
    twitch.listen?.('broadcast', () => { traceTimeoutDebug('twitch.listen.broadcast'); void poller.now(); });
  }

  // Twitch can suspend the iframe (pause, minimise, tab change, mobile power saving) without a new onAuthorized.
  const resume = () => {
    if (document.visibilityState === 'hidden') return;
    if (video) setOpen(true);
    if (token) void poller.now();
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);

  // Grey-screen guard (backup 99157a3): blocked helper or no onAuthorized → a recoverable error, cleared by a
  // session received later.
  if (!isDemo()) {
    const authFailed = () => panel.setError(
      'Connexion à Twitch impossible. Désactive le bloqueur ou les boucliers pour twitch.tv, puis réessaie.',
      () => window.location.reload(),
    );
    if (!twitch) authFailed();
    else window.setTimeout(() => { if (!token && !panel.state) authFailed(); }, 10_000);
  }
  return { panel, client, poller };
}
