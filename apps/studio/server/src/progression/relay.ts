import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Progression native (docs/PROGRESSION.md) — Studio's panel relay to the profile's Core (the Lab Core, or the
// Production Core through the paired installation). Studio only relays: the Core decides and records everything.
// The WizeBot import reads WizeBot's levels, watchtime and messages through raptoru.fr's public API (the site holds
// the read-only WizeBot key; Studio never does) and sends them to the Core, which resolves the accounts.

const WIZEBOT_SOURCE = 'https://raptoru.fr/api/wizebot';

type WizebotRow = {
  twitch_user_id?: string | null;
  username?: string;
  value?: number;
};

/** WizeBot rows of the three rankings → one import row per viewer (by Twitch id when known, else by login). */
export function wizebotRows(
  levels: WizebotRow[],
  uptime: WizebotRow[],
  messages: WizebotRow[],
) {
  const key = (r: WizebotRow) =>
    String(r.username ?? '')
      .trim()
      .toLowerCase();
  const by = (rows: WizebotRow[]) => new Map(rows.map((r) => [key(r), r]));
  const up = by(uptime);
  const msg = by(messages);
  const out = [];
  for (const r of levels) {
    const login = key(r);
    const level = Math.floor(Number(r.value ?? 0));
    if (!/^[a-z0-9_]{1,25}$/.test(login) || level < 1) continue;
    const id = String(
      r.twitch_user_id ??
        up.get(login)?.twitch_user_id ??
        msg.get(login)?.twitch_user_id ??
        '',
    );
    out.push({
      twitch_user_id: /^\d{1,32}$/.test(id) ? id : null,
      login,
      level: Math.min(level, 10_000),
      watch_seconds: Math.max(0, Math.floor(Number(up.get(login)?.value ?? 0))),
      messages: Math.max(0, Math.floor(Number(msg.get(login)?.value ?? 0))),
    });
  }
  return out;
}

/**
 * Rows per request: the Lab Core takes 8 KB per request, the main Core 64 KB; ~2 400 WizeBot rows go in batches (the
 * import is idempotent per viewer, so a batch sent twice changes nothing).
 */
export const IMPORT_BATCH = 60;

type ImportRow = ReturnType<typeof wizebotRows>[number];
type ImportOut = {
  imported?: number;
  would_import?: number;
  already: number;
  by_id: number;
  by_login: number;
  unresolved: string[];
  ambiguous: string[];
  conflicts: string[];
};

/**
 * Sends the import in batches and adds up the answers. One Twitch id reached by two rows is set aside BEFORE batching
 * (a batch alone cannot see the other row): never two histories on one viewer.
 */
export async function importInBatches(
  core: LabCoreCall,
  base: string,
  rows: ImportRow[],
  dryRun: boolean,
) {
  const count = new Map<string, number>();
  for (const r of rows)
    if (r.twitch_user_id)
      count.set(r.twitch_user_id, (count.get(r.twitch_user_id) ?? 0) + 1);
  const conflicts = rows
    .filter((r) => r.twitch_user_id && count.get(r.twitch_user_id)! > 1)
    .map((r) => r.login);
  const clean = rows.filter(
    (r) => !r.twitch_user_id || count.get(r.twitch_user_id) === 1,
  );
  const total: Required<Omit<ImportOut, 'imported' | 'would_import'>> & {
    done: number;
  } = {
    done: 0,
    already: 0,
    by_id: 0,
    by_login: 0,
    unresolved: [],
    ambiguous: [],
    conflicts,
  };
  for (let i = 0; i < clean.length; i += IMPORT_BATCH) {
    const out = await core<ImportOut>(
      `${base}/import`,
      {
        source: 'wizebot',
        dry_run: dryRun,
        rows: clean.slice(i, i + IMPORT_BATCH),
      },
      { timeoutMs: 30_000 },
    );
    total.done += (dryRun ? out.would_import : out.imported) ?? 0;
    total.already += out.already;
    total.by_id += out.by_id;
    total.by_login += out.by_login;
    total.unresolved.push(...out.unresolved);
    total.ambiguous.push(...out.ambiguous);
    total.conflicts.push(...out.conflicts);
  }
  const { done, ...rest } = total;
  return {
    dry_run: dryRun,
    read: rows.length,
    [dryRun ? 'would_import' : 'imported']: done,
    ...rest,
  };
}

export class ProgressionRelay {
  constructor(
    private readonly d: {
      core: LabCoreCall | null;
      environment: 'lab' | 'production' | null;
      fetchJson?: (url: string) => Promise<unknown>;
    },
  ) {}

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/progression'
      : '/v1/lab/progression';
  }

  private async body(req: IncomingMessage) {
    let raw = '';
    for await (const c of req) {
      raw += c;
      if (raw.length > 64 * 1024)
        throw Object.assign(new Error('body_too_large'), { status: 413 });
    }
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  private async wizebot(type: string) {
    const get =
      this.d.fetchJson ??
      (async (u: string) =>
        (await fetch(u, { signal: AbortSignal.timeout(30_000) })).json());
    const d = (await get(
      `${WIZEBOT_SOURCE}?type=${type}&period=all&limit=6000&source=wizebot`,
    )) as { players?: WizebotRow[] };
    if (!Array.isArray(d?.players))
      throw Object.assign(new Error('wizebot_unavailable'), { status: 502 });
    return d.players;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const p = url.pathname;
    if (!p.startsWith('/api/progression/')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1') {
      reply(403, { error: 'forbidden' });
      return true;
    }
    const core = this.d.core;
    if (!core) {
      reply(503, { error: 'core_unavailable' });
      return true;
    }
    try {
      const route = `${req.method} ${p}`;
      const id = /^\/api\/progression\/viewers\/(\d{1,32})$/.exec(p)?.[1];
      if (route === 'GET /api/progression/state')
        return (reply(200, await core(`${this.base}/settings`)), true);
      if (route === 'GET /api/progression/viewers')
        return (
          reply(
            200,
            await core(
              `${this.base}/viewers?q=${encodeURIComponent((url.searchParams.get('q') ?? '').slice(0, 40))}`,
            ),
          ),
          true
        );
      if (req.method === 'GET' && id)
        return (reply(200, await core(`${this.base}/viewers/${id}`)), true);
      const relay: Record<string, string> = {
        'POST /api/progression/settings': '/settings',
        'POST /api/progression/rewards': '/rewards',
        'POST /api/progression/grant': '/grant',
        'POST /api/progression/revoke': '/revoke',
        'POST /api/progression/import/revert': '/import/revert',
      };
      if (relay[route])
        return (
          reply(
            200,
            await core(`${this.base}${relay[route]}`, await this.body(req)),
          ),
          true
        );
      if (
        route === 'POST /api/progression/import/wizebot' ||
        route === 'POST /api/progression/import/wizebot/dry-run'
      ) {
        const [levels, uptime, messages] = await Promise.all([
          this.wizebot('ranks'),
          this.wizebot('uptime'),
          this.wizebot('message'),
        ]);
        const rows = wizebotRows(levels, uptime, messages);
        if (!rows.length) return (reply(502, { error: 'wizebot_empty' }), true);
        const dryRun = route.endsWith('/dry-run');
        return (
          reply(200, await importInBatches(core, this.base, rows, dryRun)),
          true
        );
      }
      reply(404, { error: 'not_found' });
    } catch (e) {
      const err = e as { status?: number; message?: string; body?: unknown };
      reply(
        err.status && err.status < 600 ? err.status : 502,
        (err.body as object) ?? { error: err.message ?? 'core_unavailable' },
      );
    }
    return true;
  }
}
