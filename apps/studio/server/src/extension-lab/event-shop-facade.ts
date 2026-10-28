import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Halloween shop (docs/HALLOWEEN.md) — extension façade of the Lab EBS (the production twin: core-api
// src/ext/ext-facade.ts, /events/*). The viewer is the verified extension token's identity, never a field of the
// request; every purchase / conversion needs its Idempotency-Key. Nothing is decided here: the Lab Core sells.

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json };

export function eventShopFacade(core: LabCoreCall, channelId: string) {
  const state = (viewerId: string | null) =>
    core<Json>(
      `/v1/lab/events/channels/${channelId}/state${viewerId ? `?viewer=${viewerId}` : ''}`,
      undefined,
      {
        timeoutMs: 2000,
      },
    );
  return async function call(
    method: string,
    rawPath: string,
    body: Json | undefined,
    viewer: { id: string; display_name: string } | null,
    idempotencyKey: string | undefined,
  ): Promise<Reply | null> {
    const path = rawPath.split('?')[0]!;
    const isAction =
      method === 'POST' &&
      (path === '/actions/events/purchase' ||
        path === '/actions/events/convert');
    if (!(method === 'GET' && path === '/events/state') && !isAction)
      return null;
    try {
      if (!isAction)
        return { status: 200, body: await state(viewer?.id ?? null) };
      if (!viewer)
        return { status: 403, body: { ok: false, error: 'identity_required' } };
      if (
        !idempotencyKey ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      )
        return {
          status: 400,
          body: { ok: false, error: 'idempotency_key_required' },
        };
      const out =
        path === '/actions/events/purchase'
          ? await core<Json>('/v1/lab/events/purchase', {
              idempotency_key: idempotencyKey,
              channel_id: channelId,
              viewer,
              item_id: String(body?.item_id ?? ''),
            })
          : await core<Json>('/v1/lab/events/convert', {
              idempotency_key: idempotencyKey,
              channel_id: channelId,
              viewer,
              bonbons: Number(body?.bonbons),
            });
      return {
        status: 200,
        body: { ok: true, ...out, event_shop: await state(viewer.id) },
      };
    } catch (e) {
      const err = e as { status?: number; message: string; body?: Json };
      return {
        status: err.status ?? 503,
        body: { ...(err.body ?? {}), ok: false, error: err.message },
      };
    }
  };
}
