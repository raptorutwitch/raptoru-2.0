/* global Response, URL */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../extension/shared/api.js';

// Audit 09/11 (P1): a new Twitch token (onAuthorized → resetSession) while a /state poll is in flight. The answer used to
// be merged into the emptied session: no identity, role nor channel until a reload (« Activer mes actions » for good,
// moderators back on the V1 console). The poll now reads the whole session again.

const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('session reset during a poll', () => {
  it('a /state answer that crossed a reset is not merged: /session is read again', async () => {
    const paths = [];
    let releaseState;
    const fetchImpl = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path.endsWith('/state'))
        return new Promise(
          (r) => (releaseState = () => r(json({ ok: true, live: true }))),
        );
      return json({
        ok: true,
        identity_shared: true,
        role: 'viewer',
        channel_id: '83603689',
      });
    });
    const api = createClient({
      getToken: () => 'tok',
      apiBase: 'http://ebs',
      demoMode: false,
      fetchImpl,
    });
    await api.session();
    const polled = api.refresh();
    await vi.waitFor(() => expect(releaseState).toBeTypeOf('function'));
    api.resetSession();
    releaseState();
    const s = await polled;
    expect(paths.map((p) => p.split('/').pop())).toEqual([
      'session',
      'state',
      'session',
    ]);
    expect(s).toMatchObject({
      identity_shared: true,
      role: 'viewer',
      channel_id: '83603689',
    });
    // And the next poll merges into that full session again.
    paths.length = 0;
    const next = api.refresh();
    releaseState();
    expect(await next).toMatchObject({ identity_shared: true, live: true });
    expect(paths.map((p) => p.split('/').pop())).toEqual(['state']);
  });
});
