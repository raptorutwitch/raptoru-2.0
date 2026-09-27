import { createHash, randomUUID } from 'node:crypto';
import type {
  BonkLabAckRequest,
  BonkLabAdmitRequest,
  BonkLabAdmitResponse,
  BonkLabError,
  BonkLabHeartbeat,
  BonkLabInteraction,
  BonkLabStatus,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import {
  CATALOG_MAX_AGE_MS,
  TwitchViewerError,
  type TwitchViewerCatalog,
} from './twitch-viewer.js';

// Bonk V2, Lab slice. Core owns validation, the authoritative interaction, its durable order
// (channel_sequence) and its status; Studio only executes and acknowledges. Test only: the payment
// is a simulated snapshot (real_debited = 0). This module deliberately imports nothing from
// Wallet, Loyalty or stats: a Lab Bonk can never move real Jetons, credits or progression.

/** First slice: a single local Twemoji, resolved by Core (never a URL from the caller). */
export const BONK_LAB_EMOTES: Record<
  string,
  { glyph: string; url: string; animated: boolean }
> = {
  'unicode:1f600': {
    glyph: '😀',
    url: 'assets/twemoji/svg/1f600.svg',
    animated: false,
  },
};

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
};

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

interface Row {
  interaction_id: string;
  provider: 'unicode' | 'twitch';
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
  status: BonkLabStatus;
  lab_session_id: string;
  expires_at: Date;
  error: BonkLabError | null;
  studio_instance_id: string | null;
  attempt_id: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
}

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
    created_at: iso(r.created_at)!,
    channel_sequence: Number(r.channel_sequence),
    test_mode: true,
    payment_mode: 'simulated',
    simulated_cost: r.simulated_cost,
    simulated_currency: r.simulated_currency,
    real_debited: 0,
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
  ) {}

  /**
   * Emote resolved by Core from its own data: the local Twemoji table, or the viewer's stored
   * Twitch catalog (Get User Emotes). Never a URL from the caller.
   */
  private async resolveEmote(
    q: Queryable,
    req: BonkLabAdmitRequest,
    twitchError: string | null,
  ): Promise<{ glyph: string | null; url: string; animated: boolean }> {
    if (req.emote.provider === 'unicode') {
      const emote = BONK_LAB_EMOTES[req.emote.id];
      if (!emote)
        throw new BonkLabError409(
          'emote_not_available',
          `emote ${req.emote.id} is not available in this Lab slice`,
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
    // Network outside the transaction: refresh a stale Twitch catalog (errors kept for the answer).
    let twitchError: string | null = null;
    if (req.emote.provider === 'twitch' && this.twitch)
      await this.twitch.catalog(req.viewer.id).catch((error: unknown) => {
        twitchError =
          error instanceof TwitchViewerError
            ? error.code
            : 'catalog_unavailable';
      });

    return this.db.tx(async (q) => {
      // Channel row lock: serializes admissions of the channel (durable sequence allocation).
      await q.query(
        'insert into bonk_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
        [req.channel_id],
      );
      await q.query(
        'select last_sequence from bonk_lab_channels where channel_id = $1 for update',
        [req.channel_id],
      );

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

      const emote = await this.resolveEmote(q, req, twitchError);

      await this.sweep(q, req.channel_id);
      await this.assertReady(q);
      const open = (
        await q.query<{ n: number | string }>(
          "select count(*) as n from bonk_lab_interactions where channel_id = $1 and status in ('accepted', 'queued', 'executing')",
          [req.channel_id],
        )
      )[0]!;
      if (Number(open.n) >= BONK_LAB_RULES.maxOpenPerChannel)
        throw new BonkLabError409('queue_full', 'too many Bonks waiting');

      const seq = (
        await q.query<{ last_sequence: number | string }>(
          'update bonk_lab_channels set last_sequence = last_sequence + 1 where channel_id = $1 returning last_sequence',
          [req.channel_id],
        )
      )[0]!.last_sequence;
      const now = this.clock.now();
      const id = randomUUID();
      // accepted and queued are committed in the same transaction: the answer is already `queued`.
      await q.query(
        `insert into bonk_lab_interactions (interaction_id, idempotency_key, request_hash, source, channel_id,
           viewer_id, viewer_display_name, type, provider, emote_id, emote_glyph, emote_url, emote_animated,
           quantity, created_at, channel_sequence, test_mode, payment_mode, simulated_cost, simulated_currency,
           real_debited, status, lab_session_id, expires_at, error, updated_at)
         values ($1, $2, $3, 'extension_lab', $4, $5, $6, 'bonk', $17, $7, $8, $9, $10,
           1, $11, $12, true, 'simulated', $13, $14, 0, 'queued', $15, $16, null, $11)`,
        [
          id,
          req.idempotency_key,
          requestHash,
          req.channel_id,
          req.viewer.id,
          req.viewer.display_name,
          req.emote.id,
          emote.glyph,
          emote.url,
          emote.animated,
          now,
          Number(seq),
          BONK_LAB_RULES.simulatedCost,
          BONK_LAB_RULES.simulatedCurrency,
          req.lab_session_id,
          new Date(now.getTime() + BONK_LAB_RULES.expiresAfterMs),
          req.emote.provider,
        ],
      );
      return { interaction: (await this.byId(q, id))!, replayed: false };
    });
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
  async claim(
    studioInstanceId: string,
    channelId: string,
  ): Promise<BonkLabInteraction | null> {
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
      const pendingStart = (
        await q.query<{ n: number | string }>(
          `select count(*) as n from bonk_lab_interactions i join bonk_lab_deliveries d using (interaction_id)
           where i.channel_id = $1 and i.status = 'queued' and d.started_at is null`,
          [channelId],
        )
      )[0]!;
      if (Number(pendingStart.n) > 0) return null;
      const next = (
        await q.query<{ interaction_id: string }>(
          `select interaction_id from bonk_lab_interactions i
           where channel_id = $1 and status = 'queued'
             and not exists (select 1 from bonk_lab_deliveries d where d.interaction_id = i.interaction_id)
           order by channel_sequence limit 1`,
          [channelId],
        )
      )[0];
      if (!next) return null;
      const now = this.clock.now();
      await q.query(
        `insert into bonk_lab_deliveries (interaction_id, studio_instance_id, attempt_id, lease_expires_at)
         values ($1, $2, $3, $4)`,
        [
          next.interaction_id,
          studioInstanceId,
          randomUUID(),
          new Date(now.getTime() + BONK_LAB_RULES.claimLeaseMs),
        ],
      );
      return (await this.byId(q, next.interaction_id))!;
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

  // --- helpers -------------------------------------------------------------------------------------

  /**
   * Expired or abandoned work, never turned into a success:
   * - queued, never claimed, past expires_at → failed(expired);
   * - claimed, lease over, never started → execution_unknown (it may have been sent);
   * - executing, lease over, never completed → execution_unknown.
   */
  private async sweep(q: Queryable, channelId: string): Promise<void> {
    const now = this.clock.now();
    await q.query(
      `update bonk_lab_interactions i set status = 'failed', updated_at = $2,
         error = '{"code":"expired","message":"not started before expiry","retryable":false}'::jsonb
       where channel_id = $1 and status = 'queued' and expires_at < $2
         and not exists (select 1 from bonk_lab_deliveries d where d.interaction_id = i.interaction_id)`,
      [channelId, now],
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
