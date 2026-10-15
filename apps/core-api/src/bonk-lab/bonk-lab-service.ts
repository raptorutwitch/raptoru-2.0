import { createHash, randomUUID } from 'node:crypto';
import type {
  BonkLabAckRequest,
  BonkLabAdmitRequest,
  BonkLabAdmitResponse,
  BonkLabError,
  BonkLabHeartbeat,
  BonkLabInteraction,
  BonkLabStatus,
  BonkLabVolleyAdmitRequest,
  BonkLabVolleyAdmitResponse,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { LabModerationCommand } from '@raptoru/schemas';
import {
  activeBlock,
  actorName,
  assertNotGloballyPaused,
  audit,
  countGlobalRefusal,
  GlobalPauseError,
  moduleState,
  personalCooldownMs,
  seeViewer,
  setModuleState,
  SYSTEM,
  type Actor,
  type LabRole,
} from '../lab-moderation/store.js';
import {
  deferrableRefund,
  labEconomy,
  type EconomyPort,
} from '../economy/economy.js';
import {
  CATALOG_MAX_AGE_MS,
  TwitchViewerError,
  type TwitchViewerCatalog,
} from './twitch-viewer.js';
import {
  THIRD_PARTY_PROVIDERS,
  type ThirdPartyEmote,
  type ThirdPartyEmotes,
  type ThirdPartyProvider,
} from './third-party-emotes.js';

// Bonk V2, Lab slice. Core owns validation, the authoritative interaction, its durable order
// (channel_sequence) and its status; Studio only executes and acknowledges. Test only: the payment
// is a simulated snapshot (real_debited = 0). This module deliberately imports nothing from
// Wallet, Loyalty or stats: a Lab Bonk can never move real Jetons, credits or progression.

/**
 * Unicode emoji -> local Twemoji, resolved by Core (never a URL from the caller). The id carries
 * the exact code points: the glyph must match them, and the asset path is derived with the same
 * rule as the extension (FE0F dropped, leading zeros trimmed). A path without a Twemoji asset
 * makes the renderer fail explicitly; it is never substituted.
 */
export function twemojiEmote(
  id: string,
): { glyph: string; url: string; animated: boolean } | null {
  const hex = /^unicode:([0-9a-f]{1,6}(?:-[0-9a-f]{1,6}){0,9})$/.exec(id)?.[1];
  if (!hex) return null;
  const parts = hex.split('-');
  const points = parts.map((part) => parseInt(part, 16));
  if (points.some((point) => point > 0x10ffff)) return null;
  const path = parts
    .filter((part) => part !== 'fe0f')
    .map((part) => part.replace(/^0+(?=[0-9a-f])/, ''))
    .join('-');
  return {
    glyph: String.fromCodePoint(...points),
    url: `assets/twemoji/svg/${path}.svg`,
    animated: false,
  };
}

export const BONK_LAB_RULES = {
  simulatedCost: 200,
  simulatedCurrency: 'jetons_lab',
  /** A queued Bonk not started within this delay fails as expired (no stale replay later). */
  expiresAfterMs: 120_000,
  /** Studio heartbeat freshness required to admit or claim. */
  heartbeatFreshMs: 10_000,
  /** Lease of a claimed attempt until the renderer reports `started`. */
  claimLeaseMs: 30_000,
  /** Lease once started, until `completed`. */
  executingLeaseMs: 60_000,
  /** Bounded queue: refused before admission, nothing recorded. */
  maxOpenPerChannel: 50,
  /**
   * Salves (lot 5, mode Auto). Canonical Core rules (Bonk VNext audit § 4 / § 12): shots per salve and
   * cadence between two starts. The only place these bounds live; the Extension reads them from Core.
   */
  volleyMaxShots: 10,
  volleyCadenceMinMs: 90,
  volleyCadenceMaxMs: 600,
};

/** Salve rules as the clients see them (Extension: max munitions, cadence bounds). */
export const bonkVolleyRules = () => ({
  max_shots: BONK_LAB_RULES.volleyMaxShots,
  cadence_min_ms: BONK_LAB_RULES.volleyCadenceMinMs,
  cadence_max_ms: BONK_LAB_RULES.volleyCadenceMaxMs,
});

export class BonkLabError409 extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Studio/OBS/overlay not ready: refused before admission (nothing stored). */
export class BonkLabUnavailableError extends Error {
  constructor(
    readonly code: 'studio_offline' | 'obs_offline' | 'overlay_not_ready',
  ) {
    super(code);
  }
}

export class BonkLabNotFoundError extends Error {}

const isThirdParty = (provider: string): provider is ThirdPartyProvider =>
  (THIRD_PARTY_PROVIDERS as readonly string[]).includes(provider);

interface Row {
  interaction_id: string;
  provider: BonkLabInteraction['provider'];
  idempotency_key: string;
  request_hash: string;
  channel_id: string;
  viewer_id: string;
  viewer_display_name: string;
  emote_id: string;
  emote_glyph: string | null;
  emote_url: string;
  emote_animated: boolean;
  created_at: Date;
  channel_sequence: number | string;
  simulated_cost: number;
  simulated_currency: string;
  refund_status: 'none' | 'refunded';
  refunded_at: Date | null;
  status: BonkLabStatus;
  lab_session_id: string;
  expires_at: Date;
  error: BonkLabError | null;
  studio_instance_id: string | null;
  attempt_id: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  volley_id: string | null;
  volley_index: number | null;
  volley_count: number | null;
  cadence_ms: number | null;
}

type Emote = BonkLabAdmitRequest['emote'];
type ResolvedEmote = { glyph: string | null; url: string; animated: boolean };
/** What admission needs from the network, fetched before the transaction. */
type Prefetched = {
  twitchError: string | null;
  thirdParty: Map<string, ThirdPartyEmote | 'unavailable' | null>;
};

const SELECT = `select i.*, d.studio_instance_id, d.attempt_id, d.lease_expires_at, d.started_at, d.completed_at
  from bonk_lab_interactions i left join bonk_lab_deliveries d using (interaction_id)`;
const TERMINAL: BonkLabStatus[] = ['completed', 'failed', 'execution_unknown'];

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function toInteraction(r: Row): BonkLabInteraction {
  return {
    interaction_id: r.interaction_id,
    idempotency_key: r.idempotency_key,
    source: 'extension_lab',
    channel_id: r.channel_id,
    viewer_id: r.viewer_id,
    viewer_display_name: r.viewer_display_name,
    type: 'bonk',
    provider: r.provider,
    emote_id: r.emote_id,
    emote_glyph: r.emote_glyph,
    emote_url: r.emote_url,
    emote_animated: r.emote_animated,
    quantity: 1,
    volley:
      r.volley_id === null
        ? null
        : {
            id: r.volley_id,
            index: Number(r.volley_index),
            count: Number(r.volley_count),
            cadence_ms: Number(r.cadence_ms),
          },
    created_at: iso(r.created_at)!,
    channel_sequence: Number(r.channel_sequence),
    test_mode: true,
    payment_mode: 'simulated',
    simulated_cost: r.simulated_cost,
    simulated_currency: r.simulated_currency,
    real_debited: 0,
    refund_status: r.refund_status,
    refunded_at: iso(r.refunded_at),
    status: r.status,
    lab_session_id: r.lab_session_id,
    expires_at: iso(r.expires_at)!,
    error: r.error,
    delivery: {
      studio_instance_id: r.studio_instance_id,
      attempt_id: r.attempt_id,
      lease_expires_at: iso(r.lease_expires_at),
      started_at: iso(r.started_at),
      completed_at: iso(r.completed_at),
    },
  };
}

const err = (
  code: string,
  message: string,
  retryable = false,
): BonkLabError => ({
  code,
  message,
  retryable,
});

export class BonkLabService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Twitch viewer catalog (Lab). Without it, only the local Twemoji is admitted. */
    private readonly twitch: TwitchViewerCatalog | null = null,
    /** 7TV/BTTV/FFZ public catalogs of the channel (Lab). Without it, those providers are refused. */
    private readonly thirdParty: ThirdPartyEmotes | null = null,
    /**
     * Economic side of the admission (ASTRA-P1-001), applied inside the admission transaction: the Lab
     * test wallet by default; the canonical Core Wallet only where explicitly wired (tests today).
     */
    private readonly economy: EconomyPort = labEconomy,
  ) {}

  /** Public 7TV/BTTV/FFZ catalog of the channel (for the Studio façade). */
  async thirdPartyCatalog(force = false) {
    if (!this.thirdParty)
      throw new BonkLabError409(
        'emote_not_available',
        'third-party emotes disabled',
      );
    return this.thirdParty.catalog({ force });
  }

  /**
   * Emote resolved by Core from its own data: the local Twemoji table, or the viewer's stored
   * Twitch catalog (Get User Emotes). Never a URL from the caller.
   */
  private async resolveEmote(
    q: Queryable,
    viewerId: string,
    e: Emote,
    pre: Prefetched,
  ): Promise<ResolvedEmote> {
    const req = { emote: e, viewer: { id: viewerId } };
    const twitchError = pre.twitchError;
    const thirdParty = pre.thirdParty.get(`${e.provider}:${e.id}`) ?? null;
    if (isThirdParty(req.emote.provider)) {
      // Resolved before the transaction from the channel's public catalog: provider + id only.
      if (req.emote.glyph)
        throw new BonkLabError409('emote_not_available', 'unexpected glyph');
      if (thirdParty === 'unavailable')
        throw new BonkLabError409(
          'catalog_unavailable',
          `${req.emote.provider} catalog unavailable`,
        );
      if (!thirdParty)
        throw new BonkLabError409(
          'emote_not_in_catalog',
          `not a ${req.emote.provider} emote of this channel`,
        );
      return {
        glyph: null,
        url: thirdParty.url,
        animated: thirdParty.animated,
      };
    }
    if (req.emote.provider === 'unicode') {
      const emote = twemojiEmote(req.emote.id);
      if (!emote)
        throw new BonkLabError409(
          'emote_not_available',
          `emote ${req.emote.id} is not a Unicode emoji id`,
        );
      if (req.emote.glyph && req.emote.glyph !== emote.glyph)
        throw new BonkLabError409(
          'emote_mismatch',
          'glyph does not match the emote id',
        );
      return emote;
    }
    const id = /^twitch:([A-Za-z0-9_]{1,64})$/.exec(req.emote.id)?.[1];
    if (!id || req.emote.glyph)
      throw new BonkLabError409(
        'emote_not_available',
        'invalid Twitch emote id',
      );
    if (!this.twitch)
      throw new BonkLabError409(
        'emote_not_available',
        'Twitch catalog disabled',
      );
    const catalog = await this.twitch.storedCatalog(req.viewer.id, q);
    if (
      !catalog ||
      this.clock.now().getTime() - Date.parse(catalog.fetched_at) >
        CATALOG_MAX_AGE_MS
    )
      throw new BonkLabError409(
        twitchError ?? 'catalog_unavailable',
        'no recent Twitch emote catalog for this viewer',
      );
    const emote = catalog.emotes.find((e) => e.id === id);
    if (!emote)
      throw new BonkLabError409(
        'emote_not_in_catalog',
        'this viewer cannot use this emote',
      );
    return { glyph: null, url: emote.url, animated: emote.animated };
  }

  // --- readiness ---------------------------------------------------------------------------------

  async heartbeat(h: BonkLabHeartbeat): Promise<{ ok: true }> {
    await this.db.query(
      `insert into bonk_lab_studios (studio_instance_id, obs, source_ready, overlay_ready, last_seen)
       values ($1, $2, $3, $4, $5)
       on conflict (studio_instance_id) do update set obs = excluded.obs, source_ready = excluded.source_ready,
         overlay_ready = excluded.overlay_ready, last_seen = excluded.last_seen`,
      [
        h.studio_instance_id,
        h.obs,
        h.source_ready,
        h.overlay_ready,
        this.clock.now(),
      ],
    );
    return { ok: true };
  }

  /** Throws the precise reason when no fresh, ready Studio can execute a Bonk now. */
  private async assertReady(
    q: Queryable,
    studioId: string | null = null,
  ): Promise<void> {
    const since = new Date(
      this.clock.now().getTime() - BONK_LAB_RULES.heartbeatFreshMs,
    );
    const studio = (
      await q.query<{
        obs: string;
        source_ready: boolean;
        overlay_ready: boolean;
      }>(
        'select obs, source_ready, overlay_ready from bonk_lab_studios where last_seen >= $1 and ($2::text is null or studio_instance_id = $2) order by last_seen desc limit 1',
        [since, studioId],
      )
    )[0];
    if (!studio) throw new BonkLabUnavailableError('studio_offline');
    if (studio.obs !== 'connected')
      throw new BonkLabUnavailableError('obs_offline');
    // An open OBS connection is not enough: the Lab source and a live renderer heartbeat are required.
    if (!studio.source_ready || !studio.overlay_ready)
      throw new BonkLabUnavailableError('overlay_not_ready');
  }

  // --- admission ---------------------------------------------------------------------------------

  async admit(req: BonkLabAdmitRequest): Promise<BonkLabAdmitResponse> {
    try {
      return await this.admitTx(req);
    } catch (e) {
      // Pause globale (D4): refused before anything is stored or paid; the refusal is counted.
      if (!(e instanceof GlobalPauseError)) throw e;
      await countGlobalRefusal(this.db, req.channel_id, this.clock.now());
      throw new BonkLabError409('global_pause', e.message);
    }
  }

  /**
   * Network outside the transaction: refresh a stale Twitch catalog (its error is kept for the answer)
   * and resolve each 7TV/BTTV/FFZ id from the channel's public catalog.
   */
  private async prefetch(
    viewerId: string,
    emotes: Emote[],
  ): Promise<Prefetched> {
    const pre: Prefetched = { twitchError: null, thirdParty: new Map() };
    if (emotes.some((e) => e.provider === 'twitch') && this.twitch)
      await this.twitch.catalog(viewerId).catch((error: unknown) => {
        pre.twitchError =
          error instanceof TwitchViewerError
            ? error.code
            : 'catalog_unavailable';
      });
    for (const e of emotes) {
      const provider = e.provider;
      const key = `${provider}:${e.id}`;
      if (!isThirdParty(provider) || pre.thirdParty.has(key)) continue;
      const prefix = `${provider}:`;
      const id = e.id.startsWith(prefix) ? e.id.slice(prefix.length) : '';
      pre.thirdParty.set(
        key,
        this.thirdParty
          ? await this.thirdParty
              .resolve(provider, id)
              .catch(() => 'unavailable' as const)
          : null,
      );
    }
    return pre;
  }

  /** Channel row lock: serializes admissions of the channel (durable sequence allocation). */
  private async lockChannel(q: Queryable, channelId: string) {
    await q.query(
      'insert into bonk_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
      [channelId],
    );
    await q.query(
      'select last_sequence from bonk_lab_channels where channel_id = $1 for update',
      [channelId],
    );
  }

  /** Moderation V2 (Core): refused before admission, nothing recorded. */
  private async assertAdmissible(
    q: Queryable,
    channelId: string,
    viewerId: string,
  ) {
    const now0 = this.clock.now();
    await assertNotGloballyPaused(q, channelId);
    const state = await moduleState(q, 'bonk');
    if (state === 'disabled')
      throw new BonkLabError409('module_disabled', 'Bonk disabled');
    if (state === 'paused')
      throw new BonkLabError409('bonk_paused', 'Bonk paused by moderation');
    if (await activeBlock(q, channelId, viewerId, 'bonk', now0))
      throw new BonkLabError409(
        'viewer_blocked',
        'Bonk unavailable for this viewer',
      );
    const imposed = await personalCooldownMs(
      q,
      channelId,
      viewerId,
      'bonk',
      now0,
    );
    if (imposed > 0)
      throw new BonkLabError409(
        'viewer_cooldown',
        `cooldown imposed by moderation (${Math.ceil(imposed / 1000)} s)`,
      );
  }

  /** Executable now and room for `count` more open Bonks (bounded queue), else refused. */
  private async assertCapacity(q: Queryable, channelId: string, count: number) {
    await this.sweep(q, channelId);
    await this.assertReady(q);
    const open = (
      await q.query<{ n: number | string }>(
        "select count(*) as n from bonk_lab_interactions where channel_id = $1 and status in ('accepted', 'queued', 'executing')",
        [channelId],
      )
    )[0]!;
    if (Number(open.n) + count > BONK_LAB_RULES.maxOpenPerChannel)
      throw new BonkLabError409('queue_full', 'too many Bonks waiting');
  }

  /** Reserves `count` contiguous channel sequences; returns the first one. */
  private async allocate(q: Queryable, channelId: string, count: number) {
    const last = (
      await q.query<{ last_sequence: number | string }>(
        'update bonk_lab_channels set last_sequence = last_sequence + $2 where channel_id = $1 returning last_sequence',
        [channelId, count],
      )
    )[0]!.last_sequence;
    return Number(last) - count + 1;
  }

  /** One admitted Bonk, already `queued` (accepted and queued commit in the same transaction). */
  private async insertShot(
    q: Queryable,
    shot: {
      id: string;
      key: string;
      requestHash: string;
      channelId: string;
      viewer: BonkLabAdmitRequest['viewer'];
      labSessionId: string;
      emote: Emote;
      resolved: ResolvedEmote;
      sequence: number;
      now: Date;
      volley: {
        id: string;
        index: number;
        count: number;
        cadenceMs: number;
      } | null;
    },
  ) {
    const v = shot.volley;
    await q.query(
      `insert into bonk_lab_interactions (interaction_id, idempotency_key, request_hash, source, channel_id,
         viewer_id, viewer_display_name, type, provider, emote_id, emote_glyph, emote_url, emote_animated,
         quantity, created_at, channel_sequence, test_mode, payment_mode, simulated_cost, simulated_currency,
         real_debited, status, lab_session_id, expires_at, error, updated_at,
         volley_id, volley_index, volley_count, cadence_ms)
       values ($1, $2, $3, 'extension_lab', $4, $5, $6, 'bonk', $17, $7, $8, $9, $10,
         1, $11, $12, true, 'simulated', $13, $14, 0, 'queued', $15, $16, null, $11,
         $18, $19, $20, $21)`,
      [
        shot.id,
        shot.key,
        shot.requestHash,
        shot.channelId,
        shot.viewer.id,
        shot.viewer.display_name,
        shot.emote.id,
        shot.resolved.glyph,
        shot.resolved.url,
        shot.resolved.animated,
        shot.now,
        shot.sequence,
        BONK_LAB_RULES.simulatedCost,
        BONK_LAB_RULES.simulatedCurrency,
        shot.labSessionId,
        new Date(shot.now.getTime() + BONK_LAB_RULES.expiresAfterMs),
        shot.emote.provider,
        v?.id ?? null,
        v?.index ?? null,
        v?.count ?? null,
        v?.cadenceMs ?? null,
      ],
    );
  }

  private async admitTx(
    req: BonkLabAdmitRequest,
  ): Promise<BonkLabAdmitResponse> {
    // Hash of what the viewer asked for: a retry with the same key must ask for the same Bonk.
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          'bonk',
          req.emote.provider,
          req.emote.id,
          req.emote.glyph ?? null,
          req.lab_session_id,
        ]),
      )
      .digest('hex');
    const pre = await this.prefetch(req.viewer.id, [req.emote]);

    return this.db.tx(async (q) => {
      await this.lockChannel(q, req.channel_id);

      const prior = (
        await q.query<Row>(
          `${SELECT} where i.channel_id = $1 and i.viewer_id = $2 and i.idempotency_key = $3`,
          [req.channel_id, req.viewer.id, req.idempotency_key],
        )
      )[0];
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new BonkLabError409(
            'idempotency_conflict',
            'idempotency key already used for another Bonk',
          );
        return { interaction: toInteraction(prior), replayed: true };
      }

      await this.assertAdmissible(q, req.channel_id, req.viewer.id);
      const emote = await this.resolveEmote(q, req.viewer.id, req.emote, pre);
      await this.assertCapacity(q, req.channel_id, 1);

      const seq = await this.allocate(q, req.channel_id, 1);
      const now = this.clock.now();
      const id = randomUUID();
      await this.insertShot(q, {
        id,
        key: req.idempotency_key,
        requestHash,
        channelId: req.channel_id,
        viewer: req.viewer,
        labSessionId: req.lab_session_id,
        emote: req.emote,
        resolved: emote,
        sequence: seq,
        now,
        volley: null,
      });
      await seeViewer(
        q,
        req.channel_id,
        req.viewer.id,
        req.viewer.display_name,
        now,
      );
      // Lab test wallet: debited in the same transaction (refused → nothing admitted, nothing stored).
      await this.economy.debit(q, now, {
        channelId: req.channel_id,
        viewer: req.viewer,
        currency: 'tokens',
        amount: BONK_LAB_RULES.simulatedCost,
        module: 'bonk',
        interactionId: id,
      });
      return { interaction: (await this.byId(q, id))!, replayed: false };
    });
  }

  /**
   * Salve (lot 5, mode Auto): N individual Bonks admitted in ONE transaction — validation, contiguous
   * channel sequences and N debits (one per shot, the same debit as a single Bonk). One refusal (wallet,
   * emote, queue, moderation…) and nothing is stored or paid: never a partial salve. Each shot then
   * lives like a single Bonk (delivery, ACK, refund before start, sweep).
   */
  async admitVolley(
    req: BonkLabVolleyAdmitRequest,
  ): Promise<BonkLabVolleyAdmitResponse> {
    try {
      return await this.admitVolleyTx(req);
    } catch (e) {
      if (!(e instanceof GlobalPauseError)) throw e;
      await countGlobalRefusal(this.db, req.channel_id, this.clock.now());
      throw new BonkLabError409('global_pause', e.message);
    }
  }

  private async admitVolleyTx(
    req: BonkLabVolleyAdmitRequest,
  ): Promise<BonkLabVolleyAdmitResponse> {
    const count = req.emotes.length;
    if (count > BONK_LAB_RULES.volleyMaxShots)
      throw new BonkLabError409(
        'volley_too_large',
        `at most ${BONK_LAB_RULES.volleyMaxShots} Bonks per salve`,
      );
    if (
      req.cadence_ms < BONK_LAB_RULES.volleyCadenceMinMs ||
      req.cadence_ms > BONK_LAB_RULES.volleyCadenceMaxMs
    )
      throw new BonkLabError409(
        'invalid_cadence',
        `cadence between ${BONK_LAB_RULES.volleyCadenceMinMs} and ${BONK_LAB_RULES.volleyCadenceMaxMs} ms`,
      );
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          'bonk_volley',
          req.emotes.map((e) => [e.provider, e.id, e.glyph ?? null]),
          req.cadence_ms,
          req.lab_session_id,
        ]),
      )
      .digest('hex');
    // Each shot gets `<key>#<index>` (the unique per-viewer key of the table); the first one is the
    // salve's idempotency record.
    const keyOf = (index: number) => `${req.idempotency_key}#${index}`;
    const pre = await this.prefetch(req.viewer.id, req.emotes);

    return this.db.tx(async (q) => {
      await this.lockChannel(q, req.channel_id);

      const prior = (
        await q.query<Row>(
          `${SELECT} where i.channel_id = $1 and i.viewer_id = $2 and i.idempotency_key = $3`,
          [req.channel_id, req.viewer.id, keyOf(0)],
        )
      )[0];
      if (prior) {
        if (prior.request_hash !== requestHash || prior.volley_id === null)
          throw new BonkLabError409(
            'idempotency_conflict',
            'idempotency key already used for another salve',
          );
        return {
          volley_id: prior.volley_id,
          interactions: await this.byVolley(q, prior.volley_id),
          replayed: true,
        };
      }

      await this.assertAdmissible(q, req.channel_id, req.viewer.id);
      const resolved: ResolvedEmote[] = [];
      for (const e of req.emotes)
        resolved.push(await this.resolveEmote(q, req.viewer.id, e, pre));
      await this.assertCapacity(q, req.channel_id, count);

      const first = await this.allocate(q, req.channel_id, count);
      const now = this.clock.now();
      const volleyId = randomUUID();
      const ids = req.emotes.map(() => randomUUID());
      for (const [index, emote] of req.emotes.entries())
        await this.insertShot(q, {
          id: ids[index]!,
          key: keyOf(index),
          requestHash,
          channelId: req.channel_id,
          viewer: req.viewer,
          labSessionId: req.lab_session_id,
          emote,
          resolved: resolved[index]!,
          sequence: first + index,
          now,
          volley: {
            id: volleyId,
            index,
            count,
            cadenceMs: req.cadence_ms,
          },
        });
      await seeViewer(
        q,
        req.channel_id,
        req.viewer.id,
        req.viewer.display_name,
        now,
      );
      // Same transaction: N debits or none (an insufficient balance on the last shot refuses the salve).
      for (const id of ids)
        await this.economy.debit(q, now, {
          channelId: req.channel_id,
          viewer: req.viewer,
          currency: 'tokens',
          amount: BONK_LAB_RULES.simulatedCost,
          module: 'bonk',
          interactionId: id,
        });
      return {
        volley_id: volleyId,
        interactions: await this.byVolley(q, volleyId),
        replayed: false,
      };
    });
  }

  private async byVolley(
    q: Queryable,
    volleyId: string,
  ): Promise<BonkLabInteraction[]> {
    const rows = await q.query<Row>(
      `${SELECT} where i.volley_id = $1 order by i.volley_index`,
      [volleyId],
    );
    return rows.map(toInteraction);
  }

  async get(interactionId: string): Promise<BonkLabInteraction> {
    const found = await this.byId(this.db, interactionId);
    if (!found) throw new BonkLabNotFoundError(interactionId);
    return found;
  }

  /** Latest interactions of a viewer (Lab session history for the extension/Studio). */
  async recent(
    channelId: string,
    viewerId: string | null,
    limit = 20,
  ): Promise<BonkLabInteraction[]> {
    return this.db.tx(async (q) => {
      await q.query(
        'select 1 from bonk_lab_channels where channel_id = $1 for update',
        [channelId],
      );
      await this.sweep(q, channelId);
      const rows = await q.query<Row>(
        `${SELECT} where i.channel_id = $1 and ($2::text is null or i.viewer_id = $2)
       order by i.channel_sequence desc limit $3`,
        [channelId, viewerId, limit],
      );
      return rows.map(toInteraction);
    });
  }

  // --- execution (Studio worker) --------------------------------------------------------------------

  /**
   * Next Bonk to start, in channel_sequence order. Refuses to hand out a new one while an earlier
   * claim has not started yet (start order), but allows overlap once it has started.
   */
  /**
   * At most once (conditional update + unique ledger entry): the Bonk becomes « refunded » and the
   * Lab test wallet gets back exactly what was debited for it. Audited.
   */
  private async refund(
    q: Queryable,
    interactionId: string,
    actor: Actor,
    reason: string,
    role?: LabRole,
  ): Promise<boolean> {
    const now = this.clock.now();
    const done = await q.query<{ channel_id: string; viewer_id: string }>(
      `update bonk_lab_interactions set refund_status = 'refunded', refunded_at = $2, updated_at = $2
       where interaction_id = $1 and refund_status = 'none' returning channel_id, viewer_id`,
      [interactionId, now],
    );
    if (!done.length) return false;
    const back = await this.economy.refund(
      q,
      now,
      interactionId,
      actorName(actor),
      reason,
    );
    await audit(q, now, {
      channelId: done[0]!.channel_id,
      actor,
      role,
      module: 'bonk',
      action: 'refund',
      viewerId: done[0]!.viewer_id,
      interactionId,
      reason,
      before: { refund_status: 'none' },
      after: {
        refund_status: 'refunded',
        amount: back.amount,
        currency: back.currency,
      },
    });
    return true;
  }

  /**
   * Bonk commands: module state, and the refund of a finished Bonk (Admin Wallet). A Bonk is a short
   * visual impact, not a queue to curate: no stop / cancel (refused explicitly).
   */
  async applyModeration(
    q: Queryable,
    channelId: string,
    cmd: LabModerationCommand,
    actor: Actor,
    role: LabRole,
  ) {
    const now = this.clock.now();
    if (cmd.action === 'refund') {
      const row = await this.byId(q, cmd.interaction_id);
      if (!row || row.channel_id !== channelId)
        throw new BonkLabNotFoundError(cmd.interaction_id);
      if (!TERMINAL.includes(row.status))
        throw new BonkLabError409('not_terminal', 'this Bonk is not finished');
      if (
        !(await this.refund(
          q,
          row.interaction_id,
          actor,
          cmd.reason ?? 'moderator_refund',
          role,
        ))
      )
        throw new BonkLabError409('already_refunded', 'already refunded');
      return { ok: true, refunded: true };
    }
    if (cmd.action !== 'module_state')
      throw new BonkLabError409(
        'unsupported',
        `${cmd.action} does not apply to Bonk`,
      );
    const before = await moduleState(q, 'bonk');
    await setModuleState(q, 'bonk', cmd.state, now, actor.id);
    await audit(q, now, {
      channelId,
      actor,
      role,
      module: 'bonk',
      action: `module_${cmd.state}`,
      reason: cmd.reason ?? null,
      before: { state: before },
      after: { state: cmd.state },
    });
    return { ok: true, module_state: cmd.state };
  }

  async moderationQueue(channelId: string) {
    const rows = await this.db.query<Row>(
      `${SELECT} where i.channel_id = $1 order by i.channel_sequence desc limit 20`,
      [channelId],
    );
    return {
      module_state: await moduleState(this.db, 'bonk'),
      recent: rows.map(toInteraction),
    };
  }

  /** Next Bonk only (historical shape). A salve's other shots are then claimed one at a time. */
  async claim(
    studioInstanceId: string,
    channelId: string,
  ): Promise<BonkLabInteraction | null> {
    return (await this.claimTx(studioInstanceId, channelId, false)).interaction;
  }

  /**
   * Next Bonk and, when it opens (or continues) a salve, the salve's remaining queued shots claimed in
   * the same transaction, each with its own delivery and lease, in firing order: the renderer gets the
   * whole salve at once and keeps its cadence. Used by the Lab and production transport routes.
   */
  async claimBatch(
    studioInstanceId: string,
    channelId: string,
  ): Promise<{
    interaction: BonkLabInteraction | null;
    volley: BonkLabInteraction[] | null;
  }> {
    return this.claimTx(studioInstanceId, channelId, true);
  }

  private async claimTx(
    studioInstanceId: string,
    channelId: string,
    batch: boolean,
  ): Promise<{
    interaction: BonkLabInteraction | null;
    volley: BonkLabInteraction[] | null;
  }> {
    const none = { interaction: null, volley: null };
    return this.db.tx(async (q) => {
      await q.query(
        'insert into bonk_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
        [channelId],
      );
      await q.query(
        'select 1 from bonk_lab_channels where channel_id = $1 for update',
        [channelId],
      );
      await this.sweep(q, channelId);
      await this.assertReady(q, studioInstanceId);
      // Paused: waiting Bonks stay queued, nothing new is sent to OBS.
      if ((await moduleState(q, 'bonk')) !== 'active') return none;
      const pendingStart = (
        await q.query<{ n: number | string }>(
          `select count(*) as n from bonk_lab_interactions i join bonk_lab_deliveries d using (interaction_id)
           where i.channel_id = $1 and i.status = 'queued' and d.started_at is null`,
          [channelId],
        )
      )[0]!;
      if (Number(pendingStart.n) > 0) return none;
      const next = (
        await q.query<{
          interaction_id: string;
          volley_id: string | null;
          volley_index: number | null;
        }>(
          `select interaction_id, volley_id, volley_index from bonk_lab_interactions i
           where channel_id = $1 and status = 'queued'
             and not exists (select 1 from bonk_lab_deliveries d where d.interaction_id = i.interaction_id)
           order by channel_sequence limit 1`,
          [channelId],
        )
      )[0];
      if (!next) return none;
      const now = this.clock.now();
      // The rest of a salve: its later queued, unclaimed shots (contiguous sequences, same order).
      const rest =
        batch && next.volley_id !== null
          ? await q.query<{ interaction_id: string }>(
              `select interaction_id from bonk_lab_interactions i
               where channel_id = $1 and volley_id = $2 and volley_index > $3 and status = 'queued'
                 and not exists (select 1 from bonk_lab_deliveries d where d.interaction_id = i.interaction_id)
               order by volley_index`,
              [channelId, next.volley_id, next.volley_index],
            )
          : [];
      const ids = [next.interaction_id, ...rest.map((r) => r.interaction_id)];
      for (const id of ids)
        await q.query(
          `insert into bonk_lab_deliveries (interaction_id, studio_instance_id, attempt_id, lease_expires_at)
           values ($1, $2, $3, $4)`,
          [
            id,
            studioInstanceId,
            randomUUID(),
            new Date(now.getTime() + BONK_LAB_RULES.claimLeaseMs),
          ],
        );
      const claimed: BonkLabInteraction[] = [];
      for (const id of ids) claimed.push((await this.byId(q, id))!);
      return {
        interaction: claimed[0]!,
        volley: next.volley_id === null ? null : claimed.slice(1),
      };
    });
  }

  /** Renderer/Studio outcome for the current attempt. Idempotent; never regresses a final state. */
  async ack(
    interactionId: string,
    a: BonkLabAckRequest,
  ): Promise<BonkLabInteraction> {
    return this.db.tx(async (q) => {
      // All transitions share the channel lock, including sweeps: an expiry query must not
      // evaluate a stale joined delivery while a started ACK renews its lease.
      const channel = (
        await q.query<{ channel_id: string }>(
          'select channel_id from bonk_lab_interactions where interaction_id = $1',
          [interactionId],
        )
      )[0];
      if (!channel) throw new BonkLabNotFoundError(interactionId);
      await q.query(
        'select 1 from bonk_lab_channels where channel_id = $1 for update',
        [channel.channel_id],
      );
      // Lock first, then read in a new statement: under READ COMMITTED a waiting transaction must
      // see the delivery row committed by the ACK it waited for (a join read in the locking
      // statement would keep the old delivery values).
      await q.query(
        'select 1 from bonk_lab_interactions where interaction_id = $1 for update',
        [interactionId],
      );
      const cur = (
        await q.query<Row>(`${SELECT} where i.interaction_id = $1`, [
          interactionId,
        ])
      )[0];
      if (!cur) throw new BonkLabNotFoundError(interactionId);
      if (
        cur.attempt_id !== a.attempt_id ||
        cur.studio_instance_id !== a.studio_instance_id
      )
        throw new BonkLabError409(
          'attempt_mismatch',
          'this attempt does not own the interaction',
        );
      const now = this.clock.now();
      const set = async (status: BonkLabStatus, error: BonkLabError | null) =>
        q.query(
          'update bonk_lab_interactions set status = $2, error = $3, updated_at = $4 where interaction_id = $1',
          [interactionId, status, error ? JSON.stringify(error) : null, now],
        );
      const started = cur.started_at !== null;

      switch (a.event) {
        case 'started':
          if (started) break; // replay of a known ACK
          if (cur.status !== 'queued')
            throw new BonkLabError409(
              'invalid_transition',
              `cannot start from ${cur.status}`,
            );
          await q.query(
            'update bonk_lab_deliveries set started_at = $2, lease_expires_at = $3 where interaction_id = $1',
            [
              interactionId,
              now,
              new Date(now.getTime() + BONK_LAB_RULES.executingLeaseMs),
            ],
          );
          await set('executing', null);
          break;
        case 'completed':
          if (cur.status === 'completed') break;
          if (cur.status !== 'executing')
            throw new BonkLabError409(
              'invalid_transition',
              `cannot complete from ${cur.status}`,
            );
          await q.query(
            'update bonk_lab_deliveries set completed_at = $2 where interaction_id = $1',
            [interactionId, now],
          );
          await set('completed', null);
          break;
        case 'failed':
          if (cur.status === 'failed') break;
          if (cur.status !== 'queued' && cur.status !== 'executing')
            throw new BonkLabError409(
              'invalid_transition',
              `cannot fail from ${cur.status}`,
            );
          await set(
            'failed',
            err(
              a.error?.code ?? 'render_failed',
              a.error?.message ?? 'renderer reported a failure',
            ),
          );
          // Never shown (renderer error before the start): the Lab test wallet gets its debit back.
          if (!started)
            await deferrableRefund(q, () =>
              this.refund(q, interactionId, SYSTEM, 'failed_before_start'),
            );
          break;
        case 'execution_unknown':
          if (cur.status === 'execution_unknown') break;
          if (cur.status !== 'queued' && cur.status !== 'executing')
            throw new BonkLabError409(
              'invalid_transition',
              `cannot mark unknown from ${cur.status}`,
            );
          await set(
            'execution_unknown',
            err(
              a.error?.code ?? 'execution_unknown',
              a.error?.message ?? 'sent to the renderer, outcome not provable',
            ),
          );
          break;
        case 'released':
          // Claimed but certainly never sent to the renderer: back to the queue, same sequence.
          if (cur.status !== 'queued' || started)
            throw new BonkLabError409(
              'invalid_transition',
              'only an unstarted claim can be released',
            );
          await q.query(
            'delete from bonk_lab_deliveries where interaction_id = $1',
            [interactionId],
          );
          break;
      }
      return (await this.byId(q, interactionId))!;
    });
  }

  /**
   * Time-driven expiry, independent of claims (Bonk VNext lot 0): a channel no Studio claims any more
   * still gets its expired work settled. Each channel runs the same `sweep` under the same channel
   * lock as admission, claim and ACK, so several Core instances serialize on it; the transitions are
   * conditional and the refund is at most once. Returns the number of channels swept.
   */
  async sweepExpired(): Promise<number> {
    const channels = await this.db.query<{ channel_id: string }>(
      `select distinct i.channel_id from bonk_lab_interactions i
         left join bonk_lab_deliveries d using (interaction_id)
       where (i.status = 'queued' and i.expires_at < $1 and d.interaction_id is null)
          or (i.status in ('queued', 'executing') and d.lease_expires_at < $1)`,
      [this.clock.now()],
    );
    for (const { channel_id } of channels)
      await this.db.tx(async (q) => {
        await q.query(
          'select 1 from bonk_lab_channels where channel_id = $1 for update',
          [channel_id],
        );
        await this.sweep(q, channel_id);
      });
    return channels.length;
  }

  // --- helpers -------------------------------------------------------------------------------------

  /**
   * Expired or abandoned work, never turned into a success:
   * - queued, never claimed, past expires_at → failed(expired);
   * - claimed, lease over, never started → execution_unknown (it may have been sent);
   * - executing, lease over, never completed → execution_unknown.
   */
  private async sweep(q: Queryable, channelId: string): Promise<void> {
    const now = this.clock.now();
    const expired = await q.query<{ interaction_id: string }>(
      `update bonk_lab_interactions i set status = 'failed', updated_at = $2,
         error = '{"code":"expired","message":"not started before expiry","retryable":false}'::jsonb
       where channel_id = $1 and status = 'queued' and expires_at < $2
         and not exists (select 1 from bonk_lab_deliveries d where d.interaction_id = i.interaction_id)
       returning interaction_id`,
      [channelId, now],
    );
    for (const e of expired)
      await deferrableRefund(q, () =>
        this.refund(q, e.interaction_id, SYSTEM, 'expired'),
      );
    await q.query(
      `update bonk_lab_interactions i set status = 'execution_unknown', updated_at = $2,
         error = '{"code":"lease_expired","message":"no renderer proof before the lease ended","retryable":false}'::jsonb
       from bonk_lab_deliveries d
       where d.interaction_id = i.interaction_id and i.channel_id = $1
         and i.status in ('queued', 'executing') and d.lease_expires_at < $2`,
      [channelId, now],
    );
  }

  private async byId(
    q: Queryable,
    id: string,
  ): Promise<BonkLabInteraction | null> {
    const row = (
      await q.query<Row>(`${SELECT} where i.interaction_id = $1`, [id])
    )[0];
    return row ? toInteraction(row) : null;
  }

  static isTerminal(status: BonkLabStatus) {
    return TERMINAL.includes(status);
  }
}
