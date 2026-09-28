// Soundboard configuration (Studio): every sound of the Core bank with its streamer settings.
// A compact list to scan the whole bank; a click on a sound opens its settings in place. Each
// change is sent to Core right away (Core validates and persists), with a discreet per-row
// feedback; the Extension Lab frames are then refreshed so the viewer side follows at once.

type Mode = 'stack' | 'queue' | 'ignore_if_running';
type Protection = 'off' | 'light' | 'medium';
type Sound = {
  id: string;
  /** Shown to viewers: custom_label ?? default_label. */
  label: string;
  default_label: string;
  custom_label: string | null;
  enabled: boolean;
  token_cost: number;
  credit_cost: number;
  cooldown_ms: number;
  playback_mode: Mode;
  volume: number;
  duration_ms: number | null;
  preview_url: string | null;
  variants: number;
};
type Config = { sounds: Sound[]; settings: { volume_protection: Protection } };
type Field = Exclude<
  keyof Sound,
  'id' | 'duration_ms' | 'preview_url' | 'variants'
>;
type SaveState = 'saving' | 'saved' | 'error';

const MODES: Record<Mode, { label: string; hint: string }> = {
  stack: {
    label: 'Superposer',
    hint: 'Chaque achat joue tout de suite, même par-dessus lui-même.',
  },
  queue: {
    label: 'File',
    hint: 'Les achats de ce son jouent l’un après l’autre.',
  },
  ignore_if_running: {
    label: 'Ignorer',
    hint: 'Refusé tant que ce son est en attente ou en lecture.',
  },
};
const PROTECTIONS: Record<Protection, { label: string; hint: string }> = {
  off: {
    label: 'Désactivée',
    hint: 'Chaque son garde son volume, même à plusieurs.',
  },
  light: {
    label: 'Légère',
    hint: 'Baisse douce quand plusieurs sons se superposent (plancher 68 %).',
  },
  medium: {
    label: 'Moyenne',
    hint: 'Baisse plus marquée en cas de rafale (plancher 55 %).',
  },
};
type View = 'all' | 'on' | 'off';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const fmt = (n: number) => n.toLocaleString('fr-FR');
const seconds = (ms: number) =>
  `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;
const PLAY =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.2v11.6a.9.9 0 0 0 1.4.8l9.2-5.8a.9.9 0 0 0 0-1.6L9.9 5.4a.9.9 0 0 0-1.4.8Z" fill="currentColor"/></svg>';
const STOP =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>';
const CHEVRON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEARCH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export function mountSoundConfig(root: HTMLElement) {
  root.innerHTML = `<div class="scfg">
    <header class="scfg-head">
      <div class="scfg-title">
        <h2>Soundboard</h2>
        <p data-id="summary">Chargement…</p>
      </div>
      <div class="scfg-protect">
        <span class="scfg-protect__label">Protection volume</span>
        <div class="scfg-seg scfg-seg--protect" role="radiogroup" aria-label="Protection volume" data-id="protection">
          ${(Object.keys(PROTECTIONS) as Protection[])
            .map(
              (p) =>
                `<button type="button" role="radio" data-protection="${p}">${PROTECTIONS[p].label}</button>`,
            )
            .join('')}
        </div>
        <span class="scfg-protect__hint" data-id="protection-hint"></span>
      </div>
    </header>
    <div class="scfg-tools">
      <label class="scfg-search">${SEARCH}<input data-id="filter" type="search" placeholder="Rechercher un son…" aria-label="Rechercher un son" autocomplete="off"></label>
      <div class="scfg-seg" role="group" aria-label="Afficher" data-id="view">
        <button type="button" data-view="all">Tous</button>
        <button type="button" data-view="on">Actifs</button>
        <button type="button" data-view="off">Désactivés</button>
      </div>
      <span class="scfg-note">Lab · aucun débit réel · chaque modification s’applique immédiatement</span>
    </div>
    <p data-id="status" class="scfg-status" role="status"></p>
    <div class="scfg-list" data-id="list" role="list"></div>
  </div>`;
  const $ = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>(`[data-id="${id}"]`)!;
  let config: Config | null = null;
  let expanded: string | null = null;
  let view: View = 'all';
  let preview: HTMLAudioElement | null = null;
  let previewId: string | null = null;
  const saveStates = new Map<string, { state: SaveState; message?: string }>();
  const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const inputTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const api = async (path: string, body?: unknown) => {
    const r = await fetch('/api/sound-lab/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error ?? 'indisponible');
    return result;
  };
  const notifyExtension = () =>
    window.dispatchEvent(new CustomEvent('raptoru:lab-refresh'));
  const find = (id: string) => config?.sounds.find((s) => s.id === id);

  const summary = () => {
    if (!config) return;
    const enabled = config.sounds.filter((s) => s.enabled).length;
    $('summary').innerHTML =
      `<strong>${enabled}</strong> actifs sur ${config.sounds.length} sons`;
  };
  const syncProtection = () => {
    const current = config?.settings.volume_protection ?? 'light';
    for (const b of $('protection').querySelectorAll<HTMLButtonElement>(
      'button',
    )) {
      const on = b.dataset.protection === current;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    }
    $('protection-hint').textContent = PROTECTIONS[current].hint;
  };
  const syncView = () => {
    for (const b of $('view').querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.view === view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  const saveMark = (id: string) => {
    const s = saveStates.get(id);
    if (!s) return '<span class="scfg-save" aria-hidden="true"></span>';
    const text =
      s.state === 'saving'
        ? 'Enregistrement…'
        : s.state === 'saved'
          ? 'Enregistré'
          : 'Refusé';
    return `<span class="scfg-save is-${s.state}" title="${esc(s.message ?? text)}"><i></i>${text}</span>`;
  };

  const summaryHtml = (s: Sound) => `
      <button type="button" class="scfg-play${previewId === s.id ? ' is-playing' : ''}" data-action="preview" ${s.preview_url ? '' : 'disabled'}
        aria-label="${previewId === s.id ? 'Arrêter' : 'Écouter'} ${esc(s.label)}" title="${s.preview_url ? 'Écouter (Studio uniquement)' : 'Son tiré au hasard : pas d’aperçu'}">${s.preview_url ? (previewId === s.id ? STOP : PLAY) : '🎲'}</button>
      <span class="scfg-name"><strong>${esc(s.label)}</strong><small>${esc(s.id)}${s.custom_label !== null ? ` · par défaut : ${esc(s.default_label)}` : ''}${s.variants > 1 ? ` · ${s.variants} variantes` : ''}${s.duration_ms ? ` · ${seconds(s.duration_ms)}` : ''}</small></span>
      <span class="scfg-toggle-wrap"><button type="button" role="switch" class="scfg-switch" data-action="toggle" aria-checked="${s.enabled}" aria-label="Actif"><i></i></button><span class="scfg-toggle-label">${s.enabled ? 'Actif' : 'Off'}</span></span>
      <span class="scfg-cell scfg-price"><b class="is-token">${fmt(s.token_cost)}</b><em>J</em><span class="scfg-sep">/</span><b class="is-credit">${fmt(s.credit_cost)}</b><em>C</em></span>
      <span class="scfg-cell scfg-chip${s.cooldown_ms ? ' is-cooldown' : ''}">${s.cooldown_ms ? `⏱ ${seconds(s.cooldown_ms)}` : 'Sans cooldown'}</span>
      <span class="scfg-cell scfg-chip scfg-mode is-${s.playback_mode}">${MODES[s.playback_mode].label}</span>
      <span class="scfg-cell scfg-vol"><span class="scfg-vol__bar"><i style="width:${s.volume}%"></i></span>${s.volume} %</span>
      ${saveMark(s.id)}
      <span class="scfg-chevron">${CHEVRON}</span>`;

  const labelMetaHtml = (s: Sound) =>
    s.custom_label !== null
      ? `<small>Nom par défaut : ${esc(s.default_label)}</small><button type="button" class="scfg-reset" data-action="reset-label">↺ Nom par défaut</button>`
      : '<small>Nom par défaut</small>';

  const editorHtml = (s: Sound) => `
    <div class="scfg-editor" data-editor="${esc(s.id)}">
      <label class="scfg-field scfg-field--name"><span>Nom affiché</span>
        <input type="text" data-field="label" maxlength="40" value="${esc(s.label)}" placeholder="${esc(s.default_label)}">
        <span class="scfg-label-meta" data-label-meta>${labelMetaHtml(s)}</span></label>
      <label class="scfg-field"><span>Prix jetons</span>
        <span class="scfg-input scfg-input--token"><input type="number" data-field="token_cost" min="0" max="1000000" step="50" value="${s.token_cost}"><em>jetons</em></span></label>
      <label class="scfg-field"><span>Prix crédits</span>
        <span class="scfg-input scfg-input--credit"><input type="number" data-field="credit_cost" min="0" max="100" step="1" value="${s.credit_cost}"><em>crédits</em></span></label>
      <label class="scfg-field"><span>Cooldown</span>
        <span class="scfg-input"><input type="number" data-field="cooldown_ms" min="0" max="3600" step="1" value="${s.cooldown_ms / 1000}"><em>secondes</em></span></label>
      <div class="scfg-field scfg-field--mode"><span>Lecture</span>
        <div class="scfg-seg" role="radiogroup" aria-label="Stratégie de lecture">
          ${(Object.keys(MODES) as Mode[])
            .map(
              (m) =>
                `<button type="button" role="radio" data-mode="${m}" class="${m === s.playback_mode ? 'is-active' : ''}" aria-checked="${m === s.playback_mode}">${MODES[m].label}</button>`,
            )
            .join('')}
        </div>
        <small data-hint="mode">${MODES[s.playback_mode].hint}</small>
      </div>
      <label class="scfg-field scfg-field--volume"><span>Volume <output>${s.volume} %</output></span>
        <input type="range" data-field="volume" min="0" max="100" step="5" value="${s.volume}" style="--v:${s.volume}%"></label>
    </div>`;

  const rowHtml = (
    s: Sound,
  ) => `<div class="scfg-row${s.enabled ? '' : ' is-off'}${expanded === s.id ? ' is-open' : ''}" data-sound="${esc(s.id)}" role="listitem">
      <div class="scfg-row__summary" data-action="expand" tabindex="0" role="button" aria-expanded="${expanded === s.id}">${summaryHtml(s)}</div>
      ${expanded === s.id ? editorHtml(s) : ''}
    </div>`;

  const visible = () => {
    const q = $<HTMLInputElement>('filter').value.trim().toLowerCase();
    return (config?.sounds ?? []).filter(
      (s) =>
        (!q || s.label.toLowerCase().includes(q) || s.id.includes(q)) &&
        (view === 'all' || (view === 'on') === s.enabled),
    );
  };
  const render = () => {
    if (!config) return;
    const list = visible();
    $('list').innerHTML = list.length
      ? list.map(rowHtml).join('')
      : '<p class="scfg-empty">Aucun son ne correspond.</p>';
    summary();
    syncProtection();
    syncView();
  };
  const rowOf = (id: string) =>
    $('list').querySelector<HTMLElement>(
      `.scfg-row[data-sound="${CSS.escape(id)}"]`,
    );
  // Only the summary line is redrawn: the editor keeps focus and caret while typing.
  const refreshSummary = (id: string) => {
    const s = find(id);
    const row = rowOf(id);
    if (!s || !row) return;
    row.classList.toggle('is-off', !s.enabled);
    row.querySelector('.scfg-row__summary')!.innerHTML = summaryHtml(s);
  };

  const load = async () => {
    try {
      config = (await api('config')) as Config;
      $('status').textContent = '';
      render();
    } catch {
      $('status').textContent =
        'Soundboard Lab non lancé : utilise npm run bonk:lab depuis le dépôt.';
    }
  };

  const setSaveState = (id: string, state: SaveState, message?: string) => {
    clearTimeout(clearTimers.get(id));
    saveStates.set(id, { state, message });
    if (state === 'saved')
      clearTimers.set(
        id,
        setTimeout(() => {
          saveStates.delete(id);
          refreshSummary(id);
        }, 1800),
      );
    refreshSummary(id);
  };

  const save = async (
    id: string,
    field: Field,
    value: string | number | boolean | null,
  ) => {
    setSaveState(id, 'saving');
    try {
      const updated = (await api(`sounds/${encodeURIComponent(id)}`, {
        [field]: value,
      })) as Sound;
      const i = config!.sounds.findIndex((s) => s.id === id);
      config!.sounds[i] = updated;
      if (field === 'label') {
        const meta = rowOf(id)?.querySelector<HTMLElement>('[data-label-meta]');
        if (meta) meta.innerHTML = labelMetaHtml(updated);
      }
      setSaveState(id, 'saved');
      summary();
      notifyExtension();
    } catch (e) {
      setSaveState(id, 'error', `Refusé par Core : ${(e as Error).message}`);
      // Show the value Core really holds.
      const current = find(id)!;
      const editor = rowOf(id)?.querySelector('.scfg-editor');
      if (editor) editor.outerHTML = editorHtml(current);
    }
  };
  const numberValue = (field: Field, raw: string) =>
    field === 'cooldown_ms'
      ? Math.round(Number(raw) * 1000)
      : Math.round(Number(raw));

  const playPreview = (id: string) => {
    const s = find(id);
    const wasPlaying = previewId;
    preview?.pause();
    preview = null;
    previewId = null;
    if (wasPlaying) refreshSummary(wasPlaying);
    if (!s?.preview_url || wasPlaying === id) return;
    // One preview at a time, at the configured volume (local listening only).
    preview = new Audio('/ext/' + s.preview_url);
    preview.volume = s.volume / 100;
    previewId = id;
    const done = () => {
      if (previewId !== id) return;
      previewId = null;
      preview = null;
      refreshSummary(id);
    };
    preview.addEventListener('ended', done, { once: true });
    void preview.play().catch(done);
    refreshSummary(id);
  };

  root.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const protection = target.closest<HTMLElement>('[data-protection]');
    if (protection) {
      const value = protection.dataset.protection as Protection;
      $('status').textContent = '';
      void api('settings', { volume_protection: value })
        .then((settings) => {
          config!.settings = settings;
          syncProtection();
        })
        .catch(
          (e) =>
            ($('status').textContent =
              `Protection refusée : ${String(e.message)}`),
        );
      return;
    }
    const viewButton = target.closest<HTMLElement>('[data-view]');
    if (viewButton) {
      view = viewButton.dataset.view as View;
      render();
      return;
    }
    const row = target.closest<HTMLElement>('.scfg-row');
    const id = row?.dataset.sound;
    if (!row || !id) return;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    const mode = target.closest<HTMLElement>('[data-mode]')?.dataset.mode as
      Mode | undefined;
    if (action === 'preview') return playPreview(id);
    if (action === 'reset-label') {
      // Back to the default name: the field shows it again, the viewer gets it on the next refresh.
      const input = row.querySelector<HTMLInputElement>('[data-field="label"]');
      if (input) input.value = find(id)!.default_label;
      clearTimeout(inputTimers.get(`${id}:label`));
      return void save(id, 'label', null);
    }
    if (action === 'toggle')
      return void save(id, 'enabled', !find(id)!.enabled);
    if (mode) {
      const seg = target.closest('.scfg-seg')!;
      for (const b of seg.querySelectorAll<HTMLElement>('[data-mode]')) {
        b.classList.toggle('is-active', b.dataset.mode === mode);
        b.setAttribute('aria-checked', String(b.dataset.mode === mode));
      }
      row.querySelector('[data-hint="mode"]')!.textContent = MODES[mode].hint;
      return void save(id, 'playback_mode', mode);
    }
    if (action === 'expand') {
      expanded = expanded === id ? null : id;
      render();
      if (expanded)
        rowOf(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  root.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement;
    if (
      (ev.key === 'Enter' || ev.key === ' ') &&
      target.classList.contains('scfg-row__summary')
    ) {
      ev.preventDefault();
      target.click();
    }
  });
  root.addEventListener('input', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.dataset.id === 'filter') return render();
    const id = input.closest<HTMLElement>('.scfg-row')?.dataset.sound;
    const field = input.dataset.field as Field | undefined;
    if (!id || !field) return;
    if (field === 'volume') {
      input.style.setProperty('--v', `${input.value}%`);
      input.closest('label')!.querySelector('output')!.textContent =
        `${input.value} %`;
    }
    // Typing a number or a name: save once the value settles.
    const key = `${id}:${field}`;
    clearTimeout(inputTimers.get(key));
    inputTimers.set(
      key,
      setTimeout(
        () =>
          void save(
            id,
            field,
            field === 'label' ? input.value : numberValue(field, input.value),
          ),
        500,
      ),
    );
  });

  return {
    setVisible(visible: boolean) {
      if (visible) void load();
      else {
        preview?.pause();
        preview = null;
        previewId = null;
      }
    },
  };
}
