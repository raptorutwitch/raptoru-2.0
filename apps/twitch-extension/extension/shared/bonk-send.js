// Bonk — sending a shot or a salve and saying how it went (extracted from ui.js, docs/studio-refonte/architecture/MIGRATIONS.md).
// It owns its state: the requests in flight, the last outcome (text and kind) and the slot that shows it. Each click
// starts its own request (the client gives it its own idempotency key): no failure empties or cancels the others.
// The outcome belongs to the visit: `clear()` when the viewer leaves Bonk.

import { updateFeedbackSlot } from './ui-primitives.js';

/** What Core's answer means for the viewer. */
export function bonkFeedbackForResult(result = {}) {
  // Bonk lot 5: a salve is admitted (and paid) as one block.
  if (Array.isArray(result?.interactions) && result?.volley_id)
    return `Salve ×${result.interactions.length} acceptée ✓`;
  const status = String(result?.status ?? '').trim().toLowerCase();
  if (status === 'queued') return 'Bonk accepté · en file ✓';
  if (status === 'delivered') return 'Bonk livré ✓';
  if (status === 'spawned') return 'Bonk apparu ✓';
  return 'Bonk accepté ✓';
}

/**
 * `refresh()` → the host's state reload after an accepted request; `notice(text, kind?)` → the magazine's bubble;
 * `errorText(code)` → the viewer-facing reason; `notifyError(error)` → the host's notification centre; `redraw()` once a
 * request has settled.
 */
export function createBonkSend({ refresh, notice, errorText, notifyError, redraw }) {
  let inFlight = 0;
  let message = '';
  let kind = 'ok';
  let slot = null;
  let visit = 0; // `clear()` ends a visit: an answer arriving after it belongs to the past one

  function sync() {
    if (!slot) return;
    const text = message || (inFlight ? 'Bonk en cours…' : '');
    updateFeedbackSlot(slot, text, { kind });
    slot.classList.toggle('jdm-bonk-feedback--error', kind === 'error' && Boolean(text));
  }
  function say(text, nextKind) {
    message = text;
    kind = nextKind;
    sync();
  }

  return {
    /** The slot of the Bonk screen being drawn (each render has its own). */
    mount(node) {
      slot = node;
      sync();
    },
    /** Refused before any request (an emote this viewer cannot fire): said in words, nothing sent. */
    refuse(text) {
      say(text, 'error');
      notice(text, 'error');
    },
    clear() {
      visit += 1;
      message = '';
      kind = 'ok';
    },
    /** `task()` → the client's request. Resolves true when Core accepted it. */
    send(task) {
      inFlight += 1;
      const mine = visit;
      say('Bonk en cours…', 'ok');
      let request;
      try {
        request = task();
      } catch (error) {
        request = Promise.reject(error);
      }
      return Promise.resolve(request)
        .then(async (result) => {
          try {
            await refresh();
          } catch {
            /* le prochain polling récupérera l’état */
          }
          if (mine !== visit) return true; // the viewer left meanwhile: nothing to say on this screen
          say(bonkFeedbackForResult(result), 'ok');
          // A salve has its own bubble at the end of its playback (bonk-chargeur.js).
          if (!result?.volley_id) notice(message);
          return true;
        })
        .catch((error) => {
          notifyError(error); // a refusal is always reported in the notification centre, even after leaving
          if (mine !== visit) return false;
          say(`Bonk non envoyé · ${errorText(error?.code)}`, 'error');
          notice(message, 'error');
          return false;
        })
        .finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          sync();
          redraw();
        });
    },
  };
}
