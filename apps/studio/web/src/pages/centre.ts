import { drawer, esc, ic, page, patch, stateChip } from '../ds/ds.js';
import { readinessHtml, summary, type Check } from '../readiness.js';
import { hrefOf, pageById, type Page } from '../shell/registry.js';
import { renderHistory } from '../supervision-banner.js';
import { icon } from '../shell/icons.js';
import type { HubCtx, HubView, Pulse } from './pulse.js';

// Le Centre de contrôle répond à une seule question : est-ce prêt pour le live, et sinon que faire ? La chaîne montre tout ce qui
// doit tenir, du serveur aux viewers ; les gestes à faire suivent dans l'ordre. Il ne modifie rien : le détail d'un point dit
// pourquoi, ce que voient les viewers et où corriger.

const href = (id: string) => hrefOf(pageById(id) ?? pageById('centre')!);
const LEVEL = {
  error: ['r', 'À corriger'],
  warn: ['w', 'À corriger'],
  unknown: ['w', 'À vérifier'],
  ok: ['', 'Prêt'],
  off: ['off', 'Coupé volontairement'],
} as const;

export function mountCentre(root: HTMLElement, ctx: HubCtx): HubView {
  const p = page(root, { title: 'Centre de contrôle' });
  p.body.innerHTML = `<div class="ce"><div data-z="ready" style="display:contents"></div><aside class="ce-side" data-z="side"></aside></div>`;
  const ready = p.body.querySelector<HTMLElement>('[data-z="ready"]')!;
  const side = p.body.querySelector<HTMLElement>('[data-z="side"]')!;
  let last: Pulse | null = null;

  function openCheck(x: Check) {
    const raw = last?.input?.modules?.find((m) => m.id === x.id) as
      | {
          hint?: string | null;
          facts?: { label: string; value: string }[];
        }
      | undefined;
    const facts = raw?.facts ?? [];
    const d = drawer({
      kicker: `${LEVEL[x.level][1]} · ${x.state}`,
      title: x.label,
      body: `<p>${esc(x.why)}</p>${x.consequence ? `<p class="d-quote"><b>Pour les viewers :</b> ${esc(x.consequence)}</p>` : ''}${raw?.hint ? `<p class="d-note">${esc(raw.hint)}</p>` : ''}${facts.length ? `<dl class="d-kv">${facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>` : ''}`,
      foot: x.fix
        ? `<button type="button" class="d-btn pri" data-fix="${esc(x.fix.page)}">${esc(x.fix.label)}${ic('arrow')}</button>`
        : '',
    });
    d.el.addEventListener('click', (e) => {
      const to = (e.target as HTMLElement).closest<HTMLElement>('[data-fix]');
      if (!to) return;
      d.close();
      ctx.open(to.dataset.fix!);
    });
  }

  function draw(u: Pulse) {
    const active = u.sup?.incidents.filter((i) => !i.endedAt) ?? [];
    if (u.ready) {
      const s = summary(u.ready);
      patch(
        p.state,
        stateChip(
          s.level === 'error' ? 'r' : s.level === 'ok' ? '' : 'w',
          s.level === 'error' || s.level === 'warn'
            ? 'Pas encore prêt'
            : s.level === 'unknown'
              ? 'À vérifier'
              : 'Prêt',
        ),
      );
    }
    patch(ready, readinessHtml(u.ready, href, u.profile === 'lab'));
    const quick = [
      ...u.recent.filter((r) => r !== 'centre'),
      ...u.favs.filter((f) => !u.recent.includes(f)),
    ]
      .map((id) => pageById(id))
      .filter((pg): pg is Page => !!pg)
      .slice(0, 6);
    patch(
      side,
      `<section><h2 class="d-lb">Santé</h2>
        <p class="ce-h" data-tone="${!u.supOk ? 'unknown' : active.length ? 'bad' : 'ok'}"><i></i>${!u.supOk ? 'Supervision indisponible' : active.length ? `${active.length} incident${active.length > 1 ? 's' : ''} en cours` : 'Aucun incident en cours'}</p>
        ${active.map((i) => `<div class="ce-inc"><b>${esc(i.label)}</b><span>${esc(i.value)}</span>${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</div>`).join('')}
        ${u.sup?.history.length ? `<h3 class="d-lb">Dernières coupures</h3>${renderHistory(u.sup.history, 4)}` : ''}
        <p class="d-note"><a href="${href('activite')}" data-page="activite">Activité</a> · <a href="${href('systeme')}" data-page="systeme">Système</a></p></section>
      ${quick.length ? `<section><h2 class="d-lb">Reprendre</h2><div class="ce-quick">${quick.map((pg) => `<a href="${hrefOf(pg)}" data-page="${pg.id}"${pg.tint ? ` style="--tint:var(--${pg.tint})"` : ''}>${icon(pg.icon, '')}${esc(pg.label)}</a>`).join('')}</div></section>` : ''}`,
    );
  }

  p.body.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-check]')
      ?.dataset.check;
    const x = id ? last?.ready?.find((c) => c.id === id) : null;
    if (x) openCheck(x);
  });

  return {
    setVisible() {},
    update(u) {
      last = u;
      draw(u);
    },
  };
}
