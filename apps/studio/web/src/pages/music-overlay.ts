import {
  confirmBox,
  copy,
  ic,
  page,
  panelBtn,
  patch,
  poller,
  run,
  stateChip,
  toast,
} from '../ds/ds.js';
import { esc, getJson, postJson } from '../http.js';
import { morph } from './morph.js';
import {
  DEMOS,
  OBS_ERRORS,
  READABILITY,
  libraryView,
  obsView,
  settingsView,
  stageBar,
  type DemoId,
  type MoObs,
  type MoSettings,
  type MoState,
} from './music-overlay-view.js';

// Overlay musique (docs/music/MUSIC_OVERLAYS.md) : choisir un modèle, le régler en voyant le résultat, l'afficher ou le
// masquer sur le stream. L'aperçu est la vraie page OBS dans un cadre (même code) ; ses données de démo ne vont jamais
// vers OBS. Chaque changement est enregistré tout seul (indiqué « Enregistré » seulement quand Studio l'a confirmé) ; un
// modèle prêt n'est jamais modifié : le premier changement crée une variante à ton nom.

const API = '/api/spotify/overlays';
const SAVE_MS = 450;

export function mountMusicOverlayPage(root: HTMLElement) {
  const p = page(root, {
    title: 'Overlay musique',
    mod: 'spotify',
    panel: true,
  });
  p.body.innerHTML = `<div class="mox">
    <aside class="mox-lib d-scroll" data-z="lib" aria-label="Modèles et variantes"></aside>
    <section class="mox-stage" aria-label="Aperçu">
      <div data-z="bar"></div>
      <div class="mox-screen" data-z="screen" data-bg="dark"><iframe data-z="frame" src="/music-overlay/overlay.html?preview=1" title="Aperçu de l’overlay"></iframe></div>
      <p class="mox-foot" data-z="foot"></p>
    </section>
    <aside class="mox-set d-scroll" data-z="set" aria-label="Réglages"></aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const frame = z('frame') as HTMLIFrameElement;

  let st: MoState | null = null;
  let obs: MoObs | null = null;
  let sel = '';
  /** The settings being edited (saved a moment later). */
  let draft: MoSettings | null = null;
  let save: { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string } = {
    state: 'idle',
  };
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let source: 'real' | 'demo' = 'real';
  let demo: DemoId = 'normal';
  let backdrop = 'dark';
  /** Zoom ×2 on the widget's corner of the screen (the real scale is small in the editor). */
  let zoom = false;
  let previewPulse = 0;
  let previewGen = 0;
  let error = '';

  const selected = () => {
    if (!st) return null;
    const v = st.variants.find((x) => x.id === sel);
    if (v)
      return {
        id: v.id,
        name: v.name,
        builtin: false,
        base: v.base,
        settings: draft ?? v.settings,
      };
    const b =
      st.builtins.find((x) => x.id === sel) ??
      st.builtins.find((x) => x.id === st!.preset.id) ??
      st.builtins[0]!;
    return {
      id: b.id,
      name: b.name,
      builtin: true,
      base: b.id,
      settings: draft ?? b.settings,
    };
  };

  // --- the preview (the real OBS page in a frame) ---------------------------------------------------------------------
  const liveForPreview = () => {
    if (source === 'demo') {
      const d = DEMOS[demo].live;
      return { ...d, gen: d.gen * 1000 + previewGen };
    }
    return st?.live ?? null;
  };
  const toFrame = (
    win: Window | null,
    settings: MoSettings,
    extra: object = {},
  ) =>
    win?.postMessage(
      {
        type: 'mo:preview',
        preset: { id: 'preview', name: 'preview', settings },
        live: liveForPreview(),
        visible: true,
        pulse: previewPulse,
        ...extra,
      },
      location.origin,
    );
  const feed = () => {
    const s = selected();
    if (s) toFrame(frame.contentWindow, s.settings);
  };
  const feedCards = () => {
    if (!st) return;
    for (const f of p.body.querySelectorAll<HTMLIFrameElement>(
      'iframe[data-card]',
    )) {
      const id = f.dataset.card!;
      const b = st.builtins.find((x) => x.id === id);
      if (!b) continue;
      f.contentWindow?.postMessage(
        {
          type: 'mo:preview',
          preset: { id, name: b.name, settings: b.settings },
          live: DEMOS.normal.live,
          visible: true,
          pulse: 0,
        },
        location.origin,
      );
    }
  };
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'mo:ready') return;
    if (e.source === frame.contentWindow) feed();
    else feedCards();
  });
  const scale = () => {
    const box = z('screen');
    const W = box.clientWidth;
    const H = box.clientHeight;
    const s0 = W / 1920;
    const pos = selected()?.settings.position ?? 'bottom-left';
    if (!zoom) {
      frame.style.transform = `scale(${s0})`;
      return;
    }
    // The widget's corner of the 1920 × 1080 canvas stays at the same corner of the screen, twice as big.
    const s = s0 * 2;
    const fx = pos.endsWith('left') ? 0 : pos.endsWith('right') ? 1 : 0.5;
    const fy = pos.startsWith('top') ? 0 : pos.startsWith('bottom') ? 1 : 0.5;
    frame.style.transform = `translate(${fx * W - s * fx * 1920}px, ${fy * H - s * fy * 1080}px) scale(${s})`;
  };
  new ResizeObserver(scale).observe(z('screen'));

  // --- painting --------------------------------------------------------------------------------------------------------
  const paintHead = () => {
    const on = st?.visible ?? false;
    // « Afficher » authorises; in announce mode it arms the overlay (it shows at the next track, not now).
    const d = st?.preset.settings.display;
    patch(
      p.state,
      st
        ? stateChip(
            on ? 'live' : 'off',
            !on
              ? `Masqué · ${st.preset.name} · aucune apparition`
              : d?.mode === 'announce'
                ? `Armé · ${st.preset.name} · ${d.announce_s} s à chaque nouveau titre`
                : d?.mode === 'hybrid'
                  ? `Affiché · ${st.preset.name} · pastille, agrandie à chaque titre`
                  : `Affiché en permanence · ${st.preset.name}`,
          )
        : stateChip('w', error || 'Lecture…'),
    );
    patch(
      p.actions,
      st
        ? `<button type="button" class="d-btn ghost" data-act="mox-pulse" title="${d?.mode === 'announce' ? `Montre l’overlay maintenant, ${d.announce_s} s, avec le titre réel` : 'Rejoue l’apparition sur le stream avec le titre réel'}">${ic('sparkle')}${d?.mode === 'announce' ? 'Montrer maintenant' : 'Tester sur le stream'}</button>
           <button type="button" class="d-btn ${on ? '' : 'pri'}" data-act="mox-visible" data-on="${on ? '0' : '1'}" title="${on ? 'Cache l’overlay tout de suite ; plus aucune apparition automatique' : d?.mode === 'announce' ? 'Arme l’overlay : il apparaîtra au prochain titre' : 'Affiche l’overlay sur le stream'}">${ic(on ? 'eye' : 'eye')}${on ? 'Masquer' : 'Afficher'}</button>
           ${panelBtn(p.panel.isOpen(), 'OBS')}`
        : '',
    );
  };
  const paint = () => {
    paintHead();
    if (!st) {
      patch(z('set'), `<p class="mox-note">${esc(error || 'Lecture…')}</p>`);
      return;
    }
    const s = selected()!;
    // Updated in place (never rebuilt): the gallery's frames stay loaded; in the settings, the open sections stay open,
    // the field in use keeps its focus, a slider held or a colour picker open is not interrupted, the scroll stays.
    morph(z('lib'), libraryView(st, s.id));
    patch(z('bar'), stageBar({ source, demo, backdrop, zoom, live: st.live }));
    scale();
    z('screen').dataset.bg = backdrop;
    morph(z('set'), settingsView(st, s, save));
    patch(
      z('foot'),
      source === 'demo'
        ? `${ic('info')}Démo : visible ici seulement, rien n’est envoyé au stream.`
        : `${ic('info')}Le titre réel, tel que l’overlay le reçoit${st.preset.id === s.id ? ' (ce preset est à l’antenne)' : ' — ce preset n’est pas à l’antenne'}.`,
    );
    if (p.panel.isOpen()) p.panel.set(obsView(obs, st.url, st.visible));
    feed();
  };

  // --- data -------------------------------------------------------------------------------------------------------------
  let lastVersion = 0;
  async function read() {
    try {
      const fresh = await getJson<MoState>(API);
      const first = !st;
      st = fresh;
      error = '';
      if (first) sel = fresh.preset.id;
      if (first && fresh.repaired.length)
        toast(
          `Réglages réparés après une mise à jour : ${fresh.repaired.join(', ')}`,
          { bad: true },
        );
      if (fresh.version !== lastVersion || first) {
        lastVersion = fresh.version;
        paint();
      } else if (source === 'real') feed();
      if (first) feedCards();
    } catch (e) {
      error = `Overlay indisponible : ${(e as Error).message}`;
      paint();
    }
  }
  async function readObs() {
    try {
      obs = await getJson<MoObs>(`${API}/obs`);
    } catch {
      obs = null;
    }
    if (p.panel.isOpen() && st) p.panel.set(obsView(obs, st.url, st.visible));
  }
  const tick = poller(read, 1500);

  // --- editing ----------------------------------------------------------------------------------------------------------
  const setPath = (
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ) => {
    const keys = path.split('.');
    const last = keys.pop()!;
    let o = obj;
    for (const k of keys) o = o[k] as Record<string, unknown>;
    o[last] = value;
  };
  /** A change: shown at once in the preview, saved a moment later (a built-in model becomes « Mon … » first). */
  const HUES = new Set([
    'colors.accent',
    'colors.text',
    'colors.artist',
    'colors.muted',
    'colors.background',
  ]);
  const getPath = (obj: Record<string, unknown>, path: string) =>
    path
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
  const change = (path: string, value: unknown, repaint = true) =>
    changeAll([[path, value]], repaint);
  async function changeAll(updates: [string, unknown][], repaint = true) {
    const s = selected();
    if (!s || !st) return;
    const next = structuredClone(s.settings) as MoSettings;
    for (const [path, raw] of updates) {
      // A choice made by a button carries text: a numeric setting gets its number back.
      const value =
        typeof getPath(next as unknown as Record<string, unknown>, path) ===
          'number' && typeof raw === 'string'
          ? Number(raw)
          : raw;
      setPath(next as unknown as Record<string, unknown>, path, value);
      // A colour changed by hand: the palette becomes « Perso ».
      if (HUES.has(path)) next.palette = 'custom';
    }
    draft = next;
    feed();
    if (repaint) paint();
    if (s.builtin) {
      // The model stays intact: a variant carries the change (created now, then saved like any change).
      if (saveTimer) clearTimeout(saveTimer);
      save = { state: 'saving' };
      try {
        const out = await postJson<
          { variant: { id: string; name: string } } & MoState
        >(`${API}/variant`, {
          base: s.base,
          settings: next,
        });
        st = out;
        sel = out.variant.id;
        draft = null;
        save = { state: 'saved' };
        toast(
          `Variante « ${out.variant.name} » créée : tes réglages y sont enregistrés.`,
        );
      } catch (e) {
        save = { state: 'error', error: errWord(e) };
      }
      paint();
      return;
    }
    save = { state: 'saving' };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), SAVE_MS);
  }
  async function flush() {
    saveTimer = null;
    const s = selected();
    if (!s || s.builtin || !draft) return;
    const body = { id: s.id, base: s.base, settings: draft };
    try {
      const out = await postJson<MoState>(`${API}/variant`, body);
      st = out;
      lastVersion = out.version;
      // Edited again meanwhile: the newer draft stays (saved at its own turn).
      if (!saveTimer) draft = null;
      save = { state: saveTimer ? 'saving' : 'saved' };
    } catch (e) {
      save = { state: 'error', error: errWord(e) };
    }
    paint();
  }
  const errWord = (e: unknown) => {
    const code =
      (e as { code?: string; message?: string }).code ?? (e as Error).message;
    return OBS_ERRORS[code] ?? code;
  };
  const pick = async (id: string) => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      await flush();
    }
    sel = id;
    draft = null;
    save = { state: 'idle' };
    previewGen++;
    paint();
  };

  // --- events -----------------------------------------------------------------------------------------------------------
  p.root.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.num) {
      const v = Number(t.value);
      const b = t.parentElement?.querySelector('b');
      if (b)
        b.textContent = `${v}${b.textContent?.replace(/^-?[\d.]+/, '') ?? ''}`;
      void change(t.dataset.num, v, false);
    } else if (t.dataset.color) {
      const code = t.parentElement?.querySelector('code');
      if (code) code.textContent = t.value;
      void change(t.dataset.color, t.value, false);
    }
  });
  p.root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.bool) void change(t.dataset.bool, t.checked);
    else if ((t as unknown as HTMLSelectElement).dataset.pickSet)
      void change(
        (t as unknown as HTMLSelectElement).dataset.pickSet!,
        t.value,
      );
    else if (t.dataset.num || t.dataset.color) paint();
  });
  const actions: Record<string, (el: HTMLElement) => unknown> = {
    'mox-visible': (el) =>
      run(
        el,
        async () => {
          st = await postJson<MoState>(`${API}/visible`, {
            visible: el.dataset.on === '1',
          });
          lastVersion = st.version;
          paint();
        },
        el.dataset.on === '1'
          ? st?.preset.settings.display.mode === 'announce'
            ? 'Overlay armé : il apparaîtra au prochain titre'
            : 'Overlay affiché'
          : 'Overlay masqué : plus aucune apparition',
      ),
    'mox-pulse': (el) =>
      run(
        el,
        () => postJson(`${API}/pulse`, {}),
        st?.visible
          ? 'Animation rejouée sur le stream'
          : 'Animation envoyée (l’overlay est masqué : rien ne se voit)',
      ),
    'mox-replay': () => {
      previewPulse++;
      previewGen++;
      feed();
    },
    'mox-onair': async (el) => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        await flush();
      }
      return run(
        el,
        async () => {
          st = await postJson<MoState>(`${API}/active`, { id: selected()!.id });
          lastVersion = st.version;
          paint();
        },
        'Preset mis à l’antenne',
      );
    },
    'mox-dup': (el) =>
      run(el, async () => {
        const out = await postJson<
          { variant: { id: string; name: string } } & MoState
        >(`${API}/variant/duplicate`, { id: selected()!.id });
        st = out;
        await pick(out.variant.id);
        toast(`« ${out.variant.name} » créée`);
      }),
    'mox-rename': async (el) => {
      const s = selected()!;
      const name = window.prompt('Nouveau nom de la variante', s.name)?.trim();
      if (!name || name === s.name) return;
      return run(
        el,
        async () => {
          st = await postJson<MoState>(`${API}/variant/rename`, {
            id: s.id,
            name,
          });
          paint();
        },
        'Variante renommée',
      );
    },
    'mox-reset': async (el) => {
      const s = selected()!;
      if (
        !(await confirmBox({
          title: 'Revenir aux valeurs par défaut ?',
          body: `« ${s.name} » reprend les réglages de son modèle. Son nom est gardé.`,
          yes: 'Revenir aux valeurs par défaut',
          no: 'Annuler',
          danger: false,
        }))
      )
        return;
      return run(
        el,
        async () => {
          st = await postJson<MoState>(`${API}/variant/reset`, { id: s.id });
          draft = null;
          previewGen++;
          paint();
        },
        'Valeurs par défaut rétablies',
      );
    },
    'mox-delete': async (el) => {
      const s = selected()!;
      const onAir = st?.preset.id === s.id;
      if (
        !(await confirmBox({
          title: 'Supprimer cette variante ?',
          body: onAir
            ? `« ${s.name} » est à l’antenne : son modèle d’origine la remplace.`
            : `« ${s.name} » sera supprimée.`,
          yes: 'Supprimer',
        }))
      )
        return;
      return run(
        el,
        async () => {
          st = await postJson<MoState>(`${API}/variant/delete`, { id: s.id });
          await pick(st.preset.id);
        },
        'Variante supprimée',
      );
    },
    'mox-copy-url': () =>
      st &&
      copy(
        st.url,
        'Adresse copiée (garde-la pour toi : elle contient une clé)',
      ),
    'mox-obs-refresh': () => readObs(),
    'mox-obs-install': async (el) => {
      if (
        !(await confirmBox({
          title: 'Installer dans OBS ?',
          body: 'Studio crée une scène à part « Raptoru · Musique (overlay) » avec une source navigateur « Raptoru · Musique ». Aucune de tes scènes n’est modifiée, rien n’est supprimé.',
          yes: 'Installer',
          no: 'Annuler',
          danger: false,
        }))
      )
        return;
      return run(
        el,
        async () => {
          const out = await postJson<{ created: boolean; status: MoObs }>(
            `${API}/obs/install`,
            {},
          );
          obs = out.status;
          toast(
            out.created
              ? 'Source créée et confirmée par OBS'
              : 'La source existait déjà : rien de créé',
          );
          if (st) p.panel.set(obsView(obs, st.url, st.visible));
        },
        undefined,
        OBS_ERRORS,
      );
    },
    'mox-obs-add': async (el) => {
      const scene =
        p.panel.body?.querySelector<HTMLSelectElement>(
          '[data-obs-scene]',
        )?.value;
      if (!scene) return;
      if (
        !(await confirmBox({
          title: `Ajouter à « ${scene} » ?`,
          body: 'La source « Raptoru · Musique » est ajoutée à cette scène, au-dessus des autres. Rien n’est retiré ni remplacé.',
          yes: 'Ajouter',
          no: 'Annuler',
          danger: false,
        }))
      )
        return;
      return run(
        el,
        async () => {
          const out = await postJson<{ added: boolean; status: MoObs }>(
            `${API}/obs/add`,
            { scene },
          );
          obs = out.status;
          toast(
            out.added
              ? `Ajoutée à « ${scene} » (confirmé par OBS)`
              : `Déjà dans « ${scene} »`,
          );
          if (st) p.panel.set(obsView(obs, st.url, st.visible));
        },
        undefined,
        OBS_ERRORS,
      );
    },
    'mox-obs-repair': (el) =>
      run(
        el,
        async () => {
          const out = await postJson<{ status: MoObs }>(
            `${API}/obs/repair`,
            {},
          );
          obs = out.status;
          if (st) p.panel.set(obsView(obs, st.url, st.visible));
        },
        'Adresse réparée (confirmé par OBS)',
        OBS_ERRORS,
      ),
  };
  p.root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-panel]')) {
      setTimeout(() => {
        paintHead();
        if (p.panel.isOpen()) void readObs();
      });
      return;
    }
    const pk = t.closest<HTMLElement>('[data-pick]');
    if (pk) return void pick(pk.dataset.pick!);
    const sg = t.closest<HTMLElement>('[data-seg]');
    if (sg) return void change(sg.dataset.seg!, sg.dataset.v!);
    const pal = t.closest<HTMLElement>('[data-palette]');
    if (pal && st) {
      const c = st.palettes[pal.dataset.palette!]!;
      const s = selected()!;
      const colors = {
        ...s.settings.colors,
        accent: c.accent,
        text: c.text,
        artist: c.artist,
        muted: c.muted,
        background: c.background,
      };
      void changeAll([
        ['colors', colors],
        ['palette', pal.dataset.palette!],
        // The request tab in the palette's accent.
        ['request_tab.background', c.accent],
        ['request_tab.text', c.on_accent],
      ]);
      return;
    }
    const look = t.closest<HTMLElement>('[data-look]');
    if (look) {
      const r = READABILITY[look.dataset.look!];
      if (!r) return;
      void changeAll([
        ...Object.entries(r.colors).map(
          ([k, v]) => [`colors.${k}`, v] as [string, unknown],
        ),
        ['palette', 'custom'],
      ]);
      return;
    }
    const src = t.closest<HTMLElement>('[data-src]');
    if (src) {
      source = src.dataset.src as 'real' | 'demo';
      previewGen++;
      return paint();
    }
    const dm = t.closest<HTMLElement>('[data-demo]');
    if (dm) {
      demo = dm.dataset.demo as DemoId;
      return paint();
    }
    const zm = t.closest<HTMLElement>('[data-zoom]');
    if (zm) {
      zoom = zm.dataset.zoom === '1';
      return paint();
    }
    const bg = t.closest<HTMLElement>('[data-bg]');
    if (bg) {
      backdrop = bg.dataset.bg!;
      return paint();
    }
    const el = t.closest<HTMLElement>('[data-act]');
    if (el && st) void actions[el.dataset.act!]?.(el);
  });

  paint();
  return {
    setVisible(v: boolean) {
      if (v) {
        tick.start();
        scale();
      } else tick.stop();
    },
  };
}
