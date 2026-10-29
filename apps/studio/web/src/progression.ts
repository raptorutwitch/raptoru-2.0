// Progression native (docs/PROGRESSION.md) — Studio's panel: ON / OFF and the rules, the titles and badges catalogue,
// a viewer (level, XP, inventory) with grant and revoke, the WizeBot import and its undo. Studio only relays: the
// profile's Core decides and records (/api/progression/* → /v1/lab|studio/progression/*).

type Json = Record<string, unknown>;
type Reward = {
  reward_id: string;
  kind: 'title' | 'badge';
  label: string;
  description: string;
  rarity: string;
  category: string;
  unlock_level: number | null;
  active: boolean;
  sort: number;
};
type State = {
  enabled: boolean;
  rules: Record<string, number | boolean | string[]>;
  catalog: Reward[];
};
type ViewerRow = {
  twitch_user_id: string;
  login: string;
  display_name: string;
  level: number;
  xp: number;
};
type Detail = {
  level: number;
  xp: number;
  rank: number | null;
  nextLevelXp: number;
  watchMinutes: number;
  messages: number;
  imported: { level: number; watchMinutes: number; messages: number } | null;
  equipped: { title: string | null; badges: string[] };
  inventory: {
    id: string;
    kind: string;
    label: string;
    rarity: string;
    source: string;
    reference: string | null;
  }[];
};

const HEADERS = { 'content-type': 'application/json', 'x-raptoru-studio': '1' };
const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const fmt = (n: number) => Number(n || 0).toLocaleString('fr-FR');
const RARITIES = ['common', 'rare', 'epic', 'legendary', 'event'];
const RARITY_FR: Record<string, string> = {
  common: 'Commun',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
  event: 'Événement',
};
const RULES: [string, string, string][] = [
  ['xp_per_minute', 'XP par minute de présence validée', '0.1'],
  ['message_xp', 'XP par message récompensé', '1'],
  ['message_cooldown_s', 'Délai entre deux messages récompensés (s)', '1'],
  ['message_min_chars', 'Longueur minimale d’un message', '1'],
  ['curve_base', 'Courbe : base', '1'],
  ['curve_exponent', 'Courbe : exposant', '0.05'],
];

export function mountProgression(root: HTMLElement) {
  let state: State | null = null;
  let error = '';
  let flash = '';
  let results: ViewerRow[] = [];
  let selected: { row: ViewerRow; detail: Detail } | null = null;
  let visible = false;

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
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      flash = ok;
    } catch (e) {
      flash = `Refusé : ${(e as Error).message}`;
    }
    await load();
  };

  const load = async () => {
    try {
      state = (await call('/api/progression/state')) as unknown as State;
      error = '';
      if (selected)
        selected.detail = (await call(
          `/api/progression/viewers/${selected.row.twitch_user_id}`,
        )) as unknown as Detail;
    } catch (e) {
      error = (e as Error).message;
    }
    render();
  };

  const rewardOptions = (kind?: string) =>
    (state?.catalog ?? [])
      .filter((r) => r.active && (!kind || r.kind === kind))
      .map(
        (r) =>
          `<option value="${esc(r.reward_id)}">${r.kind === 'title' ? 'Titre' : 'Badge'} · ${esc(r.label)}</option>`,
      )
      .join('');

  function render() {
    if (!visible) return;
    if (error && !state) {
      root.innerHTML = `<div class="hw"><h2>⭐ Progression</h2><p class="muted">Progression indisponible : ${esc(error)} (Core du profil sans la progression ?).</p></div>`;
      return;
    }
    if (!state) {
      root.innerHTML =
        '<div class="hw"><h2>⭐ Progression</h2><p class="muted">Chargement…</p></div>';
      return;
    }
    const s = state;
    const d = selected?.detail;
    root.innerHTML = `<div class="hw">
      <header class="hw-head"><h2>⭐ Progression</h2><span class="hw-flash">${esc(flash)}</span></header>
      <div class="hw-grid">
        <section class="card"><h3>Activation</h3>
          <p>${s.enabled ? '<b>Active</b> : la présence et le chat rapportent de l’XP.' : '<b>Inactive</b> : rien n’est compté.'}</p>
          <button type="button" data-act="toggle" class="${s.enabled ? '' : 'primary'}">${s.enabled ? 'Désactiver' : 'Activer'}</button>
          <p class="muted">Présence = vue dans deux relevés des chatters de suite (toutes les 2 min) ; un spectateur absent de cette liste n’est pas compté.</p>
        </section>
        <section class="card"><h3>Règles</h3>
          ${RULES.map(([k, label, step]) => `<label class="row">${esc(label)} <input type="number" step="${step}" data-rule="${k}" value="${esc(s.rules[k])}"></label>`).join('')}
          <label class="row"><input type="checkbox" data-rule="live_only" ${s.rules.live_only ? 'checked' : ''}> Chat compté seulement en live</label>
          <button type="button" data-act="rules">Enregistrer les règles</button>
        </section>
        <section class="card wide"><h3>Titres et badges</h3>
          <table class="tbl"><thead><tr><th>Id</th><th>Type</th><th>Libellé</th><th>Rareté</th><th>Catégorie</th><th>Niveau</th><th>Actif</th></tr></thead><tbody>
          ${s.catalog.map((r) => `<tr><td><code>${esc(r.reward_id)}</code></td><td>${r.kind === 'title' ? 'Titre' : 'Badge'}</td><td>${esc(r.label)}</td><td>${esc(RARITY_FR[r.rarity] ?? r.rarity)}</td><td>${esc(r.category)}</td><td>${r.unlock_level ?? '—'}</td><td>${r.active ? 'oui' : 'non'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune récompense pour l’instant.</td></tr>'}
          </tbody></table>
          <div class="row-in" data-role="reward-form">
            <input placeholder="id (ex. citrouille-2026)" data-f="reward_id" maxlength="48">
            <select data-f="kind"><option value="title">Titre</option><option value="badge">Badge</option></select>
            <input placeholder="Libellé" data-f="label" maxlength="60">
            <select data-f="rarity">${RARITIES.map((r) => `<option value="${r}">${RARITY_FR[r]}</option>`).join('')}</select>
            <input placeholder="catégorie" data-f="category" value="general" maxlength="32">
            <input type="number" min="1" placeholder="niveau (vide : événement / manuel)" data-f="unlock_level">
            <label><input type="checkbox" data-f="active" checked> actif</label>
            <button type="button" data-act="reward">Créer / mettre à jour</button>
          </div>
          <p class="muted">Un id existant est mis à jour (le type ne change pas). Un niveau de déblocage donne la récompense à tous ceux qui l’ont atteint.</p>
        </section>
        <section class="card wide"><h3>Un viewer</h3>
          <div class="row-in"><input placeholder="Pseudo Twitch ou identifiant" data-role="q" maxlength="40"><button type="button" data-act="search">Chercher</button></div>
          ${results.length ? `<ul class="list">${results.map((r) => `<li><button type="button" class="link" data-pick="${esc(r.twitch_user_id)}">${esc(r.display_name ?? r.login)}</button> <span class="muted">${esc(r.login)} · niveau ${r.level} · ${fmt(Number(r.xp))} XP</span></li>`).join('')}</ul>` : ''}
          ${
            selected && d
              ? `<div class="detail">
            <h4>${esc(selected.row.display_name ?? selected.row.login)}</h4>
            <p>Niveau <b>${d.level}</b> · ${fmt(d.xp)} XP (niveau suivant à ${fmt(d.nextLevelXp)}) · rang ${d.rank ?? '—'} · ${fmt(d.watchMinutes)} min de présence · ${fmt(d.messages)} messages</p>
            ${d.imported ? `<p class="muted">Repris de WizeBot : niveau ${d.imported.level}, ${fmt(d.imported.watchMinutes)} min, ${fmt(d.imported.messages)} messages.</p>` : ''}
            <p>Équipé : ${d.equipped.title ? `titre <code>${esc(d.equipped.title)}</code>` : 'aucun titre'}${d.equipped.badges.length ? ` · badges ${d.equipped.badges.map((b) => `<code>${esc(b)}</code>`).join(' ')}` : ''}</p>
            <ul class="list">${d.inventory.map((i) => `<li>${i.kind === 'title' ? 'Titre' : 'Badge'} <b>${esc(i.label)}</b> <span class="muted">${esc(RARITY_FR[i.rarity] ?? i.rarity)} · ${esc(i.source)}${i.reference ? ` · ${esc(i.reference)}` : ''}</span> <button type="button" class="link" data-revoke="${esc(i.id)}">Retirer</button></li>`).join('') || '<li class="muted">Inventaire vide.</li>'}</ul>
            <div class="row-in"><select data-role="grant-reward">${rewardOptions()}</select>
              <select data-role="grant-source"><option value="manual">Manuel</option><option value="event">Événement</option></select>
              <input placeholder="référence (ex. halloween-2026)" data-role="grant-ref" maxlength="80">
              <button type="button" data-act="grant" ${rewardOptions() ? '' : 'disabled'}>Attribuer</button></div>
          </div>`
              : ''
          }
        </section>
        <section class="card"><h3>Reprise de WizeBot</h3>
          <p class="muted">Lit les niveaux, le temps de présence et les messages de WizeBot (via raptoru.fr) et démarre chaque viewer à son niveau, une seule fois. Les pseudos inconnus du Core sont listés, à reprendre plus tard.</p>
          <button type="button" data-act="import">Importer depuis WizeBot</button>
          <button type="button" class="warn" data-act="revert">Annuler l’import</button>
          <pre data-role="import-out" class="muted"></pre>
        </section>
      </div></div>`;
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const a = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const pick = t.closest<HTMLElement>('[data-pick]')?.dataset.pick;
    const revoke = t.closest<HTMLElement>('[data-revoke]')?.dataset.revoke;
    const val = (sel: string) =>
      root.querySelector<HTMLInputElement>(sel)?.value ?? '';
    if (pick) {
      const row = results.find((r) => r.twitch_user_id === pick)!;
      void call(`/api/progression/viewers/${pick}`).then((detail) => {
        selected = { row, detail: detail as unknown as Detail };
        render();
      });
    } else if (revoke && selected) {
      const reason = prompt('Raison du retrait (gardée dans l’historique) :');
      if (reason?.trim())
        void act(
          () =>
            call('/api/progression/revoke', {
              reward_id: revoke,
              viewer: selected!.row.twitch_user_id,
              reason: reason.trim(),
            }),
          'Retiré.',
        );
    } else if (a === 'toggle' && state)
      void act(
        () => call('/api/progression/settings', { enabled: !state!.enabled }),
        state.enabled ? 'Progression désactivée.' : 'Progression activée.',
      );
    else if (a === 'rules') {
      const rules: Json = {};
      for (const [k] of RULES) rules[k] = Number(val(`[data-rule="${k}"]`));
      rules.live_only = !!root.querySelector<HTMLInputElement>(
        '[data-rule="live_only"]',
      )?.checked;
      void act(
        () => call('/api/progression/settings', { rules }),
        'Règles enregistrées.',
      );
    } else if (a === 'reward') {
      const f = (k: string) =>
        root.querySelector<HTMLInputElement>(
          `[data-role="reward-form"] [data-f="${k}"]`,
        )!;
      const level = f('unlock_level').value.trim();
      void act(
        () =>
          call('/api/progression/rewards', {
            reward_id: f('reward_id').value.trim(),
            kind: f('kind').value,
            label: f('label').value.trim(),
            rarity: f('rarity').value,
            category: f('category').value.trim() || 'general',
            unlock_level: level ? Number(level) : null,
            active: f('active').checked,
          }),
        'Récompense enregistrée.',
      );
    } else if (a === 'search') {
      void call(
        `/api/progression/viewers?q=${encodeURIComponent(val('[data-role="q"]'))}`,
      ).then(
        (rows) => {
          results = rows as unknown as ViewerRow[];
          flash = results.length ? '' : 'Aucun viewer connu sous ce pseudo.';
          render();
        },
        (e: Error) => {
          flash = `Recherche impossible : ${e.message}`;
          render();
        },
      );
    } else if (a === 'grant' && selected) {
      void act(
        () =>
          call('/api/progression/grant', {
            reward_id: val('[data-role="grant-reward"]'),
            viewers: [selected!.row.twitch_user_id],
            source: val('[data-role="grant-source"]'),
            reference: val('[data-role="grant-ref"]').trim() || null,
          }),
        'Attribué.',
      );
    } else if (a === 'import') {
      const out = root.querySelector<HTMLElement>('[data-role="import-out"]');
      if (out) out.textContent = 'Import en cours…';
      void call('/api/progression/import/wizebot', {}).then(
        (r) => {
          const res = r as {
            read: number;
            imported: number;
            already: number;
            unresolved: string[];
          };
          flash = `WizeBot : ${res.read} lus, ${res.imported} importés, ${res.already} déjà là, ${res.unresolved.length} pseudos inconnus du Core.`;
          void load();
        },
        (e: Error) => {
          flash = `Import impossible : ${e.message}`;
          render();
        },
      );
    } else if (a === 'revert') {
      if (
        confirm(
          'Annuler l’import WizeBot ? Les XP importées sont retirées (l’XP gagnée depuis reste).',
        )
      )
        void act(
          () => call('/api/progression/import/revert', {}),
          'Import annulé.',
        );
    }
  });

  return {
    setVisible(on: boolean) {
      visible = on;
      if (on) void load();
    },
  };
}
