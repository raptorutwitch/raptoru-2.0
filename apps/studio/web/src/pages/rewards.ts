import {
  confirmBox,
  copy,
  drawer,
  errText,
  esc,
  fld,
  grp,
  ic,
  keyed,
  menu,
  page,
  panelBtn,
  patch,
  poller,
  pop,
  row,
  run,
  seg,
  stateChip,
  sw,
  toast,
  type Drawer,
  streamTestConfirm,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import { cpBlocker } from '../shell/regie.js';
import {
  actionIcon,
  actionLabel,
  CP_OFF,
  CP_ON,
  effectItems,
  effectsFact,
  INTERACTIONS,
  isNotable,
  masterChip,
  runNowConfirm,
  runNowLines,
  statusView,
  takeReward,
  textChoices,
  type CpActionView,
  type CpRedemption,
  type CpReward,
  type CpState,
} from './rewards-model.js';
import {
  ADD_KINDS,
  actionTitle,
  addKindsHtml,
  feedRow,
  filtersHtml,
  galleryHtml,
  kindOf,
  requestHtml,
  requestsOf,
  tile,
  twitchState,
  type Filter,
} from './rewards-view.js';

// Récompenses Twitch. La page principale sert à parcourir et suivre : la galerie des récompenses (ce qu'elles coûtent, si elles
// sont achetables, ce qu'elles déclenchent, interrupteur de leurs actions) et le fil des demandes reçues. Régler une récompense
// se fait dans sa fiche, un panneau latéral en trois temps : la récompense sur Twitch (lue, jamais modifiée), les actions de
// Raptoru (la règle du Core), le test et les demandes de cette récompense. L'interrupteur général vit dans le Core, coupé par
// défaut, et demande une confirmation. Un test exécute la règle enregistrée (OBS, sons, effets) sur un clic explicite.

const MAX_STEPS = 5;
const ERRORS = {
  version_conflict: 'Modifiée ailleurs entre-temps : recharge la récompense.',
  invalid_request:
    'Action incomplète : choisis un son, une scène, une source ou un filtre, ou un nombre de crédits.',
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
const reqKey = (x: CpRedemption) => `${x.source}:${x.redemption_id}`;

export function mountRewardsPage(root: HTMLElement) {
  const p = page(root, {
    title: 'Récompenses Twitch',
    mod: 'rewards',
    panel: true,
  });
  p.body.innerHTML = `<div class="rwp">
    <div class="rwp-facts" data-z="pulse"></div>
    <section class="rwp-gal" aria-label="Récompenses">
      <div class="rwp-bar">
        <label class="d-fld rwp-find">${ic('search')}<input type="search" data-find placeholder="Chercher une récompense" aria-label="Chercher une récompense"></label>
        <div class="rwp-chips" role="group" aria-label="Filtrer" data-z="filters"></div>
      </div>
      <div data-z="master"></div>
      <div class="rwp-grid" data-z="grid"></div>
    </section>
    <aside class="rwp-feed" aria-label="Demandes reçues">
      <header class="rwp-fh"><h2>Demandes</h2><span class="d-sp"></span><span data-z="feedtabs"></span></header>
      <div class="rwp-fl" data-z="feed"></div>
      <p class="rwp-fn">Chaque rachat sur Twitch, et chaque test, avec ce que Raptoru a exécuté.</p>
    </aside>
    <datalist id="rw-scenes"></datalist><datalist id="rw-sources"></datalist><datalist id="rw-filters"></datalist>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let s: CpState | null = null;
  let error: string | null = null;
  let find = '';
  let filter: Filter = 'all';
  let feedTab: 'all' | 'look' = 'all';
  let audio: HTMLAudioElement | null = null;
  /** Les brouillons gardés quand une fiche se ferme sans enregistrer : la carte le signale, la fiche les reprend. */
  const drafts = new Map<string, { draft: Draft; base: string }>();

  // La fiche ouverte (une à la fois).
  let fiche: {
    id: string;
    dr: Drawer;
    draft: Draft;
    /** La règle lue quand le brouillon a été pris : « modifié » se mesure à elle. */
    base: string;
    openStep: number | null;
    conflict: boolean;
    testInput: string;
  } | null = null;

  const rewardOf = (id: string | undefined) =>
    s?.rewards.find((r) => r.id === id) ?? null;
  const dirty = () => !!fiche && JSON.stringify(fiche.draft) !== fiche.base;

  // --- Lectures ---------------------------------------------------------------------------------------------------
  async function read() {
    try {
      s = await getJson<CpState>('/api/channel-points/state');
      error = null;
    } catch (e) {
      error = errText(e);
    }
    paint();
    const asked = takeReward();
    if (asked && rewardOf(asked)) openFiche(asked);
    else if (fiche) refreshFiche();
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

  // --- Page principale ----------------------------------------------------------------------------------------------
  function paintHead() {
    patch(p.state, masterChip(s, error, s && cpBlocker(s)));
    patch(
      p.actions,
      `<span class="d-lb rwp-ml" title="L’interrupteur général : coupé, aucune récompense ne déclenche d’action Raptoru">Automatisations Raptoru</span>${sw(!!s?.settings.enabled, 'data-master', 'Automatisations Raptoru (toutes les récompenses)', { disabled: !s })}${panelBtn(p.panel.isOpen())}`,
    );
  }
  function paintGallery() {
    if (!s) {
      patch(z('filters'), '');
      patch(
        z('grid'),
        error
          ? ''
          : '<div class="d-skel" style="height:120px"></div><div class="d-skel" style="height:120px"></div>',
      );
      return;
    }
    if (!s.rewards.length) {
      patch(z('filters'), '');
      patch(
        z('grid'),
        s.environment === 'lab'
          ? `<div class="rwp-empty">${ic('gift')}<h3>Le Lab n’a pas de vrai Twitch</h3><p>Aucune récompense n’arrive ici. Le catalogue fictif crée des récompenses et des actions d’exemple par les mêmes règles du Core. Rien ne va sur Twitch ni en Production.</p><button type="button" class="d-btn pri" data-lab-catalog>${ic('plus')}Charger le catalogue fictif</button></div>`
          : `<div class="rwp-empty">${ic('gift')}<h3>Aucune récompense connue</h3><p>Elles apparaissent dès que Twitch les liste, ou au premier rachat d’un viewer.</p></div>`,
      );
      return;
    }
    patch(z('filters'), filtersHtml(s, filter));
    // L'interrupteur général coupé : les cartes gardent leur réglage, mais rien ne s'exécute. Dit une fois, au-dessus.
    patch(
      z('master'),
      s.settings.enabled
        ? ''
        : `<p class="rwp-master">${ic('pause')}<span><b>Automatisations coupées.</b> Les récompenses restent achetables sur Twitch, mais aucune ne déclenche ses actions Raptoru. Les tests restent possibles.</span><button type="button" class="d-btn sm" data-master-on>Activer…</button></p>`,
    );
    const html = galleryHtml(s, filter, find, new Set(drafts.keys()));
    if (!html.startsWith('<article')) return patch(z('grid'), html);
    // Les cartes gardent leur élément (focus, interrupteur) entre deux relevés.
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    keyed(
      z('grid'),
      [...tmp.children].map((el) => ({
        key: (el as HTMLElement).dataset.card ?? '',
        html: el.outerHTML,
      })),
      '',
    );
  }
  function paintFeed() {
    const look = s ? s.recent.filter(isNotable).length : 0;
    patch(
      z('feedtabs'),
      seg(
        'data-feed',
        [
          ['all', 'Toutes'],
          ['look', look ? `À vérifier · ${look}` : 'À vérifier'],
        ],
        feedTab,
      ),
    );
    if (!s) return;
    const rows = s.recent.filter((x) => feedTab === 'all' || isNotable(x));
    keyed(
      z('feed'),
      rows.map((x) => ({ key: reqKey(x), html: feedRow(x) })),
      `<div class="d-empty">${feedTab === 'all' ? 'Aucune demande pour l’instant. Ouvre une récompense et clique « Tester » pour en voir une.' : 'Rien à vérifier : ni échec, ni retard, ni remboursement.'}</div>`,
    );
  }
  const paintPanel = () => {
    const fx = s ? effectsFact(s.effects) : null;
    const tw = s?.twitch;
    p.panel.set(`${grp(
      'Réception Twitch',
      'gift',
      `<div class="d-row col" data-k="twitch réception autorisation lecture seule"><small>Les récompenses viennent de Twitch, en lecture seule : Raptoru ne les crée pas ici, ne les modifie pas et ne rembourse que celles qu’il a créées. Les actions sont celles de Raptoru.</small>${tw?.profile_note ? `<small>${esc(tw.profile_note)}</small>` : ''}</div>`,
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
    paintGallery();
    paintFeed();
    paintPanel();
  }

  // --- La fiche -------------------------------------------------------------------------------------------------------
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
    `<span class="rwf-f ${cls}"><small>${esc(label)}</small>${ctl}</span>`;
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
      'rwf-num',
    );
  const volume = (i: number, v: number) =>
    field(
      'Volume',
      `<span class="rwf-vol"><input class="d-range" type="range" min="0" max="100" step="1" data-a="volume" data-i="${i}" value="${v}" aria-label="Volume"><b data-vol="${i}">${v} %</b></span>`,
    );

  /** Les réglages d'une action. Son type ne change pas ici : on retire l'action et on en ajoute une autre. */
  function fields(a: CpActionView, i: number) {
    if (a.type === 'effect_sound')
      return `${field(
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
        'rwf-wide',
      )}${volume(i, a.volume)}<button type="button" class="d-btn sm" data-listen="${i}" ${a.sound_id ? '' : 'disabled'} title="Ici, dans Studio, pas dans OBS">${ic('play')}Écouter</button>`;
    if (a.type === 'effect_video')
      return `${field(
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
        'rwf-wide',
      )}${volume(i, a.volume)}`;
    if (a.type === 'sound')
      return field(
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
        'rwf-wide',
      );
    if (a.type === 'obs_source')
      return `${text(i, 'scene', a.scene, 'rw-scenes', 'Scène')}${text(i, 'source', a.source, 'rw-sources', 'Source')}${field(
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
    if (a.type === 'obs_filter')
      return `${text(i, 'source', a.source, 'rw-sources', 'Source')}${text(i, 'filter', a.filter, 'rw-filters', 'Filtre')}${field(
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
    if (a.type === 'interaction') {
      const it = INTERACTIONS[a.interaction];
      return `<p class="rwf-desc">${esc(it?.description ?? '')}</p>${it ? `<a class="d-btn ghost sm" href="/?p=${it.page}">${ic('arrow')}Régler ${esc(it.page === 'effects' ? 'Effets et lecteur' : it.label)}</a>` : ''}`;
    }
    if (a.type === 'credits') {
      const tts = a.currency === 'credits_tts';
      return `${field(
        tts ? 'Crédits TTS par achat' : 'Crédits Soundboard par achat',
        fld(
          `data-a="amount" data-i="${i}" min="1" max="1000" step="1" placeholder="à choisir" aria-label="Nombre de crédits"`,
          a.amount || '',
          'cr',
        ),
        'rwf-num',
      )}<p class="rwf-desc">${
        tts
          ? 'Le viewer qui rachète reçoit ces crédits TTS : un message TTS en consomme selon sa longueur, au lieu de Jetons.'
          : 'Le viewer qui rachète reçoit ces crédits Soundboard : un son en consomme, au lieu de Jetons.'
      } Versés une fois par achat, repris si Twitch annule l’achat. C’est cette action, pas le nom de la récompense, qui décide ce qui est versé.</p>`;
    }
    return `${text(i, 'scene', a.scene, 'rw-scenes', 'Scène')}${duration(i, a.duration_ms)}`;
  }

  const stepLabel = (a: CpActionView) =>
    actionLabel(a, s?.sounds, effectItems(s?.effects));

  /** Bloc 1 : la récompense sur Twitch, en lecture. */
  function twHtml(r: CpReward) {
    const tw = twitchState(r);
    return `<div class="rwf-tw">
      ${tile(r, true)}
      <div class="rwf-twb">
        <p class="rwf-k">${ic('gift')}Sur Twitch<span class="d-tag ${tw.tone}">${esc(tw.text)}</span></p>
        <h3>${esc(r.title)}</h3>
        ${r.prompt ? `<p class="rwf-prompt">${esc(r.prompt)}</p>` : ''}
        <p class="rwf-facts"><span><b class="d-num">${r.cost.toLocaleString('fr-FR')}</b> points de chaîne</span>${r.user_input_required ? `<span>${ic('chat')}Le viewer écrit un texte</span>` : ''}</p>
      </div>
    </div>
    <p class="rwf-note">${ic('info')}<span>Nom, coût, image, disponibilité : ils se règlent sur Twitch, Studio les lit${r.listed_by_twitch ? '' : ' (celle-ci n’est connue que par un achat reçu)'}. Rien n’est créé ni modifié sur Twitch d’ici.</span></p>`;
  }
  /** Bloc 2 : les actions de Raptoru, la seule partie réglée ici. */
  function actsHtml(r: CpReward) {
    const f = fiche!;
    const d = f.draft;
    return `<header class="rwf-h"><span class="rwf-k">${ic('bolt')}Ce que fait Raptoru</span><span class="d-sp"></span><span class="d-faint" data-rule-state>${d.enabled ? 'Actions actives' : 'Actions coupées'}</span>${sw(d.enabled, 'data-rule', `Actions Raptoru de ${r.title}`)}</header>
    <ol class="rwf-acts${d.enabled ? '' : ' is-off'}">
      ${d.actions
        .map(
          (
            a,
            i,
          ) => `<li class="rwa k-${kindOf(a)}${f.openStep === i ? ' is-open' : ''}">
            <div class="rwa-h">
              <button type="button" class="rwa-t" data-step="${i}" aria-expanded="${f.openStep === i}">
                <span class="rwa-ic">${ic(actionIcon(a))}</span>
                <span class="rwa-n"><b>${esc(actionTitle(a))}</b><small data-label="${i}">${esc(stepLabel(a))}</small></span>
                ${ic('down', 'rwa-chev')}
              </button>
              <button type="button" class="d-ib" data-more="${i}" aria-label="Déplacer ou retirer l’action ${i + 1}">${ic('more')}</button>
            </div>
            ${f.openStep === i ? `<div class="rwa-b">${fields(a, i)}</div>` : ''}
          </li>`,
        )
        .join('')}
    </ol>
    ${
      d.actions.length
        ? ''
        : '<p class="rwf-none">Aucune action : ce rachat ne déclenche rien dans Raptoru. Ajoute un son, un effet, une interaction, une action OBS ou des crédits.</p>'
    }
    <button type="button" class="d-btn sm rwf-add" data-add ${d.actions.length >= MAX_STEPS ? `disabled title="${MAX_STEPS} actions au maximum"` : ''}>${ic('plus')}Ajouter une action</button>`;
  }
  /** Bloc 3 : le test de la version enregistrée. */
  function testHtml(r: CpReward) {
    const f = fiche!;
    const saved = r.rule?.actions ?? [];
    const lab = s?.environment === 'lab';
    const choices = textChoices(r);
    const lines = runNowLines(saved, s?.sounds, effectItems(s?.effects));
    return `<header class="rwf-h"><span class="rwf-k">${ic('flask')}${lab ? 'Tester dans le Lab' : 'Tester'}</span></header>
      ${
        dirty()
          ? '<p class="rwf-none">Enregistre d’abord : le test joue la version enregistrée.</p>'
          : saved.length
            ? `<ul class="rwf-lines">${lines.map((l) => `<li>${esc(l.replace(/^• /, ''))}</li>`).join('')}</ul>`
            : '<p class="rwf-none">Aucune action enregistrée à tester.</p>'
      }
      <div class="rwf-try">
        ${choices ? `<label class="d-fld rwf-tryin">${ic('chat')}<input type="text" data-try list="rw-text" maxlength="500" value="${esc(f.testInput || choices[0]!)}" aria-label="Ce qu’un viewer écrirait" title="Ce qu’un viewer écrirait (texte inconnu possible)"></label><datalist id="rw-text">${choices.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>` : ''}
        <button type="button" class="d-btn" data-test ${r.rule && saved.length && !dirty() ? '' : 'disabled'}>${ic('play')}${lab ? 'Tester' : 'Tester pour de vrai…'}</button>
        <small class="d-faint">Aucun point de chaîne utilisé ; le test s’inscrit dans les demandes.</small>
      </div>`;
  }
  /** Bloc 4 : les demandes de cette récompense. */
  function reqsHtml(r: CpReward) {
    const list = s ? requestsOf(s, r) : [];
    return `<header class="rwf-h"><span class="rwf-k">${ic('hist')}Demandes de cette récompense</span><span class="d-sp"></span><span class="d-faint">${list.length || 'aucune'}</span></header>
      ${list.length ? `<div class="rwf-reqs">${list.slice(0, 12).map(feedRow).join('')}</div>` : '<p class="rwf-none">Aucune demande récente.</p>'}`;
  }
  function footHtml() {
    const f = fiche!;
    if (f.conflict)
      return `<span class="d-note bad">${esc(ERRORS.version_conflict)}</span><span class="d-sp"></span><button type="button" class="d-btn sm" data-reload>Recharger</button>`;
    if (dirty())
      return `<span class="d-muted">Pas encore enregistré</span><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-revert>Annuler</button><button type="button" class="d-btn pri sm" data-save>Enregistrer</button>`;
    return '';
  }

  const fz = (k: string) =>
    fiche?.dr.el.querySelector<HTMLElement>(`[data-fz="${k}"]`) ?? null;
  function paintActs() {
    const r = rewardOf(fiche?.id);
    if (!fiche || !r) return;
    fz('acts')!.innerHTML = actsHtml(r);
    paintFicheFoot();
  }
  function paintFicheFoot() {
    const r = rewardOf(fiche?.id);
    if (!fiche || !r) return;
    if (!fiche.dr.el.querySelector('[data-try]:focus'))
      patch(fz('test'), testHtml(r));
    fiche.dr.set({ foot: footHtml() });
    const st = fiche.dr.el.querySelector('[data-rule-state]');
    if (st)
      st.textContent = fiche.draft.enabled
        ? 'Actions actives'
        : 'Actions coupées';
    fiche.dr.el
      .querySelector('.rwf-acts')
      ?.classList.toggle('is-off', !fiche.draft.enabled);
  }
  function refreshFiche() {
    const f = fiche!;
    const r = rewardOf(f.id);
    if (!r) return f.dr.close();
    f.dr.set({ title: r.title });
    patch(fz('tw'), twHtml(r));
    patch(fz('reqs'), reqsHtml(r));
    // Une règle changée ailleurs : reprise si rien n'est en cours ici.
    if (!dirty() && JSON.stringify(copyRule(r)) !== f.base) {
      f.draft = copyRule(r);
      f.base = JSON.stringify(f.draft);
      paintActs();
    } else paintFicheFoot();
  }
  function openFiche(id: string) {
    const r = rewardOf(id);
    if (!r || fiche?.id === id) return;
    const kept = drafts.get(id);
    const draft = kept?.draft ?? copyRule(r);
    const dr = drawer({
      kicker: 'Récompense',
      title: r.title,
      body: `<div class="rwf">
        <section class="rwf-s rwf-s1" data-fz="tw" aria-label="La récompense sur Twitch"></section>
        <div class="rwf-arrow" aria-hidden="true">${ic('down')}<span>rachetée, elle déclenche</span></div>
        <section class="rwf-s rwf-s2" data-fz="acts" aria-label="Ce que fait Raptoru"></section>
        <section class="rwf-s rwf-s3" data-fz="test" aria-label="Tester"></section>
        <section class="rwf-s rwf-s4" data-fz="reqs" aria-label="Demandes de cette récompense"></section>
      </div>`,
      onClose: () => {
        // Les changements non enregistrés restent sur la carte, la fiche les reprend à la prochaine ouverture.
        if (fiche && dirty())
          drafts.set(fiche.id, { draft: fiche.draft, base: fiche.base });
        else if (fiche) drafts.delete(fiche.id);
        fiche = null;
        audio?.pause();
        paintGallery();
      },
    });
    dr.el.classList.add('rwf-drawer');
    fiche = {
      id,
      dr,
      draft,
      base: kept?.base ?? JSON.stringify(copyRule(r)),
      openStep: draft.actions.length === 1 ? 0 : null,
      conflict: false,
      testInput: '',
    };
    drafts.delete(id);
    bindFiche(dr.el);
    patch(fz('tw'), twHtml(r));
    patch(fz('reqs'), reqsHtml(r));
    paintActs();
    paintGallery();
    void loadLists();
    dr.el.querySelector('.d-drawer__b')?.scrollTo(0, 0);
  }

  /** Brouillon → règle du Core : une durée vide veut dire permanent. */
  const toRule = (d: Draft) =>
    d.actions.map((a) => {
      const c = { ...a } as CpActionView & { duration_ms?: number };
      if ('duration_ms' in c && !c.duration_ms) delete c.duration_ms;
      return c;
    });
  async function save(btn: HTMLElement) {
    const f = fiche;
    const r = rewardOf(f?.id);
    if (!f || !r) return;
    btn.classList.add('is-busy');
    try {
      await postJson(`/api/channel-points/rules/${r.id}`, {
        enabled: f.draft.enabled,
        actions: toRule(f.draft),
        ...(r.rule ? { expected_version: r.rule.version } : {}),
      });
      toast('Actions enregistrées');
      s = await getJson<CpState>('/api/channel-points/state');
      const fresh = rewardOf(f.id);
      if (fresh && fiche === f) {
        f.draft = copyRule(fresh);
        f.base = JSON.stringify(f.draft);
        f.openStep = null;
        paintActs();
        patch(fz('reqs'), reqsHtml(fresh));
      }
      paint();
    } catch (e) {
      f.conflict = (e as { code?: string }).code === 'version_conflict';
      if (!f.conflict) toast(errText(e, ERRORS), { bad: true });
      paintFicheFoot();
    } finally {
      btn.classList.remove('is-busy');
    }
  }
  async function test(btn: HTMLElement) {
    const f = fiche;
    const r = rewardOf(f?.id);
    if (!f || !r) return;
    const yes = await streamTestConfirm({
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
          ...(choices ? { user_input: f.testInput || choices[0]! } : {}),
        }),
      'Test envoyé : il s’affiche dans les demandes',
    );
    if (ok) tick.now();
  }
  /** Couper ou rallumer les actions d'une récompense depuis sa carte : la règle enregistrée, actions inchangées. */
  async function toggleRule(id: string, on: boolean, input: HTMLInputElement) {
    const r = rewardOf(id);
    if (!r?.rule) return;
    const actions = r.rule.actions;
    const put = (enabled: boolean, version: number) =>
      postJson(`/api/channel-points/rules/${r.id}`, {
        enabled,
        actions,
        expected_version: version,
      });
    input.disabled = true;
    try {
      await put(on, r.rule.version);
      s = await getJson<CpState>('/api/channel-points/state');
      paint();
      toast(
        on
          ? `« ${r.title} » : actions Raptoru rallumées`
          : `« ${r.title} » : actions Raptoru coupées`,
        {
          undo: () => {
            const now = rewardOf(id)?.rule;
            if (now)
              void put(!on, now.version)
                .then(() => tick.now())
                .catch((e) => toast(errText(e, ERRORS), { bad: true }));
          },
        },
      );
    } catch (e) {
      input.checked = !on;
      toast(errText(e, ERRORS), { bad: true });
      tick.now();
    } finally {
      input.disabled = false;
    }
  }
  function stepMenu(b: HTMLElement, i: number) {
    const f = fiche!;
    const d = f.draft;
    const move = (to: number) => {
      const [a] = d.actions.splice(i, 1);
      d.actions.splice(to, 0, a!);
      f.openStep = null;
      paintActs();
    };
    menu(b, `Action ${i + 1}`, [
      { label: 'Monter', disabled: i === 0, run: () => move(i - 1) },
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
          f.openStep = null;
          paintActs();
        },
      },
    ]);
  }
  function addMenu(b: HTMLElement) {
    const f = fiche!;
    const el = pop(
      b,
      `<h3>Ajouter une action</h3>${addKindsHtml()}`,
      undefined,
      { cls: 'rwk-pop' },
    );
    el.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
      const kind = ADD_KINDS.find((x) => x.id === k?.dataset.kind);
      if (!kind || f.draft.actions.length >= MAX_STEPS) return;
      el.hidePopover();
      f.draft.actions.push(kind.make());
      f.openStep = f.draft.actions.length - 1;
      paintActs();
      fz('acts')
        ?.querySelector<HTMLElement>('.rwa.is-open input, .rwa.is-open select')
        ?.focus();
    });
  }

  function bindFiche(el: HTMLElement) {
    el.addEventListener('click', (e) => {
      const f = fiche;
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!f || !b) return;
      if (b.dataset.req) return openRequest(b.dataset.req);
      if (b.dataset.step) {
        const i = Number(b.dataset.step);
        f.openStep = f.openStep === i ? null : i;
        return paintActs();
      }
      if (b.dataset.more) return stepMenu(b, Number(b.dataset.more));
      if (b.matches('[data-add]')) return addMenu(b);
      if (b.dataset.listen !== undefined) {
        const a = f.draft.actions[Number(b.dataset.listen)];
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
      const fl = b.dataset.b;
      if (fl) {
        const a = f.draft.actions[Number(b.dataset.i)] as unknown as Record<
          string,
          unknown
        >;
        a[fl] = b.dataset.v === '1';
        return paintActs();
      }
      if (b.matches('[data-save]')) return void save(b);
      if (b.matches('[data-test]')) return void test(b);
      if (b.matches('[data-revert]') || b.matches('[data-reload]')) {
        const r = rewardOf(f.id);
        if (!r) return;
        f.draft = copyRule(r);
        f.base = JSON.stringify(f.draft);
        f.conflict = false;
        f.openStep = null;
        paintActs();
      }
    });
    el.addEventListener('input', (e) => {
      const f = fiche;
      const t = e.target as HTMLInputElement;
      if (!f) return;
      if (t.matches('[data-try]')) {
        f.testInput = t.value.slice(0, 500);
        return;
      }
      const k = t.dataset.a;
      if (!k) return;
      const i = Number(t.dataset.i);
      const a = f.draft.actions[i] as unknown as Record<string, unknown>;
      if (!a) return;
      if (k === 'volume') {
        a.volume = Number(t.value);
        const v = el.querySelector(`[data-vol="${i}"]`);
        if (v) v.textContent = `${t.value} %`;
      } else if (k === 'amount') a.amount = Math.round(Number(t.value) || 0);
      else if (k === 'duration') {
        const n = Number(t.value);
        if (n > 0) a.duration_ms = Math.round(n * 1000);
        else delete a.duration_ms;
      } else if (k === 'sound_id' || k === 'video_id') {
        a[k] = t.value;
        // Un média choisi : son volume d'origine par défaut.
        if (a.type !== 'sound')
          a.volume =
            effectItems(s?.effects).find((x) => x.id === t.value)?.volume ??
            100;
        return paintActs();
      } else a[k] = t.value.trim();
      const label = el.querySelector(`[data-label="${i}"]`);
      if (label) label.textContent = stepLabel(f.draft.actions[i]!);
      if (k === 'scene' || k === 'source')
        void loadLists(String(a.scene ?? ''), String(a.source ?? ''));
      paintFicheFoot();
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (fiche && t.matches('[data-rule]')) {
        fiche.draft.enabled = t.checked;
        paintFicheFoot();
      }
    });
  }

  function openRequest(key: string) {
    const x = s?.recent.find((y) => reqKey(y) === key);
    if (!x || !s) return;
    const r =
      s.rewards.find((w) => w.id === x.reward.id) ??
      s.rewards.find((w) => w.title === x.reward.title) ??
      null;
    const dr = drawer({
      kicker: 'Demande',
      title: x.reward.title,
      body: requestHtml(x, s, r),
    });
    dr.el.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-open]')
        ?.dataset.open;
      if (!id) return;
      dr.close();
      setTimeout(() => openFiche(id), 0);
    });
  }

  // --- Interaction de la page principale ------------------------------------------------------------------------------
  p.root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.open) return openFiche(b.dataset.open);
    if (b.dataset.req) return openRequest(b.dataset.req);
    const fl = b.dataset.filter as Filter | undefined;
    if (fl) {
      filter = fl;
      return paintGallery();
    }
    const ft = b.dataset.feed as typeof feedTab | undefined;
    if (ft) {
      feedTab = ft;
      return paintFeed();
    }
    if (b.matches('[data-copy]'))
      return copy(s?.effects?.url ?? '', 'Adresse copiée');
    if (b.matches('[data-master-on]')) {
      const m = p.root.querySelector<HTMLInputElement>('[data-master]');
      if (m && !m.checked) m.click();
      return;
    }
    if (b.matches('[data-lab-catalog]'))
      void run(
        b,
        () => postJson('/api/channel-points/lab-catalog', {}),
        'Catalogue fictif chargé',
      ).then(() => tick.now());
  });
  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-find]')) {
      find = t.value;
      paintGallery();
    }
  });
  p.root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const rid = t.dataset.ruleToggle;
    if (rid) return void toggleRule(rid, t.checked, t);
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

  paint();
  return {
    setVisible(v: boolean) {
      if (v) tick.start();
      else {
        tick.stop();
        audio?.pause();
        fiche?.dr.close();
      }
    },
  };
}
