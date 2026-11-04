import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

// Atelier (docs/COSMETIC_SHOP.md § 9), end to end in a real browser: Studio › Boutique creates an avatar frame and a
// banner. A frame whose centre is not transparent is refused by the atelier before sending; a correct one is accepted
// by the Core, previewed at raptoru.fr's five sizes, published; a banner is previewed on the card; a badge-size image
// never dresses a banner (the Core's rule). Isolated stack: no Twitch, Lab data only.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const labCore = async (path: string) => {
  const { url, secret } = JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
  const r = await fetch(url + path, {
    headers: { authorization: `Bearer ${secret}` },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read answers
  return (await r.json()) as Record<string, any>;
};

/** A real RGBA PNG (zlib), drawn pixel by pixel. */
function png(
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number, number],
) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** A 256 px ring between two radii of the 512 template (the avatar circle is r = 160). */
const ring = (from: number, to: number) =>
  png(256, 256, (x, y) => {
    const d = Math.hypot(x + 0.5 - 128, y + 0.5 - 128) * 2;
    return d >= from && d <= to ? [255, 140, 40, 255] : [0, 0, 0, 0];
  });

test('Atelier: a frame checked before sending, previewed at the site sizes, published; a banner previewed on the card', async ({
  page,
}) => {
  await page.goto('/?tab=shop');
  const tab = page.locator('#tab-shop');
  const form = tab.locator('[data-role="item-form"]');

  await tab.getByRole('button', { name: 'Nouvel objet' }).click();
  await form.locator('[data-f="reward_id"]').fill('e2e-braise');
  await form.locator('[data-f="kind"]').selectOption('frame');
  await form.locator('[data-f="label"]').fill('Braise');
  await expect(tab).toContainText('carré de 128 à 512 px');
  // The look settings (title / badge) are hidden for a frame.
  await expect(tab.locator('[data-role="look-form"]')).toBeHidden();

  // A filled disc: the avatar would be hidden. Refused by the atelier, nothing sent.
  await tab.locator('[data-role="image"]').setInputFiles({
    name: 'plein.png',
    mimeType: 'image/png',
    buffer: ring(0, 200),
  });
  await expect(tab).toContainText(
    'Cadre refusé : le centre n’est pas transparent',
  );

  // A ring around the avatar: accepted by the Core, drawn at the five sizes of raptoru.fr.
  await tab.locator('[data-role="image"]').setInputFiles({
    name: 'braise.png',
    mimeType: 'image/png',
    buffer: ring(156, 230),
  });
  await expect(tab).toContainText('Image acceptée (256 × 256');
  const frames = tab.locator('[data-preview] .rc-av-frame');
  await expect(frames).toHaveCount(5);
  await expect(frames.first()).toHaveJSProperty('naturalWidth', 256);
  await form.locator('[data-f="status"]').selectOption('published');
  await tab.locator('[data-act="save"]').click();
  await expect(tab).toContainText('Enregistré.');
  await expect(tab.locator('[data-row="e2e-braise"]')).toContainText(
    'Cadre d’avatar',
  );
  const items = (await labCore('/v1/lab/cosmetics/items')) as unknown as {
    items?: { reward_id: string; kind: string; status: string }[];
  };
  const list = Array.isArray(items) ? items : (items.items ?? []);
  expect(list.find((i) => i.reward_id === 'e2e-braise')).toMatchObject({
    kind: 'frame',
    status: 'published',
  });

  // A banner: a badge-size image is refused by the Core; a 4:1 one is previewed on the card.
  await tab.getByRole('button', { name: 'Nouvel objet' }).click();
  await form.locator('[data-f="reward_id"]').fill('e2e-aurore');
  await form.locator('[data-f="kind"]').selectOption('banner');
  await form.locator('[data-f="label"]').fill('Aurore');
  await tab.locator('[data-role="image"]').setInputFiles({
    name: 'petit.png',
    mimeType: 'image/png',
    buffer: png(64, 64, () => [20, 120, 100, 255]),
  });
  await expect(tab).toContainText('Image refusée');
  await tab.locator('[data-role="image"]').setInputFiles({
    name: 'aurore.png',
    mimeType: 'image/png',
    buffer: png(1024, 256, (x) => [20, 60 + (x >> 3), 100, 255]),
  });
  await expect(tab).toContainText('Image acceptée (1024 × 256');
  await expect(
    tab.locator('[data-preview] .rc-banner').first(),
  ).toHaveAttribute(
    'style',
    /--banner:url\('\/cosmetics\/images\/[0-9a-f]{64}'\)/,
  );
});
