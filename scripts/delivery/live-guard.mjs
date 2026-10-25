// Live guard (docs/CICD.md « Jamais pendant un live »): is the channel live right now? Asked before a deployment,
// right before each write to Production and between the Core and the bot.
//
// Sources, each answering live (true), offline (false) or unknown (null):
// - core-session : the Core's stream session (Twitch EventSub → bot → Core), via GET /v1/ops/status;
// - core-helix   : Twitch Helix asked by the Core itself (its app credentials), same call;
// - helix        : Twitch Helix asked from here (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET), when configured;
// - obs          : OBS's stream output (obs-websocket, local runs only), when configured.
// Decision: any source live → LIVE (blocked). At least two sources definitely offline and none live → OFFLINE. Fewer
// than two → UNKNOWN (blocked), unless the operator explicitly accepts a single offline source (allowSingle) — never
// when a source says live. A failing source is unknown, never offline. No dependency.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URLSearchParams } from 'node:url';

const { fetch, AbortSignal, WebSocket } = globalThis;

/** Pure decision from the sources' answers ({ name, live: true|false|null, detail }). */
export function decide(sources, { allowSingle = false } = {}) {
  const live = sources.filter((s) => s.live === true);
  const offline = sources.filter((s) => s.live === false);
  if (live.length)
    return {
      verdict: 'LIVE',
      ok: false,
      reason: `en live selon ${live.map((s) => s.name).join(', ')}`,
    };
  if (offline.length >= 2)
    return {
      verdict: 'OFFLINE',
      ok: true,
      reason: `hors live selon ${offline.map((s) => s.name).join(', ')}`,
    };
  if (offline.length === 1 && allowSingle)
    return {
      verdict: 'OFFLINE',
      ok: true,
      reason: `hors live selon ${offline[0].name} SEULEMENT (arbitrage explicite : une seule source)`,
    };
  return {
    verdict: 'UNKNOWN',
    ok: false,
    reason: offline.length
      ? `une seule source sûre (${offline[0].name}) : les autres sont inconnues`
      : 'aucune source ne confirme le hors-live',
  };
}

/** GET /v1/ops/status of the Core: the full answer (also used after a deployment), or null. */
export async function opsStatus(env = process.env) {
  if (!env.OPS_URL || !env.OPS_TOKEN) return { error: 'not_configured' };
  try {
    const r = await fetch(env.OPS_URL, {
      headers: { authorization: `Bearer ${env.OPS_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { error: `http_${r.status}` };
    return { status: await r.json() };
  } catch (e) {
    return { error: String(e.message ?? e).slice(0, 80) };
  }
}

function coreSources(ops, now = Date.now()) {
  if (!ops.status)
    return [
      { name: 'core-session', live: null, detail: ops.error },
      { name: 'core-helix', live: null, detail: ops.error },
    ];
  const s = ops.status;
  // A stale or clock-skewed answer proves nothing.
  const skew = Math.abs(now - Date.parse(s.now));
  if (!(skew < 120_000))
    return [
      { name: 'core-session', live: null, detail: `réponse datée (${s.now})` },
      { name: 'core-helix', live: null, detail: `réponse datée (${s.now})` },
    ];
  const one = (name, x) => ({
    name,
    live: x?.live === true ? true : x?.live === false ? false : null,
    detail: x?.error ?? (x?.since ? `depuis ${x.since}` : ''),
  });
  return [
    one('core-session', s.live?.session),
    one('core-helix', s.live?.helix),
  ];
}

async function helixSource(env) {
  if (
    !env.TWITCH_CLIENT_ID ||
    !env.TWITCH_CLIENT_SECRET ||
    !env.TWITCH_CHANNEL_ID
  )
    return null;
  try {
    const t = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!t.ok)
      return { name: 'helix', live: null, detail: `jeton Twitch ${t.status}` };
    const { access_token } = await t.json();
    const r = await fetch(
      `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(env.TWITCH_CHANNEL_ID)}`,
      {
        headers: {
          authorization: `Bearer ${access_token}`,
          'client-id': env.TWITCH_CLIENT_ID,
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!r.ok)
      return { name: 'helix', live: null, detail: `Helix ${r.status}` };
    const data = (await r.json()).data ?? [];
    const s = data.find((x) => x.type === 'live');
    return {
      name: 'helix',
      live: Boolean(s),
      detail: s ? `depuis ${s.started_at}` : '',
    };
  } catch (e) {
    return {
      name: 'helix',
      live: null,
      detail: String(e.message ?? e).slice(0, 80),
    };
  }
}

/** OBS stream output over obs-websocket v5 (local runs: OBS_WS_URL + OBS_WS_PASSWORD_FILE). */
async function obsSource(env) {
  if (!env.OBS_WS_URL) return null;
  let password = '';
  try {
    if (env.OBS_WS_PASSWORD_FILE)
      password = readFileSync(env.OBS_WS_PASSWORD_FILE, 'utf8').trim();
  } catch {
    return { name: 'obs', live: null, detail: 'mot de passe OBS illisible' };
  }
  const sha = (s) => createHash('sha256').update(s).digest('base64');
  return new Promise((resolve) => {
    let ws;
    const done = (r) => {
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* closed */
      }
      resolve(r);
    };
    const timer = setTimeout(
      () => done({ name: 'obs', live: null, detail: 'OBS ne répond pas' }),
      6_000,
    );
    try {
      ws = new WebSocket(env.OBS_WS_URL);
    } catch {
      return done({ name: 'obs', live: null, detail: 'OBS injoignable' });
    }
    ws.onerror = () =>
      done({ name: 'obs', live: null, detail: 'OBS injoignable' });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.op === 0) {
        const a = m.d.authentication;
        ws.send(
          JSON.stringify({
            op: 1,
            d: {
              rpcVersion: 1,
              ...(a
                ? { authentication: sha(sha(password + a.salt) + a.challenge) }
                : {}),
            },
          }),
        );
      } else if (m.op === 2)
        ws.send(
          JSON.stringify({
            op: 6,
            d: { requestType: 'GetStreamStatus', requestId: 's' },
          }),
        );
      else if (m.op === 7) {
        const active = m.d.responseData?.outputActive;
        done({
          name: 'obs',
          live: active === true ? true : active === false ? false : null,
          detail: active ? 'sortie stream active' : '',
        });
      }
    };
  });
}

/** Asks every configured source; returns { verdict, ok, reason, sources, ops }. */
export async function liveCheck(env = process.env, opts = {}) {
  const ops = opts.ops ?? (await opsStatus(env));
  const sources = [
    ...coreSources(ops),
    ...(await Promise.all([helixSource(env), obsSource(env)])).filter(Boolean),
  ];
  return { ...decide(sources, opts), sources, ops };
}

export const describeSources = (sources) =>
  sources
    .map(
      (s) =>
        `${s.name}: ${s.live === true ? 'EN LIVE' : s.live === false ? 'hors live' : 'inconnu'}${s.detail ? ` (${s.detail})` : ''}`,
    )
    .join(' · ');
