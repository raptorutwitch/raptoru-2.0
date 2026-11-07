import {
  confirmBox,
  drawer,
  errText,
  esc,
  hhmm,
  ic,
  menu,
  page,
  panelBtn,
  patch,
  poller,
  pop,
  run,
  scrub,
  seg,
  stateChip,
  toast,
} from '../ds/ds.js';
import {
  ApiError,
  getJson,
  postJson,
  STUDIO_HEADERS,
  tryGetJson,
} from '../http.js';
import { CLEAR_QUEUE_CONFIRM, clearedText } from '../shell/regie.js';
import { setNavCount } from '../shell/shell.js';
import { inspectorHtml } from './alerts-inspector.js';
import { askThumb, askWave, forgetMedia } from './alerts-media.js';
import {
  type AlertItem,
  type AlertsState,
  type AlertVariantInfo,
  chance,
  type Clip,
  clipsOf,
  type FakeData,
  FAMILIES,
  FOLLOW,
  familyById,
  familyEvent,
  type FamilyMode,
  type FxKey,
  GIFT_MIN,
  failureText,
  isHalloween,
  lengthOf,
  markLabel,
  moveClip,
  overlapCategories,
  PRESETS,
  previewData,
  previewStatus,
  queueHtml,
  scrubLabel,
  setFx,
  STATUS,
  togglePool,
  toggleFollow,
  TYPE_LABEL,
  type VariantSettings,
  variantName,
} from './alerts-model.js';
import {
  type CalibElement,
  identity,
  placeOf,
  samePlacement,
  setField,
  TEXT_PARTS,
  type VariantLook,
  type VariantPlacement,
} from './alerts-place.js';
import { mountSources } from './alerts-sources.js';
import { mountStage } from './alerts-stage.js';
import {
  dragClip,
  type TimelineDrag,
  tracksHtml,
  transportHtml,
} from './alerts-timeline.js';

// Alertes : un éditeur posé sur le vrai rendu. La scène est le moteur de la source OBS, la timeline en règle les temps, l'inspecteur
// montre ce qu'on a saisi. Ce qui est modifié reste un brouillon dans l'aperçu jusqu'à « Enregistrer » : la source OBS joue les
// valeurs enregistrées, dès la prochaine alerte de la variante. « Envoyer en file » passe par la vraie file du Core, qui tire lui-même
// la variante. Le mode d'une famille et le tirage partent tout de suite au Core, qui les valide.

interface Frame {
  ms: number;
  lengthMs: number;
  videoMs: number;
  marks: { at: number; action: string }[];
}

export function mountAlerts(root: HTMLElement) {
  const p = page(root, { title: 'Alertes', mod: 'alerts', panel: true });
  p.body.innerHTML = `<div class="alr">
    <nav class="alr-f" data-z="fams" aria-label="Familles d’alertes"></nav>
    <div class="alr-m">
      <div class="alr-box0" data-z="stage"></div>
      <div class="alr-tl">
        <div class="alr-ctl" data-z="ctl"></div>
        <div class="alr-grid" data-z="tracks"></div>
        <p class="alr-marks" data-z="marks"></p>
      </div>
    </div>
    <aside class="alr-i d-scroll" data-z="insp" aria-label="Inspecteur"></aside>
    <div class="alr-qs" data-z="qs"></div>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let cat: AlertVariantInfo[] = [];
  let catError = '';
  let st: AlertsState | null = null;
  let stError = '';
  let settings: VariantSettings | null = null;
  const saved = new Map<string, VariantPlacement>();
  const drafts = new Map<string, VariantPlacement>();
  let famId = 'follow';
  let vid: string | null = null;
  let sel: CalibElement | 'sound' | null = null;
  let presetKey = 'normal';
  let fake: FakeData = { ...PRESETS.normal!.data };
  let volume = 50;
  let playing = false;
  let previewLine = '';
  let ms = 0;
  let lengthMs = 0;
  let videoMs = 0;
  let marks: Frame['marks'] = [];
  let run_ = 0;
  let last: { variant: AlertVariantInfo; data: unknown } | null = null;
  let playStart = 0;
  let raf = 0;
  let repaintInsp = false;
  /** Un curseur est tenu dans l'inspecteur : pas de réécriture sous la souris. */
  let holding = false;

  const cur = () => cat.find((v) => v.id === vid) ?? null;
  const familyList = (id = famId) =>
    cat
      .filter(familyById(id).has)
      .sort(
        (a, b) =>
          FOLLOW.findIndex(([v]) => v === a.id) -
          FOLLOW.findIndex(([v]) => v === b.id),
      );
  const savedOf = (id: string) => saved.get(id) ?? identity();
  const draftOf = (id: string) => drafts.get(id) ?? savedOf(id);
  const dirty = (id: string) => !samePlacement(draftOf(id), savedOf(id));
  const lookOf = (id: string) => draftOf(id).look ?? {};
  const isTextSel = () => sel !== null && sel !== 'media' && sel !== 'sound';
  const modeOf = (id: string): FamilyMode => settings?.families[id] ?? 'auto';

  /** Les éléments modifiables : l'alerte, puis ses blocs de texte s'il y en a, sinon ses textes d'un seul tenant. */
  const elements = () => {
    const v = cur();
    if (!v) return [];
    const parts = TEXT_PARTS[v.textStyle ?? ''] ?? [];
    const moved = placeOf(draftOf(v.id), 'text');
    const textMoved = moved.x !== 0 || moved.y !== 0 || moved.scale !== 1;
    return [
      { id: 'media', label: 'Toute l’alerte' },
      ...(parts.length && !textMoved
        ? []
        : [{ id: 'text', label: parts.length ? 'Textes' : 'Texte' }]),
      ...parts,
    ];
  };
  const firstTextEl = () =>
    elements().find((e) => e.id !== 'media')?.id ?? 'text';
  const textMs = () => {
    const v = cur();
    const c = v && clipsOf(v, lookOf(v.id))[0];
    return c ? Math.round(c.in + Math.min(800, (c.end - c.in) / 2)) : 0;
  };
  const data = () => {
    const v = cur()!;
    return previewData(familyEvent(famId, v, fake));
  };

  // --- Aperçu ------------------------------------------------------------------------------------------------------------
  let seeking = false;
  let queuedSeek: number | null = null;
  let seekGuard = 0;
  let busyTimer = 0;
  const stage = mountStage(z('stage'), {
    elements,
    selected: () => (sel === 'sound' ? null : sel),
    select(el) {
      pick(el);
    },
    placement: () => (vid ? draftOf(vid) : null),
    edit(next, done) {
      if (!vid) return;
      drafts.set(vid, next);
      stage.send({ type: 'place', placement: next });
      paintCtl();
      afterPlace();
      if (done) paintTracks();
    },
    onMessage: (m) => onPreview(m),
  });
  /** L'aperçu applique le placement au message suivant : on relit ses boîtes ensuite. */
  const afterPlace = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        stage.refresh();
        paintInsp();
      }),
    );

  function seek(at: number) {
    const v = cur();
    ms = Math.max(0, Math.round(lengthMs ? Math.min(at, lengthMs) : at));
    paintHead();
    if (!v || v.missing.length) return;
    if (seeking) {
      queuedSeek = ms;
      return;
    }
    seeking = true;
    clearTimeout(busyTimer);
    busyTimer = window.setTimeout(() => stage.setBusy(true), 250);
    clearTimeout(seekGuard);
    // Un fichier à décoder depuis son début peut prendre du temps ; sans réponse, on ne bloque pas la timeline.
    seekGuard = window.setTimeout(seekDone, 8000);
    stage.send({
      type: 'seek',
      variant: v,
      data: data(),
      ms,
      placement: draftOf(v.id),
    });
  }
  const seekDone = () => {
    seeking = false;
    clearTimeout(seekGuard);
    clearTimeout(busyTimer);
    stage.setBusy(false);
    if (queuedSeek !== null) {
      const q = queuedSeek;
      queuedSeek = null;
      seek(q);
    }
  };

  function onPreview(m: Record<string, unknown>) {
    if (m.type === 'ready') {
      // Un aperçu tout neuf n'a rien reçu : on repart de l'image en cours.
      seeking = false;
      queuedSeek = null;
      if (cur()) seek(ms);
      return;
    }
    if (m.run !== undefined && (m.run as number) < run_) return;
    run_ = (m.run as number | undefined) ?? run_;
    if (m.type === 'frame') {
      const f = m as unknown as Frame;
      lengthMs = Math.max(1, Math.ceil(f.lengthMs));
      videoMs = f.videoMs || videoMs;
      marks = f.marks;
      stage.refresh();
      paintTracks();
      paintHead();
      paintInsp();
      seekDone();
      return;
    }
    if (m.type !== 'state') return;
    const state = m.state as string;
    previewLine = previewStatus(
      m as { state: string; reason?: string; ms?: number },
    );
    if (state === 'playing') {
      playStart = performance.now();
      startClock();
    }
    if (state === 'ended') {
      seekDone();
      if (playing) {
        setPlaying(false);
        seek(textMs());
      }
    }
    paintMarks();
  }

  const startClock = () => {
    cancelAnimationFrame(raf);
    const step = () => {
      if (!playing) return;
      ms = performance.now() - playStart;
      movePlayhead();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  function setPlaying(on: boolean) {
    playing = on;
    stage.setPlaying(on);
    if (!on) cancelAnimationFrame(raf);
    paintHeadActions();
    paintCtl();
  }

  function play() {
    const v = cur();
    if (!v || v.missing.length) return;
    if (playing) {
      stage.send({ type: 'stop' });
      setPlaying(false);
      seek(textMs());
      return;
    }
    last = { variant: v, data: data() };
    ms = 0;
    setPlaying(true);
    stage.send({
      type: 'play',
      ...last,
      volume: volume / 100,
      placement: draftOf(v.id),
    });
  }

  /** Superposer : une alerte de chaque autre famille joue à côté, à sa place enregistrée. Local, jamais dans la file. */
  function overlap() {
    const v = cur();
    if (!v || v.missing.length) return;
    if (playing) return play();
    play();
    stage.send({
      type: 'overlay',
      volume: volume / 100,
      items: overlapCategories(v.type).flatMap((cat2) => {
        const x = cat.find((c) => c.type === cat2 && !c.missing.length);
        if (!x) return [];
        const fam = FAMILIES.find((f) => f.has(x))!.id;
        return [
          {
            variant: x,
            data: previewData(familyEvent(fam, x, fake)),
            placement: savedOf(x.id),
          },
        ];
      }),
    });
  }

  // --- Choix ---------------------------------------------------------------------------------------------------------------
  function resetView() {
    const v = cur();
    lengthMs = v ? lengthOf(v) : 0;
    videoMs = v ? (v.duration ? v.duration + 300 : (v.mediaMs ?? lengthMs)) : 0;
    marks = [];
    previewLine = '';
    if (!v) return paintAll();
    stage.setMissing(v.missing.length ? missingHtml(v) : null);
    if (v.missing.length) stage.send({ type: 'stop' });
    ms = textMs();
    paintAll();
    seek(ms);
  }
  const missingHtml = (v: AlertVariantInfo) =>
    `<div><b>Média manquant</b><p>${v.missing.map(esc).join('<br>')}</p><button type="button" class="d-btn sm pri" data-a="media-help">${ic('upload')}${sources.media()?.can_import ? 'Importer mes fichiers' : 'Voir les médias'}</button></div>`;

  function pickFamily(id: string) {
    if (playing) play();
    famId = id;
    const list = familyList();
    vid = (list.find((v) => !v.missing.length) ?? list[0])?.id ?? null;
    sel = null;
    resetView();
  }
  function pickVariant(id: string) {
    if (id === vid) return;
    if (playing) play();
    vid = id;
    const min = GIFT_MIN[id];
    if (min) fake = { ...fake, count: min };
    resetView();
  }
  /** Sélection sur la scène ou la timeline : l'image se met sur le texte s'il n'est pas à l'écran. */
  function pick(el: CalibElement | 'sound' | null) {
    sel = el;
    paintTracks();
    paintInsp();
    if (el && el !== 'media' && el !== 'sound' && !stage.box(el))
      seek(textMs());
  }

  // --- Lectures ----------------------------------------------------------------------------------------------------------
  async function readCatalog() {
    try {
      const r = await getJson<{ variants: AlertVariantInfo[] }>(
        '/api/alerts/catalog',
      );
      const had = cat.length;
      const before = cur();
      cat = r.variants.map((v) => ({ ...v, missing: v.missing ?? [] }));
      catError = '';
      if (!had) pickFamily(famId);
      else {
        const v = cur();
        const wasMissing = !!before?.missing.length;
        stage.setMissing(v?.missing.length ? missingHtml(v) : null);
        // Le fichier vient d'arriver : l'image peut enfin se montrer.
        if (wasMissing && v && !v.missing.length) resetView();
        else paintAll();
      }
    } catch (e) {
      catError = errText(e);
      paintAll();
    }
  }
  async function readPlacements() {
    const r = await tryGetJson<{ variants: Record<string, VariantPlacement> }>(
      '/api/alerts/placement',
    );
    if (!r) return;
    saved.clear();
    for (const [k, v] of Object.entries(r.variants)) saved.set(k, v);
  }
  async function readSettings() {
    settings = await tryGetJson<VariantSettings>('/api/alerts/variants');
    paintFams();
    paintInsp();
  }
  async function readState() {
    try {
      const s = await getJson<AlertsState & { enabled?: false }>(
        '/api/alerts/state',
      );
      if (s.enabled === false) throw new Error('alertes indisponibles ici');
      st = s;
      stError = '';
    } catch (e) {
      stError = errText(e);
    }
    setNavCount('alerts', st?.queued.length ? String(st.queued.length) : null);
    paintQueue();
    paintState();
    paintHeadActions();
    if (!cat.length) void readCatalog();
    if (p.panel.isOpen()) sources.paint();
  }
  let reads = 0;
  const tick = poller(async () => {
    await readState();
    // Les sources bougent moins vite que la file : un relevé sur quatre.
    if (reads++ % 4 === 0) {
      await sources.read();
      paintHeadActions();
      paintInsp();
    }
  }, 1500);

  const sources = mountSources(p, {
    state: () => st,
    onMedia() {
      forgetMedia();
      void readCatalog();
    },
    onRules: () => paintInsp(),
  });

  // --- Peinture ----------------------------------------------------------------------------------------------------------
  const paintState = () => {
    const src = st?.source;
    patch(
      p.state,
      stError
        ? stateChip('r', 'Serveur injoignable')
        : !src
          ? ''
          : src.seen
            ? stateChip('', 'Source OBS vue')
            : stateChip('w', 'Source OBS absente'),
    );
  };
  const paintHeadActions = () => {
    const tw = sources.twitch();
    const prod = st?.environment === 'production';
    const managed = tw?.managed_by === 'production_bot';
    const v = cur();
    const segment = seg(
      'data-tw',
      [
        ['off', 'Off'],
        ['test', 'Test'],
        ['active', 'Actif'],
      ],
      tw?.mode ?? 'off',
    ).replaceAll('<button', managed ? '<button disabled' : '<button');
    patch(
      p.actions,
      `<span class="alr-lab">Événements Twitch</span>${segment}<button type="button" class="d-btn" data-a="send" ${v ? '' : 'disabled'}>${prod ? 'Jouer sur le stream' : 'Envoyer en file'}</button><button type="button" class="d-btn pri" data-a="play" ${v && !v.missing.length ? '' : 'disabled'}>${ic(playing ? 'stop' : 'play')}${playing ? 'Arrêter' : 'Jouer'}</button>${panelBtn(p.panel.isOpen())}`,
    );
  };
  const paintFams = () => {
    patch(
      z('fams'),
      FAMILIES.map((f) => {
        const list = familyList(f.id);
        const missing =
          list.length > 0 && list.every((v) => v.missing.length > 0);
        const off = modeOf(f.id) === 'off';
        const n = list.filter((v) => !isHalloween(v)).length;
        return `<button type="button" class="alr-fm ${f.id === famId ? 'on' : ''} ${off ? 'off' : ''}" style="--c:var(--${f.color})" data-fam="${f.id}" aria-pressed="${f.id === famId}"><i></i><span>${esc(f.label)}</span><em>${off ? 'off' : missing ? '!' : n > 1 ? n : ''}</em><span class="t" data-hit="${f.id}" role="button" aria-label="Jouer ${esc(f.label)}">${ic('play')}</span></button>`;
      }).join(''),
    );
  };
  const paintCtl = () => {
    const v = cur();
    patch(
      z('ctl'),
      transportHtml(playing, !v || v.missing.length > 0, {
        dirty: !!v && dirty(v.id),
        others: [...drafts.keys()].filter((k) => k !== vid && dirty(k)).length,
        volume,
      }),
    );
    paintHead();
  };
  const trackSel = () => (isTextSel() ? 'text' : sel);
  const paintTracks = () => {
    const v = cur();
    if (!v) {
      patch(
        z('tracks'),
        `<p class="d-note bad" style="grid-column:1 / -1">${catError ? `Catalogue indisponible : ${esc(catError)}` : 'Chargement…'}</p>`,
      );
      if (catError)
        stage.setMissing(
          '<b>Aperçu indisponible</b><span>Le serveur de Studio ne répond pas pour les alertes.</span>',
        );
      return;
    }
    const f = familyById(famId);
    const look = lookOf(v.id);
    const name = v.audio ?? v.video;
    if (name && !v.missing.includes(name)) askWave(name, paintTracks);
    patch(
      z('tracks'),
      tracksHtml({
        v,
        look,
        length: Math.max(1, lengthMs),
        videoMs,
        sel: trackSel(),
        color: f.color,
        marks,
      }),
    );
    movePlayhead();
    paintMarks();
  };
  const paintMarks = () =>
    patch(
      z('marks'),
      esc([previewLine, ...marks.map(markLabel)].filter(Boolean).join(' · ')),
    );
  const movePlayhead = () => {
    const ph = p.body.querySelector<HTMLElement>('[data-ph]');
    if (ph)
      ph.style.left = `${Math.min(100, (ms / Math.max(1, lengthMs)) * 100)}%`;
    const tc = p.body.querySelector<HTMLElement>('[data-tc]');
    if (tc)
      tc.textContent = `${scrubLabel(ms, cur()?.fps)} / ${((lengthMs || 0) / 1000).toFixed(1).replace('.', ',')} s`;
  };
  const paintHead = () => movePlayhead();

  function paintInsp() {
    const host = z('insp');
    const a = document.activeElement;
    if (holding || (host.contains(a) && a?.matches('input,textarea,select'))) {
      repaintInsp = true;
      return;
    }
    repaintInsp = false;
    const v = cur();
    const family = familyById(famId);
    const list = familyList();
    for (const x of list)
      if (x.video && !x.missing.includes(x.video))
        askThumb(
          x.video,
          (x.showAt ?? x.subtitles?.[0]?.showAt ?? 800) + 300,
          paintInsp,
        );
    const el = isTextSel() ? sel! : 'media';
    patch(
      host,
      inspectorHtml({
        family,
        variants: list,
        cur: v,
        settings,
        pools: sources.pools(),
        mode: modeOf(famId),
        presetKey,
        fake,
        look: v ? lookOf(v.id) : {},
        unsaved: [...drafts.keys()].filter(dirty),
        canReplace: !!sources.media()?.can_import,
        sel,
        selLabel: elements().find((e) => e.id === sel)?.label ?? 'Texte',
        place: v ? placeOf(draftOf(v.id), el) : { x: 0, y: 0, scale: 1 },
        box: stage.box(el),
        sharedBy: v?.id === 'eren_sub' ? ['Sub', 'Sub Prime', 'Resub'] : [],
      }),
    );
  }
  function paintQueue() {
    if (stError && !st) {
      patch(
        z('qs'),
        `<span class="d-lb">File</span><span class="d-note bad">File indisponible : ${esc(stError)}</span>`,
      );
      return;
    }
    const s = st;
    const lastOne = s?.recent[0];
    patch(
      z('qs'),
      `<span class="d-lb">File</span>${s && (s.in_flight.length || s.queued.length) ? queueHtml(s) : '<span class="d-faint">Vide</span>'}${s?.queued.length ? '<button type="button" class="d-btn ghost sm" data-a="clear">Vider</button>' : ''}<span class="d-sp"></span>${lastOne ? `<span class="d-faint alr-last">Dernière : ${esc(lastOne.data.pseudo)}, ${hhmm(lastOne.ended_at ?? lastOne.created_at)}</span>` : ''}<button type="button" class="d-btn ghost sm" data-a="history">${ic('hist')}Historique</button>`,
    );
  }
  function paintAll() {
    paintFams();
    paintHeadActions();
    paintCtl();
    paintTracks();
    paintInsp();
    paintQueue();
    paintState();
  }

  // --- Réglages d'une variante --------------------------------------------------------------------------------------------
  const setLook = (next: VariantLook) => {
    if (!vid) return;
    const d = { ...draftOf(vid) };
    if (Object.keys(next).length) d.look = next;
    else delete d.look;
    drafts.set(vid, d);
    paintCtl();
    paintTracks();
    paintInsp();
    seek(ms);
  };
  async function save(btn: HTMLElement | null) {
    const v = cur();
    if (!v) return;
    const body = draftOf(v.id);
    await run(
      btn,
      async () => {
        const res = await fetch(`/api/alerts/placement/${v.id}`, {
          method: 'PUT',
          headers: STUDIO_HEADERS,
          body: JSON.stringify(body),
        });
        const out = (await res.json()) as {
          placement?: VariantPlacement;
          error?: string;
        };
        if (!res.ok || !out.placement)
          throw new ApiError(res.status, out.error ?? `HTTP ${res.status}`);
        saved.set(v.id, out.placement);
        drafts.set(v.id, out.placement);
      },
      'Enregistré. La source OBS l’utilisera dès la prochaine alerte de cette variante.',
      { invalid_placement: 'Réglage refusé : une valeur sort des limites.' },
    );
    paintCtl();
  }
  function revert() {
    if (!vid) return;
    drafts.delete(vid);
    stage.send({ type: 'place', placement: savedOf(vid) });
    afterSeek();
  }
  const afterSeek = () => {
    paintCtl();
    paintTracks();
    paintInsp();
    seek(ms);
  };
  /** Remet l'alerte ou ses textes à leur place d'origine. Reste un brouillon jusqu'à l'enregistrement. */
  function resetPart(what: 'media' | 'text') {
    if (!vid) return;
    const d = draftOf(vid);
    const next: VariantPlacement =
      what === 'media'
        ? { ...d, media: identity().media }
        : { media: d.media, text: identity().text };
    if (what === 'media') {
      const look = { ...d.look };
      delete look.mediaEnter;
      delete look.mediaExit;
      if (Object.keys(look).length) next.look = look;
      else delete next.look;
    } else {
      const look = { ...d.look };
      for (const k of [
        'showAt',
        'hideAt',
        'subtitles',
        'text',
        'textEnter',
        'textExit',
        'nameColor',
      ] as const)
        delete look[k];
      if (Object.keys(look).length) next.look = look;
    }
    drafts.set(vid, next);
    stage.send({ type: 'place', placement: next });
    afterSeek();
  }

  // --- File --------------------------------------------------------------------------------------------------------------
  async function sendToQueue(btn: HTMLElement | null) {
    const v = cur();
    if (!v) return;
    const prod = st?.environment === 'production';
    if (
      prod &&
      !(await confirmBox({
        title: 'Jouer cette alerte sur le stream ?',
        body: 'C’est une alerte fictive, mais elle passe par la vraie file : la source OBS « Alertes » la joue devant les viewers. Aucun Jeton, aucun événement Twitch.',
        yes: 'Jouer sur le stream',
        no: 'Annuler',
        danger: false,
      }))
    )
      return;
    await run(btn, async () => {
      const out = await postJson<{
        outcome?: string;
        alert?: { variant_id?: string } | null;
      }>('/api/alerts/test', familyEvent(famId, v, fake));
      const said: Record<string, string> = {
        queued: `En file : ${variantName(out.alert?.variant_id ?? v.id)}${vid && dirty(vid) ? ' (dernière version enregistrée)' : ''}.`,
        duplicate: 'Déjà reçue : rien de plus dans la file.',
        absorbed: 'Comptée dans le subgift en cours.',
        below_threshold: 'Sous le seuil : pas d’alerte (moins de 10 Bits).',
        disabled: `${familyById(famId).label} est sur Off : l’événement est noté, pas d’animation.`,
      };
      toast(said[out.outcome ?? ''] ?? `Réponse : ${out.outcome}`);
    });
    tick.now();
  }
  async function clearQueue(btn: HTMLElement | null) {
    const [title, ...rest] = CLEAR_QUEUE_CONFIRM.split('\n\n');
    if (
      !(await confirmBox({
        title: title!,
        body: rest.join(' '),
        yes: 'Vider la file',
      }))
    )
      return;
    await run(btn, async () => {
      const out = await postJson<{ cleared?: number; in_flight?: number }>(
        '/api/alerts/clear',
        {},
      );
      toast(clearedText(out.cleared ?? 0, out.in_flight ?? 0));
    });
    tick.now();
  }
  const REPLAY_ERRORS = {
    original_not_played_yet: 'Cette alerte n’a pas encore été jouée.',
    alert_not_replayable: 'Cette alerte ne se rejoue pas.',
  };
  const replay = (id: string, btn: HTMLElement | null) =>
    run(
      btn,
      async () => {
        const out = await postJson<{ already_pending?: boolean }>(
          `/api/alerts/replay/${id}`,
          { replay_key: crypto.randomUUID() },
        );
        toast(
          out.already_pending
            ? 'Un rejeu de cette alerte attend déjà dans la file.'
            : 'Rejeu envoyé : l’animation seule, jamais l’événement.',
        );
      },
      undefined,
      REPLAY_ERRORS,
    ).then(() => tick.now());
  const itemLine = (a: AlertItem) =>
    `<div class="alr-h-r" data-st="${esc(a.status)}"><div><b>${esc(a.data.pseudo)}</b><span class="d-faint">${esc(TYPE_LABEL[a.type] ?? a.type)} · ${esc(variantName(a.variant_id))}</span>${a.failure ? `<small>${esc(failureText(a))}</small>` : ''}</div><span class="d-tag ${a.status === 'completed' ? 'ok' : a.status === 'failed' ? 'bad' : 'off'}">${esc(STATUS[a.status] ?? a.status)}${a.attempts > 1 ? ` · essai ${a.attempts}` : ''}</span><span class="d-faint">${hhmm(a.ended_at ?? a.created_at)}</span>${['completed', 'failed', 'expired'].includes(a.status) ? `<button type="button" class="d-btn ghost sm" data-replay="${esc(a.alert_id)}">Rejouer</button>` : ''}</div>`;
  function history() {
    const s = st;
    const age = s?.max_age_ms
      ? `<p class="d-note">Une alerte qui attend plus de ${Math.round(s.max_age_ms / 60000)} min n’est plus jouée : elle reste ici.</p>`
      : '';
    const d = drawer({
      kicker: 'Alertes',
      title: 'Historique',
      body: `${age}${
        [...(s?.in_flight ?? []), ...(s?.queued ?? []), ...(s?.recent ?? [])]
          .map(itemLine)
          .join('') ||
        '<div class="d-empty">Aucune alerte pour l’instant.</div>'
      }`,
    });
    d.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-replay]');
      if (b) void replay(b.dataset.replay!, b);
    });
  }
  function itemMenu(anchor: HTMLElement, id: string) {
    const a = [
      ...(st?.in_flight ?? []),
      ...(st?.queued ?? []),
      ...(st?.recent ?? []),
    ].find((x) => x.alert_id === id);
    if (!a) return;
    menu(anchor, esc(`${a.data.pseudo} · ${variantName(a.variant_id)}`), [
      { label: STATUS[a.status] ?? a.status, disabled: true, run: () => {} },
      a.failure && { label: failureText(a), disabled: true, run: () => {} },
      { label: 'Voir l’historique', icon: 'hist', run: history },
    ]);
  }

  // --- Événements --------------------------------------------------------------------------------------------------------
  scrub(z('insp'), (input) => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  z('insp').addEventListener('pointerdown', () => {
    holding = true;
  });
  window.addEventListener('pointerup', () => {
    if (!holding) return;
    holding = false;
    setTimeout(() => {
      if (repaintInsp) paintInsp();
    }, 0);
  });

  const postSettings = async (body: unknown, undo?: () => void) => {
    const ok = await run(null, async () => {
      settings = await postJson<VariantSettings>('/api/alerts/variants', body);
    });
    if (!ok) await readSettings();
    paintFams();
    paintInsp();
    if (ok && undo) undo();
  };

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const tw = t.closest<HTMLElement>('[data-tw]')?.dataset.tw;
    if (tw) return void sources.setTwitch(tw as 'off').then(paintHeadActions);
    const hit = t.closest<HTMLElement>('[data-hit]')?.dataset.hit;
    if (hit) {
      ev.stopPropagation();
      pickFamily(hit);
      return play();
    }
    const fam = t.closest<HTMLElement>('[data-fam]')?.dataset.fam;
    if (fam) return pickFamily(fam);
    if (t.closest('[data-w], [data-follow], [data-ballon], .d-sw')) return;
    const variant = t.closest<HTMLElement>('[data-var]')?.dataset.var;
    if (variant) return pickVariant(variant);
    const mode = t.closest<HTMLElement>('[data-mode]')?.dataset.mode;
    if (mode) return void setMode(mode as FamilyMode);
    const preset = t.closest<HTMLElement>('[data-preset]')?.dataset.preset;
    if (preset && PRESETS[preset]) {
      presetKey = preset;
      fake = { ...PRESETS[preset].data };
      paintInsp();
      return seek(ms);
    }
    const color = t.closest<HTMLElement>('[data-color]')?.dataset.color;
    if (color !== undefined && vid) {
      const look = { ...lookOf(vid) };
      if (color) look.nameColor = color;
      else delete look.nameColor;
      return setLook(look);
    }
    if (t.closest('[data-unsel]')) return pick(null);
    const item = t.closest<HTMLElement>('[data-item]');
    if (item) return itemMenu(item, item.dataset.item!);
    const step = t.closest<HTMLElement>('[data-step]')?.dataset.step;
    if (step) return seek(ms + (Number(step) * 1000) / (cur()?.fps ?? 24));
    const btn = t.closest<HTMLElement>('[data-a]');
    const a = btn?.dataset.a;
    if (!a) return;
    if (a === 'play') return play();
    if (a === 'overlap') return overlap();
    if (a === 'send') return void sendToQueue(btn);
    if (a === 'save') return void save(btn);
    if (a === 'revert') return revert();
    if (a === 'clear') return void clearQueue(btn);
    if (a === 'history') return history();
    if (a === 'reset-text') return resetPart('text');
    if (a === 'reset-media') return resetPart('media');
    if (a === 'replace') return replaceMedia(btn!);
    if (a === 'media-help') return p.panel.open('médias');
  });

  async function setMode(mode: FamilyMode) {
    const before = modeOf(famId);
    if (mode === before) return;
    const id = famId;
    await postSettings({ families: { [id]: mode } });
    if (mode === 'off')
      toast(
        `${familyById(id).label} coupé : l’événement est noté, sans animation.`,
        {
          undo: () => void postSettings({ families: { [id]: before } }),
        },
      );
  }

  /** Lab : pointe un autre fichier pour la vidéo de la variante. L'original est seulement lu. */
  function replaceMedia(anchor: HTMLElement) {
    const v = cur();
    if (!v?.video) return;
    const name = v.video;
    const el = pop(
      anchor,
      `<form class="d-form"><h3>Remplacer ${esc(name)}</h3><label class="d-fld alr-line"><input type="text" data-file placeholder="C:\\...\\mon-fichier.webm" aria-label="Chemin du fichier" spellcheck="false"></label><p class="d-note">Dans le Lab seulement. Tes fichiers sont lus, jamais modifiés.</p><button type="submit" class="d-btn sm pri">Remplacer</button></form>`,
    );
    el.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const file = el
        .querySelector<HTMLInputElement>('[data-file]')!
        .value.trim();
      void run(
        el.querySelector('button'),
        async () => {
          await postJson('/api/alerts/media/import', { name, file });
          el.hidePopover();
          forgetMedia(name);
          stage.reload();
          await readCatalog();
        },
        'Média remplacé dans le Lab.',
        {
          file_not_found: 'Ce fichier n’existe pas.',
          bad_media: 'Il faut un fichier du même type.',
          bad_path: 'Donne le chemin complet du fichier.',
        },
      );
    });
  }

  root.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    const d = t.dataset;
    if (d.vol !== undefined) volume = Number(t.value);
    if (d.field) {
      const k = d.field as keyof FakeData;
      if (k === 'anonymous') fake.anonymous = t.checked;
      else if (
        k === 'count' ||
        k === 'bits' ||
        k === 'viewers' ||
        k === 'months'
      )
        fake[k] = Math.max(1, Math.round(Number(t.value) || 1));
      else fake[k] = t.value;
      presetKey = '';
      seek(ms);
    }
    if (d.size !== undefined && vid) {
      const el = isTextSel() ? sel! : 'media';
      const box = stage.box(el);
      if (box) {
        const next = setField(draftOf(vid), el, box, 'scale', Number(t.value));
        drafts.set(vid, next);
        stage.send({ type: 'place', placement: next });
        t.nextElementSibling!.textContent = `${t.value} %`;
        paintCtl();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => stage.refresh()),
        );
      }
    }
    if (d.w && settings) {
      settings = {
        ...settings,
        weights: { ...settings.weights, [d.w]: Number(t.value) },
      };
      for (const em of p.body.querySelectorAll<HTMLElement>('[data-wp]'))
        if ((settings.follow ?? [em.dataset.wp!]).includes(em.dataset.wp!))
          em.textContent = `${chance(settings, em.dataset.wp!)} %`;
    }
    if (d.obsVol !== undefined && vid) {
      t.nextElementSibling!.textContent = `${t.value} %`;
      const look = { ...lookOf(vid), volume: Number(t.value) / 100 };
      const draft = { ...draftOf(vid), look };
      drafts.set(vid, draft);
      paintCtl();
    }
  });

  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    const d = t.dataset;
    if (d.follow) {
      const next = toggleFollow(settings?.follow, d.follow, t.checked);
      if (next) void postSettings({ follow: next });
      else {
        toast(
          'Au moins une variante reste dans le tirage. Pour ne rien jouer : Off.',
        );
        paintInsp();
      }
      return;
    }
    if (d.w) return void postSettings({ weights: { [d.w]: Number(t.value) } });
    if (d.ballon) {
      const [kind, n] = d.ballon.split(':');
      void run(null, async () => {
        await postJson('/api/halloween/admin/settings', {
          rules: {
            halloween_ballon: togglePool(
              sources.pools() ?? undefined,
              kind as 'sub',
              Number(n),
              t.checked,
            ),
          },
        });
        await sources.read();
        paintInsp();
      });
      return;
    }
    if (!vid) return;
    const look = lookOf(vid);
    if (d.pos) {
      const el = isTextSel() ? sel! : 'media';
      const box = stage.box(el);
      if (box) {
        const next = setField(
          draftOf(vid),
          el,
          box,
          d.pos as 'x' | 'y',
          Number(t.value),
        );
        drafts.set(vid, next);
        stage.send({ type: 'place', placement: next });
        paintCtl();
        afterPlace();
      }
      return;
    }
    if (d.fxKind) return setLook(setFx(look, d.fxKind as FxKey, t.value));
    if (d.fxMs) {
      const key = d.fxMs as FxKey;
      const kind = look[key]?.kind;
      if (kind) setLook(setFx(look, key, kind, Number(t.value)));
      return;
    }
    if (d.text !== undefined) {
      const next = { ...look };
      if (t.value.trim() && t.value !== cur()?.text) next.text = t.value;
      else delete next.text;
      return setLook(next);
    }
    if (d.subText !== undefined) {
      const v = cur()!;
      const i = Number(d.subText);
      const subs: NonNullable<VariantLook['subtitles']> = (
        v.subtitles ?? []
      ).map((_, n) => ({ ...look.subtitles?.[n] }));
      if (t.value.trim() && t.value !== v.subtitles?.[i]?.text)
        subs[i]!.text = t.value;
      else delete subs[i]!.text;
      const next: VariantLook = { ...look, subtitles: subs };
      if (subs.every((s) => !Object.keys(s).length)) delete next.subtitles;
      return setLook(next);
    }
    if (d.at) {
      const v = cur()!;
      const clip = clipsOf(v, look)[0];
      if (!clip) return;
      const value = Math.round(Number(t.value) * 1000);
      const [a, b] =
        d.at === 'show'
          ? [Math.min(value, clip.end - 120), clip.end]
          : [clip.in, Math.max(value + clip.tail, clip.in + 120)];
      return setLook(moveClip(v, look, clip, a, Math.min(b, lengthMs)));
    }
    if (d.size !== undefined || d.obsVol !== undefined) paintInsp();
  });

  z('insp').addEventListener('focusout', () =>
    setTimeout(() => {
      if (repaintInsp) paintInsp();
    }, 0),
  );

  // Timeline : tête de lecture, blocs de texte, poignées, pentes de transition.
  const tracks = z('tracks');
  let drag: TimelineDrag | null = null;
  let draftClip: VariantLook | null = null;
  const timeAt = (e: PointerEvent, rect: DOMRect) =>
    ((e.clientX - rect.left) / rect.width) * lengthMs;

  tracks.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const v = cur();
    if (!v) return;
    const rul = tracks.querySelector<HTMLElement>('[data-rul]');
    const rect = rul?.getBoundingClientRect();
    if (!rect) return;
    const hold = () => {
      e.preventDefault();
      tracks.setPointerCapture(e.pointerId);
    };
    const clipEl = t.closest<HTMLElement>('[data-clip]');
    const fx = t.closest<HTMLElement>('[data-fx]')?.dataset.fx;
    const clips = clipsOf(v, lookOf(v.id));
    const clip: Clip | undefined = clips.find(
      (c) => c.key === clipEl?.dataset.clip,
    );
    if (clip) {
      if (playing) play();
      if (!isTextSel()) pick(firstTextEl());
      const edge = t.closest<HTMLElement>('[data-edge]')?.dataset.edge;
      if (edge) drag = { kind: edge as 'in', clip, rect };
      else if (fx) drag = { kind: 'fx', side: fx as 'in', clip, rect };
      else drag = { kind: 'clip', clip, rect, x: timeAt(e, rect) };
      return hold();
    }
    const track = t.closest<HTMLElement>('[data-track]')?.dataset.track;
    if (track === 'media' && fx) {
      if (sel !== 'media') pick('media');
      drag = { kind: 'fx', side: fx as 'in', clip: null, rect };
      return hold();
    }
    if (track === 'media' || track === 'sound') {
      pick(sel === track ? null : track);
      return;
    }
    if (t.closest('[data-rul]')) {
      if (playing) play();
      drag = { kind: 'scrub', rect };
      seek(timeAt(e, rect));
      hold();
      // `hold` empêche le focus par défaut : les flèches (une image, 0,01 s avec Maj) doivent marcher après un clic.
      rul!.focus();
    }
  });
  tracks.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const v = cur();
    if (!v) return;
    const at = timeAt(e, drag.rect);
    if (drag.kind === 'scrub') return seek(at);
    const base = lookOf(v.id);
    if (drag.kind !== 'fx') {
      const [a, b] = dragClip(drag, at, lengthMs);
      draftClip = moveClip(v, base, drag.clip, a, b);
    } else {
      const enter = drag.side === 'in';
      const key: FxKey = drag.clip
        ? enter
          ? 'textEnter'
          : 'textExit'
        : enter
          ? 'mediaEnter'
          : 'mediaExit';
      const from = drag.clip?.in ?? 0;
      const to = drag.clip?.end ?? videoMs;
      const len = enter ? at - from : to - at;
      draftClip = setFx(
        base,
        key,
        base[key]?.kind ?? 'fade',
        Math.max(0, Math.min(5000, len)),
      );
    }
    const d = { ...draftOf(v.id), look: draftClip };
    drafts.set(v.id, d);
    paintTracks();
  });
  const endDrag = () => {
    const had = drag && drag.kind !== 'scrub';
    drag = null;
    if (had && draftClip) {
      const look = draftClip;
      draftClip = null;
      setLook(look);
    }
  };
  tracks.addEventListener('pointerup', endDrag);
  tracks.addEventListener('pointercancel', endDrag);
  tracks.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    // Une image par flèche, un centième de seconde avec Maj.
    const step = e.shiftKey ? 10 : 1000 / (cur()?.fps ?? 24);
    seek(ms + (e.key === 'ArrowLeft' ? -step : step));
  });

  void readPlacements().then(() => {
    void readSettings();
    void readCatalog();
  });
  paintAll();

  return {
    setVisible(v: boolean) {
      if (v) {
        tick.start();
        void readPlacements();
        if (!cat.length) void readCatalog();
      } else {
        tick.stop();
        if (playing) play();
        else stage.send({ type: 'stop' });
      }
    },
  };
}
