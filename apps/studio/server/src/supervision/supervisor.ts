import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Signal } from './signals.js';

// Incidents of the live (docs/PLAN_SUPERVISION_2026-10-23.md lots 1–2). Runs in the Studio server whatever page is open:
// every change of a signal is one log line (Electron keeps the output in <userData>/logs/studio-server.log) and one
// history entry; an error lasting CONFIRM_MS becomes an incident, shown by the global banner and notified once by the
// desktop shell. A shorter outage is a « microcoupure »: history and log only, never an alert. Memory only: a Studio
// restart starts afresh (the log file keeps the lines of the previous run).

export const CONFIRM_MS = 30_000;
export const STARTUP_GRACE_MS = 20_000;
const HISTORY_MAX = 50;
const ENDED_MAX = 20;

export interface Incident {
  id: string;
  signal: string;
  label: string;
  cause: string | null;
  value: string;
  hint: string | null;
  action: 'auto' | 'manual' | null;
  startedAt: string;
  confirmedAt: string;
  endedAt: string | null;
  acknowledged: boolean;
}

export interface HistoryEntry {
  at: string;
  signal: string;
  label: string;
  kind: 'down' | 'confirmed' | 'up' | 'micro';
  text: string;
}

interface Track {
  label: string;
  since: number;
  cause: string | null;
  incident: Incident | null;
}

export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60
    ? `${m} min ${s % 60} s`
    : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export class Supervisor {
  private readonly down = new Map<string, Track>();
  private readonly incidents: Incident[] = [];
  private readonly history: HistoryEntry[] = [];
  private signals: Signal[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;
  private firstAt: number | null = null;

  constructor(
    private readonly d: {
      read(): Promise<Signal[]>;
      log(line: string): void;
      now?: () => number;
      confirmMs?: number;
      /** Startup: players (OBS sources, Studio window) reconnect; nothing is counted before this. */
      graceMs?: number;
    },
  ) {}

  private now() {
    return (this.d.now ?? Date.now)();
  }

  private note(
    at: number,
    s: Signal,
    kind: HistoryEntry['kind'],
    text: string,
  ) {
    this.history.unshift({
      at: new Date(at).toISOString(),
      signal: s.id,
      label: s.label,
      kind,
      text,
    });
    this.history.length = Math.min(this.history.length, HISTORY_MAX);
    this.d.log(`[supervision] ${s.label} : ${text}`);
  }

  /** One observation of every signal (pure bookkeeping: tested with a fake clock). */
  observe(signals: Signal[], at = this.now()) {
    this.signals = signals;
    this.firstAt ??= at;
    // Studio just started: the players and OBS are reconnecting. No outage is counted yet (no false alert at startup);
    // one still present after the grace starts its 30 s from there.
    if (at - this.firstAt < (this.d.graceMs ?? STARTUP_GRACE_MS)) return;
    const seen = new Set<string>();
    for (const s of signals) {
      seen.add(s.id);
      const track = this.down.get(s.id);
      const failing = s.level === 'error';
      if (failing && !track) {
        this.down.set(s.id, {
          label: s.label,
          since: at,
          cause: s.cause,
          incident: null,
        });
        this.note(
          at,
          s,
          'down',
          `indisponible (${s.cause ?? 'erreur'}) — ${s.value}`,
        );
      } else if (failing && track) {
        if (s.cause !== track.cause) {
          track.cause = s.cause;
          this.note(
            at,
            s,
            'down',
            `toujours indisponible, nouvelle cause (${s.cause ?? 'erreur'}) — ${s.value}`,
          );
        }
        if (track.incident) Object.assign(track.incident, pick(s));
        else if (at - track.since >= (this.d.confirmMs ?? CONFIRM_MS)) {
          track.incident = {
            id: randomUUID(),
            signal: s.id,
            label: s.label,
            ...pick(s),
            startedAt: new Date(track.since).toISOString(),
            confirmedAt: new Date(at).toISOString(),
            endedAt: null,
            acknowledged: false,
          };
          this.incidents.unshift(track.incident);
          this.note(
            at,
            s,
            'confirmed',
            `panne confirmée après ${duration(at - track.since)} (${s.cause ?? 'erreur'})`,
          );
        }
      } else if (!failing && track) this.recover(s, track, at);
    }
    // A signal that disappeared (module stopped) ends its outage too.
    for (const [id, track] of this.down)
      if (!seen.has(id))
        this.recover(
          {
            id,
            label: track.label,
            level: 'off',
            value: 'arrêté',
            cause: null,
            action: null,
            hint: null,
          },
          track,
          at,
        );
    this.prune();
  }

  private recover(s: Signal, track: Track, at: number) {
    this.down.delete(s.id);
    const lasted = duration(at - track.since);
    if (track.incident) {
      track.incident.endedAt = new Date(at).toISOString();
      this.note(at, s, 'up', `rétabli après ${lasted}`);
    } else
      this.note(at, s, 'micro', `microcoupure de ${lasted}, rétablie seule`);
  }

  /** Ended and acknowledged incidents leave; the ended unacknowledged ones stay (bounded). */
  private prune() {
    for (let i = this.incidents.length - 1; i >= 0; i--) {
      const inc = this.incidents[i]!;
      if (inc.endedAt && inc.acknowledged) this.incidents.splice(i, 1);
    }
    const ended = this.incidents.filter((i) => i.endedAt);
    for (const old of ended.slice(ENDED_MAX))
      this.incidents.splice(this.incidents.indexOf(old), 1);
  }

  /** « Vu »: only an ended incident (an ongoing one stays on screen while it lasts). */
  acknowledge(id: string): 'ok' | 'active' | 'unknown' {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc) return 'unknown';
    if (!inc.endedAt) return 'active';
    inc.acknowledged = true;
    this.prune();
    return 'ok';
  }

  snapshot() {
    return {
      now: new Date(this.now()).toISOString(),
      confirm_ms: this.d.confirmMs ?? CONFIRM_MS,
      signals: this.signals,
      incidents: this.incidents.map((i) => ({ ...i })),
      history: this.history.map((h) => ({ ...h })),
    };
  }

  async check() {
    if (this.checking) return;
    this.checking = true;
    try {
      this.observe(await this.d.read());
    } catch (e) {
      this.d.log(`[supervision] lecture impossible : ${(e as Error).message}`);
    } finally {
      this.checking = false;
    }
  }

  start(intervalMs = 5000) {
    void this.check();
    this.timer = setInterval(() => void this.check(), intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** GET /api/supervision · POST /api/supervision/ack {id} (local Studio page and desktop shell only). */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    origin: string,
  ): Promise<boolean> {
    if (
      url.pathname !== '/api/supervision' &&
      url.pathname !== '/api/supervision/ack'
    )
      return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    const o = new URL(origin);
    if (
      req.headers.host !== o.host ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      reply(403, { error: 'forbidden_origin' });
    else if (req.headers['x-raptoru-studio'] !== '1')
      reply(403, { error: 'forbidden' });
    else if (url.pathname === '/api/supervision') {
      if (req.method === 'GET') reply(200, this.snapshot());
      else reply(405, { error: 'method_not_allowed' });
    } else if (req.method !== 'POST')
      reply(405, { error: 'method_not_allowed' });
    else {
      let raw = '';
      for await (const chunk of req) {
        raw += String(chunk);
        if (raw.length > 1024) break;
      }
      let id = '';
      try {
        id = String((JSON.parse(raw || '{}') as { id?: unknown }).id ?? '');
      } catch {
        /* invalid body → unknown */
      }
      const r = this.acknowledge(id);
      if (r === 'ok') reply(200, { ok: true });
      else if (r === 'active') reply(409, { error: 'incident_active' });
      else reply(404, { error: 'not_found' });
    }
    return true;
  }
}

function pick(s: Signal) {
  return { cause: s.cause, value: s.value, hint: s.hint, action: s.action };
}
