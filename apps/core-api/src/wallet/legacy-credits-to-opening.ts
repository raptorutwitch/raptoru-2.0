import { createHash } from 'node:crypto';
import { z } from 'zod';
import { OpeningSnapshot } from './opening-import.js';

// Historical Crédits TTS / Soundboard → opening snapshots (docs/ECONOMY_MIGRATION.md § 15). The real source is the
// legacy extension's table `ext_channel_point_redemptions` (CANONICAL_WORKSPACE/extension/db 001 + 006): one row per
// Twitch redemption, `credit_remaining` credits still usable until `expires_at`, reward_key `tts` / `sound`. A drained
// export of it (nothing claimed or in flight) becomes ONE snapshot per credits currency, imported by the same secure
// opening import as the Jetons (plan → apply → verify, once). Pure and reproducible; it never decides: anything in
// flight, unknown, inconsistent or not matching the export's own totals is refused. The Lab test wallet (its
// fictitious credits) is never a source: only this export format is read.

const Int = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The export of the legacy table, as the approved read produces it (docs § 15: the query). */
export const LegacyCreditsExport = z.strictObject({
  source: z.literal('legacy-ext-redemptions'),
  exported_at: z.iso.datetime({ offset: true }),
  /** The instant the snapshot stands for: a credit still valid after it is kept. */
  cutoff: z.iso.datetime({ offset: true }),
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
      expires_at: z.iso.datetime({ offset: true }),
      credit_units: Int,
      credit_remaining: Int,
      credit_in_flight: Int,
    }),
  ),
});
export type LegacyCreditsExport = z.infer<typeof LegacyCreditsExport>;

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

export interface LegacyCreditsSummary {
  sha256: string;
  cutoff: string;
  rows: number;
  /** Per currency: viewers and credits imported, credits left out (expired / settled) and why. */
  currencies: Record<
    string,
    {
      viewers: number;
      imported: number;
      excluded_rows: number;
      excluded: number;
      reasons: Record<string, number>;
    }
  >;
  /** Twitch IDs seen with several logins (the latest is kept: the ID is the key). */
  renamed: number;
}

const TWITCH_ID = /^[1-9]\d{0,31}$/;
const LOGIN = /^[a-z0-9_]{1,25}$/;

export function convertLegacyCredits(p: {
  exportText: string;
  /** e.g. legacy-credits-2026-10-25: the two import ids are <prefix>-tts and <prefix>-soundboard. */
  importPrefix: string;
}): {
  snapshots: { snapshot: OpeningSnapshot; text: string }[];
  summary: LegacyCreditsSummary;
} {
  const sha256 = createHash('sha256').update(p.exportText).digest('hex');
  const ex = LegacyCreditsExport.parse(JSON.parse(p.exportText));
  const blocking: string[] = [];
  const cutoff = Date.parse(ex.cutoff);
  if (Date.parse(ex.exported_at) < cutoff)
    blocking.push('export antérieur à sa coupure');
  if (ex.rows.length !== ex.declared.rows)
    blocking.push(
      `lignes ${ex.rows.length} ≠ lignes déclarées par l'export ${ex.declared.rows}`,
    );
  const seen = new Set<string>();
  const remaining: Record<string, number> = {};
  for (const r of ex.rows) {
    if (seen.has(r.redemption_id))
      blocking.push(`redemption en double : ${r.redemption_id}`);
    seen.add(r.redemption_id);
    remaining[r.reward_key] =
      (remaining[r.reward_key] ?? 0) + r.credit_remaining;
    if (r.credit_remaining > r.credit_units)
      blocking.push(`restant > unités : ${r.redemption_id}`);
    if (
      r.credit_in_flight > 0 ||
      ['claimed', 'cancel_pending'].includes(r.status)
    )
      blocking.push(
        `crédit en vol (${r.status}) : ${r.redemption_id} — drainer avant l'export`,
      );
    if (r.credit_remaining === 0) continue;
    if (!CURRENCY_OF[r.reward_key])
      blocking.push(
        `reward_key inconnue : ${r.reward_key} (${r.redemption_id})`,
      );
    if (!TWITCH_ID.test(r.twitch_user_id))
      blocking.push(`identité non résolue : ${r.redemption_id}`);
    if (!LOGIN.test(r.login.toLowerCase()))
      blocking.push(`login illisible : ${r.redemption_id}`);
    if (r.redemption_id.startsWith('lab-'))
      blocking.push(`crédit du Lab de test : ${r.redemption_id}`);
  }
  for (const k of new Set([
    ...Object.keys(remaining),
    ...Object.keys(ex.declared.remaining),
  ]))
    if ((remaining[k] ?? 0) !== (ex.declared.remaining[k] ?? 0))
      blocking.push(
        `crédits ${k} : ${remaining[k] ?? 0} ≠ total déclaré par l'export ${ex.declared.remaining[k] ?? 0}`,
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
    const kept = new Map<
      string,
      {
        login: string;
        at: number;
        sources: { source_ref: string; balance: number }[];
      }
    >();
    const excluded: OpeningSnapshot['excluded'] = [];
    const reasons: Record<string, number> = {};
    for (const r of mine) {
      const ref = `ext-redemption:${r.redemption_id}`;
      const valid =
        r.status === 'available' && Date.parse(r.expires_at) > cutoff;
      if (!valid) {
        const reason =
          r.status === 'available' || r.status === 'expired'
            ? 'expiré à la coupure'
            : `statut ${r.status}`;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
        excluded.push({ source_ref: ref, balance: r.credit_remaining, reason });
        continue;
      }
      const login = r.login.toLowerCase();
      (
        logins.get(r.twitch_user_id) ??
        logins.set(r.twitch_user_id, new Set()).get(r.twitch_user_id)!
      ).add(login);
      const at = Date.parse(r.expires_at);
      const k = kept.get(r.twitch_user_id) ?? { login, at, sources: [] };
      if (at >= k.at) Object.assign(k, { login, at });
      k.sources.push({ source_ref: ref, balance: r.credit_remaining });
      kept.set(r.twitch_user_id, k);
    }
    const rows = [...kept.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([twitch_user_id, k]) => ({
        twitch_user_id,
        login: k.login,
        balance: k.sources.reduce((t, s) => t + s.balance, 0),
        sources: k.sources,
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
    };
  }
  summary.renamed = [...logins.values()].filter((s) => s.size > 1).length;
  return { snapshots, summary };
}
