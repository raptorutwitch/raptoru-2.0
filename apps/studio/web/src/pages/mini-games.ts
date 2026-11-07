import type { MiniGamePlay, MiniGamesState } from '@raptoru/schemas';
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
  stateChip,
  viewersSeg,
  toast,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import { openViewer } from '../mod/mod.js';

// Roulette, Slots et Duels : trois jeux du chat, une table par jeu avec ses mots, sa mise, son délai et ses derniers tirages. Le
// Core tire et paie. L'interrupteur agit tout de suite ; mises et délais sont des règles d'économie : on les prépare, puis
// « Appliquer » les envoie au Core. Chances et gains ne se règlent pas ici, ni ailleurs.

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
interface HostModule {
  id: string;
  status: {
    intention: 'on' | 'off';
    observed: string;
    summary: string;
    reasons: string[];
    activity?: string | null;
  };
}
type Game = 'roulette' | 'slot' | 'duel';

const TABLES: {
  id: Game;
  title: string;
  words: string[];
  settings: [key: string, label: string][];
}[] = [
  {
    id: 'roulette',
    title: 'Roulette',
    words: ['roulette', 'gamble'],
    settings: [
      ['mini_games.roulette_min_bet', 'Mise minimale'],
      ['mini_games.roulette_cooldown_s', 'Délai par viewer'],
    ],
  },
  {
    id: 'slot',
    title: 'Slots',
    words: ['slots', 'slot', 'slotmachine', 'sm', 'smp'],
    settings: [
      ['mini_games.slot_min_bet', 'Mise'],
      ['mini_games.slot_cooldown_s', 'Délai par viewer'],
    ],
  },
  {
    id: 'duel',
    title: 'Duels',
    words: ['duel', 'accept', 'deny', 'cancelduel'],
    settings: [
      ['mini_games.duel_max_bet', 'Mise maximale'],
      ['mini_games.duel_cooldown_s', 'Délai entre deux défis'],
    ],
  },
];

const gainText = (x: MiniGamePlay) =>
  `${x.delta > 0 ? '+' : '−'} ${fmt(Math.abs(x.delta))}`;
const said = (x: MiniGamePlay) =>
  `${x.viewer_display_name} · ${gainText(x)} Jetons · ${hhmm(x.created_at)}`;

function rouletteStrip(plays: MiniGamePlay[]) {
  const top = Math.max(1, ...plays.map((x) => Math.abs(x.delta)));
  return plays.length
    ? `<div class="mg-bars" role="img" aria-label="${plays.filter((x) => x.won).length} gains sur ${plays.length} tirages">${plays
        .slice()
        .reverse()
        .map(
          (x) =>
            `<i class="${x.won ? 'w' : ''}" style="--h:${Math.round(18 + (Math.abs(x.delta) / top) * 82)}%" title="${esc(said(x))}"></i>`,
        )
        .join('')}</div>`
    : '<p class="d-faint">Aucun tirage.</p>';
}
function slotStrip(plays: MiniGamePlay[]) {
  const [last, ...rest] = plays;
  if (!last) return '<p class="d-faint">Aucun tirage.</p>';
  return `<div class="mg-reels ${last.won ? 'won' : ''}" title="${esc(said(last))}">${(last.symbols ?? []).map((s) => `<span>${esc(s)}</span>`).join('')}</div>
    <div class="mg-mini">${rest
      .slice(0, 11)
      .map(
        (x) =>
          `<span class="${x.won ? 'won' : ''}" title="${esc(said(x))}">${esc((x.symbols ?? []).join(''))}</span>`,
      )
      .join('')}</div>`;
}

export function mountMiniGamesPage(root: HTMLElement) {
  const p = page(root, { title: 'Roulette · Slots · Duels' });
  p.body.innerHTML = `<div class="mg">
    <div class="mg-tables">
      <div class="mg-bar"><span class="d-faint" data-z="note">Chances et gains sont fixes.</span><span class="d-sp"></span><span data-z="apply"></span></div>
      ${TABLES.map(
        (t) => `<section class="mg-t" aria-label="${t.title}">
        <header><h2>${t.title}</h2><div class="d-tags">${t.words.map((w) => `<span class="d-tag off">!${w}</span>`).join('')}</div></header>
        <div class="mg-set" data-z="set-${t.id}"></div>
        <div class="mg-res" data-z="res-${t.id}">${t.id === 'duel' ? '<p class="d-faint">Le résultat d’un duel s’annonce dans le chat.</p>' : ''}</div>
      </section>`,
      ).join('')}
    </div>
    <aside class="mg-feed">
      <h2 class="d-lb">Derniers tirages</h2>
      <div class="mg-list d-scroll" data-z="list"></div>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let state: MiniGamesState | null = null;
  let readError = '';
  let host: HostModule | null = null;
  let settings: Setting[] | null = null;
  let draft: Record<string, number> = {};
  let production = false;

  const of = (k: string) => settings?.find((s) => s.key === k);
  const dirty = () =>
    Object.entries(draft).some(([k, v]) => of(k)?.value !== v);

  function paintHead() {
    const s = host?.status;
    patch(
      p.state,
      !state
        ? stateChip(readError ? 'r' : 'w', readError || 'Lecture…')
        : !state.enabled
          ? stateChip('off', 'Fermés aux viewers')
          : s?.observed === 'ready'
            ? stateChip('live', s.summary)
            : stateChip('w', s?.summary ?? 'État inconnu'),
    );
    patch(
      p.actions,
      `${production ? '<span class="d-tag warn">Vrais Jetons</span>' : '<span class="d-tag off">Jetons de test</span>'}<a class="d-btn ghost" href="?p=simulation">${ic('chat')}Essayer dans Simulation</a>
       ${viewersSeg(
         'data-open',
         [
           ['on', 'Ouvert'],
           ['off', 'Fermé'],
         ],
         state?.enabled ? 'on' : 'off',
       ).replaceAll('<button', state ? '<button' : '<button disabled')}`,
    );
  }
  function paintSettings() {
    for (const t of TABLES) {
      const el = z(`set-${t.id}`);
      if (el.contains(document.activeElement)) continue;
      patch(
        el,
        !settings
          ? `<p class="d-note">Réglages illisibles.</p>`
          : t.settings
              .map(([k, label]) => {
                const s = of(k);
                if (!s) return '';
                const v = draft[k] ?? s.value;
                return `<div title="${esc(`De ${fmt(s.min)} à ${fmt(s.max)} · par défaut ${fmt(s.default)}${s.help ? ` · ${s.help}` : ''}`)}">${numrow(label, fld(`data-s="${k}" min="${s.min}" max="${s.max}" step="${s.unit === 's' ? 1 : 10}" aria-label="${esc(s.label)}"`, v, s.unit === 'Jetons' ? 'J' : s.unit))}</div>`;
              })
              .join(''),
      );
    }
  }
  function paintApply() {
    patch(
      z('apply'),
      dirty()
        ? `<span class="mg-apply"><span class="d-muted">Pas encore appliqué</span><button type="button" class="d-btn ghost sm" data-revert>Annuler</button><button type="button" class="d-btn pri sm" data-apply>Appliquer</button></span>`
        : '',
    );
  }
  function paintPlays() {
    const recent = state?.recent ?? [];
    patch(
      z('res-roulette'),
      rouletteStrip(recent.filter((x) => x.game === 'roulette')),
    );
    patch(z('res-slot'), slotStrip(recent.filter((x) => x.game === 'slot')));
    keyed(
      z('list'),
      recent.map((x) => ({
        key: x.message_id,
        html: `<button type="button" class="mg-r d-in" data-viewer="${esc(x.viewer_id)}" aria-label="Fiche de ${esc(x.viewer_display_name)}">${pp(x.viewer_display_name, 26)}
          <span class="mg-r__w"><b>${esc(x.viewer_display_name)}</b><small>${x.game === 'slot' ? esc((x.symbols ?? []).join(' ')) : 'Roulette'} · mise ${fmt(x.bet)}${x.all_in ? ' · tapis' : ''}</small></span>
          <span class="mg-r__g"><b class="d-num ${x.won ? (x.game === 'slot' ? 'gold' : 'win') : ''}">${gainText(x)}</b><small>${hhmm(x.created_at)}</small></span></button>`,
      })),
      `<div class="d-empty">${!state && readError ? esc(readError) : 'Aucun tirage pour l’instant.'}</div>`,
    );
  }

  async function read() {
    const [st, mods, set] = await Promise.all([
      getJson<MiniGamesState>('/api/mini-games/state').catch((e: unknown) => {
        readError = errText(e);
        return null;
      }),
      tryGetJson<{ modules: HostModule[] }>('/api/modules'),
      tryGetJson<{ settings: Setting[] }>('/api/module-settings'),
    ]);
    if (st) {
      state = st;
      readError = '';
    } else state = null;
    host = mods?.modules.find((m) => m.id === 'mini_games') ?? host;
    settings = set?.settings ?? settings;
    paintHead();
    if (!dirty()) paintSettings();
    paintApply();
    paintPlays();
  }
  const tick = poller(read, 2500);

  async function setOpen(enabled: boolean, input: HTMLElement | null) {
    if (
      production &&
      !(await confirmBox({
        title: enabled ? 'Ouvrir les mini-jeux ?' : 'Fermer les mini-jeux ?',
        body: enabled
          ? 'Roulette, Slot et Duel s’ouvrent pour les vrais viewers : vrais Jetons, pendant les lives.'
          : 'Roulette, Slot et Duel se ferment pour les vrais viewers.',
        yes: enabled ? 'Ouvrir' : 'Fermer',
        no: 'Annuler',
      }))
    )
      return paintHead();
    const ok = await run(
      input,
      () => postJson('/api/mini-games/settings', { enabled }),
      undefined,
    );
    if (ok)
      toast(enabled ? 'Mini-jeux ouverts' : 'Mini-jeux fermés', {
        undo: () => void setOpen(!enabled, null),
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
      body: `${changes.map(([k, v]) => `${of(k)!.label} : ${fmt(of(k)!.value)} → ${fmt(v)}`).join(' · ')}. Appliqué aux prochains tirages, ${production ? 'sur le vrai Core' : 'sur le Core du Lab'}.`,
      yes: 'Appliquer',
      no: 'Annuler',
      danger: false,
    });
    if (!yes) return;
    const ok = await run(btn, () => send(changes), undefined, {
      out_of_bounds: 'Valeur hors des bornes.',
      unknown_setting: 'Réglage inconnu.',
    });
    // Refusé : les réglages sont envoyés un par un. Ce qui est passé se relit, le reste reste à l'écran, à corriger.
    if (!ok) return read();
    toast('Appliqué aux prochains tirages', {
      undo: () =>
        void run(
          null,
          () => send(before),
          'Valeurs précédentes rétablies',
        ).then(() => tick.now()),
    });
    draft = {};
    for (const t of TABLES) delete z(`set-${t.id}`).dataset.sig;
    settings = null;
    await read();
  }

  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (b?.dataset.open && (b.dataset.open === 'on') !== !!state?.enabled)
      return void setOpen(b.dataset.open === 'on', null);
    if (b?.dataset.viewer) return openViewer(b.dataset.viewer);
    if (b?.matches('[data-apply]')) return void apply(b);
    if (b?.matches('[data-revert]')) {
      draft = {};
      for (const x of TABLES) delete z(`set-${x.id}`).dataset.sig;
      (document.activeElement as HTMLElement | null)?.blur?.();
      paintSettings();
      paintApply();
    }
  });
  const onInput = (i: HTMLInputElement) => {
    if (!i.dataset.s) return;
    draft[i.dataset.s] = Number(i.value);
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
