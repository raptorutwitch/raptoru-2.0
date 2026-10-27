import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Dock OBS V1 (docs/OBS_DOCK.md) — Studio's ONE follower of the Core activity feed, shared by every open dock: the
// recent activities (snapshot + cursor, one read), then the changes after the cursor (long-poll, commit order), kept in
// a bounded cache. A dock never reaches the Core: it gets the cache, then the same changes (dock/server.ts).
// Core unreachable: backoff 1 → 10 s, the cache stays (marked stale by the status). Cursor ahead of the Core (another
// database, rebuild): a fresh snapshot. It follows only while a dock is open (and 60 s after the last one closed).

export interface DockActivity {
  activity_key: string;
  kind: 'alert' | 'channel_points';
  type: string;
  occurred_at: string;
  data: Record<string, unknown>;
  state: Record<string, unknown>;
  seq: number;
}

export type DockHubStatus = {
  /** connecting: no snapshot yet · live: following · stale: the Core is unreachable (cache shown as is). */
  state: 'idle' | 'connecting' | 'live' | 'stale';
  since: string | null;
  error: string | null;
};

export type DockHubEvent =
  | { type: 'snapshot'; activities: DockActivity[]; more: boolean }
  | { type: 'upsert'; activities: DockActivity[] }
  | { type: 'status'; status: DockHubStatus };

export const DOCK_HUB = {
  /** Activities kept in memory (newest by time). */
  cacheMax: 500,
  snapshotLimit: 150,
  changesLimit: 100,
  waitMs: 15_000,
  /** The long-poll's own timeout: the wait plus the Core's answer. */
  requestTimeoutMs: 25_000,
  backoffMs: [1_000, 2_000, 5_000, 10_000] as readonly number[],
  idleStopMs: 60_000,
};

export class DockHub {
  private readonly cache = new Map<string, DockActivity>();
  private cursor = 0;
  private loaded = false;
  private more = false;
  private running = false;
  private stopAt: number | null = null;
  private failures = 0;
  private readonly listeners = new Set<(e: DockHubEvent) => void>();
  status: DockHubStatus = { state: 'idle', since: null, error: null };

  constructor(
    private readonly d: {
      core: LabCoreCall;
      environment: 'lab' | 'production';
      channelId: string;
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
    },
  ) {}

  private get base() {
    return `${this.d.environment === 'production' ? '/v1/studio/dock' : '/v1/lab/dock'}/${this.d.channelId}`;
  }

  private nowMs() {
    return (this.d.now ?? Date.now)();
  }

  /** The activities as they are now, newest first. */
  snapshot(): { activities: DockActivity[]; more: boolean } {
    return {
      activities: [...this.cache.values()].sort(
        (a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.seq - a.seq,
      ),
      more: this.more,
    };
  }

  /** A dock opens: it gets the current state, then every event; the follower runs while one is open. */
  subscribe(fn: (e: DockHubEvent) => void): () => void {
    this.listeners.add(fn);
    this.stopAt = null;
    if (this.loaded) fn({ type: 'snapshot', ...this.snapshot() });
    fn({ type: 'status', status: this.status });
    if (!this.running) void this.run();
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size)
        this.stopAt = this.nowMs() + DOCK_HUB.idleStopMs;
    };
  }

  get clients() {
    return this.listeners.size;
  }

  private emit(e: DockHubEvent) {
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch {
        /* a broken dock never stops the others */
      }
    }
  }

  private setStatus(
    state: DockHubStatus['state'],
    error: string | null = null,
  ) {
    if (this.status.state === state && this.status.error === error) return;
    this.status = { state, since: new Date(this.nowMs()).toISOString(), error };
    this.emit({ type: 'status', status: this.status });
  }

  /** Keeps the newest cacheMax by time (a change of an older row still replaces it while it is kept). */
  private put(rows: DockActivity[]) {
    const changed: DockActivity[] = [];
    for (const r of rows) {
      const cur = this.cache.get(r.activity_key);
      if (cur && cur.seq >= r.seq) continue; // an older copy (overlap of snapshot and changes)
      this.cache.set(r.activity_key, r);
      changed.push(r);
    }
    if (this.cache.size > DOCK_HUB.cacheMax) {
      const keep = this.snapshot().activities.slice(0, DOCK_HUB.cacheMax);
      const kept = new Set(keep.map((a) => a.activity_key));
      for (const k of [...this.cache.keys()])
        if (!kept.has(k)) this.cache.delete(k);
      this.more = true;
    }
    return changed.filter((r) => this.cache.has(r.activity_key));
  }

  private async load() {
    const r = await this.d.core<{
      cursor: number;
      activities: DockActivity[];
      more: boolean;
    }>(`${this.base}/activity?limit=${DOCK_HUB.snapshotLimit}`);
    this.cache.clear();
    this.put(r.activities);
    this.cursor = r.cursor;
    this.more = r.more;
    this.loaded = true;
    this.emit({ type: 'snapshot', ...this.snapshot() });
  }

  /** One step: the snapshot when needed, else the next changes. Throws when the Core cannot be reached. */
  async step() {
    if (!this.loaded) {
      await this.load();
      return;
    }
    const r = await this.d.core<{
      cursor: number;
      activities: DockActivity[];
      reset?: boolean;
    }>(
      `${this.base}/changes?after=${this.cursor}&limit=${DOCK_HUB.changesLimit}&wait_ms=${DOCK_HUB.waitMs}`,
      undefined,
      { timeoutMs: DOCK_HUB.requestTimeoutMs },
    );
    if (r.reset) {
      this.loaded = false;
      return;
    }
    const changed = this.put(r.activities);
    this.cursor = Math.max(this.cursor, r.cursor);
    if (changed.length) this.emit({ type: 'upsert', activities: changed });
  }

  private async run() {
    this.running = true;
    const sleep =
      this.d.sleep ??
      ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    if (!this.loaded) this.setStatus('connecting');
    try {
      while (this.stopAt === null || this.nowMs() < this.stopAt) {
        try {
          await this.step();
          this.failures = 0;
          if (this.loaded) this.setStatus('live');
        } catch (e) {
          this.failures += 1;
          this.setStatus(
            this.loaded ? 'stale' : 'connecting',
            (e as Error).message.slice(0, 120),
          );
          const b = DOCK_HUB.backoffMs;
          await sleep(b[Math.min(this.failures - 1, b.length - 1)]!);
        }
      }
    } finally {
      this.running = false;
      this.setStatus('idle');
    }
  }

  /** An older page of history, straight from the Core (never cached). */
  history(before: { at: string; seq: number }, limit = 50) {
    return this.d.core<{
      cursor: number;
      activities: DockActivity[];
      more: boolean;
    }>(
      `${this.base}/activity?limit=${limit}&before=${encodeURIComponent(before.at)}&before_seq=${before.seq}`,
    );
  }

  /** A visual replay of an alert (Core decides; never the event again). */
  replay(alertId: string, replayKey: string) {
    return this.d.core<{
      replay_alert_id: string;
      created: boolean;
      already_pending?: boolean;
    }>(`${this.base}/alerts/${alertId}/replay`, { replay_key: replayKey });
  }
}
