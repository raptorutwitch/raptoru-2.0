// Level Up V2 (docs/PROGRESSION.md) — Studio's cards inside the Progression tab: the normalization (real distribution,
// the three compressions compared, the guarded activation and its undo), the channel's notifications (on / off, sound
// cooldown, freshness), the OBS level-up source (URL, volume, a local test) and the latest level-ups. Core decides and
// records; Studio relays. No bulk action without its typed confirmation.

type Json = Record<string, unknown>;
type Call = (path: string, body?: unknown) => Promise<Json>;
type Buckets = Record<string, number>;
type Method = {
  exponent: number;
  all: Buckets;
  attached: Buckets;
  droppedToLevel1: number;
  distinctLevels: number;
};
type Status = {
  levelModel: 'curve' | 'fixed';
  normalization: {
    version: number;
    exponent: number;
    max_level: number;
    target_max: number;
    applied_at: string;
  } | null;
  xpPerLevel: number;
  historyRows: number;
  maxWizebotLevel: number;
  distinctWizebotLevels: number;
  wizebot: Buckets;
  accounts: number;
  attachedAccounts: number;
  nativeXpAccounts: number;
  methods: Record<'proportional' | 'sqrt' | 'chosen', Method>;
};
type LevelUp = {
  id: number;
  displayName: string;
  fromLevel: number;
  toLevel: number;
  mode: string;
  status: string;
  reason: string | null;
  sound: boolean;
  at: string;
};
type Source = {
  player_url: string;
  volume: number;
  sources: number;
  shown: number;
  last_error: string | null;
  custom_sound: boolean;
};

export const ACTIVATE_PHRASE = 'NORMALISER LES NIVEAUX';
export const REVERT_PHRASE = 'ANNULER LA NORMALISATION';
const MODE_FR: Record<string, string> = {
  off: 'Désactivé',
  text: 'Écrit',
  sound: 'Sonore',
};
const STATUS_FR: Record<string, string> = {
  pending: 'en attente',
  delivered: 'affiché',
  skipped: 'non affiché',
  expired: 'trop ancien',
  merged: 'fusionné',
};
const REASON_FR: Record<string, string> = {
  viewer_off: 'mode du viewer : désactivé',
  notifications_off: 'notifications coupées',
  too_old: 'trop ancien',
  newer_level_up: 'un niveau plus récent l’a remplacé',
  sound_cooldown: 'sans son (délai entre deux sons)',
};

export function createLevelUpPanel(
  call: Call,
  esc: (s: unknown) => string,
  fmt: (n: number) => string,
) {
  let status: Status | null = null;
  let levelUps: LevelUp[] = [];
  let source: Source | null = null;

  const buckets = (b: Buckets) =>
    Object.entries(b)
      .map(([k, v]) => `${esc(k)} : ${fmt(v)}`)
      .join(' · ');

  return {
    async load() {
      [status, levelUps, source] = await Promise.all([
        call('/api/progression/level-v2').catch(
          () => null,
        ) as Promise<Status | null>,
        call('/api/progression/levelups').catch(() => []) as unknown as Promise<
          LevelUp[]
        >,
        call('/api/level-up/state').catch(
          () => null,
        ) as unknown as Promise<Source | null>,
      ]);
    },

    html(rules: Record<string, unknown>) {
      const s = status;
      const on = rules.level_up_notifications === true;
      const v2 = s?.levelModel === 'fixed';
      return `
        <section class="card wide"><h3>Level Up V2 — niveaux à 1 000 XP</h3>
          ${
            !s
              ? '<p class="muted">Indisponible (Core du profil sans Level Up V2 ?).</p>'
              : `<p>Modèle actuel : <b>${v2 ? `fixe, ${fmt(s.xpPerLevel)} XP par niveau` : 'courbe (premier modèle)'}</b>${s.normalization ? ` · normalisation v${s.normalization.version} appliquée le ${esc(new Date(s.normalization.applied_at).toLocaleString('fr-FR'))} (exposant ${s.normalization.exponent}, niveau WizeBot max figé ${s.normalization.max_level} → ${s.normalization.target_max})` : ''}</p>
          <p class="muted">Historiques WizeBot : ${fmt(s.historyRows)} (niveau max ${s.maxWizebotLevel}, ${s.distinctWizebotLevels} niveaux distincts) — ${buckets(s.wizebot)}. Comptes : ${fmt(s.accounts)}, dont ${fmt(s.attachedAccounts)} avec historique et ${fmt(s.nativeXpAccounts)} avec de l’XP gagnée depuis.</p>
          <table class="tbl"><thead><tr><th>Compression</th><th>Tous les historiques (nouveaux niveaux)</th><th>Niveaux &gt; 1 tombés à 1</th><th>Niveaux distincts</th></tr></thead><tbody>
            ${(['proportional', 'sqrt', 'chosen'] as const)
              .map(
                (k) =>
                  `<tr><td>${k === 'chosen' ? `<b>retenue (exposant ${s.methods[k].exponent})</b>` : k === 'sqrt' ? 'adoucie (racine)' : 'proportionnelle'}</td><td>${buckets(s.methods[k].all)}</td><td>${fmt(s.methods[k].droppedToLevel1)}</td><td>${s.methods[k].distinctLevels}</td></tr>`,
              )
              .join('')}
          </tbody></table>
          <p class="muted">Activation (une seule fois) : chaque historique WizeBot rattaché prend son niveau normalisé, plus toute l’XP gagnée ou ajustée depuis ; les comptes sans historique gardent leur XP (1 niveau par 1 000 XP). Rien n’entre dans les classements Semaine / Mois, aucune annonce. Les historiques rattachés plus tard suivent les mêmes paramètres figés.</p>
          ${
            v2
              ? `<button type="button" class="warn" data-act="lv2-revert">Annuler la normalisation…</button>`
              : `<button type="button" class="primary" data-act="lv2-activate">Activer Level Up V2…</button>`
          }`
          }
        </section>
        <section class="card"><h3>Annonces de Level Up</h3>
          <p>${on ? '<b>Actives</b> : chaque viewer choisit dans l’extension (Désactivé par défaut, Écrit ou Sonore).' : '<b>Coupées</b> : les montées de niveau sont enregistrées, jamais annoncées.'}</p>
          <button type="button" data-act="lu-toggle" class="${on ? '' : 'primary'}">${on ? 'Couper les annonces' : 'Activer les annonces'}</button>
          <label class="row">Délai entre deux sons, toute la chaîne (s) <input type="number" min="0" max="86400" step="1" data-lu="level_up_sound_cooldown_s" value="${esc(rules.level_up_sound_cooldown_s)}"></label>
          <label class="row">Annonce abandonnée après (s) <input type="number" min="10" max="3600" step="1" data-lu="level_up_max_age_s" value="${esc(rules.level_up_max_age_s)}"></label>
          <button type="button" data-act="lu-save">Enregistrer</button>
          <p class="muted">Une annonce dans le délai entre deux sons s’affiche sans son ; plusieurs niveaux d’un viewer : une seule annonce (le dernier). Aucune annonce pour un import, une normalisation ou un ajustement.</p>
        </section>
        <section class="card"><h3>Source OBS « Level Up »</h3>
          ${
            source
              ? `<p>À ajouter dans OBS (source navigateur 1920 × 1080, fond transparent) :</p>
          <p><code>${esc(source.player_url)}</code></p>
          <p class="muted">${source.sources ? `<b>${source.sources}</b> source(s) connectée(s)` : 'aucune source connectée (rien n’est demandé au Core sans elle)'} · ${fmt(source.shown)} annonce(s) affichée(s) · son : ${source.custom_sound ? 'personnalisé' : 'carillon par défaut'}${source.last_error ? ` · erreur : ${esc(source.last_error)}` : ''}</p>
          <label class="row">Volume du son (%) <input type="number" min="0" max="100" step="5" data-role="lu-volume" value="${source.volume}"></label>
          <button type="button" data-act="lu-volume">Enregistrer le volume</button>
          <button type="button" data-act="lu-test">Tester (écrit)</button>
          <button type="button" data-act="lu-test-sound">Tester (sonore)</button>`
              : '<p class="muted">Source indisponible (profil sans Core ?).</p>'
          }
        </section>
        <section class="card wide"><h3>Derniers Level Up</h3>
          <table class="tbl"><thead><tr><th>Quand</th><th>Viewer</th><th>Niveau</th><th>Mode</th><th>Annonce</th></tr></thead><tbody>
          ${
            levelUps
              .slice(0, 30)
              .map(
                (e) =>
                  `<tr><td>${esc(new Date(e.at).toLocaleString('fr-FR'))}</td><td>${esc(e.displayName)}</td><td>${e.fromLevel} → <b>${e.toLevel}</b></td><td>${esc(MODE_FR[e.mode] ?? e.mode)}</td><td>${esc(STATUS_FR[e.status] ?? e.status)}${e.sound ? ' 🔊' : ''}${e.reason ? ` <span class="muted">(${esc(REASON_FR[e.reason] ?? e.reason)})</span>` : ''}</td></tr>`,
              )
              .join('') ||
            '<tr><td colspan="5" class="muted">Aucun Level Up pour l’instant.</td></tr>'
          }
          </tbody></table>
        </section>`;
    },

    /** A click in the tab: true when it was one of these cards' actions (the result message, or null). */
    async click(
      act: string,
      root: HTMLElement,
    ): Promise<{ handled: boolean; message?: string }> {
      const val = (sel: string) =>
        root.querySelector<HTMLInputElement>(sel)?.value ?? '';
      const run = async (fn: () => Promise<unknown>, ok: string) => {
        try {
          await fn();
          return { handled: true, message: ok };
        } catch (e) {
          return {
            handled: true,
            message: `Refusé : ${(e as Error).message}`,
          };
        }
      };
      if (act === 'lv2-activate') {
        const typed = prompt(
          `Level Up V2 : tous les niveaux passent à 1 000 XP par niveau et les historiques WizeBot sont normalisés (une seule fois, réversible tant qu’aucun historique n’a été rattaché depuis). Pour confirmer, tape : ${ACTIVATE_PHRASE}`,
        );
        if (typed === null) return { handled: true };
        return run(
          () =>
            call('/api/progression/level-v2/activate', {
              confirm: typed.trim(),
            }),
          'Level Up V2 activé.',
        );
      }
      if (act === 'lv2-revert') {
        const typed = prompt(
          `Annuler la normalisation (l’XP et la courbe d’avant reviennent ; l’audit est gardé). Pour confirmer, tape : ${REVERT_PHRASE}`,
        );
        if (typed === null) return { handled: true };
        return run(
          () =>
            call('/api/progression/level-v2/revert', { confirm: typed.trim() }),
          'Normalisation annulée.',
        );
      }
      if (act === 'lu-toggle')
        return run(async () => {
          const st = (await call('/api/progression/state')) as {
            rules?: Record<string, unknown>;
          };
          await call('/api/progression/settings', {
            rules: {
              level_up_notifications: st.rules?.level_up_notifications !== true,
            },
          });
        }, 'Annonces mises à jour.');
      if (act === 'lu-save')
        return run(
          () =>
            call('/api/progression/settings', {
              rules: {
                level_up_sound_cooldown_s: Number(
                  val('[data-lu="level_up_sound_cooldown_s"]'),
                ),
                level_up_max_age_s: Number(
                  val('[data-lu="level_up_max_age_s"]'),
                ),
              },
            }),
          'Réglages des annonces enregistrés.',
        );
      if (act === 'lu-volume')
        return run(
          () =>
            call('/api/level-up/volume', {
              volume: Number(val('[data-role="lu-volume"]')),
            }),
          'Volume enregistré.',
        );
      if (act === 'lu-test' || act === 'lu-test-sound')
        return run(
          () => call('/api/level-up/test', { sound: act === 'lu-test-sound' }),
          'Annonce de test envoyée à la source OBS.',
        );
      return { handled: false };
    },
  };
}
