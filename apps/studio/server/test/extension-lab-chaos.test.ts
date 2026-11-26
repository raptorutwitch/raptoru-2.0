import { describe, expect, it } from 'vitest';
import { LabEbs } from '../src/extension-lab/lab-ebs.js';
import { EXTENSION_DIR } from '../src/index.js';
import type { LabCoreCall } from '../src/lab-moderation/proxy.js';

// Chaos V2 lot 2 — the Studio-served extension Lab reaches the Lab Core's Chaos (state, quote, buy) with the TOKEN's
// identity (a body field can never change it), the intent's Idempotency-Key, and the Core's refusals unchanged.
type Json = Record<string, unknown>;
const token = (role: string, shared = true) => ({
  authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role, identity_shared: shared })).toString('base64url')}`,
});

describe('Extension Lab → Lab Core: Chaos', () => {
  it('state, quote and buy reach the Lab Core with the token identity; buy needs an identity and a key; refusals pass through', async () => {
    const calls: { path: string; body: Json | undefined }[] = [];
    const core = (async (path: string, body?: unknown) => {
      calls.push({ path, body: body as Json | undefined });
      // Only Chaos answers here: every other Lab Core read fails (the EBS keeps its defaults).
      if (!path.includes('/chaos/'))
        throw Object.assign(new Error('core_unavailable'), { status: 503 });
      if (path.endsWith('/buy') && (body as Json).expected_price === 1)
        throw Object.assign(new Error('price_changed'), {
          status: 409,
          body: {
            ok: false,
            error: 'price_changed',
            code: 'price_changed',
            price: 8000,
          },
        });
      if (path.endsWith('/summary')) return { enabled: true, cap_s: 30 };
      return path.includes('/state') ? { enabled: true } : { price: 8000 };
    }) as LabCoreCall;
    const lab = await LabEbs.create(EXTENSION_DIR);
    lab.connectLab(core);
    const viewer = token('viewer');
    // The Hub offers Interactions only while the Lab Core opens Chaos (as the Production session does).
    expect(
      (await lab.handle('GET', '/session', undefined, viewer)).body,
    ).toMatchObject({
      chaos: { enabled: true, cap_s: 30 },
    });

    const state = await lab.handle('GET', '/chaos/state', undefined, viewer);
    expect(state).toMatchObject({
      status: 200,
      body: { ok: true, enabled: true },
    });
    expect(
      calls.find((c) => c.path.includes('/chaos/900100/state'))!.path,
    ).toMatch(/^\/v1\/lab\/chaos\/\d+\/state\?viewer_id=\d+&viewer_name=/);

    const body = { effect: 'color', choice: {}, expected_price: 8000 };
    expect((await lab.handle('POST', '/chaos/buy', body, viewer)).status).toBe(
      400,
    );
    const ok = await lab.handle(
      'POST',
      '/chaos/buy',
      { ...body, viewer: { id: '1', display_name: 'spoof' } },
      { ...viewer, idempotencyKey: 'intent-12345' },
    );
    expect(ok.status).toBe(200);
    const sent = calls.at(-1)!.body!;
    expect(sent.idempotency_key).toBe('intent-12345');
    expect((sent.viewer as Json).id).not.toBe('1');

    const refused = await lab.handle(
      'POST',
      '/chaos/buy',
      { ...body, expected_price: 1 },
      { ...viewer, idempotencyKey: 'intent-67890' },
    );
    expect(refused).toMatchObject({
      status: 409,
      body: { code: 'price_changed', price: 8000 },
    });

    const anonymous = await lab.handle('POST', '/chaos/buy', body, {
      ...token('viewer', false),
      idempotencyKey: 'intent-24680',
    });
    expect(anonymous.status).toBe(403);
  });
});
