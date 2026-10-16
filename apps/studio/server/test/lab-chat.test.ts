import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXIT_AUTH,
  LabChatIngress,
  type IngressProcess,
} from '../src/lab-chat/ingress.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Single Lab chat ingress in Studio: one Twitch chat adapter for every Lab module (switch OFF by
// default, its blocking reason shown), and the chat simulator posting to the same Core entry.

let server: Server | null = null;
let dir = '';
afterEach(async () => {
  server?.close();
  server = null;
  if (dir) await rm(dir, { recursive: true, force: true });
});

interface Opts {
  /** A previous Studio session left its adapter running (stored PID still a node process). */
  orphan?: boolean;
  botRunning?: boolean;
  scopes?: string[];
  tokenPresent?: boolean;
  prerequisite?: 'bot_env_missing' | 'bot_not_built' | null;
}

interface Out {
  blocked?: { code: string; message: string } | null;
  identities?: unknown;
  [k: string]: unknown;
}

async function setup(opts: Opts = {}) {
  dir = await mkdtemp(join(tmpdir(), 'lab-chat-'));
  const calls: { path: string; body?: unknown }[] = [];
  const started: Record<string, string>[] = [];
  const events: string[] = [];
  let running = false;
  let lastExit: IngressProcess['lastExit'] = null;
  // Core's « Sortie chat réelle » state (the fake Core keeps it like the real one).
  let output = false;
  const proc: IngressProcess = {
    get running() {
      return running;
    },
    get lastExit() {
      return lastExit;
    },
    start: (env) => {
      started.push(env);
      events.push('start');
      running = true;
    },
    stop: () => {
      events.push('stop');
      running = false;
    },
    adoptPrevious: async () => {
      if (!opts.orphan) return false;
      events.push('adopt');
      running = true;
      return true;
    },
  };
  server = createServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const make = () =>
    LabChatIngress.create({
      core: (async (path: string, body?: unknown) => {
        calls.push({ path, body });
        if (path.endsWith('/output')) {
          if (body) output = (body as { enabled: boolean }).enabled;
          return { enabled: output, executor_absent: output };
        }
        return { handled: [{ module: 'raffle', outcome: 'joined' }] };
      }) as never,
      origin,
      dir: join(dir, 'lab-chat'),
      identities: () => [{ id: '900101', label: 'lab_viewer' }],
      process: proc,
      env: () => ({ LAB_CHAT_CORE_URL: 'http://127.0.0.1:4301' }),
      token: () => ({
        present: opts.tokenPresent ?? true,
        login: 'lecroupier_',
        scopes: opts.scopes ?? ['user:read:chat'],
      }),
      prerequisite: () => opts.prerequisite ?? null,
      botRunning: () => opts.botRunning ?? false,
      lines: () => ['[lab-chat] ok'],
    });
  let ing = await make();
  server.on('request', (req, res) => {
    void ing
      .handle(req, res, new URL(req.url ?? '/', origin))
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      });
  });
  const studio = async (path: string, body?: unknown) => {
    const r = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-raptoru-studio': '1',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as Out };
  };
  return {
    origin,
    calls,
    started,
    events,
    studio,
    ingress: () => ing,
    /** The adapter exits on its own (crash, refused token…). */
    exit: (code: number) => {
      running = false;
      lastExit = { code, at: new Date().toISOString() };
    },
    reload: async () => {
      ing = await make();
      return ing;
    },
  };
}

describe('Lab chat ingress (Studio)', () => {
  it('OFF by default; ON starts the single adapter; remembered across a restart; OFF stops it', async () => {
    const f = await setup();
    const st = await f.studio('/api/lab-chat/status');
    expect(st.json).toMatchObject({
      enabled: false,
      running: false,
      blocked: null,
      token_login: 'lecroupier_',
    });
    expect(f.started).toEqual([]);
    const on = await f.studio('/api/lab-chat/ingress', { enabled: true });
    expect(on.json).toMatchObject({ enabled: true, running: true });
    expect(f.started[0]).toMatchObject({
      LAB_CHAT_CORE_URL: 'http://127.0.0.1:4301',
    });
    (await f.reload()).start();
    expect(f.started).toHaveLength(1); // still running: never started twice
    const off = await f.studio('/api/lab-chat/ingress', { enabled: false });
    expect(off.json).toMatchObject({ enabled: false, running: false });
  });

  it('an adapter orphaned by a previous Studio session is stopped before anything starts: one ingestion only', async () => {
    const f = await setup({ orphan: true });
    expect(f.events).toEqual(['adopt', 'stop']);
    const on = await f.studio('/api/lab-chat/ingress', { enabled: true });
    expect(on.json).toMatchObject({ enabled: true, running: true });
    expect(f.events).toEqual(['adopt', 'stop', 'start']);
    expect(f.started).toHaveLength(1); // the new session's adapter, with the new secret
  });

  it('supervision: an adapter that exits on its own is restarted, within a budget, then shown down', async () => {
    const f = await setup();
    await f.studio('/api/lab-chat/ingress', { enabled: true });
    const t0 = Date.now();
    for (let i = 1; i <= 3; i++) {
      f.exit(1);
      f.ingress().supervise(t0 + i * 1000);
      expect(f.started).toHaveLength(1 + i); // restarted
    }
    f.exit(1);
    f.ingress().supervise(t0 + 4000); // 4th exit within 10 min: left down, reason shown
    expect(f.started).toHaveLength(4);
    const st = await f.studio('/api/lab-chat/status');
    expect(st.json).toMatchObject({
      enabled: true,
      running: false,
      blocked: { code: 'crash_loop' },
    });
    // The user's OFF / ON is the action it waited for: running again, reason gone.
    await f.studio('/api/lab-chat/ingress', { enabled: false });
    const on = await f.studio('/api/lab-chat/ingress', { enabled: true });
    expect(on.json).toMatchObject({ running: true, blocked: null });
  });

  it('supervision: a refused token is not restarted (reason shown); OFF and shutdown never restart', async () => {
    const f = await setup();
    await f.studio('/api/lab-chat/ingress', { enabled: true });
    f.exit(EXIT_AUTH);
    f.ingress().supervise();
    expect(f.started).toHaveLength(1);
    expect((await f.studio('/api/lab-chat/status')).json.blocked).toMatchObject(
      { code: 'auth_failed' },
    );
    await f.studio('/api/lab-chat/ingress', { enabled: false });
    f.ingress().supervise();
    expect(f.started).toHaveLength(1); // OFF: stays off
    await f.studio('/api/lab-chat/ingress', { enabled: true });
    expect(f.started).toHaveLength(2);
    await f.ingress().stop(); // Studio closing
    f.exit(1);
    f.ingress().supervise();
    expect(f.started).toHaveLength(2);
  });

  it('a token without user:read:chat blocks the switch with the reason shown; nothing starts or is saved', async () => {
    const f = await setup({ scopes: ['moderator:read:chatters'] });
    const st = await f.studio('/api/lab-chat/status');
    expect(st.json.blocked).toMatchObject({ code: 'missing_scope' });
    expect(st.json.blocked!.message).toContain('user:read:chat');
    const on = await f.studio('/api/lab-chat/ingress', { enabled: true });
    expect(on.status).toBe(409);
    expect(on.json).toMatchObject({ error: 'missing_scope' });
    expect(f.started).toEqual([]);
    expect((await f.studio('/api/lab-chat/status')).json.enabled).toBe(false);
  });

  it.each([
    [{ tokenPresent: false }, 'no_token'],
    [{ prerequisite: 'bot_env_missing' as const }, 'bot_env_missing'],
    [{ prerequisite: 'bot_not_built' as const }, 'bot_not_built'],
    [{ botRunning: true }, 'bot_running'],
  ])('blocked reason %o → %s', async (opts, code) => {
    const f = await setup(opts);
    expect((await f.studio('/api/lab-chat/status')).json.blocked!.code).toBe(
      code,
    );
    expect(
      (await f.studio('/api/lab-chat/ingress', { enabled: true })).status,
    ).toBe(409);
    expect(f.started).toEqual([]);
  });

  it('the simulator posts to the generic Core chat entry (every module), role sanitized', async () => {
    const f = await setup();
    const out = await f.studio('/api/lab-chat/simulate', {
      viewer_id: '900101',
      display_name: 'lab_viewer',
      text: '!join',
      role: 'admin',
    });
    expect(out.json).toEqual({
      handled: [{ module: 'raffle', outcome: 'joined' }],
    });
    const sent = f.calls.at(-1)!;
    expect(sent.path).toBe('/v1/lab/chat');
    expect(sent.body).toMatchObject({
      channel_id: '900100',
      text: '!join',
      chatter: { id: '900101', display_name: 'lab_viewer', role: 'viewer' },
      source: 'simulator',
    });
    expect(
      (await f.studio('/api/lab-chat/identities')).json.identities,
    ).toEqual([{ id: '900101', label: 'lab_viewer' }]);
  });

  it('Simulation chat: the last received messages are read from Core (GET only, nothing written)', async () => {
    const f = await setup();
    const out = await f.studio('/api/lab-chat/recent');
    expect(out.status).toBe(200);
    expect(f.calls.at(-1)).toEqual({
      path: '/v1/lab/chat/900100/recent',
      body: undefined,
    });
  });

  it('« Sortie chat réelle »: ON refused without user:write:chat (nothing sent to Core); OFF always allowed', async () => {
    const f = await setup();
    const on = await f.studio('/api/lab-chat/output', { enabled: true });
    expect(on.status).toBe(409);
    expect(on.json).toMatchObject({ error: 'missing_write_scope' });
    expect(String(on.json.message)).toContain('LAB_CHAT_OUTPUT=true');
    expect(f.calls).toEqual([]);
    expect(
      (await f.studio('/api/lab-chat/output', { enabled: false })).status,
    ).toBe(200);
    expect(f.calls).toEqual([
      { path: '/v1/lab/commands/900100/output', body: undefined },
      {
        path: '/v1/lab/commands/900100/output',
        body: {
          actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
          enabled: false,
        },
      },
    ]);
  });

  it('OFF → ON while the Lab bot runs: the bot is restarted (reloads its token scopes); not otherwise', async () => {
    const f = await setup({ scopes: ['user:read:chat', 'user:write:chat'] });
    // Not running: nothing to restart.
    expect(
      (await f.studio('/api/lab-chat/output', { enabled: true })).json,
    ).toMatchObject({ enabled: true, adapter_restarted: false });
    expect(f.events).toEqual([]);
    await f.studio('/api/lab-chat/output', { enabled: false });
    // Ingestion ON: the bot runs.
    await f.studio('/api/lab-chat/ingress', { enabled: true });
    expect(f.events).toEqual(['start']);
    expect(
      (await f.studio('/api/lab-chat/output', { enabled: true })).json,
    ).toMatchObject({ enabled: true, adapter_restarted: true });
    expect(f.events).toEqual(['start', 'stop', 'start']);
    expect(f.started.at(-1)).toEqual({
      LAB_CHAT_CORE_URL: 'http://127.0.0.1:4301',
    });
    // Already ON (ON → ON) or turned OFF: no restart.
    await f.studio('/api/lab-chat/output', { enabled: true });
    await f.studio('/api/lab-chat/output', { enabled: false });
    expect(f.events).toEqual(['start', 'stop', 'start']);
  });

  it('executor absent is shown as Core reports it (output ON, no step request for > 5 s)', async () => {
    const f = await setup({ scopes: ['user:read:chat', 'user:write:chat'] });
    await f.studio('/api/lab-chat/output', { enabled: true });
    expect((await f.studio('/api/lab-chat/output')).json).toMatchObject({
      enabled: true,
      executor_absent: true,
      ingress_running: false,
    });
  });

  it('« Sortie chat réelle »: ON goes to Core (the switch lives there) with a writing token; steps readable', async () => {
    const f = await setup({ scopes: ['user:read:chat', 'user:write:chat'] });
    expect(
      (await f.studio('/api/lab-chat/output', { enabled: true })).status,
    ).toBe(200);
    expect(f.calls.at(-1)).toMatchObject({
      path: '/v1/lab/commands/900100/output',
      body: { enabled: true },
    });
    const out = await f.studio('/api/lab-chat/output');
    expect(out.json).toMatchObject({
      write_scope: true,
      ingress_running: false,
    });
    await f.studio('/api/lab-chat/steps?status=unknown');
    expect(f.calls.at(-1)).toEqual({
      path: '/v1/lab/commands/900100/steps?status=unknown',
      body: undefined,
    });
  });

  it('refuses another origin and a call without the Studio header', async () => {
    const f = await setup();
    expect((await fetch(`${f.origin}/api/lab-chat/status`)).status).toBe(403);
    expect(
      (
        await fetch(`${f.origin}/api/lab-chat/status`, {
          headers: { 'x-raptoru-studio': '1', origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
  });
});

describe('Studio → Lab Core client', () => {
  it('reaches the generic Lab chat entry (and still refuses any other route)', async () => {
    const seen: string[] = [];
    const core = createServer((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ handled: [] }));
    });
    await new Promise<void>((r) => core.listen(0, '127.0.0.1', r));
    try {
      const call = localLabCoreClient(
        `http://127.0.0.1:${(core.address() as AddressInfo).port}`,
        's'.repeat(32),
      );
      expect(await call('/v1/lab/chat', { text: '!join' })).toEqual({
        handled: [],
      });
      await expect(call('/v1/admin/anything')).rejects.toThrow(
        'lab_route_required',
      );
      expect(seen).toEqual(['/v1/lab/chat']);
    } finally {
      core.close();
    }
  });
});
