// Shell v2 — panel (Hub, chrome, module host). Started as a copy of shared/ui.js (legacy shell, unchanged for the
// rollback); the v2 changes are marked « v2 : ». Views and services stay in shared/ (one implementation each).
// Rendu des modules, partagé par l'overlay desktop et le viewer mobile.
// Les deux surfaces ont la MÊME logique et des CSS différents : une seule
// implémentation métier, deux mises en page.

import { ERROR_LABELS, errorLabel } from '../shared/api.js';
import { modulePresentation, notificationCount, resolveExperience, syncNotificationCenter } from '../shared/experience.js';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  resolveNotification,
  unreadNotificationCount,
} from '../shared/notifications.js';
import { createEmoteAccess } from '../shared/emote-access.js';
import { walletPaymentMethods } from '../shared/wallet-payment.js';
import {
  createWalletFace,
  createCurrencySwitch,
  formatWalletExactValue,
} from '../shared/ui-primitives.js';
import { createHubCarousel, hubIcon } from '../shared/hub-carousel.js';
import { readTutorialDisabled, writeTutorialDisabled } from '../shared/tutorial-prefs.js';
// v2 : Soundboard, Bonk, TTS (V2 puis V1) et Modération (D4 puis V1) ne sont plus importés ici : app/lazy-views.js les
// charge à l'ouverture du module (ou en arrière-plan une fois le Hub affiché). Ils s'enregistrent comme avant.
import { lazyViewReady, loadLazyView, prefetchLazyViews } from './lazy-views.js';
import { historyActionIcon, historyCost, historyQuantity } from '../shared/history-format.js';
// Session modules: each registers itself (card, availability, view) — the import order is the Hub order.
import '../shared/commands-public.js';
import '../shared/sub-wheel-ext.js';
import '../shared/events-shop.js';
import '../shared/tombola-v2.js';
// Music Hub (docs/music/MUSIC_HUB_STATE.md): the song requests' entry — a tiny file; its view and sheet load on opening.
import '../modules/music/module.js';
// Tombola V1 for the sessions without V2 (its « open » rule is also the Hub's and the header's).
import { raffleIsActive } from '../shared/tombola-v1.js';
// The module host (architecture socle): viewer modules register themselves; ui.js only hosts them.
import { hostModules, loadHostModules, moduleVariant, sessionModule, sessionModules, viewerModuleView } from '../shared/module-registry.js';
import { createModuleModerationPanel } from '../shared/module-moderation.js';
import '../shared/coffre-mystere.js';
import {
  hideRestrictions,
  holdsAction,
  isHidden,
  restrictionChips,
  restrictionFor,
  restrictionId,
  restrictionModal,
  restrictionPill,
  restrictionsFor,
  tickRestrictions,
} from '../shared/viewer-restrictions.js';
import { boxWidth } from '../shared/box.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// Icônes du Soundboard (sbx-*) : tracés simples, couleur héritée.
function createNotificationBellIcon() {
  const createNode = typeof document.createElementNS === 'function'
    ? (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag)
    : (tag) => document.createElement(tag);
  const svg = createNode('svg');
  svg.classList.add('jdm-notification-toggle__icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const bell = createNode('path');
  bell.setAttribute('d', 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z');
  bell.setAttribute('fill', 'none');
  bell.setAttribute('stroke', 'currentColor');
  bell.setAttribute('stroke-linecap', 'round');
  bell.setAttribute('stroke-linejoin', 'round');
  bell.setAttribute('stroke-width', '1.8');

  const clapper = createNode('path');
  clapper.setAttribute('d', 'M10 21h4');
  clapper.setAttribute('fill', 'none');
  clapper.setAttribute('stroke', 'currentColor');
  clapper.setAttribute('stroke-linecap', 'round');
  clapper.setAttribute('stroke-width', '1.8');

  svg.append(bell, clapper);
  return svg;
}

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

// Soundboard help copy, kept for the tutorial (not wired yet).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SOUNDBOARD_HELP_PAGES = Object.freeze([
  'Choisis un son dans la liste, puis appuie sur Envoyer pour le jouer sur le stream.',
  'Utilise 🔊 pour écouter gratuitement un son avant de l’envoyer.',
  'Tu peux payer en Jetons ou utiliser un Crédit. Change de monnaie avec le switch ou le wallet.',
  'Utilise 🔍 pour retrouver rapidement un son.',
  '🔊 règle le volume de tes aperçus.',
]);
const ACTIONS_MODULE = Object.freeze({
  id: 'actions',
  label: 'Actions',
  icon: '✓',
  description: 'Suis chaque interaction, de la file jusqu’à sa lecture ou son remboursement.',
});
// Hub « Pop Premium » : icône et couleurs propres à chaque module (présentation uniquement).
const HUB_MODULE_STYLES = Object.freeze({
  tts: { icon: 'tts', color: '#a855f7', color2: '#6366f1' },
  soundboard: { icon: 'soundboard', color: '#06b6d4', color2: '#3b82f6' },
  bonk: { icon: 'bonk', color: '#f59e0b', color2: '#ef4444' },
  raffle_join: { icon: 'raffle_join', color: '#ec4899', color2: '#a855f7' },
  moderation: { icon: 'moderation', color: '#10b981', color2: '#0e7490' },
  commands: { icon: 'commands', color: '#2fd8c4', color2: '#3b82f6' },
  event_shop: { icon: 'bat', color: '#7a1220', color2: '#d4561a' },
  // Music Hub: an emerald of Raptoru's own (never a music service's brand colour).
  music: { icon: 'music', color: '#16a34a', color2: '#0f766e' },
});
const HUB_DEFAULT_STYLE = Object.freeze({ icon: 'module', color: '#8b5cf6', color2: '#6366f1' });
const MODERATION_MODULE = Object.freeze({
  id: 'moderation',
  label: 'Modération',
  icon: '⚔',
  description: 'Valide les messages TTS et consulte l’activité du stream.',
});

function homeModuleDescription(mod) {
  return modulePresentation(mod?.id).homeDescription || String(mod?.description || '').trim();
}

function visibleModuleLabel(mod) {
  return mod?.id === ACTIONS_MODULE.id ? 'Historique' : mod?.label;
}

export function shouldAutoOpenTutorial({
  isStudioPreview = false,
  tutorialDisabled = false,
  openModule = null,
  modules = [],
} = {}) {
  return !isStudioPreview
    && !tutorialDisabled
    && !openModule
    && !modules.some((module) => module?.id === 'bonk');
}

/**
 * Returns only a reliable, user-facing Soundboard reason. Unknown errors stay
 * deliberately reason-less so the feedback never invents a cause from a
 * technical message or an exception string.
 */
export function soundboardFeedbackForError(error) {
  const code = String(error?.code ?? '').trim();
  return {
    kind: 'error',
    reason: code && Object.hasOwn(ERROR_LABELS, code) ? errorLabel(code) : '',
  };
}

// Une erreur de saisie, de solde ou de course normale reste locale au module.
// Seuls les incidents qui peuvent nécessiter une nouvelle action méritent une
// entrée persistante dans le Centre ; les messages de succès restent toujours
// des feedbacks éphémères.
const ACTIONABLE_RUNTIME_ERROR_CODES = new Set([
  // Les pannes temporaires restent dans le feedback local de l'action ; elles
  // ne méritent pas une entrée persistante dans l'historique du viewer.
  'moderation_batch_partial_failure',
  'redemption_expired',
  'redemption_not_found',
  'redemption_wrong_reward',
  'tts_control_failed',
  'tts_control_timeout',
  'tts_control_uncertain',
  'wallet_debit_failed',
  'wallet_debit_uncertain',
]);

const ACTION_REQUIRED_RUNTIME_ERROR_CODES = new Set([
  'moderation_batch_partial_failure',
  'redemption_expired',
  'redemption_not_found',
  'wallet_debit_uncertain',
  'tts_control_failed',
  'tts_control_timeout',
  'tts_control_uncertain',
]);

export function shouldPersistRuntimeError(error) {
  const code = String(error?.code ?? error?.message ?? '').trim();
  return ACTIONABLE_RUNTIME_ERROR_CODES.has(code);
}

/**
 * @param {object} options
 *   root      élément hôte
 *   client    client EBS
 *   onRefresh callback après une action réussie
 */
export function createModulePanel({ root, client, onRefresh, initialModule = null, onNotificationChange = null }) {
  let state = null;
  // Raptoru restrictions of this viewer (session `restrictions`, Core's rows): only times move here;
  // when one ends, the screen is drawn again from the same data (no extra request).
  const restrictionStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
  const restrictionOf = (moduleId) => restrictionFor(state?.restrictions, moduleId);
  const restrictionsOf = (moduleId) => restrictionsFor(state?.restrictions, moduleId);
  // Popup: closed ones are not shown again during this visit of the module (polls redraw the screen);
  // a new visit shows them again, unless « Ne plus afficher ce message » was ticked for them.
  let restrictionsSeen = new Set();
  globalThis.setInterval?.(() => {
    if (root.querySelector('[data-rl-end]') && tickRestrictions(root)) renderPreservingViewport();
  }, 1000);
  let openModule = initialModule;
  let busy = false;
  let loadError = null;
  let retryLoad = null;
  let successMessage = null;
  let actionError = null;
  /** A refused action of a view that shows its own error (`errorScope` = its module id): { scope, message }. */
  let scopedError = null;
  let tutorialOpen = false;
  let notificationCenterOpen = false;
  let viewerPreferencesOpen = false;
  let viewerPreferenceIdentity = null;
  let viewerPreferenceLoaded = false;
  let viewerPreferenceLoading = false;
  let viewerPreferenceSaving = false;
  let viewerPreferenceValue = false;
  let viewerPreferenceError = false;
  let viewerPreferenceRequest = 0;
  let tutorialStep = 0;
  let tutorialAutoOpened = false;
  let tutorialDisabled = false;
  // Chaque module possède sa monnaie ; le wallet est sa projection et son
  // sélecteur unique, tandis que la dépensabilité reste évaluée par le CTA.
  /** The currency chosen per module (TTS today); a module variant reads and writes its own entry. */
  const paymentChoice = {};
  /** What a registered view keeps between two visits of its module (its form drafts): host.memory. */
  const moduleMemory = {};
  // TTS V2 (Lab, Core-backed): one persistent view per opening of the module.
  // Moderation V2 (D4, Lab): persistent console reading / commanding Core while the module is open.
  /** « Modération › Commandes » (Commands V2) and whether it currently replaces the console. */
  /** Tombola V2 (Lab): persistent screen reading Core itself (never rebuilt by the host's polling). */
  /** Commands V2 public list (phase F), kept while « Commandes » is open. */
  /** The open module of the module host (one at a time) and its id. */
  let hostView = null;
  let hostViewId = null;
  /** The variant definition behind hostView (null: a session or host module view). */
  let hostVariant = null;
  /** v2 : the registered definition behind hostView (session module or variant): its optional live hooks
   * (rendered, onState) apply to a session module too, so a new module needs no host change to follow the session. */
  let hostDef = null;

  /** What a registered view receives from the host (module-registry.js): no module-specific code here. */
  function variantContext(def, mod, body = null) {
    return {
      document,
      client,
      /** The panel's root element: a view's listeners stay inside the panel (never document-wide). */
      root,
      module: mod,
      state,
      /** The module body of this draw (rendered only): views that draw into the host's container (Soundboard). */
      body,
      team: canModerate(),
      host: {
        home: () => navigateTo(null),
        refresh: () => onRefresh?.(),
        payment: {
          get: () => paymentChoice[mod?.id] ?? 'tokens',
          set: (method) => { paymentChoice[mod?.id] = method; },
          sync: (methods, onChange) => paymentWalletSync?.(methods, onChange),
        },
        walletMethods: () => walletPaymentMethods(mod, state),
        restrictionChips: (id) => {
          const list = restrictionsOf(id);
          return list.length ? restrictionChips(document, list) : null;
        },
        memory: (moduleMemory[mod?.id] ??= {}),
        /** The action runner (busy flag, refresh, notifications); `feedbackScope` + `onSettled`: the view says it. */
        run: (node, task, options) => run(node, task, options),
        /** The message of this module's last refused action run with `errorScope: <module id>` (cleared by the next state). */
        scopedError: () => (scopedError?.scope === mod?.id ? scopedError.message : null),
        /** The host's action feedback, for a view that shows it in its own place (the success is shown once). */
        feedback: () => {
          const shown = { success: successMessage, error: actionError };
          successMessage = null;
          return shown;
        },
        /** The module's active restriction that holds actions (cooldown or block), or null. */
        restriction: () => {
          const restriction = restrictionOf(mod?.id);
          return holdsAction(restriction) ? restriction : null;
        },
        interactions: () => ({ available: interactionsAvailableForState(), identityShared: identityShared() }),
        redraw: () => renderPreservingViewport(),
        /** The viewer-facing reason of a refusal, only when reliably known ('' otherwise). */
        errorReason: (error) => soundboardFeedbackForError(error).reason,
        /** The viewer's Twitch emotes (emote-access.js): catalog, authorization. */
        emotes: emoteAccess,
        /** A failure of this module in the notification centre. */
        notifyError: (error, { title } = {}) => publishRuntimeNotification(runtimeNotificationForError(error, {
          module: mod?.id,
          title: title ?? `Action ${mod?.id} échouée`,
          actionModule: mod?.id,
        })),
      },
    };
  }
  let paymentWalletSync = null;
  // Hub : module sélectionné dans le carousel et monnaie affichée par le wallet (consultation).
  let hubSelectedId = null;
  /** « Voir tous les modules » open: kept across the Hub's redraws (a new balance never closes it under the viewer). */
  let hubAllOpen = false;
  let hubWalletMethod = 'tokens';
  let hubCarousel = null;
  const isStudioPreview = new URLSearchParams(globalThis.location?.search || '').get('studio') === '1';
  // Access to the viewer's Twitch emotes (emote-access.js): catalog, authorization and its notice are its own state.
  const emoteAccess = createEmoteAccess({
    document,
    window,
    client,
    getState: () => state,
    applyState: (next) => updateState(next, { render: false }),
    redraw: () => renderPreservingViewport(),
    refreshHost: () => onRefresh?.(),
    following: () => openModule === 'bonk',
  });
  root.classList.add('jdm-shell');
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (notificationCenterOpen || viewerPreferencesOpen || tutorialOpen) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (tutorialOpen) {
      tutorialOpen = false;
      render();
      return;
    }
    if (notificationCenterOpen) {
      notificationCenterOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-notification-toggle')?.focus({ preventScroll: true }));
      return;
    }
    if (viewerPreferencesOpen) {
      viewerPreferencesOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-viewer-preferences-toggle')?.focus({ preventScroll: true }));
      return;
    }
  });
  document.addEventListener('click', (event) => {
    if (!notificationCenterOpen && !viewerPreferencesOpen) return;
    const target = event.target;
    if (target?.closest?.('.jdm-notification-center')
      || target?.closest?.('.jdm-viewer-preferences')
      || target?.closest?.('.jdm-notification-toggle')
      || target?.closest?.('.jdm-viewer-preferences-toggle')) return;
    notificationCenterOpen = false;
    viewerPreferencesOpen = false;
    renderPreservingViewport();
  });

  function canModerate() {
    return state?.moderation?.tts?.can_moderate === true;
  }

  function identityShared() {
    return state?.identity_shared === true;
  }

  function interactionsAvailableForState({ allowLab = true } = {}) {
    return identityShared()
      && (state?.interactions?.available !== false || (allowLab && state?.lab_mode));
  }

  function moduleById(id) {
    if (id === ACTIONS_MODULE.id) return ACTIONS_MODULE;
    if (id === MODERATION_MODULE.id) return canModerate() ? MODERATION_MODULE : null;
    const session = sessionModule(id);
    if (session) return session.available(sessionEnv()) ? session.card(state) : null;
    return (state?.modules ?? []).find((m) => m.id === id) ?? hostModules().find((m) => m.id === id) ?? null;
  }

  /** What a session module's availability reads (module-registry.js). */
  function sessionEnv() {
    return { state, client, document };
  }

  let runtimeNotificationSequence = 0;

  function notificationModuleForNode(node, fallback = null) {
    const fromDom = node?.closest?.('[data-module]')?.dataset?.module;
    return String(fromDom || fallback || openModule || 'global').trim() || 'global';
  }

  function publishRuntimeNotification(notification) {
    if (!notification) return null;
    const item = notify(notification);
    if (item) onNotificationChange?.();
    return item;
  }

  function runtimeNotificationForError(error, {
    module = 'global',
    title = 'Action échouée',
    actionModule = module,
    dedupeKey = null,
  } = {}) {
    const code = String(error?.code ?? error?.message ?? '').trim();
    if (!shouldPersistRuntimeError(error)) return null;
    const key = dedupeKey || `runtime:${module}:${code}`;
    const action = actionModule && actionModule !== 'global'
      ? { label: `Ouvrir ${notificationModuleLabel(actionModule)}`, module: actionModule }
      : null;
    return {
      id: `${key}:${Date.now()}:${++runtimeNotificationSequence}`,
      module,
      type: ACTION_REQUIRED_RUNTIME_ERROR_CODES.has(code) ? 'action_required' : 'error',
      severity: ACTION_REQUIRED_RUNTIME_ERROR_CODES.has(code) ? 'action_required' : 'error',
      title,
      message: errorLabel(code),
      created_at: new Date().toISOString(),
      dedupe_key: key,
      action,
    };
  }

  function runtimeNotificationForConfirmation({
    module,
    title,
    message,
    actionModule = module,
    dedupeKey,
    type = 'action_required',
  }) {
    if (!message) return null;
    const key = dedupeKey || `runtime:${module}:confirmation`;
    const action = actionModule && actionModule !== 'global'
      ? { label: `Ouvrir ${notificationModuleLabel(actionModule)}`, module: actionModule }
      : null;
    return {
      id: `${key}:${Date.now()}:${++runtimeNotificationSequence}`,
      module,
      type,
      severity: type,
      title,
      message: String(message),
      created_at: new Date().toISOString(),
      dedupe_key: key,
      action,
    };
  }

  const savedScrollPositions = new Map();

  function captureScrollPositions() {
    const positions = new Map([...root.querySelectorAll('[data-scroll-key]')]
      .map((node) => [node.dataset.scrollKey, {
        top: node.scrollTop,
        left: node.scrollLeft,
      }]));
    for (const [key, value] of positions) savedScrollPositions.set(key, value);
    return positions;
  }

  function restoreScrollPositions(positions = savedScrollPositions) {
    if (!positions?.size) return;
    for (const node of root.querySelectorAll('[data-scroll-key]')) {
      if (!positions.has(node.dataset.scrollKey)) continue;
      const position = positions.get(node.dataset.scrollKey);
      // Tolère les snapshots numériques de versions précédentes de la vue.
      node.scrollTop = typeof position === 'number' ? position : position?.top ?? 0;
      node.scrollLeft = typeof position === 'number' ? 0 : position?.left ?? 0;
    }
  }

  function renderPreservingViewport() {
    const scrollPositions = captureScrollPositions();
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const draftKey = active?.dataset?.draftKey ?? null;
    const selection = draftKey && typeof active.selectionStart === 'number'
      ? [active.selectionStart, active.selectionEnd]
      : null;
    render();
    restoreScrollPositions(scrollPositions);
    if (!scrollPositions.size) restoreScrollPositions(savedScrollPositions);
    if (draftKey) {
      const replacement = root.querySelector(`[data-draft-key="${draftKey}"]`);
      replacement?.focus({ preventScroll: true });
      if (selection && typeof replacement?.setSelectionRange === 'function') {
        replacement.setSelectionRange(...selection);
      }
    }
  }

  function updateState(next, { render = true } = {}) {
    // Hub and identical poll: nothing to redraw (an open module's view decides for itself: onState).
    const unchanged = render && !openModule && !loadError
      && JSON.stringify(stableState(state)) === JSON.stringify(stableState(next));
    const previous = state;
    // An error screen shown before this state must be redrawn away: never absorbed by a live update.
    const hadLoadError = !!loadError;
    state = next;
    emoteAccess.onState(previous, next, { render });
    loadError = null;
    retryLoad = null;
    actionError = null;
    scopedError = null;
    syncViewerPreferenceIdentity(next);
    // The open module's own live update (module variants: TTS V2, Tombola V2…): absorbed, the host does not redraw.
    // (v2 : only while the module is still offered — a module that disappears is closed by the redraw.)
    if (render && !hadLoadError && hostView && hostViewId === openModule && hostDef?.onState && moduleById(openModule)
      && hostDef.onState(hostView, next, previous, variantContext(hostDef, (next?.modules ?? []).find((m) => m.id === openModule) ?? hostDef.card?.(next)))) {
      return;
    }
    if (render && !unchanged) renderPreservingViewport();
  }

  /**
   * Tombola V2: the screen reads Core itself, the host only shows « Ouverte » on the Hub card. The
   * seconds left change on every read and would rebuild the whole Hub (flicker): not compared.
   */
  function stableState(value) {
    if (!value?.raffle || !(value.modules ?? []).some((m) => m.id === 'raffle_join' && m.raffle_v2)) return value;
    return { ...value, raffle: { ...value.raffle, ends_in_s: null } };
  }


  function navigateTo(moduleId) {
    hubAllOpen = false; // a module opened (or the Hub again): the list starts closed
    if (moduleId !== null && !moduleById(moduleId)) return;
    if (moduleId !== null) {
      notificationCenterOpen = false;
      viewerPreferencesOpen = false;
    }
    if (moduleId !== openModule) emoteAccess.leaveVisit();
    if (moduleId !== hostViewId) {
      hostView?.destroy?.();
      hostView = null;
      hostViewId = null;
      hostVariant = null;
      hostDef = null;
    }
    captureScrollPositions();
    if (moduleId !== openModule) restrictionsSeen = new Set();
    openModule = moduleId;
    if (moduleId === 'soundboard') {
      tutorialOpen = false;
      tutorialStep = 0;
    }
    render();
    restoreScrollPositions();
  }

  function flash(node, message, kind = 'error') {
    const box = el('p', `jdm-flash jdm-flash--${kind}`, message);
    node.append(box);
    setTimeout(() => box.remove(), 4000);
  }

  async function run(node, task, {
    onSuccess,
    success,
    errorScope = null,
    feedbackScope = null,
    confirm,
    pending,
    notification = null,
    /** `(ok, error)` once settled: a view that says the outcome itself (feedbackScope set) — the host stays quiet. */
    onSettled = null,
  } = {}) {
    if (busy) return;
    busy = true;
    actionError = null;
    if (feedbackScope) successMessage = null;
    if (errorScope) scopedError = null;
    root.dataset.busy = '1';
    if (!feedbackScope) flash(
      node,
      pending === undefined ? 'Envoi en cours…' : (typeof pending === 'function' ? pending() : pending),
      'ok',
    );
    try {
      const result = await task();
      await onSuccess?.(result);
      const confirmation = await confirm?.(result);
      // L'action est déjà acceptée par l'EBS à ce stade. Une panne du simple
      // rafraîchissement ne doit jamais transformer ce succès en erreur ni
      // pousser le viewer à cliquer une seconde fois.
      try { await onRefresh?.(); } catch { /* le prochain polling récupérera l'état */ }
      const shouldNotifyConfirmation = notification
        && (typeof notification.shouldNotify !== 'function' || notification.shouldNotify(confirmation));
      if (notification?.dedupeKey && (!confirmation || confirmation.confirmed !== false || !shouldNotifyConfirmation)) {
        resolveNotification(notification.dedupeKey);
      }
      if (shouldNotifyConfirmation) {
        publishRuntimeNotification(runtimeNotificationForConfirmation({
          ...notification,
          message: confirmation?.message || notification.message,
          dedupeKey: notification.dedupeKey,
        }));
      }
      // Le rafraîchissement reconstruit le panneau. Poser le succès après lui
      // évite qu'il soit aussitôt consommé par un premier rendu intermédiaire.
      actionError = confirmation?.confirmed === false
        ? String(confirmation.message || 'Commande envoyée, exécution non confirmée')
        : null;
      if (errorScope) scopedError = null;
      if (!feedbackScope) {
        if (confirmation?.confirmed === true) {
          successMessage = String(confirmation.message || (typeof success === 'function' ? success(result) : success || 'Action exécutée ✓'));
        } else if (confirmation?.confirmed === false) {
          successMessage = null;
        } else if (success !== undefined) {
          successMessage = typeof success === 'function' ? success(result) : success;
        } else if (result?.status === 'pending_review') successMessage = 'Message envoyé en validation ✓';
        else if (result?.status === 'queued') successMessage = 'Action mise en file ✓';
        else successMessage = 'Action envoyée ✓';
      }
      if (feedbackScope) onSettled?.(true);
    } catch (error) {
      const message = errorLabel(error?.code);
      if (errorScope) scopedError = { scope: errorScope, message };
      else if (!feedbackScope) actionError = message;
      if (feedbackScope) onSettled?.(false, error);
      const notificationModule = notificationModuleForNode(node,
        notification?.module || errorScope || feedbackScope || null);
      publishRuntimeNotification(runtimeNotificationForError(error, {
        module: notificationModule,
        title: notification?.title || `Action ${notificationModule === 'global' ? '' : `${notificationModule} `}échouée`.replace(/\s+/g, ' ').trim(),
        actionModule: notification?.actionModule || notificationModule,
        dedupeKey: notification?.dedupeKey || null,
      }));
    } finally {
      busy = false;
      delete root.dataset.busy;
      renderPreservingViewport();
    }
  }

  function tutorialDialog(tutorial) {
    const index = Math.min(Math.max(0, tutorialStep), tutorial.steps.length - 1);
    tutorialStep = index;
    const step = tutorial.steps[index];
    const overlay = el('div', 'jdm-tour');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'jdm-tour-title');

    const card = el('section', 'jdm-tour__card');
    const top = el('div', 'jdm-tour__top');
    top.append(
      el('span', 'jdm-tour__count', `${index + 1}/${tutorial.steps.length}`),
    );
    const skip = el('button', 'jdm-tour__skip', 'Passer');
    skip.type = 'button';
    skip.addEventListener('click', () => {
      tutorialOpen = false;
      render();
    });
    top.append(skip);

    const icon = el('span', 'jdm-tour__icon', step.icon);
    icon.setAttribute('aria-hidden', 'true');
    const kicker = step.kicker ? el('p', 'jdm-tour__kicker', step.kicker) : null;
    const title = el('h2', 'jdm-tour__title', step.title);
    title.id = 'jdm-tour-title';
    const heading = el('div', 'jdm-tour__heading');
    const headingCopy = el('div', 'jdm-tour__heading-copy');
    if (kicker) headingCopy.append(kicker);
    headingCopy.append(title);
    heading.append(icon, headingCopy);
    const copy = el('p', 'jdm-tour__copy', step.body);
    const highlights = el('div', 'jdm-tour__highlights');
    for (const highlight of step.highlights ?? []) {
      const chip = el('span', 'jdm-tour__highlight', highlight.label);
      chip.dataset.tone = highlight.tone ?? 'violet';
      highlights.append(chip);
    }
    const command = step.command ? el('code', 'jdm-tour__command', step.command) : null;

    const identityAction = step.action === 'identity'
      ? el(
        'button',
        'jdm-btn jdm-btn--primary jdm-tour__identity',
        state?.identity_shared !== true
          ? 'Partager mon identité Twitch'
          : state?.emotes?.twitch_connected
            ? 'Emotes déjà autorisées'
            : 'Autoriser mes emotes Twitch',
      )
      : null;
    if (identityAction) {
      identityAction.type = 'button';
      identityAction.disabled = Boolean(state?.emotes?.twitch_connected);
      identityAction.addEventListener('click', () => {
        if (state?.emotes?.twitch_connected) return;
        emoteAccess.begin(card);
      });
    }

    const remember = el('label', 'jdm-tour__remember');
    const rememberInput = document.createElement('input');
    rememberInput.type = 'checkbox';
    rememberInput.checked = tutorialDisabled;
    rememberInput.addEventListener('change', () => {
      tutorialDisabled = rememberInput.checked;
      writeTutorialDisabled(tutorial, tutorialDisabled);
    });
    remember.append(rememberInput, el('span', null, 'Ne plus afficher au lancement'));

    const dots = el('div', 'jdm-tour__dots');
    dots.setAttribute('aria-hidden', 'true');
    for (let dot = 0; dot < tutorial.steps.length; dot += 1) {
      const marker = el('span', 'jdm-tour__dot');
      if (dot === index) marker.classList.add('is-active');
      dots.append(marker);
    }

    const controls = el('div', 'jdm-tour__controls');
    const previous = el('button', 'jdm-btn', 'Précédent');
    previous.type = 'button';
    previous.disabled = index === 0;
    previous.addEventListener('click', () => {
      tutorialStep = Math.max(0, index - 1);
      render();
    });
    const last = index === tutorial.steps.length - 1;
    const next = el('button', 'jdm-btn jdm-btn--primary', last ? 'Terminer' : 'Suivant');
    next.type = 'button';
      next.addEventListener('click', () => {
      if (last) {
        tutorialOpen = false;
        tutorialStep = 0;
      } else {
        tutorialStep = index + 1;
      }
      render();
    });
    controls.append(previous, next);
    card.append(top, heading, copy);
    if (highlights.childElementCount) card.append(highlights);
    if (command) card.append(command);
    if (identityAction) card.append(identityAction);
    card.append(dots, remember, controls);
    overlay.append(card);
    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) return;
      tutorialOpen = false;
      render();
    });
    return overlay;
  }

  function historyIdentity(row) {
    const login = String(row?.login ?? '').trim().replace(/^@+/, '');
    const viewer = String(state?.viewer_login ?? '').trim().replace(/^@+/, '');
    if (!login || (viewer && login.toLowerCase() === viewer.toLowerCase())) return '';
    return `@${login} · `;
  }

  function personalHistory() {
    const section = el('section', 'jdm-history');
    section.setAttribute('aria-label', 'Mes actions');
    const head = el('div', 'jdm-history__head');
    head.append(el('strong', 'jdm-history__title', 'Mes actions'));
    section.append(head);
    const receipts = Array.isArray(state?.action_receipts) ? state.action_receipts : [];
    const receiptIds = new Set(receipts.map((row) => String(row.id || '')));
    const playedHistory = (Array.isArray(state?.recent_activity) ? state.recent_activity : [])
      .filter((row) => !receiptIds.has(String(row.id || '')))
      .map((row) => ({ ...row, status: 'played' }));
    const rows = [...receipts, ...playedHistory]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    if (!rows.length) {
      section.append(el('p', 'jdm-hint', 'Aucune interaction enregistrée pour le moment.'));
      return section;
    }
    const labels = { tts: 'TTS', soundboard: 'Soundboard', bonk: 'Bonk' };
    const statusLabels = {
      queued: 'En file · en attente de SAMMI',
      processing: 'Transmis à SAMMI',
      accepted: 'Acceptée · en attente du bridge',
      dispatched: 'Transmise à SAMMI',
      executed: 'Exécutée',
      enabled: 'Activé',
      disabled: 'Désactivé',
      failed: 'Échec d’exécution',
      timeout: 'Délai dépassé · exécution non confirmée',
      uncertain: 'Exécution non confirmée',
      no_active: 'Aucun TTS actif',
      played: 'Joué',
      refunded: 'Remboursé',
      refund_pending: 'Remboursement en cours',
      failed_no_charge: 'Échec — aucun jeton perdu',
      credit_restored: 'Crédit restauré — réessaie',
      review: 'Vérification nécessaire',
    };
    const statusShortLabels = {
      queued: 'En file',
      processing: 'Envoi',
      accepted: 'Acceptée',
      dispatched: 'Transmise',
      executed: 'Exécutée',
      enabled: 'Activé',
      disabled: 'Désactivé',
      failed: 'Échec',
      timeout: 'Délai',
      uncertain: 'Incertain',
      no_active: 'Aucun actif',
      played: 'Joué',
      refunded: 'Remboursé',
      refund_pending: 'Rembours.',
      failed_no_charge: 'Échec · 0 perdu',
      credit_restored: 'Crédit restauré',
      review: 'Vérif.',
    };
    const list = el('ol', 'jdm-history__list');
    for (const row of rows.slice(0, 20)) {
      const status = statusLabels[row.status] ? row.status : 'review';
      const item = el('li', `jdm-history__item is-${status}`);
      const actionId = String(row.action || '').toLowerCase();
      const action = labels[actionId] || row.label || 'Interaction';
      const detail = row.action === 'tts' || row.action === 'TTS'
        ? ''
        : String(row.detail || '').trim();
      const identity = historyIdentity(row);
      const quantity = historyQuantity(row);
      const targetLogin = String(row.target_login ?? '').trim().replace(/^@+/, '');
      const target = targetLogin ? ` → @${targetLogin}` : '';
      const cost = historyCost(row);
      const date = new Date(row.created_at || 0);
      const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const summary = `${identity}${detail || action}${quantity}${target}`;
      const icon = el('span', 'jdm-history__icon', historyActionIcon(actionId));
      icon.setAttribute('aria-hidden', 'true');
      const actionNode = el('strong', 'jdm-history__action', summary);
      const statusNode = el('span', 'jdm-history__status', statusShortLabels[status]);
      statusNode.title = statusLabels[status];
      statusNode.setAttribute('aria-label', statusLabels[status]);
      const timeNode = el('time', 'jdm-history__when', when);
      if (when) timeNode.dateTime = date.toISOString();
      item.setAttribute('aria-label', [summary, cost, statusLabels[status], when].filter(Boolean).join(' · '));
      item.title = item.getAttribute('aria-label');
      item.append(icon, actionNode);
      if (cost) item.append(el('span', 'jdm-history__cost', cost));
      item.append(statusNode, timeNode);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  function notificationRelativeTime(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
    if (minutes < 1) return 'À l’instant';
    if (minutes < 60) return `Il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Il y a ${hours} h`;
    return `Il y a ${Math.floor(hours / 24)} j`;
  }

  function notificationModuleLabel(moduleId) {
    if (!moduleId || moduleId === 'global') return 'Général';
    return modulePresentation(moduleId).shortLabel || moduleId;
  }

  function syncViewerPreferenceIdentity(next = state) {
    const key = next?.identity_shared === true
      ? `${String(next.channel_id || '')}:${String(next.twitch_user_id || '')}`
      : 'anonymous';
    if (key === viewerPreferenceIdentity) return;
    viewerPreferenceIdentity = key;
    viewerPreferenceLoaded = false;
    viewerPreferenceLoading = false;
    viewerPreferenceSaving = false;
    viewerPreferenceValue = false;
    viewerPreferenceError = false;
    viewerPreferenceRequest += 1;
  }

  function loadViewerPreference() {
    syncViewerPreferenceIdentity();
    if (!viewerPreferencesOpen
      || state?.identity_shared !== true
      || viewerPreferenceLoaded
      || viewerPreferenceLoading) return;
    if (typeof client?.getViewerPreference !== 'function') {
      viewerPreferenceLoaded = true;
      viewerPreferenceError = true;
      return;
    }
    viewerPreferenceLoading = true;
    viewerPreferenceError = false;
    const requestId = ++viewerPreferenceRequest;
    void Promise.resolve()
      .then(() => client.getViewerPreference())
      .then((response) => {
        if (requestId !== viewerPreferenceRequest) return;
        viewerPreferenceValue = response?.level_up_sfx_opt_in === true;
        viewerPreferenceLoaded = true;
        viewerPreferenceLoading = false;
        viewerPreferenceError = false;
        if (viewerPreferencesOpen) renderPreservingViewport();
      })
      .catch(() => {
        if (requestId !== viewerPreferenceRequest) return;
        // Lecture en échec = OFF. Le panneau reste utilisable et n'affiche
        // qu'un signal discret, sans jamais activer le son par défaut.
        viewerPreferenceValue = false;
        viewerPreferenceLoaded = true;
        viewerPreferenceLoading = false;
        viewerPreferenceError = true;
        if (viewerPreferencesOpen) renderPreservingViewport();
      });
  }

  function saveViewerPreference(nextValue) {
    if (viewerPreferenceSaving || typeof client?.setViewerPreference !== 'function') return;
    const previousValue = viewerPreferenceValue;
    viewerPreferenceValue = nextValue === true;
    viewerPreferenceSaving = true;
    viewerPreferenceError = false;
    const requestId = ++viewerPreferenceRequest;
    renderPreservingViewport();
    void Promise.resolve()
      .then(() => client.setViewerPreference(viewerPreferenceValue))
      .then((response) => {
        if (requestId !== viewerPreferenceRequest) return;
        viewerPreferenceValue = response?.level_up_sfx_opt_in === true;
        viewerPreferenceLoaded = true;
        viewerPreferenceSaving = false;
        viewerPreferenceError = false;
        if (viewerPreferencesOpen) renderPreservingViewport();
      })
      .catch(() => {
        if (requestId !== viewerPreferenceRequest) return;
        viewerPreferenceValue = previousValue;
        viewerPreferenceLoaded = true;
        viewerPreferenceSaving = false;
        viewerPreferenceError = true;
        if (viewerPreferencesOpen) renderPreservingViewport();
      });
  }

  /** Refonte H15: no announcement reads this preference yet (Level Up V2 is not live). */
  const LEVEL_UP_ANNOUNCE_VISIBLE = false;

  function viewerPreferencesPanel() {
    syncViewerPreferenceIdentity();
    loadViewerPreference();
    const panel = el('section', 'jdm-viewer-preferences');
    panel.id = 'jdm-viewer-preferences';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'jdm-viewer-preferences-title');

    const heading = el('strong', 'jdm-viewer-preferences__title', 'Préférences');
    heading.id = 'jdm-viewer-preferences-title';
    const close = el('button', 'jdm-viewer-preferences__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer les préférences');
    close.title = 'Fermer';
    close.addEventListener('click', () => {
      viewerPreferencesOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-viewer-preferences-toggle')?.focus({ preventScroll: true }));
    });
    const header = el('header', 'jdm-viewer-preferences__head');
    header.append(heading, close);

    const option = el('div', 'jdm-viewer-preferences__option');
    const label = el('label', 'jdm-viewer-preferences__label', 'Annoncer mes Level Up sur le stream');
    const input = el('input', 'jdm-viewer-preferences__control');
    input.type = 'checkbox';
    input.id = 'jdm-level-up-sfx-preference';
    input.checked = viewerPreferenceValue;
    input.setAttribute('aria-label', 'Annoncer mes Level Up sur le stream');
    label.htmlFor = input.id;
    const canEdit = state?.identity_shared === true
      && typeof client?.getViewerPreference === 'function'
      && typeof client?.setViewerPreference === 'function';
    input.disabled = !canEdit || viewerPreferenceLoading || viewerPreferenceSaving;
    input.title = !canEdit && state?.identity_shared !== true
      ? 'Partage ton identité Twitch pour modifier ce réglage.'
      : viewerPreferenceLoading
        ? 'Chargement…'
        : viewerPreferenceError
          ? 'Réglage indisponible. Réessaie en ouvrant les préférences.'
          : 'Annoncer mes Level Up sur le stream';
    input.addEventListener('change', () => saveViewerPreference(input.checked));
    option.append(label, input);
    if (viewerPreferenceError && state?.identity_shared === true) {
      const status = el('span', 'jdm-viewer-preferences__status', 'Indisponible');
      status.setAttribute('role', 'status');
      option.append(status);
    }
    const refreshAction = el('button', 'jdm-viewer-preferences__refresh', '↻ Actualiser');
    refreshAction.type = 'button';
    refreshAction.addEventListener('click', async () => {
      refreshAction.disabled = true;
      try { await onRefresh?.(); } catch { /* le polling reprendra */ }
      refreshAction.disabled = false;
    });
    // Refonte H15 (decided 05/11): « Annoncer mes Level Up » is read by nothing yet — hidden until it has a real effect.
    // The preference already saved stays stored (never deleted); the code above is kept for that day.
    panel.append(header, ...(LEVEL_UP_ANNOUNCE_VISIBLE ? [option] : []), refreshAction);
    return panel;
  }

  function notificationCenterDrawer() {
    const drawer = el('section', 'jdm-notification-center');
    drawer.id = 'jdm-notification-center';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'false');
    drawer.setAttribute('aria-labelledby', 'jdm-notification-center-title');

    const heading = el('strong', 'jdm-notification-center__title', 'Notifications');
    heading.id = 'jdm-notification-center-title';
    const close = el('button', 'jdm-notification-center__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer les notifications');
    close.title = 'Fermer';
    close.addEventListener('click', () => {
      notificationCenterOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-notification-toggle')?.focus({ preventScroll: true }));
    });
    const header = el('header', 'jdm-notification-center__head');
    header.append(heading, close);

    const tools = el('div', 'jdm-notification-center__tools');
    const unread = unreadNotificationCount();
    tools.append(el('span', 'jdm-notification-center__summary', unread ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout est lu'));
    const markAll = el('button', 'jdm-notification-center__mark-all', 'Tout marquer comme lu');
    markAll.type = 'button';
    markAll.disabled = unread === 0;
    markAll.addEventListener('click', () => {
      markAllNotificationsRead();
      onNotificationChange?.();
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-notification-center__mark-all')?.focus({ preventScroll: true }));
    });
    tools.append(markAll);

    const list = el('div', 'jdm-notification-center__list');
    list.dataset.scrollKey = 'notification-center-list';
    list.setAttribute('role', 'region');
    list.setAttribute('aria-label', 'Liste des notifications');
    list.setAttribute('tabindex', '0');
    const notifications = getNotifications();
    if (!notifications.length) {
      list.append(el('p', 'jdm-notification-center__empty', 'Aucune notification.'));
    } else {
      for (const notification of notifications) {
        const item = el('article', `jdm-notification${notification.read ? '' : ' is-unread'}`);
        item.dataset.notificationId = notification.id;
        const type = el('span', `jdm-notification__type jdm-notification__type--${notification.type}`,
          notification.type === 'error' ? '!' : notification.type === 'warning' ? '⚠' : notification.type === 'success' ? '✓' : '•');
        type.setAttribute('aria-hidden', 'true');
        const module = el('span', 'jdm-notification__module', notificationModuleLabel(notification.module));
        const when = el('time', 'jdm-notification__time', notificationRelativeTime(notification.created_at));
        when.dateTime = notification.created_at;
        const meta = el('div', 'jdm-notification__meta');
        meta.append(type, module, when);
        const copy = el('div', 'jdm-notification__copy');
        copy.append(el('strong', 'jdm-notification__title', notification.title));
        if (notification.message) copy.append(el('p', 'jdm-notification__message', notification.message));
        const actions = el('div', 'jdm-notification__actions');
        const actionTarget = notification.action?.module && moduleById(notification.action.module)
          ? notification.action.module
          : null;
        if (actionTarget) {
          const open = el('button', 'jdm-notification__action', notification.action.label);
          open.type = 'button';
          open.addEventListener('click', () => {
            markNotificationRead(notification.id, true);
            onNotificationChange?.();
            notificationCenterOpen = false;
            navigateTo(actionTarget);
          });
          actions.append(open);
        }
        const read = el('button', 'jdm-notification__read', notification.read ? 'Marquer non lue' : 'Marquer comme lue');
        read.type = 'button';
        read.dataset.notificationId = notification.id;
        read.addEventListener('click', () => {
          markNotificationRead(notification.id, !notification.read);
          onNotificationChange?.();
          renderPreservingViewport();
          queueMicrotask(() => [...root.querySelectorAll('.jdm-notification__read')]
            .find((button) => button.dataset.notificationId === notification.id)
            ?.focus({ preventScroll: true }));
        });
        actions.append(read);
        item.append(meta, copy, actions);
        item.setAttribute('aria-label', [notificationModuleLabel(notification.module), notification.title, notification.message, notification.read ? 'Lue' : 'Non lue'].filter(Boolean).join(' · '));
        list.append(item);
      }
    }
    drawer.append(header, tools, list);
    return drawer;
  }

  function render() {
    hubCarousel?.destroy();
    hubCarousel = null;
    root.replaceChildren();
    // Les callbacks pointent toujours vers le Soundboard actuellement rendu.
    // Un rerender d’état ne doit jamais conserver un listener vers une vue
    // démontée.
    paymentWalletSync = null;
    root.dataset.view = loadError ? 'error' : state ? (openModule ? 'module' : 'home') : 'loading';
    if (loadError) {
      const retry = el('button', 'jdm-btn jdm-btn--primary', 'Réessayer');
      retry.type = 'button';
      retry.addEventListener('click', () => retryLoad?.());
      root.append(el('div', 'jdm-empty', loadError), retry);
      return;
    }
    if (!state) {
      root.append(el('p', 'jdm-hint', 'Chargement…'));
      return;
    }

    syncNotificationCenter(state);
    const emoteNotice = emoteAccess.noticeView();
    if (emoteNotice) root.append(emoteNotice);

    const experience = resolveExperience(state);
    root.dataset.theme = experience.theme.id;
    if (!tutorialAutoOpened && (state.identity_shared || isStudioPreview)) {
      tutorialAutoOpened = true;
      tutorialDisabled = readTutorialDisabled(experience.tutorial);
      // Le studio garde sa vue de travail immédiatement disponible. En vrai
      // composant Twitch, le tutoriel s’ouvre une fois par ouverture tant que
      // le viewer n’a pas coché « Ne plus afficher ».
      if (shouldAutoOpenTutorial({
        isStudioPreview,
        tutorialDisabled,
        openModule,
        modules: state.modules ?? [],
      })) tutorialOpen = true;
    }

    if (!state.identity_shared) {
      const cta = el('button', 'jdm-btn jdm-ui-action jdm-btn--primary', 'Activer mes actions');
      cta.type = 'button';
      cta.setAttribute('aria-describedby', 'jdm-identity-help');
      cta.addEventListener('click', () => {
        const requestIdShare = window.Twitch?.ext?.actions?.requestIdShare;
        if (typeof requestIdShare !== 'function') {
          flash(root, 'La demande Twitch est indisponible dans cet aperçu. Teste ce bouton depuis l’extension Twitch.', 'error');
          return;
        }
        try {
          requestIdShare();
          flash(root, 'Confirme la fenêtre Twitch pour activer tes actions.', 'ok');
        } catch {
          flash(root, 'Twitch n’a pas pu ouvrir la demande. Rouvre l’extension puis réessaie.', 'error');
        }
      });
      const help = el('p', 'jdm-hint jdm-identity-help', 'Une fenêtre Twitch va s’ouvrir : valide le partage, puis l’extension se recharge automatiquement.');
      help.id = 'jdm-identity-help';
      root.append(
        el('p', 'jdm-identity-title', 'Active tes actions Twitch'),
        el('p', 'jdm-hint', 'Les emotes publiques restent disponibles. Partage ton identité Twitch pour débloquer tes actions payées, tes jetons et tes emotes personnelles.'),
        help,
        cta,
      );
    }

    // solde jetons
    const wallet = state.wallet ?? {};
    // A module that is paid in tokens or in its own credits says so (its variant's `wallet`): the header wallet becomes its
    // currency switch, with its credit balance and name. No module id here.
    const openSessionModule = openModule ? (state.modules ?? []).find((candidate) => candidate.id === openModule) : null;
    const payment = openSessionModule && !sessionModule(openModule)
      ? moduleVariant({ module: openSessionModule, state, client, document })?.wallet ?? null
      : null;
    const moderationView = openModule === MODERATION_MODULE.id && canModerate();
    const raffleView = openModule === 'raffle_join';
    const paymentView = Boolean(payment);
    const hubView = !openModule;
    const historyView = openModule === ACTIONS_MODULE.id;
    const consultView = hubView || historyView;
    const informativeView = !paymentView && !consultView && !moderationView;
    const updatedWalletView = paymentView || raffleView;
    let changeWalletMethod = null;
    const headerSwitch = paymentView || consultView || informativeView
      ? createCurrencySwitch({
        variant: 'balance',
        className: 'rl-cswitch--header',
        ariaLabel: consultView ? 'Soldes' : informativeView ? 'Solde de jetons' : 'Monnaie de paiement',
        onChange: () => changeWalletMethod?.(),
      })
      : null;
    const walletRow = headerSwitch
      ? headerSwitch.node
      : el('div', updatedWalletView
        ? 'jdm-wallet-stack'
        : 'jdm-wallet jdm-ui-wallet jdm-wallet--informative');
    if (!headerSwitch) {
      walletRow.setAttribute('role', 'group');
    }
    // Sans liste API, aucun zéro/solde fictif n'est présenté.
    const creditsKnown = Array.isArray(state.pending_actions);
    // Hub : total des crédits de tous les modules ; ils restent propres à chaque module.
    const creditRows = Array.isArray(state.pending_actions) ? state.pending_actions : [];
    const hubCreditsByModule = new Map();
    for (const row of creditRows) {
      const amount = Math.max(0, Number(row.credits_remaining ?? 1));
      hubCreditsByModule.set(row.module_id, (hubCreditsByModule.get(row.module_id) ?? 0) + amount);
    }
    const moduleCredits = consultView
      ? [...hubCreditsByModule.values()].reduce((sum, value) => sum + value, 0)
      : payment ? payment.credits(state) : 0;
    const creditModule = payment?.label ?? '';
    const creditWord = `crédit${moduleCredits > 1 ? 's' : ''}`;
    const exactCreditValue = creditsKnown ? formatWalletExactValue(moduleCredits) : 'Solde indisponible';
    const exactTokenValue = wallet.unavailable
      ? 'Solde de jetons indisponible'
      : formatWalletExactValue(wallet.available);
    const tokenView = createWalletFace({
      currency: 'tokens',
      value: wallet.available,
      unavailable: wallet.unavailable,
      hold: wallet.reserved,
    });
    const creditView = createWalletFace({
      currency: 'credits',
      value: moduleCredits,
      unavailable: !creditsKnown,
    });
    if (!headerSwitch) walletRow.append(tokenView, creditView);
    const syncWalletView = (methods = [], onMethodChange = null) => {
      const mode = payment ? (paymentChoice[openModule] ?? 'tokens') : consultView ? hubWalletMethod : 'tokens';
      const showingCredits = mode === 'credits';
      tokenView.classList.toggle('is-active', !showingCredits);
      creditView.classList.toggle('is-active', showingCredits);
      tokenView.setAttribute('aria-hidden', String(showingCredits));
      creditView.setAttribute('aria-hidden', String(!showingCredits));
      walletRow.dataset.walletMode = mode;
      walletRow.dataset.walletExactValue = showingCredits ? exactCreditValue : exactTokenValue;
      const balanceLabel = showingCredits
        ? `${exactCreditValue} ${creditWord} ${creditModule}`
        : `${wallet.unavailable ? exactTokenValue : `${exactTokenValue} jetons`}`;
      const next = methods.find((candidate) => candidate !== mode);
      const canSwitch = (paymentView || consultView) && Boolean(next);
      walletRow.dataset.payment = mode;
      walletRow.dataset.canSwitch = String(canSwitch);
      const switchLabel = next === 'credits' ? `Afficher les crédits ${creditModule}` : 'Afficher les jetons';
      const holdLabel = Number(wallet.reserved) > 0 ? ` · ${formatWalletExactValue(wallet.reserved)} jetons réservés` : '';
      if (!headerSwitch) {
        walletRow.setAttribute('aria-label', `${balanceLabel}${holdLabel}${canSwitch ? `. ${switchLabel}.` : ''}`);
        walletRow.title = `${balanceLabel}${holdLabel}${canSwitch ? ` · ${switchLabel}` : ''}`;
      }
      if (headerSwitch) {
        headerSwitch.sync({
          method: mode,
          methods: methods.length ? methods : [mode],
          amounts: {
            tokens: wallet.unavailable ? null : wallet.available,
            credits: creditsKnown ? moduleCredits : null,
          },
          details: {
            tokens: Number(wallet.reserved) > 0 ? `${formatWalletExactValue(wallet.reserved)} jetons réservés` : '',
            credits: consultView && hubCreditsByModule.size
              ? `${[...hubCreditsByModule].map(([id, amount]) => `${visibleModuleLabel((state.modules ?? []).find((m) => m.id === id) ?? { label: id })} ${formatWalletExactValue(amount)}`).join(' · ')} — propres à chaque module`
              : '',
          },
        });
      } else if (paymentView) {
        walletRow.setAttribute('aria-disabled', String(!canSwitch));
        tokenView.hidden = !methods.includes('tokens') && mode !== 'tokens';
        creditView.hidden = !methods.includes('credits') && mode !== 'credits';
      } else {
        // Les vues informatives (dont Tombola) restent jetons-only : elles
        // réutilisent la même pile de wallet sans exposer une face crédits
        // qui ne correspond à aucune capacité de paiement du module.
        tokenView.hidden = false;
        creditView.hidden = true;
      }
      // Callback vers le formulaire actif ; le wallet ne possède aucune monnaie.
      changeWalletMethod = canSwitch ? () => onMethodChange?.(next) : null;
    };
    syncWalletView();
    if (informativeView) syncWalletView(['tokens']);
    if (consultView) {
      const syncHubWallet = () => syncWalletView(['tokens', 'credits'], (nextMethod) => {
        hubWalletMethod = nextMethod;
        syncHubWallet();
      });
      syncHubWallet();
    }
    if (paymentView) paymentWalletSync = syncWalletView;
    if (!moderationView) {
      if (successMessage) {
        root.append(el('p', 'jdm-flash jdm-flash--ok', successMessage));
        successMessage = null;
      }
      if (actionError) {
        root.append(el('p', 'jdm-flash jdm-flash--error', actionError));
      }
    }

    // Les crédits PDC disponibles sont un état runtime, jamais une
    // notification persistante ni un badge d’attention.
    if (!moderationView) {
      const pending = Array.isArray(state.pending_actions) ? state.pending_actions : [];
      const availableCredits = pending.reduce((sum, row) => sum + Math.max(0, Number(row.credits_remaining ?? 1)), 0);
      if (availableCredits && openModule) {
        root.append(el('p', 'jdm-queue-hint',
          `${availableCredits} crédit${availableCredits > 1 ? 's' : ''} PDC disponible${availableCredits > 1 ? 's' : ''}`));
      }
    }

    const modules = [...(state.modules ?? [])]
      .filter((mod) => mod.id !== MODERATION_MODULE.id);
    if (state.identity_shared && !modules.some((mod) => mod.id === ACTIONS_MODULE.id)) modules.push(ACTIONS_MODULE);
    // Session modules (Commandes, Roue du Sub, Événements…) when the EBS offers them: their own files decide.
    for (const session of sessionModules()) {
      if (!session.available(sessionEnv()) || modules.some((mod) => mod.id === session.id)) continue;
      if (session.hubFirst) modules.unshift(session.card(state));
      else modules.push(session.card(state));
    }
    if (canModerate() && !modules.some((mod) => mod.id === MODERATION_MODULE.id)) {
      modules.push(MODERATION_MODULE);
    }
    // Modules of the module host: listed by the server, shown only when this build has their view.
    void loadHostModules(client, () => renderPreservingViewport());
    for (const mod of hostModules()) if (!modules.some((m) => m.id === mod.id)) modules.push(mod);
    if (openModule && !modules.some((mod) => mod.id === openModule)) openModule = null;
    // Its view goes with it (as navigateTo does): no timer, audio, listener or tour left behind.
    if (hostView && hostViewId !== openModule) {
      hostView.destroy?.();
      hostView = null;
      hostViewId = null;
      hostVariant = null;
      hostDef = null;
    }
    root.dataset.view = openModule ? 'module' : 'home';

    const moduleNotices = (mod) => notificationCount(state, mod.id);

    const openTutorial = () => {
      tutorialStep = 0;
      tutorialOpen = true;
      renderPreservingViewport();
    };

    if (!openModule) {
      const hub = el('section', 'rh-hub');
      hub.setAttribute('aria-label', 'Interactions disponibles');
      const top = el('header', 'rh-top');
      const brand = el('div', 'rh-brand');
      const mark = el('span', 'rh-mark', 'R');
      mark.setAttribute('aria-hidden', 'true');
      const brandCopy = el('span', 'rh-brand__copy');
      brandCopy.append(el('small', '', 'Raptoru Live'), el('strong', '', 'Interactions'));
      brand.append(mark, brandCopy);
      const notificationToggle = el('button', 'jdm-notification-toggle');
      notificationToggle.type = 'button';
      notificationToggle.setAttribute('aria-label', 'Ouvrir les notifications');
      notificationToggle.setAttribute('aria-haspopup', 'dialog');
      notificationToggle.setAttribute('aria-controls', 'jdm-notification-center');
      notificationToggle.setAttribute('aria-expanded', String(notificationCenterOpen));
      notificationToggle.title = 'Notifications';
      const unread = unreadNotificationCount();
      notificationToggle.append(createNotificationBellIcon());
      if (unread) notificationToggle.append(el('span', 'jdm-notification-toggle__count', String(unread)));
      notificationToggle.addEventListener('click', () => {
        notificationCenterOpen = !notificationCenterOpen;
        viewerPreferencesOpen = false;
        renderPreservingViewport();
        if (notificationCenterOpen) {
          queueMicrotask(() => root.querySelector('.jdm-notification-center__close')?.focus({ preventScroll: true }));
        }
      });
      const preferencesToggle = el('button', 'jdm-viewer-preferences-toggle');
      preferencesToggle.type = 'button';
      preferencesToggle.setAttribute('aria-label', 'Ouvrir les préférences');
      preferencesToggle.setAttribute('aria-haspopup', 'dialog');
      preferencesToggle.setAttribute('aria-controls', 'jdm-viewer-preferences');
      preferencesToggle.setAttribute('aria-expanded', String(viewerPreferencesOpen));
      preferencesToggle.title = 'Préférences';
      const preferencesIcon = el('span', 'jdm-viewer-preferences-toggle__icon', '⚙');
      preferencesIcon.setAttribute('aria-hidden', 'true');
      preferencesToggle.append(preferencesIcon);
      preferencesToggle.addEventListener('click', () => {
        viewerPreferencesOpen = !viewerPreferencesOpen;
        notificationCenterOpen = false;
        renderPreservingViewport();
        if (viewerPreferencesOpen) {
          queueMicrotask(() => root.querySelector('.jdm-viewer-preferences__close')?.focus({ preventScroll: true }));
        }
      });
      top.append(brand, notificationToggle, preferencesToggle, walletRow);

      // Modules du carousel : les vrais modules (Historique reste un accès secondaire).
      const raffleOpen = raffleIsActive(state?.raffle ?? {});
      const hubModules = modules
        .filter((candidate) => candidate.id !== ACTIONS_MODULE.id)
        .map((mod) => {
          const style = HUB_MODULE_STYLES[mod.id] ?? HUB_DEFAULT_STYLE;
          const off = state?.module_states?.[mod.id]?.enabled === false;
          const chip = off
            ? { text: 'En pause', tone: 'neutral' }
            : mod.id === 'raffle_join' && raffleOpen
              ? { text: mod.open_label || 'Ouverte', tone: 'live' }
              : mod.id === 'tts' && state?.moderation?.tts?.paused
                ? { text: 'En pause', tone: 'neutral' }
                : mod.id === MODERATION_MODULE.id
                  ? { text: 'Modérateurs', tone: 'staff' }
                  // Music Hub: open with the songs waiting, or closed (the card stays, its module says why).
                  : mod.id === 'music'
                    ? state?.music?.open
                      ? { text: state.music.queue_count ? `${state.music.queue_count} en file` : 'Ouvert', tone: 'live' }
                      : { text: 'Fermé', tone: 'neutral' }
                    : null;
          return {
            id: mod.id,
            label: visibleModuleLabel(mod),
            description: mod.id === MODERATION_MODULE.id ? 'Outils du stream' : homeModuleDescription(mod),
            icon: style.icon,
            color: style.color,
            color2: style.color2,
            chip,
            off,
            badge: moduleNotices(mod),
            // Cooldown / restriction of this viewer: a small pill, never a sentence.
            corner: holdsAction(restrictionOf(mod.id)) ? restrictionPill(document, restrictionOf(mod.id)) : null,
          };
        });
      const stage = el('div', 'rh-stage');
      const dock = el('div', 'rh-dock');
      const rail = el('div', 'rh-rail');
      const allModules = el('div', 'rh-all');
      allModules.setAttribute('role', 'dialog');
      allModules.setAttribute('aria-label', 'Tous les modules');
      // Navigation secondaire : Historique · grille (lanceur) · Classement ; Tutoriel au bord droit.
      const util = el('nav', 'rh-util');
      util.setAttribute('aria-label', 'Navigation secondaire');
      const utilLeft = el('div', 'rh-util__side rh-util__side--left');
      const launcherHost = el('div', 'rh-util__center');
      const utilRight = el('div', 'rh-util__side rh-util__side--right');
      if (modules.some((mod) => mod.id === ACTIONS_MODULE.id)) {
        const history = el('button', 'rh-util-btn');
        history.type = 'button';
        history.append(hubIcon(document, 'clock'), el('span', '', 'Historique'));
        const historyNotices = moduleNotices(ACTIONS_MODULE);
        if (historyNotices) history.append(el('span', 'rh-util-btn__count', String(historyNotices)));
        history.setAttribute('aria-label', historyNotices ? `Historique · ${historyNotices} non lue${historyNotices > 1 ? 's' : ''}` : 'Historique');
        history.addEventListener('click', () => navigateTo(ACTIONS_MODULE.id));
        utilLeft.append(history);
      }
      if (state.site_url) {
        const ranking = el('a', 'rh-util-btn');
        ranking.href = state.site_url;
        ranking.target = '_blank';
        ranking.rel = 'noopener noreferrer';
        ranking.append(hubIcon(document, 'trophy'), el('span', '', 'Classement'));
        ranking.setAttribute('aria-label', 'Classement (nouvel onglet)');
        utilRight.append(ranking);
      }
      const tutorial = el('button', 'rh-tuto');
      tutorial.type = 'button';
      tutorial.setAttribute('aria-label', 'Ouvrir le tutoriel');
      tutorial.setAttribute('aria-haspopup', 'dialog');
      tutorial.title = 'Tutoriel';
      tutorial.append(el('span', 'rh-tuto__q', '?'));
      tutorial.addEventListener('click', openTutorial);
      util.append(utilLeft, launcherHost, utilRight, tutorial);
      dock.append(rail, util);
      hub.append(top, stage, dock, allModules);
      if (notificationCenterOpen) hub.append(notificationCenterDrawer());
      if (viewerPreferencesOpen) hub.append(viewerPreferencesPanel());
      root.append(hub);
      if (hubModules.length) {
        if (!hubModules.some((mod) => mod.id === hubSelectedId)) hubSelectedId = hubModules[0].id;
        hubCarousel = createHubCarousel({
          document,
          stage,
          rail,
          popover: allModules,
          launcherHost,
          modules: hubModules,
          selectedId: hubSelectedId,
          onSelect: (id) => { hubSelectedId = id; },
          onOpen: (id) => navigateTo(id),
          popoverOpen: hubAllOpen,
          onPopover: (open) => { hubAllOpen = open; },
        });
      }
      // v2 : une fois le Hub affiché, les vues des modules qu'il propose se chargent en arrière-plan (ouverture
      // immédiate ensuite) ; le premier affichage n'attend rien d'elles.
      prefetchLazyViews(hubModules.map((mod) => mod.id));
      // Hauteur disponible sous le haut du Hub : rien ne déborde de la surface Twitch.
      hub.classList.toggle('is-narrow', boxWidth(hub) <= 340);
      requestAnimationFrame(() => {
        if (!hub.isConnected) return;
        hub.classList.toggle('is-narrow', boxWidth(hub) <= 340);
        const page = document.scrollingElement;
        const topOffset = hub.getBoundingClientRect().top + (page?.scrollTop ?? 0);
        hub.style.setProperty('--rh-top', `${Math.max(0, Math.round(topOffset))}px`);
        const overflow = page ? page.scrollHeight - page.clientHeight : 0;
        if (overflow > 0) hub.style.setProperty('--rh-bottom', `${8 + overflow}px`);
      });
    } else if (!lazyViewReady(openModule)) {
      // v2 : la vue du module se charge (première ouverture) : écran d'attente, puis rendu complet.
      const waiting = el('section', 'jdm-module-screen rx-loading');
      waiting.setAttribute('aria-busy', 'true');
      waiting.append(el('p', 'jdm-hint', 'Chargement…'));
      root.append(waiting);
      const id = openModule;
      void loadLazyView(id).then(
        () => { if (openModule === id) renderPreservingViewport(); },
        () => { if (openModule === id) { loadError = 'Ce module n’a pas pu se charger. Vérifie ta connexion puis réessaie.'; retryLoad = () => { loadError = null; render(); }; render(); } },
      );
    } else {
      const mod = modules.find((candidate) => candidate.id === openModule);
      const screen = el('section', 'jdm-module-screen');
      const isRaffle = mod.id === 'raffle_join';
      const isModeration = mod.id === MODERATION_MODULE.id;
      // A registered view takes the module's screen: a session module, or a variant of a module the session lists.
      const session = sessionModule(mod.id);
      const variant = session ? null : moduleVariant({ module: mod, state, client, document });
      const registered = session ?? variant;
      // A registered view — a session module, a module variant or a module of the module host: created once while the
      // module is open, kept across the host's refreshes, destroyed when it closes (navigateTo). No per-module branch.
      const hostedView = mod.id !== ACTIONS_MODULE.id && Boolean(registered || (mod.host && viewerModuleView(mod.id)));
      if (hostedView && (!hostView || hostViewId !== mod.id || hostVariant !== variant)) {
        hostView?.destroy?.();
        hostView = registered
          ? registered.view(variantContext(registered, mod))
          : viewerModuleView(mod.id)({ document, client, module: mod.server });
        hostViewId = mod.id;
        hostVariant = variant;
        hostDef = registered;
        hostView.start?.(); // optional: TTS V2 has no start (it waits for the host's state)
        // The team's moderation of a MODULE-HOST module only (never a session module or a variant: no mod.server).
        const panel = !registered && canModerate() ? createModuleModerationPanel({ document, client, module: mod.server }) : null;
        if (panel?.visible) {
          hostView.node.append(panel.node);
          void panel.refresh();
        }
      }
      const head = el('header', `jdm-ui-header jdm-module__screen-head${registered?.headClass ? ` ${registered.headClass}` : ''}${isRaffle ? ' jdm-module__screen-head--raffle' : ''}${isModeration ? ' jdm-module__screen-head--moderation' : ''}`);
      head.setAttribute('aria-label', visibleModuleLabel(mod));
      const headLeft = el('div', 'jdm-module__screen-side jdm-module__screen-side--left');
      const headRight = el('div', 'jdm-module__screen-side jdm-module__screen-side--right');
      const back = el('button', 'jdm-back');
      back.type = 'button';
      back.setAttribute('aria-label', 'Retour au Hub');
      back.title = 'Retour au Hub';
      // Chevron seul, carré compact (même forme que la Tombola V2) : module-back.css.
      back.append(hubIcon(document, 'chevL', 'jdm-back__icon'));
      back.addEventListener('click', () => navigateTo(null));
      headLeft.append(back);
      if (isRaffle) {
        const raffleHeader = state?.raffle ?? {};
        const raffleOpen = raffleIsActive(raffleHeader);
        const status = el('span', `jdm-raffle-header-status ${raffleOpen ? 'is-open' : 'is-closed'}`);
        status.dataset.raffleStatus = raffleOpen ? 'open' : 'closed';
        status.setAttribute('aria-label', raffleOpen ? 'Tombola ouverte' : 'Tombola fermée');
        const dot = el('span', 'jdm-raffle-header-status__dot', '●');
        dot.setAttribute('aria-hidden', 'true');
        status.append(dot, el('span', 'jdm-raffle-header-status__label', raffleOpen ? 'Ouverte' : 'Fermée'));
        headLeft.append(status);
      }
      const heading = el('div', 'jdm-module__screen-title');
      // The title's icon: the module's, or a control the view puts there (Soundboard: its volume popover).
      let screenIcon = hostedView && registered?.headIcon ? registered.headIcon(hostView, variantContext(registered, mod)) : null;
      if (!screenIcon) {
        screenIcon = el('span', 'jdm-module__screen-icon', mod.icon);
        screenIcon.setAttribute('aria-hidden', 'true');
      }
      if (!isModeration) heading.append(screenIcon);
      heading.append(el('strong', 'jdm-module__screen-name', visibleModuleLabel(mod)));
      // A control the view puts after the title (Bonk: its tour's « ? »).
      const headAfter = hostedView && registered?.headAfter ? registered.headAfter(hostView, variantContext(registered, mod)) : null;
      if (headAfter) heading.append(headAfter);
      head.append(headLeft, heading, headRight);
      if (!isModeration && !walletRow.classList.contains('rl-cswitch')) {
        walletRow.classList.add('jdm-wallet--shell-header');
        if (registered?.walletClass) walletRow.classList.add(registered.walletClass);
      }

      if (!isModeration) headRight.append(walletRow);
      // Active restrictions: chips on the left of the header (next to the way back), not by the wallet.
      const restrictions = restrictionsOf(mod.id);
      if (restrictions.length && !registered?.ownHeader) headLeft.append(restrictionChips(document, restrictions));

      const item = el('section', 'jdm-module');
      item.dataset.module = mod.id;
      item.classList.add('is-open');
      const body = el('div', 'jdm-module__body');
      if (!isModeration) body.dataset.scrollKey = `module-${mod.id}`;
      if (!isModeration && registered?.intro !== false) {
        const intro = el('div', 'jdm-module__intro');
        intro.append(
          el('strong', 'jdm-module__intro-title', mod.label),
          el('span', 'jdm-module__intro-copy', mod.description),
        );
        body.append(intro);
      }
      if (mod.id === ACTIONS_MODULE.id) {
        body.append(personalHistory());
      } else if (hostedView) {
        Object.assign(body.dataset, registered?.bodyData ?? {});
        if (registered?.screenClass) screen.classList.add(registered.screenClass);
        registered?.rendered?.(hostView, variantContext(registered, mod, body));
        // A view either has its own node, or draws into the module body (Soundboard).
        if (hostView.node) body.append(hostView.node);
        queueMicrotask(() => hostView?.attached?.());
      }
      item.append(body);
      screen.append(head, item);
      // Every active restriction of the module (blocks and cooldown) in one popup, at each visit; the
      // module stays readable behind it.
      const viewerId = state?.twitch_user_id;
      const toTell = restrictionsOf(mod.id).filter((r) => !restrictionsSeen.has(restrictionId(viewerId, r)) && !isHidden(restrictionStorage(), viewerId, r));
      if (toTell.length) {
        screen.append(restrictionModal(document, toTell, (dontShowAgain) => {
          for (const r of toTell) restrictionsSeen.add(restrictionId(viewerId, r));
          if (dontShowAgain) hideRestrictions(restrictionStorage(), viewerId, toTell);
        }));
      }
      root.append(screen);
    }

    if (tutorialOpen && !openModule) root.append(tutorialDialog(experience.tutorial));
  }

  return {
    setState(next) {
      updateState(next);
    },
    setError(message, retry) {
      // Après la première session, garder l'interface et les brouillons
      // utilisables pendant une panne de polling. Un simple refresh ne doit
      // jamais transformer un panneau fonctionnel en écran vide.
      if (state) {
        actionError = message;
        retryLoad = retry;
        renderPreservingViewport();
        return;
      }
      loadError = message;
      retryLoad = retry;
      render();
    },
    get state() { return state; },
    collapse() { captureScrollPositions(); },
  };
}

export { fmt };
