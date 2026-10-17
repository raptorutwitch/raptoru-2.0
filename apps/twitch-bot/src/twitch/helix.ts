import type { Chatter } from '@raptoru/schemas';
import type { HelixStream } from '../stream-watch.js';

/** Token provider for Helix; implemented by TwitchAuth. */
export interface HelixAuth {
  clientId: string;
  getAccessToken(): Promise<string>;
  /** Called once after a 401; true when a new token is available for one retry. */
  handleUnauthorized(rejectedAccessToken: string): Promise<boolean>;
}

/** Per-request timeout; callers may also pass their own abort signal. */
export const HELIX_REQUEST_TIMEOUT_MS = 10_000;

export class HelixError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    /** From the `Ratelimit-Reset` header (epoch ms), when Twitch sent it. */
    readonly rateLimitResetMs: number | null = null,
  ) {
    super(`helix ${status}: ${body.slice(0, 200)}`);
  }
}

interface HelixResponse {
  data?: unknown[];
  pagination?: { cursor?: string };
  total?: number;
}

export interface ChattersPage {
  chatters: Chatter[];
  cursor: string | null;
  total: number | null;
}

export function createHelix(auth: HelixAuth, fetchImpl: typeof fetch = fetch) {
  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    retried = false,
  ): Promise<HelixResponse> {
    let accessToken: string;
    try {
      accessToken = await auth.getAccessToken();
    } catch (error) {
      // No usable token (refresh rejected, scopes lost…): surface it as an auth failure.
      throw new HelixError(401, `auth: ${(error as Error).message}`);
    }
    const timeout = AbortSignal.timeout(HELIX_REQUEST_TIMEOUT_MS);
    const res = await fetchImpl(`https://api.twitch.tv/helix${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'client-id': auth.clientId,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await res.text();
    if (
      res.status === 401 &&
      !retried &&
      (await auth.handleUnauthorized(accessToken))
    ) {
      return request(method, path, body, signal, true);
    }
    if (!res.ok) {
      const reset = Number(res.headers.get('ratelimit-reset'));
      throw new HelixError(
        res.status,
        text,
        Number.isFinite(reset) && reset > 0 ? reset * 1000 : null,
      );
    }
    return text ? (JSON.parse(text) as HelixResponse) : {};
  }

  return {
    async getStream(broadcasterId: string): Promise<HelixStream | null> {
      const { data = [] } = await request(
        'GET',
        `/streams?user_id=${encodeURIComponent(broadcasterId)}`,
      );
      const stream = data[0] as
        { id: string; started_at: string; type: string } | undefined;
      return stream?.type === 'live'
        ? { id: stream.id, started_at: stream.started_at }
        : null;
    },

    /** One page of Get Chatters (scope moderator:read:chatters; token user = broadcaster or mod). */
    async getChattersPage(
      broadcasterId: string,
      moderatorId: string,
      after: string | null,
      signal?: AbortSignal,
      first = 1000,
    ): Promise<ChattersPage> {
      const qs = new URLSearchParams({
        broadcaster_id: broadcasterId,
        moderator_id: moderatorId,
        first: String(first),
      });
      if (after) qs.set('after', after);
      const res = await request(
        'GET',
        `/chat/chatters?${qs}`,
        undefined,
        signal,
      );
      const rows = (res.data ?? []) as {
        user_id: string;
        user_login: string;
        user_name: string;
      }[];
      return {
        chatters: rows
          .filter((r) => /^\d+$/.test(String(r.user_id)) && r.user_login)
          .map((r) => ({
            twitchUserId: String(r.user_id),
            login: String(r.user_login).slice(0, 25),
            displayName: String(r.user_name || r.user_login).slice(0, 50),
          })),
        cursor: res.pagination?.cursor || null,
        total: typeof res.total === 'number' ? res.total : null,
      };
    },

    /** Twitch identity of a login, or null if it does not exist. */
    async getUserByLogin(login: string): Promise<Chatter | null> {
      const { data = [] } = await request(
        'GET',
        `/users?login=${encodeURIComponent(login)}`,
      );
      const user = data[0] as
        { id: string; login: string; display_name: string } | undefined;
      return user
        ? {
            twitchUserId: user.id,
            login: user.login,
            displayName: user.display_name || user.login,
          }
        : null;
    },

    /** One page of Get Broadcaster Subscriptions (broadcaster token, channel:read:subscriptions). */
    async getSubscriptionsPage(
      broadcasterId: string,
      after: string | null,
      signal?: AbortSignal,
    ) {
      const qs = new URLSearchParams({
        broadcaster_id: broadcasterId,
        first: '100',
      });
      if (after) qs.set('after', after);
      const res = await request(
        'GET',
        `/subscriptions?${qs}`,
        undefined,
        signal,
      );
      return {
        subscriptions: (res.data ?? []) as {
          user_id: string;
          user_login: string;
          user_name: string;
          tier: string;
          is_gift: boolean;
        }[],
        cursor: res.pagination?.cursor || null,
        total: typeof res.total === 'number' ? res.total : null,
      };
    },

    async sendChatMessage(
      broadcasterId: string,
      senderId: string,
      message: string,
    ): Promise<void> {
      await request('POST', '/chat/messages', {
        broadcaster_id: broadcasterId,
        sender_id: senderId,
        message,
      });
    },

    /**
     * Send Chat Message with its outcome (scope user:write:chat): `is_sent` false + `drop_reason` when
     * Twitch dropped it; `reply_parent_message_id` makes it a Twitch reply. No /me here: Helix does not
     * support chat commands (IRC only).
     */
    async sendChat(
      broadcasterId: string,
      senderId: string,
      message: string,
      replyParentMessageId: string | null = null,
    ): Promise<{
      message_id: string | null;
      is_sent: boolean;
      drop_reason: { code: string; message: string } | null;
    }> {
      const res = await request('POST', '/chat/messages', {
        broadcaster_id: broadcasterId,
        sender_id: senderId,
        message,
        ...(replyParentMessageId
          ? { reply_parent_message_id: replyParentMessageId }
          : {}),
      });
      const row = (res.data ?? [])[0] as
        | {
            message_id?: string;
            is_sent?: boolean;
            drop_reason?: { code?: string; message?: string } | null;
          }
        | undefined;
      if (!row || typeof row.is_sent !== 'boolean')
        throw new Error('send chat message: unexpected answer');
      return {
        message_id: row.message_id || null,
        is_sent: row.is_sent,
        drop_reason: row.drop_reason
          ? {
              code: String(row.drop_reason.code ?? 'dropped'),
              message: String(row.drop_reason.message ?? ''),
            }
          : null,
      };
    },

    /** Send Chat Announcement (scope moderator:manage:announcements; token user = a moderator). 204. */
    async sendAnnouncement(
      broadcasterId: string,
      moderatorId: string,
      message: string,
    ): Promise<void> {
      const qs = new URLSearchParams({
        broadcaster_id: broadcasterId,
        moderator_id: moderatorId,
      });
      await request('POST', `/chat/announcements?${qs}`, { message });
    },

    /** Enabled EventSub subscriptions of this token (all pages): used to detect another consumer. */
    async listEnabledSubscriptions(): Promise<
      { type: string; sessionId: string | null; createdAt: string }[]
    > {
      const all: {
        type: string;
        sessionId: string | null;
        createdAt: string;
      }[] = [];
      let after: string | null = null;
      for (let page = 0; page < 20; page++) {
        const qs = new URLSearchParams({ status: 'enabled' });
        if (after) qs.set('after', after);
        const res = await request('GET', `/eventsub/subscriptions?${qs}`);
        for (const s of (res.data ?? []) as {
          type: string;
          created_at: string;
          transport?: { session_id?: string };
        }[])
          all.push({
            type: s.type,
            sessionId: s.transport?.session_id ?? null,
            createdAt: s.created_at,
          });
        after = res.pagination?.cursor || null;
        if (!after) return all;
      }
      // An incomplete list could hide another consumer: never decide on it.
      throw new Error('eventsub subscriptions: too many pages');
    },

    /** The broadcaster's custom rewards (Points de chaîne V1, read only: channel:read:redemptions). */
    async getCustomRewards(broadcasterId: string) {
      const qs = new URLSearchParams({ broadcaster_id: broadcasterId });
      const res = await request('GET', `/channel_points/custom_rewards?${qs}`);
      return (res.data ?? []) as {
        id: string;
        title: string;
        cost: number;
        prompt?: string;
        is_enabled: boolean;
        is_paused?: boolean;
        is_user_input_required?: boolean;
      }[];
    },

    async subscribe(
      type: string,
      condition: Record<string, string>,
      sessionId: string,
      version = '1',
    ): Promise<void> {
      await request('POST', '/eventsub/subscriptions', {
        type,
        version,
        condition,
        transport: { method: 'websocket', session_id: sessionId },
      });
    },
  };
}

export type Helix = ReturnType<typeof createHelix>;
