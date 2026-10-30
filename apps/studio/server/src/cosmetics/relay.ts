import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Boutique cosmétique V1 (docs/COSMETIC_SHOP.md) — Studio's « Boutique » tab relay to the profile's Core (the Lab Core,
// or the Production Core through the paired installation). Studio only relays: the Core checks every look, image, price
// and right. For the preview, Studio serves the Core's OWN stylesheet and the badge images locally
// (/cosmetics/style.css, /cosmetics/images/<id>): the preview is drawn exactly as raptoru.fr draws it.

const MAX_BODY = 64 * 1024;

export class CosmeticsRelay {
  private css: { text: string; at: number } | null = null;

  constructor(
    private readonly d: {
      core: LabCoreCall | null;
      environment: 'lab' | 'production' | null;
    },
  ) {}

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/cosmetics'
      : '/v1/lab/cosmetics';
  }

  private async body(req: IncomingMessage) {
    let raw = '';
    for await (const c of req) {
      raw += c;
      if (raw.length > MAX_BODY)
        throw Object.assign(new Error('body_too_large'), { status: 413 });
    }
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const p = url.pathname;
    const isApi = p.startsWith('/api/cosmetics/');
    const isAsset = p.startsWith('/cosmetics/');
    if (!isApi && !isAsset) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    const core = this.d.core;
    if (!core) {
      reply(503, { error: 'core_unavailable' });
      return true;
    }
    try {
      if (isAsset) {
        if (req.method !== 'GET')
          return (reply(405, { error: 'method_not_allowed' }), true);
        if (p === '/cosmetics/style.css') {
          if (!this.css || Date.now() - this.css.at > 60_000)
            this.css = {
              // Studio's own route (production allows /v1/studio/* only; Lab: /v1/lab/cosmetics/*).
              text: (await core<{ css: string }>(`${this.base}/style.json`))
                .css,
              at: Date.now(),
            };
          res.writeHead(200, {
            'content-type': 'text/css; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          res.end(this.css.text);
          return true;
        }
        const id = /^\/cosmetics\/images\/([0-9a-f]{64})$/.exec(p)?.[1];
        if (!id) return (reply(404, { error: 'not_found' }), true);
        const img = await core<{ mime: string; data_base64: string }>(
          `${this.base}/images/${id}`,
        );
        if (img.mime !== 'image/png' && img.mime !== 'image/webp')
          return (reply(415, { error: 'unsupported' }), true);
        res.writeHead(200, {
          'content-type': img.mime,
          'cache-control': 'max-age=3600',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        });
        res.end(Buffer.from(img.data_base64, 'base64'));
        return true;
      }
      if (req.headers['x-raptoru-studio'] !== '1')
        return (reply(403, { error: 'forbidden' }), true);
      const route = `${req.method} ${p}`;
      if (route === 'GET /api/cosmetics/items')
        return (reply(200, await core(`${this.base}/items`)), true);
      if (route === 'GET /api/cosmetics/purchases')
        return (reply(200, await core(`${this.base}/purchases`)), true);
      const viewer = /^\/api\/cosmetics\/viewers\/(\d{1,32})$/.exec(p)?.[1];
      if (req.method === 'GET' && viewer)
        return (reply(200, await core(`${this.base}/viewers/${viewer}`)), true);
      const item =
        /^\/api\/cosmetics\/items\/([a-z0-9][a-z0-9_-]{0,47})\/(rename|duplicate)$/.exec(
          p,
        );
      const refund =
        /^\/api\/cosmetics\/purchases\/([0-9a-f-]{36})\/refund$/.exec(p);
      const writes: Record<string, string> = {
        'POST /api/cosmetics/items': '/items',
        'POST /api/cosmetics/images': '/images',
        'POST /api/cosmetics/offers': '/offers',
        'POST /api/cosmetics/award': '/award',
      };
      const target =
        writes[route] ??
        (req.method === 'POST' && item
          ? `/items/${item[1]}/${item[2]}`
          : null) ??
        (req.method === 'POST' && refund
          ? `/purchases/${refund[1]}/refund`
          : null);
      if (target)
        return (
          reply(200, await core(`${this.base}${target}`, await this.body(req))),
          true
        );
      reply(404, { error: 'not_found' });
    } catch (e) {
      const err = e as { status?: number; message?: string; body?: unknown };
      reply(
        err.status && err.status < 600 ? err.status : 502,
        (err.body as object) ?? { error: err.message ?? 'core_unavailable' },
      );
    }
    return true;
  }
}
