import {
  type Box,
  type CalibElement,
  type Corner,
  moveBy,
  nudge,
  resizeFromCorner,
  snapMove,
  STAGE,
  type VariantPlacement,
} from './alerts-place.js';

// Alertes : la scène. L'aperçu est le VRAI moteur de la source OBS, dans une iframe 1920 × 1080 mise à l'échelle sur le damier ;
// il ne touche jamais la file. Les cadres et les poignées vivent au-dessus, dans la page, donc jamais dans OBS. Chaque geste est
// converti en pixels de scène à l'échelle du moment. Les boîtes sont lues dans l'aperçu : on déplace ce qui est réellement dessiné.

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

export interface StageDeps {
  /** Les éléments modifiables de la variante à l'écran. */
  elements(): { id: CalibElement; label: string }[];
  selected(): CalibElement | null;
  select(el: CalibElement | null): void;
  placement(): VariantPlacement | null;
  /** Un geste a changé le placement (`done` : le geste est fini). */
  edit(next: VariantPlacement, done: boolean): void;
  onMessage(m: Record<string, unknown>): void;
}

export interface Stage {
  /** Parle à l'aperçu. */
  send(msg: unknown): void;
  /** Relit les boîtes dans l'aperçu et redessine les cadres. */
  refresh(): void;
  box(el: CalibElement): Box | null;
  /** Pendant la lecture, la scène ne se manipule pas. */
  setPlaying(on: boolean): void;
  /** Un média manque : la scène le dit au lieu d'un cadre vide. */
  setMissing(html: string | null): void;
  /** Recharge l'aperçu (un média a été remplacé). */
  reload(): void;
  /** Une image se prépare (certains fichiers se décodent depuis leur début). */
  setBusy(on: boolean): void;
}

export function mountStage(host: HTMLElement, d: StageDeps): Stage {
  host.innerHTML = `<div class="d-scn alr-scn" data-scn>
    <div class="d-scn__fit" data-fit><iframe title="Aperçu de l’alerte" src="/alerts/preview.html" allow="autoplay"></iframe></div>
    <span class="d-scn__tag">Source OBS</span>
    <span class="d-scn__tag alr-busy" data-busy hidden>Image…</span>
    <div class="alr-edit" data-edit tabindex="0" role="application" aria-label="Scène : flèches pour déplacer, Maj pour un pixel">
      <i class="alr-g v" data-gv></i><i class="alr-g h" data-gh></i><div data-boxes></div>
    </div>
    <div class="alr-miss" data-miss hidden></div>
  </div>`;
  const scn = host.querySelector<HTMLElement>('[data-scn]')!;
  const fit = host.querySelector<HTMLElement>('[data-fit]')!;
  const frame = host.querySelector('iframe')!;
  const edit = host.querySelector<HTMLElement>('[data-edit]')!;
  const boxesHost = host.querySelector<HTMLElement>('[data-boxes]')!;
  const gv = host.querySelector<HTMLElement>('[data-gv]')!;
  const gh = host.querySelector<HTMLElement>('[data-gh]')!;
  const miss = host.querySelector<HTMLElement>('[data-miss]')!;
  const busy = host.querySelector<HTMLElement>('[data-busy]')!;

  const scale = () => scn.clientWidth / STAGE.w || 1;
  new ResizeObserver(() => {
    fit.style.transform = `scale(${scale()})`;
    refresh();
  }).observe(scn);

  let boxes: Record<string, Box | null> = {};
  let drawn = '';
  let drag: {
    el: CalibElement;
    corner: Corner | null;
    x0: number;
    y0: number;
    start: VariantPlacement;
    box: Box;
    moved: boolean;
    /** Un premier appui sur l'alerte entière la sélectionne seulement : pas de déplacement par accident. */
    armed: boolean;
  } | null = null;

  const measure = () => {
    const doc = frame.contentDocument;
    const out: Record<string, Box | null> = {};
    if (!doc) return out;
    const rect = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height
        ? { x: r.left, y: r.top, w: r.width, h: r.height }
        : null;
    };
    const texts = ['pseudoText', 'erenSubtitle']
      .map((id) => doc.getElementById(id))
      .filter((el) => el?.textContent?.trim())
      .map(rect)
      .filter((b): b is Box => !!b);
    out.text = texts.length
      ? texts.reduce((a, b) => {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          return {
            x,
            y,
            w: Math.max(a.x + a.w, b.x + b.w) - x,
            h: Math.max(a.y + a.h, b.y + b.h) - y,
          };
        })
      : null;
    const video = doc.getElementById('alertVideo');
    out.media =
      video && getComputedStyle(video).visibility !== 'hidden'
        ? rect(video)
        : null;
    for (const e of d.elements())
      if (e.id !== 'media' && e.id !== 'text')
        out[e.id] = rect(doc.querySelector(`[data-part="${e.id}"]`));
    return out;
  };

  const paint = () => {
    const els = d.elements();
    const sig = els.map((e) => e.id).join(',');
    if (sig !== drawn) {
      drawn = sig;
      boxesHost.innerHTML = els
        .map(
          (e) =>
            `<div class="alr-box ${e.id === 'media' ? 'is-media' : 'is-text'}" data-box="${e.id}" hidden><span class="alr-box__l">${e.label}</span>${CORNERS.map((c) => `<i class="alr-h ${c}" data-corner="${c}"></i>`).join('')}</div>`,
        )
        .join('');
    }
    const sel = d.selected();
    for (const node of boxesHost.querySelectorAll<HTMLElement>('[data-box]')) {
      const b = boxes[node.dataset.box!];
      node.hidden = !b;
      node.classList.toggle('on', node.dataset.box === sel);
      node.classList.toggle('d-vf', node.dataset.box === sel);
      if (b)
        Object.assign(node.style, {
          left: `${(b.x / STAGE.w) * 100}%`,
          top: `${(b.y / STAGE.h) * 100}%`,
          width: `${(b.w / STAGE.w) * 100}%`,
          height: `${(b.h / STAGE.h) * 100}%`,
        });
    }
  };
  function refresh() {
    boxes = measure();
    paint();
  }

  const guide = (v: number | null, h: number | null) => {
    gv.classList.toggle('show', v !== null);
    gh.classList.toggle('show', h !== null);
    if (v !== null) gv.style.left = `${(v / STAGE.w) * 100}%`;
    if (h !== null) gh.style.top = `${(h / STAGE.h) * 100}%`;
  };

  edit.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const node = t.closest<HTMLElement>('[data-box]');
    if (!node) {
      d.select(null);
      paint();
      return;
    }
    const el = node.dataset.box!;
    const box = boxes[el];
    const start = d.placement();
    if (!box || !start) return;
    e.preventDefault();
    edit.focus({ preventScroll: true });
    const already = d.selected() === el;
    if (!already) {
      d.select(el);
      paint();
    }
    drag = {
      el,
      corner: (t.dataset.corner as Corner | undefined) ?? null,
      x0: e.clientX,
      y0: e.clientY,
      start,
      box,
      moved: false,
      armed: already || el !== 'media',
    };
    edit.setPointerCapture(e.pointerId);
  });
  edit.addEventListener('pointermove', (e) => {
    if (!drag?.armed) return;
    const k = scale();
    const rawX = (e.clientX - drag.x0) / k;
    const rawY = (e.clientY - drag.y0) / k;
    if (!drag.moved && Math.hypot(rawX, rawY) < 3) return;
    drag.moved = true;
    if (drag.corner) {
      d.edit(
        resizeFromCorner(
          drag.start,
          drag.el,
          drag.box,
          drag.corner,
          rawX,
          rawY,
        ),
        false,
      );
    } else {
      // Alt : déplacement libre, sans repère d'accroche.
      const s = e.altKey
        ? { dx: rawX, dy: rawY, v: null, h: null }
        : snapMove(drag.box, rawX, rawY);
      guide(s.v, s.h);
      d.edit(moveBy(drag.start, drag.el, s.dx, s.dy), false);
    }
    refresh();
  });
  const end = () => {
    if (drag?.moved) {
      const p = d.placement();
      if (p) d.edit(p, true);
    }
    drag = null;
    guide(null, null);
  };
  edit.addEventListener('pointerup', end);
  edit.addEventListener('pointercancel', end);
  edit.addEventListener('keydown', (e) => {
    const el = d.selected();
    const p = d.placement();
    if (!el || !p) return;
    const next = nudge(p, el, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    d.edit(next, true);
    refresh();
  });

  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || ev.source !== frame.contentWindow)
      return;
    const m = ev.data as Record<string, unknown>;
    if (m?.source === 'alerts-preview') d.onMessage(m);
  });

  return {
    send: (msg) => frame.contentWindow?.postMessage(msg, location.origin),
    refresh,
    box: (el) => boxes[el] ?? null,
    setPlaying(on) {
      edit.hidden = on;
      if (on) boxes = {};
    },
    setMissing(html) {
      miss.hidden = html === null;
      miss.innerHTML = html ?? '';
    },
    reload() {
      frame.src = '/alerts/preview.html';
    },
    setBusy(on) {
      busy.hidden = !on;
    },
  };
}
