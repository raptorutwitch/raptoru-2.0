import { afterEach, describe, expect, it } from 'vitest';
import { installConsole, redact } from '../src/log.js';

// Persistent logs (plan post-live lot 2): no secret ever reaches a log line.

const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
afterEach(() => Object.assign(console, original));

describe('redact', () => {
  it('masks the configured secrets by value and token shapes', () => {
    const secret = 'bot-secret-0123456789';
    const text = [
      `calling core with ${secret}`,
      'Authorization: Bearer abcDEF123.456-xyz',
      'irc oauth:abcdef0123456789',
      '{"access_token":"tok123","refresh_token":"ref456","expires_in":3600}',
      'client_secret=shh123&grant_type=refresh_token',
    ].join('\n');
    const out = redact(text, [secret]);
    for (const leaked of [
      secret,
      'abcDEF123',
      'abcdef0123456789',
      'tok123',
      'ref456',
      'shh123',
    ])
      expect(out).not.toContain(leaked);
    expect(out).toContain('"expires_in":3600'); // the rest stays readable
    expect(out).toContain('grant_type=refresh_token');
  });

  it('ignores empty / short secrets (never masks every « a »)', () => {
    expect(redact('a normal line', ['', 'a'])).toBe('a normal line');
  });
});

describe('installConsole', () => {
  it('one line per call: UTC time, level, redacted text; errors with their message', () => {
    const lines: [string, string][] = [];
    installConsole(
      ['super-secret-value'],
      (level, line) => lines.push([level, line]),
      () => new Date('2026-10-21T10:00:00.000Z'),
    );
    console.log('[twitch-bot] token', { secret: 'super-secret-value' });
    console.error(new Error('boom super-secret-value'));
    console.warn('careful');
    expect(lines[0]).toEqual([
      'info',
      '2026-10-21T10:00:00.000Z INFO [twitch-bot] token {"secret":"***"}',
    ]);
    expect(lines[1]![0]).toBe('error');
    expect(lines[1]![1]).toMatch(
      /^2026-10-21T10:00:00\.000Z ERROR boom \*\*\*/,
    );
    expect(lines[1]![1]).not.toContain('super-secret-value');
    expect(lines[2]).toEqual(['warn', '2026-10-21T10:00:00.000Z WARN careful']);
  });
});
