import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmoteCatalog } from '../src/chatbox/emotes.js';
import { ChatboxHost } from '../src/chatbox/host.js';
import { ChatboxStore } from '../src/chatbox/store.js';

// Chatbox Raptoru — the real chat's stability in Studio (docs/CHATBOX.md § 5.1): the Core's stream opened for the live
// pages, resumed after a cut from Studio's cursor, reset when the Core restarted (also what a restarted Studio gets:
// the Core's chat as it stands), never a message twice, the command catalogue read from the Core.

let dir: string;
let server: Server;
let host: ChatboxHost;
let store: ChatboxStore;
let base: string;
const opened: {
  path: string;
  push: (block: string) => void;
  end: () => void;
}[] = [];

const message = (id: string) => ({
  id,
  at: 1,
  user: {
    id: '42',
    login: 'mimi',
    name: 'Mimi',
    color: null,
    badges: [],
    staff: null,
  },
  fragments: [{ t: 'text', text: `message ${id}` }],
});

beforeEach(async () => {
  opened.length = 0;
  dir = await mkdtemp(join(tmpdir(), 'raptoru-chatbox-up-'));
  store = await ChatboxStore.open(dir);
  host = new ChatboxHost({
    store,
    emotes: { emotes: [], version: 1, status: {} } as unknown as EmoteCatalog,
    dir: join(import.meta.dirname, '..', 'chatbox-player'),
    origin: 'http://127.0.0.1:1',
    build: 'b',
    guard: () => null,
    core: {
      channelId: '900100',
      call: (async () => ({
        commands: [
          {
            key: 'module:rb',
            label: 'Random Ban',
            module: 'Random Ban',
            words: ['rb'],
            source: 'module',
            enabled: true,
          },
        ],
      })) as never,
      events: async (path, signal) => {
        const enc = new TextEncoder();
        let ctl!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start: (c) => void (ctl = c),
        });
        signal.addEventListener('abort', () => ctl.close());
        opened.push({
          path,
          push: (b) => ctl.enqueue(enc.encode(`${b}\n\n`)),
          end: () => ctl.close(),
        });
        return new Response(body);
      },
    },
  });
  server = createServer(async (req, res) => {
    if (
      !(await host.handle(
        req,
        res,
        new URL(req.url ?? '/', 'http://127.0.0.1'),
      ))
    )
      res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  host.stop();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

function page() {
  const ac = new AbortController();
  const events: {
    event: string;
    data: { messages?: { id: string }[]; message?: { id: string } };
  }[] = [];
  void (async () => {
    const r = await fetch(
      `${base}/chatbox/events?t=${store.token}&profile=react`,
      { signal: ac.signal },
    );
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader
        .read()
        .catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buf += dec.decode(value, { stream: true });
      for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
      }
    }
  })();
  return { events, close: () => ac.abort() };
}

const until = async (fn: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('chatbox: the real chat from the Core', () => {
  it('opens for a live page, resets from the Core, never shows a message twice, resumes after a cut, resets after a Core restart', async () => {
    const p = page();
    await until(() => opened.length === 1);
    expect(opened[0]!.path).toBe(
      '/v1/lab/chatbox/900100/events?boot=&after=-1',
    );
    // A restarted Studio (or a first start): the Core's chat as it stands.
    opened[0]!.push(
      `event: hello\ndata: ${JSON.stringify({ boot: 'core-1', cursor: 5 })}`,
    );
    opened[0]!.push(
      `event: reset\ndata: ${JSON.stringify({ cursor: 5, messages: [message('m1')] })}`,
    );
    await until(() =>
      p.events.some(
        (e) => e.event === 'history' && e.data.messages?.[0]?.id === 'm1',
      ),
    );
    // The same event twice (a redelivery): shown once.
    const ev = `event: chatbox\ndata: ${JSON.stringify({ seq: 6, type: 'msg', message: message('m2') })}`;
    opened[0]!.push(ev);
    opened[0]!.push(ev);
    await until(() => p.events.some((e) => e.event === 'msg'));
    await new Promise((r) => setTimeout(r, 100));
    expect(
      p.events.filter((e) => e.event === 'msg').map((e) => e.data.message!.id),
    ).toEqual(['m2']);
    // A cut: Studio comes back where it stopped (boot + cursor).
    opened[0]!.end();
    await until(() => opened.length === 2);
    expect(opened[1]!.path).toBe(
      '/v1/lab/chatbox/900100/events?boot=core-1&after=6',
    );
    // The Core restarted meanwhile: a reset replaces the live history.
    opened[1]!.push(
      `event: hello\ndata: ${JSON.stringify({ boot: 'core-2', cursor: 0 })}`,
    );
    opened[1]!.push(
      `event: reset\ndata: ${JSON.stringify({ cursor: 0, messages: [message('m3')] })}`,
    );
    await until(
      () =>
        p.events.filter((e) => e.event === 'history').at(-1)?.data.messages?.[0]
          ?.id === 'm3',
    );
    p.close();
  });

  it('closes the Core stream when the last live page leaves; the demo preview never opens it', async () => {
    const demo = new AbortController();
    void fetch(
      `${base}/chatbox/events?t=${store.token}&profile=react&feed=demo`,
      { signal: demo.signal },
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
    expect(opened).toHaveLength(0);
    const p = page();
    await until(() => opened.length === 1);
    p.close();
    await until(
      () => !host.upstream!.connected && host.view().live.pages === 0,
    );
    demo.abort();
  });

  it('reads the command catalogue from the Core (Studio shows it, the rules use it)', async () => {
    await host.refreshCatalog(true);
    expect(host.view().commands.map((c) => c.key)).toEqual(['module:rb']);
  });
});
