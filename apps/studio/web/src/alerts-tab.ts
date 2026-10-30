import {
  type AlertsState,
  type AlertVariantInfo,
  CATEGORIES,
  type FakeData,
  formView,
  mediaView,
  overlapCategories,
  PRESETS,
  previewData,
  previewStatus,
  queueView,
  sourceView,
  scrubLabel,
  scrubMarks,
  testEvent,
  variantLabel,
} from './alerts-view.js';
import { mountCalibration } from './alerts-calibrate.js';
import { mountSeDonations } from './alerts-se.js';
import { mountTwitchMode } from './alerts-twitch.js';
import { mountAlertVariants } from './alerts-variants.js';
import { mountDockPanel } from './dock-panel.js';

// Twitch alerts V1 (A2) — Studio tab « Alertes » (docs/TWITCH_ALERTS_PARITY_2026-10.md § 14). The preview iframe runs
// the SAME engine as the OBS source, driven by postMessage: it never claims or reports anything (no queue).
// « Envoyer dans la file » posts a simulated event through Core's normal path: the OBS source plays it.
// Calibration (17/10/2026): alerts-calibrate.ts (placement per variant, saved in Studio's storage); the tab only
// passes the placement along with its play / seek messages.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

export function mountAlerts(root: HTMLElement) {
  let variants: AlertVariantInfo[] = [];
  let state: AlertsState | null = null;
  let error: string | null = null;
  let category = 'follow';
  let fake: FakeData = { ...PRESETS.normal!.data };
  let last: { variant: AlertVariantInfo; data: unknown } | null = null;
  let run = 0;
  let timer: number | null = null;
  /** Timeline of the preview: the frozen instant (ms) and the selected variant's length / frame rate. */
  let scrubMs = 0;
  let lengthMs = 0;

  root.innerHTML = `
    <section class="al">
      <div class="al-head"><h1>Alertes <em data-role="alerts-env">Core</em></h1>
        <span class="al-note">Aperçu : local, sans file. Simulation : passe par la file du Core. Événements réels : réglés plus bas (OFF par défaut).</span></div>
      <div class="al-grid">
        <div class="al-side">
          <h2>Alerte</h2>
          <label class="al-field"><span>Catégorie</span><select data-role="category">${Object.entries(
            CATEGORIES,
          )
            .map(([k, l]) => `<option value="${k}">${l}</option>`)
            .join('')}</select></label>
          <label class="al-field"><span>Variante</span><select data-role="variant"></select></label>
          <h2>Fausses données</h2>
          <div class="al-presets">${Object.entries(PRESETS)
            .map(
              ([k, p]) =>
                `<button type="button" class="al-small" data-preset="${k}">${p.label}</button>`,
            )
            .join('')}</div>
          <div class="al-form" data-role="form"></div>
          <h2>Aperçu</h2>
          <div class="al-actions">
            <button type="button" class="primary" data-act="play">Lancer</button>
            <button type="button" data-act="replay">Rejouer</button>
            <button type="button" data-act="stop">Arrêter</button>
          </div>
          <button type="button" class="al-small" data-act="overlay">Superposer les autres familles</button>
          <p class="al-hint">Joue aussi un Follow, un Sub, des Bits, un Don et un Raid (sauf la famille choisie), chacun à sa
            position enregistrée, comme dans OBS. Aperçu local uniquement.</p>
          <label class="al-field"><span>Volume de l’aperçu <b data-role="vol-label">50 %</b></span>
            <input type="range" min="0" max="100" value="50" data-role="volume"/></label>
          <p class="al-preview-status" data-role="preview-status">Prêt.</p>
          <div data-role="calib"></div>
          <h2>Simulation (file réelle)</h2>
          <button type="button" data-act="queue">Envoyer dans la file</button>
          <p class="al-hint">Événement simulé, mis dans la file du Core de ce profil : la source OBS le joue.</p>
          <p class="al-hint" data-role="queue-result"></p>
        </div>
        <div class="al-main">
          <div class="al-stage"><iframe title="Aperçu des alertes" src="/alerts/preview.html" allow="autoplay"></iframe></div>
          <div class="al-timeline">
            <input type="range" min="0" max="0" step="1" value="0" data-role="scrub" list="al-marks" aria-label="Instant de l’alerte"/>
            <datalist id="al-marks" data-role="marks"></datalist>
            <div class="al-scrub-actions">
              <button type="button" class="al-small" data-step="-frame">−1 image</button>
              <button type="button" class="al-small" data-step="-10">−0,01 s</button>
              <output data-role="scrub-time">—</output>
              <button type="button" class="al-small" data-step="10">+0,01 s</button>
              <button type="button" class="al-small" data-step="frame">+1 image</button>
            </div>
            <p class="al-hint" data-role="scrub-marks">Timeline : image figée de la vraie vidéo, textes à cet instant, sans son.</p>
          </div>
          <div class="al-columns">
            <div><h2>File des alertes</h2><div data-role="queue"></div></div>
            <div><h2>Source OBS</h2>
              <div class="al-url"><input readonly data-role="obs-url"/><button type="button" class="al-small" data-act="copy">Copier</button></div>
              <p class="al-hint">Source navigateur 1920×1080, fond transparent. Seule consommatrice de la file.</p>
              <div data-role="source"></div>
              <h2>Médias</h2><div data-role="media"></div>
              <h2>Événements Twitch réels</h2><div data-role="twitch"></div></div>
          </div>
          <div class="al-se"><h2>Variantes par famille</h2><div data-role="variants"></div></div>
          <div class="al-se"><h2>Dons StreamElements</h2><div data-role="se"></div>
          </div>
          <div class="al-se"><h2>Dock OBS</h2><div data-role="dock"></div></div>
        </div>
      </div>
    </section>`;

  const $ = <T extends HTMLElement>(role: string) =>
    root.querySelector<T>(`[data-role="${role}"]`)!;
  const frame = root.querySelector('iframe')!;
  const stageBox = root.querySelector<HTMLElement>('.al-stage')!;

  mountTwitchMode($('twitch'));
  mountSeDonations($('se'));
  mountAlertVariants($('variants'), HEADERS);
  // Dock OBS V1: the URL for OBS and its key (dock-panel.ts).
  mountDockPanel($('dock'));

  const calib = mountCalibration({
    host: $('calib'),
    stage: stageBox,
    frame,
    variantId: () => selected()?.id,
    textStyle: () => selected()?.textStyle,
    send: (msg) => send(msg),
    seekTo: (ms) => seek(ms),
  });

  const renderVariants = () => {
    const list = variants.filter((v) => v.type === category);
    $<HTMLSelectElement>('variant').innerHTML = list.length
      ? list
          .map((v) => `<option value="${v.id}">${variantLabel(v)}</option>`)
          .join('')
      : '<option value="">Catalogue indisponible</option>';
  };
  const renderForm = () => {
    $('form').innerHTML = formView(category, fake);
  };
  const renderState = () => {
    $('queue').innerHTML = queueView(state, error);
    $('media').innerHTML = mediaView(state);
    $('source').innerHTML = sourceView(state);
    if (state) $<HTMLInputElement>('obs-url').value = state.player_url;
    if (state?.environment)
      $('alerts-env').textContent =
        state.environment === 'production' ? 'Core production' : 'Core Lab';
  };

  /** Reads the visible inputs back into the fake data. */
  const readForm = () => {
    for (const el of root.querySelectorAll<HTMLInputElement>('[data-field]')) {
      const k = el.dataset.field as keyof FakeData;
      if (k === 'anonymous') fake.anonymous = el.checked;
      else if (k === 'count' || k === 'bits' || k === 'viewers')
        fake[k] = Math.max(1, Math.round(Number(el.value) || 1));
      else fake[k] = el.value;
    }
  };

  const send = (msg: unknown) =>
    frame.contentWindow?.postMessage(msg, location.origin);
  const volume = () => Number($<HTMLInputElement>('volume').value) / 100;

  const selected = () =>
    variants.find((v) => v.id === $<HTMLSelectElement>('variant').value);

  /** Freezes the preview at `ms` on the selected variant with the current fake data. */
  const seek = (ms: number) => {
    const variant = selected();
    if (!variant) return;
    readForm();
    scrubMs = Math.max(0, lengthMs ? Math.min(ms, lengthMs) : ms);
    send({
      type: 'seek',
      variant,
      data: previewData(testEvent(category, fake)),
      ms: scrubMs,
      placement: calib.placement(variant.id),
    });
  };

  const play = (p: { variant: AlertVariantInfo; data: unknown }) => {
    last = p;
    send({
      type: 'play',
      variant: p.variant,
      data: p.data,
      volume: volume(),
      placement: calib.placement(p.variant.id),
    });
  };

  async function load() {
    try {
      const res = await fetch('/api/alerts/catalog', { headers: HEADERS });
      const body = (await res.json()) as {
        variants?: AlertVariantInfo[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      variants = body.variants ?? [];
    } catch (e) {
      error = `Catalogue indisponible : ${(e as Error).message}`;
    }
    renderVariants();
  }

  async function refresh() {
    try {
      const res = await fetch('/api/alerts/state', { headers: HEADERS });
      const body = (await res.json()) as AlertsState & {
        enabled?: false;
        error?: string;
      };
      if (body.enabled === false)
        throw new Error('alertes disponibles en profil Lab uniquement');
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
    } catch (e) {
      error = `File indisponible : ${(e as Error).message}`;
    }
    renderState();
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || ev.source !== frame.contentWindow)
      return;
    const m = ev.data as {
      source?: string;
      type?: string;
      run?: number;
      state?: string;
    };
    if (m?.source !== 'alerts-preview') return;
    if (m.run !== undefined && m.run < run) return;
    run = m.run ?? run;
    if (m.type === 'frame') {
      const f = m as unknown as {
        ms: number;
        lengthMs: number;
        marks: { at: number; action: string }[];
      };
      lengthMs = Math.ceil(f.lengthMs);
      const range = $<HTMLInputElement>('scrub');
      range.max = String(lengthMs);
      range.value = String(Math.round(f.ms));
      $('scrub-time').textContent = scrubLabel(f.ms, selected()?.fps);
      $('marks').innerHTML = f.marks
        .map((k) => `<option value="${Math.round(k.at)}"></option>`)
        .join('');
      $('scrub-marks').textContent = scrubMarks(f.marks);
      calib.onFrame(f.marks);
      $('preview-status').textContent = 'Image figée (timeline).';
      return;
    }
    if (m.type !== 'state') return;
    $('preview-status').textContent = previewStatus(
      m as Parameters<typeof previewStatus>[0],
    );
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target as HTMLElement;
    if (el.dataset.role === 'category') {
      readForm();
      category = (el as HTMLSelectElement).value;
      renderVariants();
      renderForm();
    }
    if (el.dataset.role === 'category' || el.dataset.role === 'variant') {
      lengthMs = 0;
      seek(0);
    }
  });
  $<HTMLInputElement>('scrub').addEventListener('input', (ev) =>
    seek(Number((ev.target as HTMLInputElement).value)),
  );
  $<HTMLInputElement>('volume').addEventListener('input', () => {
    $('vol-label').textContent = `${$<HTMLInputElement>('volume').value} %`;
  });

  root.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    const preset = t.closest<HTMLElement>('[data-preset]')?.dataset.preset;
    if (preset && PRESETS[preset]) {
      fake = { ...PRESETS[preset].data };
      renderForm();
      return;
    }
    const step = t.closest<HTMLElement>('[data-step]')?.dataset.step;
    if (step) {
      const frame = 1000 / (selected()?.fps ?? 24);
      const delta =
        step === 'frame' ? frame : step === '-frame' ? -frame : Number(step);
      return seek(scrubMs + delta);
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'stop') return send({ type: 'stop' });
    if (act === 'replay') return last && play(last);
    if (act === 'copy') {
      const url = $<HTMLInputElement>('obs-url').value;
      if (url) await navigator.clipboard?.writeText(url).catch(() => {});
      return;
    }
    readForm();
    const event = testEvent(category, fake);
    if (act === 'play' || act === 'overlay') {
      const variant = selected();
      if (variant) play({ variant, data: previewData(event) });
      if (act === 'overlay')
        send({
          type: 'overlay',
          volume: volume(),
          items: overlapCategories(category).flatMap((cat) => {
            const v = variants.find((x) => x.type === cat && !x.missing.length);
            return v
              ? [
                  {
                    variant: v,
                    data: previewData(testEvent(cat, fake)),
                    placement: calib.placement(v.id),
                  },
                ]
              : [];
          }),
        });
      return;
    }
    if (act === 'queue') {
      const out = $('queue-result');
      try {
        const res = await fetch('/api/alerts/test', {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify(event),
        });
        const body = (await res.json()) as {
          outcome?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        out.textContent = `Core : ${body.outcome ?? 'ok'}.`;
      } catch (e) {
        out.textContent = `Refusé : ${(e as Error).message}`;
      }
      void refresh();
    }
  });

  // The 1920×1080 stage scaled to the column width.
  new ResizeObserver(() => {
    stageBox.style.setProperty(
      '--al-scale',
      String(stageBox.clientWidth / 1920),
    );
  }).observe(stageBox);

  renderForm();
  renderState();
  void load();

  return {
    setVisible(visible: boolean) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      calib.setVisible(visible);
      if (!visible) {
        send({ type: 'stop' });
        return;
      }
      void refresh();
      if (!variants.length) void load();
      timer = window.setInterval(() => void refresh(), 1500);
    },
  };
}
