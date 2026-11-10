// Width of a node in COMPOSITION pixels: its CSS width divided by the v2 geometry scale (--kg on <html>, set by
// app/layout.js). The legacy shell has no --kg: 1, the width is unchanged. Use it for every JS width threshold
// written for the 651×434 composition (moderation modes, Commandes modes, Hub « étroit »).
export function scaleOf(doc = globalThis.document) {
  const v = doc?.defaultView?.getComputedStyle(doc.documentElement)?.getPropertyValue('--kg');
  return parseFloat(v) || 1;
}

export function boxWidth(node, win = globalThis.window) {
  return (node?.clientWidth || win?.innerWidth || 0) / scaleOf(node?.ownerDocument ?? win?.document);
}
