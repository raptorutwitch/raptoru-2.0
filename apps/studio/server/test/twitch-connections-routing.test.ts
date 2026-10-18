import type { AddressInfo } from 'node:net';
import {
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStudioServer } from '../src/index.js';
import type { TestLab } from '../src/test-lab/test-lab.js';
import type { TwitchConnections } from '../src/twitch-oauth/twitch-connections.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function fixture(authorizing = false) {
  const handle = vi.fn(async (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ accounts: [] }));
    return true;
  });
  // No TestLab, OAuth child, real configuration or real tokens are constructed in this test.
  const args: Parameters<typeof createStudioServer> = [{} as TestLab, () => {}];
  args[16] = { authorizing, handle } as unknown as TwitchConnections;
  const server = createStudioServer(...args);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (
    path: string,
    headers: Record<string, string> = {},
    method = 'GET',
  ) =>
    new Promise<{ status: number; json(): Promise<unknown> }>(
      (resolve, reject) => {
        const req = httpRequest(
          origin + path,
          { method, headers: { host: '127.0.0.1:4100', ...headers } },
          (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += String(chunk);
            });
            res.on('end', () =>
              resolve({
                status: res.statusCode!,
                json: async () => JSON.parse(body) as unknown,
              }),
            );
          },
        );
        req.once('error', reject);
        req.end();
      },
    );
  return { request, handle };
}

describe('Twitch account routes in Studio', () => {
  it('requires the local Host and the Studio header before forwarding account data', async () => {
    const f = await fixture();
    expect((await f.request('/api/twitch-connections')).status).toBe(403);
    expect(
      (
        await f.request('/api/twitch-connections', {
          host: 'untrusted.example',
          'x-raptoru-studio': '1',
        })
      ).status,
    ).toBe(403);
    expect(f.handle).not.toHaveBeenCalled();
    expect(
      (
        await f.request('/api/twitch-connections', {
          'x-raptoru-studio': '1',
        })
      ).status,
    ).toBe(200);
    expect(f.handle).toHaveBeenCalledOnce();
  });

  it('blocks new token consumers until the authorization child has closed', async () => {
    const f = await fixture(true);
    for (const path of [
      '/api/test-lab/bot-start',
      '/api/test-lab/preflight',
      '/api/lab-chat/ingress',
    ]) {
      const response = await f.request(
        path,
        { 'x-raptoru-studio': '1' },
        'POST',
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'twitch_authorization_in_progress',
      });
    }
    expect(f.handle).not.toHaveBeenCalled();
  });
});
