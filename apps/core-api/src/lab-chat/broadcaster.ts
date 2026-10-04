// Who is the streamer in the Lab chat — ONE rule for every module that reads chat messages (Commands V2
// admission, Tombola chat commands…). Decided by identity only: the chatter's user id is the channel's
// own id, or the channel's real Twitch broadcaster id (the Lab channel 900100 is not a Twitch id; the
// real one comes from the Lab Core's configuration, BONK_LAB_CHANNEL_TWITCH_ID = the bot's
// TWITCH_BROADCASTER_ID). A claimed role or a « broadcaster » badge never makes a streamer.

/** The real Twitch broadcaster id of a channel, when the runtime knows it. */
export type BroadcasterOf = (channelId: string) => string | null;

export function isChannelBroadcaster(
  channelId: string,
  userId: string,
  broadcasterOf?: BroadcasterOf,
): boolean {
  return (
    userId === channelId || userId === (broadcasterOf?.(channelId) ?? null)
  );
}

/** Role of a chat message's author: the claimed role, except « broadcaster », granted by identity only. */
export function chatRole(
  channelId: string,
  chatter: { id: string; role: 'broadcaster' | 'moderator' | 'viewer' },
  broadcasterOf?: BroadcasterOf,
): 'broadcaster' | 'moderator' | 'viewer' {
  if (isChannelBroadcaster(channelId, chatter.id, broadcasterOf))
    return 'broadcaster';
  return chatter.role === 'broadcaster' ? 'viewer' : chatter.role;
}
