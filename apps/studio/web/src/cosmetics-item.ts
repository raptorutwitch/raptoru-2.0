// Studio › Boutique: what « Enregistrer » sends for an item (pure, tested; no stylesheet import, so the server tests
// can load it).

/** The item's own fields: exactly the Core's CosmeticItemInput (strict). */
export const ITEM_FIELDS = [
  'reward_id',
  'kind',
  'label',
  'description',
  'rarity',
  'category',
  'unlock_level',
  'sort',
  'status',
  'style',
  'image_id',
  'event_key',
] as const;

/**
 * An item opened with « Modifier » also carries the list's display fields (active, image, owners, offers): never sent
 * back (31/10: « Refusé : invalid_request » on every edit). Absent fields take the Core's defaults.
 */
export function itemPayload(edit: Record<string, unknown>) {
  return Object.fromEntries(
    ITEM_FIELDS.filter((k) => edit[k] !== undefined).map((k) => [k, edit[k]]),
  );
}

/**
 * The atelier's checks before sending (the Core checks format, size and weight again): a frame's avatar circle must stay
 * transparent (the decoration may bite 12 px of 512 on its edge) and its 8 px border empty. Pure on RGBA pixels.
 */
export function frameProblemsOf(px: Uint8ClampedArray, w: number, h: number) {
  if (w !== h) return ['le cadre doit être carré'];
  const alpha = (x: number, y: number) => px[(y * w + x) * 4 + 3]!;
  const k = w / 512;
  const inner = (160 - 12) * k; // the avatar's radius minus the allowed overlap
  const margin = Math.max(1, Math.round(8 * k));
  let opaqueCenter = 0;
  let centerPx = 0;
  let edge = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2);
      if (d < inner) {
        centerPx++;
        if (alpha(x, y) > 24) opaqueCenter++;
      } else if (
        (x < margin || y < margin || x >= w - margin || y >= h - margin) &&
        alpha(x, y) > 24
      )
        edge++;
    }
  const out: string[] = [];
  if (opaqueCenter > centerPx * 0.01)
    out.push(
      'le centre n’est pas transparent : l’avatar serait caché (cercle central de 62,5 %, 12 px de recouvrement au plus sur 512)',
    );
  if (edge > 0)
    out.push(
      'des pixels touchent le bord : laisse 8 px vides de chaque côté (sur une toile de 512)',
    );
  return out;
}
