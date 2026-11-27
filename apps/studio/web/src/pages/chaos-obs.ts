import {
  confirmBox,
  esc,
  ic,
  morph,
  poller,
  row,
  run,
  seg,
  stateChip,
} from '../ds/ds.js';
import { getJson, postJson } from '../http.js';

// Studio › Chaos › Diffusion OBS (docs/chaos/MODE_C.md). Mode C : chaque activation a deux sorties, l'écran du streamer
// (calque) et la source gameplay d'OBS (filtres « Raptoru Chaos V2 »), dans une seule session du moteur. Le calque est
// alors exclu des captures : OBS ne voit que le vrai écran et applique l'effet une seule fois, sous la webcam et les
// alertes. Rien n'est créé dans OBS sans « Préparer les filtres OBS » (liste exacte, sauvegarde, confirmation).

type Mode = 'screen' | 'obs' | 'both';
interface Mon {
  device: string;
  key: string;
  label: string;
  width: number;
  height: number;
  primary?: boolean;
}
export interface ObsStatus {
  config: {
    mode: Mode;
    source: string | null;
    device: string | null;
    prepared: { version: string; at: string } | null;
  };
  obs: { connected: boolean; version?: string; websocket?: string };
  shaderfilter?: boolean;
  sources?: { name: string; kind: string }[];
  source?: {
    name: string;
    kind?: string;
    width?: number;
    height?: number;
    scene?: string;
  };
  filters?: {
    expected: number;
    missing: string[];
    enabled: string[];
    v1: { name: string; enabled: boolean }[];
    others: number;
  };
  effects: Record<string, { available: boolean; reason: string | null }>;
  ready: boolean;
  reasons: string[];
  sessions: {
    request_id: string;
    effect: string;
    state: string;
    error: string | null;
  }[];
  incident: { at: string; message: string } | null;
  /** Curseur d'OBS pendant les effets à curseur dessiné (docs/chaos/CURSEUR_OBS.md). */
  cursor?: {
    enabled: boolean;
    active: number;
    hidden: boolean;
    left_alone: boolean;
    pending_restore: string | null;
    incident: { at: string; message: string } | null;
  };
  /** Relais anti-coupure (docs/chaos/CURSEUR_OBS.md § 5) : capture sans curseur du même écran, hors du cadre. */
  relay?: {
    source: string | null;
    ready: boolean;
    reason?: string;
    relay?: string;
    exists?: boolean;
    same_screen?: boolean;
    scenes?: string[];
    missing?: string[];
    extra?: string[];
    program_covered?: boolean;
  };
}
interface RelayPlan {
  relay: string;
  exists: boolean;
  scenes: string[];
  missing: string[];
  extra: { scene: string }[];
}
interface Preview {
  source: string;
  create: string[];
  update: string[];
  untouched: string[];
  unavailable: { effect: string; reason: string | null }[];
}

const MODES: [Mode, string][] = [
  ['screen', 'Écran uniquement'],
  ['obs', 'OBS uniquement'],
  ['both', 'Écran + OBS'],
];
const CURSOR: [string, string][] = [
  ['off', 'Laisser'],
  ['on', 'Masquer pendant les effets'],
];
const KIND: Record<string, string> = {
  monitor_capture: 'capture d’écran',
  window_capture: 'capture de fenêtre',
  game_capture: 'capture de jeu',
};
const SESSION: Record<string, string> = {
  prepared: 'prête',
  live: 'à l’antenne',
  ending: 'se termine',
  ended: 'terminée',
  failed: 'sortie OBS coupée',
};

/** Le mode et son état, pour le bouton de l'en-tête de la page Chaos. */
export function obsChip(st: ObsStatus | null) {
  if (!st) return '';
  const m = MODES.find(([k]) => k === st.config.mode)?.[1] ?? '';
  if (st.config.mode === 'screen') return stateChip('off', m);
  return st.ready
    ? stateChip('live', `${m} · prêt`)
    : stateChip('w', `${m} · incomplet`);
}

export function mountObsPanel(
  el: HTMLElement,
  deps: {
    monitors: () => Mon[];
    effects: () => { id: string; label: string }[];
    onStatus: (st: ObsStatus | null) => void;
  },
) {
  let st: ObsStatus | null = null;
  let pv: Preview | null = null;
  let open = false;

  async function load(force = false) {
    try {
      st = await getJson<ObsStatus>(`/api/chaos/obs${force ? '?force=1' : ''}`);
    } catch {
      st = null;
    }
    deps.onStatus(st);
    if (open) paint();
  }
  // Fermé : un relevé lent (puce de l'en-tête) ; ouvert : toutes les 2 s.
  const slow = poller(() => load(), 10_000);
  const fast = poller(() => load(), 2000);
  slow.start();

  const label = (id: string) =>
    deps.effects().find((e) => e.id === id)?.label ?? id;

  function html() {
    if (!st)
      return '<header><h2>Diffusion OBS</h2></header><p class="d-faint">État indisponible (serveur de Studio).</p>';
    const c = st.config;
    const mons = deps.monitors();
    const src = st.source;
    const f = st.filters;
    const eff = Object.entries(st.effects);
    const off = eff.filter(([, e]) => !e.available);
    const mismatch =
      src?.width && c.device
        ? mons.find(
            (m) =>
              m.device === c.device &&
              (m.width !== src.width || m.height !== src.height),
          )
        : undefined;
    const obsLine = st.obs.connected
      ? stateChip('live', `OBS ${esc(st.obs.version ?? '')} connecté`) +
        (st.shaderfilter === false
          ? stateChip('r', 'obs-shaderfilter absent')
          : st.shaderfilter
            ? stateChip('', 'obs-shaderfilter présent')
            : '')
      : stateChip('r', 'OBS non connecté');
    const cur = st.cursor;
    const rel = st.relay;
    const cursorRows = `${row(
      'Curseur d’OBS',
      `${seg('data-obs-cursor', CURSOR, cur?.enabled ? 'on' : 'off')}${
        cur?.hidden
          ? stateChip('live', 'coupé pendant l’effet')
          : cur?.pending_restore
            ? stateChip('w', `à rétablir sur « ${esc(cur.pending_restore)} »`)
            : cur?.left_alone
              ? stateChip('', 'déjà coupé dans OBS : laissé tel quel')
              : ''
      }${cur?.enabled && !(c.source && c.device) ? '<span class="d-tag bad">choisir la source et l’écran capturé</span>' : ''}`,
    )}
      ${row(
        'Relais anti-coupure',
        `<span class="cx-ctl">${
          rel?.ready
            ? stateChip(
                'live',
                `prêt dans ${rel.scenes?.length ?? 0} scène${(rel.scenes?.length ?? 0) > 1 ? 's' : ''}`,
              )
            : rel?.exists
              ? stateChip(
                  'w',
                  rel.same_screen === false
                    ? 'sur un autre écran que la source'
                    : (rel.missing ?? []).length
                      ? `manque dans ${(rel.missing ?? []).map(esc).join(', ')}`
                      : `à retirer de ${(rel.extra ?? []).map(esc).join(', ')} (« ${esc(st.config.source ?? '')} » y est masquée)`,
                )
              : stateChip('off', rel?.reason ? esc(rel.reason) : 'absent')
        }</span><span class="d-sp"></span>
        <button type="button" class="d-btn sm" data-obs-relay-prepare ${st.obs.connected && c.source && !rel?.ready ? '' : 'disabled'}>${ic('layers')}Préparer le relais…</button>
        <button type="button" class="d-btn ghost sm" data-obs-relay-remove ${st.obs.connected && rel?.exists ? '' : 'disabled'}>Retirer le relais…</button>`,
      )}
      <p class="d-faint cx-obs__note">Miroir, retournement, tremblement, zoom, ivre et tunnel dessinent leur curseur transformé, qu’OBS capture avec l’image : « Masquer » coupe « Capturer le curseur » de la source pendant ces effets (un seul curseur dans le stream), puis rétablit la valeur d’avant. Seule capture de son écran, la source redémarre alors sa capture (flash noir) ; le <b>relais</b>, une petite capture sans curseur du même écran, hors du cadre, garde cette capture partagée en vie : la bascule devient instantanée.${cur?.incident ? ` <b>${esc(new Date(cur.incident.at).toLocaleTimeString('fr-FR'))} · ${esc(cur.incident.message)}</b>` : ''}</p>`;
    const sourceRows = `${row(
      'Source gameplay',
      `<select data-obs-source aria-label="Source gameplay d’OBS"><option value="">Choisir…</option>${(
        st.sources ?? []
      )
        .map(
          (s) =>
            `<option value="${esc(s.name)}" ${s.name === c.source ? 'selected' : ''}>${esc(s.name)} · ${esc(KIND[s.kind] ?? s.kind)}</option>`,
        )
        .join(
          '',
        )}${c.source && !(st.sources ?? []).some((s) => s.name === c.source) ? `<option selected value="${esc(c.source)}">${esc(c.source)} (introuvable)</option>` : ''}</select>${src?.width ? `<span class="d-faint">${src.width} × ${src.height}</span>` : ''}`,
    )}
      ${row(
        'Écran capturé',
        `<select data-obs-device aria-label="Écran que capture la source"><option value="">Choisir…</option>${mons
          .map(
            (m) =>
              `<option value="${esc(m.device)}" ${m.device === c.device ? 'selected' : ''}>${esc(m.label)} · ${m.width} × ${m.height}</option>`,
          )
          .join(
            '',
          )}</select>${mismatch ? `<span class="d-tag bad">taille différente de la source</span>` : ''}`,
      )}`;
    return `<header><h2>Diffusion OBS</h2><span class="d-faint">Chaos sur ton écran et sur la source gameplay d’OBS, sous la webcam et les alertes</span><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-obs-refresh>${ic('repeat')}Vérifier</button></header>
      ${row('Sorties', seg('data-obs-mode', MODES, c.mode))}
      ${
        c.mode === 'screen'
          ? `<p class="d-faint cx-obs__note">Écran uniquement (capture directe) : la source « Écran » d’OBS voit le même calque, une seule fois, sans aucun filtre. Pendant un effet qui lit l’image, la fenêtre du dessus (le jeu) reste en direct ; le reste de l’écran est figé.</p>
      ${row('OBS', `<span class="cx-ctl">${obsLine}</span>`)}
      ${sourceRows}
      ${cursorRows}`
          : `${row('OBS', `<span class="cx-ctl">${obsLine}</span>`)}
      ${sourceRows}
      ${row(
        'Filtres Chaos V2',
        `<span class="cx-ctl">${
          f
            ? f.missing.length
              ? stateChip(
                  'w',
                  `${f.missing.length} sur ${f.expected} à préparer`,
                )
              : stateChip('live', `${f.expected} prêts`)
            : '<span class="d-faint">—</span>'
        }${f?.enabled.length ? stateChip('live', `${f.enabled.length} actif${f.enabled.length > 1 ? 's' : ''}`) : ''}</span><span class="d-sp"></span>
        <button type="button" class="d-btn sm" data-obs-preview ${st.obs.connected && c.source ? '' : 'disabled'}>${ic('layers')}Préparer les filtres OBS…</button>
        <button type="button" class="d-btn ghost sm" data-obs-disable ${st.obs.connected && c.source ? '' : 'disabled'} title="Coupe tout de suite les filtres Chaos V2 de la source (aucun autre filtre)">${ic('stop')}Couper</button>`,
      )}
      ${
        pv
          ? `<div class="cx-obs__pv"><b>Dans OBS, sur « ${esc(pv.source)} »</b>
          <p>${pv.create.length ? `À créer (désactivés) : ${pv.create.map(esc).join(' · ')}` : 'Aucun filtre à créer.'}</p>
          ${pv.update.length ? `<p>Fichier de shader à mettre à jour : ${pv.update.map(esc).join(' · ')}</p>` : ''}
          <p class="d-faint">Laissés tels quels : ${pv.untouched.length ? pv.untouched.map(esc).join(' · ') : 'aucun autre filtre'}. Une sauvegarde des filtres de la source est écrite avant tout changement ; « Retirer les filtres V2 » les enlève.</p>
          ${pv.unavailable.length ? `<p class="d-faint">Sans version OBS : ${pv.unavailable.map((u) => esc(label(u.effect))).join(', ')} (écran seulement).</p>` : ''}
          <div class="cx-run"><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-obs-pv-close>Annuler</button><button type="button" class="d-btn ghost sm" data-obs-remove>Retirer les filtres V2…</button><button type="button" class="d-btn pri sm" data-obs-prepare ${pv.create.length || pv.update.length ? '' : 'disabled'}>Créer dans OBS</button></div></div>`
          : ''
      }
      ${row(
        'Anti-double',
        `<span class="d-faint">Pendant un effet diffusé par OBS, le calque est exclu des captures : OBS ne voit que le vrai écran et applique l’effet une fois.</span>`,
      )}
      ${row(
        'Synchronisation',
        `<span class="d-faint">Une seule session : même graine, mêmes réglages, même durée, même sortie ; arrêt et prolongation recalés.</span>`,
      )}
      ${row(
        'Effets',
        `<span class="d-faint">${eff.length - off.length} sur ${eff.length} en écran + OBS${off.length ? ` · ${off.map(([k, e]) => `${esc(label(k))} : écran seulement (${esc(e.reason ?? '?')})`).join(' · ')}` : ''}</span>`,
      )}
      ${
        st.reasons.length
          ? `<div class="cx-obs__warn">${ic('warn')}<span><b>${c.mode === 'obs' ? 'OBS uniquement impossible' : 'Écran + OBS incomplet'}</b> : ${st.reasons.map(esc).join(' · ')}. ${c.mode === 'obs' ? 'Les activations sont refusées.' : 'Les effets partent sur l’écran seul, et la page le dit à chaque activation.'}</span></div>`
          : ''
      }
      ${st.incident ? `<p class="cx-obs__inc">${ic('warn')} ${esc(new Date(st.incident.at).toLocaleTimeString('fr-FR'))} · ${esc(st.incident.message)}</p>` : ''}
      ${
        st.sessions.length
          ? `<p class="d-faint">Dernières sorties OBS : ${st.sessions
              .slice(-4)
              .map(
                (s) =>
                  `${esc(label(s.effect))} ${esc(SESSION[s.state] ?? s.state)}${s.error ? ` (${esc(s.error)})` : ''}`,
              )
              .join(' · ')}</p>`
          : ''
      }`
      }`;
  }
  function paint() {
    morph(el, html());
  }

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.obsMode)
      void run(b, async () => {
        await postJson('/api/chaos/obs/config', { mode: b.dataset.obsMode });
        await load(true);
      });
    else if (b.matches('[data-obs-relay-prepare]'))
      void (async () => {
        const p = await getJson<RelayPlan>('/api/chaos/obs/relay');
        const ok = await confirmBox({
          title: 'Préparer le relais anti-coupure dans OBS ?',
          body: `${p.exists ? `« ${p.relay} » existe déjà.` : `Création de « ${p.relay} » : capture du même écran que « ${st?.config.source ?? ''} », sans curseur.`} Ajout ${p.missing.length ? `aux scènes où « ${st?.config.source ?? ''} » est visible : ${p.missing.join(', ')}` : 'à aucune scène (déjà partout où elle est visible)'} — tout en bas, verrouillé, minuscule et hors du cadre (invisible dans le stream).${p.extra.length ? ` Retrait des scènes où elle est masquée : ${p.extra.map((x) => x.scene).join(', ')}.` : ''} Jamais dans une scène où « ${st?.config.source ?? ''} » est masquée (PS5). Aucune autre source, aucun filtre ni réglage n’est modifié ; « Retirer le relais » annule tout.`,
          yes: 'Préparer dans OBS',
          no: 'Annuler',
          danger: false,
        });
        if (!ok) return;
        await run(
          b,
          async () => {
            await postJson('/api/chaos/obs/relay/prepare', { confirm: true });
            await load(true);
          },
          'Relais anti-coupure prêt',
        );
      })();
    else if (b.matches('[data-obs-relay-remove]'))
      void (async () => {
        const ok = await confirmBox({
          title: 'Retirer le relais anti-coupure d’OBS ?',
          body: `« ${st?.relay?.relay ?? 'le relais'} » est supprimé de toutes les scènes. Le curseur d’OBS fonctionne comme avant (coupure possible à chaque bascule).`,
          yes: 'Retirer',
          no: 'Garder',
        });
        if (!ok) return;
        await run(
          b,
          async () => {
            await postJson('/api/chaos/obs/relay/remove', { confirm: true });
            await load(true);
          },
          'Relais retiré',
        );
      })();
    else if (b.dataset.obsCursor)
      void run(b, async () => {
        await postJson('/api/chaos/obs/config', {
          cursor: b.dataset.obsCursor === 'on',
        });
        await load(true);
      });
    else if (b.matches('[data-obs-refresh]')) void run(b, () => load(true));
    else if (b.matches('[data-obs-preview]'))
      void run(b, async () => {
        pv = await getJson<Preview>('/api/chaos/obs/preview');
        paint();
      });
    else if (b.matches('[data-obs-pv-close]')) {
      pv = null;
      paint();
    } else if (b.matches('[data-obs-prepare]') && pv)
      void (async () => {
        const ok = await confirmBox({
          title: 'Créer les filtres Chaos V2 dans OBS ?',
          body: `${pv!.create.length} filtre(s) créé(s) désactivés et ${pv!.update.length} mis à jour sur « ${pv!.source} ». Aucun autre filtre, aucune scène ni source n’est modifié ; une sauvegarde est écrite avant.`,
          yes: 'Créer dans OBS',
          no: 'Annuler',
          danger: false,
        });
        if (!ok) return;
        await run(
          b,
          async () => {
            await postJson('/api/chaos/obs/prepare', { confirm: true });
            pv = null;
            await load(true);
          },
          'Filtres Chaos V2 prêts dans OBS',
        );
      })();
    else if (b.matches('[data-obs-remove]'))
      void (async () => {
        const ok = await confirmBox({
          title: 'Retirer les filtres Chaos V2 d’OBS ?',
          body: 'Seuls les filtres « Raptoru Chaos V2 · … » de la source sont supprimés. Les autres filtres, dont les « Raptoru Chaos · … » de V1, restent.',
          yes: 'Retirer',
          no: 'Garder',
        });
        if (!ok) return;
        await run(
          b,
          async () => {
            await postJson('/api/chaos/obs/remove', { confirm: true });
            pv = null;
            await load(true);
          },
          'Filtres Chaos V2 retirés',
        );
      })();
    else if (b.matches('[data-obs-disable]'))
      void run(
        b,
        async () => {
          await postJson('/api/chaos/obs/disable-all', {});
          await load(true);
        },
        'Filtres Chaos V2 coupés',
      );
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.matches('[data-obs-source]'))
      void run(t, async () => {
        await postJson('/api/chaos/obs/config', { source: t.value || null });
        pv = null;
        await load(true);
      });
    else if (t.matches('[data-obs-device]'))
      void run(t, async () => {
        await postJson('/api/chaos/obs/config', { device: t.value || null });
        await load(true);
      });
  });

  function toggle(on: boolean) {
    open = on;
    el.hidden = !on;
    if (on) {
      paint();
      fast.start();
      void load(true);
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else fast.stop();
  }
  return { toggle: () => toggle(!open), status: () => st };
}
