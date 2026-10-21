import {
  BOT_LEASE_RENEW_SECONDS,
  BotLeaseResponse,
  type BotLeaseRequest,
} from '@raptoru/schemas';
import type { BotConfig } from './config.js';

// Single active production bot (plan post-live lot 1/2). Before anything touches Twitch (token refresh included), the
// bot waits for the Core's lease (standby); then it renews it every renewSeconds with its health.
// It stops (the caller exits; the supervisor restarts it in standby) as soon as it can no longer prove it holds it:
// - another instance named holder (lost);
// - no successful renewal for (ttl − FENCE_MARGIN) counted from the SENDING of the last granted request (expired): the
//   Core's lease ran at least ttl from that moment, so this instance is stopped before anyone else can be granted it,
//   whatever the network did (Core unreachable, 5xx, timeouts, a Core without the route).
// A Core without the lease route (404) is refused — the bot waits — unless `optional` (development only, config.ts).

export type LeaseCall = (
  path: string,
  body: unknown,
) => Promise<{ status: number; body: unknown }>;

/** Self-stop this long before the Core's lease can expire (covers a slow answer and timer delays). */
export const FENCE_MARGIN_MS = 10_000;

export type LeaseStop =
  | { kind: 'lost'; holder: BotLeaseResponse['holder'] }
  | { kind: 'expired'; lastGrantMs: number };

export interface InstanceLeaseOptions {
  call: LeaseCall;
  /** Fixed for the process: the release never depends on the health report. */
  instanceId: string;
  report: () => Omit<BotLeaseRequest, 'instanceId'>;
  /** Development only: a Core without the lease API (404) lets the bot start, unprotected. */
  optional?: boolean;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Monotonic milliseconds (default performance.now: immune to wall-clock jumps). */
  now?: () => number;
  /**
   * The Core answered (granted, standby or no lease route): the container health check. Never « holds the lease »:
   * during a rolling deploy the new container waits in standby until the old one releases, and must look healthy.
   */
  alive?: () => void;
}

export interface InstanceLease {
  /** Resolves once this instance holds the lease (or, optional only, the Core does not know leases). */
  acquire(): Promise<{ supported: boolean }>;
  /** Renews until stop(); `onStop` once when this instance can no longer prove it holds the lease. */
  keep(onStop: (reason: LeaseStop) => void): void;
  /** Frees the lease (clean stop); never throws, gives up after 3 s. */
  release(): Promise<void>;
  stop(): void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export function createInstanceLease(o: InstanceLeaseOptions): InstanceLease {
  const log = o.log ?? ((m: string) => console.log(m));
  const sleep = o.sleep ?? defaultSleep;
  const now = o.now ?? (() => performance.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  let fence: ReturnType<typeof setTimeout> | undefined;
  let renewMs = BOT_LEASE_RENEW_SECONDS * 1000;
  /** The last granted request: when it was SENT and the lease duration the Core gave. */
  let grant: { sentAt: number; ttlMs: number } | null = null;

  type Outcome =
    | { kind: 'granted' }
    | { kind: 'refused'; holder: BotLeaseResponse['holder'] }
    | { kind: 'unsupported' }
    | { kind: 'error'; message: string };

  const ask = async (): Promise<Outcome> => {
    const sentAt = now();
    try {
      const r = await o.call('/v1/bot/instance/lease', {
        instanceId: o.instanceId,
        ...o.report(),
      });
      if (r.status === 404) {
        o.alive?.();
        return o.optional
          ? { kind: 'unsupported' }
          : {
              kind: 'error',
              message:
                'Core sans API de bail (404) : déployer le Core à jour avant ce bot',
            };
      }
      if (r.status < 200 || r.status >= 300)
        return { kind: 'error', message: `Core ${r.status}` };
      const res = BotLeaseResponse.parse(r.body);
      o.alive?.();
      renewMs = res.renewSeconds * 1000;
      if (!res.granted) return { kind: 'refused', holder: res.holder };
      grant = { sentAt, ttlMs: res.ttlSeconds * 1000 };
      return { kind: 'granted' };
    } catch (e) {
      return { kind: 'error', message: (e as Error).message };
    }
  };

  return {
    async acquire() {
      let said = '';
      for (;;) {
        const r = await ask();
        if (r.kind === 'granted') {
          log('[instance] bail obtenu : cette instance est le bot actif');
          return { supported: true };
        }
        if (r.kind === 'unsupported') {
          log(
            '[instance] ATTENTION (développement) : ce Core ne connaît pas le bail d’instance — démarrage sans garantie d’instance unique',
          );
          return { supported: false };
        }
        // Once per change (holder or error), not every 15 s.
        const key =
          r.kind === 'refused'
            ? `holder:${r.holder.instanceId}`
            : `error:${r.message}`;
        if (key !== said)
          log(
            r.kind === 'refused'
              ? `[instance] en attente : une autre instance est active (${r.holder.host}, ${r.holder.instanceId}, depuis ${r.holder.since}) — aucune connexion Twitch`
              : `[instance] en attente : ${r.message} — aucune connexion Twitch, nouvel essai`,
          );
        said = key;
        await sleep(renewMs);
      }
    },
    keep(onStop) {
      let done = false;
      let failing = '';
      const end = (reason: LeaseStop) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        clearTimeout(fence);
        onStop(reason);
      };
      // Re-armed on every grant: fires if no grant comes back in time.
      const arm = () => {
        if (!grant) return; // optional mode without lease: nothing to protect
        clearTimeout(fence);
        const g = grant;
        fence = setTimeout(
          () => end({ kind: 'expired', lastGrantMs: g.sentAt }),
          Math.max(0, g.ttlMs - FENCE_MARGIN_MS - (now() - g.sentAt)),
        );
        fence.unref?.();
      };
      arm();
      timer = setInterval(() => {
        void ask().then((r) => {
          if (done) return;
          if (r.kind === 'refused')
            return end({ kind: 'lost', holder: r.holder });
          if (r.kind === 'granted') {
            arm();
            if (failing) log('[instance] bail renouvelé de nouveau');
            failing = '';
          } else if (r.kind === 'error') {
            if (r.message !== failing)
              log(
                `[instance] renouvellement du bail impossible (${r.message}) — arrêt de sécurité si cela dure`,
              );
            failing = r.message;
          }
        });
      }, renewMs);
      timer.unref?.();
    },
    async release() {
      clearInterval(timer);
      clearTimeout(fence);
      try {
        await Promise.race([
          o.call('/v1/bot/instance/release', { instanceId: o.instanceId }),
          sleep(3000),
        ]);
      } catch {
        // best effort: the lease expires by itself
      }
    },
    stop() {
      clearInterval(timer);
      clearTimeout(fence);
    },
  };
}

const FLAG_NAMES = [
  'DAILY_CHAT_COMMANDS',
  'LOYALTY_CHAT_COMMANDS',
  'LOYALTY_TWITCH_EVENTS',
  'CHANNEL_POINTS_EVENTS',
  'PRESENCE_SHADOW',
  'CHAT_GAMES',
  'CHAT_GAMES_OUTPUT',
  'ALERTS_FOLLOW',
  'RANDOM_BAN',
] as const;

/** What Studio shows of the configuration: on / off per feature and the alerts mode, never a value or a path. */
export function botFlags(
  config: Pick<BotConfig, (typeof FLAG_NAMES)[number] | 'ALERTS_MODE'>,
): BotLeaseRequest['flags'] {
  return {
    ...Object.fromEntries(FLAG_NAMES.map((n) => [n, config[n] === 'true'])),
    ALERTS_MODE: config.ALERTS_MODE,
  };
}
