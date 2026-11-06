import {
  clock,
  confirmBox,
  esc,
  fld,
  fmt,
  hhmm,
  ic,
  keyed,
  patch,
  pop,
  pp,
  ring,
  seg,
  sw,
  toast,
  type IcName,
} from '../ds/ds.js';
import {
  act,
  allow,
  blockForm,
  emoteHtml,
  isLive,
  modChanged,
  marked,
  modJump,
  money,
  MODS,
  openItem,
  openLedgerId,
  openViewer,
  pending,
  purge,
  raffleAct,
  raffleAddForm,
  removeMenu,
  resetTrail,
  setModuleState,
  sourceText,
  statusText,
  stopAll,
  type ModItem,
  type ModModule,
} from '../mod/mod.js';
import { saveSetting } from '../module-settings.js';
import type { Ctx, ModState, Round, View } from './moderation-ui.js';

// La Régie : une table de mixage. Une tranche par module, côte à côte : son état, ce qui joue, ce qui attend, ce qui vient de
// passer. Les demandes à vérifier passent devant tout le reste. Une sélection (souris ou flèches) ouvre le détail à droite.

const STATES = [
  ['active', 'Ouvert'],
  ['paused', 'Pause'],
  ['disabled', 'Fermé'],
] as const;
const STRIPS: { m: ModModule; mod: string; icon: IcName; label: string }[] = [
  { m: 'tts', mod: 'tts', icon: 'mic', label: 'TTS' },
  { m: 'soundboard', mod: 'soundboard', icon: 'sound', label: 'Sons' },
  { m: 'bonk', mod: 'bonk', icon: 'sparkle', label: 'Bonk' },
  { m: 'raffle', mod: 'tombola', icon: 'ticket', label: 'Tombola' },
];
const BEFORE_DRAW = ['opening', 'open', 'paused'];
const title = (r: Round, k: string) => {
  const t = r.titles?.[k];
  return Array.isArray(t) ? t.join(' ').trim() : (t ?? '');
};

export function mountDesk(ctx: Ctx): View {
  const el = document.createElement('div');
  el.className = 'mv-desk';
  el.innerHTML = `<section class="mv-review" data-z="review" aria-label="Demandes à vérifier" hidden>
      <h2 class="d-lb" data-z="rhead"></h2><div data-z="rlist"></div></section>
    <div class="mv-strips">${STRIPS.map(
      (
        s,
      ) => `<section class="ms" data-strip="${s.m}" data-mod="${s.mod}" aria-label="${s.label}">
        <header class="ms-h" data-h></header><div class="ms-now" data-now></div>
        <div class="ms-l" data-l></div><footer class="ms-f" data-f></footer></section>`,
    ).join('')}
      <section class="ms ms--host" data-strip="host" aria-label="Autres modules" hidden><header class="ms-h" data-h></header><div class="ms-l" data-l></div><footer class="ms-f" data-f></footer></section>
    </div>`;
  // Une emote qui n'est plus servie disparaît sans laisser d'image cassée.
  el.addEventListener(
    'error',
    (e) => {
      if ((e.target as HTMLElement).matches?.('.m-emote'))
        (e.target as HTMLElement).remove();
    },
    true,
  );
  const z = (k: string) => el.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const strip = (m: string, part: string) =>
    el.querySelector<HTMLElement>(`[data-strip="${m}"] [data-${part}]`)!;

  let sel: { id: string; m: ModModule } | null = null;
  let col = 'tts';
  const stateOf = (m: ModModule): ModState =>
    ctx.o?.[m]?.module_state ?? 'active';
  const waiting = (m: ModModule): ModItem[] =>
    m === 'tts'
      ? (ctx.o?.tts.waiting ?? [])
      : m === 'soundboard'
        ? (ctx.o?.soundboard.waiting ?? [])
        : [];
  const playing = (m: ModModule): ModItem[] =>
    m === 'tts'
      ? ctx.o?.tts.current
        ? [ctx.o.tts.current]
        : []
      : m === 'soundboard'
        ? (ctx.o?.soundboard.playing ?? [])
        : [];
  const recent = (m: ModModule): ModItem[] =>
    m === 'tts' || m === 'soundboard' || m === 'bonk'
      ? (ctx.o?.[m].recent ?? []).filter((i) => !isLive(i))
      : [];
  const reviews = () => [...playing('tts'), ...waiting('tts')].filter(pending);
  const rowText = (i: ModItem, m: ModModule) =>
    m === 'tts'
      ? (i.message ?? i.detail ?? '')
      : m === 'soundboard'
        ? (i.sound_label ?? i.detail ?? '')
        : (i.detail ?? '');
  const on = (i: ModItem) => sel?.id === i.interaction_id;

  const row = (i: ModItem, m: ModModule, past = false) => {
    const hits = pending(i) ? (i.review_hits ?? []) : [];
    return {
      key: i.interaction_id,
      html: `<div class="ms-r d-in ${past ? 'past' : ''} ${hits.length ? 'watch' : ''} ${on(i) ? 'd-vf' : ''}"><button type="button" class="ms-r__m" data-item="${esc(i.interaction_id)}" data-m="${m}">${pp(i.viewer_display_name, 22)}<b>${esc(i.viewer_display_name)}</b><small>${past ? esc(statusText(i)) : hits.length ? 'À vérifier' : esc(money(i))}</small>${m === 'bonk' ? `<p class="ms-emote">${emoteHtml(i)}<span>${hhmm(i.created_at)}</span></p>` : `<p>${marked(rowText(i, m), hits)}</p>`}</button>${past ? '' : `<button type="button" class="d-ib ms-r__x" data-more="${esc(i.interaction_id)}" data-m="${m}" aria-label="Décider pour ${esc(i.viewer_display_name)}">${ic('more')}</button>`}</div>`,
    };
  };
  const nowRow = (i: ModItem, m: ModModule) =>
    `<div class="ms-p ${on(i) ? 'd-vf' : ''}"><button type="button" class="ms-r__m" data-item="${esc(i.interaction_id)}" data-m="${m}">${pp(i.viewer_display_name, 22)}<b>${esc(i.viewer_display_name)}</b><small data-left="${esc(i.interaction_id)}"></small><p>${marked(rowText(i, m), pending(i) ? i.review_hits : [])}</p></button>
      <span class="d-prog"><i data-prog="${esc(i.interaction_id)}"></i></span>
      <button type="button" class="d-btn ghost sm ms-cut" data-more="${esc(i.interaction_id)}" data-m="${m}">${ic('skip')}Passer${ic('down')}</button></div>`;
  const icb = (attr: string, icon: IcName, label: string) =>
    `<button type="button" class="d-ib" ${attr} aria-label="${esc(label)}" title="${esc(label)}">${ic(icon)}</button>`;

  function paintHead(s: (typeof STRIPS)[number]) {
    const st = stateOf(s.m);
    const w = waiting(s.m).length;
    const tts = ctx.o?.tts;
    const bits =
      s.m === 'tts'
        ? [
            w && tts?.wait_ms ? `≈ ${clock(tts.wait_ms / 1000)}` : '',
            tts?.queue_full ? 'File pleine' : '',
          ]
        : [];
    patch(
      strip(s.m, 'h'),
      `<div class="ms-t">${ic(s.icon)}<b>${s.label}</b>${w ? `<span class="ms-n d-num">${w}</span>` : ''}<span class="d-sp"></span><span class="ms-s">${esc(bits.filter(Boolean).join(' · '))}</span></div>${ctx.o ? seg(`data-st="${s.m}" data-v`, STATES, st, 'block ms-seg') : ''}`,
    );
    strip(s.m, 'h').parentElement!.dataset.state = st;
  }
  function paintNow(m: ModModule) {
    const p = playing(m);
    const st = stateOf(m);
    const note =
      st === 'paused'
        ? `En pause${waiting(m).length ? ' · file conservée' : ''}`
        : st === 'disabled'
          ? 'Fermé · masqué aux viewers'
          : '';
    if (m === 'raffle') return paintRaffle(note);
    const off =
      m === 'tts' && ctx.o?.tts.player_offline
        ? '<p class="ms-warn">Lecteur OBS absent : les messages attendent.</p>'
        : '';
    patch(
      strip(m, 'now'),
      `${note ? `<p class="ms-state">${esc(note)}</p>` : ''}${off}${m === 'bonk' && ctx.o ? '<p class="ms-hint">Instantané : pas de file.</p>' : ''}${p.map((i) => nowRow(i, m)).join('')}${m === 'soundboard' && p.length > 1 ? `<button type="button" class="d-btn bad sm" data-stopall>${ic('stop')}Couper tout</button>` : ''}`,
    );
  }
  function paintList(m: ModModule) {
    if (m === 'raffle') return;
    const w = waiting(m);
    const past = recent(m).slice(0, m === 'bonk' ? 9 : 5);
    keyed(
      strip(m, 'l'),
      [...w.map((i) => row(i, m)), ...past.map((i) => row(i, m, true))],
      `<div class="d-empty">${ctx.o ? (m === 'bonk' ? 'Aucun bonk.' : 'File vide.') : esc(ctx.err || 'Lecture…')}</div>`,
    );
  }
  function paintFoot(m: ModModule) {
    const w = waiting(m);
    const r = ctx.o?.raffle_v2?.round;
    patch(
      strip(m, 'f'),
      `${icb(`data-hist="${m}"`, 'hist', `Historique ${MODS[m].label}`)}${icb(`data-restr="${m}"`, 'ban', `Restrictions ${MODS[m].label}`)}${m === 'tts' ? icb('data-words', 'eye', 'Mots surveillés') : ''}<span class="d-sp"></span>
      ${m === 'tts' || m === 'soundboard' ? `<button type="button" class="d-btn bad sm" data-purge="${m}" ${w.length ? '' : 'disabled'}>${ic('trash')}Vider…</button>` : ''}
      ${m === 'raffle' ? `${r && BEFORE_DRAW.includes(r.status) ? `<button type="button" class="d-btn ghost sm" data-add>${ic('plus')}Ajouter</button>` : ''}<a class="d-ib" href="?p=tombola" aria-label="Réglages de la Tombola" title="Réglages de la Tombola">${ic('sliders')}</a>` : ''}`,
    );
  }
  function paintRaffle(note: string) {
    const v = ctx.o?.raffle_v2 ?? null;
    const r = v?.round ?? null;
    const before = !!r && BEFORE_DRAW.includes(r.status);
    let head: string;
    // Sans lecture du Core, on ne sait pas : ne rien affirmer sur la manche.
    if (!ctx.o) head = '';
    else if (!r)
      head = `<p class="ms-hint">Aucune manche en cours.</p><button type="button" class="d-btn sm" data-quick>${ic('ticket')}Manche rapide…</button>`;
    else {
      const st =
        r.status === 'paused'
          ? title(r, 'paused')
          : before
            ? title(r, 'open')
            : r.status === 'cancelled'
              ? title(r, 'cancelled')
              : r.status === 'drawing'
                ? 'Tirage en cours'
                : r.outcome === 'no_participants'
                  ? title(r, 'ended')
                  : 'Résultat à l’écran';
      const what =
        r.kind === 'giveaway'
          ? esc(r.prize ?? '')
          : `${fmt(r.amount)} ${esc(r.currency?.label ?? 'Jetons')}`;
      head = `<div class="ms-round" data-round>
        ${before ? `<span class="ms-ring" data-ringbox>${ring(1, 17, 3, 42)}<b class="d-num" data-rt></b></span>` : ''}
        <div><b>${esc(st)}</b><small>${r.participants} participant${r.participants > 1 ? 's' : ''} · ${what}${r.origin === 'automatic' ? ' · auto' : ''}</small></div></div>
        ${
          before
            ? `<div class="ms-rctl">${r.status === 'paused' ? icb('data-r="resume"', 'play', 'Reprendre la manche') : icb('data-r="pause"', 'pause', 'Mettre la manche en pause')}<button type="button" class="d-btn ghost sm" data-r="extend" title="Ajouter 30 secondes">+30 s</button><button type="button" class="d-btn sm" data-r="draw">${ic('crown')}Tirer</button><span class="d-sp"></span>${icb('data-r="cancel"', 'x', 'Annuler la manche')}</div>`
            : ''
        }`;
    }
    patch(
      strip('raffle', 'now'),
      `${note ? `<p class="ms-state">${esc(note)}</p>` : ''}${head}`,
    );
    // Le temps ne passe pas par le dessin : le rond se recale à chaque relevé sans réécrire les boutons.
    const rd = strip('raffle', 'now').querySelector<HTMLElement>(
      '[data-round]',
    );
    if (rd && r) {
      rd.dataset.end = String(Date.now() + Math.max(0, r.remaining_ms));
      rd.dataset.left = String(r.remaining_ms);
      rd.dataset.total = String(r.duration_ms);
      rd.dataset.frozen = r.status === 'paused' ? '1' : '';
    }
    const entries = (before ? (r?.entries ?? []) : []).map((e) => ({
      key: `p${e.viewer_id}`,
      html: `<div class="ms-pp d-in"><button type="button" class="ms-r__m ms-who" data-viewer="${esc(e.viewer_id)}">${pp(e.display_name, 22)}<b>${esc(e.display_name)}</b><small>${esc(sourceText(e.source))}</small></button><button type="button" class="d-ib ms-r__x" data-out="${esc(e.viewer_id)}" data-name="${esc(e.display_name)}" aria-label="Retirer ${esc(e.display_name)} de la manche">${ic('x')}</button></div>`,
    }));
    const drawn = r?.winners.length
      ? r
      : v?.last && (!r || v.last.raffle_id !== r.raffle_id)
        ? v.last
        : null;
    const won = (drawn?.winners ?? []).map((w) => ({
      key: `w${drawn!.raffle_id}${w.viewer_id}`,
      html: `<button type="button" class="ms-win" ${w.ledger_id ? `data-led="${w.ledger_id}" data-v="${esc(w.viewer_id)}"` : `data-viewer="${esc(w.viewer_id)}"`}>${ic('crown')}<b>${esc(w.display_name)}</b><small>${drawn!.kind === 'giveaway' ? 'gagne le lot' : `+ ${fmt(w.amount)}`} · ${w.payout_status === 'paid' ? 'payé' : w.payout_status === 'failed' ? 'échec' : 'en cours'}</small></button>`,
    }));
    const lastTag =
      drawn && drawn !== r && !drawn.winners.length
        ? [
            {
              key: `l${drawn.raffle_id}`,
              html: `<p class="ms-hint">Dernière manche : ${drawn.outcome === 'cancelled' ? 'annulée' : 'aucun participant'}.</p>`,
            },
          ]
        : [];
    keyed(strip('raffle', 'l'), [...entries, ...won, ...lastTag], '');
  }
  function paintReview() {
    const list = reviews();
    z('review').hidden = !list.length;
    patch(z('rhead'), `À vérifier · ${list.length}`);
    keyed(
      z('rlist'),
      list.map((i) => ({
        key: i.interaction_id,
        html: `<div class="mv-rv d-in ${on(i) ? 'd-vf' : ''}"><button type="button" class="mv-rv__m" data-item="${esc(i.interaction_id)}" data-m="tts">${pp(i.viewer_display_name, 28)}<b>${esc(i.viewer_display_name)}</b><small>${esc(money(i))} · ${hhmm(i.created_at)}</small><p>${marked(i.message ?? i.detail ?? '', i.review_hits)}</p></button>
          <button type="button" class="d-btn pri sm" data-allow="${esc(i.interaction_id)}">${ic('check')}Laisser passer</button>
          <button type="button" class="d-btn sm" data-refuse="${esc(i.interaction_id)}">Refuser${ic('down')}</button>
          <button type="button" class="d-btn ghost sm" data-block="${esc(i.interaction_id)}">${ic('ban')}Bloquer</button></div>`,
      })),
    );
  }
  function paintHosts() {
    const hosts = (ctx.hosts ?? []).filter((h) => h.moderation?.visible);
    const box = el.querySelector<HTMLElement>('[data-strip="host"]')!;
    box.hidden = !hosts.length;
    if (!hosts.length) return;
    patch(
      strip('host', 'h'),
      `<div class="ms-t">${ic('puzzle')}<b>Autres</b></div><p class="ms-hint">Modules du socle</p>`,
    );
    const dot = (h: (typeof hosts)[number]) =>
      h.status.intention === 'off'
        ? 'off'
        : h.status.observed === 'ready'
          ? ''
          : h.status.observed === 'error'
            ? 'r'
            : 'w';
    keyed(
      strip('host', 'l'),
      hosts.map((h) => ({
        key: h.id,
        html: `<div class="ms-host"><button type="button" class="ms-r__m" data-host="${esc(h.id)}"><i class="d-dot ${dot(h)}"></i><b>${esc(h.label)}</b><p>${esc(h.status.intention === 'off' ? 'Coupé' : h.status.summary)}</p></button>${h.has_switch ? sw(h.enabled, `data-hsw="${esc(h.id)}"`, `${h.label} ouvert aux viewers`) : ''}</div>`,
      })),
    );
    patch(
      strip('host', 'f'),
      `<span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-host="">Journal${ic('arrow')}</button>`,
    );
  }
  function paint() {
    paintReview();
    for (const s of STRIPS) {
      paintHead(s);
      paintNow(s.m);
      paintList(s.m);
      paintFoot(s.m);
    }
    paintHosts();
    tick();
  }

  // Temps vivant, sans relire le Core.
  function tick() {
    const now = Date.now();
    for (const i of [...playing('tts'), ...playing('soundboard')]) {
      const ms = i.estimated_duration_ms ?? i.duration_ms;
      const start = i.delivery?.started_at;
      const id = CSS.escape(i.interaction_id);
      const bar = el.querySelector<HTMLElement>(`[data-prog="${id}"]`);
      const left = el.querySelector<HTMLElement>(`[data-left="${id}"]`);
      if (!start || !ms) {
        if (left) left.textContent = '…';
        continue;
      }
      const t = now - Date.parse(start);
      if (bar)
        bar.style.width = `${Math.min(100, Math.max(2, (t / ms) * 100))}%`;
      if (left) left.textContent = clock((ms - t) / 1000);
    }
    const rd = el.querySelector<HTMLElement>('[data-round]');
    if (rd) {
      const total = Number(rd.dataset.total);
      const left = rd.dataset.frozen
        ? Number(rd.dataset.left)
        : Number(rd.dataset.end) - now;
      const c = rd.querySelector<SVGCircleElement>('[data-ring]');
      const dash = Number(c?.getAttribute('stroke-dasharray'));
      c?.setAttribute(
        'stroke-dashoffset',
        String(dash * (1 - Math.min(1, Math.max(0, left / total)))),
      );
      const text = rd.querySelector<HTMLElement>('[data-rt]');
      if (text) text.textContent = clock(left / 1000);
      rd.querySelector('[data-ringbox]')?.classList.toggle(
        'd-hot',
        left < 10_000,
      );
    }
  }

  // --- Sélection -----------------------------------------------------------------------------------------------------
  const find = (id: string, m: ModModule) =>
    [...playing(m), ...waiting(m), ...recent(m)].find(
      (i) => i.interaction_id === id,
    );
  const extra = (i: ModItem) =>
    `${i.estimated_duration_ms ? `<dt>Durée estimée</dt><dd>${clock(i.estimated_duration_ms / 1000)}</dd>` : ''}${i.channel_sequence ? `<dt>Ordre</dt><dd>n° ${i.channel_sequence}</dd>` : ''}${i.delivery?.started_at ? `<dt>Joué à</dt><dd>${hhmm(i.delivery.started_at)}</dd>` : ''}`;
  function select(i: ModItem, m: ModModule) {
    sel = { id: i.interaction_id, m };
    resetTrail();
    openItem(i, m, extra);
    paint();
    el.querySelector('.d-vf')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }
  /** Les colonnes parcourues au clavier, dans l'ordre de l'écran. */
  const columns = () =>
    [
      { k: 'review', m: 'tts' as ModModule, rows: reviews() },
      ...STRIPS.map(({ m }) => ({
        k: m as string,
        m,
        rows: [...playing(m), ...waiting(m), ...recent(m)],
      })),
    ].filter((c) => c.rows.length);
  function move(dx: number, dy: number) {
    const cols = columns();
    if (!cols.length) return;
    const cx =
      (Math.max(
        0,
        cols.findIndex((c) => c.k === col),
      ) +
        dx +
        cols.length) %
      cols.length;
    const c = cols[cx]!;
    const at = c.rows.findIndex((i) => i.interaction_id === sel?.id);
    const cy =
      dx || at < 0 ? 0 : Math.min(c.rows.length - 1, Math.max(0, at + dy));
    col = c.k;
    select(c.rows[cy]!, c.m);
  }
  const selected = () => (sel ? (find(sel.id, sel.m) ?? null) : null);
  const anchorOf = () =>
    el.querySelector<HTMLElement>(
      `.d-vf [data-more], .d-vf [data-item], .mv-rv.d-vf [data-item]`,
    );

  // --- Gestes --------------------------------------------------------------------------------------------------------
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const id = t.dataset.hsw;
    if (!id) return;
    void saveSetting(`${id}.enabled`, t.checked ? 1 : 0).then(
      () => {
        toast(t.checked ? 'Ouvert aux viewers' : 'Coupé');
        modChanged();
      },
      (err: Error) => {
        t.checked = !t.checked;
        toast(err.message, { bad: true });
      },
    );
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    if (d.st) {
      const m = d.st as ModModule;
      return void setModuleState(b, m, d.v as ModState, waiting(m));
    }
    if (d.item) {
      const i = find(d.item, d.m as ModModule);
      col = b.closest('.mv-review') ? 'review' : (d.m as string);
      if (i) select(i, d.m as ModModule);
      return;
    }
    if (d.more) {
      const i = find(d.more, d.m as ModModule);
      if (i) removeMenu(b, i, d.m as ModModule);
      return;
    }
    if (d.allow) {
      const i = reviews().find((x) => x.interaction_id === d.allow);
      if (i) void allow(b, i);
      return;
    }
    if (d.refuse) {
      const i = reviews().find((x) => x.interaction_id === d.refuse);
      if (i) removeMenu(b, i, 'tts', { refuse: true });
      return;
    }
    if (d.block) {
      const i = reviews().find((x) => x.interaction_id === d.block);
      if (i) blockForm(b, i.viewer_id, i.viewer_display_name, 'tts');
      return;
    }
    if (d.viewer) return openViewer(d.viewer);
    if (d.led) return void openLedgerId(Number(d.led), d.v!);
    if (d.hist) return modJump({ tab: 'journal', sub: 'ix', module: d.hist });
    if (d.restr) return modJump({ tab: 'restrictions', module: d.restr });
    if (b.matches('[data-words]')) return modJump({ tab: 'words' });
    if (d.host !== undefined) return ctx.go({ tab: 'others', module: d.host });
    if (d.purge)
      return void purge(b, d.purge as ModModule, waiting(d.purge as ModModule));
    if (b.matches('[data-stopall]'))
      return void stopAll(b, playing('soundboard'));
    if (b.matches('[data-add]'))
      return raffleAddForm(
        b,
        new Set(
          (ctx.o?.raffle_v2?.round?.entries ?? []).map((x) => x.viewer_id),
        ),
      );
    if (d.out)
      return void raffleAct(
        b,
        {
          action: 'remove_participant',
          viewer_id: d.out,
          reason: 'retiré par la modération',
        },
        `${d.name} retiré de la manche`,
      );
    if (b.matches('[data-quick]')) return quickRound(b);
    if (d.r) return void raffle(b, d.r);
  });
  /** Une manche à la main, cagnotte et durée posées ici ; le lancement selon les réglages reste sur la page Tombola. */
  function quickRound(b: HTMLElement) {
    const el = pop(
      b,
      `<h3>Manche rapide</h3><div class="d-row"><span>Cagnotte</span>${fld('data-q="jackpot" min="0" max="10000000" step="500"', 5000, 'J')}</div><div class="d-row"><span>Durée</span>${fld('data-q="duration_s" min="10" max="3600"', 60, 's')}</div><div class="d-row"><span>Gagnants</span>${fld('data-q="winners" min="1" max="10"', 1)}</div><p class="d-note">Inscription gratuite, cagnotte offerte par la chaîne.</p><button type="button" class="d-btn pri" data-go>Ouvrir la manche</button>`,
      undefined,
      { cls: 'd-form' },
    );
    el.querySelector<HTMLElement>('[data-go]')!.onclick = () => {
      const v = (k: string) =>
        Math.round(
          Number(el.querySelector<HTMLInputElement>(`[data-q="${k}"]`)!.value),
        );
      el.hidePopover();
      void act(
        b,
        {
          action: 'raffle_open',
          jackpot: v('jackpot'),
          duration_s: v('duration_s'),
          winners: v('winners'),
        },
        'Manche ouverte',
      );
    };
  }
  async function raffle(b: HTMLElement, r: string) {
    if (r === 'extend')
      return raffleAct(b, { action: 'extend', seconds: 30 }, '+30 s');
    if (r === 'pause')
      return raffleAct(
        b,
        { action: 'pause', reason: 'pause depuis la modération' },
        'Manche en pause',
      );
    if (r === 'resume')
      return raffleAct(b, { action: 'resume' }, 'Manche reprise');
    if (r === 'draw') {
      const yes = await confirmBox({
        title: 'Tirer maintenant ?',
        body: 'Les inscriptions ferment et le tirage démarre tout de suite.',
        yes: 'Tirer maintenant',
        no: 'Annuler',
        danger: false,
      });
      if (yes)
        await raffleAct(
          b,
          { action: 'draw_now', reason: 'tirage depuis la modération' },
          'Tirage lancé',
        );
    }
    if (r === 'cancel') {
      const yes = await confirmBox({
        title: 'Annuler la manche ?',
        body: 'Personne n’est payé. L’annulation s’affiche sur le stream et dans l’extension.',
        yes: 'Annuler la manche',
        no: 'Garder',
      });
      if (yes)
        await raffleAct(
          b,
          { action: 'cancel', reason: 'annulée depuis la modération' },
          'Manche annulée',
        );
    }
    return undefined;
  }

  return {
    el,
    paint,
    tick,
    closed() {
      sel = null;
      paint();
    },
    key(e) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'ArrowDown' || k === 'j') return (move(0, 1), true);
      if (k === 'ArrowUp' || k === 'k') return (move(0, -1), true);
      if (k === 'ArrowRight') return (move(1, 0), true);
      if (k === 'ArrowLeft') return (move(-1, 0), true);
      const i = selected();
      if (!i || !sel) return false;
      const a = anchorOf();
      if (k === 'l' && pending(i)) return (void allow(a, i), true);
      if (k === 'r' && a && isLive(i) && sel.m !== 'raffle' && sel.m !== 'bonk')
        return (removeMenu(a, i, sel.m, { refuse: pending(i) }), true);
      if (k === 'b' && a)
        return (blockForm(a, i.viewer_id, i.viewer_display_name, sel.m), true);
      if (k === 'v') return (openViewer(i.viewer_id), true);
      return false;
    },
  };
}
