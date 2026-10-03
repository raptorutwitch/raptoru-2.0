import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
  let running = false;
  const proc: IngressProcess = {
    get running() {
      return running;
    },
    lastExit: null,
    start: (env) => {
      started.push(env);
      running = true;
    },
    stop: () => {
      running = false;
    },
  };
  server = createServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const make = () =>
    LabChatIngress.create({
      core: (async (path: string, body?: unknown) => {
        calls.push({ path, body });
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
    studio,
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
      {
        path: '/v1/lab/commands/900100/output',
        body: {
          actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
          enabled: false,
        },
      },
    ]);
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
