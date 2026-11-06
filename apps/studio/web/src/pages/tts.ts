import {
  clock,
  confirmBox,
  errText,
  esc,
  fld,
  fmt,
  grp,
  hhmm,
  ic,
  keyed,
  numrow,
  page,
  panelBtn,
  patch,
  poller,
  pop,
  pp,
  row,
  run,
  scrub,
  seg,
  stateChip,
  toast,
  copy,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import {
  act,
  marked,
  modGet,
  onModChange,
  openItem,
  pending,
  purge,
  refreshOpenItem,
  removeMenu,
  setModuleState,
  statusText,
  type ModItem,
} from '../mod/mod.js';
import { setNavCount } from '../shell/shell.js';
import { mountScene, type Scene } from './tts-stage.js';

// Le TTS : la scène montre ce que voit OBS, la file se lit et se modère, les prix se règlent sur la règle graduée. Prix et limites
// sont des règles d'économie : on les prépare, puis « Appliquer » les envoie au Core en une fois. Le reste agit tout de suite.

interface Tier {
  min: number;
  max: number | null;
  price: number;
  credit_cost: number;
  cooldown_seconds: number;
}
interface Rules {
  tiers: Tier[];
  max_chars: number;
  max_waiting_global: number;
  max_waiting_weight_ms: number | null;
  transition_gap_ms: number;
  max_per_viewer: number;
}
interface Queue {
  module_state: 'active' | 'paused' | 'disabled';
  current: ModItem | null;
  waiting: ModItem[];
  recent: ModItem[];
  queue_full?: boolean;
  wait_ms?: number;
}
interface Player {
  enabled: boolean;
  ready?: boolean;
  player?: { voices: number; seen_ms_ago: number } | null;
  overlayUrl?: string;
  previewUrl?: string;
  error?: string | null;
}
const STATES = [
  ['active', 'Ouvert'],
  ['paused', 'Pause'],
  ['disabled', 'Fermé'],
] as const;
const COPY_RULES = (r: Rules) => structuredClone(r);
/** La règle : racine carrée, pour lire les premiers paliers sans écraser les longs messages. */
const SCALE = 800;
const chars2x = (c: number) => Math.sqrt(Math.min(c, SCALE) / SCALE) * 100;
const x2chars = (x: number) => Math.round(((x / 100) ** 2 * SCALE) / 10) * 10;
const sum = (l: ModItem[]) =>
  l.reduce((n, w) => n + (w.estimated_duration_ms ?? 0), 0) / 1000;

export function mountTtsPage(root: HTMLElement) {
  const p = page(root, { title: 'TTS', mod: 'tts', panel: true });
  p.body.innerHTML = `<div class="tts">
    <section class="tts-voice">
      <div class="d-scn d-vf" data-scn><span class="d-scn__tag">Source OBS</span><div class="tts-hint" data-z="hint"></div></div>
      <div class="tts-trans" data-z="trans"></div>
      <p class="tts-sub" data-z="sub"></p>
    </section>
    <section class="tts-q" aria-label="File des messages">
      <div class="tts-qhead" data-z="qhead"></div>
      <div class="tts-qlist" data-z="qlist"></div>
      <div class="tts-qfoot" data-z="qfoot"></div>
    </section>
    <section class="tts-tarif" aria-label="Prix selon la longueur">
      <div class="tts-line"><span class="d-lb">Prix selon la longueur</span><span class="d-sp"></span><span data-z="apply"></span></div>
      <form class="tts-line" data-try>
        <label class="d-fld tts-tryin">${ic('chat')}<input type="text" data-test placeholder="Écris un message : la règle montre son prix" aria-label="Message de test" maxlength="2000"></label>
        <span class="tts-read" data-z="read"></span>
        <label class="d-fld tts-cast"><select data-char aria-label="Personnage"></select></label>
        <label class="d-fld tts-cast"><select data-voice aria-label="Voix"></select></label>
        <button class="d-btn" data-readbtn type="submit">${ic('play')}Lire</button>
      </form>
      <div class="tts-rule" data-z="rule"></div>
    </section>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const input = p.body.querySelector<HTMLInputElement>('[data-test]')!;
  const charSel = p.body.querySelector<HTMLSelectElement>('[data-char]')!;
  const voiceSel = p.body.querySelector<HTMLSelectElement>('[data-voice]')!;

  let q: Queue | null = null;
  let qError = '';
  let player: Player | null = null;
  let globalPaused = false;
  let saved: Rules | null = null;
  let customized = false;
  let draft: Rules | null = null;
  let tab: 'file' | 'past' = 'file';
  let past: ModItem[] | null = null;
  let words: { id: number; word: string; kind: string }[] | null = null;
  let scene: Scene | null = null;
  let spoken: { interaction_id: string; char: number; phase: string } | null =
    null;
  let testing = false;
  let dragging: number | null = null;
  let studioPlayer: HTMLIFrameElement | null = null;

  void mountScene(p.body.querySelector<HTMLElement>('[data-scn]')!).then(
    (s) => {
      scene = s;
      charSel.innerHTML = s.characters
        .map(
          (c) => `<option value="${esc(c.id)}">${esc(c.displayName)}</option>`,
        )
        .join('');
      fillVoices();
    },
  );
  const fillVoices = () => {
    const c = scene?.characters.find((x) => x.id === charSel.value);
    voiceSel.innerHTML = (c?.voicePool ?? [])
      .map(
        (v) =>
          `<option value="${esc(v.voiceProfileId)}">${esc(scene!.voices[v.voiceProfileId]?.label ?? v.voiceProfileId)}</option>`,
      )
      .join('');
  };
  charSel.addEventListener('change', fillVoices);

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  const tierOf = (n: number) =>
    draft?.tiers.find((t) => n >= t.min && (t.max === null || n <= t.max)) ??
    draft?.tiers.at(-1) ??
    null;
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(saved);

  async function readQueue() {
    try {
      const o = await modGet<{ tts: Queue; global?: { paused?: boolean } }>(
        'overview',
      );
      q = o.tts;
      qError = '';
      globalPaused = !!o.global?.paused;
    } catch (e) {
      qError = errText(e);
    }
    player = await tryGetJson<Player>('/api/tts-lab/status');
    setNavCount('tts', q?.waiting.length ? String(q.waiting.length) : null);
    if (p.panel.isOpen()) paintPanel();
    if (tab === 'past') void readPast();
    refreshOpenItem();
    paint();
  }
  async function readPast() {
    const r = await modGet<{ items: ModItem[] }>(
      'interactions?module=tts&period=stream&limit=60',
    ).catch(() => null);
    past = r?.items ?? past ?? q?.recent ?? [];
    paintQ();
  }
  async function readRules() {
    try {
      const v = await getJson<{ rules: Rules; customized: boolean }>(
        '/api/lab/tts/rules',
      );
      saved = v.rules;
      customized = v.customized;
      if (!draft || !dirty()) draft = COPY_RULES(v.rules);
    } catch (e) {
      toast(errText(e), { bad: true });
    }
    paintRule();
    paintPanel();
  }
  async function readWords() {
    words =
      (await modGet<{ words: typeof words }>('words').catch(() => null))
        ?.words ??
      words ??
      [];
    paintPanel();
  }
  const fast = poller(async () => {
    const id = q?.current?.interaction_id;
    if (!id) return;
    spoken = await tryGetJson('/api/tts-lab/live');
    scene?.follow(
      q?.current as never,
      spoken?.interaction_id === id && spoken.phase === 'speaking'
        ? spoken.char
        : null,
    );
    paintTrans();
    scene?.copySubtitle(z('sub'));
  }, 300);
  const slow = poller(readQueue, 1500);
  onModChange(() => {
    slow.now();
    if (tab === 'past') void readPast();
  });

  // --- Dessin -----------------------------------------------------------------------------------------------------------
  function paintHead() {
    const st = q?.module_state ?? 'active';
    const up = !!player?.ready;
    const seen = !!player?.player && player.player.seen_ms_ago < 5000;
    const chip = !q
      ? stateChip('w', qError || 'Lecture…')
      : globalPaused
        ? stateChip('w', 'Pause globale')
        : !up
          ? stateChip('w', seen ? 'Lecteur sans voix' : 'Lecteur OBS absent')
          : st === 'paused'
            ? stateChip('w', 'En pause')
            : st === 'disabled'
              ? stateChip('off', 'Fermé aux viewers')
              : q.current
                ? stateChip('live', 'À l’antenne')
                : stateChip('', `Prêt · ${player?.player?.voices ?? 0} voix`);
    patch(p.state, chip);
    patch(
      p.actions,
      `<span class="d-lb" style="margin-right:-4px">Viewers</span>${seg('data-state', STATES, st)}${panelBtn(p.panel.isOpen())}`,
    );
  }
  function paintHint() {
    const c = q?.current;
    const up = !!player?.ready;
    z('hint').hidden = !!c || testing;
    patch(
      z('hint'),
      !player
        ? ''
        : !up
          ? `<b>Le lecteur OBS ne répond pas</b><span>Les messages attendent, rien n’est perdu.</span><button type="button" class="d-btn sm" data-open-source>Voir la source</button>`
          : '<span>Personne ne parle pour l’instant.</span>',
    );
  }
  function paintTrans() {
    const c = q?.current;
    const st = q?.module_state ?? 'active';
    const pct =
      c?.delivery?.started_at && c.estimated_duration_ms
        ? Math.min(
            100,
            ((Date.now() - Date.parse(c.delivery.started_at)) /
              c.estimated_duration_ms) *
              100,
          )
        : 0;
    const left = c?.estimated_duration_ms
      ? Math.max(
          0,
          c.estimated_duration_ms / 1000 -
            (pct / 100) * (c.estimated_duration_ms / 1000),
        )
      : 0;
    const prog = p.body.querySelector<HTMLElement>('[data-prog]');
    if (prog && z('trans').dataset.who === (c?.interaction_id ?? '')) {
      prog.style.width = `${pct}%`;
      const time = z('trans').querySelector<HTMLElement>('[data-time]');
      if (time) time.textContent = c ? clock(left) : '';
      return;
    }
    z('trans').dataset.who = c?.interaction_id ?? '';
    z('trans').innerHTML =
      `<button type="button" class="d-play ${st === 'paused' ? 'go' : ''}" data-pp aria-label="${st === 'paused' ? 'Reprendre' : 'Mettre en pause'}" ${st === 'disabled' ? 'disabled' : ''}>${ic(st === 'paused' ? 'play' : 'pause')}</button>
      <button type="button" class="d-btn ghost" data-cut ${c ? '' : 'disabled'}>${ic('skip')}Passer${ic('down')}</button>
      ${c ? `<span class="tts-who">${pp(c.viewer_display_name, 22)}<b>${esc(c.viewer_display_name)}</b></span>` : ''}
      <span class="d-prog"><i data-prog style="width:${pct}%"></i></span>
      <span class="tts-time" data-time>${c ? clock(left) : ''}</span>`;
  }
  const qRow = (i: ModItem, isPast: boolean) => {
    const hits = pending(i) ? (i.review_hits ?? []) : [];
    return {
      key: i.interaction_id,
      html: `<div class="tts-r d-in ${isPast ? 'past' : ''} ${hits.length ? 'watch' : ''}"><button type="button" class="tts-r__m" data-item="${esc(i.interaction_id)}">${pp(i.viewer_display_name, 32)}<b>${esc(i.viewer_display_name)}</b><small>${isPast ? esc(statusText(i)) : hits.length ? '<span class="d-tag warn">À vérifier</span>' : clock((i.estimated_duration_ms ?? 0) / 1000)}</small><p>${marked(i.message ?? i.detail ?? '', hits)}</p></button>${isPast ? '' : `<button type="button" class="d-ib tts-r__x" data-more="${esc(i.interaction_id)}" aria-label="Décider pour ${esc(i.viewer_display_name)}">${ic('more')}</button>`}</div>`,
    };
  };
  const paintQ = () => {
    const w = q?.waiting ?? [];
    const max = draft?.max_waiting_global ?? 0;
    patch(
      z('qhead'),
      `${seg(
        'data-list',
        [
          ['file', `File ${w.length}${max ? `/${max}` : ''}`],
          ['past', 'Déjà lus'],
        ],
        tab,
      )}${tab === 'file' && w.length ? `<span class="tts-time">≈ ${clock(sum(w))}</span>` : ''}`,
    );
    const list = z('qlist');
    if (tab === 'file')
      keyed(
        list,
        w.map((i) => qRow(i, false)),
        `<div class="d-empty">${qError ? esc(qError) : 'La file est vide.'}</div>`,
      );
    else
      keyed(
        list,
        (past ?? q?.recent ?? []).map((i) => qRow(i, true)),
        '<div class="d-empty">Aucun message pendant ce stream.</div>',
      );
    patch(
      z('qfoot'),
      tab === 'file' && w.length > 1
        ? `<button type="button" class="d-btn bad sm" data-purge>${ic('trash')}Vider la file…</button>`
        : '',
    );
  };
  const paintRule = () => {
    if (!draft) return;
    const tiers = draft.tiers;
    const top = Math.max(1, ...tiers.map((t) => t.price));
    const n = Array.from(input.value).length;
    const hit = n ? tierOf(n) : null;
    let html = '';
    tiers.forEach((t, i) => {
      const l = chars2x(t.min - 1);
      const r = t.max === null ? 100 : chars2x(t.max);
      html += `<button type="button" class="tts-seg ${t === hit ? 'hit' : ''}" data-seg="${i}" style="left:${l}%;width:calc(${r - l}% - 3px);--a:${8 + (t.price / top) * 18}%;--hp:${44 + (t.price / top) * 56}%" aria-label="Modifier le palier de ${t.min} à ${t.max ?? 'plus'} caractères"><b>${fmt(t.price)}</b><span>${t.cooldown_seconds} s · ${t.credit_cost} cr</span></button>`;
      if (t.max !== null)
        html += `<button type="button" class="tts-lim ${dragging === i ? 'drag' : ''}" data-lim="${i}" style="left:${r}%" aria-label="Limite du palier : ${t.max} caractères"><span>${t.max}</span></button>`;
    });
    if (n) html += `<i class="tts-mark" style="left:${chars2x(n)}%"></i>`;
    z('rule').innerHTML = html;
    patch(
      z('read'),
      n && hit
        ? `<span><b>${n}</b> car.</span><span><b>${fmt(hit.price)}</b> Jetons</span><span><b>${hit.credit_cost}</b> cr</span><span>attente <b>${hit.cooldown_seconds} s</b></span>`
        : '',
    );
    patch(
      z('apply'),
      dirty()
        ? `<span class="tts-apply"><span class="d-muted">Pas encore appliqué</span><button type="button" class="d-btn ghost sm" data-revert>Annuler</button><button type="button" class="d-btn pri sm" data-apply>Appliquer</button></span>`
        : '<span class="d-faint">Tire les limites, clique un palier pour son prix</span>',
    );
  };
  const paintPanel = () => {
    if (!draft) return;
    const d = draft;
    const seen = player?.player && player.player.seen_ms_ago < 5000;
    const url = player?.overlayUrl ?? '';
    p.panel.set(`${grp(
      'File d’attente',
      'layers',
      `${numrow('Messages en attente', fld('data-g="max_waiting_global" min="1"', d.max_waiting_global), 'file max')}
       ${numrow('Durée max en attente', fld('data-g="weight" step="5" min="5" placeholder="aucune"', d.max_waiting_weight_ms === null ? '' : Math.round(d.max_waiting_weight_ms / 1000), 's'), 'expire poids')}
       ${numrow('Délai entre deux TTS', fld('data-g="transition_gap_ms" step="100" min="0"', d.transition_gap_ms, 'ms'), 'pause transition')}
       ${numrow('Simultanés par viewer', fld('data-g="max_per_viewer" min="1"', d.max_per_viewer), 'limite')}`,
    )}
    ${grp('Message', 'chat', numrow('Longueur maximale', fld('data-g="max_chars" step="50" min="1"', d.max_chars, 'car'), 'caractères'))}
    ${grp(
      'Source OBS',
      'eye',
      `${row('Lecteur', stateChip(player?.ready ? '' : 'w', player?.ready ? `Prêt, ${player.player?.voices ?? 0} voix` : seen ? 'Sans voix' : 'Absent'), 'voix')}
       <div class="d-row col" data-k="adresse url source navigateur obs"><label class="d-fld"><input type="text" readonly value="${esc(url)}" aria-label="Adresse de la source OBS"></label><button type="button" class="d-btn sm" data-copy>${ic('copy')}Copier l’adresse</button><small>Navigateur 1920 × 1080, fond transparent. Un seul lecteur à la fois.</small></div>
       ${row('Lire dans Studio', `<button type="button" class="d-btn sm" data-here ${seen && !studioPlayer ? 'disabled title="Une source OBS est déjà connectée"' : ''}>${studioPlayer ? 'Arrêter' : 'Démarrer'}</button>`, 'lecteur aperçu test')}`,
      'source lecteur',
    )}
    ${grp(
      'Mots surveillés',
      'eye',
      `<div class="d-row col" data-k="mots surveillés bloqués liste vérifier"><div class="d-tags">${(words ?? []).map((w) => `<button type="button" class="d-tag ${w.kind === 'block' ? 'bad' : 'warn'}" data-word="${w.id}" title="Retirer « ${esc(w.word)} »">${esc(w.word)} ${ic('x')}</button>`).join('') || '<span class="d-faint">Aucun mot.</span>'}</div>
       <form class="tts-wordform" data-wordform><label class="d-fld"><input type="text" data-newword maxlength="40" placeholder="Ajouter un mot" aria-label="Nouveau mot"></label>${seg(
         'data-wkind',
         [
           ['watch', 'À vérifier'],
           ['block', 'Bloqué'],
         ],
         wordKind,
       )}<button class="d-ib" aria-label="Ajouter le mot">${ic('plus')}</button></form>
       <small>À vérifier : le message attend ta décision. Bloqué : le Core le refuse.</small></div>`,
      'mots',
    )}
    ${grp('Valeurs', 'hist', `<div class="d-row" data-k="restaurer défaut origine"><span>${customized ? 'Valeurs personnalisées' : 'Valeurs d’origine'}</span><button type="button" class="d-btn sm" data-reset ${customized ? '' : 'disabled'}>Restaurer</button></div>`)}`);
  };
  let wordKind = 'watch';
  function paint() {
    paintHead();
    paintHint();
    paintTrans();
    paintQ();
    paintRule();
    scene?.follow(q?.current as never, null);
  }

  // --- Interaction ------------------------------------------------------------------------------------------------------
  const findItem = (id: string) =>
    [
      ...(q?.waiting ?? []),
      ...(q?.current ? [q.current] : []),
      ...(past ?? []),
      ...(q?.recent ?? []),
    ].find((i) => i.interaction_id === id);
  const castInfo = (i: ModItem) => {
    if (!i.cast) return '';
    const c = scene?.characters.find((x) => x.id === i.cast!.character_id);
    const v = scene?.voices[i.cast.voice_profile_id];
    return `<dt>Personnage</dt><dd>${esc(c?.displayName ?? i.cast.character_id)}</dd><dt>Voix</dt><dd>${esc(v?.label ?? i.cast.voice_profile_id)}</dd><dt>Durée estimée</dt><dd>${clock((i.estimated_duration_ms ?? 0) / 1000)}</dd>${i.channel_sequence ? `<dt>Ordre</dt><dd>n° ${i.channel_sequence}</dd>` : ''}${i.delivery?.started_at ? `<dt>Lu à</dt><dd>${hhmm(i.delivery.started_at)}</dd>` : ''}`;
  };
  async function applyRules(btn: HTMLElement | null) {
    if (!draft || !saved) return;
    const before = COPY_RULES(saved);
    const rules = draft;
    const ok = await run(btn, () => postJson('/api/lab/tts/rules', { rules }));
    if (!ok) return;
    toast('Appliqué aux prochains achats', {
      undo: () =>
        void run(
          null,
          () => postJson('/api/lab/tts/rules', { rules: before }),
          'Valeurs précédentes rétablies',
        ).then(() => {
          draft = null;
          void readRules();
        }),
    });
    draft = null;
    await readRules();
  }
  const clampLimits = (d: Rules) => {
    d.tiers.forEach((t, k) => {
      t.min = k ? d.tiers[k - 1]!.max! + 1 : 1;
    });
    d.tiers.at(-1)!.max = null;
  };
  function editSeg(b: HTMLElement, i: number) {
    if (!draft) return;
    const d = draft;
    const t = d.tiers[i]!;
    const html = `<div class="d-form"><h3>${t.min} à ${t.max ?? '∞'} caractères</h3>
      <div class="d-row"><span>Prix</span>${fld('data-e="price" step="250" min="0"', t.price, 'J')}</div>
      <div class="d-row"><span>Crédits TTS</span>${fld('data-e="credit_cost" min="0"', t.credit_cost, 'cr')}</div>
      <div class="d-row"><span>Attente du viewer</span>${fld('data-e="cooldown_seconds" step="15" min="0"', t.cooldown_seconds, 's')}</div>
      <div style="display:flex;justify-content:space-between"><button type="button" class="d-btn ghost sm" data-split ${d.tiers.length >= 12 ? 'disabled' : ''}>${ic('plus')}Couper en deux</button><button type="button" class="d-btn bad sm" data-del ${d.tiers.length < 2 ? 'disabled' : ''}>Retirer</button></div></div>`;
    pop(b, html, (el) => {
      el.addEventListener('input', (e) => {
        const f = (e.target as HTMLInputElement).dataset.e as
          keyof Tier | undefined;
        if (f) {
          (t[f] as number) = Number((e.target as HTMLInputElement).value);
          paintRule();
        }
      });
      el.addEventListener('click', (e) => {
        const x = (e.target as HTMLElement).closest<HTMLElement>('button');
        if (x?.matches('[data-del]')) {
          d.tiers.splice(i, 1);
          clampLimits(d);
          el.hidePopover();
          paintRule();
        }
        if (x?.matches('[data-split]')) {
          const mid = t.max
            ? Math.max(t.min, Math.round((t.min + t.max) / 20) * 10)
            : t.min + 200;
          d.tiers.splice(i, 0, { ...t, max: mid });
          clampLimits(d);
          el.hidePopover();
          paintRule();
        }
      });
    });
  }

  // Tirer une limite de palier.
  let drag: { i: number; box: DOMRect } | null = null;
  p.body.addEventListener('pointerdown', (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>('[data-lim]');
    if (!h) return;
    e.preventDefault();
    drag = { i: Number(h.dataset.lim), box: z('rule').getBoundingClientRect() };
    dragging = drag.i;
    z('rule').setPointerCapture(e.pointerId);
    paintRule();
  });
  p.body.addEventListener('pointermove', (e) => {
    if (!drag || !draft) return;
    const t = draft.tiers[drag.i]!;
    const next = draft.tiers[drag.i + 1];
    const x = ((e.clientX - drag.box.left) / drag.box.width) * 100;
    const v = Math.min(next?.max ?? SCALE, Math.max(t.min, x2chars(x)));
    if (v !== t.max) {
      t.max = v;
      if (next) next.min = v + 1;
      paintRule();
    }
  });
  p.body.addEventListener('pointerup', () => {
    drag = null;
    dragging = null;
    paintRule();
  });
  p.body.addEventListener('keydown', (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>('[data-lim]');
    if (!h || !draft || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = Number(h.dataset.lim);
    const t = draft.tiers[i]!;
    const v = (t.max ?? 0) + (e.key === 'ArrowRight' ? 10 : -10);
    if (v >= t.min && v < (draft.tiers[i + 1]?.max ?? Infinity)) {
      t.max = v;
      draft.tiers[i + 1]!.min = v + 1;
      paintRule();
      p.body.querySelector<HTMLElement>(`[data-lim="${i}"]`)?.focus();
    }
  });

  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    const st = b?.dataset.state as 'active' | 'paused' | 'disabled' | undefined;
    if (st) return void setModuleState(b!, 'tts', st, q?.waiting ?? []);
    if (b?.matches('[data-pp]'))
      return void setModuleState(
        b,
        'tts',
        q?.module_state === 'paused' ? 'active' : 'paused',
        q?.waiting ?? [],
      );
    if (b?.matches('[data-cut]') && q?.current)
      return removeMenu(b, q.current, 'tts');
    const list = b?.dataset.list as 'file' | 'past' | undefined;
    if (list) {
      tab = list;
      if (list === 'past') void readPast();
      return paintQ();
    }
    const id = t.closest<HTMLElement>('[data-item]')?.dataset.item;
    if (id) {
      const i = findItem(id);
      if (i) openItem(i, 'tts', castInfo);
      return;
    }
    const more = b?.dataset.more;
    if (more) {
      const i = findItem(more);
      if (i) removeMenu(b!, i, 'tts');
      return;
    }
    if (b?.matches('[data-purge]'))
      return void purge(b, 'tts', q?.waiting ?? []);
    if (b?.matches('[data-open-source]')) return p.panel.open('source');
    const seg0 = b?.dataset.seg;
    if (seg0 !== undefined && !drag) return editSeg(b!, Number(seg0));
    if (b?.matches('[data-apply]')) return void applyRules(b);
    if (b?.matches('[data-revert]')) {
      draft = saved && COPY_RULES(saved);
      paintRule();
      paintPanel();
      return;
    }
    if (b?.matches('[data-copy]'))
      return copy(player?.overlayUrl ?? '', 'Adresse copiée');
    if (b?.matches('[data-here]')) return toggleStudioPlayer();
    if (b?.dataset.wkind) {
      wordKind = b.dataset.wkind;
      return paintPanel();
    }
    const word = b?.dataset.word;
    if (word) {
      void act(
        b!,
        { action: 'remove_word', word_id: Number(word) },
        'Mot retiré',
      ).then(readWords);
      return;
    }
    if (b?.matches('[data-reset]')) {
      void confirmBox({
        title: 'Restaurer les valeurs d’origine ?',
        body: 'Prix, paliers et limites du TTS reviennent aux valeurs d’origine pour les prochains achats.',
        yes: 'Restaurer',
      }).then((yes) => {
        if (!yes) return;
        void run(
          b,
          () => postJson('/api/lab/tts/rules/reset', {}),
          'Valeurs d’origine restaurées',
        ).then(() => {
          draft = null;
          void readRules();
        });
      });
    }
  });
  p.root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target as HTMLElement;
    if (f.matches('[data-wordform]')) {
      const w = f.querySelector<HTMLInputElement>('[data-newword]')!;
      if (w.value.trim())
        void act(
          null,
          { action: 'add_word', word: w.value.trim(), kind: wordKind },
          'Mot ajouté',
        ).then(readWords);
      return;
    }
    const btn = f.querySelector<HTMLElement>('[data-readbtn]')!;
    if (testing) {
      scene?.stopTest();
      return;
    }
    const message = input.value.trim();
    if (!message || !scene) return input.focus();
    testing = true;
    btn.innerHTML = `${ic('stop')}Arrêter`;
    paintHint();
    void scene.tryRead(
      {
        pseudo: 'Essai',
        message,
        character: charSel.value,
        voice: voiceSel.value,
      },
      () => {
        testing = false;
        btn.innerHTML = `${ic('play')}Lire`;
        paintHint();
      },
    );
  });
  input.addEventListener('input', paintRule);
  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const g = t.dataset.g;
    if (!g || !draft) return;
    if (g === 'weight')
      draft.max_waiting_weight_ms =
        t.value.trim() === '' ? null : Number(t.value) * 1000;
    else (draft as unknown as Record<string, number>)[g] = Number(t.value);
    paintRule();
    paintQ();
  });
  scrub(p.root, (i) => i.dispatchEvent(new Event('input', { bubbles: true })));

  /** Lecteur dans Studio : quand aucune source OBS n'est là. C'est le vrai lecteur, invisible : la scène le suit. */
  function toggleStudioPlayer() {
    if (studioPlayer) {
      studioPlayer.remove();
      studioPlayer = null;
      paintPanel();
      return;
    }
    if (!player?.previewUrl)
      return toast('Lecteur indisponible', { bad: true });
    const f = document.createElement('iframe');
    f.title = 'Lecteur TTS dans Studio';
    f.className = 'tts-here';
    f.src = player.previewUrl;
    f.addEventListener('load', () => {
      setTimeout(
        () => f.contentDocument?.querySelector<HTMLElement>('#enable')?.click(),
        300,
      );
    });
    p.root.append(f);
    studioPlayer = f;
    paintPanel();
  }

  return {
    setVisible(v: boolean) {
      if (v) {
        slow.start();
        fast.start();
        void readRules();
        void readWords();
      } else {
        slow.stop();
        fast.stop();
        scene?.stopTest();
      }
    },
  };
}
