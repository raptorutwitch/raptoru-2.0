// « Modération » tab — the SAME D4 console as the extension (apps/twitch-extension/extension/shared/
// moderation-v2.js, served by this Studio under /ext/), with Studio as the actor (the broadcaster):
// one moderation, one implementation, the same Core read models and commands (/api/lab/* → local
// Lab Core, which decides, stores and audits). Around it, the Studio-only tools D4 leaves to Studio:
// Tombola (opening, draw, closing), supermods, TTS configuration and the Lab test wallet.

type Json = Record<string, unknown>;
type View = 'console' | 'raffle' | 'team' | 'config' | 'wallet';
interface ConsoleView {
  node: HTMLElement;
  start(): void;
  attached(): void;
  suspend(): void;
  resume(): void;
  destroy(): void;
}
type ConsoleFactory = (options: {
  document: Document;
  client: {
    modV2: (path: string) => Promise<unknown>;
    modV2Act: (command: Json) => Promise<unknown>;
  };
  assetBase?: string;
}) => ConsoleView;

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const fmt = (n: number) => Number(n).toLocaleString('fr-FR');
const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60
    ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
    : `${s} s`;
};
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const ERRORS: Record<string, string> = {
  forbidden: 'Action non autorisée pour ce rôle.',
  invalid_rules: 'Configuration refusée par Core.',
  raffle_already_open: 'Une tombola est déjà ouverte.',
  no_open_raffle: 'Aucune tombola ouverte.',
  nothing_to_draw: 'Aucune tombola à tirer.',
  target_not_editable: 'Le streamer garde toutes les permissions.',
  lab_core_unavailable: 'Core local indisponible.',
  core_unavailable: 'Core local indisponible.',
};

/** Studio API (Lab Core relay). Errors keep Core's code and details (like the extension client). */
async function api<T = Json>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/lab${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw Object.assign(new Error(out.error ?? 'error'), {
      code: out.error,
      details: out,
      body: out,
    });
  return out;
}

export function mountModeration(root: HTMLElement) {
  root.classList.add('mod-root2');
  root.innerHTML = `
    <nav class="mod-bar" aria-label="Modération">
      <button class="mod-nav is-on" type="button" data-view="console">Console D4</button>
      <button class="mod-nav" type="button" data-view="raffle">Tombola <em>Studio</em></button>
      <button class="mod-nav" type="button" data-view="team">Supermods</button>
      <button class="mod-nav" type="button" data-view="config">Configuration TTS</button>
      <button class="mod-nav" type="button" data-view="wallet">Wallet de test <em>Lab</em></button>
      <span class="mod-foot">Même console que l’extension · Core local · tout est audité</span>
    </nav>
    <section class="mod-console" data-id="console"><p class="muted">Chargement de la console…</p></section>
    <section class="mod-center mod-tool" data-id="tool" hidden></section>
    <div class="mod-toast" data-id="toast" hidden></div>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<T>(`[data-id="${id}"]`)!;

  let view: View = 'console';
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let consoleView: ConsoleView | null = null;
  const editing = () => view === 'config' || view === 'wallet';

  const toast = (text: string, bad = false) => {
    const t = $('toast');
    t.textContent = text;
    t.className = `mod-toast${bad ? ' is-bad' : ''}`;
    t.hidden = false;
    clearTimeout((t as unknown as { _t?: ReturnType<typeof setTimeout> })._t);
    (t as unknown as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(
      () => (t.hidden = true),
      3500,
    );
  };
  const errorText = (e: unknown) => {
    const b = (
      e as { body?: { error?: string; message?: string; errors?: string[] } }
    ).body;
    if (b?.errors?.length) return b.errors.join(' ');
    return (
      ERRORS[b?.error ?? ''] ?? b?.message ?? b?.error ?? (e as Error).message
    );
  };
  const act = async (command: Json, done?: string) => {
    try {
      await api('/actions', { command });
      if (done) toast(done);
    } catch (e) {
      toast(errorText(e), true);
    }
    void renderTool();
  };

  // --- the D4 console (shared module of the extension) -----------------------------------------------
  async function mountConsole() {
    if (consoleView) return;
    const host = $('console');
    try {
      if (!document.querySelector('link[data-modv2]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/ext/moderation-v2.css';
        link.dataset.modv2 = '1';
        document.head.append(link);
      }
      const url = '/ext/shared/moderation-v2.js';
      const mod = (await import(/* @vite-ignore */ url)) as {
        createModerationV2View: ConsoleFactory;
      };
      consoleView = mod.createModerationV2View({
        document,
        client: {
          modV2: (path) => api(`/${path}`),
          modV2Act: (command) => api('/actions', { command }),
        },
        assetBase: '/ext/',
      });
      host.innerHTML = '';
      host.append(consoleView.node);
      consoleView.start();
    } catch (e) {
      host.innerHTML = `<p class="bad">Console indisponible : ${esc((e as Error).message)}</p>`;
    }
  }

  // --- Tombola (Studio: opening, draw, closing) --------------------------------------------------------
  async function renderRaffle() {
    const center = $('tool');
    // The view follows Core every 2 s: what is being typed in the form is kept.
    const typed = Object.fromEntries(
      [...center.querySelectorAll<HTMLInputElement>('[data-r]')].map((i) => [
        i.dataset.r!,
        i.value,
      ]),
    );
    const r = await api<{
      module_state: string;
      current: {
        status: string;
        jackpot: number;
        participants: number;
        ends_at: string;
        winners_count: number;
      } | null;
      participants: { display_name: string }[];
      last_draw: {
        drawn_at: string;
        jackpot: number;
        participants: number;
        winners: { display_name: string; amount: number }[];
      } | null;
    }>('/raffle');
    const cur = r.current;
    const open = cur?.status === 'open';
    center.innerHTML = `<header class="mod-head"><h2>Tombola</h2><span class="muted">Inscription gratuite (une par viewer) · cagnotte offerte par la chaîne · gagnants payés sur le wallet de test · module ${esc(r.module_state)}</span></header>
      <p>${open ? `<b class="okc">Ouverte</b> · ferme à ${hhmm(cur.ends_at)} (${secs(Date.parse(cur.ends_at) - Date.now())}) · <b>${cur.participants}</b> inscrit·s · cagnotte <b>${fmt(cur.jackpot)} J</b> · ${cur.winners_count} gagnant·s` : cur?.status === 'closed' ? `<b>Fermée</b> · ${cur.participants} inscrit·s · en attente du tirage (cagnotte ${fmt(cur.jackpot)} J)` : '<b>Fermée</b>'}</p>
      ${open ? `<p class="muted">${r.participants.map((p) => esc(p.display_name)).join(' · ') || 'Aucun inscrit.'}</p>` : ''}
      <div class="mod-grid">
        <fieldset><legend>Ouvrir</legend>
          <label>Cagnotte (jetons) <input type="number" data-r="jackpot" value="5000" min="0" step="500"></label>
          <label>Durée (s) <input type="number" data-r="duration" value="60" min="10" max="3600"></label>
          <label>Gagnants <input type="number" data-r="winners" value="1" min="1" max="10"></label>
          <button type="button" data-raffle="open" ${open ? 'disabled' : ''}>Ouvrir la tombola</button></fieldset>
        <fieldset><legend>Clore</legend>
          <button type="button" class="ghost" data-raffle="close" ${open ? '' : 'disabled'}>Fermer (sans tirer)</button>
          <button type="button" data-raffle="draw" ${open || cur?.status === 'closed' ? '' : 'disabled'}>Tirer au sort</button></fieldset>
      </div>
      <h3>Dernier tirage</h3>
      ${r.last_draw ? `<p>${hhmm(r.last_draw.drawn_at)} · ${r.last_draw.participants} inscrit·s · ${r.last_draw.winners.map((w) => `<b>${esc(w.display_name)}</b> + ${fmt(w.amount)} J`).join(' · ') || 'aucun gagnant'}</p>` : '<p class="muted">Aucun tirage.</p>'}`;
    for (const [k, v] of Object.entries(typed)) {
      const input = center.querySelector<HTMLInputElement>(`[data-r="${k}"]`);
      if (input) input.value = v;
    }
  }

  // --- supermods (named by the broadcaster; D4 grants are edited in the console's team drawer) --------
  async function renderTeam() {
    const center = $('tool');
    const { members } = await api<{
      members: {
        viewer_id: string;
        display_name: string;
        role: string;
        grants: string[];
      }[];
    }>('/team');
    center.innerHTML = `<header class="mod-head"><h2>Supermods</h2><span class="muted">Un supermod a toutes les permissions D4. Les permissions fines d’un mod se règlent dans la console (bouclier « Équipe & permissions »).</span></header>
      ${members
        .map(
          (
            m,
          ) => `<div class="mod-row"><span class="mod-pos">${m.role === 'broadcaster' ? '★' : m.role === 'supermod' ? 'S' : 'M'}</span><b>${esc(m.display_name)}</b>
          <span class="mod-meta">${m.role === 'broadcaster' ? 'Streamer' : m.role === 'supermod' ? 'Supermod' : `Mod · ${m.grants.length} permission${m.grants.length > 1 ? 's' : ''}`}</span><span class="mod-pay">${esc(m.viewer_id)}</span>
          <span class="mod-actions">${m.role === 'broadcaster' ? '' : `<button type="button" class="${m.role === 'supermod' ? 'ghost' : ''}" data-staff="${esc(m.viewer_id)}" data-role="${m.role === 'supermod' ? '' : 'supermod'}">${m.role === 'supermod' ? 'Retirer supermod' : 'Nommer supermod'}</button>`}</span></div>`,
        )
        .join('')}
      <p class="muted">Un mod apparaît ici dès qu’il ouvre la console de modération dans l’extension (rôle Twitch).</p>`;
  }

  // --- TTS configuration ------------------------------------------------------------------------------------------
  type Tier = {
    min: number;
    max: number | null;
    price: number;
    credit_cost: number;
    cooldown_seconds: number;
  };
  type Rules = {
    tiers: Tier[];
    max_chars: number;
    max_waiting_global: number;
    max_waiting_weight_ms: number | null;
    transition_gap_ms: number;
    max_per_viewer: number;
  };
  let draft: Rules | null = null;
  async function renderConfig(reload = true) {
    const center = $('tool');
    let customized = false;
    let moduleState = '';
    if (reload || !draft) {
      const v = await api<{
        rules: Rules;
        customized: boolean;
        module_state: string;
      }>('/tts/rules');
      draft = structuredClone(v.rules);
      customized = v.customized;
      moduleState = v.module_state;
    }
    const d = draft!;
    const num = (field: string, value: number | null, attrs = '') =>
      `<input type="number" data-f="${field}" value="${value ?? ''}" ${attrs}>`;
    center.innerHTML = `<header class="mod-head"><h2>TTS · Configuration</h2><span class="muted">${customized ? 'Valeurs personnalisées' : 'Valeurs par défaut (legacy)'} · appliquées par Core dès l’enregistrement${moduleState ? ` · module ${esc(moduleState)}` : ''}</span></header>
      <table class="mod-table mod-tiers"><thead><tr><th>Longueur min</th><th>Longueur max</th><th>Prix jetons</th><th>Crédits</th><th>Cooldown (s)</th><th></th></tr></thead><tbody>
      ${d.tiers
        .map(
          (
            t,
            i,
          ) => `<tr data-tier="${i}"><td>${num('min', t.min, 'min="1"')}</td><td>${num('max', t.max, `min="1" placeholder="${i === d.tiers.length - 1 ? 'ouvert' : ''}"`)}</td>
            <td>${num('price', t.price, 'min="0" step="100"')}</td><td>${num('credit_cost', t.credit_cost, 'min="0"')}</td><td>${num('cooldown_seconds', t.cooldown_seconds, 'min="0"')}</td>
            <td><button type="button" class="ghost" data-tier-del="${i}" ${d.tiers.length < 2 ? 'disabled' : ''}>Retirer</button></td></tr>`,
        )
        .join('')}</tbody></table>
      <p><button type="button" class="ghost" data-tier-add>Ajouter un palier</button> <span class="muted">Dernier palier sans max = ouvert.</span></p>
      <div class="mod-grid">
        <fieldset><legend>Message</legend><label>Longueur max <input type="number" data-g="max_chars" value="${d.max_chars}" min="1"></label></fieldset>
        <fieldset><legend>File</legend>
          <label>Nombre max en attente <input type="number" data-g="max_waiting_global" value="${d.max_waiting_global}" min="1"></label>
          <label>Durée max en attente (s, vide = aucune) <input type="number" data-g="max_waiting_weight_s" value="${d.max_waiting_weight_ms === null ? '' : Math.round(d.max_waiting_weight_ms / 1000)}" min="5"></label>
          <label>Délai entre deux TTS (ms) <input type="number" data-g="transition_gap_ms" value="${d.transition_gap_ms}" min="0" step="100"></label></fieldset>
        <fieldset><legend>Viewer</legend><label>TTS simultanés par viewer <input type="number" data-g="max_per_viewer" value="${d.max_per_viewer}" min="1"></label></fieldset>
      </div>
      <p class="bad" data-id="config-errors"></p>
      <div class="actions"><button type="button" data-config-save>Enregistrer</button><button type="button" class="ghost" data-config-reset>Restaurer les valeurs par défaut</button><button type="button" class="ghost" data-config-reload>Annuler les modifications</button></div>`;
  }
  function readDraft(): Rules {
    const d = structuredClone(draft!);
    const n = (v: string) => (v.trim() === '' ? null : Number(v));
    root.querySelectorAll<HTMLTableRowElement>('[data-tier]').forEach((row) => {
      const t = d.tiers[Number(row.dataset.tier)]!;
      for (const input of row.querySelectorAll<HTMLInputElement>('[data-f]')) {
        const f = input.dataset.f as keyof Tier;
        (t as Record<string, number | null>)[f] =
          f === 'max' ? n(input.value) : Number(input.value);
      }
    });
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-g]')) {
      const g = input.dataset.g!;
      if (g === 'max_waiting_weight_s')
        d.max_waiting_weight_ms =
          n(input.value) === null ? null : Number(input.value) * 1000;
      else (d as unknown as Record<string, number>)[g] = Number(input.value);
    }
    return d;
  }

  // --- Lab test wallet tools (set / reset; the D4 « Wallet admin » is in the console) --------------------------
  let walletViewer: string | null = null;
  async function renderWallet() {
    const center = $('tool');
    const { identities } = await api<{
      identities: { id: string; label: string }[];
    }>('/identities');
    walletViewer ??= identities[0]?.id ?? null;
    const [w, card] = walletViewer
      ? await Promise.all([
          api<{
            tokens: number;
            credits_tts: number;
            credits_soundboard: number;
          }>(`/wallet/${walletViewer}`),
          api<{ tts_cooldown_until: string | null }>(
            `/viewers/${walletViewer}`,
          ),
        ])
      : [null, null];
    const until = card?.tts_cooldown_until ?? null;
    center.innerHTML = `<header class="mod-head"><h2>Wallet de test <em class="lab">Lab</em></h2><span class="muted">Jetons et crédits fictifs du Lab local · jamais l’économie réelle · outils Studio (valeurs exactes, reset)</span></header>
      <label class="mod-field">Viewer <select data-id="wallet-viewer">${identities.map((i) => `<option value="${esc(i.id)}" ${i.id === walletViewer ? 'selected' : ''}>${esc(i.label)} · ${esc(i.id)}</option>`).join('')}</select></label>
      ${
        w
          ? `<div class="mod-wallet">
            <label>Jetons <input type="number" data-w="tokens" value="${w.tokens}" min="0"></label>
            <label>Crédits TTS <input type="number" data-w="credits_tts" value="${w.credits_tts}" min="0"></label>
            <label>Crédits Soundboard <input type="number" data-w="credits_soundboard" value="${w.credits_soundboard}" min="0"></label>
          </div>
          <div class="actions"><button type="button" data-wallet="set">Définir</button>
            <button type="button" class="ghost" data-wallet="adjust" data-tokens="10000">+10 000 jetons</button>
            <button type="button" class="ghost" data-wallet="adjust" data-credits_tts="1">+1 crédit TTS</button>
            <button type="button" class="ghost" data-wallet="adjust" data-credits_soundboard="1">+1 crédit Soundboard</button>
            <button type="button" class="ghost" data-wallet="reset">Reset test</button></div>
          <h3>Cooldown TTS</h3>
          <p>${until ? `Actif jusqu’à ${hhmm(until)} (${secs(Date.parse(until) - Date.now())})` : 'Aucun cooldown TTS.'}
            <button type="button" data-tts-clear="${esc(walletViewer)}" ${until ? '' : 'disabled'}>Effacer le cooldown TTS</button></p>`
          : '<p class="muted">Aucun viewer.</p>'
      }`;
  }

  async function renderTool(reload = true) {
    if (view === 'console') return;
    try {
      if (view === 'raffle') await renderRaffle();
      else if (view === 'team') await renderTeam();
      else if (view === 'config') await renderConfig(reload);
      else if (view === 'wallet') await renderWallet();
    } catch (e) {
      $('tool').innerHTML = `<p class="bad">${esc(errorText(e))}</p>`;
    }
  }
  const showView = (v: View) => {
    view = v;
    for (const b of root.querySelectorAll<HTMLElement>('[data-view]'))
      b.classList.toggle('is-on', b.dataset.view === v);
    $('console').hidden = v !== 'console';
    $('tool').hidden = v === 'console';
    if (v === 'console') consoleView?.attached();
    else void renderTool();
  };

  // --- events ------------------------------------------------------------------------------------------------------------
  root.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    const nav = t.closest<HTMLElement>('.mod-bar [data-view]');
    if (nav) return showView(nav.dataset.view as View);
    const r = t.closest<HTMLElement>('[data-raffle]');
    if (r) {
      const val = (k: string) =>
        Number(root.querySelector<HTMLInputElement>(`[data-r="${k}"]`)?.value);
      const op = r.dataset.raffle;
      return act(
        op === 'open'
          ? {
              action: 'raffle_open',
              jackpot: Math.max(0, Math.round(val('jackpot') || 0)),
              duration_s: Math.min(
                3600,
                Math.max(10, Math.round(val('duration') || 60)),
              ),
              winners: Math.min(
                10,
                Math.max(1, Math.round(val('winners') || 1)),
              ),
            }
          : { action: op === 'close' ? 'raffle_close' : 'raffle_draw' },
        op === 'open'
          ? 'Tombola ouverte'
          : op === 'close'
            ? 'Tombola fermée'
            : 'Tirage effectué',
      );
    }
    const staff = t.closest<HTMLElement>('[data-staff]');
    if (staff)
      return act(
        {
          action: 'set_staff',
          viewer_id: staff.dataset.staff,
          role: staff.dataset.role || null,
        },
        staff.dataset.role ? 'Nommé supermod' : 'Supermod retiré',
      );
    const clear = t.closest<HTMLElement>('[data-tts-clear]');
    if (clear)
      return act(
        {
          action: 'clear_cooldown',
          viewer_id: clear.dataset.ttsClear,
          module: 'tts',
        },
        'Cooldown TTS effacé',
      );
    // TTS configuration
    if (t.closest('[data-tier-add]') && draft) {
      draft = readDraft();
      const last = draft.tiers.at(-1)!;
      const min = (last.max ?? last.min) + 1;
      if (last.max === null) last.max = last.min;
      draft.tiers.push({
        min: Math.max(min, last.max + 1),
        max: null,
        price: last.price,
        credit_cost: last.credit_cost,
        cooldown_seconds: last.cooldown_seconds,
      });
      return void renderConfig(false);
    }
    const del = t.closest<HTMLElement>('[data-tier-del]');
    if (del && draft) {
      draft = readDraft();
      draft.tiers.splice(Number(del.dataset.tierDel), 1);
      return void renderConfig(false);
    }
    if (t.closest('[data-config-reload]')) return void renderConfig(true);
    if (t.closest('[data-config-save]') && draft) {
      const rules = readDraft();
      try {
        await api('/tts/rules', { rules });
        toast('Configuration TTS enregistrée : appliquée aux prochains achats');
        return void renderConfig(true);
      } catch (e) {
        $('config-errors').textContent = errorText(e);
        return;
      }
    }
    if (t.closest('[data-config-reset]')) {
      if (!confirm('Restaurer les valeurs TTS par défaut (legacy) ?')) return;
      try {
        await api('/tts/rules/reset', {});
        toast('Valeurs par défaut restaurées');
      } catch (e) {
        toast(errorText(e), true);
      }
      return void renderConfig(true);
    }
    // Lab wallet tools
    const w = t.closest<HTMLElement>('[data-wallet]');
    if (w && walletViewer) {
      const op = w.dataset.wallet!;
      const body: Json = { viewer_id: walletViewer, op };
      if (op === 'set')
        for (const input of root.querySelectorAll<HTMLInputElement>('[data-w]'))
          body[input.dataset.w!] = Number(input.value);
      if (op === 'adjust')
        for (const k of ['tokens', 'credits_tts', 'credits_soundboard'])
          if (w.dataset[k]) body[k] = Number(w.dataset[k]);
      if (
        op === 'reset' &&
        !confirm('Remettre ce wallet de test aux valeurs par défaut ?')
      )
        return;
      try {
        await api('/wallet', body);
        toast('Wallet de test mis à jour');
      } catch (e) {
        toast(errorText(e), true);
      }
      return void renderWallet();
    }
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.matches('[data-id="wallet-viewer"]')) {
      walletViewer = (t as HTMLSelectElement).value;
      void renderWallet();
    }
  });

  // Tool views without a form follow Core (the console polls by itself).
  const loop = async () => {
    if (!visible) return;
    if (!editing() && view !== 'console') await renderTool();
    timer = setTimeout(() => void loop(), 2000);
  };
  return {
    setVisible(v: boolean) {
      visible = v;
      clearTimeout(timer);
      if (v) {
        void mountConsole();
        consoleView?.resume();
        consoleView?.attached();
        void loop();
      } else consoleView?.suspend();
    },
  };
}
