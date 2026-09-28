// Primitives visuelles partagees par les vues Viewer. Ce module ne contient
// aucune regle metier : il normalise uniquement l'affichage et les etats UI.

export const UI_ICONS = Object.freeze({
  search: '⌕',
  close: '×',
  back: '←',
  refresh: '↻',
  favorite: '☆',
  favoriteActive: '★',
  history: '◷',
  help: '?',
  tokens: '◆',
  credits: '✦',
});

function createSwapCycleIcon(documentRef) {
  const createNode = typeof documentRef.createElementNS === 'function'
    ? (tag) => documentRef.createElementNS('http://www.w3.org/2000/svg', tag)
    : (tag) => documentRef.createElement(tag);
  const svg = createNode('svg');
  svg.classList?.add('jdm-multi-payment__switch-icon');
  svg.setAttribute('viewBox', '0 0 24 18');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const upper = createNode('path');
  upper.setAttribute('d', 'M9 4.5A4.5 4.5 0 1 0 9 13.5');
  upper.setAttribute('fill', 'none');
  upper.setAttribute('stroke', 'currentColor');
  upper.setAttribute('stroke-linecap', 'round');
  upper.setAttribute('stroke-linejoin', 'round');
  upper.setAttribute('stroke-width', '2');

  const lower = createNode('path');
  lower.setAttribute('d', 'M19 13.5A4.5 4.5 0 1 0 19 4.5');
  lower.setAttribute('fill', 'none');
  lower.setAttribute('stroke', 'currentColor');
  lower.setAttribute('stroke-linecap', 'round');
  lower.setAttribute('stroke-linejoin', 'round');
  lower.setAttribute('stroke-width', '2');

  const upperHead = createNode('path');
  upperHead.setAttribute('d', 'M9 4.5 5.8 6.8 9 7.2Z');
  upperHead.setAttribute('fill', 'currentColor');

  const lowerHead = createNode('path');
  lowerHead.setAttribute('d', 'M19 13.5 22.2 11.2 19 10.8Z');
  lowerHead.setAttribute('fill', 'currentColor');

  svg.append(upper, upperHead, lower, lowerHead);
  return svg;
}

const PROVIDER_PRESENTATIONS = Object.freeze({
  // Le rendu global utilise une primitive SVG locale dans le rail ; cette
  // valeur est seulement le fallback textuel accessible, jamais une lettre
  // affichée comme marque principale.
  twitch: Object.freeze({ key: 'twitch', icon: 'twitch' }),
  '7tv': Object.freeze({
    key: '7tv',
    icon: '7TV',
    label: '7TV',
    asset: 'assets/bonk/providers/7tv.svg',
  }),
  bttv: Object.freeze({
    key: 'bttv',
    icon: 'BTTV',
    label: 'BetterTTV',
    asset: 'assets/bonk/providers/bttv.svg',
  }),
  ffz: Object.freeze({
    key: 'ffz',
    icon: 'FFZ',
    label: 'FrankerFaceZ',
    asset: 'assets/bonk/providers/ffz.svg',
  }),
  unicode: Object.freeze({ key: 'unicode', icon: '😀', label: 'Unicode' }),
  favorites: Object.freeze({ key: 'favorites', icon: '⭐', label: 'Favoris' }),
  recents: Object.freeze({ key: 'recents', icon: '🕘', label: 'Récents' }),
});

// Le rail Bonk garde un repère couleur par famille sans toucher aux IDs ni
// aux données d’emotes. Les labels restent portés par le bouton pour que
// l’icône seule puisse rester compacte et accessible via tooltip/ARIA.
const BONK_GROUP_PRESENTATIONS = Object.freeze({
  'unicode-smileys-emotion': Object.freeze({ icon: '😀', label: 'Visages' }),
  'unicode-people-body': Object.freeze({ icon: '🧑', label: 'Personnes' }),
  'unicode-animals-nature': Object.freeze({ icon: '🌿', label: 'Nature' }),
  'unicode-food-drink': Object.freeze({ icon: '🍔', label: 'Cuisine' }),
  'unicode-travel-places': Object.freeze({ icon: '✈️', label: 'Voyages' }),
  'unicode-activities': Object.freeze({ icon: '⚽', label: 'Activités' }),
  'unicode-objects': Object.freeze({ icon: '💡', label: 'Objets' }),
  'unicode-symbols': Object.freeze({ icon: '❤️', label: 'Symboles' }),
  'unicode-flags': Object.freeze({ icon: '🏳️', label: 'Drapeaux' }),
});

function bonkGroupPresentation(group, source, id) {
  const direct = BONK_GROUP_PRESENTATIONS[id];
  if (direct) return direct;

  const label = String(group.label || '').toLocaleLowerCase('fr');
  if (source === 'unicode') {
    if (label.includes('visage')) return BONK_GROUP_PRESENTATIONS['unicode-smileys-emotion'];
    if (label.includes('person')) return BONK_GROUP_PRESENTATIONS['unicode-people-body'];
    if (label.includes('nature')) return BONK_GROUP_PRESENTATIONS['unicode-animals-nature'];
    if (label.includes('cuisine') || label.includes('aliment')) return BONK_GROUP_PRESENTATIONS['unicode-food-drink'];
    if (label.includes('voyage') || label.includes('lieu')) return BONK_GROUP_PRESENTATIONS['unicode-travel-places'];
    if (label.includes('activité')) return BONK_GROUP_PRESENTATIONS['unicode-activities'];
    if (label.includes('objet')) return BONK_GROUP_PRESENTATIONS['unicode-objects'];
    if (label.includes('symbole')) return BONK_GROUP_PRESENTATIONS['unicode-symbols'];
    if (label.includes('drapeau')) return BONK_GROUP_PRESENTATIONS['unicode-flags'];
  }
  return null;
}

function compactDecimal(value) {
  return String(Number(value.toFixed(1)));
}

/**
 * Format compact uniquement pour les soldes affichés dans le wallet.
 * Les coûts et les historiques continuent d'utiliser le formateur métier/UI
 * existant afin de ne pas modifier la lecture des autres écrans.
 */
export function formatWalletValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const amount = Math.max(0, Math.trunc(numeric));
  if (amount < 1_000) return amount.toLocaleString('fr-FR');

  if (amount < 1_000_000) {
    const scaled = Math.min(999, Math.round(amount / 100) / 10);
    return `${compactDecimal(scaled)}K`;
  }

  const scaled = Math.round(amount / 100_000) / 10;
  return `${compactDecimal(scaled)}M`;
}

/**
 * Format exact utilisé uniquement par les informations accessibles et le
 * survol du wallet. Il ne remplace jamais la valeur métier ni le format
 * compact visible au repos.
 */
export function formatWalletExactValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return Math.max(0, Math.trunc(numeric))
    .toLocaleString('fr-FR')
    .replace(/[\u00a0\u202f]/gu, ' ');
}

export function createDisclosureSearchState({ open = false, query = '' } = {}) {
  return { open: Boolean(open), query: String(query ?? '') };
}

export function updateDisclosureSearchState(
  state = {},
  { open, query, resetOnClose = true } = {},
) {
  const next = createDisclosureSearchState(state);
  if (open !== undefined) next.open = Boolean(open);
  if (query !== undefined) next.query = String(query ?? '');
  if (!next.open && resetOnClose !== false) next.query = '';
  return next;
}

export function closeDisclosureSearch(state = {}, { reset = true } = {}) {
  return updateDisclosureSearchState(state, { open: false, resetOnClose: reset });
}

export function normalizeSearchQuery(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function providerKey(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.replace(/[^a-z0-9_-]/g, '') || 'unicode';
}

function localAvatarAssetPath(value) {
  const path = String(value ?? '').trim().replaceAll('\\', '/');
  // Les fixtures Studio peuvent déclarer un asset local explicite. Toute
  // autre valeur relative reste ignorée afin que le viewer ne fabrique jamais
  // un fetch d'avatar à partir d'un champ ambigu de l'API.
  return /^assets\/bonk\/[a-z0-9/_-]+\.svg$/iu.test(path) ? path : '';
}

function providerAvatarUrl(group = {}) {
  const nested = [
    group.channel,
    group.broadcaster,
    group.owner,
    group.user,
    group.channel_info,
    group.broadcaster_info,
  ]
    .filter((value) => value && typeof value === 'object');
  const records = [group, ...nested];
  for (const record of records) {
    for (const key of ['channel_avatar_asset', 'avatar_asset', 'local_avatar_asset']) {
      const asset = localAvatarAssetPath(record?.[key]);
      if (asset) return asset;
    }
    for (const key of [
      'channel_avatar_url', 'avatar_url', 'profile_image_url', 'profile_image', 'profileImageUrl', 'avatar',
    ]) {
      const value = record?.[key];
      if (typeof value !== 'string' || !value.trim()) continue;
      try {
        // Profile images are displayed only when the API already provided a
        // complete URL. Do not resolve arbitrary relative strings into a
        // synthetic asset path.
        const url = new URL(value.trim());
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
      } catch {
        // Keep the textual channel fallback for invalid profile URLs.
      }
    }
  }
  return '';
}

export function providerPresentation(group = {}) {
  const source = String(group.source ?? '').trim().toLowerCase();
  const id = String(group.id ?? '').trim().toLowerCase();
  const known = PROVIDER_PRESENTATIONS[source]
    || PROVIDER_PRESENTATIONS[id]
    || null;

  const semantic = bonkGroupPresentation(group, source, id);
  if (semantic) {
    return {
      key: source === 'twitch' ? 'twitch' : 'unicode',
      source: source || 'virtual',
      icon: semantic.icon,
      label: semantic.label,
    };
  }

  if (source === 'twitch') {
    const label = id === 'twitch-global'
      ? 'Twitch'
      : String(group.channel_display_name || group.display_name || group.label || 'User/Sub');
    const avatarUrl = providerAvatarUrl(group);
    return {
      key: 'twitch',
      source,
      icon: String(group.icon || (id === 'twitch-global'
        ? PROVIDER_PRESENTATIONS.twitch.icon
        : label.trim().slice(0, 1).toUpperCase() || PROVIDER_PRESENTATIONS.twitch.icon)),
      label,
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }
  if (known) {
    return {
      ...known,
      source: source || 'virtual',
      icon: source === 'unicode' ? String(group.icon || known.icon) : known.icon,
      label: source === 'unicode' ? String(group.label || known.label || 'Emoji') : (known.label || String(group.label || 'Emoji')),
    };
  }

  const label = String(group.label || 'Emoji');
  return {
    key: providerKey(source || 'unicode'),
    source: source || 'unicode',
    icon: String(group.icon || label.slice(0, 1) || '☺'),
    label,
  };
}

function requireDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('ui_document_required');
  }
  return documentRef;
}

export function createIconButton({
  document: documentRef = globalThis.document,
  icon = '',
  label = '',
  title = label,
  className = '',
  iconClassName = '',
  visibleLabel = '',
} = {}) {
  const document = requireDocument(documentRef);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ['jdm-icon-button', className].filter(Boolean).join(' ');
  if (label) button.setAttribute('aria-label', label);
  if (title) button.title = title;

  const iconNode = document.createElement('span');
  iconNode.className = ['jdm-icon-button__icon', iconClassName].filter(Boolean).join(' ');
  iconNode.dataset.icon = 'true';
  iconNode.setAttribute('aria-hidden', 'true');
  iconNode.textContent = String(icon);
  button.append(iconNode);

  if (visibleLabel) {
    const labelNode = document.createElement('span');
    labelNode.className = 'jdm-icon-button__label';
    labelNode.textContent = String(visibleLabel);
    button.append(labelNode);
  }
  return button;
}

export function updateIconButton(button, { icon, label, title } = {}) {
  if (!button) return button;
  if (icon !== undefined) {
    const iconNode = button.querySelector?.('[data-icon="true"]');
    if (iconNode) iconNode.textContent = String(icon);
  }
  if (label !== undefined) button.setAttribute('aria-label', String(label));
  if (title !== undefined) button.title = String(title);
  return button;
}

export function createWalletFace({
  document: documentRef = globalThis.document,
  currency = 'tokens',
  value = 0,
  unavailable = false,
  hold = 0,
} = {}) {
  const document = requireDocument(documentRef);
  const normalizedCurrency = currency === 'credits' ? 'credits' : 'tokens';
  const face = document.createElement('span');
  face.className = `jdm-wallet__face jdm-wallet__face--${normalizedCurrency}`;
  face.dataset.walletFace = normalizedCurrency;
  face.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('span');
  icon.className = 'jdm-wallet__coin';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = normalizedCurrency === 'credits' ? UI_ICONS.credits : UI_ICONS.tokens;

  const label = document.createElement('span');
  label.className = 'jdm-wallet__label';
  label.textContent = normalizedCurrency === 'credits' ? 'Crédits' : 'Jetons';

  const amount = document.createElement('strong');
  amount.className = 'jdm-wallet__value';
  amount.textContent = unavailable ? '—' : formatWalletValue(value);

  const exact = document.createElement('span');
  exact.className = 'jdm-wallet__exact';
  const exactValue = unavailable ? '—' : formatWalletExactValue(value);
  exact.dataset.exactValue = exactValue;
  exact.dataset.exactLength = String(exactValue.replace(/\s+/gu, '').length);
  exact.setAttribute('aria-hidden', 'true');
  // Le libellé de devise reste dans la face compacte et l’aria-label du
  // wallet ; le mode hover doit réserver toute la surface au nombre exact.
  exact.textContent = exactValue;

  face.append(icon, label, amount, exact);
  if (normalizedCurrency === 'tokens' && Number(hold) > 0) {
    const holdNode = document.createElement('span');
    holdNode.className = 'jdm-wallet__hold';
    holdNode.textContent = `${formatWalletValue(hold)} en cours`;
    face.append(holdNode);
  }
  return face;
}

const PAYMENT_METHOD_PRESENTATIONS = Object.freeze({
  tokens: Object.freeze({ label: 'Jetons', icon: UI_ICONS.tokens }),
  credits: Object.freeze({ label: 'Crédits', icon: UI_ICONS.credits }),
});

function normalizePaymentMethods(methods) {
  const source = Array.isArray(methods) ? methods : ['tokens', 'credits'];
  const normalized = [];
  for (const method of source) {
    const value = method === 'credits' ? 'credits' : method === 'tokens' ? 'tokens' : null;
    if (value && !normalized.includes(value)) normalized.push(value);
  }
  return normalized.length ? normalized : ['tokens'];
}

const CURRENCY_SWITCH_LABELS = Object.freeze({ tokens: 'Jetons', credits: 'Crédits' });
const CURRENCY_SWITCH_UNITS = Object.freeze({
  tokens: () => 'jetons',
  credits: (amount) => `crédit${amount > 1 ? 's' : ''}`,
});
let currencySwitchSequence = 0;

/**
 * Solde compact pour une case de largeur fixe : jusqu'à 999 tel quel, puis K / M avec une
 * décimale sous 10 (1,2K · 12K · 985K · 1,2M). Tronqué : jamais surestimé.
 */
export function formatCompactBalance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const amount = Math.max(0, Math.trunc(numeric));
  if (amount < 1_000) return String(amount);
  const [divisor, unit] = amount < 1_000_000 ? [1_000, 'K'] : [1_000_000, 'M'];
  const scaled = amount / divisor;
  if (scaled < 10) {
    const truncated = Math.floor(scaled * 10) / 10;
    return `${Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(1).replace('.', ',')}${unit}`;
  }
  return `${Math.floor(scaled)}${unit}`;
}

/**
 * Switch de monnaie Jetons / Crédits « Peek slide » (classes rl-cswitch, currency-switch.css).
 * Une pill à largeur fixe posée dans une zone sombre : la pièce active s'écarte au survol et
 * laisse apparaître l'autre, le clic termine le mouvement ; le montant reste immobile dans sa
 * case (fondu seul). Infobulle du solde exact au survol / focus clavier, fermée au clic, absente
 * au tactile. Purement visuel : onChange(nouvelle, précédente) ; aucune règle métier.
 */
export function createCurrencySwitch({
  document: documentRef = globalThis.document,
  variant = 'label',
  className = '',
  ariaLabel = 'Monnaie de paiement',
  tipPlacement = 'below',
  onChange = null,
} = {}) {
  const document = requireDocument(documentRef);
  const mode = variant === 'balance' ? 'balance' : 'label';
  const make = (tag, cls) => {
    const node = document.createElement(tag);
    node.className = cls;
    return node;
  };
  const root = make('span', ['rl-cswitch', `rl-cswitch--${mode}`,
    tipPlacement === 'above' ? 'rl-cswitch--tip-above' : '', className].filter(Boolean).join(' '));
  const chip = make('button', 'rl-cswitch__chip');
  chip.type = 'button';
  const stage = make('span', 'rl-cswitch__stage');
  stage.setAttribute('aria-hidden', 'true');
  const box = make('span', 'rl-cswitch__val');
  box.setAttribute('aria-hidden', 'true');
  const texts = {};
  for (const method of ['tokens', 'credits']) {
    const coin = make('i', 'rl-cswitch__coin');
    coin.dataset.coin = method;
    stage.append(coin);
    texts[method] = make('span', 'rl-cswitch__v');
    texts[method].dataset.v = method;
    box.append(texts[method]);
  }
  chip.append(stage, box);
  const tip = make('span', 'rl-cswitch__tip');
  tip.id = `rl-cswitch-tip-${++currencySwitchSequence}`;
  tip.setAttribute('role', 'tooltip');
  chip.setAttribute('aria-describedby', tip.id);
  root.append(chip, tip);

  let current = null;
  let available = ['tokens', 'credits'];
  let locked = false;
  const toggle = () => {
    const next = available.find((method) => method !== current);
    if (!locked && next) onChange?.(next, current);
  };
  // Infobulle : un clic / appui / Entrée la ferme tout de suite ; elle ne revient qu'au
  // prochain survol. Un appui tactile ne la laisse jamais ouverte.
  let lastPointer = 'mouse';
  const closeTip = () => root.classList.add('tip-off');
  chip.addEventListener('pointerdown', (event) => {
    lastPointer = event.pointerType || 'mouse';
    closeTip();
  });
  root.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch') root.classList.remove('tip-off');
  });
  root.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse' && lastPointer === 'touch') {
      lastPointer = 'mouse';
      root.classList.remove('tip-off');
    }
  });
  chip.addEventListener('blur', () => {
    if (lastPointer !== 'touch') root.classList.remove('tip-off');
  });
  chip.addEventListener('click', (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    toggle();
  });
  chip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') closeTip();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault?.();
      closeTip();
      toggle();
    }
  });

  const exact = (amount) => Math.max(0, Math.trunc(Number(amount))).toLocaleString('fr-FR');
  const known = (amount) => amount !== null && amount !== undefined && Number.isFinite(Number(amount));
  const tipLine = (method, amounts, className) => {
    const line = make('span', className);
    const dot = make('i', 'rl-cswitch__dot');
    dot.dataset.coin = method;
    const amount = amounts[method];
    if (known(amount)) {
      const value = make('b', '');
      value.textContent = exact(amount);
      line.append(dot, value, ` ${CURRENCY_SWITCH_UNITS[method](Number(amount))}`);
    } else {
      line.append(dot, `${CURRENCY_SWITCH_LABELS[method]} : solde indisponible`);
    }
    return line;
  };

  const sync = ({
    method = 'tokens',
    methods = ['tokens', 'credits'],
    amounts = {},
    details = {},
    disabled = false,
  } = {}) => {
    available = normalizePaymentMethods(methods);
    const active = available.includes(method) ? method : available[0];
    const other = available.find((candidate) => candidate !== active) ?? null;
    current = active;
    locked = !other || Boolean(disabled);
    root.dataset.method = active;
    chip.dataset.m = active;
    root.classList.toggle('is-locked', locked);
    chip.setAttribute('aria-disabled', String(locked));
    for (const candidate of ['tokens', 'credits']) {
      texts[candidate].textContent = mode === 'balance'
        ? (known(amounts[candidate]) ? formatCompactBalance(amounts[candidate]) : '—')
        : CURRENCY_SWITCH_LABELS[candidate];
    }
    const hasAmounts = known(amounts.tokens) || known(amounts.credits);
    tip.hidden = !hasAmounts;
    tip.replaceChildren();
    if (hasAmounts) {
      tip.append(tipLine(active, amounts, 'rl-cswitch__tip-main'));
      if (other) tip.append(tipLine(other, amounts, 'rl-cswitch__tip-other'));
      if (details[active]) {
        const note = make('span', 'rl-cswitch__tip-other');
        note.textContent = String(details[active]);
        tip.append(note);
      }
    }
    const balance = known(amounts[active])
      ? ` · ${exact(amounts[active])} ${CURRENCY_SWITCH_UNITS[active](Number(amounts[active]))}`
      : '';
    chip.setAttribute('aria-label', `${ariaLabel} : ${CURRENCY_SWITCH_LABELS[active]}${balance}${
      locked ? '' : `. Changer pour ${CURRENCY_SWITCH_LABELS[other]}`}`);
    return active;
  };
  sync();
  return { node: root, root, chip, sync };
}

/**
 * Primitive purement visuelle pour une action payable. Elle ne connaît aucun
 * contrat réseau : l'intégration fournit la méthode, le coût, la disponibilité
 * et les callbacks métier, puis resynchronise l'affichage après chaque rendu.
 */
export function createMultiCurrencyPayment({
  document: documentRef = globalThis.document,
  className = '',
  rowClassName = '',
  ctaClassName = '',
  switchClassName = '',
  hintClassName = '',
  actionLabel = 'Action',
  compact = false,
  enableMethodSwitch = false,
  integratedMethodSwitch = false,
  switchIcon = '',
  modern = false,
  onAction = null,
  onMethodChange = null,
} = {}) {
  const document = requireDocument(documentRef);
  if (modern) {
    return createModernPayment({ document, className, actionLabel, enableMethodSwitch, onAction, onMethodChange });
  }
  const root = document.createElement('div');
  root.className = [
    'jdm-multi-payment',
    'jdm-multi-payment--action',
    compact ? 'jdm-multi-payment--compact' : '',
    integratedMethodSwitch ? 'jdm-multi-payment--integrated-switch' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const row = document.createElement('div');
  row.className = ['jdm-multi-payment__row', rowClassName].filter(Boolean).join(' ');

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = ['jdm-btn', 'jdm-ui-action', 'jdm-multi-payment__cta', ctaClassName]
    .filter(Boolean)
    .join(' ');
  const icon = document.createElement('span');
  icon.className = 'jdm-multi-payment__icon';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'jdm-multi-payment__label';
  const value = document.createElement('strong');
  value.className = 'jdm-multi-payment__value';
  const unit = document.createElement('span');
  unit.className = 'jdm-multi-payment__unit';
  cta.append(icon, label, value, unit);

  const switchButton = enableMethodSwitch ? document.createElement('button') : null;
  if (switchButton) {
    switchButton.type = 'button';
    switchButton.className = ['jdm-multi-payment__switch', switchClassName]
      .filter(Boolean)
      .join(' ');
  }

  const hint = document.createElement('span');
  hint.className = ['jdm-multi-payment__hint', hintClassName].filter(Boolean).join(' ');

  let currentMethod = 'tokens';
  let availableMethods = ['tokens', 'credits'];

  const sync = ({
    method = 'tokens',
    methods = ['tokens', 'credits'],
    cost = '—',
    unit: unitText = '',
    disabled = false,
    hint: hintText = '',
    label: labelText = actionLabel,
    ariaLabel = '',
    title = '',
  } = {}) => {
    availableMethods = normalizePaymentMethods(methods);
    currentMethod = availableMethods.includes(method) ? method : availableMethods[0];
    const nextMethod = availableMethods.find((candidate) => candidate !== currentMethod) ?? null;
    const presentation = PAYMENT_METHOD_PRESENTATIONS[currentMethod];
    const nextPresentation = nextMethod ? PAYMENT_METHOD_PRESENTATIONS[nextMethod] : null;
    const costText = cost == null ? '—' : String(cost);
    const unitValue = String(unitText ?? '');
    const actionText = String(labelText ?? actionLabel);

    root.dataset.payment = currentMethod;
    root.dataset.paymentMethods = availableMethods.join(',');
    icon.textContent = compact ? '' : presentation.icon;
    label.textContent = actionText;
    value.textContent = costText;
    unit.textContent = compact ? '' : unitValue;
    cta.dataset.payment = currentMethod;
    cta.disabled = Boolean(disabled);
    cta.setAttribute('aria-label', String(ariaLabel || `${actionText}${costText ? ` pour ${costText}${unitValue ? ` ${unitValue}` : ''}` : ''}`));
    cta.title = String(title || cta.getAttribute('aria-label') || actionText);

    if (switchButton) {
      const canSwitch = Boolean(nextPresentation);
      switchButton.hidden = !canSwitch;
      switchButton.disabled = !canSwitch;
      switchButton.tabIndex = canSwitch ? 0 : -1;
      switchButton.dataset.payment = currentMethod;
      switchButton.dataset.nextPayment = nextMethod || '';
      switchButton.setAttribute('aria-hidden', String(!canSwitch));
      switchButton.setAttribute('aria-pressed', String(currentMethod === 'credits'));
      if (integratedMethodSwitch && canSwitch && switchIcon === '↻↺') {
        const hasCycleIcon = [...(switchButton.children ?? [])]
          .some((child) => String(child.className || '').includes('jdm-multi-payment__switch-icon'));
        if (!hasCycleIcon) {
          switchButton.textContent = '';
          switchButton.append(createSwapCycleIcon(document));
        }
      } else {
        switchButton.textContent = canSwitch ? nextPresentation.label : '';
        if (integratedMethodSwitch && canSwitch) switchButton.textContent = switchIcon || presentation.icon;
      }
      switchButton.setAttribute('aria-label', canSwitch
        ? `Utiliser ${nextPresentation.label}`
        : 'Changer de monnaie indisponible');
      switchButton.title = canSwitch
        ? `Utiliser ${nextPresentation.label}`
        : '';
    }

    hint.textContent = String(hintText ?? '');
    return { method: currentMethod, nextMethod, methods: [...availableMethods] };
  };

  cta.addEventListener('click', () => {
    if (!cta.disabled) return onAction?.(currentMethod);
  });
  if (switchButton) {
    switchButton.addEventListener('click', (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (switchButton.disabled) return;
      const nextMethod = availableMethods.find((candidate) => candidate !== currentMethod);
      if (!nextMethod) return;
      if (integratedMethodSwitch && switchIcon === '↻↺') {
        const cycleIcon = [...(switchButton.children ?? [])]
          .find((child) => String(child.className || '').includes('jdm-multi-payment__switch-icon'));
        cycleIcon?.classList.remove('is-spinning');
        cycleIcon?.getBoundingClientRect?.();
        cycleIcon?.classList.add('is-spinning');
      }
      return onMethodChange?.(nextMethod, currentMethod);
    });
  }
  row.append(cta);
  if (switchButton) row.append(switchButton);
  root.append(row, hint);
  sync();
  return {
    node: root,
    root,
    row,
    actionButton: cta,
    switchButton,
    valueNode: value,
    unitNode: unit,
    hintNode: hint,
    sync,
  };
}

// Ligne de paiement moderne (rl-pay) : [Jetons | Crédits]  [Envoyer · prix]. Même contrat que
// createMultiCurrencyPayment ; aucune règle métier.
function createModernPayment({ document, className, actionLabel, enableMethodSwitch, onAction, onMethodChange }) {
  const root = document.createElement('div');
  root.className = ['rl-pay', className].filter(Boolean).join(' ');
  const row = document.createElement('div');
  row.className = 'rl-pay__row';
  const currencySwitch = enableMethodSwitch
    ? createCurrencySwitch({ document, tipPlacement: 'above', onChange: (next, previous) => onMethodChange?.(next, previous) })
    : null;
  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'rl-pay__cta';
  const label = document.createElement('span');
  label.className = 'rl-pay__label';
  const price = document.createElement('span');
  price.className = 'rl-pay__price';
  const value = document.createElement('strong');
  value.className = 'rl-pay__value';
  const unit = document.createElement('span');
  unit.className = 'rl-pay__unit';
  price.append(value, unit);
  cta.append(label, price);
  const hint = document.createElement('span');
  hint.className = 'rl-pay__hint';
  let currentMethod = 'tokens';

  const sync = ({
    method = 'tokens',
    methods = ['tokens', 'credits'],
    cost = '—',
    unit: unitText = '',
    disabled = false,
    hint: hintText = '',
    label: labelText = actionLabel,
    ariaLabel = '',
    title = '',
    amounts = {},
  } = {}) => {
    const available = normalizePaymentMethods(methods);
    currentMethod = available.includes(method) ? method : available[0];
    const actionText = String(labelText ?? actionLabel);
    const costText = cost == null ? '—' : String(cost);
    root.dataset.payment = currentMethod;
    cta.dataset.payment = currentMethod;
    label.textContent = actionText;
    value.textContent = costText;
    unit.textContent = String(unitText ?? '');
    cta.disabled = Boolean(disabled);
    cta.setAttribute('aria-label', String(ariaLabel || `${actionText} pour ${costText} ${unitText ?? ''}`.trim()));
    cta.title = String(title || cta.getAttribute('aria-label'));
    currencySwitch?.sync({ method: currentMethod, methods: available, amounts });
    hint.textContent = String(hintText ?? '');
    const nextMethod = available.find((candidate) => candidate !== currentMethod) ?? null;
    return { method: currentMethod, nextMethod, methods: [...available] };
  };
  cta.addEventListener('click', () => {
    if (!cta.disabled) return onAction?.(currentMethod);
  });
  if (currencySwitch) row.append(currencySwitch.node);
  row.append(cta);
  root.append(row, hint);
  sync();
  return {
    node: root,
    root,
    row,
    actionButton: cta,
    switchButton: null,
    currencySwitch,
    valueNode: value,
    unitNode: unit,
    hintNode: hint,
    sync,
  };
}

export function createFeedbackSlot({
  document: documentRef = globalThis.document,
  className = '',
  label = 'Retour de l’action',
} = {}) {
  const document = requireDocument(documentRef);
  const node = document.createElement('p');
  node.className = ['jdm-feedback-slot', className].filter(Boolean).join(' ');
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-atomic', 'true');
  if (label) node.setAttribute('aria-label', label);
  node.classList.add('is-empty');
  return node;
}

export function updateFeedbackSlot(node, message, { kind = 'ok' } = {}) {
  if (!node) return node;
  const text = String(message ?? '');
  node.textContent = text;
  node.classList.toggle('is-empty', !text);
  node.classList.toggle('jdm-feedback-slot--error', kind === 'error' && Boolean(text));
  return node;
}
