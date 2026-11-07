import {
  clock,
  confirmBox,
  copy,
  drawer,
  errText,
  esc,
  hhmm,
  ic,
  keyed,
  menu,
  page,
  panelBtn,
  patch,
  poller,
  pop,
  pp,
  run,
  scrub,
  stateChip,
  toast,
} from '../ds/ds.js';
import {
  blockMenu,
  onModChange,
  openViewer,
  raffleAdd,
  searchViewers,
  setModuleState,
  type SearchHit,
} from '../mod/mod.js';
import { setNavCount } from '../shell/shell.js';
import {
  addBand,
  bandProblems,
  parseNumber,
  removeBand,
  type BandsDraft,
} from '../tombola-bands.js';
import { mountArena } from './tombola-arena.js';
import {
  mountHistory,
  openFiche,
  openHistoryDrawer,
  refreshFiche,
  retryPayout,
  winnerState,
} from './tombola-history.js';
import {
  ACTIVE,
  api,
  cmdProblem,
  DRAWN,
  ERRORS,
  nextRoundLook,
  normCmd,
  pickCurrency,
  reward,
  type Card,
  type CmdList,
  type Config,
  type Entry,
  type HistoryItem,
  type Round,
  type Snapshot,
  type Status,
} from './tombola-model.js';
import { panelHtml } from './tombola-panel.js';
import { mountStage } from './tombola-stage.js';
import { leftText, ticketHtml } from './tombola-ticket.js';

// La Tombola : on prépare le ticket en voyant le résultat sur le vrai overlay, on détache le talon, les inscrits arrivent dans
// l'arène, le tirage les départage. Le Core décide et garde tout (manche, phases, gagnants, paiements, audit) : cette page lit
// /api/raffle/* et n'envoie que des intentions. La configuration est toujours envoyée entière, le Core la valide.

type Slot = 'normal' | 'super' | 'giveaway';
/** Le résultat reste à l’écran une minute après la fin de la manche, puis la préparation revient seule. */
const AUTO_BACK_MS = 60_000;
const FOCUS_KEYS = [
  'cfg',
  'band',
  'bandDel',
  'draft',
  'display',
  'label',
  'schedMin',
  'hintIn',
  'cmdEditIn',
  'cmdAddIn',
];
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const setPath = (c: Config, path: string, v: unknown) => {
  const keys = path.split('.');
  let o = c as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys.at(-1)!] = v;
};
const NUMERIC = new Set([
  'fixed_amount',
  'duration_s',
  'winners_custom',
  'full.chance_pct',
  'super.jackpot',
  'super.one_in',
]);

export function mountTombolaPage(root: HTMLElement) {
  const p = page(root, {
    title: 'Tombola',
    mod: 'tombola',
    panel: true,
    folded: [
      'Instruction à l’écran',
      'Nom et textes',
      'Durées sur l’overlay',
      'Résultat dans l’extension',
      'Sons d’ouverture',
      'Stream',
      'Source OBS',
      'Accès des viewers',
    ],
  });
  p.body.innerHTML = `<div class="tb-state" data-z="state"></div>
  <div class="tb" data-z="prep" hidden>
    <div class="tb-l">
      <section class="tb-ticket" data-z="ticket" aria-label="Préparer la prochaine manche"></section>
      <div class="tb-scene"><div class="d-scn d-vf" data-prepscn><span class="d-scn__tag" data-z="preptag">Sur le stream</span></div></div>
    </div>
    <section class="tb-night" aria-label="Historique"><div class="tb-nhead"><span class="d-lb">Historique</span></div><div class="tb-hbox" data-z="hist"></div></section>
  </div>
  <div class="tb-live" data-z="live" hidden>
    <section class="tb-arena" data-z="arena" aria-label="Participants"></section>
    <section class="tb-aside">
      <div class="d-scn d-vf" data-livescn><span class="d-scn__tag">Sur le stream</span><button type="button" class="d-ib tb-cmp" data-compare aria-label="Comparer avec l’extension" title="Comparer avec l’extension">${ic('ext')}</button></div>
      <div class="tb-feedbox" data-z="result"></div>
      <div class="tb-feedbox tb-grow"><div class="tb-feedh" data-z="feedh"></div><div class="tb-srcbar" data-z="srcbar"></div><div class="tb-feed" data-z="feed"></div></div>
      <form class="tb-add" data-add hidden><div class="tb-addres" data-z="addres"></div><label class="d-fld">${ic('plus')}<input type="text" data-addq placeholder="Ajouter un viewer" aria-label="Ajouter un viewer" autocomplete="off"></label></form>
    </section>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  const stagePrep = mountStage(
    p.body.querySelector<HTMLElement>('[data-prepscn]')!,
    1.7,
  );
  const stageLive = mountStage(
    p.body.querySelector<HTMLElement>('[data-livescn]')!,
    2.8,
  );
  const arena = mountArena(z('arena'));
  const hist = mountHistory(z('hist'), openFiche);

  let visible = false;
  let st: Status | null = null;
  let error = '';
  /** La configuration à l'écran, et la dernière que le Core a acceptée. */
  let cfg: Config | null = null;
  let saved: Config | null = null;
  let snap: Snapshot | null = null;
  let readAt = 0;
  let card: Card | null = null;
  let history: HistoryItem[] = [];
  let reads = 0;
  /** La manche finie reste à l'écran jusqu'à « Terminer » : le Core, lui, l'a déjà rangée. */
  let held: Round | null = null;
  let dismissed: string | null = null;
  /** Quand la manche montrée a quitté le Core (terminée) : le résultat reste affiché AUTO_BACK_MS, puis la préparation revient. */
  let endedAt = 0;
  let bands: BandsDraft | null = null;
  let editing: { list: CmdList; i: number } | null = null;
  const cmdErr: Record<CmdList, string> = {
    join_commands: '',
    cancel_commands: '',
  };
  let preview: { audio: HTMLAudioElement; slot: string } | null = null;
  let hintText: string | null = null;
  let asSuper = false;
  let lookSig = '';
  let saving = 0;
  let gen = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let found: SearchHit[] = [];
  let findTimer: ReturnType<typeof setTimeout> | undefined;

  const typing = (el: HTMLElement) => {
    const a = document.activeElement as HTMLElement | null;
    return (
      !!a &&
      el.contains(a) &&
      a.matches('input:not([type="range"],[type="file"]),textarea')
    );
  };
  /** Réécrit une zone en gardant le champ actif ; une saisie en cours n'est jamais écrasée par un relevé. */
  function keep(el: HTMLElement, force: boolean, write: () => void) {
    if (typing(el) && !force) return;
    const a = document.activeElement as HTMLElement | null;
    const k =
      a && el.contains(a)
        ? FOCUS_KEYS.find((x) => a.dataset[x] !== undefined)
        : null;
    const sel = k ? `[data-${kebab(k)}="${a!.dataset[k]}"]` : null;
    write();
    if (sel) el.querySelector<HTMLElement>(sel)?.focus();
  }

  // --- La manche à l'écran ------------------------------------------------------------------------------------------------
  const running = () => {
    const r = snap?.round ?? null;
    return r && r.raffle_id !== dismissed ? r : null;
  };
  /** La manche montrée, enrichie de ce que dit sa fiche une fois sortie de l'instantané. */
  const shown = (): Round | null => {
    const r = running();
    if (r) return r;
    if (!held) return null;
    return {
      ...held,
      status: card?.status ?? 'finished',
      outcome: card?.outcome ?? held.outcome,
      reveal: { is_full: !!card?.is_full },
    };
  };
  const leftMs = (r: Round) =>
    Math.min(
      r.duration_ms,
      Math.max(
        0,
        r.remaining_ms - (r.status === 'paused' ? 0 : Date.now() - readAt),
      ),
    );
  const roundTitle = (r: Round, s: 'open' | 'paused' | 'cancelled') =>
    (r.titles?.[s] ?? []).join(' ').trim();

  // --- Lectures -----------------------------------------------------------------------------------------------------------
  async function readHistory() {
    const h = await api<{ items: HistoryItem[] }>('/history').catch(() => null);
    if (h) history = h.items ?? [];
  }
  async function read() {
    const g = gen;
    try {
      const [status, snapshot] = await Promise.all([
        api<Status>('/status'),
        api<Snapshot>('/snapshot'),
      ]);
      error = '';
      st = status;
      snap = snapshot;
      readAt = Date.now();
      if (g === gen && !saving) {
        saved = status.config;
        if (!cfg || !typing(p.root)) cfg = structuredClone(status.config);
      }
    } catch (e) {
      error = errText(e, ERRORS);
      return paint();
    }
    const r = snap!.round;
    const ended = !!held && !r;
    if (r && r.outcome !== 'cancelled' && r.raffle_id !== dismissed) held = r;
    const c = shown();
    card = c
      ? await api<Card>(`/rounds/${c.raffle_id}`).catch(() => card)
      : null;
    if (!r && held && card?.status === 'cancelled') held = null;
    // Retour seul à la préparation : rien n'est rejoué ni repayé, la manche reste dans l'historique.
    if (r || !held) endedAt = 0;
    else if (!endedAt) endedAt = Date.now();
    else if (Date.now() - endedAt > AUTO_BACK_MS) {
      dismissed = held.raffle_id;
      held = null;
      card = null;
      endedAt = 0;
    }
    if (reads++ % 5 === 0 || ended) await readHistory();
    refreshFiche();
    stagePrep.load(
      visible ? st!.preview_url.replace('preview=1', 'preview=1&demo=1') : null,
    );
    stageLive.load(visible ? st!.preview_url : null);
    paint();
  }
  const slow = poller(read, 1000);
  const fast = poller(() => tick(), 250);
  onModChange(() => slow.now());

  // --- Dessin ---------------------------------------------------------------------------------------------------------------
  function paintHead(r: Round | null) {
    const m = snap?.module_state ?? 'active';
    const on = !!r && ACTIVE.includes(r.status);
    let chip: string;
    if (!st) chip = stateChip('w', error || 'Lecture…');
    else if (error) chip = stateChip('w', error);
    else if (!r)
      chip = snap?.round
        ? stateChip('', 'Résultat à l’écran')
        : m === 'disabled'
          ? stateChip('off', 'Fermé')
          : m === 'paused'
            ? stateChip('w', 'Inscriptions en pause')
            : stateChip('', 'Prête');
    else if (r.status === 'paused')
      chip = stateChip('w', roundTitle(r, 'paused') || 'Pause');
    else if (on)
      chip =
        leftMs(r) <= 10_000
          ? stateChip('w', 'Dernières secondes')
          : stateChip('live', roundTitle(r, 'open') || 'Inscriptions ouvertes');
    else if (r.status === 'drawing')
      chip = stateChip('live', 'Tirage en cours');
    else if (r.status === 'revealing')
      chip = stateChip('live', 'Révélation sur le stream');
    else if (r.status === 'revealed')
      chip = stateChip('', 'Résultat à l’écran');
    else if (r.status === 'cancelled')
      chip = stateChip('off', roundTitle(r, 'cancelled') || 'Annulée');
    else
      chip = stateChip(
        'off',
        r.outcome === 'no_participants' ? 'Aucun participant' : 'Terminée',
      );
    const tags =
      r && (r.kind === 'super' || r.reveal?.is_full || r.origin === 'automatic')
        ? `<span class="d-tags">${r.kind === 'super' ? '<span class="d-tag gold">Super</span>' : ''}${r.reveal?.is_full ? '<span class="d-tag gold">Full oseille</span>' : ''}${r.origin === 'automatic' ? '<span class="d-tag off">Auto</span>' : ''}</span>`
        : '';
    patch(p.state, `<span class="tb-chip">${chip}${tags}</span>`);
    const done = !!r && [...DRAWN, 'finished'].includes(r.status);
    patch(
      p.actions,
      `${
        on
          ? `<button type="button" class="d-btn bad" data-cancel>Annuler</button><span class="tb-gap"></span><button type="button" class="d-btn" data-extend>+30 s</button>${r!.status === 'paused' ? `<button type="button" class="d-btn" data-resume>${ic('play')}Reprendre</button>` : `<button type="button" class="d-btn" data-pause>${ic('pause')}Pause</button>`}<button type="button" class="d-btn pri" data-draw>Tirer maintenant</button>`
          : done
            ? `${endedAt ? `<span class="d-faint tb-back">Retour à la préparation dans ${Math.max(0, Math.ceil((AUTO_BACK_MS - (Date.now() - endedAt)) / 1000))} s</span>` : ''}<button type="button" class="d-btn pri" data-finish title="Revient à la préparation. Le tirage, les gains et l’historique sont gardés : rien n’est retiré ni rejoué.">Fermer le résultat</button>`
            : ''
      }${r ? `<button type="button" class="d-btn ghost" data-hist>${ic('hist')}Historique</button>` : ''}${panelBtn(p.panel.isOpen())}`,
    );
  }
  const draftOf = (c: Config): BandsDraft =>
    bands ?? {
      step: c.random.step,
      bands: c.random.bands.map((b) => ({ ...b })),
    };
  function paintTicket(force: boolean) {
    if (!st || !cfg) return;
    const c = cfg;
    const live = st.stream
      ? history.filter((h) => h.session_id === st!.stream!.session_id).length +
        1
      : 0;
    keep(z('ticket'), force, () =>
      patch(
        z('ticket'),
        ticketHtml(c, st!, {
          bandsDirty: !!bands,
          onAir: !!snap?.round,
          round: live ? `Manche ${live}` : 'Hors stream',
        }),
      ),
    );
  }
  function paintPanel(force = false) {
    if (!st || !cfg) return;
    const c = cfg;
    keep(p.panel.body, force, () =>
      p.panel.set(
        panelHtml(c, st!, {
          draft: draftOf(c),
          bandsDirty: !!bands,
          editing,
          cmdErr,
          playing: preview?.slot ?? null,
          moduleState: snap?.module_state ?? 'active',
        }),
      ),
    );
    paintHintLines();
  }
  /** Le vrai overlay montre la prochaine manche : rien n'est réécrit tant qu'elle ne change pas. */
  function paintLook() {
    if (!st || !cfg) return;
    const c: Config =
      hintText === null
        ? cfg
        : {
            ...cfg,
            overlay_hint: { ...cfg.overlay_hint, text: hintText },
          };
    const sig = JSON.stringify([c, st.titles, st.currencies, asSuper]);
    if (sig === lookSig) return;
    lookSig = sig;
    const look = nextRoundLook(c, st, asSuper);
    stagePrep.show(look.snapshot);
    z('preptag').textContent = look.example
      ? 'Sur le stream, montant d’exemple'
      : 'Sur le stream';
    setTimeout(paintHintLines, 80);
  }
  function paintHintLines() {
    const el = p.panel.body.querySelector<HTMLElement>('[data-hint-lines]');
    if (!el) return;
    const n = stagePrep.hintLines();
    el.textContent = n
      ? `${n} ligne${n > 1 ? 's' : ''} sur l’overlay.`
      : 'Vide : aucune instruction à l’écran.';
  }
  function paintFeed(r: Round) {
    const list = (card?.entries ?? []).filter((e) => !e.removed_at);
    const n = (s: Entry['source']) => list.filter((e) => e.source === s).length;
    const [ch, ex, mn] = [n('chat'), n('extension'), n('manual')];
    const pct = (v: number) => (list.length ? (v / list.length) * 100 : 0);
    patch(
      z('feedh'),
      `<span class="d-lb">Inscriptions</span><span class="tb-srcs"><span>${ch} chat</span><span class="ext">${ex} extension</span>${mn ? `<span class="man">${mn} ajouté${mn > 1 ? 's' : ''}</span>` : ''}</span>`,
    );
    patch(
      z('srcbar'),
      `<i style="width:${pct(ch)}%"></i><i class="ext" style="width:${pct(ex)}%"></i><i class="man" style="width:${pct(mn)}%"></i>`,
    );
    const before = ACTIVE.includes(r.status);
    keyed(
      z('feed'),
      list
        .slice()
        .reverse()
        .map((e) => ({
          key: e.viewer_id,
          html: `<div class="tb-fr d-in"><button type="button" class="tb-fr__m" data-entry="${esc(e.viewer_id)}" title="Inscrit à ${hhmm(e.created_at)}">${pp(e.display_name, 24, e.avatar_url)}<span>${esc(e.display_name)}</span>${e.source === 'extension' ? '<small class="ext">Extension</small>' : e.source === 'manual' ? `<small class="man">Ajouté</small>` : `<small>${esc(e.command ?? 'Chat')}</small>`}</button></div>`,
        })),
      `<div class="d-empty">${before ? 'En attente des premières inscriptions.' : 'Personne ne s’est inscrit.'}</div>`,
    );
    const form = p.body.querySelector<HTMLElement>('[data-add]')!;
    form.hidden = !before;
    const drawn = DRAWN.includes(r.status);
    const winners = drawn ? (card?.winners ?? []) : [];
    const box = z('result');
    if (winners.length) {
      const c = card!;
      const gold = r.kind === 'super' || !!c.is_full;
      patch(
        box,
        `<div class="tb-feedh"><span class="d-lb">Gagnants</span><span class="tb-srcs"><span class="${gold ? 'gold' : ''}">${r.kind === 'giveaway' ? 'Lot à remettre' : 'Paiement automatique'}</span></span></div><div class="tb-wins">${winners
          .map(
            (w, i) =>
              `<div class="tb-win d-in" style="animation-delay:${i * 90}ms">${pp(w.display_name, 34, c.entries.find((e) => e.viewer_id === w.viewer_id)?.avatar_url)}<span class="tb-cut"><b>${esc(w.display_name)}</b><small class="${gold ? 'gold' : ''}">${r.kind === 'giveaway' ? esc(r.prize ?? 'Lot') : `+ ${esc(reward({ kind: r.kind, amount: w.expected, prize: null, currency: w.currency }))}`}</small></span><span class="tb-wst">${winnerState(w, c.raffle_id)}</span></div>`,
          )
          .join('')}</div>`,
      );
    } else
      patch(
        box,
        r.outcome === 'no_participants'
          ? '<p class="d-note">Aucun participant cette fois : pas de tirage, rien n’est payé. Ce n’est pas une annulation, l’automatique planifie la suivante normalement.</p>'
          : '',
      );
    z('feed').parentElement!.classList.toggle('dim', winners.length > 0);
  }
  /** `force` : après une modification du streamer, on réécrit même si un champ a gardé le focus. */
  function paint(force = false) {
    const r = shown();
    paintHead(r);
    z('state').hidden = !!st;
    if (!st || !cfg) {
      z('prep').hidden = z('live').hidden = true;
      patch(
        z('state'),
        error
          ? `<div class="d-empty">${esc(error)}<br>La Tombola revient dès que ça répond.</div>`
          : '<div class="d-skel tb-skel"></div>',
      );
      return;
    }
    z('prep').hidden = !!r;
    z('live').hidden = !r;
    if (r) {
      arena.paint(r, card);
      paintFeed(r);
    } else {
      paintTicket(force);
      hist.paint(history, st.stream?.session_id ?? null);
      paintLook();
    }
    paintPanel(force);
    tick();
  }
  let navText: string | null = null;
  const nav = (text: string | null) => {
    if (text !== navText) setNavCount('tombola', (navText = text));
  };
  function tick() {
    const r = shown();
    const on = !!r && ACTIVE.includes(r.status);
    if (r) arena.tick(on ? leftMs(r) : 0, r.duration_ms, on);
    nav(r && on ? clock(leftMs(r) / 1000) : null);
    const a = st?.scheduler;
    if (a?.phase === 'running' && a.remaining_ms !== null) {
      const text = leftText(a.remaining_ms - (Date.now() - readAt));
      for (const el of p.root.querySelectorAll<HTMLElement>('[data-left]'))
        if (el.textContent !== text) el.textContent = text;
    }
  }

  // --- Configuration --------------------------------------------------------------------------------------------------------
  const refused = (e: unknown) => {
    const x = e as { code?: string; body?: { message?: string } };
    if (x.code !== 'invalid_config') return errText(e, ERRORS);
    const why = x.body?.message ?? '';
    if (/^currency .* not available/.test(why))
      return ERRORS.currency_unavailable!;
    if (why.includes('minimum interval'))
      return 'L’intervalle minimum dépasse le maximum.';
    return `Réglage refusé${why ? ` : ${why}` : '.'}`;
  };
  /** Enregistre la configuration à l'écran. Les envois restent dans l'ordre : le dernier réglage gagne, aucun clic n'est perdu. */
  function save(done?: () => void) {
    const next = structuredClone(cfg!);
    saving += 1;
    gen += 1;
    chain = chain.then(async () => {
      try {
        await api('/actions', { command: { action: 'config', config: next } });
        saved = next;
        done?.();
      } catch (e) {
        toast(refused(e), { bad: true });
        cfg = structuredClone(saved);
      } finally {
        saving -= 1;
        // Un relevé parti avant la fin de cet envoi porte l'ancienne configuration : on l'ignore.
        gen += 1;
        if (!saving) slow.now();
        paint(true);
      }
    });
  }
  /** Un réglage ordinaire : il agit tout de suite. L'écriture attend que le focus ait fini de bouger. */
  function change(fn: (c: Config) => void) {
    if (!cfg) return;
    fn(cfg);
    save();
    setTimeout(() => paint(true));
  }
  function saveBands() {
    if (!cfg || !bands || bandProblems(bands).length) return;
    const d = bands;
    cfg.random.step = d.step;
    cfg.random.bands = d.bands.map((b) => ({ ...b }));
    save(() => {
      bands = null;
      toast('Tranches enregistrées');
    });
  }
  const showCmdErr = (list: CmdList, text: string) => {
    cmdErr[list] = text;
    const el = p.panel.body.querySelector<HTMLElement>(
      `[data-cmd-err="${list}"]`,
    );
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    }
  };
  function saveCmd(key: string) {
    if (!cfg) return;
    const [list, i] = key.split(':') as [CmdList, string];
    const value = normCmd(
      p.panel.body.querySelector<HTMLInputElement>(
        `[data-cmd-edit-in="${key}"]`,
      )?.value ?? '',
    );
    const problem = cmdProblem(cfg, list, value, Number(i));
    if (problem) return showCmdErr(list, problem);
    editing = null;
    cmdErr[list] = '';
    change((c) => (c[list][Number(i)] = value));
  }
  function addCmd(list: CmdList, input: HTMLInputElement) {
    if (!cfg || !input.value.trim()) return;
    const value = normCmd(input.value);
    const problem = cmdProblem(cfg, list, value);
    if (problem) return showCmdErr(list, problem);
    cmdErr[list] = '';
    change((c) => c[list].push(value));
  }
  function stopPreview() {
    if (preview) {
      preview.audio.pause();
      preview.audio.src = '';
    }
    preview = null;
    paintPanel(true);
  }
  function togglePreview(slot: Slot) {
    const same = preview?.slot === slot;
    stopPreview();
    const s = cfg?.launch_sounds[slot];
    if (s && !same) {
      const a = new Audio(`/raffle-lab/sounds/${s.asset_id}.${s.format}`);
      a.volume = s.volume / 100;
      preview = { audio: a, slot };
      a.addEventListener('ended', () => {
        if (preview?.audio === a) stopPreview();
      });
      void a.play().catch(() => {
        stopPreview();
        toast('Lecture impossible.', { bad: true });
      });
      paintPanel(true);
    }
  }
  function compare() {
    const d = drawer({
      kicker: 'Tombola',
      title: 'Ce que voit un viewer',
      body: `<iframe class="tb-extf" title="Extension, vue d’un viewer" src="/ext/panel.html?anchor=panel&mode=viewer&platform=web&state=released&language=fr&locale=fr-FR&labRole=viewer&labIdentity=1&demoModule=raffle_join"></iframe><p class="d-note">L’extension montre le résultat après la fin de l’animation sur l’overlay, plus le décalage réglé (${cfg?.display.stream_margin_s ?? 0} s). L’aperçu de Studio n’a pas le retard du stream Twitch : le calibrage final se fait en regardant le vrai stream.</p>`,
    });
    d.el.classList.add('tb-fiche');
  }

  // --- Commandes de la manche -----------------------------------------------------------------------------------------------
  const command = (
    btn: HTMLElement | null,
    c: Record<string, unknown>,
    done?: string,
    more: Record<string, string> = {},
  ) =>
    run(btn, () => api('/actions', { command: c }), done, {
      ...ERRORS,
      ...more,
    }).then((ok) => {
      slow.now();
      return ok;
    });
  async function launch(btn: HTMLElement) {
    const stub = p.body.querySelector<HTMLElement>('[data-stub]');
    stub?.classList.add('torn');
    const ok = await command(btn, {
      action: 'launch',
      kind: btn.dataset.launch,
    });
    if (ok) {
      dismissed = null;
      held = null;
    } else stub?.classList.remove('torn');
  }
  async function cancelRound(btn: HTMLElement) {
    const yes = await confirmBox({
      title: 'Annuler la Tombola en cours ?',
      body: `Les inscriptions sont fermées, personne n’est payé. L’overlay affiche l’annulation quelques secondes, puis disparaît. Possible aussi depuis Modération et en chat avec ${cfg?.cancel_commands[0] ?? '!annuletombola'}.`,
      yes: 'Annuler la Tombola',
      no: 'Continuer la Tombola',
    });
    if (yes)
      await command(btn, { action: 'cancel', reason: 'annulée depuis Studio' });
  }
  async function addViewer(v: { viewer_id: string; display_name: string }) {
    await raffleAdd(null, v.viewer_id, v.display_name);
    found = [];
    const q = p.body.querySelector<HTMLInputElement>('[data-addq]')!;
    q.value = '';
    q.focus();
    paintFound();
  }
  function paintFound() {
    patch(
      z('addres'),
      found
        .map(
          (v) =>
            `<button type="button" class="tb-found" data-add-viewer="${esc(v.viewer_id)}" data-name="${esc(v.display_name)}">${pp(v.display_name, 20)}<span>${esc(v.display_name)}</span>${v.restriction === 'block' ? '<small class="d-tag bad">Bloqué</small>' : ''}</button>`,
        )
        .join(''),
    );
  }
  function entryMenu(b: HTMLElement, id: string) {
    const e = card?.entries.find((x) => x.viewer_id === id);
    if (!e) return;
    const before = ACTIVE.includes(shown()?.status ?? '');
    menu(b, esc(e.display_name), [
      before && {
        label: 'Retirer de la manche',
        icon: 'trash',
        kind: 'bad',
        run: () =>
          void command(
            b,
            {
              action: 'remove_participant',
              viewer_id: id,
              reason: 'retiré depuis Studio',
            },
            `${e.display_name} retiré de la manche`,
          ),
      },
      {
        label: 'Bloquer de la Tombola',
        icon: 'ban',
        run: () => blockMenu(b, id, e.display_name, 'raffle'),
      },
      { label: 'Fiche du viewer', icon: 'user', run: () => openViewer(id) },
    ]);
  }
  function winnersTable(b: HTMLElement) {
    pop(
      b,
      `<div class="d-form"><h3>Gagnants selon la salle</h3><dl class="d-kv">${st!.winners_table
        .map(
          (r) =>
            `<dt>${r.participants} inscrits</dt><dd>${r.min === r.max ? r.min : `${r.min} à ${r.max}`} gagnant${r.max > 1 ? 's' : ''}</dd>`,
        )
        .join(
          '',
        )}</dl><p class="d-note">Même gain pour chacun, arrondi au jeton supérieur.</p></div>`,
    );
  }

  // --- Écouteurs ------------------------------------------------------------------------------------------------------------
  p.root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    if (d.launch) return void launch(b);
    if (b.matches('[data-cancel]')) return void cancelRound(b);
    if (b.matches('[data-extend]'))
      return void command(b, { action: 'extend', seconds: 30 }, '+30 s');
    if (b.matches('[data-pause]')) return void command(b, { action: 'pause' });
    if (b.matches('[data-resume]'))
      return void command(b, { action: 'resume' });
    if (b.matches('[data-draw]'))
      return void command(b, { action: 'draw_now' });
    if (b.matches('[data-finish]')) {
      dismissed = shown()?.raffle_id ?? null;
      held = null;
      card = null;
      endedAt = 0;
      void readHistory().then(() => paint());
      return paint();
    }
    if (b.matches('[data-hist]'))
      return openHistoryDrawer(history, st?.stream?.session_id ?? null);
    if (b.matches('[data-compare]')) return compare();
    if (b.matches('[data-copy]'))
      return copy(st?.overlay_url ?? '', 'Adresse copiée');
    if (b.matches('[data-wintable]')) return winnersTable(b);
    if (d.open) return p.panel.open(d.open);
    if (d.entry) return entryMenu(b, d.entry);
    if (b.classList.contains('tb-ava')) return entryMenu(b, d.id!);
    if (d.retry) {
      const [raffle, viewer] = d.retry.split(':');
      return void retryPayout(b, raffle!, viewer!).then(() => slow.now());
    }
    if (d.addViewer)
      return void addViewer({
        viewer_id: d.addViewer,
        display_name: d.name!,
      });
    if (d.stream)
      return void command(b, {
        action: d.stream === 'start' ? 'stream_start' : 'stream_end',
      });
    if (d.sched)
      return void command(b, {
        action: d.sched === 'pause' ? 'scheduler_pause' : 'scheduler_resume',
      });
    if (d.state)
      return void setModuleState(
        b,
        'raffle',
        d.state as 'active' | 'paused' | 'disabled',
      );
    // Configuration.
    if (d.cur) return change((c) => pickCurrency(c, d.cur!));
    if (d.mode)
      return change((c) => (c.amount_mode = d.mode as Config['amount_mode']));
    if (d.fixed) return change((c) => (c.fixed_amount = Number(d.fixed)));
    if (d.dur) return change((c) => (c.duration_s = Number(d.dur)));
    if (d.win)
      return change((c) => (c.winners_mode = d.win as Config['winners_mode']));
    if (b.matches('[data-band-add]') && cfg) {
      bands = addBand(draftOf(cfg));
      return paint(true);
    }
    if (d.bandDel && cfg) {
      bands = removeBand(draftOf(cfg), Number(d.bandDel));
      return paint(true);
    }
    if (d.bands === 'save') return saveBands();
    if (d.bands === 'cancel') {
      bands = null;
      return paint(true);
    }
    if (d.hint)
      return change(
        (c) => (c.overlay_hint.mode = d.hint as Config['overlay_hint']['mode']),
      );
    if (d.hfont)
      return change(
        (c) =>
          (c.overlay_hint.style.font =
            d.hfont as Config['overlay_hint']['style']['font']),
      );
    if (d.hstyle) {
      const [k, v] = d.hstyle.split(':') as [string, string | undefined];
      return change((c) => {
        const s = c.overlay_hint.style;
        if (k === 'bold' || k === 'italic') s[k] = !s[k];
        else if (k === 'color' || k === 'highlight') s[k] = v || null;
      });
    }
    if (d.emoji) {
      const input =
        p.panel.body.querySelector<HTMLInputElement>('[data-hint-in]');
      if (input) {
        const at = input.selectionStart ?? input.value.length;
        const next = `${input.value.slice(0, at)}${d.emoji}${input.value.slice(input.selectionEnd ?? at)}`;
        if (next.length <= 60) {
          input.value = next;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return;
    }
    if (d.lname !== undefined)
      return change((c) => {
        c.labels.event_name = d.lname || null;
        if (d.lname) c.labels.event_gender = d.lgenderSet as 'f' | 'm';
      });
    if (d.lgender)
      return change((c) => (c.labels.event_gender = d.lgender as 'f' | 'm'));
    if (d.schedMode)
      return change(
        (c) => (c.scheduler.mode = d.schedMode as 'fixed' | 'random'),
      );
    if (d.soundPlay) return togglePreview(d.soundPlay as Slot);
    if (d.soundPick)
      return p.panel.body
        .querySelector<HTMLInputElement>(`[data-sound-file="${d.soundPick}"]`)
        ?.click();
    if (d.soundDel) {
      if (preview?.slot === d.soundDel) stopPreview();
      return change((c) => (c.launch_sounds[d.soundDel as Slot] = null));
    }
    if (d.cmdEdit) {
      const [list, i] = d.cmdEdit.split(':') as [CmdList, string];
      editing = { list, i: Number(i) };
      cmdErr[list] = '';
      paint(true);
      return p.panel.body
        .querySelector<HTMLElement>(`[data-cmd-edit-in="${d.cmdEdit}"]`)
        ?.focus();
    }
    if (b.matches('[data-cmd-cancel]')) {
      if (editing) cmdErr[editing.list] = '';
      editing = null;
      return paint(true);
    }
    if (d.cmdSave) return saveCmd(d.cmdSave);
    if (d.cmdMain) {
      const [list, i] = d.cmdMain.split(':') as [CmdList, string];
      cmdErr[list] = '';
      return change((c) => {
        const [x] = c[list].splice(Number(i), 1);
        c[list].unshift(x!);
      });
    }
    if (d.cmdDel) {
      const [list, i] = d.cmdDel.split(':') as [CmdList, string];
      cmdErr[list] = '';
      editing = null;
      return change((c) => {
        if (c[list].length > 1) c[list].splice(Number(i), 1);
      });
    }
  });

  p.root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    const d = t.dataset;
    const v = t.value.trim();
    if (d.sw) return change((c) => setPath(c, d.sw!, t.checked));
    if (d.preset !== undefined)
      return change(
        (c) => (c.scheduler.preset = v as Config['scheduler']['preset']),
      );
    if (d.cfg) {
      if (d.cfg === 'duration_s' && !v) return;
      return change((c) =>
        setPath(c, d.cfg!, NUMERIC.has(d.cfg!) ? parseNumber(v) : v),
      );
    }
    if (d.band && cfg) {
      const [i, k] = d.band.split('.') as [string, 'from' | 'to' | 'pct'];
      const next = draftOf(cfg);
      next.bands[Number(i)]![k] = parseNumber(v);
      bands = next;
      return void setTimeout(() => paint(true));
    }
    if (d.draft === 'step' && cfg) {
      bands = { ...draftOf(cfg), step: parseNumber(v) };
      return void setTimeout(() => paint(true));
    }
    if (d.display) {
      const k = d.display as keyof Config['display'];
      const n = parseNumber(v);
      return change(
        (c) =>
          (c.display[k] =
            k === 'join_feedback_ms' ? Math.round(n * 1000) : Math.round(n)),
      );
    }
    if (d.schedMin) {
      const k = d.schedMin as
        'first_delay_s' | 'interval_s' | 'interval_min_s' | 'interval_max_s';
      return change((c) => (c.scheduler[k] = Math.round(parseNumber(v) * 60)));
    }
    if (d.label) {
      const k = d.label as 'event_name' | 'empty_title' | 'empty_message';
      return change((c) => {
        if (k === 'empty_message')
          c.labels.empty_message = v || 'Aucun participant cette fois !';
        else c.labels[k] = v || null;
      });
    }
    if (d.hintIn !== undefined) {
      hintText = null;
      return change((c) => (c.overlay_hint.text = v));
    }
    if (d.hcolor !== undefined)
      return change((c) => (c.overlay_hint.style.color = t.value));
    if (d.soundVol)
      return change(
        (c) => (c.launch_sounds[d.soundVol as Slot]!.volume = Number(v)),
      );
    if (d.soundFile && t.files?.[0]) {
      const slot = d.soundFile as Slot;
      const file = t.files[0];
      void run(
        null,
        async () => {
          const s = await api<NonNullable<Config['launch_sounds'][Slot]>>(
            '/sounds',
            undefined,
            { data: file, name: file.name },
          );
          change(
            (c) =>
              (c.launch_sounds[slot] = {
                ...s,
                volume: c.launch_sounds[slot]?.volume ?? s.volume,
              }),
          );
        },
        `Son importé : ${file.name}`,
        ERRORS,
      );
    }
  });

  p.root.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    const d = t.dataset;
    if (d.soundVol) (t.nextElementSibling as HTMLElement).textContent = t.value;
    if (d.hintIn !== undefined) {
      hintText = t.value;
      const n = p.panel.body.querySelector<HTMLElement>('[data-hint-count]');
      if (n) n.textContent = `${t.value.length}/60`;
      paintLook();
    }
    if (d.cmdAddIn) showCmdErr(d.cmdAddIn as CmdList, '');
    if (d.cmdEditIn) showCmdErr(d.cmdEditIn.split(':')[0] as CmdList, '');
    if (d.addq !== undefined) {
      clearTimeout(findTimer);
      const q = t.value.trim();
      if (!q) {
        found = [];
        return paintFound();
      }
      findTimer = setTimeout(() => {
        void searchViewers(q)
          .then((list) => {
            found = list.slice(0, 5);
            paintFound();
          })
          .catch(() => undefined);
      }, 180);
    }
  });

  p.root.addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (ev.key === 'Enter' && t.dataset.cmdEditIn) {
      ev.preventDefault();
      saveCmd(t.dataset.cmdEditIn);
    } else if (ev.key === 'Escape' && t.dataset.cmdEditIn) {
      editing = null;
      paint(true);
    }
  });
  p.root.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target as HTMLElement;
    const list = f.dataset.cmdForm as CmdList | undefined;
    if (list) return addCmd(list, f.querySelector<HTMLInputElement>('input')!);
    if (f.matches('[data-add]') && found[0]) void addViewer(found[0]);
  });
  // Tirer le libellé d'un réglage numérique : on enregistre au lâcher.
  let scrubbed: HTMLInputElement | null = null;
  scrub(p.root, (i) => (scrubbed = i));
  p.root.addEventListener('pointerup', () => {
    const i = scrubbed;
    scrubbed = null;
    i?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // Survoler « Super » montre la Super Tombola sur la scène.
  p.body.addEventListener('pointerover', (ev) => {
    const on = !!(ev.target as HTMLElement).closest('[data-launch="super"]');
    if (on !== asSuper) {
      asSuper = on;
      paintLook();
    }
  });

  return {
    setVisible(v: boolean) {
      visible = v;
      if (v) {
        slow.start();
        fast.start();
        return;
      }
      slow.stop();
      fast.stop();
      nav(null);
      stagePrep.load(null);
      stageLive.load(null);
      lookSig = '';
      stopPreview();
    },
  };
}
