import type { LabCoreCall, LabCoreEvents } from '../lab-moderation/proxy.js';
import type { BusEvent } from './demo.js';
import type { ChatboxMessage } from './visibility.js';

// Chatbox Raptoru — the real chat from the Core (docs/CHATBOX.md § 5.1): ONE stream for the three profiles, opened only
// while a live OBS page listens, resumed where it stopped (the Core's boot + cursor: only the missed events, or a reset
// of the live history when the Core restarted), reconnected with growing delays, taken for dead after a long silence
// (the Core pings every 25 s). And the command catalogue (every command the project knows), refreshed every minute.

export const UPSTREAM_RETRY_MS = [1000, 2000, 5000, 10_000];
export const UPSTREAM_IDLE_MS = 60_000;
const CATALOG_TTL_MS = 60_000;

export interface CatalogCommand {
  key: string;
  label: string;
  module: string;
  words: string[];
  source: 'commands_v2' | 'module' | 'discovered';
  enabled: boolean;
}

export interface CoreLink {
  call: LabCoreCall;
  events: LabCoreEvents;
  channelId: string;
}

export class ChatboxUpstream {
  private ac: AbortController | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private boot = '';
  private cursor = -1;
  private catalogAt = 0;
  private catalogLoading: Promise<void> | null = null;
  commands: CatalogCommand[] = [];
  /** null: never read; else when the Core's stream last answered (Studio shows it). */
  connectedAt: number | null = null;
  lastEventAt: number | null = null;
  catalogError: string | null = null;

  constructor(
    private readonly d: {
      core: CoreLink;
      /** The live feed's events (Studio decides what each page shows). */
      emit: (e: BusEvent) => void;
      reset: (messages: ChatboxMessage[]) => void;
      /** True while at least one live page listens. */
      wanted: () => boolean;
      idleMs?: number;
    },
  ) {}

  /** A live page connected: the stream opens if it is not. */
  ensure() {
    if (!this.ac && !this.retry) void this.connect();
  }

  stop() {
    this.ac?.abort();
    this.ac = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  get connected() {
    return !!this.ac && this.connectedAt !== null;
  }

  /** The catalogue (read again after a minute; a failure keeps the last one and says so). */
  async catalog(force = false) {
    if (!force && Date.now() - this.catalogAt < CATALOG_TTL_MS)
      return this.commands;
    this.catalogLoading ??= (async () => {
      try {
        const r = await this.d.core.call<{ commands: CatalogCommand[] }>(
          `/v1/lab/chatbox/${this.d.core.channelId}/catalog`,
        );
        this.commands = Array.isArray(r.commands) ? r.commands : [];
        this.catalogError = null;
      } catch (e) {
        this.catalogError = (e as Error).message;
      } finally {
        this.catalogAt = Date.now();
        this.catalogLoading = null;
      }
    })();
    await this.catalogLoading;
    return this.commands;
  }

  private async connect() {
    const ac = new AbortController();
    this.ac = ac;
    try {
      const q = new URLSearchParams({
        boot: this.boot,
        after: String(this.cursor),
      });
      const res = await this.d.core.events(
        `/v1/lab/chatbox/${this.d.core.channelId}/events?${q}`,
        ac.signal,
      );
      this.attempt = 0;
      this.connectedAt = Date.now();
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let idle: ReturnType<typeof setTimeout> | undefined;
      const watch = () => {
        clearTimeout(idle);
        idle = setTimeout(() => ac.abort(), this.d.idleMs ?? UPSTREAM_IDLE_MS);
        idle.unref?.();
      };
      watch();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          watch();
          buffer += decoder.decode(value, { stream: true });
          for (let i; (i = buffer.indexOf('\n\n')) >= 0;) {
            this.handle(buffer.slice(0, i));
            buffer = buffer.slice(i + 2);
          }
        }
      } finally {
        clearTimeout(idle);
      }
    } catch {
      /* the Core is away, restarting, or the stream was closed on purpose */
    }
    if (this.ac !== ac) return;
    this.ac = null;
    this.connectedAt = null;
    if (!this.d.wanted()) return;
    const delay =
      UPSTREAM_RETRY_MS[Math.min(this.attempt++, UPSTREAM_RETRY_MS.length - 1)];
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.d.wanted()) void this.connect();
    }, delay);
    this.retry.unref?.();
  }

  private handle(block: string) {
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const raw = /^data: (.*)$/m.exec(block)?.[1];
    if (!event || !raw) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    this.lastEventAt = Date.now();
    if (event === 'hello') {
      this.boot = String(data.boot ?? '');
      return;
    }
    if (event === 'reset') {
      this.cursor = Number(data.cursor ?? -1);
      this.d.reset((data.messages as ChatboxMessage[]) ?? []);
      return;
    }
    if (event !== 'chatbox') return;
    this.cursor = Math.max(this.cursor, Number(data.seq ?? this.cursor));
    if (data.type === 'msg')
      this.d.emit({ type: 'msg', message: data.message as ChatboxMessage });
    else if (data.type === 'delete')
      this.d.emit({ type: 'delete', id: String(data.id) });
    else if (data.type === 'clear_user')
      this.d.emit({ type: 'clear_user', userId: String(data.userId) });
    else if (data.type === 'clear') this.d.emit({ type: 'clear' });
  }
}
