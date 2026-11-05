// Soundboard — the feedback after a send (extracted from ui.js, docs/studio-refonte/architecture/MIGRATIONS.md). It owns
// its state (the last outcome and its sequence) and its timer. Purely decorative: the outcome itself (debit, recents,
// notifications) is the host's. A success says « Envoyé au stream »; a refusal « Non envoyé » with a reason only when one
// is reliably known (`reasonFor(error)` → '' otherwise: never a cause invented from a technical message).

export const FEEDBACK_MS = { success: 2_300, error: 2_900, errorWithReason: 3_800 };

/** `root()` → the module's element (the mounted toast is removed from it when the feedback expires). */
export function createSoundboardFeedback({ document, root, reasonFor, timers = globalThis }) {
  let current = null; // { kind: 'success' | 'error', reason, sequence }
  let timer = null;
  let sequence = 0;

  function clear() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    current = null;
  }

  function set(kind, error = null) {
    if (timer !== null) timers.clearTimeout(timer);
    const reason = kind === 'error' ? reasonFor(error) : '';
    const mine = ++sequence;
    current = { kind, reason, sequence: mine };
    const duration = reason ? FEEDBACK_MS.errorWithReason : kind === 'success' ? FEEDBACK_MS.success : FEEDBACK_MS.error;
    timer = timers.setTimeout(() => {
      if (current?.sequence !== mine) return;
      current = null;
      timer = null;
      // Only the toast already mounted goes: a redraw here could move the caret / viewport of an interaction that has
      // just begun, and the feedback is purely decorative.
      try {
        root()?.querySelector('.sbx-toast')?.remove();
      } catch {
        /* vue déjà démontée */
      }
    }, duration);
  }

  /** The toast for the current outcome (an empty, hidden one when there is none: the slot keeps its place). */
  function overlay() {
    const make = (tag, cls, text) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    };
    const toast = make('div', 'sbx-toast');
    if (!current) {
      toast.hidden = true;
      toast.setAttribute('aria-hidden', 'true');
      return toast;
    }
    const isError = current.kind === 'error';
    toast.classList.add(isError ? 'is-error' : 'is-success');
    toast.setAttribute('role', isError ? 'alert' : 'status');
    toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.append(make('span', 'sbx-toast__mark', isError ? '!' : '✓'));
    const text = make('span', 'sbx-toast__text');
    text.append(make('strong', '', isError ? 'Non envoyé' : 'Envoyé au stream'));
    if (current.reason) text.append(make('span', '', current.reason));
    toast.append(text);
    return toast;
  }

  return { set, clear, overlay };
}
