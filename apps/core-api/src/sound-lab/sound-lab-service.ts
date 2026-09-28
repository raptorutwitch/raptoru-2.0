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
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { SOUND_BANK, type SoundBankEntry } from './bank.js';

// Soundboard V2, Lab slice. Same contract as the Bonk Lab: Core owns the catalog, validation, the
// authoritative interaction, its durable order (channel_sequence) and its status; Studio only
// plays and acknowledges. Test only: the payment is a simulated snapshot (real_debited = 0). This
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
    label: entry.label.slice(0, 40),
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
  label: string;
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
  status: SoundLabStatus;
  lab_session_id: string;
  expires_at: Date;
  error: SoundLabError | null;
  studio_instance_id: string | null;
  attempt_id: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
}

const SELECT = `select i.*, d.studio_instance_id, d.attempt_id, d.lease_expires_at, d.started_at, d.completed_at
  from sound_lab_interactions i left join sound_lab_deliveries d using (interaction_id)`;
const TERMINAL: SoundLabStatus[] = ['completed', 'failed', 'execution_unknown'];
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const BANK = new Map(SOUND_BANK.map((s) => [s.id, s]));

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
        `insert into sound_lab_sounds (sound_id, label, enabled, token_cost, credit_cost, cooldown_ms, playback_mode, volume, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (sound_id) do nothing`,
        [
          entry.id,
          d.label,
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
      label: c.label,
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
    const fields = Object.entries(update);
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
        label: c.label,
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
      await this.assertReady(q);
      const now = this.clock.now();
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
            ? `${config.label} · ${playedConfig.label}`.slice(0, 80)
            : config.label,
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
    await q.query(
      `update sound_lab_interactions i set status = 'failed', updated_at = $2,
         error = '{"code":"expired","message":"not started before expiry","retryable":false}'::jsonb
       where channel_id = $1 and status = 'queued' and expires_at < $2
         and not exists (select 1 from sound_lab_deliveries d where d.interaction_id = i.interaction_id)`,
      [channelId, now],
    );
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
