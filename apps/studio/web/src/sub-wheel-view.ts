// Roue du Sub — Studio section (pure part, tested): the switch (OFF by default), the queue, the gains waiting for
// their attribution, the last spins with their real result, the tests (never a real gain). Every name is escaped.

export interface SwSpinView {
  spin_id: string;
  source: 'twitch' | 'simulation' | 'test';
  type: 'sub' | 'resub';
  viewer: { name: string };
  tier: number;
  months: number;
  status: 'ignored' | 'queued' | 'playing' | 'shown' | 'failed' | 'skipped';
  reason: string | null;
  segment: number | null;
  amount: number | null;
  award: {
    status: 'none' | 'pending' | 'awarded' | 'manual' | 'cancelled' | 'test';
    ref: string | null;
    note: string | null;
  };
  created_at: string;
}

export interface SwState {
  settings: { enabled: boolean };
  waiting: number;
  pending_awards: { count: number; total: number };
  recent: SwSpinView[];
  animations_error?: string | null;
  effects: {
    connected: boolean;
    current: boolean;
    media: { id: string; label: string; available: boolean }[];
  } | null;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const chip = (cls: string, text: string) =>
  `<span class="cp-chip cp-chip--${cls}">${esc(text)}</span>`;
const n = (v: number) => v.toLocaleString('fr-FR');

const STATUS: Record<SwSpinView['status'], string> = {
  ignored: 'Roue désactivée (rien tiré)',
  queued: 'En attente (après l’alerte)',
  playing: 'En cours',
  shown: 'Affichée',
  failed: 'Non affichée',
  skipped: 'Non affichée (trop tard)',
};
const AWARD: Record<SwSpinView['award']['status'], string> = {
  none: '',
  pending: 'Gain en attente d’attribution',
  awarded: 'Crédité',
  manual: 'Crédité à la main',
  cancelled: 'Annulé',
  test: 'Test : aucun gain',
};

export function subWheelView(s: SwState | null, error: string | null) {
  if (error) return `<p class="cp-error">${esc(error)}</p>`;
  if (!s) return '<p class="cp-muted">Chargement…</p>';
  const missing = (s.effects?.media ?? []).filter((m) => !m.available);
  const player = !s.effects
    ? chip('warn', 'Lecteur d’effets indisponible')
    : !s.effects.connected
      ? chip('warn', 'Lecteur d’effets : non ouvert')
      : !s.effects.current
        ? chip('warn', 'Lecteur d’effets : à recharger')
        : chip('ok', 'Animation : lecteur d’effets prêt');
  const rows = s.recent
    .map((r) => {
      const result =
        r.amount === null
          ? '—'
          : `${n(r.amount)} jetons <small>(segment ${(r.segment ?? 0) + 1})</small>`;
      const award = AWARD[r.award.status];
      const actions =
        r.award.status === 'pending'
          ? ` <button type="button" class="cp-ghost" data-act="sw-manual" data-spin="${esc(r.spin_id)}">Crédité à la main…</button> <button type="button" class="cp-ghost" data-act="sw-cancel" data-spin="${esc(r.spin_id)}">Annuler…</button>`
          : '';
      return `<tr class="cp-row--${r.status === 'shown' ? 'done' : r.status === 'failed' || r.status === 'skipped' ? 'failed' : 'pending'}">
        <td>${esc(new Date(r.created_at).toLocaleTimeString('fr-FR'))}</td>
        <td>${r.source === 'twitch' ? '' : '<i>Test</i> '}${esc(r.viewer.name)}<br><small>${r.type === 'sub' ? 'sub' : 'resub'} · T${r.tier} · ${r.months} mois</small></td>
        <td><b>${STATUS[r.status]}</b><br><small>${result}</small>${r.reason && r.status !== 'ignored' ? `<br><small>${esc(r.reason)}</small>` : ''}</td>
        <td><small>${esc(award)}${r.award.note ? ` — ${esc(r.award.note)}` : ''}</small>${actions}</td></tr>`;
    })
    .join('');
  return `<div class="cp-status">${s.settings.enabled ? chip('ok', 'Roue : ACTIVE') : chip('warn', 'Roue : désactivée')} ${player}
      ${s.waiting ? chip('warn', `${s.waiting} roue(s) en attente`) : ''}
      ${s.pending_awards.count ? chip('warn', `${s.pending_awards.count} gain(s) à attribuer : ${n(s.pending_awards.total)} jetons`) : ''}
      ${s.animations_error ? chip('warn', 'Animations : Core injoignable') : ''}</div>
    ${missing.length ? `<p class="cp-error">Médias non importés : ${esc(missing.map((m) => m.label).join(', '))}</p>` : ''}
    <p class="cp-muted">Comme SAMMI : une roue par sub, resub ou Prime (tiers 1 à 3), jamais pour un sub offert ni un
      gift communautaire ; elle tourne après l’alerte de sub. Gain = segment tiré (paliers 1–3, 4–11, 12–19, 20+ mois) ×
      tier. <b>Les gains ne sont pas crédités</b> : ils sont enregistrés « en attente d’attribution » (économie raccordée
      plus tard). Désactivée, un vrai sub est seulement noté.</p>
    <div class="cp-buttons">
      <button type="button" data-act="sw-switch" class="${s.settings.enabled ? '' : 'cp-primary'}">${s.settings.enabled ? 'Désactiver la roue' : 'Activer la roue'}</button>
      <label class="cp-inline">Pseudo <input data-f="sw-name" size="12" maxlength="25" value="Test Studio"/></label>
      <label class="cp-inline">Tier <select data-f="sw-tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></label>
      <label class="cp-inline">Mois <input data-f="sw-months" type="number" min="1" max="200" value="1" style="width:4em"/></label>
      <button type="button" data-act="sw-test" title="Joue une roue dans OBS, aucun gain">Tester l’animation</button>
      <button type="button" data-act="sw-full" title="Alerte de sub simulée puis la roue, aucun gain">Test complet simulé</button>
    </div>
    ${rows ? `<table class="cp-history"><thead><tr><th>Heure</th><th>Viewer</th><th>Roue</th><th>Gain</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="cp-muted">Aucune roue.</p>'}`;
}
