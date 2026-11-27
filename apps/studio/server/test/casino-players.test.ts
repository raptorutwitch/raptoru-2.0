import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  groupByPlayer,
  signed,
  type CasinoRound,
} from '../../web/src/pages/casino-players.js';
import { casinoRelay } from '../src/casino/relay.js';
import type { LabCoreCall } from '../src/lab-moderation/proxy.js';

// Studio › Casino « Dernières parties » par joueur (pages/casino-players.ts) : une ligne par joueur, dans l'ordre de leur
// dernière partie ; son historique complet lu à part, par pages, par le relais (lecture seule).

const r = (
  id: string,
  viewer: string,
  at: string,
  bet = 100,
  payout = 0,
): CasinoRound => ({
  round_id: id,
  game: 'slot',
  bet,
  payout,
  capped: false,
  created_at: at,
  viewer_id: viewer,
  viewer_name: `V${viewer}`,
});

const cleanups: (() => unknown)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('Casino › Dernières parties par joueur', () => {
  it('une seule ligne par joueur, la plus récente activité en haut ; ses parties récentes et leur variation nette', () => {
    const recent = [
      r('a3', '1', '2026-11-27T10:05:00Z', 100, 300),
      r('b2', '2', '2026-11-27T10:04:00Z', 200, 0),
      r('a2', '1', '2026-11-27T10:03:00Z', 100, 0),
      r('c1', '3', '2026-11-27T10:06:00Z', 50, 50),
      r('a1', '1', '2026-11-27T10:01:00Z', 100, 0),
      r('b1', '2', '2026-11-27T10:00:00Z', 200, 500),
    ];
    const groups = groupByPlayer(recent);
    expect(groups.map((g) => g.viewer_id)).toEqual(['3', '1', '2']);
    expect(new Set(groups.map((g) => g.viewer_id)).size).toBe(groups.length);
    const alice = groups.find((g) => g.viewer_id === '1')!;
    expect(alice.rounds.map((x) => x.round_id)).toEqual(['a3', 'a2', 'a1']);
    expect([alice.staked, alice.won, alice.last]).toEqual([
      300,
      300,
      '2026-11-27T10:05:00Z',
    ]);
    expect(groups.reduce((n, g) => n + g.rounds.length, 0)).toBe(recent.length);
    expect(groupByPlayer([])).toEqual([]);
    expect([signed(1500), signed(-800), signed(0)]).toEqual([
      '+1 500',
      '−800',
      '0',
    ]);
  });

  it('le relais lit l’historique d’un joueur au Core admin (pages gardées, curseur invalide ignoré) et rien d’autre', async () => {
    const calls: string[] = [];
    const core = (async (path: string, body?: unknown) => {
      calls.push(`${body === undefined ? 'GET' : 'POST'} ${path}`);
      return { rounds: [], totals: { rounds: 0 }, next_before: null };
    }) as LabCoreCall;
    const relay = casinoRelay(core, '900100');
    const server = createServer((req, res) => {
      void relay(req, res, new URL(req.url!, 'http://studio')).then((done) => {
        if (!done) res.writeHead(404).end();
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    cleanups.push(() => server.close());
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = (p: string, method = 'GET') =>
      fetch(base + p, { method, headers: { 'x-raptoru-studio': '1' } });
    const cursor =
      '2026-11-27T10:05:00.000Z|0f6c2f0e-8a39-4c55-9d2e-2b8ad3c3e1a1';
    expect(
      (
        await get(
          `/api/casino/players/9001/rounds?limit=30&before=${encodeURIComponent(cursor)}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await get('/api/casino/players/9001/rounds?before=evil&limit=999'))
        .status,
    ).toBe(200);
    expect((await get('/api/casino/players/abc/rounds')).status).toBe(404);
    expect((await get('/api/casino/players/9001/rounds', 'POST')).status).toBe(
      404,
    );
    expect((await fetch(`${base}/api/casino/players/9001/rounds`)).status).toBe(
      403,
    );
    expect(calls).toEqual([
      `GET /v1/lab/casino/900100/admin/players/9001/rounds?before=${encodeURIComponent(cursor)}&limit=30`,
      'GET /v1/lab/casino/900100/admin/players/9001/rounds?limit=100',
    ]);
  });
});
