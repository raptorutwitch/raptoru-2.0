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
