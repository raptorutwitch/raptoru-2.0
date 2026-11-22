import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmoteCatalog } from '../src/chatbox/emotes.js';
import { ChatboxHost } from '../src/chatbox/host.js';
import { PARITY } from '../src/chatbox/parity.js';
import { builtinSettings } from '../src/chatbox/settings.js';
import { ChatboxStore } from '../src/chatbox/store.js';

// Chatbox Raptoru — the host (docs/CHATBOX.md § 5): the OBS page's stream (hello, history, messages, moderation), the
// two feeds that never mix, saved settings applied at once to that profile's pages only, the token, the API guard.

let dir: string;
let server: Server;
let host: ChatboxHost;
let store: ChatboxStore;
let base: string;
const H = { 'content-type': 'application/json', 'x-raptoru-studio': '1' };
// The stream's payloads, read loosely (the host's own types are checked by the typecheck of host.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'raptoru-chatbox-host-'));
  store = await ChatboxStore.open(dir);
  const emotes = {
    emotes: [
      {
        code: 'KEKW',
        url: 'https://cdn.betterttv.net/emote/x/3x',
        provider: 'bttv',
        scope: 'channel',
        zw: false,
        animated: false,
      },
    ],
    version: 3,
    status: {},
  } as unknown as EmoteCatalog;
  host = new ChatboxHost({
    store,
    emotes,
    dir: join(import.meta.dirname, '..', 'chatbox-player'),
    origin: 'http://127.0.0.1:1',
    build: 'b1',
    guard: (req) =>
      req.headers['x-raptoru-studio'] === '1' ? null : 'missing_studio_header',
  });
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!(await host.handle(req, res, url))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  host.stop();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

/** Reads a page's event stream; `until` resolves when an event matches. */
function stream(query: string) {
  const ac = new AbortController();
  const events: { event: string; data: Loose }[] = [];
  let wake: () => void = () => {};
  void (async () => {
    const r = await fetch(`${base}/chatbox/events?${query}`, {
      signal: ac.signal,
    });
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader
        .read()
        .catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        wake();
      }
    }
  })();
  const until = async (
    pred: (e: { event: string; data: Loose }) => boolean,
    ms = 2000,
  ) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      if (Date.now() > end)
        throw new Error(
          `no event; got ${events.map((e) => e.event).join(',')}`,
        );
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 50);
      });
    }
  };
  return { events, until, close: () => ac.abort() };
}

const q = (o: Record<string, string>) =>
  new URLSearchParams({ t: store.token, ...o }).toString();
const message = (id: string, caseId = 'P01') =>
  host.demo.message(PARITY.find((c) => c.id === caseId)!.message, id);

describe('chatbox host', () => {
  it('refuses a page without the token, and the API without the Studio header', async () => {
    expect((await fetch(`${base}/chatbox/events?t=nope`)).status).toBe(403);
    expect((await fetch(`${base}/chatbox/catalog.json?t=nope`)).status).toBe(
      403,
    );
    expect((await fetch(`${base}/api/chatbox`)).status).toBe(403);
    expect((await fetch(`${base}/api/chatbox`, { headers: H })).status).toBe(
      200,
    );
    const page = await fetch(`${base}/chatbox/player.html`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'self'",
    );
  });

  it('hello gives the profile settings, the scene placement and the build; then the history', async () => {
    host.ingest('live', { type: 'msg', message: message('m1') });
    const s = stream(q({ profile: 'react', scene: 'fullscreen' }));
    const hello = await s.until((e) => e.event === 'hello');
    expect(hello.data.build).toBe('b1');
    expect(hello.data.settings).toEqual(builtinSettings('modernisee', 'react'));
    expect(hello.data.placement).toEqual(store.state.placements.fullscreen);
    const h = await s.until((e) => e.event === 'history');
    expect(h.data.messages.map((m: Loose) => m.id)).toEqual(['m1']);
    expect(h.data.messages[0].decision.mode).toBe('normal');
    s.close();
  });

  it('the demo feed never reaches a live page, and the live feed never the preview', async () => {
    const live = stream(q({ profile: 'just-chatting' }));
    const demo = stream(q({ profile: 'just-chatting', feed: 'demo' }));
    await live.until((e) => e.event === 'history');
    await demo.until((e) => e.event === 'history');
    host.ingest('demo', { type: 'msg', message: message('d1') });
    host.ingest('live', { type: 'msg', message: message('l1') });
    await demo.until((e) => e.event === 'msg' && e.data.message.id === 'd1');
    await live.until((e) => e.event === 'msg' && e.data.message.id === 'l1');
    expect(
      live.events.some((e) => e.event === 'msg' && e.data.message.id === 'd1'),
    ).toBe(false);
    expect(
      demo.events.some((e) => e.event === 'msg' && e.data.message.id === 'l1'),
    ).toBe(false);
    live.close();
    demo.close();
  });

  it('a hidden message never reaches an OBS page; the preview (explain) gets it with its rule', async () => {
    const obs = stream(q({ profile: 'dessin' }));
    const preview = stream(q({ profile: 'dessin', explain: '1' }));
    await obs.until((e) => e.event === 'history');
    await preview.until((e) => e.event === 'history');
    host.ingest('live', { type: 'msg', message: message('cmd', 'P19a') });
    host.ingest('live', { type: 'msg', message: message('ok', 'P19b') });
    const hidden = await preview.until(
      (e) => e.event === 'msg' && e.data.message.id === 'cmd',
    );
    expect(hidden.data.message.decision).toMatchObject({
      mode: 'hide',
      reason: 'commande Raptoru !roue',
    });
    await obs.until((e) => e.event === 'msg' && e.data.message.id === 'ok');
    expect(
      obs.events.some((e) => e.event === 'msg' && e.data.message.id === 'cmd'),
    ).toBe(false);
    obs.close();
    preview.close();
  });

  it("saved settings reach that profile's pages at once, never the other profiles'", async () => {
    const react = stream(q({ profile: 'react', scene: 'ps5' }));
    const jc = stream(q({ profile: 'just-chatting' }));
    await react.until((e) => e.event === 'history');
    await jc.until((e) => e.event === 'history');
    const settings = builtinSettings('modernisee', 'react');
    settings.presence.seconds = 20;
    const r = await fetch(`${base}/api/chatbox/profile`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ profile: 'react', settings }),
    });
    expect(r.status).toBe(200);
    const pushed = await react.until((e) => e.event === 'settings');
    expect(pushed.data.settings.presence.seconds).toBe(20);
    expect(jc.events.some((e) => e.event === 'settings')).toBe(false);
    const placed = await fetch(`${base}/api/chatbox/placement`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        scene: 'ps5',
        placement: { x: 5, y: 340, w: 460, h: 500, zoom: 1 },
      }),
    });
    expect(placed.status).toBe(200);
    await react.until(
      (e) => e.event === 'settings' && e.data.placement.x === 5,
    );
    react.close();
    jc.close();
  });

  it('a page asking for a preset keeps it (the demonstration compares Origine and Modernisée)', async () => {
    const s = stream(q({ profile: 'react', preset: 'origine', feed: 'demo' }));
    const hello = await s.until((e) => e.event === 'hello');
    expect(hello.data.settings).toEqual(builtinSettings('origine', 'react'));
    const r = await fetch(
      `${base}/chatbox/settings.json?${q({ profile: 'dessin', preset: 'origine' })}`,
    );
    expect((await r.json()).settings).toEqual(
      builtinSettings('origine', 'dessin'),
    );
    s.close();
  });

  it('new rules re-decide what every page shows', async () => {
    host.ingest('live', { type: 'msg', message: message('u1', 'P19d') });
    const s = stream(q({ profile: 'just-chatting' }));
    const first = await s.until((e) => e.event === 'history');
    expect(first.data.messages.map((m: Loose) => m.id)).toEqual(['u1']);
    const rules = structuredClone(store.state.rules);
    rules.commands.external = ['uptime'];
    await fetch(`${base}/api/chatbox/rules`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ rules }),
    });
    await s.until((e) => e.event === 'history' && e.data.messages.length === 0);
    s.close();
  });

  it("moderation: a deleted message, a viewer's messages, the whole chat — gone from the history too", async () => {
    host.ingest('live', { type: 'msg', message: message('a', 'P01') });
    host.ingest('live', { type: 'msg', message: message('b', 'P02') });
    host.ingest('live', { type: 'msg', message: message('c', 'P01') });
    const s = stream(q({ profile: 'just-chatting' }));
    await s.until((e) => e.event === 'history');
    host.ingest('live', { type: 'delete', id: 'b' });
    await s.until((e) => e.event === 'delete' && e.data.id === 'b');
    const mimi = message('x', 'P01').user.id;
    host.ingest('live', { type: 'clear_user', userId: mimi });
    await s.until((e) => e.event === 'clear_user' && e.data.userId === mimi);
    const again = stream(q({ profile: 'just-chatting' }));
    expect(
      (await again.until((e) => e.event === 'history')).data.messages,
    ).toEqual([]);
    host.ingest('live', { type: 'msg', message: message('d', 'P02') });
    host.ingest('live', { type: 'clear' });
    await s.until((e) => e.event === 'clear');
    s.close();
    again.close();
  });

  it('only the real chat binds an account rule to an id (a demo viewer never does)', async () => {
    host.ingest('demo', { type: 'msg', message: message('n1', 'P19e') });
    await new Promise((r) => setTimeout(r, 30));
    expect(
      store.state.rules.accounts.find((a) => a.login === 'nightbot')!.id,
    ).toBeNull();
    host.ingest('live', { type: 'msg', message: message('n2', 'P19e') });
    await new Promise((r) => setTimeout(r, 30));
    expect(
      store.state.rules.accounts.find((a) => a.login === 'nightbot')!.id,
    ).toBe('9000010');
  });
});
