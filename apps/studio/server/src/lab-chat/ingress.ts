import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  LAB_CHANNEL_ID,
  type LabCoreCall,
  STUDIO_ACTOR,
} from '../lab-moderation/proxy.js';

// Lab chat ingress in Studio — ONE Twitch chat connection for the whole Lab, not a Tombola feature.
// Its switch (OFF by default, never turned on automatically) starts the bot's Lab chat adapter, which
// forwards the chat commands to POST /v1/lab/chat and the stream state to POST /v1/lab/stream; Core
// routes them to the Lab modules (Tombola today; TTS !canceltts, global commands, moderation test
// commands later). The chat simulator posts to the same Core entry. A new module never adds a
// second EventSub connection, token or process here.

/** Scope the adapter needs to read the chat (EventSub channel.chat.message). */
export const CHAT_READ_SCOPE = 'user:read:chat';
/** Scope LeCroupier_ needs to send the Commands V2 answers (Send Chat Message). */
export const CHAT_WRITE_SCOPE = 'user:write:chat';
const OUTPUT_SCOPE_MISSING = `Le jeton Twitch du bot n'a pas le droit d'écrire dans le chat (scope ${CHAT_WRITE_SCOPE} manquant). Ajoute LAB_CHAT_OUTPUT=true dans apps/twitch-bot/.env, puis relance « npm run twitch:auth -w apps/twitch-bot » (il doit afficher « … user:write:chat moderator:manage:announcements »).`;

/** The bot's Lab chat adapter, as a managed child process (injectable for tests). */
export interface IngressProcess {
  readonly running: boolean;
  readonly lastExit: { code: number | null; at: string } | null;
  start(env: Record<string, string>): void;
  stop(): Promise<void> | void;
  /** Takes back an adapter left running by a previous Studio session (stored PID, node only). */
  adoptPrevious?(): Promise<boolean>;
}

export interface LabChatIngressDeps {
  core: LabCoreCall;
  origin: string;
  /** Studio data folder of the ingress (its switch). */
  dir: string;
  /** Lab identities the chat simulator can speak as (fictitious viewers + linked Twitch account). */
  identities: () => { id: string; label: string; login?: string }[];
  process?: IngressProcess;
  /** Environment of the adapter process (Lab Core URL / secret / channel). */
  env?: () => Record<string, string>;
  /** Bot token summary (never the token itself): owner and scopes. */
  token?: () => { present: boolean; login: string | null; scopes: string[] };
  /** Missing local prerequisite (bot .env, built adapter), or null. */
  prerequisite?: () => 'bot_env_missing' | 'bot_not_built' | null;
  /** The Test Lab bot already reads Twitch with the same token. */
  botRunning?: () => boolean;
  /** Last log lines of the adapter process (redacted). */
  lines?: () => string[];
}

/** Exit code of the bot's Lab chat adapter when its Twitch token is unusable (needs the user). */
export const EXIT_AUTH = 78;
/** Supervision: an adapter that exits on its own is restarted at most this often, then left down. */
const RESTART_BUDGET = 3;
const RESTART_WINDOW_MS = 10 * 60_000;
const SUPERVISE_MS = 5_000;

/** Why an adapter switched ON is down and no longer restarted (shown as is in Studio). */
type DownCode = 'auth_failed' | 'crash_loop';
const DOWN_FR: Record<DownCode, string> = {
  auth_failed:
    'L’ingestion s’est arrêtée : le jeton Twitch du bot est refusé. Relance « npm run twitch:auth -w apps/twitch-bot », puis désactive et réactive l’ingestion.',
  crash_loop:
    'L’ingestion s’arrête en boucle (3 redémarrages en 10 min) : voir le journal ci-dessous, puis désactive et réactive l’ingestion.',
};

export type BlockedCode =
  | 'unavailable'
  | 'bot_env_missing'
  | 'bot_not_built'
  | 'no_token'
  | 'missing_scope'
  | 'bot_running';

/** Why the switch cannot be turned on — shown as is in Studio. */
const BLOCKED_FR: Record<BlockedCode, string> = {
  unavailable: 'Ingestion indisponible : Core Lab non démarré.',
  bot_env_missing:
    'Configuration du bot absente (apps/twitch-bot/.env) : lance le Labo de test une fois pour la créer.',
  bot_not_built:
    'Adaptateur du bot non compilé : lance « npm run build -w apps/twitch-bot ».',
  no_token:
    'Aucun jeton Twitch pour le bot : lance « npm run twitch:auth -w apps/twitch-bot ».',
  missing_scope: `Le jeton Twitch du bot n'a pas le droit de lire le chat (scope ${CHAT_READ_SCOPE} manquant). Ajoute LAB_CHAT_INGEST=true dans apps/twitch-bot/.env, puis relance « npm run twitch:auth -w apps/twitch-bot » (il doit afficher « Scopes requested: user:read:chat … »).`,
  bot_running:
    'Le bot du Labo de test est déjà connecté à Twitch avec ce jeton : arrête-le avant d’activer l’ingestion.',
};

export class LabChatIngress {
  private constructor(
    private readonly d: LabChatIngressDeps,
    private enabled: boolean,
  ) {}

  static async create(d: LabChatIngressDeps) {
    await mkdir(d.dir, { recursive: true });
    let enabled = false;
    try {
      enabled =
        JSON.parse(await readFile(join(d.dir, 'ingress.json'), 'utf8'))
          .enabled === true;
    } catch {
      /* OFF by default */
    }
    // An adapter orphaned by a Studio that died (children survive on Windows) still reads Twitch with
    // the previous session's secret: stopped before anything starts, so only ONE ingestion ever runs.
    if (await d.process?.adoptPrevious?.()) await d.process!.stop();
    const ingress = new LabChatIngress(d, enabled);
    ingress.watch = setInterval(() => ingress.supervise(), SUPERVISE_MS);
    ingress.watch.unref();
    return ingress;
  }

  private watch: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private restarts: number[] = [];
  private down: DownCode | null = null;

  /**
   * The switch ON means the adapter runs: one that exited on its own is restarted (bounded budget).
   * A refused token, or a crash loop, leaves it down with the reason shown until the user acts. The
   * user's OFF and the Studio shutdown never restart it.
   */
  supervise(now = Date.now()) {
    const p = this.d.process;
    if (this.closed || !this.enabled || this.down || !p || p.running) return;
    if (!p.lastExit || this.blocked()) return;
    if (p.lastExit.code === EXIT_AUTH) {
      this.down = 'auth_failed';
      return;
    }
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restarts.length >= RESTART_BUDGET) {
      this.down = 'crash_loop';
      return;
    }
    this.restarts.push(now);
    p.start(this.d.env!());
  }

  /** First reason preventing the adapter from running, or null. */
  blocked(): BlockedCode | null {
    if (!this.d.process || !this.d.env) return 'unavailable';
    const pre = this.d.prerequisite?.();
    if (pre) return pre;
    const token = this.d.token?.();
    if (token && !token.present) return 'no_token';
    if (token && !token.scopes.includes(CHAT_READ_SCOPE))
      return 'missing_scope';
    if (this.d.botRunning?.()) return 'bot_running';
    return null;
  }

  private writeScope() {
    return this.d.token?.().scopes.includes(CHAT_WRITE_SCOPE) ?? false;
  }

  /** Restarts the adapter if the switch was left ON (Studio restart) and nothing blocks it. */
  start() {
    if (this.enabled && !this.blocked() && !this.d.process!.running)
      this.d.process!.start(this.d.env!());
  }
  async stop() {
    this.closed = true;
    clearInterval(this.watch);
    await this.d.process?.stop();
  }

  status() {
    const code = this.blocked();
    const down = this.enabled && !code ? this.down : null;
    const token = this.d.token?.();
    return {
      enabled: this.enabled,
      running: this.d.process?.running ?? false,
      blocked: code
        ? { code, message: BLOCKED_FR[code] }
        : down
          ? { code: down, message: DOWN_FR[down] }
          : null,
      token_login: token?.login ?? null,
      last_exit: this.d.process?.lastExit ?? null,
      lines: this.d.lines?.().slice(-12) ?? [],
    };
  }

  /** The switch. Turning it on while something blocks it is refused (nothing is saved). */
  async setEnabled(enabled: boolean) {
    const code = enabled ? this.blocked() : null;
    if (code)
      throw Object.assign(new Error(code), {
        status: 409,
        body: { error: code, message: BLOCKED_FR[code] },
      });
    this.enabled = enabled;
    // A user OFF / ON is the action a down adapter was waiting for: supervision starts afresh.
    this.down = null;
    this.restarts = [];
    await writeFile(
      join(this.d.dir, 'ingress.json'),
      JSON.stringify({ enabled }),
    );
    if (enabled) this.start();
    else await this.d.process?.stop();
    return this.status();
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/lab-chat/')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    const origin = new URL(this.d.origin);
    if (
      req.headers.host !== origin.host ||
      (req.headers.origin && req.headers.origin !== this.d.origin) ||
      req.headers['x-raptoru-studio'] !== '1'
    ) {
      reply(403, { error: 'forbidden' });
      return true;
    }
    try {
      await this.api(req, url, reply);
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      reply(err.status ?? 503, {
        ...(err.body ?? {}),
        error: err.body?.error ?? err.message,
      });
    }
    return true;
  }

  private async api(
    req: IncomingMessage,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const p = url.pathname.slice('/api/lab-chat'.length);
    const get = req.method === 'GET';
    if (get && p === '/status') return reply(200, this.status());
    if (get && p === '/identities')
      return reply(200, { identities: this.d.identities() });
    // Commands V2 « Sortie chat réelle » (OFF by default; Core holds it) and the step debug view.
    const commands = `/v1/lab/commands/${LAB_CHANNEL_ID}`;
    if (get && p === '/output')
      return reply(200, {
        ...(await this.d.core<Record<string, unknown>>(`${commands}/output`)),
        write_scope: this.writeScope(),
        ingress_running: this.d.process?.running ?? false,
      });
    if (get && p === '/steps') {
      const status = url.searchParams.get('status');
      return reply(
        200,
        await this.d.core(
          `${commands}/steps${status && /^[a-z]{1,16}$/.test(status) ? `?status=${status}` : ''}`,
        ),
      );
    }
    // Studio « Simulation » chat: the last messages Core received (simulator and real chat), read only.
    if (get && p === '/recent')
      return reply(
        200,
        await this.d.core(`/v1/lab/chat/${LAB_CHANNEL_ID}/recent`),
      );
    if (get) return reply(404, { error: 'not_found' });
    const json = JSON.parse(
      (await readBody(req, 16 * 1024)).toString('utf8') || '{}',
    ) as Record<string, unknown>;
    if (p === '/ingress')
      return reply(200, await this.setEnabled(json.enabled === true));
    if (p === '/output') {
      const enabled = json.enabled === true;
      if (enabled && !this.writeScope())
        return reply(409, {
          error: 'missing_write_scope',
          message: OUTPUT_SCOPE_MISSING,
        });
      const before = await this.d.core<{ enabled?: boolean }>(
        `${commands}/output`,
      );
      const out = await this.d.core<Record<string, unknown>>(
        `${commands}/output`,
        { actor: STUDIO_ACTOR, enabled },
      );
      // OFF → ON while the adapter runs: restart it so it reloads the token (its scopes are read at
      // start — a re-authorization made while it ran would leave it without executor).
      let restarted = false;
      if (enabled && before.enabled !== true && this.d.process?.running) {
        await this.d.process.stop();
        this.start();
        restarted = this.d.process.running;
      }
      return reply(200, { ...out, adapter_restarted: restarted });
    }
    if (p === '/simulate') {
      // Lab chat simulator: same Core entry as the real chat, routed to every Lab module.
      const viewer = String(json.viewer_id ?? '');
      const role = ['viewer', 'moderator', 'broadcaster'].includes(
        String(json.role),
      )
        ? String(json.role)
        : 'viewer';
      return reply(
        200,
        await this.d.core('/v1/lab/chat', {
          channel_id: LAB_CHANNEL_ID,
          message_id: `sim-${Date.now()}-${randomBytes(4).toString('hex')}`,
          text: String(json.text ?? '').slice(0, 500),
          chatter: {
            id: viewer,
            login: String(json.login ?? viewer).slice(0, 64),
            display_name: String(json.display_name ?? viewer).slice(0, 64),
            role,
          },
          source: 'simulator',
        }),
      );
    }
    reply(404, { error: 'not_found' });
  }
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max)
      throw Object.assign(new Error('body_too_large'), {
        status: 413,
        body: { error: 'body_too_large' },
      });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
