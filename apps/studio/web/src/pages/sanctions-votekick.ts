import {
  clock,
  copy,
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
  ring,
  stateChip,
} from '../ds/ds.js';
import { getJson, STUDIO_HEADERS } from '../http.js';
import { loadSettings, type SettingView } from '../module-settings.js';
import {
  overlayOutcome,
  voteDetail,
  voteLocks,
  voteRow,
  votekickError,
  votekickForm,
  type VoteView,
  type VotekickLaunchSound,
  type VotekickLive,
  type VotekickSettings,
  type VotekickUi,
} from './sanctions-model.js';
import { bindSettings, settingRows } from './setting-rows.js';

// Votekick : le vrai overlay dans sa scène, le vote en cours, la durée et le son de lancement, l'exécuteur et la tâche de mute,
// les derniers votes. Le Core tient le vote, Studio le suit et coupe le micro du streamer dans OBS. Le bouton d'aperçu joue une
// démonstration à l'intérieur de cette scène seulement : rien ne part vers OBS ni vers le chat.

const OVERLAY = '/votekick/overlay.html?studio';

export function mountVotekickPage(root: HTMLElement) {
  const p = page(root, { title: 'Votekick', mod: 'sanction', panel: true });
  p.body.innerHTML = `<div class="sx vk">
    <section class="sx-main">
      <div class="d-scn d-vf vk-scn" data-scn><span class="d-scn__tag">Source OBS</span><div class="vk-idle" data-z="idle"></div></div>
      <div class="vk-live" data-z="live"></div>
      <h2 class="d-lb sx-h">Derniers votes</h2>
      <div class="sx-ledger" data-z="ledger"></div>
    </section>
    <aside class="sx-side">
      <div data-z="form"></div>
      <h2 class="d-lb sx-h">Exécution</h2>
      <div class="sx-locks" data-z="locks"></div>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let live: VotekickLive | null = null;
  let error: string | null = null;
  let conf: VotekickSettings | null = null;
  let draft: VotekickLaunchSound | null = null;
  const ui: VotekickUi = { error: null, notice: null, busy: false };
  let settings: SettingView[] | null = null;
  let preview: HTMLAudioElement | null = null;
  let frame: HTMLIFrameElement | null = null;
  let scale: ResizeObserver | null = null;
  let demoUntil = 0;

  /** La vraie page de l'overlay, à l'échelle : un seul chargement, seulement quand la page est visible. */
  function showFrame() {
    const box = p.body.querySelector<HTMLElement>('[data-scn]')!;
    if (frame) return;
    frame = document.createElement('iframe');
    frame.title = 'Overlay Votekick';
    frame.className = 'd-scn__fit vk-frame';
    frame.src = OVERLAY;
    box.prepend(frame);
    scale = new ResizeObserver(() => {
      if (frame) frame.style.transform = `scale(${box.clientWidth / 1920})`;
    });
    scale.observe(box);
  }
  function hideFrame() {
    frame?.remove();
    frame = null;
    scale?.disconnect();
  }

  async function read() {
    try {
      live = await getJson<VotekickLive>('/api/votekick/state');
      error = null;
    } catch (e) {
      error = errText(e);
    }
    paint();
  }
  const tick = poller(read, 1000);

  const form = () =>
    z('form').querySelector<HTMLFormElement>('[data-role="vk-form"]');
  const named = <T extends Element>(name: string) =>
    form()?.elements.namedItem(name) as unknown as T | null;
  /** Le son tel que le formulaire le montre. */
  const fromForm = (): VotekickLaunchSound => {
    const sound = named<HTMLSelectElement>('sound')!.value || null;
    return {
      enabled: named<HTMLInputElement>('enabled')!.checked,
      sound,
      sound_name: sound?.startsWith('upload:')
        ? ((draft?.sound === sound
            ? draft.sound_name
            : conf?.launch_sound?.sound_name) ?? null)
        : null,
      volume: Number(named<HTMLInputElement>('volume')!.value),
    };
  };
  /** Redessiné en gardant la durée en cours de frappe (un son changé ou importé ne la remet jamais à zéro). */
  function paintForm() {
    const typed = named<HTMLInputElement>('vote_seconds')?.value;
    z('form').innerHTML = votekickForm(conf, ui, draft);
    const input = named<HTMLInputElement>('vote_seconds');
    if (input && typed !== undefined && !input.disabled) {
      input.value = typed;
      const r = z('form').querySelector<HTMLInputElement>('[data-vs]');
      if (r) r.value = typed;
    }
  }
  const call = async <T>(path: string, init?: RequestInit) => {
    const res = await fetch(`/api/votekick${path}`, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok)
      throw new Error(votekickError(body.error ?? `HTTP ${res.status}`));
    return body;
  };
  async function loadForm() {
    try {
      conf = await call<VotekickSettings>('/settings', {
        headers: STUDIO_HEADERS,
      });
      draft = null;
      ui.error = null;
    } catch (e) {
      ui.error = `Réglages Votekick indisponibles : ${(e as Error).message}`;
    }
    paintForm();
  }

  function paintLive() {
    const o = live?.overlay ?? live?.core.overlay;
    const on = o?.action === 'live';
    const res = o?.action === 'result';
    const leftS = on && o?.ends ? Math.max(0, (o.ends - Date.now()) / 1000) : 0;
    const part = on && o?.dur ? leftS / o.dur : 0;
    z('idle').hidden = on || res || Date.now() < demoUntil;
    patch(
      z('idle'),
      live
        ? '<span>Aucun vote : l’overlay est vide à l’antenne.</span>'
        : `<b>${esc(error ?? 'Lecture…')}</b>`,
    );
    patch(
      z('live'),
      on
        ? `<span class="vk-ring ${leftS <= 10 ? 'd-hot' : ''}">${ring(part, 15, 3, 36)}<b class="d-num">${clock(leftS)}</b></span>
           <span class="vk-q"><b>${esc(o?.target)}</b><small>lancé par ${esc(o?.initiator)}</small></span>
           <span class="vk-t"><b class="d-num">${o?.yes ?? 0}</b> KICK</span><span class="vk-t"><b class="d-num">${o?.no ?? 0}</b> SAVE</span>`
        : res
          ? `<span class="vk-q"><b>${esc(overlayOutcome(o!))}</b><small>${esc(o?.target)}${o?.punished ? ` · ${esc(o.punished)}` : ''}${o?.minutes ? ` · ${o.minutes} min` : ''}${o?.mute_seconds ? ` · sourdine ${o.mute_seconds} s` : ''}</small></span>
             <span class="vk-t"><b class="d-num">${o?.yes ?? 0}</b> KICK</span><span class="vk-t"><b class="d-num">${o?.no ?? 0}</b> SAVE</span>`
          : `<button type="button" class="d-btn sm" data-demo title="Dans cette scène seulement, rien ne part vers OBS">${ic('play')}Aperçu de l’overlay</button><small class="d-faint">Démonstration locale, aucun vote n’est lancé. Les vrais votes viennent du chat : <code>!votekick pseudo</code>.</small>`,
    );
  }
  function paintPanel() {
    p.panel.set(`${grp(
      'Délais et durées d’exclusion',
      'clock',
      settingRows(settings, [
        'votekick.initiator_cooldown_min',
        'votekick.sanction_min_minutes',
        'votekick.sanction_max_minutes',
      ]),
      'exclusion délai sanction',
    )}
    ${grp(
      'Source OBS',
      'eye',
      `<div class="d-row col" data-k="overlay adresse url source navigateur"><label class="d-fld"><input type="text" readonly value="${esc(location.origin + OVERLAY)}" aria-label="Adresse de l’overlay"></label><button type="button" class="d-btn sm" data-copy>${ic('copy')}Copier l’adresse</button><small>Navigateur 1920 × 1080, fond transparent.</small></div>`,
      'overlay source',
    )}`);
  }
  function paint() {
    const o = live?.overlay;
    const m = live?.core.mute;
    patch(
      p.state,
      !live
        ? stateChip('w', error ?? 'Lecture…')
        : o?.action === 'live'
          ? stateChip('live', 'Vote en cours')
          : m?.status === 'active'
            ? stateChip('r', 'Streamer en sourdine')
            : live.core.error
              ? stateChip('w', 'Serveur injoignable')
              : !live.core.executor?.ready
                ? stateChip('r', 'Exécuteur Twitch absent')
                : stateChip('', 'Prêt'),
    );
    patch(p.actions, panelBtn(p.panel.isOpen()));
    paintLive();
    patch(z('locks'), voteLocks(live, error));
    keyed(
      z('ledger'),
      (live?.core.recent ?? []).map((r) => ({
        key: r.vote_id,
        html: voteRow(r),
      })),
      `<div class="d-empty">${live ? 'Aucun vote.' : ''}</div>`,
    );
    paintPanel();
  }

  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    if (b.matches('[data-copy]'))
      return copy(location.origin + OVERLAY, 'Adresse copiée');
    if (b.matches('[data-demo]')) {
      // Le mode d'essai de la page d'overlay, à l'intérieur de l'iframe de cette scène.
      const vk = (
        frame?.contentWindow as
          (Window & { VK?: { demo(o: { dur: number }): void } }) | null
      )?.VK;
      if (!vk) return;
      demoUntil = Date.now() + 22_000;
      vk.demo({ dur: 12 });
      return paintLive();
    }
    if (b.dataset.rq) {
      const r = live?.core.recent?.find(
        (x: VoteView) => x.vote_id === b.dataset.rq,
      );
      if (r)
        drawer({
          kicker: `Votekick · ${hhmm(r.created_at)}`,
          title: r.target,
          body: voteDetail(r),
        });
      return;
    }
    if (b.dataset.act === 'vk-preview') {
      const { sound, volume } = fromForm();
      preview?.pause();
      if (!sound) return;
      preview = new Audio(`/effects/media/${sound}`);
      preview.volume = volume / 100;
      preview.play().catch(() => {
        ui.error = 'Pré-écoute impossible (fichier absent ?).';
        paintForm();
      });
    }
  });
  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'volume') {
      const out = named<HTMLOutputElement>('volume_out');
      if (out) out.value = t.value;
      if (preview) preview.volume = Number(t.value) / 100;
    }
    if (t.matches('[data-vs]')) {
      const n = named<HTMLInputElement>('vote_seconds');
      if (n) n.value = t.value;
    }
    if (t.name === 'vote_seconds') {
      const r = z('form').querySelector<HTMLInputElement>('[data-vs]');
      if (r) r.value = t.value;
    }
  });
  p.root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'sound') {
      draft = fromForm();
      paintForm();
    }
    if (t.name !== 'file' || !t.files?.[0]) return;
    const file = t.files[0];
    const keep = fromForm();
    ui.busy = true;
    ui.notice = null;
    ui.error = null;
    paintForm();
    try {
      const up = await call<{ id: string; name: string }>('/sounds', {
        method: 'POST',
        headers: {
          'x-raptoru-studio': '1',
          'content-type': 'application/octet-stream',
          'x-sound-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      draft = { ...keep, sound: up.id, sound_name: up.name };
      ui.notice = `« ${up.name} » importé : enregistre pour l’utiliser.`;
    } catch (err) {
      draft = keep;
      ui.error = (err as Error).message;
    }
    ui.busy = false;
    paintForm();
  });
  p.root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body: Record<string, unknown> = { launch_sound: fromForm() };
    if (conf?.available)
      body.vote_seconds = Number(
        named<HTMLInputElement>('vote_seconds')!.value,
      );
    ui.busy = true;
    ui.error = null;
    ui.notice = null;
    paintForm();
    try {
      conf = await call<VotekickSettings>('/settings', {
        method: 'POST',
        headers: STUDIO_HEADERS,
        body: JSON.stringify(body),
      });
      draft = null;
      ui.notice = 'Enregistré';
    } catch (err) {
      draft = body.launch_sound as VotekickLaunchSound;
      ui.error = (err as Error).message;
    }
    ui.busy = false;
    paintForm();
  });
  bindSettings(
    p.root,
    () => settings,
    (next) => {
      settings = next;
      paintPanel();
    },
  );

  return {
    setVisible(v: boolean) {
      if (v) {
        showFrame();
        tick.start();
        void loadForm();
        void loadSettings().then((x) => {
          settings = x;
          paintPanel();
        });
      } else {
        tick.stop();
        preview?.pause();
        hideFrame();
      }
    },
  };
}
