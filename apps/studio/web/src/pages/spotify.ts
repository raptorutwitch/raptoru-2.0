import {
  clock,
  confirmBox,
  errText,
  keyed,
  morph,
  page,
  panelBtn,
  patch,
  poller,
  run,
  scrub,
  toast,
  seg,
  viewersSeg,
  stateChip,
  esc,
  ic,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import { setNavCount } from '../shell/shell.js';
import {
  HISTORICAL,
  REWARD_TITLE,
  simBar,
  spotifyPanel,
} from './spotify-panel.js';
import type { StepOut } from '../sim-chat-view.js';
import {
  alertsView,
  countsView,
  historyRows,
  livePosition,
  liveOf,
  nowView,
  playedRows,
  openingView,
  position,
  queueEmpty,
  quotasView,
  queueRows,
  stateView,
  musicRulesView,
  timeView,
  verifyNote,
  type SpLive,
  type SpOverlay,
  type SpPlayedPage,
  type SpState,
  type SpUi,
} from './spotify-view.js';

// Spotify : ce qui joue d'abord, la file vivante à côté, ses décisions sur chaque ligne ; quotas, exceptions, récompense, connexion
// et simulateur dans le panneau. Chaque action est un clic explicite ; ce qui est saisi survit au relevé. Le Core décide, Studio est
// le seul à appeler Spotify (« Actualiser » est limité par Studio).

const ERRORS: Record<string, string> = {
  effects_player_offline:
    'Source OBS « Effets » absente : ouvre OBS ou ajoute la source.',
  effects_player_muted:
    'Source « Effets » sans son : active le son de la source.',
  effects_player_outdated: 'Source « Effets » à recharger dans OBS.',
  effect_media_missing: 'Ce son n’est pas importé dans Studio.',
  invalid_overlay: 'Réglage de l’overlay refusé.',
  overlay_unavailable: 'Overlay indisponible dans ce Studio.',
  unsupported_audio: 'Format de son non pris en charge (mp3, wav, ogg).',
  sound_too_large: 'Son trop lourd (5 Mo max).',
  reward_exists: 'La récompense existe déjà.',
  reward_create_in_progress: 'Une création est déjà en cours.',
  rate_limited: 'Spotify limite les appels : réessaie plus tard.',
  spotify_not_connected: 'Spotify n’est pas connecté.',
  invalid_request: 'Valeur refusée : vérifie les champs.',
  invalid_client_id: 'Client ID invalide (32 caractères).',
  not_removable: 'Cette demande ne peut plus être retirée.',
  playing_use_skip: 'Elle joue déjà : utilise « Passer la musique ».',
  already_settled: 'Déjà réglée.',
  not_uncertain: 'Cette demande n’est plus à vérifier.',
  player_controls_disabled:
    'Commandes du lecteur désactivées (panneau, Extension).',
  no_device: 'Aucun appareil Spotify actif.',
  studio_unavailable: 'Studio absent pour le serveur.',
};
const SETTINGS = ['set-pending', 'set-cooldown', 'set-duration', 'set-grace'];

export function mountSpotifyPage(root: HTMLElement) {
  const p = page(root, { title: 'Spotify', mod: 'spotify', panel: true });
  p.body.innerHTML = `<div class="spo">
    <div class="spo-main">
      <div class="spo-alerts d-tags" data-z="alerts"></div>
      <div data-z="open"></div>
      <div data-z="ovl"></div>
      <div data-z="rules"></div>
      <section class="spo-now" data-z="now" aria-label="Lecture en cours"><div class="d-skel" style="height:200px;grid-column:1/-1"></div></section>
      <div class="spo-quotas" data-z="quotas"></div>
      <div data-z="simbar"></div>
      <section class="spo-tl" data-z="time" aria-label="La file dans le temps"></section>
      <div class="spo-counts" data-z="counts"></div>
    </div>
    <section class="spo-q" aria-label="File des demandes">
      <div class="spo-qhead" data-z="qhead"></div>
      <div data-z="note"></div>
      <div class="spo-qlist d-scroll" data-z="qlist"></div>
    </section>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let state: SpState | null = null;
  let error = '';
  let list: 'file' | 'past' | 'played' = 'file';
  // Music Hub : les musiques du stream (Core), chargées à l'ouverture de l'onglet, page par page.
  let played: (SpPlayedPage & { loading?: boolean; error?: string }) | null =
    null;
  const ui: SpUi = { fields: {}, who: [], now: Date.now() };

  z('simbar').addEventListener(
    'toggle',
    (e) => {
      ui.simClosed = !(e.target as HTMLDetailsElement).open;
    },
    true,
  );
  const typing = () => {
    const a = document.activeElement;
    return (
      !!a && p.panel.body.contains(a) && a.matches('input,select,textarea')
    );
  };

  const paintHead = () => {
    patch(
      p.state,
      state ? stateView(state) : stateChip('w', error || 'Lecture…'),
    );
    patch(
      p.actions,
      `${viewersSeg(
        'data-switch',
        [
          ['on', 'Ouvert'],
          ['off', 'Fermé'],
        ],
        state?.settings.enabled ? 'on' : 'off',
      )}${panelBtn(p.panel.isOpen())}`,
    );
  };
  let barMs = -1;
  const paintProgress = () => {
    if (!state) return;
    const live = liveOf(state, ui);
    const at = live
      ? livePosition(live, ui.liveAt ?? Date.now(), Date.now())
      : position(state, Date.now());
    const bar = p.body.querySelector<HTMLElement>('[data-prog]');
    const t0 = p.body.querySelector<HTMLElement>('[data-t0]');
    const t1 = p.body.querySelector<HTMLElement>('[data-t1]');
    if (!bar || !t0 || !t1) return;
    // Fluide : la barre glisse d'une seconde à l'autre ; un retour en arrière (titre suivant, recherche) saute sans glisser.
    const ms = at?.ms ?? 0;
    bar.style.transition =
      at?.live && ms >= barMs && ms - barMs < 2_500 ? '' : 'none';
    barMs = ms;
    bar.style.width = at ? `${(at.ms / at.total) * 100}%` : '0';
    t0.textContent = at ? clock(at.ms / 1000) : '';
    t1.textContent = at ? clock(at.total / 1000) : '';
  };
  const paint = () => {
    paintHead();
    const s = state;
    if (!s) {
      patch(
        z('now'),
        `<div class="d-empty" style="grid-column:1/-1">${esc(error)}</div>`,
      );
      return;
    }
    ui.now = Date.now();
    patch(z('alerts'), alertsView(s));
    patch(z('open'), openingView(s));
    morph(z('now'), nowView(s, ui));
    paintProgress();
    patch(z('quotas'), quotasView(s));
    patch(z('rules'), musicRulesView(s, ui.now));
    patch(z('time'), timeView(s, ui));
    patch(z('counts'), countsView(s));
    if (!z('simbar').contains(document.activeElement))
      patch(z('simbar'), simBar(s, ui));
    patch(
      z('qhead'),
      seg(
        'data-list',
        [
          ['file', `File ${s.queue.length + s.in_progress.length}`],
          ['past', 'Dernières décisions'],
          ['played', 'Musiques du stream'],
        ],
        list,
      ),
    );
    patch(z('note'), list === 'file' ? verifyNote(s) : '');
    if (list === 'file') keyed(z('qlist'), queueRows(s, ui), queueEmpty(s));
    else if (list === 'played') paintPlayed();
    else
      keyed(
        z('qlist'),
        historyRows(s),
        '<div class="d-empty">Aucune demande pour l’instant.</div>',
      );
    if (!typing()) p.panel.set(spotifyPanel(s, ui));
  };

  // --- Music Hub : les musiques du stream ----------------------------------------------------------------------------------
  function paintPlayed() {
    const h = played;
    const rows = h ? playedRows(h) : [];
    const more = h?.next
      ? [
          {
            key: 'more',
            html: `<button type="button" class="d-btn ghost sm spo-pmore" data-act="sp-hmore" ${h.loading ? 'aria-busy="true" disabled' : ''}>Plus anciennes</button>`,
          },
        ]
      : [];
    keyed(
      z('qlist'),
      [...rows, ...more],
      h?.error
        ? `<div class="d-empty">${esc(h.error)}</div>`
        : !h || h.loading
          ? '<div class="d-skel" style="height:120px"></div>'
          : `<div class="d-empty">Aucune musique relevée pendant un live pour l’instant.<br><small>Studio note chaque titre que Spotify Desktop joue pendant le live (y compris ta musique), avec les demandes reconnues par le Core.</small></div>`,
    );
  }
  async function loadPlayed(more = false) {
    if (played?.loading) return;
    played = played
      ? { ...played, loading: true }
      : { items: [], next: null, live: false, since: null, loading: true };
    if (list === 'played') paintPlayed();
    try {
      const page = await postJson<SpPlayedPage>('/api/spotify/history', {
        before: more ? played.next : null,
      });
      // Une première page relue garde les plus anciennes déjà chargées (sans doublon).
      const items = more
        ? [...played.items, ...page.items]
        : [
            ...page.items,
            ...played.items.filter(
              (i) =>
                !page.items.some((n) => n.id === i.id) &&
                Date.parse(i.at) < Date.parse(page.items.at(-1)?.at ?? ''),
            ),
          ];
      played = {
        ...page,
        items,
        next: more || !played.items.length ? page.next : played.next,
        loading: false,
      };
    } catch (e) {
      played = { ...played, loading: false, error: errText(e) };
    }
    if (list === 'played') paintPlayed();
  }

  // --- Music Hub : le titre en cours selon Windows (local, chaque seconde) ------------------------------------------------
  let liveSig = '';
  async function readLive() {
    const out = await tryGetJson<{ live: SpLive | null }>('/api/spotify/live');
    if (!out) return;
    ui.live = out.live;
    ui.liveAt = Date.now();
    const l = out.live;
    const sig = l
      ? `${l.state}|${l.gen}|${l.seq}|${l.link?.uri ?? ''}|${l.cover ?? ''}`
      : '';
    if (sig === liveSig || !state) return;
    const newTrack = !!l && liveSig.split('|')[1] !== String(l.gen);
    liveSig = sig;
    ui.now = Date.now();
    morph(z('now'), nowView(state, ui));
    paintProgress();
    // Le titre change : une apparition douce, et l'historique ouvert se met à jour.
    if (newTrack) {
      const box = z('now');
      box.classList.remove('is-new');
      void box.offsetWidth;
      box.classList.add('is-new');
      if (list === 'played') void loadPlayed(false);
    }
  }

  let reads = 0;
  async function read() {
    const id = ++reads;
    try {
      const fresh = await getJson<SpState>('/api/spotify/state');
      // Un relevé parti avant une action ne doit pas la faire disparaître en revenant après elle.
      if (id !== reads) return;
      state = fresh;
      error = '';
      if (state?.sim && !ui.who.length)
        ui.who =
          (
            await tryGetJson<{ identities: SpUi['who'] }>(
              '/api/lab-chat/identities',
            )
          )?.identities ?? [];
      if (state?.sim)
        ui.replies = (
          await tryGetJson<{ steps: StepOut[] }>('/api/lab-chat/steps')
        )?.steps
          ?.filter((x) => x.origin === 'music' && x.params.text)
          .slice(0, 3)
          .map((x) => x.params.text!)
          .reverse();
      const n = (state?.queue.length ?? 0) + (state?.in_progress.length ?? 0);
      setNavCount('spotify', n ? String(n) : null);
    } catch (e) {
      error = `Musique indisponible : ${errText(e)}`;
    }
    paint();
  }
  // Overlay musique (OBS) : le contrôle rapide (affiché ou non, quel preset) et le lien vers l'éditeur.
  let ovl: { visible: boolean; preset: { name: string } } | null = null;
  const paintOvl = () =>
    patch(
      z('ovl'),
      ovl
        ? `<div class="spo-line spo-ovl"><span>${ic('film')}Overlay musique : <b>${ovl.visible ? 'affiché' : 'masqué'}</b> · ${esc(ovl.preset.name)}</span>
            <button type="button" class="d-btn sm ${ovl.visible ? '' : 'pri'}" data-act="sp-ovl" data-on="${ovl.visible ? '0' : '1'}">${ovl.visible ? 'Masquer' : 'Afficher'}</button>
            <a class="d-btn ghost sm" href="/?p=music-overlay">Régler</a></div>`
        : '',
    );
  const readOvl = async () => {
    ovl = await tryGetJson<typeof ovl>('/api/spotify/overlays/summary');
    paintOvl();
  };

  // Music Hub V2 : le réglage de la carte musique (lu une fois, puis à chaque enregistrement).
  async function readOverlay() {
    ui.overlay = await tryGetJson<SpOverlay>('/api/spotify/overlay');
    paint();
  }
  void readOverlay();
  async function saveOverlay(next: Partial<SpOverlay['config']>, done: string) {
    if (!ui.overlay) return;
    await run(
      null,
      async () => {
        ui.overlay = await postJson<SpOverlay>('/api/spotify/overlay', {
          ...ui.overlay!.config,
          ...next,
        });
      },
      done,
      ERRORS,
    );
    paint();
  }
  const tick = poller(async () => {
    await read();
    await readOvl();
  }, 3000);
  const clockTick = poller(paintProgress, 1000);
  const liveTick = poller(readLive, 1000);

  const post = async (
    btn: HTMLElement | null,
    path: string,
    body: object,
    done: string,
    clear: string[] = [],
  ) => {
    let out: Record<string, unknown> | null = null;
    await run(
      btn,
      async () => {
        out = await postJson<Record<string, unknown>>(
          `/api/spotify${path}`,
          body,
        );
        for (const f of clear) delete ui.fields[f];
      },
      done,
      ERRORS,
    );
    // Un champ saisi est relâché pour que le relevé le réécrive ; un bouton du lecteur garde son focus (la carte n'est
    // plus reconstruite).
    const active = document.activeElement as HTMLElement | null;
    if (active?.matches('input,select,textarea')) active.blur();
    await read();
    return out as Record<string, unknown> | null;
  };

  /**
   * What the player really did (Studio's answer to the job), told once — never « demandé » as if it had worked.
   * No job: Core refused before anything was sent (its reason is already shown by `post`).
   */
  const follow = async (jobId: unknown, done: string) => {
    if (typeof jobId !== 'string') return;
    let r: { status: string; reason: string | null } = {
      status: 'pending',
      reason: null,
    };
    // Studio prend la tâche (≈ 1 s), l'envoie, puis relit Spotify jusqu'à la preuve (≈ 4 s au plus) : 12 s de patience.
    for (let n = 0; n < 30 && r.status === 'pending'; n++) {
      await new Promise((ok) => setTimeout(ok, 400));
      r = (await tryGetJson<typeof r>(`/api/spotify/controls/${jobId}`)) ?? r;
    }
    const why: Record<string, string> = {
      LAB_READ_ONLY: 'Lab en lecture seule : rien n’a été envoyé à Spotify',
      NO_DEVICE: 'Aucun appareil Spotify actif : rien n’a été envoyé',
      RATE_LIMITED: 'Spotify limite les appels : réessaie dans un moment',
      STUDIO_LOST: 'Studio n’a pas répondu',
      TEMPORARY_ERROR:
        'Spotify indisponible un instant : rien n’est confirmé, regarde le lecteur',
      TRACK_CHANGED: 'Le titre a changé entre-temps : rien n’a été envoyé',
    };
    toast(
      r.status === 'done'
        ? done
        : r.status === 'pending'
          ? 'Le lecteur n’a pas encore répondu'
          : r.status === 'unknown'
            ? 'Spotify n’a pas confirmé à temps : l’action a peut-être eu lieu, regarde le lecteur'
            : (why[r.reason ?? ''] ?? 'Spotify a refusé l’action'),
      { bad: r.status !== 'done' },
    );
    await read();
  };

  const field = (f: string) =>
    (
      ui.fields[f] ??
      p.root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)?.value ??
      ''
    ).trim();
  const simWho = () =>
    z('simbar').querySelector<HTMLSelectElement>('[data-f="sim-who"]')
      ?.selectedOptions[0];
  /** Un nombre facultatif : vide → null. */
  const opt = (f: string) => (field(f) === '' ? null : Number(field(f)));

  // Ce qui est saisi survit au relevé.
  const keep = (ev: Event) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.f) ui.fields[t.dataset.f] = t.value;
  };
  p.root.addEventListener('input', keep);
  p.root.addEventListener('change', keep);
  // Music Hub : les interrupteurs de l'extension et le volume s'appliquent dès qu'on les lâche.
  p.root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.spFlag)
      void post(
        null,
        '/settings',
        { [t.dataset.spFlag]: t.checked },
        'Réglage enregistré',
      );
    else if (t.dataset.spRule)
      void post(
        null,
        '/music-rules',
        { [t.dataset.spRule]: t.checked },
        'Réglage enregistré',
      );
    else if (t.dataset.ov) {
      const k = t.dataset.ov;
      const v =
        t.type === 'checkbox'
          ? t.checked
          : k === 'volume' || k === 'duration_s'
            ? Number(t.value)
            : k === 'sound'
              ? t.value || null
              : t.value;
      void saveOverlay(
        k === 'sound'
          ? { sound: v as string | null, sound_name: null }
          : { [k]: v },
        'Overlay enregistré',
      );
    } else if (t.hasAttribute('data-ov-file') && t.files?.[0]) {
      const file = t.files[0];
      void run(
        null,
        async () => {
          const res = await fetch('/api/spotify/overlay/sounds', {
            method: 'POST',
            headers: {
              'x-raptoru-studio': '1',
              'content-type': 'application/octet-stream',
              'x-sound-name': encodeURIComponent(file.name),
            },
            body: file,
          });
          const up = (await res.json().catch(() => ({}))) as {
            id?: string;
            name?: string;
            error?: string;
          };
          if (!res.ok || !up.id)
            throw new Error(up.error ?? `HTTP ${res.status}`);
          await saveOverlay(
            { sound: up.id, sound_name: up.name ?? null },
            `« ${up.name} » importé`,
          );
        },
        'Son importé',
        ERRORS,
      );
    } else if (t.hasAttribute('data-vol'))
      void post(
        null,
        '/actions',
        { action: 'volume', volume_percent: Number(t.value) },
        `Volume ${t.value} demandé`,
      );
  });
  scrub(p.root, (i) => i.dispatchEvent(new Event('input', { bubbles: true })));

  async function setOpen(btn: HTMLElement | null, on: boolean) {
    if (!state || on === state.settings.enabled) return;
    if (
      on &&
      !(await confirmBox({
        title: 'Ouvrir les demandes de musique ?',
        body: 'Les rédemptions de la récompense liée seront cherchées et ajoutées à la file Spotify.',
        yes: 'Ouvrir les demandes',
        no: 'Annuler',
        danger: false,
      }))
    )
      return;
    void post(
      btn,
      '/settings',
      { enabled: on },
      on ? 'Demandes ouvertes' : 'Demandes fermées',
    );
  }

  const actions: Record<string, (el: HTMLElement) => unknown> = {
    'sp-switch': (el) => setOpen(el, true),
    'sp-refresh': (el) => post(el, '/refresh', {}, 'Lecture actualisée'),
    'sp-skip': async (el) => {
      if (
        await confirmBox({
          title: 'Passer la musique ?',
          body: 'Le titre en cours est passé sur Spotify.',
          yes: 'Passer la musique',
          no: 'Annuler',
          danger: false,
        })
      )
        void post(el, '/actions', { action: 'skip' }, '').then((out) =>
          out?.outcome === 'songskip_busy'
            ? toast(
                'Un skip payé par un viewer est déjà en cours : rien de plus n’a été envoyé',
                { bad: true },
              )
            : follow(out?.job_id, 'Musique passée'),
        );
    },
    'sp-remove': async (el) => {
      const keep = el.dataset.keep === '1';
      if (
        await confirmBox({
          title: keep ? 'Retirer sans rembourser ?' : 'Retirer cette demande ?',
          body: keep
            ? 'Les Jetons ne sont pas rendus au viewer. Si elle est déjà dans la file Spotify, elle sera passée automatiquement.'
            : 'Le viewer est remboursé (Jetons, ou points de la récompense de Raptoru) ; si elle est déjà dans la file Spotify, elle sera passée automatiquement.',
          yes: keep ? 'Retirer sans rembourser' : 'Retirer et rembourser',
        })
      )
        void post(
          el,
          '/actions',
          {
            action: 'remove',
            request_id: el.dataset.id,
            ...(keep ? { refund: false } : {}),
          },
          keep ? 'Demande retirée, Jetons gardés' : 'Demande retirée',
        );
    },
    'sp-play': async (el) => {
      const out = await post(el, '/actions', { action: el.dataset.play }, '');
      await follow(
        out?.job_id,
        el.dataset.play === 'pause' ? 'Lecteur en pause' : 'Lecture reprise',
      );
    },
    'sp-bar': async (el) => {
      const on = el.dataset.on === '1';
      if (
        on &&
        !(await confirmBox({
          title: 'Ouvrir l’Open Bar ?',
          body: 'Jusqu’à ce que tu le fermes : les demandes depuis l’extension sont gratuites et sans limite par personne (20 s entre deux demandes, 50 musiques au plus en file). Les demandes déjà payées gardent leur prix. Les skips payants restent payants. La récompense de points de chaîne ne change pas.',
          yes: 'Ouvrir l’Open Bar',
          no: 'Annuler',
          danger: false,
        }))
      )
        return;
      await post(
        el,
        '/music-rules',
        { open_bar: on },
        on ? 'Open Bar ouvert' : 'Open Bar fermé : prix et limites habituels',
      );
    },
    'sp-ov-preview': (el) =>
      run(
        el,
        () => postJson('/api/spotify/overlay/preview', {}),
        'Carte envoyée à la source « Effets »',
        ERRORS,
      ),
    'sp-ext-price': (el) =>
      post(
        el,
        '/settings',
        { extension_price_tokens: Number(field('ext-price')) },
        'Prix enregistré',
        ['ext-price'],
      ),
    'sp-settle': async (el) => {
      const refund = el.dataset.decision === 'refund';
      if (
        await confirmBox({
          title: refund
            ? 'Rembourser cette demande sur Twitch ?'
            : 'Garder cette demande ?',
          body: refund
            ? 'Les points sont rendus au viewer (récompense de Raptoru).'
            : 'Rien n’est envoyé à Twitch : la réclamation reste en attente.',
          yes: refund ? 'Rembourser' : 'Garder la demande',
          no: 'Annuler',
          danger: refund,
        })
      )
        void post(
          el,
          `/requests/${el.dataset.id}/settle`,
          { decision: refund ? 'refund' : 'keep' },
          'Demande réglée',
        );
    },
    // Music Hub : la progression du skip payant (le Core valide et recalcule le prix suivant tout de suite).
    'sp-skip-rules': (el) =>
      post(
        el,
        '/music-rules',
        {
          viewer_skip_base_price: Number(field('vs-base')),
          viewer_skip_multiplier: Number(field('vs-mult').replace(',', '.')),
          viewer_skip_window_minutes: Number(field('vs-window')),
        },
        'Progression du skip payant enregistrée',
        ['vs-base', 'vs-mult', 'vs-window'],
      ),
    'sp-skip-defaults': (el) =>
      post(
        el,
        '/music-rules',
        {
          viewer_skip_base_price: 25_000,
          viewer_skip_multiplier: 2,
          viewer_skip_window_minutes: 30,
        },
        'Valeurs d’origine remises (◆ 25 000, ×2, 30 min)',
        ['vs-base', 'vs-mult', 'vs-window'],
      ),
    'sp-save': (el) => {
      const min = (f: string) => Math.round(Number(field(f)) * 60);
      return post(
        el,
        '/settings',
        {
          max_pending_per_viewer: Number(field('set-pending')),
          viewer_cooldown_seconds: min('set-cooldown'),
          max_duration_seconds: min('set-duration'),
          cancel_grace_seconds: Number(field('set-grace')),
        },
        'Quotas enregistrés',
        SETTINGS,
      );
    },
    'sp-historical': async (el) => {
      if (
        await confirmBox({
          title: 'Revenir aux valeurs historiques ?',
          body: '2 demandes en attente, 10 min entre deux demandes, 10 min de durée maximale, 10 s pour annuler sa musique en cours.',
          yes: 'Rétablir',
          no: 'Annuler',
          danger: false,
        })
      )
        void post(
          el,
          '/settings',
          HISTORICAL,
          'Valeurs historiques rétablies',
          SETTINGS,
        );
    },
    'sp-ov-save': (el) => {
      const cooldown = opt('ov-cooldown');
      return post(
        el,
        '/overrides',
        {
          viewer_login: field('ov-login'),
          max_pending_per_viewer: opt('ov-pending'),
          viewer_cooldown_seconds:
            cooldown === null ? null : Math.round(cooldown * 60),
        },
        'Exception enregistrée',
        ['ov-login', 'ov-pending', 'ov-cooldown'],
      );
    },
    'sp-ov-edit': (el) => {
      const login = el.dataset.login!;
      const o = state?.overrides?.find((x) => x.viewer_login === login);
      ui.fields['ov-login'] = login;
      ui.fields['ov-pending'] = String(o?.max_pending_per_viewer ?? '');
      ui.fields['ov-cooldown'] =
        o?.viewer_cooldown_seconds == null
          ? ''
          : String(o.viewer_cooldown_seconds / 60);
      paint();
    },
    'sp-ov-reset': async (el) => {
      const login = el.dataset.login!;
      if (
        await confirmBox({
          title: `@${login} revient aux valeurs globales ?`,
          body: 'Son exception est retirée.',
          yes: 'Retirer l’exception',
          no: 'Annuler',
          danger: false,
        })
      )
        void post(
          el,
          '/overrides',
          {
            viewer_login: login,
            max_pending_per_viewer: null,
            viewer_cooldown_seconds: null,
          },
          'Valeurs globales rétablies pour ce viewer',
        );
    },
    'sp-connect': async (el) => {
      const out = await post(
        el,
        '/connect',
        { client_id: field('client') },
        'Page Spotify ouverte dans le navigateur : accepte, puis reviens ici',
      );
      if (out?.url) window.open(String(out.url), '_blank');
    },
    'sp-disconnect': async (el) => {
      if (
        await confirmBox({
          title: 'Déconnecter Spotify de ce PC ?',
          body: 'Les demandes seront refusées.',
          yes: 'Déconnecter',
        })
      )
        void post(el, '/disconnect', {}, 'Spotify déconnecté');
    },
    'sp-reward': async (el) => {
      const title = field('rw-title') || REWARD_TITLE;
      const cost = Number(field('rw-cost') || 1500);
      const prompt = field('rw-prompt');
      if (
        await confirmBox({
          title: `Créer sur Twitch la récompense « ${title} » ?`,
          body: `Prix : ${cost} points, texte du viewer obligatoire (« ${prompt} »).\nCréée par l’application Twitch de Raptoru, avec le compte de la chaîne. Seules ses réclamations pourront être remboursées par Raptoru ; l’ancienne récompense (SAMMI) n’est pas touchée.\n\nAction réelle sur Twitch.`,
          yes: 'Créer sur Twitch',
          no: 'Annuler',
          danger: false,
        })
      )
        void post(
          el,
          '/reward',
          { title, cost, prompt },
          'Création demandée : le bot la fait sur Twitch',
        );
    },
    'sp-chat': (el) => {
      const who = simWho();
      if (!who) return;
      return void run(
        el,
        () =>
          postJson('/api/lab-chat/simulate', {
            viewer_id: who.value,
            display_name: who.textContent,
            login: who.dataset.login,
            role: who.dataset.role,
            text: el.dataset.text,
          }),
        undefined,
        ERRORS,
      ).then(read);
    },
    'sp-simulate': (el) => {
      const who = simWho();
      if (!who) return;
      return post(
        el,
        '/simulate',
        {
          viewer_id: who.value,
          viewer_login: (who.dataset.login || 'lab_viewer').toLowerCase(),
          user_input: field('sim-text'),
        },
        'Demande simulée envoyée',
      );
    },
    'sp-sim': (el) =>
      post(el, `/sim/${el.dataset.what}`, {}, 'Simulateur modifié'),
    // Music Hub : les musiques du stream, page suivante.
    'sp-hmore': () => loadPlayed(true),
    'sp-ovl': (el) =>
      run(
        el,
        async () => {
          await postJson('/api/spotify/overlays/visible', {
            visible: el.dataset.on === '1',
          });
          await readOvl();
        },
        el.dataset.on === '1'
          ? 'Overlay musique affiché'
          : 'Overlay musique masqué',
        ERRORS,
      ),
    // Lab : le live simulé (le même que la page Simulation) — l'historique ne note que pendant un live.
    'sp-live': (el) =>
      run(
        el,
        async () => {
          await postJson('/api/raffle/actions', {
            command: {
              action: el.dataset.on === '1' ? 'stream_start' : 'stream_end',
            },
          });
          if (list === 'played') await loadPlayed(false);
        },
        el.dataset.on === '1' ? 'Live simulé démarré' : 'Live simulé terminé',
        ERRORS,
      ),
    // Lab with the real account: allow (or stop) the writes for this session — a confirmation before allowing.
    'sp-lab-writes': (el) => {
      const on = el.dataset.on === '1';
      if (
        on &&
        !window.confirm(
          'Autoriser le Lab à ajouter des titres à TA file Spotify, à passer et à piloter ton lecteur pendant cette session ?',
        )
      )
        return;
      return post(
        el,
        '/lab-writes',
        { enabled: on },
        on ? 'Ajouts autorisés pour cette session' : 'Lab en lecture seule',
      );
    },
  };

  p.root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const sw = t.closest<HTMLElement>('[data-switch]');
    if (sw) return void setOpen(sw, sw.dataset.switch === 'on');
    const l = t.closest<HTMLElement>('[data-list]');
    if (l) {
      list = l.dataset.list as 'file' | 'past' | 'played';
      if (list === 'played') void loadPlayed(false);
      return paint();
    }
    const sim = t.closest<HTMLElement>('[data-sim-try]');
    if (sim) {
      ui.fields['sim-text'] = sim.dataset.simTry!;
      (document.activeElement as HTMLElement | null)?.blur();
      return paint();
    }
    const go = t.closest<HTMLElement>('[data-open]');
    if (go) return p.panel.open(go.dataset.open);
    const el = t.closest<HTMLElement>('[data-act]');
    if (el && state) void actions[el.dataset.act!]?.(el);
  });

  paintHead();
  return {
    setVisible(v: boolean) {
      if (v) {
        tick.start();
        clockTick.start();
        liveTick.start();
      } else {
        tick.stop();
        clockTick.stop();
        liveTick.stop();
      }
    },
  };
}
