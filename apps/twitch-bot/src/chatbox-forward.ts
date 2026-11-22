// Chatbox Raptoru (docs/CHATBOX.md § 5.1) — what the chatbox shows, sent to the main Core (POST /v1/bot/chatbox) from
// this bot's EXISTING EventSub connection: never a second connection or token. Every chat message (display fields:
// colour, badges, emote fragments, /me, reply, announcement, highlight, first message), LeCroupier_'s own messages
// (marked: the chat games never see them) and the moderation (deleted message, timeout / ban, clear). Batched, best
// effort: the chat games and the alerts never wait for it, a Core that refuses or is away only loses the chatbox
// events of that moment. OFF unless CHATBOX_RELAY=true.

export type ChatboxEvent =
  | {
      type: 'msg';
      message_id: string;
      at: number;
      user: {
        id: string;
        login: string;
        name: string;
        color: string | null;
        badges: { set: string; version: string }[];
      };
      fragments: (
        | { t: 'text'; text: string }
        | { t: 'emote'; id: string; text: string }
        | { t: 'mention'; text: string }
        | { t: 'cheer'; text: string; bits: number }
        | { t: 'gif'; url: string; text: string }
      )[];
      action?: boolean;
      kind?: 'chat' | 'announcement' | 'highlighted' | 'first';
      accent?: 'primary' | 'blue' | 'green' | 'orange' | 'purple';
      reply?: { name: string; text: string };
      own?: boolean;
      answered?: string | null;
    }
  | { type: 'delete'; message_id: string }
  | { type: 'clear_user'; user_id: string }
  | { type: 'clear' };

/** The EventSub subscriptions the chatbox adds to the connection (channel.chat.message is already there). */
export const CHATBOX_SUBSCRIPTIONS = [
  'channel.chat.notification',
  'channel.chat.message_delete',
  'channel.chat.clear_user_messages',
  'channel.chat.clear',
] as const;

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const ACCENTS = new Set(['primary', 'blue', 'green', 'orange', 'purple']);

/** `!` followed by a letter or a digit (the Core's own rule): the command word a bot answer belongs to. */
export function commandWord(text: string): string | null {
  const m = /^\s*!([\p{L}\p{N}][\p{L}\p{N}_]*)/u.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

function fragments(
  message: unknown,
): Extract<ChatboxEvent, { type: 'msg' }>['fragments'] {
  const m = (message ?? {}) as { text?: unknown; fragments?: unknown };
  const list = Array.isArray(m.fragments) ? (m.fragments as Raw[]) : [];
  if (!list.length) return [{ t: 'text', text: str(m.text).slice(0, 600) }];
  return list.slice(0, 200).map((f) => {
    const text = str(f.text).slice(0, 600);
    if (f.type === 'emote' && str((f.emote as Raw | null)?.id))
      return {
        t: 'emote' as const,
        id: str((f.emote as Raw).id).slice(0, 80),
        text,
      };
    if (f.type === 'mention') return { t: 'mention' as const, text };
    // Twitch's GIFs (EventSub `gif` fragment: id + url, « must not be modified »): shown as the old widgets did.
    if (f.type === 'gif' && /^https:\/\//.test(str((f.gif as Raw | null)?.url)))
      return {
        t: 'gif' as const,
        url: str((f.gif as Raw).url).slice(0, 500),
        text,
      };
    if (f.type === 'cheermote')
      return {
        t: 'cheer' as const,
        text,
        bits: Number((f.cheermote as Raw | null)?.bits ?? 0) || 0,
      };
    return { t: 'text' as const, text };
  });
}

function user(e: Raw) {
  const badges = Array.isArray(e.badges) ? (e.badges as Raw[]) : [];
  const color = str(e.color);
  return {
    id: str(e.chatter_user_id),
    login: str(e.chatter_user_login).toLowerCase(),
    name: str(e.chatter_user_name) || str(e.chatter_user_login),
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
    badges: badges
      .map((b) => ({ set: str(b.set_id), version: str(b.id).slice(0, 40) }))
      .filter((b) => /^[a-z0-9_-]{1,40}$/.test(b.set))
      .slice(0, 20),
  };
}

/** One EventSub notification → the chatbox event it means (null: nothing for the chatbox). */
export function chatboxEvent(
  type: string,
  e: Raw,
  o: {
    tokenUserId: string;
    answered?: (messageId: string) => string | null | undefined;
  },
): ChatboxEvent | null {
  if (type === 'channel.chat.message') {
    const text = str((e.message as Raw | null)?.text);
    const u = user(e);
    if (!u.id || !str(e.message_id)) return null;
    const kind =
      e.message_type === 'channel_points_highlighted'
        ? 'highlighted'
        : e.message_type === 'user_intro'
          ? 'first'
          : 'chat';
    const reply = e.reply as Raw | null;
    const own = u.id === o.tokenUserId;
    const answered = own ? o.answered?.(str(e.message_id)) : undefined;
    // `/me`: EventSub keeps the action as the text « \u0001ACTION … » (IRC) or flags nothing: the text is kept as it is.
    const SOH = String.fromCharCode(1);
    const ACTION = `${SOH}ACTION `;
    const action = text.startsWith(ACTION);
    return {
      type: 'msg',
      message_id: str(e.message_id),
      at: Date.now(),
      user: u,
      fragments: action
        ? [
            {
              t: 'text',
              text: text
                .slice(ACTION.length)
                .replace(/\s*$/, '')
                .split(SOH)
                .join(''),
            },
          ]
        : fragments(e.message),
      ...(action ? { action: true } : {}),
      ...(kind !== 'chat' ? { kind } : {}),
      ...(reply && str(reply.parent_message_id)
        ? {
            reply: {
              name: str(reply.parent_user_name),
              text: str(reply.parent_message_body).slice(0, 600),
            },
          }
        : {}),
      ...(own
        ? { own: true, ...(answered !== undefined ? { answered } : {}) }
        : {}),
    };
  }
  if (type === 'channel.chat.notification') {
    // Announcements only (V1), the shared chat's too: subscriptions and raids are the alerts' (no duplicate).
    const shared = e.notice_type === 'shared_chat_announcement';
    if (e.notice_type !== 'announcement' && !shared) return null;
    const u = user(e);
    if (!u.id || !str(e.message_id)) return null;
    const color = str(
      ((shared ? e.shared_chat_announcement : e.announcement) as Raw | null)
        ?.color,
    ).toLowerCase();
    return {
      type: 'msg',
      message_id: str(e.message_id),
      at: Date.now(),
      user: u,
      fragments: fragments(e.message),
      kind: 'announcement',
      ...(ACCENTS.has(color) ? { accent: color as 'blue' } : {}),
      ...(u.id === o.tokenUserId ? { own: true } : {}),
    };
  }
  if (type === 'channel.chat.message_delete')
    return str(e.message_id)
      ? { type: 'delete', message_id: str(e.message_id) }
      : null;
  if (type === 'channel.chat.clear_user_messages')
    return str(e.target_user_id)
      ? { type: 'clear_user', user_id: str(e.target_user_id) }
      : null;
  if (type === 'channel.chat.clear') return { type: 'clear' };
  return null;
}

/** The bot's own direct answers (Daily, Jetons): the message id Helix gave → the command word it answered. */
export class OwnAnswers {
  private readonly map = new Map<string, string | null>();
  note(messageId: string | null, command: string | null) {
    if (!messageId) return;
    this.map.set(messageId, command);
    if (this.map.size > 300) this.map.delete(this.map.keys().next().value!);
  }
  get(messageId: string) {
    return this.map.has(messageId)
      ? (this.map.get(messageId) ?? null)
      : undefined;
  }
}

export function createChatboxForwarder(d: {
  channelId: string;
  post: (path: string, body: unknown) => Promise<{ status: number }>;
  log?: (...a: unknown[]) => void;
  /** Batching delay (ms). */
  flushMs?: number;
  /** An own message waits this long for its Helix answer (OwnAnswers) before it leaves. */
  ownDelayMs?: number;
}) {
  const log = d.log ?? console.log;
  const queue: ChatboxEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastError = 0;
  const flush = async () => {
    timer = null;
    const events = queue.splice(0, 50);
    if (queue.length) timer = setTimeout(() => void flush(), 0);
    if (!events.length) return;
    try {
      const r = await d.post('/v1/bot/chatbox', {
        channel_id: d.channelId,
        events,
      });
      if (r.status >= 300) throw new Error(`core_${r.status}`);
    } catch (e) {
      // Best effort: the chatbox loses these events, the chat games never wait. One line a minute at most.
      if (Date.now() - lastError > 60_000)
        log('[chatbox] events not delivered', (e as Error).message);
      lastError = Date.now();
    }
  };
  const push = (e: ChatboxEvent) => {
    queue.push(e);
    timer ??= setTimeout(() => void flush(), d.flushMs ?? 60);
  };
  return {
    /** An event; an own message waits a moment for the bot's own answer to be known. */
    send(e: ChatboxEvent, resolve?: () => ChatboxEvent | null) {
      if (e.type === 'msg' && e.own && resolve)
        setTimeout(() => push(resolve() ?? e), d.ownDelayMs ?? 400);
      else push(e);
    },
    flushNow: flush,
  };
}
