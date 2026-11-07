// Tombola V1: the « raffle_join » screen when the session does not offer Tombola V2 (`raffle_v2`) — a Lab without its
// Core, the calibration build. A module variant (module-registry.js) drawn into the host's module body at each render, as
// ui.js drew it. The visit owns its countdown, its timer snapshot and its history drawer (Escape closes it): destroyed
// on leaving. A join the server confirmed stays shown for its window (host.memory) even if a poll has not caught up.
import { registerModuleVariant } from './module-registry.js';
import { tombolaV2Applies } from './tombola-v2.js';
import { createIconButton, UI_ICONS } from './ui-primitives.js';

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

// Le pot garde une valeur exacte et groupée. On remplace l'espace fine de
// l'API Intl par une espace insécable normale pour que la séparation reste
// perceptible dans la petite carte Tombola.
function fmtRafflePotAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('fr-FR').replace(/\u202f/gu, '\u00a0');
}

function raffleSeconds(raffle) {
  const endsAt = Date.parse(raffle?.ends_at || '');
  if (Number.isFinite(endsAt)) return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return Math.max(0, Number(raffle?.ends_in_s || 0));
}

export function raffleIsActive(raffle) {
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


function createTombolaV1View({ document, root, host }) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const memory = host.memory;
  let historyOpen = false;
  let countdown = null;
  let snapshot = null;
  const stop = () => {
    if (countdown === null) return;
    if (typeof globalThis.clearInterval === 'function') globalThis.clearInterval(countdown);
    countdown = null;
  };
  // The join the server confirmed, for as long as its window is the open one.
  const withJoin = (raffle) => {
    const windowId = String(raffle?.window_id || '').trim();
    if (memory.joinedWindow && (!raffle?.open || windowId !== memory.joinedWindow)) memory.joinedWindow = null;
    return memory.joinedWindow && raffle?.joined !== true ? { ...raffle, joined: true } : raffle;
  };
  // Escape closes the history drawer (the host's own popups, registered earlier on the root, take it first).
  const onKey = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !historyOpen) return;
    event.preventDefault();
    event.stopPropagation();
    historyOpen = false;
    host.redraw();
    queueMicrotask(() => root.querySelector('.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
  };
  root.addEventListener('keydown', onKey);

  function draw({ client, state, body }) {
      stop();
      const raffle = withJoin(state?.raffle) ?? { open: false };
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
        label: historyOpen ? 'Fermer l’historique Tombola' : 'Ouvrir l’historique Tombola',
        title: historyOpen ? 'Fermer l’historique' : 'Historique des tombolas',
        className: 'jdm-raffle-history-toggle',
        iconClassName: 'jdm-raffle-history-toggle__icon',
        visibleLabel: 'Historique',
      });
      historyToggle.setAttribute('aria-controls', 'raffle-history-panel');
      historyToggle.setAttribute('aria-expanded', String(historyOpen));
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
      const snapshotChanged = !snapshot
        || snapshot.active !== active
        || snapshot.windowId !== timerWindowId
        || snapshot.source !== timerSource
        || snapshot.endsAt !== timerEndsAt
        || snapshot.serverRemaining !== snapshotRemaining;
      if (snapshotChanged) {
        const initialRemaining = active
          ? timerSource === 'ends_at'
            ? raffleSeconds(raffle)
            : serverRemaining ?? 0
          : 0;
        snapshot = {
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
        snapshot.totalSeconds = explicitTotal;
      }
      const timerTotal = Math.max(1, Number(snapshot?.totalSeconds || 1));
      const currentTimerSeconds = () => {
        if (!active) return 0;
        if (timerSource === 'ends_at') return raffleSeconds(raffle);
        if (timerSource === 'ends_in_s' && snapshot?.serverRemaining !== null) {
          return Math.max(0, Math.ceil(
            snapshot.serverRemaining - (Date.now() - snapshot.syncedAt) / 1000,
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
        countdown = globalThis.window.setInterval(syncTimer, 1000);
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
        if (!raffle.joined) join.addEventListener('click', () => host.run(joinZone, () => client.joinRaffle(), {
          onSuccess: (result) => {
            const windowId = String(result?.window_id || raffle.window_id || '').trim();
            if (!windowId) return;
            memory.joinedWindow = windowId;
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
      historyPanel.setAttribute('aria-hidden', String(!historyOpen));
      historyPanel.inert = !historyOpen;
      historyPanel.classList.toggle('is-screen-fallback', !active);
      historyPanel.classList.toggle('is-open', historyOpen);
      const historyHead = el('div', 'jdm-raffle-history-panel__head');
      const historyClose = createIconButton({
        icon: UI_ICONS.close,
        label: 'Fermer l’historique Tombola',
        title: 'Fermer l’historique',
        className: 'jdm-raffle-history__close',
        iconClassName: 'jdm-raffle-history__close-icon',
      });
      historyClose.tabIndex = historyOpen ? 0 : -1;
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
        historyOpen = !historyOpen;
        host.redraw();
        queueMicrotask(() => root.querySelector(historyOpen
          ? '.jdm-raffle-history__close'
          : '.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
      });
      historyClose.addEventListener('click', () => {
        historyOpen = false;
        host.redraw();
        queueMicrotask(() => root.querySelector('.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
      });

      screen.append(layout);
      const historyFooter = el('footer', 'jdm-raffle-footer');
      historyFooter.append(historyToggle);
      screen.append(historyFooter, historyPanel);

      body.append(screen);
  }

  return {
    node: null,
    draw,
    destroy() {
      stop();
      root.removeEventListener('keydown', onKey);
    },
  };
}

registerModuleVariant({
  id: 'raffle_join',
  // Registered after Tombola V2 (imported above): exactly the sessions V2 does not take.
  match: (env) => !tombolaV2Applies(env),
  view: (ctx) => createTombolaV1View(ctx),
  rendered: (view, ctx) => view.draw(ctx),
});
