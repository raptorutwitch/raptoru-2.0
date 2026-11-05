// One purchase per INTENT (architecture friction E3): the Idempotency-Key is created when the viewer starts an intent and
// kept until the server answers for good — a double click, a retry after a timeout or a reconnection resend the SAME key
// and the Core answers the first result (never a second debit). A success, or a refusal the viewer must act on, closes
// the intent; the next click is a new intent. Two taps: the first shows the price, the second confirms.

import { errorLabel, newIdempotencyKey } from './api.js';

/** The intent of one action of one module (its key lives until the intent is over). */
export function createIntent() {
  let key = null;
  return {
    key() {
      key ??= newIdempotencyKey();
      return key;
    },
    /** The server decided (success or a final refusal): the next click is a new intent. */
    close() {
      key = null;
    },
    get open() {
      return key !== null;
    },
  };
}

/** Network or server unavailable: the same intent is retried with the same key. Anything else closes it. */
export const isRetryable = (e) =>
  !e?.status || e.status >= 500 || e?.code === 'timeout' || e?.code === 'network_error';

/**
 * Two-tap purchase button. `run(key)` performs the request; the button never sends twice in parallel.
 * `update({ label, price, available, reason })` redraws it from the server's state.
 */
export function createPurchaseButton({ document, onResult, run }) {
  const intent = createIntent();
  // The house payment look (rl-pay of ui-primitives / base.css): no style of its own to load.
  const node = document.createElement('div');
  node.className = 'rl-pay rp-purchase';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rl-pay__cta';
  const note = document.createElement('span');
  note.className = 'rl-pay__hint';
  node.append(button, note);
  let armed = false;
  let busy = false;
  let view = { label: '', price: 0, available: false, reason: null };
  let timer = null;
  const draw = () => {
    button.disabled = busy || !view.available;
    button.textContent = busy
      ? 'Envoi…'
      : armed
        ? `Confirmer (${view.price} Jetons) ?`
        : view.price
          ? `${view.label} · ${view.price} Jetons`
          : view.label;
    note.textContent = view.available ? '' : errorLabel(view.reason ?? 'unavailable');
  };
  button.addEventListener('click', async () => {
    if (busy || !view.available) return;
    if (view.price && !armed) {
      armed = true;
      clearTimeout(timer);
      timer = setTimeout(() => { armed = false; draw(); }, 4000);
      return draw();
    }
    armed = false;
    busy = true;
    draw();
    try {
      // The price the viewer just confirmed travels with the intent (the server refuses if it changed meanwhile).
      const out = await run(intent.key(), view.price);
      intent.close();
      onResult?.({ ok: true, out });
    } catch (e) {
      if (!isRetryable(e)) intent.close();
      onResult?.({ ok: false, error: e, message: errorLabel(e?.code ?? e?.message) });
    } finally {
      busy = false;
      draw();
    }
  });
  return {
    node,
    intent,
    update(next) {
      view = { ...view, ...next };
      draw();
    },
  };
}
