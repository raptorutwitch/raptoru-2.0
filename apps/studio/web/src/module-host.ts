import { esc, getJson, postJson, tryGetJson } from './http.js';
import { mountSettingsPanel } from './module-settings.js';

// The generic Studio page of a module of the module host (architecture socle): status, settings, admin actions with
// their real scope, activity with the moderator refund. Every module gets it for free; a module that needs its own
// screen writes it and keeps these parts (they are exported). One view, one page per module (registry anchor).

export interface CatalogModule {
  id: string;
  label: string;
  description: string;
  category: string;
  lab_only: boolean;
  capabilities: string[];
  enabled: boolean;
  settings: string[];
  admin: {
    name: string;
    label: string;
    confirm: string | null;
    input: { key: string; label: string; min: number; max: number } | null;
  }[];
  viewer: { name: string; label: string; price: number; live_only: boolean }[];
  moderation: {
    visible: boolean;
    refund: 'never' | 'moderator';
    note: string;
  } | null;
  status: {
    intention: 'on' | 'off';
    observed: 'ready' | 'waiting' | 'error' | 'unknown';
    summary: string;
    reasons: string[];
    activity?: string | null;
  };
}

export interface Activity {
  activity_id: string;
  module_id: string;
  action: string;
  viewer: { id: string; display_name: string } | null;
  amount: number;
  status: string;
  result: unknown;
  created_at: string;
  ended_by: string | null;
  reason: string | null;
}

const STATE_CLASS: Record<string, string> = {
  ready: 'is-ok',
  waiting: 'is-unknown',
  error: 'is-down',
  unknown: 'is-unknown',
};
const STATUS_FR: Record<string, string> = {
  done: 'terminé',
  queued: 'en attente',
  failed: 'échec',
  refunded: 'remboursé',
  canceled: 'annulé',
};

/** The status line (pure): OFF on purpose is said as a setting, never as an outage; never green on the switch alone. */
export function statusHtml(m: CatalogModule) {
  const s = m.status;
  const cls =
    s.intention === 'off' ? '' : (STATE_CLASS[s.observed] ?? 'is-unknown');
  const text =
    s.intention === 'off'
      ? 'Coupé (réglage) : invisible pour les viewers.'
      : s.summary;
  return `<p class="rs-state ${cls}">${esc(text)}</p>${
    s.intention !== 'off' && s.reasons.length
      ? `<ul class="rs-muted">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : ''
  }`;
}

/** The activity table (pure); the refund button only where the module's policy allows it and the action was paid. */
export function activityHtml(items: Activity[], m: CatalogModule | null) {
  if (!items.length) return '<p class="rs-muted">Aucune activité.</p>';
  const canRefund = m?.moderation?.refund === 'moderator';
  return `<div class="rs-scroll"><table class="rs-tbl"><thead><tr><th>Quand</th><th>Action</th><th>Qui</th><th class="num">Jetons</th><th>État</th><th></th></tr></thead><tbody>${items
    .map(
      (i) =>
        `<tr><td>${esc(new Date(i.created_at).toLocaleString('fr-FR'))}</td><td>${esc(i.action)}</td><td>${esc(i.viewer?.display_name ?? i.ended_by ?? '—')}</td><td class="num">${i.amount || ''}</td><td>${esc(STATUS_FR[i.status] ?? i.status)}${i.reason ? ` · ${esc(i.reason)}` : ''}</td><td>${
          canRefund && i.amount > 0 && i.status !== 'refunded'
            ? `<button type="button" class="rs-btn sm" data-refund="${esc(i.activity_id)}">Rembourser…</button>`
            : ''
        }</td></tr>`,
    )
    .join('')}</tbody></table></div>`;
}

function cardHtml(m: CatalogModule) {
  return `<section class="rs-panel" data-module="${esc(m.id)}"><h2>${esc(m.label)}${m.lab_only ? ' <span class="rs-chip">Lab</span>' : ''}</h2>
    <p class="rs-muted">${esc(m.description)}</p>${statusHtml(m)}
    ${m.viewer.length ? `<p class="rs-muted">Pour les viewers : ${m.viewer.map((v) => `${esc(v.label)} (${v.price ? `${v.price} Jetons` : 'gratuit'}${v.live_only ? ', pendant le live' : ''})`).join(' · ')}.</p>` : ''}
    ${m.moderation ? `<p class="rs-muted">Modération : ${esc(m.moderation.note)}</p>` : ''}
    <div data-role="settings"></div>
    ${m.admin.length ? `<div class="rs-buttons">${m.admin.map((a) => `<button type="button" class="rs-btn" data-admin="${esc(a.name)}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    ${m.capabilities.includes('history') ? '<h3>Activité</h3><div data-role="activity"><p class="rs-muted">Lecture…</p></div>' : ''}</section>`;
}

export function mountModuleHost(root: HTMLElement) {
  let focus: string | null = null;
  let visible = false;
  let modules: CatalogModule[] | null = null;
  let message = '';
  const render = async () => {
    if (!visible) return;
    modules =
      (await tryGetJson<{ modules: CatalogModule[] }>('/api/modules'))
        ?.modules ?? null;
    const shown = modules?.filter((m) => !focus || m.id === focus) ?? [];
    root.innerHTML = `<div class="rs-page rs-form">
      <header class="rs-page-head"><h1>${focus && shown[0] ? esc(shown[0].label) : 'Modules du socle'}</h1>
      <p>Modules construits sur le socle commun : chacun a son état, ses réglages, ses actions et son activité, sans raccordement propre.</p></header>
      ${message ? `<p class="rs-flash${message.startsWith('Refusé') ? ' is-bad' : ''}" role="status">${esc(message)}</p>` : ''}
      ${modules === null ? '<p class="rs-state is-unknown">Catalogue illisible : le Core de ce profil ne fournit pas les modules du socle.</p>' : shown.length ? shown.map(cardHtml).join('') : '<p class="rs-muted">Aucun module.</p>'}
    </div>`;
    for (const m of shown) {
      const card = root.querySelector<HTMLElement>(`[data-module="${m.id}"]`)!;
      if (m.settings.length || m.viewer.length)
        void mountSettingsPanel(
          card.querySelector<HTMLElement>('[data-role="settings"]')!,
          'Réglages',
          [...(m.viewer.length ? [`${m.id}.enabled`] : []), ...m.settings],
        ).refresh();
      // No journal on the host for this module (a historical one keeps its own): never an empty « Activité ».
      if (!m.capabilities.includes('history')) continue;
      const act = await tryGetJson<{ items: Activity[] }>(
        `/api/modules/activity?module=${m.id}&limit=20`,
      );
      card.querySelector<HTMLElement>('[data-role="activity"]')!.innerHTML = act
        ? activityHtml(act.items, m)
        : '<p class="rs-state is-unknown">Activité illisible.</p>';
    }
  };
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const card = t.closest<HTMLElement>('[data-module]');
    const m = modules?.find((x) => x.id === card?.dataset.module);
    if (!m) return;
    const admin = t.closest<HTMLElement>('[data-admin]')?.dataset.admin;
    const refund = t.closest<HTMLElement>('[data-refund]')?.dataset.refund;
    if (admin) {
      const a = m.admin.find((x) => x.name === admin)!;
      let input: unknown = null;
      if (a.confirm && !confirm(a.confirm)) return;
      if (a.input) {
        const n = Number(
          prompt(
            `${a.input.label} (${a.input.min} à ${a.input.max})`,
            String(a.input.min),
          ),
        );
        if (!Number.isInteger(n)) return;
        input = { [a.input.key]: n };
      }
      void postJson(`/api/modules/${m.id}/admin/${admin}`, { input }).then(
        () => ((message = `${a.label} : fait.`), render()),
        (err: Error) => ((message = `Refusé : ${err.message}`), render()),
      );
    }
    if (refund) {
      const reason = prompt(
        'Rembourser cette action ? Le débit d’origine est rendu une seule fois. Motif :',
        '',
      );
      if (!reason?.trim()) return;
      void postJson('/api/modules/refund', {
        activity_id: refund,
        reason,
      }).then(
        () => ((message = 'Remboursé.'), render()),
        (err: Error) => ((message = `Refusé : ${err.message}`), render()),
      );
    }
  });
  return {
    setVisible(v: boolean) {
      visible = v;
      if (v) void render();
    },
    setFocus(f: string | null) {
      focus = f;
      if (visible) void render();
    },
  };
}

export { getJson };
