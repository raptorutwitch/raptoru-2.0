import { esc, tryGetJson } from './http.js';

// The common frame of a Studio page: title, one sentence, optional state, tabs. A module keeps its own screens inside;
// the frame gives every page the same head and the same keyboard behaviour.

export type TabDef = [id: string, label: string];

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export function moduleFrame(
  root: HTMLElement,
  o: { id: string; title: string; lead: string; tabs?: TabDef[] },
) {
  const tabs = o.tabs ?? [];
  const key = `raptoru-studio-tab-${o.id}`;
  const saved = stored(key);
  let on = tabs.some(([id]) => id === saved) ? saved! : (tabs[0]?.[0] ?? '');
  const tabId = (id: string) => `${o.id}-tab-${id}`;
  const panelId = (id: string) => `${o.id}-panel-${id}`;
  root.innerHTML = `<div class="rs-page rs-form rs-frame">
    <header class="rs-page-head rs-head-row"><div><h1>${esc(o.title)}</h1><p>${esc(o.lead)}</p></div><div data-frame="state"></div></header>
    ${
      tabs.length
        ? `<div class="rs-tabs" role="tablist" aria-label="${esc(o.title)}">${tabs
            .map(
              ([id, label]) =>
                `<button type="button" role="tab" id="${tabId(id)}" data-tab="${id}" aria-controls="${panelId(id)}" aria-selected="${id === on}" tabindex="${id === on ? 0 : -1}">${esc(label)}</button>`,
            )
            .join('')}</div>`
        : ''
    }
    ${
      tabs.length
        ? tabs
            .map(
              ([id]) =>
                `<section class="rs-tabpanel" role="tabpanel" id="${panelId(id)}" aria-labelledby="${tabId(id)}"${id === on ? '' : ' hidden'}></section>`,
            )
            .join('')
        : `<section class="rs-tabpanel" data-frame="body"></section>`
    }
  </div>`;
  const buttons = () => [
    ...root.querySelectorAll<HTMLButtonElement>('.rs-tabs > [role="tab"]'),
  ];
  const listeners: ((id: string) => void)[] = [];
  const select = (id: string, focus = false) => {
    on = id;
    for (const b of buttons()) {
      const mine = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(mine));
      b.tabIndex = mine ? 0 : -1;
      if (mine && focus) b.focus();
    }
    for (const [t] of tabs)
      root.querySelector<HTMLElement>(`#${panelId(t)}`)!.hidden = t !== id;
    try {
      localStorage.setItem(key, id);
    } catch {
      /* private mode: the tab is not remembered */
    }
    for (const l of listeners) l(id);
  };
  const bar = root.querySelector<HTMLElement>('.rs-tabs');
  bar?.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')
      ?.dataset.tab;
    if (id) select(id);
  });
  bar?.addEventListener('keydown', (e) => {
    const shown = buttons().filter((b) => !b.hidden);
    const at = shown.findIndex((b) => b.dataset.tab === on);
    const to =
      e.key === 'ArrowRight'
        ? shown[(at + 1) % shown.length]
        : e.key === 'ArrowLeft'
          ? shown[(at - 1 + shown.length) % shown.length]
          : e.key === 'Home'
            ? shown[0]
            : e.key === 'End'
              ? shown.at(-1)
              : undefined;
    if (!to) return;
    e.preventDefault();
    select(to.dataset.tab!, true);
  });
  return {
    /** A tab's panel; without tabs, the body of the page. */
    panel: (id?: string) =>
      root.querySelector<HTMLElement>(
        id ? `#${panelId(id)}` : '[data-frame="body"]',
      )!,
    state: root.querySelector<HTMLElement>('[data-frame="state"]')!,
    current: () => on,
    onTab: (l: (id: string) => void) => listeners.push(l),
    hideTab(id: string) {
      root.querySelector<HTMLElement>(`#${tabId(id)}`)!.hidden = true;
      if (on === id) select(tabs[0]![0]);
    },
    showTab(id: string) {
      root.querySelector<HTMLElement>(`#${tabId(id)}`)!.hidden = false;
    },
  };
}

/** The profile, once known (retried while Studio's server starts). */
export async function whenProfile(): Promise<'production' | 'lab'> {
  for (;;) {
    const p = await tryGetJson<{ effective?: string }>('/api/profile');
    if (p?.effective === 'production') return 'production';
    if (p?.effective) return 'lab';
    await new Promise((r) => setTimeout(r, 5000));
  }
}
