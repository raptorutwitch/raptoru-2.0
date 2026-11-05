// Progression native (docs/PROGRESSION.md) — Studio's panel: ON / OFF and the rules, the titles and badges catalogue,
// a viewer (level, XP, inventory) with grant and revoke, manual XP (journaled) and their journal, the WizeBot import
// (every row kept; the waiting ones attached later, automatically or by a decision here) and its undo. Studio only relays: the
// profile's Core decides and records (/api/progression/* → /v1/lab|studio/progression/*).

import './progression.css';

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
  /** Boutique cosmétique: a draft is never granted (the Core refuses it). */
  status?: string;
};
type Tab = 'viewers' | 'catalog' | 'rules' | 'daily' | 'import';
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
  totals: { watchMinutes: number; messages: number };
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

type Journal = {
  movements: {
    kind: string;
    amount: number;
    actor: string;
    reason: string | null;
    at: string;
  }[];
  sources: {
    login: string;
    level: number;
    measuredAt: string;
    attachedBy: string | null;
  }[];
};
type ImportStatus = {
  imported: number;
  pending: number;
  ambiguous: number;
  conflict: number;
  lastMeasuredAt: string | null;
};
type Waiting = {
  login: string;
  status: string;
  twitchUserId: string | null;
  level: number;
  watchMinutes: number;
  messages: number;
  candidates: string[];
};
const STATUS_FR: Record<string, string> = {
  pending: 'inconnu du Core',
  ambiguous: 'ambigu',
  conflict: 'conflit',
};
const KIND_FR: Record<string, string> = {
  import: 'Reprise',
  grant: 'Ajout',
  correction: 'Correction',
};
const ADJUST: [string, string][] = [
  ['add', 'Ajouter de l’XP'],
  ['remove', 'Retirer de l’XP'],
  ['set_xp', 'Fixer l’XP à'],
  ['set_level', 'Fixer le niveau à'],
];
const requestId = () =>
  `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

/** Refonte H14 — the Daily steps (Jetons per consecutive stream; the last one repeats). */
export interface DailySteps {
  steps: number[];
  default_steps: number[];
  bounds: { max_steps: number; max_value: number };
  /** Fixed (decision H14): shown, never edited. */
  reset_time: string;
}

export function dailyHtml(d: DailySteps | null) {
  if (!d)
    return '<section class="rs-panel"><h2>Daily</h2><p class="rs-muted">Paliers indisponibles sur ce profil (Core sans cette route).</p></section>';
  const changed = d.steps.join(',') !== d.default_steps.join(',');
  return `<section class="rs-panel pg-daily"><h2>Daily</h2>
    <p>Jetons reçus avec <code>!daily</code> selon le nombre de streams d’affilée. Le dernier palier se répète. Remise à zéro fixe : <b>${esc(d.reset_time)}</b>.</p>
    <div class="rs-fields">${d.steps
      .map(
        (v, i) =>
          `<label>${i + 1}${i ? 'e' : 'er'} stream${i === d.steps.length - 1 ? ' et suivants' : ''} <input type="number" min="0" max="${d.bounds.max_value}" step="1" value="${v}" data-daily-step="${i}"> Jetons</label>`,
      )
      .join('')}</div>
    <p class="rs-muted">De 1 à ${d.bounds.max_steps} paliers, ${d.bounds.max_value.toLocaleString('fr-FR')} Jetons au plus chacun, jamais en baisse d’un palier au suivant.${changed ? ' Paliers <b>modifiés</b> (valeurs d’origine : ' + d.default_steps.join(' · ') + ').' : ''}</p>
    <div class="rs-buttons"><button type="button" class="rs-btn primary" data-act="daily-save">Enregistrer…</button>
      <button type="button" class="rs-btn" data-act="daily-add">Ajouter un palier</button>
      <button type="button" class="rs-btn" data-act="daily-remove"${d.steps.length > 1 ? '' : ' disabled'}>Retirer le dernier</button>
      <button type="button" class="rs-btn" data-act="daily-default">Revenir aux valeurs d’origine</button></div>
    <p class="rs-muted">Chaque !daily garde le montant calculé à son heure : un changement ne verse et ne retire rien rétroactivement.</p></section>`;
}

export function mountProgression(root: HTMLElement) {
  let state: State | null = null;
  let error = '';
  let flash = '';
  let tab: Tab = 'viewers';
  /** Refonte H14: the Daily steps as the Core holds them (null: a Core without the route). */
  let daily: DailySteps | null = null;
  let results: ViewerRow[] = [];
  let selected: { row: ViewerRow; detail: Detail; journal: Journal } | null =
    null;
  let importStatus: ImportStatus | null = null;
  let waiting: Waiting[] | null = null;
  let visible = false;
  let lastImport = '';

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
      daily = (await call('/api/daily/config').catch(
        () => null,
      )) as unknown as DailySteps | null;
      importStatus = (await call('/api/progression/import/status').catch(
        () => null,
      )) as unknown as ImportStatus | null;
      if (selected) {
        const id = selected.row.twitch_user_id;
        selected.detail = (await call(
          `/api/progression/viewers/${id}`,
        )) as unknown as Detail;
        selected.journal = (await call(
          `/api/progression/viewers/${id}/history`,
        )) as unknown as Journal;
      }
    } catch (e) {
      error = (e as Error).message;
    }
    render();
  };

  const rewardOptions = (kind?: string) =>
    (state?.catalog ?? [])
      .filter(
        (r) => r.active && r.status !== 'draft' && (!kind || r.kind === kind),
      )
      .map(
        (r) =>
          `<option value="${esc(r.reward_id)}">${r.kind === 'title' ? 'Titre' : 'Badge'} · ${esc(r.label)}</option>`,
      )
      .join('');

  function render() {
    if (!visible) return;
    if (error && !state) {
      root.innerHTML = `<div class="rs-page"><header class="rs-page-head"><h1>Progression</h1></header><p class="rs-muted">Progression indisponible : ${esc(error)} (Core du profil sans la progression ?).</p></div>`;
      return;
    }
    if (!state) {
      root.innerHTML =
        '<div class="rs-page"><header class="rs-page-head"><h1>Progression</h1></header><p class="rs-muted">Chargement…</p></div>';
      return;
    }
    const s = state;
    const d = selected?.detail;
    const tabBtn = (id: Tab, label: string) =>
      `<button type="button" role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`;
    root.innerHTML = `<div class="rs-page rs-form pg">
      <header class="rs-page-head rs-head-row"><div><h1>Progression <span class="rs-chip ${s.enabled ? 'is-active' : ''}">${s.enabled ? 'Active' : 'Inactive'}</span></h1>
        <p>${s.enabled ? 'La présence et le chat rapportent de l’XP.' : 'Rien n’est compté tant que la progression est inactive.'} Présence = vue dans deux relevés des chatters de suite (toutes les 2 min) ; un spectateur absent de cette liste n’est pas compté.</p></div>
        <button type="button" data-act="toggle" class="rs-btn ${s.enabled ? '' : 'primary'}">${s.enabled ? 'Désactiver…' : 'Activer'}</button></header>
      ${flash ? `<p class="rs-flash${/^(Refusé|Liste impossible|Rattachement impossible|Import)/.test(flash) ? ' is-bad' : ''}" role="status">${esc(flash)}</p>` : ''}
      <div class="rs-seg" role="tablist" aria-label="Progression">${tabBtn('viewers', 'Viewers')}${tabBtn('catalog', 'Titres et badges')}${tabBtn('rules', 'Règles d’XP')}${tabBtn('daily', 'Daily')}${tabBtn('import', 'Reprise WizeBot')}</div>
      ${tab === 'viewers' ? viewersHtml(d) : tab === 'catalog' ? catalogHtml(s) : tab === 'rules' ? rulesHtml(s) : tab === 'daily' ? dailyHtml(daily) : importHtml()}
    </div>`;
  }

  function rulesHtml(s: State) {
    return `<section class="rs-panel pg-rules"><h2>Règles d’XP</h2>
      <div class="rs-fields">${RULES.map(([k, label, step]) => `<label>${esc(label)} <input type="number" step="${step}" data-rule="${k}" value="${esc(s.rules[k])}"></label>`).join('')}
        <label class="rs-check span2"><input type="checkbox" data-rule="live_only" ${s.rules.live_only ? 'checked' : ''}> <span>Chat compté seulement en live</span></label></div>
      <p><button type="button" class="rs-btn primary" data-act="rules">Enregistrer les règles</button></p>
      <p class="rs-muted">Les nouvelles règles s’appliquent à l’XP gagnée ensuite ; l’XP déjà acquise ne change pas.</p>
    </section>`;
  }

  function catalogHtml(s: State) {
    return `<section class="rs-panel"><h2>Titres et badges</h2>
      <div class="rs-scroll"><table class="rs-tbl"><thead><tr><th>Libellé</th><th>Type</th><th>Rareté</th><th>Catégorie</th><th class="num">Niveau</th><th>État</th></tr></thead><tbody>
      ${s.catalog.map((r) => `<tr><td><b>${esc(r.label)}</b><small><code>${esc(r.reward_id)}</code></small></td><td>${r.kind === 'title' ? 'Titre' : 'Badge'}</td><td>${esc(RARITY_FR[r.rarity] ?? r.rarity)}</td><td>${esc(r.category)}</td><td class="num">${r.unlock_level ?? '—'}</td><td><span class="rs-chip ${r.active ? 'is-active' : ''}">${r.active ? 'actif' : 'inactif'}</span></td></tr>`).join('') || '<tr><td colspan="6" class="rs-muted">Aucune récompense pour l’instant.</td></tr>'}
      </tbody></table></div></section>
      <section class="rs-panel rs-step"><h2><i>+</i> Créer ou mettre à jour</h2>
        <div class="rs-fields pg-reward" data-role="reward-form">
          <label>Identifiant <input placeholder="ex. citrouille-2026" data-f="reward_id" maxlength="48"><small>Un identifiant existant est mis à jour (le type ne change pas).</small></label>
          <label>Type <select data-f="kind"><option value="title">Titre</option><option value="badge">Badge</option></select></label>
          <label>Libellé <input data-f="label" maxlength="60"></label>
          <label>Rareté <select data-f="rarity">${RARITIES.map((r) => `<option value="${r}">${RARITY_FR[r]}</option>`).join('')}</select></label>
          <label>Catégorie <input data-f="category" value="general" maxlength="32"></label>
          <label>Débloqué au niveau <input type="number" min="1" placeholder="vide : événement / manuel" data-f="unlock_level"><small>Donné à tous ceux qui ont atteint ce niveau.</small></label>
          <label class="rs-check"><input type="checkbox" data-f="active" checked> <span>Actif</span></label>
          <div><button type="button" class="rs-btn primary" data-act="reward">Créer / mettre à jour</button></div>
        </div>
        <p class="rs-muted">Apparence, cadres, bannières et vente : <a href="/?p=shop">Boutique</a>.</p>
      </section>`;
  }

  function viewersHtml(d: Detail | undefined) {
    return `<div class="pg-viewers">
      <section class="rs-panel pg-search"><h2>Trouver un viewer</h2>
        <div class="pg-q"><input placeholder="Pseudo Twitch ou identifiant" data-role="q" maxlength="40" aria-label="Pseudo Twitch ou identifiant"><button type="button" class="rs-btn" data-act="search">Chercher</button></div>
        ${results.length ? `<div class="rs-rows">${results.map((r) => `<button type="button" class="rs-row pg-hit${selected?.row.twitch_user_id === r.twitch_user_id ? ' is-sel' : ''}" data-pick="${esc(r.twitch_user_id)}"><b>${esc(r.display_name ?? r.login)}</b><small>${esc(r.login)} · niveau ${r.level} · ${fmt(Number(r.xp))} XP</small></button>`).join('')}</div>` : '<p class="rs-muted">Les viewers vus par la chaîne (présence, chat, achats).</p>'}
      </section>
      ${
        selected && d
          ? `<section class="rs-panel detail">
        <h2>${esc(selected.row.display_name ?? selected.row.login)}</h2>
        <div class="pg-kpis"><div><b>${d.level}</b><span>niveau</span></div><div><b>${fmt(d.xp)}</b><span>XP · suivant à ${fmt(d.nextLevelXp)}</span></div><div><b>${d.rank ?? '—'}</b><span>rang</span></div><div><b>${fmt(d.totals.watchMinutes)}</b><span>min de présence</span></div><div><b>${fmt(d.totals.messages)}</b><span>messages</span></div></div>
        <p class="rs-muted">Dont ${fmt(d.watchMinutes)} min relevées par Raptoru (liste des chatters, pas une preuve de visionnage) et ${fmt(d.messages)} messages comptés par Raptoru.${d.imported ? ` Repris de WizeBot : niveau ${d.imported.level}, ${fmt(d.imported.watchMinutes)} min, ${fmt(d.imported.messages)} messages.` : ''}</p>
        <p>Équipé : ${d.equipped.title ? `titre <code>${esc(d.equipped.title)}</code>` : 'aucun titre'}${d.equipped.badges.length ? ` · badges ${d.equipped.badges.map((b) => `<code>${esc(b)}</code>`).join(' ')}` : ''}</p>
        <h3>Inventaire</h3>
        <ul class="pg-list">${d.inventory.map((i) => `<li>${i.kind === 'title' ? 'Titre' : 'Badge'} <b>${esc(i.label)}</b> <span class="rs-muted">${esc(RARITY_FR[i.rarity] ?? i.rarity)} · ${esc(i.source)}${i.reference ? ` · ${esc(i.reference)}` : ''}</span> <button type="button" class="rs-btn sm quiet" data-revoke="${esc(i.id)}">Retirer</button></li>`).join('') || '<li class="rs-muted">Inventaire vide.</li>'}</ul>
        <div class="pg-inline"><select data-role="grant-reward" aria-label="Récompense">${rewardOptions()}</select>
          <select data-role="grant-source" aria-label="Source"><option value="manual">Manuel</option><option value="event">Événement</option></select>
          <input placeholder="référence (ex. halloween-2026)" data-role="grant-ref" maxlength="80" aria-label="Référence">
          <button type="button" class="rs-btn" data-act="grant" ${rewardOptions() ? '' : 'disabled'}>Attribuer</button></div>
        <h3>XP manuelle</h3>
        <div class="pg-inline"><select data-role="adj-mode" aria-label="Opération">${ADJUST.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
          <input type="number" min="0" step="1" placeholder="valeur" data-role="adj-value" aria-label="Valeur">
          <input placeholder="raison (obligatoire, gardée)" data-role="adj-reason" maxlength="200" aria-label="Raison">
          <button type="button" class="rs-btn" data-act="adjust">Appliquer</button></div>
        <p class="rs-muted">Jamais en dessous de 0 ; le niveau suit l’XP. Chaque ajustement est journalisé (qui, quand, pourquoi).</p>
        <h3>Journal</h3>
        ${selected.journal.sources.map((h) => `<p class="rs-muted">Historique WizeBot « ${esc(h.login)} » : niveau ${h.level}, relevé le ${esc(new Date(h.measuredAt).toLocaleDateString('fr-FR'))}, rattaché ${h.attachedBy === 'manual' ? 'à la main' : h.attachedBy === 'id' ? 'par identifiant Twitch' : 'par pseudo'}.</p>`).join('')}
        <ul class="pg-list">${selected.journal.movements.map((m) => `<li>${esc(new Date(m.at).toLocaleString('fr-FR'))} · ${esc(KIND_FR[m.kind] ?? m.kind)} <b>${m.amount > 0 ? '+' : ''}${fmt(m.amount)} XP</b> <span class="rs-muted">${esc(m.actor)}${m.reason ? ` — ${esc(m.reason)}` : ''}</span></li>`).join('') || '<li class="rs-muted">Aucun ajustement ni reprise.</li>'}</ul>
      </section>`
          : '<section class="rs-panel pg-empty"><p class="rs-muted">Choisis un viewer pour voir son niveau, son inventaire et son journal.</p></section>'
      }
    </div>`;
  }

  function importHtml() {
    return `<section class="rs-panel"><h2>Reprise de WizeBot</h2>
        <p class="rs-muted">Lit les niveaux, le temps de présence et les messages de WizeBot (via raptoru.fr) et démarre chaque viewer à son niveau, une seule fois. Chaque ligne est gardée avec sa date ; celles qu’on ne peut pas rattacher avec certitude attendent : elles se rattachent seules quand le viewer revient (stream, connexion sur raptoru.fr), ou ici sur décision.</p>
        ${importStatus ? `<div class="pg-kpis"><div><b>${fmt(importStatus.imported)}</b><span>rattachés</span></div><div><b>${fmt(importStatus.pending)}</b><span>inconnus du Core</span></div><div><b>${fmt(importStatus.ambiguous)}</b><span>ambigus</span></div><div><b>${fmt(importStatus.conflict)}</b><span>conflits</span></div></div>${importStatus.lastMeasuredAt ? `<p class="rs-muted">Dernier relevé ${esc(new Date(importStatus.lastMeasuredAt).toLocaleString('fr-FR'))}.</p>` : ''}` : ''}
        <div class="pg-inline"><button type="button" class="rs-btn" data-act="dry-run">Simuler (n’écrit rien)</button>
          <button type="button" class="rs-btn" data-act="import">Importer depuis WizeBot</button>
          <button type="button" class="rs-btn" data-act="resolve">Rattacher les lignes en attente</button>
          <button type="button" class="rs-btn danger" data-act="revert">Annuler l’import</button></div>
        <pre data-role="import-out" class="pg-out">${esc(lastImport)}</pre>
      </section>
      <section class="rs-panel"><h2>Historiques en attente</h2>
        <div class="pg-q"><input placeholder="pseudo WizeBot (début)" data-role="wq" maxlength="25" aria-label="Pseudo WizeBot"><button type="button" class="rs-btn" data-act="waiting">Afficher</button></div>
        ${
          waiting
            ? `<div class="rs-scroll"><table class="rs-tbl"><thead><tr><th>Pseudo WizeBot</th><th>Statut</th><th class="num">Niveau</th><th class="num">Présence</th><th class="num">Messages</th><th>Comptes du Core sous ce pseudo</th><th></th></tr></thead><tbody>
        ${waiting.map((w) => `<tr><td>${esc(w.login)}${w.twitchUserId ? `<small>id ${esc(w.twitchUserId)}</small>` : ''}</td><td>${esc(STATUS_FR[w.status] ?? w.status)}</td><td class="num">${w.level}</td><td class="num">${fmt(w.watchMinutes)} min</td><td class="num">${fmt(w.messages)}</td><td>${w.candidates.map((c) => `<code>${esc(c)}</code>`).join(' ') || '—'}</td><td><button type="button" class="rs-btn sm quiet" data-attach="${esc(w.login)}">Rattacher…</button></td></tr>`).join('') || '<tr><td colspan="7" class="rs-muted">Rien en attente.</td></tr>'}
        </tbody></table></div>`
            : ''
        }
        <p class="rs-muted">Rattacher seulement après avoir vérifié l’identité (identifiant Twitch) : jamais sur la seule ressemblance des pseudos. Un viewer n’a qu’un historique WizeBot.</p>
      </section>`;
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const a = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const pick = t.closest<HTMLElement>('[data-pick]')?.dataset.pick;
    const revoke = t.closest<HTMLElement>('[data-revoke]')?.dataset.revoke;
    const attach = t.closest<HTMLElement>('[data-attach]')?.dataset.attach;
    const val = (sel: string) =>
      root.querySelector<HTMLInputElement>(sel)?.value ?? '';
    if (pick) {
      const row = results.find((r) => r.twitch_user_id === pick)!;
      void Promise.all([
        call(`/api/progression/viewers/${pick}`),
        call(`/api/progression/viewers/${pick}/history`),
      ]).then(([detail, journal]) => {
        selected = {
          row,
          detail: detail as unknown as Detail,
          journal: journal as unknown as Journal,
        };
        render();
      });
    } else if (attach) {
      const viewer = prompt(
        `Rattacher l’historique WizeBot « ${attach} » à quel identifiant Twitch (vérifié) ?`,
      )?.trim();
      if (!viewer) return;
      const reason = prompt(
        'Comment l’identité a-t-elle été vérifiée ?',
      )?.trim();
      if (reason)
        void act(async () => {
          await call('/api/progression/import/attach', {
            login: attach,
            viewer,
            reason,
          });
          waiting = waiting?.filter((w) => w.login !== attach) ?? null;
        }, 'Historique rattaché.');
    } else if (a === 'waiting') {
      void call(
        `/api/progression/import/waiting?q=${encodeURIComponent(val('[data-role="wq"]'))}`,
      ).then(
        (rows) => {
          waiting = rows as unknown as Waiting[];
          render();
        },
        (e: Error) => {
          flash = `Liste impossible : ${e.message}`;
          render();
        },
      );
    } else if (a === 'resolve') {
      void call('/api/progression/import/resolve', {}).then(
        (r) => {
          const res = r as { imported: number };
          flash = `${res.imported} historique(s) rattaché(s).`;
          void load();
        },
        (e: Error) => {
          flash = `Rattachement impossible : ${e.message}`;
          render();
        },
      );
    } else if (a === 'adjust' && selected) {
      const value = Number(val('[data-role="adj-value"]'));
      const reason = val('[data-role="adj-reason"]').trim();
      if (!Number.isInteger(value) || value < 0 || reason.length < 3) {
        flash =
          'Valeur entière ≥ 0 et raison (3 caractères au moins) requises.';
        render();
        return;
      }
      void act(
        () =>
          call('/api/progression/adjust', {
            viewer: selected!.row.twitch_user_id,
            mode: val('[data-role="adj-mode"]'),
            value,
            reason,
            request_id: requestId(),
          }),
        'XP ajustée.',
      );
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
    } else if (t.closest('[data-tab]')) {
      tab = t.closest<HTMLElement>('[data-tab]')!.dataset.tab as Tab;
      render();
    } else if (a === 'toggle' && state) {
      if (
        state.enabled &&
        !confirm(
          'Désactiver la progression ?\n\nLa présence et le chat ne rapportent plus d’XP tant qu’elle est désactivée. Les niveaux, l’XP et les inventaires déjà acquis sont conservés.',
        )
      )
        return;
      void act(
        () => call('/api/progression/settings', { enabled: !state!.enabled }),
        state.enabled ? 'Progression désactivée.' : 'Progression activée.',
      );
    } else if (a === 'daily-save' && daily) {
      const steps = [
        ...root.querySelectorAll<HTMLInputElement>('[data-daily-step]'),
      ].map((i) => Number(i.value));
      if (
        !confirm(
          `Enregistrer ces paliers du Daily ?\n\n${steps.map((v, i) => `${i + 1}${i ? 'e' : 'er'} stream : ${v.toLocaleString('fr-FR')} Jetons`).join('\n')}\n\nAppliqués aux prochains !daily. Les récompenses déjà reçues ne changent pas ; rien n’est versé rétroactivement.`,
        )
      )
        return;
      void act(
        () => call('/api/daily/config', { steps }),
        'Paliers du Daily enregistrés.',
      );
    } else if (a === 'daily-add' && daily) {
      daily = { ...daily, steps: [...daily.steps, daily.steps.at(-1) ?? 0] };
      render();
    } else if (a === 'daily-remove' && daily && daily.steps.length > 1) {
      daily = { ...daily, steps: daily.steps.slice(0, -1) };
      render();
    } else if (a === 'daily-default' && daily) {
      daily = { ...daily, steps: [...daily.default_steps] };
      render();
    } else if (a === 'rules') {
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
    } else if (a === 'import' || a === 'dry-run') {
      const dry = a === 'dry-run';
      if (
        !dry &&
        !confirm(
          'Importer les niveaux WizeBot pour de vrai ? (« Simuler » d’abord pour voir les chiffres)',
        )
      )
        return;
      const out = root.querySelector<HTMLElement>('[data-role="import-out"]');
      if (out)
        out.textContent = dry ? 'Simulation en cours…' : 'Import en cours…';
      void call(
        `/api/progression/import/wizebot${dry ? '/dry-run' : ''}`,
        {},
      ).then(
        (r) => {
          const res = r as {
            read: number;
            imported?: number;
            would_import?: number;
            already: number;
            by_id: number;
            by_login: number;
            unresolved: string[];
            ambiguous: string[];
            conflicts: string[];
          };
          flash = dry
            ? 'Simulation terminée (rien n’a été écrit).'
            : 'Import WizeBot terminé.';
          lastImport = [
            `${res.read} viewers WizeBot lus (tous gardés avec leur date)`,
            `${dry ? 'à rattacher' : 'rattachés'} : ${dry ? res.would_import : res.imported} (par identifiant Twitch ${res.by_id}, par pseudo ${res.by_login})`,
            `déjà rattachés : ${res.already}`,
            `pseudos inconnus du Core (gardés, rattachés à leur retour) : ${res.unresolved.length}`,
            `pseudos ambigus (gardés, décision ici) : ${res.ambiguous.length}${res.ambiguous.length ? ` — ${res.ambiguous.slice(0, 20).join(', ')}` : ''}`,
            `conflits (gardés, décision ici) : ${res.conflicts.length}${res.conflicts.length ? ` — ${res.conflicts.slice(0, 20).join(', ')}` : ''}`,
          ].join('\n');
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
