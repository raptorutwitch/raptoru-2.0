import { mkdtemp, rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(await worker.stopOrders('player-1')).toEqual([]); // handed out once
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
