// Access to the viewer's Twitch emotes (Bonk « Twitch » source), out of ui.js (docs/studio-refonte/architecture/
// MIGRATIONS.md). A panel-level service, not a screen: its notice shows on every screen, an authorization confirmed late
// by the server is still confirmed, and the catalog follows the session's identity. It owns the catalog (with its
// generation, cache and synchronization reads), the authorization (popup, polling, late window) and its notice.
// The host gives: its state (read / apply a fresh one), a redraw, its refresh, and whether Bonk is the open screen (the
// synchronization is followed only there). Core stays the authority: the server's state confirms an authorization.

import { errorLabel } from './api.js';
import { RUNTIME } from './runtime-config.js';

const EMOTE_CATALOG_REFRESH_MS = 10 * 60 * 1000;
export const EMOTE_AUTH_POLL_INTERVAL_MS = 2_000;
export const EMOTE_AUTH_TIMEOUT_MS = 90_000;
export const EMOTE_AUTH_POPUP_GRACE_MS = 5_000;
/** Après une tentative, une autorisation vue plus tard par le serveur est encore confirmée pendant ce délai. */
const EMOTE_AUTH_LATE_WINDOW_MS = 10 * 60_000;

export function emoteCatalogStateKey(emotes, twitchUserId = '') {
  return [
    String(twitchUserId || ''),
    emotes?.twitch_connected === true ? 'viewer' : 'public',
    emotes?.seven_tv === true ? '7tv' : 'no-7tv',
    emotes?.bttv === true ? 'bttv' : 'no-bttv',
    emotes?.ffz === true ? 'ffz' : 'no-ffz',
  ].join('|');
}

/**
 * Attend la confirmation serveur d'une autorisation viewer sans dépendre de
 * window.opener. Le premier contrôle est immédiat, puis les contrôles restent
 * séquentiels pour ne jamais empiler des GET /state.
 */
export function createEmoteAuthorizationPoller({
  check,
  isPopupClosed = () => false,
  onSuccess = () => {},
  onStopped = () => {},
  intervalMs = EMOTE_AUTH_POLL_INTERVAL_MS,
  timeoutMs = EMOTE_AUTH_TIMEOUT_MS,
  popupGraceMs = EMOTE_AUTH_POPUP_GRACE_MS,
  now = () => Date.now(),
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  cancel = (timer) => globalThis.clearTimeout(timer),
} = {}) {
  if (typeof check !== 'function') throw new TypeError('oauth_poll_check_required');
  const safeNow = () => {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  };
  const safeDelay = (value) => Math.max(0, Number(value) || 0);
  let active = false;
  let timer = null;
  let generation = 0;
  let startedAt = 0;
  let popupClosedAt = null;

  function clearTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  async function stop(reason, { notify = true } = {}) {
    const wasActive = active;
    active = false;
    generation += 1;
    clearTimer();
    if (notify && wasActive) await onStopped(reason);
  }

  async function tick(runGeneration) {
    if (!active || runGeneration !== generation) return;
    const current = safeNow();
    if (current - startedAt >= timeoutMs) {
      await stop('timeout');
      return;
    }

    let closed;
    try { closed = isPopupClosed() === true; } catch { closed = true; }
    if (closed && popupClosedAt === null) popupClosedAt = current;

    let confirmed = false;
    try { confirmed = (await check({ popupClosed: closed })) === true; } catch { /* prochain poll */ }
    if (!active || runGeneration !== generation) return;
    if (confirmed) {
      await stop('success', { notify: false });
      await onSuccess();
      return;
    }

    const afterCheck = safeNow();
    if (afterCheck - startedAt >= timeoutMs) {
      await stop('timeout');
      return;
    }
    if (popupClosedAt !== null && afterCheck - popupClosedAt >= popupGraceMs) {
      await stop('popup_closed');
      return;
    }

    const remainingGrace = popupClosedAt === null
      ? intervalMs
      : Math.max(0, popupGraceMs - (afterCheck - popupClosedAt));
    timer = schedule(() => {
      timer = null;
      void tick(runGeneration);
    }, safeDelay(Math.min(intervalMs, remainingGrace)));
  }

  return {
    start() {
      void stop('restart', { notify: false });
      active = true;
      generation += 1;
      startedAt = safeNow();
      popupClosedAt = null;
      void tick(generation);
    },
    stop(reason = 'cancelled') {
      return stop(reason);
    },
    get active() { return active; },
  };
}

export function createEmoteAccess({ document, window: win, client, getState, applyState, redraw, refreshHost, following }) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  function flash(node, message, kind = 'error') {
    const box = el('p', `jdm-flash jdm-flash--${kind}`, message);
    node.append(box);
    setTimeout(() => box.remove(), 4000);
  }
  let emoteCatalog = null;
  let emoteCatalogKey = null;
  let emoteCatalogLoadedAt = 0;
  let emoteLoading = false;
  let emoteError = null;
  let emoteCatalogGeneration = 0;
  let emoteForceReloadPending = false;
  let emoteAuthorizationStarting = false;
  // Twitch emotes being synchronized (Core reloads them in the background): re-read every 3 s, at most
  // 20 times per visit of Bonk, one timer only; stops as soon as the state is stable or Bonk is left.
  let emoteSyncTimer = null;
  let emoteSyncReads = 0;
  let emoteAuthorizationPopup = null;
  let emoteAuthorizationPoller = null;
  let emoteAuthorizationFinishing = false;
  // Autorisation des emotes vue par le viewer (en cours · autorisé · non confirmé · erreur) : redessinée à chaque
  // render, elle ne se perd plus quand le panneau se reconstruit pendant que le viewer est dans la fenêtre Twitch.
  let emoteAuthNotice = null;
  let emoteAuthNoticeTimer = null;
  let emoteAuthAttemptAt = 0;

  win.addEventListener('message', (event) => {
    const data = event.data;
    if (
      event.source !== emoteAuthorizationPopup
      || data?.type !== 'raptoru:oauth-complete'
      || data?.flow !== 'viewer-emotes'
      || data?.ok !== true
    ) return;
    let oauthOrigin;
    try { oauthOrigin = new URL(RUNTIME.siteUrl).origin; } catch { return; }
    if (!oauthOrigin || event.origin !== oauthOrigin) return;

    // Le message est le chemin rapide, mais le serveur reste l'autorité :
    // on relit /state avant de considérer l'autorisation comme terminée.
    void confirmEmoteAuthorization();
  });

  /** `kind` : pending · success · info · error ; null retire le message. */
  function setEmoteAuthNotice(kind, text = '') {
    clearTimeout(emoteAuthNoticeTimer);
    emoteAuthNoticeTimer = null;
    const notice = kind ? { kind, text } : null;
    emoteAuthNotice = notice;
    redraw();
    if (!notice || kind === 'pending') return;
    // Le viewer est peut-être encore dans la fenêtre Twitch : le résultat reste jusqu'à son retour sur
    // l'extension (pointeur ou focus), puis 8 s.
    const arm = () => {
      document.removeEventListener('pointermove', arm);
      document.removeEventListener('focusin', arm);
      if (emoteAuthNotice !== notice) return;
      emoteAuthNoticeTimer = setTimeout(() => {
        if (emoteAuthNotice === notice) setEmoteAuthNotice(null);
      }, 8_000);
    };
    document.addEventListener('pointermove', arm);
    document.addEventListener('focusin', arm);
  }

  function emoteAuthNoticeView({ kind, text }) {
    const box = el('div', `rl-emote-auth rl-emote-auth--${kind}`);
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const mark = el('span', 'rl-emote-auth__mark', kind === 'success' ? '✓' : kind === 'error' ? '!' : kind === 'info' ? 'i' : '');
    mark.setAttribute('aria-hidden', 'true');
    box.append(mark, el('span', 'rl-emote-auth__text', text));
    if (kind !== 'pending') {
      const close = el('button', 'rl-emote-auth__close', '✕');
      close.type = 'button';
      close.setAttribute('aria-label', 'Fermer le message');
      close.addEventListener('click', () => setEmoteAuthNotice(null));
      box.append(close);
    }
    return box;
  }

  function closeEmoteAuthorizationPopup() {
    const popup = emoteAuthorizationPopup;
    emoteAuthorizationPopup = null;
    try { popup?.close(); } catch { /* fenêtre déjà fermée */ }
  }

  async function confirmEmoteAuthorization({ refreshed = false } = {}) {
    if (emoteAuthorizationFinishing) return false;
    emoteAuthorizationFinishing = true;
    try {
      if (!refreshed) {
        const next = await client.refresh();
        if (next && typeof next === 'object') applyState(next);
      }
      if (getState()?.emotes?.twitch_connected !== true) return false;

      const poller = emoteAuthorizationPoller;
      emoteAuthorizationPoller = null;
      await poller?.stop('success');
      closeEmoteAuthorizationPopup();
      emoteAuthorizationStarting = false;
      redraw();
      emoteAuthAttemptAt = 0;
      setEmoteAuthNotice('success', 'Emotes Twitch connectées : tes emotes personnelles sont disponibles.');
      await loadEmotes({ force: true });
      return true;
    } catch {
      // Le polling garde la main si une relecture transitoire échoue.
      return false;
    } finally {
      emoteAuthorizationFinishing = false;
    }
  }

  function startEmoteAuthorizationPolling() {
    const popup = emoteAuthorizationPopup;
    let poller;
    poller = createEmoteAuthorizationPoller({
      check: async () => {
        const next = await client.refresh();
        if (next && typeof next === 'object') applyState(next);
        return getState()?.emotes?.twitch_connected === true;
      },
      isPopupClosed: () => {
        try { return popup?.closed === true; } catch { return true; }
      },
      onSuccess: () => confirmEmoteAuthorization({ refreshed: true }),
      onStopped: (reason) => {
        if (emoteAuthorizationPoller === poller) emoteAuthorizationPoller = null;
        if (reason === 'success') return;
        emoteAuthorizationStarting = false;
        closeEmoteAuthorizationPopup();
        if (reason === 'timeout' || reason === 'popup_closed') {
          setEmoteAuthNotice('info', 'Autorisation non confirmée. Si tu viens de valider sur Twitch, la confirmation s’affichera ici ; sinon, réessaie.');
        } else redraw();
      },
    });
    emoteAuthorizationPoller = poller;
    poller.start();
  }

  /** not_linked · syncing · ready · stale · reauth_required (same values in the Lab and on Twitch). */
  function twitchEmotesStatus() {
    const key = emoteCatalogStateKey(getState()?.emotes, getState()?.twitch_user_id);
    const known = emoteCatalog && emoteCatalogKey === key ? emoteCatalog.twitch_status : null;
    return known ?? getState()?.emotes?.twitch_status ?? (getState()?.emotes?.twitch_connected === true ? 'ready' : 'not_linked');
  }

  function followEmoteSync() {
    clearTimeout(emoteSyncTimer);
    emoteSyncTimer = null;
    if (twitchEmotesStatus() !== 'syncing' || !following() || emoteSyncReads >= 20) return;
    emoteSyncReads += 1;
    emoteSyncTimer = setTimeout(() => {
      emoteSyncTimer = null;
      void loadEmotes({ poll: true });
    }, 3000);
  }

  async function loadEmotes({ force = false, poll = false } = {}) {
    if (emoteLoading) {
      if (force) emoteForceReloadPending = true;
      return;
    }
    const requestKey = emoteCatalogStateKey(getState()?.emotes, getState()?.twitch_user_id);
    if (!force && !poll && emoteCatalog
      && emoteCatalogKey === requestKey
      && Date.now() - emoteCatalogLoadedAt < EMOTE_CATALOG_REFRESH_MS) return;
    if (!getState()?.emotes?.connected || !client.emotes) return;
    const generation = emoteCatalogGeneration;
    emoteLoading = true;
    emoteError = null;
    try {
      const result = force && client.refreshEmotes
        ? await client.refreshEmotes()
        : await client.emotes();
      if (!result.connected) throw Object.assign(new Error('emotes_not_connected'), { code: 'emotes_not_connected' });
      if (generation === emoteCatalogGeneration
        && requestKey === emoteCatalogStateKey(getState()?.emotes, getState()?.twitch_user_id)) {
        emoteCatalog = {
          groups: result.groups ?? [],
          count: Number(result.count || 0),
          diagnostics: result.diagnostics ?? null,
          twitch_connected: result.twitch_connected === true,
          twitch_status: result.twitch_status
            ?? (result.twitch_connected === true ? 'ready' : 'not_linked'),
        };
        emoteCatalogKey = requestKey;
        emoteCatalogLoadedAt = Date.now();
      }
    } catch {
      if (generation === emoteCatalogGeneration) {
        emoteError = 'Impossible de charger le catalogue d’emotes pour le moment.';
      }
    } finally {
      emoteLoading = false;
      redraw();
      followEmoteSync();
      if (emoteForceReloadPending) {
        emoteForceReloadPending = false;
        queueMicrotask(() => loadEmotes({ force: true }));
      }
    }
  }

  async function beginEmoteAuthorization(node) {
    if (emoteAuthorizationStarting) return;
    if (getState()?.identity_shared !== true) {
      const requestIdShare = window.Twitch?.ext?.actions?.requestIdShare;
      if (typeof requestIdShare !== 'function') {
        flash(node, 'Le partage d’identité est indisponible dans cet aperçu. Ouvre l’extension sur Twitch.', 'error');
        return;
      }
      try {
        requestIdShare();
        flash(node, 'Confirme d’abord le partage d’identité Twitch, puis autorise tes emotes.', 'ok');
      } catch {
        flash(node, 'Twitch n’a pas pu ouvrir la demande d’identité. Rouvre l’extension puis réessaie.', 'error');
      }
      return;
    }

    if (emoteAuthorizationPopup && !emoteAuthorizationPopup.closed) {
      try { emoteAuthorizationPopup.focus(); } catch { /* focus best effort */ }
      flash(node, 'La fenêtre Twitch est déjà ouverte.', 'ok');
      return;
    }
    // Blank window first, in the click itself (browsers keep the user gesture). Raptoru Studio refuses it
    // (only its own pages open inside; https links go to the system browser): then the Twitch URL itself
    // is opened, which Studio hands to the system browser.
    const popup = window.open('about:blank', '_blank');
    emoteAuthorizationPopup = popup;
    emoteAuthorizationStarting = true;
    try {
      const result = await client.startEmoteOAuth();
      const authorizationUrl = new URL(String(result?.authorization_url || ''));
      if (
        authorizationUrl.protocol !== 'https:'
        || authorizationUrl.hostname !== 'id.twitch.tv'
        || authorizationUrl.pathname !== '/oauth2/authorize'
      ) throw new Error('invalid_oauth_url');
      emoteAuthAttemptAt = Date.now();
      if (popup) {
        popup.location.replace(authorizationUrl.href);
        startEmoteAuthorizationPolling();
        setEmoteAuthNotice('pending', 'Autorisation en cours : valide dans la fenêtre Twitch, la confirmation s’affichera ici.');
      } else {
        // Studio answers null too when it opened the system browser: the message covers both cases.
        window.open(authorizationUrl.href, '_blank');
        startEmoteAuthorizationPolling();
        setEmoteAuthNotice('pending', 'Connexion Twitch ouverte dans ton navigateur : valide, puis reviens ici. Si rien ne s’ouvre, autorise les fenêtres Twitch.');
      }
    } catch (error) {
      const poller = emoteAuthorizationPoller;
      emoteAuthorizationPoller = null;
      void poller?.stop('start_failed');
      try { popup.close(); } catch { /* fenêtre déjà fermée */ }
      closeEmoteAuthorizationPopup();
      emoteAuthorizationStarting = false;
      setEmoteAuthNotice('error', `Autorisation Twitch impossible : ${errorLabel(error?.code)}`);
    }
  }

  async function disconnectEmoteAuthorization(node) {
    if (!client.disconnectEmotes) return;
    try {
      await client.disconnectEmotes();
      emoteCatalogGeneration += 1;
      emoteCatalog = null;
      emoteError = null;
      if (getState()?.emotes) getState().emotes.twitch_connected = false;
      try { await refreshHost(); } catch { /* le polling synchronisera l’état */ }
      flash(node, 'Accès aux emotes personnelles retiré. Les emotes publiques restent disponibles.', 'ok');
      await loadEmotes({ force: true });
    } catch (error) {
      flash(node, errorLabel(error?.code), 'error');
    }
  }

  /** Bonk drawn: load the catalog when missing, stale or for another identity; else follow a synchronization. */
  function ensure() {
    const state = getState();
    const key = emoteCatalogStateKey(state?.emotes, state?.twitch_user_id);
    const expired = !emoteCatalogLoadedAt || Date.now() - emoteCatalogLoadedAt >= EMOTE_CATALOG_REFRESH_MS;
    if (state?.emotes?.connected && (!emoteCatalog || emoteCatalogKey !== key || expired) && !emoteLoading) {
      queueMicrotask(loadEmotes);
    } else if (!emoteLoading && !emoteSyncTimer && twitchEmotesStatus() === 'syncing') {
      queueMicrotask(followEmoteSync);
    }
  }

  return {
    get catalog() { return emoteCatalog; },
    get loading() { return emoteLoading; },
    get error() { return emoteError; },
    get starting() { return emoteAuthorizationStarting; },
    status: twitchEmotesStatus,
    ensure,
    load: (options) => loadEmotes(options),
    begin: (node) => beginEmoteAuthorization(node),
    disconnect: (node) => disconnectEmoteAuthorization(node),
    /** The authorization's notice for this render (any screen), or null. */
    noticeView: () => (emoteAuthNotice ? emoteAuthNoticeView(emoteAuthNotice) : null),
    /** A new session state: a late confirmation, or a catalog that belongs to another identity. */
    onState(previous, next, { render }) {
      const wasTwitchConnected = previous?.emotes?.twitch_connected === true;
      // Validation reconnue après la fin de l'attente (fenêtre fermée tôt, retour tardif) : confirmée quand même,
      // dès que le serveur la voit — jamais avant.
      if (!wasTwitchConnected && next?.emotes?.twitch_connected === true && !emoteAuthorizationPoller
        && emoteAuthAttemptAt && Date.now() - emoteAuthAttemptAt < EMOTE_AUTH_LATE_WINDOW_MS) {
        queueMicrotask(() => void confirmEmoteAuthorization({ refreshed: true }));
      }
      if (emoteCatalogStateKey(previous?.emotes, previous?.twitch_user_id) !== emoteCatalogStateKey(next?.emotes, next?.twitch_user_id)) {
        emoteCatalogGeneration += 1;
        emoteCatalog = null;
        emoteCatalogKey = null;
        emoteCatalogLoadedAt = 0;
        emoteError = null;
        if (render) queueMicrotask(() => loadEmotes({ force: true }));
      }
    },
    /** A new visit of Bonk follows a synchronization again; leaving it stops following. */
    leaveVisit() {
      clearTimeout(emoteSyncTimer);
      emoteSyncTimer = null;
      emoteSyncReads = 0;
    },
  };
}
