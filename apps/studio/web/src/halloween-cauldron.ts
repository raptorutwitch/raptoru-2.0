// Halloween — « Chaudron des subs » card (docs/HALLOWEEN.md § 13): the subgoal shown by its own OBS source. The Core
// counts from the Twitch events it records (sub, targeted gift 1; community gift its count; resub 1 if chosen) since
// the start chosen here, plus a manual correction. Separate from the Bonbons. Off by default; the goal is the
// streamer's. « Tester » plays the animation on the OBS source, the count never moves.

export interface CauldronSettings {
  enabled: boolean;
  goal: number;
  since: string | null;
  adjust: number;
  count_resubs: boolean;
  title: string;
}
export interface CauldronState {
  enabled: boolean;
  count?: number;
  goal?: number;
}
export const DEFAULT_CAULDRON: CauldronSettings = {
  enabled: false,
  goal: 50,
  since: null,
  adjust: 0,
  count_resubs: true,
  title: 'Chaudron des subs',
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** The card (pure, tested). `url`: the OBS source; `state`: the Core's count (null: not read yet). */
export function cauldronCard(
  c: CauldronSettings | null,
  state: CauldronState | null,
  obs: { url: string; connected: boolean } | null,
) {
  if (!c) return '<p class="hw-hint">Chargement…</p>';
  const since = c.since
    ? new Date(c.since).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'toujours (aucun départ choisi)';
  const head = c.enabled
    ? `<div class="hw-state ok"><span class="hw-dot"></span>Chaudron ACTIF${state?.enabled ? ` : <b>${state.count} / ${state.goal}</b>` : ''}</div>`
    : '<div class="hw-state warn"><span class="hw-dot"></span>Chaudron désactivé (la source OBS n’affiche rien)</div>';
  return `${head}
    <div class="hw-form">
      <button type="button" class="${c.enabled ? '' : 'primary'}" data-act="cauldron-toggle">${c.enabled ? 'Désactiver' : 'Activer'}</button>
    </div>
    <form class="hw-rules" data-form="cauldron">
      <label><span>Titre affiché</span><input name="title" maxlength="40" value="${esc(c.title)}"/></label>
      <label><span>Objectif (abonnements) <small>à choisir</small></span><input name="goal" type="number" min="1" max="100000" step="1" value="${c.goal}"/></label>
      <label class="hw-check"><input type="checkbox" name="count_resubs"${c.count_resubs ? ' checked' : ''}/> Compter les resubs (réabonnements partagés)</label>
      <button type="submit" class="primary">Enregistrer</button>
    </form>
    <p class="hw-hint">Compté depuis : <b>${esc(since)}</b> · correction manuelle : <b>${c.adjust > 0 ? '+' : ''}${c.adjust}</b>.
      Sub et sub offert à un viewer = 1 ; lot de subs offerts = son nombre ; resub = 1 si coché. Un événement Twitch reçu deux
      fois ne compte qu’une fois. Les Bonbons ne comptent pas.</p>
    <div class="hw-form">
      <button type="button" data-act="cauldron-start">Repartir de zéro maintenant</button>
      <input type="number" step="1" min="-1000" max="1000" data-role="cauldron-fix" aria-label="Correction" placeholder="± abonnements"/>
      <button type="button" data-act="cauldron-fix">Corriger</button>
    </div>
    <div class="hw-chips">
      <button type="button" class="hw-chip" data-act="cauldron-test-sub">Tester un sub</button>
      <button type="button" class="hw-chip" data-act="cauldron-test-goal">Tester l’objectif atteint</button>
    </div>
    <p class="hw-hint">Tests gratuits : l’animation seulement, le compteur ne bouge pas.</p>
    ${obs ? `<p class="hw-hint">Source navigateur OBS 480 × 520, fond transparent${obs.connected ? ' (ouverte)' : ''} : <code class="hw-url">${esc(obs.url)}</code></p>` : ''}`;
}

/** The settings after a form save (pure, tested): goal 1…100 000, title trimmed. */
export function cauldronFromForm(
  cur: CauldronSettings,
  f: { title: string; goal: string; count_resubs: boolean },
): CauldronSettings {
  const goal = Math.round(Number(f.goal));
  return {
    ...cur,
    title: f.title.trim().slice(0, 40),
    goal: Number.isFinite(goal)
      ? Math.min(100_000, Math.max(1, goal))
      : cur.goal,
    count_resubs: f.count_resubs,
  };
}
