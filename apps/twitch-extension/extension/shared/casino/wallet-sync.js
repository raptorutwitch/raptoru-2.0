// Casino — the open game follows the viewer's Wallet (a credit from Studio, a reward, another tab, another game…)
// without reloading the extension. The trigger is the extension's existing session read (panel → onWallet): when the
// session's balance differs from the one the game plays with, the game's state is read again FROM THE CORE (the
// financial authority; the session's number is never used as the playable balance). A Core answer is applied only if
// it is still the newest one and the game has not itself received a balance from the Core since it was asked (a spin
// result, a reload): an older read can never overwrite a newer balance. During a round nothing is applied — the round's
// own answer carries the Core's balance, and its end asks the session again (jdm:host-refresh), which converges.

/**
 * `pull()` → the Core's casino state; `game()` → the mounted player screen, or null. A screen that follows the Wallet
 * exposes `wallet()` → { balance, serial, busy } (serial: bumped each time the screen takes a balance from the Core
 * itself, or starts a round) and `sync(state)`.
 */
export function createWalletSync({ pull, game }) {
  let seq = 0;
  return async function onWallet(wallet) {
    const available = wallet && !wallet.unavailable ? Number(wallet.available) : NaN;
    const g = game();
    if (!g?.wallet || !Number.isFinite(available)) return false;
    const before = g.wallet();
    if (before.busy || before.balance === available) return false;
    const my = ++seq;
    let state;
    try {
      state = await pull();
    } catch {
      return false; // the next session read tries again
    }
    if (my !== seq || game() !== g) return false; // a newer read was asked, or the screen changed
    const now = g.wallet();
    if (now.busy || now.serial !== before.serial) return false; // the screen got a newer balance meanwhile
    g.sync(state);
    return true;
  };
}
