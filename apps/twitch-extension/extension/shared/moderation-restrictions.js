// Moderation › Restrictions: the one view of Raptoru's own restrictions (blocks, personal cooldowns),
// opened from the left column, a module (filter = module) or a viewer card (filter = viewer). Core is
// the truth: active = GET /moderation/v2/restrictions, history = the moderation audit (restriction
// actions only). Lift / change reuse the existing Core commands. No Twitch sanction here.

/** Audit actions that are restriction events (the rest of the audit stays in Historique). */
export const RESTRICTION_ACTIONS = ['block_viewer', 'unblock_viewer', 'cooldown_set', 'cooldown_clear', 'cooldown_running_clear'];
export const freshRestrictionFilters = () => ({ state: 'active', module: 'any', viewer: null, q: '' });

/** Module filter: a module also shows the « Tout Raptoru » blocks (they stop that module too). */
const moduleMatch = (f, module) => f.module === 'any' || module === f.module || (f.module !== 'all' && module === 'all');

/**
 * @param {object} h helpers of the console: ic, esc, av, MODS, MOD_KEYS, mmss, dur, hhmm, dday, actorName,
 *   nameOf, actionLabel
 */
export function restrictionsView(h, f, data) {
  const { ic, esc, MODS, MOD_KEYS } = h;
  const seg = (k, l) => `<button class="${f.state === k ? 'is-on' : ''}" data-act="rfilter" data-k="state" data-val="${k}" aria-pressed="${f.state === k}">${l}</button>`;
  const chip = (k, l, icon) =>
    `<button class="chip${f.module === k ? ' is-on' : ''}" data-act="rfilter" data-k="module" data-val="${k}" aria-pressed="${f.module === k}">${icon ? `<span class="mini" style="--c:${MODS[k].c}">${ic(k)}</span>` : ''}${l}</button>`;
  const who = f.viewer
    ? `<button class="chip is-on" data-act="rfilter" data-k="viewer" data-val="" data-tip="Retirer ce filtre">${ic('user')}${esc(h.nameOf(f.viewer))} ${ic('x')}</button>`
    : `<label class="search search--sm"><span class="sr">Rechercher un viewer</span>${ic('search')}<input data-rq placeholder="Viewer…" value="${esc(f.q)}" autocomplete="off"></label>`;
  const body = `<div class="rbar"><div class="seg" role="group" aria-label="État">${seg('active', 'Actives')}${seg('history', 'Historique')}</div>${who}</div>
    <div class="chips chips--scroll rchips">${chip('any', 'Tous')}${chip('all', 'Global')}${MOD_KEYS.map((m) => chip(m, MODS[m].short || MODS[m].label, true)).join('')}</div>
    <div class="rows rlist" data-rrows>${restrictionRows(h, f, data)}</div>
    <p class="fine rfine">${ic('shield')}Restrictions Raptoru uniquement · aucune sanction Twitch.</p>`;
  return { title: `<span class="ttl-ic">${ic('ban')}</span>Restrictions`, body };
}

export function restrictionRows(h, f, data) {
  const { ic, esc, av } = h;
  const q = f.q.trim().toLowerCase();
  const named = (id, name) => (!f.viewer || id === f.viewer) && (!q || String(name ?? id).toLowerCase().includes(q));
  if (f.state === 'history') {
    if (!data.history) return '<div class="empty">Chargement…</div>';
    const rows = data.history.filter((a) => RESTRICTION_ACTIONS.includes(a.action) && moduleMatch(f, a.module_id) && named(a.viewer_id, h.nameOf(a.viewer_id)));
    if (!rows.length) return '<div class="empty">Aucune restriction pour ces filtres</div>';
    return rows
      .map((a) => {
        const lift = /^(unblock|cooldown_clear|cooldown_running)/.test(a.action);
        const until = a.after?.until;
        return `<button class="r r--hist" data-act="open-audit" data-id="${esc(a.id)}">
        <span class="r__t tnum">${h.dday(a.created_at)}<br>${h.hhmm(a.created_at)}</span>
        <span class="r__main"><span class="r__l1"><b class="ellipsis">${esc(h.nameOf(a.viewer_id))}</b>${scopeBadge(h, a.module_id)}<span class="rbadge rbadge--${lift ? 'lift' : a.action.startsWith('cooldown') ? 'cd' : 'block'}">${esc(h.actionLabel(a.action))}</span></span>
        <span class="r__l2">${esc(h.actorName(a.actor))}${!lift && a.action === 'block_viewer' ? ` · ${until ? h.dur(Math.max(1, Math.round((Date.parse(until) - Date.parse(a.created_at)) / 1000))) : 'jusqu’au déblocage'}` : ''}${a.reason ? ` · ${esc(a.reason)}` : ''}</span></span></button>`;
      })
      .join('');
  }
  if (!data.active) return `<div class="empty">${data.failed ? 'Restrictions indisponibles pour le moment.' : 'Chargement…'}</div>`;
  const rows = data.active.filter((r) => moduleMatch(f, r.module) && named(r.viewer_id, r.display_name));
  if (!rows.length) return '<div class="empty">Aucune restriction active</div>';
  return rows
    .map((r) => {
      const cd = r.kind === 'cooldown';
      const left = r.until
        ? `<span class="timer tnum" data-until="${Date.parse(r.until)}">${h.mmss(Date.parse(r.until) - Date.now())}</span>`
        : '<span class="timer timer--inf">∞ jusqu’au déblocage</span>';
      const type = cd ? `<span class="rbadge rbadge--cd">${ic('clock')}Cooldown ${h.dur(r.delay_s)}</span>` : `<span class="rbadge rbadge--block">${ic('ban')}Bloqué</span>`;
      return `<div class="r">
        ${av(r.viewer_id, r.display_name, 'xs')}
        <span class="r__main"><span class="r__l1"><button class="who" data-act="open-viewer" data-id="${esc(r.viewer_id)}">${esc(r.display_name)}</button>${type}${scopeBadge(h, r.module)}</span>
        <span class="r__l2">${left} · ${esc(h.actorName(r.actor))}${r.reason ? ` · ${esc(r.reason)}` : ''}</span></span>
        <button class="icon-btn icon-btn--xs" data-act="${cd ? 'cooldown' : 'block'}" data-v="${esc(r.viewer_id)}" data-m="${esc(r.module)}" data-tip="Modifier (remplace la restriction)" aria-label="Modifier">${ic('timeplus')}</button>
        <button class="icon-btn icon-btn--xs" data-act="lift" data-v="${esc(r.viewer_id)}" data-kind="${r.kind}" data-m="${esc(r.module)}" data-tip="Lever la restriction" aria-label="Lever la restriction">${ic('x')}</button>
      </div>`;
    })
    .join('');
}

function scopeBadge(h, module) {
  const { ic, MODS } = h;
  if (module === 'all') return '<span class="rscope rscope--all">Global</span>';
  const m = MODS[module];
  return m ? `<span class="rscope" style="--c:${m.c}">${ic(module)}${m.short || m.label}</span>` : `<span class="rscope">${h.esc(module)}</span>`;
}
