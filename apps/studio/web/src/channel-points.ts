import {
  actionLabel,
  type CpActionView,
  type CpState,
  effectItems,
  effectsView,
  esc,
  historyView,
  rewardsView,
  statusView,
} from './channel-points-view.js';

// Points de chaîne V1 — Studio tab (docs/CHANNEL_POINTS_V1.md). Twitch rewards (left), the local rule of the selected
// reward (right: ordered actions, typed fields, suggestions read from OBS), the history (below). The master switch is
// persistent in Core and OFF by default; turning it on asks for a confirmation. « Tester » runs the saved rule for
// real (OBS / Soundboard / effects player), on an explicit click only. « Écouter » previews an effect sound in this
// window only (nothing in OBS, no history).

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const TYPES: { id: CpActionView['type']; label: string }[] = [
  { id: 'effect_sound', label: 'Son d’effet (lecture immédiate)' },
  { id: 'effect_video', label: 'Vidéo d’effet (lecture immédiate)' },
  { id: 'sound', label: 'Jouer un son (Soundboard)' },
  { id: 'obs_source', label: 'Afficher / masquer une source OBS' },
  { id: 'obs_filter', label: 'Activer / désactiver un filtre OBS' },
  { id: 'obs_scene', label: 'Changer de scène OBS' },
];

const blank = (type: CpActionView['type']): CpActionView =>
  type === 'effect_sound'
    ? { type, sound_id: '', volume: 100 }
    : type === 'effect_video'
      ? { type, video_id: '', volume: 100 }
      : type === 'sound'
        ? { type, sound_id: '' }
        : type === 'obs_source'
          ? { type, scene: '', source: '', visible: true }
          : type === 'obs_filter'
            ? { type, source: '', filter: '', enabled: true }
            : { type, scene: '' };

export function mountChannelPoints(root: HTMLElement) {
  let state: CpState | null = null;
  let error: string | null = null;
  let selected: string | null = null;
  let draft: { enabled: boolean; actions: CpActionView[] } | null = null;
  let message = '';
  let lists: { scenes: string[]; sources: string[]; filters: string[] } = {
    scenes: [],
    sources: [],
    filters: [],
  };
  let timer: number | null = null;

  root.innerHTML = `<section class="cp">
    <div class="cp-head"><h1>Points de chaîne <em>Core</em></h1>
      <button type="button" data-act="switch"></button></div>
    <div class="cp-status" data-role="status"></div>
    <div data-role="effects"></div>
    <p class="cp-muted">Les récompenses viennent de Twitch (lecture seule : Raptoru ne les valide ni ne les rembourse).
      Les règles sont propres à Raptoru. SAMMI exécute encore les récompenses de production.</p>
    <div class="cp-grid">
      <div><h2>Récompenses Twitch</h2><div data-role="rewards"></div></div>
      <div><h2>Actions de la récompense</h2><div data-role="editor"></div></div>
    </div>
    <h2>Historique</h2><div data-role="history"></div>
    <datalist id="cp-scenes"></datalist><datalist id="cp-sources"></datalist><datalist id="cp-filters"></datalist>
  </section>`;
  const $ = (role: string) =>
    root.querySelector<HTMLElement>(`[data-role="${role}"]`)!;

  const reward = () => state?.rewards.find((r) => r.id === selected) ?? null;

  const fillLists = () => {
    for (const [id, values] of [
      ['cp-scenes', lists.scenes],
      ['cp-sources', lists.sources],
      ['cp-filters', lists.filters],
    ] as const)
      root.querySelector(`#${id}`)!.innerHTML = values
        .map((v) => `<option value="${esc(v)}"></option>`)
        .join('');
  };
  /** Suggestions read from OBS (read only); typing stays possible when OBS is closed. */
  const loadLists = async (scene?: string, source?: string) => {
    try {
      const qs = new URLSearchParams();
      if (scene) qs.set('scene', scene);
      if (source) qs.set('source', source);
      const res = await fetch(`/api/channel-points/obs?${qs}`, {
        headers: HEADERS,
      });
      if (res.ok) lists = await res.json();
    } catch {
      /* OBS closed: free typing */
    }
    fillLists();
  };

  const field = (
    i: number,
    name: string,
    value: string,
    list = '',
    placeholder = '',
  ) =>
    `<input data-i="${i}" data-f="${name}" value="${esc(value)}"${list ? ` list="${list}"` : ''} placeholder="${esc(placeholder)}" maxlength="256"/>`;

  const actionRow = (a: CpActionView, i: number) => {
    const type = `<select data-i="${i}" data-f="type">${TYPES.map(
      (t) =>
        `<option value="${t.id}"${t.id === a.type ? ' selected' : ''}>${t.label}</option>`,
    ).join('')}</select>`;
    const duration = (ms?: number) =>
      `<label class="cp-inline">pendant <input type="number" min="0" max="600" step="0.5" data-i="${i}" data-f="duration" value="${ms ? ms / 1000 : ''}" placeholder="toujours"/> s</label>`;
    let body: string;
    if (a.type === 'effect_sound')
      body = `<select data-i="${i}" data-f="sound_id"><option value="">— choisir un son d’effet —</option>${(
        state?.effects?.sounds ?? []
      )
        .map(
          (s) =>
            `<option value="${esc(s.id)}"${s.id === a.sound_id ? ' selected' : ''}${s.available || s.id === a.sound_id ? '' : ' disabled'}>${esc(s.label)}${s.available ? '' : ' (non importé)'}</option>`,
        )
        .join('')}</select>
        <label class="cp-inline">volume <input type="number" min="0" max="100" step="1" data-i="${i}" data-f="volume" value="${a.volume}"/> %</label>
        <button type="button" class="cp-ghost" data-act="preview" data-i="${i}"${a.sound_id ? '' : ' disabled'} title="Écouter ici (dans Studio, pas dans OBS)">▶ Écouter</button>`;
    else if (a.type === 'effect_video')
      body = `<select data-i="${i}" data-f="video_id"><option value="">— choisir une vidéo d’effet —</option>${(
        state?.effects?.videos ?? []
      )
        .map(
          (s) =>
            `<option value="${esc(s.id)}"${s.id === a.video_id ? ' selected' : ''}${s.available || s.id === a.video_id ? '' : ' disabled'}>${esc(s.label)}${s.available ? '' : ' (non importée)'}</option>`,
        )
        .join('')}</select>
        <label class="cp-inline">volume <input type="number" min="0" max="100" step="1" data-i="${i}" data-f="volume" value="${a.volume}"/> %</label>`;
    else if (a.type === 'sound')
      body = `<select data-i="${i}" data-f="sound_id"><option value="">— choisir un son —</option>${(
        state?.sounds ?? []
      )
        .filter((s) => s.enabled || s.id === a.sound_id)
        .map(
          (s) =>
            `<option value="${esc(s.id)}"${s.id === a.sound_id ? ' selected' : ''}>${esc(s.label)}</option>`,
        )
        .join('')}</select>`;
    else if (a.type === 'obs_source')
      body = `${field(i, 'scene', a.scene, 'cp-scenes', 'Scène')}${field(i, 'source', a.source, 'cp-sources', 'Source')}
        <select data-i="${i}" data-f="visible"><option value="1"${a.visible ? ' selected' : ''}>Afficher</option><option value="0"${a.visible ? '' : ' selected'}>Masquer</option></select>${duration(a.duration_ms)}`;
    else if (a.type === 'obs_filter')
      body = `${field(i, 'source', a.source, 'cp-sources', 'Source')}${field(i, 'filter', a.filter, 'cp-filters', 'Filtre')}
        <select data-i="${i}" data-f="enabled"><option value="1"${a.enabled ? ' selected' : ''}>Activer</option><option value="0"${a.enabled ? '' : ' selected'}>Désactiver</option></select>${duration(a.duration_ms)}`;
    else body = field(i, 'scene', a.scene, 'cp-scenes', 'Scène');
    return `<li class="cp-action"><span class="cp-step">${i + 1}</span>${type}<div class="cp-fields">${body}</div>
      <button type="button" class="cp-ghost" data-act="remove" data-i="${i}" title="Retirer">✕</button></li>`;
  };

  const renderEditor = () => {
    const r = reward();
    if (!r || !draft) {
      $('editor').innerHTML =
        '<p class="cp-muted">Choisis une récompense à gauche.</p>';
      return;
    }
    $('editor').innerHTML = `
      <p><b>${esc(r.title)}</b> <span class="cp-muted">· ${r.cost.toLocaleString('fr-FR')} pts</span></p>
      <label class="cp-inline"><input type="checkbox" data-f="rule-enabled"${draft.enabled ? ' checked' : ''}/> Règle active</label>
      <ol class="cp-actions">${draft.actions.map(actionRow).join('')}</ol>
      <div class="cp-buttons">
        <button type="button" data-act="add"${draft.actions.length >= 5 ? ' disabled' : ''}>+ Ajouter une action</button>
        <button type="button" class="cp-primary" data-act="save">Enregistrer</button>
        <button type="button" data-act="test"${r.rule ? '' : ' disabled'} title="Exécute la règle enregistrée pour de vrai (OBS / Soundboard)">Tester</button>
      </div>
      <p class="cp-muted" data-role="message">${esc(message)}</p>
      ${r.rule ? `<p class="cp-muted">Enregistré : ${r.rule.actions.map((a) => esc(actionLabel(a, state?.sounds, effectItems(state?.effects)))).join(' → ')}</p>` : ''}`;
  };

  const render = () => {
    const sw = root.querySelector<HTMLButtonElement>('[data-act="switch"]')!;
    sw.textContent = state?.settings.enabled
      ? 'Désactiver les automatisations'
      : 'Activer les automatisations';
    sw.className = state?.settings.enabled ? '' : 'cp-primary';
    sw.disabled = !state;
    $('status').innerHTML = statusView(state, error);
    // Kept while open (the URL may be selected for copying).
    if (!$('effects').querySelector('details[open]'))
      $('effects').innerHTML = effectsView(state?.effects ?? null);
    $('rewards').innerHTML = state ? rewardsView(state, selected) : '';
    $('history').innerHTML = state ? historyView(state) : '';
    renderEditor();
  };

  const load = async () => {
    try {
      const res = await fetch('/api/channel-points/state', {
        headers: HEADERS,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
    } catch (e) {
      error = `Points de chaîne indisponibles : ${(e as Error).message}`;
    }
    // The editor keeps its draft while the list refreshes.
    const editing =
      root.contains(document.activeElement) &&
      root.querySelector('.cp-actions')?.contains(document.activeElement);
    if (editing) {
      $('status').innerHTML = statusView(state, error);
      $('history').innerHTML = state ? historyView(state) : '';
    } else render();
  };

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`/api/channel-points${path}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
    return out;
  };

  /** Draft → the Core rule (seconds → ms; empty duration = permanent). */
  const toRule = () =>
    draft!.actions.map((a) => {
      const copy = { ...a } as CpActionView & { duration_ms?: number };
      if ('duration_ms' in copy && !copy.duration_ms) delete copy.duration_ms;
      return copy;
    });

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const rewardId = t.closest<HTMLElement>('[data-reward]')?.dataset.reward;
    if (rewardId) {
      selected = rewardId;
      const r = reward();
      draft = r?.rule
        ? {
            enabled: r.rule.enabled,
            actions: r.rule.actions.map((a) => ({ ...a })),
          }
        : { enabled: true, actions: [blank('effect_sound')] };
      message = '';
      render();
      void loadLists();
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'switch' && state) {
      const on = !state.settings.enabled;
      if (
        on &&
        !confirm(
          'Activer les automatisations de points de chaîne ?\n\nLes vraies récompenses de ta chaîne déclencheront les actions configurées (OBS, sons). SAMMI exécute encore les récompenses de production : si une même récompense est configurée des deux côtés, elle sera exécutée deux fois.',
        )
      )
        return;
      void post('/settings', { enabled: on }).then(load, (e) => {
        error = (e as Error).message;
        render();
      });
      return;
    }
    if (!draft) return;
    if (act === 'add' && draft.actions.length < 5)
      draft.actions.push(blank('effect_sound'));
    if (act === 'preview') {
      const a =
        draft.actions[Number(t.closest<HTMLElement>('[data-i]')!.dataset.i)];
      if (a?.type === 'effect_sound' && a.sound_id) {
        const audio = new Audio(
          `/effects/media/${encodeURIComponent(a.sound_id)}`,
        );
        audio.volume = Math.min(1, Math.max(0, a.volume / 100));
        void audio.play().catch(() => {
          message = 'Écoute impossible : son non importé ou illisible.';
          renderEditor();
        });
      }
      return;
    }
    if (act === 'remove')
      draft.actions.splice(
        Number(t.closest<HTMLElement>('[data-i]')!.dataset.i),
        1,
      );
    if (act === 'save' && selected) {
      const r = reward();
      void post(`/rules/${selected}`, {
        enabled: draft.enabled,
        actions: toRule(),
        ...(r?.rule ? { expected_version: r.rule.version } : {}),
      }).then(
        async () => {
          message = 'Règle enregistrée.';
          await load();
        },
        (e) => {
          const code = (e as Error).message;
          message =
            code === 'version_conflict'
              ? 'Modifiée ailleurs entre-temps : recharge la récompense.'
              : code === 'invalid_request'
                ? 'Action incomplète : choisis un son, une scène, une source ou un filtre.'
                : `Refusée : ${code}`;
          renderEditor();
        },
      );
      return;
    }
    if (act === 'test' && selected) {
      if (
        !confirm(
          'Tester cette récompense ?\n\nLa règle enregistrée est exécutée pour de vrai : OBS, Soundboard et lecteur d’effets.',
        )
      )
        return;
      void post('/test', { reward_id: selected }).then(
        async () => {
          message = 'Test envoyé : voir l’historique.';
          await load();
        },
        (e) => {
          message = `Test refusé : ${(e as Error).message}`;
          renderEditor();
        },
      );
      return;
    }
    renderEditor();
  });

  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (!draft) return;
    if (t.dataset.f === 'rule-enabled') {
      draft.enabled = t.checked;
      return;
    }
    const i = Number(t.dataset.i);
    const a = draft.actions[i] as unknown as Record<string, unknown>;
    if (!a) return;
    const f = t.dataset.f!;
    if (f === 'type') draft.actions[i] = blank(t.value as CpActionView['type']);
    else if (f === 'visible' || f === 'enabled') a[f] = t.value === '1';
    else if (f === 'volume')
      a.volume = Math.min(100, Math.max(0, Math.round(Number(t.value) || 0)));
    else if (f === 'sound_id' && a.type === 'effect_sound') {
      // A sound chosen: its original volume (SAMMI) by default.
      a.sound_id = t.value;
      a.volume =
        state?.effects?.sounds.find((x) => x.id === t.value)?.volume ?? 100;
      renderEditor();
    } else if (f === 'video_id' && a.type === 'effect_video') {
      // A video chosen: its legacy effective volume by default.
      a.video_id = t.value;
      a.volume =
        state?.effects?.videos.find((x) => x.id === t.value)?.volume ?? 100;
      renderEditor();
    } else if (f === 'duration') {
      const s = Number(t.value);
      if (s > 0) a.duration_ms = Math.round(s * 1000);
      else delete a.duration_ms;
    } else a[f] = t.value.trim();
    if (f === 'type') renderEditor();
    if (f === 'scene' || f === 'source')
      void loadLists(String(a.scene ?? ''), String(a.source ?? ''));
  });

  return {
    setVisible(visible: boolean) {
      if (timer) window.clearInterval(timer);
      timer = null;
      if (!visible) return;
      void load();
      timer = window.setInterval(() => void load(), 3000);
    },
  };
}
