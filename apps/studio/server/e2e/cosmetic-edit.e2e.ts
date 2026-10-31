import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Studio › Boutique: an existing title edited (31/10 production bug « Refusé : invalid_request »): its name, look and
// state change, its identifier never; the viewer who owns it keeps it. Isolated Lab stack only.

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

test('Boutique: an existing title is edited (name, look, rarity, Publié → Masqué → Publié), its owner keeps it', async ({
  page,
}) => {
  await page.goto('/?tab=shop');
  const tab = page.locator('#tab-shop');
  const form = tab.locator('[data-role="item-form"]');
  await tab.getByRole('button', { name: 'Nouveau titre / badge' }).click();
  await form.locator('[data-f="reward_id"]').fill('e2e-gentil-fantome');
  await form.locator('[data-f="label"]').fill('Gentil fantôme');
  await form.locator('[data-f="status"]').selectOption('published');
  await tab.locator('[data-act="save"]').click();
  await expect(tab).toContainText('Enregistré.');
  // A viewer owns it (Studio's « Donner »).
  const award = tab.locator('[data-role="award-form"]');
  await award.locator('[data-a="viewer"]').fill('57012399');
  await award.locator('[data-a="viewer_name"]').fill('Casper');
  await award.locator('[data-a="kind"]').selectOption('reward');
  await award
    .locator('[data-a="reward_id"]')
    .selectOption('e2e-gentil-fantome');
  await award.getByRole('button', { name: 'Donner' }).click();
  await expect(tab).toContainText('Donné.');

  // Edit the existing title: name, rarity, gradient look, state Masqué.
  await page.reload();
  await tab.locator('[data-edit="e2e-gentil-fantome"]').click();
  await expect(form.locator('[data-f="reward_id"]')).toHaveValue(
    'e2e-gentil-fantome',
  );
  await form.locator('[data-f="label"]').fill('Loup-garou');
  await form.locator('[data-f="rarity"]').selectOption('epic');
  await tab.locator('[data-l="use-gradient"]').check();
  await form.locator('[data-f="status"]').selectOption('hidden');
  await tab.locator('[data-act="save"]').click();
  await expect(tab).toContainText('Enregistré.');
  await expect(tab).not.toContainText('Refusé');
  const row = tab.locator('[data-row="e2e-gentil-fantome"]');
  await expect(row).toContainText('Masqué');
  await expect(row).toContainText('1'); // owners

  // Back to Publié.
  await tab.locator('[data-edit="e2e-gentil-fantome"]').click();
  await form.locator('[data-f="status"]').selectOption('published');
  await tab.locator('[data-act="save"]').click();
  await expect(tab).toContainText('Enregistré.');
  await expect(row).toContainText('Publié');

  // The Core: same identifier, new name / rarity / look; the owner still has it.
  const items = (await labCore('/v1/lab/cosmetics/items')).body as unknown as {
    reward_id: string;
    label: string;
    rarity: string;
    status: string;
    owners: number;
    style: { gradient: unknown };
  }[];
  const it = (Array.isArray(items) ? items : (items as never)['items']).find(
    (i: { reward_id: string }) => i.reward_id === 'e2e-gentil-fantome',
  );
  expect(it).toMatchObject({
    label: 'Loup-garou',
    rarity: 'epic',
    status: 'published',
    owners: 1,
  });
  expect(it?.style.gradient).toBeTruthy();
  const side = await labCore('/v1/site/cosmetics/viewers/57012399');
  expect(side.body.owned).toContain('e2e-gentil-fantome');
});
