// Raptoru Studio · design system « Coulisses ». Une page importe d'ici ses contrôles, ses surcouches et son cadre : un module
// nouveau obtient ainsi d'office l'apparence, la navigation, les états, les notifications et les confirmations. Aucune règle
// métier ici : le Core décide, ces fonctions montrent et transmettent. Docs : docs/studio-refonte/DESIGN_SYSTEM.md.
import { ApiError, esc } from '../http.js';
import { ic, type IcName } from './icons.js';

export { esc, ic };
export type { IcName };

export const fmt = (n: unknown) =>
  Number(n ?? 0)
    .toLocaleString('fr-FR')
    .replace(/\s/g, ' ');
export const clock = (s: number) => {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};
export const hhmm = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
export const ago = (iso: string) => {
  const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return d < 60
    ? `il y a ${d} s`
    : d < 3600
      ? `il y a ${Math.floor(d / 60)} min`
      : `il y a ${Math.floor(d / 3600)} h`;
};
/** Une durée en toutes lettres : 45 s, 5 min, 1 h 30. */
export const dur = (s: number) => {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};
export const motionOk = () =>
  !matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Petits contrôles (HTML) -----------------------------------------------------------------------------------------

export const sw = (
  on: boolean,
  attr: string,
  label: string,
  o: { gold?: boolean; disabled?: boolean } = {},
) =>
  `<span class="d-sw${o.gold ? ' gold' : ''}"><input type="checkbox" role="switch" ${attr} ${on ? 'checked' : ''} ${o.disabled ? 'disabled' : ''} aria-label="${esc(label)}"><i></i></span>`;

export const seg = (
  attr: string,
  opts: readonly (readonly [string, string])[],
  cur: string,
  cls = '',
) => {
  const i = Math.max(
    0,
    opts.findIndex(([k]) => k === cur),
  );
  return `<span class="d-seg ${cls}" style="--n:${opts.length};--i:${i}" role="group">${opts
    .map(
      ([k, l]) =>
        `<button type="button" ${attr}="${esc(k)}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${l}</button>`,
    )
    .join('')}</span>`;
};

export const fld = (
  attr: string,
  v: unknown,
  unit = '',
  extra = '',
  type = 'number',
) =>
  `<label class="d-fld"><input type="${type}" ${attr} value="${esc(v ?? '')}" ${extra}>${unit ? `<span>${esc(unit)}</span>` : ''}</label>`;

const k = (label: string, keys: string) =>
  esc(`${label} ${keys}`.toLowerCase());
/** Une ligne de réglage ; `keys` : les autres mots qui doivent la retrouver dans la recherche du panneau. */
export const row = (label: string, ctl: string, keys = '') =>
  `<div class="d-row" data-k="${k(label, keys)}"><span>${esc(label)}</span>${ctl}</div>`;
/** Même ligne, valeur numérique qu'on tire à la souris depuis son libellé (`scrub`). */
export const numrow = (label: string, ctl: string, keys = '') =>
  `<div class="d-row" data-scrubbable data-k="${k(label, keys)}"><span data-scrub>${esc(label)}</span>${ctl}</div>`;
export const grp = (title: string, icon: IcName | '', body: string, g = '') =>
  `<section class="d-grp" data-g="${esc(`${title} ${g}`.toLowerCase())}"><h3>${icon ? ic(icon) : ''}${esc(title)}</h3>${body}</section>`;

const hash = (s: string) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const PAL = [
  ['#2fd8c4', '#0d3a3e'],
  ['#f47e98', '#43162a'],
  ['#e9c46a', '#3d2e12'],
  ['#86b4ff', '#142b52'],
  ['#b9a0ff', '#2c2058'],
  ['#ff9f6b', '#452210'],
  ['#9be8a0', '#163c26'],
] as const;
/**
 * Le visage d'un viewer : sa vraie photo quand le Core la connaît, sinon un petit visage dérivé du pseudo, le même partout.
 */
export const pp = (name: string, size = 32, url?: string | null) => {
  if (url)
    return `<img class="d-pp" src="${esc(url)}" width="${size}" height="${size}" alt="" loading="lazy">`;
  const h = hash(name);
  const [fg, bg] = PAL[h % PAL.length]!;
  const eye = (2 + ((h >>> 4) % 3)) / 1.6;
  const tilt = -14 + ((h >>> 7) % 28);
  const dx = -3 + ((h >>> 3) % 7);
  const mouth = [
    'M14 23q4 3 8 0',
    'M15 23q3 2 6 0',
    'M14 22.5q4 4.5 8 0z',
    'M15.5 23h5',
  ][(h >>> 11) % 4];
  return `<svg class="d-pp" width="${size}" height="${size}" viewBox="0 0 36 36" aria-hidden="true"><clipPath id="pp${h}"><circle cx="18" cy="18" r="18"/></clipPath><g clip-path="url(#pp${h})"><rect width="36" height="36" fill="${bg}"/><g transform="rotate(${tilt} 18 18) translate(${dx} 3)"><rect x="5" y="5" width="26" height="38" rx="13" fill="${fg}"/><circle cx="13.5" cy="16" r="${eye}" fill="${bg}"/><circle cx="22.5" cy="16" r="${eye}" fill="${bg}"/><path d="${mouth}" fill="none" stroke="${bg}" stroke-width="1.6" stroke-linecap="round"/></g></g></svg>`;
};

/** L'anneau de temps des overlays : `p` de 0 à 1. */
export const ring = (p: number, r: number, w: number, size: number) => {
  const c = 2 * Math.PI * r;
  const m = size / 2;
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="d-ring-bg" cx="${m}" cy="${m}" r="${r}" stroke-width="${w}"/><circle class="d-ring-fg" data-ring cx="${m}" cy="${m}" r="${r}" stroke-width="${w}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"/></svg>`;
};

// --- Rendu sobre : on ne réécrit que ce qui a changé -------------------------------------------------------------------

/** Remplace le contenu seulement s'il a changé : focus, survol et défilement restent en place entre deux relevés. */
export function patch(el: HTMLElement | null, html: string) {
  if (el && el.dataset.sig !== html) {
    el.dataset.sig = html;
    el.innerHTML = html;
  }
}

/**
 * Une liste vivante : les lignes gardent leur élément d'un relevé à l'autre (clé), seules les nouvelles apparaissent.
 * Pur DOM, pour une file qui bouge pendant qu'on la lit.
 */
export function keyed(
  el: HTMLElement,
  items: readonly { key: string; html: string }[],
  empty = '',
) {
  if (!items.length) {
    patch(el, empty);
    return;
  }
  if (el.dataset.sig !== undefined) {
    delete el.dataset.sig;
    el.innerHTML = '';
  }
  const have = new Map<string, HTMLElement>();
  for (const c of [...el.children] as HTMLElement[])
    have.set(c.dataset.key ?? '', c);
  let prev: Element | null = null;
  for (const it of items) {
    let node = have.get(it.key);
    if (node) {
      have.delete(it.key);
      if (node.dataset.rowsig !== it.html) {
        const t = document.createElement('template');
        t.innerHTML = it.html.trim();
        const fresh = t.content.firstElementChild as HTMLElement;
        fresh.dataset.key = it.key;
        fresh.dataset.rowsig = it.html;
        fresh.classList.remove('d-in');
        node.replaceWith(fresh);
        node = fresh;
      }
    } else {
      const t = document.createElement('template');
      t.innerHTML = it.html.trim();
      node = t.content.firstElementChild as HTMLElement;
      node.dataset.key = it.key;
      node.dataset.rowsig = it.html;
    }
    const want: ChildNode | null = prev ? prev.nextSibling : el.firstChild;
    if (want !== node) el.insertBefore(node, want);
    prev = node;
  }
  for (const gone of have.values()) gone.remove();
}

/** Un relevé régulier qui n'existe que lorsque la page est visible. Deux relevés ne se chevauchent jamais. */
export function poller(fn: () => unknown | Promise<unknown>, ms: number) {
  let on = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gen = 0;
  const loop = async (g: number) => {
    try {
      await fn();
    } catch {
      /* le relevé suivant réessaie ; la page dit elle-même ce qu'elle ne sait plus */
    }
    if (on && g === gen) timer = setTimeout(() => void loop(g), ms);
  };
  return {
    start() {
      if (on) return;
      on = true;
      void loop(++gen);
    },
    stop() {
      on = false;
      gen += 1;
      clearTimeout(timer);
    },
    /** Relève tout de suite, sans attendre l'échéance. */
    now() {
      if (!on) return;
      clearTimeout(timer);
      void loop(++gen);
    },
  };
}

// --- Surcouches --------------------------------------------------------------------------------------------------------

function place(el: HTMLElement, anchor: Element) {
  const a = anchor.getBoundingClientRect();
  const p = el.getBoundingClientRect();
  const gap = 8;
  let top = a.bottom + gap;
  if (top + p.height > innerHeight - 12) top = a.top - p.height - gap;
  if (top < 12) top = 12;
  let left = a.left;
  if (left + p.width > innerWidth - 12) left = a.right - p.width;
  if (left < 12) left = 12;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/** Popover natif lié à `anchor` : Échap et clic extérieur sont natifs. Le focus revient à l'ancre à la fermeture. */
export function pop(
  anchor: HTMLElement,
  html: string,
  fill?: (el: HTMLElement) => void,
  opt: { cls?: string; onClose?: () => void } = {},
) {
  const el = document.createElement('div');
  el.className = `d-pop ${opt.cls ?? ''}`;
  el.popover = 'auto';
  el.innerHTML = html;
  // Dans un tiroir ou un dialogue modal, le popover doit rester sous cet élément pour recevoir les clics.
  (anchor.closest('dialog') ?? document.body).append(el);
  fill?.(el);
  el.showPopover();
  place(el, anchor);
  el.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState === 'closed') {
      opt.onClose?.();
      anchor.focus?.();
      setTimeout(() => el.remove(), 200);
    }
  });
  el.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
  return el;
}

export type MenuItem =
  | '-'
  | null
  | false
  | undefined
  | {
      label: string;
      icon?: IcName;
      hint?: string;
      kind?: 'bad' | 'ok';
      disabled?: boolean;
      run: () => void;
    };

/** Le menu d'une ligne : des verbes clairs, jamais une croix ambiguë. */
export function menu(anchor: HTMLElement, title: string, items: MenuItem[]) {
  const list = items.filter(Boolean) as Exclude<
    MenuItem,
    null | false | undefined
  >[];
  const html = `${title ? `<h3>${title}</h3>` : ''}${list
    .map((it, i) =>
      it === '-'
        ? '<hr>'
        : `<button type="button" data-i="${i}" class="${it.kind ?? ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`,
    )
    .join('')}`;
  const el = pop(anchor, html, undefined, { cls: 'd-menu' });
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!b) return;
    const it = list[Number(b.dataset.i)];
    el.hidePopover();
    if (it && it !== '-') it.run();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...el.querySelectorAll<HTMLButtonElement>('button:enabled')];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[
      (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
    ]?.focus();
  });
  return el;
}

function toastHost() {
  const host = document.querySelector(
    'dialog[open].d-drawer, dialog[open].d-dlg',
  );
  const box =
    document.querySelector<HTMLElement>('.d-toasts') ??
    Object.assign(document.createElement('div'), {
      className: 'd-toasts',
      role: 'status',
    });
  box.popover = 'manual';
  document.body.append(box);
  // Au-dessus d'un tiroir ouvert : la notification reste lisible sans le fermer.
  if (box.matches(':popover-open')) box.hidePopover();
  box.showPopover();
  return { box, host };
}
/** Notification discrète ; `undo` ajoute « Annuler » et laisse le temps de s'en servir. */
export function toast(
  text: string,
  opt: { undo?: () => void; bad?: boolean } = {},
) {
  const { box } = toastHost();
  const t = document.createElement('div');
  t.className = `d-toast${opt.bad ? ' bad' : ''}`;
  t.innerHTML = `<span>${esc(text)}</span>${opt.undo ? '<button type="button">Annuler</button>' : ''}`;
  box.append(t);
  const end = () => {
    t.remove();
    if (!box.children.length) box.hidePopover();
  };
  const id = setTimeout(end, opt.undo ? 6000 : opt.bad ? 5000 : 2800);
  t.querySelector('button')?.addEventListener('click', () => {
    clearTimeout(id);
    end();
    opt.undo?.();
  });
}

/** Les refus du Core dits dans les mots du streamer ; un code inconnu reste lisible tel quel. */
const REFUS: Record<string, string> = {
  forbidden: 'Action non autorisée.',
  core_unavailable: 'Core injoignable. Réessaie dans un instant.',
  lab_core_unavailable: 'Core injoignable. Réessaie dans un instant.',
  invalid_rules: 'Configuration refusée par le Core.',
  network_error: 'Connexion perdue : réessaie.',
};
export function errText(e: unknown, more: Record<string, string> = {}) {
  const x = e as ApiError & {
    body?: { error?: string; message?: string; errors?: string[] };
  };
  const b = x.body ?? (x.details as unknown as typeof x.body);
  if (b?.errors?.length) return b.errors.join(' ');
  const code = x.code ?? b?.error;
  return (
    more[code] ??
    REFUS[code] ??
    b?.message ??
    code ??
    x.message ??
    'Action impossible.'
  );
}

/** Lance une action, désactive son bouton le temps de la réponse, dit le refus du Core. Renvoie vrai si elle a abouti. */
export async function run(
  btn: HTMLElement | null,
  fn: () => Promise<unknown>,
  done?: string,
  errors?: Record<string, string>,
) {
  btn?.classList.add('is-busy');
  try {
    await fn();
    if (done) toast(done);
    return true;
  } catch (e) {
    toast(errText(e, errors), { bad: true });
    return false;
  } finally {
    btn?.classList.remove('is-busy');
  }
}

function dlg(cls: string, html: string) {
  const d = document.createElement('dialog');
  d.className = cls;
  d.innerHTML = html;
  (document.querySelector('dialog[open]') ?? document.body).append(d);
  d.showModal();
  return d;
}
function closeDlg(d: HTMLDialogElement) {
  d.close();
  setTimeout(() => d.remove(), 240);
}

/** Confirmation sobre, réservée aux actions sensibles ou irréversibles : jamais pour un interrupteur ordinaire. */
export const confirmBox = (o: {
  title: string;
  body: string;
  yes: string;
  no?: string;
  danger?: boolean;
}) =>
  new Promise<boolean>((res) => {
    const d = dlg(
      'd-dlg',
      `<div class="d-dlg__b"><h2>${esc(o.title)}</h2><p>${esc(o.body)}</p></div><div class="d-dlg__a"><button type="button" class="d-btn ghost" data-no>${esc(o.no ?? 'Garder')}</button><button type="button" class="d-btn ${o.danger === false ? 'pri' : 'danger'}" data-yes>${esc(o.yes)}</button></div>`,
    );
    const end = (v: boolean) => {
      closeDlg(d);
      res(v);
    };
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      end(false);
    });
    d.querySelector<HTMLElement>('[data-yes]')!.onclick = () => end(true);
    d.querySelector<HTMLElement>('[data-no]')!.onclick = () => end(false);
  });

/**
 * Une action à plusieurs issues (« Purger + rembourser » / « Purger sans rembourser ») : le choix est explicite, rien par défaut
 * sur une action d'argent. Renvoie la valeur choisie, ou null.
 */
export const choiceBox = (o: {
  title: string;
  body?: string;
  choices: { v: string; label: string; sub?: string }[];
  yes: string;
  danger?: boolean;
  /** Champ libre (raison) : sa valeur revient dans `text`. */
  field?: { label: string; required?: boolean };
}) =>
  new Promise<{ v: string; text: string } | null>((res) => {
    const name = `c${Math.random().toString(36).slice(2)}`;
    const d = dlg(
      'd-dlg',
      `<div class="d-dlg__b"><h2>${esc(o.title)}</h2>${o.body ? `<p>${esc(o.body)}</p>` : ''}<div class="d-dlg__c">${o.choices
        .map(
          (c) =>
            `<label><input type="radio" name="${name}" value="${esc(c.v)}"><span>${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span></label>`,
        )
        .join(
          '',
        )}${o.field ? `<textarea class="d-area" data-text placeholder="${esc(o.field.label)}" aria-label="${esc(o.field.label)}"></textarea>` : ''}</div></div><div class="d-dlg__a"><button type="button" class="d-btn ghost" data-no>Annuler</button><button type="button" class="d-btn ${o.danger ? 'danger' : 'pri'}" data-yes disabled>${esc(o.yes)}</button></div>`,
    );
    const yes = d.querySelector<HTMLButtonElement>('[data-yes]')!;
    const text = d.querySelector<HTMLTextAreaElement>('[data-text]');
    const pick = () =>
      d.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ??
      (o.choices.length ? null : '');
    const check = () => {
      yes.disabled =
        pick() === null || (!!o.field?.required && !text?.value.trim());
    };
    d.addEventListener('input', check);
    check();
    const end = (v: { v: string; text: string } | null) => {
      closeDlg(d);
      res(v);
    };
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      end(null);
    });
    d.querySelector<HTMLElement>('[data-no]')!.onclick = () => end(null);
    yes.onclick = () =>
      end({ v: pick() ?? '', text: text?.value.trim() ?? '' });
  });

export interface Drawer {
  el: HTMLDialogElement;
  /** Réécrit le contenu en gardant le défilement ; rien si rien n'a changé. */
  set(o: {
    kicker?: string;
    title?: string;
    body?: string;
    foot?: string;
  }): void;
  close(): void;
}
/** Le détail d'un objet (une demande, un viewer) par-dessus la page, qu'on referme sans perdre sa place. */
export function drawer(o: {
  kicker?: string;
  title: string;
  body: string;
  foot?: string;
  onClose?: () => void;
}): Drawer {
  for (const old of document.querySelectorAll<HTMLDialogElement>(
    'dialog.d-drawer',
  ))
    old.close();
  const d = document.createElement('dialog');
  d.className = 'd-drawer';
  d.innerHTML = `<header class="d-drawer__h"><div><small data-k></small><h2 data-t></h2></div><button type="button" class="d-ib" data-close aria-label="Fermer">${ic('x')}</button></header><div class="d-drawer__b" data-b></div><footer class="d-drawer__f" data-f hidden></footer>`;
  document.body.append(d);
  const q = (s: string) => d.querySelector<HTMLElement>(s)!;
  const api: Drawer = {
    el: d,
    set(x) {
      if (x.kicker !== undefined) q('[data-k]').textContent = x.kicker;
      if (x.title !== undefined) q('[data-t]').textContent = x.title;
      if (x.body !== undefined) patch(q('[data-b]'), x.body);
      if (x.foot !== undefined) {
        patch(q('[data-f]'), x.foot);
        q('[data-f]').hidden = !x.foot;
      }
    },
    close: () => d.close(),
  };
  api.set(o);
  d.addEventListener('close', () => {
    o.onClose?.();
    setTimeout(() => d.remove(), 260);
  });
  d.addEventListener('click', (e) => {
    if (e.target === d || (e.target as HTMLElement).closest('[data-close]'))
      d.close();
  });
  d.showModal();
  q('[data-close]').blur();
  return api;
}

// --- Cadre d'une page -----------------------------------------------------------------------------------------------

export interface Page {
  root: HTMLElement;
  /** L'état, à côté du titre. */
  state: HTMLElement;
  /** Les actions de la page, à droite du titre. */
  actions: HTMLElement;
  body: HTMLElement;
  panel: {
    isOpen(): boolean;
    /** Ouvre le panneau de réglages ; `to` : la section à montrer. */
    open(to?: string): void;
    close(): void;
    toggle(): void;
    /** Le contenu, à la recherche près : `grp`, `row`, `numrow`. */
    set(html: string): void;
    body: HTMLElement;
  };
}

/** Bouton « Réglages » standard de l'en-tête. */
export const panelBtn = (on: boolean, label = 'Réglages') =>
  `<button type="button" class="d-btn ${on ? 'on' : 'ghost'}" data-panel>${ic('sliders')}${esc(label)}</button>`;

/**
 * Le cadre de toute page : titre, état, actions, zone de travail et panneau à la demande avec recherche. `mod` choisit la
 * teinte. Chaque page dessine sa zone de travail à sa façon : il n'y a pas de gabarit au-delà de ce cadre.
 */
export function page(
  root: HTMLElement,
  o: { title: string; mod?: string; panel?: boolean },
): Page {
  root.innerHTML = `<div class="d-page" ${o.mod ? `data-mod="${esc(o.mod)}"` : ''}>
    <header class="d-head"><h1>${esc(o.title)}</h1><span data-d="state"></span><span class="d-sp"></span><span data-d="actions" style="display:contents"></span></header>
    <div class="d-work" data-d="work"><div class="d-body" data-d="body"></div>${
      o.panel
        ? `<aside class="d-panel" aria-label="Réglages" inert><div class="d-panel__in"><div class="d-panel__s"><label class="d-fld">${ic('search')}<input type="search" data-pfind placeholder="Chercher un réglage" aria-label="Chercher un réglage"></label><button type="button" class="d-ib" data-pclose aria-label="Fermer les réglages">${ic('x')}</button></div><div class="d-panel__b" data-d="pbody"></div></div></aside>`
        : '<span></span>'
    }</div></div>`;
  const q = (k: string) => root.querySelector<HTMLElement>(`[data-d="${k}"]`)!;
  const work = q('work');
  const aside = root.querySelector<HTMLElement>('.d-panel');
  const pbody = q('pbody');
  const find = root.querySelector<HTMLInputElement>('[data-pfind]');
  const filter = () => {
    const s = (find?.value ?? '').toLowerCase().trim();
    pbody?.querySelectorAll<HTMLElement>('.d-grp').forEach((g) => {
      let any = false;
      g.querySelectorAll<HTMLElement>('[data-k]').forEach((r) => {
        const hit =
          !s || !!r.dataset.k?.includes(s) || !!g.dataset.g?.includes(s);
        r.hidden = !hit;
        any ||= hit;
      });
      g.hidden = !any;
    });
  };
  const paintBtn = (on: boolean) => {
    for (const b of root.querySelectorAll<HTMLElement>('[data-panel]')) {
      b.classList.toggle('on', on);
      b.classList.toggle('ghost', !on);
    }
  };
  const panel: Page['panel'] = {
    body: pbody,
    isOpen: () => work.classList.contains('is-open'),
    open(to) {
      if (!aside) return;
      work.classList.add('is-open');
      aside.inert = false;
      paintBtn(true);
      setTimeout(() => {
        if (to)
          pbody
            .querySelector<HTMLElement>(`[data-g*="${to}"]`)
            ?.scrollIntoView({
              block: 'start',
            });
        else find?.focus({ preventScroll: true });
      }, 60);
    },
    close() {
      if (!aside) return;
      work.classList.remove('is-open');
      aside.inert = true;
      paintBtn(false);
    },
    toggle() {
      if (panel.isOpen()) panel.close();
      else panel.open();
    },
    set(html) {
      // Une partie dépliée le reste quand un relevé réécrit le panneau.
      const open = [...pbody.querySelectorAll('details')].map((d) => d.open);
      patch(pbody, html);
      pbody.querySelectorAll('details').forEach((d, i) => {
        if (open[i]) d.open = true;
      });
      filter();
    },
  };
  find?.addEventListener('input', filter);
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-panel]')) panel.toggle();
    else if (t.closest('[data-pclose]')) panel.close();
  });
  root.addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      panel.isOpen() &&
      aside?.contains(e.target as Node)
    )
      panel.close();
  });
  return {
    root,
    state: q('state'),
    actions: q('actions'),
    body: q('body'),
    panel,
  };
}

export const stateChip = (dot: '' | 'w' | 'off' | 'r' | 'live', text: string) =>
  `<span class="d-state"><i class="d-dot ${dot}"></i>${esc(text)}</span>`;

/** Champ numérique qu'on tire à la souris depuis son libellé `[data-scrub]`. Le clavier reste celui de l'input. */
export function scrub(
  root: HTMLElement,
  onChange: (input: HTMLInputElement) => void,
) {
  let drag: {
    x: number;
    v: number;
    input: HTMLInputElement;
    step: number;
    moved: boolean;
  } | null = null;
  root.addEventListener('pointerdown', (e) => {
    const lab = (e.target as HTMLElement).closest<HTMLElement>('[data-scrub]');
    const input = lab?.parentElement?.querySelector('input');
    if (!lab || !input) return;
    drag = {
      x: e.clientX,
      v: Number(input.value) || 0,
      input,
      step: Number(input.step) || 1,
      moved: false,
    };
    lab.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) < 3 && !drag.moved) return;
    drag.moved = true;
    const min = drag.input.min === '' ? -Infinity : Number(drag.input.min);
    const max = drag.input.max === '' ? Infinity : Number(drag.input.max);
    const v = Math.min(
      max,
      Math.max(min, drag.v + Math.round(dx / 4) * drag.step),
    );
    if (String(v) !== drag.input.value) {
      drag.input.value = String(v);
      onChange(drag.input);
    }
  });
  root.addEventListener('pointerup', () => {
    drag = null;
  });
}

/** Copie une valeur (URL de source OBS…) et le dit. */
export function copy(text: string, done = 'Copié') {
  void navigator.clipboard?.writeText(text).then(
    () => toast(done),
    () => toast('Copie impossible', { bad: true }),
  );
}
