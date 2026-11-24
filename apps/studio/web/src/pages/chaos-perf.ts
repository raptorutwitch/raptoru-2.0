import { esc, ic, morph, poller, row, run, seg, stateChip } from '../ds/ds.js';
import { getJson, postJson, STUDIO_HEADERS } from '../http.js';

// Studio › Chaos › Performance Lab (docs/chaos/PERFORMANCE_LAB.md). Deux modes séparés :
//   - banc hors écran (automatique) : le moteur rend chaque effet sur une scène de synthèse, à la résolution de l'écran
//     choisi ; rien ne s'affiche ; refusé si un jeu est ouvert ; progression réelle, annulation ;
//   - validation en jeu (manuelle) : référence sans effet, l'effet (déclenché par ce clic, sur l'écran et avec les
//     réglages de sa fiche), retour ; télémétrie GPU / processeur par processus ; images/s du jeu non mesurées.
// La page ne calcule rien : elle affiche ce que le moteur et le serveur de Studio ont mesuré, « — » sinon.

type Json = Record<string, unknown>;
interface Mon {
  key: string;
  label: string;
  width: number;
  height: number;
  hz: number;
  primary?: boolean;
}
interface PerfState {
  system: Json | null;
  offscreen: {
    status: string;
    options?: Json;
    progress?: { done: number; total: number; label?: string };
    results: Json[];
    summary?: Json;
    error?: { code: string; message: string };
    ended_at?: string;
  };
  live: {
    status: string;
    effect?: string;
    label?: string;
    phase?: string;
    phase_ends_at?: number;
    samples: number;
    error?: { code: string; message: string };
  };
  live_results: Json[];
}

const NB = ' ';
const n = (v: unknown, d = 2) =>
  typeof v === 'number' && v >= 0
    ? v.toLocaleString('fr-FR', { maximumFractionDigits: d })
    : '—';
const msCell = (v: unknown) =>
  typeof v === 'number' ? `${n(v, 3)}${NB}ms` : '—';
const pct = (v: unknown) =>
  typeof v === 'number'
    ? `${v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NB}pt`
    : '—';
const LEVEL: Record<string, string> = {
  leger: 'Léger',
  marque: 'Marqué',
  dense: 'Dense',
  extreme: 'Extrême',
};
const STATUS: Record<string, string> = {
  ok: 'mesuré',
  partial: 'mesure partielle',
  gpu_unmeasured: 'GPU non mesuré',
  failed: 'échec',
};
const PHASE: Record<string, string> = {
  reference: 'Référence sans effet',
  effect: 'Effet en cours',
  after: 'Retour à la normale',
};

export function mountPerfLab(
  el: HTMLElement,
  deps: {
    monitors: () => Mon[];
    effects: () => { id: string; label: string }[];
  },
) {
  let st: PerfState | null = null;
  let screen = '';
  let frames = '240';
  let profile = 'qualite';
  let effect = '';
  const secs = { reference: 10, effect: 10, after: 10 };
  let open = false;

  const poll = poller(async () => {
    st = await getJson<PerfState>('/api/chaos/perf');
    paint();
    const busy =
      st.offscreen.status === 'running' || st.live.status === 'running';
    // Pendant une mesure : chaque seconde ; sinon un relevé lent suffit (la page reste juste).
    if (!busy) {
      poll.stop();
      slow.start();
    }
  }, 1000);
  const slow = poller(async () => {
    if (!open) return;
    const next = await getJson<PerfState>('/api/chaos/perf');
    st = next;
    paint();
    if (next.offscreen.status === 'running' || next.live.status === 'running') {
      slow.stop();
      poll.start();
    }
  }, 5000);

  function chosen(): Mon | undefined {
    const ms = deps.monitors();
    return (
      ms.find((m) => m.key === screen) ?? ms.find((m) => m.primary) ?? ms[0]
    );
  }

  function systemHtml() {
    const s = st?.system;
    if (!s) return '<p class="d-faint">Lecture du matériel…</p>';
    const g = (s.gpu as Json) ?? {};
    const c = (s.cpu as Json) ?? {};
    const o = (s.os as Json) ?? {};
    const scr = ((s.screens as Json[]) ?? [])
      .map(
        (m) =>
          `${esc(m.label)} ${esc(m.width)}×${esc(m.height)} · ${esc(m.hz)}${NB}Hz`,
      )
      .join(' — ');
    return `<dl class="cx-perf__sys">
      <div><dt>Carte graphique</dt><dd>${esc(g.name)} · ${n(Number(g.dedicated_vram_mb) / 1024, 1)}${NB}Go</dd></div>
      <div><dt>Processeur</dt><dd>${esc(c.name)} · ${esc(c.logical_cores)} cœurs logiques</dd></div>
      <div><dt>Mémoire</dt><dd>${n(Number(s.memory_mb) / 1024, 0)}${NB}Go</dd></div>
      <div><dt>Système</dt><dd>${esc(o.name)} ${esc(o.version ?? '')} (build ${esc(o.build)})</dd></div>
      <div><dt>Écrans</dt><dd>${scr || '—'}</dd></div>
      <div><dt>Moteur Chaos</dt><dd>${esc(s.engine)}</dd></div>
    </dl>`;
  }

  function offscreenHtml() {
    const o = st?.offscreen;
    const running = o?.status === 'running';
    const m = chosen();
    const mons = deps.monitors();
    const pr = o?.progress;
    const pctDone = pr && pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
    const results = o?.results ?? [];
    const sum = (o?.summary ?? {}) as Json;
    const list = (k: string) =>
      ((sum[k] as Json[]) ?? [])
        .map(
          (r) =>
            `${esc(r.label)}${r.level ? ` (${esc(LEVEL[String(r.level)] ?? r.level)})` : ''} : ${msCell(r.gpu_ms_p95)}`,
        )
        .join(' · ') || '—';
    const th = (sum.thresholds_ms ?? {}) as Json;
    return `<div class="cx-perf__mode">
      <header><h3>${ic('play')}Banc hors écran</h3>${stateChip(running ? 'live' : o?.status === 'done' ? '' : o?.status === 'failed' ? 'r' : 'off', running ? 'En cours' : o?.status === 'done' ? 'Terminé' : o?.status === 'failed' ? 'Échec' : o?.status === 'cancelled' ? 'Annulé' : 'Prêt')}</header>
      <p class="d-faint cx-help">Automatique et invisible : chaque effet est rendu hors écran sur une scène de jeu de synthèse qui bouge, à la résolution de l’écran choisi, avec une référence sans effet. Refusé si un jeu ou une application plein écran est ouvert. Temps GPU de Chaos seul : un coût relatif entre effets, pas les images/s d’un jeu.</p>
      ${row(
        'Écran de référence',
        mons.length
          ? seg(
              'data-perf-screen',
              mons.map(
                (x) =>
                  [
                    x.key,
                    `${esc(x.label)} <small>${x.width}×${x.height}</small>`,
                  ] as [string, string],
              ),
              m?.key ?? '',
            )
          : '<span class="d-faint">Lecture des écrans…</span>',
        'écran résolution',
      )}
      ${row(
        'Images par cas',
        seg(
          'data-perf-frames',
          [
            ['120', '120'],
            ['240', '240'],
            ['600', '600'],
          ],
          frames,
        ),
        'images frames répétitions',
      )}
      ${row(
        'Profil',
        seg(
          'data-perf-profile',
          [
            ['qualite', 'Qualité'],
            ['equilibre', 'Équilibré'],
            ['economie', 'Économie'],
          ],
          profile,
        ),
        'profil performance',
      )}
      <div class="cx-perf__run">
        ${running ? `<button type="button" class="d-btn danger" data-perf-cancel>${ic('stop')}Annuler</button>` : `<button type="button" class="d-btn primary" data-perf-start ${m ? '' : 'disabled'}>${ic('play')}Lancer le benchmark</button>`}
        ${running && pr ? `<div class="cx-perf__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctDone}"><i style="width:${pctDone}%"></i></div><span class="d-faint">${pr.done}/${pr.total}${pr.label ? ` · ${esc(pr.label)}` : ''}</span>` : ''}
      </div>
      ${o?.error ? `<p class="d-note">${esc(o.error.message)}</p>` : ''}
      ${
        results.length
          ? `<div class="cx-perf__tw"><table class="cx-perf__t"><thead><tr><th>Effet</th><th>Niveau</th><th>Statut</th><th>GPU médian</th><th>p95</th><th>p99</th><th>Surcoût</th><th>CPU</th><th>Allocations</th><th>Mém. vidéo</th></tr></thead><tbody>${results
              .map(
                (r) =>
                  `<tr class="${r.kind === 'reference' ? 'is-ref' : r.kind === 'combo' ? 'is-combo' : ''}"><td>${esc(r.label)}</td><td>${esc(LEVEL[String(r.level)] ?? '')}</td><td>${esc(STATUS[String(r.status)] ?? r.status)}</td><td>${msCell(r.gpu_ms_p50)}</td><td>${msCell(r.gpu_ms_p95)}</td><td>${msCell(r.gpu_ms_p99)}</td><td>${msCell(r.gpu_ms_over_reference)}</td><td>${msCell(r.cpu_ms_p50)}</td><td>${typeof r.alloc_bytes_per_frame === 'number' ? `${n(r.alloc_bytes_per_frame, 0)}${NB}o` : '—'}</td><td>${typeof r.vram_delta_mb === 'number' ? `${n(r.vram_delta_mb, 1)}${NB}Mo` : '—'}</td></tr>`,
              )
              .join('')}</tbody></table></div>`
          : ''
      }
      ${
        o?.summary
          ? `<dl class="cx-perf__sum">
        <div><dt>Les moins coûteux</dt><dd>${list('cheapest')}</dd></div>
        <div><dt>Les plus coûteux</dt><dd>${list('costliest')}</dd></div>
        <div><dt>À surveiller (p95 > ${msCell(th.watch)})</dt><dd>${list('to_watch')}</dd></div>
        <div><dt>À optimiser (p95 > ${msCell(th.optimize)})</dt><dd>${list('to_optimize')}</dd></div>
        <div><dt>Combinaisons les plus lourdes</dt><dd>${list('heaviest_combos')}</dd></div>
        ${((sum.unmeasured as Json[]) ?? []).length ? `<div><dt>Non mesurés</dt><dd>${((sum.unmeasured as Json[]) ?? []).map((u) => `${esc(u.id)} (${esc(STATUS[String(u.status)] ?? u.status)})`).join(', ')}</dd></div>` : ''}
      </dl>`
          : ''
      }
      ${results.length ? `<div class="cx-perf__exp"><span class="d-faint">Exporter</span><button type="button" class="d-btn ghost sm" data-perf-export="json">JSON</button><button type="button" class="d-btn ghost sm" data-perf-export="csv" data-part="offscreen">CSV</button><button type="button" class="d-btn ghost sm" data-perf-export="html">Rapport HTML</button></div>` : ''}
    </div>`;
  }

  function liveHtml() {
    const l = st?.live;
    const running = l?.status === 'running';
    const fx = deps.effects();
    if (!effect && fx.length) effect = fx[0]!.id;
    const left =
      running && l?.phase_ends_at
        ? Math.max(0, Math.ceil((l.phase_ends_at - Date.now()) / 1000))
        : 0;
    const res = st?.live_results ?? [];
    const num = (k: keyof typeof secs, label: string) =>
      `<label class="d-fld cx-fld-s"><input type="number" min="5" max="60" step="1" value="${secs[k]}" data-perf-secs="${k}" aria-label="${esc(label)} en secondes"><span>s</span></label>`;
    return `<div class="cx-perf__mode">
      <header><h3>${ic('activity')}Validation en jeu</h3>${stateChip(running ? 'live' : 'off', running ? `${PHASE[l?.phase ?? ''] ?? ''} · ${left}${NB}s` : 'Manuelle')}</header>
      <p class="d-faint cx-help">Strictement manuelle : ouvre le jeu et OBS, puis lance la mesure. Studio relève une référence sans effet, déclenche l’effet choisi (sur l’écran et avec les réglages de sa fiche) seulement à ce moment, puis mesure le retour. Aucune action sur le jeu. Les images/s du jeu ne sont pas mesurées (il faudrait PresentMon) : lis-les dans le jeu ou dans OBS pendant l’essai.</p>
      ${row('Effet', `<select class="d-sel" data-perf-effect aria-label="Effet à mesurer">${fx.map((x) => `<option value="${esc(x.id)}"${x.id === effect ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`, 'effet')}
      ${row('Phases', `<span class="cx-ctl">${num('reference', 'Référence')}${num('effect', 'Effet')}${num('after', 'Retour')}</span>`, 'référence effet retour durée')}
      <div class="cx-perf__run">
        ${running ? `<button type="button" class="d-btn danger" data-perf-live-stop>${ic('stop')}Arrêter tout de suite</button><span class="d-faint">${l?.samples ?? 0} relevés</span>` : `<button type="button" class="d-btn primary" data-perf-live-start ${effect ? '' : 'disabled'}>${ic('play')}Lancer la mesure</button>`}
      </div>
      ${l?.error ? `<p class="d-note">${esc(l.error.message)}</p>` : ''}
      ${
        res.length
          ? `<div class="cx-perf__tw"><table class="cx-perf__t"><thead><tr><th>Effet</th><th>Jeu au premier plan</th><th>GPU du jeu</th><th>GPU de Chaos</th><th>Compositeur</th><th>OBS</th><th>GPU total</th><th>CPU du jeu</th><th>Traitement Chaos p95</th><th>Images/s du jeu</th></tr></thead><tbody>${res
              .map((r) => {
                const d = (r.deltas ?? {}) as Json;
                const ph = (r.phases ?? {}) as Json;
                const fg = ((ph.effect as Json | undefined)?.foreground ??
                  {}) as Json;
                const c = (r.chaos ?? {}) as Json;
                return `<tr><td>${esc(r.label)}</td><td>${esc(((fg.names as string[]) ?? []).join(', ') || '—')}</td><td>${pct(d.game_gpu_pct)}</td><td>${pct(d.chaos_gpu_pct)}</td><td>${pct(d.dwm_gpu_pct)}</td><td>${pct(d.obs_gpu_pct)}</td><td>${pct(d.gpu_all_pct)}</td><td>${pct(d.game_cpu_pct)}</td><td>${msCell(c.processing_p95_ms_max)}</td><td>non mesurées</td></tr>`;
              })
              .join('')}</tbody></table></div>
        <p class="d-faint cx-help">Écarts entre la référence et la phase « effet », en points de pourcentage d’utilisation (moteur 3D de la carte, processeur entier). Un jeu limité par la carte graphique peut garder 99${NB}% et perdre des images/s : c’est pourquoi les images/s se lisent à part.</p>
        <div class="cx-perf__exp"><span class="d-faint">Exporter</span><button type="button" class="d-btn ghost sm" data-perf-export="csv" data-part="live">CSV</button><button type="button" class="d-btn ghost sm" data-perf-export="html">Rapport HTML</button><button type="button" class="d-btn ghost sm" data-perf-live-clear>Vider</button></div>`
          : ''
      }
    </div>`;
  }

  function paint() {
    if (!open) return;
    morph(
      el,
      `<header><h2>${ic('pulse')}Performance Lab</h2><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-perf-close>Fermer</button></header>
      ${systemHtml()}
      <div class="cx-perf__modes">${offscreenHtml()}${liveHtml()}</div>`,
    );
  }

  async function download(format: string, part: string) {
    const res = await fetch(
      `/api/chaos/perf/export?format=${encodeURIComponent(format)}&part=${encodeURIComponent(part)}`,
      { headers: STUDIO_HEADERS },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const name =
      /filename="([^"]+)"/.exec(
        res.headers.get('content-disposition') ?? '',
      )?.[1] ?? `chaos-perf.${format}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.perfScreen) {
      screen = b.dataset.perfScreen;
      paint();
    } else if (b.dataset.perfFrames) {
      frames = b.dataset.perfFrames;
      paint();
    } else if (b.dataset.perfProfile) {
      profile = b.dataset.perfProfile;
      paint();
    } else if (b.hasAttribute('data-perf-close')) toggle(false);
    else if (b.hasAttribute('data-perf-start')) {
      const m = chosen();
      if (!m) return;
      void run(b, async () => {
        await postJson('/api/chaos/perf/offscreen/start', {
          width: m.width,
          height: m.height,
          frames: Number(frames),
          warmup: 30,
          profile,
          screen: m.key,
        });
        slow.stop();
        poll.start();
      });
    } else if (b.hasAttribute('data-perf-cancel'))
      void run(
        b,
        () => postJson('/api/chaos/perf/offscreen/cancel', {}),
        'Banc annulé',
      );
    else if (b.hasAttribute('data-perf-live-start'))
      void run(b, async () => {
        const label = deps.effects().find((x) => x.id === effect)?.label;
        await postJson('/api/chaos/perf/live/start', {
          effect,
          label,
          reference_s: secs.reference,
          effect_s: secs.effect,
          after_s: secs.after,
        });
        slow.stop();
        poll.start();
      });
    else if (b.hasAttribute('data-perf-live-stop'))
      void run(
        b,
        () => postJson('/api/chaos/perf/live/stop', {}),
        'Mesure arrêtée, effet arrêté',
      );
    else if (b.hasAttribute('data-perf-live-clear'))
      void run(b, async () => {
        st = await postJson<PerfState>('/api/chaos/perf/live/clear', {}).then(
          async () => getJson<PerfState>('/api/chaos/perf'),
        );
        paint();
      });
    else if (b.dataset.perfExport)
      void run(b, () =>
        download(b.dataset.perfExport!, b.dataset.part ?? 'offscreen'),
      );
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('[data-perf-effect]')) effect = t.value;
    else if (t.matches('[data-perf-secs]')) {
      const k = (t as HTMLInputElement).dataset.perfSecs as keyof typeof secs;
      secs[k] = Math.min(60, Math.max(5, Math.round(Number(t.value) || 10)));
      paint();
    }
  });

  function toggle(on: boolean) {
    open = on;
    el.hidden = !on;
    if (on) {
      paint();
      slow.stop();
      poll.start();
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      poll.stop();
      slow.stop();
    }
  }
  return { toggle: () => toggle(!open), isOpen: () => open };
}
