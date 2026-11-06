import {
  type FeedFilter,
  feedHtml,
  FEED_FILTERS,
  mergeFeed,
} from '../activity-feed.js';
import { esc, page, patch, seg, stateChip } from '../ds/ds.js';
import { icon } from '../shell/icons.js';
import { hrefOf, pageById, type Page } from '../shell/registry.js';
import type { HubView, Pulse } from './pulse.js';

// Activité : ce qui s'est passé, sur un seul fil. Chaque source reste où elle est ; une source muette est dite, jamais lue comme
// « rien ne s'est passé ».

const DETAIL = [
  'shop',
  'challenges',
  'alerts',
  'channel-points',
  'tombola',
  'moderation',
];
const href = (id: string) => hrefOf(pageById(id) ?? pageById('activite')!);

export function mountActivite(root: HTMLElement): HubView {
  const p = page(root, { title: 'Activité' });
  p.body.innerHTML = `<div class="ac"><div data-z="feed"></div><aside class="ac-side"><h2 class="d-lb">Historiques détaillés</h2><nav>${DETAIL.map(
    (id) => pageById(id),
  )
    .filter((x): x is Page => !!x)
    .map(
      (x) =>
        `<a href="${hrefOf(x)}" data-page="${x.id}"${x.tint ? ` style="--tint:var(--${x.tint})"` : ''}>${icon(x.icon, '')}${esc(x.label)}</a>`,
    )
    .join('')}</nav></aside></div>`;
  const out = p.body.querySelector<HTMLElement>('[data-z="feed"]')!;
  let filter: FeedFilter = 'all';
  let last: Pulse | null = null;

  function draw() {
    const u = last;
    if (!u) return;
    patch(p.actions, seg('data-feed', FEED_FILTERS, filter));
    if (!u.feed) {
      patch(out, '<p class="d-empty">Lecture…</p>');
      return;
    }
    const missing = [
      ...(u.sup ? [] : ['coupures']),
      ...(u.feed.modules ? [] : ['journal des modules']),
      ...(u.feed.audit ? [] : ['audit de modération']),
    ];
    patch(p.state, missing.length ? stateChip('w', 'Fil incomplet') : '');
    const items = mergeFeed(
      u.sup?.history ?? [],
      u.feed.modules ?? [],
      u.feed.audit ?? [],
      (id) =>
        pageById(id === 'raffle' ? 'tombola' : id.replace(/_/g, '-'))?.label ??
        id,
    );
    patch(out, feedHtml(items, filter, href, missing));
  }
  root.addEventListener('click', (e) => {
    const f = (e.target as HTMLElement).closest<HTMLElement>('[data-feed]')
      ?.dataset.feed;
    if (f) {
      filter = f as FeedFilter;
      draw();
    }
  });
  return {
    setVisible() {},
    update(u) {
      last = u;
      draw();
    },
  };
}
