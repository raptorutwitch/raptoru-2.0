import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Clock } from '../clock.js';
import type { Queryable } from '../db/db.js';

// Chatbox Raptoru — the Core's relay (docs/CHATBOX.md § 5.1). The bot sends what the chatbox shows (its existing
// EventSub connection, no second one); the Core adds what only it knows — the Raptoru staff role (lab_staff), the badge
// images (Helix, app token) and, for LeCroupier_'s own messages, the chat step that sent them (cmd_steps: origin, kind,
// the command it answered) — and keeps the last events IN MEMORY ONLY (never a table, never a log of their content)
// for Studio's stream. A Core restart starts empty (Studio is told to reset).

const Text = z.string().max(600);
const Fragment = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('text'), text: Text }),
  z.strictObject({
    t: z.literal('emote'),
    id: z.string().min(1).max(80),
    text: Text,
  }),
  z.strictObject({ t: z.literal('mention'), text: Text }),
  z.strictObject({
    t: z.literal('cheer'),
    text: Text,
    bits: z.number().int().min(0).max(1_000_000),
  }),
  z.strictObject({
    t: z.literal('gif'),
    url: z.string().url().max(500),
    text: Text,
  }),
]);
const Id = z.string().regex(/^\d{1,20}$/);

export const ChatboxIncoming = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('msg'),
    message_id: z.string().min(1).max(128),
    at: z.number().int().positive(),
    user: z.strictObject({
      id: Id,
      login: z.string().min(1).max(64),
      name: z.string().min(1).max(64),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable(),
      badges: z
        .array(
          z.strictObject({
            set: z.string().regex(/^[a-z0-9_-]{1,40}$/),
            version: z.string().max(40),
          }),
        )
        .max(20),
    }),
    fragments: z.array(Fragment).max(200),
    action: z.boolean().optional(),
    kind: z.enum(['chat', 'announcement', 'highlighted', 'first']).optional(),
    accent: z.enum(['primary', 'blue', 'green', 'orange', 'purple']).optional(),
    reply: z.strictObject({ name: z.string().max(64), text: Text }).optional(),
    /** LeCroupier_'s own message (never seen by the chat games). */
    own: z.boolean().optional(),
    /** The bot's own direct answer (Daily, Jetons): the command word it answered. */
    answered: z.string().max(40).nullable().optional(),
  }),
  z.strictObject({
    type: z.literal('delete'),
    message_id: z.string().min(1).max(128),
  }),
  z.strictObject({ type: z.literal('clear_user'), user_id: Id }),
  z.strictObject({ type: z.literal('clear') }),
]);
export type ChatboxIncoming = z.infer<typeof ChatboxIncoming>;
export const ChatboxBatch = z.strictObject({
  channel_id: Id,
  events: z.array(ChatboxIncoming).min(1).max(50),
});

/** What Studio receives for one message (its visibility rules and the OBS pages decide what is shown). */
export interface ChatboxMessage {
  id: string;
  at: number;
  user: {
    id: string;
    login: string;
    name: string;
    color: string | null;
    badges: { set: string; version: string; url: string | null }[];
    staff: 'supermod' | null;
  };
  fragments: z.infer<typeof Fragment>[];
  action?: boolean;
  type?: 'chat' | 'announcement' | 'highlighted' | 'first';
  accent?: 'primary' | 'blue' | 'green' | 'orange' | 'purple';
  reply?: { name: string; text: string };
  /** LeCroupier_'s own message: the step family that sent it and the command word it answered (null: unknown). */
  croupier?: { family: string | null; command: string | null };
}

type EventBody =
  | { type: 'msg'; message: ChatboxMessage }
  | { type: 'delete'; id: string }
  | { type: 'clear_user'; userId: string }
  | { type: 'clear' };
export type ChatboxEvent = EventBody & { seq: number };

export interface BadgeImages {
  /** `${set}/${version}` → image URL; refreshed by the relay. */
  load(channelId: string): Promise<Map<string, string>>;
}

const EVENTS_MAX = 400;
const MESSAGES_MAX = 200;
/** An own message's step: Twitch's echo can come before the bot's ACK (twitch_message_id written after the send). */
const OWN_LOOKUPS_MS = [0, 300, 900, 2000];
const STAFF_TTL_MS = 60_000;
const BADGES_TTL_MS = 6 * 3600_000;

export class ChatboxRelay {
  /** Changes at every Core start: Studio resets its live history when it differs. */
  readonly boot = randomUUID();
  private seq = 0;
  private readonly events: ChatboxEvent[] = [];
  private readonly messages = new Map<string, ChatboxMessage>();
  private readonly listeners = new Set<(e: ChatboxEvent) => void>();
  private staff: { at: number; ids: Set<string> } | null = null;
  private badges: { at: number; map: Map<string, string> } | null = null;
  /** Command words the chat modules took (a module's new command appears in the catalogue on its first use). */
  readonly discovered = new Map<string, string>();

  constructor(
    private readonly d: {
      db: Queryable;
      clock: Clock;
      channelId: string;
      badgeImages?: BadgeImages | null;
      sleep?: (ms: number) => Promise<void>;
      log?: (...a: unknown[]) => void;
    },
  ) {}

  get cursor() {
    return this.seq;
  }

  /** Every event still remembered after `after` (null when Studio must reset: another boot, or too old). */
  since(boot: string, after: number): ChatboxEvent[] | null {
    if (boot !== this.boot || after > this.seq) return null;
    const first = this.events[0]?.seq ?? this.seq + 1;
    if (after < first - 1) return null;
    return this.events.filter((e) => e.seq > after);
  }

  /** The chat as it stands (moderation applied): Studio's reset. */
  snapshot(): ChatboxMessage[] {
    return [...this.messages.values()];
  }

  listen(fn: (e: ChatboxEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EventBody) {
    const ev = { ...e, seq: ++this.seq } as ChatboxEvent;
    this.events.push(ev);
    if (this.events.length > EVENTS_MAX)
      this.events.splice(0, this.events.length - EVENTS_MAX);
    if (ev.type === 'msg') {
      this.messages.set(ev.message.id, ev.message);
      if (this.messages.size > MESSAGES_MAX)
        this.messages.delete(this.messages.keys().next().value!);
    } else if (ev.type === 'delete') this.messages.delete(ev.id);
    else if (ev.type === 'clear_user') {
      for (const [id, m] of this.messages)
        if (m.user.id === ev.userId) this.messages.delete(id);
    } else this.messages.clear();
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch {
        /* a broken listener never stops the others */
      }
    }
  }

  /** The bot's events (its own messages resolved against the chat steps first). */
  async ingest(batch: z.infer<typeof ChatboxBatch>) {
    for (const e of batch.events) {
      if (e.type === 'delete') this.emit({ type: 'delete', id: e.message_id });
      else if (e.type === 'clear_user')
        this.emit({ type: 'clear_user', userId: e.user_id });
      else if (e.type === 'clear') this.emit({ type: 'clear' });
      else if (e.own) void this.own(e);
      else this.emit({ type: 'msg', message: await this.message(e) });
    }
  }

  /** The Lab's simulated chat (no display fields): shown as plain text, with the roles its badges give. */
  async simulated(m: {
    message_id: string;
    text: string;
    chatter: {
      id: string;
      login: string;
      display_name: string;
      badges?: string[];
    };
  }) {
    this.emit({
      type: 'msg',
      message: await this.message({
        type: 'msg',
        message_id: m.message_id,
        at: this.d.clock.now().getTime(),
        user: {
          id: m.chatter.id,
          login: m.chatter.login,
          name: m.chatter.display_name,
          color: null,
          badges: (m.chatter.badges ?? []).map((set) => ({
            set,
            version: '1',
          })),
        },
        fragments: [{ t: 'text', text: m.text }],
      }),
    });
  }

  /** A command word a chat module took (the catalogue's automatic discovery). */
  discover(word: string, module: string) {
    if (/^[\p{Ll}\p{N}_]{1,40}$/u.test(word) && !this.discovered.has(word))
      this.discovered.set(word, module);
  }

  private async message(
    e: Extract<ChatboxIncoming, { type: 'msg' }>,
  ): Promise<ChatboxMessage> {
    const [staff, badges] = await Promise.all([
      this.staffIds(),
      this.badgeMap(),
    ]);
    return {
      id: e.message_id,
      at: e.at,
      user: {
        ...e.user,
        badges: e.user.badges.map((b) => ({
          ...b,
          url: badges.get(`${b.set}/${b.version}`) ?? null,
        })),
        staff: staff.has(e.user.id) ? 'supermod' : null,
      },
      fragments: e.fragments,
      ...(e.action ? { action: true } : {}),
      ...(e.kind && e.kind !== 'chat' ? { type: e.kind } : {}),
      ...(e.accent ? { accent: e.accent } : {}),
      ...(e.reply ? { reply: e.reply } : {}),
    };
  }

  /**
   * LeCroupier_'s own message: the chat step that sent it (by its Twitch id; an announcement, which Twitch sends back
   * without one, by the exact text it just announced), else the bot's own answer, else « not categorised ».
   */
  private async own(e: Extract<ChatboxIncoming, { type: 'msg' }>) {
    const sleep =
      this.d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let croupier: ChatboxMessage['croupier'] = {
      family: null,
      command: e.answered ?? null,
    };
    if (e.answered !== undefined)
      croupier = { family: 'bot:reply', command: e.answered ?? null };
    else {
      const text = e.fragments.map((f) => f.text).join('');
      for (const wait of OWN_LOOKUPS_MS) {
        if (wait) await sleep(wait);
        const step = await this.step(
          e.message_id,
          e.kind === 'announcement' ? text : null,
        ).catch(() => null);
        if (step) {
          croupier = step;
          break;
        }
      }
    }
    const message = await this.message(e);
    this.emit({ type: 'msg', message: { ...message, croupier } });
  }

  private async step(messageId: string, announced: string | null) {
    const rows = await this.d.db.query<{
      origin: string | null;
      kind: string;
      params: Record<string, unknown>;
    }>(
      announced === null
        ? `select origin, kind, params from cmd_steps where channel_id = $1 and twitch_message_id = $2 limit 1`
        : `select origin, kind, params from cmd_steps
             where channel_id = $1 and status = 'succeeded' and params->>'mode' = 'announce' and params->>'text' = $2
               and updated_at > $3
             order by updated_at desc limit 1`,
      announced === null
        ? [this.d.channelId, messageId]
        : [
            this.d.channelId,
            announced,
            new Date(this.d.clock.now().getTime() - 60_000),
          ],
    );
    const r = rows[0];
    if (!r) return null;
    const trigger = (r.params?.trigger ?? null) as { command?: unknown } | null;
    const family =
      typeof r.params?.family === 'string'
        ? r.params.family
        : `${r.origin ?? 'commands'}:${r.kind}`;
    return {
      family,
      command: typeof trigger?.command === 'string' ? trigger.command : null,
    };
  }

  private async staffIds() {
    const now = this.d.clock.now().getTime();
    if (this.staff && now - this.staff.at < STAFF_TTL_MS) return this.staff.ids;
    try {
      const rows = await this.d.db.query<{ viewer_id: string }>(
        `select viewer_id from lab_staff where channel_id = $1 and role = 'supermod'`,
        [this.d.channelId],
      );
      this.staff = { at: now, ids: new Set(rows.map((r) => r.viewer_id)) };
    } catch {
      this.staff = { at: now, ids: this.staff?.ids ?? new Set() };
    }
    return this.staff.ids;
  }

  private async badgeMap() {
    const now = this.d.clock.now().getTime();
    if (!this.d.badgeImages) return new Map<string, string>();
    if (this.badges && now - this.badges.at < BADGES_TTL_MS)
      return this.badges.map;
    const prior = this.badges?.map ?? new Map<string, string>();
    // One attempt per period: a failing Helix never slows the chat down (the badges stay as they were).
    this.badges = { at: now, map: prior };
    try {
      this.badges = {
        at: now,
        map: await this.d.badgeImages.load(this.d.channelId),
      };
    } catch (e) {
      this.d.log?.('[chatbox] badges unavailable', (e as Error).message);
    }
    return this.badges.map;
  }
}

/** Helix badge images (global + the channel's), with the Twitch app's token (client credentials). */
export function helixBadgeImages(
  app: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): BadgeImages {
  let token: { value: string; until: number } | null = null;
  const appToken = async () => {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const res = await fetchImpl('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`twitch_app_token_${res.status}`);
    const b = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    token = { value: b.access_token, until: Date.now() + b.expires_in * 1000 };
    return token.value;
  };
  const get = async (path: string) => {
    const res = await fetchImpl(`https://api.twitch.tv/helix${path}`, {
      headers: {
        authorization: `Bearer ${await appToken()}`,
        'client-id': app.clientId,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`helix_badges_${res.status}`);
    return (
      (await res.json()) as {
        data: {
          set_id: string;
          versions: {
            id: string;
            image_url_2x?: string;
            image_url_4x?: string;
          }[];
        }[];
      }
    ).data;
  };
  return {
    async load(channelId) {
      const map = new Map<string, string>();
      // The channel's own badges (subscriber, bits) override the global ones of the same set.
      for (const set of [
        ...(await get('/chat/badges/global')),
        ...(await get(`/chat/badges?broadcaster_id=${channelId}`)),
      ])
        for (const v of set.versions) {
          const url = v.image_url_4x ?? v.image_url_2x;
          if (url) map.set(`${set.set_id}/${v.id}`, url);
        }
      return map;
    },
  };
}
