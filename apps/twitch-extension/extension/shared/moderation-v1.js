// Moderation V1: the « moderation » console when the session does not offer the D4 console (moderation V2:
// `moderation_v2`) — a Lab without Core, the calibration build. A module variant (module-registry.js) drawn into the
// host's module body at each render, exactly as ui.js drew it. The console (its tab, searches, selected user,
// suspension choices) lives for the panel's life in host.memory, as it always did; a visit only opens and closes it.
// Escape closes the user history drawer while the console is open (the host's own popups take Escape first).
import { registerModuleVariant } from './module-registry.js';
import { moderationV2Applies } from './moderation-v2.js';
import { historyActionIcon, historyCost, historyQuantity } from './history-format.js';


function createModerationV1Console({ document, client, root, host }) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const flash = (node, message, kind = 'error') => {
    const box = el('p', `jdm-flash jdm-flash--${kind}`, message);
    node.append(box);
    setTimeout(() => box.remove(), 4000);
  };
  const run = (node, task, options) => host.run(node, task, options);
  const renderPreservingViewport = () => host.redraw();
  /** The session state of the current draw. */
  let state = null;
  /** A visit of the module is open (Escape is only the console's then). */
  let visiting = false;

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

  // Soundboard viewer (markup sbx-*, feuille soundboard.css). Le son est la star : cartes lisibles,
  // aperçu distinct de l'achat, prix et envoi regroupés dans la barre d'action du bas.
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
        // The redraw replaces the toggle: the focus goes to the drawer (its close button), or back to the toggle — never
        // lost outside the panel, where Escape could not close the drawer.
        queueMicrotask(() => root.querySelector(moderationUserHistoryOpen
          ? '.jdm-mod-user-history__close'
          : '.jdm-mod-user-history-toggle')?.focus({ preventScroll: true }));
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


  // --- rendu ---------------------------------------------------------------

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !visiting || !moderationUserHistoryOpen) return;
    event.preventDefault();
    event.stopPropagation();
    moderationUserHistoryOpen = false;
    renderPreservingViewport();
    queueMicrotask(() => root.querySelector('.jdm-mod-user-history-toggle')?.focus({ preventScroll: true }));
  });

  return {
    open() { visiting = true; },
    close() { visiting = false; },
    draw({ state: next, body }) {
      state = next;
      const moderation = moderationForm();
      if (!moderation) return;
      // The host's action feedback goes inside the console (not above the screen).
      const { success, error } = host.feedback();
      if (success) moderation.prepend(el('p', 'jdm-flash jdm-flash--ok', success));
      if (error) moderation.prepend(el('p', 'jdm-flash jdm-flash--error', error));
      body.append(moderation);
    },
  };
}

registerModuleVariant({
  id: 'moderation',
  // Registered after moderation V2 (imported above): exactly the sessions V2 does not take.
  match: (env) => !moderationV2Applies(env),
  intro: false,
  view: (ctx) => {
    const console_ = (ctx.host.memory.console ??= createModerationV1Console(ctx));
    console_.open();
    return { node: null, console: console_, destroy: () => console_.close() };
  },
  rendered: (view, ctx) => view.console.draw(ctx),
});
