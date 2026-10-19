import {
  BONK_LAB_RULES,
  bonkVolleyRules,
} from '../bonk-lab/bonk-lab-service.js';
import {
  type TwitchViewerCatalog,
  TwitchViewerError,
} from '../bonk-lab/twitch-viewer.js';
import { twitchEmoteGroups } from './twitch-emote-groups.js';
import type { LabCall, LabCallError } from './lab-internal.js';
import type { ExtCaller } from './twitch-jwt.js';
import type { TwitchName, TwitchNames } from './twitch-names.js';

// ASTRA-P1-006 (minimal): the public viewer frontier of the Core for a real Twitch Extension (Hosted
// Test on the staging Core first). It speaks the contract the extension already speaks to the Studio's
// LabEbs façade (/session, /state, /actions/*, /tts/state, /raffle/state, /moderation/v2/*), but:
// - the caller is the verified Twitch JWT only (role, user id when shared) — never a body field;
// - every decision, price, balance and refusal comes from Core (same services as the Lab), through
//   the in-process Lab call: nothing is simulated here, no fictitious identity, no local wallet;
// - payment stays SIMULATED (Lab test wallet, fictitious Jetons): no StreamElements, no Channel Points,
//   no canonical Wallet. TTS / Soundboard credits (phase 2 lot 4: their own currencies, obtained through a channel
//   points reward) are shown and spent as Core holds them — never a fictitious 0 (null: unavailable).
// Out of scope here: Twitch personal emotes (viewer OAuth), Commands V2, the legacy moderation paths
// beyond the TTS controls.

type Json = Record<string, unknown>;
/** The viewer's balances as Core holds them (a credits currency not available: null). */
interface LabWallet {
  tokens: number;
  credits_tts: number | null;
  credits_soundboard: number | null;
}

/**
 * The extension counts TTS credits as pending TTS redemptions and Soundboard credits as one redemption with
 * credits_remaining (same shapes as Studio's Lab EBS, values from Core). The ids are labels only: the payment is
 * always the viewer's balance in Core.
 */
function creditActions(w: LabWallet) {
  const tts = w.credits_tts ?? 0;
  const sb = w.credits_soundboard ?? 0;
  return [
    ...Array.from({ length: Math.min(tts, 200) }, (_, i) => ({
      redemption_id: `credit-tts-${i + 1}`,
      module_id: 'tts',
      reward_key: 'tts',
    })),
    ...(sb > 0
      ? [
          {
            redemption_id: 'credit-soundboard',
            module_id: 'soundboard',
            reward_key: 'sound',
            credits_remaining: sb,
          },
        ]
      : []),
  ];
}
export interface ExtReply {
  status: number;
  body: Json;
}

export interface ExtConfig {
  channelId: string;
  channelLogin: string;
  /** Shown to the extension (`environment`): 'staging' until the cutover. */
  environment: string;
}

interface Viewer extends TwitchName {
  id: string;
}

interface Who {
  caller: ExtCaller;
  /** Shared identity (and its name), null for an anonymous / unshared viewer. */
  viewer: Viewer | null;
  team: boolean;
}

const MODULE_PRESENTATION = {
  tts: {
    id: 'tts',
    label: 'TTS',
    icon: '💬',
    description: 'TTS · test staging, Jetons de test, aucun débit réel.',
    kinds: ['tokens'],
    token_cost: 7500,
    channel_points_cost: null,
    max_chars: 800,
  },
  soundboard: {
    id: 'soundboard',
    label: 'Soundboard',
    icon: '🔊',
    description: 'Soundboard · test staging, Jetons de test, aucun débit réel.',
    kinds: ['tokens'],
    token_cost: 500,
    channel_points_cost: null,
  },
  bonk: {
    id: 'bonk',
    label: 'Bonk',
    icon: '🔨',
    description: 'Bonk · test staging, Jetons de test, aucun débit réel.',
    kinds: ['tokens'],
    token_cost: BONK_LAB_RULES.simulatedCost,
    channel_points_cost: null,
    // Salves (lot 5): Core's bounds, shown by the chargeur (never decided by the client).
    volley: bonkVolleyRules(),
  },
  raffle_join: {
    id: 'raffle_join',
    label: 'Tombola',
    icon: '🎟️',
    description: 'Inscris-toi sans écrire dans le chat.',
    kinds: ['free'],
    token_cost: null,
    channel_points_cost: null,
  },
} as const;

const MODULE_IDS = ['tts', 'soundboard', 'bonk', 'raffle_join'] as const;
type ModuleId = (typeof MODULE_IDS)[number];
const BONK_PROVIDERS = ['unicode', 'twitch', '7tv', 'bttv', 'ffz'];
const MAX_RECEIPTS = 10;

const ok = (body: Json = {}): ExtReply => ({
  status: 200,
  body: { ok: true, ...body },
});
const fail = (status: number, error: string, extra: Json = {}): ExtReply => ({
  status,
  body: { ...extra, ok: false, error },
});
/** A Core refusal keeps its details (retry_after_ms, balance…), like the Lab façade. */
const refused = (e: unknown): ExtReply => {
  const err = e as Partial<LabCallError>;
  if (typeof err.status !== 'number') throw e;
  return {
    status: err.status,
    body: { ...(err.body ?? {}), ok: false, error: err.message ?? 'error' },
  };
};

export class ExtFacade {
  /** Recent TTS / Soundboard admissions per viewer (Bonk is read back from Core). */
  private receipts = new Map<string, Json[]>();
  private preferences = new Map<string, boolean>();

  constructor(
    private readonly core: LabCall,
    private readonly names: TwitchNames,
    private readonly config: ExtConfig,
    /** Twitch viewers (Bonk emotes): linking and personal catalogs; null = off. */
    private readonly twitch: TwitchViewerCatalog | null = null,
  ) {}

  private get C() {
    return this.config.channelId;
  }

  async handle(
    method: string,
    rawPath: string,
    body: Json | undefined,
    caller: ExtCaller,
    idempotencyKey?: string,
  ): Promise<ExtReply> {
    const [path = '', query = ''] = rawPath.split('?');
    const who = await this.who(caller);
    if (method === 'GET' && path === '/session')
      return ok(await this.session(who));
    if (method === 'GET' && path === '/state') return ok(await this.state(who));
    if (method === 'GET' && path === '/tts/state') return this.ttsState(who);
    if (path === '/viewer/preferences')
      return this.viewerPreferences(who, method, body);
    // Bonk « Twitch » source: always the account of the JWT (never an id sent by the client).
    if (path === '/emotes' || path === '/emotes/refresh')
      return ok(await this.emotes(caller, path === '/emotes/refresh'));
    if (method === 'POST' && path === '/emotes/oauth/disconnect') {
      if (this.twitch && caller.userId)
        await this.twitch.disconnect(caller.userId);
      return ok({ revoked: true });
    }
    if (method === 'POST' && path === '/emotes/oauth/start') {
      if (!this.twitch?.canLink) return fail(409, 'twitch_emotes_unavailable');
      if (!caller.userId) return fail(403, 'identity_required');
      return ok(await this.twitch.startAuth(caller.userId));
    }
    if (method === 'GET' && path === '/raffle/state')
      return this.raffleState(who);
    if (method === 'POST' && path === '/actions/raffle')
      return this.joinRaffle(who, idempotencyKey);
    if (method === 'POST' && path === '/actions/tokens')
      return this.spend(who, body ?? {}, idempotencyKey, 'tokens');
    // Paid in credits (TTS / Soundboard only): the viewer's balance in the module's own currency, never Jetons.
    if (method === 'POST' && path === '/actions/redemption')
      return this.spend(who, body ?? {}, idempotencyKey, 'credits');
    if (path.startsWith('/moderation/')) {
      if (!who.team) return fail(403, 'forbidden');
      if (!who.viewer) return fail(403, 'identity_required');
      if (path.startsWith('/moderation/v2/'))
        return this.moderationV2(
          method,
          path,
          query,
          body,
          who,
          idempotencyKey,
        );
      return this.legacyModeration(method, path, body, who);
    }
    return fail(404, 'not_available');
  }

  // --- Twitch emotes (Bonk) ----------------------------------------------------------------------

  /** The viewer's Twitch emotes: state + catalog of the JWT's account (stored catalog at once). */
  private async emotes(caller: ExtCaller, force: boolean): Promise<Json> {
    if (!this.twitch || !caller.userId)
      return {
        connected: true,
        twitch_connected: false,
        twitch_status: 'not_linked',
        groups: [],
      };
    const s = await this.twitch.emotesState(caller.userId, {
      force,
      waitMs: force ? 6000 : 0,
    });
    return {
      connected: true,
      twitch_connected: ['ready', 'syncing', 'stale'].includes(s.status),
      twitch_status: s.status,
      twitch_login: s.viewer?.display_name ?? null,
      ...(s.catalog ? { twitch_fetched_at: s.catalog.fetched_at } : {}),
      groups: s.catalog ? twitchEmoteGroups(s.catalog) : [],
    };
  }

  /**
   * GET /v1/ext/emotes/oauth/callback: Twitch sends the viewer's browser back here (no JWT; the
   * one-time state names the viewer). Logs: user id, scopes, outcome — never a token.
   */
  async oauthCallback(
    q: URLSearchParams,
  ): Promise<{ status: number; title: string; text: string }> {
    if (!this.twitch?.canLink)
      return { status: 404, title: 'Introuvable', text: '' };
    const code = q.get('code');
    const state = q.get('state');
    if (!code || !state)
      return {
        status: 400,
        title: 'Connexion Twitch annulée',
        text: 'Aucune autorisation n’a été donnée. Tu peux fermer cette fenêtre.',
      };
    try {
      const viewer = await this.twitch.completeAuth(
        code.slice(0, 512),
        state.slice(0, 128),
      );
      console.info(
        `[ext] Twitch emotes linked · user ${viewer.user_id} · scopes ${viewer.scopes.join(' ')}`,
      );
      return {
        status: 200,
        title: 'Connexion Twitch réussie',
        text: `Compte : ${viewer.display_name}. Tu peux fermer cette fenêtre et revenir sur le stream.`,
      };
    } catch (error) {
      const reason =
        error instanceof TwitchViewerError ? error.code : 'oauth_failed';
      console.warn(`[ext] Twitch emotes link refused · ${reason}`);
      return {
        status: 400,
        title: 'Connexion Twitch refusée',
        text:
          reason === 'oauth_wrong_account'
            ? 'Ce compte Twitch n’est pas celui avec lequel tu regardes le stream. Recommence depuis l’extension avec le bon compte.'
            : reason === 'oauth_state_invalid'
              ? 'Ce lien a expiré ou a déjà servi. Recommence depuis l’extension.'
              : 'La connexion n’a pas pu aboutir. Recommence depuis l’extension.',
      };
    }
  }

  // --- identity ----------------------------------------------------------------------------------

  private async who(caller: ExtCaller): Promise<Who> {
    const team = caller.role === 'broadcaster' || caller.role === 'moderator';
    const viewer = caller.userId
      ? { id: caller.userId, ...(await this.names.get(caller.userId)) }
      : null;
    return { caller, viewer, team };
  }

  /** The verified caller as a Core actor (role from the JWT; Core computes the effective role). */
  private actor(who: Who) {
    return {
      id: who.viewer!.id,
      login: who.viewer!.login,
      display_name: who.viewer!.display_name,
      role:
        who.caller.role === 'broadcaster'
          ? ('broadcaster' as const)
          : who.caller.role === 'moderator'
            ? ('moderator' as const)
            : ('viewer' as const),
      via: 'extension' as const,
    };
  }

  // --- session -----------------------------------------------------------------------------------

  private async session(who: Who): Promise<Json> {
    const C = this.C;
    const v = who.viewer;
    const [
      overview,
      wallet,
      catalog,
      ttsConfig,
      ttsViewer,
      raffle,
      bonkRecent,
    ] = await Promise.all([
      this.core<Json>(`/v1/lab/moderation/${C}/overview`).catch(() => null),
      v
        ? this.core<LabWallet>(`/v1/lab/wallet/${C}/${v.id}`).catch(() => null)
        : null,
      this.core<{ sounds: Json[] }>(
        `/v1/lab/sound/channels/${C}/catalog`,
      ).catch(() => null),
      this.core<{ module_state: string; rules: Json }>(
        '/v1/lab/tts/config',
      ).catch(() => null),
      v
        ? this.core<Json>(
            `/v1/lab/tts/channels/${C}/viewers/${v.id}/state`,
          ).catch(() => null)
        : null,
      this.core<Json>(
        `/v1/lab/raffle/${C}/state${v ? `?viewer=${v.id}` : ''}`,
      ).catch(() => null),
      v
        ? this.core<{ interactions: Json[] }>(
            `/v1/lab/bonk/channels/${C}/interactions?limit=10&viewer_id=${v.id}`,
          ).catch(() => null)
        : null,
    ]);

    const moduleState = (id: 'tts' | 'soundboard' | 'bonk' | 'raffle') =>
      String(
        ((overview?.[id] as Json | undefined)?.module_state as
          string | undefined) ?? 'active',
      );
    const enabled: Record<ModuleId, boolean> = {
      tts: moduleState('tts') !== 'disabled',
      soundboard: moduleState('soundboard') !== 'disabled',
      bonk: moduleState('bonk') !== 'disabled',
      raffle_join: moduleState('raffle') !== 'disabled',
    };
    const raffleV2 = overview?.raffle_v2 as
      { live_name?: string; live_open?: string } | undefined;
    const ttsV2 = ttsConfig
      ? {
          module_state: (ttsViewer as Json | null)?.global_paused
            ? 'paused'
            : ttsConfig.module_state,
          rules: ttsConfig.rules,
          viewer: ttsViewer,
          test_mode: true,
          payment_mode: 'simulated',
        }
      : null;

    const modules: Json[] = [
      {
        ...MODULE_PRESENTATION.tts,
        max_chars: Number(
          (ttsConfig?.rules as Json | undefined)?.max_chars ??
            MODULE_PRESENTATION.tts.max_chars,
        ),
        tts_v2: ttsV2,
      },
      {
        ...MODULE_PRESENTATION.soundboard,
        sounds: (catalog?.sounds ?? []).map((s) => ({
          id: s.id,
          label: s.label,
          emoji: s.id === 'random' ? '🎲' : '🔊',
          credit_cost: s.credit_cost,
          token_cost: s.token_cost,
          preview_url: s.preview_url,
          duration_ms: s.duration_ms,
          playback_mode: s.playback_mode,
          enabled: s.enabled,
          cooldown_ms: s.cooldown_ms,
          // Rounded to the second: a stable state between polls (no needless re-render).
          cooldown_until: s.cooldown_remaining_ms
            ? new Date(
                Math.ceil(
                  (Date.now() + Number(s.cooldown_remaining_ms)) / 1000,
                ) * 1000,
              ).toISOString()
            : null,
          running: s.running,
        })),
      },
      { ...MODULE_PRESENTATION.bonk, emote_catalog: { groups: [] } },
      {
        ...MODULE_PRESENTATION.raffle_join,
        raffle_v2: true,
        ...(raffleV2?.live_name ? { label: raffleV2.live_name } : {}),
        ...(raffleV2?.live_open ? { open_label: raffleV2.live_open } : {}),
      },
    ];

    const ttsPaused = moduleState('tts') === 'paused';
    const ttsModeration = (canModerate: boolean) => ({
      mode: 'instant',
      paused: ttsPaused,
      blocked: false,
      can_moderate: canModerate,
      pending: [],
    });
    const moduleStates = Object.fromEntries(
      MODULE_IDS.map((id) => [id, { enabled: enabled[id] }]),
    );
    const receipts = [
      ...(bonkRecent?.interactions ?? []).map((i) => ({
        id: i.interaction_id,
        action: 'bonk',
        label: 'Bonk',
        detail: i.status,
        currency: 'jetons',
        cost: i.simulated_cost,
        status: i.status,
        created_at: i.created_at,
      })),
      ...(v ? (this.receipts.get(v.id) ?? []) : []),
    ]
      .sort((a, b) =>
        String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
      )
      .slice(0, MAX_RECEIPTS);

    return {
      demo_mode: false,
      test_mode: true,
      environment: this.config.environment,
      payment_mode: 'simulated',
      moderation_v2: true,
      commands_public: false,
      role: who.caller.role === 'external' ? 'viewer' : who.caller.role,
      channel_id: this.C,
      channel_login: this.config.channelLogin,
      identity_shared: v !== null,
      twitch_user_id: v?.id ?? null,
      viewer_login: v?.display_name ?? null,
      user_login: v?.login ?? null,
      modules,
      module_states: moduleStates,
      wallet:
        v && wallet
          ? { points: wallet.tokens, reserved: 0, available: wallet.tokens }
          : { unavailable: true },
      credits: {
        tts: (v && wallet?.credits_tts) ?? null,
        soundboard: (v && wallet?.credits_soundboard) ?? null,
      },
      pending_actions: v && wallet ? creditActions(wallet) : [],
      action_receipts: receipts,
      notifications: [],
      interactions: { available: true, reason: null },
      locked_modules: [],
      emotes: { connected: true, twitch_connected: false, connect_url: null },
      moderation: who.team
        ? {
            tts: ttsModeration(true),
            modules: moduleStates,
            activity: { can_view: false, items: [] },
            history: { can_view: false, items: [], total: 0 },
          }
        : {
            tts: ttsModeration(false),
            activity: { can_view: false, items: [] },
            history: { can_view: false, items: [], total: 0 },
          },
      raffle: this.raffleSession(raffle, v),
    };
  }

  private async state(who: Who): Promise<Json> {
    const s = await this.session(who);
    return Object.fromEntries(
      [
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
        // The extension only re-reads /state after its first load: live catalog and prices follow.
        'modules',
      ].map((k) => [k, s[k]]),
    );
  }

  /** Tombola in the shape the extension expects (its own screen reads /raffle/state). */
  private raffleSession(r: Json | null, v: Viewer | null): Json {
    const cur = (r?.current ?? null) as {
      raffle_id: string;
      status: string;
      jackpot: number;
      ends_at: string;
      closed_at: string | null;
    } | null;
    const open = cur?.status === 'open';
    const participants = (r?.participants ?? []) as {
      display_name: string;
    }[];
    const history = (r?.history ?? []) as {
      drawn_at: string;
      jackpot: number;
      winners: { display_name: string; amount: number }[];
    }[];
    return {
      open,
      joined: open && r?.joined === true,
      window_id: cur?.raffle_id ?? 'none',
      token: cur?.raffle_id ?? 'none',
      ends_in_s: open
        ? Math.max(
            0,
            Math.round((Date.parse(cur!.ends_at) - Date.now()) / 1000),
          )
        : 0,
      ends_at: open ? cur!.ends_at : undefined,
      closed_at: open ? undefined : (cur?.closed_at ?? undefined),
      viewer_login: v?.display_name ?? null,
      total: cur?.jackpot ?? 0,
      currency: 'jetons',
      participant_count: open ? participants.length : 0,
      participants: open
        ? participants.map((p) => ({
            login: p.display_name,
            display_name: p.display_name,
            source: 'extension',
          }))
        : [],
      history: history.map((h) => ({
        created_at: h.drawn_at,
        pot: h.jackpot,
        currency: 'jetons',
        winners: h.winners.map((w) => ({
          login: w.display_name,
          amount: w.amount,
        })),
      })),
    };
  }

  private async ttsState(who: Who): Promise<ExtReply> {
    const s = await this.session(who);
    const tts = (s.modules as Json[]).find((m) => m.id === 'tts');
    return ok({
      tts_v2: tts?.tts_v2 ?? null,
      wallet: s.wallet,
      pending_actions: [],
    });
  }

  private viewerPreferences(
    who: Who,
    method: string,
    body: Json | undefined,
  ): ExtReply {
    if (!who.viewer) return fail(403, 'identity_required');
    if (method === 'POST') {
      if (typeof body?.level_up_sfx_opt_in !== 'boolean')
        return fail(400, 'invalid_payload');
      this.preferences.set(who.viewer.id, body.level_up_sfx_opt_in);
    }
    return ok({
      level_up_sfx_opt_in: this.preferences.get(who.viewer.id) ?? false,
    });
  }

  // --- actions (simulated payment: Lab test wallet) ----------------------------------------------

  private async spend(
    who: Who,
    body: Json,
    key: string | undefined,
    payment: 'tokens' | 'credits',
  ): Promise<ExtReply> {
    if (!who.viewer) return fail(403, 'identity_required');
    if (
      payment === 'credits' &&
      body.module_id !== 'tts' &&
      body.module_id !== 'soundboard'
    )
      return fail(400, 'unsupported_payment');
    if (!key || key.length < 8 || key.length > 128)
      return fail(400, 'idempotency_key_required');
    const viewer = { id: who.viewer.id, display_name: who.viewer.display_name };
    const payload = (body.payload ?? {}) as Json;
    const base = {
      channel_id: this.C,
      viewer,
      idempotency_key: key,
      lab_session_id: `ext-${this.config.environment}`,
    };
    const simulated = (module: string, i: Json, extra: Json = {}) =>
      ok({
        status: i.status,
        module_id: module,
        reference_id: i.interaction_id,
        interaction: i,
        charged: false,
        test_mode: true,
        payment_mode: 'simulated',
        cost: i.simulated_cost,
        ...extra,
      });
    try {
      switch (body.module_id) {
        case 'bonk': {
          // Salve (lot 5, mode Auto): every shot admitted and paid at once, or nothing.
          if (Array.isArray(payload.shots)) {
            const shots = payload.shots as Json[];
            if (
              !shots.length ||
              shots.some(
                (s) =>
                  !BONK_PROVIDERS.includes(String(s?.emote_source)) ||
                  typeof s?.emote !== 'string',
              ) ||
              typeof payload.cadence_ms !== 'number'
            )
              return fail(400, 'invalid_payload');
            const out = await this.core<{
              volley_id: string;
              interactions: Json[];
              replayed: boolean;
            }>('/v1/lab/bonk/volleys', {
              ...base,
              emotes: shots.map((s) => {
                const provider = String(s.emote_source);
                return {
                  provider,
                  id: String(s.emote),
                  glyph:
                    provider === 'unicode' && typeof s.emote_glyph === 'string'
                      ? s.emote_glyph
                      : null,
                };
              }),
              cadence_ms: payload.cadence_ms,
            });
            return ok({
              status: 'queued',
              module_id: 'bonk',
              reference_id: out.volley_id,
              volley_id: out.volley_id,
              interactions: out.interactions,
              replayed: out.replayed,
              charged: false,
              test_mode: true,
              payment_mode: 'simulated',
              cost: out.interactions.reduce(
                (sum, i) => sum + Number(i.simulated_cost),
                0,
              ),
            });
          }
          if (
            !BONK_PROVIDERS.includes(String(payload.emote_source)) ||
            !Array.isArray(payload.emotes) ||
            payload.emotes.length !== 1
          )
            return fail(400, 'invalid_payload');
          const provider = String(payload.emote_source);
          const out = await this.core<{ interaction: Json }>(
            '/v1/lab/bonk/interactions',
            {
              ...base,
              emote: {
                provider,
                id: String(payload.emotes[0]),
                glyph:
                  provider === 'unicode' &&
                  typeof payload.emote_glyph === 'string'
                    ? payload.emote_glyph
                    : null,
              },
            },
          );
          return simulated('bonk', out.interaction);
        }
        case 'soundboard': {
          if (typeof payload.sound_id !== 'string' || !payload.sound_id)
            return fail(400, 'invalid_payload');
          const out = await this.core<{ interaction: Json; replayed: boolean }>(
            '/v1/lab/sound/interactions',
            { ...base, sound_id: payload.sound_id, payment_method: payment },
          );
          if (!out.replayed)
            this.receipt(who.viewer.id, {
              id: out.interaction.interaction_id,
              action: 'soundboard',
              label: 'Soundboard',
              detail: out.interaction.sound_label ?? payload.sound_id,
              currency: payment === 'credits' ? 'credits_soundboard' : 'jetons',
              cost: out.interaction.simulated_cost,
              status: out.interaction.status,
              created_at: out.interaction.created_at,
            });
          return simulated('soundboard', out.interaction);
        }
        case 'tts': {
          if (typeof payload.text !== 'string')
            return fail(400, 'invalid_payload');
          const out = await this.core<{
            interaction: Json;
            queue: unknown;
            replayed: boolean;
          }>('/v1/lab/tts/interactions', {
            ...base,
            text: payload.text,
            payment_method: payment,
          });
          if (!out.replayed)
            this.receipt(who.viewer.id, {
              id: out.interaction.interaction_id,
              action: 'tts',
              label: 'TTS',
              detail: out.interaction.message,
              currency: payment === 'credits' ? 'credits_tts' : 'jetons',
              cost: out.interaction.simulated_cost,
              status: 'queued',
              created_at: out.interaction.created_at,
            });
          return simulated('tts', out.interaction, {
            queue: out.queue,
            replayed: out.replayed,
          });
        }
        default:
          return fail(400, 'invalid_module');
      }
    } catch (e) {
      return refused(e);
    }
  }

  private receipt(viewerId: string, r: Json) {
    // ponytail: in-process history of this viewer's TTS / Soundboard (lost on restart); Core's
    // moderation ledger stays the source of truth.
    if (this.receipts.size > 5000) this.receipts.clear();
    this.receipts.set(
      viewerId,
      [r, ...(this.receipts.get(viewerId) ?? [])].slice(0, MAX_RECEIPTS),
    );
  }

  // --- Tombola -------------------------------------------------------------------------------------

  private async raffleState(who: Who): Promise<ExtReply> {
    const v = who.viewer;
    try {
      const [raffle, wallet] = await Promise.all([
        this.core<Json>(
          `/v1/lab/raffle/${this.C}/viewer${v ? `?viewer=${v.id}` : ''}`,
        ),
        v
          ? this.core<{ tokens: number }>(
              `/v1/lab/wallet/${this.C}/${v.id}`,
            ).catch(() => null)
          : null,
      ]);
      return ok({
        raffle_v2: raffle,
        me: v ? { viewer_id: v.id, display_name: v.display_name } : null,
        wallet: wallet
          ? { points: wallet.tokens, reserved: 0, available: wallet.tokens }
          : { unavailable: true },
      });
    } catch (e) {
      return refused(e);
    }
  }

  private async joinRaffle(
    who: Who,
    key: string | undefined,
  ): Promise<ExtReply> {
    if (!who.viewer) return fail(403, 'identity_required');
    if (!key || key.length < 8 || key.length > 128)
      return fail(400, 'idempotency_key_required');
    try {
      const out = await this.core<{ raffle_id: string; replayed: boolean }>(
        '/v1/lab/raffle/entries',
        {
          channel_id: this.C,
          viewer: { id: who.viewer.id, display_name: who.viewer.display_name },
          idempotency_key: key,
        },
      );
      return ok({
        joined: true,
        duplicate: out.replayed,
        already_joined: out.replayed,
        window_id: out.raffle_id,
        raffle_token: out.raffle_id,
        source: 'extension',
      });
    } catch (e) {
      return refused(e);
    }
  }

  // --- moderation (team only: broadcaster / moderator from the JWT) --------------------------------

  /** D4 console of the extension: Core read models and commands, with the verified caller as actor. */
  private async moderationV2(
    method: string,
    path: string,
    query: string,
    body: Json | undefined,
    who: Who,
    key: string | undefined,
  ): Promise<ExtReply> {
    const C = this.C;
    const qs = new URLSearchParams(query);
    const actor = this.actor(who);
    // Core refuses its read models to a viewer: the reader is named on every read.
    const as = `as=${actor.id}&as_role=${actor.role}`;
    const pass = (keys: string[]) => {
      const out = new URLSearchParams();
      for (const k of keys) if (qs.get(k)) out.set(k, qs.get(k)!.slice(0, 64));
      return out.toString();
    };
    try {
      let m: RegExpExecArray | null;
      if (method === 'GET' && path === '/moderation/v2/team')
        return ok(await this.core<Json>(`/v1/lab/moderation/${C}/team?${as}`));
      if (method === 'GET' && path === '/moderation/v2/words')
        return ok(await this.core<Json>(`/v1/lab/moderation/${C}/words?${as}`));
      if (method === 'GET' && path === '/moderation/v2/interactions')
        return ok(
          await this.core<Json>(
            `/v1/lab/moderation/${C}/interactions?${as}&${pass(['module', 'status', 'viewer', 'q', 'period', 'before', 'limit'])}`,
          ),
        );
      if (
        method === 'GET' &&
        (m = /^\/moderation\/v2\/interactions\/([0-9a-f-]{36})$/.exec(path))
      )
        return ok(
          await this.core<Json>(
            `/v1/lab/moderation/${C}/interactions/${m[1]}?${as}`,
          ),
        );
      if (method === 'GET' && path === '/moderation/v2/ledger')
        return ok(
          await this.core<Json>(
            `/v1/lab/moderation/${C}/ledger?${as}&${pass(['viewer', 'before', 'limit', 'auto'])}`,
          ),
        );
      if (method === 'GET' && path === '/moderation/v2/whoami')
        return ok({
          ...(await this.core<Json>(`/v1/lab/moderation/${C}/whoami`, actor)),
          actor,
        });
      if (method === 'GET' && path === '/moderation/v2/overview') {
        const me = await this.core<Json>(
          `/v1/lab/moderation/${C}/whoami`,
          actor,
        );
        const overview = await this.core<Json>(
          `/v1/lab/moderation/${C}/overview?${as}`,
        );
        return ok({ ...overview, me: { ...me, actor } });
      }
      if (method === 'GET' && path === '/moderation/v2/search')
        return ok(
          await this.core<Json>(
            `/v1/lab/moderation/${C}/search?${as}&q=${encodeURIComponent((qs.get('q') ?? '').slice(0, 40))}`,
          ),
        );
      if (
        method === 'GET' &&
        (m = /^\/moderation\/v2\/viewers\/(\d{1,32})$/.exec(path))
      )
        return ok(
          await this.core<Json>(
            `/v1/lab/moderation/${C}/viewers/${m[1]}?${as}`,
          ),
        );
      if (method === 'GET' && path === '/moderation/v2/audit')
        return ok(
          await this.core<Json>(
            `/v1/lab/moderation/${C}/audit?${as}&${pass(['module', 'viewer', 'limit'])}`,
          ),
        );
      if (method === 'POST' && path === '/moderation/v2/actions')
        // The client's Idempotency-Key goes to Core: a retried action is answered, never applied twice.
        return ok(
          await this.core<Json>(`/v1/lab/moderation/${C}/actions`, {
            actor,
            command: body?.command,
            ...(key ? { idempotency_key: key } : {}),
          }),
        );
      return fail(404, 'not_found');
    } catch (e) {
      return refused(e);
    }
  }

  /** The TTS controls of the TTS screen (moderators): the same Core commands as the D4 console. */
  private async legacyModeration(
    method: string,
    path: string,
    body: Json | undefined,
    who: Who,
  ): Promise<ExtReply> {
    const tts = /^\/moderation\/tts\/(pause|resume|stop|purge)$/.exec(path);
    if (method !== 'POST' || !tts) return fail(404, 'not_available');
    const action = tts[1]!;
    const command =
      action === 'stop'
        ? { action: 'stop_current', module: 'tts', refund: false }
        : action === 'purge'
          ? { action: 'purge', module: 'tts', refund: false }
          : {
              action: 'module_state',
              module: 'tts',
              state: action === 'pause' ? 'paused' : 'active',
              waiting: 'keep',
            };
    try {
      await this.core<Json>(`/v1/lab/moderation/${this.C}/actions`, {
        actor: this.actor(who),
        command,
      });
    } catch (e) {
      const reply = refused(e);
      if (reply.status === 409 && reply.body.error === 'nothing_playing')
        return ok({
          action,
          command_id: String(body?.command_id ?? ''),
          status: 'no_active',
          final_status: 'no_active',
        });
      return reply;
    }
    return ok({
      action,
      command_id: String(body?.command_id ?? ''),
      status: 'executed',
      final_status: 'executed',
    });
  }
}
