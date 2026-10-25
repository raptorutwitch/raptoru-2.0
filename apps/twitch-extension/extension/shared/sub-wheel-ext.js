// Roue du Sub V2 (R8) — « Roue du Sub » in the Hub: the viewer's OWN tours (Core's projection, identity from the
// verified token), « Lancer mes tours » (= « !roue oui »: the draws are asked, never credited here — each wheel is
// drawn by Core when it is shown, the viewer present), and for the team (moderators, the streamer) the tours waiting
// with « Tirer » / « Accorder un tour »: Core checks « Roue du Sub · Tirer / Accorder » and journals. Confirmations are
// inline (two steps): the extension frame may block window.confirm. Nothing is decided in this file.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const REFRESH_MS = 15_000;
const ERRORS = {
  forbidden: 'Permission requise (Roue du Sub · Tirer / Accorder).',
  team_only: 'Réservé à l’équipe.',
  identity_required: 'Partage ton identité Twitch avec l’extension pour voir tes tours.',
  needs_review: 'Ce tour est à vérifier par le streamer.',
  not_owed: 'Ce tour n’est plus en attente.',
  grant_key_reused: 'Ce tour a déjà été accordé.',
};
const say = (e) => ERRORS[e?.code ?? e?.message] ?? ERRORS[e?.body?.error] ?? 'Indisponible pour le moment.';
const month = (r) => {
  if (!r.month_source || r.sub_month == null) return `roue ${r.months} mois`;
  return r.month_source === 'twitch' ? `mois ${r.sub_month}` : `mois ~${r.sub_month} (estimé)`;
};
const STATE = (r) =>
  r.blocked
    ? 'à vérifier'
    : r.status === 'requested'
      ? 'demandé'
      : r.status === 'queued' || r.status === 'playing'
        ? 'en cours'
        : r.queue === 'auto'
          ? 'automatique'
          : 'à lancer';

export function createSubWheelView({ document, client, team = false }) {
  const node = document.createElement('div');
  node.className = 'swx';
  let me = null;
  let rights = null;
  let error = '';
  let note = '';
  let confirming = null; // 'accept' | spin id
  let loadedAt = 0;

  async function load() {
    loadedAt = Date.now();
    try {
      const r = await client.subWheelMe();
      me = r?.data ?? r;
      error = '';
    } catch (e) {
      error = say(e);
    }
    if (team) {
      try {
        const t = await client.subWheelTeam();
        rights = t?.data ?? t;
      } catch (e) {
        rights = { error: say(e) };
      }
    }
    render();
  }

  async function act(fn, done) {
    try {
      await fn();
      note = done;
    } catch (e) {
      note = say(e);
    }
    confirming = null;
    await load();
  }

  function viewerPart() {
    if (error) return `<p class="muted">${esc(error)}</p>`;
    if (!me) return '<p class="muted">Chargement…</p>';
    const c = me.counts ?? {};
    const total = (c.auto ?? 0) + (c.manual ?? 0) + (c.requested ?? 0) + (c.blocked ?? 0) + (c.drawing ?? 0);
    const status =
      me.mode !== 'v2'
        ? 'La Roue du Sub V2 n’est pas encore active : tes tours sont gardés.'
        : !me.enabled
          ? 'La roue est en pause : aucun tour n’est perdu.'
          : !me.live
            ? 'Les tours se lancent pendant le live.'
            : me.presence === 'present'
              ? 'Tu es là : tes tours demandés passent à la prochaine roue.'
              : 'Tes tours demandés passeront quand tu seras dans le chat.';
    const list = (me.rights ?? [])
      .map((r) => `<li><b>${esc(month(r))}</b> · T${r.tier} · <span class="lpill${r.blocked ? ' lpill--off' : ''}">${esc(STATE(r))}</span></li>`)
      .join('');
    const accept = me.can_accept
      ? confirming === 'accept'
        ? `<p>Lancer ${c.manual > 1 ? `tes ${c.manual} tours` : 'ton tour'} ? <button class="jdm-btn jdm-btn--primary" data-act="sw-accept-yes">Oui, lancer</button> <button class="jdm-btn" data-act="sw-cancel">Annuler</button></p>`
        : `<button class="jdm-btn jdm-btn--primary" data-act="sw-accept">Lancer mes tours</button>`
      : '';
    return `<p>${total ? `Tu as <b>${total} tour${total > 1 ? 's' : ''}</b> de Roue du Sub.` : 'Tu n’as aucun tour en attente.'}</p>
      <p class="muted small">${esc(status)}</p>
      ${list ? `<ul class="swx-list">${list}</ul>` : ''}
      ${accept}
      <p class="muted small">Dans le chat : <b>!roue</b> (tes tours), <b>!roue oui</b> (les lancer).</p>`;
  }

  function teamPart() {
    if (!team) return '';
    if (!rights) return '<p class="muted">Chargement…</p>';
    if (rights.error) return `<h3>Équipe</h3><p class="muted">${esc(rights.error)}</p>`;
    const rows = rights
      .map((r) => {
        const can = !r.blocked && r.status === 'owed';
        const btn = can
          ? confirming === r.spin_id
            ? `<button class="jdm-btn jdm-btn--primary" data-act="sw-draw-yes" data-spin="${esc(r.spin_id)}">Confirmer</button> <button class="jdm-btn" data-act="sw-cancel">Annuler</button>`
            : `<button class="jdm-btn" data-act="sw-draw" data-spin="${esc(r.spin_id)}">Tirer</button>`
          : '';
        return `<li><b>${esc(r.viewer?.name)}</b> · ${esc(month({ ...r.right, months: r.months }))} · T${r.tier} · <span class="lpill${r.blocked ? ' lpill--off' : ''}">${esc(r.blocked ? 'à vérifier' : r.status === 'requested' ? 'demandé' : r.right?.queue === 'auto' ? 'automatique' : 'manuel')}</span> <span class="muted small">${esc(r.presence === 'present' ? 'présent' : r.presence === 'absent' ? 'absent' : '')}</span> ${btn}</li>`;
      })
      .join('');
    return `<h3>Équipe — tours en attente</h3>
      ${rows ? `<ul class="swx-list">${rows}</ul>` : '<p class="muted">Aucun tour en attente.</p>'}
      <details><summary>Accorder un tour</summary>
        <form data-role="swx-grant">
          <input data-f="g-id" inputmode="numeric" placeholder="Twitch ID" required>
          <input data-f="g-name" placeholder="Pseudo" required maxlength="64">
          <select data-f="g-tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select>
          <input data-f="g-months" type="number" min="1" max="200" value="1" aria-label="Roue (mois)">
          <input data-f="g-note" placeholder="Motif" required maxlength="200">
          <button class="jdm-btn" type="submit">Accorder</button>
        </form></details>`;
  }

  function render() {
    node.innerHTML = `${viewerPart()}${teamPart()}${note ? `<p class="muted small" role="status">${esc(note)}</p>` : ''}`;
  }

  node.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    if (a === 'sw-accept' || a === 'sw-draw') {
      confirming = a === 'sw-accept' ? 'accept' : t.dataset.spin;
      render();
    } else if (a === 'sw-cancel') {
      confirming = null;
      render();
    } else if (a === 'sw-accept-yes') {
      void act(() => client.subWheelAccept(), 'C’est demandé : tes tours seront lancés pendant le live, quand tu seras là.');
    } else if (a === 'sw-draw-yes') {
      void act(() => client.subWheelTeamRequest(t.dataset.spin), 'Tirage demandé : il passe à la prochaine roue.');
    }
  });
  node.addEventListener('submit', (e) => {
    if (e.target.dataset.role !== 'swx-grant') return;
    e.preventDefault();
    const f = (k) => node.querySelector(`[data-f="${k}"]`)?.value.trim() ?? '';
    if (!/^\d{1,32}$/.test(f('g-id')) || !f('g-name') || !f('g-note')) {
      note = 'Twitch ID, pseudo et motif obligatoires.';
      render();
      return;
    }
    void act(
      () =>
        client.subWheelTeamGrant({
          key: crypto.randomUUID(),
          viewer: { id: f('g-id'), name: f('g-name') },
          tier: Number(f('g-tier') || 1),
          months: Math.max(1, Math.min(200, Math.round(Number(f('g-months')) || 1))),
          note: f('g-note'),
        }),
      'Tour accordé (tours manuels).',
    );
  });

  return {
    node,
    start() {
      render();
      void load();
    },
    /** The host re-attaches the view on its refreshes: re-render, re-read Core at most every 15 s. */
    attached() {
      render();
      if (Date.now() - loadedAt > REFRESH_MS) void load();
    },
  };
}
