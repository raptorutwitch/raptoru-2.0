import { createHash, randomUUID } from 'node:crypto';

/** Delays between reconnection attempts (the last one repeats). */
export const OBS_RETRY_MS = [1000, 2000, 5000, 10_000];
/** obs-websocket v5 close code: wrong password. */
const AUTHENTICATION_FAILED = 4009;

// Minimal read-only obs-websocket v5 client. No scene/source mutation and no streaming controls.
// Protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
// Bonk VNext lot 0: a lost or not yet available OBS is retried until `disconnect()` (memory only:
// the password is never written by this class). A refused password stops the retries.
export class LabObs {
  private socket: WebSocket | null = null;
  connected = false;
  /** Last connection failure (status display); null once connected. */
  error: string | null = null;
  private target: { port: number; password: string } | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private generation = 0;
  private pending = new Map<
    string,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();

  /** A connection is wanted but not established (OBS closed, restarting…). */
  get reconnecting() {
    return this.target !== null && !this.connected;
  }

  /** Explicit disconnection: no reconnection afterwards. */
  disconnect() {
    this.target = null;
    this.error = null;
    this.generation += 1;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.drop();
  }

  private drop() {
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    for (const p of this.pending.values()) p.reject(new Error('obs_offline'));
    this.pending.clear();
  }

  /** Connects and keeps the connection: the first failure is thrown, the retries continue. */
  async connect(port: number, password: string) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('invalid_obs_port');
    this.disconnect();
    this.target = { port, password };
    this.attempt = 0;
    await this.tryOpen();
  }

  private async tryOpen() {
    const target = this.target;
    if (!target) return;
    const generation = ++this.generation;
    try {
      await this.open(target.port, target.password);
      this.error = null;
      this.attempt = 0;
    } catch (e) {
      // A newer attempt or a disconnect took over: this one decides nothing.
      if (generation !== this.generation) throw e;
      this.error = (e as Error).message;
      if (this.error === 'obs_auth_failed') this.target = null;
      else this.schedule();
      throw e;
    }
  }

  private schedule() {
    if (!this.target || this.retry) return;
    const delay = OBS_RETRY_MS[Math.min(this.attempt, OBS_RETRY_MS.length - 1)];
    this.attempt += 1;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.tryOpen().catch(() => {});
    }, delay);
  }

  private open(port: number, password: string) {
    this.drop();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket = ws;
    let identified = false;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail('obs_connect_timeout'), 5000);
      const fail = (code: string) => {
        clearTimeout(timer);
        if (this.socket === ws) this.drop();
        reject(new Error(code));
      };
      // Once identified, a socket error is followed by `close`, which reconnects.
      ws.addEventListener(
        'error',
        () => {
          if (!identified) fail('obs_offline_or_auth_failed');
        },
        { once: true },
      );
      ws.addEventListener(
        'close',
        (event) => {
          if (!identified)
            return fail(
              (event as CloseEvent).code === AUTHENTICATION_FAILED
                ? 'obs_auth_failed'
                : 'obs_offline_or_auth_failed',
            );
          // Established connection lost (OBS closed or restarted): reconnect.
          if (this.socket !== ws) return;
          this.drop();
          this.error = 'obs_offline';
          this.attempt = 0;
          this.schedule();
        },
        { once: true },
      );
      ws.addEventListener('message', (event) => {
        try {
          const packet = JSON.parse(String(event.data));
          if (packet.op === 0) {
            const auth = packet.d.authentication;
            const hash = (s: string) =>
              createHash('sha256').update(s).digest('base64');
            ws.send(
              JSON.stringify({
                op: 1,
                d: {
                  rpcVersion: 1,
                  eventSubscriptions: 0,
                  ...(auth
                    ? {
                        authentication: hash(
                          hash(password + auth.salt) + auth.challenge,
                        ),
                      }
                    : {}),
                },
              }),
            );
          } else if (packet.op === 2) {
            clearTimeout(timer);
            identified = true;
            this.connected = true;
            resolve();
          } else if (packet.op === 7) {
            const p = this.pending.get(packet.d.requestId);
            this.pending.delete(packet.d.requestId);
            if (packet.d.requestStatus.result)
              p?.resolve(packet.d.responseData ?? {});
            else p?.reject(new Error('obs_request_failed'));
          }
        } catch {
          if (!identified) fail('obs_offline_or_auth_failed');
        }
      });
    });
  }

  async request(
    requestType: string,
    requestData: object,
  ): Promise<Record<string, unknown>> {
    if (!this.connected || !this.socket) throw new Error('obs_offline');
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('obs_request_timeout'));
      }, 3000);
      this.pending.set(requestId, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.socket!.send(
        JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }),
      );
    });
  }

  async sourceReady(overlayUrl: string): Promise<boolean> {
    if (!this.connected) return false;
    try {
      const input = await this.request('GetInputSettings', {
        inputName: 'Raptoru Bonk Lab',
      });
      const settings = input.inputSettings as Record<string, unknown>;
      const active = await this.request('GetSourceActive', {
        sourceName: 'Raptoru Bonk Lab',
      });
      return (
        input.inputKind === 'browser_source' &&
        settings.url === overlayUrl &&
        Number(settings.width) === 1920 &&
        Number(settings.height) === 1080 &&
        active.videoActive === true
      );
    } catch {
      return false;
    }
  }
}
