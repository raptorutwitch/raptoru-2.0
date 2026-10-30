// Client de l'EBS.
//
// L'URL est publique et pointe vers l'EBS HTTPS. Les secrets et les coûts fiables
// restent exclusivement côté serveur.

import { createDemoSession } from './demo-data.js';
import { RUNTIME } from './runtime-config.js';
import { traceTimeoutDebug } from './timeout-debug.js';

export const API_BASE = RUNTIME.apiBase;

// Les actions utilisent toutes une Idempotency-Key côté EBS. On peut donc
// retenter une réponse HTTP transitoire sans rejouer l'effet côté SAMMI.
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 8_000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Body of a response within the request budget (ASTRA-P2-010): the headers alone do not end the
 * request, a body that never completes is aborted with it.
 */
function readBody(response, signal) {
  const body = response.text();
  if (!signal) return body;
  return new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('response_timeout'), { name: 'AbortError' }));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    body.then(resolve, reject);
  });
}
const sessionRoute = (path) => String(path).split('?', 1)[0];
const diagnosticRoute = (path) => sessionRoute(path)
  .split('/')
  .map((segment) => (/^\d{4,}$/.test(segment) ? ':id' : segment))
  .join('/');
const DYNAMIC_SESSION_KEYS = Object.freeze([
  'pending_actions',
  'credits',
  'emotes',
  'wallet',
  'interactions',
  'module_states',
  'moderation',
  'raffle',
  'action_receipts',
  'recent_activity',
  'notifications',
]);

function dynamicSessionState(session) {
  return {
    ok: true,
    ...Object.fromEntries(DYNAMIC_SESSION_KEYS.map((key) => [key, structuredClone(session?.[key])])),
  };
}

export const isDemo = () => {
  return RUNTIME.mode === 'demo';
};

/** Clé d'idempotence : une par intention utilisateur, réutilisée sur les retries. */
export function newIdempotencyKey() {
  const random = crypto.getRandomValues(new Uint8Array(12));
  return `ext-${Date.now()}-${[...random].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function createClient({
  getToken,
  apiBase = API_BASE,
  demoMode = isDemo(),
  demoScenario = new URLSearchParams(globalThis.location?.search || '').get('demoScenario') || 'paid',
  fetchImpl = globalThis.fetch,
  // Local fixtures in place of the simulator: only the calibration build's runtime-config defines it.
  fixtureCall = RUNTIME.fixtureCall ?? null,
}) {
  const demoQuery = new URLSearchParams(globalThis.location?.search || '');
  const studioCatalog = demoMode === true
    && demoQuery.get('studio') === '1'
    && demoQuery.get('demoCatalog') === 'large';
  const demo = createDemoSession(demoScenario, { studioCatalog });
  let lastSession = null;
  let serverConfirmedTestMode = false;
  const browserTestMode = () => RUNTIME.mode === 'test'
    || RUNTIME.testMode === true
    || serverConfirmedTestMode;
  const testLog = (stage, details = {}) => {
    if (!browserTestMode()) return;
    globalThis.console?.info?.('[RAPTORU TEST]', stage, {
      api_base: apiBase,
      ...details,
    });
  };

  function rememberSession(responsePayload) {
    lastSession = responsePayload;
    serverConfirmedTestMode = responsePayload.test_mode === true;
    testLog('session', {
      channel_id: responsePayload.channel_id || null,
      channel_login: responsePayload.channel_login || null,
      twitch_user_id: responsePayload.twitch_user_id || null,
      user_login: responsePayload.user_login || null,
      role: responsePayload.role || null,
      identity_shared: responsePayload.identity_shared !== false,
      test_mode: responsePayload.test_mode === true,
      environment: responsePayload.environment || null,
    });
  }

  async function call(method, path, { body, idempotencyKey } = {}) {
    if (demoMode) {
      const responsePayload = await (fixtureCall ?? demoCall)(method, path, body);
      if (sessionRoute(path) === '/session') rememberSession(responsePayload);
      return responsePayload;
    }
    if (!apiBase) {
      traceTimeoutDebug('api.request.blocked', { method, route: diagnosticRoute(path), reason: 'api_not_configured' });
      throw Object.assign(new Error('api_not_configured'), { code: 'api_not_configured' });
    }

    testLog('request', {
      method,
      path,
      ...(body?.module_id ? { module_id: String(body.module_id) } : {}),
    });

    const token = getToken();
    if (!token) {
      traceTimeoutDebug('api.request.blocked', { method, route: diagnosticRoute(path), reason: 'authorization_pending' });
      throw Object.assign(new Error('authorization_pending'), { code: 'authorization_pending' });
    }
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const request = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
    };

    // Un retry réseau réutilise exactement la même Idempotency-Key. Si le
    // serveur a exécuté l'action mais que la réponse s'est perdue, le second
    // envoi récupère la réponse mémorisée sans rejouer TTS/son/bonk.
    let response;
    // Budget of the attempt whose response is read: it covers the body too (cleared after reading).
    let pending = null;
    const route = diagnosticRoute(path);
    const requestStartedAt = globalThis.performance?.now?.() ?? Date.now();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        : null;
      try {
        traceTimeoutDebug('api.request.attempt', { method, route, attempt: attempt + 1 });
        response = await fetchImpl(`${apiBase}${path}`, {
          ...request,
          ...(controller ? { signal: controller.signal } : {}),
        });
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        traceTimeoutDebug('api.request.network_error', {
          method,
          route,
          attempt: attempt + 1,
          error_name: error?.name ? String(error.name) : null,
          error_message: error?.message || error || '',
        });
        if (attempt === 1) {
          throw Object.assign(new Error('network_error'), {
            code: 'network_error',
            cause: error,
          });
        }
        await wait(180);
        continue;
      }
      const status = Number(response?.status || 0);
      traceTimeoutDebug('api.response', {
        method,
        route,
        attempt: attempt + 1,
        http_status: status,
        http_ok: response?.ok === true,
        duration_ms: Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - requestStartedAt)),
      });
      if (attempt === 0 && TRANSIENT_HTTP_STATUSES.has(status)) {
        if (timeout) clearTimeout(timeout);
        await wait(status === 429 ? 350 : 180);
        continue;
      }
      pending = { timeout, signal: controller?.signal ?? null };
      break;
    }
    let text;
    try {
      text = await readBody(response, pending?.signal);
    } catch (error) {
      traceTimeoutDebug('api.response.body_error', {
        method,
        route,
        http_status: Number(response?.status || 0),
        error_name: error?.name ? String(error.name) : null,
        error_message: error?.message || error || '',
      });
      // Headers received, body not: the outcome is unknown, like a network failure (no retry here).
      throw Object.assign(new Error('network_error'), { code: 'network_error', cause: error });
    } finally {
      if (pending?.timeout) clearTimeout(pending.timeout);
    }
    let responsePayload = null;
    try {
      responsePayload = text.trim() ? JSON.parse(text) : null;
    } catch (error) {
      traceTimeoutDebug('api.response.json_error', {
        method,
        route,
        http_status: Number(response?.status || 0),
        error_name: error?.name ? String(error.name) : null,
        error_message: error?.message || error || '',
      });
    }
    if (!responsePayload || typeof responsePayload !== 'object') {
      // A success must carry its JSON object (ASTRA-P2-003): never a silent {} (204 = no content).
      if (response.ok && response.status !== 204) {
        throw Object.assign(new Error('invalid_response'), {
          code: 'invalid_response',
          status: Number(response?.status || 0),
        });
      }
      responsePayload = {};
    }
    if (!response.ok || responsePayload?.ok === false) {
      traceTimeoutDebug('api.response.failure', {
        method,
        route,
        http_status: Number(response?.status || 0),
        error_code: String(responsePayload.error || 'http_error'),
      });
      testLog('error', {
        method,
        path,
        http_status: Number(response?.status || 0),
        error: String(responsePayload.error || 'http_error'),
        ...(body?.module_id ? { module_id: String(body.module_id) } : {}),
      });
      throw Object.assign(new Error(responsePayload.error || 'http_error'), {
        code: responsePayload.error,
        status: Number(response?.status || 0),
        // Refusal details kept for the caller (e.g. TTS retry_after_ms, max_chars).
        details: responsePayload,
      });
    }
    if (sessionRoute(path) === '/session') rememberSession(responsePayload);
    testLog('response', {
      method,
      path,
      status: responsePayload.status || null,
      reference_id: responsePayload.reference_id || null,
      channel_id: responsePayload.channel_id || lastSession?.channel_id || null,
      channel_login: responsePayload.channel_login || lastSession?.channel_login || null,
      user_login: responsePayload.user_login || lastSession?.user_login || null,
      role: responsePayload.role || lastSession?.role || null,
      test_mode: responsePayload.test_mode === true || lastSession?.test_mode === true,
      environment: responsePayload.environment || lastSession?.environment || null,
      billing_mode: responsePayload.billing_mode || null,
      normal_cost: responsePayload.normal_cost ?? null,
    });
    return responsePayload;
  }

  // --- simulateur local ----------------------------------------------------
  function demoCall(method, path, body) {
    if (demoScenario === 'error') {
      return Promise.reject(Object.assign(new Error('x'), { code: 'network_error' }));
    }
    const studioSoundboardError = demoQuery.get('studio') === '1'
      && (demoScenario === 'soundboard_error' || demoScenario === 'soundboard_error_reason');
    if (studioSoundboardError
      && path === '/actions/tokens'
      && body?.module_id === 'soundboard') {
      const code = demoScenario === 'soundboard_error_reason'
        ? 'insufficient_tokens'
        : 'demo_soundboard_error';
      return Promise.reject(Object.assign(new Error(code), { code }));
    }
    if (path === '/session') return Promise.resolve(structuredClone(demo));
    if (path === '/state') return Promise.resolve(dynamicSessionState(demo));
    if (path === '/viewer/preferences') {
      if (method === 'GET') {
        const mode = demo.viewer_preferences?.level_up_notify ?? 'off';
        return Promise.resolve({ ok: true, level_up_notify: mode, level_up_sfx_opt_in: mode === 'sound' });
      }
      if (method === 'POST' && ['off', 'text', 'sound'].includes(body?.level_up_notify)) {
        demo.viewer_preferences ??= {};
        demo.viewer_preferences.level_up_notify = body.level_up_notify;
        return Promise.resolve({ ok: true, level_up_notify: body.level_up_notify, level_up_sfx_opt_in: body.level_up_notify === 'sound' });
      }
      return Promise.reject(Object.assign(new Error('invalid_payload'), { code: 'invalid_payload' }));
    }
    if (path === '/emotes') {
      const bonk = demo.modules.find((module) => module.id === 'bonk');
      return Promise.resolve({
        ok: true,
        connected: true,
        twitch_connected: demo.emotes?.twitch_connected !== false,
        groups: structuredClone(bonk?.emote_catalog?.groups ?? []),
      });
    }
    if (path === '/emotes/refresh') {
      const bonk = demo.modules.find((module) => module.id === 'bonk');
      return Promise.resolve({
        ok: true,
        connected: true,
        twitch_connected: demo.emotes?.twitch_connected !== false,
        groups: structuredClone(bonk?.emote_catalog?.groups ?? []),
      });
    }
    if (path === '/emotes/oauth/start') {
      return Promise.resolve({
        ok: true,
        authorization_url: 'https://id.twitch.tv/oauth2/authorize?client_id=demo&scope=user%3Aread%3Aemotes',
      });
    }
    if (path === '/emotes/oauth/disconnect') {
      demo.emotes = { ...(demo.emotes || {}), connected: true, twitch_connected: false };
      return Promise.resolve({ ok: true, revoked: true });
    }

    if (path.startsWith('/moderation/history')) {
      return Promise.resolve({
        ok: true,
        ...(demo.moderation?.history ?? { can_view: false, items: [], total: 0 }),
      });
    }

    if (path.startsWith('/moderation/tts/control/')) {
      const commandId = decodeURIComponent(path.split('/').at(-1));
      const status = demo.moderation?.tts?.control_statuses?.[commandId];
      if (!status) return Promise.reject(Object.assign(new Error('tts_control_status_not_found'), { code: 'tts_control_status_not_found' }));
      return Promise.resolve({ ok: true, ...structuredClone(status) });
    }

    if (path === '/moderation/tts/stop') {
      const commandId = String(body?.command_id || newIdempotencyKey());
      demo.moderation ??= { tts: { mode: 'instant', paused: false, can_moderate: true, pending: [] } };
      demo.moderation.tts.control_statuses ??= {};
      demo.moderation.tts.control_statuses[commandId] = {
        command_id: commandId, action: 'stop', status: 'executed', final_status: 'executed',
        requested_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
        queued_at: new Date().toISOString(), executed_at: new Date().toISOString(),
        marker: 'demo_tts_control_ack', target_ref: null, reference_id: null, error: null,
      };
      return Promise.resolve({ ok: true, action: 'stop', command_id: commandId, status: 'executed', final_status: 'executed', interrupted: true, control_available: true });
    }
    if (path === '/moderation/tts/purge') {
      const commandId = String(body?.command_id || newIdempotencyKey());
      demo.moderation ??= { tts: { mode: 'instant', paused: false, can_moderate: true, pending: [] } };
      demo.moderation.tts.control_statuses ??= {};
      demo.moderation.tts.control_statuses[commandId] = {
        command_id: commandId, action: 'purge', status: 'executed', final_status: 'executed',
        requested_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
        queued_at: new Date().toISOString(), executed_at: new Date().toISOString(),
        marker: 'demo_tts_purge_cutoff', target_ref: null, reference_id: null, error: null,
      };
      return Promise.resolve({ ok: true, action: 'purge', command_id: commandId, status: 'executed', final_status: 'executed', purged: 0, retained: 0, pending_reviews: 0 });
    }
    if (path === '/moderation/modules' || path.startsWith('/moderation/modules/')) {
      const moduleId = body?.module_id || path.split('/').at(-1);
      demo.module_states ??= {};
      demo.module_states[moduleId] = {
        ...(demo.module_states[moduleId] ?? {}),
        enabled: Boolean(body?.enabled),
      };
      return Promise.resolve({ ok: true, control: { module_id: moduleId, enabled: Boolean(body?.enabled) } });
    }
    if (path.startsWith('/moderation/users')) {
      if (path.includes('/credits')) {
        return Promise.resolve({ ok: true, delta: Number(body?.delta || 0), balance: 3 + Number(body?.delta || 0) });
      }
      if (path.includes('/profile/') || /^\/moderation\/users\/\d+$/.test(path)) {
        return Promise.resolve({ ok: true, user: { twitch_user_id: path.split('/').at(-1), login: 'viewer_test', credits: { soundboard: 3 }, audit: [] } });
      }
      return Promise.resolve({ ok: true, items: [{ twitch_user_id: '77', login: 'viewer_test' }] });
    }

    if (path === '/actions/redemption') {
      const index = demo.pending_actions.findIndex((a) => a.redemption_id === body.redemption_id);
      if (index === -1) return Promise.reject(Object.assign(new Error('x'), { code: 'redemption_not_found' }));
      demo.pending_actions.splice(index, 1);
      demo.credits[body.module_id] = Math.max(0, Number(demo.credits?.[body.module_id] || 0) - 1);
      return Promise.resolve({ ok: true, status: 'fulfilled', module_id: body.module_id });
    }

    if (path === '/actions/tokens') {
      const mod = demo.modules.find((m) => m.id === body.module_id);
      const sound = body.module_id === 'soundboard'
        ? mod?.sounds?.find((candidate) => candidate.id === body.payload?.sound_id)
        : null;
      const cost = sound?.token_cost ?? mod?.token_cost ?? 0;
      if (demo.wallet.available < cost) {
        return Promise.reject(Object.assign(new Error('x'), { code: 'insufficient_tokens' }));
      }
      demo.wallet.points -= cost;
      demo.wallet.available -= cost;
      return Promise.resolve({ ok: true, status: 'settled', module_id: body.module_id, cost });
    }

    if (path === '/moderation/tts/settings') {
      demo.moderation ??= { tts: { mode: 'instant', paused: false, can_moderate: true, pending: [] } };
      demo.moderation.tts = {
        ...demo.moderation.tts,
        ...(body?.mode === undefined ? {} : { mode: body.mode }),
        ...(body?.paused === undefined ? {} : { paused: Boolean(body.paused) }),
      };
      return Promise.resolve({ ok: true, settings: structuredClone(demo.moderation.tts) });
    }

    if (path === '/moderation/tts/pause' || path === '/moderation/tts/resume') {
      demo.moderation ??= { tts: { mode: 'instant', paused: false, can_moderate: true, pending: [] } };
      demo.moderation.tts.paused = path.endsWith('/pause');
      const action = path.endsWith('/pause') ? 'pause' : 'resume';
      const commandId = String(body?.command_id || newIdempotencyKey());
      demo.moderation.tts.control_statuses ??= {};
      demo.moderation.tts.control_statuses[commandId] = {
        command_id: commandId, action, status: 'executed', final_status: 'executed',
        requested_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
        queued_at: new Date().toISOString(), executed_at: new Date().toISOString(),
        marker: 'demo_tts_control_ack', target_ref: null, reference_id: null, error: null,
      };
      return Promise.resolve({ ok: true, action, command_id: commandId, status: 'executed', final_status: 'executed', settings: structuredClone(demo.moderation.tts) });
    }

  if (path === '/actions/raffle') {
      if (!demo.raffle.open) return Promise.reject(Object.assign(new Error('x'), { code: 'raffle_closed' }));
      if (demo.raffle.joined) {
        return Promise.resolve({
          ok: true,
          joined: true,
          duplicate: true,
          already_joined: true,
          window_id: demo.raffle.window_id,
          raffle_token: demo.raffle.token,
          source: 'extension',
        });
      }
      demo.raffle.joined = true;
      return Promise.resolve({
        ok: true,
        joined: true,
        duplicate: false,
        window_id: demo.raffle.window_id,
        raffle_token: demo.raffle.token,
        source: 'extension',
      });
    }

    return Promise.reject(Object.assign(new Error('x'), { code: 'not_found' }));
  }

  const controlCall = (path) => {
    const idempotencyKey = newIdempotencyKey();
    return call('POST', path, {
      body: { command_id: idempotencyKey },
      idempotencyKey,
    });
  };

  return {
    session: () => call('GET', '/session'),
    state: () => call('GET', '/state'),
    getViewerPreference: () => call('GET', '/viewer/preferences'),
    // Level Up V2: 'off' | 'text' | 'sound'.
    setViewerPreference: (mode) => call('POST', '/viewer/preferences', {
      body: { level_up_notify: ['off', 'text', 'sound'].includes(mode) ? mode : 'off' },
    }),
    refresh: async () => {
      if (!lastSession) return call('GET', '/session');
      const dynamic = await call('GET', '/state');
      lastSession = { ...lastSession, ...dynamic };
      return structuredClone(lastSession);
    },
    resetSession: () => {
      lastSession = null;
      serverConfirmedTestMode = false;
    },
    emotes: () => call('GET', '/emotes'),
    refreshEmotes: () => call('POST', '/emotes/refresh', { body: {} }),
    startEmoteOAuth: () => call('POST', '/emotes/oauth/start', { body: {} }),
    disconnectEmotes: () => call('POST', '/emotes/oauth/disconnect', { body: {} }),
    useRedemption: (redemptionId, moduleId, payload) => call('POST', '/actions/redemption', {
      body: { redemption_id: redemptionId, module_id: moduleId, payload },
      idempotencyKey: newIdempotencyKey(),
    }),
    spendTokens: (moduleId, payload) => call('POST', '/actions/tokens', {
      body: { module_id: moduleId, payload },
      idempotencyKey: newIdempotencyKey(),
    }),
    /**
     * Bonk salve (lot 5, mode Auto): every shot admitted and paid by Core at once, or nothing. The key is
     * chosen by the chargeur once per salve and reused on a retry: a salve is never paid twice.
     */
    spendBonkSalve: (idempotencyKey, payload) => call('POST', '/actions/tokens', {
      body: { module_id: 'bonk', payload },
      idempotencyKey,
    }),
    /** Moderation V2 (D4): Core read models (overview, whoami, search, viewer card, audit). */
    modV2: (path) => call('GET', `/moderation/v2/${path}`),
    /** Moderation V2 command, executed and audited by Core with the caller's permissions. */
    modV2Act: (command) => call('POST', '/moderation/v2/actions', { body: { command }, idempotencyKey: newIdempotencyKey() }),
    /** Commands V2 public list (« Commandes » for every viewer): Core's public projection, read-only. */
    commandsPublic: () => call('GET', '/commands/public'),
    /** Roue du Sub V2 (R8): the caller's own tours (identity from the token), and « Lancer mes tours ». */
    subWheelMe: () => call('GET', '/sub-wheel/me'),
    subWheelAccept: () => call('POST', '/sub-wheel/me/accept', { body: {} }),
    /** Roue du Sub V2 (R8), team: the tours waiting, « Tirer », « Accorder un tour » — Core checks the permissions. */
    subWheelTeam: () => call('POST', '/sub-wheel/team/rights', { body: {} }),
    subWheelTeamRequest: (spinId) => call('POST', `/sub-wheel/team/spins/${encodeURIComponent(spinId)}/request`, { body: {} }),
    subWheelTeamGrant: (grant) => call('POST', '/sub-wheel/team/grant', { body: grant }),
    /** Commands V2 « Modération › Commandes »: Core read models with the caller's verified identity. */
    cmdV2: (path) => call('GET', `/commands/v2/${path}`),
    /** Commands V2 change (update / create / delete): Core checks the caller's rights and the version. */
    cmdV2Post: (path, body) => call('POST', `/commands/v2/${path}`, { body }),
    /** TTS V2 (Lab): Core state for this viewer (availability, queue, current TTS). */
    ttsState: () => call('GET', '/tts/state'),
    /**
     * TTS V2 purchase. The key is chosen and persisted by the caller, once per confirmed message,
     * and reused on every retry / refresh: a message is never paid twice.
     */
    ttsBuy: (idempotencyKey, method, text) => call('POST', method === 'credits' ? '/actions/redemption' : '/actions/tokens', {
      body: { module_id: 'tts', payload: { text } },
      idempotencyKey,
    }),
    runLab: (moduleId, payload) => call('POST', '/actions/lab', {
      body: { module_id: moduleId, payload },
      idempotencyKey: newIdempotencyKey(),
    }),
    /** Halloween shop (docs/HALLOWEEN.md): Core's state for this viewer, a purchase, a conversion (one key per click). */
    eventsState: () => call('GET', '/events/state'),
    eventsBuy: (itemId) => call('POST', '/actions/events/purchase', {
      body: { item_id: itemId },
      idempotencyKey: newIdempotencyKey(),
    }),
    eventsConvert: (bonbons) => call('POST', '/actions/events/convert', {
      body: { bonbons },
      idempotencyKey: newIdempotencyKey(),
    }),
    /** Tombola V2 (Lab): Core's viewer state (phase, timer, entries, refusal, result, history). */
    raffleState: () => call('GET', '/raffle/state'),
    joinRaffle: () => call('POST', '/actions/raffle', {
      body: {},
      idempotencyKey: newIdempotencyKey(),
    }),
    setTtsModeration: (settings) => call('POST', '/moderation/tts/settings', {
      body: settings,
      idempotencyKey: newIdempotencyKey(),
    }),
    pauseTts: () => controlCall('/moderation/tts/pause'),
    resumeTts: () => controlCall('/moderation/tts/resume'),
    stopTts: () => controlCall('/moderation/tts/stop'),
    purgeTts: () => controlCall('/moderation/tts/purge'),
    ttsControlStatus: (commandId) => call(
      'GET', `/moderation/tts/control/${encodeURIComponent(String(commandId))}`,
    ),
    moderationHistory: (filters = {}) => {
      const query = new URLSearchParams({
        ...(filters.query ? { query: filters.query } : {}),
        ...(filters.module_id ? { module_id: filters.module_id } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      });
      return call('GET', `/moderation/history${query.toString() ? `?${query}` : ''}`);
    },
    moderationUsers: (query = '') => call('GET', `/moderation/users/search${query ? `?query=${encodeURIComponent(query)}` : ''}`),
    moderationUserProfile: (twitchUserId) => call('GET', `/moderation/users/profile/${encodeURIComponent(twitchUserId)}`),
    setModuleControl: (moduleId, enabled) => call('POST', '/moderation/modules', {
      body: { module_id: moduleId, enabled },
      idempotencyKey: newIdempotencyKey(),
    }),
    suspendUser: (payload) => call('POST', '/moderation/users/suspend', {
      body: payload,
      idempotencyKey: newIdempotencyKey(),
    }),
    unsuspendUser: (payload) => call('POST', '/moderation/users/unsuspend', {
      body: payload,
      idempotencyKey: newIdempotencyKey(),
    }),
    adjustSoundboardCredits: (payload) => call('POST', '/moderation/users/credits', {
      body: payload,
      idempotencyKey: newIdempotencyKey(),
    }),
    decideTtsSubmission: (submissionId, decision) => call(
      'POST',
      `/moderation/tts/submissions/${encodeURIComponent(submissionId)}/${decision}`,
      { body: {}, idempotencyKey: newIdempotencyKey() },
    ),
    rejectAndBanTtsSubmission: (submissionId, payload = {}) => call(
      'POST',
      `/moderation/tts/submissions/${encodeURIComponent(submissionId)}/reject-and-ban`,
      { body: payload, idempotencyKey: newIdempotencyKey() },
    ),
    banTtsViewer: (viewer) => call('POST', '/moderation/tts/ban', {
      body: viewer,
      idempotencyKey: newIdempotencyKey(),
    }),
    unbanTtsViewer: (twitchUserId) => call('POST', '/moderation/tts/unban', {
      body: { twitch_user_id: twitchUserId },
      idempotencyKey: newIdempotencyKey(),
    }),
  };
}

export const ERROR_LABELS = {
  test_user_not_allowed: 'Ce compte n’est pas autorisé.',
  test_channelpoints_disabled: 'Les points de chaîne sont désactivés.',
  test_mode_unavailable: 'Le service de test n’est pas disponible.',
  sound_not_found: 'Ce son n’existe pas (ou plus).',
  sound_disabled: 'Ce son est temporairement désactivé.',
  sound_cooldown: 'Ce son est en cooldown : réessaie dans quelques secondes.',
  sound_running: 'Ce son est déjà en cours de lecture.',
  sound_unavailable: 'Aucun son disponible pour le moment.',
  studio_offline: 'Le Studio du streamer est hors ligne. Aucun jeton consommé.',
  player_offline: 'Le lecteur audio du Studio n’est pas prêt. Aucun jeton consommé.',
  extension_suspended: 'Ton accès à ce module est temporairement suspendu.',
  tts_control_unavailable: 'Le contrôle TTS du pont local n’est pas disponible.',
  tts_control_status_not_found: 'Le statut d’exécution TTS n’est pas encore disponible.',
  tts_control_timeout: 'Commande envoyée, exécution non confirmée (délai dépassé).',
  tts_control_uncertain: 'Commande envoyée, exécution non confirmée.',
  tts_control_failed: 'La commande TTS n’a pas été exécutée.',
  moderation_atomic_unavailable: 'Le blocage atomique est temporairement indisponible.',
  moderation_action_unavailable: 'Cette action de modération est indisponible pour le moment.',
  moderation_batch_unavailable: 'La suspension multi-module est temporairement indisponible.',
  moderation_batch_partial_failure: 'La modération n’a pas été appliquée complètement — vérifie la fiche avant de réessayer.',
  global_suspension_requires_all: 'Cette ancienne suspension globale doit être réactivée sur tous les modules en une seule fois.',
  redemption_not_found: 'Action introuvable — recharge le panneau.',
  redemption_already_used: 'Cette action a déjà été utilisée.',
  insufficient_credits: 'Pas assez de crédits Soundboard pour ce son.',
  redemption_wrong_reward: 'Cette action ne correspond pas à ce module.',
  redemption_expired: 'Cette action a expiré. Si Twitch l’avait mise en attente, son remboursement est traité.',
  insufficient_tokens: 'Pas assez de jetons.',
  wallet_unavailable: 'Solde indisponible pour le moment.',
  wallet_debit_failed: 'Le débit des jetons a échoué — aucun TTS n’a été lancé.',
  wallet_debit_uncertain: 'Le résultat du débit est incertain — n’envoie rien de nouveau et préviens Raptoru.',
  raffle_closed: 'Aucune tombola en cours.',
  raffle_already_joined: 'Tu participes déjà à ce tirage.',
  raffle_unavailable: 'La tombola est momentanément indisponible.',
  sammi_failed: 'Le stream n’a pas répondu — réessaie dans un instant.',
  sammi_unavailable: 'Les interactions sont temporairement en pause — aucun crédit ni jeton n’a été consommé.',
  tts_paused: 'Le TTS est temporairement mis en pause — rien n’a été consommé.',
  soundboard_paused: 'Le Soundboard est en pause : rien n’a été débité.',
  bonk_paused: 'Le Bonk est en pause : rien n’a été débité.',
  viewer_blocked: 'Cette interaction est indisponible pour ton compte.',
  viewer_cooldown: 'Cooldown en cours : réessaie un peu plus tard.',
  global_pause: 'Raptoru est en pause : les nouvelles interactions sont refusées, rien n’a été débité.',
  message_blocked: 'Ce message contient un mot interdit : rien n’a été débité.',
  raffle_paused: 'La tombola est en pause.',
  module_disabled: 'Ce module est désactivé pour le moment.',
  tts_banned: 'Tu ne peux pas utiliser le TTS pour le moment.',
  tts_viewer_busy: 'Ton TTS précédent est encore en attente ou en lecture.',
  tts_queue_full: 'La file TTS est pleine — aucun jeton ni crédit n’a été consommé.',
  tts_cooldown: 'Ton cooldown TTS est encore actif.',
  tts_admission_unavailable: 'La protection anti-abus TTS est indisponible — rien n’a été consommé.',
  tts_purged: 'Cette demande TTS a été purgée et ne peut pas être rejouée.',
  tts_submission_not_found: 'Cette demande a déjà été traitée ou n’existe plus.',
  forbidden: 'Cette commande est réservée à la modération.',
  invalid_payload: 'Saisie invalide.',
  identity_not_shared: 'Partage ton identité pour utiliser tes actions.',
  authorization_pending: 'Connexion à Twitch en cours — réessaie dans un instant.',
  invalid_token: 'La session Twitch a expiré — ferme puis rouvre l’extension.',
  internal_error: 'Le service est momentanément indisponible — réessaie dans un instant.',
  network_error: 'Connexion au service impossible — réessaie dans un instant.',
  login_unavailable: 'Ton compte Twitch n’est pas encore reconnu — réessaie dans un instant.',
  api_not_configured: 'L’extension est momentanément indisponible.',
  rate_limited: 'Un peu trop de demandes à la fois — attends quelques secondes.',
  // Bonk : emote Twitch refusée par Core (compte Twitch non lié / emote hors du catalogue du viewer).
  viewer_not_linked: 'Emotes Twitch indisponibles : aucun compte Twitch lié à cette identité.',
  emote_not_in_catalog: 'Cette emote ne fait pas partie de tes emotes Twitch.',
  catalog_unavailable: 'Tes emotes Twitch ne sont pas encore chargées — réessaie dans un instant.',
  // Refus du Core (Bonk / frontière viewer) : jamais un « Une erreur est survenue » muet.
  obs_offline: 'Le Bonk est indisponible : OBS n’est pas connecté côté Studio. Aucun jeton consommé.',
  overlay_not_ready: 'Le Bonk est indisponible : l’overlay du stream n’est pas prêt. Aucun jeton consommé.',
  identity_required: 'Partage ton identité pour utiliser tes actions.',
  token_expired: 'La session Twitch a expiré — ferme puis rouvre l’extension.',
  unauthorized: 'La session Twitch n’est pas reconnue — ferme puis rouvre l’extension.',
  wrong_channel: 'Cette extension n’est pas configurée pour cette chaîne.',
  unsupported_payment: 'Ce mode de paiement n’est pas disponible ici : utilise tes jetons.',
  twitch_emotes_unavailable: 'Les emotes Twitch personnelles ne sont pas disponibles dans ce test.',
  not_available: 'Cette fonction n’est pas disponible dans ce test.',
};

export const errorLabel = (code) => ERROR_LABELS[code] ?? 'Une erreur est survenue.';

// Une session qui échoue doit toujours fermer les boutons, mais sa cause ne
// doit pas être réécrite en `sammi_unavailable` : un JWT expiré, un EBS absent
// et un heartbeat périmé n'ont pas la même procédure de reprise.
export function sessionFailureState(previous, error) {
  if (!previous) return null;
  const reason = String(error?.code || 'session_unavailable');
  return {
    ...previous,
    interactions: {
      ...(previous.interactions || {}),
      available: false,
      reason,
    },
  };
}
