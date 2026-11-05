import type {
  BonkLabCatalog,
  BonkLabThirdPartyCatalog,
} from '@raptoru/schemas';

// A viewer's Twitch catalog as the extension's emote picker reads it: one group per channel that owns
// emotes (its subs, follower, bits… emotes), globals last. Same shape as the Studio Lab EBS gives
// (apps/studio/server/src/extension-lab/lab-ebs.ts `twitchGroups`): the extension sends back only
// `twitch:<id>`, checked by Core against this same catalog.

type Json = Record<string, unknown>;

export function twitchEmoteGroups(catalog: BonkLabCatalog): Json[] {
  const owners = new Map(catalog.owners.map((o) => [o.id, o]));
  const groups = new Map<string, Json & { emotes: Json[] }>();
  for (const e of catalog.emotes) {
    const owner = owners.get(e.owner_id);
    const key = owner ? `twitch-channel-${owner.id}` : 'twitch-global';
    if (!groups.has(key))
      groups.set(key, {
        id: key,
        label: owner?.display_name ?? 'Twitch',
        icon: 'twitch',
        source: 'twitch',
        provider: 'twitch',
        scope: owner ? 'channel' : 'global',
        ...(owner
          ? {
              channel_id: owner.id,
              channel_login: owner.login,
              channel_display_name: owner.display_name,
              ...(owner.profile_image_url
                ? { channel_avatar_url: owner.profile_image_url }
                : {}),
            }
          : {}),
        emotes: [],
      });
    groups.get(key)!.emotes.push({
      id: `twitch:${e.id}`,
      label: e.name,
      source: 'twitch',
      provider: 'twitch',
      image_url: e.url,
      static_url: e.static_url,
      animated: e.animated,
      emote_set_id: e.emote_set_id,
      emote_type: e.emote_type,
    });
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.scope === 'global') - Number(b.scope === 'global'),
  );
}

/**
 * The PUBLIC 7TV / BTTV / FFZ catalogs of the channel (EMOTE_CATALOG_CHANNEL_ID, read-only, no token) → picker groups,
 * per provider (channel, then globals). The extension only ever sends back `provider` + `provider:id`; the Core checks
 * the id against the same catalog and builds the CDN URL itself.
 */
export function thirdPartyEmoteGroups(catalog: BonkLabThirdPartyCatalog) {
  const groups: Record<string, unknown>[] = [];
  for (const provider of ['7tv', 'bttv', 'ffz'] as const)
    for (const scope of ['channel', 'global'] as const) {
      const emotes = catalog.emotes.filter(
        (e) => e.provider === provider && e.scope === scope,
      );
      if (!emotes.length) continue;
      groups.push({
        id: `${provider}-${scope}`,
        label:
          scope === 'global'
            ? 'Globales'
            : (catalog.channel_display_name ?? 'Chaîne'),
        source: provider,
        provider,
        scope,
        emotes: emotes.map((e) => ({
          id: `${provider}:${e.id}`,
          label: e.name,
          source: provider,
          provider,
          image_url: e.url,
          animated: e.animated,
        })),
      });
    }
  return groups;
}
