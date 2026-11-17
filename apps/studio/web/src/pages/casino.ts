import {
  confirmBox,
  errText,
  esc,
  fld,
  fmt,
  hhmm,
  ic,
  keyed,
  numrow,
  page,
  patch,
  poller,
  pp,
  run,
  scrub,
  seg,
  stateChip,
  toast,
  viewersSeg,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import { openViewer } from '../mod/mod.js';

// Casino (docs/CASINO.md § 8) : la machine à sous (et son Coffre) et la roulette de l'extension. Le Core tire, paie et
// garde chaque partie ; ici on ouvre ou ferme, on règle les limites économiques (préparées, puis « Appliquer »), et on lit
// l'état : les chiffres du jour, les parties en cours, les dernières parties et les refus. Les règles des jeux (chances,
// gains, Coffre) ne se règlent nulle part.

interface Setting {
  key: string;
  label: string;
  unit: string;
  value: number;
  default: number;
  min: number;
  max: number;
  help?: string;
}
interface Round {
  round_id: string;
  game: 'slot' | 'roulette';
  bet: number;
  payout: number;
  raw_payout: number;
  capped: boolean;
  viewer_id: string;
  viewer_name: string;
  created_at: string;
  shared: boolean;
  announced: boolean;
  economy: string;
  finished: boolean;
  progress_step: number;
  coffre?: { total: number; full: boolean; jackpots: string[] } | null;
  number?: number;
  color?: string;
}
interface CasinoAdmin {
  availability: {
    open: boolean;
    reason: string | null;
    live: boolean;
    games: { slot: boolean; roulette: boolean };
    economy: string;
  };
  limits: Record<string, number | boolean>;
  production_approved: boolean;
  active: {
    round_id: string;
    game: string;
    viewer_name: string;
    bet: number;
    phase: string;
  }[];
  day: {
    game: string;
    rounds: number;
    staked: number;
    paid: number;
    net_house: number;
    capped: number;
    players: number;
  }[];
  recent: Round[];
  refusals: {
    counts: Record<string, number>;
    last: { at: string; viewer: string; game: string; code: string }[];
  };
}

const LIMITS: [key: string, label: string][] = [
  ['casino.slot_min_bet', 'Machine : mise minimum'],
  ['casino.slot_max_bet', 'Machine : mise maximum'],
  ['casino.roulette_max_total', 'Roulette : mise totale max.'],
  ['casino.max_win', 'Gain maximum par partie'],
  ['casino.share_cooldown_s', 'Partage : délai par viewer'],
  ['casino.announce_min_x', 'Annonce automatique dès'],
];
const REASON: Record<string, string> = {
  not_approved: 'Pas autorisé sur ce Core (variable CASINO_EXTENSION)',
  casino_closed: 'Fermé aux viewers',
  stream_offline: 'Ouvert, mais hors live : rien ne se joue',
};
const REFUSAL: Record<string, string> = {
  insufficient_tokens: 'solde insuffisant',
  stream_offline: 'hors live',
  casino_closed: 'Casino fermé',
  game_closed: 'jeu fermé',
  not_approved: 'non autorisé',
  above_max: 'au-dessus du maximum',
  above_max_win: 'gain possible au-dessus du plafond',
  below_min: 'mise trop basse',
  invalid_bet: 'mise invalide',
  not_multiple: 'pas un multiple de 20',
  unknown_spot: 'case inconnue',
  viewer_blocked: 'viewer bloqué',
  global_pause: 'pause générale',
  balance_cap: 'plafond de solde',
  casino_unavailable: 'erreur du Core',
  economy_unavailable: 'Wallet indisponible',
};
/** RTP of the machine with a win cap of `x` × the bet (docs/CASINO.md § 5, 20 000 000 simulated spins). */
const RTP_BY_CAP: [number, number][] = [
  [50, 89.9],
  [100, 92.0],
  [200, 93.1],
  [300, 93.6],
  [500, 94.5],
  [750, 94.9],
  [1000, 95.1],
];
function rtpAt(x: number) {
  if (x >= 1000) return 95.1;
  if (x <= 50) return 89.9;
  for (let i = 1; i < RTP_BY_CAP.length; i++) {
    const [x1, r1] = RTP_BY_CAP[i]!;
    const [x0, r0] = RTP_BY_CAP[i - 1]!;
    if (x <= x1) return r0 + ((r1 - r0) * (x - x0)) / (x1 - x0);
  }
  return 95.1;
}
const gameLabel = (g: string) => (g === 'slot' ? 'Machine' : 'Roulette');
const outcome = (r: Round) =>
  r.game === 'roulette'
    ? `le ${r.number}`
    : r.coffre
      ? `Coffre ×${String(r.coffre.total).replace('.', ',')}${r.coffre.full ? ' · GRAND' : ''}${r.coffre.jackpots.length ? ` · ${r.coffre.jackpots.join(', ').toUpperCase()}` : ''}`
      : '';

export function mountCasinoPage(root: HTMLElement) {
  const p = page(root, { title: 'Casino · machine à sous et roulette' });
  p.body.innerHTML = `<div class="cz-adm">
    <div class="cz-adm__main">
      <div class="mg-bar"><span class="d-faint">Chances et gains sont fixes (Coffre compris).</span><span class="d-sp"></span><span data-z="apply"></span></div>
      <section class="mg-t"><header><h2>Jeux</h2></header><div class="cz-adm__games" data-z="games"></div></section>
      <section class="mg-t"><header><h2>Limites économiques</h2></header><div class="mg-set" data-z="limits"></div><p class="d-faint cz-adm__rtp" data-z="rtp"></p></section>
      <section class="mg-t"><header><h2>Aujourd’hui</h2></header><div data-z="day"></div></section>
      <section class="mg-t"><header><h2>Refus et transactions bloquées</h2></header><div data-z="refusals"></div></section>
    </div>
    <aside class="mg-feed">
      <h2 class="d-lb">En cours</h2>
      <div class="mg-list" data-z="active"></div>
      <h2 class="d-lb">Dernières parties</h2>
      <div class="mg-list d-scroll" data-z="list"></div>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let state: CasinoAdmin | null = null;
  let readError = '';
  let settings: Setting[] | null = null;
  let draft: Record<string, number> = {};
  let production = false;
  const of = (k: string) => settings?.find((s) => s.key === k);
  const dirty = () =>
    Object.entries(draft).some(([k, v]) => of(k)?.value !== v);
  const val = (k: string) => draft[k] ?? of(k)?.value ?? 0;

  function paintHead() {
    const a = state?.availability;
    patch(
      p.state,
      !state
        ? stateChip(readError ? 'r' : 'w', readError || 'Lecture…')
        : a?.open
          ? stateChip('live', 'Ouvert aux viewers pendant le live')
          : stateChip(
              a?.reason === 'stream_offline' ? 'w' : 'off',
              REASON[a?.reason ?? ''] ?? 'Fermé',
            ),
    );
    const open = of('casino.open')?.value === 1;
    patch(
      p.actions,
      `${production ? '<span class="d-tag warn">Vrais Jetons</span>' : '<span class="d-tag off">Jetons de test</span>'}<a class="d-btn ghost" href="?p=simulation">${ic('chat')}Live simulé</a>
       ${viewersSeg(
         'data-open',
         [
           ['on', 'Ouvert'],
           ['off', 'Fermé'],
         ],
         open ? 'on' : 'off',
       ).replaceAll('<button', settings ? '<button' : '<button disabled')}`,
    );
  }
  function paintGames() {
    const row = (key: string, label: string) => {
      const s = of(key);
      const on = s?.value === 1;
      return `<div class="cz-adm__game" data-gk="${key}" data-gl="${esc(label)}"><b>${label}</b>${seg(
        'data-gv',
        [
          ['1', 'Ouvert'],
          ['0', 'Fermé'],
        ],
        on ? '1' : '0',
      ).replaceAll('<button', s ? '<button' : '<button disabled')}</div>`;
    };
    patch(
      z('games'),
      `${row('casino.slot_open', 'Machine à sous')}${row('casino.roulette_open', 'Roulette')}${row('casino.announce', 'Annonces automatiques (GRAND, gros gains)')}
       ${state && !state.production_approved && state.availability.economy === 'canonical' ? '<p class="d-note">Ce Core n’autorise pas le Casino : variable CASINO_EXTENSION à off (le seul verrou qui ne se lève pas d’ici).</p>' : ''}`,
    );
  }
  function paintLimits() {
    const el = z('limits');
    if (el.contains(document.activeElement)) return;
    patch(
      el,
      !settings
        ? '<p class="d-note">Réglages illisibles.</p>'
        : LIMITS.map(([k, label]) => {
            const s = of(k);
            if (!s) return '';
            const v = draft[k] ?? s.value;
            return `<div title="${esc(`De ${fmt(s.min)} à ${fmt(s.max)} · par défaut ${fmt(s.default)}${s.help ? ` · ${s.help}` : ''}`)}">${numrow(label, fld(`data-s="${k}" min="${s.min}" max="${s.max}" step="${s.unit === 'Jetons' ? 20 : 1}" aria-label="${esc(s.label)}"`, v, s.unit === 'Jetons' ? 'J' : s.unit === '× la mise' ? '×' : s.unit))}</div>`;
          }).join(''),
    );
  }
  function paintRtp() {
    const maxBet = val('casino.slot_max_bet');
    const maxWin = val('casino.max_win');
    if (!maxBet || !maxWin) return patch(z('rtp'), '');
    const x = maxWin / maxBet;
    const full = Math.floor(maxWin / 1000);
    patch(
      z('rtp'),
      `Gain maximum = ${fmt(Math.round(x))} × la mise maximale : RTP de la machine ≈ <b>${rtpAt(x).toFixed(1).replace('.', ',')} %</b> à la mise maximale, ${x >= 1000 ? 'sans effet' : `95,1 % jusqu’à ${fmt(full)} de mise`}. Un gain plafonné est montré « plafonné » au joueur (jamais en silence) ; la roulette refuse avant le tirage une mise qui pourrait dépasser le plafond.`,
    );
  }
  function paintApply() {
    patch(
      z('apply'),
      dirty()
        ? '<span class="mg-apply"><span class="d-muted">Pas encore appliqué</span><button type="button" class="d-btn ghost sm" data-revert>Annuler</button><button type="button" class="d-btn pri sm" data-apply>Appliquer</button></span>'
        : '',
    );
  }
  function paintDay() {
    const d = state?.day ?? [];
    patch(
      z('day'),
      d.length
        ? `<table class="cz-adm__t"><thead><tr><th></th><th>Parties</th><th>Joueurs</th><th>Misé</th><th>Payé</th><th>Net Casino</th><th>Plafonnés</th></tr></thead><tbody>${d
            .map(
              (x) =>
                `<tr><td>${gameLabel(x.game)}</td><td>${fmt(x.rounds)}</td><td>${fmt(x.players)}</td><td>${fmt(x.staked)}</td><td>${fmt(x.paid)}</td><td class="${x.net_house < 0 ? 'neg' : ''}">${x.net_house < 0 ? '−' : '+'}${fmt(Math.abs(x.net_house))}</td><td>${fmt(x.capped)}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : '<p class="d-faint">Aucune partie ces dernières 24 h.</p>',
    );
  }
  function paintRefusals() {
    const r = state?.refusals;
    const counts = Object.entries(r?.counts ?? {}).sort((a, b) => b[1] - a[1]);
    patch(
      z('refusals'),
      counts.length
        ? `<div class="d-tags">${counts.map(([c, n]) => `<span class="d-tag ${c === 'casino_unavailable' || c === 'economy_unavailable' ? 'warn' : 'off'}">${esc(REFUSAL[c] ?? c)} · ${fmt(n)}</span>`).join('')}</div>
           <ul class="cz-adm__ref">${(r?.last ?? [])
             .slice(0, 8)
             .map(
               (x) =>
                 `<li><span>${hhmm(x.at)}</span> ${esc(x.viewer)} · ${gameLabel(x.game)} · ${esc(REFUSAL[x.code] ?? x.code)}</li>`,
             )
             .join('')}</ul>`
        : '<p class="d-faint">Aucun refus : rien n’a été bloqué.</p>',
    );
  }
  function paintRounds() {
    keyed(
      z('active'),
      (state?.active ?? []).map((x) => ({
        key: x.round_id,
        html: `<div class="mg-r d-in">${pp(x.viewer_name, 26)}<span class="mg-r__w"><b>${esc(x.viewer_name)}</b><small>${gameLabel(x.game)} · mise ${fmt(x.bet)}</small></span><span class="mg-r__g"><small>${x.phase === 'bonus' ? 'Coffre' : x.phase === 'draw' ? 'tirage' : 'résultat'}</small></span></div>`,
      })),
      '<div class="d-empty">Aucune partie en cours.</div>',
    );
    keyed(
      z('list'),
      (state?.recent ?? []).map((x) => ({
        key: x.round_id,
        html: `<button type="button" class="mg-r d-in" data-round="${esc(x.round_id)}" title="Détail technique de la partie">${pp(x.viewer_name, 26)}
          <span class="mg-r__w"><b>${esc(x.viewer_name)}</b><small>${gameLabel(x.game)} · mise ${fmt(x.bet)}${outcome(x) ? ` · ${esc(outcome(x))}` : ''}${x.capped ? ' · plafonné' : ''}${x.shared ? ' · partagé' : ''}</small></span>
          <span class="mg-r__g"><b class="d-num ${x.payout > x.bet ? 'win' : ''}">${x.payout ? `+${fmt(x.payout)}` : `−${fmt(x.bet)}`}</b><small>${hhmm(x.created_at)}</small></span></button>`,
      })),
      `<div class="d-empty">${!state && readError ? esc(readError) : 'Aucune partie pour l’instant.'}</div>`,
    );
  }

  async function read() {
    const [st, set] = await Promise.all([
      getJson<CasinoAdmin>('/api/casino/state').catch((e: unknown) => {
        readError = errText(e);
        return null;
      }),
      tryGetJson<{ settings: Setting[] }>('/api/module-settings'),
    ]);
    state = st;
    if (st) readError = '';
    settings = set?.settings ?? settings;
    paintHead();
    paintGames();
    if (!dirty()) paintLimits();
    paintRtp();
    paintApply();
    paintDay();
    paintRefusals();
    paintRounds();
  }
  const tick = poller(read, 3000);

  async function setSwitch(key: string, value: 0 | 1, label: string) {
    if (
      production &&
      !(await confirmBox({
        title: `${label} : ${value ? 'ouvrir' : 'fermer'} ?`,
        body: value
          ? 'Pour les vrais viewers : vrais Jetons, pendant les lives.'
          : 'Plus aucune nouvelle partie (l’historique reste lisible).',
        yes: value ? 'Ouvrir' : 'Fermer',
        no: 'Annuler',
      }))
    )
      return paintHead();
    const ok = await run(
      null,
      () => postJson('/api/module-settings', { key, value }),
      undefined,
    );
    if (ok)
      toast(`${label} ${value ? 'ouvert' : 'fermé'}`, {
        undo: () => void setSwitch(key, value ? 0 : 1, label),
      });
    tick.now();
  }
  async function send(changes: [string, number][]) {
    for (const [key, value] of changes)
      await postJson('/api/module-settings', { key, value });
  }
  async function apply(btn: HTMLElement) {
    const changes = Object.entries(draft).filter(
      ([k, v]) => of(k)?.value !== v,
    );
    const before = changes.map(([k]) => [k, of(k)!.value] as [string, number]);
    const yes = await confirmBox({
      title:
        changes.length > 1
          ? `Appliquer ${changes.length} changements ?`
          : 'Appliquer ce changement ?',
      body: `${changes.map(([k, v]) => `${of(k)!.label} : ${fmt(of(k)!.value)} → ${fmt(v)}`).join(' · ')}. Appliqué aux prochaines parties, ${production ? 'sur le vrai Core (vrais Jetons)' : 'sur le Core du Lab'}.`,
      yes: 'Appliquer',
      no: 'Annuler',
      danger: production,
    });
    if (!yes) return;
    const ok = await run(btn, () => send(changes), undefined, {
      out_of_bounds: 'Valeur hors des bornes.',
      unknown_setting: 'Réglage inconnu.',
    });
    if (!ok) return read();
    toast('Appliqué aux prochaines parties', {
      undo: () =>
        void run(
          null,
          () => send(before),
          'Valeurs précédentes rétablies',
        ).then(() => tick.now()),
    });
    draft = {};
    delete z('limits').dataset.sig;
    settings = null;
    await read();
  }
  async function showRound(id: string) {
    const r = await getJson<{
      round: Record<string, unknown>;
      wallet_keys: string[];
    }>(`/api/casino/rounds/${id}`).catch((e: unknown) => {
      toast(errText(e));
      return null;
    });
    if (!r) return;
    await confirmBox({
      title: `Partie ${id.slice(0, 8)}`,
      body: `Clés Wallet : ${r.wallet_keys.join(' · ')}. Tirage : ${JSON.stringify(r.round.outcome).slice(0, 600)}`,
      yes: 'Fermer',
      no: 'Fermer',
      danger: false,
    });
  }

  p.root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const isOpen = of('casino.open')?.value === 1;
    if (b.dataset.open && (b.dataset.open === 'on') !== isOpen)
      return void setSwitch(
        'casino.open',
        b.dataset.open === 'on' ? 1 : 0,
        'Casino',
      );
    const g = b.closest<HTMLElement>('[data-gk]');
    if (g && b.dataset.gv && Number(b.dataset.gv) !== of(g.dataset.gk!)?.value)
      return void setSwitch(
        g.dataset.gk!,
        b.dataset.gv === '1' ? 1 : 0,
        g.dataset.gl ?? 'Réglage',
      );
    if (b.dataset.round) return void showRound(b.dataset.round);
    if (b.dataset.viewer) return openViewer(b.dataset.viewer);
    if (b.matches('[data-apply]')) return void apply(b);
    if (b.matches('[data-revert]')) {
      draft = {};
      delete z('limits').dataset.sig;
      (document.activeElement as HTMLElement | null)?.blur?.();
      paintLimits();
      paintRtp();
      paintApply();
    }
  });
  const onInput = (i: HTMLInputElement) => {
    if (!i.dataset.s) return;
    draft[i.dataset.s] = Number(i.value);
    paintRtp();
    paintApply();
  };
  p.root.addEventListener('input', (e) =>
    onInput(e.target as HTMLInputElement),
  );
  scrub(p.root, (i) => onInput(i));

  return {
    setVisible(v: boolean) {
      if (v) {
        void tryGetJson<{ effective?: string }>('/api/profile').then((r) => {
          production = r?.effective === 'production';
          paintHead();
        });
        tick.start();
      } else tick.stop();
    },
  };
}
