// Tombola « Préparer » — the random amount's tiers edited as a DRAFT: every field changes freely (they depend on each
// other: contiguous tiers, 100 % in all), nothing is sent until « Enregistrer »; « Annuler » drops the draft. The checks
// below are Core's (raffle-lab/rules.ts validateConfig + the schema bounds), said in plain words BEFORE sending; Core
// still validates the saved configuration and stays the authority.

export interface Band {
  from: number;
  to: number;
  pct: number;
}
export interface BandsDraft {
  step: number;
  bands: Band[];
}

export const MAX_BANDS = 8;

const n = (v: number) => v.toLocaleString('fr-FR').replace(/\s/g, ' ');

/** What prevents saving the draft (empty: it can be saved). */
export function bandProblems(d: BandsDraft): string[] {
  const out: string[] = [];
  const { step, bands } = d;
  if (!Number.isInteger(step) || step < 1 || step > 100_000)
    out.push('Le pas doit être un nombre entier entre 1 et 100 000.');
  if (!bands.length) out.push('Il faut au moins une tranche.');
  if (bands.length > MAX_BANDS) out.push(`${MAX_BANDS} tranches au maximum.`);
  bands.forEach((b, i) => {
    const t = `Tranche ${i + 1}`;
    if (![b.from, b.to].every(Number.isInteger) || b.from < 0 || b.to < 1)
      out.push(`${t} : montants entiers positifs attendus.`);
    else if (b.to <= b.from)
      out.push(
        `${t} : la fin (${n(b.to)}) doit être au-dessus du début (${n(b.from)}).`,
      );
    if (!Number.isFinite(b.pct) || b.pct < 0 || b.pct > 100)
      out.push(`${t} : pourcentage entre 0 et 100.`);
    if (i && b.from !== bands[i - 1]!.to)
      out.push(
        `${t} doit commencer où finit la tranche ${i} (${n(bands[i - 1]!.to)}).`,
      );
  });
  const total = bands.reduce(
    (s, b) => s + (Number.isFinite(b.pct) ? b.pct : 0),
    0,
  );
  if (bands.length && Math.abs(total - 100) > 0.001)
    out.push(
      `Les pourcentages font ${n(Math.round(total * 1000) / 1000)} % au lieu de 100 %.`,
    );
  if (bands.length && Number.isInteger(step) && bands[0]!.from < step)
    out.push(
      `Le minimum (${n(bands[0]!.from)}) doit valoir au moins un pas (${n(step)}).`,
    );
  return out;
}

/** A field typed in French (« 10 000 », « 2,5 »). */
export const parseNumber = (raw: string) =>
  Number(raw.replace(/\s/g, '').replace(',', '.'));

/** A tier added at the end: it starts where the last one ends, 0 % (to be given a share before saving). */
export function addBand(d: BandsDraft): BandsDraft {
  const last = d.bands.at(-1);
  const from = last ? last.to : d.step;
  return {
    ...d,
    bands: [...d.bands, { from, to: from + Math.max(d.step, 1) * 10, pct: 0 }],
  };
}

/** A tier removed: the next one takes its start, so that the tiers stay contiguous. */
export function removeBand(d: BandsDraft, i: number): BandsDraft {
  const bands = d.bands.map((b) => ({ ...b }));
  const [gone] = bands.splice(i, 1);
  if (gone && i > 0 && bands[i]) bands[i]!.from = bands[i - 1]!.to;
  else if (gone && i === 0 && bands[0]) bands[0]!.from = gone.from;
  return { ...d, bands };
}
