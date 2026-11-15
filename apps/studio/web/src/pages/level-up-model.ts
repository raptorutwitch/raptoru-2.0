// Level Up V2 (docs/LEVEL_UP_V2.md) — what Studio decides BEFORE sending anything to the Core, without a DOM (tested in
// apps/studio/server/test/level-up-model.test.ts):
// - the order of the streamer's sub badges from their folder (one badge every 10 levels), the real ambiguities only;
// - the rows of the first extension's sound choices from their Supabase export (CSV or JSON).

export interface BadgeFile {
  /** The path inside the chosen folder, as the browser gives it (« Badge de ma chaine/1. UglyTitan.png »). */
  path: string;
  size: number;
  /** The file's content hash (SHA-256 hex): the same picture under two names is one picture. */
  hash: string;
}

export interface PlannedBadge {
  n: number;
  level: number;
  path: string;
  name: string;
  /** A real ambiguity: the same picture used by another palier at the root — not imported unless Antoni ticks it. */
  doubt: string | null;
  /** Worth knowing, not a doubt: the same picture also lives in a subfolder (e.g. a Bits badge) — imported. */
  note: string | null;
}

export interface BadgePlan {
  badges: PlannedBadge[];
  /** Files left aside, and why (a subfolder such as « Obsolète » or « Badges Bits », no number, not an image). */
  ignored: { path: string; why: 'subfolder' | 'no_number' | 'not_image' }[];
  /** What prevents a palier from being filled (a number used twice, a missing number). */
  issues: string[];
}

const IMAGE = /\.(png|webp|jpe?g)$/i;
const NUMBERED = /^(\d{1,3})\s*[.)_-]?\s*(.*?)\.(png|webp|jpe?g)$/i;

/**
 * The sub badges in their order of progression: only the numbered pictures at the TOP of the chosen folder (the
 * subfolders hold older versions or other badges); badge n → level 10 × n. Never guessed: a number used by two different
 * files leaves its palier empty (said in `issues`), a missing number is said, one picture used by two paliers is a doubt
 * (`doubt`, waits for a tick). The same picture kept in a subfolder too (the « Badge HK » sub badge is also a Bits badge,
 * confirmed by Antoni on 15/11) is only a remark (`note`).
 */
export function planSubBadges(files: BadgeFile[]): BadgePlan {
  const split = files.map((f) => f.path.replace(/\\/g, '/').split('/'));
  // The browser puts the chosen folder's own name first: drop it when every path starts with it.
  const root =
    split.length && split.every((p) => p.length > 1 && p[0] === split[0]![0])
      ? 1
      : 0;
  const ignored: BadgePlan['ignored'] = [];
  const byNumber = new Map<number, { f: BadgeFile; name: string }[]>();
  files.forEach((f, i) => {
    const parts = split[i]!.slice(root);
    const name = parts.at(-1)!;
    if (parts.length > 1)
      return void ignored.push({ path: f.path, why: 'subfolder' });
    if (!IMAGE.test(name))
      return void ignored.push({ path: f.path, why: 'not_image' });
    const m = NUMBERED.exec(name);
    if (!m) return void ignored.push({ path: f.path, why: 'no_number' });
    const n = Number(m[1]);
    const list = byNumber.get(n) ?? [];
    list.push({ f, name: m[2]!.trim() || `Badge ${n}` });
    byNumber.set(n, list);
  });
  const issues: string[] = [];
  const badges: PlannedBadge[] = [];
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  for (const n of numbers) {
    const list = byNumber.get(n)!;
    const distinct = new Set(list.map((x) => x.f.hash));
    if (distinct.size > 1) {
      issues.push(
        `Le numéro ${n} est porté par ${list.length} images différentes (${list.map((x) => x.f.path).join(', ')}) : le palier ${10 * n} reste vide tant qu’il n’en reste qu’une.`,
      );
      continue;
    }
    const { f, name } = list[0]!;
    const twins = files.filter(
      (o) => o !== f && o.hash === f.hash && !list.some((x) => x.f === o),
    );
    const atRoot = (o: BadgeFile) =>
      o.path.replace(/\\/g, '/').split('/').slice(root).length === 1;
    const otherPalier = twins.filter(atRoot);
    const elsewhere = twins.filter((o) => !atRoot(o));
    badges.push({
      n,
      level: 10 * n,
      path: f.path,
      name,
      doubt: otherPalier.length
        ? `même image qu’un autre palier : ${otherPalier.map((t) => t.path).join(', ')}`
        : null,
      note: elsewhere.length
        ? `aussi présent dans ${elsewhere.map((t) => t.path).join(', ')}`
        : null,
    });
  }
  const max = numbers.at(-1) ?? 0;
  for (let n = 1; n <= max; n++)
    if (!byNumber.has(n))
      issues.push(
        `Aucun badge numéroté ${n} : le palier ${10 * n} reste vide.`,
      );
  return { badges, ignored, issues };
}

export interface LegacyPrefRow {
  channel_id: string;
  twitch_user_id: string | null;
  twitch_login: string | null;
  level_up_sfx_opt_in: boolean;
  updated_at: string | null;
}

/** One CSV line into fields (quotes, doubled quotes and commas inside quotes handled). */
function csvFields(line: string) {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const truthy = (v: unknown) =>
  v === true || /^(true|t|1|yes|oui)$/i.test(String(v ?? '').trim());
const dateOf = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  // Supabase CSV: « 2026-10-01 10:00:00.123+00 » — made readable by Date.
  const t = Date.parse(
    String(v)
      .trim()
      .replace(' ', 'T')
      .replace(/([+-]\d\d)$/, '$1:00'),
  );
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const digits = (v: unknown) =>
  /^\d{1,32}$/.test(String(v ?? '').trim()) ? String(v).trim() : null;

/**
 * The export of the Supabase table `ext_viewer_preferences` (raptoru.fr's first EBS): CSV with its header row, or the JSON
 * array the dashboard gives. Rows Studio cannot read are counted in `invalid` (never sent).
 */
export function parseLegacyPrefsExport(text: string): {
  rows: LegacyPrefRow[];
  invalid: number;
} {
  const t = text.replace(/^\uFEFF/, '').trim();
  let records: Record<string, unknown>[];
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = JSON.parse(t) as unknown;
    records = (Array.isArray(j) ? j : [j]) as Record<string, unknown>[];
  } else {
    const lines = t.split(/\r?\n/).filter((l) => l.trim());
    const head = csvFields(lines[0] ?? '').map((h) => h.toLowerCase());
    records = lines.slice(1).map((l) => {
      const v = csvFields(l);
      return Object.fromEntries(head.map((h, i) => [h, v[i] ?? '']));
    });
  }
  const rows: LegacyPrefRow[] = [];
  let invalid = 0;
  for (const r of records) {
    const channel = digits(r.channel_id);
    if (!channel || !('level_up_sfx_opt_in' in r)) {
      invalid++;
      continue;
    }
    rows.push({
      channel_id: channel,
      twitch_user_id: digits(r.twitch_user_id),
      twitch_login:
        typeof r.twitch_login === 'string' && r.twitch_login.trim()
          ? r.twitch_login.trim().slice(0, 64)
          : null,
      level_up_sfx_opt_in: truthy(r.level_up_sfx_opt_in),
      updated_at: dateOf(r.updated_at),
    });
  }
  return { rows, invalid };
}
