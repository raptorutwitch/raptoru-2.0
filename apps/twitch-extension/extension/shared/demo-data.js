// Données de démonstration du front. Miroir navigateur de fixtures/seed.js
// (qui, lui, dépend de node:crypto et ne peut pas être importé ici).
// Aucun identifiant réel.
import { RUNTIME } from './runtime-config.js';

// Catalogue de volume réservé au Studio. Les entrées sont volontairement
// fictives, sans aperçu audio ni identifiant de production. Le builder
// Production remplace cette liste par une liste vide avant de copier le
// module partagé dans le paquet Twitch.
const STUDIO_SOUND_PLACEHOLDERS = Object.freeze([]);

export const DEMO_SESSION = {
  ok: true,
  demo_mode: true,
  demo_scenario: 'paid',
  notifications: [],
  identity_shared: true,
  twitch_user_id: '42',
  viewer_login: 'Raptoru_',
  site_url: RUNTIME.siteUrl || RUNTIME.apiBase,
  modules: [
    {
      id: 'tts',
      label: 'TTS',
      icon: '💬',
      description: 'Fais lire un message sans l’écrire dans le chat.',
      kinds: ['redemption', 'tokens'],
      token_cost: 7500,
      channel_points_cost: 1000,
      max_chars: 800,
    },
    {
      id: 'soundboard',
      label: 'Soundboard',
      icon: '🔊',
      description: 'Choisis directement le son à jouer.',
      kinds: ['redemption', 'tokens'],
      token_cost: 500,
      channel_points_cost: 1000,
      reward_credit_units: 3,
      sounds: [
        { id: 'boop', label: 'Boop', emoji: '👾', credit_cost: 1, token_cost: 500, preview_url: 'assets/sounds/boop.mp3' },
        { id: 'ohlala', label: 'Ohlala', emoji: '😏', credit_cost: 1, token_cost: 500, preview_url: 'assets/sounds/ohlala.mp3' },
        { id: 'hello', label: 'Hello', emoji: '🎈', credit_cost: 1, token_cost: 500, preview_url: 'assets/sounds/balloon-boy-says-hello.mp3' },
        { id: 'random', label: 'Aléatoire', emoji: '🎲', credit_cost: 1, token_cost: 600 },
      ],
    },
    {
      id: 'bonk',
      label: 'Bonk',
      icon: '🔨',
      description: 'Choisis une emote à lancer sur la caméra.',
      kinds: ['tokens'],
      token_cost: 200,
      channel_points_cost: null,
      emote_catalog: {
        status: 'preview',
        groups: [
          {
            id: 'twitch-global-preview',
            label: 'Twitch',
            icon: 'twitch',
            source: 'twitch',
            provider: 'twitch',
            scope: 'global',
            preview_only: true,
            emotes: [
              { id: 'preview:twitch-global:kappa', label: 'Kappa', mark: 'K', tone: 'slate' },
              { id: 'preview:twitch-global:pogchamp', label: 'PogChamp', mark: 'P!', tone: 'gold' },
              { id: 'preview:twitch-global:lul', label: 'LUL', mark: 'LUL', tone: 'teal' },
              { id: 'preview:twitch-global:kreygasm', label: 'Kreygasm', mark: 'K', tone: 'pink' },
              { id: 'preview:twitch-global:resident-sleeper', label: 'ResidentSleeper', mark: 'Z', tone: 'violet' },
              { id: 'preview:twitch-global:4head', label: '4Head', mark: '4', tone: 'blue' },
              { id: 'preview:twitch-global:monkas', label: 'MonkaS', mark: 'M', tone: 'gold' },
              { id: 'preview:twitch-global:pepehands', label: 'PepeHands', mark: 'PH', tone: 'slate' },
            ],
          },
          {
            id: 'twitch-channel-raptoru-preview',
            label: 'Raptoru_',
            icon: 'R',
            source: 'twitch',
            provider: 'twitch',
            scope: 'channel',
            channel_id: '42',
            channel_login: 'Raptoru_',
            channel_display_name: 'Raptoru_',
            channel_avatar_asset: 'assets/bonk/twitch-avatar-raptoru.svg',
            preview_only: true,
            emotes: [
              { id: 'preview:raptoru:bonk', label: 'raptoruBONK', mark: 'B!', tone: 'violet' },
              { id: 'preview:raptoru:love', label: 'raptoruLOVE', mark: '♥', tone: 'pink' },
              { id: 'preview:raptoru:ko', label: 'raptoruKO', mark: 'KO', tone: 'gold' },
              { id: 'preview:raptoru:gg', label: 'raptoruGG', mark: 'RG', tone: 'blue' },
              { id: 'preview:raptoru:hype', label: 'raptoruHYPE', mark: 'R!', tone: 'teal' },
              { id: 'preview:raptoru:shrug', label: 'raptoruSHRUG', mark: 'ツ', tone: 'slate' },
            ],
          },
          {
            id: 'twitch-channel-ptitchef-preview',
            label: 'PtitChef',
            icon: 'P',
            source: 'twitch',
            provider: 'twitch',
            scope: 'channel',
            channel_id: '43',
            channel_login: 'ptitchef',
            channel_display_name: 'PtitChef',
            channel_avatar_asset: 'assets/bonk/twitch-avatar-ptitchef.svg',
            preview_only: true,
            emotes: [
              { id: 'preview:ptitchef:mdr', label: 'ptitchefMDR', mark: 'XD', tone: 'gold' },
              { id: 'preview:ptitchef:chef', label: 'ptitchefCHEF', mark: '🍳', tone: 'orange' },
              { id: 'preview:ptitchef:omg', label: 'ptitchefOMG', mark: '!', tone: 'pink' },
              { id: 'preview:ptitchef:gg', label: 'ptitchefGG', mark: 'GG', tone: 'teal' },
            ],
          },
          {
            id: 'twitch-channel-pixelrider-preview',
            label: 'PixelRider',
            icon: 'P',
            source: 'twitch',
            provider: 'twitch',
            scope: 'channel',
            channel_id: '44',
            channel_login: 'pixelrider',
            channel_display_name: 'PixelRider',
            channel_avatar_asset: 'assets/bonk/twitch-avatar-pixel.svg',
            preview_only: true,
            emotes: [
              { id: 'preview:pixelrider:wave', label: 'pixelWAVE', mark: '👋', tone: 'blue' },
              { id: 'preview:pixelrider:gg', label: 'pixelGG', mark: 'GG', tone: 'violet' },
              { id: 'preview:pixelrider:rage', label: 'pixelRAGE', mark: 'R!', tone: 'pink' },
              { id: 'preview:pixelrider:clap', label: 'pixelCLAP', mark: '👏', tone: 'slate' },
            ],
          },
          {
            id: '7tv-global-preview',
            label: '7TV',
            icon: '7TV',
            source: '7tv',
            provider: '7tv',
            scope: 'global',
            preview_only: true,
            emotes: [
              { id: 'preview:7tv:party', label: 'partyParrot', mark: '🦜', tone: 'teal' },
              { id: 'preview:7tv:blob', label: 'blobDance', mark: '🟢', tone: 'green' },
              { id: 'preview:7tv:wave', label: 'wave7', mark: '👋', tone: 'blue' },
            ],
          },
          {
            id: 'bttv-global-preview',
            label: 'BetterTTV',
            icon: 'BTTV',
            source: 'bttv',
            provider: 'bttv',
            scope: 'global',
            preview_only: true,
            emotes: [
              { id: 'preview:bttv:cat', label: 'catJAM', mark: '🐈', tone: 'blue' },
              { id: 'preview:bttv:pepe', label: 'pepeSmile', mark: '🙂', tone: 'green' },
              { id: 'preview:bttv:clap', label: 'clapBTTV', mark: '👏', tone: 'violet' },
            ],
          },
          {
            id: 'ffz-global-preview',
            label: 'FrankerFaceZ',
            icon: 'FFZ',
            source: 'ffz',
            provider: 'ffz',
            scope: 'global',
            preview_only: true,
            emotes: [
              { id: 'preview:ffz:wave', label: 'ffzWave', mark: '👋', tone: 'gold' },
              { id: 'preview:ffz:happy', label: 'ffzHappy', mark: '😺', tone: 'orange' },
              { id: 'preview:ffz:think', label: 'ffzThink', mark: '🤔', tone: 'pink' },
            ],
          },
        ],
      },
    },
    {
      id: 'raffle_join',
      label: 'Tombola',
      icon: '🎟️',
      description: 'Inscris-toi sans écrire dans le chat.',
      kinds: ['free'],
      token_cost: null,
      channel_points_cost: null,
    },
  ],
  pending_actions: [
    { redemption_id: 'red-demo-1', module_id: 'tts', reward_key: 'tts', cost: 1000 },
    { redemption_id: 'red-demo-2', module_id: 'soundboard', reward_key: 'sound', cost: 1000, credits_remaining: 3 },
  ],
  credits: { tts: 1, soundboard: 1 },
  action_receipts: [
    { id: 'demo-sound', action: 'soundboard', label: 'Soundboard', detail: 'Boop', currency: 'jetons', cost: 500, status: 'played', created_at: '2026-08-10T20:12:00.000Z' },
    { id: 'demo-tts', action: 'tts', label: 'TTS', currency: 'channelpoints', cost: 1000, status: 'queued', created_at: '2026-08-10T20:13:00.000Z' },
  ],
  wallet: { points: 12000, reserved: 0, available: 12000 },
  interactions: { available: true, reason: null },
  module_states: {
    tts: { enabled: true },
    soundboard: { enabled: true },
    bonk: { enabled: true },
    raffle_join: { enabled: true },
  },
  moderation: {
    tts: { mode: 'instant', paused: false, blocked: false, can_moderate: false, pending: [] },
    activity: { can_view: false, items: [] },
    history: { can_view: false, items: [], total: 0 },
  },
  emotes: { connected: true, connect_url: null },
  locked_modules: [],
  raffle: {
    open: true,
    window_id: 'raffle-demo',
    token: 'raffle-demo',
    ends_in_s: 42,
    joined: false,
    viewer_login: 'Raptoru_',
    history: [{
      created_at: '2026-08-03T22:10:00.000Z',
      winners: [
        { login: 'MisterJDM', amount: 5000 },
        { login: 'LunaWords', amount: 5000 },
      ],
    }],
  },
};

/**
 * Etats visuels du studio local. Ils restent strictement fictifs et ne sont
 * jamais utilisés quand l'extension tourne sur Twitch.
 */
export function createDemoSession(scenario = 'paid', { studioCatalog = false } = {}) {
  const session = structuredClone(DEMO_SESSION);
  session.demo_scenario = scenario;

  if (studioCatalog === true) {
    const soundboard = session.modules.find((module) => module.id === 'soundboard');
    soundboard?.sounds?.push(...structuredClone(STUDIO_SOUND_PLACEHOLDERS));
  }

  if (scenario === 'public_tts') {
    session.modules = session.modules.filter((module) => module.id === 'tts');
    session.pending_actions = session.pending_actions.filter((action) => action.module_id === 'tts');
    session.credits = { tts: Number(session.credits?.tts || 0) };
    session.locked_modules = [
      { id: 'soundboard', label: 'Soundboard', icon: '🔊', status: 'coming_soon' },
      { id: 'bonk', label: 'Bonk', icon: '🔨', status: 'coming_soon' },
      { id: 'raffle_join', label: 'Tombola', icon: '🎟️', status: 'coming_soon' },
    ];
    session.raffle = { ...session.raffle, open: false, joined: false, history: [] };
  }

  if (scenario === 'wallet') {
    session.pending_actions = [];
    session.wallet = { points: 28450, reserved: 2500, available: 25950 };
    session.raffle = { ...session.raffle, open: false, joined: false };
  }

  if (scenario === 'empty') {
    session.pending_actions = [];
    session.wallet = { points: 420, reserved: 0, available: 420 };
    session.raffle = { ...session.raffle, open: false, joined: false, history: [] };
  }

  const demoNotification = (id, type, module, title, message, extra = {}) => ({
    id,
    type,
    module,
    title,
    message,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...extra,
  });
  if (scenario === 'notification_info') {
    session.notifications = [demoNotification(
      'demo-info', 'info', 'global', 'Bienvenue dans le centre',
      'Les informations importantes apparaîtront ici.',
    )];
  }
  if (scenario === 'notification_warning') {
    session.notifications = [demoNotification(
      'demo-warning', 'warning', 'tts', 'TTS à vérifier',
      'Le pont TTS demande une vérification avant la prochaine action.',
      { dedupe_key: 'demo_tts_warning' },
    )];
  }
  if (scenario === 'notification_many') {
    session.notifications = [
      demoNotification('demo-tts-info', 'info', 'tts', 'TTS disponible', 'Le service TTS est prêt.'),
      demoNotification('demo-sound-warning', 'warning', 'soundboard', 'Son à vérifier', 'Le bridge audio demande ton attention.'),
      demoNotification('demo-bonk-success', 'success', 'bonk', 'Catalogue actualisé', 'Les emotes sont disponibles.'),
      demoNotification('demo-raffle-result', 'success', 'raffle_join', 'Résultat de tombola', 'Le dernier tirage est terminé.'),
      demoNotification('demo-mod-action', 'action_required', 'moderation', 'Action à confirmer', 'Une action de modération attend une vérification.'),
    ];
  }
  if (scenario === 'notification_moderation_error') {
    session.moderation = {
      ...session.moderation,
      tts: { ...session.moderation.tts, can_moderate: true },
    };
    session.notifications = [demoNotification(
      'demo-moderation-timeout', 'error', 'moderation', 'Action non confirmée',
      'Le contrôle TTS n’a pas reçu de confirmation.',
      { dedupe_key: 'moderation_tts_timeout', action: { label: 'Ouvrir la modération', module: 'moderation' } },
    )];
  }
  if (scenario === 'notification_raffle') {
    session.notifications = [demoNotification(
      'demo-raffle-result', 'success', 'raffle_join', 'Tombola terminée',
      'Le résultat du tirage est disponible dans la Tombola.',
      { action: { label: 'Voir la Tombola', module: 'raffle_join' } },
    )];
  }
  if (scenario === 'notification_dedupe') {
    session.notifications = [
      demoNotification('demo-bridge-a', 'error', 'moderation', 'Bridge indisponible', 'Une seule entrée doit rester visible.', { dedupe_key: 'bridge_offline' }),
      demoNotification('demo-bridge-b', 'error', 'moderation', 'Bridge indisponible', 'Doublon de démonstration.', { dedupe_key: 'bridge_offline' }),
    ];
  }
  if (scenario === 'notification_expired') {
    session.notifications = [demoNotification(
      'demo-expired', 'info', 'global', 'Ancienne information',
      'Cette entrée est déjà expirée.',
      { expires_at: new Date(Date.now() - 1_000).toISOString() },
    )];
  }

  if (['raffle', 'raffle_joined', 'raffle_result', 'raffle_closed', 'raffle_long', 'joined'].includes(scenario)) {
    session.pending_actions = [];
    session.wallet = { points: 12000, reserved: 0, available: 12000 };
    // Fixture strictement locale : elle rend visibles les surfaces UX-3 sans
    // prétendre que ces montants/provenances viennent d'une session Twitch.
    session.raffle = {
      ...session.raffle,
      open: true,
      joined: false,
      ends_in_s: 87,
      ends_at: new Date(Date.now() + 87_000).toISOString(),
      total: 12000,
      currency: 'jetons',
      participant_count: 4,
      participants: [
        { login: 'Raptoru_', display_name: 'Raptoru_', source: 'extension' },
        { login: 'MisterJDM', display_name: 'MisterJDM', source: 'chat' },
        { login: 'LunaWords', display_name: 'LunaWords', source: 'extension' },
        { login: 'ViewerMix', display_name: 'ViewerMix', sources: ['chat', 'extension'] },
      ],
    };
  }

  if (scenario === 'raffle_long') {
    session.raffle = {
      ...session.raffle,
      participant_count: 18,
      participants: Array.from({ length: 18 }, (_, index) => ({
        login: `viewer${String(index + 1).padStart(2, '0')}`,
        display_name: `Viewer ${index + 1}`,
        ...(index === 0
          ? { login: 'Raptoru_', display_name: 'Raptoru_', source: 'extension' }
          : index % 4 === 0
            ? { sources: ['chat', 'extension'] }
            : { source: index % 2 ? 'chat' : 'extension' }),
      })),
    };
  }

  if (scenario === 'raffle_joined' || scenario === 'joined') {
    session.pending_actions = [];
    session.raffle = { ...session.raffle, open: true, joined: true, ends_in_s: 31 };
  }

  if (scenario === 'raffle_closed') {
    session.pending_actions = [];
    session.raffle = {
      ...session.raffle,
      open: false,
      joined: false,
      ends_in_s: 0,
      ends_at: undefined,
      closed_at: new Date().toISOString(),
      history: [],
    };
  }

  if (scenario === 'raffle_result') {
    session.pending_actions = [];
    session.raffle = {
      ...session.raffle,
      open: false,
      joined: false,
      ends_in_s: 0,
      ends_at: undefined,
      closed_at: new Date().toISOString(),
      history: [
        {
          created_at: '2026-09-04T22:40:00.000Z',
          pot: 12000,
          currency: 'jetons',
          winners: [
            { login: 'MisterJDM', amount: 6000 },
            { login: 'LunaWords', amount: 6000 },
          ],
        },
      ],
    };
  }

  if (scenario === 'identity') {
    session.identity_shared = false;
    session.pending_actions = [];
    session.wallet = { unavailable: true };
  }

  // Etat de validation local : l'identite est partagee, mais l'autorisation
  // Twitch `user:read:emotes` ne l'est pas encore. Cela permet de verifier
  // visuellement le CTA sans ouvrir Twitch ni toucher a une vraie session.
  if (scenario === 'emote_auth') {
    session.emotes = {
      connected: true,
      twitch_connected: false,
      seven_tv: true,
      connect_url: `${RUNTIME.apiBase}/oauth/viewer/emotes/start`,
    };
    session.pending_actions = [];
  }

  if (scenario === 'moderator') {
    session.moderation = {
      tts: {
        mode: 'approval',
        paused: false,
        blocked: false,
        can_moderate: true,
        pending: [{
          submission_id: 'demo-submission-1',
          twitch_user_id: '77',
          login: 'viewer_test',
          currency: 'channelpoints',
          text: 'Message TTS de démonstration',
          created_at: '2026-08-14T11:20:00.000Z',
        }],
      },
      activity: {
        can_view: true,
        items: [{
          id: 'demo-activity-1',
          action: 'soundboard',
          label: 'Soundboard',
          login: 'viewer_test',
          detail: 'Boop',
          created_at: '2026-08-14T11:18:00.000Z',
        }],
      },
      history: {
        can_view: true,
        total: 1,
        items: [{
          id: 'demo-activity-1',
          action: 'soundboard',
          label: 'Soundboard',
          login: 'viewer_test',
          target_login: null,
          detail: 'Boop',
          currency: 'jetons',
          cost: 500,
          status: 'played',
          created_at: '2026-08-14T11:18:00.000Z',
        }],
      },
      users: [
        { twitch_user_id: '77', login: 'viewer_test', display_name: 'Viewer Test' },
        { twitch_user_id: '88', login: 'demo_mod', display_name: 'Demo Mod' },
      ],
      selected_user: null,
      modules: structuredClone(session.module_states),
    };
  }

  return session;
}
