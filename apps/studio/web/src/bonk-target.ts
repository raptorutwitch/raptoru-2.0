import {
  DEFAULT_ZONE,
  dragZone,
  fromPixels,
  sameZone,
  toPixels,
  CANVAS,
  type Handle,
  type Zone,
} from './bonk-zone.js';

// Bonk VNext lots 2–3 — « Cible des Bonk » editor (Auto / Manuel / Plein écran) of the Bonk card.
// Everything happens on a local draft: moving or resizing the zone, the mode or the preferred Auto
// source change nothing on the overlay until « Enregistrer »; « Annuler » goes back to the last saved
// value. The Auto rectangle is read-only (« Copier vers Manuel » to adjust it by hand).

type Mode = 'auto' | 'manual' | 'fullscreen';
interface Pinned {
  name: string;
  uuid: string | null;
}
interface Settings {
  version: 2;
  mode: Mode;
  manual: Zone;
  auto: { pinned: Pinned | null };
}
interface AutoCandidate {
  name: string;
  uuid: string | null;
  input_kind: string | null;
  path: string[];
  rect: Zone;
  area: number;
  score: number;
  reliable: boolean;
  reasons: string[];
}
interface AutoView {
  status:
    | 'ready'
    | 'pinned_absent'
    | 'no_candidate'
    | 'ambiguous'
    | 'obs_offline'
    | 'syncing'
    | 'stale';
  reason: string;
  scene: string | null;
  chosen: AutoCandidate | null;
  candidates: AutoCandidate[];
}
type Call = (path: string, body?: unknown) => Promise<Record<string, unknown>>;

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const ERRORS: Record<string, string> = {
  obs_offline: 'OBS non connecté : aperçu indisponible.',
  invalid_zone: 'Zone invalide.',
  invalid_mode: 'Mode invalide.',
  invalid_pinned: 'Source préférée invalide.',
};
const STATUS: Record<AutoView['status'], string> = {
  ready: 'Auto prêt',
  pinned_absent: 'Source épinglée absente — fallback',
  no_candidate: 'Aucun candidat fiable — Manuel',
  ambiguous: 'Plusieurs caméras possibles — Manuel (épingle une source)',
  obs_offline: 'OBS indisponible — Manuel',
  syncing: 'Lecture de la scène OBS… — Manuel',
  stale: 'OBS ne répond plus — Manuel',
};
const sameSource = (a: Pinned | null, b: Pinned | null) =>
  a === b ||
  (!!a && !!b && (a.uuid && b.uuid ? a.uuid === b.uuid : a.name === b.name));
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function mountBonkTarget(root: HTMLElement, call: Call) {
  const box = document.createElement('section');
  box.className = 'bonk-target';
  box.innerHTML = `<h4>Cible des Bonk</h4>
    <div class="bonk-target__modes" role="radiogroup" aria-label="Mode de cible">
      <label><input type="radio" name="bonk-target-mode" value="auto"> Auto</label>
      <label><input type="radio" name="bonk-target-mode" value="manual"> Manuel</label>
      <label><input type="radio" name="bonk-target-mode" value="fullscreen"> Plein écran</label>
    </div>
    <div class="bonk-target__auto" data-t="auto" hidden>
      <p class="bonk-target__auto-state"><strong data-t="auto-status"></strong> <span data-t="auto-label"></span></p>
      <p class="bonk-target__row"><label>Source préférée <select data-t="pinned"></select></label>
        <button type="button" data-t="copy">Copier vers Manuel</button></p>
      <details><summary>Candidats détectés</summary><ol data-t="candidates"></ol></details>
    </div>
    <div class="bonk-target__stage" data-t="stage">
      <img data-t="shot" alt="Capture de la scène OBS en cours" hidden>
      <div class="bonk-target__full" data-t="full" hidden>Plein écran : les Bonk visent tout le canvas</div>
      <div class="bonk-target__autozone" data-t="autozone" hidden></div>
      <div class="bonk-target__zone" data-t="zone" data-handle="move" tabindex="0" aria-label="Zone visée par les Bonk">
        ${HANDLES.map((h) => `<span class="bonk-target__handle is-${h}" data-handle="${h}"></span>`).join('')}
      </div>
    </div>
    <p class="bonk-target__row"><button type="button" data-t="refresh">Rafraîchir l’aperçu</button> <span data-t="shot-status"></span></p>
    <p class="bonk-target__row bonk-target__fields" data-t="fields">
      ${(['x', 'y', 'w', 'h'] as const)
        .map(
          (k) =>
            `<label>${{ x: 'X', y: 'Y', w: 'Largeur', h: 'Hauteur' }[k]} <input type="number" step="1" data-field="${k}"> px</label>`,
        )
        .join(' ')}
    </p>
    <p class="bonk-target__row">
      <button type="button" data-t="save">Enregistrer</button>
      <button type="button" data-t="cancel">Annuler</button>
      <button type="button" data-t="reset">Réinitialiser</button>
      <span data-t="state" aria-live="polite"></span>
    </p>`;
  root.append(box);
  const q = <T extends HTMLElement>(key: string) =>
    box.querySelector<T>(`[data-t="${key}"]`)!;
  const stage = q('stage');
  const zoneEl = q('zone');
  const shot = q<HTMLImageElement>('shot');
  const pinnedSelect = q<HTMLSelectElement>('pinned');

  let saved: Settings | null = null;
  let draft: Settings | null = null;
  let auto: AutoView | null = null;
  let message = '';

  const dirty = () =>
    !!saved &&
    !!draft &&
    (saved.mode !== draft.mode ||
      !sameZone(saved.manual, draft.manual) ||
      !sameSource(saved.auto.pinned, draft.auto.pinned));

  const place = (el: HTMLElement, z: Zone) => {
    el.style.left = `${z.x * 100}%`;
    el.style.top = `${z.y * 100}%`;
    el.style.width = `${z.w * 100}%`;
    el.style.height = `${z.h * 100}%`;
  };
  const fraction = (r: Zone): Zone => ({
    x: r.x / CANVAS.width,
    y: r.y / CANVAS.height,
    w: r.w / CANVAS.width,
    h: r.h / CANVAS.height,
  });

  const renderAuto = () => {
    if (!draft) return;
    const a = auto;
    // What the saved setting aims at now (the draft's pin only applies once saved).
    q('auto-status').textContent = a
      ? STATUS[a.status]
      : 'État Auto indisponible';
    q('auto-label').textContent = a?.chosen
      ? `Auto : ${a.chosen.name} · ${a.chosen.path.join(' > ')} (${a.reason})`
      : a
        ? `(${a.reason})`
        : '';
    const autozone = q('autozone');
    autozone.hidden = draft.mode !== 'auto' || !a?.chosen;
    if (a?.chosen) place(autozone, fraction(a.chosen.rect));
    q<HTMLButtonElement>('copy').disabled = !a?.chosen;
    // Preferred source: Automatique, the detected candidates, or the pinned one when absent.
    const options: { value: string; label: string; pinned: Pinned | null }[] = [
      { value: '', label: 'Automatique', pinned: null },
      ...(a?.candidates ?? []).map((c) => ({
        value: c.uuid ?? `name:${c.name}`,
        label: `${c.name} · ${c.path.slice(0, -1).join(' > ')}${c.reliable ? '' : ' (non fiable seule)'}`,
        pinned: { name: c.name, uuid: c.uuid },
      })),
    ];
    const pin = draft.auto.pinned;
    if (pin && !options.some((o) => sameSource(o.pinned, pin)))
      options.push({
        value: pin.uuid ?? `name:${pin.name}`,
        label: `${pin.name} (épinglée, absente de la scène)`,
        pinned: pin,
      });
    const current = pin ? (pin.uuid ?? `name:${pin.name}`) : '';
    const html = options
      .map(
        (o) =>
          `<option value="${escape(o.value)}"${o.value === current ? ' selected' : ''}>${escape(o.label)}</option>`,
      )
      .join('');
    if (
      pinnedSelect.innerHTML !== html &&
      document.activeElement !== pinnedSelect
    )
      pinnedSelect.innerHTML = html;
    pinnedOptions = options;
    q('candidates').innerHTML =
      (a?.candidates ?? [])
        .map(
          (c) =>
            `<li><strong>${escape(c.name)}</strong> · ${escape(c.path.join(' > '))} · score ${c.score}${c.reliable ? '' : ' (non fiable)'}<br><small>${escape(c.reasons.join(' · '))} · ${Math.round(c.rect.w)} × ${Math.round(c.rect.h)} px en ${Math.round(c.rect.x)}, ${Math.round(c.rect.y)}</small></li>`,
        )
        .join('') || '<li>Aucun candidat visible dans la scène programme.</li>';
  };
  let pinnedOptions: { value: string; pinned: Pinned | null }[] = [];

  const render = () => {
    if (!draft) return;
    const z = draft.manual;
    const mode = draft.mode;
    for (const input of box.querySelectorAll<HTMLInputElement>(
      'input[name="bonk-target-mode"]',
    ))
      input.checked = input.value === mode;
    zoneEl.hidden = mode !== 'manual';
    q('full').hidden = mode !== 'fullscreen';
    q('fields').hidden = mode !== 'manual';
    q('auto').hidden = mode !== 'auto';
    q<HTMLButtonElement>('reset').hidden = mode !== 'manual';
    place(zoneEl, z);
    const px = toPixels(z);
    for (const input of box.querySelectorAll<HTMLInputElement>('[data-field]'))
      if (document.activeElement !== input)
        input.value = String(px[input.dataset.field as keyof Zone]);
    renderAuto();
    const changed = dirty();
    q<HTMLButtonElement>('save').disabled = !changed;
    q<HTMLButtonElement>('cancel').disabled = !changed;
    q('state').textContent =
      message || (changed ? 'Modifications non enregistrées' : 'Enregistré');
  };

  const edit = (next: Partial<Settings>) => {
    if (!draft) return;
    draft = { ...draft, ...next };
    message = '';
    render();
  };

  // --- drag / resize (Manuel): the local draft only --------------------------------------------
  let drag: { handle: Handle; x: number; y: number; start: Zone } | null = null;
  zoneEl.addEventListener('pointerdown', (e) => {
    if (!draft) return;
    const handle = ((e.target as HTMLElement).dataset.handle ??
      'move') as Handle;
    drag = { handle, x: e.clientX, y: e.clientY, start: draft.manual };
    zoneEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  zoneEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rect = stage.getBoundingClientRect();
    edit({
      manual: dragZone(
        drag.start,
        drag.handle,
        (e.clientX - drag.x) / rect.width,
        (e.clientY - drag.y) / rect.height,
      ),
    });
  });
  const stop = () => (drag = null);
  zoneEl.addEventListener('pointerup', stop);
  zoneEl.addEventListener('pointercancel', stop);
  // Keyboard: arrows move by 1 % (Shift: resize).
  zoneEl.addEventListener('keydown', (e) => {
    if (!draft) return;
    const step = 0.01;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!d) return;
    e.preventDefault();
    edit({
      manual: dragZone(draft.manual, e.shiftKey ? 'se' : 'move', d[0]!, d[1]!),
    });
  });

  for (const input of box.querySelectorAll<HTMLInputElement>('[data-field]'))
    input.addEventListener('change', () => {
      if (!draft) return;
      const px = toPixels(draft.manual);
      px[input.dataset.field as keyof Zone] = Number(input.value) || 0;
      edit({ manual: fromPixels(px) });
      input.value = String(
        toPixels(draft.manual)[input.dataset.field as keyof Zone],
      );
    });
  for (const input of box.querySelectorAll<HTMLInputElement>(
    'input[name="bonk-target-mode"]',
  ))
    input.addEventListener('change', () => edit({ mode: input.value as Mode }));
  pinnedSelect.addEventListener('change', () => {
    const chosen = pinnedOptions.find((o) => o.value === pinnedSelect.value);
    edit({ auto: { pinned: chosen?.pinned ?? null } });
  });
  // The Auto box becomes the Manuel draft (to adjust it by hand); saved only with « Enregistrer ».
  q('copy').addEventListener('click', () => {
    if (!auto?.chosen) return;
    edit({ mode: 'manual', manual: fromPixels(auto.chosen.rect) });
  });

  // --- persisted value -------------------------------------------------------------------------
  q('save').addEventListener('click', () => {
    if (!draft) return;
    void call('settings', draft).then(
      (r) => {
        saved = r.settings as Settings;
        draft = structuredClone(saved);
        message = 'Enregistré : appliqué à l’overlay';
        render();
        void refreshAuto();
      },
      (e: Error) => {
        message = `Non enregistré : ${ERRORS[e.message] ?? e.message}`;
        render();
      },
    );
  });
  q('cancel').addEventListener('click', () => {
    if (!saved) return;
    draft = structuredClone(saved);
    message = '';
    render();
  });
  q('reset').addEventListener('click', () =>
    edit({ manual: { ...DEFAULT_ZONE } }),
  );

  const refreshShot = () => {
    q('shot-status').textContent = 'Capture…';
    void call('obs-screenshot').then(
      (r) => {
        shot.src = String(r.image);
        shot.hidden = false;
        q('shot-status').textContent = '';
      },
      (e: Error) => {
        shot.hidden = true;
        q('shot-status').textContent = ERRORS[e.message] ?? e.message;
      },
    );
  };
  q('refresh').addEventListener('click', refreshShot);

  const refreshAuto = () =>
    call('auto').then(
      (r) => {
        auto = r as unknown as AutoView;
        render();
      },
      () => {
        auto = null;
        render();
      },
    );
  // Auto follows OBS live: the state and the box are refreshed while Auto is the draft mode.
  setInterval(() => {
    if (draft?.mode === 'auto' && box.isConnected && box.offsetParent)
      void refreshAuto();
  }, 2000);

  void call('settings').then(
    (r) => {
      saved = r.settings as Settings;
      draft = structuredClone(saved);
      render();
      refreshShot();
      void refreshAuto();
    },
    () => {
      q('state').textContent = 'Réglages indisponibles';
    },
  );
}
