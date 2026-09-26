// Local stand-in for the Twitch Extension Helper (window.Twitch.ext), served by the Studio in
// place of https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js inside the Extension Lab
// only. It implements what the extension uses (onAuthorized, onContext, onVisibilityChanged,
// onHighlightChanged, onError, listen, actions.requestIdShare/minimize) and reads the simulated
// context from the URL, like Twitch does (anchor, mode, platform, language…) plus lab parameters
// (labRole, labIdentity, labLayout). The token is a readable lab token, never a Twitch JWT: only the
// Studio's Lab EBS accepts it.

export const TWITCH_EXT_MOCK_PATH = '/ext-lab/twitch-ext-mock.js';

export const TWITCH_EXT_MOCK_JS = String.raw`(() => {
  'use strict';
  const query = new URLSearchParams(location.search);
  const role = ['viewer', 'moderator', 'broadcaster'].includes(query.get('labRole'))
    ? query.get('labRole') : 'viewer';
  const identityShared = query.get('labIdentity') !== '0';
  const layout = query.get('labLayout') || 'normal';
  const channelId = '900100';
  const token = 'lab.' + btoa(JSON.stringify({ role, identity_shared: identityShared }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const opaqueUserId = 'U' + ({ viewer: '900101', moderator: '900102', broadcaster: '900100' })[role];
  const auth = {
    channelId,
    clientId: 'raptoru-lab',
    token,
    helixToken: '',
    userId: opaqueUserId,
  };
  const context = {
    arePlayerControlsVisible: false,
    bitrate: 6000,
    bufferSize: 2,
    displayResolution: '1920x1080',
    game: 'Just Chatting',
    hlsLatencyBroadcaster: 3,
    isFullScreen: layout === 'fullscreen',
    isMuted: false,
    isPaused: false,
    isTheatreMode: layout === 'theatre',
    language: query.get('language') || 'fr',
    mode: query.get('mode') || 'viewer',
    playbackMode: 'video',
    theme: 'dark',
    videoResolution: '1920x1080',
    volume: 0.5,
  };
  const listeners = { authorized: [], context: [], visibility: [], highlight: [], error: [], pubsub: new Map() };
  const toParent = (type, detail = {}) => {
    try { parent.postMessage({ source: 'raptoru-ext-lab', type, anchor: query.get('anchor'), ...detail }, location.origin); } catch {}
  };
  const later = (fn) => setTimeout(fn, 40);
  const ext = {
    version: 'lab',
    environment: 'lab',
    onAuthorized(cb) { listeners.authorized.push(cb); later(() => cb({ ...auth })); },
    onContext(cb) { listeners.context.push(cb); later(() => cb({ ...context }, Object.keys(context))); },
    onVisibilityChanged(cb) { listeners.visibility.push(cb); later(() => cb(true, { ...context })); },
    onHighlightChanged(cb) { listeners.highlight.push(cb); },
    onError(cb) { listeners.error.push(cb); },
    listen(target, cb) {
      if (!listeners.pubsub.has(target)) listeners.pubsub.set(target, []);
      listeners.pubsub.get(target).push(cb);
    },
    unlisten(target, cb) {
      const list = listeners.pubsub.get(target) || [];
      listeners.pubsub.set(target, list.filter((fn) => fn !== cb));
    },
    send(target, contentType, message) { toParent('send', { target, message: String(message).slice(0, 200) }); },
    actions: {
      requestIdShare() { toParent('requestIdShare'); },
      minimize() { toParent('minimize'); },
      followChannel(login) { toParent('followChannel', { login }); },
      onFollow() {},
    },
    features: { isChatEnabled: true, isBitsEnabled: false, isSubscriptionStatusAvailable: false, onChanged() {} },
    viewer: {
      opaqueId: opaqueUserId,
      id: identityShared ? opaqueUserId.slice(1) : null,
      role: role === 'viewer' ? 'viewer' : role,
      isLinked: identityShared,
      sessionToken: token,
      subscriptionStatus: null,
      onChanged() {},
    },
    bits: { getProducts: async () => [], onTransactionComplete() {}, useBits() {}, setUseLoopback() {} },
    configuration: { broadcaster: null, developer: null, global: null, onChanged(cb) { later(cb); }, set() {} },
    rig: { log: (...args) => console.info('[twitch-ext lab]', ...args) },
  };
  window.Twitch = { ext };
  // Messages from the Studio (same origin only): broadcast (like a PubSub push), context, highlight.
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.source !== 'raptoru-studio-lab') return;
    const { type } = event.data;
    if (type === 'broadcast') {
      for (const cb of listeners.pubsub.get('broadcast') || []) cb('broadcast', 'application/json', JSON.stringify(event.data.message ?? {}));
    } else if (type === 'highlight') {
      for (const cb of listeners.highlight) cb(Boolean(event.data.value));
    } else if (type === 'visibility') {
      for (const cb of listeners.visibility) cb(Boolean(event.data.value), { ...context });
    }
  });
  toParent('ready', { role, identityShared });
})();
`;
