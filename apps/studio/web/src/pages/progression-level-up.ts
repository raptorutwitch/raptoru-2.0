import {
  choiceBox,
  confirmBox,
  errText,
  esc,
  fld,
  fmt,
  grp,
  hhmm,
  numrow,
  patch,
  poller,
  row,
  run,
  sw,
  toast,
} from '../ds/ds.js';
import { ApiError, getJson, postJson } from '../http.js';
import {
  parseLegacyPrefsExport,
  planSubBadges,
  type BadgePlan,
  type LegacyPrefRow,
} from './level-up-model.js';

// Level Up V2 (docs/LEVEL_UP_V2.md): the « Level Up » scene of the Progression page — the passage to 1 000 XP per level
// (simulate, activate once, undo), the chat announcements, the SOUND (never any visual on stream), the first extension's
// sound choices, the sub badges every 10 levels, the latest level-ups. Studio shows and relays: the Core decides, counts
// and journals.

type Buckets = Record<string, number>;
interface LevelBadge {
  id: string;
  label: string;
  level: number;
  active: boolean;
  status: string;
  image: string | null;
  owners: number;
}
interface Status {
  levelModel: 'curve' | 'fixed';
  normalization: { applied_at: string; max_level: number } | null;
  xpPerLevel: number;
  historyRows: number;
  maxWizebotLevel: number;
  accounts: number;
  attachedAccounts: number;
  levels: { buckets: Buckets; max: number };
  levelBadges: LevelBadge[];
  methods: Record<
    'proportional' | 'sqrt' | 'chosen',
    { exponent: number; distinctLevels: number; droppedToLevel1: number }
  >;
}
interface Simulation {
  accounts: number;
  attachedAccounts: number;
  changed: number;
  levelChanged: number;
  rates: {
    xp_per_minute: number;
    message_xp: number;
    message_cooldown_s: number;
  };
  levelsBefore: { buckets: Buckets; max: number };
  levelsAfter: { buckets: Buckets; max: number };
  variations: {
    name: string;
    wizebot: number | null;
    before: number;
    after: number;
  }[];
  levelRewardsGiven: number;
  levelRewards: {
    id: string;
    label: string;
    level: number;
    owners: number;
    ownersBefore: number;
  }[];
  unresolved: {
    imported: number;
    pending: number;
    ambiguous: number;
    conflict: number;
    sample: { login: string; status: string; level: number }[];
  };
}
interface LuRules {
  level_model: 'curve' | 'fixed';
  level_up_sound: boolean;
  level_up_sound_cooldown_s: number;
  level_up_max_age_s: number;
  level_up_chat: boolean;
  level_up_chat_text: string;
  level_up_chat_interval_s: number;
  message_min_distinct: number;
  message_repeat_window_s: number;
}
interface Source {
  player_url: string;
  volume: number;
  sources: number;
  shown: number;
  last_error: string | null;
  custom_sound: boolean;
  custom_sound_type: string | null;
}
interface LevelUp {
  id: number;
  displayName: string;
  fromLevel: number;
  toLevel: number;
  status: string;
  reason: string | null;
  sound: boolean;
  at: string;
  chat: { status: string; reason: string | null };
}
interface PrefsImport {
  dry_run: boolean;
  rows: number;
  sound_on: number;
  sound_off: number;
  unchanged: number;
  kept_extension_choice: number;
  other_channel: number;
  duplicates: number;
  no_identity: string[];
}

const ACTIVATE = 'NORMALISER LES NIVEAUX';
const UNDO = 'ANNULER LA NORMALISATION';
const STATUS_FR: Record<string, string> = {
  pending: 'en attente',
  delivered: 'joué',
  sent: 'envoyé',
  skipped: 'non',
  expired: 'trop ancien',
  merged: 'regroupé',
};
const REASON_FR: Record<string, string> = {
  sound_off: 'sons coupés pour la chaîne',
  viewer_no_sound: 'le viewer n’a pas activé le son',
  chat_off: 'annonces chat coupées',
  chat_output_off: '« Sortie chat réelle » coupée',
  too_old: 'trop ancien',
  newer_level_up: 'regroupé avec un niveau plus haut',
  sound_cooldown: 'délai entre deux sons',
  outbox_refused: 'file du chat indisponible',
};
const WAITING_FR: Record<string, string> = {
  pending: 'inconnu pour l’instant',
  ambiguous: 'ambigu',
  conflict: 'conflit',
};
const REFUS = {
  already_applied:
    'Level Up V2 est déjà actif : la normalisation ne se fait qu’une fois.',
  not_applied: 'Level Up V2 n’est pas actif : rien à annuler.',
  imports_since_activation:
    'Annulation impossible : un historique WizeBot a été rattaché depuis l’activation (son XP compte déjà à 1 000 par niveau).',
  level_curve_locked: 'La courbe est verrouillée depuis Level Up V2.',
  unsupported_sound: 'Ce fichier n’est pas un son MP3, OGG ou WAV.',
  sound_too_large: 'Fichier trop lourd : 2 Mo au plus.',
  no_source:
    'Aucune source OBS « Level Up » connectée : ajoute-la dans OBS d’abord.',
  image_kind_mismatch: 'Image refusée : un badge fait 128 px et 40 Ko au plus.',
};
const BUCKET_ORDER = [
  '1',
  '2-5',
  '6-9',
  '10-19',
  '20-29',
  '30-39',
  '40-49',
  '50+',
];

const bucketsHtml = (before: Buckets, after?: Buckets) =>
  `<table class="d-tbl pg-lu-t"><thead><tr><th>Niveaux</th><th>Aujourd’hui</th>${after ? '<th>Après</th>' : ''}</tr></thead><tbody>${BUCKET_ORDER.filter(
    (k) => k in before,
  )
    .map(
      (k) =>
        `<tr><td>${esc(k)}</td><td>${fmt(before[k])}</td>${after ? `<td>${fmt(after[k] ?? 0)}</td>` : ''}</tr>`,
    )
    .join('')}</tbody></table>`;

/** A sub badge made to the Core's rule (128 × 128 at most, 40 Ko at most): the same picture, only smaller. */
async function badgeImage(file: Blob) {
  const bmp = await createImageBitmap(file);
  const side = 128;
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  const k = Math.min(side / bmp.width, side / bmp.height);
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  g.drawImage(bmp, (side - w) / 2, (side - h) / 2, w, h);
  for (const [type, q] of [
    ['image/webp', 0.92],
    ['image/webp', 0.82],
    ['image/png', 1],
    ['image/webp', 0.7],
  ] as const) {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, q));
    if (blob && blob.size <= 40 * 1024) return blob;
  }
  throw new ApiError(400, 'image_kind_mismatch');
}
const base64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('image illisible'));
    r.readAsDataURL(b);
  });
const sha256 = async (b: Blob) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', await b.arrayBuffer()),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');

export function mountLevelUpScene(
  host: HTMLElement,
  o: { onChanged: () => void },
) {
  host.innerHTML = `<div class="pg-lu">
    <div data-lz="model"></div>
    <div data-lz="announce"></div>
    <div data-lz="sound"></div>
    <div data-lz="prefs"></div>
    <div data-lz="badges"></div>
    <div data-lz="recent"></div>
    <input type="file" accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav" data-lu-file hidden>
    <input type="file" accept=".csv,.json,text/csv,application/json" data-lu-prefs hidden>
    <input type="file" webkitdirectory multiple data-lu-badges hidden>
  </div>`;
  const zz = (k: string) =>
    host.querySelector<HTMLElement>(`[data-lz="${k}"]`)!;
  const file = host.querySelector<HTMLInputElement>('[data-lu-file]')!;
  const prefsFile = host.querySelector<HTMLInputElement>('[data-lu-prefs]')!;
  const badgesDir = host.querySelector<HTMLInputElement>('[data-lu-badges]')!;
  let status: Status | null = null;
  let rules: LuRules | null = null;
  let source: Source | null = null;
  let recent: LevelUp[] = [];
  let sim: Simulation | null = null;
  let prefRows: LegacyPrefRow[] | null = null;
  let prefRead = { invalid: 0, name: '' };
  let prefResult: PrefsImport | null = null;
  let plan:
    (BadgePlan & { files: Map<string, File>; take: Set<number> }) | null = null;
  let error = '';

  async function read() {
    try {
      const [s, st, r] = await Promise.all([
        getJson<Status>('/api/progression/level-v2'),
        getJson<{ rules: LuRules }>('/api/progression/state'),
        getJson<LevelUp[]>('/api/progression/levelups'),
      ]);
      status = s;
      rules = st.rules;
      recent = r;
      error = '';
    } catch (e) {
      error = errText(e);
    }
    // The OBS source is Studio's own (absent when Studio has no Core profile).
    source = await getJson<Source>('/api/level-up/state').catch(() => null);
    paint();
  }
  const poll = poller(read, 6000);

  const save = (
    patchRules: Partial<LuRules>,
    btn: HTMLElement | null,
    done = 'Réglage enregistré.',
  ) =>
    run(
      btn,
      () => postJson('/api/progression/settings', { rules: patchRules }),
      done,
      REFUS,
    ).then((ok) => {
      if (ok) void read();
      return ok;
    });

  function paintModel() {
    const s = status;
    if (!s)
      return patch(
        zz('model'),
        `<div class="d-empty">${esc(error || 'Lecture…')}</div>`,
      );
    const fixed = s.levelModel === 'fixed';
    const c = s.methods.chosen;
    const simHtml = sim
      ? `<h4 class="pg-h">Simulation : rien n’a été écrit</h4>
        <dl class="d-kv"><dt>Comptes</dt><dd>${fmt(sim.accounts)}, dont ${fmt(sim.attachedAccounts)} avec un historique WizeBot</dd><dt>Niveau changé</dt><dd>${fmt(sim.levelChanged)} comptes</dd><dt>Niveau le plus haut</dt><dd>${fmt(sim.levelsBefore.max)} → ${fmt(sim.levelsAfter.max)}</dd><dt>Gains après l’activation</dt><dd>${fmt(sim.rates.xp_per_minute)} XP / min de présence, ${fmt(sim.rates.message_xp)} XP / message (un toutes les ${fmt(sim.rates.message_cooldown_s)} s)</dd><dt>Récompenses de niveau données</dt><dd>${fmt(sim.levelRewardsGiven)}</dd></dl>
        ${bucketsHtml(sim.levelsBefore.buckets, sim.levelsAfter.buckets)}
        ${
          sim.variations.length
            ? `<h4 class="pg-h">Plus grandes variations</h4><table class="d-tbl pg-lu-t"><thead><tr><th>Viewer</th><th>WizeBot</th><th>Avant</th><th>Après</th></tr></thead><tbody>${sim.variations
                .slice(0, 15)
                .map(
                  (v) =>
                    `<tr><td>${esc(v.name)}</td><td>${v.wizebot === null ? '—' : fmt(v.wizebot)}</td><td>${fmt(v.before)}</td><td>${fmt(v.after)}</td></tr>`,
                )
                .join('')}</tbody></table>`
            : ''
        }
        ${
          sim.levelRewards.length
            ? `<h4 class="pg-h">Badges et titres de niveau</h4><table class="d-tbl pg-lu-t"><thead><tr><th>Palier</th><th>Récompense</th><th>Viewers avant</th><th>Après</th></tr></thead><tbody>${sim.levelRewards
                .map(
                  (r) =>
                    `<tr><td>${fmt(r.level)}</td><td>${esc(r.label)}</td><td>${fmt(r.ownersBefore)}</td><td>${fmt(r.owners)}</td></tr>`,
                )
                .join('')}</tbody></table>`
            : '<p class="d-note">Aucun badge de niveau n’existe encore : importe tes badges sub avant d’activer pour les voir ici.</p>'
        }
        <h4 class="pg-h">Historiques WizeBot non résolus</h4>
        <p class="d-note">${fmt(sim.unresolved.pending)} inconnus pour l’instant, ${fmt(sim.unresolved.ambiguous)} ambigus, ${fmt(sim.unresolved.conflict)} en conflit : jamais donnés à une mauvaise personne. Ils reçoivent le même niveau figé le jour où ils sont rattachés (le viewer revu, une connexion sur raptoru.fr, ou à la main dans Viewers).</p>
        ${
          sim.unresolved.sample.length
            ? `<table class="d-tbl pg-lu-t"><thead><tr><th>Pseudo WizeBot</th><th>Niveau</th><th>État</th></tr></thead><tbody>${sim.unresolved.sample
                .slice(0, 12)
                .map(
                  (w) =>
                    `<tr><td>${esc(w.login)}</td><td>${fmt(w.level)}</td><td>${esc(WAITING_FR[w.status] ?? w.status)}</td></tr>`,
                )
                .join('')}</tbody></table>`
            : ''
        }`
      : '';
    patch(
      zz('model'),
      grp(
        'Passage à Level Up V2',
        'level',
        `${row('Modèle des niveaux', `<b>${fixed ? `Fixe : ${fmt(s.xpPerLevel)} XP par niveau` : 'Courbe (premier modèle)'}</b>`)}
        ${fixed && s.normalization ? row('Activé', `<span>${esc(new Date(s.normalization.applied_at).toLocaleString('fr-FR'))}</span>`) : ''}
        ${row('Comptes', `<span>${fmt(s.accounts)} dont ${fmt(s.attachedAccounts)} avec un historique WizeBot</span>`)}
        ${row('Niveau WizeBot le plus haut', `<span>${fmt(s.maxWizebotLevel)} → 50</span>`)}
        <p class="d-note">Un historique WizeBot devient le niveau normalisé (exposant ${c.exponent}), plus toute l’XP gagnée depuis. Sans historique : l’XP est gardée, le niveau se lit à 1 000 XP par niveau. Les gains passent à 1 XP par minute de présence et 3 XP par message. Jamais d’annonce ni de son pour ce recalcul ; les badges de niveau sont donnés selon le niveau recalculé.</p>
        ${simHtml}
        <div class="pg-lu-acts">${
          fixed
            ? `<button type="button" class="d-btn danger" data-lu="revert">Annuler la normalisation…</button>`
            : `<button type="button" class="d-btn" data-lu="simulate">Simuler</button><button type="button" class="d-btn pri" data-lu="activate">Activer Level Up V2…</button>`
        }</div>
        <p class="d-note">Garanties : la simulation n’écrit rien. L’activation se fait une seule fois, avec la phrase tapée, et chaque compte garde une ligne d’audit (niveau et XP avant). Elle s’annule tant qu’aucun historique n’a été rattaché depuis. En Production : sauvegarde Coolify vérifiée avant (docs/LEVEL_UP_V2.md § 9).</p>`,
      ),
    );
  }

  function paintAnnounce() {
    const r = rules;
    if (!r || zz('announce').contains(document.activeElement)) return;
    patch(
      zz('announce'),
      grp(
        'Annonces dans le chat',
        'chat',
        `${row('Annoncer les Level Up (LeCroupier_)', sw(r.level_up_chat, 'data-lu-rule="level_up_chat"', 'Annoncer les Level Up'))}
        <label class="pg-fl"><span>Texte : {pseudo} et {niveau}</span><span class="d-fld"><input type="text" data-lu-text maxlength="200" value="${esc(r.level_up_chat_text)}"></span></label>
        ${numrow('Une annonce au plus toutes les', fld('data-lu-num="level_up_chat_interval_s" min="5" max="3600"', r.level_up_chat_interval_s, 's'))}
        ${numrow('Annonce abandonnée après', fld('data-lu-num="level_up_max_age_s" min="10" max="3600"', r.level_up_max_age_s, 's'))}
        <h4 class="pg-h">Anti-farm du chat</h4>
        ${numrow('Lettres ou chiffres différents', fld('data-lu-num="message_min_distinct" min="1" max="20"', r.message_min_distinct))}
        ${numrow('Même message sans XP pendant', fld('data-lu-num="message_repeat_window_s" min="0" max="86400"', r.message_repeat_window_s, 's'))}
        <p class="d-note">Chaque vrai Level Up est annoncé, que le viewer ait activé le son ou non. Plusieurs Level Up rapprochés partent en une seule ligne, et plusieurs niveaux d’un coup sont annoncés une fois. La « Sortie chat réelle » et la limite du bot s’appliquent. Les gains d’XP se règlent dans XP et Daily.</p>
        <button type="button" class="d-btn" data-lu="save-text">Enregistrer le texte et les délais</button>`,
      ),
    );
  }

  function paintSound() {
    const r = rules;
    const s = source;
    if (zz('sound').contains(document.activeElement)) return;
    patch(
      zz('sound'),
      grp(
        'Son sur le stream',
        'sound',
        `${r ? row('Sons Level Up', sw(r.level_up_sound, 'data-lu-rule="level_up_sound"', 'Sons Level Up')) : ''}
        ${r ? numrow('Un son au plus toutes les', fld('data-lu-num2="level_up_sound_cooldown_s" min="0" max="86400"', r.level_up_sound_cooldown_s, 's')) : ''}
        ${
          s
            ? `${row('Source OBS invisible (navigateur, 1920 × 1080)', `<button type="button" class="d-btn" data-lu="copy">Copier l’adresse</button>`)}
          ${row('Sources connectées', `<span>${fmt(s.sources)}${s.last_error ? ` · <span class="d-tag off">${esc(s.last_error)}</span>` : ''}</span>`)}
          ${numrow('Volume', fld('data-lu-volume min="0" max="100"', s.volume, '%'))}
          ${row('Fichier', `<span>${s.custom_sound ? `Ton son (${esc((s.custom_sound_type ?? '').replace('audio/', ''))})` : 'Carillon de test (Studio)'}</span>`)}
          <div class="pg-lu-acts"><button type="button" class="d-btn" data-lu="sound-pick">${s.custom_sound ? 'Remplacer le son…' : 'Choisir un son…'}</button>${s.custom_sound ? '<button type="button" class="d-btn ghost" data-lu="sound-reset">Supprimer mon son</button>' : ''}<button type="button" class="d-btn" data-lu="test-sound">Tester le son</button></div>`
            : '<div class="d-empty">Source indisponible : Studio n’a pas de profil Core.</div>'
        }
        <p class="d-note">Le son n’est joué que pour les viewers qui l’ont activé dans l’extension (« Jouer un son lorsque je monte de niveau ») : jamais par défaut. Rien ne s’affiche sur le stream. Le fichier reste sur ce PC ; vérifie que tu as le droit de diffuser ce son en public.</p>`,
      ),
    );
  }

  function paintPrefs() {
    const res = prefResult;
    patch(
      zz('prefs'),
      grp(
        'Choix du son de l’ancienne extension',
        'user',
        `<p class="d-note">Jusqu’à la bascule du 20/10, l’extension gardait le choix « son des Level Up » de chaque viewer dans la table Supabase <code>ext_viewer_preferences</code>. Exporte-la (CSV ou JSON) depuis supabase.raptoru.fr, puis choisis le fichier : Studio montre d’abord ce qui changerait. Un choix fait depuis dans l’extension actuelle passe toujours en premier.</p>
        <div class="pg-lu-acts"><button type="button" class="d-btn" data-lu="prefs-pick">Choisir l’export…</button>${prefRows && res?.dry_run ? `<button type="button" class="d-btn pri" data-lu="prefs-import">Importer ces choix</button>` : ''}</div>
        ${
          prefRows
            ? `<p class="d-note">${esc(prefRead.name)} : ${fmt(prefRows.length)} lignes lues${prefRead.invalid ? `, ${fmt(prefRead.invalid)} illisibles écartées` : ''}.</p>`
            : ''
        }
        ${
          res
            ? `<dl class="d-kv"><dt>${res.dry_run ? 'Simulation, rien écrit' : 'Importé'}</dt><dd>${fmt(res.sound_on)} son activé · ${fmt(res.sound_off)} son coupé</dd><dt>Déjà à jour</dt><dd>${fmt(res.unchanged)}</dd><dt>Choix récent gardé (extension actuelle)</dt><dd>${fmt(res.kept_extension_choice)}</dd><dt>Doublons (la ligne la plus récente gagne)</dt><dd>${fmt(res.duplicates)}</dd><dt>Autre chaîne, écartées</dt><dd>${fmt(res.other_channel)}</dd><dt>Sans identifiant Twitch</dt><dd>${fmt(res.no_identity.length)}${res.no_identity.length ? ` (${esc(res.no_identity.slice(0, 8).join(', '))})` : ''}</dd></dl>`
            : ''
        }`,
      ),
    );
  }

  function paintBadges() {
    const s = status;
    if (!s) return;
    const byLevel = new Map(s.levelBadges.map((b) => [b.level, b]));
    const waiting = s.levelModel === 'curve' && s.attachedAccounts > 0;
    const top = Math.max(
      100,
      ...s.levelBadges.map((b) => b.level),
      plan ? Math.max(0, ...plan.badges.map((b) => b.level)) : 0,
    );
    const lines: string[] = [];
    for (let lvl = 10; lvl <= top; lvl += 10) {
      const b = byLevel.get(lvl);
      lines.push(
        row(
          `Niveau ${lvl}`,
          b
            ? `<span>${b.image ? `<img class="pg-lu-img" src="${esc(b.image.replace('/v1/cosmetics/images/', '/cosmetics/images/'))}" alt="">` : ''}${esc(b.label)} · ${b.image ? '' : '<span class="d-tag off">sans image</span> · '}${b.active ? `${fmt(b.owners)} viewer${b.owners > 1 ? 's' : ''}` : '<span class="d-tag off">inactif</span>'}</span>`
            : '<span class="d-faint">aucun badge</span>',
        ),
      );
    }
    const planHtml = plan
      ? `<h4 class="pg-h">Tes badges sub trouvés</h4><table class="d-tbl pg-lu-t"><thead><tr><th>Importer</th><th>Palier</th><th>Badge</th><th>Remarque</th></tr></thead><tbody>${plan.badges
          .map(
            (b) =>
              `<tr><td><input type="checkbox" data-lu-take="${b.n}" ${plan!.take.has(b.n) ? 'checked' : ''} aria-label="Importer le badge ${b.n}"></td><td>${fmt(b.level)}</td><td>n°${b.n} · ${esc(b.name)}</td><td>${b.doubt ? `<span class="d-tag off">à confirmer</span> ${esc(b.doubt)}` : b.note ? `<span class="d-faint">${esc(b.note)}</span>` : ''}</td></tr>`,
          )
          .join('')}</tbody></table>
        ${plan.issues.map((i) => `<p class="d-note">${esc(i)}</p>`).join('')}
        <p class="d-note">${fmt(plan.ignored.length)} fichiers laissés de côté (sous-dossiers comme « Obsolète » ou « Badges Bits », fichiers sans numéro). Chaque image est réduite à 128 px, comme raptoru.fr l’affiche ; le dessin ne change pas.</p>
        <div class="pg-lu-acts"><button type="button" class="d-btn pri" data-lu="badges-import" ${plan.take.size ? '' : 'disabled'}>Importer ${fmt(plan.take.size)} badge${plan.take.size > 1 ? 's' : ''}</button></div>`
      : '';
    patch(
      zz('badges'),
      grp(
        'Badges de niveau (tous les 10 niveaux)',
        'star',
        `<div class="pg-lu-acts"><button type="button" class="d-btn" data-lu="badges-pick">Importer mes badges sub…</button></div>
        ${planHtml}
        ${lines.join('')}
        <p class="d-note">${
          waiting
            ? 'Les badges de niveau attendent l’activation de Level Up V2 : ils seront donnés selon les niveaux recalculés (jamais selon l’ancienne échelle WizeBot).'
            : 'Donnés à tous ceux qui ont déjà le niveau, puis à chaque passage : jamais repris, jamais en double.'
        } Chaque viewer choisit sur raptoru.fr les badges affichés à côté de son pseudo (3 au plus). Nom et image se retouchent dans Boutique.</p>`,
      ),
    );
  }

  function paintRecent() {
    patch(
      zz('recent'),
      grp(
        'Derniers Level Up',
        'pulse',
        recent.length
          ? `<table class="d-tbl pg-lu-t"><thead><tr><th>Heure</th><th>Viewer</th><th>Niveau</th><th>Chat</th><th>Son</th></tr></thead><tbody>${recent
              .slice(0, 30)
              .map(
                (e) =>
                  `<tr><td>${esc(hhmm(e.at))}</td><td>${esc(e.displayName)}</td><td>${fmt(e.fromLevel)} → ${fmt(e.toLevel)}</td><td title="${esc(REASON_FR[e.chat.reason ?? ''] ?? '')}">${esc(STATUS_FR[e.chat.status] ?? e.chat.status)}</td><td title="${esc(REASON_FR[e.reason ?? ''] ?? '')}">${esc(STATUS_FR[e.status] ?? e.status)}${e.sound ? ' 🔊' : ''}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<div class="d-empty">Aucun Level Up pour l’instant : seuls les vrais gains (présence, chat) en créent.</div>',
      ),
    );
  }

  function paint() {
    paintModel();
    paintAnnounce();
    paintSound();
    paintPrefs();
    paintBadges();
    paintRecent();
  }

  const typed = (title: string, body: string, phrase: string, yes: string) =>
    choiceBox({
      title,
      body: `${body} Pour confirmer, tape : ${phrase}`,
      choices: [],
      yes,
      danger: true,
      field: { label: phrase, required: true },
    }).then((r) =>
      r && r.text.trim() === phrase
        ? true
        : r
          ? (toast('Phrase incorrecte : rien n’a changé.', { bad: true }),
            false)
          : false,
    );

  async function importBadges(btn: HTMLElement) {
    const p = plan;
    if (!p) return;
    const chosen = p.badges.filter((b) => p.take.has(b.n));
    await run(
      btn,
      async () => {
        for (const b of chosen) {
          const img = await badgeImage(p.files.get(b.path)!);
          const up = await postJson<{ image_id: string }>(
            '/api/cosmetics/images',
            { purpose: 'badge', data_base64: await base64(img) },
          );
          await postJson('/api/cosmetics/items', {
            reward_id: `niveau-${b.level}`,
            kind: 'badge',
            label: `Niveau ${b.level}`,
            description: `Badge sub n°${b.n} (${b.name}), débloqué au niveau ${b.level}.`,
            rarity: 'common',
            category: 'niveau',
            unlock_level: b.level,
            sort: b.level,
            status: 'published',
            image_id: up.image_id,
          });
        }
      },
      `${chosen.length} badge${chosen.length > 1 ? 's' : ''} importé${chosen.length > 1 ? 's' : ''}.`,
      REFUS,
    ).then((ok) => {
      if (!ok) return;
      plan = null;
      o.onChanged();
      void read();
    });
  }

  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const act = b.dataset.lu;
    if (act === 'simulate') {
      void run(b, async () => {
        sim = await postJson<Simulation>(
          '/api/progression/level-v2/simulate',
          {},
        );
        paint();
      });
      return;
    }
    if (act === 'activate') {
      void typed(
        'Activer Level Up V2 ?',
        'Tous les niveaux passent à 1 000 XP par niveau, une seule fois : les historiques WizeBot sont normalisés, l’XP gagnée depuis est gardée, les gains passent à 1 XP / minute et 3 XP / message, les badges de niveau sont donnés selon le niveau recalculé. Aucune annonce, aucun son.',
        ACTIVATE,
        'Activer',
      ).then((ok) => {
        if (!ok) return;
        void run(
          b,
          () =>
            postJson('/api/progression/level-v2/activate', {
              confirm: ACTIVATE,
            }),
          'Level Up V2 activé.',
          REFUS,
        ).then((done) => {
          if (!done) return;
          sim = null;
          o.onChanged();
          void read();
        });
      });
      return;
    }
    if (act === 'revert') {
      void typed(
        'Annuler la normalisation ?',
        'L’XP, la courbe et les gains d’avant reviennent (l’audit reste). Impossible si un historique WizeBot a été rattaché depuis l’activation. Les badges déjà donnés restent.',
        UNDO,
        'Annuler la normalisation',
      ).then((ok) => {
        if (!ok) return;
        void run(
          b,
          () => postJson('/api/progression/level-v2/revert', { confirm: UNDO }),
          'Normalisation annulée.',
          REFUS,
        ).then((done) => {
          if (!done) return;
          o.onChanged();
          void read();
        });
      });
      return;
    }
    if (act === 'save-text') {
      const text =
        host.querySelector<HTMLInputElement>('[data-lu-text]')!.value;
      const nums: Record<string, number> = {};
      for (const i of host.querySelectorAll<HTMLInputElement>('[data-lu-num]'))
        nums[i.dataset.luNum!] = Number(i.value);
      void save(
        { level_up_chat_text: text, ...nums },
        b,
        'Texte et délais enregistrés.',
      ).then((ok) => {
        if (!ok) toast('Le texte doit contenir {niveau}.', { bad: true });
      });
      return;
    }
    if (act === 'copy' && source) {
      void navigator.clipboard.writeText(source.player_url).then(
        () => toast('Adresse copiée : ajoute une source navigateur dans OBS.'),
        () => toast('Copie impossible.', { bad: true }),
      );
      return;
    }
    if (act === 'test-sound') {
      void run(
        b,
        () => postJson('/api/level-up/test', { sound: true }),
        'Son envoyé à la source OBS.',
        REFUS,
      );
      return;
    }
    if (act === 'sound-pick') {
      file.value = '';
      file.click();
      return;
    }
    if (act === 'sound-reset') {
      void confirmBox({
        title: 'Supprimer ton son ?',
        body: 'Ton fichier est supprimé du dossier de Studio ; le carillon de test le remplace.',
        yes: 'Supprimer',
      }).then((ok) => {
        if (!ok) return;
        void run(
          b,
          () => studioFetch('/api/level-up/sound', { method: 'DELETE' }),
          'Son supprimé : carillon de test.',
        ).then(() => void read());
      });
      return;
    }
    if (act === 'prefs-pick') {
      prefsFile.value = '';
      prefsFile.click();
      return;
    }
    if (act === 'prefs-import' && prefRows) {
      const rows = prefRows;
      void confirmBox({
        title: 'Importer les choix de l’ancienne extension ?',
        body: `${fmt(prefResult?.sound_on ?? 0)} viewers retrouvent le son, ${fmt(prefResult?.sound_off ?? 0)} le gardent coupé. Un choix fait depuis dans l’extension actuelle n’est jamais remplacé.`,
        yes: 'Importer',
        danger: false,
      }).then((ok) => {
        if (!ok) return;
        void run(
          b,
          async () => {
            prefResult = await postJson<PrefsImport>(
              '/api/progression/prefs/import',
              { dry_run: false, rows },
            );
            paint();
          },
          'Choix importés.',
        );
      });
      return;
    }
    if (act === 'badges-pick') {
      badgesDir.value = '';
      badgesDir.click();
      return;
    }
    if (act === 'badges-import') void importBadges(b);
  });

  host.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.luRule) {
      void save(
        { [t.dataset.luRule]: t.checked } as Partial<LuRules>,
        null,
        t.checked ? 'Activé.' : 'Coupé.',
      );
      return;
    }
    if (t.dataset.luNum2) {
      void save(
        { [t.dataset.luNum2]: Number(t.value) } as Partial<LuRules>,
        null,
      );
      return;
    }
    if (t.dataset.luTake && plan) {
      const n = Number(t.dataset.luTake);
      if (t.checked) plan.take.add(n);
      else plan.take.delete(n);
      paintBadges();
      return;
    }
    if (t.matches('[data-lu-volume]')) {
      const v = Math.round(Number(t.value));
      void run(
        null,
        () => postJson('/api/level-up/volume', { volume: v }),
        `Volume : ${v} %`,
        REFUS,
      ).then(() => void read());
      return;
    }
    if (t === file && file.files?.[0]) {
      const f = file.files[0];
      void run(
        null,
        () => studioFetch('/api/level-up/sound', { method: 'POST', body: f }),
        `Son « ${f.name} » enregistré.`,
        REFUS,
      ).then(() => void read());
      return;
    }
    if (t === prefsFile && prefsFile.files?.[0]) {
      const f = prefsFile.files[0];
      void run(null, async () => {
        const parsed = parseLegacyPrefsExport(await f.text());
        prefRows = parsed.rows;
        prefRead = { invalid: parsed.invalid, name: f.name };
        prefResult = await postJson<PrefsImport>(
          '/api/progression/prefs/import',
          { dry_run: true, rows: parsed.rows },
        );
        paint();
      });
      return;
    }
    if (t === badgesDir && badgesDir.files?.length) {
      const list = [...badgesDir.files];
      void run(null, async () => {
        const files = new Map<string, File>();
        const described = [];
        for (const f of list) {
          const path = f.webkitRelativePath || f.name;
          files.set(path, f);
          // Only pictures need their content compared (never the 20 Mo Clip Studio files).
          described.push({
            path,
            size: f.size,
            hash: /\.(png|webp|jpe?g)$/i.test(f.name)
              ? await sha256(f)
              : `other:${path}`,
          });
        }
        const p = planSubBadges(described);
        plan = {
          ...p,
          files,
          // A badge with a doubt waits for Antoni's tick; the others are ready.
          take: new Set(p.badges.filter((b) => !b.doubt).map((b) => b.n)),
        };
        paint();
      });
    }
  });

  return {
    /** The scene is shown (read now, then every 6 s) or hidden (nothing read). */
    visible(on: boolean) {
      if (on) poll.start();
      else poll.stop();
    },
  };
}

/** Studio's own API with a raw body (the sound file): the Studio header, a refusal turned into an ApiError. */
async function studioFetch(
  path: string,
  init: { method: string; body?: Blob },
) {
  const res = await fetch(path, {
    method: init.method,
    headers: {
      'x-raptoru-studio': '1',
      'content-type': 'application/octet-stream',
    },
    body: init.body,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok)
    throw new ApiError(res.status, body.error ?? 'http_error', body as never);
  return body;
}
