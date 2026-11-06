import {
  clock,
  confirmBox,
  esc,
  keyed,
  page,
  patch,
  run,
  stateChip,
  toast,
} from '../ds/ds.js';
import {
  act,
  onModChange,
  openItem,
  removeMenu,
  type ModItem,
  type ModModule,
} from '../mod/mod.js';
import { pageStates } from '../module-states.js';
import { hrefOf, pageById } from '../shell/registry.js';
import {
  automationHtml,
  controlsHtml,
  CP_OFF_CONFIRM,
  CP_ON_CONFIRM,
  decisions,
  healthHtml,
  LIVE_ACTIONS,
  liveTracks,
  setChannelPoints,
} from '../shell/regie.js';
import type { HubCtx, HubView, Pulse } from './pulse.js';

// La Régie : pendant le live, tout se lit d'un coup d'œil et se pilote ici. À gauche les pistes de ce qui passe à l'antenne, comme un
// logiciel de montage ; à droite ce qui attend une décision, puis les automatisations. Les confirmations maison sont réservées au
// sensible : une pause agit tout de suite, une annulation dit ce qu'elle fait.

const href = (id: string) => hrefOf(pageById(id) ?? pageById('regie')!);
/** Le premier paragraphe d'une confirmation est son titre, le reste dit la conséquence. */
const split = (text: string) => {
  const [title, ...rest] = text.split('\n\n');
  return { title: title!, body: rest.join('\n\n') };
};

export function mountRegie(root: HTMLElement, ctx: HubCtx): HubView {
  const p = page(root, { title: 'Régie live', mod: 'tombola' });
  p.body.innerHTML = `<div class="rg">
    <div class="rg-main">
      <div class="rg-tracks" data-z="tracks" aria-label="Ce qui passe à l’antenne"></div>
      <nav class="rg-goes" aria-label="Contrôles par module">${controlsHtml(href)}</nav>
    </div>
    <aside class="rg-side">
      <section class="rg-dec" data-z-box="dec"><h2 class="d-lb">À décider</h2><div data-z="dec"></div></section>
      <section data-role="regie-cp"><h2 class="d-lb">Points de chaîne</h2><div data-z="cp"></div></section>
      <section><h2 class="d-lb">Santé</h2><div data-z="health"></div></section>
      <section data-z-box="watch" hidden><h2 class="d-lb">À surveiller</h2><div class="rg-watch" data-z="watch"></div></section>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  let last: Pulse | null = null;
  let tick = 0;

  const items = () => {
    const l = last?.live;
    const tts = l?.tts && l.tts !== 'off' ? l.tts : null;
    return [
      ...(tts?.playing ? [tts.playing] : []),
      ...(tts?.queue ?? []),
      ...(l?.sounds?.playing ?? []),
      ...(l?.sounds?.waiting ?? []),
    ];
  };
  const find = (id: string): ModItem | undefined =>
    items().find((i) => i.interaction_id === id);
  const moduleOf = (i: ModItem): ModModule => i.module ?? 'tts';

  /** Décomptes et progressions, sans réécrire la page : les boutons restent sous la souris. */
  function ticks() {
    const now = Date.now();
    for (const el of p.body.querySelectorAll<HTMLElement>('b[data-ends]'))
      el.textContent = clock((Number(el.dataset.ends) - now) / 1000);
    for (const el of p.body.querySelectorAll<HTMLElement>('i[data-total]')) {
      if (!el.dataset.ends) continue;
      el.style.width = `${Math.min(100, Math.max(0, ((Number(el.dataset.ends) - now) / Number(el.dataset.total)) * 100))}%`;
    }
    for (const el of p.body.querySelectorAll<HTMLElement>('i[data-start]')) {
      const from = Date.parse(el.dataset.start ?? '');
      if (from)
        el.style.width = `${Math.min(100, ((now - from) / Number(el.dataset.dur || 1)) * 100)}%`;
    }
  }

  function chips(u: Pulse) {
    const l = u.live;
    const parts = [
      l?.stream
        ? stateChip(
            'live',
            `${l.stream.source === 'twitch' ? 'En direct' : 'Live simulé'}`,
          )
        : l?.stream === null
          ? stateChip('off', 'Hors ligne')
          : '',
      l?.paused ? stateChip('w', 'Pause générale') : '',
    ];
    patch(p.state, parts.join(' '));
  }

  function draw(u: Pulse) {
    chips(u);
    const tracks = z('tracks');
    if (u.live) keyed(tracks, liveTracks(u.live, u.profile, href));
    else patch(tracks, '<p class="d-empty">Lecture…</p>');
    keyed(
      z('dec'),
      decisions(u.live, u.sup, href),
      `<p class="rg-calm">Rien à décider pour l’instant.</p>`,
    );
    patch(z('cp'), automationHtml(u.cp));
    patch(z('health'), healthHtml(u.sup, u.supOk, href));
    // Ce qui mérite un regard parmi tous les modules, sans quitter la page et sans liste à tenir.
    const watch = [...pageStates(u.ready, u.hostModules)].filter(
      ([, st]) => st.level === 'error' || st.level === 'warn',
    );
    p.body.querySelector<HTMLElement>('[data-z-box="watch"]')!.hidden =
      !watch.length;
    patch(
      z('watch'),
      watch
        .map(([id, st]) => {
          const pg = pageById(id);
          return pg
            ? `<a href="${hrefOf(pg)}" data-page="${pg.id}" data-tone="${st.level === 'error' ? 'bad' : 'warn'}"><i></i><b>${esc(pg.label)}</b><span>${esc(st.text)}</span></a>`
            : '';
        })
        .join(''),
    );
    ticks();
  }

  async function live(b: HTMLElement, id: string) {
    const a = LIVE_ACTIONS[id];
    if (!a) return;
    if (a.confirm) {
      const ok = await confirmBox({
        ...split(a.confirm),
        yes: a.label.replace('…', ''),
        no: 'Ne rien faire',
      });
      if (!ok) return;
    }
    let out = {};
    const done = await run(b, async () => {
      out = (await a.run()) as object;
    });
    if (done) toast(typeof a.done === 'string' ? a.done : a.done(out));
    ctx.refresh();
  }

  async function automations(b: HTMLElement) {
    const on = !last?.cp?.enabled;
    const ok = await confirmBox({
      ...split(on ? CP_ON_CONFIRM : CP_OFF_CONFIRM),
      yes: on ? 'Activer' : 'Couper',
      no: 'Ne rien faire',
      danger: !on,
    });
    if (!ok) return;
    await run(
      b,
      () => setChannelPoints(on),
      on ? 'Automatisations activées' : 'Automatisations coupées',
    );
    ctx.refresh();
  }

  p.body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const liveBtn = t.closest<HTMLElement>('[data-live]');
    if (liveBtn) return void live(liveBtn, liveBtn.dataset.live!);
    if (t.closest('[data-regie="cp"]') && last?.cp)
      return void automations(t.closest<HTMLElement>('[data-regie="cp"]')!);
    const allow = t.closest<HTMLElement>('[data-allow]');
    if (allow) {
      const i = find(allow.dataset.allow!);
      if (i)
        void act(
          allow,
          { action: 'allow', module: 'tts', interaction_id: i.interaction_id },
          `Message de ${i.viewer_display_name} laissé passer`,
        );
      return;
    }
    const more = t.closest<HTMLElement>('[data-more]');
    if (more) {
      const i = find(more.dataset.more!);
      if (i) removeMenu(more, i, moduleOf(i));
      return;
    }
    const item = t.closest<HTMLElement>('[data-item]');
    if (item) {
      const i = find(item.dataset.item!);
      if (i) openItem(i, moduleOf(i));
    }
  });
  onModChange(() => ctx.refresh());

  return {
    setVisible(v) {
      clearInterval(tick);
      if (v) tick = window.setInterval(ticks, 500);
    },
    update(u) {
      last = u;
      draw(u);
    },
  };
}
