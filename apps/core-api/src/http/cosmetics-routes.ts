import {
  CosmeticAwardRequest,
  CosmeticDuplicateRequest,
  CosmeticImageUpload,
  CosmeticItemInput,
  CosmeticOfferInput,
  CosmeticPurchaseRequest,
  CosmeticRefundRequest,
  CosmeticRenameRequest,
} from '@raptoru/schemas';
import { z } from 'zod';
import { COSMETICS_CSS } from '../cosmetics/look.js';
import {
  CosmeticError,
  type CosmeticShopService,
} from '../cosmetics/service.js';
import {
  HttpError,
  limitParam,
  parse,
  type Route,
  STREAMED,
} from './server.js';

// Boutique cosmétique V1 (docs/COSMETIC_SHOP.md):
// - public (raptoru.fr, Studio's preview): the catalogue on sale now, the badge images, THE stylesheet of the looks;
// - Studio (the paired installation in production, the Lab secret in the Lab): the editor, images, offers, purchases,
//   refunds, module awards;
// - the site (its token, mounted only when set): the signed-in viewer's side and their purchase — the viewer is the
//   site's SESSION, the price and the balance the Core's own.

const mapped = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CosmeticError)
      throw new HttpError(e.status, { error: e.code, ...e.details });
    throw e;
  }
};

const RewardId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);
const TwitchId = z.string().regex(/^\d{1,32}$/);

export function cosmeticsRoutes(
  svc: CosmeticShopService,
  o: { channelId: string; production: boolean; site: boolean },
): Route[] {
  const ch = o.channelId;
  const auth = o.production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const admin = (path: string) =>
    new RegExp(
      `^\\/v1\\/${o.production ? 'studio' : 'lab'}\\/cosmetics${path}$`,
    );
  const actor = (installation?: string) =>
    installation ? 'Studio' : 'Studio (Lab)';
  return [
    // --- public -------------------------------------------------------------------------------------------------------
    {
      method: 'GET',
      pattern: /^\/v1\/cosmetics\/catalog$/,
      auth: 'public',
      handle: () => svc.catalog(ch),
    },
    {
      // A badge image: its exact checked type, immutable (the id is its content hash), never a script.
      method: 'GET',
      pattern: /^\/v1\/cosmetics\/images\/([0-9a-f]{64})$/,
      auth: 'public',
      handle: async ({ params, res }) => {
        const img = await svc.image(params[0]!);
        if (!img) throw new HttpError(404, { error: 'unknown_image' });
        res!.writeHead(200, {
          'content-type': img.mime,
          'content-length': img.bytes.length,
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
          'cross-origin-resource-policy': 'cross-origin',
        });
        res!.end(img.bytes);
        return STREAMED;
      },
    },
    {
      // THE stylesheet of every look (the site and Studio's preview load the same).
      method: 'GET',
      pattern: /^\/v1\/cosmetics\/style\.css$/,
      auth: 'public',
      handle: async ({ res }) => {
        res!.writeHead(200, {
          'content-type': 'text/css; charset=utf-8',
          'cache-control': 'public, max-age=300',
          'x-content-type-options': 'nosniff',
        });
        res!.end(COSMETICS_CSS);
        return STREAMED;
      },
    },
    {
      // The same stylesheet as JSON (Studio's preview: its Core channel speaks JSON).
      method: 'GET',
      pattern: /^\/v1\/cosmetics\/style\.json$/,
      auth: 'public',
      handle: async () => ({ css: COSMETICS_CSS }),
    },
    // --- Studio ---------------------------------------------------------------------------------------------------------
    {
      // The stylesheet on Studio's own channel too (the installed Studio may only call /v1/studio/*).
      method: 'GET',
      pattern: admin('/style.json'),
      auth,
      handle: async () => ({ css: COSMETICS_CSS }),
    },
    {
      // An image for Studio's editor (its Core channel speaks JSON).
      method: 'GET',
      pattern: admin('/images/([0-9a-f]{64})'),
      auth,
      handle: async ({ params }) => {
        const img = await svc.image(params[0]!);
        if (!img) throw new HttpError(404, { error: 'unknown_image' });
        return { mime: img.mime, data_base64: img.bytes.toString('base64') };
      },
    },
    {
      method: 'GET',
      pattern: admin('/items'),
      auth,
      handle: () => svc.items(ch),
    },
    {
      method: 'POST',
      pattern: admin('/items'),
      auth,
      handle: ({ body }) =>
        mapped(() => svc.upsertItem(ch, parse(CosmeticItemInput, body))),
    },
    {
      method: 'POST',
      pattern: admin('/items/([a-z0-9][a-z0-9_-]{0,47})/rename'),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          svc.renameDraft(
            ch,
            params[0]!,
            parse(CosmeticRenameRequest, body).to,
          ),
        ),
    },
    {
      method: 'POST',
      pattern: admin('/items/([a-z0-9][a-z0-9_-]{0,47})/duplicate'),
      auth,
      handle: ({ params, body }) => {
        const r = parse(CosmeticDuplicateRequest, body);
        return mapped(() => svc.duplicate(ch, params[0]!, r.to, r.label));
      },
    },
    {
      method: 'POST',
      pattern: admin('/images'),
      auth,
      handle: ({ body }) =>
        mapped(() =>
          svc.uploadImage(parse(CosmeticImageUpload, body).data_base64),
        ),
    },
    {
      method: 'POST',
      pattern: admin('/offers'),
      auth,
      handle: ({ body }) =>
        mapped(() => svc.upsertOffer(ch, parse(CosmeticOfferInput, body))),
    },
    {
      method: 'GET',
      pattern: admin('/purchases'),
      auth,
      handle: ({ url }) => svc.purchases(ch, limitParam(url, 100, 500)),
    },
    {
      method: 'POST',
      pattern: admin('/purchases/([0-9a-f-]{36})/refund'),
      auth,
      handle: ({ params, body, installation }) =>
        mapped(() =>
          svc.refund(
            ch,
            params[0]!,
            parse(CosmeticRefundRequest, body).reason,
            actor(installation),
          ),
        ),
    },
    {
      // Studio (or a future module through Studio): one award, once per key.
      method: 'POST',
      pattern: admin('/award'),
      auth,
      handle: ({ body }) =>
        mapped(() => svc.award(ch, parse(CosmeticAwardRequest, body))),
    },
    {
      // Studio's preview of a viewer's side (balances, owned) — the same answer the site gets.
      method: 'GET',
      pattern: admin('/viewers/([0-9]{1,32})'),
      auth,
      handle: ({ params }) => svc.viewerShop(ch, params[0]!),
    },
    // --- the site -------------------------------------------------------------------------------------------------------
    ...(o.site
      ? [
          {
            method: 'GET' as const,
            pattern: /^\/v1\/site\/cosmetics\/viewers\/([0-9]{1,32})$/,
            auth: 'site' as const,
            handle: ({ params }: { params: string[] }) =>
              svc.viewerShop(ch, parse(TwitchId, params[0])),
          },
          {
            method: 'POST' as const,
            pattern: /^\/v1\/site\/cosmetics\/purchase$/,
            auth: 'site' as const,
            handle: ({ body }: { body: unknown }) =>
              mapped(() =>
                svc.purchase(ch, parse(CosmeticPurchaseRequest, body)),
              ),
          },
        ]
      : []),
  ];
}

export { RewardId };
