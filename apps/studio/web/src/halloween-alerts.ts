// Halloween — « Alertes Halloween » card (docs/HALLOWEEN.md § 14): the Halloween alert profile (Miss Minute for
// follows, the Ballon for sub / Prime / resub, Jerry for gifts) switched on / off in the Core without any redeploy, the
// Ballon animations each event may draw, and free tests through the real alert queue (the OBS « Alertes » source plays
// them; no Twitch event, nothing paid). The tests always use the Halloween variants, even while the profile is off.

export interface BallonPools {
  sub: number[];
  prime: number[];
  resub: number[];
}
export interface HalloweenAlertRules {
  halloween_alerts?: boolean;
  halloween_ballon?: BallonPools;
}
export interface CatalogVariant {
  id: string;
  missing?: string[];
}

const ALL: BallonPools = {
  sub: [1, 2, 3, 4],
  prime: [1, 2, 3, 4],
  resub: [1, 2, 3, 4],
};
const BALLON_LABEL = ['Bonbons', 'Citrouilles', 'Bonbons maïs', 'Araignées'];
const KINDS: [keyof BallonPools, string][] = [
  ['sub', 'Sub'],
  ['prime', 'Prime'],
  ['resub', 'Resub'],
];

/** The free tests: one simulated event each, Halloween variant forced (pure, tested). */
export const ALERT_TESTS: Record<string, Record<string, unknown>> = {
  follow: { type: 'follow' },
  sub: { type: 'sub', tier: '1000' },
  prime: { type: 'sub', tier: 'prime' },
  resub: { type: 'resub', tier: '1000', months: 13 },
  gift1: { type: 'gift_community', count: 1 },
  gift5: { type: 'gift_community', count: 5 },
  gift10: { type: 'gift_community', count: 10 },
  gift20: { type: 'gift_community', count: 20 },
  targeted: {
    type: 'gift_targeted',
    recipient: { display_name: 'Viewer Chanceux', login: 'viewer_chanceux' },
  },
};

export function alertTest(key: string) {
  const t = ALERT_TESTS[key];
  if (!t) return null;
  return {
    ...t,
    actor: { display_name: 'Testeur Halloween', login: 'testeur_halloween' },
    test_profile: 'halloween',
  };
}

/** A Ballon checkbox toggled → the new pools (never an empty pool: the last one stays). */
export function togglePool(
  pools: BallonPools | undefined,
  kind: keyof BallonPools,
  n: number,
  on: boolean,
): BallonPools {
  const cur = { ...ALL, ...(pools ?? {}) };
  const set = new Set(cur[kind]);
  if (on) set.add(n);
  else if (set.size > 1) set.delete(n);
  return { ...cur, [kind]: [...set].sort((a, b) => a - b) };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function halloweenAlertsCard(
  rules: HalloweenAlertRules | null,
  catalog: CatalogVariant[] | null,
  error: string | null,
) {
  if (!rules)
    return `<p class="hw-hint">${error ? `Core injoignable : ${esc(error)}` : 'Chargement…'}</p>`;
  const on = rules.halloween_alerts === true;
  const pools = { ...ALL, ...(rules.halloween_ballon ?? {}) };
  const hw = (catalog ?? []).filter((v) => v.id.startsWith('hw_'));
  const missing = [...new Set(hw.flatMap((v) => v.missing ?? []))];
  const media = !catalog
    ? '<p class="hw-hint">État des médias : indisponible (onglet Alertes).</p>'
    : missing.length
      ? `<p class="hw-hint hw-warn">Médias absents de ce PC (l’alerte habituelle sera jouée à la place) : ${missing.map(esc).join(', ')}</p>`
      : `<p class="hw-hint">${hw.length} variantes Halloween, tous leurs médias sont sur ce PC.</p>`;
  const state = on
    ? '<div class="hw-state ok"><span class="hw-dot"></span>Profil Halloween ACTIF : les vrais follows, subs et subgifts jouent les alertes Halloween</div>'
    : '<div class="hw-state warn"><span class="hw-dot"></span>Profil habituel : les alertes normales sont jouées</div>';
  const test = (key: string, label: string) =>
    `<button type="button" class="hw-chip" data-alert-test="${key}">${label}</button>`;
  return `${state}
    <div class="hw-form">
      <button type="button" class="${on ? '' : 'primary'}" data-act="toggle-hw-alerts">${on ? 'Revenir aux alertes habituelles' : 'Activer les alertes Halloween'}</button>
    </div>
    <p class="hw-hint">Follow → Miss Minute (« Hello… ») · Sub, Prime, Resub → le Ballon (« Le Ballon V2 ») · Subgift → Jerry (1, 5, 10, 20 subs : « My Ordinary Life »). Raid, bits, dons : inchangés.</p>
    <table class="hw-table"><thead><tr><th>Ballon tiré au hasard parmi</th>${BALLON_LABEL.map((l, i) => `<th>${i + 1}. ${l}</th>`).join('')}</tr></thead><tbody>
      ${KINDS.map(
        ([k, label]) =>
          `<tr><td>${label}</td>${[1, 2, 3, 4]
            .map(
              (n) =>
                `<td><input type="checkbox" data-ballon="${k}:${n}"${pools[k].includes(n) ? ' checked' : ''}/></td>`,
            )
            .join('')}</tr>`,
      ).join('')}
    </tbody></table>
    <p class="hw-hint">Tester (gratuit, aucun événement Twitch, joué par la source OBS « Alertes », même profil coupé) :</p>
    <div class="hw-chips">
      ${test('follow', 'Follow')}${test('sub', 'Sub')}${test('prime', 'Prime')}${test('resub', 'Resub')}
      ${test('gift1', 'Subgift ×1')}${test('gift5', 'Subgift ×5')}${test('gift10', 'Subgift ×10')}${test('gift20', 'Subgift ×20')}${test('targeted', 'Sub offert à un viewer')}
    </div>
    ${media}
    <p class="hw-hint">Aperçu sans file et placement du texte : onglet Alertes, variantes « hw_… ». Les textes sont provisoires.</p>`;
}
