// Random Ban « Le Viseur » (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 5): the strip Studio's reel scrolls. Built by
// Core AFTER the draw (the target is already frozen): the target sits at `stop`; the other avatars are a shuffled sample
// of the viewers present; the predicted viewer is never right before or after the target (no false « so close »).
// Only names and ids: no avatar is fetched for it.

export const REEL_MS = 4_500;
const MAX_OTHERS = 14;
const LENGTH = 26;

export interface ReelItem {
  id: string;
  name: string;
}

export function buildStrip(
  pool: ReelItem[],
  target: ReelItem,
  wishId: string | null,
  draw: (n: number) => number,
): { items: ReelItem[]; stop: number } {
  const others = pool.filter((p) => p.id !== target.id);
  // Fisher–Yates with the service's draw (crypto in production).
  for (let i = others.length - 1; i > 0; i--) {
    const j = draw(i + 1);
    [others[i], others[j]] = [others[j]!, others[i]!];
  }
  const sample = others.slice(0, MAX_OTHERS);
  if (!sample.length) return { items: [target], stop: 0 };
  const stop = LENGTH - 4;
  const items: ReelItem[] = [];
  for (let i = 0; i < LENGTH; i++)
    items.push(i === stop ? target : sample[i % sample.length]!);
  // Never the predicted viewer next to the target: swap it with the farthest avatar that is neither.
  for (const k of [stop - 1, stop + 1]) {
    if (items[k]?.id !== wishId) continue;
    const swap = items.findIndex(
      (x, i) => Math.abs(i - stop) > 2 && x.id !== wishId && x.id !== target.id,
    );
    if (swap >= 0) [items[k], items[swap]] = [items[swap]!, items[k]!];
    else items[k] = { id: 'x', name: '?' };
  }
  return { items, stop };
}
