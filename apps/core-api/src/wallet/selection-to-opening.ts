import { createHash } from 'node:crypto';
import { z } from 'zod';
import { OpeningSnapshot } from './opening-import.js';

// Selection manifest → opening snapshot (docs/ECONOMY_MIGRATION.md § 10–11). Pure and reproducible: the same validated
// selection manifest + the same raw StreamElements export give byte-identical output. It never decides anything: every
// row's fate comes from the manifest (retained → its own Twitch ID, attached → the explicit destination, excluded →
// kept out of the Wallet). Anything missing, contradictory or not validated is refused, never guessed.

const Int = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const TwitchId = z.string().regex(/^[1-9]\d{0,31}$/);

/** The parts of the selection manifest the conversion relies on (other fields are carried, not trusted). */
export const SelectionManifest = z.looseObject({
  type: z.literal('manifeste-de-selection-provisoire'),
  generated_at: z.iso.datetime({ offset: true }),
  policy: z.string().min(1),
  complete: z.boolean(),
  valid: z.boolean(),
  problems: z.array(z.unknown()),
  snapshot: z.looseObject({
    snapshot: z.iso.datetime({ offset: true }),
    comptes: Int,
    jetons: Int,
  }),
  rows: z.array(
    z.looseObject({
      se: z.string().min(1).max(200),
      points: Int,
      status: z.enum(['retenu', 'exclu', 'rattachement', 'attente']),
      status_detail: z.string(),
      rule: z.string(),
      decision: z.string().nullable(),
      attach: z
        .looseObject({
          target_se: z.string().nullable(),
          target_twitch_id: z.string().nullable(),
        })
        .nullable(),
      destination: TwitchId.nullable().optional(),
      destination_login: z.string().nullable().optional(),
    }),
  ),
});
export type SelectionManifest = z.infer<typeof SelectionManifest>;

/** Raw StreamElements export (se-points-export): every pass lists every account with its points. */
export const RawSourceExport = z.looseObject({
  at: z.iso.datetime({ offset: true }),
  passes: z
    .array(
      z.array(
        z.looseObject({
          username: z.string().min(1),
          points: z.number().int(),
        }),
      ),
    )
    .min(1),
});

export class SelectionConversionError extends Error {
  constructor(readonly blocking: string[]) {
    super(
      `conversion refused: ${blocking.slice(0, 20).join('; ')}${blocking.length > 20 ? ` (+${blocking.length - 20})` : ''}`,
    );
  }
}

export interface ConversionInput {
  manifestText: string;
  rawText: string;
  importId: string;
  currencyId: string;
  source: string;
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export function convertSelection(input: ConversionInput): {
  snapshot: OpeningSnapshot;
  text: string;
  summary: {
    sourceAccounts: number;
    wallets: number;
    attachedAccounts: number;
    importedTotal: number;
    excludedAccounts: number;
    excludedTotal: number;
  };
} {
  const blocking: string[] = [];
  const m = SelectionManifest.parse(JSON.parse(input.manifestText));
  const raw = RawSourceExport.parse(JSON.parse(input.rawText));

  // 1. Only a validated, complete manifest.
  if (!m.valid) blocking.push('manifeste non validé (valid = false)');
  if (!m.complete)
    blocking.push('manifeste incomplet (dossiers sans décision)');
  if (m.problems.length)
    blocking.push(
      `manifeste avec ${m.problems.length} problème(s) : ${JSON.stringify(m.problems)}`,
    );

  // 2. The manifest is exactly the raw export: same accounts, same points, every pass identical.
  const pass0 = raw.passes[0]!;
  const key = (p: { username: string; points: number }[]) =>
    JSON.stringify([...p].map((x) => [x.username, x.points]).sort());
  if (raw.passes.some((p) => key(p) !== key(pass0)))
    blocking.push("passes de l'export brut différentes");
  if (raw.at !== m.snapshot.snapshot)
    blocking.push(
      `date du snapshot brut ${raw.at} ≠ manifeste ${m.snapshot.snapshot}`,
    );
  const rawPoints = new Map<string, number>();
  for (const x of pass0) {
    if (rawPoints.has(x.username))
      blocking.push(`compte en double dans l'export brut : ${x.username}`);
    rawPoints.set(x.username, x.points);
  }
  const seen = new Set<string>();
  for (const r of m.rows) {
    if (seen.has(r.se))
      blocking.push(`compte en double dans le manifeste : ${r.se}`);
    seen.add(r.se);
    const p = rawPoints.get(r.se);
    if (p === undefined)
      blocking.push(`compte absent de l'export brut : ${r.se}`);
    else if (p !== r.points)
      blocking.push(
        `solde différent de l'export brut : ${r.se} ${r.points} ≠ ${p}`,
      );
  }
  for (const u of rawPoints.keys())
    if (!seen.has(u))
      blocking.push(`compte de l'export brut absent du manifeste : ${u}`);
  const total = m.rows.reduce((a, r) => a + r.points, 0);
  if (m.rows.length !== m.snapshot.comptes || total !== m.snapshot.jetons)
    blocking.push(
      `manifeste ${m.rows.length} comptes / ${total} ≠ snapshot ${m.snapshot.comptes} / ${m.snapshot.jetons}`,
    );

  // 3. Destinations: retained → its own; attached → explicit and consistent with its target; never guessed.
  const bySe = new Map(m.rows.map((r) => [r.se, r]));
  const dest = new Map<string, { id: string; login: string }>();
  for (const r of m.rows) {
    if (r.status === 'attente') blocking.push(`compte sans décision : ${r.se}`);
    if (r.status !== 'retenu' && r.status !== 'rattachement') continue;
    if (!r.destination || !r.destination_login) {
      blocking.push(`destination Twitch absente : ${r.se}`);
      continue;
    }
    if (r.status === 'rattachement') {
      if (r.status_detail !== 'rattaché, destination vérifiée')
        blocking.push(`rattachement non vérifié : ${r.se}`);
      const a = r.attach;
      if (!a || (!a.target_se && !a.target_twitch_id))
        blocking.push(`rattachement sans cible : ${r.se}`);
      if (a?.target_twitch_id && a.target_twitch_id !== r.destination)
        blocking.push(
          `Twitch ID cible ${a.target_twitch_id} ≠ destination ${r.destination} : ${r.se}`,
        );
      if (a?.target_se) {
        const t = bySe.get(a.target_se);
        if (!t)
          blocking.push(`compte cible inconnu : ${r.se} → ${a.target_se}`);
        else if (t.status !== 'retenu')
          blocking.push(
            `compte cible non repris (${t.status}) : ${r.se} → ${a.target_se}`,
          );
        else if (t.destination !== r.destination)
          blocking.push(
            `destination ≠ celle du compte cible : ${r.se} → ${a.target_se}`,
          );
      }
    }
    dest.set(r.se, { id: r.destination, login: r.destination_login });
  }
  // One login per destination (the Twitch login it carries now).
  const logins = new Map<string, string>();
  for (const { id, login } of dest.values()) {
    if (logins.has(id) && logins.get(id) !== login)
      blocking.push(`pseudos différents pour le Twitch ID ${id}`);
    logins.set(id, login);
  }
  if (blocking.length) throw new SelectionConversionError(blocking);

  // 4. Output, in a stable order (reproducible bytes).
  const groups = new Map<string, { source_ref: string; balance: number }[]>();
  for (const r of m.rows) {
    const d = dest.get(r.se);
    if (d)
      (groups.get(d.id) ?? groups.set(d.id, []).get(d.id)!).push({
        source_ref: r.se,
        balance: r.points,
      });
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const rows = [...groups]
    .sort(([a], [b]) => cmp(a, b))
    .map(([id, sources]) => ({
      twitch_user_id: id,
      login: logins.get(id)!,
      balance: sources.reduce((a, x) => a + x.balance, 0),
      sources: sources.sort((a, b) => cmp(a.source_ref, b.source_ref)),
    }));
  const excluded = m.rows
    .filter((r) => r.status === 'exclu')
    .sort((a, b) => cmp(a.se, b.se))
    .map((r) => ({
      source_ref: r.se,
      balance: r.points,
      reason: `${r.status_detail} (${r.rule})`.slice(0, 200),
    }));
  const snapshot = OpeningSnapshot.parse({
    import_id: input.importId,
    currency_id: input.currencyId,
    source: input.source,
    cutoff: m.snapshot.snapshot,
    source_snapshot: {
      sha256: sha(input.rawText),
      accounts: m.rows.length,
      total,
    },
    provenance: {
      manifest_sha256: sha(input.manifestText),
      manifest_generated_at: m.generated_at,
      policy: m.policy.slice(0, 1000),
    },
    rows,
    excluded,
  });
  const imported = rows.reduce((a, r) => a + r.balance, 0);
  const excludedTotal = excluded.reduce((a, r) => a + r.balance, 0);
  if (imported + excludedTotal !== total)
    throw new SelectionConversionError([
      `importé ${imported} + exclu ${excludedTotal} ≠ ${total}`,
    ]);
  return {
    snapshot,
    text: JSON.stringify(snapshot, null, 1) + '\n',
    summary: {
      sourceAccounts: m.rows.length,
      wallets: rows.length,
      attachedAccounts: m.rows.filter((r) => r.status === 'rattachement')
        .length,
      importedTotal: imported,
      excludedAccounts: excluded.length,
      excludedTotal,
    },
  };
}
