import {
  confirmBox,
  copy,
  errText,
  esc,
  fld,
  fmt,
  grp,
  ic,
  keyed,
  menu,
  page,
  panelBtn,
  patch,
  poller,
  row,
  run,
  seg,
  stateChip,
  sw,
  toast,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import { cpBlocker } from '../shell/regie.js';
import {
  ACTION_TYPES,
  actionIcon,
  actionLabel,
  blankAction,
  CP_OFF,
  CP_ON,
  effectItems,
  effectsFact,
  INTERACTIONS,
  isDry,
  isNotable,
  masterChip,
  redemptionRow,
  rewardsView,
  runNowConfirm,
  statusView,
  takeReward,
  textChoices,
  type CpActionView,
  type CpInteraction,
  type CpReward,
  type CpState,
} from './rewards-model.js';

// Récompenses Twitch : chaque récompense de points de chaîne reliée à ce qu'elle déclenche. À gauche les récompenses, au centre le
// fil de la récompense choisie (qui s'édite sur place et se teste), à droite ce qui s'est vraiment passé. L'interrupteur général
// vit dans le Core, coupé par défaut, et demande une confirmation. Un test exécute la règle enregistrée pour de vrai (OBS, sons,
// effets) sur un clic explicite ; « Écouter » reste dans cette fenêtre.

const MAX_STEPS = 5;
const ERRORS = {
  version_conflict: 'Modifiée ailleurs entre-temps : recharge la récompense.',
  invalid_request:
    'Action incomplète : choisis un son, une scène, une source ou un filtre.',
};
interface Draft {
  enabled: boolean;
  actions: CpActionView[];
}
const copyRule = (r: CpReward): Draft =>
  r.rule
    ? {
        enabled: r.rule.enabled,
        actions: r.rule.actions.map((a) => ({ ...a })),
      }
    : { enabled: true, actions: [] };

export function mountRewardsPage(root: HTMLElement) {
  const p = page(root, {
    title: 'Récompenses Twitch',
    mod: 'rewards',
    panel: true,
  });
  p.body.innerHTML = `<div class="rw">
    <div class="rw-pulse" data-z="pulse"></div>
    <section class="rw-list" aria-label="Récompenses">
      <label class="d-fld rw-find">${ic('search')}<input type="search" data-find placeholder="Chercher une récompense" aria-label="Chercher une récompense"></label>
      <div class="rw-rs" data-z="list"></div>
    </section>
    <section class="rw-wire" aria-label="Ce que fait la récompense" data-z="wire"></section>
    <section class="rw-log" aria-label="Historique">
      <div class="rw-loghead" data-z="loghead"></div>
      <div class="rw-hs" data-z="log"></div>
    </section>
    <datalist id="rw-scenes"></datalist><datalist id="rw-sources"></datalist><datalist id="rw-filters"></datalist>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let s: CpState | null = null;
  let error: string | null = null;
  let selected: string | null = null;
  let draft: Draft | null = null;
  /** La règle lue quand le brouillon a été pris : « modifié » se mesure à elle, une règle changée ailleurs se voit au relevé. */
  let base = '';
  let openStep: number | null = null;
  let testInput = '';
  let find = '';
  let conflict = false;
  let logTab: 'all' | 'look' | 'this' = 'all';
  let audio: HTMLAudioElement | null = null;

  const reward = () => s?.rewards.find((r) => r.id === selected) ?? null;
  const dirty = () => !!draft && JSON.stringify(draft) !== base;
  const takeRule = (r: CpReward | null) => {
    draft = r ? copyRule(r) : null;
    base = JSON.stringify(draft);
  };

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  async function read() {
    try {
      s = await getJson<CpState>('/api/channel-points/state');
      error = null;
    } catch (e) {
      error = errText(e);
    }
    const asked = takeReward();
    if (asked && s?.rewards.some((r) => r.id === asked)) pick(asked);
    else if (!selected && s?.rewards.length) pick(s.rewards[0]!.id);
    else if (selected && s && !reward()) {
      selected = null;
      takeRule(null);
      paintWire();
    } else if (reward() && !dirty()) {
      if (JSON.stringify(copyRule(reward()!)) !== base) {
        takeRule(reward());
        paintWire();
      }
    } else if (!reward()) paintWire();
    paint();
  }
  const tick = poller(read, 3000);

  /** Suggestions lues dans OBS (lecture seule) : OBS fermé, la saisie libre reste possible. */
  async function loadLists(scene?: string, source?: string) {
    const qs = new URLSearchParams();
    if (scene) qs.set('scene', scene);
    if (source) qs.set('source', source);
    const l = await tryGetJson<{
      scenes: string[];
      sources: string[];
      filters: string[];
    }>(`/api/channel-points/obs?${qs}`);
    if (!l) return;
    for (const [id, values] of [
      ['rw-scenes', l.scenes],
      ['rw-sources', l.sources],
      ['rw-filters', l.filters],
    ] as const)
      p.body.querySelector(`#${id}`)!.innerHTML = values
        .map((v) => `<option value="${esc(v)}"></option>`)
        .join('');
  }

  // --- Dessin -----------------------------------------------------------------------------------------------------------
  function paintHead() {
    patch(p.state, masterChip(s, error, s && cpBlocker(s)));
    patch(
      p.actions,
      `<span class="d-lb" style="margin-right:-4px">Automatisations</span>${sw(!!s?.settings.enabled, 'data-master', 'Automatisations des points de chaîne', { disabled: !s })}${panelBtn(p.panel.isOpen())}`,
    );
  }
  const paintList = () => {
    if (!s) {
      patch(
        z('list'),
        error ? '' : '<div class="d-skel" style="height:160px"></div>',
      );
      return;
    }
    patch(z('list'), rewardsView(s, selected, find));
  };
  const paintLog = () => {
    const r = reward();
    patch(
      z('loghead'),
      seg(
        'data-log',
        [
          ['all', 'Historique'],
          ['look', 'À voir'],
          ['this', 'Cette récompense'],
        ],
        logTab,
      ),
    );
    if (!s) return;
    const st = s;
    const rows = st.recent.filter((x) =>
      logTab === 'look'
        ? isNotable(x)
        : logTab === 'this'
          ? x.reward.id === r?.id || x.reward.title === r?.title
          : true,
    );
    keyed(
      z('log'),
      rows.map((x) => ({
        key: `${x.source}:${x.redemption_id}`,
        html: redemptionRow(x, st),
      })),
      `<div class="d-empty">${logTab === 'all' ? 'Aucune récompense reçue.' : 'Rien à signaler.'}</div>`,
    );
  };
  const paintPanel = () => {
    const fx = s ? effectsFact(s.effects) : null;
    const tw = s?.twitch;
    p.panel.set(`${grp(
      'Réception Twitch',
      'gift',
      `<div class="d-row col" data-k="twitch réception autorisation lecture seule"><small>Les récompenses viennent de Twitch, en lecture seule : Raptoru ne les valide pas et ne rembourse que celles qu’il a créées. Leurs règles sont celles de Raptoru.</small>${tw?.profile_note ? `<small>${esc(tw.profile_note)}</small>` : ''}</div>`,
    )}
    ${grp(
      'Expirations et remboursements',
      'clock',
      `<div class="d-row col" data-k="expiration délai retard rejoué file obs travaux"><small><b>Actions OBS.</b> Une action non lancée 2 min après l’achat expire. Elle n’est jamais jouée en retard, même quand Studio revient.</small></div>
       <div class="d-row col" data-k="reçue trop tard retard hors live crédits"><small><b>Achat reçu en retard.</b> Plus de 2 min après l’achat, ou hors live : rien n’est exécuté, seuls les crédits sont accordés.</small></div>
       <div class="d-row col" data-k="remboursement rembourser twitch points raptoru"><small><b>Remboursement.</b> Demandé à Twitch une seule fois, si rien de l’achat n’a eu lieu et si la récompense est créée par Raptoru. Les autres ne sont pas remboursables d’ici.</small></div>
       <div class="d-row col" data-k="annulée twitch crédits repris"><small><b>Annulation sur Twitch.</b> Les crédits accordés sont repris, jamais en dessous de 0.</small></div>`,
    )}
    ${grp(
      'Lecteur d’effets',
      'film',
      `${row('État', stateChip((fx?.tone ?? 'w') as '' | 'w', fx?.text.replace('Lecteur d’effets : ', '') ?? 'Absent'), 'lecteur source obs')}
       <div class="d-row col" data-k="adresse url source navigateur"><a class="d-btn sm" href="/?p=effects">Ouvrir Effets et lecteur</a>${s?.effects ? `<button type="button" class="d-btn sm" data-copy>${ic('copy')}Copier l’adresse de la source</button>` : ''}</div>`,
    )}`);
  };
  function paint() {
    paintHead();
    patch(z('pulse'), statusView(s, s ? null : error));
    paintList();
    paintLog();
    paintFoot();
    paintPanel();
  }

  const options = (
    items: { id: string; label: string; off?: boolean }[],
    cur: string,
    none: string,
  ) =>
    `<option value="">${esc(none)}</option>${items
      .map(
        (o) =>
          `<option value="${esc(o.id)}"${o.id === cur ? ' selected' : ''}${o.off ? ' disabled' : ''}>${esc(o.label)}</option>`,
      )
      .join('')}`;
  const field = (label: string, ctl: string, cls = '') =>
    `<span class="rw-f ${cls}"><small>${esc(label)}</small>${ctl}</span>`;
  const select = (attr: string, html: string, label: string) =>
    `<label class="d-fld"><select ${attr} aria-label="${esc(label)}">${html}</select></label>`;
  const text = (i: number, f: string, v: string, list: string, label: string) =>
    field(
      label,
      fld(
        `data-a="${f}" data-i="${i}" list="${list}" maxlength="256" aria-label="${esc(label)}"`,
        v,
        '',
        '',
        'text',
      ),
    );
  const duration = (i: number, ms?: number) =>
    field(
      'Pendant',
      fld(
        `data-a="duration" data-i="${i}" min="0" max="600" step="0.5" placeholder="toujours" aria-label="Durée"`,
        ms ? ms / 1000 : '',
        's',
      ),
      'rw-num',
    );
  const volume = (i: number, v: number) =>
    field(
      'Volume',
      `<span class="rw-vol"><input class="d-range" type="range" min="0" max="100" step="1" data-a="volume" data-i="${i}" value="${v}" aria-label="Volume"><b data-vol="${i}">${v} %</b></span>`,
    );

  function fields(a: CpActionView, i: number) {
    const type = select(
      `data-a="type" data-i="${i}"`,
      ACTION_TYPES.map(
        (t) =>
          `<option value="${t.id}"${t.id === a.type ? ' selected' : ''}>${esc(t.label)}</option>`,
      ).join(''),
      'Type d’action',
    );
    let body: string;
    if (a.type === 'effect_sound')
      body = `${field(
        'Son',
        select(
          `data-a="sound_id" data-i="${i}"`,
          options(
            (s?.effects?.sounds ?? []).map((x) => ({
              id: x.id,
              label: `${x.label}${x.available ? '' : ' (non importé)'}`,
              off: !x.available && x.id !== a.sound_id,
            })),
            a.sound_id,
            'Choisir un son d’effet',
          ),
          'Son d’effet',
        ),
      )}${volume(i, a.volume)}<button type="button" class="d-btn sm" data-listen="${i}" ${a.sound_id ? '' : 'disabled'} title="Ici, dans Studio, pas dans OBS">${ic('play')}Écouter</button>`;
    else if (a.type === 'effect_video')
      body = `${field(
        'Vidéo',
        select(
          `data-a="video_id" data-i="${i}"`,
          options(
            (s?.effects?.videos ?? []).map((x) => ({
              id: x.id,
              label: `${x.label}${x.available ? '' : ' (non importée)'}`,
              off: !x.available && x.id !== a.video_id,
            })),
            a.video_id,
            'Choisir une vidéo d’effet',
          ),
          'Vidéo d’effet',
        ),
      )}${volume(i, a.volume)}`;
    else if (a.type === 'sound')
      body = field(
        'Son du Soundboard',
        select(
          `data-a="sound_id" data-i="${i}"`,
          options(
            (s?.sounds ?? [])
              .filter((x) => x.enabled || x.id === a.sound_id)
              .map((x) => ({ id: x.id, label: x.label })),
            a.sound_id,
            'Choisir un son',
          ),
          'Son du Soundboard',
        ),
      );
    else if (a.type === 'obs_source')
      body = `${text(i, 'scene', a.scene, 'rw-scenes', 'Scène')}${text(i, 'source', a.source, 'rw-sources', 'Source')}${field(
        'Action',
        seg(
          `data-b="visible" data-i="${i}" data-v`,
          [
            ['1', 'Afficher'],
            ['0', 'Masquer'],
          ],
          a.visible ? '1' : '0',
        ),
      )}${duration(i, a.duration_ms)}`;
    else if (a.type === 'obs_filter')
      body = `${text(i, 'source', a.source, 'rw-sources', 'Source')}${text(i, 'filter', a.filter, 'rw-filters', 'Filtre')}${field(
        'Action',
        seg(
          `data-b="enabled" data-i="${i}" data-v`,
          [
            ['1', 'Activer'],
            ['0', 'Désactiver'],
          ],
          a.enabled ? '1' : '0',
        ),
      )}${duration(i, a.duration_ms)}`;
    else if (a.type === 'interaction') {
      const it = INTERACTIONS[a.interaction];
      body = `${field(
        'Interaction',
        select(
          `data-a="interaction" data-i="${i}"`,
          Object.entries(INTERACTIONS)
            .map(
              ([id, x]) =>
                `<option value="${id}"${id === a.interaction ? ' selected' : ''}>${esc(x.label)}</option>`,
            )
            .join(''),
          'Interaction',
        ),
      )}<p class="rw-desc">${esc(it?.description ?? '')}</p>${it ? `<a class="rw-open" href="/?p=${it.page}">${ic('arrow')}Ouvrir ${esc(it.page === 'effects' ? 'Effets et lecteur' : it.label)}</a>` : ''}`;
    } else if (a.type === 'credits')
      body = `${field(
        'Crédit',
        seg(
          `data-b="currency" data-i="${i}" data-v`,
          [
            ['credits_tts', 'TTS'],
            ['credits_soundboard', 'Soundboard'],
          ],
          a.currency,
        ),
      )}${field(
        'Nombre',
        fld(
          `data-a="amount" data-i="${i}" min="1" max="1000" step="1" placeholder="à choisir" aria-label="Nombre de crédits"`,
          a.amount || '',
        ),
        'rw-num',
      )}<p class="rw-desc">Crédités une fois par achat au viewer qui l’a fait ; repris si Twitch annule l’achat.</p>`;
    else
      body = `${text(i, 'scene', a.scene, 'rw-scenes', 'Scène')}${duration(i, a.duration_ms)}`;
    return `${field('Type', type, 'rw-type')}${body}`;
  }

  const stepLabel = (a: CpActionView) =>
    actionLabel(a, s?.sounds, effectItems(s?.effects));
  function paintWire() {
    const r = reward();
    if (!r || !draft) {
      z('wire').innerHTML = s
        ? `<div class="d-empty">${s.rewards.length ? 'Choisis une récompense.' : 'Rien à relier pour l’instant.'}</div>`
        : error
          ? ''
          : '<div class="d-skel" style="height:220px"></div>';
      return;
    }
    const d = draft;
    z('wire').innerHTML = `<header class="rw-wh">
        <span class="rw-pts big">${fmt(r.cost)}<small>pts</small></span>
        <div class="rw-wt"><h2>${esc(r.title)}</h2>${r.prompt ? `<p>${esc(r.prompt)}</p>` : ''}</div>
        <span class="d-sp"></span>
        <span class="d-lb">Active</span>${sw(d.enabled, 'data-rule', `Règle de ${r.title}`)}
      </header>
      <ol class="rw-steps">
        <li class="rw-start">${ic('gift')}<span>Un viewer rachète la récompense${r.user_input_required ? ' et écrit un texte' : ''}</span></li>
        ${d.actions
          .map(
            (
              a,
              i,
            ) => `<li class="rw-step ${openStep === i ? 'is-open' : ''}" data-at="${i}">
              <div class="rw-sh"><button type="button" class="rw-st" data-step="${i}" aria-expanded="${openStep === i}"><i>${i + 1}</i>${ic(actionIcon(a))}<span data-label="${i}">${esc(stepLabel(a))}</span>${ic('down')}</button>
              <button type="button" class="d-ib" data-more="${i}" aria-label="Déplacer ou retirer l’action ${i + 1}">${ic('more')}</button></div>
              ${openStep === i ? `<div class="rw-sb">${fields(a, i)}</div>` : ''}
            </li>`,
          )
          .join('')}
        <li class="rw-end"><button type="button" class="d-btn ghost sm" data-add ${d.actions.length >= MAX_STEPS ? `disabled title="${MAX_STEPS} actions au maximum"` : ''}>${ic('plus')}Ajouter une action</button></li>
      </ol>
      <footer class="rw-foot" data-z="foot"></footer>`;
    paintFoot();
  }
  function paintFoot() {
    const foot = p.body.querySelector<HTMLElement>('[data-z="foot"]');
    const r = reward();
    if (!foot || !r) return;
    const saved = r.rule?.actions ?? [];
    const dry = saved.filter(isDry).length;
    const choices = textChoices(r);
    const changed = dirty();
    patch(
      foot,
      `<div class="rw-try">
        ${choices ? `<label class="d-fld rw-tryin">${ic('chat')}<input type="text" data-try list="rw-text" maxlength="500" value="${esc(testInput || choices[0]!)}" aria-label="Ce qu’un viewer écrirait" title="Ce qu’un viewer écrirait (texte inconnu possible)"></label><datalist id="rw-text">${choices.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>` : ''}
        <button type="button" class="d-btn" data-test ${r.rule && !changed ? '' : 'disabled'} title="${changed ? 'Enregistre d’abord : le test joue la version enregistrée' : 'Exécute la règle enregistrée sur le stream'}">${ic('play')}Tester pour de vrai…</button>
        <small>${saved.length ? (dry ? `${saved.length - dry} réelle${saved.length - dry > 1 ? 's' : ''}, ${dry} à blanc` : 'Actions réelles sur le stream') : 'Aucune action enregistrée'}</small>
      </div>
      ${
        conflict
          ? `<span class="rw-apply"><span class="d-note bad">${esc(ERRORS.version_conflict)}</span><button type="button" class="d-btn sm" data-reload>Recharger</button></span>`
          : changed
            ? `<span class="rw-apply"><span class="d-muted">Pas encore enregistré</span><button type="button" class="d-btn ghost sm" data-revert>Annuler</button><button type="button" class="d-btn pri sm" data-save>Enregistrer</button></span>`
            : ''
      }`,
    );
  }

  // --- Interaction ------------------------------------------------------------------------------------------------------
  function pick(id: string) {
    if (id !== selected) testInput = '';
    selected = id;
    const r = reward();
    takeRule(r);
    openStep = r?.rule?.actions.length === 1 ? 0 : null;
    conflict = false;
    paintWire();
    paintList();
    paintLog();
    void loadLists();
  }
  async function askPick(id: string) {
    if (id === selected) return;
    if (
      dirty() &&
      !(await confirmBox({
        title: 'Abandonner les changements ?',
        body: 'Les changements de cette récompense ne sont pas enregistrés.',
        yes: 'Abandonner',
      }))
    )
      return;
    pick(id);
  }
  /** Brouillon → règle du Core : une durée vide veut dire permanent. */
  const toRule = () =>
    draft!.actions.map((a) => {
      const c = { ...a } as CpActionView & { duration_ms?: number };
      if ('duration_ms' in c && !c.duration_ms) delete c.duration_ms;
      return c;
    });
  async function save(btn: HTMLElement) {
    const r = reward();
    if (!r || !draft) return;
    btn.classList.add('is-busy');
    try {
      await postJson(`/api/channel-points/rules/${r.id}`, {
        enabled: draft.enabled,
        actions: toRule(),
        ...(r.rule ? { expected_version: r.rule.version } : {}),
      });
      toast('Règle enregistrée');
      s = await getJson<CpState>('/api/channel-points/state');
      takeRule(reward());
      paintWire();
      paint();
    } catch (e) {
      conflict = (e as { code?: string }).code === 'version_conflict';
      if (!conflict) toast(errText(e, ERRORS), { bad: true });
      paintFoot();
    } finally {
      btn.classList.remove('is-busy');
    }
  }
  async function test(btn: HTMLElement) {
    const r = reward();
    if (!r) return;
    const yes = await confirmBox({
      title: `Tester « ${r.title} » maintenant ?`,
      body: runNowConfirm(
        r.rule?.actions ?? [],
        s?.sounds,
        effectItems(s?.effects),
      ),
      yes: 'Exécuter',
      no: 'Annuler',
    });
    if (!yes) return;
    const choices = textChoices(r);
    const ok = await run(
      btn,
      () =>
        postJson('/api/channel-points/test', {
          reward_id: r.id,
          ...(choices ? { user_input: testInput || choices[0]! } : {}),
        }),
      'Test envoyé : voir l’historique',
    );
    if (ok) tick.now();
  }
  function stepMenu(b: HTMLElement, i: number) {
    const d = draft!;
    const move = (to: number) => {
      const [a] = d.actions.splice(i, 1);
      d.actions.splice(to, 0, a!);
      openStep = null;
      paintWire();
    };
    menu(b, `Action ${i + 1}`, [
      {
        label: 'Monter',
        disabled: i === 0,
        run: () => move(i - 1),
      },
      {
        label: 'Descendre',
        disabled: i === d.actions.length - 1,
        run: () => move(i + 1),
      },
      '-',
      {
        label: 'Retirer cette action',
        icon: 'trash',
        kind: 'bad',
        run: () => {
          d.actions.splice(i, 1);
          openStep = null;
          paintWire();
        },
      },
    ]);
  }

  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    const id = b?.dataset.reward;
    if (id) return void askPick(id);
    const log = b?.dataset.log as typeof logTab | undefined;
    if (log) {
      logTab = log;
      return paintLog();
    }
    if (b?.matches('[data-copy]'))
      return copy(s?.effects?.url ?? '', 'Adresse copiée');
    if (!draft || !b) return;
    if (b.dataset.step) {
      const i = Number(b.dataset.step);
      openStep = openStep === i ? null : i;
      return paintWire();
    }
    if (b.dataset.more) return stepMenu(b, Number(b.dataset.more));
    if (b.matches('[data-add]') && draft.actions.length < MAX_STEPS) {
      const d = draft;
      return void menu(
        b,
        'Ajouter une action',
        ACTION_TYPES.map((x) => ({
          label: x.label,
          icon: x.icon,
          run: () => {
            d.actions.push(blankAction(x.id));
            openStep = d.actions.length - 1;
            paintWire();
          },
        })),
      );
    }
    if (b.dataset.listen !== undefined) {
      const a = draft.actions[Number(b.dataset.listen)];
      if (a?.type === 'effect_sound' && a.sound_id) {
        audio?.pause();
        audio = new Audio(`/effects/media/${encodeURIComponent(a.sound_id)}`);
        audio.volume = Math.min(1, Math.max(0, a.volume / 100));
        void audio.play().catch(() =>
          toast('Écoute impossible : son non importé ou illisible.', {
            bad: true,
          }),
        );
      }
      return;
    }
    // Les choix à deux issues d'une action (Afficher / Masquer…).
    const f = b.dataset.b;
    if (f) {
      const a = draft.actions[Number(b.dataset.i)] as unknown as Record<
        string,
        unknown
      >;
      a[f] = f === 'currency' ? b.dataset.v : b.dataset.v === '1';
      paintWire();
      return;
    }
    if (b.matches('[data-save]')) return void save(b);
    if (b.matches('[data-test]')) return void test(b);
    if (b.matches('[data-revert]') || b.matches('[data-reload]')) {
      takeRule(reward());
      conflict = false;
      paintWire();
    }
  });

  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-find]')) {
      find = t.value;
      return paintList();
    }
    if (t.matches('[data-try]')) {
      testInput = t.value.slice(0, 500);
      return;
    }
    const f = t.dataset.a;
    if (!f || !draft) return;
    const i = Number(t.dataset.i);
    const a = draft.actions[i] as unknown as Record<string, unknown>;
    if (!a) return;
    if (f === 'type') {
      draft.actions[i] = blankAction(t.value as CpActionView['type']);
      paintWire();
      p.body.querySelector<HTMLElement>('[data-a="type"]')?.focus();
    } else if (f === 'volume') {
      a.volume = Number(t.value);
      const v = p.body.querySelector(`[data-vol="${i}"]`);
      if (v) v.textContent = `${t.value} %`;
    } else if (f === 'amount') a.amount = Math.round(Number(t.value) || 0);
    else if (f === 'duration') {
      const n = Number(t.value);
      if (n > 0) a.duration_ms = Math.round(n * 1000);
      else delete a.duration_ms;
    } else if (f === 'interaction') {
      a.interaction = t.value as CpInteraction;
      paintWire();
    } else if (f === 'sound_id' || f === 'video_id') {
      a[f] = t.value;
      // Un média choisi : son volume d'origine par défaut.
      if (a.type !== 'sound')
        a.volume =
          effectItems(s?.effects).find((x) => x.id === t.value)?.volume ?? 100;
      paintWire();
    } else a[f] = t.value.trim();
    const label = p.body.querySelector(`[data-label="${i}"]`);
    if (label) label.textContent = stepLabel(draft.actions[i]!);
    if (f === 'scene' || f === 'source')
      void loadLists(String(a.scene ?? ''), String(a.source ?? ''));
    paintFoot();
  });
  p.root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-rule]') && draft) {
      draft.enabled = t.checked;
      return paintFoot();
    }
    if (!t.matches('[data-master]') || !s) return;
    const on = t.checked;
    t.checked = !on;
    const box = on ? CP_ON : CP_OFF;
    void confirmBox({
      ...box,
      no: 'Annuler',
      danger: !on,
    }).then(async (yes) => {
      if (!yes) return;
      const ok = await run(
        null,
        () => postJson('/api/channel-points/settings', { enabled: on }),
        on ? 'Automatisations activées' : 'Automatisations coupées',
      );
      if (ok) tick.now();
    });
  });

  paintHead();
  paintWire();
  return {
    setVisible(v: boolean) {
      if (v) tick.start();
      else {
        tick.stop();
        audio?.pause();
      }
    },
  };
}
