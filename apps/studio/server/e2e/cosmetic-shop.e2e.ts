import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Boutique cosmétique V1 in the Lab, end to end in a real browser (docs/COSMETIC_SHOP.md): Studio creates a glowing
// title and a badge with its PNG (preview drawn by the Core's stylesheet), publishes them, puts the title on sale in
// Jetons, gives Kirito_TV 500 Jetons; raptoru.fr's purchase (the site route, Lab secret) buys it once — a double click
// is the same purchase; Studio lists it and refunds it. Isolated stack: no Twitch, test economy only.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const labCore = async (path: string, body?: unknown) => {
  const { url, secret } = JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
  const r = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read answers
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
// A 1 × 1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('Boutique: Studio creates, previews and sells a title; the site buys it once in Jetons; Studio refunds it', async ({
  page,
}) => {
  await page.goto('/?tab=shop');
  const tab = page.locator('#tab-shop');
  const form = tab.locator('[data-role="item-form"]');
  const save = () => tab.locator('[data-act="save"]').click();

  // A title: glow, gold, published — the preview drawn by the Core's own classes.
  await tab.getByRole('button', { name: 'Nouveau titre / badge' }).click();
  await form.locator('[data-f="reward_id"]').fill('e2e-roi');
  await form.locator('[data-f="label"]').fill('Roi des citrouilles');
  await form.locator('[data-f="status"]').selectOption('published');
  await tab.locator('[data-l="use-color"]').check();
  await tab.locator('[data-l="effect"]').selectOption('glow');
  const preview = tab.locator('[data-preview] [data-look]').first();
  await expect(preview).toHaveText('Roi des citrouilles');
  await expect(preview).toHaveClass(/rc-fx-glow/);
  await save();
  await expect(tab).toContainText('Enregistré.');
  await expect(tab.locator('[data-row="e2e-roi"]')).toContainText('Publié');

  // A badge with its image (checked by the Core), served back to the preview.
  await tab.getByRole('button', { name: 'Nouveau titre / badge' }).click();
  await form.locator('[data-f="reward_id"]').fill('e2e-citrouille');
  await form.locator('[data-f="kind"]').selectOption('badge');
  await form.locator('[data-f="label"]').fill('Citrouille');
  await tab
    .locator('[data-role="image"]')
    .setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: PNG });
  await expect(tab).toContainText('Image acceptée (1 × 1');
  const img = tab.locator('[data-preview] img').first();
  await expect(img).toHaveJSProperty('naturalWidth', 1);
  await save();
  await expect(tab.locator('[data-row="e2e-citrouille"]')).toContainText(
    'Brouillon',
  );

  // The title on sale: 300 Jetons.
  await tab.locator('[data-edit="e2e-roi"]').click();
  const offer = tab.locator('[data-role="offer-form"]');
  await offer.locator('[data-o="offer_id"]').fill('e2e-roi-jetons');
  await offer.locator('[data-o="price"]').fill('300');
  await offer.locator('[data-o="enabled"]').check();
  await offer.getByRole('button', { name: 'Enregistrer l’offre' }).click();
  await expect(tab).toContainText('Offre enregistrée.');
  await expect(tab.locator('[data-row="e2e-roi"]')).toContainText('300 Jetons');

  // Kirito_TV gets 500 Jetons (Studio's « Donner »).
  const award = tab.locator('[data-role="award-form"]');
  await award.locator('[data-a="viewer"]').fill('57012345');
  await award.locator('[data-a="viewer_name"]').fill('Kirito_TV');
  await award.locator('[data-a="kind"]').selectOption('jetons');
  await award.locator('[data-a="amount"]').fill('500');
  await award.getByRole('button', { name: 'Donner' }).click();
  await expect(tab).toContainText('Donné.');

  // The draft badge is not for sale; the title is (public catalogue).
  const catalog = await labCore('/v1/cosmetics/catalog');
  const ids = (catalog.body.items as { id?: string; reward_id?: string }[]).map(
    (i) => i.id ?? i.reward_id,
  );
  expect(ids).toContain('e2e-roi');
  expect(ids).not.toContain('e2e-citrouille');

  // raptoru.fr's purchase, twice with the same click key: one debit.
  const buy = {
    viewer: '57012345',
    viewer_name: 'Kirito_TV',
    offer_id: 'e2e-roi-jetons',
    idempotency_key: 'e2e-click-0001',
  };
  const before = (await labCore('/v1/site/cosmetics/viewers/57012345')).body
    .balances.main as number;
  const first = await labCore('/v1/site/cosmetics/purchase', buy);
  expect(first.status).toBe(200);
  const again = await labCore('/v1/site/cosmetics/purchase', buy);
  expect([again.status, again.body.replayed]).toEqual([200, true]);
  const other = await labCore('/v1/site/cosmetics/purchase', {
    ...buy,
    idempotency_key: 'e2e-click-0002',
  });
  expect([other.status, other.body.error]).toEqual([409, 'already_owned']);
  const side = await labCore('/v1/site/cosmetics/viewers/57012345');
  expect(side.body.owned).toContain('e2e-roi');
  expect(side.body.balances.main).toBe(before - 300);

  // Studio lists it and refunds it: the Jetons back, the title gone.
  await page.reload();
  await expect(tab).toContainText('Kirito_TV');
  page.once('dialog', (d) => void d.accept('test e2e'));
  await tab.getByRole('button', { name: 'Rembourser…' }).first().click();
  await expect(tab).toContainText('Remboursé.');
  await expect(tab).toContainText('remboursé (test e2e)');
  const after = await labCore('/v1/site/cosmetics/viewers/57012345');
  expect(after.body.owned).not.toContain('e2e-roi');
  expect(after.body.balances.main).toBe(before);
});
