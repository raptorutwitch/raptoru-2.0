import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  isLoopbackDatabase,
  labEnvironmentProblems,
  labUserLookup,
} from '../src/lab/environment.js';

// The main Core in its Lab environment (two environments: local Lab, Production VPS): the same entry point, refused at
// start when anything real is configured.

const LAB = {
  CORE_ENVIRONMENT: 'lab',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/raptoru_core_lab',
  TWITCH_CHANNEL_ID: '900100',
  BOT_SECRET: 'b'.repeat(20),
  STUDIO_SECRET: 's'.repeat(20),
};

describe('Lab environment of the main Core', () => {
  it('a valid Lab configuration starts; a non-Lab one is never judged here', () => {
    expect(labEnvironmentProblems(loadConfig(LAB))).toEqual([]);
    expect(
      labEnvironmentProblems(
        loadConfig({
          ...LAB,
          CORE_ENVIRONMENT: undefined,
          DATABASE_URL: 'postgres://db.example.com/x',
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a remote database, the real channel, the real Twitch app and the delivery token', () => {
    const problems = labEnvironmentProblems(
      loadConfig({
        ...LAB,
        DATABASE_URL: 'postgres://u:p@db.example.com:5432/raptoru_core_lab',
        TWITCH_CHANNEL_ID: '83603689',
        TWITCH_APP_CLIENT_ID: 'real',
        TWITCH_APP_CLIENT_SECRET: 'real',
        OPS_TOKEN: 'o'.repeat(40),
      }),
    );
    expect(problems.join(' | ')).toMatch(/DATABASE_URL/);
    expect(problems.join(' | ')).toMatch(/TWITCH_CHANNEL_ID/);
    expect(problems.join(' | ')).toMatch(/TWITCH_APP_CLIENT_ID/);
    expect(problems.join(' | ')).toMatch(/TWITCH_APP_CLIENT_SECRET/);
    expect(problems.join(' | ')).toMatch(/OPS_TOKEN/);
    // A Lab without a channel is refused too (the frontier would be off: nothing to test).
    expect(
      labEnvironmentProblems(
        loadConfig({ ...LAB, TWITCH_CHANNEL_ID: undefined }),
      ),
    ).toHaveLength(1);
  });

  it('loopback only; unparsable strings are not loopback', () => {
    expect(isLoopbackDatabase('postgres://u@localhost/x')).toBe(true);
    expect(isLoopbackDatabase('postgres://u@[::1]:5432/x')).toBe(true);
    expect(isLoopbackDatabase('postgres://u@10.0.0.2/x')).toBe(false);
    expect(isLoopbackDatabase('host=127.0.0.1 dbname=x')).toBe(false);
  });

  it('the fictional Twitch directory names the Lab accounts only, without a request', async () => {
    expect(await labUserLookup(['900101', '123'])).toEqual([
      {
        id: '900101',
        login: 'lab_viewer',
        display_name: 'Viewer Lab',
        profile_image_url: '',
      },
    ]);
  });
});
