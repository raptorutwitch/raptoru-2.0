import { esc, fmt, hhmm, keyed, pp } from '../ds/ds.js';
import { ApiError, getJson } from '../http.js';

// Studio › Casino, « Dernières parties » : un joueur par ligne (le plus récent en haut), son historique déplié à la
// demande. La liste vient des dernières parties de la chaîne (fenêtre du Core) ; l'historique d'un joueur est lu à
// part, en entier, par pages (/api/casino/players/<id>/rounds → Core admin/players). Rien n'est recalculé : mise, gain
// brut et variation nette sont ceux que la partie a enregistrés.

export interface CasinoRound {
  round_id: string;
  game: string;
  bet: number;
  payout: number;
  net?: number;
  capped: boolean;
  created_at: string;
  viewer_id: string;
  viewer_name: string;
  finished?: boolean;
  shared?: boolean;
}
interface PlayerPage {
  viewer_id: string;
  viewer_name: string | null;
  rounds: CasinoRound[];
  totals: { rounds: number; staked: number; won: number; net: number };
  next_before: string | null;
}
interface Detail {
  status: 'loading' | 'ok' | 'error';
  rounds: CasinoRound[];
  totals: PlayerPage['totals'] | null;
  next: string | null;
  more: boolean;
  error: string;
}
export interface PlayerGroup {
  viewer_id: string;
  viewer_name: string;
  last: string;
  rounds: CasinoRound[];
  staked: number;
  won: number;
}

/** Une ligne par joueur, dans l'ordre de leur dernière partie (la fenêtre arrive la plus récente d'abord). */
export function groupByPlayer(recent: readonly CasinoRound[]): PlayerGroup[] {
  const by = new Map<string, PlayerGroup>();
  const sorted = [...recent].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  for (const r of sorted) {
    let g = by.get(r.viewer_id);
    if (!g) {
      g = {
        viewer_id: r.viewer_id,
        viewer_name: r.viewer_name,
        last: r.created_at,
        rounds: [],
        staked: 0,
        won: 0,
      };
      by.set(r.viewer_id, g);
    }
    g.rounds.push(r);
    g.staked += r.bet;
    g.won += r.payout;
  }
  return [...by.values()];
}

/** Variation avec son signe : +1 500, −800, 0. */
export const signed = (n: number) =>
  n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0';
const netOf = (r: CasinoRound) => r.net ?? r.payout - r.bet;
const PAGE = 30;

export function createCasinoPlayers(o: {
  host: HTMLElement;
  gameLabel: (game: string) => string;
  outcome: (r: CasinoRound) => string;
}) {
  const open = new Set<string>();
  const details = new Map<string, Detail>();
  let groups: PlayerGroup[] = [];
  let empty = '';

  async function load(id: string, more = false) {
    const cur = details.get(id);
    const before = more ? cur?.next : null;
    details.set(id, {
      status: more && cur ? 'ok' : 'loading',
      rounds: more && cur ? cur.rounds : [],
      totals: more && cur ? cur.totals : null,
      next: more && cur ? cur.next : null,
      more,
      error: '',
    });
    paint();
    try {
      const page = await getJson<PlayerPage>(
        `/api/casino/players/${encodeURIComponent(id)}/rounds?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
      );
      const prev = more ? (details.get(id)?.rounds ?? []) : [];
      const seen = new Set(prev.map((r) => r.round_id));
      details.set(id, {
        status: 'ok',
        rounds: [...prev, ...page.rounds.filter((r) => !seen.has(r.round_id))],
        totals: page.totals,
        next: page.next_before,
        more: false,
        error: '',
      });
    } catch (e) {
      const d = details.get(id);
      details.set(id, {
        status: more && d?.rounds.length ? 'ok' : 'error',
        rounds: d?.rounds ?? [],
        totals: d?.totals ?? null,
        next: d?.next ?? null,
        more: false,
        error:
          e instanceof ApiError && e.status < 500
            ? e.code
            : 'Serveur injoignable : historique non lu.',
      });
    }
    paint();
  }

  function opHtml(r: CasinoRound) {
    const out = o.outcome(r);
    const net = netOf(r);
    const flags = [
      r.capped ? 'plafonné' : '',
      r.finished === false ? 'en cours' : '',
    ].filter(Boolean);
    return `<li class="cz-op"><button type="button" class="cz-op__b" data-round="${esc(r.round_id)}" title="Détail technique de la partie">
      <span class="cz-op__w"><b>${esc(o.gameLabel(r.game))}</b><small>${out ? esc(out) : ''}${flags.length ? `${out ? ' · ' : ''}${flags.join(' · ')}` : ''}</small></span>
      <span class="cz-op__m"><small>mise −${fmt(r.bet)} · gain ${r.payout ? `+${fmt(r.payout)}` : '0'}</small></span>
      <span class="cz-op__n"><b class="d-num ${net > 0 ? 'win' : net < 0 ? 'neg' : ''}">${signed(net)}</b><small>${hhmm(r.created_at)}</small></span>
    </button></li>`;
  }

  function detailHtml(g: PlayerGroup) {
    const d = details.get(g.viewer_id);
    if (!d || d.status === 'loading')
      return '<div class="cz-pl__d"><p class="d-faint">Chargement de l’historique…</p></div>';
    if (d.status === 'error')
      return `<div class="cz-pl__d"><p class="d-faint">${esc(d.error)}</p><button type="button" class="d-btn ghost sm" data-player-retry="${esc(g.viewer_id)}">Réessayer</button></div>`;
    const t = d.totals;
    const head = t
      ? `<p class="cz-pl__t"><span>${fmt(t.rounds)} partie${t.rounds > 1 ? 's' : ''} au total</span><span>misé ${fmt(t.staked)}</span><span>gagné ${fmt(t.won)}</span><span>net <b class="d-num ${t.net > 0 ? 'win' : t.net < 0 ? 'neg' : ''}">${signed(t.net)}</b></span></p>`
      : '';
    const list = d.rounds.length
      ? `<ul class="cz-pl__ops">${d.rounds.map(opHtml).join('')}</ul>`
      : '<p class="d-faint">Aucune partie enregistrée.</p>';
    const tail = d.next
      ? `<button type="button" class="d-btn ghost sm cz-pl__more" data-player-more="${esc(g.viewer_id)}" ${d.more ? 'disabled aria-busy="true"' : ''}>${d.more ? 'Chargement…' : 'Parties plus anciennes'}</button>`
      : d.rounds.length
        ? '<p class="d-faint cz-pl__end">Début de l’historique.</p>'
        : '';
    const err = d.error ? `<p class="d-faint">${esc(d.error)}</p>` : '';
    return `<div class="cz-pl__d">${head}${list}${err}${tail}</div>`;
  }

  function rowHtml(g: PlayerGroup) {
    const isOpen = open.has(g.viewer_id);
    const n = g.rounds.length;
    const net = g.won - g.staked;
    return `<div class="cz-pl${isOpen ? ' is-open' : ''}">
      <button type="button" class="mg-r d-in cz-pl__row" data-player="${esc(g.viewer_id)}" aria-expanded="${isOpen}" title="${isOpen ? 'Replier' : 'Voir tout son historique'}">${pp(g.viewer_name, 26)}
        <span class="mg-r__w"><b>${esc(g.viewer_name)}</b><small>${n} partie${n > 1 ? 's' : ''} récente${n > 1 ? 's' : ''} · ${esc(o.gameLabel(g.rounds[0]!.game))}</small></span>
        <span class="mg-r__g"><b class="d-num ${net > 0 ? 'win' : ''}" title="Variation nette sur ces parties récentes (gains − mises)">${signed(net)}</b><small>${hhmm(g.last)}</small></span>
      </button>${isOpen ? detailHtml(g) : ''}</div>`;
  }

  function paint() {
    keyed(
      o.host,
      groups.map((g) => ({ key: g.viewer_id, html: rowHtml(g) })),
      empty,
    );
  }

  o.host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const id = b.dataset.player;
    if (id) {
      if (open.has(id)) open.delete(id);
      else {
        open.add(id);
        if (details.get(id)?.status !== 'ok') void load(id);
      }
      return paint();
    }
    if (b.dataset.playerMore) return void load(b.dataset.playerMore, true);
    if (b.dataset.playerRetry) return void load(b.dataset.playerRetry);
  });

  return {
    /** Le relevé de la page (toutes les quelques secondes) : la fenêtre des dernières parties de la chaîne. */
    update(recent: readonly CasinoRound[], emptyHtml: string) {
      groups = groupByPlayer(recent);
      empty = emptyHtml;
      // Un joueur ouvert qui vient de rejouer : son historique est relu depuis le début.
      for (const g of groups) {
        const d = details.get(g.viewer_id);
        if (
          open.has(g.viewer_id) &&
          d?.status === 'ok' &&
          !d.more &&
          d.rounds[0] &&
          Date.parse(g.last) > Date.parse(d.rounds[0].created_at)
        )
          void load(g.viewer_id);
      }
      paint();
    },
  };
}
