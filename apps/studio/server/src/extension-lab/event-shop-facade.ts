import { eventTitlesView } from '@raptoru/schemas';
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
    ).then((s) =>
      // Testers only (Studio): the module is not shown to the others.
      s.extension_allowed === false ? { enabled: false } : s,
    );
  // Halloween « Titres » (docs/COSMETIC_SHOP.md § 8): the cosmetic shop's titles sold in Bonbons (same as production).
  const titles = async (viewer: { id: string } | null): Promise<Json> => {
    const shop = await state(viewer?.id ?? null);
    if (shop.enabled !== true) return { enabled: false };
    try {
      const [catalog, mine] = await Promise.all([
        core<Json>('/v1/cosmetics/catalog'),
        viewer
          ? core<Json>(`/v1/site/cosmetics/viewers/${viewer.id}`)
          : Promise.resolve(null),
      ]);
      return eventTitlesView(catalog, mine) as unknown as Json;
    } catch {
      return { enabled: false };
    }
  };
  const buyTitle = async (
    viewer: { id: string; display_name: string } | null,
    body: Json | undefined,
    key: string | undefined,
  ): Promise<Reply> => {
    if (!viewer)
      return { status: 403, body: { ok: false, error: 'identity_required' } };
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key))
      return {
        status: 400,
        body: { ok: false, error: 'idempotency_key_required' },
      };
    const t = await titles(viewer);
    const offer = String(body?.offer_id ?? '');
    const items = (t.items ?? []) as { offer_id: string }[];
    if (t.enabled !== true || !items.some((i) => i.offer_id === offer))
      return {
        status: 409,
        body: {
          ok: false,
          error: t.enabled === true ? 'offer_unavailable' : 'event_closed',
        },
      };
    const out = await core<Json>('/v1/site/cosmetics/purchase', {
      viewer: viewer.id,
      viewer_name: viewer.display_name.slice(0, 64) || viewer.id,
      offer_id: offer,
      idempotency_key: key,
    });
    return {
      status: 200,
      body: {
        ok: true,
        ...out,
        titles: await titles(viewer),
        event_shop: await state(viewer.id),
      },
    };
  };
  return async function call(
    method: string,
    rawPath: string,
    body: Json | undefined,
    viewer: { id: string; display_name: string } | null,
    idempotencyKey: string | undefined,
  ): Promise<Reply | null> {
    const path = rawPath.split('?')[0]!;
    if (method === 'GET' && path === '/events/titles')
      return { status: 200, body: { ok: true, ...(await titles(viewer)) } };
    if (method === 'POST' && path === '/actions/events/titles/purchase')
      try {
        return await buyTitle(viewer, body, idempotencyKey);
      } catch (e) {
        const err = e as { status?: number; message: string; body?: Json };
        return {
          status: err.status ?? 503,
          body: { ...(err.body ?? {}), ok: false, error: err.message },
        };
      }
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
              via: 'extension',
            })
          : await core<Json>('/v1/lab/events/convert', {
              idempotency_key: idempotencyKey,
              channel_id: channelId,
              viewer,
              bonbons: Number(body?.bonbons),
              via: 'extension',
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
