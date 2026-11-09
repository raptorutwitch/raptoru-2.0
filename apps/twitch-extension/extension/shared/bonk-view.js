// Bonk — the module's whole screen, out of ui.js (docs/studio-refonte/architecture/MIGRATIONS.md). A module variant
// (module-registry.js) with the same lifecycle as the Soundboard: created when the viewer opens Bonk, drawn at each host
// redraw (`rendered`), destroyed when the viewer leaves (the magazine is emptied and the mode set back, the outcome of
// the last shot forgotten, the tour closed). Its own mechanics are untouched: multi-click magazine, Manuel / Auto salve,
// speed, reload, favourites and recents, sources (Twitch, 7TV, BTTV, FFZ, Unicode), tour.
//
// What lives for the panel (host.memory): the picker (it keeps its cells across redraws), the magazine (its speed and
// composition), the tour, the send (requests in flight), « tour shown once », the Twitch link window. What it asks the
// host (ctx.host): the emote access service (host.emotes), the restriction, whether interactions are open, a redraw, a
// refresh and the notification centre. Core stays the authority on every shot (price, delay, admission).

import { newIdempotencyKey, errorLabel } from './api.js';
import { createRetryKeys, withRetryKey } from './purchase.js';
import { registerModuleVariant } from './module-registry.js';
import { createFeedbackSlot, createIconButton, providerPresentation, UI_ICONS } from './ui-primitives.js';
import { UNICODE_EMOJI_GROUPS } from './unicode-emojis.js';
import { createEmotePicker } from './emote-picker.js';
import { createBonkChargeur } from './bonk-chargeur.js';
import { createBonkTour } from './bonk-tour.js';
import { createTwitchEmoteDialog, createTwitchEmoteSource } from './bonk-twitch-source.js';
import { arrangeBonkPickerGroups } from './bonk-picker-groups.js';
import { readStoredIds, writeStoredIds } from './stored-ids.js';
import { createBonkSend } from './bonk-send.js';
import { BONK_TUTORIAL, readTutorialDisabled, writeTutorialDisabled } from './tutorial-prefs.js';
import {
  BONK_TWITCH_ROLE_HINT,
  bonkTwemojiAssetPath,
  bonkTwitchLockedForRole,
  buildBonkEmoteIndex,
  buildBonkVisibleGroups,
  createTwitchBrandIcon,
  isBonkEmoteSelectable,
  normalizeBonkEmote,
  normalizeBonkFavoriteIds,
  preventBonkDoubleClick,
  toggleBonkFavoriteIds,
} from './bonk-model.js';

export function createBonkView({ document, client, host }) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const memory = host.memory;
  const emoteAccess = host.emotes;
  /** The session state of the current draw (the shot payload and the tour read it). */
  let currentState = null;
  /** The recents shown during this visit (a new shot is listed at the next visit, not under the pointer). */
  let recentsShown = null;
  let destroyed = false;
  memory.send ??= createBonkSend({
    refresh: () => host.refresh(),
    notice: (text, kind) => memory.chargeur?.notice(text, kind),
    errorText: (code) => errorLabel(code),
    notifyError: (error) => host.notifyError(error, { title: 'Bonk non envoyé' }),
    redraw: () => host.redraw(),
  });
  const send = memory.send;

  function draw(mod, body, state) {
    currentState = state;
    const interactions = host.interactions();
    const interactionsAvailable = interactions.available;
    const favoriteKey = 'raptoru-live:bonk-favorites';
    const recentKey = 'raptoru-live:bonk-recents';
    let favorites = readStoredIds(favoriteKey);
    let recents = readStoredIds(recentKey);

    // Bonk lot 5 : le catalogue charge le chargeur (bonk-chargeur.js), qui tire en Manuel (1 clic =
    // 1 Bonk) ou envoie la salve en Auto. UX validée : prototypes/bonk-salves-ux/serie7/final.html.

    let oauthControls = null;
    emoteAccess.ensure();
    const twitchStatus = emoteAccess.status();
    // Compte Twitch non lié : une source « Twitch » dans la colonne latérale (bonk-twitch-source.js) au
    // lieu d'un bandeau permanent ; sa fenêtre lance le vrai flow OAuth (beginEmoteAuthorization).
    let twitchSource = null;
    if (state?.emotes?.twitch_connected === false) {
      twitchSource = createTwitchEmoteSource({
        document,
        reauth: twitchStatus === 'reauth_required',
        open: memory.twitchLinkOpen,
        onOpen: () => {
          memory.twitchLinkOpen = true;
          host.redraw();
        },
      });
      if (memory.twitchLinkOpen) {
        const dialog = createTwitchEmoteDialog({
          document,
          reauth: twitchStatus === 'reauth_required',
          starting: emoteAccess.starting,
          onAuthorize: () => {
            memory.twitchLinkOpen = false;
            dialog.node.remove();
            emoteAccess.begin(body);
          },
          onClose: () => {
            memory.twitchLinkOpen = false;
            host.redraw();
            queueMicrotask(() => document.querySelector('.rl-twitch-src')?.focus({ preventScroll: true }));
          },
        });
        body.append(dialog.node);
        queueMicrotask(dialog.focus);
      }
    } else if (state?.emotes?.twitch_connected === true) {
      oauthControls = el('div', 'jdm-emote-oauth-controls');
      const refresh = createIconButton({
        icon: UI_ICONS.refresh,
        label: 'Actualiser les emotes Twitch',
        title: 'Actualiser les emotes Twitch',
        className: 'jdm-emote-oauth-button',
        iconClassName: 'jdm-emote-oauth-button__icon',
      });
      refresh.addEventListener('click', () => emoteAccess.load({ force: true }));
      const disconnect = createIconButton({
        icon: UI_ICONS.close,
        label: 'Retirer l’accès Twitch aux emotes',
        title: 'Retirer l’accès Twitch',
        className: 'jdm-emote-oauth-button',
        iconClassName: 'jdm-emote-oauth-button__icon',
      });
      disconnect.addEventListener('click', () => emoteAccess.disconnect(body));
      oauthControls.append(refresh, disconnect);
      // Placés dans la ligne de recherche du picker (voir plus bas), plus au-dessus de la grille.
    }
    // Twitch emotes state: a short line in the picker's search row (the module body hides its hints in
    // the video component), never an empty grid read as « no emotes ». The cached catalog stays usable
    // while it syncs and when Twitch is briefly unreachable; a needed reconnection opens its window.
    let twitchStatusNode = null;
    if (twitchStatus === 'syncing') {
      twitchStatusNode = el('span', 'rl-twitch-status', 'Synchronisation des emotes Twitch…');
      twitchStatusNode.setAttribute('role', 'status');
    } else if (twitchStatus === 'stale') {
      twitchStatusNode = el('span', 'rl-twitch-status', 'Emotes en cache · Twitch momentanément indisponible');
      twitchStatusNode.setAttribute('role', 'status');
    } else if (twitchStatus === 'reauth_required') {
      twitchStatusNode = el('button', 'rl-twitch-status rl-twitch-status--reauth', 'Reconnexion Twitch nécessaire');
      twitchStatusNode.type = 'button';
      twitchStatusNode.addEventListener('click', () => {
        memory.twitchLinkOpen = true;
        host.redraw();
      });
    }
    if (twitchStatusNode) {
      oauthControls ??= el('div', 'jdm-emote-oauth-controls');
      oauthControls.prepend(twitchStatusNode);
    }
    if (emoteAccess.loading && !emoteAccess.catalog) {
      body.append(el('p', 'jdm-hint', 'Chargement de tes emotes Twitch…'));
    } else if (emoteAccess.error) {
      body.append(el('p', 'jdm-hint', emoteAccess.error));
    }
    if (emoteAccess.catalog?.diagnostics) {
      const info = emoteAccess.catalog.diagnostics;
      const details = el('details', 'jdm-emote-diagnostics');
      details.append(el('summary', null, 'Diagnostic emotes'));
      details.append(el('pre', null, JSON.stringify(info, null, 2)));
      body.append(details);
    }

    const rawRealGroups = [
      ...(emoteAccess.catalog?.groups ?? mod.emote_catalog?.groups ?? []),
      ...UNICODE_EMOJI_GROUPS,
    ];
    const { realGroups, emoteById } = buildBonkEmoteIndex(rawRealGroups);

    const normalizedFavorites = normalizeBonkFavoriteIds(favorites, emoteById.keys());
    if (normalizedFavorites.length !== favorites.length
      || normalizedFavorites.some((id, index) => id !== favorites[index])) {
      writeStoredIds(favoriteKey, normalizedFavorites);
    }
    favorites = normalizedFavorites;
    recents = recents.filter((id) => emoteById.has(id));
    if (recents.length !== readStoredIds(recentKey).length) writeStoredIds(recentKey, recents);

    recentsShown ??= recents;
    const shownRecents = recentsShown.filter((id) => emoteById.has(id));
    const getGroups = () => buildBonkVisibleGroups(realGroups, {
      favoriteIds: favorites,
      recentIds: shownRecents,
    });
    const groupEmotes = (group) => {
      if (group.id === 'favorites') return favorites.map((id) => emoteById.get(id)).filter(Boolean);
      if (group.id === 'recents') return shownRecents.map((id) => emoteById.get(id)).filter(Boolean);
      return group.emotes.map((item) => normalizeBonkEmote(group, item));
    };

    // Adaptateur vers le picker générique : grille statique (static_url), animation au survol
    // ou à la sélection via image_url. Twemoji reste la couche visuelle des emotes Unicode.
    const demoMode = state?.demo_mode === true;
    const twitchLocked = bonkTwitchLockedForRole(state);
    const pickerItem = (emote) => {
      const twemoji = bonkTwemojiAssetPath(emote);
      const roleLocked = twitchLocked && emote.source === 'twitch';
      return {
        id: emote.id,
        label: emote.label,
        ...(roleLocked ? { hint: `${emote.label} · ${BONK_TWITCH_ROLE_HINT}` } : {}),
        // image_url est l'URL animée quand l'emote l'est : animée directement dans la grille.
        src: twemoji ?? emote.image_url ?? null,
        animated: emote.animated === true,
        glyph: emote.mark ?? emote.glyph,
        disabled: !isBonkEmoteSelectable(emote, { demoMode, twitchLocked }),
      };
    };
    // Familles (Récents, Favoris, Twitch, Bits, Extension, Emoji) : voir bonk-picker-groups.js.
    const PROVIDER_KEYWORDS = {
      bits: ['bits'],
      '7tv': ['7tv', 'seventv'],
      bttv: ['bttv', 'betterttv'],
      ffz: ['ffz', 'frankerfacez'],
    };
    const pickerGroups = () => {
      const arranged = arrangeBonkPickerGroups(getGroups(), groupEmotes);
      // Avatar Twitch d'une chaîne (s'il est connu) réutilisé pour son contexte Extension.
      const avatars = new Map();
      for (const { group } of arranged) {
        if (group?.source !== 'twitch') continue;
        const avatar = providerPresentation(group).avatarUrl;
        if (avatar) avatars.set(String(group.channel_display_name ?? group.label).toLowerCase(), avatar);
      }
      return arranged.map((entry) => {
        const { group, family } = entry;
        const provider = group ? providerPresentation(group) : null;
        const isExtension = family?.id === 'extension';
        const label = entry.label ?? (group.id === 'twitch-global'
          ? 'Twitch'
          : String(group.label || provider.label || 'Emoji'));
        const globalContext = isExtension && entry.scope === 'global';
        const parts = entry.parts?.map((part) => ({
          id: part.id,
          label: part.label,
          iconSrc: part.iconSrc,
          keywords: PROVIDER_KEYWORDS[part.provider] ?? [],
          emotes: part.emotes.map(pickerItem),
        }));
        return {
          id: entry.id,
          label,
          keywords: [
            group?.channel_login,
            group?.channel_display_name,
            ...(PROVIDER_KEYWORDS[family?.id] ?? []),
            ...(isExtension ? ['extension'] : []),
          ].filter(Boolean),
          matchLabel: family?.id !== 'emoji',
          icon: isExtension || provider?.icon === 'twitch' ? label.slice(0, 1).toUpperCase() : provider?.icon ?? '•',
          iconSrc: entry.iconSrc ?? (globalContext ? 'assets/twemoji/svg/1f310.svg' : null),
          iconNode: group?.id === 'twitch-global' ? createTwitchBrandIcon() : null,
          avatarUrl: isExtension
            ? (globalContext ? null : avatars.get(label.toLowerCase()) ?? null)
            : provider?.avatarUrl ?? null,
          family: family
            ? { ...family, iconNode: family.id === 'twitch' ? createTwitchBrandIcon() : null }
            : null,
          virtual: group?.source === 'virtual',
          // Ordre personnel : glisser-déposer (souris) dans la section Favoris uniquement.
          reorderable: entry.id === 'favorites',
          ...(parts ? { parts } : {}),
          emotes: parts ? parts.flatMap((part) => part.emotes) : entry.emotes.map(pickerItem),
        };
      });
    };

    // Instance unique : le rendu global (polling) la déplace sans reconstruire ses cellules.
    memory.picker ??= createEmotePicker({
      label: 'Emotes Bonk',
      railKey: 'raptoru-live:bonk-rail-open',
    });
    const emotePicker = memory.picker;
    const picker = el('div', 'jdm-bonk-picker rl-bonk-picker');
    const bonkFeedback = createFeedbackSlot({
      className: 'jdm-bonk-feedback',
      label: 'Retour du Bonk',
    });
    const chargeur = chargeurView();
    const restricted = Boolean(host.restriction());
    // Core's price and salve bounds (module): the chargeur never decides them.
    chargeur.configure({
      cost: mod.token_cost,
      volley: mod.volley ?? null,
      ready: interactionsAvailable && !restricted,
      reason: restricted
        ? 'Bonk indisponible pour toi pour le moment'
        : 'Interactions indisponibles pour le moment',
    });

    const toggleFavorite = (emoteId) => {
      const id = String(emoteId ?? '');
      if (!emoteById.has(id)) return false;
      favorites = toggleBonkFavoriteIds(favorites, id, emoteById.keys());
      writeStoredIds(favoriteKey, favorites);
      emotePicker.setData(pickerGroups());
      syncSelection();
      return true;
    };

    emotePicker.setHandlers({
      onSelect: (id) => {
        const emote = emoteById.get(id);
        if (!emote || !isBonkEmoteSelectable(emote, { demoMode, twitchLocked })) return;
        memory.selectedId = emote.id;
        // One catalogue click = one munition; the emote flies from its cell (read before re-render).
        const cell = emotePicker.scroller.querySelector(`[data-id="${CSS.escape(emote.id)}"]`);
        chargeur.add(emote, cell);
        recents = [emote.id, ...recents.filter((item) => item !== emote.id)].slice(0, 36);
        writeStoredIds(recentKey, recents);
        emotePicker.setData(pickerGroups());
      },
      onFavorite: (id) => toggleFavorite(id),
      onReorder: (ids) => {
        // Même ensemble, nouvel ordre : aucune emote ne peut être ajoutée ou perdue ici.
        const next = normalizeBonkFavoriteIds(ids, emoteById.keys());
        if (next.length !== favorites.length || next.some((id) => !favorites.includes(id))) return;
        favorites = next;
        writeStoredIds(favoriteKey, favorites);
        emotePicker.setData(pickerGroups());
        syncSelection();
      },
    });

    // The chargeur shows the selection: no redundant selection state in the catalogue (validated UX).
    function syncSelection() {
      emotePicker.setState({ selected: [], favorites, queue: new Map(), next: null });
    }

    picker.append(emotePicker.nav, emotePicker.searchRow, emotePicker.scroller, bonkFeedback, chargeur.node);
    body.append(picker);
    if (!interactionsAvailable && !state?.lab_mode) {
      body.append(el('p', 'jdm-hint', interactions.identityShared
        ? 'Interactions temporairement indisponibles : SAMMI se reconnecte. Aucun jeton ne sera consommé.'
        : 'Partage ton identité Twitch pour utiliser les interactions. Aucun jeton ne sera consommé.'));
    }
    emotePicker.setExtras(oauthControls);
    emotePicker.setLead(twitchSource);
    emotePicker.setData(pickerGroups());
    emotePicker.attached();
    chargeur.attached();
    syncSelection();
    send.mount(bonkFeedback);
    // Tutoriel Bonk : ouvert une fois par chargement en arrivant sur Bonk (sauf « Ne plus afficher »).
    if (!memory.tourAutoOpened) {
      memory.tourAutoOpened = true;
      if (!readTutorialDisabled(BONK_TUTORIAL)) {
        setTimeout(() => {
          // The visit open now (this one, or the next if the viewer left and came back meanwhile).
          if (memory.visitOpen?.()) tourView().start();
        }, 400);
      }
    }
  }

  /** Bonk lot 5: the payload of one shot, or null (feedback shown) when this emote cannot be fired. */
  function shotPayload(emote) {
    const twitchLocked = bonkTwitchLockedForRole(currentState);
    if (!isBonkEmoteSelectable(emote, { demoMode: currentState?.demo_mode === true, twitchLocked })) {
      send.refuse(twitchLocked && emote.source === 'twitch'
        ? `${BONK_TWITCH_ROLE_HINT}.`
        : 'Connecte tes emotes Twitch pour utiliser celle-ci.');
      return null;
    }
    // Le Bonk vise la caméra du streamer, pas un autre spectateur.
    return {
      target_login: 'streamer',
      emotes: [emote.id],
      emote_source: emote.source,
      emote_glyph: emote.glyph ?? null,
    };
  }

  /** Emote face inside the chargeur (same sources as the picker: Twemoji, CDN image, mark, glyph). */
  function chargeurEmote(emote) {
    const src = bonkTwemojiAssetPath(emote) ?? emote.image_url;
    if (src) {
      const image = el('img', 'bkc-am__img');
      image.src = src;
      image.alt = '';
      image.draggable = false;
      return image;
    }
    if (emote.mark) {
      const mark = el('span', 'bkc-am__mark', emote.mark);
      mark.dataset.tone = emote.tone ?? 'violet';
      return mark;
    }
    return el('span', 'bkc-am__glyph', emote.glyph ?? '◌');
  }

  /**
   * The chargeur, created once. Manuel: each click = one individual Bonk (unchanged Core admission).
   * Auto: one click = the remaining munitions as one salve, admitted and paid atomically by Core.
   */
  function chargeurView() {
    // Created once per panel (memory: the speed and the composition outlive a visit); its callbacks go through
    // memory.handlers, which the open view sets — never a destroyed view's closure.
    if (!memory.chargeur) {
      memory.chargeur = createBonkChargeur({
        document,
        renderEmote: (emote) => memory.handlers.renderEmote(emote),
        newKey: newIdempotencyKey,
        onHelp: () => memory.handlers.help(),
        onFire: (emote) => memory.handlers.fire(emote),
        onSalve: (emotes, cadenceMs, key) => memory.handlers.salve(emotes, cadenceMs, key),
      });
      // Twitch interprète un double-clic rapide comme un plein écran : neutralisé sur tout le chargeur.
      memory.chargeur.node.ondblclick = preventBonkDoubleClick;
    }
    return memory.chargeur;
  }
  /** Manuel: each click = one individual Bonk (unchanged Core admission). Auto: the remaining munitions as one salve. */
  const fire = (emote) => {
    const payload = shotPayload(emote);
    if (!payload) return Promise.resolve(false);
    // Each click is its own Bonk; the click after a lost answer for the same emote re-sends that one (never paid twice).
    const keys = (memory.bonkKeys ??= createRetryKeys());
    return send.send(() => withRetryKey(keys, payload.emotes.join(','), (key) => client.spendTokens('bonk', payload, key)));
  };
  const salve = (emotes, cadenceMs, key) => {
    const shots = [];
    for (const emote of emotes) {
      const payload = shotPayload(emote);
      if (!payload) return Promise.resolve(false);
      shots.push({
        emote_source: payload.emote_source,
        emote: payload.emotes[0],
        emote_glyph: payload.emote_glyph,
      });
    }
    return send.send(() => client.spendBonkSalve(key, {
      target_login: 'streamer',
      shots,
      cadence_ms: cadenceMs,
    }));
  };

  // Tutoriel Bonk : une info par bulle, la zone concernée mise en avant (bonk-tour.js).
  function tourView() {
    memory.tour ??= createBonkTour({
      document,
      steps: () => memory.handlers.tourSteps(),
      isDisabled: () => readTutorialDisabled(BONK_TUTORIAL),
      setDisabled: (disabled) => writeTutorialDisabled(BONK_TUTORIAL, disabled),
      // Pendant le tutoriel, le chargeur reste déplié, même vide : les bulles montrent ses vrais contrôles.
      onOpenChange: (open) => memory.chargeur?.showcase(open),
    });
    return memory.tour;
  }
  function tourSteps() {
    const find = (selector) => () => document.querySelector(selector);
    const twitchSource = document.querySelector('.rl-twitch-src');
    const connected = currentState?.emotes?.twitch_connected === true;
    return [
      {
        icon: '💥',
        title: 'Bienvenue dans Bonk !',
        body: 'Envoie tes emotes préférées droit au visage du streamer. On te montre comment en quelques bulles.',
      },
      {
        icon: '🔗',
        title: 'Tes emotes Twitch',
        body: connected
          ? 'Ton compte Twitch est connecté : tes emotes sont déjà dans le catalogue.'
          : 'Connecte ton compte Twitch pour récupérer tes emotes et débloquer un catalogue plus étoffé. C’est ici, dans la colonne de gauche.',
        // Le bouton Twitch de la colonne de gauche ; à défaut (pas encore proposé), la colonne elle-même.
        target: find(connected
          ? '.jdm-emote-oauth-controls'
          : twitchSource ? '.rl-twitch-src' : '.jdm-module[data-module="bonk"] .rl-picker__nav'),
        action: twitchSource
          ? { label: 'Connecter mon compte Twitch', run: () => document.querySelector('.rl-twitch-src')?.click() }
          : undefined,
      },
      {
        icon: '🎯',
        title: 'Remplis ton chargeur',
        body: 'Clique sur les emotes du catalogue : elles s’ajoutent dans ton chargeur, juste ici.',
        target: find('.bkc-dock'),
      },
      {
        icon: '✋',
        title: 'Gère tes munitions',
        body: [
          '**Clic gauche** sur une emote pour en retirer **une unité**.',
          '**Clic droit** pour retirer **toute l’emote** de la file.',
        ],
        target: find('.bkc-dock'),
      },
      {
        icon: '👆',
        title: 'Mode Manuel',
        body: '1 clic = 1 emote envoyée. Chargeur vide ? « ↻ Recharger » remet ta composition pour la rejouer.',
        target: find('.bkc-right'),
      },
      {
        icon: '⚡',
        title: 'Mode Auto',
        body: [
          '1 clic envoie d’un coup toute la salve qui reste dans tes munitions.',
          'L’éclair règle la vitesse : 4 niveaux, de Lent à Très rapide.',
        ],
        target: find('.bkc-right'),
      },
      {
        icon: '🎉',
        title: 'Amuse-toi bien !',
        body: 'Tu peux revoir ce tutoriel à tout moment avec le bouton « ? » à côté de Bonk.',
      },
    ];
  }

  memory.handlers = { renderEmote: chargeurEmote, help: () => tourView().start(), fire, salve, tourSteps };
  memory.visitOpen = () => !destroyed;

  return {
    node: null,
    /** The « ? » next to the title: the tour. */
    headAfter: () => chargeurView().helpButton,
    draw,
    destroy() {
      destroyed = true;
      memory.chargeur?.reset();
      // The last outcome belongs to this visit (as the Soundboard's feedback): never shown again on return.
      send.clear();
      if (memory.tour?.open) memory.tour.close();
    },
  };
}

// Module variant (module-registry.js): the Bonk screen.
registerModuleVariant({
  id: 'bonk',
  match: () => true,
  intro: false,
  headClass: 'jdm-module__screen-head--bonk',
  walletClass: 'jdm-wallet--bonk-header',
  view: (ctx) => createBonkView(ctx),
  headAfter: (view) => view.headAfter(),
  rendered: (view, { module, body, state }) => view.draw(module, body, state),
});
