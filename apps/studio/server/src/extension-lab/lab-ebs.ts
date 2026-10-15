import {
  BonkLabProvider,
  type BonkLabCatalog,
  type BonkLabThirdPartyCatalog,
  type SoundLabSound,
  type TtsLabViewerState,
} from '@raptoru/schemas';
import type { SoundWorker } from '../sound-lab/worker.js';
import type { TtsWorker } from '../tts-lab/worker.js';
import type { LabCoreCall } from '../lab-moderation/proxy.js';
import { commandsFacade } from './commands-facade.js';

const BONK_PROVIDERS: readonly BonkLabProvider[] = BonkLabProvider.options;
import type {
  TwitchEmotesStatus,
  ViewerAuth,
} from '../bonk-lab/viewer-auth.js';
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
  /** This viewer's own Raptoru restrictions (Core), for the Hub / module feedback. */
  restrictions?: Json[];
}

interface Reply {
  status: number;
  body: Json;
}

/** Tombola V2 state read from Core (/v1/lab/raffle/:channel/state). */
interface CoreRaffle {
  module_state: string;
  current: {
    raffle_id: string;
    status: 'open' | 'closed' | 'drawn';
    jackpot: number;
    ends_at: string;
    closed_at: string | null;
  } | null;
  joined: boolean;
  participants: { viewer_id: string; display_name: string }[];
  history: {
    drawn_at: string;
    jackpot: number;
    winners: { display_name: string; amount: number }[];
  }[];
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
  /** Core's salve bounds (Bonk lot 5), read once from Core and shown by the chargeur; null until known. */
  private bonkVolley: Json | null = null;
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
  /** Linked real Twitch viewer (Bonk Lab), its emotes state and catalog, read from Core. */
  private twitch: {
    viewer: { user_id: string; login: string; display_name: string } | null;
    groups: Json[];
    status: TwitchEmotesStatus;
    error: string | null;
    at: number;
  } = { viewer: null, groups: [], status: 'not_linked', error: null, at: 0 };
  private soundWorker: SoundWorker | null = null;
  /** Core Soundboard catalog (last good one kept when Core is unreachable). */
  private soundCatalog: SoundLabSound[] = [];
  private soundCatalogAt = 0;
  private soundCatalogLoading: Promise<void> | null = null;

  private ttsWorker: TtsWorker | null = null;
  /** Core TTS config (module state + public rules), last good one kept when Core is unreachable. */
  private ttsConfig: { module_state: string; rules: Json } | null = null;
  private ttsViewers = new Map<string, TtsLabViewerState>();
  private ttsConfigAt = 0;
  connectTts(worker: TtsWorker) {
    this.ttsWorker = worker;
  }

  /**
   * Lab Core connected (Studio runtime): the test wallet, module states and moderation live in Core.
   * This façade only mirrors them into the session the extension expects.
   */
  private labCore: LabCoreCall | null = null;
  private coreModules: Record<
    'tts' | 'soundboard' | 'bonk' | 'raffle',
    string
  > | null = null;
  private coreModulesAt = 0;
  /** Live name of the Tombola V2 module (Core: running round's frozen name, else Studio's label). */
  private raffleName: string | null = null;
  private raffleOpenWord: string | null = null;
  /** Tombola V2 state from Core (the in-memory raffle is only used without the Lab Core). */
  private coreRaffle: CoreRaffle | null = null;

  connectLab(core: LabCoreCall) {
    this.labCore = core;
  }

  /** Studio changed a wallet / module state: re-read on the next extension request. */
  invalidateLab() {
    this.coreModulesAt = 0;
  }

  /** The viewer's Core test wallet mirrored into the fictitious identity the session is built from. */
  private async refreshLab(viewerId: string | null) {
    if (!this.labCore) return;
    const tasks: Promise<unknown>[] = [];
    if (viewerId)
      tasks.push(
        this.labCore<{
          tokens: number;
          credits_tts: number;
          credits_soundboard: number;
        }>(`/v1/lab/wallet/${LAB_CHANNEL.id}/${viewerId}`, undefined, {
          timeoutMs: 1500,
        })
          .then((w) => {
            const user = this.user(viewerId);
            user.wallet = w.tokens;
            user.credits = {
              tts: w.credits_tts,
              soundboard: w.credits_soundboard,
            };
            // The extension counts TTS credits as pending TTS redemptions, Soundboard credits as one
            // redemption with credits_remaining: same shapes, values from Core.
            user.pending = [
              ...Array.from(
                { length: Math.min(w.credits_tts, 200) },
                (_, i) => ({
                  redemption_id: `lab-credit-tts-${i + 1}`,
                  module_id: 'tts',
                  reward_key: 'tts',
                  cost: 1000,
                }),
              ),
              ...(w.credits_soundboard > 0
                ? [
                    {
                      redemption_id: 'lab-credit-soundboard',
                      module_id: 'soundboard',
                      reward_key: 'sound',
                      cost: 1000,
                      credits_remaining: w.credits_soundboard,
                    },
                  ]
                : []),
            ];
          })
          .catch(() => undefined),
      );
    if (Date.now() - this.coreModulesAt >= 1000) {
      this.coreModulesAt = Date.now();
      tasks.push(
        this.labCore<{
          tts: { module_state: string };
          soundboard: { module_state: string };
          bonk: { module_state: string };
          raffle?: { module_state: string };
          raffle_v2?: { live_name?: string; live_open?: string };
        }>(`/v1/lab/moderation/${LAB_CHANNEL.id}/overview`, undefined, {
          timeoutMs: 1500,
        })
          .then((o) => {
            this.coreModules = {
              tts: o.tts.module_state,
              soundboard: o.soundboard.module_state,
              bonk: o.bonk.module_state,
              raffle: o.raffle?.module_state ?? 'active',
            };
            for (const id of ['tts', 'soundboard', 'bonk'] as const)
              this.modules[id] = this.coreModules[id] !== 'disabled';
            this.modules.raffle_join = this.coreModules.raffle !== 'disabled';
            this.raffleName = o.raffle_v2?.live_name ?? null;
            this.raffleOpenWord = o.raffle_v2?.live_open ?? null;
          })
          .catch(() => undefined),
      );
    }
    if (viewerId)
      tasks.push(
        this.labCore<{ restrictions: Json[] }>(
          `/v1/lab/moderation/${LAB_CHANNEL.id}/viewers/${viewerId}/restrictions`,
          undefined,
          { timeoutMs: 1500 },
        )
          .then((r) => {
            this.user(viewerId).restrictions = r.restrictions;
          })
          .catch(() => undefined),
      );
    tasks.push(this.refreshRaffle(viewerId));
    await Promise.all(tasks);
  }

  /** Tombola V2 state from Core for this viewer (joined or not). */
  private async refreshRaffle(viewerId: string | null) {
    if (!this.labCore) return;
    await this.labCore<CoreRaffle>(
      `/v1/lab/raffle/${LAB_CHANNEL.id}/state${viewerId ? `?viewer=${viewerId}` : ''}`,
      undefined,
      { timeoutMs: 1500 },
    )
      .then((r) => {
        this.coreRaffle = r;
      })
      .catch(() => undefined);
  }

  /** Free Tombola entry, decided by Core (open round, module state, block, global pause). */
  private async joinRaffleCore(
    caller: { identity: LabIdentity; identityShared: boolean },
    key: string | undefined,
  ): Promise<Reply> {
    if (!caller.identityShared) return this.fail(403, 'identity_required');
    try {
      const out = await this.labCore!<{
        raffle_id: string;
        replayed: boolean;
      }>('/v1/lab/raffle/entries', {
        channel_id: LAB_CHANNEL.id,
        viewer: {
          id: caller.identity.twitchUserId,
          display_name: caller.identity.displayName,
        },
        idempotency_key:
          key ?? `lab-raffle-${caller.identity.twitchUserId}-${Date.now()}`,
      });
      if (!out.replayed)
        this.emit(caller.identity, 'raffle_join', 'free', 0, 'Tombola', {});
      await this.refreshRaffle(caller.identity.twitchUserId);
      return this.ok({
        joined: true,
        duplicate: out.replayed,
        already_joined: out.replayed,
        window_id: out.raffle_id,
        raffle_token: out.raffle_id,
        source: 'extension',
      });
    } catch (e) {
      const err = e as { status?: number; body?: Json; message: string };
      return this.fail(err.status ?? 503, err.message);
    }
  }

  /** Tombola session in the shape the extension expects, from Core's state. */
  private raffleSession(identity: LabIdentity, base: Json): Json {
    const r = this.coreRaffle!;
    const cur = r.current;
    const open = cur?.status === 'open';
    return {
      ...base,
      open,
      joined: open && r.joined,
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
      viewer_login: identity.displayName,
      total: cur?.jackpot ?? 0,
      currency: 'jetons',
      participant_count: open ? r.participants.length : 0,
      participants: open
        ? r.participants.map((p) => ({
            login: p.display_name,
            display_name: p.display_name,
            source: 'extension',
          }))
        : [],
      history: r.history.map((h) => ({
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

  private labActor(caller: { identity: LabIdentity }) {
    const role: LabRole =
      caller.identity.role === 'broadcaster'
        ? 'broadcaster'
        : caller.identity.role === 'moderator'
          ? 'moderator'
          : 'viewer';
    return {
      id: caller.identity.twitchUserId,
      login: caller.identity.login,
      display_name: caller.identity.displayName,
      role,
      via: 'extension' as const,
    };
  }

  /** Extension D4 console: Core read models and commands, relayed as is. */
  private async moderationV2(
    method: string,
    rawPath: string,
    body: Json | undefined,
    caller: { identity: LabIdentity },
    idempotencyKey?: string,
  ): Promise<Reply> {
    const [path = '', query = ''] = rawPath.split('?');
    const qs = new URLSearchParams(query);
    const C = LAB_CHANNEL.id;
    const core = this.labCore!;
    const actor = this.labActor(caller);
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
        return this.ok(await core<Json>(`/v1/lab/moderation/${C}/team?${as}`));
      if (method === 'GET' && path === '/moderation/v2/words')
        return this.ok(await core<Json>(`/v1/lab/moderation/${C}/words?${as}`));
      if (method === 'GET' && path === '/moderation/v2/interactions')
        return this.ok(
          await core<Json>(
            `/v1/lab/moderation/${C}/interactions?${as}&${pass(['module', 'status', 'viewer', 'q', 'period', 'before', 'limit'])}`,
          ),
        );
      if (
        method === 'GET' &&
        (m = /^\/moderation\/v2\/interactions\/([0-9a-f-]{36})$/.exec(path))
      )
        return this.ok(
          await core<Json>(
            `/v1/lab/moderation/${C}/interactions/${m[1]}?${as}`,
          ),
        );
      if (method === 'GET' && path === '/moderation/v2/ledger')
        return this.ok(
          await core<Json>(
            `/v1/lab/moderation/${C}/ledger?${as}&${pass(['viewer', 'before', 'limit', 'auto'])}`,
          ),
        );
      if (method === 'GET' && path === '/moderation/v2/whoami')
        return this.ok({
          ...(await core<Json>(
            `/v1/lab/moderation/${C}/whoami`,
            this.labActor(caller),
          )),
          actor: this.labActor(caller),
        });
      if (method === 'GET' && path === '/moderation/v2/overview') {
        const me = await core<Json>(`/v1/lab/moderation/${C}/whoami`, actor);
        const overview = await core<Json>(
          `/v1/lab/moderation/${C}/overview?${as}`,
        );
        return this.ok({ ...overview, me: { ...me, actor } });
      }
      if (method === 'GET' && path === '/moderation/v2/search')
        return this.ok(
          await core<Json>(
            `/v1/lab/moderation/${C}/search?${as}&q=${encodeURIComponent((qs.get('q') ?? '').slice(0, 40))}`,
          ),
        );
      if (
        method === 'GET' &&
        (m = /^\/moderation\/v2\/viewers\/(\d{1,32})$/.exec(path))
      )
        return this.ok(
          await core<Json>(`/v1/lab/moderation/${C}/viewers/${m[1]}?${as}`),
        );
      if (method === 'GET' && path === '/moderation/v2/restrictions')
        return this.ok(
          await core<Json>(`/v1/lab/moderation/${C}/restrictions?${as}`),
        );
      if (method === 'GET' && path === '/moderation/v2/audit')
        return this.ok(
          await core<Json>(
            `/v1/lab/moderation/${C}/audit?${as}&${pass(['module', 'viewer', 'limit'])}`,
          ),
        );
      if (method === 'POST' && path === '/moderation/v2/actions') {
        // The client's Idempotency-Key goes to Core: a retried action is answered, never applied twice.
        const out = await core<Json>(`/v1/lab/moderation/${C}/actions`, {
          actor,
          command: body?.command,
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        });
        this.invalidateLab();
        this.ttsConfigAt = 0;
        return this.ok(out);
      }
      return this.fail(404, 'not_found');
    } catch (e) {
      const err = e as { status?: number; body?: Json; message: string };
      return {
        status: err.status ?? 503,
        body: { ...(err.body ?? {}), ok: false, error: err.message },
      };
    }
  }

  /** Extension moderation (moderators, broadcaster) → the same Core commands and permissions as Studio. */
  private async moderateViaCore(
    caller: { identity: LabIdentity },
    command: Json,
  ): Promise<Reply> {
    try {
      const out = await this.labCore!<Json>(
        `/v1/lab/moderation/${LAB_CHANNEL.id}/actions`,
        // Same actor as the D4 console (display_name included): Core keeps the team member's name.
        { actor: this.labActor(caller), command },
      );
      this.invalidateLab();
      this.ttsConfigAt = 0;
      return this.ok(out);
    } catch (e) {
      const err = e as { status?: number; body?: Json; message: string };
      return {
        status: err.status ?? 503,
        body: { ...(err.body ?? {}), ok: false, error: err.message },
      };
    }
  }

  /** Core config at most once a second, and the viewer's TTS state (availability before payment). */
  private async refreshTts(viewerId: string | null) {
    if (!this.ttsWorker) return;
    const tasks: Promise<unknown>[] = [];
    if (Date.now() - this.ttsConfigAt >= 1000) {
      this.ttsConfigAt = Date.now();
      tasks.push(
        this.ttsWorker
          .config()
          .then((c) => {
            this.ttsConfig = c as { module_state: string; rules: Json };
          })
          .catch(() => undefined),
      );
    }
    if (viewerId)
      tasks.push(
        this.ttsWorker
          .viewerState(viewerId)
          .then((v) => {
            this.ttsViewers.set(viewerId, v);
          })
          .catch(() => {
            this.ttsViewers.delete(viewerId);
          }),
      );
    await Promise.all(tasks);
  }

  connectSound(worker: SoundWorker) {
    this.soundWorker = worker;
    void this.refreshSoundCatalog();
  }

  /** Streamer settings changed in Studio: the next request reads the catalog again. */
  invalidateSoundCatalog() {
    this.soundCatalogAt = 0;
  }

  /**
   * Catalog with live prices / cooldowns / running state, read from the local Lab Core at most once
   * a second (bounded to 1.5 s by the client). On failure the last good catalog is kept.
   */
  private async refreshSoundCatalog() {
    if (!this.soundWorker) return;
    if (!this.soundCatalogLoading && Date.now() - this.soundCatalogAt >= 1000) {
      this.soundCatalogAt = Date.now();
      this.soundCatalogLoading = this.soundWorker
        .catalog()
        .then(({ sounds }) => {
          this.soundCatalog = sounds;
        })
        .catch(() => undefined)
        .finally(() => {
          this.soundCatalogLoading = null;
        });
    }
    if (this.soundCatalogLoading) await this.soundCatalogLoading;
  }

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
   * The Lab viewer's emotes from Core (emotesState: the same states and cache as /v1/ext/emotes).
   * Core answers at once with the stored catalog and reloads it in the background (a Helix reload of a
   * big catalog takes 8-9 s); a forced refresh waits for it at most 6 s. Re-read at most every 5 s,
   * except while syncing (the extension follows the reload).
   */
  private async refreshTwitch(force = false) {
    if (!this.viewerAuth) return;
    const generation = this.viewerAuth.generation;
    const sameViewer = generation === this.twitchGeneration;
    if (
      !force &&
      sameViewer &&
      this.twitch.status !== 'syncing' &&
      Date.now() - this.twitch.at < 5000
    )
      return;
    if (force) return this.loadTwitch(generation, true);
    this.twitchLoading ??= this.loadTwitch(generation, false).finally(() => {
      this.twitchLoading = null;
    });
    await this.twitchLoading;
  }

  private async loadTwitch(generation: number, force: boolean) {
    if (!this.viewerAuth) return;
    this.twitchGeneration = generation;
    try {
      const r = await this.viewerAuth.emotes(force);
      const linked = ['ready', 'syncing', 'stale'].includes(r.status);
      this.twitch = {
        viewer: linked ? r.viewer : null,
        groups: r.catalog ? twitchGroups(r.catalog) : [],
        status: r.status,
        error: null,
        at: Date.now(),
      };
    } catch {
      // Core unreachable: keep what is known (never an empty catalog in place of a good one).
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
      raffle: this.coreRaffle
        ? {
            open: this.coreRaffle.current?.status === 'open',
            endsInSeconds:
              this.coreRaffle.current?.status === 'open'
                ? Math.max(
                    0,
                    Math.round(
                      (Date.parse(this.coreRaffle.current.ends_at) -
                        Date.now()) /
                        1000,
                    ),
                  )
                : 0,
            participants:
              this.coreRaffle.current?.status === 'open'
                ? this.coreRaffle.participants.length
                : 0,
            waitingDraw: this.coreRaffle.current?.status === 'closed',
            core: true,
          }
        : {
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

  /** Studio controls (local only). With the Lab Core, wallets live there (test wallet). */
  async control(action: string, args: Json = {}): Promise<Json> {
    if (this.labCore && action.startsWith('raffle-'))
      return this.raffleControl(action, args);
    if (this.labCore && (action === 'wallet' || action === 'reset')) {
      const actor = { id: 'studio', role: 'broadcaster', via: 'studio' };
      const roles =
        action === 'wallet'
          ? [args.role as LabRole]
          : (Object.keys(LAB_IDENTITIES) as LabRole[]);
      for (const r of roles) {
        if (!LAB_IDENTITIES[r]) throw new Error('invalid wallet control');
        const amount = Number(args.amount);
        if (action === 'wallet' && (!Number.isInteger(amount) || amount < 0))
          throw new Error('invalid wallet control');
        await this.labCore(`/v1/lab/wallet/${LAB_CHANNEL.id}`, {
          actor,
          viewer_id: LAB_IDENTITIES[r].twitchUserId,
          ...(action === 'wallet'
            ? { op: 'set', tokens: amount }
            : { op: 'reset' }),
        });
      }
      if (action === 'wallet') return { ok: true };
    }
    return this.controlLocal(action, args);
  }

  private controlLocal(action: string, args: Json = {}): Json {
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

  /** Viewers the Lab can act as: the fictitious identities, plus the linked Twitch account. */
  labIdentities(): { id: string; label: string }[] {
    const out = (Object.keys(LAB_IDENTITIES) as LabRole[]).map((r) => ({
      id: LAB_IDENTITIES[r].twitchUserId,
      label: `${LAB_IDENTITIES[r].displayName} (${r})`,
    }));
    if (this.twitch.viewer)
      out.unshift({
        id: this.twitch.viewer.user_id,
        label: `${this.twitch.viewer.display_name} (Twitch lié, rôle viewer)`,
      });
    return out;
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
    if (
      this.soundWorker &&
      ['/session', '/state'].includes(path.split('?')[0]!)
    )
      await this.refreshSoundCatalog();
    if (this.bonkWorker && (path === '/session' || path.startsWith('/emotes')))
      // Never forced from the extension: Core caches the public catalogs 10 min.
      await this.refreshThirdParty();
    if (this.bonkWorker && !this.bonkVolley && path === '/session')
      this.bonkVolley = await this.bonkWorker
        .rules()
        .then((r) => r.volley as Json)
        .catch(() => null); // Core not ready: the chargeur shows no Auto until known

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
        this.twitch = {
          viewer: null,
          groups: [],
          status: 'not_linked',
          error: null,
          at: 0,
        };
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
    // After the identity above (a linked Twitch viewer is its real account): its own TTS state.
    if (
      this.ttsWorker &&
      ['/session', '/state', '/tts/state'].includes(path.split('?')[0]!)
    )
      await this.refreshTts(
        caller.identityShared ? caller.identity.twitchUserId : null,
      );
    if (
      this.labCore &&
      ['/session', '/state', '/tts/state'].includes(path.split('?')[0]!)
    )
      await this.refreshLab(
        caller.identityShared ? caller.identity.twitchUserId : null,
      );
    // TTS V2 Lab: Core admission (idempotent; Core decides price, cast, cooldown and queue), read by
    // the Studio player. The fictitious Lab wallet is debited once and given back on a Core refund.
    if (
      this.ttsWorker &&
      method === 'GET' &&
      path.split('?')[0] === '/tts/state'
    ) {
      const user = caller.identityShared
        ? this.user(caller.identity.twitchUserId)
        : null;
      return this.ok({
        tts_v2: this.ttsV2(user ? caller.identity.twitchUserId : null),
        wallet: user
          ? { points: user.wallet, reserved: 0, available: user.wallet }
          : { unavailable: true },
        pending_actions: user ? structuredClone(user.pending) : [],
      });
    }
    if (
      this.ttsWorker &&
      method === 'POST' &&
      body?.module_id === 'tts' &&
      path.startsWith('/actions/')
    )
      return this.admitTts(path, body, caller, headers.idempotencyKey);
    // Tombola V2 (Core): what this viewer may see (phases, timer, entries, result, history of the
    // stream, why a join would be refused). A projection of Core, nothing decided here.
    if (this.labCore && method === 'GET' && path === '/raffle/state') {
      const viewerId = caller.identityShared
        ? caller.identity.twitchUserId
        : null;
      try {
        const raffle = await this.labCore<Json>(
          `/v1/lab/raffle/${LAB_CHANNEL.id}/viewer${viewerId ? `?viewer=${viewerId}` : ''}`,
          undefined,
          { timeoutMs: 1500 },
        );
        const user = viewerId ? this.user(viewerId) : null;
        return this.ok({
          raffle_v2: raffle,
          me: viewerId
            ? { viewer_id: viewerId, display_name: caller.identity.displayName }
            : null,
          wallet: user
            ? { points: user.wallet, reserved: 0, available: user.wallet }
            : { unavailable: true },
        });
      } catch (e) {
        const err = e as { status?: number; message: string };
        return this.fail(err.status ?? 503, err.message);
      }
    }
    // Tombola V2 (Core): free entry decided by Core, never the in-memory raffle.
    if (this.labCore && method === 'POST' && path === '/actions/raffle')
      return this.joinRaffleCore(caller, headers.idempotencyKey);
    // Commands V2 « Commandes » for every viewer (phase F): Core's public projection, read-only, no
    // identity needed and nothing else than what a viewer may see.
    if (
      this.labCore &&
      method === 'GET' &&
      path.split('?')[0] === '/commands/public'
    ) {
      try {
        return this.ok(
          await this.labCore<Json>(`/v1/lab/commands/${LAB_CHANNEL.id}/public`),
        );
      } catch {
        return this.fail(503, 'commands_unavailable');
      }
    }
    // Commands V2 « Modération › Commandes » (phase E): the caller's verified identity, Core decides.
    if (this.labCore && path.startsWith('/commands/v2/')) {
      const out = await commandsFacade(this.labCore)(
        method,
        path,
        body,
        this.labActor(caller),
      );
      return { status: out.status, body: out.body as Json };
    }
    // Extension moderation → Moderation V2 in Core (same commands, permissions and audit as Studio).
    if (this.labCore && path.startsWith('/moderation/')) {
      if (caller.identity.role === 'viewer') return this.fail(403, 'forbidden');
      // Moderation V2 (D4) console of the extension: a projection of the same Core (read models +
      // commands), with the caller's identity as actor. No state and no rule here.
      if (path.startsWith('/moderation/v2/'))
        return this.moderationV2(
          method,
          path,
          body,
          caller,
          headers.idempotencyKey,
        );
      const tts = /^\/moderation\/tts\/(pause|resume|stop|purge)$/.exec(path);
      if (method === 'POST' && tts) {
        const action = tts[1]!;
        const reply = await this.moderateViaCore(
          caller,
          action === 'stop'
            ? { action: 'stop_current', module: 'tts', refund: false }
            : action === 'purge'
              ? { action: 'purge', module: 'tts', refund: false }
              : {
                  action: 'module_state',
                  module: 'tts',
                  state: action === 'pause' ? 'paused' : 'active',
                  waiting: 'keep',
                },
        );
        if (reply.status === 409 && reply.body.error === 'nothing_playing')
          return this.ok({
            action,
            command_id: String(body?.command_id ?? ''),
            status: 'no_active',
            final_status: 'no_active',
          });
        if (reply.status !== 200) return reply;
        this.emit(
          caller.identity,
          'moderation',
          'lab',
          0,
          `TTS : ${action}`,
          {},
        );
        return this.ok({
          action,
          command_id: String(body?.command_id ?? `lab-${this.seq}`),
          status: 'executed',
          final_status: 'executed',
          settings: this.ttsModeration(true),
        });
      }
      if (method === 'POST' && path === '/moderation/modules') {
        const moduleId = String(body?.module_id ?? '');
        if (['tts', 'soundboard', 'bonk'].includes(moduleId))
          return this.moderateViaCore(caller, {
            action: 'module_state',
            module: moduleId,
            state: body?.enabled ? 'active' : 'disabled',
            waiting: 'keep',
          });
      }
      const MODS: Record<string, string> = {
        tts: 'tts',
        soundboard: 'soundboard',
        bonk: 'bonk',
      };
      if (
        method === 'POST' &&
        (path === '/moderation/tts/ban' || path === '/moderation/tts/unban')
      ) {
        const viewer = String(body?.twitch_user_id ?? '');
        return this.moderateViaCore(
          caller,
          path.endsWith('/ban')
            ? {
                action: 'block_viewer',
                viewer_id: viewer,
                module: 'tts',
                duration_s: null,
              }
            : { action: 'unblock_viewer', viewer_id: viewer, module: 'tts' },
        );
      }
      if (
        method === 'POST' &&
        (path === '/moderation/users/suspend' ||
          path === '/moderation/users/unsuspend')
      ) {
        const viewer = String(body?.twitch_user_id ?? '');
        const ids = (
          Array.isArray(body?.module_ids) ? (body.module_ids as string[]) : []
        )
          .map((m) => MODS[m])
          .filter(Boolean) as string[];
        const suspensions: Json[] = [];
        const errors: Json[] = [];
        for (const module of ids) {
          const r = await this.moderateViaCore(
            caller,
            path.endsWith('/suspend')
              ? {
                  action: 'block_viewer',
                  viewer_id: viewer,
                  module,
                  duration_s:
                    Number(body?.duration_ms) > 0
                      ? Math.max(
                          1,
                          Math.round(Number(body?.duration_ms) / 1000),
                        )
                      : null,
                  reason:
                    typeof body?.reason === 'string'
                      ? body.reason.slice(0, 200)
                      : undefined,
                }
              : { action: 'unblock_viewer', viewer_id: viewer, module },
          );
          if (r.status === 200) suspensions.push({ module_id: module });
          else errors.push({ module_id: module, error: r.body.error });
        }
        return this.ok({ scope: 'modules', suspensions, errors });
      }
      if (method === 'GET' && path.startsWith('/moderation/history')) {
        try {
          const { audit } = await this.labCore<{ audit: Json[] }>(
            `/v1/lab/moderation/${LAB_CHANNEL.id}/audit?limit=30`,
          );
          return this.ok({
            items: audit.map((a) => ({
              id: `audit-${a.id}`,
              action: a.module_id ?? 'moderation',
              label: String(a.action),
              login: String(a.actor),
              detail: [
                a.action,
                a.viewer_id ? `viewer ${a.viewer_id}` : '',
                a.reason ?? '',
              ]
                .filter(Boolean)
                .join(' · '),
              currency: 'lab',
              cost: 0,
              status: 'executed',
              created_at: a.created_at,
            })),
            total: audit.length,
          });
        } catch (e) {
          return this.fail(503, (e as Error).message);
        }
      }
    }
    // Extension moderation pause / resume of the TTS module: Core's module state (V2).
    if (
      this.ttsWorker &&
      method === 'POST' &&
      (path === '/moderation/tts/pause' || path === '/moderation/tts/resume')
    ) {
      if (caller.identity.role === 'viewer') return this.fail(403, 'forbidden');
      const action = path.endsWith('/pause') ? 'pause' : 'resume';
      try {
        await this.ttsWorker.moderate({
          action,
          actor: `extension:${caller.identity.login}`.slice(0, 64),
        });
        this.ttsConfigAt = 0;
        await this.refreshTts(null);
      } catch (e) {
        return this.fail(
          (e as { status?: number }).status ?? 503,
          (e as Error).message,
        );
      }
      this.emit(
        caller.identity,
        'moderation',
        'lab',
        0,
        action === 'pause' ? 'TTS en pause' : 'TTS repris',
        {},
      );
      return this.ok({
        action,
        command_id: String(body?.command_id ?? `lab-${this.seq}`),
        status: 'executed',
        final_status: 'executed',
        settings: this.ttsModeration(true),
      });
    }
    // Soundboard Lab: Core admission (idempotent, simulated payment), played by the Studio player.
    // Never the in-memory wallet/event path, whatever the payment method chosen in the extension.
    if (
      this.soundWorker &&
      method === 'POST' &&
      body?.module_id === 'soundboard' &&
      path.startsWith('/actions/')
    ) {
      if (!caller.identityShared) return this.fail(403, 'identity_required');
      if (!this.modules.soundboard) return this.fail(409, 'module_disabled');
      if (!['/actions/tokens', '/actions/redemption'].includes(path))
        return this.fail(400, 'unsupported_payment');
      if (!headers.idempotencyKey)
        return this.fail(400, 'idempotency_key_required');
      const soundId = (body.payload as Json | undefined)?.sound_id;
      if (typeof soundId !== 'string' || !soundId)
        return this.fail(400, 'invalid_payload');
      const paymentMethod =
        path === '/actions/redemption' ? 'credits' : 'tokens';
      // Simulated balance check only (fictitious Lab jetons): nothing is ever debited.
      const listed = this.soundCatalog.find((s) => s.id === soundId);
      if (
        paymentMethod === 'tokens' &&
        listed &&
        this.user(caller.identity.twitchUserId).wallet < listed.token_cost
      )
        return this.fail(409, 'insufficient_tokens');
      try {
        const result = await this.soundWorker.admit(
          {
            id: caller.identity.twitchUserId,
            display_name: caller.identity.displayName,
          },
          headers.idempotencyKey,
          soundId,
          paymentMethod,
        );
        return this.ok({
          status: result.interaction.status,
          module_id: 'soundboard',
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
      // Salve (lot 5, mode Auto): every shot admitted and paid by Core at once, or nothing.
      if (p && Array.isArray(p.shots)) {
        const shots = p.shots as Json[];
        if (
          !shots.length ||
          shots.some(
            (s) =>
              !BONK_PROVIDERS.includes(s?.emote_source as BonkLabProvider) ||
              typeof s?.emote !== 'string',
          ) ||
          typeof p.cadence_ms !== 'number'
        )
          return this.fail(400, 'invalid_payload');
        try {
          const out = await this.bonkWorker.admitVolley(
            {
              id: caller.identity.twitchUserId,
              display_name: caller.identity.displayName,
            },
            headers.idempotencyKey,
            shots.map((s) => {
              const provider = s.emote_source as BonkLabProvider;
              return {
                provider,
                id: String(s.emote),
                glyph:
                  provider === 'unicode' && typeof s.emote_glyph === 'string'
                    ? s.emote_glyph
                    : null,
              };
            }),
            p.cadence_ms,
          );
          return this.ok({
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
              (sum, i) => sum + i.simulated_cost,
              0,
            ),
          });
        } catch (e) {
          return this.fail(
            (e as { status?: number }).status ?? 503,
            (e as Error).message,
          );
        }
      }
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
            'restrictions',
            // The extension only re-reads /state after its first load: the Soundboard Lab catalog
            // (prices, cooldowns, enabled) must follow, or a Studio change never reaches it.
            ...(this.soundWorker || this.ttsWorker ? ['modules'] : []),
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
        // Same values as /v1/ext/emotes (the extension shows the same states in the Lab and on Twitch).
        twitch_status: this.viewerAuth ? this.twitch.status : 'ready',
        ...(this.twitch.viewer
          ? { twitch_login: this.twitch.viewer.display_name }
          : {}),
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
            // Salves (lot 5): Core's bounds; absent until read (the chargeur then offers no Auto).
            ...(this.bonkVolley ? { volley: this.bonkVolley } : {}),
          }
        : m.id === 'soundboard' && this.soundWorker
          ? // Soundboard Lab: the Core catalog with its live state, simulated payment.
            {
              ...m,
              description: 'Soundboard Lab · coût simulé, aucun débit',
              // Presentation only (a status pill): Core still refuses without a ready player.
              player_ready: this.soundWorker.ready,
              sounds: this.soundCatalog.map((s) => ({
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
                      Math.ceil((Date.now() + s.cooldown_remaining_ms) / 1000) *
                        1000,
                    ).toISOString()
                  : null,
                running: s.running,
              })),
            }
          : m.id === 'tts' && this.ttsWorker
            ? {
                ...m,
                description: 'TTS Lab · coût simulé, aucun débit réel',
                max_chars: Number(
                  (this.ttsConfig?.rules as Json | undefined)?.max_chars ??
                    m.max_chars,
                ),
                tts_v2: this.ttsV2(
                  identityShared ? identity.twitchUserId : null,
                ),
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
    // Tombola V2: the extension reads Core's viewer state itself (GET /raffle/state).
    if (this.labCore)
      for (const m of modules)
        if (m.id === 'raffle_join') {
          m.raffle_v2 = true;
          if (this.raffleName) m.label = this.raffleName;
          if (this.raffleOpenWord) m.open_label = this.raffleOpenWord;
        }
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
              twitch_status: this.twitch.status,
              connect_url: null,
            },
          }
        : {}),
      test_mode: true,
      environment: 'lab',
      // Moderation V2 (D4) console available: the extension reads / commands Core through /moderation/v2.
      moderation_v2: Boolean(this.labCore),
      // Commands V2 public list available (« Commandes » in the Hub, every viewer).
      commands_public: Boolean(this.labCore),
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
      // Raptoru restrictions of this viewer (never a Twitch sanction): Core's rows, own ones only.
      restrictions: identityShared
        ? structuredClone(user.restrictions ?? [])
        : [],
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
      raffle: this.coreRaffle
        ? this.raffleSession(identity, baseRaffle)
        : {
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

  /** Studio Tombola controls → Core (« Ouverture, tirage et fermeture : Studio »). */
  private async raffleControl(action: string, args: Json): Promise<Json> {
    const command =
      action === 'raffle-open'
        ? {
            action: 'raffle_open',
            duration_s: Math.min(
              3600,
              Math.max(10, Number(args.seconds) || 60),
            ),
            jackpot: Math.min(
              10_000_000,
              Math.max(0, Math.round(Number(args.jackpot ?? 5000) || 0)),
            ),
            winners: Math.min(
              10,
              Math.max(1, Math.round(Number(args.winners ?? 1) || 1)),
            ),
          }
        : {
            action: action === 'raffle-close' ? 'raffle_close' : 'raffle_draw',
          };
    const out = await this.labCore!<Json>(
      `/v1/lab/moderation/${LAB_CHANNEL.id}/actions`,
      { actor: { id: 'studio', role: 'broadcaster', via: 'studio' }, command },
    );
    await this.refreshRaffle(null);
    return { ok: true, ...out };
  }

  private async admitTts(
    path: string,
    body: Json,
    caller: { identity: LabIdentity; identityShared: boolean },
    key: string | undefined,
  ): Promise<Reply> {
    if (!caller.identityShared) return this.fail(403, 'identity_required');
    if (!this.modules.tts) return this.fail(409, 'module_disabled');
    if (!['/actions/tokens', '/actions/redemption'].includes(path))
      return this.fail(400, 'unsupported_payment');
    if (!key) return this.fail(400, 'idempotency_key_required');
    const text = (body.payload as Json | undefined)?.text;
    if (typeof text !== 'string') return this.fail(400, 'invalid_payload');
    const viewer = caller.identity.twitchUserId;
    const method = path === '/actions/redemption' ? 'credits' : 'tokens';
    try {
      // Core checks the balance, debits the Lab test wallet and admits in one transaction; refunds
      // give back exactly that debit, once. Nothing is paid or tracked here.
      const result = await this.ttsWorker!.admit(
        { id: viewer, display_name: caller.identity.displayName },
        key,
        text,
        method,
      );
      const i = result.interaction;
      if (!result.replayed) {
        this.user(viewer).receipts.unshift({
          id: i.interaction_id,
          action: 'tts',
          label: 'TTS',
          detail: i.message,
          currency: method === 'tokens' ? 'jetons' : 'channelpoints',
          cost: i.simulated_cost,
          status: 'queued',
          created_at: i.created_at,
        });
        this.emit(
          caller.identity,
          'tts',
          method === 'tokens' ? 'jetons' : 'channelpoints',
          i.simulated_cost,
          i.message,
          { interaction_id: i.interaction_id, cast: i.cast },
        );
      }
      return this.ok({
        status: i.status,
        module_id: 'tts',
        reference_id: i.interaction_id,
        interaction: i,
        queue: result.queue,
        replayed: result.replayed,
        charged: false,
        test_mode: true,
        payment_mode: 'simulated',
        cost: i.simulated_cost,
      });
    } catch (e) {
      // Core refusals (before any payment) keep their details, e.g. retry_after_ms.
      const err = e as { status?: number; body?: Json; message: string };
      return {
        status: err.status ?? 503,
        body: { ...(err.body ?? {}), ok: false, error: err.message },
      };
    }
  }

  /** TTS V2 data for the extension: Core config + this viewer's state (null = Core unreachable). */
  private ttsV2(viewerId: string | null): Json | null {
    if (!this.ttsWorker || !this.ttsConfig) return null;
    const viewer = viewerId ? (this.ttsViewers.get(viewerId) ?? null) : null;
    return {
      // Pause globale (Core): the TTS shows « en pause » before any payment.
      module_state: viewer?.global_paused
        ? 'paused'
        : this.ttsConfig.module_state,
      rules: this.ttsConfig.rules,
      viewer,
      test_mode: true,
      payment_mode: 'simulated',
    };
  }

  private ttsModeration(canModerate: boolean): Json {
    return {
      mode: this.ttsWorker ? 'instant' : this.tts.mode,
      paused: this.coreModules
        ? this.coreModules.tts === 'paused'
        : this.ttsWorker
          ? this.ttsConfig?.module_state === 'paused'
          : this.tts.paused,
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
