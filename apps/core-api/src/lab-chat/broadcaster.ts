// Who is the streamer in the Lab chat — ONE rule for every module that reads chat messages (Commands V2
// admission, Tombola chat commands…). Decided by identity only, never by a claimed role or a badge:
// - a real Twitch message: the channel's Twitch broadcaster — the id configured for it (Lab Core:
//   BONK_LAB_CHANNEL_TWITCH_ID = the bot's TWITCH_BROADCASTER_ID), else the channel id itself (a
//   channel whose id IS its Twitch id). When a real id is configured, the Lab channel id (900100,
//   fictitious) is not a Twitch identity and makes no streamer (ASTRA-P2-012);
// - a simulated message: also the Lab channel's own id (the simulator's streamer identity).

/** The real Twitch broadcaster id of a channel, when the runtime knows it. */
export type BroadcasterOf = (channelId: string) => string | null;

export function isChannelBroadcaster(
  channelId: string,
  userId: string,
  broadcasterOf: BroadcasterOf | undefined,
  simulated: boolean,
): boolean {
  const twitchId = broadcasterOf?.(channelId) ?? channelId;
  return userId === twitchId || (simulated && userId === channelId);
}

/** Role of a chat message's author: the claimed role, except « broadcaster », granted by identity only. */
export function chatRole(
  channelId: string,
  chatter: { id: string; role: 'broadcaster' | 'moderator' | 'viewer' },
  broadcasterOf: BroadcasterOf | undefined,
  source: 'twitch' | 'simulator',
): 'broadcaster' | 'moderator' | 'viewer' {
  if (
    isChannelBroadcaster(
      channelId,
      chatter.id,
      broadcasterOf,
      source === 'simulator',
    )
  )
    return 'broadcaster';
  return chatter.role === 'broadcaster' ? 'viewer' : chatter.role;
}
