import { describe, expect, it } from 'vitest';
import { commandsApi } from '../src/commands/relay.js';
import type { LabCoreCall } from '../src/lab-moderation/proxy.js';
import { cockpitClient } from '../src/prod-transport/production.js';

// Lot 8: the main Core hosts the chat games; Studio's production profile reaches their configuration through the
// cockpit (/v1/studio/cockpit/…, installation credential), on the Core's own channel.

describe('chat games configuration on the production cockpit', () => {
  it('Commands V2 calls go to the main Core channel through /v1/studio/cockpit', async () => {
    const seen: string[] = [];
    const core = (async (path: string) => {
      seen.push(path);
      return { ok: true };
    }) as unknown as Parameters<typeof cockpitClient>[0];
    const cockpit = cockpitClient(core) as LabCoreCall;
    const call = commandsApi(cockpit, '83603689');
    await call('GET', new URL('/api/commands', 'http://studio'), {});
    await call('GET', new URL('/api/commands/categories', 'http://studio'), {});
    expect(seen).toEqual([
      '/v1/studio/cockpit/commands/83603689',
      '/v1/studio/cockpit/commands/83603689/categories',
    ]);
  });
});
