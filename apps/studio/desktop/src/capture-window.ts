// Halloween Chaos effects (docs/HALLOWEEN.md § 4 bis) — which window the overlay captures. Pure (tested).

/**
 * The window a Chaos effect captures: the chosen title (exact, else contained, ignoring case); with no choice, the
 * first listed (Windows lists them topmost first). Studio's own windows are never candidates. Null: nothing to capture.
 */
export function pickCaptureWindow<S extends { id: string; name: string }>(
  sources: S[],
  own: Set<string>,
  wanted: string | null | undefined,
): S | null {
  const list = sources.filter((s) => !own.has(s.id) && s.name.trim() !== '');
  if (!wanted) return list[0] ?? null;
  const w = wanted.toLowerCase();
  return (
    list.find((s) => s.name === wanted) ??
    list.find((s) => s.name.toLowerCase().includes(w)) ??
    null
  );
}
