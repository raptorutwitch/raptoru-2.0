import { esc, ic, patch, pp, ring } from '../ds/ds.js';
import {
  DRAWN,
  reward,
  type Card,
  type Entry,
  type Round,
} from './tombola-model.js';

// L'arène : les inscrits se posent en spirale autour du compte à rebours, puis les gagnants montent au-dessus du tirage.

const SEATS = 130;
const GOLDEN = 2.39996;
const RING = 248;
const R0 = 158;
/** Au-delà, les gagnants restent à leur place, encadrés : leur liste se lit à côté. */
const MAX_LIFTED = 12;
const SRC_DOT: Record<Entry['source'], string> = {
  chat: '',
  extension: 'ext',
  manual: 'man',
};
const SRC_LABEL: Record<Entry['source'], string> = {
  chat: 'chat',
  extension: 'extension',
  manual: 'ajouté à la main',
};

function coreHtml(r: Round, c: Card | null) {
  const n = r.participants;
  const ins = `${n} inscrit${n > 1 ? 's' : ''}`;
  if (r.status === 'cancelled')
    return `${ring(1, 116, 7, RING)}<b class="tb-x">${ic('x')}</b><span>Annulée</span><small>Personne n’est payé</small>`;
  if (r.status === 'drawing')
    return `${ring(1, 116, 7, RING)}<span>Tirage</span><small>${ins}</small>`;
  if (DRAWN.includes(r.status)) {
    if (r.outcome === 'no_participants')
      return `${ring(0, 116, 7, RING)}<span>Aucun participant</span><small>Pas de tirage, rien n’est payé</small>`;
    const k = c?.winners.length ?? 0;
    return `${ring(0, 116, 7, RING)}<b class="tb-won">${esc(reward(r))}</b><small>${k} gagnant${k > 1 ? 's' : ''} sur ${n}</small>`;
  }
  return `${ring(1, 116, 8, RING)}<b data-cs></b><span>${esc(reward(r))}</span><small>${ins}</small>`;
}

export function mountArena(host: HTMLElement) {
  host.innerHTML = `<div class="tb-orbit">${'<i class="tb-seat"></i>'.repeat(SEATS)}</div><div class="tb-core" data-core></div>`;
  const orbit = host.querySelector<HTMLElement>('.tb-orbit')!;
  const core = host.querySelector<HTMLElement>('[data-core]')!;
  const seats = [...orbit.querySelectorAll<HTMLElement>('.tb-seat')];
  const slots = new Map<string, number>();
  let round: string | null = null;
  let winners: string[] = [];
  let drawn = false;

  const place = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    const n = slots.size;
    const size = n <= 64 ? 44 : n <= 130 ? 34 : 26;
    orbit.style.setProperty('--s', `${size}px`);
    const area = ((size + 5) ** 2 * 1.05) / Math.PI;
    const rMax = Math.sqrt(R0 ** 2 + Math.max(SEATS, n) * area);
    const ky = Math.min(1, (h / 2 - 22) / rMax);
    const kx = Math.min(1.3, (w / 2 - 22) / rMax);
    // Dans une arène étroite (panneau ouvert), le compte à rebours rétrécit avec la spirale.
    core.style.scale = String(
      Math.min(1, (Math.min(kx, ky) * R0 - 12) / (RING / 2)),
    );
    const at = (i: number) => {
      const th = i * GOLDEN;
      const rr = Math.sqrt(R0 ** 2 + i * area);
      return [Math.cos(th) * rr * kx, Math.sin(th) * rr * ky] as const;
    };
    seats.forEach((el, i) => {
      const [x, y] = at(i);
      el.style.setProperty('--x', String(x));
      el.style.setProperty('--y', String(y));
      el.hidden = i < n;
    });
    const lift = drawn && winners.length <= MAX_LIFTED;
    const cols = Math.max(1, Math.floor((w - 40) / 120));
    for (const el of orbit.querySelectorAll<HTMLElement>('.tb-ava')) {
      const id = el.dataset.id!;
      let [x, y] = at(slots.get(id) ?? 0);
      const i = winners.indexOf(id);
      const won = drawn && i >= 0;
      el.classList.toggle('w', won);
      el.classList.toggle('d-vf', won);
      if (lift && won) {
        const row = Math.floor(i / cols);
        const inRow = Math.min(cols, winners.length - row * cols);
        x = ((i % cols) + 0.5 - inRow / 2) * Math.min(190, (w - 40) / inRow);
        y = -h / 2 + 66 + row * 100;
      }
      el.style.setProperty('--x', String(x));
      el.style.setProperty('--y', String(y));
    }
  };
  new ResizeObserver(place).observe(host);

  return {
    paint(r: Round, c: Card | null) {
      if (round !== r.raffle_id) {
        round = r.raffle_id;
        slots.clear();
        orbit.querySelectorAll('.tb-ava').forEach((e) => e.remove());
      }
      const list = (c?.entries ?? []).filter((e) => !e.removed_at);
      const ids = new Set(list.map((e) => e.viewer_id));
      for (const k of [...slots.keys()]) if (!ids.has(k)) slots.delete(k);
      orbit.querySelectorAll<HTMLElement>('.tb-ava').forEach((b) => {
        if (!ids.has(b.dataset.id!)) b.remove();
      });
      let next = slots.size ? Math.max(...slots.values()) + 1 : 0;
      for (const e of list) {
        if (slots.has(e.viewer_id)) continue;
        slots.set(e.viewer_id, next++);
        orbit.insertAdjacentHTML(
          'beforeend',
          `<button type="button" class="tb-ava" data-id="${esc(e.viewer_id)}" data-n="${esc(e.display_name)}" aria-label="${esc(e.display_name)}, ${SRC_LABEL[e.source]}">${pp(e.display_name, 38, e.avatar_url)}<i class="${SRC_DOT[e.source]}"></i></button>`,
        );
      }
      drawn = DRAWN.includes(r.status) && !!c?.winners.length;
      winners = drawn ? c!.winners.map((w) => w.viewer_id) : [];
      host.classList.toggle('draw', drawn);
      orbit.classList.toggle('spin', r.status === 'drawing');
      core.classList.toggle('gold', r.kind === 'super' || !!r.reveal?.is_full);
      core.classList.toggle('bad', r.status === 'cancelled');
      patch(core, coreHtml(r, c));
      place();
    },
    /** Le temps, entre deux relevés : seuls le chiffre et l'anneau bougent. */
    tick(left: number, total: number, showing: boolean) {
      const n = core.querySelector<HTMLElement>('[data-cs]');
      if (n) n.textContent = String(Math.ceil(left / 1000));
      core.classList.toggle('d-hot', showing && left <= 10_000);
      const fg = core.querySelector<SVGCircleElement>('[data-ring]');
      if (fg && showing) {
        const dash = Number(fg.getAttribute('stroke-dasharray'));
        fg.style.strokeDashoffset = String(
          dash * (1 - left / Math.max(1, total)),
        );
      }
    },
  };
}
