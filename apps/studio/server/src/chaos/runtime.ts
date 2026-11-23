import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CHAOS_COMMANDS,
  chaosEffectRequestSchema,
  type ChaosEvent,
} from '@raptoru/schemas';
import {
  ChaosEngineClient,
  ChaosError,
  type ChaosEngineOptions,
} from './engine-client.js';

// Studio › Chaos (docs/chaos/ARCHITECTURE_MOTEUR.md) : l'API locale de la page Chaos. Elle ne décide rien : elle relaie
// au moteur (démarré à la première demande, puis gardé tant que Studio tourne) et garde les derniers événements pour
// l'affichage. Les tests locaux portent la source « studio » ; aucune transaction, aucun Jeton, aucune récompense.

const RECENT = 60;
const STATUS: Record<string, number> = {
  engine_absent: 503,
  engine_not_ready: 503,
  engine_unavailable: 503,
  engine_exited: 503,
  engine_timeout: 504,
  invalid_request: 400,
};

export class ChaosRuntime {
  readonly client: ChaosEngineClient;
  private readonly recent: ChaosEvent[] = [];
  private telemetry: ChaosEvent | null = null;
  private registry: Record<string, unknown> | null = null;

  constructor(o: ChaosEngineOptions) {
    this.client = new ChaosEngineClient(o);
    this.client.on('event', (e: ChaosEvent) => {
      if (e.event === 'engine.telemetry') this.telemetry = e;
      else {
        this.recent.push(e);
        if (this.recent.length > RECENT) this.recent.shift();
      }
    });
  }

  stop() {
    return this.client.stop();
  }

  private async describe() {
    this.registry ??= await this.client.call('describe');
    return this.registry;
  }

  /**
   * Compatibilité Studio ↔ moteur : les commandes que la page utilise et que le moteur en marche ne sert pas (moteur
   * plus ancien que Studio). Vide = compatible. Un moteur trop ancien pour annoncer ses commandes manque de tout ce
   * qui est apparu avec cette annonce (catalogue d'effets du 23/11).
   */
  missingCommands(): string[] {
    const hello = this.client.state.hello;
    if (!hello) return [];
    const served = Array.isArray(hello.commands)
      ? (hello.commands as string[])
      : CHAOS_COMMANDS.filter(
          (c) => c !== 'effect.activate' && c !== 'effect.stop',
        );
    return CHAOS_COMMANDS.filter((c) => !served.includes(c));
  }

  /** L'état complet pour la page : moteur, registre, état courant, mesures, derniers événements. */
  async state() {
    const engine = {
      ...this.client.state,
      available: this.client.available(),
      exe_hint: 'apps/chaos-engine/build.cmd',
      missing_commands: this.missingCommands(),
    };
    if (this.client.state.status === 'absent')
      return {
        engine,
        registry: null,
        status: null,
        telemetry: null,
        events: [],
      };
    try {
      const [registry, status] = await Promise.all([
        this.describe(),
        this.client.call('status'),
      ]);
      return {
        engine: { ...engine, ...this.client.state },
        registry,
        status,
        telemetry: this.telemetry,
        events: this.recent.slice(-30),
      };
    } catch (e) {
      return {
        engine: { ...engine, lastError: (e as Error).message },
        registry: this.registry,
        status: null,
        telemetry: this.telemetry,
        events: this.recent.slice(-30),
      };
    }
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/chaos/')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1')
      return (reply(403, { error: 'forbidden' }), true);
    const route = `${req.method} ${url.pathname.slice('/api/chaos'.length)}`;
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const c = this.client;
      switch (route) {
        case 'GET /state':
          return (reply(200, await this.state()), true);
        case 'GET /targets':
          return (reply(200, await c.call('targets.list')), true);
        case 'GET /screens':
          return (
            reply(200, await c.call('targets.list', { windows: false })),
            true
          );
        case 'GET /diagnostics':
          return (reply(200, await c.call('diagnostics')), true);
        case 'POST /test': {
          // Un essai local depuis Studio : même chemin qu'une future demande du Core (registre, validation, file).
          const parsed = chaosEffectRequestSchema.safeParse({
            ...body,
            request_id: `studio-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
            source: { kind: 'studio', ref: 'Studio › Chaos › Tester' },
          });
          if (!parsed.success)
            return (
              reply(400, {
                error: 'invalid_request',
                message: parsed.error.issues
                  .map((i) => `${i.path.join('.')} : ${i.message}`)
                  .join(' ; '),
              }),
              true
            );
          return (
            reply(200, await c.call('effect.request', parsed.data)),
            true
          );
        }
        case 'POST /activate': {
          // Fiche d'un effet : « Tester » (essai court) ou « Activer » (durée réglée), avec SES réglages enregistrés
          // dans le moteur (écran, préréglage). Source « studio » : aucun Jeton, aucun point de chaîne.
          const effect = typeof body.effect === 'string' ? body.effect : '';
          const kind = body.kind === 'test' ? 'test' : 'manual';
          if (!/^[a-z][a-z0-9_.]{0,40}$/.test(effect))
            return (
              reply(400, {
                error: 'invalid_request',
                message: 'effet invalide',
              }),
              true
            );
          return (
            reply(
              200,
              await c.call('effect.activate', {
                effect,
                kind,
                request_id: `studio-${kind}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
                source: {
                  kind: 'studio',
                  ref: `Studio › Chaos › ${kind === 'test' ? 'Tester' : 'Activer'}`,
                },
              }),
            ),
            true
          );
        }
        case 'POST /stop':
          return (
            reply(
              200,
              await c.call('effect.stop', {
                effect: String(body.effect ?? ''),
              }),
            ),
            true
          );
        case 'POST /cancel':
          return (
            reply(
              200,
              await c.call('effect.cancel', {
                request_id: String(body.request_id ?? ''),
                immediate: body.immediate === true,
              }),
            ),
            true
          );
        case 'POST /stop-all':
          return (
            reply(200, await c.call('stop_all', { reason: 'studio_stop_all' })),
            true
          );
        case 'POST /config':
          return (
            reply(
              200,
              await c.call('config.set', {
                section: body.section,
                values: body.values,
              }),
            ),
            true
          );
        case 'POST /config/reset':
          return (
            reply(
              200,
              await c.call('config.reset', { section: body.section ?? null }),
            ),
            true
          );
        case 'POST /preset':
          return (
            reply(
              200,
              await c.call('preset.set', {
                effect: body.effect,
                name: body.name ?? 'default',
                value: body.value,
              }),
            ),
            true
          );
        case 'POST /engine/restart':
          await c.stop();
          this.registry = null;
          c.start();
          await c.ready();
          return (reply(200, { engine: c.state }), true);
      }
      return (reply(404, { error: 'not_found' }), true);
    } catch (e) {
      const code = e instanceof ChaosError ? e.code : 'internal';
      return (
        reply(STATUS[code] ?? 409, {
          error: code,
          message: (e as Error).message,
        }),
        true
      );
    }
  }
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024)
      throw new ChaosError('invalid_request', 'corps trop grand');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    throw new ChaosError('invalid_request', 'JSON illisible');
  }
}
