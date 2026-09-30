import { createHash, randomUUID } from 'node:crypto';
import type {
  SoundLabAckRequest,
  SoundLabAdmitRequest,
  SoundLabAdmitResponse,
  SoundLabError,
  SoundLabHeartbeat,
  SoundLabInteraction,
  SoundLabPlaybackMode,
  SoundLabSettings,
  SoundLabSound,
  SoundLabSoundConfig,
  SoundLabSoundUpdate,
  SoundLabStatus,
} from '@raptoru/schemas';
import type { LabModerationCommand } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import {
  activeBlock,
  actorName,
  assertNotGloballyPaused,
  audit,
  countGlobalRefusal,
  debit,
  GlobalPauseError,
  moduleState,
  personalCooldownMs,
  refundDebit,
  seeViewer,
  setModuleState,
  SYSTEM,
  type Actor,
  type LabRole,
} from '../lab-moderation/store.js';
import { SOUND_BANK, type SoundBankEntry } from './bank.js';

// Soundboard V2, Lab slice. Same contract as the Bonk Lab: Core owns the catalog, validation, the
// authoritative interaction, its durable order (channel_sequence) and its status; Studio only
// plays and acknowledges. Test only: the Lab test wallet is debited at admission (real_debited = 0),
// refunded at most once (moderation, or automatically when the sound can never be played). This
// module imports nothing from Wallet, Loyalty or stats.

export const SOUND_LAB_RULES = {
  simulatedCurrency: { tokens: 'jetons_lab', credits: 'credits_lab' },
  /** A queued sound not started within this delay fails as expired (no stale replay later). */
  expiresAfterMs: 120_000,
  /** Studio heartbeat freshness required to admit or claim. */
  heartbeatFreshMs: 10_000,
  /** Lease of a claimed attempt until the player reports `started`. */
  claimLeaseMs: 30_000,
  /** Once started: the sound duration plus this margin, until `completed`. */
  executingMarginMs: 15_000,
  /** Bounded queue: refused before admission, nothing recorded. */
  maxOpenPerChannel: 50,
  /** Sounds handed to the player at the same time (stack mode can overlap up to this). */
  maxConcurrent: 8,
  defaultVolumeProtection: 'light' as const,
};

/** Initial settings from the bank: short memes stack, longer sounds queue, very long ones ignore. */
export function defaultSoundConfig(entry: SoundBankEntry) {
  const longest = Math.max(0, ...entry.files.map((f) => f.duration_ms));
  const playback_mode: SoundLabPlaybackMode =
    entry.id === 'random' || longest <= 3000
      ? 'stack'
      : longest <= 8000
        ? 'queue'
        : 'ignore_if_running';
  return {
    enabled: true,
    token_cost: entry.token_cost,
    credit_cost: entry.credit_cost,
    cooldown_ms: 0,
    playback_mode,
    volume: 100,
  };
}

export class SoundLabError409 extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Studio or its player not ready: refused before admission (nothing stored). */
export class SoundLabUnavailableError extends Error {
  constructor(readonly code: 'studio_offline' | 'player_offline') {
    super(code);
  }
}

export class SoundLabNotFoundError extends Error {}

type ConfigRow = {
  sound_id: string;
  /** Studio rename (null = default name from the bank). */
  custom_label: string | null;
  enabled: boolean;
  token_cost: number;
  credit_cost: number;
  cooldown_ms: number;
  playback_mode: SoundLabPlaybackMode;
  volume: number;
};

interface Row {
  interaction_id: string;
  idempotency_key: string;
  request_hash: string;
  channel_id: string;
  viewer_id: string;
  viewer_display_name: string;
  requested_sound_id: string;
  sound_id: string;
  sound_label: string;
  sound_url: string;
  duration_ms: number;
  playback_mode: SoundLabPlaybackMode;
  volume: number;
  created_at: Date;
  channel_sequence: number | string;
  payment_method: 'tokens' | 'credits';
  simulated_cost: number;
  simulated_currency: string;
  refund_status: 'none' | 'refunded';
  refunded_at: Date | null;
  status: SoundLabStatus;
  lab_session_id: string;
  expires_at: Date;
  error: SoundLabError | null;
  studio_instance_id: string | null;
  attempt_id: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  stopped_at: Date | null;
}

const SELECT = `select i.*, d.studio_instance_id, d.attempt_id, d.lease_expires_at, d.started_at, d.completed_at, d.stopped_at
  from sound_lab_interactions i left join sound_lab_deliveries d using (interaction_id)`;
const TERMINAL: SoundLabStatus[] = ['completed', 'failed', 'execution_unknown'];
/** Finished for moderation (a manual refund may apply). */
const ENDED: SoundLabStatus[] = [...TERMINAL, 'cancelled'];
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const BANK = new Map(SOUND_BANK.map((s) => [s.id, s]));
/** Name shown to viewers: the Studio rename if any, else the bank's canonical name. */
const labelOf = (entry: SoundBankEntry, c: ConfigRow) =>
  c.custom_label ?? entry.label;

function toInteraction(r: Row): SoundLabInteraction {
  return {
    interaction_id: r.interaction_id,
    idempotency_key: r.idempotency_key,
    source: 'extension_lab',
    channel_id: r.channel_id,
    viewer_id: r.viewer_id,
    viewer_display_name: r.viewer_display_name,
    type: 'sound',
    requested_sound_id: r.requested_sound_id,
    sound_id: r.sound_id,
    sound_label: r.sound_label,
    sound_url: r.sound_url,
    duration_ms: r.duration_ms,
    playback_mode: r.playback_mode,
    volume: r.volume,
    created_at: iso(r.created_at)!,
    channel_sequence: Number(r.channel_sequence),
    test_mode: true,
    payment_mode: 'simulated',
    payment_method: r.payment_method,
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
      stopped_at: iso(r.stopped_at),
    },
  };
}

const err = (code: string, message: string): SoundLabError => ({
  code,
  message,
  retryable: false,
});

export class SoundLabService {
  private seeded = false;
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Injectable for tests (random sound, sarah variants). */
    private readonly random: () => number = Math.random,
  ) {}

  // --- catalog & configuration ---------------------------------------------------------------------

  /** Settings rows for every bank sound (existing settings are never overwritten). */
  private async seed(q: Queryable) {
    if (this.seeded) return;
    const now = this.clock.now();
    for (const entry of SOUND_BANK) {
      const d = defaultSoundConfig(entry);
      await q.query(
        `insert into sound_lab_sounds (sound_id, custom_label, enabled, token_cost, credit_cost, cooldown_ms, playback_mode, volume, updated_at)
         values ($1, null, $2, $3, $4, $5, $6, $7, $8) on conflict (sound_id) do nothing`,
        [
          entry.id,
          d.enabled,
          d.token_cost,
          d.credit_cost,
          d.cooldown_ms,
          d.playback_mode,
          d.volume,
          now,
        ],
      );
    }
    await q.query(
      `insert into sound_lab_settings (id, volume_protection, updated_at) values (true, $1, $2) on conflict (id) do nothing`,
      [SOUND_LAB_RULES.defaultVolumeProtection, now],
    );
    this.seeded = true;
  }

  private async configRows(q: Queryable): Promise<Map<string, ConfigRow>> {
    await this.seed(q);
    const rows = await q.query<ConfigRow>('select * from sound_lab_sounds');
    return new Map(rows.map((r) => [r.sound_id, r]));
  }

  /** Streamer configuration of the whole bank (Studio panel). */
  async config(): Promise<{
    sounds: SoundLabSoundConfig[];
    settings: SoundLabSettings;
  }> {
    const rows = await this.configRows(this.db);
    return {
      sounds: SOUND_BANK.map((entry) =>
        this.toConfig(entry, rows.get(entry.id)!),
      ),
      settings: await this.settings(),
    };
  }

  private toConfig(entry: SoundBankEntry, c: ConfigRow): SoundLabSoundConfig {
    return {
      id: entry.id,
      label: labelOf(entry, c),
      default_label: entry.label,
      custom_label: c.custom_label,
      enabled: c.enabled,
      token_cost: c.token_cost,
      credit_cost: c.credit_cost,
      cooldown_ms: c.cooldown_ms,
      playback_mode: c.playback_mode,
      volume: c.volume,
      duration_ms: entry.files.length
        ? Math.max(...entry.files.map((f) => f.duration_ms))
        : null,
      preview_url: entry.files[0]?.file ?? null,
      variants: entry.files.length,
    };
  }

  async updateSound(
    soundId: string,
    update: SoundLabSoundUpdate,
  ): Promise<SoundLabSoundConfig> {
    const entry = BANK.get(soundId);
    if (!entry) throw new SoundLabError409('sound_not_found', 'unknown sound');
    await this.seed(this.db);
    // Rename: an empty value, null or the default name clears custom_label (back to default).
    const { label, ...rest } = update;
    const fields: [string, unknown][] = Object.entries(rest);
    if (label !== undefined) {
      const name = label?.trim() ?? '';
      fields.push(['custom_label', name && name !== entry.label ? name : null]);
    }
    const sets = fields.map(([key], i) => `${key} = $${i + 2}`);
    const rows = await this.db.query<ConfigRow>(
      `update sound_lab_sounds set ${sets.join(', ')}, updated_at = $${fields.length + 2}
       where sound_id = $1 returning *`,
      [soundId, ...fields.map(([, value]) => value), this.clock.now()],
    );
    return this.toConfig(entry, rows[0]!);
  }

  async settings(): Promise<SoundLabSettings> {
    await this.seed(this.db);
    const row = (
      await this.db.query<SoundLabSettings>(
        'select volume_protection from sound_lab_settings where id',
      )
    )[0]!;
    return { volume_protection: row.volume_protection };
  }

  async updateSettings(settings: SoundLabSettings): Promise<SoundLabSettings> {
    await this.seed(this.db);
    await this.db.query(
      'update sound_lab_settings set volume_protection = $1, updated_at = $2 where id',
      [settings.volume_protection, this.clock.now()],
    );
    return this.settings();
  }

  /** Catalog shown to the extension, with the live cooldown and running state. */
  async catalog(channelId: string): Promise<SoundLabSound[]> {
    const rows = await this.configRows(this.db);
    const now = this.clock.now().getTime();
    const last = new Map(
      (
        await this.db.query<{ requested_sound_id: string; at: Date }>(
          `select requested_sound_id, max(created_at) as at from sound_lab_interactions
           where channel_id = $1 and status <> 'failed' group by requested_sound_id`,
          [channelId],
        )
      ).map((r) => [r.requested_sound_id, new Date(r.at).getTime()]),
    );
    const running = new Set(
      (
        await this.db.query<{ sound_id: string }>(
          `select distinct sound_id from sound_lab_interactions
           where channel_id = $1 and status in ('queued', 'executing')`,
          [channelId],
        )
      ).map((r) => r.sound_id),
    );
    return SOUND_BANK.map((entry) => {
      const c = rows.get(entry.id)!;
      const at = last.get(entry.id);
      return {
        id: entry.id,
        label: labelOf(entry, c),
        preview_url: entry.files[0]?.file ?? null,
        duration_ms: entry.files.length
          ? Math.max(...entry.files.map((f) => f.duration_ms))
          : null,
        token_cost: c.token_cost,
        credit_cost: c.credit_cost,
        enabled: c.enabled,
        playback_mode: c.playback_mode,
        cooldown_ms: c.cooldown_ms,
        cooldown_remaining_ms:
          at === undefined ? 0 : Math.max(0, at + c.cooldown_ms - now),
        running: running.has(entry.id),
      };
    });
  }

  async heartbeat(
    h: SoundLabHeartbeat,
  ): Promise<{ ok: true; settings: SoundLabSettings }> {
    await this.db.query(
      `insert into sound_lab_studios (studio_instance_id, player_ready, last_seen) values ($1, $2, $3)
       on conflict (studio_instance_id) do update set player_ready = excluded.player_ready, last_seen = excluded.last_seen`,
      [h.studio_instance_id, h.player_ready, this.clock.now()],
    );
    return { ok: true, settings: await this.settings() };
  }

  /** Throws the precise reason when no fresh Studio with a live player can play a sound now. */
  private async assertReady(q: Queryable, studioId: string | null = null) {
    const since = new Date(
      this.clock.now().getTime() - SOUND_LAB_RULES.heartbeatFreshMs,
    );
    const studio = (
      await q.query<{ player_ready: boolean }>(
        'select player_ready from sound_lab_studios where last_seen >= $1 and ($2::text is null or studio_instance_id = $2) order by last_seen desc limit 1',
        [since, studioId],
      )
    )[0];
    if (!studio) throw new SoundLabUnavailableError('studio_offline');
    if (!studio.player_ready)
      throw new SoundLabUnavailableError('player_offline');
  }

  // --- admission ---------------------------------------------------------------------------------

  async admit(req: SoundLabAdmitRequest): Promise<SoundLabAdmitResponse> {
    try {
      return await this.admitTx(req);
    } catch (e) {
      // Pause globale (D4): refused before anything is stored or paid; the refusal is counted.
      if (!(e instanceof GlobalPauseError)) throw e;
      await countGlobalRefusal(this.db, req.channel_id, this.clock.now());
      throw new SoundLabError409('global_pause', e.message);
    }
  }

  private async admitTx(
    req: SoundLabAdmitRequest,
  ): Promise<SoundLabAdmitResponse> {
    // Hash of what the viewer asked for: a retry with the same key must ask for the same sound.
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          'sound',
          req.sound_id,
          req.payment_method,
          req.lab_session_id,
        ]),
      )
      .digest('hex');
    // Outside the transaction: a refused admission must not roll back the settings seed.
    await this.seed(this.db);
    return this.db.tx(async (q) => {
      // Channel row lock: serializes admissions of the channel (sequence, cooldown, running state).
      await q.query(
        'insert into sound_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
        [req.channel_id],
      );
      await q.query(
        'select last_sequence from sound_lab_channels where channel_id = $1 for update',
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
          throw new SoundLabError409(
            'idempotency_conflict',
            'idempotency key already used for another sound',
          );
        return { interaction: toInteraction(prior), replayed: true };
      }
      const rows = await this.configRows(q);
      const entry = BANK.get(req.sound_id);
      const config = rows.get(req.sound_id);
      if (!entry || !config)
        throw new SoundLabError409('sound_not_found', 'unknown sound');
      if (!config.enabled)
        throw new SoundLabError409('sound_disabled', 'this sound is disabled');

      await this.sweep(q, req.channel_id);
      const now = this.clock.now();
      // Moderation V2 (Core): refused before admission, nothing recorded.
      await assertNotGloballyPaused(q, req.channel_id);
      const state = await moduleState(q, 'soundboard');
      if (state === 'disabled')
        throw new SoundLabError409('module_disabled', 'Soundboard disabled');
      if (state === 'paused')
        throw new SoundLabError409(
          'soundboard_paused',
          'Soundboard paused by moderation',
        );
      if (
        await activeBlock(q, req.channel_id, req.viewer.id, 'soundboard', now)
      )
        throw new SoundLabError409(
          'viewer_blocked',
          'Soundboard unavailable for this viewer',
        );
      const imposed = await personalCooldownMs(
        q,
        req.channel_id,
        req.viewer.id,
        'soundboard',
        now,
      );
      if (imposed > 0)
        throw new SoundLabError409(
          'viewer_cooldown',
          'cooldown imposed by moderation',
          { retry_after_ms: imposed },
        );
      await this.assertReady(q);
      const remaining = await this.cooldownRemaining(
        q,
        req.channel_id,
        req.sound_id,
        config.cooldown_ms,
      );
      if (remaining > 0)
        throw new SoundLabError409('sound_cooldown', 'sound in cooldown', {
          retry_after_ms: remaining,
        });
      const running = new Set(
        (
          await q.query<{ sound_id: string }>(
            `select distinct sound_id from sound_lab_interactions
             where channel_id = $1 and status in ('queued', 'executing')`,
            [req.channel_id],
          )
        ).map((r) => r.sound_id),
      );
      const open = (
        await q.query<{ n: number | string }>(
          "select count(*) as n from sound_lab_interactions where channel_id = $1 and status in ('accepted', 'queued', 'executing')",
          [req.channel_id],
        )
      )[0]!;
      if (Number(open.n) >= SOUND_LAB_RULES.maxOpenPerChannel)
        throw new SoundLabError409('queue_full', 'too many sounds waiting');

      // `random` plays any playable sound (enabled, not in cooldown, not blocked while running).
      let played = entry;
      if (entry.id === 'random') {
        const candidates: SoundBankEntry[] = [];
        for (const candidate of SOUND_BANK) {
          const c = rows.get(candidate.id)!;
          if (candidate.id === 'random' || !c.enabled) continue;
          if (
            c.playback_mode === 'ignore_if_running' &&
            running.has(candidate.id)
          )
            continue;
          if (
            (await this.cooldownRemaining(
              q,
              req.channel_id,
              candidate.id,
              c.cooldown_ms,
            )) > 0
          )
            continue;
          candidates.push(candidate);
        }
        if (!candidates.length)
          throw new SoundLabError409('sound_unavailable', 'no playable sound');
        played = candidates[Math.floor(this.random() * candidates.length)]!;
      }
      const playedConfig = rows.get(played.id)!;
      if (
        playedConfig.playback_mode === 'ignore_if_running' &&
        running.has(played.id)
      )
        throw new SoundLabError409(
          'sound_running',
          'this sound is already playing',
        );
      const file =
        played.files[Math.floor(this.random() * played.files.length)]!;
      const cost =
        req.payment_method === 'credits'
          ? config.credit_cost
          : config.token_cost;

      const seq = (
        await q.query<{ last_sequence: number | string }>(
          'update sound_lab_channels set last_sequence = last_sequence + 1 where channel_id = $1 returning last_sequence',
          [req.channel_id],
        )
      )[0]!.last_sequence;
      const id = randomUUID();
      // accepted and queued are committed in the same transaction: the answer is already `queued`.
      await q.query(
        `insert into sound_lab_interactions (interaction_id, idempotency_key, request_hash, source, channel_id,
           viewer_id, viewer_display_name, type, requested_sound_id, sound_id, sound_label, sound_url, duration_ms,
           playback_mode, volume, created_at, channel_sequence, test_mode, payment_mode, payment_method,
           simulated_cost, simulated_currency, real_debited, status, lab_session_id, expires_at, error, updated_at)
         values ($1, $2, $3, 'extension_lab', $4, $5, $6, 'sound', $7, $8, $9, $10, $11,
           $12, $13, $14, $15, true, 'simulated', $16, $17, $18, 0, 'queued', $19, $20, null, $14)`,
        [
          id,
          req.idempotency_key,
          requestHash,
          req.channel_id,
          req.viewer.id,
          req.viewer.display_name,
          entry.id,
          played.id,
          entry.id === 'random'
            ? `${labelOf(entry, config)} · ${labelOf(played, playedConfig)}`.slice(
                0,
                80,
              )
            : labelOf(entry, config),
          file.file,
          file.duration_ms,
          playedConfig.playback_mode,
          playedConfig.volume,
          now,
          Number(seq),
          req.payment_method,
          cost,
          SOUND_LAB_RULES.simulatedCurrency[req.payment_method],
          req.lab_session_id,
          new Date(now.getTime() + SOUND_LAB_RULES.expiresAfterMs),
        ],
      );
      await seeViewer(
        q,
        req.channel_id,
        req.viewer.id,
        req.viewer.display_name,
        now,
      );
      // Lab test wallet: debited in the same transaction (refused → nothing admitted, nothing stored).
      await debit(q, now, {
        channelId: req.channel_id,
        viewerId: req.viewer.id,
        currency:
          req.payment_method === 'credits' ? 'credits_soundboard' : 'tokens',
        amount: cost,
        module: 'soundboard',
        interactionId: id,
      });
      return { interaction: (await this.byId(q, id))!, replayed: false };
    });
  }

  /** Cooldown of a requested sound: from its last admitted (non-failed) purchase. */
  private async cooldownRemaining(
    q: Queryable,
    channelId: string,
    soundId: string,
    cooldownMs: number,
  ) {
    if (cooldownMs <= 0) return 0;
    const last = (
      await q.query<{ at: Date | null }>(
        `select max(created_at) as at from sound_lab_interactions
         where channel_id = $1 and requested_sound_id = $2 and status <> 'failed'`,
        [channelId, soundId],
      )
    )[0]?.at;
    if (!last) return 0;
    return Math.max(
      0,
      new Date(last).getTime() + cooldownMs - this.clock.now().getTime(),
    );
  }

  async get(interactionId: string): Promise<SoundLabInteraction> {
    const found = await this.byId(this.db, interactionId);
    if (!found) throw new SoundLabNotFoundError(interactionId);
    return found;
  }

  /** Latest interactions of the channel (Lab history for Studio). */
  async recent(channelId: string, limit = 20): Promise<SoundLabInteraction[]> {
    return this.db.tx(async (q) => {
      await q.query(
        'select 1 from sound_lab_channels where channel_id = $1 for update',
        [channelId],
      );
      await this.sweep(q, channelId);
      const rows = await q.query<Row>(
        `${SELECT} where i.channel_id = $1 order by i.channel_sequence desc limit $2`,
        [channelId, limit],
      );
      return rows.map(toInteraction);
    });
  }

  // --- moderation V2 (called inside the moderation transaction, after the permission check) --------

  /** Waiting (not yet handed to the player) and in-flight sounds of the channel. */
  async moderationQueue(channelId: string) {
    return this.db.tx(async (q) => {
      await q.query(
        'insert into sound_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
        [channelId],
      );
      await q.query(
        'select 1 from sound_lab_channels where channel_id = $1 for update',
        [channelId],
      );
      await this.sweep(q, channelId);
      const rows = (
        await q.query<Row>(
          `${SELECT} where i.channel_id = $1 and i.status in ('queued', 'executing') order by i.channel_sequence`,
          [channelId],
        )
      ).map(toInteraction);
      const recent = (
        await q.query<Row>(
          `${SELECT} where i.channel_id = $1 order by i.channel_sequence desc limit 20`,
          [channelId],
        )
      ).map(toInteraction);
      const view = (i: SoundLabInteraction) => ({
        ...i,
        refundable: ENDED.includes(i.status) && i.refund_status === 'none',
      });
      return {
        module_state: await moduleState(q, 'soundboard'),
        playing: rows.filter((r) => r.delivery.attempt_id !== null).map(view),
        waiting: rows.filter((r) => r.delivery.attempt_id === null).map(view),
        recent: recent.map(view),
      };
    });
  }

  async viewerInteractions(channelId: string, viewerId: string, limit = 10) {
    return (
      await this.db.query<Row>(
        `${SELECT} where i.channel_id = $1 and i.viewer_id = $2 order by i.channel_sequence desc limit $3`,
        [channelId, viewerId, limit],
      )
    ).map(toInteraction);
  }

  /**
   * At most once (conditional update + unique ledger entry): the sound becomes « refunded » and the
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
      `update sound_lab_interactions set refund_status = 'refunded', refunded_at = $2, updated_at = $2
       where interaction_id = $1 and refund_status = 'none' returning channel_id, viewer_id`,
      [interactionId, now],
    );
    if (!done.length) return false;
    const back = await refundDebit(
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
      module: 'soundboard',
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
   * Soundboard commands (D4). Waiting = not yet handed to the player; playing = handed out or being
   * played: stopping one marks it cancelled in Core, the Studio worker then tells the player to stop
   * it and reports a `stopped` ACK. Refunds give back the Lab test wallet debit, at most once.
   */
  async applyModeration(
    q: Queryable,
    channelId: string,
    cmd: LabModerationCommand,
    actor: Actor,
    role: LabRole,
  ) {
    await q.query(
      'insert into sound_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
      [channelId],
    );
    await q.query(
      'select 1 from sound_lab_channels where channel_id = $1 for update',
      [channelId],
    );
    await this.sweep(q, channelId);
    const now = this.clock.now();
    const reason = 'reason' in cmd ? (cmd.reason ?? null) : null;
    const open = await q.query<{
      interaction_id: string;
      viewer_id: string;
      status: SoundLabStatus;
      delivered: boolean;
    }>(
      `select interaction_id, viewer_id, status,
         exists (select 1 from sound_lab_deliveries d where d.interaction_id = i.interaction_id) as delivered
       from sound_lab_interactions i where channel_id = $1 and status in ('queued', 'executing') order by channel_sequence`,
      [channelId],
    );
    const waiting = open.filter((r) => !r.delivered);
    const playing = open.filter((r) => r.delivered);
    const cancel = async (
      rows: typeof open,
      refund: boolean,
      stop: boolean,
    ) => {
      const out: { interaction_id: string; refunded: boolean }[] = [];
      const code = stop ? 'stopped_by_moderator' : 'cancelled_by_moderator';
      for (const r of rows) {
        const done = await q.query(
          `update sound_lab_interactions set status = 'cancelled', updated_at = $2, error = $3
           where interaction_id = $1 and status in ('queued', 'executing') returning 1`,
          [
            r.interaction_id,
            now,
            JSON.stringify(
              err(
                code,
                stop ? 'stopped by moderation' : 'cancelled by moderation',
              ),
            ),
          ],
        );
        if (!done.length) continue;
        const refunded = refund
          ? await this.refund(q, r.interaction_id, actor, code, role)
          : false;
        out.push({ interaction_id: r.interaction_id, refunded });
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'soundboard',
          action: stop ? 'stop' : 'cancel',
          viewerId: r.viewer_id,
          interactionId: r.interaction_id,
          reason,
          before: { status: r.status },
          after: { status: 'cancelled', refund },
        });
      }
      return out;
    };
    switch (cmd.action) {
      case 'module_state': {
        const before = await moduleState(q, 'soundboard');
        await setModuleState(q, 'soundboard', cmd.state, now, actor.id);
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'soundboard',
          action: `module_${cmd.state}`,
          reason,
          before: { state: before },
          after: { state: cmd.state, waiting: cmd.waiting ?? 'keep' },
        });
        const cancelled =
          (cmd.waiting ?? 'keep') === 'keep'
            ? []
            : await cancel(waiting, cmd.waiting === 'cancel_refund', false);
        return { ok: true, module_state: cmd.state, cancelled };
      }
      case 'cancel': {
        const row = open.find((w) => w.interaction_id === cmd.interaction_id);
        if (!row)
          throw new SoundLabError409(
            'not_open',
            'this sound is no longer waiting or playing',
          );
        return {
          ok: true,
          cancelled: await cancel([row], cmd.refund, row.delivered),
        };
      }
      case 'stop_all': {
        if (!playing.length)
          throw new SoundLabError409('nothing_playing', 'no sound is playing');
        const cancelled = await cancel(playing, cmd.refund, true);
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'soundboard',
          action: 'stop_all',
          reason,
          before: { playing: playing.length },
          after: { playing: 0, refund: cmd.refund, count: cancelled.length },
        });
        return { ok: true, cancelled };
      }
      case 'purge': {
        const cancelled = await cancel(waiting, cmd.refund, false);
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'soundboard',
          action: 'purge',
          reason,
          before: { waiting: waiting.length },
          after: { waiting: 0, refund: cmd.refund, count: cancelled.length },
        });
        return { ok: true, cancelled };
      }
      case 'refund': {
        const row = await this.byId(q, cmd.interaction_id);
        if (!row || row.channel_id !== channelId)
          throw new SoundLabNotFoundError(cmd.interaction_id);
        if (!ENDED.includes(row.status))
          throw new SoundLabError409('not_terminal', 'stop or remove it first');
        if (
          !(await this.refund(
            q,
            row.interaction_id,
            actor,
            reason ?? 'moderator_refund',
            role,
          ))
        )
          throw new SoundLabError409('already_refunded', 'already refunded');
        return { ok: true, refunded: true };
      }
      default:
        throw new SoundLabError409(
          'unsupported',
          `${cmd.action} is not a Soundboard command`,
        );
    }
  }

  // --- execution (Studio worker) --------------------------------------------------------------------

  /**
   * Next sound to play, in channel_sequence order, according to its playback mode: `stack` sounds
   * are handed out at once (overlap allowed); a `queue` / `ignore_if_running` sound waits while
   * another instance of the same sound is in flight. At most `maxConcurrent` sounds in flight.
   */
  async claim(
    studioInstanceId: string,
    channelId: string,
  ): Promise<SoundLabInteraction | null> {
    return this.db.tx(async (q) => {
      await q.query(
        'insert into sound_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
        [channelId],
      );
      await q.query(
        'select 1 from sound_lab_channels where channel_id = $1 for update',
        [channelId],
      );
      await this.sweep(q, channelId);
      await this.assertReady(q, studioInstanceId);
      // Paused: the waiting sounds stay queued, nothing new is handed to the player.
      if ((await moduleState(q, 'soundboard')) !== 'active') return null;
      const inFlight = await q.query<{ sound_id: string }>(
        `select i.sound_id from sound_lab_interactions i join sound_lab_deliveries d using (interaction_id)
         where i.channel_id = $1 and i.status in ('queued', 'executing')`,
        [channelId],
      );
      if (inFlight.length >= SOUND_LAB_RULES.maxConcurrent) return null;
      const busy = new Set(inFlight.map((r) => r.sound_id));
      const waiting = await q.query<{
        interaction_id: string;
        sound_id: string;
        playback_mode: SoundLabPlaybackMode;
      }>(
        `select interaction_id, sound_id, playback_mode from sound_lab_interactions i
         where channel_id = $1 and status = 'queued'
           and not exists (select 1 from sound_lab_deliveries d where d.interaction_id = i.interaction_id)
         order by channel_sequence limit 100`,
        [channelId],
      );
      const next = waiting.find(
        (w) => w.playback_mode === 'stack' || !busy.has(w.sound_id),
      );
      if (!next) return null;
      const now = this.clock.now();
      await q.query(
        `insert into sound_lab_deliveries (interaction_id, studio_instance_id, attempt_id, lease_expires_at)
         values ($1, $2, $3, $4)`,
        [
          next.interaction_id,
          studioInstanceId,
          randomUUID(),
          new Date(now.getTime() + SOUND_LAB_RULES.claimLeaseMs),
        ],
      );
      return (await this.byId(q, next.interaction_id))!;
    });
  }

  /** Player/Studio outcome for the current attempt. Idempotent; never regresses a final state. */
  async ack(
    interactionId: string,
    a: SoundLabAckRequest,
  ): Promise<SoundLabInteraction> {
    return this.db.tx(async (q) => {
      const channel = (
        await q.query<{ channel_id: string }>(
          'select channel_id from sound_lab_interactions where interaction_id = $1',
          [interactionId],
        )
      )[0];
      if (!channel) throw new SoundLabNotFoundError(interactionId);
      await q.query(
        'select 1 from sound_lab_channels where channel_id = $1 for update',
        [channel.channel_id],
      );
      // Lock first, then read in a new statement (see the Bonk Lab: READ COMMITTED visibility).
      await q.query(
        'select 1 from sound_lab_interactions where interaction_id = $1 for update',
        [interactionId],
      );
      const cur = (
        await q.query<Row>(`${SELECT} where i.interaction_id = $1`, [
          interactionId,
        ])
      )[0]!;
      if (
        cur.attempt_id !== a.attempt_id ||
        cur.studio_instance_id !== a.studio_instance_id
      )
        throw new SoundLabError409(
          'attempt_mismatch',
          'this attempt does not own the interaction',
        );
      const now = this.clock.now();
      // Stopped / removed by moderation meanwhile: the player's proof of the stop is recorded, its
      // other late ACKs are accepted and ignored (Core already holds the final state).
      if (cur.status === 'cancelled') {
        if (a.event === 'stopped')
          await q.query(
            'update sound_lab_deliveries set stopped_at = coalesce(stopped_at, $2) where interaction_id = $1',
            [interactionId, now],
          );
        return (await this.byId(q, interactionId))!;
      }
      if (a.event === 'stopped')
        throw new SoundLabError409(
          'invalid_transition',
          'only a sound stopped by moderation can be reported stopped',
        );
      const set = (status: SoundLabStatus, error: SoundLabError | null) =>
        q.query(
          'update sound_lab_interactions set status = $2, error = $3, updated_at = $4 where interaction_id = $1',
          [interactionId, status, error ? JSON.stringify(error) : null, now],
        );
      const invalid = (what: string) =>
        new SoundLabError409(
          'invalid_transition',
          `cannot ${what} from ${cur.status}`,
        );
      switch (a.event) {
        case 'started':
          if (cur.started_at !== null) break; // replay of a known ACK
          if (cur.status !== 'queued') throw invalid('start');
          await q.query(
            'update sound_lab_deliveries set started_at = $2, lease_expires_at = $3 where interaction_id = $1',
            [
              interactionId,
              now,
              new Date(
                now.getTime() +
                  cur.duration_ms +
                  SOUND_LAB_RULES.executingMarginMs,
              ),
            ],
          );
          await set('executing', null);
          break;
        case 'completed':
          if (cur.status === 'completed') break;
          if (cur.status !== 'executing') throw invalid('complete');
          await q.query(
            'update sound_lab_deliveries set completed_at = $2 where interaction_id = $1',
            [interactionId, now],
          );
          await set('completed', null);
          break;
        case 'failed':
          if (cur.status === 'failed') break;
          if (cur.status !== 'queued' && cur.status !== 'executing')
            throw invalid('fail');
          await set(
            'failed',
            err(
              a.error?.code ?? 'playback_failed',
              a.error?.message ?? 'the player reported a failure',
            ),
          );
          // Never started (file missing, player error before audio): it can never be heard → refund.
          if (cur.started_at === null)
            await this.refund(q, interactionId, SYSTEM, 'failed_before_start');
          break;
        case 'execution_unknown':
          if (cur.status === 'execution_unknown') break;
          if (cur.status !== 'queued' && cur.status !== 'executing')
            throw invalid('mark unknown');
          await set(
            'execution_unknown',
            err(
              a.error?.code ?? 'execution_unknown',
              a.error?.message ?? 'sent to the player, outcome not provable',
            ),
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
   * - claimed or playing, lease over, no final ACK → execution_unknown (it may have played).
   */
  private async sweep(q: Queryable, channelId: string): Promise<void> {
    const now = this.clock.now();
    const expired = await q.query<{ interaction_id: string }>(
      `update sound_lab_interactions i set status = 'failed', updated_at = $2,
         error = '{"code":"expired","message":"not started before expiry","retryable":false}'::jsonb
       where channel_id = $1 and status = 'queued' and expires_at < $2
         and not exists (select 1 from sound_lab_deliveries d where d.interaction_id = i.interaction_id)
       returning interaction_id`,
      [channelId, now],
    );
    // Never played: the Lab test wallet gets its debit back.
    for (const e of expired)
      await this.refund(q, e.interaction_id, SYSTEM, 'expired');
    await q.query(
      `update sound_lab_interactions i set status = 'execution_unknown', updated_at = $2,
         error = '{"code":"lease_expired","message":"no player proof before the lease ended","retryable":false}'::jsonb
       from sound_lab_deliveries d
       where d.interaction_id = i.interaction_id and i.channel_id = $1
         and i.status in ('queued', 'executing') and d.lease_expires_at < $2`,
      [channelId, now],
    );
  }

  private async byId(q: Queryable, id: string) {
    const row = (
      await q.query<Row>(`${SELECT} where i.interaction_id = $1`, [id])
    )[0];
    return row ? toInteraction(row) : null;
  }

  static isTerminal(status: SoundLabStatus) {
    return TERMINAL.includes(status);
  }
}
