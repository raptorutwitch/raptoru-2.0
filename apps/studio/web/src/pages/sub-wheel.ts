import {
  choiceBox,
  confirmBox,
  copy,
  errText,
  ic,
  page,
  panelBtn,
  patch,
  poller,
  pp,
  run,
  scrub,
  seg,
  stateChip,
  toast,
  esc,
} from '../ds/ds.js';
import { getJson, postJson } from '../http.js';
import { setNavCount } from '../shell/shell.js';
import { replayConfirm } from './sub-wheel-rights-view.js';
import { mountRights } from './sub-wheel-rights.js';
import {
  bandOf,
  BANDS,
  bannerView,
  gainsView,
  partAngle,
  playReal,
  wheelSvg,
  type Tier,
} from './sub-wheel-stage.js';
import {
  MODE,
  monthLabel,
  nextTour,
  settingsPanel,
  stateView,
  subWheelView,
  type SwMode,
  type SwState,
  type SwUi,
} from './sub-wheel-view.js';

// Roue du Sub : la roue au centre, ce qu'elle peut donner, le prochain tirage, puis les listes (en attente, à vérifier, droits,
// historique). La roue au repos montre le prochain tour tant qu'on ne choisit pas une autre tranche. Le Core vérifie chaque permission
// (Studio = le diffuseur), journalise et reste seul maître des tirages et des gains. Les actions sensibles se confirment, les
// décisions demandent un motif. Les essais ne donnent jamais de gain réel.

/** Les refus du Core ; un code inconnu reste lisible tel quel. */
const REFUSAL: Record<string, string> = {
  forbidden: 'Permission refusée.',
  needs_review: 'Ce tour est à vérifier : décide d’abord dans « À vérifier ».',
  not_owed: 'Ce tour n’est plus en attente (déjà tiré, fusionné ou retiré).',
  review_closed: 'Cette vérification a déjà été décidée.',
  not_mergeable: 'Fusion impossible : ce tour a déjà été tiré ou crédité.',
  grant_key_reused: 'Ce tour a déjà été accordé à quelqu’un d’autre.',
  not_replayable:
    'Ce tirage ne peut pas être rejoué (déjà affiché, en cours, ou un test).',
  not_to_check: 'Cette roue n’est pas « à vérifier » (déjà réglée).',
  spin_not_found: 'Tour introuvable.',
  review_not_found: 'Vérification introuvable.',
};
const MODE_CONFIRM: Record<SwMode, string> = {
  v1: 'Chaque avis de sub tire tout de suite. Les tours gardés restent gardés (aucun n’est perdu) mais la V2 ne les tire plus.',
  v2_acquire:
    'Les tours sont gardés ; la V1 continue de tirer les avis de sub. La V2 ne tire rien.',
  v2: 'La roue tirera les tours gardés : les demandes, puis la file automatique (en live, viewer présent). Les gains sont décidés et crédités par le Core.',
};
const REVIEW = {
  distinct: {
    title: 'Deux mois distincts',
    body: 'Les deux tours seront tirables.',
    done: 'Deux mois distincts : le tour est de nouveau tirable',
  },
  merge: {
    title: 'Fusionner ce doublon',
    body: 'Ce tour bloqué est le même mois que l’autre. Il ne sera jamais tiré ni crédité (rien n’est effacé).',
    done: 'Doublon fusionné (aucun crédit)',
  },
  unresolved: {
    title: 'Laisser en attente',
    body: 'Le tour reste bloqué.',
    done: 'Laissé en attente',
  },
} as const;

export function mountSubWheelPage(root: HTMLElement) {
  const p = page(root, { title: 'Roue du Sub', mod: 'wheel', panel: true });
  p.body.innerHTML = `<div class="whl">
    <section class="whl-stage" aria-label="La roue">
      <div class="whl-box" data-z="box">
        <div data-z="ban"></div>
        <div class="whl-disc"><i class="whl-ptr"></i><div data-z="wheel"></div><span class="whl-hub" data-z="hub"></span></div>
        <div class="whl-real" data-z="real"></div>
      </div>
      <div class="whl-ctl" data-z="ctl"></div>
      <div class="whl-next" data-z="next"></div>
    </section>
    <section class="whl-gains" data-z="gains" aria-label="Ce que la roue peut donner"></section>
    <section class="whl-side" data-z="side" aria-label="Tours et historique"></section>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let state: SwState | null = null;
  let error = '';
  let busy = false;
  let playing = false;
  /** La tranche et le tier choisis à la main ; null : ceux du prochain tour. */
  let pick: { months: number; tier: Tier } | null = null;
  let part: number | null = null;
  const ui: SwUi = { tab: 'waiting' };
  const rights = mountRights(() => {
    paintSide();
    tick.now();
  });

  const shown = () => {
    const next = state ? nextTour(state) : null;
    return {
      next,
      months: pick?.months ?? next?.months ?? 12,
      tier: pick?.tier ?? ((next?.tier ?? 1) as Tier),
    };
  };

  function paintHead() {
    patch(
      p.state,
      state ? stateView(state) : stateChip('w', error || 'Lecture…'),
    );
    patch(
      p.actions,
      `<span class="d-lb" style="margin-right:-4px">Roue</span>${seg(
        'data-on',
        [
          ['on', 'Active'],
          ['off', 'Coupée'],
        ],
        state?.settings.enabled ? 'on' : 'off',
      )}${panelBtn(p.panel.isOpen())}`,
    );
  }
  function paintStage() {
    const { next, months, tier } = shown();
    const name = !pick && next ? next.viewer.name : 'Aperçu';
    patch(
      z('ban'),
      bannerView(
        name,
        !pick && next
          ? String(next.right?.sub_month ?? next.months)
          : String(months),
        tier,
      ),
    );
    const wheel = z('wheel');
    if (wheel.dataset.band !== bandOf(months)) {
      wheel.dataset.band = bandOf(months);
      part = null;
      patch(wheel, wheelSvg(months));
    }
    patch(z('hub'), tier > 1 ? `×${tier}` : '');
    patch(z('gains'), gainsView(months, tier));
    paintPart();
    patch(
      z('ctl'),
      `<div class="whl-picks">${seg(
        'data-band',
        BANDS,
        bandOf(months),
        'block',
      )}${seg(
        'data-tier',
        [
          ['1', 'T1'],
          ['2', 'T2'],
          ['3', 'T3'],
        ],
        String(tier),
      )}</div>
      <div class="whl-acts">
        <button type="button" class="d-btn pri" data-try ${playing ? 'disabled' : ''}>${ic('play')}Essayer ici</button>
        <button type="button" class="d-btn" data-open="tests">Tester dans OBS</button>
        ${pick && next ? '<button type="button" class="d-btn ghost" data-follow>Revoir le prochain tour</button>' : ''}
      </div>
      <p class="d-note">L’essai joue la vraie animation et son son sur ce PC : rien n’est tiré, rien n’est crédité.</p>`,
    );
    const s = state;
    const disabled = s && !s.settings.enabled;
    patch(
      z('next'),
      !s
        ? ''
        : disabled
          ? '<div class="whl-line"><span>Roue désactivée : les tirages sont en pause, aucun tour n’est perdu.</span><button type="button" class="d-btn pri sm" data-enable>Activer la roue</button></div>'
          : next
            ? `<div class="whl-up">${pp(next.viewer.name, 30)}<span><small>${next.status === 'requested' ? 'Tirage demandé' : 'Prochain tour'}</small><b>${esc(next.viewer.name)}</b> <span class="whl-m">T${next.tier} · ${monthLabel(next.right, next.months)}</span></span>${next.status === 'owed' ? `<button type="button" class="d-btn sm" data-act="sw-draw" data-spin="${esc(next.spin_id)}" data-name="${esc(next.viewer.name)}">Tirer</button>` : ''}</div>`
            : '<p class="d-note">Aucun tour en attente.</p>',
    );
  }
  function paintPart() {
    const { months } = shown();
    const box = z('box');
    box.classList.toggle('has-part', part !== null);
    for (const g of p.body.querySelectorAll<SVGElement>('[data-part]'))
      g.classList.toggle('hot', g.dataset.part === String(part));
    for (const b of p.body.querySelectorAll<HTMLElement>('[data-part-btn]'))
      b.classList.toggle('on', b.dataset.partBtn === String(part));
    const spin = p.body.querySelector<SVGElement>('[data-spin]');
    if (spin)
      spin.style.transform = `rotate(${partAngle(months, part ?? 0)}deg)`;
  }
  function paintSide() {
    ui.rights =
      ui.tab === 'rights'
        ? rights.tab(!!state && !state.v2_unavailable)
        : undefined;
    const scroll = z('side').querySelector('.whl-body')?.scrollTop ?? 0;
    patch(z('side'), subWheelView(state, state ? null : error || null, ui));
    const body = z('side').querySelector('.whl-body');
    if (body) body.scrollTop = scroll;
  }
  function paintPanel() {
    if (!state) return;
    const a = document.activeElement;
    if (a && p.panel.body.contains(a) && a.matches('input,select,textarea'))
      return;
    const keep = [
      ...p.panel.body.querySelectorAll<HTMLInputElement>('[data-f]'),
    ].map((el) => [el.dataset.f!, el.value] as const);
    p.panel.set(settingsPanel(state));
    for (const [f, v] of keep) {
      const el = p.panel.body.querySelector<HTMLInputElement>(
        `[data-f="${f}"]`,
      );
      if (el) el.value = v;
    }
  }
  const paint = () => {
    paintHead();
    paintStage();
    paintSide();
    paintPanel();
  };

  let reads = 0;
  async function read() {
    if (busy) return;
    const id = ++reads;
    try {
      const fresh = await getJson<SwState>('/api/sub-wheel/state');
      // Un relevé parti avant une action ne doit pas la faire disparaître en revenant après elle.
      if (id !== reads) return;
      state = fresh;
      error = '';
      const n = (state?.reviews?.length ?? 0) + (state?.rights?.length ?? 0);
      setNavCount('sub-wheel', n ? String(n) : null);
    } catch (e) {
      error = `Roue du Sub indisponible : ${errText(e)}`;
    }
    paint();
  }
  const tick = poller(read, 3000);

  /** Une action à la fois : un second clic est ignoré tant que la première n'a pas répondu. */
  const post = async (
    btn: HTMLElement | null,
    path: string,
    body: object,
    done: string,
  ) => {
    if (busy) return false;
    busy = true;
    const ok = await run(
      btn,
      () => postJson(`/api/sub-wheel${path}`, body),
      done,
      REFUSAL,
    );
    busy = false;
    (document.activeElement as HTMLElement | null)?.blur();
    await read();
    return ok;
  };
  const field = (f: string) =>
    p.panel.body
      .querySelector<HTMLInputElement>(`[data-f="${f}"]`)
      ?.value.trim() ?? '';
  const testBody = () => ({
    name: field('sw-name') || undefined,
    tier: Number(field('sw-tier') || 1),
    months: Math.max(
      1,
      Math.min(200, Math.round(Number(field('sw-months') || 1) || 1)),
    ),
  });
  /** Lab : un viewer simulé se nomme par son pseudo ; le même pseudo garde le même identifiant fictif. */
  const labViewerId = (name: string) => {
    const known = state?.lab_sim?.viewers.find(
      (v) => v.display_name.toLowerCase() === name.toLowerCase(),
    );
    if (known) return known.viewer_id;
    let h = 0x811c9dc5;
    for (const c of name.toLowerCase())
      h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
    return `9${String(h).padStart(10, '0')}`;
  };

  async function setEnabled(btn: HTMLElement | null, on: boolean) {
    if (!state || on === state.settings.enabled) return;
    if (
      on &&
      !(await confirmBox({
        title: 'Activer la Roue du Sub ?',
        body: 'Les vrais subs, resubs et Prime lanceront la roue selon le mode choisi. Le Core décide chaque gain une seule fois.',
        yes: 'Activer la roue',
        no: 'Annuler',
        danger: false,
      }))
    )
      return;
    void post(
      btn,
      '/settings',
      { enabled: on },
      on
        ? 'Roue activée'
        : 'Roue désactivée (tirages en pause, aucun tour perdu)',
    );
  }

  async function tryHere(btn: HTMLElement) {
    if (playing) return;
    const { months, tier, next } = shown();
    const count = p.body.querySelectorAll('[data-part]').length;
    const box = z('box');
    playing = true;
    btn.toggleAttribute('disabled', true);
    z('real').style.zoom = String(box.clientWidth / 392);
    box.classList.add('whl-playing');
    try {
      await playReal(z('real'), {
        months,
        tier,
        name: !pick && next ? next.viewer.name : 'Aperçu',
        part: part ?? Math.floor(Math.random() * count),
      });
    } catch (e) {
      toast(`Essai impossible : ${(e as Error).message}`, { bad: true });
    }
    box.classList.remove('whl-playing');
    playing = false;
    paintStage();
  }

  const actions: Record<string, (el: HTMLElement) => unknown> = {
    'sw-draw': async (el) => {
      if (
        await confirmBox({
          title: `Tirer le tour de ${el.dataset.name ?? 'ce viewer'} ?`,
          body: 'Il passe avant la file automatique, à la prochaine roue.',
          yes: 'Tirer à la prochaine roue',
          no: 'Annuler',
          danger: false,
        })
      )
        void post(
          el,
          `/spins/${el.dataset.spin}/request`,
          {},
          'Tirage demandé : il passe à la prochaine roue',
        );
    },
    'sw-confirm-shown': async (el) => {
      if (
        await confirmBox({
          title: `La roue de ${el.dataset.name ?? 'ce viewer'} a bien été vue ?`,
          body: 'Elle passe « Affichée » telle quelle (rien n’est tiré ni crédité) et le gain est annoncé une fois dans le chat.',
          yes: 'Elle a bien été vue',
          no: 'Annuler',
          danger: false,
        })
      )
        void post(
          el,
          `/spins/${el.dataset.spin}/confirm-shown`,
          {},
          'Roue marquée « Affichée »',
        );
    },
    'sw-replay': async (el) => {
      if (
        await confirmBox({
          title: 'Rejouer l’animation ?',
          body: replayConfirm(
            el.dataset.name ?? 'ce viewer',
            Number(el.dataset.amount),
            el.dataset.award ?? '',
          ),
          yes: 'Rejouer l’animation',
          no: 'Annuler',
          danger: false,
        })
      )
        void post(
          el,
          `/spins/${el.dataset.spin}/replay`,
          {},
          'Animation remise en file (aucun crédit en plus)',
        );
    },
    'sw-review': async (el) => {
      const decision = el.dataset.decision as keyof typeof REVIEW;
      const d = REVIEW[decision];
      const said = await choiceBox({
        title: d.title,
        body: d.body,
        choices: [],
        yes: 'Continuer',
        danger: decision === 'merge',
        field: { label: 'Motif (gardé dans l’historique)', required: true },
      });
      if (!said) return;
      if (
        decision === 'merge' &&
        !(await confirmBox({
          title: 'Confirmer la fusion ?',
          body: 'Elle est définitive.',
          yes: 'Fusionner',
          no: 'Annuler',
        }))
      )
        return;
      void post(
        el,
        `/reviews/${el.dataset.review}/resolve`,
        { decision, note: said.text },
        d.done,
      );
    },
    'sw-invitations': async (el) => {
      if (!state) return;
      const on = !state.settings.invitations_enabled;
      const input = el as HTMLInputElement;
      if (
        on &&
        !(await confirmBox({
          title: 'Activer les invitations naturelles ?',
          body: 'En V2 et pendant le live, LeCroupier_ proposera une fois par live, dans le chat, de lancer les tours en attente. Accepter demande le tirage ; rien n’est crédité à la réponse.',
          yes: 'Activer les invitations',
          no: 'Annuler',
          danger: false,
        }))
      ) {
        input.checked = false;
        return;
      }
      void post(
        null,
        '/invitations',
        { enabled: on },
        on ? 'Invitations activées' : 'Invitations désactivées',
      );
    },
    'sw-announce-delay': (el) => {
      const raw = field('sw-announce-delay');
      const seconds = Number(raw);
      if (!/^\d{1,2}$/.test(raw) || seconds > 60)
        return toast('Délai d’annonce : un nombre entier de 0 à 60 secondes.', {
          bad: true,
        });
      return post(
        el,
        '/announce-delay',
        { seconds },
        `Délai d’annonce du gain : ${seconds} s`,
      );
    },
    'sw-mode': async (el) => {
      const mode = el.dataset.mode as SwMode;
      if (!state || mode === (state.settings.mode ?? 'v1')) return;
      if (
        await confirmBox({
          title: `Passer en ${MODE[mode][0]} ?`,
          body: MODE_CONFIRM[mode],
          yes: `Passer en ${MODE[mode][0]}`,
          no: 'Annuler',
          danger: false,
        })
      )
        void post(el, '/mode', { mode }, 'Mode changé');
    },
    'sw-test': (el) =>
      post(
        el,
        '/test',
        testBody(),
        'Roue envoyée au lecteur d’effets (aucun gain)',
      ),
    'sw-full': (el) =>
      post(
        el,
        '/test',
        { ...testBody(), full: true },
        'Alerte de sub simulée puis roue (aucun gain)',
      ),
    'sw-manual': (el) => award(el, 'manual'),
    'sw-cancel': (el) => award(el, 'cancelled'),
    'sw-sim-fail-start': (el) =>
      post(
        el,
        '/lab/fail-next-start',
        { on: el.dataset.on === '1' },
        el.dataset.on === '1'
          ? 'La prochaine roue échouera avant de démarrer (simulé)'
          : 'Échec simulé annulé',
      ),
    'sw-sim-live': (el) =>
      post(
        el,
        '/lab/live',
        { on: el.dataset.on === '1' },
        el.dataset.on === '1' ? 'Live simulé démarré' : 'Live simulé terminé',
      ),
    'sw-sim-readings': (el) =>
      post(
        el,
        '/lab/presence',
        { readings: el.dataset.on === '1' },
        el.dataset.on === '1'
          ? 'Relevés simulés démarrés'
          : 'Relevés arrêtés : présence inconnue',
      ),
    'sw-sim-present': (el) =>
      post(
        el,
        '/lab/presence',
        {
          viewers: [
            {
              id: el.dataset.id,
              name: el.dataset.name ?? el.dataset.id,
              present: el.dataset.present === '1',
            },
          ],
        },
        'Présence mise à jour',
      ),
  };
  async function award(el: HTMLElement, status: 'manual' | 'cancelled') {
    const said = await choiceBox({
      title: status === 'manual' ? 'Gain crédité à la main' : 'Annuler ce gain',
      body:
        status === 'manual'
          ? 'Dis où et comment il a été crédité.'
          : 'Dis pourquoi ce gain est annulé.',
      choices: [],
      yes: status === 'manual' ? 'Marquer crédité' : 'Annuler le gain',
      danger: status === 'cancelled',
      field: { label: 'Note (obligatoire)', required: true },
    });
    if (said)
      void post(
        el,
        `/spins/${el.dataset.spin}/award`,
        { status, note: said.text },
        'Gain mis à jour',
      );
  }

  p.root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const on = t.closest<HTMLElement>('[data-on]:not([data-act])');
    if (on) return void setEnabled(on, on.dataset.on === 'on');
    const tab = t.closest<HTMLElement>('[data-tab]');
    if (tab) {
      ui.tab = tab.dataset.tab as SwUi['tab'];
      ui.pendingOnly = tab.hasAttribute('data-pending');
      return paintSide();
    }
    const hist = t.closest<HTMLElement>('[data-hist]');
    if (hist) {
      ui.pendingOnly = hist.dataset.hist === 'pending';
      return paintSide();
    }
    const band = t.closest<HTMLElement>('[data-band]');
    if (band) {
      pick = { months: Number(band.dataset.band), tier: shown().tier };
      return paintStage();
    }
    const tier = t.closest<HTMLElement>('[data-tier]');
    if (tier) {
      pick = {
        months: shown().months,
        tier: Number(tier.dataset.tier) as Tier,
      };
      return paintStage();
    }
    const pb = t.closest<HTMLElement>('[data-part-btn]');
    if (pb) {
      const i = Number(pb.dataset.partBtn);
      part = part === i ? null : i;
      return paintPart();
    }
    if (t.closest('[data-follow]')) {
      pick = null;
      return paintStage();
    }
    if (t.closest('[data-enable]'))
      return void setEnabled(t.closest<HTMLElement>('[data-enable]'), true);
    const tr = t.closest<HTMLElement>('[data-try]');
    if (tr) return void tryHere(tr);
    const go = t.closest<HTMLElement>('[data-open]');
    if (go) return p.panel.open(go.dataset.open);
    if (t.closest('[data-copy]'))
      return copy(state?.effects?.url ?? '', 'Adresse copiée');
    const v = t.closest<HTMLElement>('[data-viewer]');
    if (v) return rights.openViewer(v.dataset.viewer!);
    const el = t.closest<HTMLElement>('[data-act]');
    if (!el || !state || busy) return;
    if (el.dataset.act?.startsWith('swr-')) return void rights.click(el);
    void actions[el.dataset.act!]?.(el);
  });
  // Survoler un gain allume sa part sur la roue.
  p.body.addEventListener('pointerover', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>(
      '[data-part-btn]',
    );
    if (part !== null) return;
    for (const g of p.body.querySelectorAll<SVGElement>('[data-part]'))
      g.classList.toggle('hot', !!b && g.dataset.part === b.dataset.partBtn);
    z('box').classList.toggle('has-part', !!b);
  });
  p.root.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target as HTMLElement;
    const role = form.dataset.role;
    if (role === 'swr-search')
      return rights.search(
        form.querySelector<HTMLInputElement>('[data-f="swr-q"]')!.value.trim(),
      );
    if (role !== 'sw-sim-viewer' && role !== 'sw-sim-event') return;
    const name = field(role === 'sw-sim-viewer' ? 'sv-name' : 'se-name')
      .replace(/^@+/, '')
      .trim();
    if (!name) return toast('Pseudo obligatoire.', { bad: true });
    const id = labViewerId(name);
    if (role === 'sw-sim-viewer')
      void post(
        null,
        '/lab/presence',
        { viewers: [{ id, name, present: true }] },
        `${name} ajouté, présent`,
      );
    else
      void post(
        null,
        '/lab/simulate',
        {
          kind: field('se-kind') || 'sub',
          viewer: { id, name },
          tier: Number(field('se-tier') || 1),
          months: Math.max(
            1,
            Math.min(200, Math.round(Number(field('se-months')) || 2)),
          ),
        },
        'Événement simulé envoyé (Lab)',
      );
  });
  scrub(p.root, () => {});

  paint();
  return {
    setVisible(v: boolean) {
      if (v) tick.start();
      else tick.stop();
    },
  };
}
