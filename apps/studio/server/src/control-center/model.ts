import type { IncomingMessage, ServerResponse } from 'node:http';

// Centre de contrôle Studio (plan post-live, lot 3): ONE shape for « how is this module doing », whatever the module
// (bot today; mini-games, Roue du Sub, Jeu des mots, points de chaîne, TTS, Soundboard… next). A module plugs in a
// provider that reads its own source and describes itself; the page renders every status the same way. Reading only:
// piloting a module stays in its own tab until a module's actions are designed.

/** ok: works · warn: works with a reservation · error: does not work · off: stopped / not used · unknown: cannot tell. */
export type StatusLevel = 'ok' | 'warn' | 'error' | 'off' | 'unknown';

export interface StatusFact {
  label: string;
  value: string;
  level?: StatusLevel;
}

export interface ModuleStatus {
  /** Stable id (« bot », later « mini-games », « sub-wheel »…). */
  id: string;
  label: string;
  level: StatusLevel;
  /** One or two words: « Actif », « En attente », « Déconnecté », « Erreur »… */
  state: string;
  /** One sentence for the streamer. */
  summary: string;
  facts: StatusFact[];
  /** What to do, when something is wrong (null when nothing to do). */
  hint: string | null;
  /** When Studio read it (ISO). */
  checkedAt: string;
}

export interface StatusProvider {
  id: string;
  label: string;
  read(): Promise<ModuleStatus>;
}

const PROVIDER_TIMEOUT_MS = 4000;

/** A provider that throws or hangs reads « unknown » with its reason; the others are unaffected. */
async function readSafely(
  p: StatusProvider,
  now: () => Date,
): Promise<ModuleStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('lecture trop longue')),
          PROVIDER_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (e) {
    return {
      id: p.id,
      label: p.label,
      level: 'unknown',
      state: 'Inconnu',
      summary: `Statut illisible : ${(e as Error).message}`,
      facts: [],
      hint: null,
      checkedAt: now().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /api/control/status → { modules: ModuleStatus[] } (local Studio page only, like every Studio API). */
export class ControlCenter {
  constructor(
    private readonly origin: string,
    readonly providers: StatusProvider[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async statuses(): Promise<ModuleStatus[]> {
    return Promise.all(this.providers.map((p) => readSafely(p, this.now)));
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname !== '/api/control/status') return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    const origin = new URL(this.origin);
    if (
      req.headers.host !== origin.host ||
      (req.headers.origin && req.headers.origin !== this.origin)
    )
      reply(403, { error: 'forbidden_origin' });
    else if (req.headers['x-raptoru-studio'] !== '1')
      reply(403, { error: 'forbidden' });
    else if (req.method !== 'GET') reply(405, { error: 'method_not_allowed' });
    else reply(200, { modules: await this.statuses() });
    return true;
  }
}
