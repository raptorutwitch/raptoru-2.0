// Halloween Chaos effects (docs/HALLOWEEN.md § 4 bis) — which screen the Chaos window captures. Pure (tested).

/**
 * The capture source of the monitor the Chaos window covers (Electron gives each screen source its display id). Null:
 * that monitor is not offered (unplugged meanwhile): nothing is captured, never another screen by surprise.
 */
export function pickScreenSource<S extends { id: string; display_id: string }>(
  sources: S[],
  displayId: number,
): S | null {
  return sources.find((s) => s.display_id === String(displayId)) ?? null;
}
