import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { CpAction } from '@raptoru/schemas';
import type { LabCoreCall } from '../lab-moderation/proxy.js';
import { ObsActionError, ObsActions, type ObsLike } from './obs-actions.js';

// Points de chaîne V1 in Studio (docs/CHANNEL_POINTS_V1.md). Core decides (master switch, rules, dedup, history);
// Studio is the control panel and the only one that touches OBS: it claims the OBS part of each redemption, runs it
// through the typed executor (obs-actions.ts) and reports per-action results. The loop runs with Studio, in both
// profiles (Lab Core or paired production Core: same sub-paths, only the base changes); nothing runs unless Core
// queued a job (switch ON, or an explicit « Tester »). Sounds are Core's (Soundboard queue).

const MAX_BODY = 16 * 1024;
const POLL_MS = 1000;

export interface ChannelPointsRuntimeDeps {
  core: LabCoreCall;
  environment: 'lab' | 'production';
  channelId: string;
  origin: string;
  /** Studio storage for this module (pending OBS reverts). */
  dir: string;
  /** Studio's OBS connection (the Bonk's), or null when absent. */
  obs: () => ObsLike | null;
  /** Twitch reception as Studio sees it (token summary, adapter). */
  twitch: () => {
    scope: boolean;
    adapter_running: boolean;
    profile_note?: string;
  };
  pollMs?: number;
}

export class ChannelPointsRuntime {
  private readonly consumer = `studio-${randomUUID().slice(0, 8)}`;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lastError: string | null = null;

  private constructor(
    private readonly d: ChannelPointsRuntimeDeps,
    readonly obs: ObsActions,
  ) {}

  static async create(d: ChannelPointsRuntimeDeps) {
    return new ChannelPointsRuntime(
      d,
      await ObsActions.open(join(d.dir, 'obs-reverts.json'), d.obs),
    );
  }

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/channel-points'
      : '/v1/lab/channel-points';
  }

  /** Starts with Studio: the job loop and the pending reverts (nothing happens without a job). */
  start() {
    this.obs.start();
    const loop = async () => {
      if (this.stopped) return;
      let worked = false;
      try {
        worked = await this.once();
        this.lastError = null;
      } catch (e) {
        this.lastError = (e as Error).message;
      }
      this.timer = setTimeout(
        () => void loop(),
        worked ? 0 : (this.d.pollMs ?? POLL_MS),
      );
      this.timer.unref?.();
    };
    void loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.obs.stop();
  }

  /** One job if Core has one: started, actions in order, per-action results, completed. Returns true if one ran. */
  async once(): Promise<boolean> {
    const { job } = await this.d.core<{
      job: {
        job_id: string;
        attempt_id: string;
        actions: { index: number; action: CpAction }[];
      } | null;
    }>(`${this.base}/${this.d.channelId}/claim`, {
      consumer_id: this.consumer,
    });
    if (!job) return false;
    const ack = (event: string, extra: object = {}) =>
      this.d.core(`${this.base}/jobs/${job.job_id}/ack`, {
        consumer_id: this.consumer,
        attempt_id: job.attempt_id,
        event,
        ...extra,
      });
    await ack('started');
    const results: { index: number; ok: boolean; error?: string }[] = [];
    for (const { index, action } of job.actions) {
      try {
        await this.obs.run(action);
        results.push({ index, ok: true });
      } catch (e) {
        results.push({
          index,
          ok: false,
          error: (e instanceof ObsActionError
            ? e.message
            : 'erreur inattendue'
          ).slice(0, 200),
        });
      }
    }
    await ack('completed', { results });
    return true;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/channel-points')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    const origin = new URL(this.d.origin);
    if (
      req.headers.host !== origin.host ||
      (req.headers.origin && req.headers.origin !== this.d.origin) ||
      req.headers['x-raptoru-studio'] !== '1'
    ) {
      reply(403, { error: 'forbidden' });
      return true;
    }
    try {
      await this.api(req, url, reply);
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      if (!res.headersSent)
        reply(err.status ?? 503, {
          ...(err.body ?? {}),
          error:
            err.body?.error ??
            (e instanceof ObsActionError ? e.message : err.message),
        });
    }
    return true;
  }

  private async body(req: IncomingMessage) {
    let raw = '';
    for await (const chunk of req) {
      raw += String(chunk);
      if (raw.length > MAX_BODY)
        throw Object.assign(new Error('body_too_large'), { status: 413 });
    }
    try {
      return JSON.parse(raw || '{}') as Record<string, unknown>;
    } catch {
      throw Object.assign(new Error('invalid_json'), { status: 400 });
    }
  }

  private async api(
    req: IncomingMessage,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const p = url.pathname.slice('/api/channel-points'.length);
    const ch = `${this.base}/${this.d.channelId}`;
    if (req.method === 'GET' && p === '/state') {
      const obs = this.d.obs();
      return reply(200, {
        ...(await this.d.core<Record<string, unknown>>(`${ch}/state`)),
        environment: this.d.environment,
        obs: {
          connected: Boolean(obs?.connected),
          pending_reverts: this.obs.pending,
        },
        twitch: this.d.twitch(),
        executor_error: this.lastError,
      });
    }
    if (req.method === 'GET' && p === '/obs') {
      const scene = url.searchParams.get('scene') ?? undefined;
      const source = url.searchParams.get('source') ?? undefined;
      return reply(200, await this.obs.lists(scene, source));
    }
    if (req.method !== 'POST') return reply(404, { error: 'not_found' });
    if (p === '/settings')
      return reply(
        200,
        await this.d.core(`${ch}/settings`, await this.body(req)),
      );
    if (p === '/test')
      return reply(200, await this.d.core(`${ch}/test`, await this.body(req)));
    const rule = /^\/rules\/([A-Za-z0-9-]{1,128})$/.exec(p);
    if (rule)
      return reply(
        200,
        await this.d.core(`${ch}/rules/${rule[1]}`, await this.body(req)),
      );
    reply(404, { error: 'not_found' });
  }
}
