import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, normalize } from 'node:path';
import type { VotekickOverlayEvent } from '@raptoru/schemas';
import type { MuteController } from './mute-controller.js';

// Votekick V2 in Studio (docs/VOTEKICK_V2.md § 9): Core holds the vote; Studio follows it every 400 ms
// (/v1/{lab|studio}/votekick/{channel}/studio) for two things:
// - the broadcaster's mute in OBS (MuteController: snapshot, mic « Micro » cut first and restored last, restored on
//   any failure) — started once per mute id and reported (started / failed), ended when Core ends it (time or a paid
//   caution) and reported; a mute Core forgets is ended by the controller's watchdog;
// - the overlay's event, served to the OBS browser source (/votekick/overlay.html?studio — the legacy SAMMI design,
//   votekick-overlay/legacy/votekick-overlay.html) at /votekick/event.
// Studio never decides a verdict, a timeout or a payment.

type CoreCall = <T>(path: string, body?: unknown) => Promise<T>;

interface StudioTask {
  overlay: VotekickOverlayEvent;
  mute: {
    mute_id: string;
    status: 'pending' | 'active' | 'ended' | 'failed';
    seconds: number;
    ends_at: string | null;
    end_reason: 'expired' | 'caution' | null;
  } | null;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export class VotekickRuntime {
  private event: VotekickOverlayEvent = { action: 'clear' };
  private readonly handled = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  error: string | null = null;
  lastSeenAt: number | null = null;

  constructor(
    private readonly d: {
      core: CoreCall;
      /** /v1/lab/votekick (Lab profile) or /v1/studio/votekick (Production). */
      base: string;
      channelId: string;
      mute: MuteController;
      overlayDir: string;
      log?: (line: string) => void;
    },
  ) {}

  start() {
    this.d.mute.start();
    const loop = async () => {
      if (this.stopped) return;
      await this.tick();
      this.timer = setTimeout(() => void loop(), 400);
    };
    void loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.d.mute.stop();
  }

  private report(
    muteId: string,
    event: 'started' | 'failed' | 'ended',
    error?: string,
  ) {
    return this.d.core(
      `${this.d.base}/${this.d.channelId}/mutes/${muteId}/report`,
      { event, ...(error ? { error: error.slice(0, 300) } : {}) },
    );
  }

  /** One follow-up of Core (exported for tests). */
  async tick() {
    let task: StudioTask;
    try {
      task = await this.d.core<StudioTask>(
        `${this.d.base}/${this.d.channelId}/studio`,
      );
      this.error = null;
      this.lastSeenAt = Date.now();
    } catch (e) {
      this.error = (e as Error).message;
      return;
    }
    this.event = task.overlay;
    const m = task.mute;
    if (!m) return;
    const key = `${m.mute_id}:${m.status}`;
    if (this.handled.has(key)) return;
    if (m.status === 'pending') {
      try {
        await this.d.mute.muteStart(m.mute_id, m.seconds);
      } catch (e) {
        // Never muted (the controller restored anything it had changed): Core announces it.
        this.handled.add(key);
        await this.report(m.mute_id, 'failed', (e as Error).message).catch(
          () => {},
        );
        this.d.log?.(`[votekick] mute impossible: ${(e as Error).message}`);
        return;
      }
      // Muted: reported until Core has it (a lost report is sent again; muteStart is idempotent per id).
      await this.report(m.mute_id, 'started').then(
        () => {
          this.handled.add(key);
          this.d.log?.(
            `[votekick] streamer muted ${m.seconds} s (${m.mute_id})`,
          );
        },
        () => {},
      );
    } else if (m.status === 'failed' && this.d.mute.current?.id === m.mute_id) {
      // Core gave up on it (late start report): OBS restored now, never left muted.
      this.handled.add(key);
      await this.d.mute.muteEnd(m.mute_id, 'expired');
    } else if (m.status === 'ended') {
      this.handled.add(key);
      if (this.d.mute.current?.id === m.mute_id) {
        const r = await this.d.mute.muteEnd(
          m.mute_id,
          m.end_reason ?? 'expired',
        );
        this.d.log?.(
          `[votekick] streamer unmuted (${m.end_reason ?? 'expired'})${r && !r.ok ? ` — not restored: ${r.mismatches.join(', ')}` : ''}`,
        );
        await this.report(m.mute_id, 'ended').catch(() => {});
      }
    }
    if (this.handled.size > 200) this.handled.clear();
  }

  /** GET /votekick/event (the overlay), /votekick/** (overlay files), /api/votekick/state (Studio page). */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (
      !url.pathname.startsWith('/votekick/') &&
      url.pathname !== '/api/votekick/state'
    )
      return false;
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
      });
      res.end(body);
    };
    if (req.method !== 'GET') {
      send(405, 'application/json', '{"error":"method_not_allowed"}');
      return true;
    }
    if (url.pathname === '/votekick/event') {
      send(200, 'application/json', JSON.stringify(this.event));
      return true;
    }
    if (url.pathname === '/api/votekick/state') {
      if (req.headers['x-raptoru-studio'] !== '1') {
        send(403, 'application/json', '{"error":"forbidden"}');
        return true;
      }
      let core: unknown;
      try {
        core = await this.d.core(`${this.d.base}/${this.d.channelId}/state`);
      } catch (e) {
        core = { error: (e as Error).message };
      }
      send(
        200,
        'application/json',
        JSON.stringify({
          core,
          overlay: this.event,
          obs_mute: this.d.mute.current,
          last_restore: this.d.mute.reports[0] ?? null,
          error: this.error,
        }),
      );
      return true;
    }
    // The overlay page only, never anything else of the folder. Decided 23/10 (live): the page served is the legacy
    // SAMMI design (legacy/votekick-overlay.html, fed by /votekick/event with ?studio); the exploration variants are
    // never served. /votekick/variants/variants.html stays an alias: the OBS source « Votekick (V2) » of 23/10 uses it.
    const rel = normalize(url.pathname.slice('/votekick/'.length));
    if (!/^(overlay\.html|variants[\\/]variants\.html)$/.test(rel)) {
      send(404, 'application/json', '{"error":"not_found"}');
      return true;
    }
    try {
      send(
        200,
        TYPES['.html']!,
        await readFile(join(this.d.overlayDir, 'legacy', 'votekick-overlay.html')),
      );
    } catch {
      send(404, 'application/json', '{"error":"not_found"}');
    }
    return true;
  }
}
