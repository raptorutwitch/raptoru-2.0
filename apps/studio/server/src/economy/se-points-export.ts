import { createHash } from 'node:crypto';

// StreamElements Jetons export, READ ONLY (docs/ECONOMY_MIGRATION.md). Only GET requests, one at a time, slow, never a
// write: the channel identity, the loyalty settings (ignored viewers), the paginated leaderboard (twice, to measure its
// stability), then individual sheets of a sample, every ignored viewer and every zero. Every page keeps its offset,
// its count, the announced total and its sha256. An error is never « no more accounts »: the export stops and says so.
// The token is the one Studio already holds; this module never logs it nor returns it.

export const SE_API = 'https://api.streamelements.com';

export interface SeExportDeps {
  /** A StreamElements dashboard JWT (Bearer). */
  token: string;
  /** StreamElements channel id (24 hex): must be the token's channel. */
  channel: string;
  fetch?: typeof fetch;
  base?: string;
  /** Pause between two requests (ms). */
  delayMs?: number;
  /** Page size asked first; the server may return fewer (then that becomes the page size). */
  pageSize?: number;
  /** How many leaderboard accounts (besides the top 20) are compared to their individual sheet. */
  sample?: number;
  log?: (line: string) => void;
}

export interface SePage {
  pass: number;
  offset: number;
  asked: number;
  returned: number;
  total: number | null;
  sha256: string;
}

export interface SeAccount {
  username: string;
  points: number;
}

export interface SeSheet {
  username: string;
  status: number;
  points: number | null;
  pointsAlltime: number | null;
  rank: number | null;
}

export class SeExportError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function exportSePoints(d: SeExportDeps) {
  const f = d.fetch ?? fetch;
  const base = d.base ?? SE_API;
  const delay = d.delayMs ?? 400;
  const log = d.log ?? (() => {});
  let requests = 0;

  const get = async (
    path: string,
  ): Promise<{ status: number; body: unknown }> => {
    for (let attempt = 0; ; attempt++) {
      if (requests++) await sleep(delay);
      const res = await f(`${base}${path}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${d.token}`,
          accept: 'application/json',
        },
      });
      if (res.status === 429 && attempt < 5) {
        const wait = Math.min(
          60,
          Number(res.headers.get('retry-after')) || 5 * (attempt + 1),
        );
        log(`429: attente ${wait} s`);
        await sleep(wait * 1000);
        continue;
      }
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: res.status, body };
    }
  };
  const must = async (path: string) => {
    const r = await get(path);
    if (r.status !== 200 || r.body === null)
      throw new SeExportError(
        `${path.replace(d.channel, '<canal>')} → HTTP ${r.status}`,
      );
    return r.body as Record<string, unknown>;
  };

  // 1. Which channel the token opens (must be the configured one).
  const me = await must('/kappa/v2/channels/me');
  const channel = {
    id: String(me._id ?? ''),
    username: String(me.username ?? ''),
    provider: String(me.provider ?? ''),
    matches: String(me._id ?? '') === d.channel,
  };
  if (!channel.matches)
    throw new SeExportError('le jeton ne correspond pas au canal configuré');

  // 2. Loyalty settings: the ignored viewers (« blacklist casino ») and the earning rules.
  const loyalty = ((await must(`/kappa/v2/loyalty/${d.channel}`)).loyalty ??
    {}) as Record<string, unknown>;
  const ignored = Array.isArray(loyalty.ignored)
    ? loyalty.ignored.map((u) => String(u).toLowerCase())
    : [];

  // 3. Leaderboard, two full passes.
  const pages: SePage[] = [];
  const passes: SeAccount[][] = [];
  let size = d.pageSize ?? 1000;
  for (let pass = 1; pass <= 2; pass++) {
    const accounts: SeAccount[] = [];
    let total: number | null;
    for (let offset = 0; ;) {
      const body = await must(
        `/kappa/v2/points/${d.channel}/top?limit=${size}&offset=${offset}`,
      );
      const users = Array.isArray(body.users)
        ? (body.users as Record<string, unknown>[])
        : null;
      if (!users)
        throw new SeExportError(
          `page ${offset} : réponse sans liste « users »`,
        );
      total = typeof body._total === 'number' ? body._total : null;
      pages.push({
        pass,
        offset,
        asked: size,
        returned: users.length,
        total,
        sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      });
      for (const u of users) {
        const points = Number(u.points);
        if (typeof u.username !== 'string' || !Number.isSafeInteger(points))
          throw new SeExportError(`page ${offset} : ligne illisible`);
        accounts.push({ username: u.username.toLowerCase(), points });
      }
      if (!users.length) break;
      // The server caps the page: the first page tells the real size (when it is not already the last page).
      if (
        offset === 0 &&
        users.length < size &&
        total !== null &&
        users.length < total
      )
        size = users.length;
      offset += users.length;
      if (total !== null && offset >= total) {
        // One more page past the announced end: it must be empty (else the total is not the whole list).
        const after = await must(
          `/kappa/v2/points/${d.channel}/top?limit=${size}&offset=${offset}`,
        );
        const extra = Array.isArray(after.users) ? after.users.length : -1;
        pages.push({
          pass,
          offset,
          asked: size,
          returned: extra,
          total,
          sha256: '',
        });
        if (extra !== 0) log(`page après la fin non vide (${extra})`);
        break;
      }
    }
    passes.push(accounts);
    log(
      `passage ${pass} : ${accounts.length} comptes (total annoncé ${total})`,
    );
  }

  // 4. Individual sheets: top 20, a spread sample, every zero and every ignored viewer.
  const first = passes[0]!;
  const want = new Set<string>(first.slice(0, 20).map((a) => a.username));
  const step = Math.max(1, Math.floor(first.length / (d.sample ?? 50)));
  for (let i = 20; i < first.length; i += step) want.add(first[i]!.username);
  for (const a of first.filter((u) => u.points === 0).slice(0, 30))
    want.add(a.username);
  for (const u of ignored) want.add(u);
  const sheets: SeSheet[] = [];
  for (const username of want) {
    const r = await get(
      `/kappa/v2/points/${d.channel}/${encodeURIComponent(username)}`,
    );
    const b = (r.body ?? {}) as Record<string, unknown>;
    const num = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    sheets.push({
      username,
      status: r.status,
      points: num(b.points),
      pointsAlltime: num(b.pointsAlltime),
      rank: num(b.rank),
    });
  }

  return { channel, loyalty, ignored, pages, passes, sheets, requests };
}

/** Aggregates only (no username, no individual balance): what the pilot report may show. */
export function summarizeSeExport(
  x: Awaited<ReturnType<typeof exportSePoints>>,
) {
  const [a, b] = x.passes as [SeAccount[], SeAccount[]];
  const byName = (l: SeAccount[]) =>
    new Map(l.map((u) => [u.username, u.points]));
  const ma = byName(a);
  const mb = byName(b);
  const sum = (l: SeAccount[]) => l.reduce((s, u) => s + u.points, 0);
  const listed = new Set(a.map((u) => u.username));
  const sheetVsList = x.sheets.filter((s) => ma.has(s.username));
  const lo = x.loyalty;
  return {
    channel_matches: x.channel.matches,
    requests: x.requests,
    page_size_returned: Math.max(
      0,
      ...x.pages.filter((p) => p.offset === 0).map((p) => p.returned),
    ),
    announced_total: x.pages.at(-1)?.total ?? null,
    pass1: {
      rows: a.length,
      distinct: ma.size,
      sum: sum(a),
      zeros: a.filter((u) => u.points === 0).length,
      negatives: a.filter((u) => u.points < 0).length,
    },
    pass2: { rows: b.length, distinct: mb.size, sum: sum(b) },
    duplicates_in_pass1: a.length - ma.size,
    only_in_pass1: [...ma.keys()].filter((k) => !mb.has(k)).length,
    only_in_pass2: [...mb.keys()].filter((k) => !ma.has(k)).length,
    changed_between_passes: [...ma].filter(
      ([k, v]) => mb.has(k) && mb.get(k) !== v,
    ).length,
    ignored: {
      count: x.ignored.length,
      in_leaderboard: x.ignored.filter((u) => listed.has(u)).length,
      sheet_found: x.sheets.filter(
        (s) => x.ignored.includes(s.username) && s.status === 200,
      ).length,
      sheet_positive: x.sheets.filter(
        (s) => x.ignored.includes(s.username) && (s.points ?? 0) > 0,
      ).length,
    },
    sheets: {
      checked: sheetVsList.length,
      equal: sheetVsList.filter((s) => s.points === ma.get(s.username)).length,
      different: sheetVsList.filter(
        (s) => s.status === 200 && s.points !== ma.get(s.username),
      ).length,
      errors: x.sheets.filter((s) => s.status !== 200).length,
    },
    loyalty_settings: {
      enabled: lo.enabled ?? null,
      amount: lo.amount ?? null,
      subscriber_multiplier: lo.subscriberMultiplier ?? null,
      bonuses: lo.bonuses ?? null,
      keys: Object.keys(lo).sort(),
    },
  };
}
