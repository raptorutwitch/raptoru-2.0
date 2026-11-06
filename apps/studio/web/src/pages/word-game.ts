import {
  confirmBox,
  copy,
  errText,
  keyed,
  page,
  panelBtn,
  patch,
  poller,
  toast,
} from '../ds/ds.js';
import { type ApiError, getJson, postJson, tryGetJson } from '../http.js';
import {
  type ChatStep,
  chatLine,
  keepRevealed,
  ruleHtml,
  ruleMin,
  ruleX,
  type WordGamePanel,
  wgZones,
  wordAge,
} from './word-game-view.js';

// Jeu des mots : le plateau, c'est ce que lit le chat. On y lance un mot, on arrête le live en cours, on tire l'intervalle sur sa
// règle. Le Core décide de tout. « Voir la réponse » reste local à cet écran, en mémoire : quitter la page cache toutes les réponses.

export function mountWordGamePage(root: HTMLElement) {
  const p = page(root, { title: 'Jeu des mots', panel: true });
  p.body.innerHTML = `<div class="wg">
    <section class="wg-main">
      <div class="wg-top"><span data-z="transport" class="wg-tr"></span><span class="wg-next-t" data-z="next"></span><span class="d-sp"></span><span class="d-lb" data-z="count"></span></div>
      <div data-z="error"></div>
      <div class="wg-board d-scroll" data-z="board" aria-label="Mots en jeu"></div>
      <div class="wg-iv" data-z="iv" hidden>
        <div class="wg-ivh"><span class="d-lb">Un mot toutes les</span>
          <label class="d-fld"><input type="number" min="1" max="60" step="1" data-interval="min" aria-label="Intervalle minimal en minutes"></label><span>à</span>
          <label class="d-fld"><input type="number" min="1" max="60" step="1" data-interval="max" aria-label="Intervalle maximal en minutes"><span>min</span></label>
          <span class="d-faint">au hasard entre les deux</span><span class="d-sp"></span><span data-z="ivsave"></span></div>
        <div class="wg-rule" data-z="rule"></div>
      </div>
    </section>
    <aside class="wg-side">
      <section><h2 class="d-lb">Série</h2><div class="wg-streak" data-z="streak"></div></section>
      <section class="wg-wins"><h2 class="d-lb">Dernières trouvailles</h2><div class="d-scroll" data-z="wins"></div></section>
      <section class="wg-chat"><h2 class="d-lb">Dans le chat</h2><ul class="d-scroll" data-z="chat"></ul></section>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const iv = (k: 'min' | 'max') =>
    p.body.querySelector<HTMLInputElement>(`[data-interval="${k}"]`)!;

  let state: WordGamePanel | null = null;
  let busy = false;
  let error: string | null = null;
  /** Les réponses montrées : jamais envoyées nulle part. */
  let revealed = new Set<string>();
  /** L'intervalle en cours de réglage, en minutes ; null : celui du Core. */
  let draft: { min: number; max: number } | null = null;
  /** Le volume bouge sous le doigt : le relevé ne reconstruit pas le panneau. */
  let adjusting = false;
  let dragging: 'min' | 'max' | null = null;

  const saved = () => {
    const i = state && 'live' in state ? state.interval : null;
    return i
      ? { min: Math.round(i.min_s / 60), max: Math.round(i.max_s / 60) }
      : null;
  };
  function paintRule() {
    const v = draft ?? saved();
    z('iv').hidden = !v;
    if (!v) return;
    if (document.activeElement !== iv('min')) iv('min').value = String(v.min);
    if (document.activeElement !== iv('max')) iv('max').value = String(v.max);
    patch(z('rule'), ruleHtml(v.min, v.max));
    paintAges();
    const s = saved();
    patch(
      z('ivsave'),
      draft && s && (draft.min !== s.min || draft.max !== s.max)
        ? `<span class="wg-apply"><button type="button" class="d-btn ghost sm" data-ivcancel>Annuler</button><button type="button" class="d-btn pri sm" data-action="interval" ${busy ? 'disabled' : ''}>Enregistrer l’intervalle</button></span>`
        : '',
    );
  }
  /** Ce qui bouge à chaque seconde, sans toucher au reste : l'âge des mots et le repère du prochain mot. */
  function paintAges() {
    if (!state || !('live' in state)) return;
    const now = Date.now();
    for (const w of state.active) {
      const t = z('board').querySelector<HTMLElement>(
        `[data-age="${CSS.escape(w.occurrence_id)}"]`,
      );
      if (t) t.textContent = wordAge(w, now, state.fetched_at ?? now);
    }
    const mark = z('rule').querySelector<HTMLElement>('[data-nextmark]');
    const left =
      state.next_word_at && state.live
        ? (Date.parse(state.next_word_at) - now) / 60000
        : null;
    if (mark) {
      mark.hidden = left === null;
      if (left !== null) mark.style.left = `${ruleX(left)}%`;
    }
  }
  function paint() {
    revealed = keepRevealed(revealed, state);
    const v = wgZones(state, Date.now(), busy, error, revealed);
    patch(p.state, v.state);
    patch(p.actions, `${v.env}${panelBtn(p.panel.isOpen())}`);
    patch(z('transport'), v.transport);
    z('next').textContent = v.next;
    patch(z('error'), v.error);
    patch(z('count'), v.count);
    keyed(z('board'), v.board, v.boardEmpty);
    patch(z('streak'), v.streak);
    patch(z('wins'), v.wins);
    if (!adjusting) p.panel.set(v.panel);
    paintRule();
    paintAges();
  }

  async function refresh() {
    try {
      const body = await getJson<WordGamePanel>('/api/word-game/state');
      state = 'live' in body ? { ...body, fetched_at: Date.now() } : body;
      error = null;
    } catch (e) {
      error = `État indisponible : ${errText(e)}`;
    }
    paint();
  }
  const fast = poller(refresh, 1000);
  /** Le vrai fil du bot : ce qui a été mis en file pour le chat, envoyé ou non. */
  const chat = poller(async () => {
    const r = await tryGetJson<{ steps: ChatStep[] }>(
      '/api/commands/steps?limit=60',
    );
    const lines = (r?.steps ?? [])
      .filter((x) => x.origin === 'word_game')
      .slice(0, 12)
      .reverse();
    keyed(
      z('chat'),
      lines.map((x) => ({ key: x.step_id, html: chatLine(x) })),
      `<li class="d-faint">${r ? 'Rien pour l’instant.' : 'Lecture impossible.'}</li>`,
    );
  }, 3000);

  const REFUS: Record<string, string> = {
    offline: 'Hors live : action impossible.',
    invalid_interval:
      'Intervalle refusé : le minimum doit être inférieur ou égal au maximum.',
  };
  async function act(action: string) {
    const v = draft ?? saved();
    const payload =
      action === 'new_word'
        ? { action, request_id: crypto.randomUUID() }
        : action === 'enable' || action === 'disable'
          ? { action: 'settings', enabled: action === 'enable' }
          : action === 'interval'
            ? {
                action: 'settings',
                interval_min_s: (v?.min ?? 0) * 60,
                interval_max_s: (v?.max ?? 0) * 60,
              }
            : { action };
    if (
      action === 'disable' &&
      !(await confirmBox({
        title: 'Désactiver le Jeu des mots ?',
        body: 'Plus aucun mot automatique, même après un redémarrage ou un nouveau live, jusqu’à « Activer le jeu ». Les mots déjà affichés restent trouvables jusqu’à la fin du live.',
        yes: 'Désactiver',
      }))
    )
      return;
    busy = true;
    paint();
    try {
      const body = await postJson<WordGamePanel>(
        '/api/word-game/actions',
        payload,
      );
      state = { ...body, fetched_at: Date.now() };
      error = null;
      if (action === 'interval') {
        draft = null;
        toast('Intervalle enregistré');
      }
    } catch (e) {
      toast(REFUS[(e as ApiError).code] ?? errText(e), { bad: true });
    }
    busy = false;
    paint();
  }

  async function saveVolume(volume: number) {
    try {
      const body = await postJson<{ sound_volume?: number }>(
        '/api/word-game/volume',
        { volume },
      );
      if (state && 'live' in state)
        state = { ...state, sound_volume: body.sound_volume };
    } catch (e) {
      toast(`Volume non enregistré : ${errText(e)}`, { bad: true });
    }
    paint();
  }

  // Tirer une borne de l'intervalle.
  const fromPointer = (e: PointerEvent) => {
    const box = z('rule').getBoundingClientRect();
    return ruleMin(((e.clientX - box.left) / box.width) * 100);
  };
  const setBound = (k: 'min' | 'max', n: number) => {
    const v = draft ?? saved();
    if (!v) return;
    draft =
      k === 'min'
        ? { min: Math.min(n, v.max), max: v.max }
        : { min: v.min, max: Math.max(n, v.min) };
    paintRule();
  };
  p.body.addEventListener('pointerdown', (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
    if (!h) return;
    e.preventDefault();
    dragging = h.dataset.h as 'min' | 'max';
    z('rule').setPointerCapture(e.pointerId);
    z('rule').classList.add('drag');
  });
  p.body.addEventListener('pointermove', (e) => {
    if (dragging) setBound(dragging, fromPointer(e));
  });
  p.body.addEventListener('pointerup', () => {
    dragging = null;
    z('rule').classList.remove('drag');
  });
  p.body.addEventListener('keydown', (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
    if (!h || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const k = h.dataset.h as 'min' | 'max';
    const v = draft ?? saved();
    if (!v) return;
    setBound(
      k,
      Math.min(60, Math.max(1, v[k] + (e.key === 'ArrowRight' ? 1 : -1))),
    );
    z('rule').querySelector<HTMLElement>(`[data-h="${k}"]`)?.focus();
  });

  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-volume]')) {
      adjusting = true;
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = `${t.value} %`;
      return;
    }
    const k = t.dataset.interval as 'min' | 'max' | undefined;
    if (k) {
      const n = Math.round(Number(t.value));
      if (n >= 1 && n <= 60) {
        const v = draft ?? saved()!;
        draft = { ...v, [k]: n };
        paintRule();
      }
    }
  });
  p.root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-volume]')) {
      adjusting = false;
      void saveVolume(Number(t.value));
    }
  });
  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const reveal = t.closest<HTMLElement>('[data-reveal]');
    if (reveal) {
      const id = reveal.dataset.reveal!;
      if (!revealed.delete(id)) revealed.add(id);
      paint();
      z('board')
        .querySelector<HTMLElement>(`[data-reveal="${CSS.escape(id)}"]`)
        ?.focus();
      return;
    }
    if (t.closest('[data-ivcancel]')) {
      draft = null;
      return paintRule();
    }
    const button = t.closest<HTMLButtonElement>('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action!;
    if (action === 'copy') {
      if (state && 'player_url' in state && state.player_url)
        copy(state.player_url, 'Adresse copiée');
      return;
    }
    void act(action);
  });

  paint();
  return {
    setVisible(v: boolean) {
      if (v) {
        fast.start();
        chat.start();
      } else {
        fast.stop();
        chat.stop();
        revealed.clear(); // quitter la page cache toutes les réponses
      }
    },
  };
}
