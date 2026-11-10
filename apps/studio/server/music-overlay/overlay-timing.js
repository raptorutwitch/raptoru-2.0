// Raptoru — when the music overlay shows, and in which form (docs/music/MUSIC_OVERLAYS.md § 3 ter). Pure: no DOM, no
// timer — the page (overlay.js) asks again at `until`. Tested in server/test/music-overlays.test.ts.
//
// - A new occurrence of a track (Windows' `gen`: a new track, or the same one really played again) → an announce of
//   `announce_s` (announce / hybrid modes). Another one during it: the announce starts again with the new track.
// - A pause / resume, a refresh of the same occurrence, Studio coming back after a cut: never a new announce.
// - « Afficher » arms the overlay; in announce mode nothing shows before the next track (« Tester sur le stream » shows
//   it now). « Masquer »: hidden at once, nothing appears.
// - The requester confirmed a moment after the title (Core's exact attribution): the tab comes out without a new
//   announce — the strip stays long enough to read it; after the announce, it comes back for it (« Mettre en avant »).

export const hasTrack = (l) =>
  !!l?.track && ['playing', 'paused', 'stale'].includes(l.state);

/** A requester confirmed late keeps the strip at least this long (the tab is read, the announce is not replayed). */
export const LATE_REQUEST_MS = 8000;

export function timeline({ preview = false, card = false } = {}) {
  let shownGen = null;
  let reqGen = null;
  let lastPulse = null;
  let armed = false;
  let until = 0;
  let edited = '';

  function formOf(s, m, announcing) {
    const l = m.live;
    if (card) return hasTrack(l) ? 'full' : 'idle';
    if (!preview && (!m.visible || m.offline)) return 'hidden';
    const mode = s.display.mode;
    if (!hasTrack(l)) {
      if (s.display.on_idle !== 'placeholder' || mode === 'announce')
        return 'hidden';
      return mode === 'hybrid' ? 'compact-idle' : 'idle';
    }
    let form =
      mode === 'always'
        ? 'full'
        : announcing
          ? 'full'
          : mode === 'announce'
            ? 'hidden'
            : 'compact';
    if (l.state === 'paused' && form !== 'hidden') {
      if (s.display.on_pause === 'hide') form = 'hidden';
      else if (s.display.on_pause === 'compact')
        form = mode === 'announce' ? 'hidden' : 'compact';
    }
    return form;
  }

  return {
    /** When the current announce ends (0: none). */
    get until() {
      return until;
    },
    /** The model as the page has it now (preset, live, visible, offline, pulse) → { form, pulsed }. */
    step(m, now) {
      const s = m.preset?.settings;
      if (!s) return { form: 'hidden', pulsed: false };
      const l = m.live;
      // Hidden from Studio (« Masquer »): what happens meanwhile is never announced later.
      const shown = preview || card || !!m.visible;
      const announce = () => {
        if (shown) until = now + s.display.announce_s * 1000;
      };
      if (hasTrack(l) && l.gen !== shownGen) {
        // The track already playing when the page opens is not announced (an OBS reload is not a new track).
        const first = shownGen === null;
        shownGen = l.gen;
        reqGen = l.request ? l.gen : null;
        if (!first || preview) announce();
      } else if (hasTrack(l) && l.request && reqGen !== l.gen) {
        reqGen = l.gen;
        if (now < until && shown)
          until = Math.max(until, now + LATE_REQUEST_MS);
        else if (s.display.request_spotlight) announce();
      }
      // The editor: a setting changed shows the widget again (what is edited is seen, even after an announce).
      if (preview && !card) {
        const k = JSON.stringify(s);
        if (edited && k !== edited) announce();
        edited = k;
      }
      const pulsed = lastPulse !== null && m.pulse !== lastPulse;
      lastPulse = m.pulse;
      if (pulsed) until = now + s.display.announce_s * 1000;
      // Shown from Studio (never Studio coming back after a cut): hybrid opens wide once; announce only arms.
      const nowArmed = !preview && !!m.visible;
      if (nowArmed && !armed && s.display.mode === 'hybrid') announce();
      if (!shown) until = 0;
      armed = nowArmed;
      return { form: formOf(s, m, now < until), pulsed };
    },
  };
}
