// Synthèse du banc par phases (phase A) : node analyse-a.mjs a-phases.jsonl > a-synthese.json ; tableau sur stderr.
import { readFileSync } from 'node:fs';
import process from 'node:process';
const lines = readFileSync(process.argv[2] ?? 'a-phases.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const res = lines
  .filter((l) => l.type === 'result')
  .map((l) => l.result)
  .filter((r) => r.status === 'ok');
const by = new Map();
for (const r of res) (by.get(r.case) ?? by.set(r.case, []).get(r.case)).push(r);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) =>
  a.length < 2
    ? 0
    : Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1));
const r3 = (x) =>
  x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000;
const agg = (rs, ph, k) => {
  const v = rs.map((r) => r.phases[ph]?.[k]).filter((x) => x != null);
  return v.length
    ? {
        moy: r3(mean(v)),
        min: r3(Math.min(...v)),
        max: r3(Math.max(...v)),
        et: r3(sd(v)),
      }
    : null;
};
const out = [];
const ref = by.get('reference');
const refHold = ref ? mean(ref.map((r) => r.phases.hold.gpu_ms_p50)) : 0;
for (const [id, rs] of by) {
  const r0 = rs[0];
  const o = {
    case: id,
    effet: r0.effect,
    palier: r0.tier,
    variante: r0.variant,
    niveau: r0.level,
    extra: r0.extra,
    repetitions: rs.length,
    duree_ms: r0.duration_ms,
    entree_ms: r0.in_ms,
    sortie_ms: r0.out_ms,
    horloge: r0.clock_driven,
    capture: r0.needs_capture,
    phases: {},
  };
  for (const ph of ['in', 'hold', 'out']) {
    if (!rs.some((r) => r.phases[ph].renders > 0)) continue;
    o.phases[ph] = {
      rendus_par_s: agg(rs, ph, 'renders_per_s'),
      gpu_p50: agg(rs, ph, 'gpu_ms_p50'),
      gpu_p95: agg(rs, ph, 'gpu_ms_p95'),
      gpu_p99: agg(rs, ph, 'gpu_ms_p99'),
      gpu_max: agg(rs, ph, 'gpu_ms_max'),
      gpu_ms_par_s: agg(rs, ph, 'gpu_ms_per_s'),
      cpu_p50: agg(rs, ph, 'cpu_ms_p50'),
      cpu_p95: agg(rs, ph, 'cpu_ms_p95'),
      cpu_max: agg(rs, ph, 'cpu_ms_max'),
      passes: Math.max(...rs.map((r) => r.phases[ph].passes)),
      images_statiques: Math.round(
        mean(rs.map((r) => r.phases[ph].static_skips)),
      ),
    };
  }
  o.surcout_maintien_p50_ms = o.phases.hold
    ? r3(o.phases.hold.gpu_p50.moy - refHold)
    : null;
  o.activation = {
    cpu_ms: r3(mean(rs.map((r) => r.activation.cpu_ms))),
    cpu_ms_max: r3(Math.max(...rs.map((r) => r.activation.cpu_ms))),
    premiere_image_gpu_ms: r3(
      mean(rs.map((r) => r.activation.first_gpu_ms ?? 0)),
    ),
    premiere_image_gpu_ms_max: r3(
      Math.max(...rs.map((r) => r.activation.first_gpu_ms ?? 0)),
    ),
  };
  o.desactivation_cpu_ms = r3(mean(rs.map((r) => r.deactivation.cpu_ms)));
  o.vram_mo = {
    pic_moins_avant: r3(mean(rs.map((r) => r.vram_mb.peak - r.vram_mb.before))),
    apres_liberation_moins_avant: r3(
      mean(rs.map((r) => r.vram_mb.after_trim - r.vram_mb.before)),
    ),
  };
  o.cpu_processus_ms_par_s = r3(mean(rs.map((r) => r.process_cpu_ms_per_s)));
  o.alloc_octets_par_image = Math.round(
    mean(rs.map((r) => r.alloc_bytes_per_render ?? 0)),
  );
  out.push(o);
}
process.stdout.write(
  JSON.stringify({ reference_maintien_p50_ms: r3(refHold), cas: out }, null, 1),
);
const f = (x) => (x == null ? '—' : x.toFixed(3));
for (const o of out.filter((x) => !x.extra)) {
  const h = o.phases.hold,
    i = o.phases.in,
    u = o.phases.out;
  process.stderr.write(
    `${o.case.padEnd(22)} hold p50 ${f(h?.gpu_p50.moy)} (±${f(h?.gpu_p50.et)}) p95 ${f(h?.gpu_p95.moy)} p99 ${f(h?.gpu_p99.moy)} max ${f(h?.gpu_max.max)} | ms/s ${f(h?.gpu_ms_par_s.moy)} r/s ${h?.rendus_par_s.moy} passes ${h?.passes} | in p95 ${f(i?.gpu_p95.moy)} out p95 ${f(u?.gpu_p95.moy)} | act cpu ${f(o.activation.cpu_ms)} 1re ${f(o.activation.premiere_image_gpu_ms_max)} | vram +${o.vram_mo.pic_moins_avant} rest ${o.vram_mo.apres_liberation_moins_avant} | cpu50 ${f(h?.cpu_p50.moy)} cpu95 ${f(h?.cpu_p95.moy)}\n`,
  );
}
