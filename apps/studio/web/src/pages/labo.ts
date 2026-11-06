import { esc, ic, page, patch, poller, stateChip } from '../ds/ds.js';
import { tryGetJson } from '../http.js';
import { icon } from '../shell/icons.js';
import { hrefOf, pageById, type Page } from '../shell/registry.js';
import { loadSimState, runSimAction, SIM_CHANGED } from '../simulation.js';
import { simPanel, type SimState } from '../simulation-view.js';
import { silhouette, SURFACES, type SurfaceId } from './labo-surfaces.js';
import type { HubView, Pulse } from './pulse.js';

// Le Laboratoire : tout ce qui se teste sans Twitch, sans OBS réel et sans Jetons réels. Le banc d'essai au centre (les mêmes
// interrupteurs que le widget), l'extension avec ses vraies silhouettes, les services de test.

export function mountLabo(root: HTMLElement): HubView {
  const p = page(root, { title: 'Laboratoire' });
  p.body.innerHTML = `<div class="lb">
    <section class="lb-ext">
      <h2 class="d-lb">Extension Twitch</h2>
      <nav class="lb-surfaces">${(Object.keys(SURFACES) as SurfaceId[])
        .map(
          (id) =>
            `<a href="/?p=extension-lab&amp;surface=${id}" data-page="extension-lab" title="${esc(SURFACES[id].hint)}"><span>${silhouette(id, 44)}</span><b>${esc(SURFACES[id].label)}</b></a>`,
        )
        .join('')}</nav>
    </section>
    <section class="lb-bench"><h2 class="d-lb">Banc d’essai</h2><div data-z="sim"></div></section>
    <section class="lb-more"><h2 class="d-lb">Services de test</h2><div data-z="svc"></div><nav data-z="more"></nav></section>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  let state: SimState | null = null;
  let busy = false;
  let error: string | null = null;
  const paint = () => patch(z('sim'), simPanel(state, busy, error));
  const read = poller(async () => {
    const [s, rt] = await Promise.all([
      loadSimState(),
      tryGetJson<{
        services?: { id: string; label: string; state: string }[];
      }>('/api/runtime/status'),
    ]);
    state = s;
    paint();
    patch(
      z('svc'),
      (rt?.services ?? [])
        .map(
          (x) =>
            `<p class="lb-svc" data-tone="${x.state === 'ready' ? 'ok' : x.state === 'stopped' ? 'off' : x.state === 'error' ? 'bad' : 'warn'}"><i></i>${esc(x.label)}</p>`,
        )
        .join(''),
    );
  }, 3000);
  const door = (x: Page) =>
    `<a href="${hrefOf(x)}" data-page="${x.id}">${icon(x.icon, '')}<span><b>${esc(x.label)}</b><small>${esc(x.desc)}</small></span>${ic('chevron')}</a>`;

  z('sim').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-sim]',
    );
    if (!b || b.disabled || !state) return;
    busy = true;
    error = null;
    paint();
    void runSimAction(b.dataset.sim!, state).then((x) => {
      error = x;
      busy = false;
      read.now();
    });
  });
  window.addEventListener(SIM_CHANGED, () => read.now());

  return {
    setVisible(v) {
      if (v) read.start();
      else read.stop();
    },
    update(u: Pulse) {
      patch(
        p.state,
        u.profile === 'production'
          ? stateChip('r', 'Profil Production : le Lab n’agit pas ici')
          : stateChip('', 'Sans Twitch, sans OBS réel, sans Jetons réels'),
      );
      patch(
        z('more'),
        (u.labMain
          ? ['simulation', 'socle-modules']
          : ['simulation', 'test-lab', 'socle-modules']
        )
          .map((id) => pageById(id))
          .filter((x): x is Page => !!x)
          .map(door)
          .join(''),
      );
    },
  };
}
