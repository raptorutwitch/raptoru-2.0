import {
  type Box,
  boxLabel,
  type CalibElement,
  type Corner,
  identity,
  moveBy,
  nudge,
  placeOf,
  resizeFromCorner,
  samePlacement,
  setField,
  STAGE,
  TEXT_PARTS,
  textInstant,
  type VariantPlacement,
} from './alerts-calib.js';

// Twitch alerts — visual calibration editor (17/10/2026) of the Studio tab « Alertes ». The frames and handles live
// in Studio's page ABOVE the preview iframe (never in the engine, so never in OBS); the iframe runs the shared engine
// and only receives the placement. Every pointer move is converted to 1920×1080 stage pixels with the scale of the
// moment (exact after a window resize). Unsaved values only reach the preview; « Enregistrer » writes them to Studio's
// storage, and the OBS source gets them with the next alert of that variant.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;

export interface CalibrationDeps {
  /** Where the panel goes (side column). */
  host: HTMLElement;
  /** The 1920×1080 preview box (`--al-scale`), the overlay is added inside it. */
  stage: HTMLElement;
  frame: HTMLIFrameElement;
  variantId: () => string | undefined;
  /** The selected variant's text style (which text blocks it can place on their own). */
  textStyle: () => string | undefined;
  send: (msg: unknown) => void;
  /** Asks the tab to freeze the preview at `ms` (timeline). */
  seekTo: (ms: number) => void;
}

export function mountCalibration(d: CalibrationDeps) {
  const saved = new Map<string, VariantPlacement>();
  const drafts = new Map<string, VariantPlacement>();
  let on = false;
  let visible = false;
  let hideFrames = false;
  let selected: CalibElement = 'media';
  let marks: { at: number; action: string }[] = [];
  let boxes: Record<CalibElement, Box | null> = {};
  /** The editable elements of the variant on screen, and the key they were last drawn for. */
  let elements: { id: CalibElement; label: string }[] = [];
  let drawnKey = '';
  let drag: {
    el: CalibElement;
    corner: Corner | null;
    pointer: number;
    x0: number;
    y0: number;
    start: VariantPlacement;
    box: Box;
  } | null = null;
  let status = '';
  let loop = 0;

  d.host.innerHTML = `
    <h2>Calibrage</h2>
    <label class="al-check"><input type="checkbox" data-c="on"/> Calibrer la variante</label>
    <div class="al-calib-panel" data-c="panel" hidden>
      <div class="al-calib-els" data-c="els"></div>
      <p class="al-hint" data-c="box"></p>
      <div class="al-calib-fields">
        <label class="al-field"><span>X (px)</span><input type="number" step="1" data-f="x"/></label>
        <label class="al-field"><span>Y (px)</span><input type="number" step="1" data-f="y"/></label>
        <label class="al-field"><span>Échelle (%)</span><input type="number" step="1" min="10" max="500" data-f="scale"/></label>
      </div>
      <label class="al-check"><input type="checkbox" data-c="hide"/> Masquer les cadres</label>
      <div class="al-actions">
        <button type="button" class="primary" data-c="save">Enregistrer</button>
        <button type="button" data-c="revert">Annuler les modifications</button>
        <button type="button" data-c="reset">Valeurs d’origine</button>
      </div>
      <p class="al-calib-status" data-c="status"></p>
      <p class="al-hint">Choisir l’élément, puis glisser son cadre pour le déplacer ou une poignée pour la taille (proportions gardées).
        Flèches : 10 px · Maj + flèches : 1 px. Coordonnées de la scène 1920 × 1080.
        La source OBS utilise les valeurs <b>enregistrées</b>, dès la prochaine alerte de la variante.</p>
    </div>`;
  const $ = <T extends HTMLElement>(c: string) =>
    d.host.querySelector<T>(`[data-c="${c}"]`)!;

  const layer = document.createElement('div');
  layer.className = 'al-calib-layer';
  layer.hidden = true;
  layer.innerHTML = `<div class="al-calib-stage">
      <div class="al-guide al-guide--v"></div><div class="al-guide al-guide--h"></div>
      <div data-c="boxes"></div>
    </div>`;
  d.stage.append(layer);
  const boxesHost = layer.querySelector<HTMLElement>('[data-c="boxes"]')!;

  const current = () => d.variantId();
  const savedOf = (id: string) => saved.get(id) ?? identity();
  const draftOf = (id: string) => drafts.get(id) ?? savedOf(id);
  const dirty = (id: string) => !samePlacement(draftOf(id), savedOf(id));

  /** The placement the preview must draw: the draft while calibrating, else what OBS would use. */
  const placementOf = (id: string) => (on ? draftOf(id) : savedOf(id));

  const apply = (next: VariantPlacement) => {
    const id = current();
    if (!id) return;
    drafts.set(id, next);
    status = '';
    d.send({ type: 'place', placement: next });
  };

  /**
   * The editable elements: the animation, then the text blocks of the variant when it has some (bits: badge,
   * sentence), else its texts as one. A saved whole-text offset of a variant with blocks stays editable.
   */
  const listElements = () => {
    const id = current();
    const parts = TEXT_PARTS[d.textStyle() ?? ''] ?? [];
    const textMoved =
      id !== undefined &&
      !samePlacement(
        { ...identity(), text: placeOf(draftOf(id), 'text') },
        identity(),
      );
    return [
      { id: 'media', label: 'Animation entière' },
      ...(parts.length && !textMoved
        ? []
        : [
            {
              id: 'text',
              label: parts.length ? 'Textes (ensemble)' : 'Textes',
            },
          ]),
      ...parts,
    ];
  };

  /** Buttons and frames of the variant's elements, redrawn when they change. */
  const drawElements = () => {
    elements = listElements();
    const key = `${current()}|${elements.map((e) => e.id).join(',')}`;
    if (key === drawnKey) return;
    drawnKey = key;
    if (!elements.some((e) => e.id === selected)) selected = 'media';
    const esc = (v: string) => v.replace(/[^a-zA-Z0-9_ ()éè]/g, '');
    $('els').innerHTML = elements
      .map(
        (e) =>
          `<button type="button" class="al-small" data-el="${esc(e.id)}">${esc(e.label)}</button>`,
      )
      .join('');
    boxesHost.innerHTML = elements
      .map(
        (e) =>
          `<div class="al-box al-box--${e.id === 'media' ? 'media' : 'text'}" data-box="${esc(e.id)}" hidden><span class="al-box-label">${esc(e.label)}</span>${CORNERS.map(
            (c) => `<i class="al-h al-h--${c}" data-corner="${c}"></i>`,
          ).join('')}</div>`,
      )
      .join('');
  };
  const labelOf = (el: CalibElement) =>
    elements.find((e) => e.id === el)?.label ?? el;

  /** The drawn boxes, read from the preview document (stage pixels: the iframe's own 1920×1080 viewport). */
  const measure = () => {
    const doc = d.frame.contentDocument;
    const out: Record<CalibElement, Box | null> = {};
    if (!doc) return out;
    const rect = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height
        ? { x: r.left, y: r.top, w: r.width, h: r.height }
        : null;
    };
    const texts = ['pseudoText', 'erenSubtitle']
      .map((idName) => doc.getElementById(idName))
      .filter((el) => el && el.textContent?.trim())
      .map(rect)
      .filter((b): b is Box => !!b);
    const text = texts.length
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
    out.media = rect(doc.getElementById('alertVideo'));
    out.text = text;
    for (const e of elements)
      if (e.id !== 'media' && e.id !== 'text')
        out[e.id] = rect(doc.querySelector(`[data-part="${e.id}"]`));
    return out;
  };

  const renderPanel = () => {
    const id = current();
    for (const b of d.host.querySelectorAll<HTMLElement>('[data-el]'))
      b.classList.toggle('al-on', b.dataset.el === selected);
    const box = boxes[selected] ?? null;
    $('box').textContent = `${labelOf(selected)} : ${boxLabel(box)}`;
    const p = id ? draftOf(id) : identity();
    const values = {
      x: box ? Math.round(box.x) : '',
      y: box ? Math.round(box.y) : '',
      scale: Math.round(placeOf(p, selected).scale * 1000) / 10,
    };
    for (const input of d.host.querySelectorAll<HTMLInputElement>('[data-f]'))
      if (document.activeElement !== input)
        input.value = String(values[input.dataset.f as keyof typeof values]);
    const s = $('status');
    const others = [...drafts.keys()].filter((k) => k !== id && dirty(k));
    s.className = 'al-calib-status';
    if (status) s.textContent = status;
    else if (id && dirty(id)) {
      s.textContent = '● Modifications non enregistrées (aperçu seulement).';
      s.classList.add('al-calib-status--dirty');
    } else s.textContent = 'Enregistré : identique à la source OBS.';
    if (others.length)
      s.textContent += ` Aussi non enregistré : ${others.join(', ')}.`;
  };

  const renderBoxes = () => {
    layer.classList.toggle('al-calib-layer--bare', hideFrames);
    for (const { id: el } of elements) {
      const node = boxesHost.querySelector<HTMLElement>(`[data-box="${el}"]`);
      if (!node) continue;
      const b = boxes[el];
      node.hidden = !b || hideFrames;
      node.classList.toggle('al-box--on', el === selected);
      if (b)
        Object.assign(node.style, {
          left: `${b.x}px`,
          top: `${b.y}px`,
          width: `${b.w}px`,
          height: `${b.h}px`,
        });
    }
  };

  const tick = () => {
    loop = 0;
    if (!on || !visible) return;
    drawElements();
    boxes = measure();
    renderBoxes();
    renderPanel();
    loop = requestAnimationFrame(tick);
  };
  const setOn = (value: boolean) => {
    on = value;
    $('panel').hidden = !on;
    layer.hidden = !on;
    const id = current();
    if (id) d.send({ type: 'place', placement: placementOf(id) });
    if (on && visible && !loop) loop = requestAnimationFrame(tick);
  };

  async function load() {
    try {
      const res = await fetch('/api/alerts/placement', { headers: HEADERS });
      const body = (await res.json()) as {
        variants?: Record<string, VariantPlacement>;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      saved.clear();
      for (const [k, v] of Object.entries(body.variants ?? {})) saved.set(k, v);
    } catch (e) {
      status = `Réglages illisibles : ${(e as Error).message}`;
    }
  }

  async function save() {
    const id = current();
    if (!id) return;
    try {
      const res = await fetch(`/api/alerts/placement/${id}`, {
        method: 'PUT',
        headers: HEADERS,
        body: JSON.stringify(draftOf(id)),
      });
      const body = (await res.json()) as {
        placement?: VariantPlacement;
        error?: string;
      };
      if (!res.ok || !body.placement)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      saved.set(id, body.placement);
      drafts.set(id, body.placement);
      status =
        'Enregistré. La source OBS l’utilisera dès la prochaine alerte de cette variante.';
    } catch (e) {
      status = `Échec de l’enregistrement : ${(e as Error).message}`;
    }
  }

  d.host.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.c === 'on') setOn(t.checked);
    if (t.dataset.c === 'hide') hideFrames = t.checked;
    const f = t.dataset.f as 'x' | 'y' | 'scale' | undefined;
    const id = current();
    const box = boxes[selected];
    if (f && id && box)
      apply(setField(draftOf(id), selected, box, f, Number(t.value)));
  });
  d.host.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const el = t.closest<HTMLElement>('[data-el]')?.dataset.el as
      CalibElement | undefined;
    if (el) {
      selected = el;
      // No text on screen at this instant: jump to one where the variant shows its texts.
      const at = textInstant(marks);
      if (el !== 'media' && !boxes[el] && at !== null) d.seekTo(at);
      return;
    }
    const id = current();
    const c = t.closest<HTMLElement>('[data-c]')?.dataset.c;
    if (!id || !c) return;
    if (c === 'save') void save();
    if (c === 'revert') apply(savedOf(id));
    if (c === 'reset') apply(identity());
  });

  layer.addEventListener('pointerdown', (ev) => {
    const boxEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-box]');
    const id = current();
    if (!boxEl || !id) return;
    const el = boxEl.dataset.box as CalibElement;
    const box = boxes[el];
    if (!box) return;
    ev.preventDefault();
    selected = el;
    drag = {
      el,
      corner:
        ((ev.target as HTMLElement).dataset.corner as Corner | undefined) ??
        null,
      pointer: ev.pointerId,
      x0: ev.clientX,
      y0: ev.clientY,
      start: draftOf(id),
      box,
    };
    layer.setPointerCapture(ev.pointerId);
  });
  layer.addEventListener('pointermove', (ev) => {
    if (!drag || drag.pointer !== ev.pointerId) return;
    // Window pixels → stage pixels with the scale of this very moment.
    const k = d.stage.clientWidth / STAGE.w || 1;
    const dx = (ev.clientX - drag.x0) / k;
    const dy = (ev.clientY - drag.y0) / k;
    apply(
      drag.corner
        ? resizeFromCorner(drag.start, drag.el, drag.box, drag.corner, dx, dy)
        : moveBy(drag.start, drag.el, dx, dy),
    );
  });
  const endDrag = () => {
    drag = null;
  };
  layer.addEventListener('pointerup', endDrag);
  layer.addEventListener('pointercancel', endDrag);

  document.addEventListener('keydown', (ev) => {
    if (!on || !visible) return;
    const t = ev.target as HTMLElement;
    if (t.closest('input, textarea, select')) return;
    const id = current();
    if (!id) return;
    const next = nudge(draftOf(id), selected, ev.key, ev.shiftKey);
    if (!next) return;
    ev.preventDefault();
    apply(next);
  });

  void load();

  return {
    /** For the tab's play / seek messages. */
    placement: (id: string) => placementOf(id),
    /** The marks of the latest frozen image (to find the texts). */
    onFrame(m: { at: number; action: string }[]) {
      marks = m;
    },
    setVisible(v: boolean) {
      visible = v;
      if (!v) {
        if (loop) cancelAnimationFrame(loop);
        loop = 0;
        return;
      }
      void load();
      if (on && !loop) loop = requestAnimationFrame(tick);
    },
  };
}
