// « Chaudron des subs » OBS source (docs/HALLOWEEN.md § 13): the subgoal as a potion cauldron. The Core counts (from
// the Twitch events it records); Studio relays it; this page asks every 2 s and only draws: the potion's level, bubbles
// and glow growing with the progress, a splash with « +N name » for each NEW counted event, a celebration when the goal
// is reached. Off, or Studio unreachable for 15 s: nothing shown. Studio's « Tester » plays the animation only.

/** The potion's level for a progress (pure): a little potion even at 0, full at the goal. */
export function levelOf(count, target) {
  const p = target > 0 ? Math.min(1, Math.max(0, count / target)) : 0;
  return 0.08 + 0.92 * p;
}

function start() {
  const TOKEN = decodeURIComponent(location.hash.slice(1));
  const POLL_MS = 2000;
  const GONE_MS = 15000;
  const root = document.getElementById('cauldron');
  const pot = document.getElementById('pot');
  const bubbles = document.getElementById('bubbles');
  const pops = document.getElementById('pops');
  const title = document.getElementById('title');
  const n = document.getElementById('n');
  const goal = document.getElementById('goal');
  const banner = document.getElementById('banner');

  let lastOk = 0;
  let seen = null; // ids of the counted events already shown (null: first answer, nothing animated)
  let lastTest = null;
  let wasFull = null;
  let bubbleCount = -1;

  function setBubbles(k) {
    if (k === bubbleCount) return;
    bubbleCount = k;
    bubbles.replaceChildren();
    for (let i = 0; i < k; i++) {
      const b = document.createElement('span');
      b.className = 'bubble';
      b.style.left = `${90 + ((i * 53) % 220)}px`;
      b.style.setProperty('--delay', `${(i * 0.37) % 2.4}s`);
      b.style.setProperty('--dur', `${2.6 - Math.min(1.2, k * 0.06)}s`);
      bubbles.append(b);
    }
  }

  function splash(text) {
    pot.classList.remove('splash');
    void pot.offsetWidth; // restart the animation
    pot.classList.add('splash');
    const p = document.createElement('span');
    p.className = 'pop';
    p.textContent = text;
    pops.append(p);
    setTimeout(() => p.remove(), 2700);
  }

  function celebrate() {
    banner.hidden = false;
    for (let i = 0; i < 4; i++) setTimeout(() => splash('🎃'), i * 450);
  }

  function draw(s) {
    if (!s.enabled) {
      root.classList.add('off');
      seen = null;
      return;
    }
    root.classList.remove('off');
    title.textContent = s.title || '';
    n.textContent = String(s.count);
    goal.textContent = ` / ${s.goal}`;
    const level = levelOf(s.count, s.goal);
    root.style.setProperty('--level', String(level));
    root.style.setProperty(
      '--glow',
      String(Math.min(1, s.count / Math.max(1, s.goal))),
    );
    setBubbles(3 + Math.round(9 * Math.min(1, s.count / Math.max(1, s.goal))));
    const full = s.count >= s.goal;
    root.classList.toggle('full', full);
    if (!full) banner.hidden = true;
    // New counted events since the last answer (oldest first); the first answer only remembers them.
    const ids = (s.recent ?? []).map((r) => r.id);
    if (seen) {
      const fresh = (s.recent ?? []).filter((r) => !seen.has(r.id)).reverse();
      fresh.forEach((r, i) =>
        setTimeout(() => splash(`+${r.units} ${r.name ?? ''}`.trim()), i * 900),
      );
      if (full && wasFull === false) setTimeout(celebrate, fresh.length * 900);
    }
    if (full && wasFull === null) banner.hidden = false;
    seen = new Set([...(seen ?? []), ...ids]);
    wasFull = full;
    // A free test from Studio (never changes the count); the first answer only remembers the last one.
    const testId = s.test?.id ?? 0;
    if (lastTest !== null && testId !== lastTest) {
      if (s.test.kind === 'goal') {
        celebrate();
        setTimeout(() => (banner.hidden = !full), 6000);
      } else splash('+1 Test');
    }
    lastTest = testId;
  }

  async function tick() {
    try {
      const res = await fetch('/halloween/cauldron/state', {
        headers: { 'x-overlay-token': TOKEN },
        cache: 'no-store',
      });
      if (res.ok) {
        lastOk = Date.now();
        draw(await res.json());
      }
    } catch {
      /* Studio restarting: keep the last picture for a while */
    }
    if (Date.now() - lastOk > GONE_MS) root.classList.add('off');
    setTimeout(tick, POLL_MS);
  }
  void tick();
}

if (typeof document !== 'undefined') start();
