import { createServer, type Server } from 'node:http';
import type { BonkLabCatalog, BonkLabViewer } from '@raptoru/schemas';
import type { CoreCall } from './worker.js';

/** Twitch emotes state of a viewer (same values as /v1/ext/emotes `twitch_status`). */
export type TwitchEmotesStatus =
  'not_linked' | 'syncing' | 'ready' | 'stale' | 'reauth_required';

// Twitch viewer connection for the Bonk Lab. Studio only relays the OAuth redirect to Core: the code
// is exchanged by Core (which holds the app secret) and the token never reaches Studio, the extension
// or OBS. The loopback listener on the already-registered redirect (localhost:3789/callback) only
// exists while a connection is pending.

export const CALLBACK_PORT = 3789;
const LISTEN_MS = 10 * 60_000;

const page = (title: string, text: string) =>
  `<!doctype html><html lang="fr"><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;background:#111317;color:#e6e8eb;padding:40px">
<h2>${title}</h2><p>${text}</p></body></html>`;

export class ViewerAuth {
  private servers: Server[] = [];
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  lastResult: { ok: boolean; message: string } | null = null;
  /** Bumped when a viewer gets linked: consumers drop their cached link state at once. */
  generation = 0;

  constructor(
    private readonly core: CoreCall,
    private readonly port = CALLBACK_PORT,
  ) {}

  /** Twitch authorize URL (built by Core); opens the callback listener. */
  async start(): Promise<{ authorization_url: string }> {
    const result = await this.core<{ authorization_url: string }>(
      '/v1/lab/bonk/viewer-auth/start',
      {},
    );
    await this.listen();
    return result;
  }

  /** The Lab viewer's emotes: same states / cache as the public frontier (Core emotesState). */
  emotes(refresh = false) {
    return this.core<{
      status: TwitchEmotesStatus;
      viewer: { user_id: string; login: string; display_name: string } | null;
      catalog: BonkLabCatalog | null;
    }>(
      `/v1/lab/bonk/viewer-emotes${refresh ? '?refresh=1' : ''}`,
      undefined,
      // A forced reload waits up to 6 s in Core, then answers with the stored catalog.
      { timeoutMs: refresh ? 10_000 : 4_000 },
    );
  }

  viewers() {
    return this.core<{ viewers: BonkLabViewer[] }>('/v1/lab/bonk/viewers');
  }

  catalog(userId: string, refresh = false) {
    return this.core<BonkLabCatalog>(
      `/v1/lab/bonk/viewers/${encodeURIComponent(userId)}/catalog${refresh ? '?refresh=1' : ''}`,
      undefined,
      // A full Get User Emotes reload (all pages + owners) takes several seconds for a viewer with
      // many subscriptions (~7 s measured for 1141 emotes): far above the default 4 s.
      { timeoutMs: 30_000 },
    );
  }

  disconnect(userId: string) {
    return this.core<{ disconnected: boolean }>(
      `/v1/lab/bonk/viewers/${encodeURIComponent(userId)}/disconnect`,
      {},
    );
  }

  stop() {
    clearTimeout(this.closeTimer);
    for (const s of this.servers) s.close();
    this.servers = [];
  }

  private async listen() {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.stop(), LISTEN_MS);
    this.closeTimer.unref?.();
    if (this.servers.length) return;
    const handler = async (
      req: import('node:http').IncomingMessage,
      res: import('node:http').ServerResponse,
    ) => {
      const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
      const reply = (status: number, title: string, text: string) => {
        res.writeHead(status, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'none'; style-src 'unsafe-inline'",
          'referrer-policy': 'no-referrer',
        });
        res.end(page(title, text));
      };
      if (req.method !== 'GET' || url.pathname !== '/callback')
        return reply(404, 'Introuvable', '');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        this.lastResult = {
          ok: false,
          message: url.searchParams.get('error') ?? 'refusé',
        };
        return reply(
          400,
          'Connexion Twitch annulée',
          'Aucune autorisation n’a été donnée. Tu peux fermer cette fenêtre.',
        );
      }
      try {
        const { viewer } = await this.core<{ viewer: BonkLabViewer }>(
          '/v1/lab/bonk/viewer-auth/complete',
          { code, state },
        );
        this.lastResult = { ok: true, message: viewer.display_name };
        this.generation++;
        reply(
          200,
          'Connexion Twitch réussie',
          `Compte : ${viewer.display_name}. Tu peux fermer cette fenêtre et revenir au Lab.`,
        );
        this.stop();
      } catch (error) {
        this.lastResult = { ok: false, message: (error as Error).message };
        reply(
          400,
          'Connexion Twitch refusée',
          `Raison : ${(error as Error).message.replace(/[<>&]/g, '')}`,
        );
      }
    };
    // Browsers may resolve localhost to IPv4 or IPv6: listen on both loopbacks.
    for (const host of ['127.0.0.1', '::1']) {
      const server = createServer((req, res) => void handler(req, res));
      await new Promise<void>((resolve, reject) => {
        server.once('error', (e: NodeJS.ErrnoException) =>
          host === '::1' && e.code !== 'EADDRINUSE' ? resolve() : reject(e),
        );
        server.listen(this.port, host, () => resolve());
      }).then(
        () => {
          if (server.listening) this.servers.push(server);
        },
        (e: Error) => {
          this.stop();
          throw new Error(`oauth_callback_port_busy: ${e.message}`);
        },
      );
    }
  }
}
