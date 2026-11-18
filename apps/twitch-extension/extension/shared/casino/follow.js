// Casino spectators (docs/CASINO.md § 6) — follows ONE player through the Core's feed: their revealed stages, in order,
// each once, for as long as the spectator stays (every round, every bonus, the other game). One request at a time
// (long-poll: the Core answers as soon as something is revealed); a lost connection retries with a growing pause and
// resumes from its cursor (nothing missed, nothing twice); a hidden tab stops asking and catches up when shown again.
// The first answer (or one after a lost cursor) is a snapshot: the stages of the player's current round, to rejoin it.

const WAIT_MS = 20_000;

/**
 * `client`: the extension's API; `player`: the followed viewer's id. `onPlayer(p)`: who they are / where they are;
 * `onStatus('live' | 'retry')`. Returns { next() → Promise<item>, backlog(), stop() }; an item is an event, or
 * { kind: 'snapshot', events } to rejoin at once.
 */
export function createFollower({ client, player, onPlayer, onStatus }) {
  const W = globalThis;
  const doc = W.document;
  let cursor = -1;
  let last = 0; // the newest seq queued: an event is played once
  let alive = true;
  let fails = 0;
  const queue = [];
  let taker = null;
  const give = (item) => {
    if (taker) {
      const t = taker;
      taker = null;
      t(item);
    } else queue.push(item);
  };
  const sleep = (ms) => new Promise((ok) => W.setTimeout(ok, ms));
  const shown = () =>
    !doc?.hidden
      ? Promise.resolve()
      : new Promise((ok) => {
          const on = () => {
            if (doc.hidden && alive) return;
            doc.removeEventListener('visibilitychange', on);
            ok();
          };
          doc.addEventListener('visibilitychange', on);
        });

  async function loop() {
    while (alive) {
      await shown();
      if (!alive) return;
      let res;
      try {
        res = await client.casinoWatch(player, cursor, cursor < 0 ? 0 : WAIT_MS);
        if (fails) onStatus?.('live');
        fails = 0;
      } catch (e) {
        if (!alive) return;
        fails += 1;
        onStatus?.('retry', e);
        await sleep(Math.min(8_000, 400 * 2 ** fails));
        continue;
      }
      if (!alive) return;
      const fresh = (res.events ?? []).filter((e) => e.seq > last);
      if (res.reset) {
        if (fresh.length || cursor < 0) give({ kind: 'snapshot', events: fresh, player: res.player });
      } else for (const e of fresh) give(e);
      if (fresh.length) last = fresh[fresh.length - 1].seq;
      cursor = Math.max(res.cursor ?? 0, last);
      if (res.player) onPlayer?.(res.player);
    }
  }
  void loop();

  return {
    /** The next item to play (waits for it). */
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((ok) => (taker = ok))),
    /** How many items wait behind the one being played (a late spectator catches up faster). */
    backlog: () => queue.length,
    stop() {
      alive = false;
      taker = null;
      queue.length = 0;
    },
  };
}
