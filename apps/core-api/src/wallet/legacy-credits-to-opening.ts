import { createHash } from 'node:crypto';
import { z } from 'zod';
import { OpeningSnapshot } from './opening-import.js';

// Historical Crédits TTS / Soundboard → opening snapshots (docs/ECONOMY_MIGRATION.md §§ 15, 18). The real source is the
// legacy extension's table `ext_channel_point_redemptions` (CANONICAL_WORKSPACE/extension/db 001, 006, 008): one row
// per credit pack — a Twitch redemption (TTS 1 credit, Soundboard `credit_units`, 3 by default), a Soundboard grant of
// the moderation (`moderation-credit:…`, never expires) or a test of the old extension's Lab (`lab-…`, cost 0).
// `credit_remaining` credits stay usable while the row is `available` and `expires_at` is ahead (6 h for the rewards
// managed by the app, 365 days for the dashboard ones). The export (legacy-credits-export.sql, a read-only query)
// becomes ONE snapshot per credits currency, imported by the same secure opening import as the Jetons (plan → apply →
// verify, once). Pure and reproducible; it never decides: anything in flight, unknown, inconsistent, not matching the
// export's own totals, or a finite expiry without the explicit decision (`expiry: 'permanent'`) is refused. The Lab
// test wallet of Raptoru 2.0 is never a source: only this export format is read.

const Int = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const When = z.iso.datetime({ offset: true });

/** The export of the legacy table, as legacy-credits-export.sql produces it. */
export const LegacyCreditsExport = z.strictObject({
  source: z.literal('legacy-ext-redemptions'),
  exported_at: When,
  /** The instant the snapshot stands for: a credit still valid after it is kept. */
  cutoff: When,
  /** Computed by the same read, in SQL: the rows and the credits per reward_key (checked against the rows). */
  declared: z.strictObject({
    rows: Int,
    remaining: z.record(z.string(), Int),
  }),
  rows: z.array(
    z.strictObject({
      redemption_id: z.string().min(1).max(128),
      reward_key: z.string().min(1).max(64),
      twitch_user_id: z.string().max(32),
      login: z.string().max(64),
      status: z.string().min(1).max(32),
      expires_at: When,
      credit_units: Int,
      credit_remaining: Int,
      credit_in_flight: Int,
      // Lot 10 (optional, given by legacy-credits-export.sql): audit and inventory only.
      reward_id: z.string().max(128).optional(),
      source: z.string().max(32).optional(),
      cost: Int.optional(),
      redeemed_at: When.optional(),
      settled_at: When.nullable().optional(),
      credit_claim_cost: Int.optional(),
    }),
  ),
});
export type LegacyCreditsExport = z.infer<typeof LegacyCreditsExport>;
type Row = LegacyCreditsExport['rows'][number];

/** Legacy reward keys → canonical credits currencies (legacy ebs/core/modules.js: tts, sound). */
const CURRENCY_OF: Record<string, 'credits_tts' | 'credits_soundboard'> = {
  tts: 'credits_tts',
  sound: 'credits_soundboard',
};

export class LegacyCreditsError extends Error {
  constructor(readonly blocking: string[]) {
    super(`legacy credits refused: ${blocking.join('; ')}`);
  }
}

/** What a finite expiry becomes in the Wallet (balances never expire there): refused until decided. */
export type ExpiryPolicy = 'refuse' | 'permanent';

export interface LegacyCreditsSummary {
  sha256: string;
  cutoff: string;
  rows: number;
  /** Per currency: viewers and credits imported, credits left out (expired / settled / Lab) and why. */
  currencies: Record<
    string,
    {
      viewers: number;
      imported: number;
      excluded_rows: number;
      excluded: number;
      reasons: Record<string, number>;
      /** Imported credits that would have expired in the legacy extension (made permanent by the decision). */
      finite_expiry: number;
      earliest_expiry: string | null;
    }
  >;
  /** Twitch IDs seen with several logins (the latest is kept: the ID is the key). */
  renamed: number;
}

const TWITCH_ID = /^[1-9]\d{0,31}$/;
const LOGIN = /^[a-z0-9_]{1,25}$/;
/** The moderation grants never expire (9999-12-31); anything before that year is a real deadline. */
const PERMANENT_FROM = Date.parse('9000-01-01T00:00:00Z');

export type LegacyCreditClass =
  | 'usable'
  | 'lab'
  | 'in_flight'
  | 'consumed'
  | 'expired'
  | 'canceled'
  | 'other_status';

const isLab = (r: Row) =>
  r.redemption_id.startsWith('lab-') || !!r.reward_id?.startsWith('lab:');
const isModeration = (r: Row) =>
  r.source === 'moderation' || r.redemption_id.startsWith('moderation-credit:');

/** One row at the cutoff (the legacy rules: ext_claim_redemption, ext_expire_redemptions, markRedemption). */
export function classifyLegacyCredit(
  r: Row,
  cutoff: number,
): LegacyCreditClass {
  if (isLab(r)) return 'lab';
  if (
    r.credit_in_flight > 0 ||
    ['claimed', 'cancel_pending'].includes(r.status)
  )
    return 'in_flight';
  if (r.credit_remaining === 0) return 'consumed';
  if (r.status === 'available' && Date.parse(r.expires_at) > cutoff)
    return 'usable';
  if (r.status === 'available' || r.status === 'expired') return 'expired';
  if (r.status === 'canceled') return 'canceled';
  return 'other_status';
}

/** Common reading of an export: parse, the export's own checks, duplicates. */
function readExport(exportText: string) {
  const sha256 = createHash('sha256').update(exportText).digest('hex');
  const ex = LegacyCreditsExport.parse(JSON.parse(exportText));
  const integrity: string[] = [];
  const cutoff = Date.parse(ex.cutoff);
  if (Date.parse(ex.exported_at) < cutoff)
    integrity.push('export antérieur à sa coupure');
  if (ex.rows.length !== ex.declared.rows)
    integrity.push(
      `lignes ${ex.rows.length} ≠ lignes déclarées par l'export ${ex.declared.rows}`,
    );
  const remaining: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of ex.rows) {
    if (seen.has(r.redemption_id))
      integrity.push(`redemption en double : ${r.redemption_id}`);
    seen.add(r.redemption_id);
    remaining[r.reward_key] =
      (remaining[r.reward_key] ?? 0) + r.credit_remaining;
    if (r.credit_remaining > r.credit_units)
      integrity.push(`restant > unités : ${r.redemption_id}`);
  }
  for (const k of new Set([
    ...Object.keys(remaining),
    ...Object.keys(ex.declared.remaining),
  ]))
    if ((remaining[k] ?? 0) !== (ex.declared.remaining[k] ?? 0))
      integrity.push(
        `crédits ${k} : ${remaining[k] ?? 0} ≠ total déclaré par l'export ${ex.declared.remaining[k] ?? 0}`,
      );
  return { sha256, ex, cutoff, integrity };
}

/** The display login of a viewer: the most recent real login (a moderation grant stores the ID there). */
function pickLogin(rows: Row[]) {
  const real = rows.filter(
    (r) => !isModeration(r) && r.login.toLowerCase() !== r.twitch_user_id,
  );
  const from = real.length ? real : rows;
  return [...from]
    .sort(
      (a, b) =>
        Date.parse(a.redeemed_at ?? a.expires_at) -
          Date.parse(b.redeemed_at ?? b.expires_at) ||
        a.redemption_id.localeCompare(b.redemption_id),
    )
    .at(-1)!
    .login.toLowerCase();
}

export function convertLegacyCredits(p: {
  exportText: string;
  /** e.g. legacy-credits-2026-10-25: the two import ids are <prefix>-tts and <prefix>-soundboard. */
  importPrefix: string;
  /** A finite legacy expiry: refused (default) until Antoni decides; « permanent » = a plain balance. */
  expiry?: ExpiryPolicy;
}): {
  snapshots: { snapshot: OpeningSnapshot; text: string }[];
  summary: LegacyCreditsSummary;
} {
  const { sha256, ex, cutoff, integrity } = readExport(p.exportText);
  const blocking = [...integrity];
  const finite: Record<string, number> = {};
  for (const r of ex.rows) {
    const c = classifyLegacyCredit(r, cutoff);
    if (c === 'in_flight')
      blocking.push(
        `crédit en vol (${r.status}) : ${r.redemption_id} — drainer avant l'export`,
      );
    if (c !== 'usable') continue;
    if (!CURRENCY_OF[r.reward_key])
      blocking.push(
        r.reward_key === 'bonk'
          ? `crédit Bonk utilisable : ${r.redemption_id} — aucune monnaie canonique (décision)`
          : `reward_key inconnue : ${r.reward_key} (${r.redemption_id})`,
      );
    if (!TWITCH_ID.test(r.twitch_user_id))
      blocking.push(`identité non résolue : ${r.redemption_id}`);
    if (!LOGIN.test(r.login.toLowerCase()))
      blocking.push(`login illisible : ${r.redemption_id}`);
    if (Date.parse(r.expires_at) < PERMANENT_FROM)
      finite[r.reward_key] = (finite[r.reward_key] ?? 0) + r.credit_remaining;
  }
  if ((p.expiry ?? 'refuse') === 'refuse')
    for (const [k, n] of Object.entries(finite))
      if (CURRENCY_OF[k])
        blocking.push(
          `décision requise : ${n} crédit(s) ${k} expireraient dans l'ancienne extension, un solde du Wallet n'expire pas (--expiry=permanent pour les garder sans date)`,
        );
  if (blocking.length) throw new LegacyCreditsError(blocking);

  const snapshots: { snapshot: OpeningSnapshot; text: string }[] = [];
  const summary: LegacyCreditsSummary = {
    sha256,
    cutoff: ex.cutoff,
    rows: ex.rows.length,
    currencies: {},
    renamed: 0,
  };
  const logins = new Map<string, Set<string>>();
  for (const [key, currency] of Object.entries(CURRENCY_OF)) {
    const mine = ex.rows
      .filter((r) => r.reward_key === key && r.credit_remaining > 0)
      .sort((a, b) => a.redemption_id.localeCompare(b.redemption_id));
    const kept = new Map<string, Row[]>();
    const excluded: OpeningSnapshot['excluded'] = [];
    const reasons: Record<string, number> = {};
    let earliest: number | null = null;
    for (const r of mine) {
      const ref = `ext-redemption:${r.redemption_id}`;
      const c = classifyLegacyCredit(r, cutoff);
      if (c !== 'usable') {
        const reason =
          c === 'lab'
            ? 'Lab de test (fictif)'
            : c === 'expired'
              ? 'expiré à la coupure'
              : `statut ${r.status}`;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
        excluded.push({ source_ref: ref, balance: r.credit_remaining, reason });
        continue;
      }
      if (!isModeration(r) && r.login.toLowerCase() !== r.twitch_user_id)
        (
          logins.get(r.twitch_user_id) ??
          logins.set(r.twitch_user_id, new Set()).get(r.twitch_user_id)!
        ).add(r.login.toLowerCase());
      const at = Date.parse(r.expires_at);
      if (at < PERMANENT_FROM) earliest = Math.min(earliest ?? at, at);
      kept.set(r.twitch_user_id, [...(kept.get(r.twitch_user_id) ?? []), r]);
    }
    const rows = [...kept.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([twitch_user_id, list]) => ({
        twitch_user_id,
        login: pickLogin(list),
        balance: list.reduce((t, r) => t + r.credit_remaining, 0),
        sources: list.map((r) => ({
          source_ref: `ext-redemption:${r.redemption_id}`,
          balance: r.credit_remaining,
        })),
      }));
    const total = mine.reduce((t, r) => t + r.credit_remaining, 0);
    const snapshot = OpeningSnapshot.parse({
      import_id: `${p.importPrefix}-${key === 'tts' ? 'tts' : 'soundboard'}`,
      currency_id: currency,
      source: 'legacy-ext-redemptions',
      cutoff: ex.cutoff,
      source_snapshot: { sha256, accounts: mine.length, total },
      rows,
      excluded,
    });
    snapshots.push({ snapshot, text: JSON.stringify(snapshot, null, 2) });
    summary.currencies[currency] = {
      viewers: rows.length,
      imported: rows.reduce((t, r) => t + r.balance, 0),
      excluded_rows: excluded.length,
      excluded: excluded.reduce((t, r) => t + r.balance, 0),
      reasons,
      finite_expiry: finite[key] ?? 0,
      earliest_expiry:
        earliest === null ? null : new Date(earliest).toISOString(),
    };
  }
  summary.renamed = [...logins.values()].filter((s) => s.size > 1).length;
  return { snapshots, summary };
}

const DAY = 86_400_000;

/**
 * Lot 10 — the inventory of an export, whatever its state (in flight included): what is usable at the cutoff, what
 * was consumed, expired, canceled or is a Lab test, and the identity problems. `public` holds counts only (reports,
 * commits); `private` is the per-viewer list (Twitch ID, login, balances) for a protected local file only.
 */
export function inventoryLegacyCredits(exportText: string) {
  const { sha256, ex, cutoff, integrity } = readExport(exportText);
  const byKey: Record<
    string,
    Record<LegacyCreditClass, { rows: number; credits: number }>
  > = {};
  const consumed: Record<string, number> = {};
  const viewers = new Map<
    string,
    {
      logins: Set<string>;
      balances: Record<string, number>;
      earliest: number | null;
    }
  >();
  const loginIds = new Map<string, Set<string>>();
  const expiry: Record<string, Record<string, number>> = {};
  const invalidIds = new Set<string>();
  let moderation = 0;
  for (const r of ex.rows) {
    const c = classifyLegacyCredit(r, cutoff);
    const k = (byKey[r.reward_key] ??= {
      usable: { rows: 0, credits: 0 },
      lab: { rows: 0, credits: 0 },
      in_flight: { rows: 0, credits: 0 },
      consumed: { rows: 0, credits: 0 },
      expired: { rows: 0, credits: 0 },
      canceled: { rows: 0, credits: 0 },
      other_status: { rows: 0, credits: 0 },
    });
    k[c].rows++;
    // In flight: the reserved credits (credit_claim_cost) are not in credit_remaining any more.
    k[c].credits +=
      c === 'in_flight'
        ? r.credit_remaining + (r.credit_claim_cost ?? r.credit_in_flight)
        : r.credit_remaining;
    if (!isLab(r))
      consumed[r.reward_key] =
        (consumed[r.reward_key] ?? 0) +
        Math.max(
          0,
          r.credit_units -
            r.credit_remaining -
            (c === 'in_flight'
              ? (r.credit_claim_cost ?? r.credit_in_flight)
              : 0),
        );
    if (c !== 'usable' && c !== 'in_flight') continue;
    if (!TWITCH_ID.test(r.twitch_user_id)) {
      invalidIds.add(r.redemption_id);
      continue;
    }
    if (isModeration(r)) moderation += r.credit_remaining;
    const v = viewers.get(r.twitch_user_id) ?? {
      logins: new Set<string>(),
      balances: {},
      earliest: null,
    };
    if (!isModeration(r) && r.login.toLowerCase() !== r.twitch_user_id) {
      v.logins.add(r.login.toLowerCase());
      (
        loginIds.get(r.login.toLowerCase()) ??
        loginIds
          .set(r.login.toLowerCase(), new Set())
          .get(r.login.toLowerCase())!
      ).add(r.twitch_user_id);
    }
    if (c === 'usable') {
      v.balances[r.reward_key] =
        (v.balances[r.reward_key] ?? 0) + r.credit_remaining;
      const at = Date.parse(r.expires_at);
      const bucket =
        at >= PERMANENT_FROM
          ? 'sans_expiration'
          : at - cutoff <= DAY
            ? '24h'
            : at - cutoff <= 7 * DAY
              ? '7j'
              : at - cutoff <= 30 * DAY
                ? '30j'
                : 'plus_de_30j';
      (expiry[r.reward_key] ??= {})[bucket] =
        (expiry[r.reward_key]![bucket] ?? 0) + r.credit_remaining;
      if (at < PERMANENT_FROM) v.earliest = Math.min(v.earliest ?? at, at);
    }
    viewers.set(r.twitch_user_id, v);
  }
  const usable: Record<string, { viewers: number; credits: number }> = {};
  for (const v of viewers.values())
    for (const [key, n] of Object.entries(v.balances)) {
      const u = (usable[key] ??= { viewers: 0, credits: 0 });
      u.viewers++;
      u.credits += n;
    }
  const holders = [...viewers.values()].filter(
    (v) => Object.keys(v.balances).length,
  ).length;
  return {
    public: {
      sha256,
      cutoff: ex.cutoff,
      exported_at: ex.exported_at,
      rows: ex.rows.length,
      integrity,
      viewers_with_usable_credits: holders,
      usable,
      expiry_of_usable: expiry,
      by_reward_key: byKey,
      consumed_credits: consumed,
      moderation_credits_usable: moderation,
      identity: {
        invalid_twitch_ids: invalidIds.size,
        ids_with_several_logins: [...viewers.values()].filter(
          (v) => v.logins.size > 1,
        ).length,
        logins_on_several_ids: [...loginIds.values()].filter((s) => s.size > 1)
          .length,
      },
    },
    private: [...viewers.entries()]
      .filter(([, v]) => Object.keys(v.balances).length)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([twitch_user_id, v]) => ({
        twitch_user_id,
        logins: [...v.logins].sort(),
        credits_tts: v.balances.tts ?? 0,
        credits_soundboard: v.balances.sound ?? 0,
        other: Object.fromEntries(
          Object.entries(v.balances).filter(([k]) => !CURRENCY_OF[k]),
        ),
        earliest_expiry:
          v.earliest === null ? null : new Date(v.earliest).toISOString(),
      })),
  };
}
