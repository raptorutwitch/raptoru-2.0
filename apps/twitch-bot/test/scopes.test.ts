import { describe, expect, it } from 'vitest';
import { requiredScopes } from '../src/config.js';

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
});
