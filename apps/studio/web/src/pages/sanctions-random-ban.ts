import {
  confirmBox,
  drawer,
  errText,
  esc,
  grp,
  hhmm,
  ic,
  keyed,
  page,
  panelBtn,
  patch,
  poller,
  run,
  seg,
  stateChip,
} from '../ds/ds.js';
import { getJson, postJson } from '../http.js';
import { openViewer } from '../mod/mod.js';
import { loadSettings, type SettingView } from '../module-settings.js';
import {
  askReward,
  triggersHtml,
  usesRandomBan,
  type CpState,
} from './rewards-model.js';
import {
  rbDetail,
  rbDraw,
  rbLocks,
  rbRow,
  rbTrace,
  type RbState,
  type RbView,
} from './sanctions-model.js';
import { bindSettings, settingRows } from './setting-rows.js';

// Random Ban : le barème du tirage, ce qui permet de sanctionner, le suivi des demandes. Studio ne touche jamais Twitch : le Core
// et le bot décident et appliquent. Un vrai Random Ban ne vient que d'une récompense ou de !rb, jamais de cette page. Deux essais
// sont sans sanction, deux sont réels : ils sont séparés, nommés, et disent chacun ce qu'ils font avant de partir.

export function mountRandomBanPage(root: HTMLElement) {
  const p = page(root, { title: 'Random Ban', mod: 'sanction', panel: true });
  p.body.innerHTML = `<div class="sx">
    <section class="sx-main">
      <h2 class="d-lb">Le tirage</h2>
      <div class="sx-draw" data-z="draw"></div>
      <h2 class="d-lb sx-h">Suivi des demandes</h2>
      <div class="sx-ledger" data-z="ledger"></div>
    </section>
    <aside class="sx-side">
      <h2 class="d-lb">Avant de sanctionner</h2>
      <div class="sx-locks" data-z="locks"></div>
      <h2 class="d-lb sx-h">Essais sans sanction</h2>
      <div class="sx-tests" data-z="tests"></div>
      <h2 class="d-lb sx-h sx-real">Essais réels</h2>
      <div class="sx-tests is-real">
        <button type="button" class="d-btn bad sm" data-t="mute">${ic('mic')}Couper mon micro 60 s…</button>
        <button type="button" class="d-btn bad sm" data-t="caution">${ic('shield')}Sanction Caution de test…</button>
      </div>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let s: RbState | null = null;
  let cp: CpState | null = null;
  let error: string | null = null;
  let settings: SettingView[] | null = null;
  let outcome = 'ban';

  async function read() {
    try {
      s = await getJson<RbState>('/api/random-ban/state');
      error = null;
    } catch (e) {
      error = errText(e);
    }
    cp = await getJson<CpState>('/api/channel-points/state').catch(() => cp);
    paint();
  }
  const tick = poller(read, 3000);

  const per10 = () =>
    settings?.find((x) => x.key === 'caution.mute_price_per_10s')?.value;

  function paintPanel() {
    const trace = s ? rbTrace(s) : '';
    const media = s?.effects?.media ?? [];
    p.panel
      .set(`${grp('Prix dans le chat', 'coin', settingRows(settings, ['random_ban.price']), 'prix rb')}
      ${grp('Déclencheurs', 'gift', `<div class="d-row col" data-k="déclencheurs récompenses liaisons points de chaîne">${triggersHtml(cp, error, usesRandomBan)}<small>Activation : une récompense dont l’action est l’interaction native Random Ban.</small></div>`)}
      ${grp('Suivi du streamer', 'activity', `<div class="d-row col" data-k="suivi streamer tirage malchance"><small>${esc(trace || 'Aucun Random Ban réel suivi pour l’instant.')}</small></div>`)}
      ${grp('Animations', 'film', media.length ? media.map((m) => `<div class="d-row" data-k="animations ${esc(m.label.toLowerCase())}"><span>${esc(m.label.replace('Random Ban — ', ''))}</span>${m.available ? '<span class="d-tag ok">Importée</span>' : '<span class="d-tag warn">À importer</span>'}</div>`).join('') : '<p class="d-note">Lecteur d’effets indisponible.</p>')}`);
  }
  function paint() {
    const e = s?.executor;
    patch(
      p.state,
      !s
        ? stateChip('w', error ?? 'Lecture…')
        : error
          ? stateChip('w', error)
          : !e
            ? stateChip('r', 'Exécuteur Twitch absent')
            : !e.can_timeout
              ? stateChip('r', 'Droit de timeout manquant')
              : !e.can_search
                ? stateChip('w', 'Recherche impossible')
                : stateChip('', 'Prêt'),
    );
    patch(p.actions, panelBtn(p.panel.isOpen()));
    patch(
      z('draw'),
      s
        ? rbDraw(s, per10())
        : error
          ? `<div class="d-empty">${esc(error)}</div>`
          : '<div class="d-skel" style="height:150px"></div>',
    );
    patch(z('locks'), s ? rbLocks(s) : '');
    patch(
      z('tests'),
      `<div class="sx-try"><span>${seg(
        'data-out',
        [
          ['ban', 'Ban'],
          ['csc', 'CSC'],
          ['flop', 'Flop'],
        ],
        outcome,
      )}</span><button type="button" class="d-btn sm" data-t="anim">${ic('film')}Jouer l’animation…</button></div>
      <button type="button" class="d-btn sm" data-t="dry">${ic('dice')}Tirage à blanc…</button>`,
    );
    keyed(
      z('ledger'),
      (s?.recent ?? []).map((r) => ({ key: r.request_id, html: rbRow(r) })),
      `<div class="d-empty">${s ? 'Aucun Random Ban.' : ''}</div>`,
    );
    paintPanel();
  }

  function openRow(r: RbView) {
    const d = drawer({
      kicker: `Random Ban · ${hhmm(r.created_at)}`,
      title: r.target?.name ?? r.buyer.name,
      body: rbDetail(r),
      foot: `<button type="button" class="d-btn ghost sm" data-see="${esc(r.buyer.id)}">${ic('user')}Fiche de l’acheteur</button>${r.target && r.target.id !== r.buyer.id ? `<button type="button" class="d-btn ghost sm" data-see="${esc(r.target.id)}">${ic('user')}Fiche de la cible</button>` : ''}`,
    });
    d.el.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-see]')
        ?.dataset.see;
      if (id) openViewer(id);
    });
  }

  const TESTS = {
    anim: {
      title: 'Jouer l’animation sur le stream ?',
      body: 'L’animation s’affiche dans OBS par le lecteur d’effets. Aucun appel Twitch, aucune sanction.',
      yes: 'Jouer l’animation',
      done: 'Animation envoyée au lecteur d’effets',
      danger: false,
    },
    dry: {
      title: 'Lancer un tirage à blanc ?',
      body: 'La vraie recherche est faite sur Twitch, en lecture seule ; personne n’est mis en timeout. L’animation du résultat est jouée.',
      yes: 'Tirer à blanc',
      done: 'Tirage à blanc envoyé : voir le suivi',
      danger: false,
    },
    mute: {
      title: 'Couper ton micro 60 s pour de vrai ?',
      body: 'Ton micro est VRAIMENT coupé dans OBS pendant 60 s, puis rétabli.\n\nRien d’autre : aucun appel Twitch, aucun Jeton, aucun point, aucun message dans le chat, aucune animation, aucune caution possible.',
      yes: 'Couper mon micro',
      done: 'Mute du streamer envoyé : voir le suivi',
      danger: true,
    },
    caution: {
      title: 'Créer une sanction Caution réelle ?',
      body: 'Une VRAIE sanction Random Ban est créée sur ton compte pendant 60 s : micro coupé, zoom et MUTED dans OBS.\n\nElle est reconnue par !caution raptoru_ : si quelqu’un répond « oui » au devis, ses JETONS SONT VRAIMENT DÉBITÉS et tu es libéré.\n\nAucun tirage, aucun viewer visé, aucun timeout Twitch, aucun point de chaîne, hors statistiques des tirages.',
      yes: 'Créer la sanction',
      done: 'Sanction de test créée : !caution raptoru_ peut la lever (Jetons réels)',
      danger: true,
    },
  };
  async function test(b: HTMLElement, kind: keyof typeof TESTS) {
    const t = TESTS[kind];
    const yes = await confirmBox({ ...t, no: 'Annuler' });
    if (!yes) return;
    const ok = await run(
      b,
      () =>
        kind === 'anim'
          ? postJson('/api/random-ban/test', { mode: 'animation', outcome })
          : kind === 'dry'
            ? postJson('/api/random-ban/test', { mode: 'dry_run' })
            : postJson(
                '/api/random-ban/test-streamer-mute',
                kind === 'caution' ? { caution: true } : {},
              ),
      t.done,
    );
    if (ok) tick.now();
  }

  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>('[data-go-reward]')?.dataset.goReward;
    if (go) askReward(go);
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.out) {
      outcome = b.dataset.out;
      return paint();
    }
    if (b.dataset.t) return void test(b, b.dataset.t as keyof typeof TESTS);
    if (b.dataset.rq) {
      const r = s?.recent.find((x) => x.request_id === b.dataset.rq);
      if (r) openRow(r);
    }
  });
  bindSettings(
    p.root,
    () => settings,
    (next) => {
      settings = next;
      paint();
    },
  );

  paint();
  return {
    setVisible(v: boolean) {
      if (v) {
        tick.start();
        void loadSettings().then((x) => {
          settings = x;
          paint();
        });
      } else tick.stop();
    },
  };
}
