// Shared timing of the socle (plan § 4 « Relevé » and « Compte à rebours »): one poller per data source and one
// 1-second clock for every countdown, both paused while the page is hidden. A view uses them instead of its own
// setInterval, so leaving a view leaves no timer behind (criterion F4).

/**
 * `run()` → Promise<boolean ok>; `interval(failed)` → ms before the next run. `now()` runs at once (coalesced with a
 * run in flight) and reschedules. Hidden page: no run, one check when it becomes visible again (the resume hooks of
 * the entry call now()). `stop()` clears everything.
 */
export function createPoller({ run, interval, auto = true }) {
  let timer = null;
  let inFlight = null;
  let stopped = false;
  const schedule = (failed) => {
    clearTimeout(timer);
    if (!auto || stopped) return;
    timer = setTimeout(() => void now(), interval(failed));
  };
  function now() {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    if (document.visibilityState === 'hidden') { schedule(true); return Promise.resolve(); }
    inFlight = (async () => {
      let ok = false;
      try { ok = await run(); } finally { inFlight = null; schedule(!ok); }
    })();
    return inFlight;
  }
  return { now, stop() { stopped = true; clearTimeout(timer); } };
}

const tickers = new Set();
let clockTimer = null;
/** Calls fn(nowMs) every second while subscribed (one shared timer); returns the unsubscribe function. */
export function everySecond(fn) {
  tickers.add(fn);
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const t = Date.now();
      for (const f of tickers) f(t);
    }, 1000);
  }
  return () => {
    tickers.delete(fn);
    if (!tickers.size) { clearInterval(clockTimer); clockTimer = null; }
  };
}
