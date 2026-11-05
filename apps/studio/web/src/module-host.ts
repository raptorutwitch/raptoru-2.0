import { esc, getJson, postJson, tryGetJson } from './http.js';
import { mountSettingsPanel } from './module-settings.js';
import { PAGES } from './shell/registry.js';
import './module-host.css';

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
  /** The host's switch `<id>.enabled` exists (older Core: absent, read as « no switch »). */
  has_switch?: boolean;
  /** It hands its actions to a player (OBS…): claim / report. */
  player?: boolean;
  chat_words?: string[];
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
      ? // Its own switch is a setting here (the host's); a historical one says where its switch is (reasons).
        m.has_switch
        ? 'Coupé (réglage) : invisible pour les viewers.'
        : 'Coupé.'
      : s.summary;
  return `<p class="rs-state ${cls}">${esc(text)}</p>${
    // Off too: a historical module says where its own switch is.
    s.reasons.length
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

/** The module's own Studio page (its card here, or a historical page with its own screen), or null. */
export function modulePage(id: string) {
  return (
    PAGES.find((p) => p.anchor === id) ??
    PAGES.find((p) => p.id === id.replace(/_/g, '-')) ??
    null
  );
}

/** Pure: the overview — one compact tile per module (its real state, never green on a switch), a link to its page. */
export function overviewHtml(modules: CatalogModule[]) {
  return `<div class="mh-grid">${modules
    .map((m) => {
      const page = modulePage(m.id);
      const open = page
        ? `<a class="rs-btn sm" href="?p=${esc(page.id)}">Ouvrir</a>`
        : `<button type="button" class="rs-btn sm" data-focus="${esc(m.id)}">Ouvrir</button>`;
      return `<article class="rs-panel mh-tile" data-tile="${esc(m.id)}">
        <header><h2>${esc(m.label)}</h2>${m.lab_only ? '<span class="rs-chip">Lab</span>' : ''}</header>
        ${statusHtml(m)}
        <footer>${m.status.activity ? `<small class="rs-muted">${esc(m.status.activity)}</small>` : '<span></span>'}${open}</footer>
      </article>`;
    })
    .join('')}</div>`;
}

/**
 * Pure: the Lab's fictional player — the SAME door as a real OBS executor (claim with a lease, then « joué » or
 * « échec »: an échec refunds the original debit once). Shown only when Studio says it is the Lab.
 */
export function playerHtml(
  m: CatalogModule,
  labPlayer: boolean,
  claimed: Activity[] = [],
) {
  if (!m.player || !labPlayer) return '';
  return `<div class="mh-player" data-role="player"><h3>Lecteur fictif <span class="rs-chip">Lab</span></h3>
    <p class="rs-muted">Joue le rôle de l’exécuteur OBS : il prend la prochaine action en attente (30 s pour lui seul), puis dit si elle a été montrée. Aucun OBS réel.</p>
    <button type="button" class="rs-btn sm" data-claim>Prendre la prochaine action</button>
    ${claimed
      .map(
        (a) =>
          `<p class="mh-claimed">${esc(a.viewer?.display_name ?? '—')} · ${esc(a.action)} · ${a.amount ? `${a.amount} Jetons` : 'gratuit'}
          <button type="button" class="rs-btn sm" data-report="${esc(a.activity_id)}" data-status="done">Montrée</button>
          <button type="button" class="rs-btn sm" data-report="${esc(a.activity_id)}" data-status="failed">Échec (rembourse)</button></p>`,
      )
      .join('')}</div>`;
}

function cardHtml(
  m: CatalogModule,
  labPlayer = false,
  claimed: Activity[] = [],
) {
  return `<section class="rs-panel" data-module="${esc(m.id)}"><h2>${esc(m.label)}${m.lab_only ? ' <span class="rs-chip">Lab</span>' : ''}</h2>
    <p class="rs-muted">${esc(m.description)}</p>${statusHtml(m)}
    ${m.viewer.length ? `<p class="rs-muted">Pour les viewers : ${m.viewer.map((v) => `${esc(v.label)} (${v.price ? `${v.price} Jetons` : 'gratuit'}${v.live_only ? ', pendant le live' : ''})`).join(' · ')}.</p>` : ''}
    ${m.moderation ? `<p class="rs-muted">Modération : ${esc(m.moderation.note)}</p>` : ''}
    <div data-role="settings"></div>
    ${playerHtml(m, labPlayer, claimed)}
    ${m.admin.length ? `<div class="rs-buttons">${m.admin.map((a) => `<button type="button" class="rs-btn" data-admin="${esc(a.name)}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    ${m.capabilities.includes('history') ? '<h3>Activité</h3><div data-role="activity"><p class="rs-muted">Lecture…</p></div>' : ''}</section>`;
}

export function mountModuleHost(root: HTMLElement) {
  let focus: string | null = null;
  let visible = false;
  let modules: CatalogModule[] | null = null;
  let message = '';
  let labPlayer = false;
  /** What the fictional player holds (per module), until it reports. */
  const claimed = new Map<string, Activity[]>();
  // Overlapping renders (setVisible then setFocus): only the latest one writes the page.
  let generation = 0;
  const render = async () => {
    if (!visible) return;
    const mine = ++generation;
    const answer = await tryGetJson<{
      modules: CatalogModule[];
      lab_player?: boolean;
    }>('/api/modules');
    if (mine !== generation) return;
    modules = answer?.modules ?? null;
    labPlayer = answer?.lab_player === true;
    const shown = modules?.filter((m) => !focus || m.id === focus) ?? [];
    root.innerHTML = `<div class="rs-page rs-form">
      <header class="rs-page-head"><h1>${focus && shown[0] ? esc(shown[0].label) : 'Modules du socle'}</h1>
      <p>Modules construits sur le socle commun : chacun a son état, ses réglages, ses actions et son activité, sans raccordement propre.</p></header>
      ${message ? `<p class="rs-flash${message.startsWith('Refusé') ? ' is-bad' : ''}" role="status">${esc(message)}</p>` : ''}
      ${modules === null ? '<p class="rs-state is-unknown">Catalogue illisible : le Core de ce profil ne fournit pas les modules du socle.</p>' : !shown.length ? '<p class="rs-muted">Aucun module.</p>' : focus ? shown.map((m) => cardHtml(m, labPlayer, claimed.get(m.id))).join('') : overviewHtml(shown)}
    </div>`;
    // The overview is tiles only: the cards (settings, actions, activity) live on each module's page.
    for (const m of focus ? shown : []) {
      if (mine !== generation) return;
      const card = root.querySelector<HTMLElement>(`[data-module="${m.id}"]`);
      if (!card) continue;
      if (m.settings.length || m.has_switch)
        void mountSettingsPanel(
          card.querySelector<HTMLElement>('[data-role="settings"]')!,
          'Réglages',
          [...(m.has_switch ? [`${m.id}.enabled`] : []), ...m.settings],
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
    const toFocus = t.closest<HTMLElement>('[data-focus]')?.dataset.focus;
    if (toFocus) {
      focus = toFocus;
      void render();
      return;
    }
    const card = t.closest<HTMLElement>('[data-module]');
    const m = modules?.find((x) => x.id === card?.dataset.module);
    if (!m) return;
    if (t.closest('[data-claim]')) {
      const held = claimed.get(m.id) ?? [];
      void postJson<{ items: Activity[] }>(`/api/modules/${m.id}/claim`, {
        limit: held.length + 1,
      }).then(
        (out) => {
          // Its own claims come back first: one entry per action; only a NEW one counts as taken.
          const known = new Set(held.map((a) => a.activity_id));
          const fresh = out.items.filter((a) => !known.has(a.activity_id));
          claimed.set(m.id, [
            ...held.filter((a) =>
              out.items.some((x) => x.activity_id === a.activity_id),
            ),
            ...fresh,
          ]);
          message = fresh.length
            ? 'Action prise par le lecteur fictif.'
            : 'Aucune nouvelle action en attente.';
          void render();
        },
        (err: Error) => ((message = `Refusé : ${err.message}`), void render()),
      );
      return;
    }
    const report = t.closest<HTMLElement>('[data-report]');
    if (report) {
      const id = report.dataset.report!;
      const status = report.dataset.status!;
      void postJson<{ activity?: Activity }>(`/api/modules/${m.id}/report`, {
        activity_id: id,
        status,
      }).then(
        (out) => {
          claimed.set(
            m.id,
            (claimed.get(m.id) ?? []).filter((a) => a.activity_id !== id),
          );
          // The Core's real outcome: an action already decided (expired, refunded) stays as it was.
          const st = out.activity?.status ?? '';
          message =
            st === 'done' && status === 'done'
              ? 'Montrée : action terminée.'
              : st === 'refunded' && status === 'failed'
                ? 'Échec : remboursée une fois (débit d’origine).'
                : `Déjà décidée avant ce compte rendu : ${STATUS_FR[st] ?? st}.`;
          void render();
        },
        (err: Error) => ((message = `Refusé : ${err.message}`), void render()),
      );
      return;
    }
    const admin = t.closest<HTMLElement>('[data-admin]')?.dataset.admin;
    const refund = t.closest<HTMLElement>('[data-refund]')?.dataset.refund;
    if (admin) {
      const a = m.admin.find((x) => x.name === admin)!;
      let input: unknown = null;
      if (a.confirm && !confirm(a.confirm)) return;
      if (a.input) {
        const raw = prompt(
          `${a.input.label} (${a.input.min} à ${a.input.max})`,
          String(a.input.min),
        );
        // « Annuler » (null) or an empty answer sends nothing (Number(null) would be 0).
        if (raw === null || !raw.trim()) return;
        const n = Number(raw);
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
