import {
  BonkLabProvider,
  type BonkLabCatalog,
  type BonkLabThirdPartyCatalog,
  type BonkLabViewer,
} from '@raptoru/schemas';

const BONK_PROVIDERS: readonly BonkLabProvider[] = BonkLabProvider.options;
import type { ViewerAuth } from '../bonk-lab/viewer-auth.js';
import type { BonkWorker } from '../bonk-lab/worker.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Local EBS of the Extension Lab: answers the production extension with the same contract as the
// real EBS (JSON, `{ ok: false, error: code }` on failure, Idempotency-Key replays), from an
// in-memory lab state. Jetons are fictitious; nothing reaches StreamElements, SAMMI, Twitch or the
// Core Wallet. Every accepted action becomes a lab event that the Studio plays on its local stage
// (sound, TTS voice, Bonk, raffle), so interactions are testable without a stream.
//
// Session data (modules, emote catalog, raffle shape…) comes from the extension's own demo fixture
// (shared/demo-data.js), so the lab follows the contract the extension was built against.

export type LabRole = 'viewer' | 'moderator' | 'broadcaster';
type Json = Record<string, unknown>;
type ModuleId = 'tts' | 'soundboard' | 'bonk' | 'raffle_join';

export interface LabIdentity {
  role: LabRole;
  twitchUserId: string;
  login: string;
  displayName: string;
}

/** Fictitious identities (no real Twitch account), one per simulated role. */
export const LAB_IDENTITIES: Record<LabRole, LabIdentity> = {
  viewer: {
    role: 'viewer',
    twitchUserId: '900101',
    login: 'lab_viewer',
    displayName: 'Viewer Lab',
  },
  moderator: {
    role: 'moderator',
    twitchUserId: '900102',
    login: 'lab_modo',
    displayName: 'Modo Lab',
  },
  broadcaster: {
    role: 'broadcaster',
    twitchUserId: '900100',
    login: 'raptoru_lab',
    displayName: 'Raptoru_ (lab)',
  },
};
export const LAB_CHANNEL = { id: '900100', login: 'raptoru_lab' };

export interface LabEvent {
  seq: number;
  at: string;
  kind:
    | 'soundboard'
    | 'tts'
    | 'bonk'
    | 'raffle_join'
    | 'tts_submitted'
    | 'moderation'
    | 'refused';
  viewer: string;
  role: LabRole;
  currency: 'jetons' | 'channelpoints' | 'free' | 'lab';
  cost: number;
  detail: string;
  /** What the local stage needs to render the effect. */
  effect: Json;
}

interface LabUser {
  wallet: number;
  credits: { tts: number; soundboard: number };
  pending: Json[];
  receipts: Json[];
  levelUpSfx: boolean;
}

interface Reply {
  status: number;
  body: Json;
}

const MODULES: ModuleId[] = ['tts', 'soundboard', 'bonk', 'raffle_join'];
const DEFAULT_WALLET = 12_000;
const MAX_EVENTS = 200;

type DemoFactory = (scenario?: string, options?: object) => Json;

/** Soundboard catalog from the real sound files shipped with the extension. */
export function soundCatalog(soundsDir: string): Json[] {
  const human = (id: string) =>
    id
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 40);
  return readdirSync(soundsDir)
    .filter((f) => f.endsWith('.mp3'))
    .sort()
    .map((file) => {
      const id = file.replace(/\.mp3$/, '');
      return {
        id,
        label: human(id),
        emoji: '🔊',
        credit_cost: 1,
        token_cost: 500,
        preview_url: `assets/sounds/${file}`,
      };
    });
}

/** Lab token built by the local Twitch helper: `lab.` + base64url JSON. Never a Twitch JWT. */
export function parseLabToken(
  authorization: string | undefined,
): { identity: LabIdentity; identityShared: boolean } | null {
  const match = /^Bearer lab\.([A-Za-z0-9_-]+)$/.exec(authorization ?? '');
  if (!match) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(match[1]!, 'base64url').toString('utf8'),
    ) as { role?: string; identity_shared?: boolean };
    const role = (['viewer', 'moderator', 'broadcaster'] as const).find(
      (r) => r === claims.role,
    );
    if (!role) return null;
    return {
      identity: LAB_IDENTITIES[role],
      identityShared: claims.identity_shared !== false,
    };
  } catch {
    return null;
  }
}

/**
 * Personal Twitch catalog (from Core) → picker groups: one group per emote owner (channel), globals
 * last. Only ids and Core-built CDN URLs; the picker sends back `twitch:<id>`, never a URL.
 */
export function twitchGroups(catalog: BonkLabCatalog): Json[] {
  const owners = new Map(catalog.owners.map((o) => [o.id, o]));
  const groups = new Map<string, Json & { emotes: Json[] }>();
  for (const e of catalog.emotes) {
    const owner = owners.get(e.owner_id);
    const key = owner ? `twitch-channel-${owner.id}` : 'twitch-global';
    if (!groups.has(key))
      groups.set(key, {
        id: key,
        label: owner?.display_name ?? 'Twitch',
        icon: 'twitch',
        source: 'twitch',
        provider: 'twitch',
        scope: owner ? 'channel' : 'global',
        ...(owner
          ? {
              channel_id: owner.id,
              channel_login: owner.login,
              channel_display_name: owner.display_name,
              ...(owner.profile_image_url
                ? { channel_avatar_url: owner.profile_image_url }
                : {}),
            }
          : {}),
        emotes: [],
      });
    groups.get(key)!.emotes.push({
      id: `twitch:${e.id}`,
      label: e.name,
      source: 'twitch',
      provider: 'twitch',
      image_url: e.url,
      // Grid shows the static frame; the picker swaps to image_url on hover/selection.
      static_url: e.static_url,
      animated: e.animated,
      emote_set_id: e.emote_set_id,
      emote_type: e.emote_type,
    });
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.scope === 'global') - Number(b.scope === 'global'),
  );
}

/**
 * 7TV/BTTV/FFZ catalog (resolved by Core) -> picker groups: one group per provider and scope
 * (channel, then globals). The extension only ever sends back `provider` + `provider:id`.
 */
export function thirdPartyGroups(catalog: BonkLabThirdPartyCatalog): Json[] {
  const groups: Json[] = [];
  for (const provider of ['7tv', 'bttv', 'ffz'] as const)
    for (const scope of ['channel', 'global'] as const) {
      const emotes = catalog.emotes.filter(
        (e) => e.provider === provider && e.scope === scope,
      );
      if (!emotes.length) continue;
      groups.push({
        id: `${provider}-${scope}`,
        label:
          scope === 'global'
            ? 'Globales'
            : (catalog.channel_display_name ?? 'Chaîne'),
        source: provider,
        provider,
        scope,
        emotes: emotes.map((e) => ({
          id: `${provider}:${e.id}`,
          label: e.name,
          source: provider,
          provider,
          image_url: e.url,
          animated: e.animated,
        })),
      });
    }
  return groups;
}

export class LabEbs {
  private bonkWorker: BonkWorker | null = null;
  private viewerAuth: ViewerAuth | null = null;
  private thirdPartyCatalog:
    ((refresh?: boolean) => Promise<BonkLabThirdPartyCatalog>) | null = null;
  /** 7TV/BTTV/FFZ groups of the channel (last good catalog kept on a failed refresh). */
  private thirdParty: { groups: Json[]; at: number } = { groups: [], at: 0 };

  private thirdPartyLoading: Promise<void> | null = null;

  /** Same stale-while-revalidate rule as the Twitch catalog (never blocks once known). */
  private async refreshThirdParty(force = false) {
    if (!this.thirdPartyCatalog) return;
    if (!force && Date.now() - this.thirdParty.at < 60_000) return;
    if (force) return this.loadThirdParty(true);
    this.thirdPartyLoading ??= this.loadThirdParty(false).finally(() => {
      this.thirdPartyLoading = null;
    });
    if (!this.thirdParty.groups.length) await this.thirdPartyLoading;
  }

  private async loadThirdParty(force: boolean) {
    if (!this.thirdPartyCatalog) return;
    try {
      const groups = thirdPartyGroups(await this.thirdPartyCatalog(force));
      this.thirdParty = {
        groups: groups.length ? groups : this.thirdParty.groups,
        at: Date.now(),
      };
    } catch {
      // Core not ready yet (e.g. warm-up at startup) or unreachable: keep the last groups and
      // retry shortly instead of caching the failure for a minute.
      this.thirdParty = { ...this.thirdParty, at: Date.now() - 55_000 };
    }
  }
  /** Linked real Twitch viewer (Bonk Lab) and its catalog, refreshed from Core. */
  private twitch: {
    viewer: BonkLabViewer | null;
    groups: Json[];
    error: string | null;
    at: number;
  } = { viewer: null, groups: [], error: null, at: 0 };
  connectBonk(
    worker: BonkWorker,
    viewerAuth: ViewerAuth | null = null,
    thirdPartyCatalog:
      ((refresh?: boolean) => Promise<BonkLabThirdPartyCatalog>) | null = null,
  ) {
    this.bonkWorker = worker;
    this.viewerAuth = viewerAuth;
    this.thirdPartyCatalog = thirdPartyCatalog;
    // Warm the public 7TV/BTTV/FFZ catalog now: extension requests never wait for it.
    void this.refreshThirdParty();
  }

  /** ViewerAuth generation already reflected in `twitch` (a new link invalidates the cache). */
  private twitchGeneration = -1;

  private twitchLoading: Promise<void> | null = null;

  /**
   * Stale-while-revalidate: with a catalog already known for the same linked viewer, answer now
   * and reload in the background. A Helix reload takes 8-9 s for a big catalog (measured with
   * 1141 emotes), around the extension request timeout (8 s). A forced refresh waits for it at
   * most 6 s when a catalog is already known, then answers with it (the reload still completes).
   */
  private async refreshTwitch(force = false) {
    if (!this.viewerAuth) return;
    const generation = this.viewerAuth.generation;
    const sameViewer = generation === this.twitchGeneration;
    if (!force && sameViewer && Date.now() - this.twitch.at < 5000) return;
    if (force) {
      const load = this.loadTwitch(generation, true);
      if (!(sameViewer && this.twitch.viewer)) return load;
      await Promise.race([load, new Promise((r) => setTimeout(r, 6000))]);
      return;
    }
    this.twitchLoading ??= this.loadTwitch(generation, false).finally(() => {
      this.twitchLoading = null;
    });
    if (!(sameViewer && this.twitch.viewer)) await this.twitchLoading;
  }

  private async loadTwitch(generation: number, force: boolean) {
    if (!this.viewerAuth) return;
    this.twitchGeneration = generation;
    try {
      const viewer = (await this.viewerAuth.viewers()).viewers[0] ?? null;
      let groups: Json[] = [];
      let error: string | null = null;
      if (viewer) {
        try {
          groups = twitchGroups(
            await this.viewerAuth.catalog(viewer.user_id, force),
          );
        } catch (e) {
          error = (e as Error).message;
          // Never replace a good catalog with an empty one on a failed reload: keep the last
          // catalog of the same viewer (the extension would otherwise store the empty one).
          if (this.twitch.viewer?.user_id === viewer.user_id)
            groups = this.twitch.groups;
        }
      }
      this.twitch = {
        viewer: error === 'reauth_required' ? null : viewer,
        groups,
        error,
        at: Date.now(),
      };
    } catch {
      this.twitch = {
        ...this.twitch,
        error: 'core_unavailable',
        at: Date.now(),
      };
    }
  }

  private users = new Map<string, LabUser>();
  private modules: Record<ModuleId, boolean> = {
    tts: true,
    soundboard: true,
    bonk: true,
    raffle_join: true,
  };
  private raffle = {
    open: false,
    windowId: 'lab-raffle-0',
    endsAt: 0,
    participants: [] as {
      login: string;
      display_name: string;
      source: string;
    }[],
    history: [] as Json[],
  };
  private tts = {
    mode: 'instant' as 'instant' | 'approval',
    paused: false,
    pending: [] as Json[],
  };
  private events: LabEvent[] = [];
  private seq = 0;
  private replies = new Map<string, Reply>();

  private constructor(
    private readonly demo: DemoFactory,
    private readonly sounds: Json[],
    private readonly now: () => Date,
  ) {}

  static async create(
    extensionDir: string,
    now: () => Date = () => new Date(),
  ): Promise<LabEbs> {
    const mod = (await import(
      pathToFileURL(join(extensionDir, 'shared', 'demo-data.js')).href
    )) as { createDemoSession: DemoFactory };
    return new LabEbs(
      mod.createDemoSession,
      soundCatalog(join(extensionDir, 'assets', 'sounds')),
      now,
    );
  }

  // --- Studio side ------------------------------------------------------------------------------

  /** Lab state + events after `since`, for the Studio's control panel and local stage. */
  snapshot(since = 0) {
    this.expireRaffle();
    return {
      mode: 'lab' as const,
      safety:
        'fictitious jetons: no StreamElements, no SAMMI, no Twitch write, no Core Wallet',
      identities: LAB_IDENTITIES,
      wallets: Object.fromEntries(
        (Object.keys(LAB_IDENTITIES) as LabRole[]).map((r) => [
          r,
          this.user(LAB_IDENTITIES[r].twitchUserId).wallet,
        ]),
      ),
      modules: { ...this.modules },
      raffle: {
        open: this.raffle.open,
        endsInSeconds: this.raffleEndsIn(),
        participants: this.raffle.participants.length,
      },
      tts: {
        mode: this.tts.mode,
        paused: this.tts.paused,
        pending: this.tts.pending.length,
      },
      lastSeq: this.seq,
      events: this.events.filter((e) => e.seq > since),
    };
  }

  /** Studio controls (local only). */
  control(action: string, args: Json = {}): Json {
    switch (action) {
      case 'reset':
        this.users.clear();
        this.modules = {
          tts: true,
          soundboard: true,
          bonk: true,
          raffle_join: true,
        };
        this.raffle = {
          open: false,
          windowId: `lab-raffle-${this.seq}`,
          endsAt: 0,
          participants: [],
          history: [],
        };
        this.tts = { mode: 'instant', paused: false, pending: [] };
        this.replies.clear();
        this.events = []; // seq keeps growing: a Studio polling `since` never replays old events
        return { ok: true };
      case 'wallet': {
        const role = args.role as LabRole;
        const amount = Number(args.amount);
        if (!LAB_IDENTITIES[role] || !Number.isInteger(amount) || amount < 0)
          throw new Error('invalid wallet control');
        this.user(LAB_IDENTITIES[role].twitchUserId).wallet = amount;
        return { ok: true };
      }
      case 'module': {
        const id = args.id as ModuleId;
        if (!MODULES.includes(id)) throw new Error('invalid module');
        this.modules[id] = Boolean(args.enabled);
        return { ok: true };
      }
      case 'raffle-open': {
        const seconds = Math.min(600, Math.max(10, Number(args.seconds) || 60));
        this.raffle = {
          ...this.raffle,
          open: true,
          windowId: `lab-raffle-${this.seq + 1}`,
          endsAt: this.now().getTime() + seconds * 1000,
          participants: [],
        };
        return { ok: true };
      }
      case 'raffle-close':
        this.raffle.open = false;
        return { ok: true };
      case 'raffle-draw': {
        const pool = this.raffle.participants;
        const winner = pool.length
          ? pool[Math.floor(Math.random() * pool.length)]!
          : null;
        this.raffle.open = false;
        this.raffle.history = [
          {
            created_at: this.now().toISOString(),
            winners: winner
              ? [{ login: winner.display_name, amount: 5000 }]
              : [],
          },
          ...this.raffle.history,
        ].slice(0, 5);
        return { ok: true, winner: winner?.display_name ?? null };
      }
      case 'tts-pause':
        this.tts.paused = Boolean(args.paused);
        return { ok: true };
      default:
        throw new Error(`unknown lab control ${action}`);
    }
  }

  // --- Extension side (same contract as the production EBS) -------------------------------------

  async handle(
    method: string,
    path: string,
    body: Json | undefined,
    headers: { authorization?: string; idempotencyKey?: string },
  ): Promise<Reply> {
    let caller = parseLabToken(headers.authorization);
    if (!caller) return this.fail(401, 'unauthorized');
    if (this.bonkWorker && (path === '/session' || path.startsWith('/emotes')))
      // Never forced from the extension: Core caches the public catalogs 10 min.
      await this.refreshThirdParty();
    // Bonk Lab with a connected Twitch account: the viewer role IS that account (user_id = token
    // owner), like a real Twitch JWT would say. Other roles keep their fictitious identities.
    if (this.viewerAuth && caller.identity.role === 'viewer') {
      if (path.startsWith('/emotes/oauth/start') && method === 'POST') {
        try {
          return this.ok(await this.viewerAuth.start());
        } catch (e) {
          return this.fail(503, (e as Error).message.split(':')[0]!);
        }
      }
      await this.refreshTwitch(
        path.startsWith('/emotes/refresh') || path.startsWith('/emotes/oauth'),
      );
      const linked = this.twitch.viewer;
      if (path.startsWith('/emotes/oauth/disconnect') && method === 'POST') {
        if (linked)
          await this.viewerAuth
            .disconnect(linked.user_id)
            .catch(() => undefined);
        this.twitch = { viewer: null, groups: [], error: null, at: 0 };
        return this.ok({ revoked: true });
      }
      if (linked && caller.identityShared)
        caller = {
          ...caller,
          identity: {
            role: 'viewer',
            twitchUserId: linked.user_id,
            login: linked.login,
            displayName: linked.display_name,
          },
        };
    }
    // Bonk real Lab execution uses Core idempotency, never the in-memory simulated delivery path.
    if (
      this.bonkWorker &&
      method === 'POST' &&
      body?.module_id === 'bonk' &&
      path.startsWith('/actions/')
    ) {
      if (!caller.identityShared) return this.fail(403, 'identity_required');
      if (!this.modules.bonk) return this.fail(409, 'module_disabled');
      if (!['/actions/tokens', '/actions/lab'].includes(path))
        return this.fail(400, 'unsupported_payment');
      if (path === '/actions/lab' && caller.identity.role === 'viewer')
        return this.fail(403, 'forbidden');
      if (!headers.idempotencyKey)
        return this.fail(400, 'idempotency_key_required');
      const p = body.payload as Json | undefined;
      if (
        !p ||
        !BONK_PROVIDERS.includes(p.emote_source as BonkLabProvider) ||
        !Array.isArray(p.emotes) ||
        p.emotes.length !== 1
      )
        return this.fail(400, 'invalid_payload');
      const provider = p.emote_source as BonkLabProvider;
      try {
        const result = await this.bonkWorker.admit(
          {
            id: caller.identity.twitchUserId,
            display_name: caller.identity.displayName,
          },
          headers.idempotencyKey,
          {
            provider,
            id: String(p.emotes[0]),
            // Only Unicode carries a glyph; Core resolves every image from its own catalog.
            glyph:
              provider === 'unicode' && typeof p.emote_glyph === 'string'
                ? p.emote_glyph
                : null,
          },
        );
        return this.ok({
          status: result.interaction.status,
          module_id: 'bonk',
          reference_id: result.interaction.interaction_id,
          interaction: result.interaction,
          charged: false,
          test_mode: true,
          payment_mode: 'simulated',
          cost: result.interaction.simulated_cost,
        });
      } catch (e) {
        return this.fail(
          (e as { status?: number }).status ?? 503,
          (e as Error).message,
        );
      }
    }
    const key = headers.idempotencyKey
      ? `${caller.identity.twitchUserId}:${headers.idempotencyKey}`
      : null;
    if (key && this.replies.has(key)) return this.replies.get(key)!;
    const reply = this.route(method, path, body ?? {}, caller);
    if (
      this.bonkWorker &&
      method === 'GET' &&
      ['/session', '/state'].includes(path.split('?')[0]!)
    ) {
      try {
        const { interactions } = await this.bonkWorker.recent(
          caller.identity.twitchUserId,
        );
        reply.body.action_receipts = [
          ...interactions.map((i) => ({
            id: i.interaction_id,
            action: 'bonk',
            label: 'Bonk Lab',
            detail: i.status,
            currency: 'lab',
            cost: i.simulated_cost,
            status: i.status,
            created_at: i.created_at,
          })),
          ...((reply.body.action_receipts as Json[]) ?? []),
        ];
      } catch {
        /* Studio status separately shows Core unavailable; admission fails closed. */
      }
    }
    if (key && method === 'POST') this.replies.set(key, reply);
    return reply;
  }

  private route(
    method: string,
    rawPath: string,
    body: Json,
    caller: { identity: LabIdentity; identityShared: boolean },
  ): Reply {
    const path = rawPath.split('?', 1)[0]!;
    const { identity, identityShared } = caller;
    const isMod = identity.role !== 'viewer';
    this.expireRaffle();

    if (method === 'GET' && path === '/session')
      return this.ok(this.session(identity, identityShared));
    if (method === 'GET' && path === '/state') {
      const s = this.session(identity, identityShared);
      return this.ok(
        Object.fromEntries(
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
          ].map((k) => [k, s[k]]),
        ),
      );
    }
    if (path === '/viewer/preferences') {
      const user = this.user(identity.twitchUserId);
      if (method === 'POST') {
        if (typeof body.level_up_sfx_opt_in !== 'boolean')
          return this.fail(400, 'invalid_payload');
        user.levelUpSfx = body.level_up_sfx_opt_in;
      }
      return this.ok({ level_up_sfx_opt_in: user.levelUpSfx });
    }
    if (path === '/emotes' || path === '/emotes/refresh')
      return this.ok({
        connected: true,
        twitch_connected: this.viewerAuth ? Boolean(this.twitch.viewer) : true,
        ...(this.twitch.error ? { twitch_error: this.twitch.error } : {}),
        groups: [...this.twitch.groups, ...this.bonkGroups()],
      });

    // Identity is required for anything that spends or joins (like the real EBS).
    const needsIdentity =
      path.startsWith('/actions/') &&
      !identityShared &&
      path !== '/actions/lab';
    if (needsIdentity) return this.fail(403, 'identity_required');

    if (method === 'POST' && path === '/actions/tokens')
      return this.spendTokens(identity, body);
    if (method === 'POST' && path === '/actions/redemption')
      return this.useRedemption(identity, body);
    if (method === 'POST' && path === '/actions/raffle')
      return this.joinRaffle(identity);
    if (method === 'POST' && path === '/actions/lab') {
      if (!isMod) return this.fail(403, 'forbidden');
      const moduleId = String(body.module_id ?? '');
      this.emit(
        identity,
        moduleId === 'tts' ? 'tts' : 'bonk',
        'lab',
        0,
        'test',
        this.effect(moduleId, (body.payload ?? {}) as Json),
      );
      return this.ok({ status: 'played', module_id: moduleId });
    }

    if (path.startsWith('/moderation/')) {
      if (!isMod) return this.fail(403, 'forbidden');
      return this.moderation(method, path, body, identity);
    }
    return this.fail(404, 'not_available_in_lab');
  }

  private spendTokens(identity: LabIdentity, body: Json): Reply {
    const moduleId = String(body.module_id ?? '') as ModuleId;
    const payload = (body.payload ?? {}) as Json;
    if (!MODULES.includes(moduleId) || moduleId === 'raffle_join')
      return this.fail(400, 'invalid_module');
    if (!this.modules[moduleId]) return this.fail(409, 'module_disabled');
    const cost = this.costOf(moduleId, payload);
    if (cost === null) return this.fail(400, 'invalid_payload');
    if (moduleId === 'tts' && this.tts.paused)
      return this.fail(409, 'tts_paused');
    const user = this.user(identity.twitchUserId);
    if (user.wallet < cost) {
      this.emit(
        identity,
        'refused',
        'jetons',
        0,
        `${moduleId}: pas assez de jetons`,
        {},
      );
      return this.fail(409, 'insufficient_tokens');
    }
    if (moduleId === 'tts' && this.tts.mode === 'approval')
      return this.submitTts(identity, payload, 'jetons', cost, null);
    user.wallet -= cost;
    return this.deliver(identity, moduleId, payload, 'jetons', cost);
  }

  private useRedemption(identity: LabIdentity, body: Json): Reply {
    const user = this.user(identity.twitchUserId);
    const index = user.pending.findIndex(
      (p) => p.redemption_id === body.redemption_id,
    );
    if (index === -1) return this.fail(404, 'redemption_not_found');
    const moduleId = String(body.module_id ?? '') as ModuleId;
    if (user.pending[index]!.module_id !== moduleId)
      return this.fail(409, 'redemption_wrong_reward');
    if (!this.modules[moduleId]) return this.fail(409, 'module_disabled');
    if (moduleId === 'tts' && this.tts.mode === 'approval')
      return this.submitTts(
        identity,
        (body.payload ?? {}) as Json,
        'channelpoints',
        1000,
        String(body.redemption_id),
      );
    user.pending.splice(index, 1);
    const creditKey = moduleId === 'tts' ? 'tts' : 'soundboard';
    user.credits[creditKey] = Math.max(0, user.credits[creditKey] - 1);
    return this.deliver(
      identity,
      moduleId,
      (body.payload ?? {}) as Json,
      'channelpoints',
      1000,
    );
  }

  private deliver(
    identity: LabIdentity,
    moduleId: ModuleId,
    payload: Json,
    currency: 'jetons' | 'channelpoints',
    cost: number,
  ): Reply {
    const effect = this.effect(moduleId, payload);
    const receipt = {
      id: `lab-${this.seq + 1}`,
      action: moduleId,
      label: {
        tts: 'TTS',
        soundboard: 'Soundboard',
        bonk: 'Bonk',
        raffle_join: 'Tombola',
      }[moduleId],
      detail: String(effect.label ?? effect.text ?? ''),
      currency,
      cost,
      status: 'played',
      created_at: this.now().toISOString(),
    };
    this.user(identity.twitchUserId).receipts.unshift(receipt);
    this.emit(identity, moduleId, currency, cost, receipt.detail, effect);
    return this.ok({
      status: 'settled',
      module_id: moduleId,
      cost,
      reference_id: receipt.id,
    });
  }

  /**
   * TTS in approval mode: queued for a moderator, nothing consumed yet (as the extension tells the
   * viewer). Jetons or the channel-points redemption are consumed only on approval.
   */
  private submitTts(
    identity: LabIdentity,
    payload: Json,
    currency: 'jetons' | 'channelpoints',
    cost: number,
    redemptionId: string | null,
  ): Reply {
    const submission = {
      submission_id: `lab-tts-${this.seq + 1}`,
      twitch_user_id: identity.twitchUserId,
      login: identity.login,
      currency,
      cost,
      redemption_id: redemptionId,
      text: String(payload.text ?? '').slice(0, 800),
      created_at: this.now().toISOString(),
    };
    this.tts.pending.push(submission);
    this.emit(identity, 'tts_submitted', currency, 0, submission.text, {});
    return this.ok({
      status: 'pending_review',
      module_id: 'tts',
      cost: 0,
      reference_id: submission.submission_id,
    });
  }

  /** Approval of a queued TTS: consume the payment now, or refuse if it is no longer possible. */
  private settleTts(submission: Json, moderator: LabIdentity): Reply {
    const role = (Object.keys(LAB_IDENTITIES) as LabRole[]).find(
      (r) => LAB_IDENTITIES[r].twitchUserId === submission.twitch_user_id,
    )!;
    const author = LAB_IDENTITIES[role];
    const user = this.user(author.twitchUserId);
    const cost = Number(submission.cost);
    if (submission.currency === 'jetons') {
      if (user.wallet < cost) {
        this.emit(
          author,
          'refused',
          'jetons',
          0,
          'TTS validé mais solde insuffisant',
          {},
        );
        return this.fail(409, 'insufficient_tokens');
      }
      user.wallet -= cost;
    } else {
      const index = user.pending.findIndex(
        (p) => p.redemption_id === submission.redemption_id,
      );
      if (index === -1) return this.fail(404, 'redemption_not_found');
      user.pending.splice(index, 1);
      user.credits.tts = Math.max(0, user.credits.tts - 1);
    }
    const text = String(submission.text);
    user.receipts.unshift({
      id: String(submission.submission_id),
      action: 'tts',
      label: 'TTS',
      detail: text,
      currency: submission.currency,
      cost,
      status: 'played',
      created_at: this.now().toISOString(),
    });
    this.emit(
      author,
      'tts',
      submission.currency as 'jetons' | 'channelpoints',
      cost,
      text,
      {
        text,
        voice: 'fr-FR',
        approvedBy: moderator.displayName,
      },
    );
    return this.ok({ status: 'approved' });
  }

  private joinRaffle(identity: LabIdentity): Reply {
    if (!this.modules.raffle_join) return this.fail(409, 'module_disabled');
    if (!this.raffle.open) return this.fail(409, 'raffle_closed');
    const already = this.raffle.participants.some(
      (p) => p.login === identity.login,
    );
    if (!already) {
      this.raffle.participants.push({
        login: identity.login,
        display_name: identity.displayName,
        source: 'extension',
      });
      this.emit(identity, 'raffle_join', 'free', 0, 'Tombola', {});
    }
    return this.ok({
      joined: true,
      duplicate: already,
      already_joined: already,
      window_id: this.raffle.windowId,
      raffle_token: this.raffle.windowId,
      source: 'extension',
    });
  }

  private moderation(
    method: string,
    path: string,
    body: Json,
    identity: LabIdentity,
  ): Reply {
    const settings = () => ({ ...this.ttsModeration(true) });
    if (
      method === 'POST' &&
      (path === '/moderation/tts/pause' || path === '/moderation/tts/resume')
    ) {
      this.tts.paused = path.endsWith('/pause');
      const commandId = String(body.command_id ?? `lab-${this.seq}`);
      this.emit(
        identity,
        'moderation',
        'lab',
        0,
        this.tts.paused ? 'TTS en pause' : 'TTS repris',
        {},
      );
      return this.ok({
        action: this.tts.paused ? 'pause' : 'resume',
        command_id: commandId,
        status: 'executed',
        final_status: 'executed',
        settings: settings(),
      });
    }
    if (method === 'POST' && path === '/moderation/tts/settings') {
      if (body.mode === 'instant' || body.mode === 'approval')
        this.tts.mode = body.mode;
      if (typeof body.paused === 'boolean') this.tts.paused = body.paused;
      return this.ok({ settings: settings() });
    }
    const decision =
      /^\/moderation\/tts\/submissions\/([^/]+)\/(approve|reject)$/.exec(path);
    if (method === 'POST' && decision) {
      const index = this.tts.pending.findIndex(
        (p) => p.submission_id === decision[1],
      );
      if (index === -1) return this.fail(404, 'not_found');
      const [submission] = this.tts.pending.splice(index, 1);
      if (decision[2] === 'approve')
        return this.settleTts(submission!, identity);
      this.emit(
        identity,
        'moderation',
        'lab',
        0,
        'TTS refusé (rien consommé)',
        {},
      );
      return this.ok({ status: 'rejected' });
    }
    if (method === 'POST' && path === '/moderation/modules') {
      const id = String(body.module_id ?? '') as ModuleId;
      if (!MODULES.includes(id)) return this.fail(400, 'invalid_module');
      this.modules[id] = Boolean(body.enabled);
      this.emit(
        identity,
        'moderation',
        'lab',
        0,
        `${id} ${this.modules[id] ? 'activé' : 'désactivé'}`,
        {},
      );
      return this.ok({ module_id: id, enabled: this.modules[id] });
    }
    if (method === 'GET' && path.startsWith('/moderation/history'))
      return this.ok({
        items: this.events
          .slice(-20)
          .reverse()
          .map((e) => ({
            id: `lab-${e.seq}`,
            action: e.kind,
            label: e.kind,
            login: e.viewer,
            detail: e.detail,
            currency: e.currency,
            cost: e.cost,
            status: 'played',
            created_at: e.at,
          })),
        total: this.events.length,
      });
    return this.fail(404, 'not_available_in_lab');
  }

  // --- helpers ----------------------------------------------------------------------------------

  private session(identity: LabIdentity, identityShared: boolean): Json {
    const isMod = identity.role !== 'viewer';
    const base = this.demo(isMod ? 'moderator' : 'paid');
    const user = this.user(identity.twitchUserId);
    const modules = (base.modules as Json[]).map((m) =>
      m.id === 'bonk' && this.bonkWorker
        ? {
            ...m,
            emote_catalog: {
              groups: [...this.twitch.groups, ...this.bonkGroups()],
            },
            description: 'Bonk OBS Lab · coût simulé, aucun débit',
          }
        : m.id === 'soundboard'
          ? {
              ...m,
              sounds: [
                ...this.sounds,
                {
                  id: 'random',
                  label: 'Aléatoire',
                  emoji: '🎲',
                  credit_cost: 1,
                  token_cost: 600,
                },
              ],
            }
          : m,
    );
    const baseRaffle = base.raffle as Json;
    const joined = this.raffle.participants.some(
      (p) => p.login === identity.login,
    );
    return {
      ...base,
      ok: true,
      demo_mode: true, // fixture emotes are "preview" ones: selectable only in demo mode
      demo_scenario: 'lab',
      ...(this.viewerAuth
        ? {
            // Real Twitch connection state for the extension's "authorize your emotes" flow.
            emotes: {
              connected: true,
              twitch_connected: Boolean(this.twitch.viewer),
              connect_url: null,
            },
          }
        : {}),
      test_mode: true,
      environment: 'lab',
      role: identity.role,
      channel_id: LAB_CHANNEL.id,
      channel_login: LAB_CHANNEL.login,
      identity_shared: identityShared,
      twitch_user_id: identityShared ? identity.twitchUserId : null,
      viewer_login: identityShared ? identity.displayName : null,
      user_login: identityShared ? identity.login : null,
      modules,
      module_states: Object.fromEntries(
        MODULES.map((id) => [id, { enabled: this.modules[id] }]),
      ),
      wallet: identityShared
        ? { points: user.wallet, reserved: 0, available: user.wallet }
        : { unavailable: true },
      credits: { ...user.credits },
      pending_actions: identityShared ? structuredClone(user.pending) : [],
      action_receipts: user.receipts.slice(0, 10),
      notifications: [],
      moderation: isMod
        ? {
            ...(base.moderation as Json),
            tts: this.ttsModeration(true),
            modules: Object.fromEntries(
              MODULES.map((id) => [id, { enabled: this.modules[id] }]),
            ),
          }
        : { ...(base.moderation as Json), tts: this.ttsModeration(false) },
      raffle: {
        ...baseRaffle,
        open: this.raffle.open,
        joined,
        window_id: this.raffle.windowId,
        token: this.raffle.windowId,
        ends_in_s: this.raffleEndsIn(),
        ends_at: this.raffle.open
          ? new Date(this.raffle.endsAt).toISOString()
          : undefined,
        viewer_login: identity.displayName,
        total: 5000,
        currency: 'jetons',
        participant_count: this.raffle.participants.length,
        participants: [...this.raffle.participants],
        history: this.raffle.history,
      },
    };
  }

  private ttsModeration(canModerate: boolean): Json {
    return {
      mode: this.tts.mode,
      paused: this.tts.paused,
      blocked: false,
      can_moderate: canModerate,
      pending: canModerate ? structuredClone(this.tts.pending) : [],
    };
  }

  private bonkGroups(): Json[] {
    // Bonk Lab: the extension's own Unicode/Twemoji bank is the emoji catalog (Core validates
    // any Unicode id); 7TV/BTTV/FFZ come from the channel's public catalog resolved by Core.
    if (this.bonkWorker) return this.thirdParty.groups;
    const bonk = (this.demo('paid').modules as Json[]).find(
      (m) => m.id === 'bonk',
    );
    return ((bonk?.emote_catalog as Json | undefined)?.groups as Json[]) ?? [];
  }

  private costOf(moduleId: ModuleId, payload: Json): number | null {
    if (moduleId === 'soundboard') {
      const sound = [...this.sounds, { id: 'random', token_cost: 600 }].find(
        (s) => s.id === payload.sound_id,
      );
      return sound ? Number(sound.token_cost) : null;
    }
    // Same costs as displayed by the extension (module token_cost of the session).
    const moduleCost = Number(
      (this.demo('paid').modules as Json[]).find((m) => m.id === moduleId)
        ?.token_cost ?? NaN,
    );
    if (!Number.isFinite(moduleCost)) return null;
    if (moduleId === 'tts')
      return String(payload.text ?? '').trim() ? moduleCost : null;
    if (moduleId === 'bonk')
      return Array.isArray(payload.emotes) && payload.emotes.length
        ? moduleCost
        : null;
    return null;
  }

  private effect(moduleId: string, payload: Json): Json {
    if (moduleId === 'soundboard') {
      const pool = this.sounds;
      const sound =
        payload.sound_id === 'random'
          ? pool[Math.floor(Math.random() * pool.length)]
          : pool.find((s) => s.id === payload.sound_id);
      return { label: sound?.label ?? 'Son', url: sound?.preview_url ?? null };
    }
    if (moduleId === 'tts')
      return { text: String(payload.text ?? '').slice(0, 800), voice: 'fr-FR' };
    if (moduleId === 'bonk') {
      const id = String((payload.emotes as unknown[] | undefined)?.[0] ?? '');
      const emote = this.bonkGroups()
        .flatMap((g) => (g.emotes as Json[]) ?? [])
        .find((e) => e.id === id);
      return {
        label: emote?.label ?? payload.emote_glyph ?? id,
        mark: emote?.mark ?? payload.emote_glyph ?? '🔨',
        tone: emote?.tone ?? 'gold',
      };
    }
    return {};
  }

  private user(twitchUserId: string): LabUser {
    let user = this.users.get(twitchUserId);
    if (!user) {
      const base = this.demo('paid');
      user = {
        wallet: DEFAULT_WALLET,
        credits: { tts: 1, soundboard: 1 },
        pending: structuredClone(base.pending_actions as Json[]),
        receipts: [],
        levelUpSfx: false,
      };
      this.users.set(twitchUserId, user);
    }
    return user;
  }

  private raffleEndsIn(): number {
    return this.raffle.open
      ? Math.max(
          0,
          Math.round((this.raffle.endsAt - this.now().getTime()) / 1000),
        )
      : 0;
  }

  private expireRaffle() {
    if (this.raffle.open && this.now().getTime() >= this.raffle.endsAt)
      this.raffle.open = false;
  }

  private emit(
    identity: LabIdentity,
    kind: LabEvent['kind'],
    currency: LabEvent['currency'],
    cost: number,
    detail: string,
    effect: Json,
  ) {
    this.events.push({
      seq: ++this.seq,
      at: this.now().toISOString(),
      kind,
      viewer: identity.displayName,
      role: identity.role,
      currency,
      cost,
      detail: detail.slice(0, 200),
      effect,
    });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  private ok(body: Json): Reply {
    return { status: 200, body: { ok: true, ...body } };
  }

  private fail(status: number, error: string): Reply {
    return { status, body: { ok: false, error } };
  }
}
