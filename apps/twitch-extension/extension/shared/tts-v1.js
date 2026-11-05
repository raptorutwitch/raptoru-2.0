// TTS V1: the « tts » screen when the session does not offer TTS V2 (`tts_v2`) — a Lab without its TTS worker, the
// calibration build, a Core whose TTS configuration is unreachable. A module variant (module-registry.js) drawn into the
// host's module body at each render, exactly as ui.js drew it; the draft lives in host.memory (it survives a visit), the
// currency choice is the host's (header wallet), a refused send comes back through host.run's `errorScope`.
import { registerModuleVariant } from './module-registry.js';
import { ttsV2Applies } from './tts-v2.js';
import { walletCanPayTokens } from './wallet-payment.js';
import { createMultiCurrencyPayment } from './ui-primitives.js';

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

export function normalizeTtsDraft(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- control characters are stripped on purpose
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function ttsDraftLength(value) {
  return Array.from(normalizeTtsDraft(value)).length;
}

function drawTtsV1({ document, client, module: mod, state, body, host }) {
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
  const memory = host.memory;
  memory.text ??= '';
  const pending = (state?.pending_actions ?? []).filter((a) => a.module_id === 'tts');
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
  const { displayMethods, spendMethods } = host.walletMethods();
  const supportsPaymentMethod = (method) => spendMethods.includes(method);
  const paymentMethodsFor = () => displayMethods;

  const normalizePaymentMethod = (methods) => {
    const available = methods.length ? methods : ['tokens'];
    if (available.includes(host.payment.get())) return host.payment.get();
    host.payment.set(available[0]);
    return available[0];
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
  field.value = memory.text;

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
    host.payment.sync(methods, (next) => {
      host.payment.set(next);
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
      host.payment.set(method);
      syncControls();
    },
    onAction: (method) => {
      if (!ttsAvailable || !supportsPaymentMethod(method)) return;
      if (method === 'tokens' && !walletCanPayTokens(state.wallet, quoteFor(field.value).price)) return;
      const data = payload();
      if (!data) return;
      if (method === 'credits') {
        return host.run(body, () => pending[0]
          ? client.useRedemption(pending[0].redemption_id, 'tts', data)
          : Promise.reject(Object.assign(new Error('insufficient_credits'), { code: 'insufficient_credits' })), {
          errorScope: 'tts',
          onSuccess: () => { memory.text = ''; },
        });
      }
      return host.run(body, () => client.spendTokens('tts', data), {
        errorScope: 'tts',
        onSuccess: () => { memory.text = ''; },
      });
    },
  });

  if (state?.lab_mode) {
    const lab = el('button', 'jdm-btn jdm-ui-action jdm-btn--primary jdm-tts-action jdm-tts-action--lab', 'Tester gratuitement');
    lab.type = 'button';
    lab.addEventListener('click', () => {
      const data = payload();
      if (data) return host.run(body, () => client.runLab('tts', data), {
        errorScope: 'tts',
        onSuccess: () => { memory.text = ''; },
      });
    });
    actions.append(lab);
  }

  field.addEventListener('input', () => {
    memory.text = field.value;
    syncControls();
  });

  const row = el('div', 'jdm-row');
  row.append(counter);
  const composer = el('div', 'jdm-tts-composer');
  composer.append(field, row);
  body.append(composer, help, actions);
  actions.prepend(paymentControl.node);
  const failure = host.scopedError();
  if (failure) {
    body.append(el('p', 'jdm-flash jdm-flash--error jdm-tts-error', failure));
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

registerModuleVariant({
  id: 'tts',
  // Registered after TTS V2 (imported above): exactly the sessions V2 does not take.
  match: (env) => !ttsV2Applies(env),
  // The header wallet: tokens, or the TTS credits (one pending TTS reward = one use).
  wallet: { label: 'TTS', credits: (state) => (state?.pending_actions ?? []).filter((a) => a.module_id === 'tts').length },
  view: () => ({ node: null }),
  rendered: (_view, ctx) => drawTtsV1(ctx),
});
