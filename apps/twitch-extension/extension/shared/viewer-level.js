// Level Up V2 (docs/LEVEL_UP_V2.md § 6): « Mon niveau » in the extension's preferences — the level, the XP towards the
// next level and the badges owned, read from the Core for the viewer of the token (GET /viewer/progression). Shared by
// both shells (shared/ui.js and app/panel.js); no state of its own.

// Thousands with a no-break space (never « 1 » and « 000 » on two lines), the same in every browser.
const fr = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

/** The words and the bar of the block — pure (tested without a DOM); null when there is nothing to show. */
export function viewerLevelSummary(p) {
  if (!p || p.enabled !== true || !Number.isFinite(p.level)) return null;
  const from = Number(p.levelXp) || 0;
  const span = Math.max(1, (Number(p.nextLevelXp) || 0) - from);
  const done = Math.min(span, Math.max(0, (Number(p.xp) || 0) - from));
  const owned = Array.isArray(p.badges) ? p.badges.length : 0;
  return {
    title: `Niveau ${p.level}`,
    detail: `${fr(done)} / ${fr(span)} XP vers le niveau ${p.level + 1}`,
    ratio: done / span,
    badges: owned ? `${owned} badge${owned > 1 ? 's' : ''} débloqué${owned > 1 ? 's' : ''}` : '',
  };
}

/** The block, built with the shell's own `el(tag, className, text)`. */
export function viewerLevelBlock(el, progression, { loading = false, error = false } = {}) {
  const box = el('div', 'jdm-viewer-preferences__option jdm-viewer-level');
  box.setAttribute('aria-label', 'Mon niveau');
  const summary = viewerLevelSummary(progression);
  if (!summary) {
    box.append(el('span', 'jdm-viewer-preferences__label', loading
      ? 'Mon niveau : chargement…'
      : error ? 'Mon niveau : indisponible pour l’instant.' : 'Mon niveau : pas encore de progression.'));
    return box;
  }
  const head = el('span', 'jdm-viewer-preferences__label', `${summary.title} · ${summary.detail}`);
  const bar = el('div', 'jdm-viewer-level__bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(Math.round(summary.ratio * 100)));
  // Inline CSSOM (allowed by the extension's CSP): no rule added to the central stylesheet.
  Object.assign(bar.style, { height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,.14)', overflow: 'hidden', margin: '4px 0' });
  const fill = el('div', 'jdm-viewer-level__fill');
  Object.assign(fill.style, { height: '100%', width: `${Math.round(summary.ratio * 1000) / 10}%`, background: '#58dba0' });
  bar.append(fill);
  box.append(head, bar);
  if (summary.badges) box.append(el('span', 'jdm-viewer-preferences__status', summary.badges));
  return box;
}
