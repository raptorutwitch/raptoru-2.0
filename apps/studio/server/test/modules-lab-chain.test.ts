import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { LabEbs, type LabRole } from '../src/extension-lab/lab-ebs.js';
import { EXTENSION_DIR } from '../src/index.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// The module host on the REAL Lab chain: the Lab Core, Studio's real Lab Core client (its route allow-list) and the
// Extension Lab EBS — the same door as the Production façade (@raptoru/schemas moduleFacade). Fictional data.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function chain() {
  const db = createPgliteDb(new PGlite({ parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) } }));
  await migrate(db, 'lab');
  const secret = randomBytes(32).toString('hex');
  const server: Server = createLabCore({ db, clock: systemClock, secret }).server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(async () => {
    server.close();
    await db.close();
  });
  const core = localLabCoreClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, secret);
  const lab = await LabEbs.create(EXTENSION_DIR);
  lab.connectLab(core);
  const auth = (role: LabRole) =>
    `Bearer lab.${Buffer.from(JSON.stringify({ role, identity_shared: true })).toString('base64url')}`;
  const ext = (role: LabRole, method: string, path: string, body?: Record<string, unknown>, key?: string) =>
    lab.handle(method, path, body, { authorization: auth(role), idempotencyKey: key });
  return { core, ext };
}

describe('module host — real Lab chain (Lab Core + Studio client + Extension Lab EBS)', () => {
  it('Studio\'s client reaches the settings and the host; the Lab extension buys once per intent; the team moderates', async () => {
    const { core, ext } = await chain();
    // Studio's own routes through its real client (the allow-list once refused them).
    const cat = await core<{ modules: { id: string }[] }>('/v1/lab/modules/900100');
    expect(cat.modules.map((m) => m.id)).toEqual(['objectif_soiree', 'coffre_mystere']);
    await core('/v1/lab/module-settings/900100', { key: 'coffre_mystere.enabled', value: 1 });
    // The viewer buys through the Lab EBS (fictional Lab wallet, stream live gate does not apply to Lab-only demos).
    const key = randomUUID();
    const first = await ext('viewer', 'POST', '/modules/v3/coffre_mystere/ouvrir', {}, key);
    const again = await ext('viewer', 'POST', '/modules/v3/coffre_mystere/ouvrir', {}, key);
    expect(first.body).toMatchObject({ ok: true, replayed: false, activity: { status: 'queued', amount: 100 } });
    expect(again.body).toMatchObject({ ok: true, replayed: true });
    expect((await ext('viewer', 'GET', '/modules/v3/coffre_mystere/state')).body.recent).toHaveLength(1);
    // The journal is the team's; the refund is the original debit, once.
    expect((await ext('viewer', 'GET', '/modules/v3/moderation/activity')).status).toBe(403);
    const id = (first.body.activity as { activity_id: string }).activity_id;
    const out = await ext('moderator', 'POST', '/modules/v3/moderation/refund', { activity_id: id, reason: 'test Lab' });
    expect(out.body).toMatchObject({ ok: true, refunded: 100 });
    expect((await ext('moderator', 'POST', '/modules/v3/moderation/refund', { activity_id: id, reason: 'bis' })).body.error).toBe(
      'already_refunded',
    );
  });
});
