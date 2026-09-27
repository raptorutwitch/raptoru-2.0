import { createHash, randomUUID } from 'node:crypto';

// Minimal read-only obs-websocket v5 client. No scene/source mutation and no streaming controls.
// Protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
export class LabObs {
  private socket: WebSocket | null = null;
  connected = false;
  private pending = new Map<
    string,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();

  disconnect() {
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    for (const p of this.pending.values()) p.reject(new Error('obs_offline'));
    this.pending.clear();
  }

  async connect(port: number, password: string) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('invalid_obs_port');
    this.disconnect();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('obs_connect_timeout'));
      }, 5000);
      const fail = () => {
        clearTimeout(timer);
        if (this.socket === ws) this.disconnect();
        reject(new Error('obs_offline_or_auth_failed'));
      };
      ws.addEventListener('error', fail, { once: true });
      ws.addEventListener('close', fail, { once: true });
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
          fail();
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
