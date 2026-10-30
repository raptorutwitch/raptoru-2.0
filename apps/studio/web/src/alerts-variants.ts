// Alertes › Variantes (30/10/2026): for each family, which variants may play — the Core decides (alert_settings,
// apps/core-api/src/alerts/rules.ts). Nothing saved = the behaviour so far. One event always makes at most ONE alert:
// a family picks the usual OR the Halloween variant, never both; a missing Halloween media plays the usual one instead.
// The Ballon animations (sub / Prime / resub) are chosen in the Halloween tab (« Alertes Halloween »).

export type FamilyMode = 'auto' | 'usual' | 'halloween' | 'off';
export interface VariantSettings {
  families: Partial<Record<string, FamilyMode>>;
  follow?: string[];
}

/** Family, label, its usual variant(s), its Halloween variant (null: none). */
const FAMILIES: [string, string, string, string | null][] = [
  [
    'follow',
    'Follow',
    'Dofus / Eren / Discord (cochés ci-dessous)',
    'Miss Minute',
  ],
  ['sub', 'Sub', 'Eren', 'le Ballon'],
  ['prime', 'Sub Prime', 'Eren', 'le Ballon'],
  ['resub', 'Resub', 'Eren', 'le Ballon'],
  [
    'gift',
    'Subgift (offerts)',
    'Subgift 1 / 5 / 10 / 20',
    'Jerry 1 / 5 / 10 / 20',
  ],
  ['bits', 'Bits', 'Bits', null],
  ['raid', 'Raid', 'Raid', null],
  ['donation', 'Don', 'Don', null],
];
const MODES: [FamilyMode, string][] = [
  ['auto', 'Auto'],
  ['usual', 'Habituelle'],
  ['halloween', 'Halloween'],
  ['off', 'Désactivée'],
];
/** The usual follow variants and their legacy weights (Core: FOLLOW_WEIGHTS). */
export const FOLLOW: [string, string, number][] = [
  ['follow_dofus_ebene', 'Dofus Ébène', 20],
  ['follow_dofus_eliatrope', 'Dofus Éliatrope', 20],
  ['follow_dofus_emeraude', 'Dofus Émeraude', 20],
  ['follow_eren', 'Eren', 20],
  ['follow_discord', 'Discord (rare)', 1],
];

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** What a family plays, in words (pure, tested). */
export function playsText(
  mode: FamilyMode,
  usual: string,
  halloween: string | null,
) {
  if (mode === 'off')
    return 'aucune animation (l’événement est noté, gains inchangés)';
  if (mode === 'usual' || !halloween) return usual;
  if (mode === 'halloween')
    return `${halloween} toujours (secours : ${usual} si le média manque)`;
  return `${usual} · ${halloween} quand le profil Halloween est actif`;
}

/** A follow checkbox toggled → the new selection; null when it would leave none (refused: switch the family off). */
export function toggleFollow(
  current: string[] | undefined,
  id: string,
  on: boolean,
): string[] | null {
  const set = new Set(current ?? FOLLOW.map(([v]) => v));
  if (on) set.add(id);
  else set.delete(id);
  return set.size ? FOLLOW.map(([v]) => v).filter((v) => set.has(v)) : null;
}

export function variantsView(s: VariantSettings | null, error: string | null) {
  if (!s)
    return `<p class="al-hint">${error ? `Core injoignable : ${esc(error)}` : 'Chargement…'}</p>`;
  const follow = new Set(s.follow ?? FOLLOW.map(([v]) => v));
  const rows = FAMILIES.map(([f, label, usual, hw]) => {
    const mode = s.families[f] ?? 'auto';
    const options = MODES.filter(([m]) => hw || m !== 'halloween')
      .map(
        ([m, l]) =>
          `<option value="${m}"${m === mode ? ' selected' : ''}>${l}</option>`,
      )
      .join('');
    return `<tr><td>${label}</td><td><select data-family="${f}" aria-label="${label}">${options}</select></td>
      <td class="${mode === 'off' ? 'al-error' : 'al-hint'}">${esc(playsText(mode, usual, hw))}</td></tr>`;
  }).join('');
  const total = FOLLOW.filter(([v]) => follow.has(v)).reduce(
    (t, [, , w]) => t + w,
    0,
  );
  const checks = FOLLOW.map(
    ([v, l, w]) =>
      `<label class="al-check"><input type="checkbox" data-follow="${v}"${follow.has(v) ? ' checked' : ''}/> ${l}${follow.has(v) ? ` <small>${Math.round((w / total) * 100)} %</small>` : ''}</label>`,
  ).join('');
  return `${error ? `<p class="al-error">Refusé : ${esc(error)} (rien n’a changé)</p>` : ''}<table class="al-variants"><thead><tr><th>Famille</th><th>Variantes</th><th>Joue</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="al-hint">Auto : suit le profil Halloween (onglet Halloween). Habituelle : jamais Halloween. Halloween : toujours, même
      profil coupé. Désactivée : aucune animation. Une seule alerte par événement, jamais deux.</p>
    <h3>Follow : variantes habituelles tirées au sort</h3><div class="al-presets">${checks}</div>
    <p class="al-hint">Au moins une reste cochée (pour ne rien jouer : famille « Désactivée »). Ballon (Sub / Prime / Resub) :
      onglet Halloween.</p>`;
}

export function mountAlertVariants(host: HTMLElement, headers: HeadersInit) {
  let state: VariantSettings | null = null;
  let error: string | null = null;
  const render = () => (host.innerHTML = variantsView(state, error));
  const call = async (body?: unknown) => {
    try {
      const res = await fetch('/api/alerts/variants', {
        method: body ? 'POST' : 'GET',
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const out = (await res.json()) as VariantSettings & { error?: string };
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      state = out;
      error = null;
    } catch (e) {
      error = (e as Error).message;
    }
    render();
  };
  host.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.family)
      void call({ families: { [t.dataset.family]: t.value } });
    else if (t.dataset.follow) {
      const next = toggleFollow(state?.follow, t.dataset.follow, t.checked);
      if (next) void call({ follow: next });
      else render(); // the last one stays checked
    }
  });
  render();
  void call();
}
