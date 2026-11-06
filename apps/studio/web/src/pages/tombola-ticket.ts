import { esc, fld, fmt, ic, seg, sw } from '../ds/ds.js';
import { ERRORS, PRESETS, type Config, type Status } from './tombola-model.js';

// Le ticket : l'objet qu'on prépare. La récompense à gauche, les conditions au milieu, le talon qu'on détache pour lancer.

const FIXED_JETONS = [5000, 10000, 25000, 50000];
const FIXED_BONBONS = [5, 10, 20, 30];
const DURATIONS = [30, 45, 60, 90, 120];

/** Temps restant en toutes lettres, jamais arrondi à la minute : c'est un compte à rebours. */
export const leftText = (ms: number | null) => {
  if (ms === null) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60
    ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
    : `${s} s`;
};

/** La forme de la distribution : chaque tranche, plus rare vers le haut. Décoratif, les valeurs sont dans le panneau. */
export function sparkHtml(c: Config) {
  const bands = c.random.bands;
  const span = Math.max(1, bands.at(-1)!.to - bands[0]!.from);
  const bars: number[] = [];
  for (const b of bands) {
    const n = Math.max(2, Math.round(((b.to - b.from) / span) * 24));
    for (let i = 0; i < n; i++) bars.push((b.pct / n) * (1.5 - i / n));
  }
  const top = Math.max(...bars, 0.001);
  return `<div class="tb-spark" aria-hidden="true">${bars.map((v, i) => `<i style="height:${(v / top) * 100}%;animation-delay:${i * 18}ms"></i>`).join('')}</div>`;
}

/** L'état de l'automatique, depuis la `phase` du Core. Le compte à rebours s'écrit dans `[data-left]` à chaque tic. */
export function schedLine(s: Status) {
  const a = s.scheduler;
  const skip = a.last_skip_reason
    ? ` · dernier lancement sauté : ${esc(ERRORS[a.last_skip_reason] ?? a.last_skip_reason)}`
    : '';
  const line =
    a.phase === 'waiting_stream'
      ? 'En attente du prochain stream'
      : a.phase === 'running'
        ? 'Prochaine dans <b data-left></b>'
        : a.phase === 'waiting_round'
          ? 'Manche en cours : la suivante se planifie à la fin de son affichage'
          : a.phase === 'paused'
            ? `<span class="tb-warn">En pause</span>, reste <b>${leftText(a.remaining_ms)}</b>`
            : 'Tu lances à la main';
  return line + skip;
}
export const schedBtn = (s: Status) =>
  s.scheduler.can_pause
    ? `<button type="button" class="d-btn ghost sm" data-sched="pause">${ic('pause')}Pause</button>`
    : s.scheduler.can_resume
      ? `<button type="button" class="d-btn ghost sm" data-sched="resume">${ic('play')}Reprendre</button>`
      : '';

function reward(c: Config, s: Status, bandsDirty: boolean) {
  const cur = s.currencies.find((k) => k.id === c.currency_id);
  const curLabel = esc(cur?.label ?? c.currency_id);
  if (c.amount_mode === 'giveaway')
    return `<label class="d-fld tb-prize"><input type="text" data-cfg="prize" maxlength="80" value="${esc(c.prize)}" aria-label="Lot à gagner"></label><small class="tb-sub">Rien n’est crédité : tu remets le lot toi-même</small>`;
  const coins = `<div class="d-tags tb-curs">${s.currencies
    .map(
      (k) =>
        `<button type="button" class="d-tag ${c.currency_id === k.id ? 'ok' : 'off'}" ${k.available ? `data-cur="${esc(k.id)}"` : 'disabled title="À venir"'} aria-pressed="${c.currency_id === k.id}">${esc(k.label)}</button>`,
    )
    .join('')}</div>`;
  if (c.amount_mode === 'fixed') {
    const list = c.currency_id === 'bonbons' ? FIXED_BONBONS : FIXED_JETONS;
    return `<label class="tb-bigin"><input type="number" min="1" max="10000000" data-cfg="fixed_amount" value="${c.fixed_amount}" aria-label="Montant"></label>
      ${coins}
      <div class="d-tags">${list.map((v) => `<button type="button" class="d-tag ${c.fixed_amount === v ? 'ok' : ''}" data-fixed="${v}">${fmt(v)}</button>`).join('')}</div>`;
  }
  return `<button type="button" class="tb-amount" data-open="tranches" title="Modifier les tranches">${fmt(c.random.bands[0]!.from)} – ${fmt(c.random.bands.at(-1)!.to)}${bandsDirty ? '<i class="d-dot w" title="Tranches pas encore enregistrées"></i>' : ''}<small>${curLabel}</small></button>
    ${coins}${sparkHtml(c)}`;
}

export function ticketHtml(
  c: Config,
  s: Status,
  ui: { bandsDirty: boolean; onAir: boolean; round: string },
) {
  const mode = seg(
    'data-mode',
    [
      ['random', 'Aléatoire'],
      ['fixed', 'Fixe'],
      ['giveaway', 'Giveaway'],
    ],
    c.amount_mode,
    'block',
  ).replace(
    'data-mode="random"',
    `data-mode="random" ${c.currency_id === 'bonbons' ? 'disabled title="En Bonbons : montant fixe, les tranches sont en Jetons"' : ''}`,
  );
  const a = `<div class="tb-a"><span class="d-lb">Récompense</span>${mode}${reward(c, s, ui.bandsDirty)}</div>`;
  const known = DURATIONS.includes(c.duration_s);
  const auto = c.scheduler;
  const b = `<div class="tb-b">
    <div class="tb-row"><span class="d-lb">Durée</span><div class="tb-durs">${DURATIONS.map((v) => `<button type="button" class="${c.duration_s === v ? 'on' : ''}" data-dur="${v}" aria-label="${v} s" aria-pressed="${c.duration_s === v}">${v}</button>`).join('')}<label class="d-fld ${known ? '' : 'tb-on'}"><input type="number" min="10" max="3600" data-cfg="duration_s" value="${known ? '' : c.duration_s}" placeholder="Autre" aria-label="Autre durée, en secondes"><span>s</span></label></div></div>
    <div class="tb-row"><span class="d-lb">Gagnants</span><span class="tb-line">${seg(
      'data-win',
      [
        ['auto', 'Auto'],
        ['custom', 'Fixe'],
      ],
      c.winners_mode,
    )}${c.winners_mode === 'custom' ? `<span class="tb-mini">${fld('data-cfg="winners_custom" min="1" max="50" aria-label="Nombre de gagnants"', c.winners_custom)}</span>` : `<button type="button" class="d-ib" data-wintable aria-label="Voir le nombre de gagnants selon la salle">${ic('info')}</button>`}</span></div>
    <div class="tb-row"><span class="d-lb">Inscription</span><span class="d-tags">${c.join_commands.map((j) => `<span class="d-tag">${esc(j)}</span>`).join('')}<button type="button" class="d-tag add" data-open="participation" aria-label="Modifier les commandes">${ic('plus')}</button></span></div>
    <div class="tb-row"><span class="d-lb">Extension</span><span class="tb-line">${sw(c.extension_button, 'data-sw="extension_button"', 'Bouton dans l’extension')}<span class="d-muted">Bouton « Je participe »</span></span></div>
    <div class="tb-row"><span class="d-lb">Surprises</span><span class="d-tags"><button type="button" class="d-tag ${c.super.enabled ? 'gold' : 'off'}" data-open="super">Super 1 sur ${fmt(c.super.one_in)}</button><button type="button" class="d-tag ${c.full.enabled ? 'gold' : 'off'}" data-open="full">Full oseille ${c.full.chance_pct} %</button></span></div>
    <div class="tb-row"><span class="d-lb">Automatique</span><span class="tb-auto"><span class="tb-line">${sw(auto.enabled, 'data-sw="scheduler.enabled"', 'Tombola automatique')}${
      auto.enabled
        ? `<label class="d-fld tb-preset"><select data-preset aria-label="Fréquence">${PRESETS.map(([k, l]) => `<option value="${k}" ${auto.preset === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${schedBtn(s)}`
        : '<span class="d-faint">Tu lances à la main</span>'
    }</span>${auto.enabled ? `<small data-z="sched">${schedLine(s)}</small>` : ''}</span></div>
  </div>`;
  const stub = `<div class="tb-stub" data-stub><span class="tb-no">${esc(ui.round)}</span><button type="button" class="d-btn pri tb-go" data-launch="auto" aria-label="Lancer la Tombola" ${ui.onAir ? 'disabled' : ''}>${ic('play')}Lancer</button><button type="button" class="d-btn gold" data-launch="super" aria-label="Lancer une Super Tombola" ${ui.onAir ? 'disabled' : ''}>${ic('star')}Super</button>${ui.onAir ? '<small>Résultat encore à l’écran</small>' : ''}</div>`;
  return a + b + stub;
}
