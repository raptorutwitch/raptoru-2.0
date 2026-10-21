import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

// Single active production bot: the permissive fallback (a Core without the lease API) is for a local development
// Core only — a bot pointed at any other Core never starts without single-instance protection.

const env = (over: Record<string, string> = {}) => ({
  TWITCH_CLIENT_ID: 'client',
  TWITCH_CLIENT_SECRET: 'client-secret',
  TWITCH_BROADCASTER_ID: '83603689',
  CORE_API_URL: 'https://core.raptoru.fr',
  BOT_SECRET: 'bot-secret-0123456789',
  ...over,
});

describe('BOT_LEASE_OPTIONAL', () => {
  it('off by default (production Core: protection required)', () => {
    expect(loadConfig(env()).BOT_LEASE_OPTIONAL).toBe('false');
  });

  it('refused with the production Core, an internal Docker name or any non-local host', () => {
    for (const url of [
      'https://core.raptoru.fr',
      'http://3m7cputub9wt7nwx2k78cme3:3000',
      'https://core-staging.raptoru.fr',
      'http://192.168.1.20:3000',
    ])
      expect(() =>
        loadConfig(env({ CORE_API_URL: url, BOT_LEASE_OPTIONAL: 'true' })),
      ).toThrow('local development Core only');
  });

  it('accepted for a local development Core', () => {
    for (const url of [
      'http://127.0.0.1:4301',
      'http://localhost:3000',
      'http://[::1]:3000',
    ])
      expect(
        loadConfig(env({ CORE_API_URL: url, BOT_LEASE_OPTIONAL: 'true' }))
          .BOT_LEASE_OPTIONAL,
      ).toBe('true');
  });
});
