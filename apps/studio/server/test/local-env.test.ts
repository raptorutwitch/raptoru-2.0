import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Packaged Studio: code (REPO_ROOT) and local data (DATA_ROOT) are apart. local-env reads both at
// import time, so every case loads a fresh module with its own roots.
const KEYS = [
  'RAPTORU_ROOT',
  'RAPTORU_DATA_ROOT',
  'LAB_CHAT_JOURNAL_FILE',
  'LOYALTY_OUTBOX_FILE',
  'TWITCH_TOKEN_FILE',
  'TWITCH_BROADCASTER_TOKEN_FILE',
] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

async function roots() {
  const code = await mkdtemp(join(tmpdir(), 'studio-code-'));
  const data = await mkdtemp(join(tmpdir(), 'studio-data-'));
  for (const r of [code, data])
    mkdirSync(join(r, 'apps', 'twitch-bot'), { recursive: true });
  for (const k of KEYS) delete process.env[k];
  process.env.RAPTORU_ROOT = code;
  process.env.RAPTORU_DATA_ROOT = data;
  vi.resetModules();
  const env = await import('../src/test-lab/local-env.js');
  return {
    code: join(code, 'apps', 'twitch-bot', '.lab-chat-journal.json'),
    data: join(data, 'apps', 'twitch-bot', '.lab-chat-journal.json'),
    env,
  };
}

describe('Commands V2 chat journal lives with the local data, never next to the code', () => {
  it('points the bot at DATA_ROOT', async () => {
    const { data, env } = await roots();
    env.applyDataRootEnv();
    expect(process.env.LAB_CHAT_JOURNAL_FILE).toBe(data);
  });

  it('carries an older journal over once, without overwriting a newer one', async () => {
    const r = await roots();
    writeFileSync(r.code, '{"entries":[{"step_id":"s1"}]}');
    r.env.applyDataRootEnv();
    expect(readFileSync(r.data, 'utf8')).toContain('s1');
    // Later start: the data journal moved on, the stale copy next to the code is ignored.
    writeFileSync(r.data, '{"entries":[]}');
    delete process.env.LAB_CHAT_JOURNAL_FILE;
    r.env.applyDataRootEnv();
    expect(readFileSync(r.data, 'utf8')).toBe('{"entries":[]}');
  });

  it('an explicit setting wins, and nothing is copied', async () => {
    const r = await roots();
    writeFileSync(r.code, '{"entries":[]}');
    process.env.LAB_CHAT_JOURNAL_FILE = 'C:/custom/journal.json';
    r.env.applyDataRootEnv();
    expect(process.env.LAB_CHAT_JOURNAL_FILE).toBe('C:/custom/journal.json');
    expect(existsSync(r.data)).toBe(false);
  });
});
