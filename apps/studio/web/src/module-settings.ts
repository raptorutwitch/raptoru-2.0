// Refonte H10 / H12 — « Prix et limites » of a module, in its own page. The values live in the Core (module_settings,
// per channel); the Core validates them against its bounds and every executor reads them from there. Studio only shows
// and sends them. Never the odds nor the prize tables (decision H10).

export interface SettingView {
  key: string;
  label: string;
  unit: string;
  value: number;
  default: number;
  min: number;
  max: number;
  help?: string;
}

const HEADERS = { 'content-type': 'application/json', 'x-raptoru-studio': '1' };
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const fmt = (n: number) => n.toLocaleString('fr-FR');
const isSwitch = (s: SettingView) => s.min === 0 && s.max === 1;

/** The panel (pure): one line per setting, its bounds and its default; a value off the default says so. */
export function settingsPanelHtml(
  title: string,
  settings: SettingView[] | null,
  keys: string[],
  message = '',
) {
  if (!settings)
    return `<section class="rs-panel ms-panel"><h2>${esc(title)}</h2><p class="rs-muted">Réglages indisponibles sur ce profil (Core sans réglages de modules).</p></section>`;
  const rows = keys
    .map((k) => settings.find((s) => s.key === k))
    .filter((s): s is SettingView => !!s)
    .map((s) =>
      isSwitch(s)
        ? // A 0 / 1 setting is a switch (never a number to type).
          `<div class="ms-row ms-row--switch" data-setting="${esc(s.key)}">
        <label class="ms-label" for="ms-${esc(s.key)}">${esc(s.label)}<small class="rs-muted">${s.help ? esc(s.help) : ''}</small></label>
        <label class="ms-switch"><input id="ms-${esc(s.key)}" type="checkbox" data-ms-toggle="${esc(s.key)}" ${s.value === 1 ? 'checked' : ''}> ${s.value === 1 ? 'Activé' : 'Coupé'}</label>
      </div>`
        : `<div class="ms-row" data-setting="${esc(s.key)}">
        <label class="ms-label" for="ms-${esc(s.key)}">${esc(s.label)}<small class="rs-muted">De ${fmt(s.min)} à ${fmt(s.max)} · par défaut ${fmt(s.default)}${s.value !== s.default ? ' · <b>modifié</b>' : ''}${s.help ? ` · ${esc(s.help)}` : ''}</small></label>
        <span class="rs-unit ms-field"><input id="ms-${esc(s.key)}" type="number" min="${s.min}" max="${s.max}" step="1" value="${s.value}" data-ms-input="${esc(s.key)}"><em>${esc(s.unit)}</em></span>
        <button type="button" class="rs-btn sm" data-ms-save="${esc(s.key)}">Enregistrer</button>
      </div>`,
    )
    .join('');
  return `<section class="rs-panel ms-panel"><h2>${esc(title)}</h2>
    <p class="rs-muted">Valeurs enregistrées dans le Core et appliquées aux prochains achats. Les probabilités et les gains ne se règlent pas ici.</p>
    ${message ? `<p class="rs-flash${message.startsWith('Refusé') ? ' is-bad' : ''}" role="status">${esc(message)}</p>` : ''}
    ${rows || '<p class="rs-muted">Aucun réglage pour ce module sur ce Core.</p>'}</section>`;
}

export async function loadSettings(): Promise<SettingView[] | null> {
  try {
    const res = await fetch('/api/module-settings', { headers: HEADERS });
    if (!res.ok) return null;
    return ((await res.json()) as { settings: SettingView[] }).settings;
  } catch {
    return null;
  }
}

export async function saveSetting(key: string, value: number) {
  const res = await fetch('/api/module-settings', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ key, value }),
  });
  const out = (await res.json().catch(() => ({}))) as {
    error?: string;
    settings?: SettingView[];
  };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out.settings ?? null;
}

const REFUSED: Record<string, string> = {
  out_of_bounds: 'valeur hors des bornes',
  unknown_setting: 'réglage inconnu',
};

/** Mounts the panel in `host` (its own refresh and save; a confirmation states the real effect). */
export function mountSettingsPanel(
  host: HTMLElement,
  title: string,
  keys: string[],
) {
  let settings: SettingView[] | null = null;
  let message = '';
  const render = () => {
    host.innerHTML = settingsPanelHtml(title, settings, keys, message);
  };
  host.addEventListener('click', (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-ms-save]')
      ?.dataset.msSave;
    if (!key) return;
    const s = settings?.find((x) => x.key === key);
    const input = host.querySelector<HTMLInputElement>(
      `[data-ms-input="${key}"]`,
    );
    const value = Number(input?.value);
    if (!s || !Number.isInteger(value)) return;
    if (
      !confirm(
        `${s.label} : ${fmt(s.value)} → ${fmt(value)} ${s.unit} ?\n\nAppliqué aux prochains achats, sur le Core de ce profil. Rien de ce qui est déjà payé ne change.`,
      )
    )
      return;
    void saveSetting(key, value).then(
      (next) => {
        if (next) settings = next;
        message = `${s.label} : ${fmt(value)} ${s.unit} enregistré.`;
        render();
      },
      (err: Error) => {
        message = `Refusé : ${REFUSED[err.message] ?? err.message}`;
        render();
      },
    );
  });
  host.addEventListener('change', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>('[data-ms-toggle]');
    const key = box?.dataset.msToggle;
    const s = key ? settings?.find((x) => x.key === key) : null;
    if (!box || !s) return;
    const value = box.checked ? 1 : 0;
    if (!confirm(`${s.label} : ${value ? 'activer' : 'couper'} ?\n\nSur le Core de ce profil.`)) {
      box.checked = !box.checked;
      return;
    }
    void saveSetting(s.key, value).then(
      (next) => {
        if (next) settings = next;
        message = `${s.label} : ${value ? 'activé' : 'coupé'}.`;
        render();
      },
      (err: Error) => {
        message = `Refusé : ${REFUSED[err.message] ?? err.message}`;
        render();
      },
    );
  });
  return {
    async refresh() {
      settings = await loadSettings();
      render();
    },
  };
}
