import { z } from 'zod';

// Stream lifecycle as reported by twitch-bot. Core decides what it means.

export const StreamLive = z.object({
  streamId: z.string().min(1).max(64),
  startedAt: z.iso.datetime({ offset: true }),
});
export type StreamLive = z.infer<typeof StreamLive>;

export const StreamOnlineRequest = StreamLive;
export type StreamOnlineRequest = StreamLive;

export const StreamOfflineRequest = z.object({
  endedAt: z.iso.datetime({ offset: true }).optional(),
});
export type StreamOfflineRequest = z.infer<typeof StreamOfflineRequest>;

// Full snapshot from Helix: `live: null` means Twitch confirmed the channel is offline.
export const StreamSyncRequest = z.object({
  live: StreamLive.nullable(),
});
export type StreamSyncRequest = z.infer<typeof StreamSyncRequest>;

export const StreamStateResponse = z.object({
  live: z.boolean(),
  streamId: z.string().nullable(),
  streamDay: z.string().nullable(),
});
export type StreamStateResponse = z.infer<typeof StreamStateResponse>;
