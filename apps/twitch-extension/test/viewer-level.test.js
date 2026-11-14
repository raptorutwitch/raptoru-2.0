import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../extension/shared/api.js';
import { viewerLevelSummary } from '../extension/shared/viewer-level.js';

// Level Up V2 (docs/LEVEL_UP_V2.md § 6): « Mon niveau » in the extension's preferences.
describe('Mon niveau', () => {
  it('the level, the XP towards the next level (1 000 per level), the badges owned', () => {
    expect(
      viewerLevelSummary({
        enabled: true,
        level: 12,
        xp: 11_340,
        levelXp: 11_000,
        nextLevelXp: 12_000,
        badges: [{ id: 'niveau-10' }],
      }),
    ).toEqual({
      title: 'Niveau 12',
      detail: '340 / 1\u00a0000 XP vers le niveau 13',
      ratio: 0.34,
      badges: '1 badge débloqué',
    });
    // A new viewer: level 1, nothing yet; no badge line.
    expect(
      viewerLevelSummary({ enabled: true, level: 1, xp: 0, levelXp: 0, nextLevelXp: 1000, badges: [] }),
    ).toMatchObject({ title: 'Niveau 1', ratio: 0, badges: '' });
    // The progression off, or no answer: nothing to show.
    expect(viewerLevelSummary({ enabled: false, level: 3 })).toBeNull();
    expect(viewerLevelSummary(null)).toBeNull();
  });

  it('the client reads it for the viewer of the token (GET /viewer/progression)', async () => {
    const urls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      urls.push([init.method, String(url)]);
      return new Response(JSON.stringify({ ok: true, enabled: true, level: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const api = createClient({
      getToken: () => 'tok',
      apiBase: '/ext-lab/api', // an allowed base (shared/runtime-guard.js)
      demoMode: false,
      fetchImpl,
    });
    await expect(api.getViewerProgression()).resolves.toMatchObject({ level: 2 });
    expect(urls).toEqual([['GET', '/ext-lab/api/viewer/progression']]);
  });
});
