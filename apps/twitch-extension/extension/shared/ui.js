// Rendu des modules, partagé par l'overlay desktop et le viewer mobile.
// Les deux surfaces ont la MÊME logique et des CSS différents : une seule
// implémentation métier, deux mises en page.

import { ERROR_LABELS, errorLabel } from './api.js';
import { modulePresentation, notificationCount, resolveExperience, syncNotificationCenter } from './experience.js';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  resolveNotification,
  unreadNotificationCount,
} from './notifications.js';
import { createEmoteAccess } from './emote-access.js';
import { walletPaymentMethods, walletCanPayTokens } from './wallet-payment.js';
import {
  createIconButton,
  createWalletFace,
  createCurrencySwitch,
  createMultiCurrencyPayment,
  formatWalletExactValue,
  UI_ICONS,
} from './ui-primitives.js';
import { createHubCarousel, hubIcon } from './hub-carousel.js';
// The Soundboard screen registers itself as the variant of « soundboard » (soundboard-view.js).
import './soundboard-view.js';
// The Bonk screen registers itself as the variant of « bonk » (bonk-view.js).
import './bonk-view.js';
import { readTutorialDisabled, writeTutorialDisabled } from './tutorial-prefs.js';
// Module variants register themselves (TTS V2, Tombola V2).
import './tts-v2.js';
// The D4 console registers itself as the variant of « moderation » (with its « Commandes » view).
import './moderation-v2.js';
// Session modules: each registers itself (card, availability, view) — the import order is the Hub order.
import './commands-public.js';
import './sub-wheel-ext.js';
import './events-shop.js';
import './tombola-v2.js';
// The module host (architecture socle): viewer modules register themselves; ui.js only hosts them.
import { hostModules, loadHostModules, moduleVariant, sessionModule, sessionModules, viewerModuleView } from './module-registry.js';
import { createModuleModerationPanel } from './module-moderation.js';
import './coffre-mystere.js';
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
} from './viewer-restrictions.js';

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

// Le pot garde une valeur exacte et groupée. On remplace l'espace fine de
// l'API Intl par une espace insécable normale pour que la séparation reste
// perceptible dans la petite carte Tombola.
function fmtRafflePotAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('fr-FR').replace(/\u202f/gu, '\u00a0');
}

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

function normalizeTtsDraft(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- control characters are stripped on purpose
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function ttsDraftLength(value) {
  return Array.from(normalizeTtsDraft(value)).length;
}

function raffleSeconds(raffle) {
  const endsAt = Date.parse(raffle?.ends_at || '');
  if (Number.isFinite(endsAt)) return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return Math.max(0, Number(raffle?.ends_in_s || 0));
}

function raffleIsActive(raffle) {
  return Boolean(raffle?.open) && !raffle?.unavailable && !raffle?.closed_at;
}

function raffleNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function raffleAmount(record) {
  const pot = record?.pot && typeof record.pot === 'object' ? record.pot : null;
  const candidates = [
    [pot, 'amount'],
    [record, 'pot'],
    [record, 'pot_amount'],
    [record, 'total_pot'],
    [record, 'total_amount'],
    [record, 'prize_pool'],
    [record, 'amount'],
  ];
  for (const [source, key] of candidates) {
    const value = raffleNumber(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function raffleCurrency(record) {
  const pot = record?.pot && typeof record.pot === 'object' ? record.pot : null;
  for (const value of [pot?.currency, record?.currency, record?.pot_currency, record?.unit]) {
    const text = String(value ?? '').trim();
    if (text) return text.slice(0, 24);
  }
  return '';
}

function raffleDateLabel(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function raffleHistoryDate(row) {
  for (const value of [row?.created_at, row?.drawn_at, row?.ended_at, row?.closed_at, row?.opened_at]) {
    if (value) return value;
  }
  return null;
}

function raffleTimerSource(raffle) {
  if (Number.isFinite(Date.parse(raffle?.ends_at || ''))) return 'ends_at';
  if (raffleNumber(raffle?.ends_in_s) !== null) return 'ends_in_s';
  return 'none';
}

function raffleTotalSeconds(raffle) {
  for (const value of [
    raffle?.total_duration_s,
    raffle?.duration_s,
    raffle?.duration_seconds,
    raffle?.window_duration_s,
  ]) {
    const seconds = raffleNumber(value);
    if (seconds !== null && seconds > 0) return Math.ceil(seconds);
  }
  const openedAt = Date.parse(raffle?.opened_at || '');
  const endsAt = Date.parse(raffle?.ends_at || '');
  if (Number.isFinite(openedAt) && Number.isFinite(endsAt) && endsAt > openedAt) {
    return Math.max(1, Math.ceil((endsAt - openedAt) / 1000));
  }
  return null;
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
  let ttsActionError = null;
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
  const paymentChoice = { tts: 'tokens', soundboard: 'tokens' };
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
        stopRaffleTimer: () => stopRaffleTimer(),
        memory: (moduleMemory[mod?.id] ??= {}),
        /** The action runner (busy flag, refresh, notifications); `feedbackScope` + `onSettled`: the view says it. */
        run: (node, task, options) => run(node, task, options),
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
  let moderationHistoryQuery = '';
  let moderationHistoryModule = '';
  let moderationHistoryStatus = '';
  let moderationUsersQuery = '';
  let moderationUsers = null;
  let moderationSelectedUser = null;
  let moderationUserHistoryOpen = false;
  let moderationSubmodule = 'users';
  let moderationSuspensionSelectionUserId = '';
  let moderationSuspendSelection = new Set();
  let moderationUnsuspendSelection = new Set();
  let moderationSuspensionDuration = '600000';
  let moderationSuspensionCustomValue = '';
  let moderationSuspensionCustomUnit = 'minutes';
  const moderationSuspensionDurationOptions = [
    ['600000', '10 min'],
    ['3600000', '1 heure'],
    ['86400000', '24 heures'],
    ['', 'Indéfinie'],
    ['custom', 'Personnalisée'],
  ];
  const moderationSuspensionDurationUnits = [
    ['seconds', 'secondes'],
    ['minutes', 'minutes'],
    ['hours', 'heures'],
    ['days', 'jours'],
  ];
  const moderationCustomDurationMinMs = 60_000;
  const moderationCustomDurationMaxMs = 365 * 24 * 60 * 60 * 1000;
  const isStudioPreview = new URLSearchParams(globalThis.location?.search || '').get('studio') === '1';
  let raffleHistoryOpen = false;
  let raffleTimer = null;
  let raffleTimerSnapshot = null;
  let raffleJoinConfirmedWindowId = null;
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
  const drafts = {
    tts: { text: '' },
  };
  root.classList.add('jdm-shell');
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (notificationCenterOpen || viewerPreferencesOpen || tutorialOpen || raffleHistoryOpen || moderationUserHistoryOpen) {
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
    if (raffleHistoryOpen) {
      raffleHistoryOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
      return;
    }
    if (moderationUserHistoryOpen) {
      moderationUserHistoryOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-mod-user-history-toggle')?.focus({ preventScroll: true }));
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

  function pendingFor(moduleId) {
    return (state?.pending_actions ?? []).filter((a) => a.module_id === moduleId);
  }

  function soundboardCreditBalance() {
    return pendingFor('soundboard').reduce(
      (total, action) => total + Math.max(0, Number(action.credits_remaining ?? 1)),
      0,
    );
  }

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
    const nextRaffle = next?.raffle;
    const nextWindowId = String(nextRaffle?.window_id || '').trim();
    if (raffleJoinConfirmedWindowId
      && (!nextRaffle?.open || nextWindowId !== raffleJoinConfirmedWindowId)) {
      raffleJoinConfirmedWindowId = null;
    }
    if (raffleJoinConfirmedWindowId
      && nextRaffle?.open
      && nextWindowId === raffleJoinConfirmedWindowId
      && nextRaffle.joined !== true) {
      next = {
        ...next,
        raffle: { ...nextRaffle, joined: true },
      };
    }
    state = next;
    emoteAccess.onState(previous, next, { render });
    loadError = null;
    retryLoad = null;
    actionError = null;
    ttsActionError = null;
    syncViewerPreferenceIdentity(next);
    // The open module's own live update (module variants: TTS V2, Tombola V2…): absorbed, the host does not redraw.
    if (render && !hadLoadError && hostView && hostViewId === openModule && hostVariant?.onState
      && hostVariant.onState(hostView, next, previous, variantContext(hostVariant, (next?.modules ?? []).find((m) => m.id === openModule)))) {
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


  function stopRaffleTimer() {
    if (raffleTimer === null) return;
    if (typeof globalThis.clearInterval === 'function') globalThis.clearInterval(raffleTimer);
    raffleTimer = null;
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
    }
    if (moduleId !== 'raffle_join') {
      stopRaffleTimer();
      raffleTimerSnapshot = null;
      raffleHistoryOpen = false;
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
    if (errorScope === 'tts') ttsActionError = null;
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
      if (errorScope === 'tts') ttsActionError = null;
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
      if (errorScope === 'tts') ttsActionError = message;
      else if (!feedbackScope) actionError = message;
      if (feedbackScope) onSettled?.(false, error);
      const notificationModule = notificationModuleForNode(node,
        notification?.module || (errorScope === 'tts' ? 'tts' : feedbackScope || null));
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

  function moderationAction(name, ...args) {
    if (typeof client?.[name] !== 'function') {
      return Promise.reject(Object.assign(new Error('moderation_action_unavailable'), {
        code: 'moderation_action_unavailable',
      }));
    }
    return client[name](...args);
  }

  const TTS_CONTROL_CONFIRMATION_TIMEOUT_MS = 8_000;
  const waitForTtsControl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ttsControlFinalMessage = (action, result) => {
    const final = String(result?.final_status || result?.status || '').toLowerCase();
    if (final === 'no_active') return 'Aucun TTS actif.';
    return ({
      stop: 'TTS arrêté ✓',
      pause: 'TTS en pause ✓',
      resume: 'TTS repris ✓',
      purge: 'File TTS purgée ✓',
    })[action] || 'Action TTS exécutée ✓';
  };
  async function confirmTtsControl(result, action) {
    const immediate = String(result?.final_status || result?.status || '').toLowerCase();
    if (['executed', 'no_active'].includes(immediate)) {
      return { confirmed: immediate === 'executed', message: ttsControlFinalMessage(action, result) };
    }
    const commandId = String(result?.command_id || '').trim();
    if (!commandId || typeof client?.ttsControlStatus !== 'function') {
      return { confirmed: false, message: 'Commande acceptée, exécution non confirmée' };
    }
    const deadline = Date.now() + TTS_CONTROL_CONFIRMATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const status = await client.ttsControlStatus(commandId);
        const final = String(status?.final_status || status?.status || '').toLowerCase();
        if (final === 'executed') return { confirmed: true, message: ttsControlFinalMessage(action, status) };
        if (final === 'no_active') return { confirmed: false, message: 'Aucun TTS actif.' };
        if (['failed', 'timeout', 'uncertain'].includes(final)) {
          return { confirmed: false, message: final === 'failed'
            ? 'La commande TTS a échoué.'
            : 'Commande envoyée, exécution non confirmée' };
        }
      } catch (error) {
        if (error?.code !== 'tts_control_status_not_found') {
          return { confirmed: false, message: 'Commande acceptée, exécution non confirmée' };
        }
      }
      await waitForTtsControl(250);
    }
    return { confirmed: false, message: 'Commande envoyée, exécution non confirmée' };
  }

  function runModerationControl(node, task, { action, acceptedMessage, successMessage } = {}) {
    return run(node, task, {
      pending: acceptedMessage,
      success: successMessage,
      confirm: (result) => confirmTtsControl(result, action),
      notification: {
        module: 'moderation',
        title: 'Contrôle TTS non confirmé',
        actionModule: 'moderation',
        dedupeKey: `runtime:moderation:tts:${action}`,
        shouldNotify: (confirmation) => confirmation?.confirmed === false
          && String(confirmation?.message || '').trim() !== 'Aucun TTS actif.',
      },
    });
  }


  // --- formulaires par module ----------------------------------------------

  function ttsForm(mod, body) {
    const pending = pendingFor('tts');
    const interactionsAvailable = state?.interactions?.available !== false;
    const moderation = state?.moderation?.tts ?? {};
    const ttsAvailable = interactionsAvailable
      && !moderation.paused
      && !moderation.blocked
      && !moderation.viewer_busy
      && Number(moderation.cooldown_remaining_s || 0) <= 0;
    const approvalMode = moderation.mode === 'approval';
    const ttsRules = mod.tts_rules && typeof mod.tts_rules === 'object' ? mod.tts_rules : null;
    const actionLabel = approvalMode ? 'Soumettre' : 'Envoyer';
    const { displayMethods, spendMethods } = walletPaymentMethods(mod, state);
    const supportsPaymentMethod = (method) => spendMethods.includes(method);
    const paymentMethodsFor = () => displayMethods;

    const normalizePaymentMethod = (methods) => {
      const available = methods.length ? methods : ['tokens'];
      if (available.includes(paymentChoice.tts)) return paymentChoice.tts;
      paymentChoice.tts = available[0];
      return paymentChoice.tts;
    };

    const quoteFor = (raw) => {
      const length = ttsDraftLength(normalizeTtsDraft(raw));
      const tier = (ttsRules?.tiers || []).find((candidate) => (
        length >= Number(candidate.min)
          && (candidate.max === null || length <= Number(candidate.max))
      ));
      const multiplier = Number(tier?.price_multiplier || 1);
      return {
        length,
        tier,
        multiplier,
        price: tier
          ? Math.round(Number(ttsRules.base_price) * multiplier)
          : Number(mod.token_cost || 0),
      };
    };

    const maxChars = Math.max(1, Number(mod.max_chars) || 800);
    const field = el('textarea', 'jdm-input jdm-tts-input');
    // maxlength compte les unites UTF-16 dans le navigateur, alors que le
    // contrat serveur compte les points de code. Le controle metier ci-dessous
    // reste donc la source de verite ; cette borne evite seulement une saisie
    // deraisonnable avant le retour serveur.
    field.maxLength = maxChars * 2;
    field.rows = 2;
    field.placeholder = 'Ton message…';
    field.setAttribute('aria-label', 'Message TTS');
    field.dataset.draftKey = 'tts-text';
    field.value = drafts.tts.text;

    const counter = el('span', 'jdm-counter', `${ttsDraftLength(field.value)}/${maxChars}`);
    const help = el('p', 'jdm-hint jdm-tts-help', 'Écris du texte pour le faire lire à l’oral sur le stream.');
    const actions = el('div', 'jdm-actions jdm-tts-actions');
    actions.setAttribute('aria-label', 'Actions TTS');

    const payload = () => {
      const text = normalizeTtsDraft(field.value);
      if (!text) {
        flash(body, 'Écris un message.');
        return null;
      }
      if (Array.from(text).length > maxChars) {
        flash(body, `Message trop long : ${maxChars} caractères maximum.`);
        return null;
      }
      return { text };
    };

    let paymentControl = null;
    const syncControls = () => {
      const valid = Boolean(normalizeTtsDraft(field.value))
        && ttsDraftLength(field.value) <= maxChars;
      counter.textContent = `${ttsDraftLength(field.value)}/${maxChars}`;
      const hasText = Boolean(normalizeTtsDraft(field.value));
      const quote = quoteFor(field.value);
      const methods = paymentMethodsFor();
      const method = normalizePaymentMethod(methods);
      const usingCredits = method === 'credits';
      const cost = usingCredits ? 1 : quote.price;
      const methodSupported = supportsPaymentMethod(method);
      const methodAvailable = usingCredits ? pending.length > 0 : walletCanPayTokens(state.wallet, cost);
      const unit = usingCredits ? 'crédit' : 'jetons';
      const costLabel = `${fmt(cost)} ${unit}`;
      if (hasText) {
        const tierText = quote.tier
          ? ` · palier ${quote.tier.id} · ×${String(quote.multiplier).replace('.', ',')}`
          : '';
        // Le prix reste dans le CTA : la ligne d'aide décrit uniquement la
        // longueur et le palier pour éviter une seconde source visuelle de
        // vérité sur le coût.
        help.textContent = `${fmt(quote.length)} caractères${tierText}`;
      } else {
        help.textContent = 'Écris du texte pour le faire lire à l’oral sur le stream.';
      }
      actions.classList.toggle('is-visible', hasText);
      actions.setAttribute('aria-hidden', String(!hasText));
      body.dataset.paymentMethod = method;
      paymentWalletSync?.(methods, (next) => {
        paymentChoice.tts = next;
        syncControls();
      });
      paymentControl?.sync({
        method,
        methods,
        cost: fmt(cost),
        unit,
        disabled: !valid || !ttsAvailable || !methodSupported || !methodAvailable,
        hint: !ttsAvailable
          ? 'TTS indisponible'
          : !methodSupported
            ? 'Paiement indisponible pour cette monnaie'
            : usingCredits && !pending.length
              ? 'Crédits TTS indisponibles'
              : !usingCredits && !methodAvailable
                ? 'Jetons insuffisants ou solde indisponible'
                : '',
        label: actionLabel,
        ariaLabel: hasText ? `${actionLabel} pour ${costLabel}` : actionLabel,
        title: hasText ? `${actionLabel} pour ${costLabel}` : actionLabel,
        amounts: {
          tokens: state?.wallet?.unavailable ? null : state?.wallet?.available,
          credits: Array.isArray(state?.pending_actions) ? pending.length : null,
        },
      });
    };

    paymentControl = createMultiCurrencyPayment({
      className: 'rl-pay--tts',
      modern: true,
      actionLabel,
      enableMethodSwitch: true,
      onMethodChange: (method) => {
        paymentChoice.tts = method;
        syncControls();
      },
      onAction: (method) => {
        if (!ttsAvailable || !supportsPaymentMethod(method)) return;
        if (method === 'tokens' && !walletCanPayTokens(state.wallet, quoteFor(field.value).price)) return;
        const data = payload();
        if (!data) return;
        if (method === 'credits') {
          return run(body, () => pending[0]
            ? client.useRedemption(pending[0].redemption_id, 'tts', data)
            : Promise.reject(Object.assign(new Error('insufficient_credits'), { code: 'insufficient_credits' })), {
            errorScope: 'tts',
            onSuccess: () => { drafts.tts.text = ''; },
          });
        }
        return run(body, () => client.spendTokens('tts', data), {
          errorScope: 'tts',
          onSuccess: () => { drafts.tts.text = ''; },
        });
      },
    });

    if (state?.lab_mode) {
      const lab = el('button', 'jdm-btn jdm-ui-action jdm-btn--primary jdm-tts-action jdm-tts-action--lab', 'Tester gratuitement');
      lab.type = 'button';
      lab.addEventListener('click', () => {
        const data = payload();
        if (data) return run(body, () => client.runLab('tts', data), {
          errorScope: 'tts',
          onSuccess: () => { drafts.tts.text = ''; },
        });
      });
      actions.append(lab);
    }

    field.addEventListener('input', () => {
      drafts.tts.text = field.value;
      syncControls();
    });

    const row = el('div', 'jdm-row');
    row.append(counter);
    const composer = el('div', 'jdm-tts-composer');
    composer.append(field, row);
    body.append(composer, help, actions);
    actions.prepend(paymentControl.node);
    if (ttsActionError) {
      body.append(el('p', 'jdm-flash jdm-flash--error jdm-tts-error', ttsActionError));
    }
    if (!interactionsAvailable && !state?.lab_mode) {
      body.append(el('p', 'jdm-hint', 'Interactions en pause : SAMMI se reconnecte. Ton crédit et tes jetons restent intacts.'));
    } else if (moderation.paused) {
      body.append(el('p', 'jdm-hint', 'Le TTS est mis en pause par la modération. Rien ne sera consommé.'));
    } else if (moderation.blocked) {
      body.append(el('p', 'jdm-hint', 'Le TTS n’est pas disponible pour ton compte.'));
    } else if (moderation.viewer_busy) {
      body.append(el('p', 'jdm-hint', 'Ton TTS précédent est encore en attente ou en lecture.'));
    } else if (Number(moderation.cooldown_remaining_s || 0) > 0) {
      body.append(el('p', 'jdm-hint', `Cooldown TTS : encore ${fmt(moderation.cooldown_remaining_s)} s.`));
    } else if (approvalMode) {
      body.append(el('p', 'jdm-hint', 'Validation active : ton message attendra un accord, sans consommer ton crédit ni tes jetons avant celui-ci.'));
    }
    if (mod.kinds?.includes('redemption')) {
      body.append(el('p', 'jdm-hint jdm-tts-credit-hint',
        `Ou utilise la récompense TTS (${fmt(mod.channel_points_cost)} points) dans le menu Twitch : elle apparaîtra ici.`));
    }
    syncControls();
  }

  // Soundboard viewer (markup sbx-*, feuille soundboard.css). Le son est la star : cartes lisibles,
  // aperçu distinct de l'achat, prix et envoi regroupés dans la barre d'action du bas.
  function raffleForm(mod, body) {
    stopRaffleTimer();
    const raffle = state?.raffle ?? { open: false };
    const unavailable = Boolean(raffle.unavailable);
    const active = raffleIsActive(raffle);
    const historyRows = Array.isArray(raffle.history) ? raffle.history : [];
    const participants = Array.isArray(raffle.participants) ? raffle.participants : [];
    const announcedParticipantCount = raffleNumber(raffle.participant_count);
    const participantCount = announcedParticipantCount ?? participants.length;
    const viewerLogin = String(raffle.viewer_login || '').trim().replace(/^@+/, '').toLowerCase();
    const timerSource = raffleTimerSource(raffle);
    const stateKey = unavailable ? 'unavailable' : active ? 'active' : 'inactive';

    const screen = el('section', 'jdm-raffle-screen');
    screen.dataset.raffleState = stateKey;
    screen.setAttribute('aria-label', 'Tombola');

    const historyToggle = createIconButton({
      icon: UI_ICONS.history,
      label: raffleHistoryOpen ? 'Fermer l’historique Tombola' : 'Ouvrir l’historique Tombola',
      title: raffleHistoryOpen ? 'Fermer l’historique' : 'Historique des tombolas',
      className: 'jdm-raffle-history-toggle',
      iconClassName: 'jdm-raffle-history-toggle__icon',
      visibleLabel: 'Historique',
    });
    historyToggle.setAttribute('aria-controls', 'raffle-history-panel');
    historyToggle.setAttribute('aria-expanded', String(raffleHistoryOpen));
    if (historyRows.length) historyToggle.append(el('span', 'jdm-raffle-history-count', String(historyRows.length)));

    const layout = el('div', `jdm-raffle-layout${active ? ' is-active' : ' is-inactive'}`);
    const overview = el('section', 'jdm-raffle-overview');
    overview.setAttribute('aria-label', 'État de la Tombola');

    const pot = el('section', 'jdm-raffle-pot');
    const potAmount = raffleNumber(raffle.total);
    const potUnit = 'jetons';
    const potValue = el('strong', 'jdm-raffle-pot__value', potAmount === null ? '—' : fmtRafflePotAmount(potAmount));
    const potUnitNode = el('span', 'jdm-raffle-pot__unit', potAmount === null ? '' : potUnit);
    pot.append(
      el('span', 'jdm-raffle-card__eyebrow', potAmount === null
        ? (unavailable ? 'TOMBOLA INDISPONIBLE' : 'TOMBOLA FERMÉE')
        : active ? 'À GAGNER' : 'POT'),
      potValue,
      potUnitNode,
    );
    if (potAmount !== null) pot.dataset.hasAmount = 'true';

    const timer = el('section', 'jdm-raffle-timer');
    timer.dataset.source = timerSource;
    timer.dataset.closed = String(!active);
    timer.setAttribute('role', 'timer');
    const timerValue = el('time', 'jdm-raffle-timer__value', '0');
    timer.append(timerValue);

    const timerWindowId = String(raffle.window_id || '').trim();
    const timerEndsAt = String(raffle.ends_at || '').trim();
    const serverRemaining = raffleNumber(raffle.ends_in_s);
    const snapshotRemaining = timerSource === 'ends_in_s' ? serverRemaining : null;
    const explicitTotal = raffleTotalSeconds(raffle);
    const snapshotChanged = !raffleTimerSnapshot
      || raffleTimerSnapshot.active !== active
      || raffleTimerSnapshot.windowId !== timerWindowId
      || raffleTimerSnapshot.source !== timerSource
      || raffleTimerSnapshot.endsAt !== timerEndsAt
      || raffleTimerSnapshot.serverRemaining !== snapshotRemaining;
    if (snapshotChanged) {
      const initialRemaining = active
        ? timerSource === 'ends_at'
          ? raffleSeconds(raffle)
          : serverRemaining ?? 0
        : 0;
      raffleTimerSnapshot = {
        active,
        windowId: timerWindowId,
        source: timerSource,
        endsAt: timerEndsAt,
        serverRemaining: snapshotRemaining,
        syncedAt: Date.now(),
        initialRemaining,
        totalSeconds: explicitTotal ?? Math.max(1, initialRemaining),
      };
    } else if (explicitTotal !== null) {
      raffleTimerSnapshot.totalSeconds = explicitTotal;
    }
    const timerTotal = Math.max(1, Number(raffleTimerSnapshot?.totalSeconds || 1));
    const currentTimerSeconds = () => {
      if (!active) return 0;
      if (timerSource === 'ends_at') return raffleSeconds(raffle);
      if (timerSource === 'ends_in_s' && raffleTimerSnapshot?.serverRemaining !== null) {
        return Math.max(0, Math.ceil(
          raffleTimerSnapshot.serverRemaining - (Date.now() - raffleTimerSnapshot.syncedAt) / 1000,
        ));
      }
      return 0;
    };

    const syncTimer = () => {
      const seconds = currentTimerSeconds();
      const hasTimerSource = timerSource !== 'none';
      timerValue.textContent = active && hasTimerSource ? String(seconds) : active ? '—' : '0';
      timerValue.setAttribute('aria-label', !active
        ? (unavailable ? 'Tombola indisponible' : 'Tombola fermée')
        : hasTimerSource
          ? `${seconds} seconde${seconds > 1 ? 's' : ''} restante${seconds > 1 ? 's' : ''}`
          : 'Temps restant indisponible');
      timer.setAttribute('aria-label', !active
        ? (unavailable ? 'Tombola indisponible' : 'Tombola fermée')
        : hasTimerSource ? 'Temps restant' : 'Temps restant indisponible');
      timerValue.dataset.seconds = String(seconds);
      timer.dataset.seconds = String(seconds);
      timer.dataset.totalSeconds = String(timerTotal);
      timer.style.setProperty('--raffle-progress', String(
        active && hasTimerSource ? Math.max(0, Math.min(1, seconds / timerTotal)) : 0,
      ));
    };
    syncTimer();
    if (active && timerSource !== 'none' && typeof globalThis.window?.setInterval === 'function') {
      raffleTimer = globalThis.window.setInterval(syncTimer, 1000);
    }

    const joinZone = active ? el('div', 'jdm-raffle-join-zone jdm-raffle-join-drawer') : null;
    if (joinZone) {
      joinZone.setAttribute('aria-label', 'Inscription à la Tombola');
      const joinCopy = el('div', 'jdm-raffle-join-drawer__copy');
      joinCopy.append(
        el('strong', 'jdm-raffle-join-drawer__title', raffle.joined ? 'Participation confirmée' : 'Participe au tirage'),
        el('span', 'jdm-raffle-join-drawer__hint', raffle.joined
          ? 'Ton inscription est déjà prise en compte.'
          : 'Une inscription suffit pour participer.'),
      );
      const join = el('button', 'jdm-btn jdm-btn--primary jdm-raffle-join', raffle.joined ? 'Inscrit ✓' : 'Inscription');
      join.type = 'button';
      join.disabled = Boolean(raffle.joined);
      join.setAttribute('aria-disabled', String(Boolean(raffle.joined)));
      join.setAttribute('aria-label', raffle.joined ? 'Participation confirmée' : 'S’inscrire à la Tombola');
      join.title = raffle.joined ? 'Participation confirmée' : 'Inscription à la Tombola';
      if (!raffle.joined) join.addEventListener('click', () => run(joinZone, () => client.joinRaffle(), {
        onSuccess: (result) => {
          const windowId = String(result?.window_id || raffle.window_id || '').trim();
          if (!windowId) return;
          raffleJoinConfirmedWindowId = windowId;
          if (state?.raffle?.window_id === windowId) {
            state = { ...state, raffle: { ...state.raffle, joined: true } };
          }
        },
        success: (result) => (result?.duplicate === true ? null : 'Inscription confirmée ✓'),
      }));
      joinZone.append(joinCopy, join);
    }

    overview.append(pot, timer);
    if (joinZone) overview.append(joinZone);
    if (!active) {
      overview.append(el(
        'p',
        'jdm-raffle-state-copy',
        unavailable ? 'La Tombola est momentanément indisponible.' : 'Aucune tombola en cours.',
      ));
    }

    // Une zone de résultat existe dans la composition, mais elle ne lit que
    // l'historique déjà livré par le serveur lorsque la tombola n'est plus
    // active. Aucune donnée de gagnant n'est déduite de l'état ouvert : le
    // délai de révélation reste donc entièrement piloté par le contrat actuel.
    const latestResult = !active && historyRows.length ? historyRows[0] : null;
    const resultWinners = Array.isArray(latestResult?.winners)
      ? latestResult.winners.filter((winner) => String(
        winner?.display_name ?? winner?.displayName ?? winner?.login ?? '',
      ).trim())
      : [];
    const resultRevealed = resultWinners.length > 0;
    const resultZone = el('section', `jdm-raffle-result${resultRevealed ? ' is-revealed' : ' is-waiting'}`);
    resultZone.dataset.resultState = resultRevealed ? 'revealed' : 'waiting';
    resultZone.setAttribute('aria-live', 'polite');
    resultZone.setAttribute('aria-label', resultRevealed ? 'Résultat de la Tombola' : 'Résultat de la Tombola en attente');
    resultZone.append(
      el('span', 'jdm-raffle-result__eyebrow', resultRevealed ? 'DERNIER RÉSULTAT' : 'RÉSULTAT'),
      el('strong', 'jdm-raffle-result__title', resultRevealed ? 'Gagnant(s)' : active ? 'Après le tirage' : 'En attente'),
    );
    if (resultRevealed) {
      const resultList = el('ul', 'jdm-raffle-result__winners');
      resultList.dataset.scrollKey = 'raffle-result-winners';
      resultList.setAttribute('aria-label', 'Liste des gagnants');
      const resultCurrency = raffleCurrency(latestResult);
      for (const winner of resultWinners) {
        const login = String(winner?.display_name ?? winner?.displayName ?? winner?.login ?? '')
          .trim().replace(/^@+/, '');
        if (!login) continue;
        const amount = raffleAmount(winner);
        const currency = raffleCurrency(winner) || resultCurrency;
        const winnerLine = el('li', 'jdm-raffle-result__winner');
        winnerLine.append(
          el('strong', 'jdm-raffle-result__winner-name', `@${login}`),
          ...(amount === null
            ? []
            : [el('span', 'jdm-raffle-result__winner-amount', `${fmt(amount)}${currency ? ` ${currency}` : ''}`)]),
        );
        resultList.append(winnerLine);
      }
      if (resultList.children.length) resultZone.append(resultList);
    } else {
      resultZone.append(el(
        'span',
        'jdm-raffle-result__hint',
        active ? 'Le ou les gagnants apparaîtront ici après la révélation.' : 'Aucun gagnant communiqué pour le moment.',
      ));
    }

    let participantSection;
    if (active) {
      participantSection = el('section', 'jdm-raffle-participants');
      participantSection.setAttribute('aria-label', 'Participants à la Tombola');
      const participantHead = el('div', 'jdm-raffle-participants__head');
      participantHead.append(
        el('strong', 'jdm-raffle-participants__count', `Participants · ${participantCount}`),
      );
      const participantList = el('ul', 'jdm-raffle-participants__list');
      participantList.dataset.scrollKey = 'raffle-participants';
      participantList.setAttribute('aria-label', 'Liste des participants');
      if (!participants.length) {
        participantList.append(el('li', 'jdm-hint', 'Aucun participant pour le moment.'));
      } else {
        for (const participant of participants) {
          const login = String(participant?.login || '').trim().replace(/^@+/, '').toLowerCase();
          if (!login) continue;
          const displayName = String(participant?.display_name ?? participant?.displayName ?? login)
            .trim().replace(/^@+/, '') || login;
          const isViewer = Boolean(viewerLogin) && login === viewerLogin;
          const sources = [
            ...(Array.isArray(participant?.sources) ? participant.sources : []),
            participant?.source,
          ]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter((value, index, values) => (
              ['chat', 'extension'].includes(value) && values.indexOf(value) === index
            ));
          const explicitFirstSource = [
            participant?.registration_source,
            participant?.first_source,
            participant?.source,
          ]
            .map((value) => String(value || '').trim().toLowerCase())
            .find((value) => ['chat', 'extension'].includes(value));
          const sourceTone = explicitFirstSource
            ? explicitFirstSource
            : sources.length > 1
              ? 'mixed'
              : sources[0] === 'chat'
              ? 'chat'
              : sources[0] === 'extension'
                ? 'extension'
                : 'unknown';
          const sourceLabel = explicitFirstSource === 'chat'
            ? 'Chat'
            : explicitFirstSource === 'extension'
              ? 'Extension'
              : sources.length > 1
                ? 'Sources multiples'
            : sourceTone === 'chat'
              ? 'Chat'
              : sourceTone === 'extension'
                ? 'Extension'
                : 'Source inconnue';
          const row = el('li', `jdm-raffle-participants__item${isViewer ? ' jdm-raffle-participants__item--self' : ''}`);
          row.append(
            el('strong', 'jdm-raffle-participants__login', `@${displayName}`),
            el('span', `jdm-raffle-participants__source is-${sourceTone}`, sourceLabel),
          );
          if (isViewer) row.append(el('span', 'jdm-raffle-participants__viewer', '✓ Vous'));
          participantList.append(row);
        }
      }
      participantSection.append(participantHead, participantList, resultZone);
      layout.append(overview, participantSection);
    } else {
      layout.append(overview, resultZone);
    }

    const historyPanel = el('aside', 'jdm-ui-drawer jdm-raffle-history-panel');
    historyPanel.id = 'raffle-history-panel';
    historyPanel.setAttribute('role', 'dialog');
    historyPanel.setAttribute('aria-label', 'Historique des tombolas');
    historyPanel.setAttribute('aria-hidden', String(!raffleHistoryOpen));
    historyPanel.inert = !raffleHistoryOpen;
    historyPanel.classList.toggle('is-screen-fallback', !active);
    historyPanel.classList.toggle('is-open', raffleHistoryOpen);
    const historyHead = el('div', 'jdm-raffle-history-panel__head');
    const historyClose = createIconButton({
      icon: UI_ICONS.close,
      label: 'Fermer l’historique Tombola',
      title: 'Fermer l’historique',
      className: 'jdm-raffle-history__close',
      iconClassName: 'jdm-raffle-history__close-icon',
    });
    historyClose.tabIndex = raffleHistoryOpen ? 0 : -1;
    historyHead.append(
      el('strong', 'jdm-raffle-history-panel__title', `Historique${historyRows.length ? ` · ${historyRows.length}` : ''}`),
      el('span', 'jdm-raffle-history-panel__hint', 'Données fournies par le serveur'),
      historyClose,
    );
    historyPanel.append(historyHead);
    if (!historyRows.length) {
      historyPanel.append(el('p', 'jdm-hint', 'Pas encore d’historique.'));
    } else {
      const historyList = el('ol', 'jdm-raffle-history__list');
      historyList.dataset.scrollKey = 'raffle-history';
      for (const [index, raffleRow] of historyRows.entries()) {
        const entry = el('li', 'jdm-raffle-history__entry');
        entry.dataset.historyIndex = String(index);
        const dateLabel = raffleDateLabel(raffleHistoryDate(raffleRow));
        entry.append(el('strong', 'jdm-raffle-history__entry-title', dateLabel ? `Tombola · ${dateLabel}` : 'Tombola'));
        const rowAmount = raffleAmount(raffleRow);
        const rowCurrency = raffleCurrency(raffleRow);
        if (rowAmount !== null) {
          entry.append(el('span', 'jdm-raffle-history__pot', `Pot : ${fmt(rowAmount)}${rowCurrency ? ` ${rowCurrency}` : ''}`));
        }
        const winners = el('ul', 'jdm-raffle-history__winners');
        const winnerRows = Array.isArray(raffleRow?.winners) ? raffleRow.winners : [];
        for (const winner of winnerRows) {
          const login = String(winner?.display_name ?? winner?.displayName ?? winner?.login ?? '')
            .trim().replace(/^@+/, '');
          if (!login) continue;
          const amount = raffleAmount(winner);
          const currency = raffleCurrency(winner) || rowCurrency;
          winners.append(el('li', 'jdm-raffle-history__winner', `@${login}${amount === null ? '' : ` · ${fmt(amount)}${currency ? ` ${currency}` : ''}`}`));
        }
        if (!winners.children.length) winners.append(el('li', 'jdm-raffle-history__winner jdm-raffle-history__winner--unknown', 'Résultat non communiqué'));
        entry.append(winners);
        historyList.append(entry);
      }
      historyPanel.append(historyList);
    }

    historyToggle.addEventListener('click', () => {
      raffleHistoryOpen = !raffleHistoryOpen;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector(raffleHistoryOpen
        ? '.jdm-raffle-history__close'
        : '.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
    });
    historyClose.addEventListener('click', () => {
      raffleHistoryOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
    });

    screen.append(layout);
    const historyFooter = el('footer', 'jdm-raffle-footer');
    historyFooter.append(historyToggle);
    screen.append(historyFooter, historyPanel);

    body.append(screen);
  }

  function moderationForm() {
    const moderation = state?.moderation?.tts;
    if (!moderation?.can_moderate) return null;
    const section = el('section', 'jdm-moderation jdm-moderation--screen');
    section.setAttribute('aria-label', 'Console de modération');
    const subnav = el('nav', 'jdm-moderation__subnav');
    subnav.setAttribute('aria-label', 'Sous-modules de modération');
    subnav.setAttribute('role', 'tablist');
    const submodules = [
      ['tts', '🚨', 'TTS urgence'],
      ['history', '🕘', 'Historique'],
      ['users', '👤', 'Utilisateurs'],
      ['modules', '◫', 'Modules'],
    ];
    for (const [id, icon, label] of submodules) {
      const selected = moderationSubmodule === id;
      const tab = el('button', `jdm-btn jdm-moderation__tab${selected ? ' jdm-btn--primary' : ''}`);
      tab.type = 'button';
      tab.dataset.submodule = id;
      tab.id = `moderation-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('aria-controls', 'moderation-panel');
      tab.setAttribute('aria-label', label);
      tab.title = label;
      const iconNode = el('span', 'jdm-moderation__tab-icon', icon);
      iconNode.setAttribute('aria-hidden', 'true');
      tab.append(iconNode, el('span', 'jdm-moderation__tab-label', label));
      tab.addEventListener('click', () => {
        moderationSubmodule = id;
        if (id !== 'users') moderationUserHistoryOpen = false;
        renderPreservingViewport();
      });
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = submodules.findIndex(([submoduleId]) => submoduleId === id);
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? submodules.length - 1
            : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + submodules.length) % submodules.length;
        const nextId = submodules[nextIndex][0];
        const nextTab = subnav.querySelector(`[data-submodule="${nextId}"]`);
        if (nextId === id) {
          nextTab?.focus({ preventScroll: true });
          return;
        }
        nextTab?.click();
        root.querySelector(`[data-submodule="${nextId}"]`)?.focus({ preventScroll: true });
      });
      subnav.append(tab);
    }
    const content = el('div', 'jdm-moderation__subpanel');
    content.dataset.scrollKey = 'module-moderation';
    content.id = 'moderation-panel';
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('aria-labelledby', `moderation-tab-${moderationSubmodule}`);
    const ttsPanel = el('div', 'jdm-moderation__tts');
    const pending = moderation.pending ?? [];
    const ttsStateLabel = moderation.paused ? 'En pause' : 'Actif';
    const ttsState = el('div', 'jdm-moderation__tts-status', `${ttsStateLabel} · ${pending.length} en attente`);
    ttsState.setAttribute('role', 'status');
    ttsState.setAttribute('aria-label', `État global du TTS : ${ttsStateLabel} · ${pending.length} en attente`);

    const controls = el('div', 'jdm-moderation__controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Commandes TTS');
    const pause = el('button', 'jdm-btn', moderation.paused ? 'Reprendre le TTS' : 'Pause TTS');
    pause.type = 'button';
    pause.addEventListener('click', () => runModerationControl(section, () => (
      moderation.paused
        ? client.resumeTts?.() ?? moderationAction('setTtsModeration', { paused: false })
        : client.pauseTts?.() ?? moderationAction('setTtsModeration', { paused: true })
    ), {
      action: moderation.paused ? 'resume' : 'pause',
      acceptedMessage: moderation.paused ? 'Reprise demandée…' : 'Pause demandée…',
      successMessage: moderation.paused ? 'TTS repris ✓' : 'TTS en pause ✓',
    }));
    const stop = el('button', 'jdm-btn jdm-btn--danger', 'Stop TTS');
    stop.type = 'button';
    stop.addEventListener('click', () => runModerationControl(section,
      () => client.stopTts?.() ?? moderationAction('stopTts'),
      { action: 'stop', acceptedMessage: 'Arrêt demandé…', successMessage: 'TTS arrêté ✓' }));
    const purge = el('button', 'jdm-btn jdm-btn--danger', 'Purger la file');
    purge.type = 'button';
    purge.addEventListener('click', () => runModerationControl(section,
      () => client.purgeTts?.() ?? moderationAction('purgeTts'),
      { action: 'purge', acceptedMessage: 'Purge demandée…', successMessage: 'File TTS purgée ✓' }));
    controls.append(pause, stop, purge);
    ttsPanel.append(ttsState, controls);

    if (!pending.length) {
      ttsPanel.append(el('p', 'jdm-hint', 'Aucun TTS en attente.'));
    } else {
      const list = el('div', 'jdm-moderation__list');
      for (const item of pending) {
        const card = el('article', 'jdm-moderation__item');
        card.append(
          el('strong', 'jdm-moderation__viewer', `@${item.login}`),
          el('p', 'jdm-moderation__text', item.text),
        );
        const actions = el('div', 'jdm-moderation__actions');
        actions.setAttribute('role', 'group');
        actions.setAttribute('aria-label', `Actions TTS pour @${item.login}`);
        const approve = el('button', 'jdm-btn jdm-btn--primary', 'Lire');
        approve.type = 'button';
        approve.addEventListener('click', () => run(card, () => moderationAction(
          'decideTtsSubmission', item.submission_id, 'approve',
        )));
        const reject = el('button', 'jdm-btn', 'Refuser');
        reject.type = 'button';
        reject.addEventListener('click', () => run(card, () => moderationAction(
          'decideTtsSubmission', item.submission_id, 'reject',
        )));
        const ban = el('button', 'jdm-btn jdm-btn--danger', 'Bloquer');
        ban.type = 'button';
        ban.addEventListener('click', () => run(card, () => {
          if (typeof client?.rejectAndBanTtsSubmission !== 'function') {
            return Promise.reject(Object.assign(new Error('moderation_atomic_unavailable'), {
              code: 'moderation_atomic_unavailable',
            }));
          }
          return client.rejectAndBanTtsSubmission(item.submission_id, {
            reason: 'Blocage depuis l’extension',
          });
        }, { success: 'Demande refusée et utilisateur bloqué ✓' }));
        actions.append(approve, reject, ban);
        card.append(actions);
        list.append(card);
      }
      ttsPanel.append(list);
    }

    if (moderationSubmodule === 'tts') content.append(ttsPanel);
    if (moderationSubmodule === 'history') content.append(moderationHistoryPanel() ?? moderatorActivityHistory());
    if (moderationSubmodule === 'users') content.append(moderationUsersPanel());
    if (moderationSubmodule === 'modules') content.append(moderationModulesPanel());
    section.append(subnav, content);
    return section;
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

  function historyCost(row) {
    if (row?.cost == null || !Number.isFinite(Number(row.cost))) return '';
    const units = {
      channelpoints: 'PDC',
      jetons: 'jetons',
    };
    const unit = units[row.currency] || String(row.currency || 'unités');
    return `${fmt(row.cost)} ${unit}`;
  }

  function historyIdentity(row) {
    const login = String(row?.login ?? '').trim().replace(/^@+/, '');
    const viewer = String(state?.viewer_login ?? '').trim().replace(/^@+/, '');
    if (!login || (viewer && login.toLowerCase() === viewer.toLowerCase())) return '';
    return `@${login} · `;
  }

  function historyActionIcon(action) {
    return ({ tts: '💬', soundboard: '🔊', bonk: '🔨' })[String(action || '').toLowerCase()] || '✦';
  }

  function historyQuantity(row) {
    const quantity = Number(row?.quantity ?? row?.count);
    return Number.isFinite(quantity) && quantity > 1 ? ` ×${fmt(quantity)}` : '';
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

  const moderationHistoryStatusLabels = Object.freeze({
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
  });
  const moderationHistoryStatusShortLabels = Object.freeze({
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
  });

  function moderationHistoryRow(row, fallbackStatus = 'played') {
    const requestedStatus = String(row?.status || fallbackStatus).trim().toLowerCase();
    const status = moderationHistoryStatusLabels[requestedStatus] ? requestedStatus : fallbackStatus;
    const actionId = String(row?.action || '').trim().toLowerCase();
    const actionLabel = String(row?.label || ({
      tts: 'TTS',
      soundboard: 'Soundboard',
      bonk: 'Bonk',
    })[actionId] || 'Interaction');
    const login = String(row?.login || '').trim().replace(/^@+/, '');
    const identity = login ? `@${login}` : '';
    const detail = actionId === 'tts' ? '' : String(row?.detail || '').trim();
    const targetLogin = String(row?.target_login || '').trim().replace(/^@+/, '');
    const quantity = historyQuantity(row);
    const summaryParts = [identity, actionLabel, detail].filter(Boolean);
    let summary = summaryParts.join(' · ') || 'Interaction';
    if (quantity) summary += quantity;
    if (targetLogin) summary += ` → @${targetLogin}`;
    const cost = historyCost(row);
    const statusLabel = moderationHistoryStatusLabels[status];
    const date = new Date(row?.created_at || 0);
    const when = Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const item = el('li', `jdm-history__item is-${status}`);
    const icon = el('span', 'jdm-history__icon', historyActionIcon(actionId));
    icon.setAttribute('aria-hidden', 'true');
    const copy = el('span', 'jdm-history__copy');
    copy.append(el('strong', 'jdm-history__action', summary));
    const statusNode = el('span', 'jdm-history__status', moderationHistoryStatusShortLabels[status]);
    statusNode.title = statusLabel;
    statusNode.setAttribute('aria-label', statusLabel);
    const timeNode = el('time', 'jdm-history__when', when);
    if (when) timeNode.dateTime = date.toISOString();
    const accessibleSummary = [summary, cost, statusLabel, when].filter(Boolean).join(' · ');
    item.setAttribute('aria-label', accessibleSummary);
    item.title = accessibleSummary;
    item.append(icon, copy);
    if (cost) item.append(el('span', 'jdm-history__cost', cost));
    item.append(statusNode, timeNode);
    return item;
  }

  function moderatorActivityHistory() {
    const activity = state?.moderation?.activity;
    if (!activity?.can_view) return null;
    const rows = Array.isArray(activity.items) ? activity.items : [];
    const details = el('details', 'jdm-mod-history');
    details.open = true;
    const summary = el('summary', 'jdm-mod-history__summary', `Historique du stream · modération${rows.length ? ` · ${rows.length}` : ''}`);
    details.append(summary);
    if (!rows.length) {
      details.append(el('p', 'jdm-hint', 'Aucune interaction globale enregistrée.'));
      return details;
    }
    const list = el('ol', 'jdm-history__list jdm-mod-history__list');
    list.setAttribute('aria-label', 'Historique du stream');
    for (const row of rows.slice(0, 20)) list.append(moderationHistoryRow(row));
    details.append(list);
    return details;
  }

  function moderationHistoryPanel() {
    const history = state?.moderation?.history ?? state?.moderation?.activity;
    if (!history?.can_view) return null;
    const details = el('details', 'jdm-mod-history jdm-mod-history--panel');
    details.open = true;
    const rows = Array.isArray(history.items) ? history.items : [];
    details.setAttribute('aria-label', 'Historique de modération');
    details.append(el('summary', 'jdm-mod-history__summary', `Historique${rows.length ? ` · ${rows.length}` : ''}`));
    const filters = el('div', 'jdm-mod-history__filters');
    filters.setAttribute('role', 'search');
    filters.setAttribute('aria-label', 'Filtres de l’historique');
    const query = el('input', 'jdm-input jdm-mod-history__query');
    query.type = 'search';
    query.placeholder = 'Viewer / cible';
    query.value = moderationHistoryQuery;
    query.dataset.draftKey = 'moderation-history-query';
    query.addEventListener('input', () => {
      moderationHistoryQuery = query.value;
    });
    query.setAttribute('aria-label', 'Rechercher dans l’historique');
    const module = document.createElement('select');
    module.className = 'jdm-input jdm-mod-history__select';
    module.setAttribute('aria-label', 'Filtrer par module');
    for (const option of [['', 'Tous les modules'], ['tts', 'TTS'], ['soundboard', 'Soundboard'], ['bonk', 'Bonk']]) {
      const node = document.createElement('option');
      node.value = option[0];
      node.textContent = option[1];
      node.selected = moderationHistoryModule === option[0];
      module.append(node);
    }
    const status = document.createElement('select');
    status.className = 'jdm-input jdm-mod-history__select';
    status.setAttribute('aria-label', 'Filtrer par statut');
    for (const option of [['', 'Tous les statuts'], ['accepted', 'Acceptée'], ['queued', 'En file'], ['dispatched', 'Transmise'], ['processing', 'En traitement'], ['executed', 'Exécutée'], ['no_active', 'Aucun TTS actif'], ['failed', 'Échec'], ['timeout', 'Délai dépassé'], ['uncertain', 'Non confirmée'], ['played', 'Joué'], ['refund_pending', 'Remboursement en cours'], ['refunded', 'Remboursé'], ['failed_no_charge', 'Échec sans débit'], ['credit_restored', 'Crédit restauré'], ['review', 'Vérification nécessaire']]) {
      const node = document.createElement('option');
      node.value = option[0];
      node.textContent = option[1];
      node.selected = moderationHistoryStatus === option[0];
      status.append(node);
    }
    module.addEventListener('change', () => {
      moderationHistoryModule = module.value;
    });
    status.addEventListener('change', () => {
      moderationHistoryStatus = status.value;
    });
    const reload = el('button', 'jdm-btn', 'Filtrer');
    reload.type = 'button';
    reload.addEventListener('click', () => {
      moderationHistoryQuery = query.value;
      moderationHistoryModule = module.value;
      moderationHistoryStatus = status.value;
      run(details, () => client.moderationHistory?.({
        query: moderationHistoryQuery.trim(),
        module_id: moderationHistoryModule,
        status: moderationHistoryStatus,
      }) ?? Promise.resolve(history), {
        success: '',
        onSuccess: (result) => {
          if (result?.items) {
            state.moderation.history = result;
          }
        },
      });
    });
    filters.append(query, module, status, reload);
    details.append(filters);
    const filtered = rows.filter((row) => {
      const wanted = moderationHistoryQuery.trim().toLowerCase();
      const text = [row.login, row.target_login, row.action, row.detail].join(' ').toLowerCase();
      return (!wanted || text.includes(wanted))
        && (!moderationHistoryModule || row.action === moderationHistoryModule)
        && (!moderationHistoryStatus || row.status === moderationHistoryStatus);
    });
    if (!filtered.length) {
      details.append(el('p', 'jdm-hint', 'Aucune interaction pour ces filtres.'));
      return details;
    }
    const list = el('ol', 'jdm-history__list jdm-mod-history__list');
    list.setAttribute('aria-label', 'Historique de modération');
    for (const row of filtered.slice(0, 50)) list.append(moderationHistoryRow(row));
    details.append(list);
    return details;
  }

  function moderationUserHistoryRows(selected) {
    const profileRows = Array.isArray(selected?.audit)
      ? selected.audit
      : Array.isArray(selected?.history)
        ? selected.history
        : null;
    if (profileRows?.length) return profileRows;

    const selectedId = String(selected?.twitch_user_id || '');
    const selectedLogin = String(selected?.login || '').trim().toLowerCase();
    return (state?.moderation?.history?.items ?? []).filter((row) => (
      (selectedId && String(row?.twitch_user_id || '') === selectedId)
        || (selectedLogin && String(row?.login || '').trim().toLowerCase() === selectedLogin)
    ));
  }

  function moderationUserHistoryPanel(selected) {
    const login = String(selected?.login || selected?.twitch_user_id || '').trim();
    const panel = el('aside', 'jdm-mod-user-history');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Historique de @${login}`);
    const head = el('div', 'jdm-mod-user-history__head');
    head.append(el('strong', 'jdm-mod-user-history__title', `Historique · @${login}`));
    const close = el('button', 'jdm-btn jdm-mod-user-history__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer l’historique utilisateur');
    close.title = 'Fermer l’historique utilisateur';
    close.addEventListener('click', () => {
      moderationUserHistoryOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-mod-user-history-toggle')?.focus({ preventScroll: true }));
    });
    head.append(close);
    panel.append(head);

    const rows = moderationUserHistoryRows(selected);
    if (!rows.length) {
      panel.append(el('p', 'jdm-mod-user-history__empty', 'Aucune interaction enregistrée pour cet utilisateur.'));
      return panel;
    }
    const list = el('ol', 'jdm-history__list jdm-mod-user-history__list');
    list.dataset.scrollKey = 'moderation-user-history';
    list.setAttribute('aria-label', `Historique de @${login}`);
    for (const row of rows.slice(0, 30)) list.append(moderationHistoryRow(row));
    panel.append(list);
    return panel;
  }

  function moderationModulesForUser(selected) {
    const source = Array.isArray(selected?.suspendable_modules)
      ? selected.suspendable_modules
      : Array.isArray(state?.moderation?.suspendable_modules)
        ? state.moderation.suspendable_modules
        : (state?.modules ?? []);
    const seen = new Set();
    return source
      .map((module) => ({
        id: String(module?.id || '').trim(),
        label: String(module?.label || module?.id || '').trim(),
        icon: String(module?.icon || '').trim(),
      }))
      .filter((module) => module.id && module.label && !seen.has(module.id) && seen.add(module.id));
  }

  function moderationSuspensionsForUser(selected) {
    if (Array.isArray(selected?.suspensions)) return selected.suspensions.filter(Boolean);
    return selected?.suspension ? [selected.suspension] : [];
  }

  function moderationSuspensionForModule(moduleId, rows) {
    return rows.find((row) => String(row?.module_id || '') === String(moduleId))
      ?? rows.find((row) => !row?.module_id || row.module_id === '*')
      ?? null;
  }

  function moderationSuspensionExpiryLabel(row) {
    if (!row) return '';
    const raw = row.expires_at;
    if (raw === null || raw === undefined || raw === '') return 'indéfini';
    const timestamp = typeof raw === 'number' || /^\d+$/.test(String(raw))
      ? Number(raw)
      : Date.parse(String(raw));
    if (!Number.isFinite(timestamp)) return 'expiration inconnue';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'expiration inconnue';
    return `jusqu’à ${date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  function moderationCustomDurationSelection(value, unit) {
    const rawValue = String(value ?? '').trim();
    const multiplier = new Map([
      ['seconds', 1000],
      ['minutes', 60_000],
      ['hours', 3_600_000],
      ['days', 86_400_000],
    ]).get(String(unit));
    if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(Number(rawValue)) || !multiplier) return null;
    const amount = Number(rawValue);
    const durationMs = amount * multiplier;
    if (!Number.isSafeInteger(durationMs)
      || durationMs < moderationCustomDurationMinMs
      || durationMs > moderationCustomDurationMaxMs) return null;
    const unitLabel = moderationSuspensionDurationUnits.find(([candidate]) => candidate === String(unit))?.[1];
    const singular = {
      seconds: 'seconde',
      minutes: 'minute',
      hours: 'heure',
      days: 'jour',
    }[String(unit)];
    return {
      durationMs,
      label: `${amount} ${amount === 1 ? singular : unitLabel}`,
    };
  }

  function moderationSuspensionDurationSelection(value, customValue, customUnit) {
    const normalized = String(value);
    if (normalized === '') return { durationMs: null, label: 'Indéfinie' };
    if (normalized === 'custom') return moderationCustomDurationSelection(customValue, customUnit);
    const preset = moderationSuspensionDurationOptions.find(([candidate]) => candidate === normalized);
    if (!preset) return null;
    return { durationMs: Number(preset[0]), label: preset[1] };
  }

  function moderationSuspensionDurationLabel(value, customValue, customUnit) {
    return moderationSuspensionDurationSelection(value, customValue, customUnit)?.label
      ?? 'durée personnalisée';
  }

  function moderationModuleLabels(moduleIds, modules) {
    const labels = new Map(modules.map((module) => [module.id, module.label]));
    return moduleIds.map((moduleId) => labels.get(moduleId) || moduleId);
  }

  async function refreshModerationUserProfile(userId) {
    if (typeof client?.moderationUserProfile !== 'function') return null;
    try {
      const result = await client.moderationUserProfile(userId);
      if (!result?.user) return null;
      moderationSelectedUser = result.user;
      state.moderation ??= {};
      state.moderation.selected_user = result.user;
      return result.user;
    } catch {
      // L'action est déjà confirmée. Le prochain polling ou l'ouverture de la
      // fiche reprendra la source serveur sans transformer ce succès en erreur.
      return null;
    }
  }

  function moderationUsersPanel() {
    const panel = el('section', 'jdm-mod-users');
    panel.setAttribute('aria-label', 'Gestion des utilisateurs');
    const searchRow = el('div', 'jdm-mod-history__filters jdm-mod-users__search');
    searchRow.setAttribute('role', 'search');
    searchRow.setAttribute('aria-label', 'Rechercher un utilisateur');
    const query = el('input', 'jdm-input');
    query.type = 'search';
    query.placeholder = 'Login / ID Twitch';
    query.value = moderationUsersQuery;
    query.dataset.draftKey = 'moderation-users-query';
    query.addEventListener('input', () => {
      moderationUsersQuery = query.value;
    });
    query.setAttribute('aria-label', 'Rechercher un utilisateur');
    const search = el('button', 'jdm-btn jdm-mod-users__search-button', 'Rechercher');
    search.type = 'button';
    search.setAttribute('aria-label', 'Rechercher cet utilisateur');
    search.addEventListener('click', () => run(panel, () => moderationAction('moderationUsers', query.value.trim()), {
      success: '',
      onSuccess: (result) => {
        moderationUsersQuery = query.value;
        moderationUsers = Array.isArray(result?.items) ? result.items : [];
        state.moderation.users = moderationUsers;
      },
    }));
    searchRow.append(query, search);
    panel.append(searchRow);
    const users = Array.isArray(moderationUsers)
      ? moderationUsers
      : (state?.moderation?.users ?? []);
    const selected = moderationSelectedUser ?? state?.moderation?.selected_user;
    const list = el('div', 'jdm-mod-users__list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Résultats utilisateurs');
    if (!users.length) {
      list.append(el('p', 'jdm-mod-users__empty', moderationUsersQuery.trim()
        ? 'Aucun utilisateur trouvé.'
        : 'Saisis un login ou un ID Twitch.'));
    }
    for (const user of users.slice(0, 20)) {
      const label = `@${user.login || user.twitch_user_id}`;
      const button = el('button', 'jdm-btn jdm-mod-users__user', label);
      button.type = 'button';
      button.classList.toggle('is-selected', String(selected?.twitch_user_id || '') === String(user.twitch_user_id || ''));
      button.setAttribute('aria-label', `Ouvrir le profil de ${label}`);
      button.title = `Ouvrir le profil de ${label}`;
      button.addEventListener('click', () => run(panel, () => moderationAction('moderationUserProfile', user.twitch_user_id), {
        success: '',
        onSuccess: (result) => {
          moderationSelectedUser = result?.user ?? user;
          state.moderation.selected_user = moderationSelectedUser;
          moderationUserHistoryOpen = false;
        },
      }));
      list.append(button);
    }
    panel.append(list);
    const selectedId = String(selected?.twitch_user_id || '');
    if (selectedId !== moderationSuspensionSelectionUserId) {
      moderationSuspensionSelectionUserId = selectedId;
      moderationSuspendSelection.clear();
      moderationUnsuspendSelection.clear();
    }
    const availableModules = moderationModulesForUser(selected);
    const availableModuleIds = new Set(availableModules.map((module) => module.id));
    for (const moduleId of moderationSuspendSelection) {
      if (!availableModuleIds.has(moduleId)) moderationSuspendSelection.delete(moduleId);
    }
    const suspensionRows = moderationSuspensionsForUser(selected);
    const activeModules = availableModules.filter((module) => moderationSuspensionForModule(module.id, suspensionRows));
    const activeModuleIds = new Set(activeModules.map((module) => module.id));
    for (const moduleId of moderationUnsuspendSelection) {
      if (!activeModuleIds.has(moduleId)) moderationUnsuspendSelection.delete(moduleId);
    }
    if (selected) {
      const card = el('div', 'jdm-mod-user-card');
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', `Actions pour @${selected.login || selected.twitch_user_id}`);
      const balance = Number(selected.credits?.soundboard || 0);
      const suspensionLabel = activeModules.length
        ? `${activeModules.length} module${activeModules.length > 1 ? 's' : ''} suspendu${activeModules.length > 1 ? 's' : ''}`
        : 'Aucune suspension active';
      const identity = el('div', 'jdm-mod-user-card__identity');
      identity.append(
        el('span', 'jdm-mod-user-card__avatar', '👤'),
        el('strong', 'jdm-mod-user-card__login', `@${selected.login || selected.twitch_user_id}`),
      );
      const statusNode = el('span', 'jdm-hint jdm-mod-user-card__status', suspensionLabel);
      statusNode.dataset.state = activeModules.length ? 'suspended' : 'active';
      card.append(
        identity,
        el('span', 'jdm-hint', `${balance} crédit${balance > 1 ? 's' : ''} Soundboard`),
        statusNode,
      );
      if (selected.tts_banned) {
        const banStatus = el('span', 'jdm-hint jdm-mod-user-card__tts-ban', 'TTS bloqué');
        banStatus.dataset.state = 'banned';
        const unban = el('button', 'jdm-btn jdm-btn--secondary jdm-mod-user-card__unban', 'Débloquer le TTS');
        unban.type = 'button';
        unban.setAttribute('aria-label', `Débloquer le TTS pour @${selected.login || selected.twitch_user_id}`);
        unban.addEventListener('click', () => {
          if (typeof client?.unbanTtsViewer !== 'function') return;
          return run(card, () => client.unbanTtsViewer(selected.twitch_user_id), {
            success: `TTS débloqué pour @${selected.login || selected.twitch_user_id} ✓`,
            onSuccess: async () => {
              selected.tts_banned = false;
              await refreshModerationUserProfile(selected.twitch_user_id);
            },
          });
        });
        card.append(banStatus, unban);
      }
      const delta = el('input', 'jdm-input');
      delta.type = 'number';
      delta.min = '1';
      delta.value = '1';
      delta.step = '1';
      delta.setAttribute('aria-label', 'Nombre de crédits Soundboard à ajuster');
      const adjustmentAmount = () => {
        const amount = Math.trunc(Number(delta.value));
        if (!Number.isFinite(amount) || amount < 1) {
          flash(card, 'Indique au moins 1 crédit.', 'error');
          return null;
        }
        return amount;
      };
      const suspensionDuration = document.createElement('select');
      suspensionDuration.className = 'jdm-input';
      suspensionDuration.setAttribute('aria-label', 'Durée de la suspension');
      for (const option of moderationSuspensionDurationOptions) {
        const node = document.createElement('option');
        node.value = option[0];
        node.textContent = option[1];
        node.selected = option[0] === moderationSuspensionDuration;
        suspensionDuration.append(node);
      }
      suspensionDuration.value = moderationSuspensionDuration;
      const customDurationValue = document.createElement('input');
      customDurationValue.className = 'jdm-input';
      customDurationValue.type = 'number';
      customDurationValue.min = '1';
      customDurationValue.step = '1';
      customDurationValue.inputMode = 'numeric';
      customDurationValue.value = moderationSuspensionCustomValue;
      customDurationValue.setAttribute('aria-label', 'Valeur de la durée personnalisée');
      const customDurationUnit = document.createElement('select');
      customDurationUnit.className = 'jdm-input';
      customDurationUnit.setAttribute('aria-label', 'Unité de la durée personnalisée');
      for (const option of moderationSuspensionDurationUnits) {
        const node = document.createElement('option');
        node.value = option[0];
        node.textContent = option[1];
        node.selected = option[0] === moderationSuspensionCustomUnit;
        customDurationUnit.append(node);
      }
      customDurationUnit.value = moderationSuspensionCustomUnit;
      const customDurationFields = el('div', 'jdm-mod-user-card__custom-duration');
      customDurationFields.append(customDurationValue, customDurationUnit);
      const suspensionDurationControls = el('div', 'jdm-mod-user-card__duration-controls');
      suspensionDurationControls.append(suspensionDuration, customDurationFields);
      const syncDurationControls = () => {
        const isCustom = suspensionDuration.value === 'custom';
        const multiplier = new Map([
          ['seconds', 1000],
          ['minutes', 60_000],
          ['hours', 3_600_000],
          ['days', 86_400_000],
        ]).get(customDurationUnit.value) || 60_000;
        customDurationValue.min = String(Math.ceil(moderationCustomDurationMinMs / multiplier));
        customDurationValue.max = String(Math.floor(moderationCustomDurationMaxMs / multiplier));
        customDurationFields.hidden = !isCustom;
        customDurationFields.setAttribute('aria-hidden', String(!isCustom));
        customDurationValue.disabled = !isCustom;
        customDurationUnit.disabled = !isCustom;
      };
      suspensionDuration.addEventListener('change', () => {
        moderationSuspensionDuration = suspensionDuration.value;
        syncDurationControls();
      });
      customDurationValue.addEventListener('input', () => {
        moderationSuspensionCustomValue = customDurationValue.value;
      });
      customDurationUnit.addEventListener('change', () => {
        moderationSuspensionCustomUnit = customDurationUnit.value;
        syncDurationControls();
      });
      syncDurationControls();
      const confirmWrite = (message) => typeof window.confirm !== 'function' || window.confirm(message);
      const add = el('button', 'jdm-btn jdm-mod-user-card__credit-button', '+');
      add.type = 'button';
      add.setAttribute('aria-label', 'Ajouter des crédits Soundboard');
      add.title = 'Ajouter des crédits Soundboard';
      add.addEventListener('click', () => {
        if (!confirmWrite('Ajouter ces crédits Soundboard à cet utilisateur ?')) return;
        const amount = adjustmentAmount();
        if (amount === null) return;
        return run(card, () => moderationAction('adjustSoundboardCredits', {
          twitch_user_id: selected.twitch_user_id,
          delta: amount,
          reason: 'Ajustement depuis la console',
        }), {
          onSuccess: async (result) => {
            selected.credits = { ...(selected.credits || {}), soundboard: Number(result?.balance ?? balance) };
            await refreshModerationUserProfile(selected.twitch_user_id);
          },
        });
      });
      const remove = el('button', 'jdm-btn jdm-mod-user-card__credit-button', '−');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Retirer des crédits Soundboard');
      remove.title = 'Retirer des crédits Soundboard';
      remove.addEventListener('click', () => {
        if (!confirmWrite('Retirer ces crédits Soundboard à cet utilisateur ?')) return;
        const amount = adjustmentAmount();
        if (amount === null) return;
        return run(card, () => moderationAction('adjustSoundboardCredits', {
          twitch_user_id: selected.twitch_user_id,
          delta: -amount,
          reason: 'Ajustement depuis la console',
        }), {
          onSuccess: async (result) => {
            selected.credits = { ...(selected.credits || {}), soundboard: Number(result?.balance ?? balance) };
            await refreshModerationUserProfile(selected.twitch_user_id);
          },
        });
      });
      const historyToggle = el('button', 'jdm-btn jdm-mod-user-history-toggle', 'Historique');
      historyToggle.type = 'button';
      historyToggle.setAttribute('aria-expanded', String(moderationUserHistoryOpen));
      historyToggle.setAttribute('aria-label', `Afficher l’historique de @${selected.login || selected.twitch_user_id}`);
      historyToggle.addEventListener('click', () => {
        moderationUserHistoryOpen = !moderationUserHistoryOpen;
        renderPreservingViewport();
      });
      const creditsGroup = el('div', 'jdm-mod-user-card__group jdm-mod-user-card__group--credits');
      creditsGroup.setAttribute('role', 'group');
      creditsGroup.setAttribute('aria-label', 'Crédits Soundboard');
      creditsGroup.append(
        el('span', 'jdm-mod-user-card__group-label', 'Crédits'),
        el('strong', 'jdm-mod-user-card__balance', String(balance)),
        remove,
        delta,
        add,
      );
      const suspensionGroup = el('div', 'jdm-mod-user-card__group jdm-mod-user-card__group--suspension');
      suspensionGroup.setAttribute('role', 'group');
      suspensionGroup.setAttribute('aria-label', 'Suspension Extension');
      suspensionGroup.append(el('span', 'jdm-mod-user-card__group-label', 'Accès'), historyToggle);
      const suspensionStatusList = el('ul', 'jdm-mod-user-card__suspensions');
      suspensionStatusList.setAttribute('aria-label', 'État des suspensions par module');
      for (const module of availableModules) {
        const row = moderationSuspensionForModule(module.id, suspensionRows);
        const status = row ? `Suspendu · ${moderationSuspensionExpiryLabel(row)}` : 'Actif';
        const item = el('li', 'jdm-mod-user-card__suspension');
        item.dataset.moduleId = module.id;
        item.dataset.state = row ? 'suspended' : 'active';
        item.setAttribute('aria-label', `${module.label} — ${status}`);
        item.append(
          el('span', 'jdm-mod-user-card__suspension-module', `${module.icon ? `${module.icon} ` : ''}${module.label}`),
          el('span', 'jdm-mod-user-card__suspension-state', status),
        );
        suspensionStatusList.append(item);
      }
      suspensionGroup.append(suspensionStatusList);

      const createModulePicker = ({
        legendText,
        options,
        selection,
        actionText,
        actionClass,
        actionLabel,
        extraControl = null,
        onAction,
      }) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'jdm-mod-user-card__module-picker';
        const legend = el('legend', 'jdm-mod-user-card__module-picker-legend', legendText);
        const optionList = el('div', 'jdm-mod-user-card__module-options');
        optionList.setAttribute('role', 'group');
        optionList.setAttribute('aria-label', legendText);
        const inputs = [];
        const optionIds = new Set(options.map((module) => module.id));
        for (const module of options) {
          const inputId = `moderation-${selectedId}-${module.id}-${actionText.toLowerCase()}`;
          const optionLabel = el('label', 'jdm-mod-user-card__module-option');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = module.id;
          input.checked = selection.has(module.id);
          input.setAttribute('id', inputId);
          input.setAttribute('data-module-id', module.id);
          input.setAttribute('aria-label', `${module.label} · ${actionText}`);
          input.addEventListener('change', () => {
            if (input.checked) selection.add(module.id);
            else selection.delete(module.id);
            sync();
          });
          optionLabel.htmlFor = inputId;
          optionLabel.append(input, el('span', 'jdm-mod-user-card__module-option-label', `${module.icon ? `${module.icon} ` : ''}${module.label}`));
          optionList.append(optionLabel);
          inputs.push(input);
        }
        const selectAllLabel = el('label', 'jdm-mod-user-card__module-option jdm-mod-user-card__module-option--all');
        const selectAll = document.createElement('input');
        selectAll.type = 'checkbox';
        selectAll.setAttribute('aria-label', `${actionText} sur tous les modules`);
        selectAllLabel.append(selectAll, el('span', 'jdm-mod-user-card__module-option-label', 'Tout sélectionner'));
        const actionRow = el('div', 'jdm-mod-user-card__suspension-actions');
        if (extraControl) actionRow.append(extraControl);
        const action = el('button', actionClass, actionText);
        action.type = 'button';
        action.disabled = true;
        action.setAttribute('aria-label', actionLabel);
        actionRow.append(action);
        const sync = () => {
          const selectedIds = [...selection].filter((moduleId) => optionIds.has(moduleId));
          selectAll.checked = options.length > 0 && selectedIds.length === options.length;
          selectAll.indeterminate = selectedIds.length > 0 && selectedIds.length < options.length;
          selectAll.setAttribute('aria-checked', selectAll.indeterminate ? 'mixed' : String(selectAll.checked));
          action.disabled = selectedIds.length === 0;
          for (const input of inputs) input.checked = selection.has(input.value);
        };
        selectAll.addEventListener('change', () => {
          if (selectAll.checked) {
            for (const module of options) selection.add(module.id);
          } else {
            for (const module of options) selection.delete(module.id);
          }
          sync();
        });
        action.addEventListener('click', () => {
          const selectedIds = [...selection].filter((moduleId) => optionIds.has(moduleId));
          if (!selectedIds.length) return;
          return onAction(selectedIds, moderationModuleLabels(selectedIds, options));
        });
        fieldset.append(legend, optionList, selectAllLabel, actionRow);
        sync();
        return fieldset;
      };

      const suspendPicker = createModulePicker({
        legendText: 'Suspendre sur les modules',
        options: availableModules,
        selection: moderationSuspendSelection,
        actionText: 'Suspendre',
        actionClass: 'jdm-btn jdm-btn--danger jdm-mod-user-card__suspension-button',
        actionLabel: `Suspendre @${selected.login || selected.twitch_user_id} sur les modules sélectionnés`,
        extraControl: suspensionDurationControls,
        onAction: (moduleIds, labels) => {
          const duration = moderationSuspensionDurationSelection(
            suspensionDuration.value,
            customDurationValue.value,
            customDurationUnit.value,
          );
          if (!duration) {
            flash(card, 'La durée personnalisée doit être un entier d’au moins 1 minute et ne pas dépasser 365 jours.', 'error');
            return;
          }
          const durationMs = duration.durationMs;
          const durationLabel = moderationSuspensionDurationLabel(
            suspensionDuration.value,
            customDurationValue.value,
            customDurationUnit.value,
          ).toLowerCase();
          if (!confirmWrite(`Suspendre @${selected.login || selected.twitch_user_id} pendant ${durationLabel} sur : ${labels.join(', ')} ?`)) return;
          return run(card, async () => {
            const result = await moderationAction('suspendUser', {
              twitch_user_id: selected.twitch_user_id,
              module_ids: moduleIds,
              duration_ms: durationMs,
              login: selected.login,
              reason: 'Suspension depuis la console',
            });
            if (Array.isArray(result?.errors) && result.errors.length) {
              throw Object.assign(new Error('moderation_batch_partial_failure'), { code: 'moderation_batch_partial_failure' });
            }
            if (result?.scope !== 'modules' || !Array.isArray(result?.suspensions)) {
              throw Object.assign(new Error('moderation_batch_unavailable'), { code: 'moderation_batch_unavailable' });
            }
            return result;
          }, {
            success: () => `@${selected.login || selected.twitch_user_id} suspendu sur ${labels.join(' et ')} pendant ${durationLabel}.`,
            onSuccess: async (result) => {
              selected.suspensions = result.suspensions;
              selected.suspension = result.suspensions.find((row) => !row?.module_id || row.module_id === '*')
                ?? result.suspensions[0]
                ?? null;
              moderationSuspendSelection.clear();
              moderationUnsuspendSelection.clear();
              await refreshModerationUserProfile(selected.twitch_user_id);
            },
          });
        },
      });
      suspensionGroup.append(suspendPicker);

      if (activeModules.length) {
        const restorePicker = createModulePicker({
          legendText: 'Réactiver sur les modules suspendus',
          options: activeModules,
          selection: moderationUnsuspendSelection,
          actionText: 'Réactiver',
          actionClass: 'jdm-btn jdm-btn--secondary jdm-mod-user-card__suspension-button',
          actionLabel: `Réactiver @${selected.login || selected.twitch_user_id} sur les modules sélectionnés`,
          onAction: (moduleIds, labels) => {
            if (!confirmWrite(`Réactiver @${selected.login || selected.twitch_user_id} sur : ${labels.join(', ')} ?`)) return;
            return run(card, async () => {
              const result = await moderationAction('unsuspendUser', {
                twitch_user_id: selected.twitch_user_id,
                module_ids: moduleIds,
              });
              if (Array.isArray(result?.errors) && result.errors.length) {
                throw Object.assign(new Error('moderation_batch_partial_failure'), { code: 'moderation_batch_partial_failure' });
              }
              if (result?.scope !== 'modules' || !Array.isArray(result?.remaining_suspensions)) {
                throw Object.assign(new Error('moderation_batch_unavailable'), { code: 'moderation_batch_unavailable' });
              }
              return result;
            }, {
              success: () => `@${selected.login || selected.twitch_user_id} réactivé sur ${labels.join(' et ')}.`,
              onSuccess: async (result) => {
                selected.suspensions = result.remaining_suspensions;
                selected.suspension = result.remaining_suspensions.find((row) => !row?.module_id || row.module_id === '*')
                  ?? result.remaining_suspensions[0]
                  ?? null;
                moderationUnsuspendSelection.clear();
                await refreshModerationUserProfile(selected.twitch_user_id);
              },
            });
          },
        });
        suspensionGroup.append(restorePicker);
      }
      card.append(creditsGroup, suspensionGroup);
      panel.append(card);
      if (moderationUserHistoryOpen) panel.append(moderationUserHistoryPanel(selected));
    }
    return panel;
  }

  function moderationModulesPanel() {
    const panel = el('details', 'jdm-mod-modules');
    panel.open = true;
    panel.setAttribute('aria-label', 'États des modules');
    panel.append(el('summary', 'jdm-mod-history__summary', 'Modules'));
    const states = state?.moderation?.modules ?? state?.module_states ?? {};
    const list = el('div', 'jdm-mod-modules__list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Contrôles des modules');
    for (const mod of state?.modules ?? []) {
      const enabled = states[mod.id]?.enabled !== false;
      const button = el('button', `jdm-btn${enabled ? '' : ' jdm-btn--danger'}`, `${mod.icon} ${mod.label} · ${enabled ? 'Actif' : 'Coupé'}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', `${mod.label} · ${enabled ? 'Actif' : 'Coupé'}. Cliquer pour ${enabled ? 'couper' : 'activer'} le module.`);
      button.title = `${mod.label} · ${enabled ? 'Actif' : 'Coupé'}`;
      button.addEventListener('click', () => run(panel, () => moderationAction('setModuleControl', mod.id, !enabled), {
        onSuccess: () => {
          state.module_states ??= {};
          state.module_states[mod.id] = { ...(state.module_states[mod.id] || {}), enabled: !enabled };
          state.moderation ??= {};
          state.moderation.modules ??= {};
          state.moderation.modules[mod.id] = { ...(state.moderation.modules[mod.id] || {}), enabled: !enabled };
        },
      }));
      list.append(button);
    }
    panel.append(list);
    return panel;
  }

  const FORMS = { tts: ttsForm, raffle_join: raffleForm };

  // --- rendu ---------------------------------------------------------------

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
    const soundboardView = openModule === 'soundboard'
      && (state.modules ?? []).some((candidate) => candidate.id === 'soundboard');
    const moderationView = openModule === MODERATION_MODULE.id && canModerate();
    const ttsView = openModule === 'tts';
    const raffleView = openModule === 'raffle_join';
    const paymentView = soundboardView || ttsView;
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
    if (soundboardView && !headerSwitch) walletRow.classList.add('jdm-soundboard-wallet');
    // Une récompense TTS en attente = une utilisation, comme dans ttsForm.
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
      : ttsView ? pendingFor('tts').length : soundboardCreditBalance();
    const creditModule = ttsView ? 'TTS' : 'Soundboard';
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
      const mode = soundboardView ? paymentChoice.soundboard : ttsView ? paymentChoice.tts : consultView ? hubWalletMethod : 'tokens';
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
      // Hauteur disponible sous le haut du Hub : rien ne déborde de la surface Twitch.
      hub.classList.toggle('is-narrow', hub.clientWidth <= 340);
      requestAnimationFrame(() => {
        if (!hub.isConnected) return;
        hub.classList.toggle('is-narrow', hub.clientWidth <= 340);
        const page = document.scrollingElement;
        const topOffset = hub.getBoundingClientRect().top + (page?.scrollTop ?? 0);
        hub.style.setProperty('--rh-top', `${Math.max(0, Math.round(topOffset))}px`);
        const overflow = page ? page.scrollHeight - page.clientHeight : 0;
        if (overflow > 0) hub.style.setProperty('--rh-bottom', `${8 + overflow}px`);
      });
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
        variant?.rendered?.(hostView, variantContext(variant, mod, body));
        // A view either has its own node, or draws into the module body (Soundboard).
        if (hostView.node) body.append(hostView.node);
        queueMicrotask(() => hostView?.attached?.());
      } else if (mod.id === MODERATION_MODULE.id) {
        const moderation = moderationForm();
        if (moderation) {
          if (successMessage) {
            moderation.prepend(el('p', 'jdm-flash jdm-flash--ok', successMessage));
            successMessage = null;
          }
          if (actionError) moderation.prepend(el('p', 'jdm-flash jdm-flash--error', actionError));
          body.append(moderation);
        }
      } else {
        FORMS[mod.id]?.(mod, body);
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
