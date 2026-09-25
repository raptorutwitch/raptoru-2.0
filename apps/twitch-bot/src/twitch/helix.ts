import type { HelixStream } from '../stream-watch.js';

export interface HelixAuth {
  clientId: string;
  accessToken: string;
}

export class HelixError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`helix ${status}: ${body.slice(0, 200)}`);
  }
}

export function createHelix(auth: HelixAuth, fetchImpl: typeof fetch = fetch) {
  async function request(method: 'GET' | 'POST', path: string, body?: unknown) {
    const res = await fetchImpl(`https://api.twitch.tv/helix${path}`, {
      method,
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'client-id': auth.clientId,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) throw new HelixError(res.status, text);
    return text ? (JSON.parse(text) as { data?: unknown[] }) : {};
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

    async subscribe(
      type: string,
      condition: Record<string, string>,
      sessionId: string,
    ): Promise<void> {
      await request('POST', '/eventsub/subscriptions', {
        type,
        version: '1',
        condition,
        transport: { method: 'websocket', session_id: sessionId },
      });
    },
  };
}

/** Throws unless the user access token is valid; returns its login and remaining lifetime. */
export async function validateToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  const res = await fetchImpl('https://id.twitch.tv/oauth2/validate', {
    headers: { authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Twitch token rejected (${res.status})`);
  return (await res.json()) as {
    login: string;
    user_id: string;
    expires_in: number;
    scopes: string[];
  };
}
