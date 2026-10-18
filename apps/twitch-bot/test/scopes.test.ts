import { describe, expect, it } from 'vitest';
import { broadcasterScopes, requiredScopes } from '../src/config.js';

// Scopes asked by `twitch:auth` (and checked by the bot): derived from the enabled features only.

const off = {
  DAILY_CHAT_COMMANDS: 'false',
  LOYALTY_CHAT_COMMANDS: 'false',
  PRESENCE_SHADOW: 'false',
  LAB_CHAT_INGEST: 'false',
} as const;

describe('requiredScopes', () => {
  it('presence only → moderator:read:chatters (the 2026-10-02 token: no chat reading)', () => {
    expect(requiredScopes({ ...off, PRESENCE_SHADOW: 'true' })).toEqual([
      'moderator:read:chatters',
    ]);
  });

  it('Lab chat ingestion → user:read:chat (reading only, never user:write:chat)', () => {
    expect(
      requiredScopes({
        ...off,
        PRESENCE_SHADOW: 'true',
        LAB_CHAT_INGEST: 'true',
      }),
    ).toEqual(['user:read:chat', 'moderator:read:chatters']);
  });

  it('chat commands already bring user:read:chat (no duplicate with the Lab ingestion)', () => {
    expect(
      requiredScopes({
        ...off,
        DAILY_CHAT_COMMANDS: 'true',
        LAB_CHAT_INGEST: 'true',
      }),
    ).toEqual(['user:read:chat', 'user:write:chat']);
  });

  it('Lab chat output → user:write:chat + moderator:manage:announcements (asked only when enabled)', () => {
    expect(
      requiredScopes({
        ...off,
        PRESENCE_SHADOW: 'true',
        LAB_CHAT_INGEST: 'true',
        LAB_CHAT_OUTPUT: 'true',
      }),
    ).toEqual([
      'user:read:chat',
      'moderator:read:chatters',
      'user:write:chat',
      'moderator:manage:announcements',
    ]);
    expect(
      requiredScopes({
        ...off,
        DAILY_CHAT_COMMANDS: 'true',
        LAB_CHAT_OUTPUT: 'true',
      }),
    ).toEqual([
      'user:read:chat',
      'user:write:chat',
      'moderator:manage:announcements',
    ]);
  });

  it('Lab alerts follows → moderator:read:followers, asked only when LAB_ALERTS_FOLLOW is on', () => {
    expect(requiredScopes({ ...off, LAB_CHAT_INGEST: 'true' })).not.toContain(
      'moderator:read:followers',
    );
    expect(
      requiredScopes({
        ...off,
        LAB_CHAT_INGEST: 'true',
        LAB_ALERTS_FOLLOW: 'true',
      }),
    ).toEqual(['user:read:chat', 'moderator:read:followers']);
  });

  it('Random Ban V2 (RANDOM_BAN, off by default): LeCroupier_ may time out; the broadcaster reads moderators and bans', () => {
    expect(requiredScopes({ ...off, LAB_CHAT_INGEST: 'true' })).not.toContain(
      'moderator:manage:banned_users',
    );
    expect(
      requiredScopes({ ...off, LAB_CHAT_INGEST: 'true', RANDOM_BAN: 'true' }),
    ).toEqual([
      'user:read:chat',
      'moderator:read:chatters',
      'moderator:read:followers',
      'moderator:manage:banned_users',
    ]);
    expect(broadcasterScopes({})).not.toContain('moderation:read');
    expect(
      broadcasterScopes({ CHANNEL_POINTS_EVENTS: 'true', RANDOM_BAN: 'true' }),
    ).toEqual([
      'channel:read:subscriptions',
      'bits:read',
      'moderator:read:followers',
      'channel:read:redemptions',
      'moderation:read',
    ]);
  });
});
