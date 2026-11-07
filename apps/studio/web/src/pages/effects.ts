import { COLOR_CAM, COLOR_CAM_PRESETS, FX_CAM } from '@raptoru/schemas';
import {
  confirmBox,
  copy,
  errText,
  esc,
  fmt,
  grp,
  ic,
  keyed,
  page,
  panelBtn,
  patch,
  poller,
  run,
  seg,
  stateChip,
  toast,
} from '../ds/ds.js';
import { getJson, postJson } from '../http.js';
import { loadSettings, type SettingView } from '../module-settings.js';
import {
  askReward,
  effectItems,
  effectsFact,
  INTERACTIONS,
  mediaCount,
  runNowConfirm,
  triggersHtml,
  usesEffect,
  type CpInteraction,
  type CpReward,
  type CpState,
} from './rewards-model.js';
import { bindSettings, settingRows } from './setting-rows.js';

// Effets et lecteur : la source OBS qui joue tout en superposition, ses médias, et les interactions natives (Creepy, BRB, FX Cam,
// Couleur Cam) avec les récompenses qui les déclenchent. « Écouter » reste dans cette fenêtre ; « Tester » exécute la récompense
// reliée pour de vrai, après confirmation. Le Core reconnaît le texte du viewer : la page ne fait que proposer la liste.

interface Native {
  id: CpInteraction;
  chips?: string[];
  note: string;
}
const NATIVES: Native[] = [
  { id: 'creepy', note: 'Fullscreen, Just Chatting, PS5, Dessin' },
  { id: 'brb', note: 'Dessin, Fullscreen, PS5. Nécessite le lecteur.' },
  {
    id: 'fx_cam',
    chips: [...FX_CAM.effects],
    note: `${FX_CAM.durationMs / 1000} s · Dessin, Fullscreen`,
  },
  {
    id: 'color_cam',
    chips: [...COLOR_CAM_PRESETS.map((c) => c.name), 'aléatoire'],
    note: `Transition ${COLOR_CAM.transitionMs / 1000} s · Dessin, Fullscreen`,
  },
];

export function mountEffectsPage(root: HTMLElement) {
  const p = page(root, {
    title: 'Effets et lecteur',
    mod: 'effects',
    panel: true,
  });
  p.body.innerHTML = `<div class="fxp">
    <section class="fxp-stage">
      <div class="d-scn d-vf" data-z="scene"><span class="d-scn__tag">Source OBS</span><div class="fxp-hint" data-z="hint"></div></div>
      <div class="fxp-url" data-z="url"></div>
      <div class="fxp-mhead" data-z="mhead"></div>
      <div class="fxp-media" data-z="media"></div>
    </section>
    <section class="fxp-natives" aria-label="Interactions natives" data-z="natives"></section>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let s: CpState | null = null;
  let error: string | null = null;
  let settings: SettingView[] | null = null;
  let tab: 'sounds' | 'videos' | 'native' = 'sounds';
  const picked: Partial<Record<CpInteraction, string>> = {};
  let audio: HTMLAudioElement | null = null;
  let playing: string | null = null;

  async function read() {
    try {
      s = await getJson<CpState>('/api/channel-points/state');
      error = null;
    } catch (e) {
      error = errText(e);
    }
    paint();
  }
  const tick = poller(read, 3000);

  const linked = (id: CpInteraction) =>
    s?.rewards.filter((r) =>
      r.rule?.actions.some(
        (a) => a.type === 'interaction' && a.interaction === id,
      ),
    ) ?? [];

  function paintHead() {
    const f = s ? effectsFact(s.effects) : null;
    patch(
      p.state,
      !s
        ? stateChip('w', error ?? 'Lecture…')
        : !s.effects
          ? stateChip('off', 'Lecteur absent de ce Studio')
          : stateChip(
              (s.effects.playing ? 'live' : f?.tone || '') as '' | 'w' | 'live',
              f?.text
                .replace('Lecteur d’effets : ', 'Lecteur ')
                .replace('Lecteur d’effets prêt', 'Prêt') ?? '',
            ),
    );
    patch(p.actions, panelBtn(p.panel.isOpen()));
  }
  function paintScene() {
    const e = s?.effects;
    const f = s ? effectsFact(s.effects) : null;
    const live = e?.connected && e.audio && e.current !== false;
    z('scene').classList.toggle('is-live', !!e?.playing);
    patch(
      z('hint'),
      !s
        ? error
          ? `<b>${esc(error)}</b>`
          : ''
        : !e
          ? '<b>Lecteur d’effets indisponible dans ce Studio</b>'
          : !live
            ? `<b>${esc(f?.text.replace('Lecteur d’effets : ', 'Lecteur ') ?? '')}</b><span>${esc(f?.hint ?? '')}</span>`
            : e.playing
              ? `<i class="fxp-bars"><u></u><u></u><u></u><u></u></i><b>${e.playing} effet${e.playing > 1 ? 's' : ''} en lecture</b>`
              : '<span>Rien à l’écran : le lecteur attend le prochain effet.</span>',
    );
    patch(
      z('url'),
      e
        ? `<label class="d-fld"><input type="text" readonly value="${esc(e.url)}" aria-label="Adresse de la source OBS"></label><button type="button" class="d-btn sm" data-copy>${ic('copy')}Copier</button><small>Une seule source navigateur, 1920 × 1080, plein cadre. Elle joue sons et vidéos tout de suite, en superposition, hors Soundboard.</small>`
        : '',
    );
  }
  function paintMedia() {
    const e = s?.effects;
    const sounds = e?.sounds ?? [];
    const videos = e?.videos ?? [];
    const natives = e?.interaction_media ?? [];
    const count = mediaCount(e ?? null);
    patch(
      z('mhead'),
      `${seg(
        'data-tab',
        [
          ['sounds', `Sons ${sounds.length}`],
          ['videos', `Vidéos ${videos.length}`],
          ['native', `Interactions ${natives.length}`],
        ],
        tab,
      )}<span class="d-sp"></span><small class="${count.missing.length ? 'fxp-miss' : 'd-faint'}" title="${esc(count.missing.join(', '))}">${count.have} / ${count.total} importés</small>${count.missing.length && s?.environment === 'lab' ? `<button type="button" class="d-btn sm" data-import title="Cherche dans tes dossiers habituels, puis dans la copie du Studio installé. Tes fichiers sont seulement lus.">${ic('upload')}Importer</button>` : ''}`,
    );
    const rows =
      tab === 'sounds' ? sounds : tab === 'videos' ? videos : natives;
    keyed(
      z('media'),
      rows.map((m) => ({
        key: m.id,
        html: `<div class="fxp-m ${m.available ? '' : 'is-off'}">
          ${
            tab === 'sounds'
              ? `<button type="button" class="d-ib" data-listen="${esc(m.id)}" ${m.available ? '' : 'disabled'} aria-label="Écouter ${esc(m.label)} ici">${ic(playing === m.id ? 'stop' : 'play')}</button>`
              : `<span class="d-ib">${ic(tab === 'videos' ? 'film' : 'sparkle')}</span>`
          }
          <span class="fxp-ml">${esc(m.label)}</span>
          ${'volume' in m ? `<small>${m.volume} %</small>` : ''}
          ${m.available ? '' : '<span class="d-tag warn">À importer</span>'}
        </div>`,
      })),
      `<div class="d-empty">${s ? 'Aucun média.' : ''}</div>`,
    );
  }
  function paintNatives() {
    patch(
      z('natives'),
      NATIVES.map((n) => {
        const it = INTERACTIONS[n.id];
        const rewards = linked(n.id);
        const cur = picked[n.id] ?? n.chips?.[0];
        return `<article class="fxp-n" data-native="${n.id}">
          <header>${ic(it.icon)}<h2>${esc(it.label)}</h2><small title="${esc(n.note)}">${esc(n.note)}</small>
            <button type="button" class="d-btn sm" data-try="${n.id}" ${rewards.length ? '' : 'disabled title="Relie d’abord une récompense à cette interaction"'}>${ic('play')}${s?.environment === 'lab' ? 'Tester' : 'Tester pour de vrai…'}</button>
          </header>
          <p>${esc(it.description.split(' Effets reconnus')[0]!)}</p>
          ${n.chips ? `<div class="d-tags fxp-chips">${n.chips.map((c) => `<button type="button" class="d-tag ${c === cur ? 'ok' : ''}" data-chip="${n.id}" data-v="${esc(c)}" aria-pressed="${c === cur}">${esc(c)}</button>`).join('')}</div>` : ''}
          ${rewards.length ? `<div class="fxp-rw">${ic('gift')}${rewards.map((r) => `<a class="rw-link" href="/?p=channel-points" data-go-reward="${esc(r.id)}"><b>${esc(r.title)}</b><small>${fmt(r.cost)} pts${r.rule!.enabled ? '' : ', règle désactivée'}</small></a>`).join('')}</div>` : '<small class="d-faint">Aucune récompense reliée.</small>'}
        </article>`;
      }).join(''),
    );
  }
  function paintPanel() {
    p.panel
      .set(`${grp('Prix dans le chat', 'coin', settingRows(settings, ['fx_cam.price']), 'prix fxcam')}
      ${grp('Déclencheurs', 'gift', `<div class="d-row col" data-k="déclencheurs récompenses liaisons">${triggersHtml(s, error, usesEffect)}</div>`)}
      ${grp('Tests', 'info', '<div class="d-row col" data-k="test écouter réel obs"><small>« Écouter » reste dans cette fenêtre, rien dans OBS, rien dans l’historique. « Tester » exécute la récompense reliée sur le stream ; aucun point de chaîne n’est utilisé.</small></div>')}`);
  }
  function paint() {
    paintHead();
    paintScene();
    paintMedia();
    paintNatives();
    paintPanel();
  }

  async function test(btn: HTMLElement, id: CpInteraction) {
    const r: CpReward | undefined = linked(id)[0];
    if (!r) return;
    const text = picked[id] ?? NATIVES.find((n) => n.id === id)?.chips?.[0];
    const yes = await confirmBox({
      title: `Tester « ${r.title} » maintenant ?`,
      body: `${text ? `Avec le texte « ${text} ».\n\n` : ''}${runNowConfirm(r.rule?.actions ?? [], s?.sounds, effectItems(s?.effects))}`,
      yes: 'Exécuter',
      no: 'Annuler',
    });
    if (!yes) return;
    if (
      await run(
        btn,
        () =>
          postJson('/api/channel-points/test', {
            reward_id: r.id,
            ...(text ? { user_input: text } : {}),
          }),
        'Test envoyé : voir l’historique des récompenses',
      )
    )
      tick.now();
  }

  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>('[data-go-reward]')?.dataset.goReward;
    if (go) askReward(go);
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    if (b.matches('[data-copy]'))
      return copy(s?.effects?.url ?? '', 'Adresse copiée');
    if (b.matches('[data-import]'))
      return void confirmBox({
        title: 'Importer les médias manquants ?',
        body: 'Studio cherche dans tes dossiers habituels, puis dans la copie du Studio installé, et copie dans le Lab. Tes fichiers sont seulement lus, leur empreinte est vérifiée.',
        yes: 'Importer',
        no: 'Annuler',
        danger: false,
      }).then((yes) => {
        if (!yes) return;
        let report: { result: string }[] = [];
        void run(b, async () => {
          report = (
            await postJson<{ report: typeof report }>(
              '/api/channel-points/effects-import',
              {},
            )
          ).report;
          const done = report.filter((r) => r.result !== 'corrupt').length;
          toast(
            done
              ? `${done} média(s) importé(s).`
              : 'Aucun média trouvé sur ce PC.',
            { bad: !done },
          );
        }).then(() => tick.now());
      });
    if (b.dataset.tab) {
      tab = b.dataset.tab as typeof tab;
      return paintMedia();
    }
    if (b.dataset.chip) {
      picked[b.dataset.chip as CpInteraction] = b.dataset.v!;
      return paintNatives();
    }
    if (b.dataset.try) return void test(b, b.dataset.try as CpInteraction);
    const id = b.dataset.listen;
    if (id) {
      audio?.pause();
      if (playing === id) {
        playing = null;
        return paintMedia();
      }
      audio = new Audio(`/effects/media/${encodeURIComponent(id)}`);
      audio.volume =
        (effectItems(s?.effects).find((m) => m.id === id)?.volume ?? 100) / 100;
      playing = id;
      audio.addEventListener('ended', () => {
        playing = null;
        paintMedia();
      });
      void audio.play().catch(() => {
        playing = null;
        paintMedia();
        toast('Écoute impossible : son non importé ou illisible.', {
          bad: true,
        });
      });
      paintMedia();
    }
  });
  bindSettings(
    p.root,
    () => settings,
    (next) => {
      settings = next;
      paintPanel();
    },
  );

  paintHead();
  return {
    setVisible(v: boolean) {
      if (v) {
        tick.start();
        void loadSettings().then((x) => {
          settings = x;
          paintPanel();
        });
      } else {
        tick.stop();
        audio?.pause();
        playing = null;
      }
    },
  };
}
