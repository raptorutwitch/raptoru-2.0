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
 * Audit 09/11 (P1): keys for purchases a viewer may repeat ON PURPOSE (a Bonk per click, a sound, an event item). Each
 * click is its own purchase — except the click that follows a failure with no answer for the same thing (lost response,
 * timeout, network): it re-sends THAT key, so Core answers the first purchase (maybe already paid and played) instead
 * of charging a second time. A success or a decided refusal leaves nothing behind.
 */
export function createRetryKeys() {
  const unanswered = new Map();
  return {
    /** The key of this click: the unanswered one of the same thing, else a new one. */
    take(id) {
      const key = unanswered.get(id) ?? newIdempotencyKey();
      unanswered.delete(id);
      return key;
    },
    /** How the click ended: kept for the next click only when the server's answer is unknown. */
    settle(id, key, error) {
      if (error && isRetryable(error)) unanswered.set(id, key);
    },
  };
}

/** `task(key)` with the key of this click, settled from its outcome (the promise is returned unchanged). */
export function withRetryKey(keys, id, task) {
  const key = keys.take(id);
  let run;
  try {
    run = Promise.resolve(task(key));
  } catch (error) {
    run = Promise.reject(error);
  }
  return run.then(
    (out) => (keys.settle(id, key, null), out),
    (error) => {
      keys.settle(id, key, error);
      throw error;
    },
  );
}

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
