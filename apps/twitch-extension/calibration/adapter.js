// Calibration data source (Video Component geometry, docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md).
// Packaged only by scripts/build-calibration.mjs, which hands `calibrationCall` to the extension client
// through the generated runtime-config (RUNTIME.fixtureCall): the real client, views and DOM run
// unchanged, only their answers come from local fixtures. No network, no write, no Twitch action.
import { CAPTURED_AT, FIXTURES } from './fixtures.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Fixtures with every date moved by `shiftMs` (the captured instant becomes the page load). */
export function rebase(value, shiftMs) {
  if (typeof value === 'string' && ISO.test(value))
    return new Date(Date.parse(value) + shiftMs).toISOString();
  if (Array.isArray(value)) return value.map((v) => rebase(v, shiftMs));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rebase(v, shiftMs)]),
    );
  return value;
}

const refuse = (code) =>
  Promise.reject(Object.assign(new Error(code), { code }));

export function createCalibrationSource(now = Date.now(), clock = Date.now) {
  // One rebase at load: the captured instant becomes the page load.
  const data = rebase(FIXTURES, now - Date.parse(CAPTURED_AT));
  const mod = data.moderation;
  const answer = (body) =>
    Promise.resolve({ ok: true, ...structuredClone(body) });

  // The open Tombola round loops on its own length (60 s → 0 → 60 s): a real countdown, and the round
  // never closes (no draw is simulated).
  const raffle = data.raffle_state.raffle_v2;
  const period = raffle.round.duration_ms;
  function liveRaffle() {
    const t = clock();
    const remaining = period - ((t - now) % period);
    const closes = new Date(t + remaining).toISOString();
    raffle.server_time = new Date(t).toISOString();
    Object.assign(raffle.round, { remaining_ms: remaining, closes_at: closes });
    for (const s of [data.session, data.state])
      Object.assign(s.raffle, {
        ends_at: closes,
        ends_in_s: Math.round(remaining / 1000),
      });
  }

  return function calibrationCall(method, rawPath) {
    const [path, query = ''] = String(rawPath).split('?');
    const qs = new URLSearchParams(query);
    if (['/session', '/state', '/raffle/state'].includes(path)) liveRaffle();
    if (method === 'GET') {
      if (path === '/session') return answer(data.session);
      if (path === '/state') return answer(data.state);
      if (path === '/tts/state') return answer(data.tts_state);
      if (path === '/raffle/state') return answer(data.raffle_state);
      if (path === '/emotes') return answer(data.emotes);
      if (path === '/viewer/preferences') return answer(data.preferences);
      if (path === '/moderation/v2/overview') return answer(mod.overview);
      if (path === '/moderation/v2/whoami') return answer(mod.whoami);
      if (path === '/moderation/v2/team') return answer(mod.team);
      if (path === '/moderation/v2/words') return answer(mod.words);
      if (path === '/moderation/v2/audit') return answer(mod.audit);
      if (path === '/moderation/v2/ledger') return answer(mod.ledger);
      if (path === '/moderation/v2/interactions') {
        const module = qs.get('module');
        const items = mod.interactions.items.filter(
          (i) => !module || i.module === module,
        );
        return answer({ ...mod.interactions, items });
      }
      if (path === '/moderation/v2/search') {
        const q = (qs.get('q') ?? '').toLowerCase();
        const viewers = mod.search.viewers.filter((v) =>
          v.display_name.toLowerCase().includes(q),
        );
        return answer({ ...mod.search, viewers });
      }
      const card = /^\/moderation\/v2\/viewers\/(\d+)$/.exec(path);
      if (card) {
        // One captured card, shown under the name of the viewer that was opened.
        const who = mod.search.viewers.find((v) => v.viewer_id === card[1]);
        if (!who) return refuse('not_found');
        return answer({
          ...mod.viewer,
          viewer_id: who.viewer_id,
          display_name: who.display_name,
        });
      }
    }
    // Opening Bonk re-reads the catalog with a POST: a read, answered like GET /emotes.
    if (method === 'POST' && path === '/emotes/refresh')
      return answer(data.emotes);
    // Everything else would act (pay, join, moderate, OAuth): never in this build.
    return refuse('not_available');
  };
}

export const calibrationCall = createCalibrationSource();
