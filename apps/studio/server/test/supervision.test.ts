import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { botTwitchHint } from '../src/control-center/bot.js';
import {
  CORE_FRESH_MS,
  interactionsStatusProvider,
  readSignals,
  type InteractionSources,
  type Signal,
} from '../src/supervision/signals.js';
import {
  CONFIRM_MS,
  STARTUP_GRACE_MS,
  Supervisor,
} from '../src/supervision/supervisor.js';

const NOW = Date.parse('2026-10-22T20:40:00Z');

function sources(over: Partial<InteractionSources> = {}): InteractionSources {
  return {
    link: { state: 'connected', detail: null },
    tts: {
      ready: true,
      error: null,
      lastHeartbeat: NOW - 1000,
      moduleState: 'active',
      playerInfo: { voices: 13, seen_ms_ago: 400 },
    },
    sound: { ready: true, error: null, lastHeartbeat: NOW - 1000 },
    bonk: {
      obsConnected: true,
      obsReconnecting: false,
      obsError: null,
      sourceReady: true,
      overlayReady: true,
      error: null,
      lastHeartbeat: NOW - 1000,
    },
    ...over,
  };
}
const byId = (signals: Signal[], id: string) =>
  signals.find((s) => s.id === id)!;

describe('signals: the Core admission rules seen from Studio', () => {
  it('everything fresh and ready: no refusal', () => {
    const s = readSignals(sources(), NOW);
    expect(s.map((x) => [x.id, x.level])).toEqual([
      ['core-link', 'ok'],
      ['tts', 'ok'],
      ['soundboard', 'ok'],
      ['bonk', 'ok'],
    ]);
  });

  it('a heartbeat older than the Core freshness = studio_offline (the Core refuses), automatic retry', () => {
    const s = readSignals(
      sources({
        sound: {
          ready: true,
          error: 'core timeout',
          lastHeartbeat: NOW - CORE_FRESH_MS - 1,
        },
      }),
      NOW,
    );
    expect(byId(s, 'soundboard')).toMatchObject({
      level: 'error',
      cause: 'studio_offline',
      action: 'auto',
    });
    expect(byId(s, 'soundboard').hint).toContain('core timeout');
    // Exactly at the limit the Core still accepts.
    expect(
      byId(
        readSignals(
          sources({
            sound: {
              ready: true,
              error: null,
              lastHeartbeat: NOW - CORE_FRESH_MS,
            },
          }),
          NOW,
        ),
        'soundboard',
      ).level,
    ).toBe('ok');
  });

  it('never a heartbeat yet = studio_offline', () => {
    const s = readSignals(
      sources({ sound: { ready: true, error: null, lastHeartbeat: 0 } }),
      NOW,
    );
    expect(byId(s, 'soundboard').cause).toBe('studio_offline');
  });

  it('player / overlay / OBS: the precise refusal code and whether an action is needed', () => {
    const s = readSignals(
      sources({
        tts: {
          ready: false,
          error: null,
          lastHeartbeat: NOW - 500,
          moduleState: 'active',
          playerInfo: { voices: 0, seen_ms_ago: 60_000 },
        },
        sound: { ready: false, error: null, lastHeartbeat: NOW - 500 },
        bonk: {
          obsConnected: true,
          obsReconnecting: false,
          obsError: null,
          sourceReady: true,
          overlayReady: false,
          error: null,
          lastHeartbeat: NOW - 500,
        },
      }),
      NOW,
    );
    expect(byId(s, 'tts')).toMatchObject({
      cause: 'player_offline',
      action: 'manual',
    });
    expect(byId(s, 'soundboard')).toMatchObject({
      cause: 'player_offline',
      action: 'manual',
    });
    expect(byId(s, 'bonk')).toMatchObject({
      cause: 'overlay_not_ready',
      value: 'Overlay absent',
    });
    const obs = readSignals(
      sources({
        bonk: {
          obsConnected: false,
          obsReconnecting: true,
          obsError: 'obs_connect_timeout',
          sourceReady: false,
          overlayReady: false,
          error: null,
          lastHeartbeat: NOW - 500,
        },
      }),
      NOW,
    );
    expect(byId(obs, 'bonk')).toMatchObject({
      cause: 'obs_offline',
      action: 'auto',
    });
  });

  it('a streamer setting (TTS paused) is off, never an incident; a passing worker error keeps a served module green', () => {
    const s = readSignals(
      sources({
        tts: {
          ready: false,
          error: null,
          lastHeartbeat: 0,
          moduleState: 'paused',
          playerInfo: null,
        },
        sound: {
          ready: true,
          error: 'core_unavailable',
          lastHeartbeat: NOW - 500,
        },
      }),
      NOW,
    );
    expect(byId(s, 'tts').level).toBe('off');
    // Fresh heartbeat + ready: the Core serves it. The error stays readable, never « Réserve » (flicker after recovery).
    expect(byId(s, 'soundboard')).toMatchObject({
      level: 'ok',
      cause: null,
      value: 'Prêt · erreur passagère',
    });
    expect(byId(s, 'soundboard').hint).toContain('core_unavailable');
  });

  it('Soundboard cut on purpose (« Couper le son »): off, never an outage; a lost player is still an outage', () => {
    const cut = readSignals(
      sources({
        sound: {
          ready: false,
          error: null,
          lastHeartbeat: NOW - 500,
          cutOnPurpose: true,
        },
      }),
      NOW,
    );
    expect(byId(cut, 'soundboard')).toMatchObject({
      level: 'off',
      cause: null,
      value: 'Son coupé (volontaire)',
    });
    const lost = readSignals(
      sources({
        sound: {
          ready: false,
          error: null,
          lastHeartbeat: NOW - 500,
          cutOnPurpose: false,
        },
      }),
      NOW,
    );
    expect(byId(lost, 'soundboard')).toMatchObject({
      level: 'error',
      cause: 'player_offline',
    });
  });

  it('Studio ↔ Core link: unreachable retries alone, a revoked installation needs the streamer', () => {
    expect(
      byId(
        readSignals(
          sources({
            link: { state: 'core_unreachable', detail: 'core timeout' },
          }),
          NOW,
        ),
        'core-link',
      ),
    ).toMatchObject({ level: 'error', action: 'auto' });
    expect(
      byId(
        readSignals(sources({ link: { state: 'revoked', detail: null } }), NOW),
        'core-link',
      ),
    ).toMatchObject({ level: 'error', action: 'manual' });
    // Lab profile: no production link, no signal for it.
    expect(
      readSignals(sources({ link: null }), NOW).some(
        (x) => x.id === 'core-link',
      ),
    ).toBe(false);
  });

  it('Centre de contrôle tile: the worst level wins and names who is refused', async () => {
    const tile = await interactionsStatusProvider(() =>
      readSignals(
        sources({
          sound: { ready: false, error: null, lastHeartbeat: NOW - 500 },
        }),
        NOW,
      ),
    ).read();
    expect(tile).toMatchObject({ level: 'error', state: 'Indisponible' });
    expect(tile.summary).toContain('Soundboard');
    expect(tile.facts.map((f) => f.label)).toEqual([
      'Studio ↔ Core',
      'TTS',
      'Soundboard',
      'Bonk',
    ]);
  });
});

function signal(
  level: Signal['level'],
  cause: string | null = 'player_offline',
): Signal[] {
  return [
    {
      id: 'soundboard',
      label: 'Soundboard',
      level,
      value: level === 'error' ? 'Lecteur absent' : 'Prêt',
      cause: level === 'error' ? cause : null,
      action: level === 'error' ? 'manual' : null,
      hint: null,
    },
  ];
}

function supervisor(graceMs = 0) {
  const lines: string[] = [];
  let now = NOW;
  const s = new Supervisor({
    read: async () => [],
    log: (l) => lines.push(l),
    now: () => now,
    graceMs,
  });
  return { s, lines, at: (ms: number) => (now = NOW + ms) };
}

describe('supervisor: microcoupures, confirmed incidents, recovery', () => {
  it('startup: nothing counted during the grace (players reconnecting); still down after it → counted from there', () => {
    const f = supervisor(STARTUP_GRACE_MS);
    f.s.observe(signal('error'), NOW);
    f.s.observe(signal('ok'), NOW + 8000); // the player came back during the grace: silent
    f.s.observe(signal('error'), NOW + 10_000);
    expect(f.lines).toEqual([]);
    f.s.observe(signal('error'), NOW + STARTUP_GRACE_MS);
    expect(f.lines).toHaveLength(1);
    f.s.observe(signal('error'), NOW + STARTUP_GRACE_MS + CONFIRM_MS - 1);
    expect(f.s.snapshot().incidents).toEqual([]);
    f.s.observe(signal('error'), NOW + STARTUP_GRACE_MS + CONFIRM_MS);
    expect(f.s.snapshot().incidents).toHaveLength(1);
  });

  it('nothing changes → no log line', () => {
    const f = supervisor();
    f.s.observe(signal('ok'), NOW);
    f.s.observe(signal('ok'), NOW + 5000);
    expect(f.lines).toEqual([]);
    expect(f.s.snapshot().history).toEqual([]);
  });

  it('a 20 s outage is a microcoupure: logged and in the history, never an incident', () => {
    const f = supervisor();
    f.s.observe(signal('error'), NOW);
    f.s.observe(signal('error'), NOW + 20_000);
    f.s.observe(signal('ok'), NOW + 20_000);
    const snap = f.s.snapshot();
    expect(snap.incidents).toEqual([]);
    expect(snap.history.map((h) => h.kind)).toEqual(['micro', 'down']);
    expect(f.lines).toEqual([
      '[supervision] Soundboard : indisponible (player_offline) — Lecteur absent',
      '[supervision] Soundboard : microcoupure de 20 s, rétablie seule',
    ]);
  });

  it('confirmed at 30 s exactly, not before; one incident however long it lasts; then recovered until « Vu »', () => {
    const f = supervisor();
    f.s.observe(signal('error'), NOW);
    f.s.observe(signal('error'), NOW + CONFIRM_MS - 1);
    expect(f.s.snapshot().incidents).toEqual([]);
    f.s.observe(signal('error'), NOW + CONFIRM_MS);
    f.s.observe(signal('error'), NOW + 5 * 60_000);
    let incidents = f.s.snapshot().incidents;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      label: 'Soundboard',
      cause: 'player_offline',
      action: 'manual',
      startedAt: new Date(NOW).toISOString(),
      endedAt: null,
    });
    const id = incidents[0]!.id;
    expect(f.s.acknowledge(id)).toBe('active'); // an ongoing incident stays on screen
    f.s.observe(signal('ok'), NOW + 12 * 60_000 + 30_000);
    incidents = f.s.snapshot().incidents;
    expect(incidents[0]!.endedAt).toBe(
      new Date(NOW + 12 * 60_000 + 30_000).toISOString(),
    );
    expect(f.lines.at(-1)).toBe(
      '[supervision] Soundboard : rétabli après 12 min 30 s',
    );
    expect(f.s.acknowledge(id)).toBe('ok');
    expect(f.s.snapshot().incidents).toEqual([]);
    expect(f.s.acknowledge('nope')).toBe('unknown');
  });

  it('a cause change while down is logged once and updates the incident', () => {
    const f = supervisor();
    f.s.observe(signal('error', 'player_offline'), NOW);
    f.s.observe(signal('error', 'player_offline'), NOW + CONFIRM_MS);
    f.s.observe(signal('error', 'studio_offline'), NOW + CONFIRM_MS + 5000);
    f.s.observe(signal('error', 'studio_offline'), NOW + CONFIRM_MS + 10_000);
    expect(f.lines.filter((l) => l.includes('nouvelle cause'))).toHaveLength(1);
    expect(f.s.snapshot().incidents[0]!.cause).toBe('studio_offline');
  });

  it('a module that disappears ends its outage', () => {
    const f = supervisor();
    f.s.observe(signal('error'), NOW);
    f.s.observe([], NOW + 3000);
    expect(f.lines.at(-1)).toBe(
      '[supervision] Soundboard : microcoupure de 3 s, rétablie seule',
    );
  });

  it('history is bounded to the 50 latest changes', () => {
    const f = supervisor();
    for (let i = 0; i < 40; i++) {
      f.s.observe(signal('error'), NOW + i * 2000);
      f.s.observe(signal('ok'), NOW + i * 2000 + 1000);
    }
    expect(f.s.snapshot().history).toHaveLength(50);
  });
});

function req(
  method: string,
  path: string,
  body = '',
  headers: Record<string, string> = {},
) {
  const r = Readable.from(body ? [body] : []) as IncomingMessage;
  r.method = method;
  r.url = path;
  r.headers = { host: '127.0.0.1:4100', 'x-raptoru-studio': '1', ...headers };
  return r;
}
function res() {
  const out = { status: 0, body: '' };
  const r = {
    writeHead: (s: number) => ((out.status = s), r),
    end: (b: string) => ((out.body = b), r),
  } as unknown as ServerResponse;
  return { r, out };
}

describe('/api/supervision', () => {
  const ORIGIN = 'http://127.0.0.1:4100';
  it('Studio pages only; « Vu » refuses an ongoing incident and accepts an ended one', async () => {
    const f = supervisor();
    f.s.observe(signal('error'), NOW);
    f.s.observe(signal('error'), NOW + CONFIRM_MS);
    const id = f.s.snapshot().incidents[0]!.id;
    const call = async (r: IncomingMessage) => {
      const x = res();
      expect(await f.s.handle(r, x.r, new URL(r.url!, ORIGIN), ORIGIN)).toBe(
        true,
      );
      return x.out;
    };
    expect(
      (
        await call(
          req('GET', '/api/supervision', '', { 'x-raptoru-studio': '' }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          req('GET', '/api/supervision', '', {
            origin: 'https://evil.example',
          }),
        )
      ).status,
    ).toBe(403);
    const ok = await call(req('GET', '/api/supervision'));
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).incidents).toHaveLength(1);
    expect(
      (await call(req('POST', '/api/supervision/ack', JSON.stringify({ id }))))
        .status,
    ).toBe(409);
    f.s.observe(signal('ok'), NOW + CONFIRM_MS + 1000);
    expect(
      (await call(req('POST', '/api/supervision/ack', JSON.stringify({ id }))))
        .status,
    ).toBe(200);
    expect(
      (await call(req('POST', '/api/supervision/ack', '{bad'))).status,
    ).toBe(404);
    const other = res();
    expect(
      await f.s.handle(
        req('GET', '/api/other'),
        other.r,
        new URL('/api/other', ORIGIN),
        ORIGIN,
      ),
    ).toBe(false);
  });
});

describe('bot hint (incident 22/10, F1): never the PC tokens for a bot on the VPS', () => {
  it('VPS: automatic reconnection and the bot log, no « Connexions Twitch » remedy', () => {
    expect(botTwitchHint('vps', false)).not.toContain(
      'Studio → Connexions Twitch',
    );
    expect(botTwitchHint('vps', false)).toContain('Coolify');
    expect(botTwitchHint('vps', true)).toContain('BOT_VPS_CUTOVER');
    expect(botTwitchHint('vps', true)).not.toContain(
      'Studio → Connexions Twitch',
    );
  });
  it('a bot on this PC still reads this PC tokens: the panel stays the remedy', () => {
    expect(botTwitchHint('pc', true)).toContain('Studio → Connexions Twitch');
  });
});
