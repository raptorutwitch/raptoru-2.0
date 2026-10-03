import type { RaffleConfig, RaffleSound } from '@raptoru/schemas';
import { ic } from './tombola-icons.js';

// « Tombola » tab — port of the validated prototype prototypes/tombola-v2/studio.html (Préparer &
// lancer · En direct · Historique). Core is the single source of truth: this page reads Core's
// settings / snapshot / round card / history through the Studio relay (/api/raffle/*) and only sends
// intentions (configuration, launch, +time, draw, pause, cancel, participants…). Additions decided
// with Antoni (D12, minimal, no new art direction): automatic scheduler, launch sounds, overlay
// display durations, editable chat commands (main + aliases), participant tools, round card. The chat
// (Twitch ingestion switch + simulator) is the Lab's single chat ingress (/api/lab-chat/*), shared
// by every module — not a Tombola feature.

type Json = Record<string, unknown>;
type View = 'setup' | 'live' | 'history';
interface Currency {
  id: string;
  label: string;
  short_label: string;
  icon: string;
  available: boolean;
}
interface Scheduler {
  enabled: boolean;
  preset: string;
  timing: { first_delay_s: number; min_s: number; max_s: number };
  state: 'stopped' | 'running' | 'paused';
  /** What to show (Core): disabled · waiting_stream · running · waiting_round · paused. */
  phase: 'disabled' | 'waiting_stream' | 'running' | 'waiting_round' | 'paused';
  can_pause: boolean;
  can_resume: boolean;
  next_at: string | null;
  remaining_ms: number | null;
  waiting_for_round: boolean;
  last_skip_reason: string | null;
}
type TitleState = 'open' | 'running' | 'paused' | 'ended' | 'cancelled';
type Titles = Record<TitleState, [string, string]> & { name: string };
interface Status {
  config: RaffleConfig;
  scheduler: Scheduler;
  currencies: Currency[];
  stream: { session_id: string; started_at: string; source: string } | null;
  winners_table: { participants: number; min: number; max: number }[];
  /** Titles composed by Core from the labels (overlay + extension). */
  titles?: { normal: Titles; super: Titles; giveaway: Titles; idle: string };
  overlay_url: string;
  preview_url: string;
}
/** Single Lab chat ingress (Studio): its switch and why it cannot be turned on. */
interface Ingress {
  enabled: boolean;
  running: boolean;
  blocked: { code: string; message: string } | null;
  token_login: string | null;
  lines: string[];
  last_exit: { code: number | null; at: string } | null;
}
/** `no_participants`: over with no entry (no draw, no winner, no payment) — not a cancellation. */
type Outcome = 'cancelled' | 'no_participants' | 'winners' | null;
interface Round {
  raffle_id: string;
  status: string;
  kind: 'normal' | 'super' | 'giveaway';
  amount: number;
  currency: { id: string; label: string; short_label: string } | null;
  prize: string | null;
  remaining_ms: number;
  duration_ms: number;
  participants: number;
  origin: 'manual' | 'automatic';
  reveal: { is_full: boolean } | null;
  outcome: Outcome;
  /** Core's titles of this round (its frozen name). */
  titles?: Titles;
}
interface Card {
  raffle_id: string;
  status: string;
  kind: string;
  amount: number;
  currency: { label: string; short_label: string } | null;
  prize: string | null;
  is_full: boolean | null;
  origin: string;
  opened_by: string;
  outcome: Outcome;
  duration_ms: number;
  timeline: Record<string, string | null>;
  cancelled_by: string | null;
  cancel_reason: string | null;
  entries: {
    viewer_id: string;
    display_name: string;
    source: 'chat' | 'extension' | 'manual';
    command: string | null;
    /** Twitch picture from Core's avatar cache (null = initials). */
    avatar_url?: string | null;
    created_at: string;
    added_by: string | null;
    removed_at: string | null;
    removed_by: string | null;
  }[];
  winners: {
    position: number;
    viewer_id: string;
    display_name: string;
    expected: number;
    currency: { short_label: string } | null;
    payout_status: 'pending' | 'paid' | 'failed' | 'none';
    ledger_id: number | null;
    credited: number;
    paid_at: string | null;
    attempts: number;
    failure: string | null;
  }[];
  audit: {
    created_at: string;
    actor: string;
    role: string;
    action: string;
    reason: string | null;
  }[];
}

/** Fonts of the custom overlay message (same as raffle-overlay/kit.js HINT_FONTS). */
const HINT_FONTS = {
  segoe: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  bahnschrift: "'Bahnschrift', 'Segoe UI', sans-serif",
  trebuchet: "'Trebuchet MS', 'Segoe UI', sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
} as const;
const HINT_COLORS: [string | null, string][] = [
  [null, 'Gris (défaut)'],
  ['#eef3f8', 'Blanc'],
  ['#2fd8c4', 'Turquoise'],
  ['#f47e98', 'Rose'],
  ['#e9c46a', 'Or'],
  ['#ffb35c', 'Ambre'],
];
const HINT_HIGHLIGHTS: [string | null, string][] = [
  [null, 'Aucun'],
  ['#05070bcc', 'Sombre'],
  ['#2fd8c433', 'Turquoise'],
  ['#f47e9838', 'Rose'],
  ['#e9c46a38', 'Or'],
];
const HINT_EMOJIS = ['🎟️', '🎁', '💰', '🔥', '⭐', '🎉', '🍀', '👀'];
const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const RUNNING = [
  'opening',
  'open',
  'paused',
  'drawing',
  'revealing',
  'revealed',
];
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
/** Viewer picture (`.pp`): stable hue + initials, the Twitch picture over it when Core has one. */
const hueOf = (n: string) =>
  [...n].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 9);
const pp = (name: string, url?: string | null, ext = false) =>
  `<span class="pp fr-pp ${ext ? 'ext' : ''}" style="--h:${hueOf(name)}"><i>${esc(
    name
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 2)
      .toUpperCase(),
  )}</i>${typeof url === 'string' && url.startsWith('https://static-cdn.jtvnw.net/') ? `<img src="${esc(url)}" alt="" loading="lazy" data-pp>` : ''}</span>`;
const fmt = (n: number) => Number(n).toLocaleString('fr-FR').replace(/ /g, ' ');
const hhmm = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const hhmmss = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
const duration = (ms: number | null) => {
  if (ms === null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60
    ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
    : `${s} s`;
};
const PRESETS: [string, string][] = [
  ['rare', 'Rare'],
  ['occasional', 'Occasionnel'],
  ['normal', 'Normal'],
  ['frequent', 'Fréquent'],
  ['very_frequent', 'Très fréquent'],
  ['custom', 'Personnalisé'],
];
const CUR_COLOR: Record<string, string> = {
  coin: '#e9c46a',
  tts: '#b48cff',
  sound: '#54c7ff',
  star: '#93a0b2',
};
const ERRORS: Record<string, string> = {
  forbidden: 'Action non autorisée.',
  raffle_already_open:
    'Une Tombola est déjà en cours (ou son résultat encore affiché).',
  no_open_raffle: 'Aucune Tombola en cours.',
  invalid_phase: 'Impossible à ce stade de la Tombola.',
  invalid_config: 'Configuration refusée par Core.',
  viewer_blocked: 'Ce viewer est bloqué de la Tombola.',
  already_joined: 'Déjà inscrit.',
  not_a_participant: 'Ce viewer ne participe pas.',
  global_pause: 'Raptoru est en pause globale.',
  module_disabled: 'La Tombola est désactivée.',
  currency_unavailable: 'Monnaie indisponible.',
  scheduler_not_paused: 'La Tombola automatique n’est pas en pause.',
  stream_already_live: 'Un stream est déjà en cours.',
  no_live_stream: 'Aucun stream en cours.',
  already_paid: 'Déjà payé.',
  unsupported_audio: 'Fichier refusé : MP3, WAV ou OGG uniquement.',
  sound_too_large: 'Fichier trop lourd (5 Mo maximum).',
  bot_running: 'Le bot du Test Lab lit déjà Twitch : arrête-le d’abord.',
  scheduler_not_running:
    'La Tombola automatique ne tourne pas (elle attend le prochain stream).',
  lab_core_unavailable: 'Core local indisponible.',
  core_unavailable: 'Core local indisponible.',
};

async function api<T = Json>(
  path: string,
  body?: unknown,
  raw?: { data: Blob; name: string },
  base = '/api/raffle',
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined && !raw ? 'GET' : 'POST',
    headers: raw
      ? {
          'x-raptoru-studio': '1',
          'content-type': 'application/octet-stream',
          'x-sound-name': encodeURIComponent(raw.name),
        }
      : HEADERS,
    body: raw
      ? raw.data
      : body === undefined
        ? undefined
        : JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw Object.assign(new Error(out.error ?? 'error'), {
      code: out.error,
      details: out,
    });
  return out;
}

/** Lab chat ingress (shared by every module): switch, status, simulator. */
const chatApi = <T = Json>(path: string, body?: unknown) =>
  api<T>(path, body, undefined, '/api/lab-chat');

/** Lab chat ingress outcomes, as the simulator shows them. */
const OUTCOME_FR: Record<string, string> = {
  joined: 'inscrit',
  already_joined: 'déjà inscrit',
  cancelled: 'Tombola annulée',
};
const MODULE_FR: Record<string, string> = { raffle: 'Tombola' };
type CmdList = 'join_commands' | 'cancel_commands';
const CMD_RE = /^![\p{L}\p{N}_]{1,24}$/u;
const normCmd = (v: string) => {
  const t = v.trim().toLowerCase();
  return t.startsWith('!') ? t : `!${t}`;
};

export function mountTombola(root: HTMLElement) {
  root.innerHTML = `<div class="tmb">
    <div class="page">
      <nav class="nav">
        <button class="on" type="button" data-view="setup">${ic('ticket')}Préparer & lancer</button>
        <button type="button" data-view="live">${ic('eye')}En direct<span class="live" data-id="liveDot" hidden></span></button>
        <button type="button" data-view="history">${ic('history')}Historique</button>
        <div class="note">Fermeture et tirage automatiques à la fin du timer : aucune action manuelle obligatoire.</div>
      </nav>
      <main>
        <section class="view on" data-id="v-setup"></section>
        <section class="view" data-id="v-live">
          <div data-id="liveMain"></div>
          <div class="grid" data-id="liveGrid">
            <div class="card c5" data-id="liveFeed"></div>
            <div class="card c7" data-id="pvCard"><h3>${ic('eye')}Aperçu overlay OBS<span class="r">la vraie page overlay, pilotée par Core · son coupé ici</span><button class="t-btn t-btn--ghost cmp-btn" type="button" data-act="compare">${ic('ext')}Comparer avec l’Extension</button></h3>
              <div class="cmp-row"><div class="preview" data-id="pv"><iframe data-id="pvf" title="Aperçu overlay"></iframe></div>
                <div class="cmp-ext" data-id="cmpExt" hidden><iframe data-id="extf" title="Extension Lab · viewer"></iframe><span class="fine">Extension Lab · viewer · Panel 318×496</span></div></div>
              <p class="fine" style="margin:8px 0 0">Source OBS (navigateur, 1920×1080) : <code data-id="obsUrl"></code></p>
              <p class="fine" data-id="cmpNote" hidden style="margin:6px 0 0">Anti-spoil : l’Extension affiche le résultat après la fin de l’animation sur l’overlay + « Décalage résultat Extension après le stream » (<b data-id="cmpDelay"></b> s, réglable dans Préparer & lancer). Ici l’overlay n’a pas le retard du stream Twitch : le calibrage final se fait en regardant le vrai stream.</p></div>
            <div class="c12" data-id="liveRes"></div>
          </div>
          <div data-id="liveHist"></div>
        </section>
        <section class="view" data-id="v-history"></section>
      </main>
    </div>
    <div class="confirm" data-id="confirm" hidden><div class="box"><h3>${ic('x')}Annuler la Tombola en cours ?</h3>
      <p>Les inscriptions sont fermées, personne n'est payé. L'overlay affiche « Tombola annulée » quelques secondes, puis disparaît.</p>
      <p>Réservé à l'équipe :</p><div class="who"><span class="t-pill">Streamer</span><span class="t-pill">Supermod</span><span class="t-pill">Modérateur</span><span class="t-pill" style="opacity:.5;text-decoration:line-through">Viewers</span></div>
      <p class="fine" style="margin:-6px 0 16px">Aussi possible depuis la console Modération et en chat (<code data-id="cancelCmd">!annuletombola</code>, modérateur et plus).</p>
      <div class="acts"><button class="t-btn t-btn--ghost" type="button" data-act="cancel-no">Continuer la Tombola</button><button class="t-btn t-btn--danger" type="button" data-act="cancel-yes">Annuler la Tombola</button></div></div></div>
    <div class="toast" data-id="toast" hidden></div>
  </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<T>(`[data-id="${id}"]`)!;
  let view: View = 'setup';
  let visible = false;
  let status: Status | null = null;
  let cfg: RaffleConfig | null = null;
  let round: Round | null = null;
  let card: Card | null = null;
  let snapAt = 0;
  let history: (Round & {
    participants: number;
    winners: { display_name: string; amount: number; payout_status: string }[];
    payouts: { paid: number; failed: number };
    is_full: boolean | null;
    opened_at: string;
    cancelled_at: string | null;
  })[] = [];
  let openCard: Card | null = null;
  let identities: { id: string; label: string }[] = [];
  let ingress: Ingress | null = null;
  let simOutcome = '';
  /** Command being edited (list + index) and the last refusal shown under each list. */
  let editing: { list: CmdList; i: number } | null = null;
  const cmdErr: Record<CmdList, string> = {
    join_commands: '',
    cancel_commands: '',
  };
  /** One launch sound preview at a time (Studio only — on stream, the OBS overlay plays it). */
  let preview: { audio: HTMLAudioElement; slot: string } | null = null;
  let addResults: { viewer_id: string; display_name: string }[] = [];
  let timers: number[] = [];

  const toast = (text: string, bad = false) => {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('bad', bad);
    t.hidden = false;
    window.setTimeout(() => (t.hidden = true), 3200);
  };
  const fail = (e: unknown) => {
    const code = (e as { code?: string }).code ?? (e as Error).message;
    const msg = (e as { details?: { message?: string } }).details?.message;
    toast(
      ERRORS[code]
        ? `${ERRORS[code]}${code === 'invalid_config' && msg ? ` (${msg})` : ''}`
        : (msg ?? code),
      true,
    );
  };
  const act = async (command: Json) => {
    try {
      const out = await api('/actions', { command });
      await refresh();
      return out;
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  /** Saves the whole configuration (Core validates it); the page re-renders from Core's answer. */
  const save = async (next: RaffleConfig) => {
    try {
      await api('/actions', { command: { action: 'config', config: next } });
      cfg = next;
      await refresh(true);
    } catch (e) {
      fail(e);
      renderSetup();
    }
  };
  const patch = (fn: (c: RaffleConfig) => void) => {
    if (!cfg) return;
    const next = structuredClone(cfg);
    fn(next);
    void save(next);
  };

  // --- Préparer & lancer ---------------------------------------------------------------------------------
  const cur = (id: string) => status?.currencies.find((c) => c.id === id);
  function summary(c: RaffleConfig) {
    const k = cur(c.currency_id);
    const what =
      c.amount_mode === 'random'
        ? `Aléatoire ${fmt(c.random.bands[0]!.from)} – ${fmt(c.random.bands.at(-1)!.to)}`
        : c.amount_mode === 'fixed'
          ? fmt(c.fixed_amount)
          : `Giveaway · ${esc(c.prize)}`;
    return [
      `<span class="t-pill">${ic(k?.icon ?? 'coin')}${c.amount_mode === 'giveaway' ? 'Lot' : esc(k?.label ?? c.currency_id)}</span>`,
      `<span class="t-pill">${ic('dice')}${what}</span>`,
      `<span class="t-pill">${ic('clock')}${c.duration_s} s</span>`,
      `<span class="t-pill">${ic('users')}${c.winners_mode === 'auto' ? 'Gagnants auto' : `${c.winners_custom} gagnant${c.winners_custom > 1 ? 's' : ''}`}</span>`,
      c.full.enabled
        ? `<span class="t-pill t-pill--gold">${ic('crown')}FULL ${c.full.chance_pct} %</span>`
        : '',
      `<span class="t-pill t-pill--chat">${ic('chat')}${esc(c.join_commands.join(' '))}</span>`,
      c.extension_button
        ? `<span class="t-pill t-pill--ext">${ic('ext')}Bouton Extension</span>`
        : '',
      c.scheduler.enabled
        ? `<span class="t-pill">${ic('bolt')}Auto · ${esc(PRESETS.find((p) => p[0] === c.scheduler.preset)?.[1] ?? '')}</span>`
        : '',
    ].join('');
  }
  function curCarousel(c: RaffleConfig) {
    const list = status?.currencies ?? [];
    return `<div class="cur"><button class="arrow" type="button" data-cur-step="-1">${ic('chevL')}</button><div class="track">${list
      .map(
        (k) =>
          `<button type="button" class="coin ${c.currency_id === k.id ? 'on' : ''} ${k.available ? '' : 'soon'}" ${k.available ? `data-cur="${esc(k.id)}"` : 'disabled'} style="--c:${CUR_COLOR[k.icon] ?? '#93a0b2'}"><span class="ci">${ic(k.icon)}</span><span><b>${esc(k.label)}</b><span>${k.available ? 'monnaie Raptoru' : 'à venir'}</span></span></button>`,
      )
      .join(
        '',
      )}<button type="button" class="coin soon" disabled style="--c:#93a0b2"><span class="ci">${ic('star')}</span><span><b>Future monnaie</b><span>à venir</span></span></button></div><button class="arrow" type="button" data-cur-step="1">${ic('chevR')}</button></div>`;
  }
  function modeBody(c: RaffleConfig) {
    if (c.amount_mode === 'random') {
      const bands = c.random.bands;
      const max = Math.max(...bands.map((b) => b.pct), 1);
      const under20 = bands
        .filter((b) => b.to <= 20_000)
        .reduce((a, b) => a + b.pct, 0);
      return `<div class="inline" style="margin-top:12px"><span class="muted">Tranches (de, à, % des Tombolas)</span><span class="fine">pas de</span><input class="input" style="width:90px" data-cfg="random.step" value="${c.random.step}"></div>
        <div class="bands">${bands
          .map(
            (b, i) =>
              `<div class="inline"><input class="input" style="width:100px" data-band="${i}.from" value="${b.from}"><span class="muted">→</span><input class="input" style="width:100px" data-band="${i}.to" value="${b.to}"><input class="input" style="width:70px" data-band="${i}.pct" value="${b.pct}"><span class="muted">%</span></div>`,
          )
          .join('')}</div>
        <div class="dist">${bands
          .map(
            (b) =>
              `<div class="b ${b.from >= 20_000 ? 'rare' : ''}"><em>${b.pct} %</em><i style="height:${(b.pct / max) * 62}px"></i><span>${b.from / 1000}–${b.to / 1000}k</span></div>`,
          )
          .join('')}</div>
        <p class="fine" style="margin:8px 0 0">≈ ${Math.round(under20)} % des Tombolas sous 20 000 · plus le montant monte, plus il est rare (y compris dans chaque tranche).</p>`;
    }
    if (c.amount_mode === 'fixed')
      return `<div class="field"><span>Montant</span><div class="inline"><input class="input" style="width:160px" data-cfg="fixed_amount" value="${c.fixed_amount}"><div class="chips">${[
        5000, 10000, 25000, 50000,
      ]
        .map(
          (v) =>
            `<button type="button" class="chip ${c.fixed_amount === v ? 'on' : ''}" data-fixed="${v}">${fmt(v)}</button>`,
        )
        .join('')}</div></div></div>`;
    return `<div class="field"><span>Lot (texte affiché sur le stream et dans l’extension)</span><input class="input" style="font-family:var(--t-font)" data-cfg="prize" value="${esc(c.prize)}"></div><p class="fine" style="margin:8px 0 0">Aucune monnaie créditée : le streamer remet le lot lui-même. Gagnant(s) annoncé(s) comme pour une Tombola normale.</p>`;
  }
  function soundRow(
    slot: 'normal' | 'super' | 'giveaway',
    label: string,
    fallback: string,
  ) {
    const s = cfg!.launch_sounds[slot];
    return `<div class="sound-row"><div class="txt"><b>${label}</b><span class="fine">${s ? `${esc(s.name)} · ${s.format.toUpperCase()} · ${fmt(Math.round(s.size_bytes / 1024))} Ko` : esc(fallback)}</span></div>
      ${
        s
          ? `<button class="t-btn t-btn--ghost" type="button" data-sound-play="${slot}">${preview?.slot === slot ? `${ic('stop')}Stop` : `${ic('play')}Écouter`}</button>
      <label class="vol">${ic('sound')}<input type="range" min="0" max="100" value="${s.volume}" data-sound-vol="${slot}"><span>${s.volume}</span></label>`
          : ''
      }
      <label class="t-btn t-btn--ghost">${ic('plus')}${s ? 'Remplacer' : 'Importer'}<input type="file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" data-sound-file="${slot}" hidden></label>
      ${s ? `<button class="t-btn t-btn--ghost" type="button" data-sound-del="${slot}">${ic('x')}Supprimer</button>` : ''}</div>`;
  }
  /** Scheduler state, from Core's `phase` (never guessed here): what is shown and which button. */
  function schedState() {
    const s = status!.scheduler;
    const skip = s.last_skip_reason
      ? ` · dernier lancement sauté : ${esc(ERRORS[s.last_skip_reason] ?? s.last_skip_reason)}`
      : '';
    const line =
      s.phase === 'waiting_stream'
        ? '<b>Automatisation activée · En attente du prochain stream</b>'
        : s.phase === 'running'
          ? `Prochaine Tombola automatique dans <b class="t-num" data-id="schedLeft">${duration(s.remaining_ms)}</b>`
          : s.phase === 'waiting_round'
            ? 'Tombola en cours : la prochaine sera planifiée à la fin de son affichage.'
            : s.phase === 'paused'
              ? `<b style="color:#ffbf6e">Automatisation en pause</b> · reste <b class="t-num">${duration(s.remaining_ms)}</b> (gardé à la reprise)`
              : 'Désactivée.';
    const btn = s.can_pause
      ? `<button class="t-btn t-btn--ghost" type="button" data-sched="pause">Pause</button>`
      : s.can_resume
        ? `<button class="t-btn t-btn--ghost" type="button" data-sched="resume">${ic('play')}Reprendre</button>`
        : '';
    return { line: line + skip, btn };
  }
  /** Explicit stream state: the simulation is never implicit. A Twitch session is ended by Twitch. */
  function streamLine() {
    const st = status!.stream;
    if (!st)
      return `<span>État stream : <b>Hors ligne</b></span><button class="t-btn t-btn--ghost" type="button" data-stream="start">Simuler début de stream</button>`;
    if (st.source === 'twitch')
      return `<span>État stream : <b style="color:var(--t-ok)">En direct (Twitch)</b> depuis ${hhmm(st.started_at)}</span><span class="fine">fin détectée par l’ingestion Twitch</span>`;
    return `<span>État stream : <b style="color:var(--t-ok)">En direct (simulation)</b> depuis ${hhmm(st.started_at)}</span><button class="t-btn t-btn--ghost" type="button" data-stream="end">Simuler fin de stream</button>`;
  }
  /** Bottom of the overlay C4 block (participants row + instruction), with the overlay's own values. */
  function hintPreview(c: RaffleConfig, text = c.overlay_hint.text) {
    const h = c.overlay_hint;
    const st = h.style;
    // Same style as the overlay (raffle-overlay/kit.js hintMessage).
    const css = [
      `font-family:${HINT_FONTS[st.font]}`,
      st.color ? `color:${st.color}` : '',
      st.bold ? 'font-weight:800' : '',
      st.italic ? 'font-style:italic' : '',
    ]
      .filter(Boolean)
      .join(';');
    const body = st.highlight
      ? `<span class="hl" style="background:${st.highlight}">${esc(text.trim())}</span>`
      : esc(text.trim());
    const hint =
      h.mode === 'none'
        ? ''
        : h.mode === 'join'
          ? `<span class="pv-cmd">${esc(c.join_commands[0])}</span>`
          : text.trim()
            ? `<span class="pv-hint" data-id="pvHint" style="${css}">${body}</span>`
            : '';
    const pp = (n: string, hue: number) =>
      `<span class="pp" style="--h:${hue}"><i>${n}</i></span>`;
    return `<span class="pv-people"><span class="pv-stack">${pp('PI', 205)}${pp('LU', 120)}${pp('KE', 330)}${pp('MA', 40)}${pp('NO', 280)}</span><span class="pv-pc">${ic('users')}<b>12</b></span></span>${hint}`;
  }
  /** Titles as Core composes them for the overlay and the extension (never recomputed here). */
  const titleOf = (kind: 'normal' | 'giveaway', state: TitleState) =>
    (status?.titles?.[kind]?.[state] ?? []).join(' ').trim();
  function labelsCard(c: RaffleConfig) {
    const l = c.labels;
    const kind = c.amount_mode === 'giveaway' ? 'giveaway' : 'normal';
    const name = status?.titles?.[kind]?.name ?? 'Tombola';
    const quick: [string | null, string, 'f' | 'm'][] = [
      [null, 'Automatique', 'f'],
      ['Tombola', 'Tombola', 'f'],
      ['Giveaway', 'Giveaway', 'm'],
      ['Tirage', 'Tirage', 'm'],
      ['Concours', 'Concours', 'm'],
    ];
    return `<div class="card c12"><h3>${ic('eye')}Overlay · nom et textes<span class="r">affichage sur le stream uniquement</span></h3>
      <div class="inline" style="gap:14px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="margin:0"><span>Nom affiché</span><input class="input" data-label="event_name" maxlength="16" style="width:190px;font-family:var(--t-font)" placeholder="Automatique (${kind === 'giveaway' ? 'Giveaway' : 'Tombola'})" value="${esc(l.event_name ?? '')}"></label>
        <span class="chips">${quick.map(([v, t, g]) => `<button type="button" class="chip ${(l.event_name ?? null) === v ? 'on' : ''}" data-lname="${v ?? ''}" data-lgender-set="${g}">${t}</button>`).join('')}</span>
        ${l.event_name ? `<label class="field" style="margin:0"><span>Accord</span><span class="seg"><button type="button" class="${l.event_gender === 'm' ? 'on' : ''}" data-lgender="m">Masculin · terminé</button><button type="button" class="${l.event_gender === 'f' ? 'on' : ''}" data-lgender="f">Féminin · terminée</button></span></label>` : ''}
      </div>
      <p class="fine" style="margin:8px 0 0" data-id="labelsPv">Sur l’overlay : <b>${esc(titleOf(kind, 'open'))}</b> · <b>${esc(titleOf(kind, 'paused'))}</b> · <b>${esc(titleOf(kind, 'ended'))}</b> · <b>${esc(titleOf(kind, 'cancelled'))}</b> · Extension au repos : <b>${esc(status?.titles?.idle ?? '')}</b>.</p>
      <div class="inline" style="gap:14px;flex-wrap:wrap;margin-top:12px">
        <label class="field" style="margin:0"><span>Titre si aucun participant</span><input class="input" data-label="empty_title" maxlength="28" style="width:240px;font-family:var(--t-font)" placeholder="${esc(l.empty_title ? `${name} …` : titleOf(kind, 'ended'))}" value="${esc(l.empty_title ?? '')}"></label>
        <label class="field" style="margin:0"><span>Message si aucun participant</span><input class="input" data-label="empty_message" maxlength="40" style="width:320px;font-family:var(--t-font)" value="${esc(l.empty_message)}"></label>
      </div>
      <p class="fine" style="margin:8px 0 0">Vide = texte automatique. Le même pour tous les viewers.</p></div>`;
  }
  /** Style of the custom message: a few clean choices (font, colour, bold, italic, highlight, emoji). */
  function hintStyleBar(c: RaffleConfig) {
    const st = c.overlay_hint.style;
    const sw = (
      k: 'color' | 'highlight',
      v: string | null,
      label: string,
      look: string,
    ) =>
      `<button type="button" class="hs-sw ${st[k] === v ? 'on' : ''}" data-hstyle="${k}:${v ?? ''}" title="${label}" style="${look}"></button>`;
    return `<div class="hs-bar">
      <span class="hs-grp"><span class="hs-lbl">Police</span><span class="seg">${(
        [
          ['segoe', 'Standard'],
          ['bahnschrift', 'Condensée'],
          ['trebuchet', 'Arrondie'],
          ['georgia', 'Serif'],
        ] as const
      )
        .map(
          ([k, l]) =>
            `<button type="button" class="${st.font === k ? 'on' : ''}" data-hstyle="font:${k}" style="font-family:${HINT_FONTS[k]}">${l}</button>`,
        )
        .join('')}</span></span>
      <span class="hs-grp"><span class="hs-lbl">Texte</span>${HINT_COLORS.map(([v, l]) => sw('color', v, l, `background:${v ?? '#93a0b2'}`)).join('')}<input type="color" class="hs-pick" data-hcolor value="${st.color ?? '#93a0b2'}" title="Autre couleur">
        <button type="button" class="hs-tg ${st.bold ? 'on' : ''}" data-hstyle="bold" title="Gras"><b>G</b></button><button type="button" class="hs-tg ${st.italic ? 'on' : ''}" data-hstyle="italic" title="Italique"><i>I</i></button></span>
      <span class="hs-grp"><span class="hs-lbl">Surlignage</span>${HINT_HIGHLIGHTS.map(([v, l]) => sw('highlight', v, l, v ? `background:${v}` : 'background:none;border-style:dashed')).join('')}</span>
      <span class="hs-grp"><span class="hs-lbl">Emoji</span>${HINT_EMOJIS.map((e) => `<button type="button" class="hs-emo" data-emoji="${e}">${e}</button>`).join('')}</span>
    </div>`;
  }
  /** Number of lines the custom text takes on the overlay (13 px × 1.3 line height). */
  function paintHintLines() {
    const el = root.querySelector<HTMLElement>('[data-id="hintLines"]');
    if (!el) return;
    const hint = root.querySelector<HTMLElement>('[data-id="pvHint"]');
    const n = hint
      ? Math.round(hint.getBoundingClientRect().height / (13 * 1.3))
      : 0;
    el.textContent = n ? `${n} ligne${n > 1 ? 's' : ''} sur l’overlay.` : '';
  }
  function schedulerCard(c: RaffleConfig) {
    const s = status!.scheduler;
    const custom = c.scheduler.preset === 'custom';
    const { line, btn } = schedState();
    return `<div class="card c12"><h3>${ic('bolt')}Tombola automatique<span class="r">liée au stream · une seule Tombola à la fois</span></h3>
      <div class="tog"><div class="txt"><b>Lancer des Tombolas automatiquement pendant le stream</b><span class="fine" style="display:block;margin-top:4px" data-id="schedLine">${line}</span></div>
        <span data-id="schedBtn">${btn}</span>
        <button type="button" class="sw ${c.scheduler.enabled ? 'on' : ''}" data-tog="scheduler.enabled"></button></div>
      <div class="field"><span>Fréquence</span><div class="seg">${PRESETS.map(([k, l]) => `<button type="button" class="${c.scheduler.preset === k ? 'on' : ''}" data-preset="${k}">${l}</button>`).join('')}</div></div>
      <p class="fine" style="margin:8px 0 0">${custom ? '' : `Premier lancement après ${Math.round(s.timing.first_delay_s / 60)} min, puis toutes les ${Math.round(s.timing.min_s / 60)}–${Math.round(s.timing.max_s / 60)} min (compté depuis la fin de la Tombola précédente).`}</p>
      ${
        custom
          ? `<div class="inline" style="margin-top:10px;gap:14px"><label class="field" style="margin:0"><span>Premier délai (min)</span><input class="input" style="width:90px" data-sched-min="first_delay_s" value="${Math.round(c.scheduler.first_delay_s / 60)}"></label>
        <label class="field" style="margin:0"><span>Intervalle</span><span class="seg"><button type="button" class="${c.scheduler.mode === 'fixed' ? 'on' : ''}" data-sched-mode="fixed">Fixe</button><button type="button" class="${c.scheduler.mode === 'random' ? 'on' : ''}" data-sched-mode="random">Aléatoire</button></span></label>
        ${c.scheduler.mode === 'fixed' ? `<label class="field" style="margin:0"><span>Toutes les (min)</span><input class="input" style="width:90px" data-sched-min="interval_s" value="${Math.round(c.scheduler.interval_s / 60)}"></label>` : `<label class="field" style="margin:0"><span>Entre (min)</span><input class="input" style="width:80px" data-sched-min="interval_min_s" value="${Math.round(c.scheduler.interval_min_s / 60)}"></label><label class="field" style="margin:0"><span>et (min)</span><input class="input" style="width:80px" data-sched-min="interval_max_s" value="${Math.round(c.scheduler.interval_max_s / 60)}"></label>`}</div>`
          : ''
      }
      <div class="inline stream-state" style="margin-top:12px" data-id="streamLine">${streamLine()}</div></div>`;
  }
  function displayCard(c: RaffleConfig) {
    const d = c.display;
    const f = (k: keyof RaffleConfig['display'], label: string, unit = 's') =>
      `<label class="field" style="margin:0"><span>${label}</span><span class="inline"><input class="input" style="width:80px" data-display="${k}" value="${k === 'join_feedback_ms' ? (d[k] / 1000).toFixed(1) : d[k]}"><span class="muted">${unit}</span></span></label>`;
    return `<div class="card c12"><h3>${ic('eye')}Affichage overlay · durées<span class="r">durées visibles uniquement (les micro-animations restent celles de la DA)</span></h3>
      <div class="inline" style="gap:14px;align-items:flex-end">${f('intro_s', 'Annonce d’ouverture')}${f('drawing_s', 'Tirage en cours')}${f('join_feedback_ms', 'Feedback inscription')}${f('result_normal_s', 'Résultat normal')}${f('result_super_s', 'Résultat SUPER')}${f('result_full_s', 'Résultat FULL')}${f('result_giveaway_s', 'Résultat Giveaway')}${f('cancelled_s', 'Tombola annulée')}${f('extension_idle_return_s', 'Retour accueil Extension')}</div></div>
      <div class="card c12"><h3>${ic('ext')}Résultat dans l’Extension<span class="r">anti-spoil · commun à tous les viewers</span></h3>
        <label class="field" style="margin:0"><span>Décalage résultat Extension après le stream</span><span class="inline"><input class="input" style="width:80px" data-display="stream_margin_s" data-id="extDelay" value="${d.stream_margin_s}"><span class="muted">secondes</span></span></label>
        <p class="fine" style="margin:10px 0 0">L’Extension affiche le résultat ce nombre de secondes après la fin de son animation sur le stream (le stream a du retard sur la réalité) : jamais avant. 0 à 60 s, enregistré dans Core, appliqué aux prochaines Tombolas. Calibrage côte à côte overlay / Extension en phase F.</p></div>`;
  }
  /** Ingestion switch: its state, and the exact reason when it cannot be turned on. */
  function ingressBox() {
    const ing = ingress;
    if (!ing)
      return '<p class="fine">État de l’ingestion indisponible (Studio ne répond pas).</p>';
    const locked = !!ing.blocked && !ing.enabled;
    const state = ing.running
      ? '<b style="color:var(--t-ok)">Connectée.</b>'
      : ing.enabled
        ? '<b style="color:#ffbf6e">Activée, pas connectée.</b>'
        : 'Désactivée.';
    return `<div class="tog"><div class="txt"><b>Ingestion chat Twitch réelle</b><span class="fine" style="display:block;margin-top:4px">Une seule connexion Twitch pour tout le Lab : Core route chaque commande vers le module concerné (Tombola aujourd’hui ; TTS, commandes globales… ensuite) et suit l’état du stream (hors ligne → en direct). Rien n’est écrit dans le chat. Jamais activée automatiquement. ${state}${ing.token_login ? ` Compte : ${esc(ing.token_login)}.` : ''}</span></div>
        <button type="button" class="sw ${ing.enabled ? 'on' : ''}" data-ingest="${ing.enabled ? 'off' : 'on'}" ${locked ? 'disabled title="Activation impossible : voir la raison ci-dessous"' : ''}></button></div>
      ${ing.blocked ? `<p class="blocked">${ic('lock')}<span>${esc(ing.blocked.message)}</span></p>` : ''}
      ${ing.lines.length ? `<pre class="log">${esc(ing.lines.slice(-4).join('\n'))}</pre>` : ''}`;
  }
  function chatCard() {
    return `<div class="card c12"><h3>${ic('chat')}Chat & Twitch<span class="r">Lab · commun à tous les modules</span></h3>
      <div data-id="ingressBox">${ingressBox()}</div>
      <div class="field"><span>Simulateur de chat (Lab) — même entrée Core que le vrai chat</span>
        <div class="inline"><select class="input" data-id="simWho" style="font-family:var(--t-font)">${identities.map((i) => `<option value="${esc(i.id)}">${esc(i.label)}</option>`).join('')}</select>
          <select class="input" data-id="simRole" style="font-family:var(--t-font)"><option value="viewer">Viewer</option><option value="moderator">Modérateur</option></select>
          <input class="input" data-id="simText" style="width:200px;font-family:var(--t-font)" value="${esc(cfg?.join_commands[0] ?? '!join')}">
          <button class="t-btn" type="button" data-act="sim">${ic('chat')}Envoyer</button><span class="fine" data-id="simOut">${esc(simOutcome)}</span></div></div></div>`;
  }
  /** Client check before sending (Core checks again): format, duplicate, the other list. */
  function cmdProblem(
    c: RaffleConfig,
    list: CmdList,
    value: string,
    skip = -1,
  ) {
    if (!CMD_RE.test(value))
      return 'Une commande = « ! » suivi de 1 à 24 lettres, chiffres ou « _ » (sans espace).';
    if (c[list].some((x, i) => i !== skip && x === value))
      return `${value} est déjà dans cette liste.`;
    const other: CmdList =
      list === 'join_commands' ? 'cancel_commands' : 'join_commands';
    if (c[other].includes(value))
      return `${value} est déjà une commande ${list === 'join_commands' ? 'd’annulation' : 'd’inscription'} : une commande ne peut pas faire les deux.`;
    if (skip < 0 && c[list].length >= 12) return '12 commandes maximum.';
    return '';
  }
  /** Main command (first) + its aliases: edit, add, delete, set as main. */
  function cmdEditor(c: RaffleConfig, list: CmdList) {
    const items = c[list];
    const row = (cmd: string, i: number) =>
      editing?.list === list && editing.i === i
        ? `<div class="cmd-row"><input class="input" data-cmd-edit-in="${list}:${i}" value="${esc(cmd)}" maxlength="25" style="width:140px"><button class="cmd-btn" type="button" data-cmd-save="${list}:${i}">${ic('check')}OK</button><button class="cmd-btn" type="button" data-cmd-cancel>Annuler</button></div>`
        : `<div class="cmd-row"><span class="alias ${i === 0 ? 'main' : ''}">${esc(cmd)}</span><span class="cmd-tag">${i === 0 ? 'principale' : 'alias'}</span><span class="cmd-acts">${i > 0 ? `<button class="cmd-btn" type="button" data-cmd-main="${list}:${i}" title="Définir comme commande principale">${ic('star')}</button>` : ''}<button class="cmd-btn" type="button" data-cmd-edit="${list}:${i}" title="Modifier">${ic('edit')}</button>${items.length > 1 ? `<button class="cmd-btn" type="button" data-cmd-del="${list}:${i}" title="Supprimer">${ic('x')}</button>` : ''}</span></div>`;
    return `<div class="cmds">${items.map(row).join('')}</div>
      ${items.length < 12 ? `<div class="inline" style="margin-top:10px"><input class="input" data-cmd-add-in="${list}" placeholder="${list === 'join_commands' ? '!alias' : '!commande'}" maxlength="25" style="width:130px"><button class="t-btn t-btn--ghost" type="button" data-cmd-add="${list}" style="height:36px">${ic('plus')}Ajouter</button></div>` : '<p class="fine">12 commandes maximum.</p>'}
      <p class="cmd-err" data-id="cmdErr-${list}" ${cmdErr[list] ? '' : 'hidden'}>${esc(cmdErr[list])}</p>`;
  }
  /** Folded sections: the main ones open, the advanced ones closed (remembered on this computer). */
  const SEC_KEY = 'raptoru.studio.tombola.sections';
  const secOpen = new Set<string>(['join', 'auto']);
  try {
    const saved = JSON.parse(localStorage.getItem(SEC_KEY) ?? 'null') as
      string[] | null;
    if (Array.isArray(saved)) {
      secOpen.clear();
      saved.forEach((k) => secOpen.add(k));
    }
  } catch {
    /* defaults */
  }
  function section(
    key: string,
    icon: string,
    title: string,
    hint: string,
    sum: string,
    body: string,
    fold = true,
  ) {
    const head = `<span class="tsec__t">${ic(icon)}${title}</span><span class="tsec__h">${hint}</span>${sum ? `<span class="tsec__sum">${sum}</span>` : ''}`;
    return fold
      ? `<details class="tsec" data-sec="${key}" ${secOpen.has(key) ? 'open' : ''}><summary>${head}<span class="tsec__chev">${ic('chevR')}</span></summary><div class="grid">${body}</div></details>`
      : `<section class="tsec tsec--fixed" data-sec="${key}"><div class="tsec__head">${head}</div><div class="grid">${body}</div></section>`;
  }
  root.addEventListener(
    'error',
    (ev) => {
      const t = ev.target as HTMLElement;
      if (t instanceof HTMLImageElement && t.dataset.pp !== undefined)
        t.remove();
    },
    true,
  );
  root.addEventListener(
    'toggle',
    (ev) => {
      const d = ev.target as HTMLElement;
      if (!(d instanceof HTMLDetailsElement) || !d.dataset.sec) return;
      if (d.open) secOpen.add(d.dataset.sec);
      else secOpen.delete(d.dataset.sec);
      try {
        localStorage.setItem(SEC_KEY, JSON.stringify([...secOpen]));
      } catch {
        /* in memory only */
      }
    },
    true,
  );
  function renderSetup() {
    const el = $('v-setup');
    if (!status || !cfg) {
      el.innerHTML =
        '<div class="card"><p class="muted">Core local indisponible.</p></div>';
      return;
    }
    const c = cfg;
    const focus = (document.activeElement as HTMLElement | null)?.dataset;
    const soundsN = (['normal', 'super', 'giveaway'] as const).filter(
      (k) => c.launch_sounds[k],
    ).length;
    const kindNow = c.amount_mode === 'giveaway' ? 'giveaway' : 'normal';
    el.innerHTML = `<div class="quick"><div style="flex:1"><h2>Lancement rapide</h2><div class="sum">${summary(c)}</div></div>
        <button class="t-btn t-btn--gold" type="button" data-launch="super">${ic('star')}Super Tombola</button>
        <button class="t-btn t-btn--primary" type="button" data-launch="auto">${ic('play')}Lancer la Tombola</button></div>
      ${section(
        'launch',
        'play',
        'Lancement',
        'récompense, durée, gagnants',
        '',
        `
        <div class="card c12"><h3>${ic('coin')}Récompense<span class="r">toute monnaie enregistrée dans Raptoru</span></h3>
          <div class="seg">${[
            ['random', 'dice', 'Aléatoire'],
            ['fixed', 'coin', 'Montant fixe'],
            ['giveaway', 'gift', 'Giveaway'],
          ]
            .map(
              ([k, i, l]) =>
                `<button type="button" class="${c.amount_mode === k ? 'on' : ''}" data-mode="${k}">${ic(i!)}${l}</button>`,
            )
            .join('')}</div>
          ${c.amount_mode === 'giveaway' ? '' : `<div class="field"><span>Monnaie</span>${curCarousel(c)}</div>`}
          ${modeBody(c)}</div>
        <div class="card c6"><h3>${ic('clock')}Durée</h3><div class="chips">${[30, 45, 60, 90, 120].map((v) => `<button type="button" class="chip ${c.duration_s === v ? 'on' : ''}" data-dur="${v}">${v} s</button>`).join('')}
          <span class="inline"><input class="input" style="width:70px" data-cfg="duration_s" value="${[30, 45, 60, 90, 120].includes(c.duration_s) ? '' : c.duration_s}" placeholder="Autre…"><span class="muted">s</span></span></div>
          <p class="fine" style="margin:10px 0 0">Par défaut 60 s. Fermeture puis tirage automatiques à 0.</p></div>
        <div class="card c6"><h3>${ic('users')}Gagnants</h3><div class="seg"><button type="button" class="${c.winners_mode === 'auto' ? 'on' : ''}" data-win="auto">Auto</button><button type="button" class="${c.winners_mode === 'custom' ? 'on' : ''}" data-win="custom">Nombre fixe</button></div>
          ${c.winners_mode === 'auto' ? `<table class="wtable">${status.winners_table.map((r) => `<tr><td>${r.participants} participants</td><td>${r.min === r.max ? r.min : `${r.min}–${r.max}`} gagnant${r.max > 1 ? 's' : ''}</td></tr>`).join('')}</table>` : `<div class="field"><span>Nombre de gagnants</span><input class="input" style="width:90px" data-cfg="winners_custom" value="${c.winners_custom}"></div>`}
          <p class="fine" style="margin:8px 0 0">Gains partagés aussi équitablement que possible (au jeton près).</p></div>
      `,
        false,
      )}
      ${section(
        'join',
        'chat',
        'Participation',
        'commandes chat, Extension, instruction sur l’overlay',
        `${esc(c.join_commands.join(' '))} · Extension ${c.extension_button ? 'oui' : 'non'} · annulation ${esc(c.cancel_commands[0] ?? '')}`,
        `
        <div class="card c6"><h3>${ic('chat')}Inscription</h3>
          ${cmdEditor(c, 'join_commands')}
          <div class="tog" style="margin-top:14px"><div class="txt"><b>Bouton Extension</b><span class="fine">Inscription en un clic depuis l’extension</span></div><button type="button" class="sw ${c.extension_button ? 'on' : ''}" data-tog="extension_button"></button></div>
          <p class="fine" style="margin:10px 0 0">Une seule inscription par viewer, quelle que soit la source.</p></div>
        <div class="card c6"><h3>${ic('x')}Commande d’annulation<span class="r">modérateur et plus</span></h3>
          ${cmdEditor(c, 'cancel_commands')}
          <p class="fine" style="margin:10px 0 0">Core vérifie le rôle : un viewer ne peut jamais annuler.</p></div>
        <div class="card c12"><h3>${ic('eye')}Overlay · texte d’instruction<span class="r">affichage sur le stream uniquement · ne change pas les commandes d’inscription</span></h3>
          <div class="inline" style="gap:14px;flex-wrap:wrap"><div class="seg">${[
            ['none', 'Masqué'],
            ['join', c.join_commands[0]!],
            ['custom', 'Message personnalisé'],
          ]
            .map(
              ([k, l]) =>
                `<button type="button" class="${c.overlay_hint.mode === k ? 'on' : ''}" data-hint="${k}">${l}</button>`,
            )
            .join('')}</div>
            ${c.overlay_hint.mode === 'custom' ? `<span class="hint-in"><input class="input" data-cfg="overlay_hint.text" data-id="hintIn" maxlength="60" style="flex:1;min-width:260px;font-family:var(--t-font)" placeholder="Texte affiché sur l’overlay" value="${esc(c.overlay_hint.text)}"><span class="fine t-num" data-id="hintCount">${c.overlay_hint.text.length}/60</span></span>` : ''}</div>
          ${c.overlay_hint.mode === 'custom' ? hintStyleBar(c) : ''}
          <p class="fine" style="margin:8px 0 0">${c.overlay_hint.mode === 'custom' ? 'Message personnalisé, 60 caractères max (vide = aucune instruction affichée).' : c.overlay_hint.mode === 'join' ? `Affiche la commande principale « ${esc(c.join_commands[0])} ».` : 'Aucune instruction sur l’overlay.'} Visible sous le bloc Tombola de l’overlay (et dans l’aperçu « En direct »).</p>
          <div class="hintpv-wrap"><div class="pv-c4" data-id="hintPv">${hintPreview(c)}</div>
            <div class="fine">Aperçu fidèle de la zone d’instruction du bloc C4 de l’overlay : même police, même taille, même largeur (taille réelle, 1:1 sur un stream 1080p), même retour à la ligne. <b data-id="hintLines"></b></div></div></div>
      `,
      )}
      ${section('auto', 'bolt', 'Automatisation', 'liée au stream · une seule Tombola à la fois', c.scheduler.enabled ? `Activée · ${esc(PRESETS.find((p) => p[0] === c.scheduler.preset)?.[1] ?? '')}` : 'Désactivée', schedulerCard(c))}
      ${section('display', 'eye', 'Affichage', 'nom, textes, durées, résultat Extension', `Nom : ${esc(status.titles?.[kindNow]?.name ?? 'Tombola')} · décalage Extension ${c.display.stream_margin_s} s`, `${labelsCard(c)}${displayCard(c)}`)}
      ${section(
        'effects',
        'star',
        'SUPER & FULL OSEILLE',
        'probabilités et jackpots',
        `SUPER ${c.super.enabled ? `1 sur ${fmt(c.super.one_in)}` : 'désactivée'} · FULL ${c.full.enabled ? `${c.full.chance_pct} %` : 'désactivée'}`,
        `
        <div class="card c6"><h3>${ic('crown')}Full oseille</h3>
          <div class="tog"><div class="txt"><b><span class="t-full">Full oseille</span></b><span class="fine" style="display:block;margin-top:6px">Un seul gagnant rafle toute la cagnotte. Jamais annoncée à l’ouverture.</span></div><button type="button" class="sw gold ${c.full.enabled ? 'on' : ''}" data-tog="full.enabled"></button></div>
          <div class="field"><span>Chance à chaque Tombola</span><div class="inline"><input class="input" style="width:80px" data-cfg="full.chance_pct" value="${c.full.chance_pct}"><span class="muted">%</span></div></div></div>
        <div class="card c6" style="border-color:rgba(233,196,106,0.35)"><h3 style="color:var(--t-gold)">${ic('star')}Super Tombola</h3>
          <div class="tog"><div class="txt"><b><span class="t-super">Super</span></b><span class="fine" style="display:block;margin-top:6px">Très rare, jackpot dédié, mise en scène or.</span></div><button type="button" class="sw gold ${c.super.enabled ? 'on' : ''}" data-tog="super.enabled"></button></div>
          <div class="inline" style="margin-top:12px;gap:14px"><label class="field" style="margin:0"><span>Jackpot</span><input class="input" style="width:130px;color:var(--t-gold)" data-cfg="super.jackpot" value="${c.super.jackpot}"></label>
            <label class="field" style="margin:0"><span>Chance</span><span class="inline"><span class="muted">1 sur</span><input class="input" style="width:80px" data-cfg="super.one_in" value="${c.super.one_in}"></span></label>
            <label class="field" style="margin:0"><span>Monnaie</span><select class="input" data-cfg="super.currency_id" style="font-family:var(--t-font)">${status.currencies
              .filter((k) => k.available)
              .map(
                (k) =>
                  `<option value="${esc(k.id)}" ${k.id === c.super.currency_id ? 'selected' : ''}>${esc(k.label)}</option>`,
              )
              .join('')}</select></label></div></div>
      `,
      )}
      ${section(
        'sounds',
        'sound',
        'Sons d’ouverture',
        'joués par la source OBS Tombola · stockés dans Studio',
        soundsN
          ? `${soundsN} son${soundsN > 1 ? 's' : ''} importé${soundsN > 1 ? 's' : ''}`
          : 'Aucun son',
        `
        <div class="card c12"><h3>${ic('sound')}Sons d’ouverture<span class="r">joués par la source OBS Tombola · copiés dans le stockage Raptoru Studio</span></h3>
          ${soundRow('normal', 'Tombola', 'Aucun son')}${soundRow('super', 'Super Tombola', 'Aucun son (son de la Tombola)')}${soundRow('giveaway', 'Giveaway', 'Aucun son (son de la Tombola)')}
          <p class="fine" style="margin:10px 0 0">MP3, WAV ou OGG · 5 Mo max. FULL OSEILLE n’a jamais de son d’ouverture : elle reste une surprise jusqu’au tirage.</p>
          <p class="note-f">${ic('sound')}<span>Au lancement, le son est joué une seule fois par la source OBS Tombola (jamais rejoué après un rechargement), pas par Studio : l’aperçu « En direct » est muet. « Écouter » n’est qu’un aperçu local.</span></p></div>
      `,
      )}
      ${section('chat', 'chat', 'Chat & Twitch (Lab)', 'ingestion réelle et simulateur · commun à tous les modules', '', chatCard())}`;
    $('cancelCmd').textContent = c.cancel_commands[0] ?? '!annuletombola';
    if (focus?.cfg)
      root.querySelector<HTMLElement>(`[data-cfg="${focus.cfg}"]`)?.focus();
    if (editing)
      root
        .querySelector<HTMLInputElement>(
          `[data-cmd-edit-in="${editing.list}:${editing.i}"]`,
        )
        ?.focus();
    schedSig = streamSig = ingressSig = '';
    renderStatusParts();
    paintHintLines();
  }
  /** Parts driven by Core's live state (scheduler, stream, chat ingress): refreshed on every read. */
  let schedSig = '';
  let streamSig = '';
  let ingressSig = '';
  function renderStatusParts() {
    if (!status) return;
    const s = status.scheduler;
    const sig1 = JSON.stringify([
      s.phase,
      s.can_pause,
      s.can_resume,
      s.next_at,
      s.phase === 'paused' ? s.remaining_ms : 0,
      s.last_skip_reason,
    ]);
    const line = root.querySelector('[data-id="schedLine"]');
    if (line && sig1 !== schedSig) {
      schedSig = sig1;
      const st = schedState();
      line.innerHTML = st.line;
      $('schedBtn').innerHTML = st.btn;
    }
    const sig2 = JSON.stringify(status.stream);
    const sl = root.querySelector('[data-id="streamLine"]');
    if (sl && sig2 !== streamSig) {
      streamSig = sig2;
      sl.innerHTML = streamLine();
    }
    const sig3 = JSON.stringify(ingress);
    const ib = root.querySelector('[data-id="ingressBox"]');
    if (ib && sig3 !== ingressSig) {
      ingressSig = sig3;
      ib.innerHTML = ingressBox();
    }
  }

  // --- En direct -----------------------------------------------------------------------------------
  /** « Giveaway ouvert », « Tombola en pause »…: the round's own name and agreement (Core). */
  const roundTitle = (r: Round, s: TitleState) =>
    (r.titles?.[s] ?? []).join(' ').trim();
  const phaseText = (r: Round, left: number) =>
    r.status === 'opening' || r.status === 'open'
      ? left <= 10_000
        ? 'Dernières secondes'
        : roundTitle(r, 'open') || 'Ouverte'
      : r.status === 'paused'
        ? roundTitle(r, 'paused') || 'En pause'
        : r.status === 'drawing'
          ? 'Tirage en cours'
          : r.status === 'revealing'
            ? 'Révélation sur le stream'
            : r.status === 'cancelled'
              ? `${roundTitle(r, 'cancelled') || 'Annulée'} · personne n’est payé`
              : `${doneText(r)}${r.outcome === 'no_participants' ? ' · Aucun participant' : ''}`;
  /** « Giveaway terminé » / « Tombola terminée » (« ended » may be the custom « no participant » text). */
  const doneText = (r: Round) =>
    r.titles
      ? `${r.titles.name} ${r.titles.cancelled[1].endsWith('ée') ? 'terminée' : 'terminé'}`
      : 'Terminée';
  let headSig = '';
  let bodySig = '';
  /** Remaining time of the round, from Core's value at the last read. */
  const leftMs = () =>
    round
      ? // Core's closes_at includes the opening announcement: never show more than the round length.
        Math.min(
          round.duration_ms,
          Math.max(
            0,
            round.remaining_ms -
              (round.status === 'paused' ? 0 : Date.now() - snapAt),
          ),
        )
      : 0;
  /** Between two Core reads only the seconds and the ring move (no rebuild, no lost click). */
  function tickHead() {
    if (!round || !['opening', 'open', 'paused'].includes(round.status)) return;
    const left = leftMs();
    const sec = root.querySelector('[data-id="liveSec"]');
    if (sec) sec.textContent = String(Math.ceil(left / 1000));
    const fg = root.querySelector<SVGCircleElement>('[data-id="liveFg"]');
    if (fg)
      fg.style.strokeDashoffset = String(
        2 * Math.PI * 40 * (1 - left / Math.max(1, round.duration_ms)),
      );
    root
      .querySelector('.live-head')
      ?.classList.toggle('is-hot', left <= 10_000);
  }
  function renderLiveHead(force = false) {
    const sig = JSON.stringify([
      round?.raffle_id,
      round?.status,
      round?.participants,
      round?.amount,
      round?.reveal?.is_full,
      round?.outcome,
      card?.winners.length,
      status?.scheduler.state,
      Math.ceil(leftMs() / 1000) <= 10,
    ]);
    if (!force && sig === headSig) return tickHead();
    headSig = sig;
    const main = $('liveMain');
    const grid = $('liveGrid');
    $('liveDot').hidden = !round || !RUNNING.includes(round.status);
    if (!round) {
      grid.style.display = 'none';
      const s = status?.scheduler;
      main.innerHTML = `<div class="card" style="text-align:center;padding:40px"><p class="muted" style="margin:0 0 14px">Aucune Tombola en cours.${s?.phase === 'running' && s.remaining_ms !== null ? ` Prochaine Tombola automatique dans <b data-id="schedLeft2">${duration(s.remaining_ms)}</b>.` : ''}</p><button class="t-btn t-btn--primary" type="button" data-launch="auto">${ic('play')}Lancer la Tombola</button></div>`;
      $('liveHist').innerHTML = historyTable(3);
      return;
    }
    grid.style.display = '';
    $('liveHist').innerHTML = '';
    const r = round;
    const left = leftMs();
    const R = 40;
    const C = 2 * Math.PI * R;
    const isSuper = r.kind === 'super';
    const before = ['opening', 'open', 'paused'].includes(r.status);
    const done =
      r.status === 'revealed' ||
      r.status === 'finished' ||
      r.status === 'cancelled';
    const shown = Math.ceil(left / 1000);
    const k = card?.winners.length ?? 0;
    const full = r.reveal?.is_full ?? card?.is_full ?? false;
    main.innerHTML = `<div class="live-head ${isSuper ? 'is-super' : ''} ${before && left <= 10_000 ? 'is-hot' : ''}">
        <div class="ring"><svg class="t-ring" viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="${R}"/><circle class="fg" data-id="liveFg" cx="46" cy="46" r="${R}" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - (before ? left / Math.max(1, r.duration_ms) : r.status === 'cancelled' ? 1 : 0))}${r.status === 'cancelled' ? ';stroke:#ff6b6b' : isSuper ? ';stroke:var(--t-gold)' : ''}"/></svg><b data-id="liveSec" style="${r.status === 'cancelled' ? 'color:#ff6b6b' : ''}">${before ? shown : r.status === 'drawing' || r.status === 'revealing' ? '…' : r.status === 'cancelled' ? '✕' : '✓'}</b></div>
        <div class="st"><span class="status"><span class="d"></span>${phaseText(r, left)}${isSuper ? ' · <span class="t-super" style="font-size:10px">Super</span>' : ''}${full && r.reveal ? ' · <span class="t-full" style="font-size:10px">Full oseille</span>' : ''}${r.origin === 'automatic' ? ' · <span class="t-pill" style="height:20px">Auto</span>' : ''}</span>
          <span class="t-amount amt ${isSuper ? 'is-gold' : ''}">${r.kind === 'giveaway' ? `<span style="font-family:var(--t-font);font-size:28px">${esc(r.prize)}</span>` : `${fmt(r.amount)}<small>${esc(r.currency?.label ?? '')}</small>`}</span>
          <span class="fine">Fermeture et tirage automatiques · overlay synchronisé</span></div>
        <div class="kpi"><b>${r.participants}</b><span>participants</span></div><div class="kpi"><b>${done || r.status === 'drawing' || r.status === 'revealing' ? k : '—'}</b><span>gagnant${k > 1 ? 's' : ''}</span></div>
        <div class="acts">${before ? `<button class="t-btn" type="button" data-act="extend">+30 s</button>${r.status === 'paused' ? `<button class="t-btn" type="button" data-act="resume">Reprendre</button>` : `<button class="t-btn" type="button" data-act="pause">Pause</button>`}<button class="t-btn" type="button" data-act="draw">Tirer maintenant</button><button class="t-btn t-btn--ghost" type="button" data-act="cancel">Annuler</button>` : done ? `<button class="t-btn t-btn--primary" type="button" data-launch="auto">${ic('play')}Nouvelle</button>` : ''}</div></div>`;
  }
  function renderLiveBody(force = false) {
    if (!round) return;
    const sig = JSON.stringify([
      round.raffle_id,
      round.status,
      card?.entries.map((e) => [e.viewer_id, e.removed_at]),
      card?.winners.map((w) => w.payout_status),
      round.outcome,
      addResults,
    ]);
    if (!force && sig === bodySig) return;
    bodySig = sig;
    const typed =
      root.querySelector<HTMLInputElement>('[data-id="addQ"]')?.value ?? '';
    const entries = (card?.entries ?? []).filter((e) => !e.removed_at);
    const ch = entries.filter((e) => e.source === 'chat').length;
    const ex = entries.filter((e) => e.source === 'extension').length;
    const mn = entries.length - ch - ex;
    const before = ['opening', 'open', 'paused'].includes(round.status);
    const pill = (e: Card['entries'][number]) =>
      e.source === 'extension'
        ? `<span class="t-pill t-pill--ext">${ic('ext')}Extension</span>`
        : e.source === 'manual'
          ? `<span class="t-pill">${ic('plus')}Ajout manuel</span>`
          : `<span class="t-pill t-pill--chat">${ic('chat')}${esc(e.command ?? 'chat')}</span>`;
    const feed = $('liveFeed');
    const scroll = feed.querySelector('.feed')?.scrollTop ?? 0;
    feed.innerHTML = `<h3>${ic('users')}Inscriptions<span class="r">${ch} chat · ${ex} extension${mn ? ` · ${mn} manuel` : ''}</span></h3>
      <div class="srcbar"><i style="width:${entries.length ? (ch / entries.length) * 100 : 0}%;background:var(--t-teal)"></i><i style="width:${entries.length ? (ex / entries.length) * 100 : 0}%;background:var(--t-ext)"></i><i style="width:${entries.length ? (mn / entries.length) * 100 : 0}%;background:#93a0b2"></i></div>
      <div class="feed" style="margin-top:12px">${
        entries
          .slice()
          .reverse()
          .map(
            (e) =>
              `<div class="fr"><span class="t">${hhmmss(e.created_at)}</span>${pp(e.display_name, e.avatar_url, e.source === 'extension')}<span class="n">${esc(e.display_name)}</span>${pill(e)}${before ? `<button class="mini" type="button" title="Retirer de la Tombola" data-remove="${esc(e.viewer_id)}">${ic('x')}</button>` : ''}</div>`,
          )
          .join('') ||
        '<p class="fine">En attente des premières inscriptions…</p>'
      }</div>
      ${
        before
          ? `<div class="add-part"><div class="inline"><input class="input" data-id="addQ" placeholder="Ajouter un viewer (pseudo)…" style="flex:1;font-family:var(--t-font)"><button class="t-btn t-btn--ghost" type="button" data-act="add-search">${ic('plus')}Chercher</button></div>
        <div class="add-res">${addResults.map((v) => `<button class="chip" type="button" data-add-viewer="${esc(v.viewer_id)}" data-name="${esc(v.display_name)}">${esc(v.display_name)}</button>`).join('')}</div></div>`
          : ''
      }`;
    const f = feed.querySelector('.feed');
    if (f) f.scrollTop = scroll;
    const q = root.querySelector<HTMLInputElement>('[data-id="addQ"]');
    if (q) q.value = typed;
    const res = $('liveRes');
    if (
      card &&
      card.winners.length &&
      (round.status === 'revealed' ||
        round.status === 'finished' ||
        round.status === 'revealing')
    ) {
      res.innerHTML = `<div class="card"><h3>${ic('crown')}Résultat<span class="r">${round.kind === 'giveaway' ? 'lot à remettre par le streamer' : 'payé automatiquement par Core'}</span></h3><div class="feed" style="max-height:none">${card.winners
        .map(
          (
            w,
          ) => `<div class="fr">${pp(w.display_name, picOf(card!, w.viewer_id))}<span class="n">${esc(w.display_name)}</span>${round!.kind === 'giveaway' ? '<span class="muted">gagne le lot</span>' : `<b class="t-num" style="color:${round!.kind === 'super' || card!.is_full ? 'var(--t-gold)' : 'var(--t-teal)'}">+ ${fmt(w.expected)} ${esc(w.currency?.short_label ?? '')}</b>`}
            ${w.payout_status === 'paid' ? '<span style="color:var(--t-ok);font-weight:600">✓ Payé</span>' : w.payout_status === 'failed' ? `<span style="color:#ff8a8a;font-weight:600">✗ Échec</span><button class="t-btn t-btn--ghost" type="button" data-retry="${esc(w.viewer_id)}">Relancer le paiement</button>` : w.payout_status === 'none' ? '<span class="muted">à remettre</span>' : '<span class="muted">en cours…</span>'}</div>`,
        )
        .join('')}</div></div>`;
    } else if (round.outcome === 'no_participants')
      res.innerHTML = `<div class="card"><h3>${ic('users')}Aucun participant cette fois !<span class="r">pas de tirage · aucun gagnant · aucun paiement</span></h3><p class="fine" style="margin:0">${esc(round.titles?.name ?? 'Tombola')} sans inscription. Ce n’est pas une annulation : la Tombola automatique planifie la suivante normalement.</p></div>`;
    else res.innerHTML = '';
  }

  // --- Historique + fiche manche ---------------------------------------------------------------------
  function historyTable(limit = 999) {
    const rows = history.slice(0, limit);
    return `<div class="card"><h3>${ic('history')}Historique<span class="r">${history.length} Tombola${history.length > 1 ? 's' : ''}</span></h3><table class="htable"><thead><tr><th>Heure</th><th>Type</th><th>Origine</th><th>Récompense</th><th>Participants</th><th>Gagnants</th><th>Statut</th></tr></thead><tbody>${
      rows
        .map((h) => {
          const tag =
            h.status === 'cancelled'
              ? '<span class="muted">Annulée</span>'
              : h.is_full
                ? '<span class="t-full">Full oseille</span>'
                : h.kind === 'super'
                  ? '<span class="t-super">Super</span>'
                  : h.kind === 'giveaway'
                    ? `<span class="t-pill">${ic('gift')}Giveaway</span>`
                    : '<span class="muted">Normale</span>';
          const statusText =
            h.status === 'cancelled'
              ? '<span class="muted">annulée</span>'
              : h.outcome === 'no_participants'
                ? '<span class="muted">Terminée · Aucun participant</span>'
                : RUNNING.includes(h.status)
                  ? '<span class="muted">en cours</span>'
                  : h.kind === 'giveaway'
                    ? '<span class="muted">à remettre</span>'
                    : h.payouts.failed
                      ? `<span style="color:#ff8a8a">${h.payouts.failed} échec${h.payouts.failed > 1 ? 's' : ''}</span>`
                      : h.winners.length
                        ? '<span class="paid">Payé</span>'
                        : '<span class="muted">aucun gagnant</span>';
          return `<tr data-open-round="${esc(h.raffle_id)}" style="cursor:pointer"><td class="num">${hhmm(h.opened_at)}</td><td>${tag}</td><td>${h.origin === 'automatic' ? 'Auto' : 'Manuelle'}</td>
          <td class="num" style="${h.kind === 'super' || h.is_full ? 'color:var(--t-gold);font-weight:700' : 'font-weight:700'}">${h.kind === 'giveaway' ? `<span style="font-family:var(--t-font)">${esc(h.prize)}</span>` : `${fmt(h.amount)} ${esc(h.currency?.short_label ?? '')}`}</td><td class="num">${h.participants}</td>
          <td>${esc(
            h.winners
              .slice(0, 3)
              .map((w) => w.display_name)
              .join(', '),
          )}${h.winners.length > 3 ? ` <span class="muted">+${h.winners.length - 3}</span>` : ''}</td><td>${statusText}</td></tr>`;
        })
        .join('') ||
      '<tr><td colspan="7" class="fine">Aucune Tombola pour l’instant.</td></tr>'
    }</tbody></table></div>`;
  }
  const STATUS_FR: Record<string, string> = {
    opening: 'Ouverture',
    open: 'Ouverte',
    paused: 'En pause',
    drawing: 'Tirage en cours',
    revealing: 'Révélation',
    revealed: 'Résultat affiché',
    finished: 'Terminée',
    cancelled: 'Annulée',
  };
  const KIND_FR: Record<string, string> = {
    normal: 'Normale',
    super: 'SUPER',
    giveaway: 'Giveaway',
  };
  /** A winner's picture: the one of their entry (Core sends it with the entries). */
  const picOf = (c: Card, viewerId: string) =>
    c.entries.find((e) => e.viewer_id === viewerId)?.avatar_url ?? null;
  function roundCard(c: Card) {
    const t = c.timeline;
    return `<div class="card round-card"><h3>${ic('ticket')}Fiche de la Tombola<span class="r">${esc(c.raffle_id)}</span><button class="mini" type="button" data-close-round title="Fermer">${ic('x')}</button></h3>
      <div class="inline" style="gap:18px"><span><b>${c.outcome === 'no_participants' ? 'Terminée · Aucun participant' : esc(STATUS_FR[c.status] ?? c.status)}</b></span><span>${c.kind === 'giveaway' ? esc(c.prize) : `${fmt(c.amount)} ${esc(c.currency?.label ?? '')}`}</span><span>${esc(KIND_FR[c.kind] ?? c.kind)}${c.is_full ? ' · FULL OSEILLE' : ''}</span><span>${c.origin === 'automatic' ? 'Automatique' : `Manuelle (${esc(c.opened_by)})`}</span><span>${Math.round(c.duration_ms / 1000)} s</span></div>
      <p class="fine">Ouverte ${hhmm(t.opened_at ?? null)} · fermée ${hhmm(t.closed_at ?? null)} · tirage ${hhmm(t.drawn_at ?? null)} · résultat viewers ${hhmm(t.viewer_result_at ?? null)}${c.cancelled_by ? ` · annulée par ${esc(c.cancelled_by)}${c.cancel_reason ? ` (${esc(c.cancel_reason)})` : ''}` : ''}</p>
      <div class="grid"><div class="c6"><h4>Participants (${c.entries.filter((e) => !e.removed_at).length})</h4><div class="feed">${c.entries
        .map(
          (e) =>
            `<div class="fr"><span class="t">${hhmm(e.created_at)}</span>${pp(e.display_name, e.avatar_url, e.source === 'extension')}<span class="n" style="${e.removed_at ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(e.display_name)}</span><span class="fine">${e.source === 'chat' ? esc(e.command ?? 'chat') : e.source === 'manual' ? `ajout ${esc(e.added_by ?? '')}` : 'Extension'}${e.removed_at ? ` · retiré par ${esc(e.removed_by ?? '')}` : ''}</span></div>`,
        )
        .join('')}</div></div>
      <div class="c6"><h4>Gagnants & paiements</h4><div class="feed">${
        c.winners
          .map(
            (w) =>
              `<div class="fr">${pp(w.display_name, picOf(c, w.viewer_id))}<span class="n">${w.position}. ${esc(w.display_name)}</span><span class="t-num">${c.kind === 'giveaway' ? 'lot' : `${fmt(w.expected)} ${esc(w.currency?.short_label ?? '')}`}</span><span class="fine">${w.payout_status === 'paid' ? `✓ payé ${hhmm(w.paid_at)} · mouvement #${w.ledger_id} · ${fmt(w.credited)} crédités` : w.payout_status === 'failed' ? `✗ échec (${esc(w.failure)}) · ${w.attempts} tentative${w.attempts > 1 ? 's' : ''}` : w.payout_status === 'none' ? 'à remettre' : 'en cours'}</span></div>`,
          )
          .join('') || '<p class="fine">Aucun gagnant.</p>'
      }</div></div></div>
      <h4>Historique des actions</h4><div class="feed">${c.audit.map((a) => `<div class="fr"><span class="t">${hhmmss(a.created_at)}</span><span class="n">${esc(a.action)}</span><span class="fine">${esc(a.actor)} (${esc(a.role)})${a.reason ? ` · ${esc(a.reason)}` : ''}</span></div>`).join('')}</div></div>`;
  }
  function renderHistory() {
    $('v-history').innerHTML =
      historyTable() + (openCard ? roundCard(openCard) : '');
  }

  // --- data ---------------------------------------------------------------------------------------------
  let busy = false;
  async function refresh(full = false) {
    if (busy && !full) return;
    busy = true;
    try {
      const [st, snap, ing] = await Promise.all([
        api<Status>('/status'),
        api<{ server_time: string; round: Round | null }>('/snapshot'),
        chatApi<Ingress>('/status').catch(() => null),
      ]);
      ingress = ing;
      const firstConfig = !cfg || full;
      status = st;
      if (firstConfig) cfg = st.config;
      round = snap.round;
      snapAt = Date.now();
      card = round
        ? await api<Card>(`/rounds/${round.raffle_id}`).catch(() => null)
        : null;
      if (view === 'history' || view === 'live' || full)
        history = ((await api<{ items: typeof history }>('/history')).items ??
          []) as typeof history;
      const pv = $<HTMLIFrameElement>('pvf');
      if (pv.dataset.src !== st.preview_url) {
        pv.dataset.src = st.preview_url;
        pv.src = st.preview_url;
      }
      $('obsUrl').textContent = st.overlay_url;
      if (firstConfig || view !== 'setup') renderSetup();
      else renderStatusParts();
      renderLiveHead();
      renderLiveBody();
      if (view === 'history') renderHistory();
    } catch (e) {
      status = null;
      $('v-setup').innerHTML =
        `<div class="card"><p class="muted">${esc(ERRORS[(e as { code?: string }).code ?? ''] ?? 'Core local indisponible : la Tombola revient dès qu’il répond.')}</p></div>`;
    } finally {
      busy = false;
    }
  }
  /** Overlay preview and the real Extension (Lab viewer, Tombola screen) side by side. */
  let comparing = false;
  function toggleCompare() {
    comparing = !comparing;
    const card = $('pvCard');
    card.classList.toggle('c7', !comparing);
    card.classList.toggle('c12', comparing);
    $('cmpExt').hidden = !comparing;
    $('cmpNote').hidden = !comparing;
    $('cmpDelay').textContent = String(cfg?.display.stream_margin_s ?? '');
    const f = $<HTMLIFrameElement>('extf');
    f.src = comparing
      ? '/ext/panel.html?anchor=panel&mode=viewer&platform=web&state=released&language=fr&locale=fr-FR&labRole=viewer&labIdentity=1&demoModule=raffle_join'
      : 'about:blank';
    root
      .querySelector('[data-act="compare"]')!
      .classList.toggle('on', comparing);
    window.setTimeout(scalePreview, 30);
  }
  const scalePreview = () => {
    const pv = $('pv');
    $<HTMLIFrameElement>('pvf').style.transform =
      `scale(${pv.clientWidth / 1920})`;
  };

  // --- events ---------------------------------------------------------------------------------------
  const show = (v: View) => {
    view = v;
    for (const b of root.querySelectorAll<HTMLElement>('.nav [data-view]'))
      b.classList.toggle('on', b.dataset.view === v);
    for (const s of ['setup', 'live', 'history'] as View[])
      $(`v-${s}`).classList.toggle('on', s === v);
    void refresh();
    window.setTimeout(scalePreview, 30);
  };
  const setByPath = (c: RaffleConfig, path: string, value: unknown) => {
    const keys = path.split('.');
    let o = c as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys.at(-1)!] = value;
  };
  const numeric = new Set([
    'random.step',
    'fixed_amount',
    'duration_s',
    'winners_custom',
    'full.chance_pct',
    'super.jackpot',
    'super.one_in',
  ]);
  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const g = <T extends HTMLElement = HTMLElement>(sel: string) =>
      t.closest<T>(sel);
    let b: HTMLElement | null;
    if ((b = g('[data-view]'))) return show(b.dataset.view as View);
    if ((b = g('[data-launch]'))) {
      void act({ action: 'launch', kind: b.dataset.launch }).then(() =>
        show('live'),
      );
      return;
    }
    if ((b = g('[data-act]'))) {
      const a = b.dataset.act;
      if (a === 'extend') void act({ action: 'extend', seconds: 30 });
      if (a === 'pause') void act({ action: 'pause' });
      if (a === 'resume') void act({ action: 'resume' });
      if (a === 'draw') void act({ action: 'draw_now' });
      if (a === 'cancel') $('confirm').hidden = false;
      if (a === 'compare') toggleCompare();
      if (a === 'cancel-no') $('confirm').hidden = true;
      if (a === 'cancel-yes') {
        $('confirm').hidden = true;
        void act({ action: 'cancel', reason: 'annulée depuis Studio' });
      }
      if (a === 'sim') {
        const who = identities.find(
          (i) => i.id === $<HTMLSelectElement>('simWho').value,
        );
        void chatApi<{ handled: { module: string; outcome: string }[] }>(
          '/simulate',
          {
            viewer_id: who?.id,
            display_name: who?.label,
            login: who?.label,
            text: $<HTMLInputElement>('simText').value,
            role: $<HTMLSelectElement>('simRole').value,
          },
        )
          .then((o) => {
            simOutcome = o.handled.length
              ? `→ ${o.handled.map((h) => `${MODULE_FR[h.module] ?? h.module} : ${OUTCOME_FR[h.outcome] ?? ERRORS[h.outcome] ?? h.outcome}`).join(' · ')}`
              : '→ aucun module concerné (message ignoré)';
            $('simOut').textContent = simOutcome;
            void refresh();
          })
          .catch(fail);
      }
      if (a === 'add-search') {
        const q = $<HTMLInputElement>('addQ').value.trim();
        void api<{ viewers: { viewer_id: string; display_name: string }[] }>(
          `/search?q=${encodeURIComponent(q)}`,
        )
          .then((r) => {
            addResults = r.viewers ?? [];
            renderLiveBody(true);
          })
          .catch(fail);
      }
      return;
    }
    if ((b = g('[data-add-viewer]'))) {
      const viewer_id = b.dataset.addViewer!;
      const display_name = b.dataset.name!;
      void api('/actions', {
        command: { action: 'add_participant', viewer_id, display_name },
      })
        .then(() => {
          addResults = [];
          return refresh();
        })
        .catch((e: { code?: string }) => {
          if (
            e.code === 'viewer_blocked' &&
            window.confirm(
              `${display_name} est bloqué de la Tombola. Forcer son inscription ? (action tracée)`,
            )
          )
            void act({
              action: 'add_participant',
              viewer_id,
              display_name,
              force: true,
              reason: 'ajout forcé malgré le blocage',
            });
          else fail(e);
        });
      return;
    }
    if ((b = g('[data-remove]'))) {
      void act({
        action: 'remove_participant',
        viewer_id: b.dataset.remove,
        reason: 'retiré depuis Studio',
      });
      return;
    }
    if ((b = g('[data-retry]')) && round) {
      void act({
        action: 'retry_payout',
        raffle_id: round.raffle_id,
        viewer_id: b.dataset.retry,
      });
      return;
    }
    if ((b = g('[data-open-round]'))) {
      void api<Card>(`/rounds/${b.dataset.openRound}`).then((c) => {
        openCard = c;
        if (view !== 'history') show('history');
        else renderHistory();
      });
      return;
    }
    if (g('[data-close-round]')) {
      openCard = null;
      renderHistory();
      return;
    }
    if ((b = g('[data-ingest]'))) {
      if ((b as HTMLButtonElement).disabled) return;
      void chatApi<Ingress>('/ingress', { enabled: b.dataset.ingest === 'on' })
        .then((r) => {
          ingress = r;
          renderStatusParts();
        })
        .catch((e) => {
          fail(e);
          void refresh();
        });
      return;
    }
    if ((b = g('[data-stream]'))) {
      void act({
        action: b.dataset.stream === 'start' ? 'stream_start' : 'stream_end',
      });
      return;
    }
    if ((b = g('[data-sched]'))) {
      void act({
        action:
          b.dataset.sched === 'pause' ? 'scheduler_pause' : 'scheduler_resume',
      });
      return;
    }
    if ((b = g('[data-sound-play]'))) {
      const slot = b.dataset.soundPlay!;
      const same = preview?.slot === slot;
      stopPreview();
      const s = cfg?.launch_sounds[slot as 'normal'];
      if (s && !same) {
        const a = new Audio(`/raffle-lab/sounds/${s.asset_id}.${s.format}`);
        a.volume = s.volume / 100;
        preview = { audio: a, slot };
        a.addEventListener('ended', () => {
          if (preview?.audio === a) stopPreview();
        });
        void a.play().catch(() => {
          stopPreview();
          toast('Lecture impossible.', true);
        });
      }
      paintPreview();
      return;
    }
    if ((b = g('[data-sound-del]'))) {
      const slot = b.dataset.soundDel as 'normal' | 'super' | 'giveaway';
      patch((c) => (c.launch_sounds[slot] = null));
      return;
    }
    if ((b = g('[data-cur]')))
      return patch((c) => (c.currency_id = b!.dataset.cur!));
    if ((b = g('[data-cur-step]'))) {
      const ok = (status?.currencies ?? []).filter((k) => k.available);
      const i = ok.findIndex((k) => k.id === cfg?.currency_id);
      const next = ok[(i + Number(b.dataset.curStep) + ok.length) % ok.length];
      if (next) patch((c) => (c.currency_id = next.id));
      return;
    }
    if ((b = g('[data-mode]')))
      return patch(
        (c) => (c.amount_mode = b!.dataset.mode as RaffleConfig['amount_mode']),
      );
    if ((b = g('[data-fixed]')))
      return patch((c) => (c.fixed_amount = Number(b!.dataset.fixed)));
    if ((b = g('[data-dur]')))
      return patch((c) => (c.duration_s = Number(b!.dataset.dur)));
    if ((b = g('[data-win]')))
      return patch(
        (c) => (c.winners_mode = b!.dataset.win as 'auto' | 'custom'),
      );
    if ((b = g('[data-lname]'))) {
      const v = b.dataset.lname || null;
      const gender = b.dataset.lgenderSet as 'f' | 'm';
      return patch((c) => {
        c.labels.event_name = v;
        if (v) c.labels.event_gender = gender;
      });
    }
    if ((b = g('[data-lgender]')))
      return patch(
        (c) => (c.labels.event_gender = b!.dataset.lgender as 'f' | 'm'),
      );
    if ((b = g('[data-hstyle]'))) {
      const [k, v] = b.dataset.hstyle!.split(':') as [
        string,
        string | undefined,
      ];
      return patch((c) => {
        const st = c.overlay_hint.style;
        if (k === 'bold' || k === 'italic') st[k] = !st[k];
        else if (k === 'font') st.font = v as typeof st.font;
        else if (k === 'color' || k === 'highlight') st[k] = v || null;
      });
    }
    if ((b = g('[data-emoji]'))) {
      // Inserted at the cursor of the custom message (60 characters max), saved like a typed text.
      const input = root.querySelector<HTMLInputElement>('[data-id="hintIn"]');
      if (input) {
        const at = input.selectionStart ?? input.value.length;
        const next = `${input.value.slice(0, at)}${b.dataset.emoji}${input.value.slice(input.selectionEnd ?? at)}`;
        if (next.length <= 60) {
          input.value = next;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return;
    }
    if ((b = g('[data-hint]')))
      return patch(
        (c) =>
          (c.overlay_hint.mode = b!.dataset.hint as 'none' | 'join' | 'custom'),
      );
    if ((b = g('[data-preset]')))
      return patch(
        (c) =>
          (c.scheduler.preset = b!.dataset
            .preset as RaffleConfig['scheduler']['preset']),
      );
    if ((b = g('[data-sched-mode]')))
      return patch(
        (c) => (c.scheduler.mode = b!.dataset.schedMode as 'fixed' | 'random'),
      );
    if ((b = g('[data-tog]'))) {
      const path = b.dataset.tog!;
      return patch((c) => {
        const keys = path.split('.');
        let o = c as unknown as Record<string, unknown>;
        for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
        o[keys.at(-1)!] = !o[keys.at(-1)!];
      });
    }
    if ((b = g('[data-cmd-edit]'))) {
      const [list, i] = b.dataset.cmdEdit!.split(':') as [CmdList, string];
      editing = { list, i: Number(i) };
      cmdErr[list] = '';
      renderSetup();
      return;
    }
    if (g('[data-cmd-cancel]')) {
      if (editing) cmdErr[editing.list] = '';
      editing = null;
      renderSetup();
      return;
    }
    if ((b = g('[data-cmd-save]'))) return saveEdit(b.dataset.cmdSave!);
    if ((b = g('[data-cmd-add]'))) return addCmd(b.dataset.cmdAdd as CmdList);
    if ((b = g('[data-cmd-main]'))) {
      const [list, i] = b.dataset.cmdMain!.split(':') as [CmdList, string];
      cmdErr[list] = '';
      return patch((c) => {
        const [cmd] = c[list].splice(Number(i), 1);
        c[list].unshift(cmd!);
      });
    }
    if ((b = g('[data-cmd-del]'))) {
      const [list, i] = b.dataset.cmdDel!.split(':') as [CmdList, string];
      cmdErr[list] = '';
      editing = null;
      return patch((c) => {
        if (c[list].length > 1) c[list].splice(Number(i), 1);
      });
    }
  });
  const showCmdErr = (list: CmdList, text: string) => {
    cmdErr[list] = text;
    const el = root.querySelector<HTMLElement>(`[data-id="cmdErr-${list}"]`);
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    }
  };
  function saveEdit(key: string) {
    if (!cfg) return;
    const [list, i] = key.split(':') as [CmdList, string];
    const value = normCmd(
      root.querySelector<HTMLInputElement>(`[data-cmd-edit-in="${key}"]`)
        ?.value ?? '',
    );
    const problem = cmdProblem(cfg, list, value, Number(i));
    if (problem) return showCmdErr(list, problem);
    editing = null;
    cmdErr[list] = '';
    patch((c) => (c[list][Number(i)] = value));
  }
  function addCmd(list: CmdList) {
    if (!cfg) return;
    const input = root.querySelector<HTMLInputElement>(
      `[data-cmd-add-in="${list}"]`,
    );
    if (!input?.value.trim()) return;
    const value = normCmd(input.value);
    const problem = cmdProblem(cfg, list, value);
    if (problem) return showCmdErr(list, problem);
    cmdErr[list] = '';
    patch((c) => c[list].push(value));
  }
  function stopPreview() {
    if (preview) {
      preview.audio.pause();
      preview.audio.src = '';
    }
    preview = null;
    paintPreview();
  }
  /** Play / Stop labels of every sound row, without re-rendering the page. */
  function paintPreview() {
    for (const btn of root.querySelectorAll<HTMLElement>('[data-sound-play]'))
      btn.innerHTML =
        preview?.slot === btn.dataset.soundPlay
          ? `${ic('stop')}Stop`
          : `${ic('play')}Écouter`;
  }
  root.addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (ev.key === 'Enter' && t.dataset.cmdEditIn) {
      ev.preventDefault();
      saveEdit(t.dataset.cmdEditIn);
    } else if (ev.key === 'Escape' && t.dataset.cmdEditIn) {
      editing = null;
      renderSetup();
    } else if (ev.key === 'Enter' && t.dataset.cmdAddIn) {
      ev.preventDefault();
      addCmd(t.dataset.cmdAddIn as CmdList);
    }
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    // Command inputs are saved by their own buttons / Enter (never on blur).
    if (t.dataset.cmdEditIn || t.dataset.cmdAddIn) return;
    if (t.dataset.label) {
      const k = t.dataset.label as
        'event_name' | 'empty_title' | 'empty_message';
      const v = t.value.trim();
      patch((c) => {
        if (k === 'empty_message')
          c.labels.empty_message = v || 'Aucun participant cette fois !';
        else c.labels[k] = v || null;
      });
      return;
    }
    if (t.dataset.hcolor !== undefined) {
      patch((c) => (c.overlay_hint.style.color = t.value));
      return;
    }
    if (t.dataset.cfg) {
      const path = t.dataset.cfg;
      const raw = t.value.trim();
      if (path === 'duration_s' && !raw) return;
      patch((c) =>
        setByPath(
          c,
          path,
          numeric.has(path)
            ? Number(raw.replace(/\s/g, '').replace(',', '.'))
            : raw,
        ),
      );
    } else if (t.dataset.band) {
      const [i, k] = t.dataset.band.split('.') as [
        string,
        'from' | 'to' | 'pct',
      ];
      patch(
        (c) =>
          (c.random.bands[Number(i)]![k] = Number(
            t.value.replace(/\s/g, '').replace(',', '.'),
          )),
      );
    } else if (t.dataset.display) {
      const k = t.dataset.display as keyof RaffleConfig['display'];
      const v = Number(t.value.replace(',', '.'));
      patch(
        (c) =>
          (c.display[k] =
            k === 'join_feedback_ms' ? Math.round(v * 1000) : Math.round(v)),
      );
    } else if (t.dataset.schedMin) {
      const k = t.dataset.schedMin as
        'first_delay_s' | 'interval_s' | 'interval_min_s' | 'interval_max_s';
      patch(
        (c) =>
          (c.scheduler[k] = Math.round(Number(t.value.replace(',', '.')) * 60)),
      );
    } else if (t.dataset.soundVol) {
      const slot = t.dataset.soundVol as 'normal' | 'super' | 'giveaway';
      patch((c) => (c.launch_sounds[slot]!.volume = Number(t.value)));
    } else if (t.dataset.soundFile && t.files?.[0]) {
      const slot = t.dataset.soundFile as 'normal' | 'super' | 'giveaway';
      const file = t.files[0];
      void api<RaffleSound>('/sounds', undefined, {
        data: file,
        name: file.name,
      })
        .then((s) =>
          patch(
            (c) =>
              (c.launch_sounds[slot] = {
                ...s,
                volume: c.launch_sounds[slot]?.volume ?? s.volume,
              }),
          ),
        )
        .catch(fail);
    }
  });
  root.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.soundVol)
      (t.nextElementSibling as HTMLElement).textContent = t.value;
    if (t.dataset.id === 'hintIn') {
      $('hintCount').textContent = `${t.value.length}/60`;
      // Live preview while typing (saved to Core on change).
      if (cfg) {
        $('hintPv').innerHTML = hintPreview(cfg, t.value);
        paintHintLines();
      }
    }
    if (t.dataset.cmdAddIn || t.dataset.cmdEditIn) {
      const list = (t.dataset.cmdAddIn ??
        t.dataset.cmdEditIn!.split(':')[0]) as CmdList;
      if (cmdErr[list]) showCmdErr(list, '');
    }
  });
  window.addEventListener('resize', scalePreview);
  // Local seconds between two Core reads (the countdown comes from Core's closes_at / next_at).
  const tickLocal = () => {
    if (!visible) return;
    if (round && view === 'live') tickHead();
    const s = status?.scheduler;
    if (s?.phase === 'running' && s.remaining_ms !== null) {
      const left = s.remaining_ms - (Date.now() - snapAt);
      for (const id of ['schedLeft', 'schedLeft2']) {
        const el = root.querySelector(`[data-id="${id}"]`);
        if (el) el.textContent = duration(left);
      }
    }
  };
  void chatApi<{ identities: { id: string; label: string }[] }>('/identities')
    .then((r) => (identities = r.identities ?? []))
    .catch(() => {});

  return {
    setVisible(v: boolean) {
      visible = v;
      timers.forEach((x) => window.clearInterval(x));
      timers = [];
      if (!v) return stopPreview();
      void refresh(!cfg);
      timers.push(window.setInterval(() => void refresh(), 1000));
      timers.push(window.setInterval(tickLocal, 250));
      window.setTimeout(scalePreview, 30);
    },
  };
}
