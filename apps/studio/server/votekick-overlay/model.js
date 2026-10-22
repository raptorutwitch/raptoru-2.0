// Votekick V2 overlay — pure model (docs/VOTEKICK_V2.md § Overlay), kept apart from the DOM to be tested on its
// own. A classic script (no module): the overlay still works opened as file:// by an OBS browser source, like the
// legacy page SAMMI drives through obs-browser `emit_event` « votekick_update ».
// Event contract = the legacy one (`action` live | open | update | result | clear, `yes` = KICK, `no` = SAVE, `ends`
// in ms, `session`, `outcome`, `minutes`, `mute_seconds`) plus an optional `seq` (Raptoru Core): within a session an
// event older than the last one applied is ignored, and nothing of a finished session is applied again (a late
// update can never reopen a vote whose verdict is shown).

(function (root) {
  'use strict';

  const VOTE_MS = 60000;
  const URGENT_MS = 10000;
  const CLOSED_MEMORY = 20;

  function createState() {
    return {
      phase: 'hidden', // hidden | live | result
      session: null,
      lastSeq: 0,
      closed: [],
      target: '',
      initiator: '',
      punished: '',
      avatar: '',
      kick: 0,
      save: 0,
      ends: 0,
      outcome: null,
      minutes: 0,
      muteSeconds: 0,
    };
  }

  const count = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const text = (v) =>
    v === undefined || v === null ? '' : String(v).replace(/^@/, '').trim();

  /**
   * One event against the state: the next state and what the page must do — 'ignore', 'open' (a new vote: intro),
   * 'update' (numbers only, nothing restarts), 'result' (the verdict), 'clear' (hide).
   */
  function reduce(state, event, now) {
    const e = event || {};
    const action = String(e.action || '').toLowerCase();
    const session = e.session ? String(e.session) : null;
    const seq = Number(e.seq) || 0;
    const sameSession = session !== null && session === state.session;
    if (sameSession && seq && seq <= state.lastSeq)
      return { state, effect: 'ignore' };
    if (action === 'clear') {
      if (!session && seq && seq <= state.lastSeq)
        return { state, effect: 'ignore' };
      if (state.phase === 'hidden') return { state, effect: 'ignore' };
      return {
        state: {
          ...state,
          phase: 'hidden',
          lastSeq: Math.max(state.lastSeq, seq),
        },
        effect: 'clear',
      };
    }
    const fields = {
      ...(e.target !== undefined ? { target: text(e.target) } : {}),
      ...(e.initiator !== undefined ? { initiator: text(e.initiator) } : {}),
      ...(e.avatar !== undefined ? { avatar: String(e.avatar || '') } : {}),
      ...(e.yes !== undefined ? { kick: count(e.yes) } : {}),
      ...(e.no !== undefined ? { save: count(e.no) } : {}),
    };
    if (action === 'live' || action === 'open' || action === 'update') {
      if (session && state.closed.includes(session))
        return { state, effect: 'ignore' }; // late update of a finished vote
      const fresh = !sameSession || state.phase !== 'live';
      const base = fresh
        ? {
            ...createState(),
            closed: state.closed,
            phase: 'live',
            session: session || state.session || 'default',
          }
        : state;
      const ends =
        Number(e.ends) > 0 ? Number(e.ends) : fresh ? now + VOTE_MS : base.ends;
      return {
        state: { ...base, ...fields, ends, lastSeq: seq || base.lastSeq },
        effect: fresh ? 'open' : 'update',
      };
    }
    if (action === 'result') {
      // A verdict of another session while a vote is live is late (never covers the live vote).
      if (state.phase === 'live' && session && state.session && !sameSession)
        return { state, effect: 'ignore' };
      if (
        session &&
        state.closed.includes(session) &&
        state.phase === 'result' &&
        state.session === session
      )
        return { state, effect: 'ignore' }; // the same verdict again
      const closed = session
        ? [...state.closed.filter((s) => s !== session), session].slice(
            -CLOSED_MEMORY,
          )
        : state.closed;
      const keep = sameSession || !session ? state : createState();
      return {
        state: {
          ...keep,
          ...fields,
          closed,
          phase: 'result',
          session: session || state.session,
          lastSeq: seq || (sameSession ? state.lastSeq : 0),
          outcome: String(e.outcome || ''),
          punished: text(e.punished),
          minutes: count(e.minutes),
          muteSeconds: count(e.mute_seconds),
        },
        effect: 'result',
      };
    }
    return { state, effect: 'ignore' };
  }

  /** KICK's share of the votes, 0..1 (0.5 with no vote). */
  function kickShare(kick, save) {
    const total = kick + save;
    return total ? kick / total : 0.5;
  }

  /** The timer: seconds left (ceil), the ring's remaining fraction, urgent in the last 10 s. */
  function timer(ends, now, voteMs = VOTE_MS) {
    const leftMs = Math.max(0, ends - now);
    return {
      seconds: Math.ceil(leftMs / 1000),
      fraction: Math.min(1, leftMs / voteMs),
      urgent: leftMs > 0 && leftMs <= URGENT_MS,
      over: leftMs <= 0,
    };
  }

  function duration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m && r) return `${m} min ${r} s`;
    if (m) return `${m} min`;
    return `${r} s`;
  }

  /**
   * The verdict screen: tone (kick red / save green / void white / gold), the stamp, who, the detail and an optional
   * badge. Texts from the legacy page, reorganised.
   */
  function verdict(s) {
    const at = (name) => `@${name || '?'}`;
    const min = `${s.minutes} min`;
    switch (s.outcome) {
      case 'target_timeout_perfect':
        return {
          tone: 'gold',
          stamp: 'Perfect',
          who: at(s.target),
          detail: `Condamné · ${min}`,
          badge: '×2',
          fx: 'perfect',
        };
      case 'target_timeout':
        return {
          tone: 'kick',
          stamp: 'Condamné',
          who: at(s.target),
          detail: `Timeout · ${min}`,
          badge: null,
          fx: 'stamp',
        };
      case 'backfire':
        return {
          tone: 'kick',
          stamp: 'Retour de bâton',
          who: at(s.initiator),
          detail: `L'initiateur prend ${min}`,
          badge: '×2',
          fx: 'backfire',
        };
      case 'coinflip_target':
        return {
          tone: 'kick',
          stamp: 'Pile ou face',
          who: at(s.target),
          detail: `Perd le tirage · ${min}`,
          badge: null,
          fx: 'coin',
          coinSide: 'kick',
        };
      case 'coinflip_initiator':
        return {
          tone: 'kick',
          stamp: 'Pile ou face',
          who: at(s.initiator),
          detail: `Perd le tirage · ${min}`,
          badge: null,
          fx: 'coin',
          coinSide: 'save',
        };
      case 'broadcaster_muted':
        // The broadcaster muted: the target, or the initiator after a Backfire / lost coin flip (V2 `punished`).
        return {
          tone: 'kick',
          stamp: 'Réduit au silence',
          who: at(s.punished || s.target),
          detail: `Mute · ${duration(s.muteSeconds)}`,
          badge: null,
          fx: 'mute',
        };
      case 'no_timeout':
        return s.save > s.kick
          ? {
              tone: 'save',
              stamp: 'Sauvé',
              who: at(s.target),
              detail: 'Le chat a parlé',
              badge: null,
              fx: 'saved',
            }
          : {
              tone: 'void',
              stamp: 'Égalité',
              who: at(s.target),
              detail: 'Personne ne prend',
              badge: null,
              fx: 'void',
            };
      case 'no_quorum':
      default:
        return {
          tone: 'void',
          stamp: 'Annulé',
          who: at(s.target),
          detail: 'Pas assez de votes',
          badge: null,
          fx: 'void',
        };
    }
  }

  root.VotekickModel = {
    VOTE_MS,
    URGENT_MS,
    createState,
    reduce,
    kickShare,
    timer,
    duration,
    verdict,
  };
})(globalThis);
