// Minimal EventSub WebSocket client: welcome → subscribe, keepalive watchdog, server-requested
// reconnect, and message-id dedupe (Twitch may deliver a notification more than once).

export const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

interface EventSubMessage {
  metadata: {
    message_id: string;
    message_type: string;
    message_timestamp?: string;
    subscription_type?: string;
  };
  payload: {
    session?: {
      id: string;
      keepalive_timeout_seconds: number | null;
      reconnect_url: string | null;
    };
    subscription?: { type: string; status?: string };
    event?: Record<string, unknown>;
  };
}

export interface EventSubHandlers {
  /** Called on the first welcome of a fresh connection: create subscriptions for `sessionId`. */
  subscribe(sessionId: string): Promise<void>;
  /**
   * `messageId` is stable across Twitch redeliveries: usable as an idempotency key. `timestamp` is
   * the Twitch time of the message.
   */
  notification(
    type: string,
    event: Record<string, unknown>,
    messageId: string,
    timestamp: string,
  ): Promise<void>;
  log?: (...args: unknown[]) => void;
  /** A revoked subscription requires an explicit recovery; do not keep advertising it as active. */
  revocation?: (type: string, status: string) => void;
}

/** Pure message routing, separated from the socket for tests. */
export function createEventSubRouter(
  handlers: EventSubHandlers,
  dedupeSize = 500,
) {
  const seen: string[] = [];
  const log = handlers.log ?? console.log;

  return async function route(
    raw: string,
    fresh: boolean,
  ): Promise<
    | { kind: 'welcome'; keepaliveSeconds: number }
    | { kind: 'reconnect'; url: string }
    | { kind: 'other' }
  > {
    const message = JSON.parse(raw) as EventSubMessage;
    const { message_id: id, message_type: type } = message.metadata;
    if (seen.includes(id)) return { kind: 'other' };
    seen.push(id);
    if (seen.length > dedupeSize) seen.shift();

    switch (type) {
      case 'session_welcome': {
        const session = message.payload.session!;
        if (fresh) await handlers.subscribe(session.id);
        return {
          kind: 'welcome',
          keepaliveSeconds: session.keepalive_timeout_seconds ?? 10,
        };
      }
      case 'session_reconnect':
        return {
          kind: 'reconnect',
          url: message.payload.session!.reconnect_url!,
        };
      case 'notification':
        await handlers.notification(
          message.metadata.subscription_type!,
          message.payload.event ?? {},
          id,
          message.metadata.message_timestamp ?? new Date().toISOString(),
        );
        return { kind: 'other' };
      case 'revocation':
        log('[eventsub] subscription revoked', message.payload.subscription);
        handlers.revocation?.(
          message.payload.subscription?.type ?? '',
          message.payload.subscription?.status ?? 'unknown',
        );
        return { kind: 'other' };
      default:
        return { kind: 'other' };
    }
  };
}

/**
 * Keeps one EventSub session alive forever. Any unexpected close reconnects from scratch. `connected()`: a session is
 * welcomed and open (the health the bot reports to Core).
 */
export function runEventSub(handlers: EventSubHandlers): {
  stop(): void;
  connected(): boolean;
} {
  let stopped = false;
  let welcomed: WebSocket | null = null;
  const sockets = new Set<WebSocket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function stop() {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const socket of sockets) socket.close();
    sockets.clear();
  }
  const route = createEventSubRouter({
    ...handlers,
    revocation(type, status) {
      stop();
      handlers.revocation?.(type, status);
    },
  });
  const log = handlers.log ?? console.log;

  const connect = (url: string, fresh: boolean, previous?: WebSocket) => {
    if (stopped) return;
    const socket = new WebSocket(url);
    sockets.add(socket);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let replaced = false;
    let keepaliveSeconds = 10;
    const arm = () => {
      clearTimeout(watchdog);
      if (watchdog) timers.delete(watchdog);
      if (stopped) return;
      watchdog = setTimeout(
        () => socket.close(),
        (keepaliveSeconds + 5) * 1000,
      );
      timers.add(watchdog);
    };

    socket.onmessage = async (ev) => {
      if (stopped) return;
      try {
        const result = await route(String(ev.data), fresh);
        if (stopped) return;
        if (result.kind === 'welcome') {
          welcomed = socket;
          previous?.close();
          keepaliveSeconds = result.keepaliveSeconds;
        }
        arm();
        if (result.kind === 'reconnect') {
          replaced = true;
          connect(result.url, false, socket); // subscriptions carry over
        }
      } catch (error) {
        // Subscription failure or malformed frame: start over with a fresh session.
        log('[eventsub] message handling failed, reconnecting', error);
        socket.close();
      }
    };
    socket.onclose = () => {
      clearTimeout(watchdog);
      if (watchdog) timers.delete(watchdog);
      sockets.delete(socket);
      if (welcomed === socket) welcomed = null;
      if (stopped || replaced) return;
      log('[eventsub] connection closed, reconnecting in 5s');
      const timer = setTimeout(() => {
        timers.delete(timer);
        connect(EVENTSUB_URL, true);
      }, 5000);
      timers.add(timer);
    };
  };

  connect(EVENTSUB_URL, true);
  return { stop, connected: () => !stopped && welcomed !== null };
}
