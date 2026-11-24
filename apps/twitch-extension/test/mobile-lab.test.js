import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_PREFIX,
  benchRuntimeConfig,
  labTokenFor,
  readTwitchToken,
} from '../scripts/mobile-lab.mjs';
import { isAllowedApiBase } from '../extension/shared/runtime-guard.js';

const SECRET = Buffer.from('secret-du-core-lab-du-banc');
const jwt = (payload) =>
  `Bearer h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const claims = (token) => {
  const [h, p, s] = token.split('.');
  expect(
    createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'),
  ).toBe(s);
  return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
};

describe('banc mobile Twitch', () => {
  it('serves a runtime the extension guard accepts, diagnostic on and badge visible', () => {
    expect(isAllowedApiBase(API_PREFIX)).toBe(true);
    const src = benchRuntimeConfig('banc-mobile-abc');
    expect(src).toContain(`apiBase: '${API_PREFIX}'`);
    expect(src).toContain('diagnostics: true');
    expect(src).toContain("environment: 'banc-mobile'");
  });

  it('maps the real Twitch token to the fictional Lab account of the same role and identity', () => {
    const viewer = claims(
      labTokenFor(
        readTwitchToken(
          jwt({ role: 'viewer', user_id: '83603689', channel_id: '1' }),
        ),
        SECRET,
      ),
    );
    expect(viewer).toMatchObject({
      role: 'viewer',
      user_id: '900101',
      channel_id: '900100',
      is_unlinked: false,
    });
    const anon = claims(
      labTokenFor(
        readTwitchToken(
          jwt({ role: 'viewer', opaque_user_id: 'A123', channel_id: '1' }),
        ),
        SECRET,
      ),
    );
    expect(anon.user_id).toBeUndefined();
    expect(anon.is_unlinked).toBe(true);
    expect(
      claims(labTokenFor({ role: 'broadcaster', channel_id: '1' }, SECRET)),
    ).toMatchObject({ user_id: '900100', role: 'broadcaster' });
    expect(claims(labTokenFor({ role: 'external' }, SECRET)).role).toBe(
      'viewer',
    );
  });

  it('ignores what is not a bearer JWT', () => {
    expect(readTwitchToken(undefined)).toBeNull();
    expect(readTwitchToken('Bearer pas-un-jwt')).toBeNull();
    expect(readTwitchToken('Bearer a.%%%.c')).toBeNull();
  });
});
