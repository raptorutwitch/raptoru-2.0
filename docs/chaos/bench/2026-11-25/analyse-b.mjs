// Synthèse du banc OBS isolé (phase B) : node analyse-b.mjs b-report.json > b-synthese.json ; tableau sur stderr.
import { readFileSync } from 'node:fs';
const rep = JSON.parse(
  readFileSync(process.argv[2] ?? 'b-report.json', 'utf8').replace(
    /^\uFEFF/,
    '',
  ),
);
const m = (rep.mesures ?? []).filter((x) => x.obs && x.obs.images);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const groups = new Map();
for (const x of m) {
  const k = `${x.case}|${x.phase}`;
  (groups.get(k) ?? groups.set(k, []).get(k)).push(x);
}
const rows = [];
for (const [k, xs] of groups) {
  const [cs, phase] = k.split('|');
  const sum = (f) => xs.reduce((s, x) => s + (x.obs[f] ?? 0), 0);
  const w = (f) => {
    const t = xs.reduce((s, x) => s + x.obs.secondes, 0);
    return t ? xs.reduce((s, x) => s + x.obs[f] * x.obs.secondes, 0) / t : null;
  };
  rows.push({
    case: cs,
    phase,
    mesures: xs.length,
    secondes: r(sum('secondes'), 1),
    images: sum('images'),
    en_retard_rendu: sum('en_retard_rendu'),
    sautees_encodage: sum('sautees_encodage'),
    noires: sum('noires'),
    ecart_max_ms: Math.max(...xs.map((x) => x.obs.ecart_max_ms)),
    rendu_obs_ms_moy: r(w('rendu_obs_ms_moy')),
    rendu_obs_ms_max: Math.max(...xs.map((x) => x.obs.rendu_obs_ms_max)),
    gpu_obs_ms_par_image: r(w('gpu_obs_ms_par_image')),
    gpu_moteur_pct: r(w('gpu_moteur_pct'), 2),
    gpu_3d_total_pct: r(w('gpu_3d_total_pct'), 1),
    nvenc_pct: r(w('nvenc_obs_pct'), 1),
    moteur_gpu_p50_ms: r(
      mean(xs.map((x) => x.moteur?.gpu_ms_p50).filter((v) => v != null)),
    ),
    moteur_gpu_p95_ms: r(
      mean(xs.map((x) => x.moteur?.gpu_ms_p95).filter((v) => v != null)),
    ),
  });
}
const base = [rep.obs_seul, rep.obs_seul_fin].filter(Boolean);
process.stdout.write(
  JSON.stringify(
    {
      obs: rep.obs,
      canvas: rep.canvas,
      encodeur: rep.encodeur,
      ecran: rep.monitor,
      obs_seul: base,
      lignes: rows,
    },
    null,
    1,
  ),
);
const f = (x, d = 3) => (x == null ? '—' : Number(x).toFixed(d));
for (const b of base)
  process.stderr.write(
    `OBS seul            rendu ${f(b.rendu_obs_ms_moy)} ms, GPU OBS ${f(b.gpu_obs_ms_par_image)} ms/img, 3D total ${f(b.gpu_3d_total_pct, 1)} %, retard ${b.en_retard_rendu}, sautées ${b.sautees_encodage}, noires ${b.noires}, écart max ${b.ecart_max_ms}\n`,
  );
for (const x of rows)
  process.stderr.write(
    `${(x.case + ' ' + x.phase).padEnd(28)} ${f(x.secondes, 1).padStart(6)} s  retard ${x.en_retard_rendu}  sautées ${x.sautees_encodage}  noires ${x.noires}  écart ${x.ecart_max_ms}  rendu OBS ${f(x.rendu_obs_ms_moy)} (max ${f(x.rendu_obs_ms_max)})  GPU OBS ${f(x.gpu_obs_ms_par_image)} ms/img  moteur ${f(x.gpu_moteur_pct, 2)} %  3D ${f(x.gpu_3d_total_pct, 1)} %  NVENC ${f(x.nvenc_pct, 1)} %  moteur p95 ${f(x.moteur_gpu_p95_ms)}\n`,
  );
