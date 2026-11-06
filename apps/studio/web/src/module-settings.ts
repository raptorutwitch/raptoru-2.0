// Refonte H10 / H12 — « Prix et limites » of a module, in its own page. The values live in the Core (module_settings,
// per channel); the Core validates them against its bounds and every executor reads them from there. Studio only shows
// and sends them. Never the odds nor the prize tables (decision H10).

import { confirmBox, esc, fld, fmt, run, sw, toast } from './ds/ds.js';
import { ApiError } from './http.js';

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
const isSwitch = (s: SettingView) => s.min === 0 && s.max === 1;

/** The panel (pure): one line per setting, its bounds and its default; a value off the default says so. */
export function settingsPanelHtml(
  title: string,
  settings: SettingView[] | null,
  keys: string[],
) {
  if (!settings)
    return `<section class="ms-panel"><h3>${esc(title)}</h3><p class="d-note">Réglages indisponibles sur ce profil.</p></section>`;
  const rows = keys
    .map((k) => settings.find((s) => s.key === k))
    .filter((s): s is SettingView => !!s)
    .map((s) =>
      isSwitch(s)
        ? // A 0 / 1 setting is a switch (never a number to type).
          `<div class="ms-row ms-row--switch" data-setting="${esc(s.key)}">
        <label>${esc(s.label)}<small>${s.help ? esc(s.help) : s.value === 1 ? 'Activé' : 'Coupé'}</small></label>
        ${sw(s.value === 1, `data-ms-toggle="${esc(s.key)}"`, s.label)}
      </div>`
        : `<div class="ms-row" data-setting="${esc(s.key)}">
        <label for="ms-${esc(s.key)}">${esc(s.label)}<small>De ${fmt(s.min)} à ${fmt(s.max)} · par défaut ${fmt(s.default)}${s.value !== s.default ? ' · <b>modifié</b>' : ''}${s.help ? ` · ${esc(s.help)}` : ''}</small></label>
        ${fld(`id="ms-${esc(s.key)}" min="${s.min}" max="${s.max}" step="1" data-ms-input="${esc(s.key)}"`, s.value, s.unit)}
        <button type="button" class="d-btn sm" data-ms-save="${esc(s.key)}">Enregistrer</button>
      </div>`,
    )
    .join('');
  return `<section class="ms-panel"><h3>${esc(title)}</h3>
    <p class="d-note">Valeurs appliquées aux prochains achats. Les probabilités et les gains ne se règlent pas ici.</p>
    ${rows || '<p class="d-note">Aucun réglage pour ce module.</p>'}</section>`;
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
  if (!res.ok)
    throw new ApiError(res.status, out.error ?? `HTTP ${res.status}`);
  return out.settings ?? null;
}

const REFUSED: Record<string, string> = {
  out_of_bounds: 'Valeur hors des bornes.',
  unknown_setting: 'Réglage inconnu.',
};

/**
 * Mounts the panel in `host` (its own refresh and save). Un prix est une règle d'économie : sa confirmation dit l'effet réel. Un
 * interrupteur agit tout de suite et se rattrape.
 */
export function mountSettingsPanel(
  host: HTMLElement,
  title: string,
  keys: string[],
) {
  let settings: SettingView[] | null = null;
  const render = () => {
    host.innerHTML = settingsPanelHtml(title, settings, keys);
  };
  const save = async (
    btn: HTMLElement | null,
    key: string,
    value: number,
    done: string,
    undo?: () => void,
  ) => {
    let ok = false;
    await run(
      btn,
      async () => {
        const next = await saveSetting(key, value);
        if (next) settings = next;
        ok = true;
      },
      undefined,
      REFUSED,
    );
    render();
    if (ok) toast(done, undo ? { undo } : {});
  };
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ms-save]');
    const key = b?.dataset.msSave;
    if (!key) return;
    const s = settings?.find((x) => x.key === key);
    const input = host.querySelector<HTMLInputElement>(
      `[data-ms-input="${key}"]`,
    );
    const value = Number(input?.value);
    if (!s || !Number.isInteger(value)) return;
    void confirmBox({
      title: `${s.label} : ${fmt(s.value)} → ${fmt(value)} ${s.unit}`,
      body: 'Appliqué aux prochains achats. Rien de ce qui est déjà payé ne change.',
      yes: 'Enregistrer',
      no: 'Annuler',
      danger: false,
    }).then((yes) => {
      if (yes)
        void save(
          b,
          key,
          value,
          `${s.label} : ${fmt(value)} ${s.unit} enregistré`,
        );
    });
  });
  host.addEventListener('change', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>(
      '[data-ms-toggle]',
    );
    const key = box?.dataset.msToggle;
    const s = key ? settings?.find((x) => x.key === key) : null;
    if (!box || !s) return;
    const value = box.checked ? 1 : 0;
    void save(
      null,
      s.key,
      value,
      `${s.label} : ${value ? 'activé' : 'coupé'}`,
      () => void save(null, s.key, 1 - value, `${s.label} rétabli`),
    );
  });
  return {
    async refresh() {
      settings = await loadSettings();
      render();
    },
  };
}
