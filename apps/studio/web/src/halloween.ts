// Halloween (docs/HALLOWEEN.md) — Studio's tab: the overlay engine (state, screen, volume, safe mode, local tests,
// STOP ALL) and the Core's shop (open / closed, rules, catalogue, Bonbons grants, what was bought). Every button here
// acts for real: a local test plays on the streamer's screen (an explicit click), the shop controls write the Core.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

type Json = Record<string, unknown>;

interface Status {
  environment: string | null;
  core: { connected: boolean; error: string | null } | null;
  engine_ready: boolean;
  page: { connected: boolean; ready: boolean };
  settings: {
    overlay_enabled: boolean;
    display_id: number | null;
    volume: number;
    safe_mode: boolean;
  };
  displays: {
    id: number;
    label: string;
    bounds: { width: number; height: number };
    primary: boolean;
  }[];
  media: {
    id: string;
    label: string;
    kind: string;
    duration_ms: number | null;
  }[];
  effects: string[];
  current: {
    source: string;
    label: string;
    viewer: string;
    state: string;
  } | null;
  events: { at: string; text: string; level: string }[];
}

interface Item {
  item_id: string;
  kind: 'screamer' | 'apparition' | 'effect';
  media_id: string | null;
  effect: string | null;
  label: string;
  description: string;
  price: number;
  cooldown_ms: number;
  enabled: boolean;
}

interface Admin {
  settings: { season: string; enabled: boolean; rules: Record<string, number> };
  items: Item[];
  engine: { ready: boolean } | null;
  purchases: {
    purchase_id: string;
    label: string;
    price: number;
    viewer: { name: string };
    status: string;
    refund_status: string;
    error: string | null;
    created_at: string;
  }[];
  ledger: {
    id: number;
    viewer: { name: string };
    kind: string;
    amount: number;
    balance_after: number;
    reason: string | null;
    created_at: string;
  }[];
  totals: { wallets: number; bonbons: number };
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const KIND: Record<string, string> = {
  screamer: 'Screamer',
  apparition: 'Apparition',
  effect: 'Effet',
};
const STATUS: Record<string, string> = {
  queued: 'en attente',
  executing: 'en cours',
  completed: 'joué',
  failed: 'échec',
  unknown: 'fin inconnue',
};
const LEDGER: Record<string, string> = {
  grant: 'cadeau',
  remove: 'retrait',
  sub_reward: 'sub',
  gift_reward: 'subgift',
  convert: 'conversion',
  purchase: 'achat',
  refund: 'remboursement',
  raffle: 'tombola',
};
const EFFECT_LABEL: Record<string, string> = {
  blink: 'Clignement',
  fog: 'Brouillard',
  glitch: 'Signal corrompu',
  tunnel: 'Vision tunnel',
  eyes: 'Yeux dans le noir',
  silhouette: 'Silhouette',
};
/** Rules shown in the panel (units for people: seconds, not milliseconds). */
const RULES: { key: string; label: string; ms?: boolean; hint: string }[] = [
  { key: 'conversion_rate', label: 'Jetons pour 1 Bonbon', hint: 'conversion' },
  {
    key: 'conversion_cap_per_hour',
    label: 'Bonbons convertibles / heure / viewer',
    hint: '0 = conversion fermée',
  },
  { key: 'sub_reward', label: 'Bonbons par sub / resub', hint: 'l’abonné' },
  {
    key: 'gift_giver_per_sub',
    label: 'Bonbons au donateur, par sub offert',
    hint: 'anonyme : rien',
  },
  {
    key: 'gift_recipient',
    label: 'Bonbons au bénéficiaire d’un sub offert',
    hint: '',
  },
  {
    key: 'viewer_gap_ms',
    label: 'Attente entre deux achats d’un viewer (s)',
    ms: true,
    hint: '',
  },
  {
    key: 'screamer_gap_ms',
    label: 'Écart minimal entre deux screamers (s)',
    ms: true,
    hint: '',
  },
  {
    key: 'screamers_per_hour',
    label: 'Screamers maximum par heure',
    hint: '0 = screamers fermés',
  },
];
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

/** Engine state in words (pure, tested). */
export function engineState(s: Status | null): {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
} {
  if (!s) return { tone: 'warn', text: 'Chargement…' };
  if (!s.settings.overlay_enabled)
    return { tone: 'warn', text: 'Overlay désactivé' };
  if (!s.page.connected)
    return { tone: 'bad', text: 'Overlay absent (fenêtre non ouverte)' };
  if (!s.page.ready)
    return { tone: 'bad', text: 'Overlay incapable de lire les vidéos' };
  if (s.core && !s.core.connected)
    return {
      tone: 'warn',
      text: 'Overlay prêt · Core injoignable (achats suspendus)',
    };
  return {
    tone: 'ok',
    text: s.core
      ? 'Prêt · les achats sont joués'
      : 'Prêt · tests locaux seulement (aucun Core)',
  };
}

export function overlayCard(s: Status | null) {
  if (!s) return '<p class="hw-hint">Chargement…</p>';
  const st = engineState(s);
  const displays = s.displays.length
    ? s.displays
        .map(
          (d) =>
            `<option value="${d.id}"${(s.settings.display_id ?? s.displays.find((x) => x.primary)?.id) === d.id ? ' selected' : ''}>${esc(d.label)} — ${d.bounds.width}×${d.bounds.height}${d.primary ? ' (principal)' : ''}</option>`,
        )
        .join('')
    : '<option value="">Écran principal</option>';
  const tests = [
    ...s.effects.map(
      (e) =>
        `<button type="button" class="hw-chip" data-test-effect="${esc(e)}">${esc(EFFECT_LABEL[e] ?? e)}</button>`,
    ),
    ...s.media.map(
      (m) =>
        `<button type="button" class="hw-chip ${m.kind === 'screamer' ? 'scream' : ''}" data-test-media="${esc(m.id)}" title="${esc(m.kind)}${m.duration_ms ? ` · ${(m.duration_ms / 1000).toFixed(1)} s` : ''}">${esc(m.label)}</button>`,
    ),
  ].join('');
  return `<div class="hw-state ${st.tone}"><span class="hw-dot"></span>${esc(st.text)}</div>
    ${s.current ? `<p class="hw-now">En cours : <b>${esc(s.current.label)}</b> · ${esc(s.current.viewer)} · ${esc(s.current.state)}</p>` : ''}
    <div class="hw-form">
      <label class="hw-check"><input type="checkbox" data-set="overlay_enabled"${s.settings.overlay_enabled ? ' checked' : ''}/> Overlay actif</label>
      <label>Écran <select data-set="display_id">${displays}</select></label>
      <label>Volume <input type="range" min="0" max="100" step="5" value="${Math.round(s.settings.volume * 100)}" data-set="volume"/> <span>${Math.round(s.settings.volume * 100)} %</span></label>
      <label class="hw-check"><input type="checkbox" data-set="safe_mode"${s.settings.safe_mode ? ' checked' : ''}/> Mode sûr (photosensibilité : pas de « signal corrompu »)</label>
    </div>
    <p class="hw-hint">${s.media.length} médias · <button type="button" class="hw-link" data-act="reload">Recharger les médias</button> · STOP ALL global : <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>F12</kbd></p>
    <details class="hw-tests"><summary>Tester sur mon écran (joue réellement, sans achat)</summary><div class="hw-chips">${tests}</div></details>
    <ul class="hw-log">${s.events
      .slice(0, 8)
      .map(
        (e) =>
          `<li class="${e.level === 'error' ? 'bad' : ''}"><time>${time(e.at)}</time> ${esc(e.text)}</li>`,
      )
      .join('')}</ul>`;
}

export function shopCard(a: Admin | null, error: string | null) {
  if (error)
    return `<p class="hw-hint bad">Boutique indisponible : ${esc(error)}</p>`;
  if (!a) return '<p class="hw-hint">Chargement…</p>';
  const r = a.settings.rules;
  const rules = RULES.map(
    (x) =>
      `<label><span>${esc(x.label)}${x.hint ? ` <small>${esc(x.hint)}</small>` : ''}</span><input type="number" min="0" step="1" data-rule="${x.key}" value="${x.ms ? Math.round((r[x.key] ?? 0) / 1000) : (r[x.key] ?? 0)}"/></label>`,
  ).join('');
  return `<div class="hw-open ${a.settings.enabled ? 'on' : ''}">
      <div><b>Boutique ${a.settings.enabled ? 'OUVERTE' : 'fermée'}</b> <small>saison ${esc(a.settings.season)}</small>
        <p class="hw-hint">${a.settings.enabled ? 'Les viewers voient la boutique, gagnent et dépensent des Bonbons.' : 'Fermée : rien n’est gagné ni dépensé (les soldes sont gardés).'}</p></div>
      <button type="button" class="${a.settings.enabled ? '' : 'primary'}" data-act="toggle-shop">${a.settings.enabled ? 'Fermer la boutique' : 'Ouvrir la boutique'}</button>
    </div>
    <div class="hw-rules">${rules}</div>
    <button type="button" class="primary" data-act="save-rules">Enregistrer les règles</button>`;
}

export function catalogueCard(a: Admin | null) {
  if (!a) return '';
  const rows = a.items
    .map(
      (
        i,
      ) => `<tr data-item="${esc(i.item_id)}" class="${i.enabled ? '' : 'off'}">
      <td><input type="checkbox" data-field="enabled"${i.enabled ? ' checked' : ''} aria-label="Activé"/></td>
      <td><input type="text" maxlength="40" data-field="label" value="${esc(i.label)}"/></td>
      <td><span class="hw-kind ${i.kind}">${KIND[i.kind]}</span></td>
      <td><input type="number" min="1" max="100000" data-field="price" value="${i.price}"/></td>
      <td><input type="number" min="0" max="86400" data-field="cooldown" value="${Math.round(i.cooldown_ms / 1000)}"/></td>
      <td><button type="button" class="hw-small" ${i.media_id ? `data-test-media="${esc(i.media_id)}"` : `data-test-effect="${esc(i.effect)}"`}>Tester</button></td>
    </tr>`,
    )
    .join('');
  return `<table class="hw-table"><thead><tr><th>On</th><th>Nom affiché</th><th>Type</th><th>Prix (Bonbons)</th><th>Cooldown (s)</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hw-hint">Chaque changement est enregistré dans le Core dès que tu quittes le champ.</p>`;
}

export function bonbonsCard(a: Admin | null) {
  if (!a) return '';
  const purchases = a.purchases
    .slice(0, 12)
    .map(
      (p) =>
        `<li><time>${time(p.created_at)}</time> <b>${esc(p.viewer.name)}</b> · ${esc(p.label)} · ${p.price} 🍬 · <span class="hw-st ${esc(p.status)}">${esc(STATUS[p.status] ?? p.status)}${p.refund_status === 'refunded' ? ' · remboursé' : ''}</span>${p.error ? ` <small>(${esc(p.error)})</small>` : ''}</li>`,
    )
    .join('');
  const ledger = a.ledger
    .slice(0, 14)
    .map(
      (l) =>
        `<li><time>${time(l.created_at)}</time> <b>${esc(l.viewer.name)}</b> ${l.amount > 0 ? '+' : ''}${l.amount} 🍬 <small>${esc(LEDGER[l.kind] ?? l.kind)} → ${l.balance_after}</small></li>`,
    )
    .join('');
  return `<p class="hw-hint">${a.totals.bonbons} Bonbons en circulation · ${a.totals.wallets} viewers</p>
    <form class="hw-grant" data-form="grant">
      <input name="viewer" required maxlength="64" placeholder="Pseudo Twitch" aria-label="Pseudo"/>
      <input name="amount" required type="number" min="-100000" max="100000" step="1" placeholder="Bonbons (+/-)" aria-label="Bonbons"/>
      <select name="reason" aria-label="Motif"><option value="grant">Cadeau</option><option value="raffle">Tombola</option></select>
      <input name="note" maxlength="200" placeholder="Note (facultatif)" aria-label="Note"/>
      <button type="submit" class="primary">Attribuer</button>
    </form>
    <div class="hw-cols"><div><h4>Achats</h4><ul class="hw-log">${purchases || '<li class="hw-hint">Aucun achat.</li>'}</ul></div>
    <div><h4>Mouvements</h4><ul class="hw-log">${ledger || '<li class="hw-hint">Aucun mouvement.</li>'}</ul></div></div>`;
}

export function mountHalloween(root: HTMLElement) {
  let status: Status | null = null;
  let admin: Admin | null = null;
  let adminError: string | null = null;
  let visible = false;
  let flash = '';
  root.innerHTML = `<div class="hw">
    <header class="hw-head"><h2>🎃 Halloween</h2><span class="hw-flash" data-role="flash"></span>
      <button type="button" class="hw-stop" data-act="stop" title="Arrête immédiatement tout effet (Ctrl+Maj+F12)">STOP ALL</button></header>
    <div class="hw-grid">
      <section class="card"><h3>Overlay sur mon écran</h3><div data-role="overlay"></div></section>
      <section class="card"><h3>Boutique</h3><div data-role="shop"></div></section>
      <section class="card wide"><h3>Catalogue</h3><div data-role="catalogue"></div></section>
      <section class="card wide"><h3>Bonbons</h3><div data-role="bonbons"></div></section>
    </div></div>`;
  const part = (role: string) =>
    root.querySelector<HTMLElement>(`[data-role="${role}"]`)!;
  const say = (text: string) => {
    flash = text;
    part('flash').textContent = flash;
    setTimeout(() => {
      if (flash === text) part('flash').textContent = '';
    }, 4000);
  };
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new Error(String(out.error ?? `HTTP ${res.status}`));
    return out;
  };
  // Only the parts not being edited are redrawn (a field in focus keeps its value).
  const editing = (role: string) => part(role).contains(document.activeElement);
  const renderStatus = () => {
    if (!editing('overlay')) part('overlay').innerHTML = overlayCard(status);
  };
  const renderAdmin = () => {
    if (!editing('shop')) part('shop').innerHTML = shopCard(admin, adminError);
    if (!editing('catalogue'))
      part('catalogue').innerHTML = catalogueCard(admin);
    if (!editing('bonbons')) part('bonbons').innerHTML = bonbonsCard(admin);
  };
  const loadStatus = async () => {
    try {
      status = (await call('/api/halloween/status')) as unknown as Status;
    } catch {
      status = null;
    }
    renderStatus();
  };
  const loadAdmin = async () => {
    try {
      admin = (await call('/api/halloween/admin')) as unknown as Admin;
      adminError = null;
    } catch (e) {
      adminError =
        (e as Error).message === 'core_unavailable'
          ? 'aucun Core pour ce profil'
          : (e as Error).message;
    }
    renderAdmin();
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      say(ok);
    } catch (e) {
      say(`Refusé : ${(e as Error).message}`);
    }
    await Promise.all([loadStatus(), loadAdmin()]);
  };

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const a = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const media =
      t.closest<HTMLElement>('[data-test-media]')?.dataset.testMedia;
    const effect =
      t.closest<HTMLElement>('[data-test-effect]')?.dataset.testEffect;
    if (a === 'stop')
      void act(() => call('/api/halloween/stop', {}), 'Tout est arrêté.');
    else if (a === 'reload')
      void act(
        () => call('/api/halloween/media/reload', {}),
        'Médias rechargés.',
      );
    else if (a === 'toggle-shop' && admin)
      void act(
        () =>
          call('/api/halloween/admin/settings', {
            enabled: !admin!.settings.enabled,
          }),
        admin.settings.enabled ? 'Boutique fermée.' : 'Boutique ouverte.',
      );
    else if (a === 'save-rules') {
      const rules: Record<string, number> = {};
      for (const input of part('shop').querySelectorAll<HTMLInputElement>(
        '[data-rule]',
      )) {
        const def = RULES.find((r) => r.key === input.dataset.rule)!;
        rules[def.key] =
          Math.max(0, Math.round(Number(input.value) || 0)) *
          (def.ms ? 1000 : 1);
      }
      void act(
        () => call('/api/halloween/admin/settings', { rules }),
        'Règles enregistrées.',
      );
    } else if (media || effect)
      void act(
        () =>
          call('/api/halloween/test', media ? { media_id: media } : { effect }),
        'Test envoyé à l’overlay.',
      );
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    const set = t.dataset.set;
    if (set) {
      const value =
        set === 'volume'
          ? Number(t.value) / 100
          : set === 'display_id'
            ? t.value === ''
              ? null
              : Number(t.value)
            : t.checked;
      void act(
        () => call('/api/halloween/settings', { [set]: value }),
        'Réglage enregistré.',
      );
      return;
    }
    const row = t.closest<HTMLElement>('[data-item]');
    const field = t.dataset.field;
    if (row && field) {
      const patch =
        field === 'enabled'
          ? { enabled: t.checked }
          : field === 'label'
            ? { label: t.value.trim().slice(0, 40) || undefined }
            : field === 'price'
              ? { price: Math.max(1, Math.round(Number(t.value) || 1)) }
              : {
                  cooldown_ms:
                    Math.max(0, Math.round(Number(t.value) || 0)) * 1000,
                };
      t.blur();
      void act(
        () => call(`/api/halloween/admin/items/${row.dataset.item}`, patch),
        'Catalogue enregistré.',
      );
    }
  });
  root.addEventListener('submit', (ev) => {
    const form = (ev.target as HTMLElement).closest<HTMLFormElement>(
      '[data-form="grant"]',
    );
    if (!form) return;
    ev.preventDefault();
    const f = new FormData(form);
    const amount = Math.round(Number(f.get('amount')));
    if (!amount) return say('Montant non nul requis.');
    void act(
      () =>
        call('/api/halloween/admin/grant', {
          idempotency_key: crypto.randomUUID(),
          viewer: String(f.get('viewer')).trim(),
          amount,
          reason: f.get('reason') === 'raffle' ? 'raffle' : 'grant',
          ...(String(f.get('note') ?? '').trim()
            ? { note: String(f.get('note')).trim() }
            : {}),
        }),
      `${amount > 0 ? '+' : ''}${amount} Bonbons attribués.`,
    ).then(() => form.reset());
  });

  setInterval(() => {
    if (visible) void loadStatus();
  }, 1500);
  setInterval(() => {
    if (visible) void loadAdmin();
  }, 5000);
  return {
    setVisible(v: boolean) {
      visible = v;
      if (v) void Promise.all([loadStatus(), loadAdmin()]);
    },
  };
}
