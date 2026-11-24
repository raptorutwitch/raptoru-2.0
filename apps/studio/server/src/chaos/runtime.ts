import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
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
import {
  liveCsv,
  offscreenCsv,
  PerfError,
  PerfLab,
  reportHtml,
} from './perf.js';
import type { ObsLike } from '../channel-points/obs-actions.js';
import { ChaosObsError, ChaosObsOutput } from './obs-output.js';
import { PreviewError, renderPreview } from './preview.js';

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
  obs_offline: 503,
};

export class ChaosRuntime {
  readonly client: ChaosEngineClient;
  /** Chaos Performance Lab (perf.ts) : banc hors écran et mesures en jeu, pilotés depuis la page Chaos. */
  readonly perf: PerfLab;
  private readonly recent: ChaosEvent[] = [];
  private telemetry: ChaosEvent | null = null;
  private registry: Record<string, unknown> | null = null;

  /** Diffusion OBS (mode C, docs/chaos/MODE_C.md) : la sortie OBS des activations, sur la connexion OBS de Studio. */
  readonly obsOut: ChaosObsOutput;

  constructor(
    private readonly opts: ChaosEngineOptions & {
      /** La seule connexion OBS de Studio (celle du Bonk) ; absente : diffusion OBS indisponible. */
      obs?: () => ObsLike | null;
    },
  ) {
    const o = opts;
    this.client = new ChaosEngineClient(o);
    this.obsOut = new ChaosObsOutput(
      join(o.stateDir, 'obs-output.json'),
      o.obs ?? (() => null),
      (cmd, args) =>
        this.client.call(
          cmd as Parameters<ChaosEngineClient['call']>[0],
          args as Record<string, unknown>,
        ),
      o.log,
    );
    void this.obsOut.load().then(() => this.obsOut.start());
    this.client.on('exit', () => this.obsOut.onEngineExit());
    this.perf = new PerfLab(o.exe, o.stateDir, (cmd, args) =>
      this.client.call(cmd as Parameters<ChaosEngineClient['call']>[0], args),
    );
    this.client.on('event', (e: ChaosEvent) => {
      if (e.event === 'engine.telemetry') {
        this.telemetry = e;
        this.perf.onTelemetry(e as unknown as Record<string, unknown>);
      } else {
        this.obsOut.onEngineEvent(e as unknown as Record<string, unknown>);
        this.recent.push(e);
        if (this.recent.length > RECENT) this.recent.shift();
      }
    });
  }

  /** Studio se ferme : filtres Chaos V2 coupés (au plus 1,5 s d'attente), puis le moteur. */
  async stop() {
    this.perf.stop();
    this.obsOut.stop();
    await Promise.race([
      this.obsOut.disableAll('Studio se ferme').catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
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
        obs: this.obsOut.config.mode,
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
          // Une seule commande pour les deux sorties : le moteur tient la session (écran et/ou OBS).
          const out = await this.obsOut.outputsFor(effect);
          const result = (await c.call('effect.activate', {
            effect,
            kind,
            request_id: `studio-${kind}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
            source: {
              kind: 'studio',
              ref: `Studio › Chaos › ${kind === 'test' ? 'Tester' : 'Activer'}`,
            },
            outputs: out.outputs,
            ...(out.obs ? { obs: out.obs } : {}),
          })) as Record<string, unknown>;
          return (
            reply(200, {
              ...result,
              obs_output: {
                mode: this.obsOut.config.mode,
                outputs: out.outputs,
                note: out.note ?? null,
              },
            }),
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
        case 'POST /stop-all': {
          // STOP ALL : le calque d'abord (moteur), et les filtres Chaos V2 d'OBS en même temps, sans attendre d'événement.
          const [engine, obs] = await Promise.allSettled([
            c.call('stop_all', { reason: 'studio_stop_all' }),
            this.obsOut.disableAll('STOP ALL'),
          ]);
          if (engine.status === 'rejected') throw engine.reason;
          return (
            reply(200, {
              ...(engine.value as Record<string, unknown>),
              obs:
                obs.status === 'fulfilled'
                  ? obs.value
                  : { error: obsMessage(obs.reason) },
            }),
            true
          );
        }
        case 'GET /obs':
          return (
            reply(200, await this.obsOut.status(url.searchParams.has('force'))),
            true
          );
        case 'POST /obs/config':
          return (
            reply(200, {
              config: await this.obsOut.setConfig({
                ...(body.mode !== undefined
                  ? { mode: body.mode as 'screen' }
                  : {}),
                ...(body.source !== undefined
                  ? { source: body.source as string | null }
                  : {}),
                ...(body.device !== undefined
                  ? { device: body.device as string | null }
                  : {}),
              }),
              status: await this.obsOut.status(true),
            }),
            true
          );
        case 'GET /obs/preview':
          return (reply(200, await this.obsOut.preview()), true);
        case 'POST /obs/prepare':
          if (body.confirm !== true)
            return (
              reply(400, {
                error: 'invalid_request',
                message: 'confirmation obligatoire',
              }),
              true
            );
          return (
            reply(
              200,
              await this.obsOut.prepare(
                join(this.opts.stateDir, 'obs-backups'),
              ),
            ),
            true
          );
        case 'POST /obs/disable-all':
          return (
            reply(200, await this.obsOut.disableAll('coupure depuis Studio')),
            true
          );
        case 'POST /obs/remove':
          if (body.confirm !== true)
            return (
              reply(400, {
                error: 'invalid_request',
                message: 'confirmation obligatoire',
              }),
              true
            );
          return (reply(200, await this.obsOut.remove()), true);
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
        case 'POST /preview':
          // Aperçu animé de la fiche : processus court et séparé, hors écran (preview.ts).
          return (
            reply(
              200,
              await renderPreview(
                this.opts.exe,
                this.opts.stateDir,
                String(body.effect ?? ''),
                typeof body.variant === 'string' ? body.variant : null,
                body.preset ?? {},
              ),
            ),
            true
          );
        case 'GET /perf':
          return (
            reply(200, {
              system: await this.perf.sysinfo().catch(() => null),
              ...this.perf.state(),
            }),
            true
          );
        case 'POST /perf/offscreen/start':
          return (
            reply(
              200,
              this.perf.startOffscreen({
                width: Number(body.width),
                height: Number(body.height),
                frames: Number(body.frames ?? 240),
                warmup: Number(body.warmup ?? 30),
                profile: String(body.profile ?? 'qualite'),
                screen:
                  typeof body.screen === 'string' ? body.screen : undefined,
              }),
            ),
            true
          );
        case 'POST /perf/offscreen/cancel':
          return (reply(200, this.perf.cancelOffscreen()), true);
        case 'POST /perf/live/start':
          return (
            reply(
              200,
              await this.perf.startLive({
                effect: String(body.effect ?? ''),
                label: typeof body.label === 'string' ? body.label : undefined,
                // Phases de 5 à 60 s depuis la page (la classe accepte moins pour ses tests).
                reference_s: Math.max(5, Number(body.reference_s ?? 10)),
                effect_s: Math.max(5, Number(body.effect_s ?? 10)),
                after_s: Math.max(5, Number(body.after_s ?? 10)),
              }),
            ),
            true
          );
        case 'POST /perf/live/stop':
          return (reply(200, await this.perf.stopLive()), true);
        case 'POST /perf/live/clear':
          return (this.perf.clearLive(), reply(200, this.perf.state()), true);
        case 'GET /perf/export': {
          // Téléchargement du rapport : json (tout), csv (banc hors écran ou essais en jeu), html (lisible seul).
          const f = url.searchParams.get('format') ?? 'json';
          const part = url.searchParams.get('part') ?? 'offscreen';
          const st = this.perf.state();
          const stamp = new Date()
            .toISOString()
            .slice(0, 16)
            .replace(/[:T]/g, '-');
          const send = (type: string, ext: string, data: string) => {
            res.writeHead(200, {
              'content-type': `${type}; charset=utf-8`,
              'content-disposition': `attachment; filename="chaos-perf-${stamp}.${ext}"`,
              'cache-control': 'no-store',
            });
            res.end(data);
            return true;
          };
          if (f === 'csv')
            return send(
              'text/csv',
              'csv',
              '﻿' +
                (part === 'live'
                  ? liveCsv(st.live_results)
                  : offscreenCsv(st.offscreen)),
            );
          if (f === 'html')
            return send(
              'text/html',
              'html',
              reportHtml(
                st.offscreen,
                st.live_results,
                await this.perf.sysinfo().catch(() => null),
              ),
            );
          return send(
            'application/json',
            'json',
            JSON.stringify(
              {
                system: await this.perf.sysinfo().catch(() => null),
                ...st,
              },
              null,
              2,
            ),
          );
        }
        case 'POST /engine/restart':
          await c.stop();
          this.registry = null;
          c.start();
          await c.ready();
          return (reply(200, { engine: c.state }), true);
      }
      return (reply(404, { error: 'not_found' }), true);
    } catch (e) {
      const code =
        e instanceof ChaosError ||
        e instanceof PreviewError ||
        e instanceof PerfError ||
        e instanceof ChaosObsError
          ? e.code
          : 'internal';
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

function obsMessage(e: unknown) {
  return (e as Error)?.message ?? 'erreur OBS';
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
