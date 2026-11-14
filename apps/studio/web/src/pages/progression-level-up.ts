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
  seg,
  sw,
  toast,
} from '../ds/ds.js';
import { ApiError, getJson, postJson } from '../http.js';

// Level Up V2 (docs/LEVEL_UP_V2.md): the « Level Up » scene of the Progression page — the passage to 1 000 XP per level
// (simulate, activate once, undo), the announcements (Twitch chat, stream), the OBS source and its sound, the badges
// every 10 levels, the latest level-ups. Studio shows and relays: the Core decides, counts and journals.

type Buckets = Record<string, number>;
interface Method {
  exponent: number;
  all: Buckets;
  attached: Buckets;
  droppedToLevel1: number;
  distinctLevels: number;
}
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
  nativeXpAccounts: number;
  levels: { buckets: Buckets; max: number };
  levelBadges: LevelBadge[];
  methods: Record<'proportional' | 'sqrt' | 'chosen', Method>;
}
interface Simulation {
  accounts: number;
  changed: number;
  levelsBefore: { buckets: Buckets; max: number };
  levelsAfter: { buckets: Buckets; max: number };
  levelRewardsGiven: number;
}
interface LuRules {
  level_model: 'curve' | 'fixed';
  level_up_notifications: boolean;
  level_up_sound_cooldown_s: number;
  level_up_max_age_s: number;
  level_up_default_mode: 'off' | 'text' | 'sound';
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
  mode: string;
  status: string;
  reason: string | null;
  sound: boolean;
  at: string;
  chat: { status: string; reason: string | null };
}

const ACTIVATE = 'NORMALISER LES NIVEAUX';
const UNDO = 'ANNULER LA NORMALISATION';
const MODES = [
  ['off', 'Désactivé'],
  ['text', 'Écrit'],
  ['sound', 'Sonore'],
] as const;
const STATUS_FR: Record<string, string> = {
  pending: 'en attente',
  delivered: 'affiché',
  sent: 'envoyé',
  skipped: 'non',
  expired: 'trop ancien',
  merged: 'regroupé',
};
const REASON_FR: Record<string, string> = {
  notifications_off: 'annonces à l’écran coupées',
  viewer_off: 'le viewer a choisi Désactivé',
  chat_off: 'annonces chat coupées',
  chat_output_off: '« Sortie chat réelle » coupée',
  too_old: 'trop ancien',
  newer_level_up: 'regroupé avec un niveau plus haut',
  sound_cooldown: 'sans son (délai entre deux sons)',
  outbox_refused: 'file du chat indisponible',
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

const bucketsHtml = (b: Buckets, order = BUCKET_ORDER) =>
  `<dl class="d-kv pg-lu-b">${order
    .filter((k) => k in b)
    .map((k) => `<dt>Niveau ${esc(k)}</dt><dd>${fmt(b[k])}</dd>`)
    .join('')}</dl>`;

export function mountLevelUpScene(
  host: HTMLElement,
  o: { onChanged: () => void },
) {
  host.innerHTML = `<div class="pg-lu">
    <div data-lz="model"></div>
    <div data-lz="announce"></div>
    <div data-lz="source"></div>
    <div data-lz="badges"></div>
    <div data-lz="recent"></div>
    <input type="file" accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav" data-lu-file hidden>
  </div>`;
  const zz = (k: string) =>
    host.querySelector<HTMLElement>(`[data-lz="${k}"]`)!;
  const file = host.querySelector<HTMLInputElement>('[data-lu-file]')!;
  let status: Status | null = null;
  let rules: LuRules | null = null;
  let source: Source | null = null;
  let recent: LevelUp[] = [];
  let sim: Simulation | null = null;
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
    patch(
      zz('model'),
      grp(
        'Passage à Level Up V2',
        'level',
        `${row('Modèle des niveaux', `<b>${fixed ? `Fixe : ${fmt(s.xpPerLevel)} XP par niveau` : 'Courbe (premier modèle)'}</b>`)}
        ${fixed && s.normalization ? row('Activé', `<span>${esc(new Date(s.normalization.applied_at).toLocaleString('fr-FR'))}</span>`) : ''}
        ${row('Comptes', `<span>${fmt(s.accounts)} dont ${fmt(s.attachedAccounts)} avec un historique WizeBot</span>`)}
        ${row('Niveau WizeBot le plus haut', `<span>${fmt(s.maxWizebotLevel)} → 50</span>`)}
        <p class="d-note">Un historique WizeBot devient le niveau normalisé (exposant ${c.exponent} : ${fmt(c.distinctLevels)} niveaux distincts, ${fmt(c.droppedToLevel1)} viewer ramené au niveau 1), plus toute l’XP gagnée depuis. Sans historique : l’XP est gardée, le niveau se lit à 1 000 XP par niveau. Jamais d’annonce, jamais dans Semaine / Mois ; les badges de niveau sont donnés selon le niveau recalculé.</p>
        <h4 class="pg-h">Niveaux aujourd’hui</h4>${bucketsHtml(s.levels.buckets)}
        ${
          sim
            ? `<h4 class="pg-h">Simulation, rien écrit</h4><dl class="d-kv"><dt>Comptes modifiés</dt><dd>${fmt(sim.changed)} / ${fmt(sim.accounts)}</dd><dt>Niveau le plus haut</dt><dd>${fmt(sim.levelsBefore.max)} → ${fmt(sim.levelsAfter.max)}</dd><dt>Récompenses de niveau données</dt><dd>${fmt(sim.levelRewardsGiven)}</dd></dl>${bucketsHtml(sim.levelsAfter.buckets)}`
            : ''
        }
        <div class="pg-lu-acts">${
          fixed
            ? `<button type="button" class="d-btn danger" data-lu="revert">Annuler la normalisation…</button>`
            : `<button type="button" class="d-btn" data-lu="simulate">Simuler</button><button type="button" class="d-btn pri" data-lu="activate">Activer Level Up V2…</button>`
        }</div>
        <p class="d-note">Avant l’activation en Production : une sauvegarde Coolify vérifiée (docs/LEVEL_UP_V2.md § 7).</p>`,
      ),
    );
  }

  function paintAnnounce() {
    const r = rules;
    if (!r || zz('announce').contains(document.activeElement)) return;
    patch(
      zz('announce'),
      grp(
        'Annonces',
        'bell',
        `${row('Annonces dans le chat (LeCroupier_)', sw(r.level_up_chat, 'data-lu-rule="level_up_chat"', 'Annonces dans le chat'))}
        <label class="pg-fl"><span>Texte (un viewer) : {pseudo} et {niveau}</span><span class="d-fld"><input type="text" data-lu-text maxlength="200" value="${esc(r.level_up_chat_text)}"></span></label>
        ${numrow('Une annonce au plus toutes les', fld('data-lu-num="level_up_chat_interval_s" min="5" max="3600"', r.level_up_chat_interval_s, 's'))}
        ${row('Annonces à l’écran (source OBS)', sw(r.level_up_notifications, 'data-lu-rule="level_up_notifications"', 'Annonces à l’écran'))}
        ${numrow('Un son au plus toutes les', fld('data-lu-num="level_up_sound_cooldown_s" min="0" max="86400"', r.level_up_sound_cooldown_s, 's'))}
        ${numrow('Annonce abandonnée après', fld('data-lu-num="level_up_max_age_s" min="10" max="3600"', r.level_up_max_age_s, 's'))}
        ${row('Viewer qui n’a rien choisi', seg('data-lu-default', MODES, r.level_up_default_mode))}
        <h4 class="pg-h">Anti-farm du chat</h4>
        ${numrow('Lettres ou chiffres différents', fld('data-lu-num="message_min_distinct" min="1" max="20"', r.message_min_distinct))}
        ${numrow('Même message sans XP pendant', fld('data-lu-num="message_repeat_window_s" min="0" max="86400"', r.message_repeat_window_s, 's'))}
        <p class="d-note">Plusieurs Level Up rapprochés partent en une seule ligne ; un viewer qui monte de plusieurs niveaux est annoncé une fois. La « Sortie chat réelle » et la limite du bot s’appliquent. Chaque viewer garde son choix dans l’extension (Désactivé, Écrit, Sonore).</p>
        <button type="button" class="d-btn" data-lu="save-text">Enregistrer le texte et les délais</button>`,
      ),
    );
  }

  function paintSource() {
    const s = source;
    patch(
      zz('source'),
      grp(
        'Source OBS « Level Up »',
        'film',
        s
          ? `${row('Adresse (source navigateur 1920 × 1080)', `<button type="button" class="d-btn" data-lu="copy">Copier l’adresse</button>`)}
          ${row('Sources connectées', `<span>${fmt(s.sources)}${s.last_error ? ` · <span class="d-tag off">${esc(s.last_error)}</span>` : ''}</span>`)}
          ${numrow('Volume', fld('data-lu-volume min="0" max="100"', s.volume, '%'))}
          ${row('Son', `<span>${s.custom_sound ? `Ton fichier (${esc((s.custom_sound_type ?? '').replace('audio/', ''))})` : 'Carillon de Studio (test)'}</span>`)}
          <div class="pg-lu-acts"><button type="button" class="d-btn" data-lu="sound-pick">Choisir un son…</button>${s.custom_sound ? '<button type="button" class="d-btn ghost" data-lu="sound-reset">Revenir au carillon</button>' : ''}<button type="button" class="d-btn" data-lu="test-text">Tester (écrit)</button><button type="button" class="d-btn" data-lu="test-sound">Tester (sonore)</button></div>
          <p class="d-note">Le son reste sur ce PC (dossier de Studio). Avant de diffuser un son qui n’est pas le tien, vérifie que tu as le droit de le jouer en public.</p>`
          : '<div class="d-empty">Source indisponible : Studio n’a pas de profil Core.</div>',
      ),
    );
  }

  function paintBadges() {
    const s = status;
    if (!s) return;
    const top = Math.max(50, Math.ceil((s.levels.max + 1) / 10) * 10);
    const byLevel = new Map(s.levelBadges.map((b) => [b.level, b]));
    const waiting = s.levelModel === 'curve' && s.attachedAccounts > 0;
    const lines: string[] = [];
    for (let lvl = 10; lvl <= top; lvl += 10) {
      const b = byLevel.get(lvl);
      lines.push(
        b
          ? row(
              `Niveau ${lvl}`,
              `<span>${esc(b.label)} · ${b.image ? 'image ✓' : '<span class="d-tag off">sans image</span>'} · ${b.active ? `${fmt(b.owners)} viewer${b.owners > 1 ? 's' : ''}` : '<span class="d-tag off">inactif</span>'}</span>`,
            )
          : row(
              `Niveau ${lvl}`,
              `<button type="button" class="d-btn ghost" data-lu-badge="${lvl}">Créer le badge</button>`,
            ),
      );
    }
    patch(
      zz('badges'),
      grp(
        'Badges de niveau (tous les 10 niveaux)',
        'star',
        `${lines.join('')}
        <p class="d-note">${
          waiting
            ? 'Les badges de niveau attendent l’activation de Level Up V2 : ils seront donnés selon les niveaux recalculés (jamais selon l’ancienne échelle WizeBot).'
            : 'Donnés à tous ceux qui ont déjà le niveau, puis à chaque passage : jamais repris, jamais en double.'
        } L’image (PNG ou WebP, 128 px, 40 Ko au plus) s’ajoute dans <a href="/?p=shop">Boutique</a> ; sans image, raptoru.fr montre le nom. Chaque viewer choisit sur raptoru.fr les badges affichés à côté de son pseudo (3 au plus).</p>`,
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
          ? `<table class="d-tbl pg-lu-t"><thead><tr><th>Heure</th><th>Viewer</th><th>Niveau</th><th>Mode</th><th>Chat</th><th>Écran</th></tr></thead><tbody>${recent
              .slice(0, 30)
              .map(
                (e) =>
                  `<tr><td>${esc(hhmm(e.at))}</td><td>${esc(e.displayName)}</td><td>${fmt(e.fromLevel)} → ${fmt(e.toLevel)}</td><td>${esc(MODES.find(([k]) => k === e.mode)?.[1] ?? e.mode)}</td><td title="${esc(REASON_FR[e.chat.reason ?? ''] ?? '')}">${esc(STATUS_FR[e.chat.status] ?? e.chat.status)}</td><td title="${esc(REASON_FR[e.reason ?? ''] ?? '')}">${esc(STATUS_FR[e.status] ?? e.status)}${e.sound ? ' 🔊' : ''}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<div class="d-empty">Aucun Level Up pour l’instant : seuls les vrais gains (présence, chat) en créent.</div>',
      ),
    );
  }

  function paint() {
    paintModel();
    paintAnnounce();
    paintSource();
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
        'Tous les niveaux passent à 1 000 XP par niveau, une seule fois : les historiques WizeBot sont normalisés, l’XP gagnée depuis est gardée, les badges de niveau sont donnés selon le niveau recalculé. Aucune annonce.',
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
        'L’XP et la courbe d’avant reviennent (l’audit reste). Impossible si un historique WizeBot a été rattaché depuis l’activation. Les badges déjà donnés restent.',
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
    if (b.dataset.luDefault) {
      void save(
        {
          level_up_default_mode: b.dataset
            .luDefault as LuRules['level_up_default_mode'],
        },
        b,
      );
      return;
    }
    if (act === 'save-text') {
      const text =
        host.querySelector<HTMLInputElement>('[data-lu-text]')!.value;
      const nums: Partial<LuRules> = {};
      for (const i of host.querySelectorAll<HTMLInputElement>('[data-lu-num]'))
        (nums as Record<string, number>)[i.dataset.luNum!] = Number(i.value);
      void save(
        { level_up_chat_text: text, ...nums },
        b,
        'Texte et délais enregistrés.',
      ).then((ok) => {
        if (!ok) toast('Le texte doit contenir {niveau}.', { bad: true });
      });
      return;
    }
    if (b.dataset.luBadge) {
      const lvl = Number(b.dataset.luBadge);
      void run(
        b,
        () =>
          postJson('/api/progression/rewards', {
            reward_id: `niveau-${lvl}`,
            kind: 'badge',
            label: `Niveau ${lvl}`,
            description: `Débloqué au niveau ${lvl}.`,
            rarity: 'common',
            category: 'niveau',
            unlock_level: lvl,
            active: true,
            sort: lvl,
          }),
        `Badge du niveau ${lvl} créé : ajoute son image dans Boutique.`,
      ).then((ok) => {
        if (!ok) return;
        o.onChanged();
        void read();
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
    if (act === 'test-text' || act === 'test-sound') {
      void run(
        b,
        () => postJson('/api/level-up/test', { sound: act === 'test-sound' }),
        'Test envoyé à la source OBS.',
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
        title: 'Revenir au carillon ?',
        body: 'Ton fichier est supprimé du dossier de Studio ; le carillon de test le remplace.',
        yes: 'Revenir au carillon',
      }).then((ok) => {
        if (!ok) return;
        void run(
          b,
          () => studioFetch('/api/level-up/sound', { method: 'DELETE' }),
          'Carillon rétabli.',
        ).then(() => void read());
      });
    }
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
