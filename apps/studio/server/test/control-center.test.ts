import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BotStatus } from '@raptoru/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  botStatusProvider,
  describeBot,
  duration,
} from '../src/control-center/bot.js';
import {
  ControlCenter,
  type StatusProvider,
} from '../src/control-center/model.js';
import { StudioTransportError } from '../src/prod-transport/core-client.js';

// Centre de contrôle (lot 3): the bot's status as the streamer reads it, and the reusable status API.

const NOW = '2026-10-21T18:00:00.000Z';
const ago = (s: number) => new Date(Date.parse(NOW) - s * 1000).toISOString();
const READ_AT = new Date(NOW);

const active = (
  over: Partial<NonNullable<BotStatus['active']>> = {},
): NonNullable<BotStatus['active']> => ({
  instanceId: 'vps-a1b2c3-1',
  host: 'vps',
  version: '45ae1c8abcdef0123',
  startedAt: ago(3600),
  since: ago(3600),
  lastSeenAt: ago(4),
  expiresAt: ago(-41),
  health: {
    eventSubBot: true,
    eventSubBroadcaster: true,
    broadcasterToken: true,
  },
  flags: {
    CHAT_GAMES: true,
    CHAT_GAMES_OUTPUT: true,
    CHANNEL_POINTS_EVENTS: true,
    LOYALTY_TWITCH_EVENTS: true,
    ALERTS_MODE: 'active',
  },
  ...over,
});
const status = (over: Partial<BotStatus> = {}): BotStatus => ({
  now: NOW,
  state: 'active',
  active: active(),
  lastSeen: null,
  standby: [],
  ...over,
});
const fact = (s: ReturnType<typeof describeBot>, label: string) =>
  s.facts.find((f) => f.label === label);

describe('describeBot (what the streamer reads)', () => {
  it('Actif on the VPS: connected, where, Twitch connections, last signal, features', () => {
    const s = describeBot(status(), READ_AT);
    expect(s).toMatchObject({
      id: 'bot',
      level: 'ok',
      state: 'Actif',
      summary: 'Connecté à Twitch, actif sur le VPS Contabo.',
      hint: null,
    });
    expect(fact(s, 'Où')?.value).toBe('VPS Contabo · vps-a1b2c3-1');
    expect(fact(s, 'Twitch · chat (LeCroupier_)')).toMatchObject({
      value: 'Connecté',
      level: 'ok',
    });
    expect(fact(s, 'Dernier signal')?.value).toMatch(/^il y a 4 s \(/);
    expect(fact(s, 'Fonctions')?.value).toBe(
      'jeux chat, réponses chat, subs / bits / follows, points de chaîne, alertes (active)',
    );
    expect(fact(s, 'Version')?.value).toBe('45ae1c8abcde');
  });

  it('PC host named as such', () => {
    const s = describeBot(
      status({ active: active({ host: 'pc', instanceId: 'pc-AntoniPC-42' }) }),
      READ_AT,
    );
    expect(s.summary).toContain('PC de stream');
  });

  it('just started, EventSub not joined yet: « Connexion » (warn), not an error', () => {
    const s = describeBot(
      status({
        active: active({
          startedAt: ago(20),
          health: {
            eventSubBot: false,
            eventSubBroadcaster: null,
            broadcasterToken: null,
          },
        }),
      }),
      READ_AT,
    );
    expect(s).toMatchObject({ level: 'warn', state: 'Connexion' });
  });

  it('running for long without EventSub: « Erreur » with what to do', () => {
    const s = describeBot(
      status({
        active: active({
          health: {
            eventSubBot: false,
            eventSubBroadcaster: true,
            broadcasterToken: true,
          },
        }),
      }),
      READ_AT,
    );
    expect(s).toMatchObject({ level: 'error', state: 'Erreur' });
    expect(s.hint).toContain('LeCroupier_');
    expect(fact(s, 'Twitch · chat (LeCroupier_)')?.level).toBe('error');
  });

  it('broadcaster token unusable: « Erreur », reconnect raptoru_', () => {
    const s = describeBot(
      status({
        active: active({
          health: {
            eventSubBot: true,
            eventSubBroadcaster: null,
            broadcasterToken: false,
          },
        }),
      }),
      READ_AT,
    );
    expect(s.level).toBe('error');
    expect(s.hint).toContain('raptoru_');
    expect(fact(s, 'Twitch · subs, bits, points (raptoru_)')?.value).toBe(
      'Non utilisé',
    );
  });

  it('late signal (> 30 s) but lease still valid: Actif with a warning', () => {
    const s = describeBot(
      status({ active: active({ lastSeenAt: ago(35) }) }),
      READ_AT,
    );
    expect(s).toMatchObject({ level: 'warn', state: 'Actif' });
    expect(fact(s, 'Dernier signal')?.level).toBe('warn');
  });

  it('an instance waiting while another is active: still Actif, the waiting one listed', () => {
    const s = describeBot(
      status({
        standby: [
          {
            instanceId: 'pc-AntoniPC-7',
            host: 'pc',
            version: 'dev',
            lastSeenAt: ago(3),
          },
        ],
      }),
      READ_AT,
    );
    expect(s).toMatchObject({ level: 'warn', state: 'Actif' });
    expect(s.summary).toContain('aucun double bot');
    expect(fact(s, 'Instance en attente')?.value).toContain('PC de stream');
  });

  it('lease expired without a clean stop: « Déconnecté » since …, with the host-specific fix', () => {
    const vps = describeBot(
      status({
        state: 'stale',
        active: active({ lastSeenAt: ago(125) }),
      }),
      READ_AT,
    );
    expect(vps).toMatchObject({ level: 'error', state: 'Déconnecté' });
    expect(vps.summary).toContain('2 min 05 s');
    expect(vps.hint).toContain('Coolify');
    const pc = describeBot(
      status({
        state: 'stale',
        active: active({ host: 'pc', lastSeenAt: ago(60) }),
      }),
      READ_AT,
    );
    expect(pc.hint).toContain('fenêtre fermée');
  });

  it('no holder, an instance waiting: « En attente »', () => {
    const s = describeBot(
      status({
        state: 'stale',
        active: null,
        standby: [
          {
            instanceId: 'vps-x-1',
            host: 'vps',
            version: 'dev',
            lastSeenAt: ago(2),
          },
        ],
      }),
      READ_AT,
    );
    expect(s).toMatchObject({ level: 'warn', state: 'En attente' });
  });

  it('clean stop: « Arrêté » with the time, how to start it', () => {
    const s = describeBot(
      status({
        state: 'stale',
        active: null,
        lastSeen: {
          instanceId: 'vps-x-1',
          host: 'vps',
          version: 'dev',
          state: 'released',
          lastSeenAt: ago(600),
        },
      }),
      READ_AT,
    );
    expect(s).toMatchObject({ level: 'off', state: 'Arrêté' });
    expect(s.hint).toContain('Démarrer');
  });

  it('no bot ever seen (today’s PC bot predates the lease): « Non suivi », never « Déconnecté »', () => {
    const s = describeBot(
      status({ state: 'none', active: null, lastSeen: null }),
      READ_AT,
    );
    expect(s).toMatchObject({ level: 'warn', state: 'Non suivi' });
    expect(s.summary).toContain('version antérieure');
  });

  it('ages come from the Core clock, not the PC clock', () => {
    // The PC is 10 min late: the age stays 4 s (status.now − lastSeenAt).
    const s = describeBot(status(), new Date(Date.parse(NOW) - 600_000));
    expect(fact(s, 'Dernier signal')?.value).toMatch(/^il y a 4 s/);
  });

  it('duration', () => {
    expect(duration(4_000)).toBe('4 s');
    expect(duration(125_000)).toBe('2 min 05 s');
    expect(duration(3 * 3600_000 + 12 * 60_000)).toBe('3 h 12 min');
  });
});

describe('botStatusProvider', () => {
  const coreOf =
    (answer: () => Promise<unknown>) =>
    <T>(path: string) => {
      expect(path).toBe('/v1/studio/status/bot');
      return answer() as Promise<T>;
    };

  it('Production: reads the Core status (GET, no body)', async () => {
    const s = await botStatusProvider(
      coreOf(async () => status()),
      () => READ_AT,
    ).read();
    expect(s.state).toBe('Actif');
  });

  it('Lab profile: not followed (off), no Core call', async () => {
    const s = await botStatusProvider(null, () => READ_AT).read();
    expect(s).toMatchObject({ level: 'off', state: 'Non suivi' });
  });

  it('a Core without the route (404): « Inconnu », deploy the Core', async () => {
    const s = await botStatusProvider(
      coreOf(async () => {
        throw new StudioTransportError('core_error', 'not found', 404);
      }),
      () => READ_AT,
    ).read();
    expect(s).toMatchObject({ level: 'unknown', state: 'Inconnu' });
    expect(s.hint).toContain('Déployer le Core');
  });

  it('Core unreachable or a malformed answer: « Inconnu », never a fake state', async () => {
    for (const answer of [
      async () => {
        throw new StudioTransportError('core_unreachable', 'timeout');
      },
      async () => ({ state: 'active' }),
    ]) {
      const s = await botStatusProvider(coreOf(answer), () => READ_AT).read();
      expect(s.level).toBe('unknown');
      expect(s.summary).toContain('ne joint pas');
    }
  });
});

describe('ControlCenter (GET /api/control/status)', () => {
  let server: Server | undefined;
  afterEach(
    () => new Promise<void>((r) => (server ? server.close(() => r()) : r())),
  );

  async function start(providers: StatusProvider[]) {
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!(await center.handle(req, res, url))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const center = new ControlCenter(origin, providers, () => READ_AT);
    return origin;
  }
  const ok = (id: string): StatusProvider => ({
    id,
    label: id,
    read: async () => ({
      id,
      label: id,
      level: 'ok',
      state: 'Actif',
      summary: '',
      facts: [],
      hint: null,
      checkedAt: NOW,
    }),
  });

  it('every module, in order; a failing or hanging provider reads « Inconnu » alone', async () => {
    const origin = await start([
      ok('bot'),
      {
        id: 'broken',
        label: 'Cassé',
        read: async () => {
          throw new Error('boom');
        },
      },
      ok('next'),
    ]);
    const res = await fetch(`${origin}/api/control/status`, {
      headers: { 'x-raptoru-studio': '1' },
    });
    const body = (await res.json()) as {
      modules: { id: string; level: string; summary: string }[];
    };
    expect(body.modules.map((m) => [m.id, m.level])).toEqual([
      ['bot', 'ok'],
      ['broken', 'unknown'],
      ['next', 'ok'],
    ]);
    expect(body.modules[1]!.summary).toContain('boom');
  });

  it('a hanging provider gives up after 4 s, the others answer', async () => {
    vi.useFakeTimers();
    try {
      const center = new ControlCenter(
        'http://127.0.0.1:1',
        [
          ok('bot'),
          { id: 'slow', label: 'Lent', read: () => new Promise(() => {}) },
        ],
        () => READ_AT,
      );
      const pending = center.statuses();
      await vi.advanceTimersByTimeAsync(4_000);
      const modules = await pending;
      expect(modules.map((m) => [m.id, m.level])).toEqual([
        ['bot', 'ok'],
        ['slow', 'unknown'],
      ]);
      expect(modules[1]!.summary).toContain('trop longue');
    } finally {
      vi.useRealTimers();
    }
  });

  it('local Studio page only: without the Studio header or from another origin → 403', async () => {
    const origin = await start([ok('bot')]);
    expect((await fetch(`${origin}/api/control/status`)).status).toBe(403);
    expect(
      (
        await fetch(`${origin}/api/control/status`, {
          headers: { 'x-raptoru-studio': '1', origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
  });
});
