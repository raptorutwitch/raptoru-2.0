// In-page audit (passed to page.evaluate). Shared by measure.mjs and resize.mjs.
/* global document, getComputedStyle, innerWidth, innerHeight, devicePixelRatio -- evaluated in the page (Playwright) */
export function audit() {
  const vw = innerWidth, vh = innerHeight;
  const de = document.documentElement;
  const tol = 1;
  const desc = (el) => {
    const cls = [...el.classList].slice(0, 2).join('.');
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}${t ? ` "${t}"` : ''}`;
  };
  const shown = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const INTERACTIVE = 'button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=tab], [tabindex]:not([tabindex="-1"])';
  const isInteractive = (el) => el.matches(INTERACTIVE);
  const hasText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const inCarousel = (el) => !!el.closest('.rh-card:not(.is-active), .rh-stage .rh-card[aria-hidden="true"]');
  const sr = (el) => !!el.closest('.sr-only, [aria-hidden="true"]');
  // Clip analysis against every non-visible-overflow ancestor and the viewport.
  // A child of a scroll container is judged, further up, through that container's visible window
  // (scrolling brings it there): only that window must survive the outer clips.
  function clipInfo(el, r0) {
    let cut = null, scrolls = 0, scrollHidden = false;
    let r = r0;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const L = ar.left + a.clientLeft, T = ar.top + a.clientTop;
      const R = L + a.clientWidth, B = T + a.clientHeight;
      const outX = r.left < L - tol || r.right > R + tol;
      const outY = r.top < T - tol || r.bottom > B + tol;
      const scrollX = ox === 'auto' || ox === 'scroll';
      const scrollY = oy === 'auto' || oy === 'scroll';
      if ((scrollY && a.scrollHeight > a.clientHeight + 1) || (scrollX && a.scrollWidth > a.clientWidth + 1)) scrolls += 1;
      if ((outX && !scrollX) || (outY && !scrollY)) {
        if (!cut) cut = { by: desc(a), overflow: `${ox}/${oy}` };
      } else if (outX || outY) {
        scrollHidden = true;
        r = { left: Math.max(L, r.left), top: Math.max(T, r.top), right: Math.min(R, r.right), bottom: Math.min(B, r.bottom) };
        if (r.right < r.left || r.bottom < r.top) r = { left: L, top: T, right: R, bottom: B };
      }
    }
    const off = r.left < -tol || r.top < -tol || r.right > vw + tol || r.bottom > vh + tol;
    // A document that scrolls (html/body not hidden) brings off-viewport items back: not cut.
    const docScrolls = !/hidden|clip/.test(getComputedStyle(de).overflowY + getComputedStyle(document.body).overflowY) && de.scrollHeight > de.clientHeight + 1;
    if (off && docScrolls) scrollHidden = true;
    return { cut, scrolls, scrollHidden, off: off && !docScrolls };
  }
  const els = [...document.body.querySelectorAll('*')].filter((el) => {
    if (!shown(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  });
  const res = {
    vw, vh, dpr: devicePixelRatio,
    doc: { sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, ch: de.clientHeight, bodyOverflow: getComputedStyle(document.body).overflow, htmlOverflow: getComputedStyle(de).overflow },
    view: document.querySelector('.rh-hub') ? 'hub' : (document.querySelector('.jdm-module__screen-head')?.getAttribute('aria-label') || document.querySelector('#panel')?.firstElementChild?.className || '?'),
    cutInteractive: [], offInteractive: [], cutText: [], offText: [], covered: [], ellipsized: 0, carouselOff: 0,
    minFont: null, fontSmall: { lt9: 0, lt10: 0, lt11: 0, lt12: 0 }, smallestFonts: [],
    minTarget: null, targetsLt24: [], targetsLt44: 0, interactiveCount: 0, maxScrollNesting: 0, scrollContainers: [],
    back: null,
  };
  const fonts = [];
  const targets = [];
  const hits = [];
  function hitRect(el, r) {
    let e = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    // A pseudo-element is clipped (and not hit) outside an element whose own overflow is not visible.
    const ownClip = getComputedStyle(el).overflow !== 'visible';
    for (const pseudo of ownClip ? [] : ['::after', '::before']) {
      const pa = getComputedStyle(el, pseudo);
      if (pa.content === 'none' || pa.position !== 'absolute' || pa.pointerEvents === 'none') continue;
      const g = (k) => -Math.min(0, parseFloat(pa[k]) || 0);
      e = { left: Math.min(e.left, r.left - g('left')), top: Math.min(e.top, r.top - g('top')),
        right: Math.max(e.right, r.right + g('right')), bottom: Math.max(e.bottom, r.bottom + g('bottom')) };
    }
    const label = el.matches('input, textarea, select') ? el.closest('label') : null;
    if (label) {
      const l = hitRect(label, label.getBoundingClientRect());
      e = { left: Math.min(e.left, l.left), top: Math.min(e.top, l.top), right: Math.max(e.right, l.right), bottom: Math.max(e.bottom, l.bottom) };
    }
    return e;
  }
  for (const el of els) {
    if (sr(el)) continue;
    const r = el.getBoundingClientRect();
    const inter = isInteractive(el);
    const text = !inter && hasText(el);
    if (!inter && !text) continue;
    if (inCarousel(el)) { if (r.left < 0 || r.right > vw) res.carouselOff += 1; continue; }
    const c = clipInfo(el, r);
    const entry = `${desc(el)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]${c.cut ? ' cut by ' + c.cut.by + ' (' + c.cut.overflow + ')' : ''}`;
    if (inter) {
      res.interactiveCount += 1;
      res.maxScrollNesting = Math.max(res.maxScrollNesting, c.scrolls);
      if (c.cut) res.cutInteractive.push(entry);
      else if (c.off) res.offInteractive.push(entry);
      if (!c.cut && !c.off && !c.scrollHidden) {
        // Effective hit area: a transparent absolute ::after / ::before (app/css/targets.css) may enlarge it beyond
        // the drawn box; a field inside a <label> is focused by a click anywhere on the label.
        const e = hitRect(el, r);
        const ew = e.right - e.left, eh = e.bottom - e.top;
        targets.push([Math.min(ew, eh), `${desc(el)} ${Math.round(ew)}x${Math.round(eh)}`]);
        hits.push({ el, r, e, grown: e.left < r.left - 0.5 || e.top < r.top - 0.5 || e.right > r.right + 0.5 || e.bottom > r.bottom + 0.5 });
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        // Another element, or an ANCESTOR (its enlarged hit area drawn over its own children), takes the click.
        if (hit && hit !== el && !el.contains(hit)) res.covered.push(`${desc(el)} under ${desc(hit)}`);
      }
    } else {
      if (c.cut) res.cutText.push(entry);
      else if (c.off) res.offText.push(entry);
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) res.ellipsized += 1;
      if (!c.cut && !c.off && !c.scrollHidden) fonts.push([parseFloat(cs.fontSize), desc(el)]);
    }
  }
  // Enlarged hit areas must not reach another control: an enlarged zone over a neighbour's drawn box (or over its
  // enlarged zone) would take its clicks. Nested controls (label > input) are not a conflict.
  // A small control drawn ON a larger one (the favourite star on a sound card) is a design choice of V1: reported apart
  // (hitOverlays); its enlarged zone is still checked against every OTHER control.
  res.hitOverlaps = [];
  res.hitOverlays = 0;
  const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
  for (let i = 0; i < hits.length; i += 1) for (let j = i + 1; j < hits.length; j += 1) {
    const A = hits[i], B = hits[j];
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const la = A.el.closest('label'), lb = B.el.closest('label');
    if (la && la === lb) continue;
    if (!inter(A.e, B.e)) continue;
    if (inside(A.r, B.r) || inside(B.r, A.r)) { res.hitOverlays += 1; continue; }
    const box = (h) => `${Math.round(h.e.left)},${Math.round(h.e.top)}→${Math.round(h.e.right)},${Math.round(h.e.bottom)}`;
    res.hitOverlaps.push(`${desc(A.el)} [${box(A)}] ↔ ${desc(B.el)} [${box(B)}]`);
  }
  fonts.sort((a, b) => a[0] - b[0]);
  targets.sort((a, b) => a[0] - b[0]);
  res.minFont = fonts[0]?.[0] ?? null;
  for (const [f] of fonts) { if (f < 9) res.fontSmall.lt9++; if (f < 10) res.fontSmall.lt10++; if (f < 11) res.fontSmall.lt11++; if (f < 12) res.fontSmall.lt12++; }
  res.textCount = fonts.length;
  res.smallestFonts = fonts.slice(0, 4).map(([f, d]) => `${f}px ${d}`);
  res.minTarget = targets[0]?.[0] != null ? Math.round(targets[0][0] * 10) / 10 : null;
  res.targetsLt24 = targets.filter(([s]) => s < 23.95).map(([, d]) => d);
  res.targetsLt44 = targets.filter(([s]) => s < 44).length;
  // Scroll containers that actually scroll.
  for (const el of els) {
    const cs = getComputedStyle(el);
    if ((/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) || (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1))
      res.scrollContainers.push(`${desc(el).split(' "')[0]} ${el.clientWidth}x${el.clientHeight} content ${el.scrollWidth}x${el.scrollHeight}`);
  }
  const back = document.querySelector('.jdm-back');
  if (back) { const r = back.getBoundingClientRect(); res.back = `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} ${clipInfo(back, r).cut || clipInfo(back, r).off ? 'NOT REACHABLE' : 'ok'}`; }
  const hubNav = [...document.querySelectorAll('.rh-nav, .rh-all-toggle, .rh-util-btn, .rh-tuto, .rh-card.is-active .rh-cta, .rh-cta')].filter(shown);
  res.hubNav = hubNav.map((el) => { const r = el.getBoundingClientRect(); const c = clipInfo(el, r); return `${desc(el).split(' "')[0]}:${c.cut ? 'CUT' : c.off ? 'OFF' : 'ok'}`; }).join(' ');
  return res;
}

