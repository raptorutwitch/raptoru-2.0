import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyExtensionJwt } from '../../../core-api/src/ext/twitch-jwt.js';
import { LAB_TWITCH_USERS } from '../../../core-api/src/lab/environment.js';
import {
  labExtensionToken,
  labRoleOf,
} from '../src/extension-lab/core-frontier.js';

// The Extension Lab on the main Core's /v1/ext: the JWT Studio signs is checked by the Core's OWN verifier (the one that
// checks Twitch's tokens in Production), for every Lab role, with and without the shared identity.

const f = {
  coreUrl: 'http://127.0.0.1:1',
  extensionSecret: randomBytes(32),
  channelId: '900100',
};

describe('Lab JWT of the Extension Lab', () => {
  it('accepted by the Core for each fictional account; user_id only when the identity is shared', () => {
    for (const role of ['viewer', 'moderator', 'broadcaster'] as const) {
      const shared = verifyExtensionJwt(
        `Bearer ${labExtensionToken(f, role, true)}`,
        { secret: f.extensionSecret, channelId: f.channelId },
      );
      expect(shared.role).toBe(role);
      expect(LAB_TWITCH_USERS.map((u) => u.id)).toContain(shared.userId);
      const hidden = verifyExtensionJwt(
        `Bearer ${labExtensionToken(f, role, false)}`,
        { secret: f.extensionSecret, channelId: f.channelId },
      );
      expect(hidden.userId).toBeNull();
      expect(hidden.opaqueUserId).toBe(shared.opaqueUserId);
    }
  });

  it('another secret, another channel or an expired token: refused by the Core', () => {
    const token = labExtensionToken(f, 'viewer', true, 1_000);
    expect(() =>
      verifyExtensionJwt(`Bearer ${token}`, {
        secret: randomBytes(32),
        channelId: f.channelId,
        nowS: 1_000,
      }),
    ).toThrow();
    expect(() =>
      verifyExtensionJwt(`Bearer ${token}`, {
        secret: f.extensionSecret,
        channelId: '83603689',
        nowS: 1_000,
      }),
    ).toThrow(/wrong_channel/);
    expect(() =>
      verifyExtensionJwt(`Bearer ${token}`, {
        secret: f.extensionSecret,
        channelId: '900100',
        nowS: 1_000 + 2 * 86_400,
      }),
    ).toThrow(/token_expired/);
  });

  it('an unknown role is the viewer (never a broader one)', () => {
    expect(labRoleOf('admin')).toBe('viewer');
    expect(labRoleOf(null)).toBe('viewer');
    expect(labRoleOf('moderator')).toBe('moderator');
  });
});
