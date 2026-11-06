import {
  choiceBox,
  confirmBox,
  esc,
  fld,
  fmt,
  page,
  patch,
  pop,
  run,
  toast,
} from './ds/ds.js';
import { getJson, postJson, tryGetJson } from './http.js';
import { mountSettingsPanel } from './module-settings.js';
import { PAGES } from './shell/registry.js';

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

const STATE_DOT: Record<string, '' | 'w' | 'r'> = {
  ready: '',
  waiting: 'w',
  error: 'r',
  unknown: 'w',
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
  const off = s.intention === 'off';
  const text = off
    ? // Its own switch is a setting here (the host's); a historical one says where its switch is (reasons).
      m.has_switch
      ? 'Coupé (réglage) : invisible pour les viewers.'
      : 'Coupé.'
    : s.summary;
  return `<p class="mh-state"><span class="d-dot ${off ? 'off' : (STATE_DOT[s.observed] ?? 'w')}" style="display:inline-block;margin-right:7px"></span>${esc(text)}</p>${
    // Off too: a historical module says where its own switch is.
    s.reasons.length
      ? `<ul class="mh-reasons">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : ''
  }`;
}

/** The activity journal (pure); the refund button only where the module's policy allows it and the action was paid. */
export function activityHtml(items: Activity[], m: CatalogModule | null) {
  if (!items.length) return '<p class="d-note">Aucune activité.</p>';
  const canRefund = m?.moderation?.refund === 'moderator';
  return `<div class="mh-log">${items
    .map(
      (i) =>
        `<div><time>${esc(new Date(i.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</time><span><b>${esc(i.viewer?.display_name ?? i.ended_by ?? 'Studio')}</b> · ${esc(i.action)}<small>${esc(STATUS_FR[i.status] ?? i.status)}${i.reason ? ` · ${esc(i.reason)}` : ''}</small></span><span class="d-num">${i.amount ? `${fmt(i.amount)} J` : ''}</span><span>${
          canRefund && i.amount > 0 && i.status !== 'refunded'
            ? `<button type="button" class="d-btn sm ghost" data-refund="${esc(i.activity_id)}">Rembourser…</button>`
            : ''
        }</span></div>`,
    )
    .join('')}</div>`;
}

/** The module's own Studio page (its card here, or a historical page with its own screen), or null. */
export function modulePage(id: string) {
  return (
    PAGES.find((p) => p.anchor === id) ??
    PAGES.find((p) => p.id === id.replace(/_/g, '-')) ??
    null
  );
}

/** Pure: the overview — one compact entry per module (its real state, never green on a switch), a link to its page. */
export function overviewHtml(modules: CatalogModule[]) {
  return `<div class="mh-wall">${modules
    .map((m) => {
      const page = modulePage(m.id);
      return `<a class="mh-t" data-tile="${esc(m.id)}" href="${page ? `?p=${esc(page.id)}` : '#'}"${page ? ` data-page="${esc(page.id)}"` : ` data-focus="${esc(m.id)}"`}>
        <b>${esc(m.label)}</b>${m.lab_only ? '<span class="d-tag">Lab</span>' : '<span></span>'}
        ${statusHtml(m).replace('<ul', '<ul hidden')}
        ${m.status.activity ? `<p>${esc(m.status.activity)}</p>` : ''}
      </a>`;
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
  return `<div data-role="player"><h2 class="d-lb">Lecteur fictif</h2>
    <p class="d-note">Joue le rôle de l’exécuteur OBS : il prend la prochaine action en attente (30 s pour lui seul), puis dit si elle a été montrée. Aucun OBS réel.</p>
    <button type="button" class="d-btn sm" data-claim>Prendre la prochaine action</button>
    ${claimed
      .map(
        (a) =>
          `<p class="mh-claimed">${esc(a.viewer?.display_name ?? 'Studio')} · ${esc(a.action)} · ${a.amount ? `${a.amount} Jetons` : 'gratuit'}
          <button type="button" class="d-btn sm" data-report="${esc(a.activity_id)}" data-status="done">Montrée</button>
          <button type="button" class="d-btn sm bad" data-report="${esc(a.activity_id)}" data-status="failed">Échec (rembourse)</button></p>`,
      )
      .join('')}</div>`;
}

function cardHtml(
  m: CatalogModule,
  labPlayer = false,
  claimed: Activity[] = [],
) {
  return `<div class="mh-page" data-module="${esc(m.id)}">
    <div>
      ${statusHtml(m)}
      ${m.description ? `<p class="d-note">${esc(m.description)}</p>` : ''}
      ${m.viewer.length ? `<p class="d-note">Pour les viewers : ${m.viewer.map((v) => `${esc(v.label)} (${v.price ? `${v.price} Jetons` : 'gratuit'})`).join(' · ')}</p>` : ''}
      ${m.moderation ? `<p class="d-note">Modération : ${esc(m.moderation.note)}</p>` : ''}
      ${m.admin.length ? `<div class="mh-acts">${m.admin.map((a) => `<button type="button" class="d-btn sm" data-admin="${esc(a.name)}">${esc(a.label)}${a.confirm ? '…' : ''}</button>`).join('')}</div>` : ''}
      ${m.capabilities.includes('history') ? '<h2 class="d-lb">Activité</h2><div data-role="activity"><p class="d-note">Lecture…</p></div>' : ''}
    </div>
    <div><div data-role="settings"></div>${playerHtml(m, labPlayer, claimed)}</div>
  </div>`;
}

export function mountModuleHost(root: HTMLElement) {
  let focus: string | null = null;
  let visible = false;
  let modules: CatalogModule[] | null = null;
  let labPlayer = false;
  const p = page(root, { title: 'Modules du socle' });
  p.body.innerHTML = '<div class="mh" data-z="body"></div>';
  const body = p.body.querySelector<HTMLElement>('[data-z="body"]')!;
  const title = root.querySelector<HTMLElement>('h1')!;
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
    const one = focus ? shown[0] : undefined;
    title.textContent = one?.label ?? 'Modules du socle';
    patch(p.state, one?.lab_only ? '<span class="d-tag">Lab</span>' : '');
    body.innerHTML =
      modules === null
        ? '<p class="d-note bad">Catalogue illisible sur ce profil.</p>'
        : !shown.length
          ? '<p class="d-empty">Aucun module.</p>'
          : focus
            ? shown
                .map((m) => cardHtml(m, labPlayer, claimed.get(m.id)))
                .join('')
            : `<p class="d-note">L’état, les réglages et l’activité des modules construits sur le socle commun.</p>${overviewHtml(shown)}`;
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
      if (mine !== generation) return;
      card.querySelector<HTMLElement>('[data-role="activity"]')!.innerHTML = act
        ? activityHtml(act.items, m)
        : '<p class="d-note bad">Activité illisible.</p>';
    }
  };
  /** Le refus du Core, ou ce qui a été fait ; puis on relit. */
  const send = (
    b: HTMLElement | null,
    fn: () => Promise<unknown>,
    done: string,
  ) => run(b, fn, done).then(render);

  /** Une action admin qui demande une valeur : le champ apparaît sur le bouton, jamais une invite du navigateur. */
  function askNumber(
    btn: HTMLElement,
    a: CatalogModule['admin'][number],
    then: (n: number) => void,
  ) {
    const i = a.input!;
    const el = pop(
      btn,
      `<form class="d-form"><h3>${esc(i.label)}</h3><div class="d-row"><span>De ${fmt(i.min)} à ${fmt(i.max)}</span>${fld(`data-v min="${i.min}" max="${i.max}"`, i.min)}</div><button class="d-btn pri sm">${esc(a.label)}</button></form>`,
    );
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Number(el.querySelector<HTMLInputElement>('[data-v]')?.value);
      if (!Number.isInteger(n) || n < i.min || n > i.max) return;
      el.hidePopover();
      then(n);
    });
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const toFocus = t.closest<HTMLElement>('[data-focus]')?.dataset.focus;
    if (toFocus) {
      e.preventDefault();
      focus = toFocus;
      void render();
      return;
    }
    const card = t.closest<HTMLElement>('[data-module]');
    const m = modules?.find((x) => x.id === card?.dataset.module);
    if (!m) return;
    if (t.closest('[data-claim]')) {
      const held = claimed.get(m.id) ?? [];
      void run(t.closest<HTMLElement>('[data-claim]'), async () => {
        const out = await postJson<{ items: Activity[] }>(
          `/api/modules/${m.id}/claim`,
          { limit: held.length + 1 },
        );
        // Its own claims come back first: one entry per action; only a NEW one counts as taken.
        const known = new Set(held.map((a) => a.activity_id));
        const fresh = out.items.filter((a) => !known.has(a.activity_id));
        claimed.set(m.id, [
          ...held.filter((a) =>
            out.items.some((x) => x.activity_id === a.activity_id),
          ),
          ...fresh,
        ]);
        toast(
          fresh.length
            ? 'Action prise par le lecteur fictif'
            : 'Aucune nouvelle action en attente',
        );
      }).then(render);
      return;
    }
    const report = t.closest<HTMLElement>('[data-report]');
    if (report) {
      const id = report.dataset.report!;
      const status = report.dataset.status!;
      void run(report, async () => {
        const out = await postJson<{ activity?: Activity }>(
          `/api/modules/${m.id}/report`,
          { activity_id: id, status },
        );
        claimed.set(
          m.id,
          (claimed.get(m.id) ?? []).filter((a) => a.activity_id !== id),
        );
        // The Core's real outcome: an action already decided (expired, refunded) stays as it was.
        const st = out.activity?.status ?? '';
        toast(
          st === 'done' && status === 'done'
            ? 'Montrée : action terminée'
            : st === 'refunded' && status === 'failed'
              ? 'Échec : remboursée une fois (débit d’origine)'
              : `Déjà décidée avant ce compte rendu : ${STATUS_FR[st] ?? st}`,
        );
      }).then(render);
      return;
    }
    const adminBtn = t.closest<HTMLElement>('[data-admin]');
    if (adminBtn) {
      const a = m.admin.find((x) => x.name === adminBtn.dataset.admin)!;
      const go = (input: unknown) =>
        void send(
          adminBtn,
          () => postJson(`/api/modules/${m.id}/admin/${a.name}`, { input }),
          `${a.label} : fait`,
        );
      void (async () => {
        if (
          a.confirm &&
          !(await confirmBox({ title: a.label, body: a.confirm, yes: a.label }))
        )
          return;
        if (a.input) askNumber(adminBtn, a, (n) => go({ [a.input!.key]: n }));
        else go(null);
      })();
      return;
    }
    const refundBtn = t.closest<HTMLElement>('[data-refund]');
    if (refundBtn)
      void choiceBox({
        title: 'Rembourser cette action ?',
        body: 'Le débit d’origine est rendu une seule fois.',
        choices: [],
        yes: 'Rembourser',
        field: { label: 'Motif', required: true },
      }).then((r) => {
        if (r)
          void send(
            refundBtn,
            () =>
              postJson('/api/modules/refund', {
                activity_id: refundBtn.dataset.refund,
                reason: r.text,
              }),
            'Remboursé',
          );
      });
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
