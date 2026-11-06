import { dur, esc, ic, keyed, patch, pp, seg } from '../ds/ds.js';
import {
  actionLabel,
  actorName,
  blockForm,
  cooldownForm,
  learn,
  learnMissing,
  lift,
  modGet,
  nameOf,
  openAudit,
  openViewer,
  SCOPE,
  when,
  type AuditEntry,
  type ModJump,
} from '../mod/mod.js';
import { mmss, moduleSeg, viewerField, type View } from './moderation-ui.js';

// Les restrictions de Raptoru : en cours et passées, pour toute la chaîne. Le Core est la vérité : les actives sont sa lecture,
// l'historique est son audit, limité aux actions de restriction. Aucune sanction Twitch ici.

interface Restriction {
  kind: 'block' | 'cooldown';
  viewer_id: string;
  display_name: string;
  module: string;
  until: string | null;
  reason?: string | null;
  actor: string;
  delay_s?: number;
}
export const RESTRICTION_ACTIONS = [
  'block_viewer',
  'unblock_viewer',
  'cooldown_set',
  'cooldown_clear',
  'cooldown_running_clear',
];
/** Un module montre aussi les blocages « Tout Raptoru » : ils l'arrêtent aussi. */
export const moduleMatch = (filter: string, module: string | null) =>
  filter === 'any' ||
  module === filter ||
  (filter !== 'all' && module === 'all');

export function mountRestrictions(onCount: (n: number) => void): View {
  const el = document.createElement('div');
  el.className = 'mv-restr';
  el.innerHTML = `<div class="mv-bar" data-bar></div><div class="mr-rows" data-rows></div><p class="d-note">Restrictions Raptoru uniquement : aucune sanction Twitch.</p>`;
  const bar = el.querySelector<HTMLElement>('[data-bar]')!;
  const list = el.querySelector<HTMLElement>('[data-rows]')!;

  const fresh = () => ({
    state: 'active',
    module: 'any',
    viewer: null as string | null,
    q: '',
  });
  let f = fresh();
  let active: Restriction[] | null = null;
  let history: AuditEntry[] | null = null;
  let failed = false;

  const field = viewerField(bar, {
    id: 'mr-viewers',
    picked: () => f.viewer,
    typed: () => f.q,
    onType: (t) => {
      f.q = t;
      paintRows();
    },
    onPick: (id) => {
      f.viewer = id;
      f.q = '';
      void paint();
      void read();
    },
  });
  const named = (id: string | null, name: string) =>
    (!f.viewer || id === f.viewer) &&
    (!f.q.trim() || name.toLowerCase().includes(f.q.trim().toLowerCase()));

  async function read() {
    try {
      const a = await modGet<{ restrictions: Restriction[] }>('restrictions');
      active = a.restrictions;
      for (const r of active) learn(r.viewer_id, r.display_name);
      onCount(active.length);
      if (f.state === 'history') {
        // L'historique d'un module montre aussi les blocages globaux : lu sans filtre, trié ici.
        const qs = new URLSearchParams({ limit: '200' });
        if (f.viewer) qs.set('viewer', f.viewer);
        if (f.module === 'all') qs.set('module', 'all');
        history = (await modGet<{ audit: AuditEntry[] }>(`audit?${qs}`)).audit;
        learnMissing(
          history.map((a) => a.viewer_id),
          paintRows,
        );
      }
      failed = false;
    } catch {
      failed = true;
    }
    paintRows();
  }

  const chip = (r: Restriction) => {
    const cd = r.kind === 'cooldown';
    const scope = r.module === 'all' ? 'Global' : (SCOPE[r.module] ?? r.module);
    const tip = [`Par ${actorName(r.actor)}`, r.reason]
      .filter(Boolean)
      .join(' · ');
    return `<span class="mr-chip ${cd ? 'cd' : ''}" title="${esc(tip)}"><button type="button" data-edit="${r.kind}" data-v="${esc(r.viewer_id)}" data-m="${esc(r.module)}" data-name="${esc(r.display_name)}" aria-label="Modifier ${esc(scope)}">${ic(cd ? 'clock' : 'ban')}<b>${esc(scope)}</b>${cd ? `Cooldown ${dur(r.delay_s ?? 0)}` : 'Bloqué'}<time class="d-num" ${r.until ? `data-until="${Date.parse(r.until)}"` : ''}>${r.until ? mmss(Date.parse(r.until) - Date.now()) : 'sans fin'}</time></button><button type="button" class="mr-x" data-lift="${r.kind}" data-v="${esc(r.viewer_id)}" data-m="${esc(r.module)}" data-name="${esc(r.display_name)}" aria-label="Lever ${esc(scope)}">${ic('x')}</button></span>`;
  };
  function paintActive() {
    if (!active)
      return patch(
        list,
        `<div class="d-empty">${failed ? 'Restrictions illisibles pour le moment.' : 'Lecture…'}</div>`,
      );
    const rows = active.filter(
      (r) =>
        moduleMatch(f.module, r.module) && named(r.viewer_id, r.display_name),
    );
    const groups = new Map<string, Restriction[]>();
    for (const r of rows)
      groups.set(r.viewer_id, [...(groups.get(r.viewer_id) ?? []), r]);
    keyed(
      list,
      [...groups.entries()].map(([id, l]) => ({
        key: `v${id}`,
        html: `<div class="mr-v"><button type="button" class="mr-who" data-viewer="${esc(id)}">${pp(l[0]!.display_name, 26)}<b>${esc(l[0]!.display_name)}</b></button><span class="mr-chips">${l.map(chip).join('')}</span></div>`,
      })),
      '<div class="d-empty">Aucune restriction active.</div>',
    );
  }
  function paintHistory() {
    if (!history)
      return patch(
        list,
        `<div class="d-empty">${failed ? 'Restrictions illisibles pour le moment.' : 'Lecture…'}</div>`,
      );
    const rows = history.filter(
      (a) =>
        RESTRICTION_ACTIONS.includes(a.action) &&
        moduleMatch(f.module, a.module_id) &&
        named(a.viewer_id, nameOf(a.viewer_id ?? '')),
    );
    keyed(
      list,
      rows.map((a) => {
        const up = /^(unblock|cooldown_clear|cooldown_running)/.test(a.action);
        const until = (a.after as { until?: string } | null)?.until;
        const span =
          a.action === 'block_viewer'
            ? ` · ${until ? dur(Math.max(1, Math.round((Date.parse(until) - Date.parse(a.created_at)) / 1000))) : 'jusqu’au déblocage'}`
            : '';
        return {
          key: `a${a.id}`,
          html: `<button type="button" class="mj-r" data-a="${esc(a.id)}"><time class="d-num">${when(a.created_at)}</time><b>${esc(nameOf(a.viewer_id ?? ''))}</b><span class="d-tag off">${esc(a.module_id === 'all' ? 'Global' : (SCOPE[a.module_id ?? ''] ?? a.module_id))}</span><span class="d-tag ${up ? 'ok' : a.action.startsWith('cooldown') ? 'warn' : 'bad'}">${esc(actionLabel(a.action))}</span><span class="mj-what">${esc(actorName(a.actor))}${span}${a.reason ? ` · ${esc(a.reason)}` : ''}</span></button>`,
        };
      }),
      '<div class="d-empty">Aucune restriction pour ces filtres.</div>',
    );
  }
  function paintRows() {
    list.dataset.state = f.state;
    if (f.state === 'history') paintHistory();
    else paintActive();
    tick();
  }
  function tick() {
    for (const t of list.querySelectorAll<HTMLElement>('[data-until]'))
      t.textContent = mmss(Number(t.dataset.until) - Date.now());
  }
  function paint() {
    patch(
      bar,
      `${seg(
        'data-state',
        [
          ['active', 'Actives'],
          ['history', 'Historique'],
        ],
        f.state,
      )}${moduleSeg(
        'data-mf',
        [
          ['any', 'Toutes'],
          ['all', 'Global'],
        ],
        f.module,
      )}<span class="d-sp"></span>${field.html()}`,
    );
    field.restore();
    paintRows();
  }
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    const d = b?.dataset;
    if (!d) return;
    if (d.state) {
      f.state = d.state;
      history = null;
      paint();
      return void read();
    }
    if (d.mf) {
      f.module = d.mf;
      if (f.state === 'history') history = null;
      paint();
      return void read();
    }
    if (d.viewer) return openViewer(d.viewer);
    if (d.edit === 'block') blockForm(b!, d.v!, d.name!, d.m!);
    if (d.edit === 'cooldown') cooldownForm(b!, d.v!, d.name!, d.m!);
    if (d.lift) void lift(b!, d.v!, d.lift, d.m!, d.name!);
    if (d.a) {
      const a = history?.find((x) => String(x.id) === d.a);
      if (a) openAudit(a);
    }
  });
  return {
    el,
    paint,
    read,
    tick,
    enter(j?: ModJump) {
      if (!j?.viewer && !j?.module) return;
      f = { ...fresh(), module: j.module ?? 'any', viewer: j.viewer ?? null };
      history = null;
    },
  };
}
