import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activityHtml,
  type CatalogModule,
  statusHtml,
} from '../../web/src/module-host.ts';
import {
  levelOf,
  modulesStatusProvider,
} from '../src/control-center/modules.js';
import { modulesRelay } from '../src/modules/relay.js';
import { MODULES } from '../../../core-api/src/modules/index.js';
import { checkModule } from '../../../core-api/src/modules/kit.js';
import { PAGES } from '../../web/src/shell/registry.ts';

// Architecture socle, Studio side: ONE relay, ONE Control Center provider and ONE generic page for every module of the
// module host. Fictional modules and data.

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function relay(answer: unknown = { ok: true }, labPlayer = false) {
  const calls: { path: string; body: unknown }[] = [];
  const handle = modulesRelay(
    async (path, body) => {
      calls.push({ path, body });
      return answer as never;
    },
    '900100',
    { labPlayer },
  );
  const server = createServer((req, res) => {
    void handle(req, res, new URL(req.url!, 'http://x')).then((done) => {
      if (!done) res.writeHead(418).end();
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = (path: string, body?: unknown, studio = true) =>
    fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: studio ? { 'x-raptoru-studio': '1' } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { calls, api };
}

const sample = (over: Partial<CatalogModule> = {}): CatalogModule => ({
  id: 'coffre_mystere',
  label: 'Coffre mystère',
  description: 'x',
  category: 'jeux',
  lab_only: true,
  capabilities: [],
  enabled: true,
  settings: [],
  admin: [],
  viewer: [],
  moderation: { visible: true, refund: 'moderator', note: 'n' },
  status: {
    intention: 'on',
    observed: 'ready',
    summary: 'Aucun coffre en attente',
    reasons: [],
  },
  ...over,
});

describe('modules relay (one for every module)', () => {
  it('forwards to the profile Core with the broadcaster actor; a body actor is ignored; only known paths', async () => {
    const r = await relay();
    expect((await r.api('/api/modules')).status).toBe(200);
    await r.api('/api/modules/objectif_soiree/admin/ajouter', {
      input: { points: 3 },
      actor: { id: 'evil', role: 'broadcaster', via: 'studio' },
    });
    await r.api('/api/modules/refund', {
      activity_id: 'a',
      reason: 'b',
      actor: { id: 'evil' },
    });
    expect(r.calls).toEqual([
      { path: '/v1/lab/modules/900100', body: undefined },
      {
        path: '/v1/lab/modules/900100/objectif_soiree/admin/ajouter',
        body: {
          actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
          input: { points: 3 },
        },
      },
      {
        path: '/v1/lab/modules/900100/refund',
        body: {
          actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
          activity_id: 'a',
          reason: 'b',
        },
      },
    ]);
    expect((await r.api('/api/modules/Bad-Id/status')).status).toBe(404);
  });
  it('refuses a call without the Studio header; another path is not its business', async () => {
    const r = await relay();
    expect((await r.api('/api/modules', undefined, false)).status).toBe(403);
    expect((await r.api('/api/other')).status).toBe(418);
    expect(r.calls).toEqual([]);
  });
});

describe('the fictional player (Lab only)', () => {
  it('Lab: claim and report as Studio’s fixed player (a body player is ignored), bounded limit; the catalog says so', async () => {
    const r = await relay({ items: [] }, true);
    expect(await (await r.api('/api/modules')).json()).toMatchObject({
      lab_player: true,
    });
    await r.api('/api/modules/coffre_mystere/claim', {
      player: 'evil',
      limit: 99,
    });
    await r.api('/api/modules/coffre_mystere/report', {
      activity_id: 'a1',
      status: 'failed',
      result: { x: 1 },
      player: 'evil',
    });
    expect(r.calls.slice(1)).toEqual([
      {
        path: '/v1/lab/modules/900100/coffre_mystere/claim',
        body: { player: 'studio-lab-fictif', limit: 10 },
      },
      {
        path: '/v1/lab/modules/900100/coffre_mystere/report',
        body: {
          activity_id: 'a1',
          status: 'failed',
          player: 'studio-lab-fictif',
        },
      },
    ]);
  });
  it('Production profile: no fictional player (a « played » report would close a real paid action nobody saw)', async () => {
    const r = await relay({ modules: [] }, false);
    expect(await (await r.api('/api/modules')).json()).toMatchObject({
      lab_player: false,
    });
    expect((await r.api('/api/modules/coffre_mystere/claim', {})).status).toBe(
      404,
    );
    expect(
      (
        await r.api('/api/modules/coffre_mystere/report', {
          activity_id: 'a',
          status: 'done',
        })
      ).status,
    ).toBe(404);
    expect(r.calls).toHaveLength(1); // only the catalog read
  });
});

describe('Control Center: one provider for every module', () => {
  it('off on purpose is « off », never an outage; waiting / error / unknown never green', () => {
    expect(
      levelOf({
        intention: 'off',
        observed: 'error',
        summary: '',
        reasons: [],
      }),
    ).toBe('off');
    expect(
      levelOf({ intention: 'on', observed: 'ready', summary: '', reasons: [] }),
    ).toBe('ok');
    expect(
      levelOf({
        intention: 'on',
        observed: 'waiting',
        summary: '',
        reasons: [],
      }),
    ).toBe('warn');
    expect(
      levelOf({
        intention: 'on',
        observed: 'unknown',
        summary: '',
        reasons: [],
      }),
    ).toBe('unknown');
  });
  it('a waiting module names its reason; an unreadable catalogue is « Inconnu »', async () => {
    const tile = await modulesStatusProvider(
      async () =>
        ({
          modules: [
            sample(),
            sample({
              id: 'objectif_soiree',
              label: 'Objectif',
              status: {
                intention: 'on',
                observed: 'waiting',
                summary: 's',
                reasons: ['Lecteur absent'],
              },
            }),
          ],
        }) as never,
      '900100',
    ).read();
    expect(tile).toMatchObject({ level: 'warn', state: 'En attente' });
    expect(tile.hint).toContain('Objectif : Lecteur absent');
    const none = await modulesStatusProvider(async () => {
      throw new Error('404');
    }, '900100').read();
    expect(none.level).toBe('unknown');
  });
});

describe('generic module page (pure parts)', () => {
  it('OFF is said as a setting (host switch) or plainly with where the switch is (historical); refund only where allowed', () => {
    const historical = statusHtml(
      sample({
        status: {
          intention: 'off',
          observed: 'unknown',
          summary: 'x',
          reasons: ['Interrupteur : page « Simulation ».'],
        },
      }),
    );
    expect(historical).toContain('Coupé.');
    expect(historical).not.toContain('(réglage)');
    expect(historical).toContain('page « Simulation »');
    expect(
      statusHtml(
        sample({
          has_switch: true,
          status: {
            intention: 'off',
            observed: 'ready',
            summary: 'x',
            reasons: [],
          },
        }),
      ),
    ).toContain('Coupé (réglage)');
    const row = {
      activity_id: 'a1',
      module_id: 'coffre_mystere',
      action: 'ouvrir',
      viewer: { id: '1', display_name: 'Fictif' },
      amount: 100,
      status: 'done',
      result: null,
      created_at: '2026-11-05T20:00:00Z',
      ended_by: null,
      reason: null,
    };
    expect(activityHtml([row], sample())).toContain('data-refund="a1"');
    expect(
      activityHtml(
        [row],
        sample({ moderation: { visible: true, refund: 'never', note: '' } }),
      ),
    ).not.toContain('data-refund');
    expect(activityHtml([{ ...row, amount: 0 }], sample())).not.toContain(
      'data-refund',
    );
  });
});

describe('automatic checks (architecture socle § 11)', () => {
  it('every host module passes the contract and has ITS Studio page (navigation is never forgotten)', () => {
    for (const m of MODULES) {
      expect(checkModule(m), m.id).toEqual([]);
      const pages = PAGES.filter(
        (p) => p.view === 'modules' && p.anchor === m.id,
      );
      expect(
        pages,
        `${m.id}: one page { view: 'modules', anchor: '${m.id}' } in shell/registry.ts`,
      ).toHaveLength(1);
    }
  });
});
