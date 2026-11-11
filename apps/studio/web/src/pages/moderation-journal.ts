import { esc, fmt, keyed, patch, pp, seg, sw } from '../ds/ds.js';
import {
  actionLabel,
  actorName,
  learnMissing,
  MODS,
  money,
  nameOf,
  openAudit,
  openItem,
  openLedger,
  rememberLedger,
  ROLE,
  SCOPE,
  signed,
  statusText,
  when,
  modGet,
  type AuditEntry,
  type LedgerEntry,
  type ModItem,
  type ModJump,
  type ModModule,
} from '../mod/mod.js';
import { moduleSeg, viewerField, type View } from './moderation-ui.js';

// L'historique : les interactions de tous les modules, l'activité Jetons, l'audit. Les filtres sont appliqués par le Core.

type Sub = 'ix' | 'j' | 'audit';
const STATUS = [
  ['all', 'Tous statuts'],
  ['done', 'Terminé'],
  ['queued', 'En attente'],
  ['refunded', 'Remboursé'],
  ['cancelled', 'Retiré'],
  ['failed', 'Échec'],
] as const;
const PERIOD = [
  ['15', '15 dernières min'],
  ['60', 'Dernière heure'],
  ['stream', 'Ce stream'],
  ['1440', '24 heures'],
  ['10080', '7 jours'],
  ['', 'Tout'],
] as const;
const select = (
  attr: string,
  label: string,
  opts: readonly (readonly [string, string])[],
  cur: string,
) =>
  `<label class="d-fld"><select ${attr} aria-label="${label}">${opts.map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
const q = (o: Record<string, string | number | null | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export function mountJournal(): View {
  const el = document.createElement('div');
  el.className = 'mv-journal';
  el.innerHTML = `<div class="mv-bar" data-bar></div><div class="mj-rows" data-rows role="list"></div><div class="mv-foot" data-foot></div>`;
  const bar = el.querySelector<HTMLElement>('[data-bar]')!;
  const list = el.querySelector<HTMLElement>('[data-rows]')!;
  const foot = el.querySelector<HTMLElement>('[data-foot]')!;

  let sub: Sub = 'ix';
  const fresh = () => ({
    module: 'all',
    status: 'all',
    period: 'stream',
    q: '',
    viewer: null as string | null,
  });
  let f = fresh();
  let auto = false;
  let ix: ModItem[] = [];
  let led: LedgerEntry[] = [];
  let aud: AuditEntry[] = [];
  let more = false;
  let hidden = 0;
  let extended = false;
  let loaded = false;
  let failed = '';
  let seq = 0;

  const field = viewerField(bar, {
    id: 'mj-viewers',
    picked: () => f.viewer,
    typed: () => f.q,
    onType: (t) => {
      f.q = t;
      if (sub === 'ix') void load();
    },
    onPick: (id) => {
      f.viewer = id;
      f.q = '';
      void load();
    },
  });

  async function load(next = false) {
    const mine = ++seq;
    const module = f.module === 'all' ? null : f.module;
    try {
      if (sub === 'ix') {
        const r = await modGet<{ items: ModItem[]; more: boolean }>(
          `interactions?${q({
            module,
            status: f.status === 'all' ? null : f.status,
            period: f.period,
            viewer: f.viewer,
            q: f.viewer ? null : f.q.trim(),
            before: next ? ix.at(-1)?.created_at : null,
            limit: 60,
            // This Studio knows the Music Hub purchases (post-live 11/11).
            music: 1,
          })}`,
        );
        if (mine !== seq) return;
        ix = next ? [...ix, ...r.items] : r.items;
        more = r.more;
      } else if (sub === 'j') {
        const r = await modGet<{
          items: LedgerEntry[];
          more: boolean;
          hidden?: number;
        }>(
          `ledger?${q({
            viewer: f.viewer,
            limit: 60,
            before: next ? led.at(-1)?.id : null,
            auto: auto ? 1 : null,
          })}`,
        );
        if (mine !== seq) return;
        rememberLedger(r.items);
        led = next ? [...led, ...r.items] : r.items;
        more = r.more;
        hidden = Number(r.hidden ?? 0);
      } else {
        const r = await modGet<{ audit: AuditEntry[] }>(
          `audit?${q({ limit: 120, viewer: f.viewer, module })}`,
        );
        if (mine !== seq) return;
        aud = r.audit;
        more = false;
        learnMissing(
          aud.map((a) => a.viewer_id),
          paintRows,
        );
      }
      extended = next || extended;
      loaded = true;
      failed = '';
    } catch (e) {
      if (mine !== seq) return;
      failed = (e as Error).message;
    }
    paintRows();
  }
  function paintBar() {
    const tags = [['all', 'Tout']] as const;
    patch(
      bar,
      `${seg(
        'data-sub',
        [
          ['ix', 'Interactions'],
          ['j', 'Jetons'],
          ['audit', 'Audit'],
        ],
        sub,
      )}
      ${sub !== 'j' ? moduleSeg('data-mf', tags, f.module) : ''}
      ${sub === 'ix' ? select('data-sf', 'Statut', STATUS, f.status) + select('data-pf', 'Période', PERIOD, f.period) : ''}
      ${sub === 'j' ? `<label class="mv-sw">${sw(auto, 'data-auto', 'Mouvements automatiques')}<span>Automatiques${hidden ? ` (${hidden})` : ''}</span></label>` : ''}
      <span class="d-sp"></span>${field.html()}`,
    );
    field.restore();
  }
  function paintRows() {
    const empty = `<div class="d-empty">${failed ? 'Historique illisible pour le moment.' : loaded ? 'Rien pour ces filtres.' : 'Lecture…'}</div>`;
    if (sub === 'ix')
      keyed(
        list,
        ix.map((i) => ({
          key: i.interaction_id,
          html: `<button type="button" class="mj-r" data-ix="${esc(i.interaction_id)}"><time class="d-num">${when(i.created_at)}</time><span class="d-tag off">${esc(i.module === 'soundboard' ? 'Sons' : MODS[i.module!]?.label)}</span>${pp(i.viewer_display_name, 20)}<b>${esc(i.viewer_display_name)}</b><span class="mj-what">${esc(i.detail ?? '')}</span><span class="mj-st is-${esc(i.status_key ?? '')}">${esc(statusText(i))}</span><span class="d-num mj-amt">${esc(money(i))}</span></button>`,
        })),
        empty,
      );
    if (sub === 'j')
      keyed(
        list,
        led.map((e) => ({
          key: String(e.id),
          html: `<button type="button" class="mj-r" data-e="${esc(e.id)}"><time class="d-num">${when(e.created_at)}</time>${pp(e.viewer_display_name ?? e.viewer_id, 20)}<b>${esc(e.viewer_display_name ?? e.viewer_id)}</b><span class="mj-what">${esc(e.label)}</span><span class="mj-st">${e.refunded_by ? 'Remboursé' : e.visible_in_moderation_activity === false ? 'Automatique' : ''}</span><span class="d-num mj-amt ${e.amount > 0 ? 'm-plus' : ''}">${esc(signed(e))}</span></button>`,
        })),
        empty,
      );
    if (sub === 'audit')
      keyed(
        list,
        aud.map((a) => ({
          key: String(a.id),
          html: `<button type="button" class="mj-r" data-a="${esc(a.id)}"><time class="d-num">${when(a.created_at)}</time><span class="d-tag off">${esc(SCOPE[a.module_id ?? ''] ?? '—')}</span><b>${esc(actionLabel(a.action))}</b><span class="mj-what">${esc(actorName(a.actor))}${a.viewer_id ? ` → ${esc(nameOf(a.viewer_id))}` : ''}${a.reason ? ` · ${esc(a.reason)}` : ''}</span><span class="mj-st">${esc(ROLE[a.role] ?? a.role)}</span></button>`,
        })),
        empty,
      );
    list.dataset.sub = sub;
    patch(
      foot,
      `${more ? '<button type="button" class="d-btn ghost sm" data-more>Plus ancien</button>' : ''}${sub === 'j' ? '<span class="d-faint">Présence, watchtime, récompenses sub, follow et Bits sont masqués par défaut.</span>' : ''}${sub === 'audit' ? `<span class="d-faint">Les ${fmt(120)} dernières actions.</span>` : ''}`,
    );
  }
  function reload() {
    extended = false;
    loaded = false;
    ix = [];
    led = [];
    aud = [];
    paintBar();
    paintRows();
    void load();
  }
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    const d = b?.dataset;
    if (!d) return;
    if (d.sub) {
      sub = d.sub as Sub;
      return reload();
    }
    if (d.mf) {
      f.module = d.mf;
      return reload();
    }
    if (b!.matches('[data-more]')) return void load(true);
    if (d.ix) {
      const i = ix.find((x) => x.interaction_id === d.ix);
      if (i)
        openItem(
          { ...i, message: i.module === 'tts' ? i.detail : undefined },
          i.module as ModModule,
        );
    }
    if (d.e) {
      const x = led.find((v) => String(v.id) === d.e);
      if (x) openLedger(x);
    }
    if (d.a) {
      const a = aud.find((v) => String(v.id) === d.a);
      if (a) openAudit(a);
    }
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.matches('[data-sf]')) f.status = t.value;
    else if (t.matches('[data-pf]')) f.period = t.value;
    else if (t.matches('[data-auto]'))
      auto = (t as unknown as HTMLInputElement).checked;
    else return;
    reload();
  });

  return {
    el,
    paint: () => {
      paintBar();
      paintRows();
    },
    // La première page suit le Core ; une liste dépliée reste telle quelle pour qu'on la lise.
    read: () => (extended ? undefined : load()),
    enter(j?: ModJump) {
      if (!j?.sub && !j?.viewer && !j?.module) return;
      sub = j.sub ?? 'ix';
      f = { ...fresh(), module: j.module ?? 'all', viewer: j.viewer ?? null };
      if (j.viewer) f.period = '';
      reload();
    },
  };
}
