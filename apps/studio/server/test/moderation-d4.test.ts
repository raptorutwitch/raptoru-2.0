import { mkdtemp, rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../core-api/src/http/server.js';
import { LabModerationService } from '../../../core-api/src/lab-moderation/service.js';
import { setup } from '../../../core-api/test/helpers.js';
import { LabEbs } from '../src/extension-lab/lab-ebs.js';
import { EXTENSION_DIR } from '../src/index.js';
import { labProxy, localLabCoreClient } from '../src/lab-moderation/proxy.js';
import { localSoundCoreClient, SoundWorker } from '../src/sound-lab/worker.js';

// Moderation V2 — parity D4 through Studio: the extension (Lab EBS façade, caller as actor) and the
// Studio cockpit (/api/lab/*, Studio = broadcaster) read and command the SAME Core. A change made on
// one side is what the other side reads next; the Soundboard stop goes Core → worker → player → ACK.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
type Json = Record<string, unknown>;
const token = (role: string) => ({
  authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role, identity_shared: true })).toString('base64url')}`,
});
const viewer = token('viewer');
const mod = token('moderator');
const boss = token('broadcaster');

async function fixture() {
  const core = await setup();
  core.clock.set(new Date());
  const server = createApp({
    ...core,
    labModeration: new LabModerationService(
      core.db,
      core.clock,
      core.ttsLab,
      core.soundLab,
      core.bonkLab,
      core.raffleLab,
    ),
    raffleLab: core.raffleLab,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const coreCall = localLabCoreClient(base, 'studio-test-secret');
  // Studio side: the real /api/lab proxy on a local HTTP server.
  const handle = labProxy({
    core: coreCall,
    players: async () => ({}),
    identities: () => [],
  });
  const studio = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1')).then(
      (done) => {
        if (!done) {
          res.writeHead(404);
          res.end();
        }
      },
    );
  });
  await new Promise<void>((resolve) => studio.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => studio.close(() => resolve())),
  );
  const studioUrl = `http://127.0.0.1:${(studio.address() as AddressInfo).port}`;
  const studioApi = async (path: string, body?: unknown) => {
    const res = await fetch(`${studioUrl}/api/lab${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Json };
  };
  // Extension side: the Lab EBS façade with the caller's identity.
  const lab = await LabEbs.create(EXTENSION_DIR);
  lab.connectLab(coreCall);
  const ext = async (path: string, h = mod) =>
    (await lab.handle('GET', `/moderation/v2/${path}`, undefined, h)).body;
  const extAct = (command: Json, h = mod) =>
    lab.handle('POST', '/moderation/v2/actions', { command }, h);
  const me = async (h: { authorization: string }) =>
    (await lab.handle('GET', '/session', undefined, h)).body
      .twitch_user_id as string;
  return { core, lab, studioApi, ext, extAct, me, base };
}

describe('Studio ↔ Extension: one moderation (same Core)', () => {
  it('ASTRA-P1-009: the Idempotency-Key reaches Core — a retried credit is applied once', async () => {
    const f = await fixture();
    const target = await f.me(viewer);
    const credit = () =>
      f.lab.handle(
        'POST',
        '/moderation/v2/actions',
        {
          command: {
            action: 'wallet_adjust',
            viewer_id: target,
            currency: 'tokens',
            delta: 100,
          },
        },
        { ...boss, idempotencyKey: 'ext-1759600000000-abcdef' },
      );
    const first = await credit();
    expect(first.status).toBe(200);
    // The response was lost: the extension retries with the same key.
    const again = await credit();
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(
      await f.core.db.query(
        'select 1 from lab_wallet_ledger where viewer_id = $1 and amount = 100',
        [target],
      ),
    ).toHaveLength(1);
  });

  it('an extension action appears in Studio; a Studio action appears in the extension', async () => {
    const f = await fixture();
    // The moderator opens the console once (Twitch role → team).
    expect(((await f.ext('overview')) as { me: Json }).me).toMatchObject({
      role: 'moderator',
      grants: [],
    });
    const viewerId = await f.me(viewer);
    const modId = await f.me(mod);
    // Extension → Studio: block + note.
    expect(
      (
        await f.extAct({
          action: 'block_viewer',
          viewer_id: viewerId,
          module: 'tts',
          duration_s: 300,
          reason: 'spam',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.extAct({
          action: 'add_note',
          viewer_id: viewerId,
          text: 'averti en chat',
        })
      ).status,
    ).toBe(200);
    const card = (await f.studioApi(`/viewers/${viewerId}`)).body;
    expect(card.restrictions).toEqual([
      expect.objectContaining({ kind: 'block', module: 'tts', reason: 'spam' }),
    ]);
    expect((card.notes as Json[])[0]).toMatchObject({
      text: 'averti en chat',
      author: 'lab_modo',
    });
    // Studio → extension: global pause, a word, a grant.
    expect(
      (
        await f.studioApi('/actions', {
          command: { action: 'global_pause', paused: true },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.studioApi('/actions', {
          command: { action: 'add_word', word: 'nul', kind: 'watch' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.studioApi('/actions', {
          command: {
            action: 'set_permission',
            viewer_id: modId,
            permission: 'words',
            granted: true,
          },
        })
      ).status,
    ).toBe(200);
    const ov = (await f.ext('overview')) as { global: Json; me: Json };
    expect(ov.global).toMatchObject({ paused: true });
    expect(ov.me.grants).toEqual(['words']);
    expect(
      ((await f.ext('words')) as { words: Json[] }).words.map((w) => w.word),
    ).toEqual(['nul']);
    const team = (await f.ext('team')) as { members: Json[] };
    expect(team.members.find((m) => m.viewer_id === modId)).toMatchObject({
      role: 'moderator',
      grants: ['words'],
    });
    // The grant is enforced by Core for the extension caller: allowed now, refused once removed.
    expect(
      (
        await f.extAct({
          action: 'add_word',
          word: 'arrête le stream',
          kind: 'watch',
        })
      ).status,
    ).toBe(200);
    await f.studioApi('/actions', {
      command: {
        action: 'set_permission',
        viewer_id: modId,
        permission: 'words',
        granted: false,
      },
    });
    const refused = await f.extAct({ action: 'remove_word', word_id: 1 });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'forbidden', grant: 'words' });
    // Same audit on both sides.
    const audit = (await f.studioApi('/audit?limit=20')).body.audit as Json[];
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'block_viewer',
        'note_add',
        'global_pause',
        'word_add',
        'set_permission',
      ]),
    );
    expect(
      ((await f.ext('audit?limit=20')) as { audit: Json[] }).audit,
    ).toHaveLength(audit.length);
  });

  it('a viewer never reads the read models (Core refuses the named reader)', async () => {
    const f = await fixture();
    for (const path of [
      'overview',
      'team',
      'words',
      'interactions',
      'ledger',
      'search?q=',
      'audit',
    ])
      expect(
        (await f.lab.handle('GET', `/moderation/v2/${path}`, undefined, viewer))
          .status,
      ).toBe(403);
    // Even if the façade let it through, Core answers 403 to a viewer reader.
    const res = await fetch(
      `${f.base}/v1/lab/moderation/900100/team?as=900101&as_role=viewer`,
      {
        headers: { authorization: 'Bearer studio-test-secret' },
      },
    );
    expect(res.status).toBe(403);
  });

  it('Tombola V2 through Studio controls and the extension entry (Core state in the session)', async () => {
    const f = await fixture();
    const viewerId = await f.me(viewer);
    expect(
      (
        await f.lab.handle(
          'POST',
          '/actions/raffle',
          {},
          { ...viewer, idempotencyKey: 'r-0-aaaaaaaa' },
        )
      ).body.error,
    ).toBe('raffle_closed');
    await f.lab.control('raffle-open', { seconds: 60, jackpot: 6000 });
    let session = (await f.lab.handle('GET', '/session', undefined, viewer))
      .body.raffle as Json;
    expect(session).toMatchObject({
      open: true,
      joined: false,
      total: 6000,
      participant_count: 0,
    });
    const joined = await f.lab.handle(
      'POST',
      '/actions/raffle',
      {},
      { ...viewer, idempotencyKey: 'r-1-aaaaaaaa' },
    );
    expect(joined.body).toMatchObject({ joined: true, duplicate: false });
    expect(
      (
        await f.lab.handle(
          'POST',
          '/actions/raffle',
          {},
          { ...viewer, idempotencyKey: 'r-2-aaaaaaaa' },
        )
      ).body,
    ).toMatchObject({ duplicate: true });
    session = (await f.lab.handle('GET', '/session', undefined, viewer)).body
      .raffle as Json;
    expect(session).toMatchObject({
      open: true,
      joined: true,
      participant_count: 1,
    });
    // The D4 console sees the same round.
    const ov = (await f.ext('overview')) as {
      raffle: { current: Json; recent_entries: Json[] };
    };
    expect(ov.raffle.current).toMatchObject({
      status: 'open',
      participants: 1,
      jackpot: 6000,
    });
    expect(ov.raffle.recent_entries[0]).toMatchObject({ viewer_id: viewerId });
    // Studio draws: the winner is paid on the Lab test wallet.
    await f.lab.control('raffle-draw');
    const w = (await f.studioApi(`/wallet/${viewerId}`)).body;
    expect(w.tokens).toBe(12_000 + 6000);
    session = (await f.lab.handle('GET', '/session', undefined, viewer)).body
      .raffle as Json;
    expect(session.open).toBe(false);
    expect((session.history as Json[])[0]).toMatchObject({
      pot: 6000,
      winners: [{ amount: 6000 }],
    });
    // A moderator cannot open the Tombola (Studio only).
    expect(
      (await f.extAct({ action: 'raffle_open', jackpot: 1, duration_s: 60 }))
        .status,
    ).toBe(403);
    // The broadcaster passes the permission check; Core refuses a new round while the previous
    // result is still on screen (Tombola V2 phases: drawing → revealing → revealed → finished).
    const again = await f.extAct(
      { action: 'raffle_open', jackpot: 1, duration_s: 60 },
      boss,
    );
    expect(again.status).toBe(409);
    expect((again.body as Json).error).toBe('raffle_already_open');
  });
});

describe('Tombola V2 moderation (phase G): the console, Studio and the extension act on the same Core', () => {
  it('extension mod / Studio broadcaster send the Studio commands through the D4 channel; Core checks the caller and audits', async () => {
    const f = await fixture();
    const viewerId = await f.me(viewer);
    const raffle = (command: Json) => ({ action: 'raffle', command });
    await f.lab.control('raffle-open', { seconds: 60, jackpot: 6000 });
    // The console reads the running round in the overview (Studio and extension alike).
    let ov = (await f.ext('overview')) as {
      raffle_v2: { round: Json & { participants: number } };
    };
    expect(ov.raffle_v2.round).toMatchObject({
      participants: 0,
      titles: { name: 'Tombola' },
    });
    expect((await f.studioApi('/overview')).body).toHaveProperty(
      'raffle_v2.round.participants',
      0,
    );
    // A standard moderator: no « Gérer la Tombola » → a manual entry is refused, the reason named.
    const refused = await f.extAct(
      raffle({
        action: 'add_participant',
        viewer_id: viewerId,
        display_name: 'Viewer',
      }),
    );
    expect(refused.status).toBe(403);
    expect((refused.body as Json).grant).toBe('raffle');
    // Studio (broadcaster): manual entry, then the moderator removes it (safe action).
    const added = await f.studioApi('/actions', {
      command: raffle({
        action: 'add_participant',
        viewer_id: viewerId,
        display_name: 'Viewer',
      }),
    });
    expect(added.status).toBe(200);
    ov = (await f.ext('overview')) as typeof ov;
    expect(ov.raffle_v2.round.participants).toBe(1);
    // The viewer card shows it, the extension viewer too.
    expect((await f.ext(`viewers/${viewerId}`)) as Json).toMatchObject({
      raffle: { joined: true, source: 'manual' },
    });
    expect(
      (
        (await f.lab.handle('GET', '/raffle/state', undefined, viewer)).body
          .raffle_v2 as { round: Json }
      ).round,
    ).toMatchObject({ joined: true, my_source: 'manual' });
    expect(
      (
        await f.extAct(
          raffle({ action: 'remove_participant', viewer_id: viewerId }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        (await f.lab.handle('GET', '/raffle/state', undefined, viewer)).body
          .raffle_v2 as { round: Json }
      ).round,
    ).toMatchObject({ joined: false, refusal: 'entry_removed' });
    // The console channel never carries configuration or launches.
    expect((await f.extAct(raffle({ action: 'launch' }), boss)).status).toBe(
      400,
    );
    // Audited with the extension moderator as author.
    const audit = (await f.ext('audit?module=raffle')) as {
      audit: { action: string; viewer_id: string | null }[];
    };
    expect(audit.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'raffle_add_participant',
        'raffle_remove_participant',
      ]),
    );
    // Cancel by the moderator (safe action).
    expect(
      (await f.extAct(raffle({ action: 'cancel', reason: 'test' }))).status,
    ).toBe(200);
  });
});

describe('Tombola V2 extension screen (Lab EBS → Core viewer state)', () => {
  it('flags the module, reads Core for this viewer (phase, refusal, entries, result), nothing decided here', async () => {
    const f = await fixture();
    const viewerId = await f.me(viewer);
    const session = (await f.lab.handle('GET', '/session', undefined, viewer))
      .body;
    expect(
      (session.modules as Json[]).find((m) => m.id === 'raffle_join'),
    ).toMatchObject({ raffle_v2: true });
    const state = async (h: { authorization: string } = viewer) =>
      (await f.lab.handle('GET', '/raffle/state', undefined, h)).body as {
        raffle_v2: Json & { phase: string; round: Json | null };
        me: Json | null;
        wallet: Json;
      };
    let s = await state();
    expect(s.raffle_v2).toMatchObject({ phase: 'idle', round: null });
    expect(s.me).toEqual({
      viewer_id: viewerId,
      display_name: expect.any(String),
    });
    expect(s.wallet).toMatchObject({ available: 12_000 });
    await f.lab.control('raffle-open', { seconds: 60, jackpot: 6000 });
    s = await state();
    expect(s.raffle_v2.phase).toBe('open');
    expect(s.raffle_v2.round).toMatchObject({
      joined: false,
      refusal: null,
      participants: 0,
    });
    await f.lab.handle(
      'POST',
      '/actions/raffle',
      {},
      { ...viewer, idempotencyKey: 'r-v2-aaaaaaaa' },
    );
    s = await state();
    expect(s.raffle_v2.round).toMatchObject({
      joined: true,
      my_source: 'extension',
      participants: 1,
      counts: { chat: 0, extension: 1, manual: 0 },
      list: [
        expect.objectContaining({ viewer_id: viewerId, source: 'extension' }),
      ],
    });
    // Identity not shared: no viewer, Core's channel-wide answer only.
    const anon = {
      authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role: 'viewer', identity_shared: false })).toString('base64url')}`,
    };
    const a = await state(anon);
    expect(a.me).toBeNull();
    expect(a.raffle_v2.round).toMatchObject({ joined: false, refusal: null });
    // Drawn: no spoiler before Core's viewer result time.
    await f.lab.control('raffle-draw');
    s = await state();
    expect(s.raffle_v2.phase).toBe('drawing');
    expect(s.raffle_v2.round).toMatchObject({ outcome: null });
    expect(s.raffle_v2.round).not.toHaveProperty('winners');
  });
});

describe('Soundboard stop: Core → Studio worker → player → ACK → Core', () => {
  it('a playing sound stopped by moderation is stopped on the player, proven by a `stopped` ACK, refunded', async () => {
    const f = await fixture();
    const dir = await mkdtemp(join(process.cwd(), '.runtime-mod-sound-test-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const client = localSoundCoreClient(f.base, 'studio-test-secret');
    const worker = await SoundWorker.open(join(dir, 'journal.json'), client);
    await worker.playerHeartbeat('player-1', true);
    await worker.tick();
    const lab = f.lab;
    lab.connectSound(worker);
    const buy = await lab.handle(
      'POST',
      '/actions/tokens',
      { module_id: 'soundboard', payload: { sound_id: 'boop' } },
      { ...viewer, idempotencyKey: 's-stop-1' },
    );
    expect(buy.status).toBe(200);
    const id = (buy.body.interaction as Json).interaction_id as string;
    const viewerId = await f.me(viewer);
    expect(
      (await f.studioApi(`/wallet/${viewerId}`)).body.tokens as number,
    ).toBe(11_500);
    await worker.tick();
    const handed = (await worker.command('player-1'))!;
    expect(handed.interaction_id).toBe(id);
    await worker.playerAck(
      id,
      handed.delivery.attempt_id!,
      'player-1',
      'started',
    );
    await worker.tick();
    // The moderator stops it from the extension (+ refund, D4).
    expect(
      (
        await f.extAct({
          action: 'cancel',
          module: 'soundboard',
          interaction_id: id,
          refund: true,
        })
      ).status,
    ).toBe(200);
    await worker.tick(); // the worker learns it from Core
    expect(await worker.stopOrders('player-1')).toEqual([
      { interaction_id: id, attempt_id: handed.delivery.attempt_id },
    ]);
    expect(await worker.stopOrders('player-1')).toEqual([]); // within the resend delay
    // The answer carrying the stop was lost (ASTRA-P1-017): proposed again until the player's proof.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500);
    expect(await worker.stopOrders('player-1')).toEqual([
      { interaction_id: id, attempt_id: handed.delivery.attempt_id },
    ]);
    clock.mockRestore();
    // The player stops it and proves it; its late `completed` is ignored.
    await worker.playerAck(
      id,
      handed.delivery.attempt_id!,
      'player-1',
      'stopped',
    );
    await worker.playerAck(
      id,
      handed.delivery.attempt_id!,
      'player-1',
      'completed',
    );
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    expect(await worker.stopOrders('player-1')).toEqual([]); // proven: no more stop orders
    later.mockRestore();
    await worker.tick();
    const row = await client<Json>(`/v1/lab/sound/interactions/${id}`);
    expect(row).toMatchObject({
      status: 'cancelled',
      refund_status: 'refunded',
    });
    expect((row.delivery as Json).stopped_at).toBeTruthy();
    expect(
      (await f.studioApi(`/wallet/${viewerId}`)).body.tokens as number,
    ).toBe(12_000);
    // Studio's history shows it, with who stopped it.
    const detail = (await f.studioApi(`/interactions/${id}`)).body;
    expect((detail.actions as Json[]).map((a) => [a.action, a.actor])).toEqual(
      expect.arrayContaining([['stop', 'lab_modo']]),
    );
  });
});
