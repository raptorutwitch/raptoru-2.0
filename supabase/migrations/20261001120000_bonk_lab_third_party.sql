-- Bonk V2 Lab: 7TV / BTTV / FFZ emotes (Lab/test only). Core resolves them from the public
-- catalogs of the channel (global + channel sets) and builds the CDN URL itself: the caller only
-- sends provider + id, never a URL.

alter table bonk_lab_interactions drop constraint bonk_lab_interactions_provider_check;
alter table bonk_lab_interactions add constraint bonk_lab_interactions_provider_check
  check (provider in ('unicode', 'twitch', '7tv', 'bttv', 'ffz'));
