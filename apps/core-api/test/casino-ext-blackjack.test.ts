import { describe, expect, it } from 'vitest';
import { casinoExt } from '../src/ext/casino-ext.js';

// The extension's door to the Blackjack (docs/CASINO.md § 18): the verified viewer + the intent's own fields reach the
// Core — `new_table` (a table of one's own), `r` (a reaction id), `rx` (the last reaction a screen has) — and nothing
// else; an anonymous viewer may watch, never react.

const CH = '83603689';
const viewer = { id: '9001', display_name: 'Fictif' };

function fakeCore() {
  const calls: { path: string; body?: unknown }[] = [];
  const core = async <T>(path: string, body?: unknown) => {
    calls.push({ path, body });
    return {} as T;
  };
  return { core, calls };
}

describe('casino-ext: Blackjack tables and reactions', () => {
  it('« new table » and a reaction carry only the intent’s fields, with the verified viewer', async () => {
    const { core, calls } = fakeCore();
    await casinoExt(
      core,
      CH,
      'POST',
      '/casino/bj/join',
      { new_table: true, viewer: { id: '1' }, extra: 1 },
      viewer,
    );
    await casinoExt(
      core,
      CH,
      'POST',
      '/casino/bj/react',
      { r: 'r7', text: '<b>libre</b>' },
      viewer,
    );
    expect(calls).toEqual([
      {
        path: `/v1/lab/casino/${CH}/bj/join`,
        body: { viewer, new_table: true },
      },
      { path: `/v1/lab/casino/${CH}/bj/react`, body: { viewer, r: 'r7' } },
    ]);
  });

  it('the table state passes `rx` only when the screen sends it (an older screen keeps the old long-poll)', async () => {
    const { core, calls } = fakeCore();
    const t = '00000000-0000-4000-8000-000000000001';
    await casinoExt(
      core,
      CH,
      'GET',
      `/casino/bj/state?table=${t}&after=4&wait_ms=20000&rx=1764000000000`,
      undefined,
      viewer,
    );
    await casinoExt(
      core,
      CH,
      'GET',
      `/casino/bj/state?table=${t}&after=4&wait_ms=20000`,
      undefined,
      null,
    );
    expect(calls[0]!.path).toBe(
      `/v1/lab/casino/${CH}/bj/state?table=${t}&after=4&wait_ms=20000&rx=1764000000000&viewer_id=9001&viewer_name=Fictif`,
    );
    expect(calls[1]!.path).toBe(
      `/v1/lab/casino/${CH}/bj/state?table=${t}&after=4&wait_ms=20000`,
    );
  });

  it('an anonymous viewer may watch but never react', async () => {
    const { core, calls } = fakeCore();
    const out = await casinoExt(
      core,
      CH,
      'POST',
      '/casino/bj/react',
      { r: 'r1' },
      null,
    );
    expect(out).toEqual({
      status: 403,
      body: { ok: false, error: 'identity_required' },
    });
    expect(calls).toEqual([]);
  });
});
