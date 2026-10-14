import {
  DEFAULT_ZONE,
  dragZone,
  fromPixels,
  sameZone,
  toPixels,
  type Handle,
  type Zone,
} from './bonk-zone.js';

// Bonk VNext lot 2 — « Cible des Bonk » editor (Manuel / Fullscreen) of the Bonk card. Everything
// happens on a local draft: moving or resizing the zone changes nothing on the overlay until
// « Enregistrer »; « Annuler » goes back to the last saved value.

type Mode = 'manual' | 'fullscreen';
interface Settings {
  version: 1;
  mode: Mode;
  manual: Zone;
}
type Call = (path: string, body?: unknown) => Promise<Record<string, unknown>>;

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const ERRORS: Record<string, string> = {
  obs_offline: 'OBS non connecté : aperçu indisponible.',
  invalid_zone: 'Zone invalide.',
  invalid_mode: 'Mode invalide.',
};

export function mountBonkTarget(root: HTMLElement, call: Call) {
  const box = document.createElement('section');
  box.className = 'bonk-target';
  box.innerHTML = `<h4>Cible des Bonk</h4>
    <div class="bonk-target__modes" role="radiogroup" aria-label="Mode de cible">
      <label><input type="radio" name="bonk-target-mode" value="manual"> Manuel</label>
      <label><input type="radio" name="bonk-target-mode" value="fullscreen"> Plein écran</label>
      <label class="is-disabled"><input type="radio" name="bonk-target-mode" value="auto" disabled> Auto (bientôt)</label>
    </div>
    <div class="bonk-target__stage" data-t="stage">
      <img data-t="shot" alt="Capture de la scène OBS en cours" hidden>
      <div class="bonk-target__full" data-t="full" hidden>Plein écran : les Bonk visent tout le canvas</div>
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

  let saved: Settings | null = null;
  let draft: Settings | null = null;
  let message = '';

  const dirty = () =>
    !!saved &&
    !!draft &&
    (saved.mode !== draft.mode || !sameZone(saved.manual, draft.manual));

  const render = () => {
    if (!draft) return;
    const z = draft.manual;
    const full = draft.mode === 'fullscreen';
    for (const input of box.querySelectorAll<HTMLInputElement>(
      'input[name="bonk-target-mode"]',
    ))
      input.checked = input.value === draft.mode;
    zoneEl.hidden = full;
    q('full').hidden = !full;
    q('fields').hidden = full;
    zoneEl.style.left = `${z.x * 100}%`;
    zoneEl.style.top = `${z.y * 100}%`;
    zoneEl.style.width = `${z.w * 100}%`;
    zoneEl.style.height = `${z.h * 100}%`;
    const px = toPixels(z);
    for (const input of box.querySelectorAll<HTMLInputElement>('[data-field]'))
      if (document.activeElement !== input)
        input.value = String(px[input.dataset.field as keyof Zone]);
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

  // --- drag / resize: the local draft only ---------------------------------------------------
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

  // --- persisted value -------------------------------------------------------------------------
  q('save').addEventListener('click', () => {
    if (!draft) return;
    void call('settings', draft).then(
      (r) => {
        saved = r.settings as Settings;
        draft = structuredClone(saved);
        message = 'Enregistré : appliqué à l’overlay';
        render();
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

  void call('settings').then(
    (r) => {
      saved = r.settings as Settings;
      draft = structuredClone(saved);
      render();
      refreshShot();
    },
    () => {
      q('state').textContent = 'Réglages indisponibles';
    },
  );
}
