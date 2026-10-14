import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TtsLabInteraction } from '@raptoru/schemas';
import { createApp } from '../../../core-api/src/http/server.js';
import { setup } from '../../../core-api/test/helpers.js';
import { localTtsCoreClient, TtsWorker } from '../src/tts-lab/worker.js';
import { LabModerationService } from '../../../core-api/src/lab-moderation/service.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';
import { LabEbs } from '../src/extension-lab/lab-ebs.js';
import { EXTENSION_DIR } from '../src/index.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Json = Record<string, unknown>;
const token = (role: string) => ({
  authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role, identity_shared: true })).toString('base64url')}`,
});
const viewer = token('viewer');
const tts = (text: string) => ({ module_id: 'tts', payload: { text } });

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
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const dir = await mkdtemp(join(process.cwd(), '.runtime-tts-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'journal.json');
  const client = localTtsCoreClient(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    'studio-test-secret',
  );
  const worker = await TtsWorker.open(file, client);
  const ready = async (w = worker, player = 'player-1') => {
    await w.playerHeartbeat(player, 12);
    await w.tick();
  };
  const lab = await LabEbs.create(EXTENSION_DIR);
  lab.connectTts(worker);
  // Test wallet, module states and moderation live in the Lab Core (as in the Studio runtime).
  lab.connectLab(
    localLabCoreClient(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      'studio-test-secret',
    ),
  );
  const buy = (
    key: string,
    text: string,
    headers = viewer,
    path = '/actions/tokens',
  ) => lab.handle('POST', path, tts(text), { ...headers, idempotencyKey: key });
  const wallet = async (headers = viewer) =>
    (
      (await lab.handle('GET', '/session', undefined, headers)).body
        .wallet as Json
    ).available as number;
  const coreRow = (id: string) =>
    client<TtsLabInteraction>(`/v1/lab/tts/interactions/${id}`);
  /** Plays the handed TTS on the fake player up to `until` (started / completed). */
  const play = async (until: 'started' | 'completed', player = 'player-1') => {
    await worker.tick();
    const cmd = await worker.command(player);
    if (!cmd || !('play' in cmd))
      throw new Error(`nothing to play: ${JSON.stringify(cmd)}`);
    const i = cmd.play;
    await worker.playerAck(
      i.interaction_id,
      i.delivery.attempt_id!,
      player,
      'started',
    );
    await worker.tick();
    if (until === 'completed') {
      await worker.playerAck(
        i.interaction_id,
        i.delivery.attempt_id!,
        player,
        'completed',
      );
      await worker.tick();
    }
    return i;
  };
  return { core, worker, client, file, ready, lab, buy, wallet, coreRow, play };
}

describe('TTS V2 Lab: Extension Lab → Core → Studio worker → OBS player', () => {
  it('the session carries the Core rules and the viewer state; a purchase is admitted once, the Lab wallet debited once', async () => {
    const f = await fixture();
    await f.ready();
    const session = (await f.lab.handle('GET', '/session', undefined, viewer))
      .body;
    const mod = (session.modules as Json[]).find((m) => m.id === 'tts')!;
    const v2 = mod.tts_v2 as Json;
    expect(v2.module_state).toBe('active');
    expect(
      ((v2.rules as Json).tiers as Json[]).map((t) => [
        t.id,
        t.price,
        t.credit_cost,
        t.cooldown_seconds,
      ]),
    ).toEqual([
      ['1-80', 7500, 1, 60],
      ['81-150', 11250, 1, 90],
      ['151-300', 15000, 1, 120],
      ['301-500', 22500, 1, 180],
      ['501+', 37500, 1, 300],
    ]);
    expect((v2.viewer as Json).player_offline).toBe(false);
    const before = await f.wallet();

    const first = await f.buy('tts-key-1', 'Salut Raptoru !');
    expect(first.status).toBe(200);
    const i = first.body.interaction as TtsLabInteraction;
    expect(i.simulated_cost).toBe(7500);
    expect(i.cast.character_id).toBeTruthy();
    // Double click / retry / refresh with the same key: the same TTS, never a second debit.
    const again = await f.buy('tts-key-1', 'Salut Raptoru !');
    expect(again.body.reference_id).toBe(i.interaction_id);
    expect(again.body.replayed).toBe(true);
    expect(await f.wallet()).toBe(before - 7500);
    // A second message while the first is waiting (paid with a credit): refused by Core, nothing consumed.
    const busy = await f.buy(
      'tts-key-2',
      'Encore moi',
      viewer,
      '/actions/redemption',
    );
    expect(busy.status).toBe(409);
    expect(busy.body.error).toBe('viewer_busy');
    expect(await f.wallet()).toBe(before - 7500);
    // The client never decides the price, the cast or the cooldown: nothing of it is read from the body.
    const forged = await f.lab.handle(
      'POST',
      '/actions/tokens',
      {
        module_id: 'tts',
        payload: {
          text: 'Hack',
          price: 1,
          cast: { character_id: 'golem' },
          cooldown_seconds: 0,
        },
      },
      { ...token('moderator'), idempotencyKey: 'tts-key-forged' },
    );
    const fi = forged.body.interaction as TtsLabInteraction;
    expect(fi.simulated_cost).toBe(7500);
    expect(fi.cooldown_seconds).toBe(60);
  });

  it('one TTS at a time, in order; the cooldown starts at the real start of the reading', async () => {
    const f = await fixture();
    await f.ready();
    const a = (await f.buy('k-a', 'Premier message')).body
      .interaction as TtsLabInteraction;
    const b = (await f.buy('k-b', 'Deuxième message', token('moderator'))).body
      .interaction as TtsLabInteraction;
    await f.worker.tick();
    const cmd = await f.worker.command('player-1');
    expect(cmd && 'play' in cmd && cmd.play.interaction_id).toBe(
      a.interaction_id,
    );
    // Not started yet: no cooldown for the viewer.
    let state = (await f.lab.handle('GET', '/tts/state', undefined, viewer))
      .body.tts_v2 as Json;
    expect((state.viewer as Json).cooldown_remaining_ms).toBe(0);
    // Strictly one at a time: the second one is not handed out while the first is in flight.
    expect(await f.worker.command('player-1')).toBeNull();
    const i = (cmd as { play: TtsLabInteraction }).play;
    f.core.clock.advance(5_000);
    await f.worker.playerAck(
      i.interaction_id,
      i.delivery.attempt_id!,
      'player-1',
      'started',
    );
    await f.worker.tick();
    const started = await f.coreRow(a.interaction_id);
    expect(started.status).toBe('playing');
    state = (await f.lab.handle('GET', '/tts/state', undefined, viewer)).body
      .tts_v2 as Json;
    expect((state.viewer as Json).cooldown_remaining_ms).toBe(60_000);
    await f.worker.playerAck(
      i.interaction_id,
      i.delivery.attempt_id!,
      'player-1',
      'completed',
    );
    await f.worker.tick();
    expect((await f.coreRow(a.interaction_id)).status).toBe('completed');
    await f.worker.tick();
    const next = await f.worker.command('player-1');
    expect(next && 'play' in next && next.play.interaction_id).toBe(
      b.interaction_id,
    );
  });

  it('nothing was heard (voice missing): failed, refunded once by Core, the Lab wallet given back once', async () => {
    const f = await fixture();
    await f.ready();
    const before = await f.wallet();
    const i = (await f.buy('k-fail', 'Message qui échoue')).body
      .interaction as TtsLabInteraction;
    expect(await f.wallet()).toBe(before - 7500);
    await f.worker.tick();
    const cmd = (await f.worker.command('player-1')) as {
      play: TtsLabInteraction;
    };
    await f.worker.playerAck(
      i.interaction_id,
      cmd.play.delivery.attempt_id!,
      'player-1',
      'failed',
      {
        code: 'voice_unavailable',
        message: 'voice missing',
      },
    );
    await f.worker.tick();
    const row = await f.coreRow(i.interaction_id);
    expect(row.status).toBe('failed');
    expect(row.refund_status).toBe('refunded');
    expect(row.error?.code).toBe('voice_unavailable');
    expect(await f.wallet()).toBe(before);
    // Polled again: never given back twice.
    await new Promise((r) => setTimeout(r, 1100));
    expect(await f.wallet()).toBe(before);
  });

  it('credits: one pending TTS redemption consumed, given back on refund', async () => {
    const f = await fixture();
    await f.ready();
    const credits = async () =>
      (
        (await f.lab.handle('GET', '/tts/state', undefined, viewer)).body
          .pending_actions as Json[]
      ).filter((p) => p.module_id === 'tts').length;
    const start = await credits();
    expect(start).toBeGreaterThan(0);
    const res = await f.buy(
      'k-credit',
      'Avec un crédit',
      viewer,
      '/actions/redemption',
    );
    const i = res.body.interaction as TtsLabInteraction;
    expect(i.payment_method).toBe('credits');
    expect(i.simulated_cost).toBe(1);
    expect(await credits()).toBe(start - 1);
    await f.worker.moderate({
      action: 'cancel',
      actor: 'test',
      interaction_id: i.interaction_id,
      refund: true,
    });
    await new Promise((r) => setTimeout(r, 1100));
    expect(await credits()).toBe(start);
  });

  it('a Studio restart never replays a TTS handed to the player: execution_unknown, not refunded', async () => {
    const f = await fixture();
    await f.ready();
    const i = (await f.buy('k-restart', 'Coupure')).body
      .interaction as TtsLabInteraction;
    await f.play('started');
    const reopened = await TtsWorker.open(f.file, f.client);
    await reopened.playerHeartbeat('player-2', 12);
    await reopened.tick();
    const row = await f.coreRow(i.interaction_id);
    expect(row.status).toBe('execution_unknown');
    expect(row.refund_status).toBe('none');
    expect(await reopened.command('player-2')).toBeNull();
  });

  it('moderation stop: proposed again until the player proves it (ASTRA-P1-017), late ACKs ignored, refund on request', async () => {
    const f = await fixture();
    await f.ready();
    const before = await f.wallet();
    await f.buy('k-stop', 'Arrête-moi');
    const i = await f.play('started');
    await f.worker.moderate({
      action: 'stop_current',
      actor: 'test',
      refund: true,
    });
    await f.worker.tick();
    const order = {
      stop: i.interaction_id,
      attempt_id: i.delivery.attempt_id,
    };
    expect(await f.worker.command('player-1')).toEqual(order);
    expect(await f.worker.command('player-1')).toBeNull(); // within the resend delay
    // The answer carrying the stop was lost: proposed again, until the player proves the silence.
    const t = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t + 1500);
    expect(await f.worker.command('player-1')).toEqual(order);
    await f.worker.playerAck(
      i.interaction_id,
      i.delivery.attempt_id!,
      'player-1',
      'stopped',
    );
    clock.mockReturnValue(t + 5000);
    expect(await f.worker.command('player-1')).toBeNull(); // proven: no more stop orders
    clock.mockRestore();
    // The page finished anyway: ignored, no error, Core keeps the cancelled + refunded state.
    await f.worker.playerAck(
      i.interaction_id,
      i.delivery.attempt_id!,
      'player-1',
      'completed',
    );
    await f.worker.tick();
    const row = await f.coreRow(i.interaction_id);
    expect(row.status).toBe('cancelled');
    expect(row.refund_status).toBe('refunded');
    await new Promise((r) => setTimeout(r, 1100));
    await f.lab.handle('GET', '/tts/state', undefined, viewer);
    expect(await f.wallet()).toBe(before);
  });

  it('ASTRA-P2-016: an idle tick writes no journal; a real change does (format unchanged)', async () => {
    const f = await fixture();
    await f.ready();
    await f.worker.tick();
    // Marker in place of the journal: any write by the worker would replace it.
    await writeFile(f.file, 'MARKER');
    for (let i = 0; i < 5; i++) await f.worker.tick(); // nothing to do: nothing written
    expect(await readFile(f.file, 'utf8')).toBe('MARKER');
    await f.buy('k-journal', 'Change le journal');
    await f.worker.tick(); // claimed: the journal holds it before anything is handed out
    const journal = JSON.parse(await readFile(f.file, 'utf8')) as {
      entries: unknown[];
    };
    expect(journal.entries).toHaveLength(1);
  });

  it('fails closed without a live player (nothing debited); paused: refused before payment, nothing handed out', async () => {
    const f = await fixture();
    const before = await f.wallet();
    const offline = await f.buy('k-offline', 'Personne pour lire');
    expect(offline.status).toBe(503);
    expect(await f.wallet()).toBe(before);
    await f.ready();
    await f.lab.handle('POST', '/moderation/tts/pause', {}, token('moderator'));
    const paused = await f.buy('k-paused', 'En pause');
    expect(paused.status).toBe(409);
    expect(paused.body.error).toBe('tts_paused');
    expect(await f.wallet()).toBe(before);
    const moduleTts = (
      (await f.lab.handle('GET', '/session', undefined, viewer)).body
        .moderation as Json
    ).tts as Json;
    expect(moduleTts.paused).toBe(true);
    // A viewer can never pause the TTS.
    expect(
      (await f.lab.handle('POST', '/moderation/tts/resume', {}, viewer)).status,
    ).toBe(403);
  });

  it('a viewer linked to Twitch (Bonk Lab) gets the TTS state of its real account', async () => {
    const f = await fixture();
    await f.ready();
    const twitchViewer = {
      user_id: '41414141',
      login: 'lecroupier_',
      display_name: 'LeCroupier_',
    };
    f.lab.connectBonk(
      { recent: async () => ({ interactions: [] }) } as never,
      {
        generation: 1,
        viewers: async () => ({ viewers: [twitchViewer] }),
        emotes: async () => ({
          status: 'ready',
          viewer: twitchViewer,
          catalog: null,
        }),
        catalog: async () => ({ groups: [] }),
      } as never,
    );
    const state = (await f.lab.handle('GET', '/tts/state', undefined, viewer))
      .body.tts_v2 as Json;
    expect(state.viewer).not.toBeNull();
    expect((state.viewer as Json).player_offline).toBe(false);
    const bought = await f.buy('k-linked', 'Depuis mon vrai compte');
    expect((bought.body.interaction as TtsLabInteraction).viewer_id).toBe(
      '41414141',
    );
  });

  it('extension moderation goes through Core: same states, permissions and audit as Studio', async () => {
    const f = await fixture();
    await f.ready();
    // A viewer can never moderate.
    expect(
      (await f.lab.handle('POST', '/moderation/tts/pause', {}, viewer)).status,
    ).toBe(403);
    const paused = await f.lab.handle(
      'POST',
      '/moderation/tts/pause',
      { command_id: 'c1' },
      token('moderator'),
    );
    expect(paused.body).toMatchObject({
      status: 'executed',
      final_status: 'executed',
    });
    // Same actor as the D4 console: Core keeps the moderator's display name, not its login.
    expect(
      await f.core.db.query(
        "select login, display_name from lab_staff where viewer_id = '900102'",
      ),
    ).toEqual([{ login: 'lab_modo', display_name: 'Modo Lab' }]);
    expect((await f.buy('k-p', 'Pendant la pause')).body.error).toBe(
      'tts_paused',
    );
    await f.lab.handle(
      'POST',
      '/moderation/tts/resume',
      { command_id: 'c2' },
      token('moderator'),
    );
    // Disabling a module needs a supermod: refused for a Twitch moderator, allowed for the broadcaster.
    expect(
      (
        await f.lab.handle(
          'POST',
          '/moderation/modules',
          { module_id: 'soundboard', enabled: false },
          token('moderator'),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.lab.handle(
          'POST',
          '/moderation/modules',
          { module_id: 'soundboard', enabled: false },
          token('broadcaster'),
        )
      ).status,
    ).toBe(200);
    // Suspension (all modules picked in the extension) → Core blocks.
    const suspended = await f.lab.handle(
      'POST',
      '/moderation/users/suspend',
      {
        twitch_user_id: '900101',
        module_ids: ['tts', 'soundboard'],
        duration_ms: 300_000,
        reason: 'Suspension depuis la console',
      },
      token('moderator'),
    );
    expect(suspended.body).toMatchObject({ scope: 'modules', errors: [] });
    expect((await f.buy('k-s', 'Suspendu')).body.error).toBe('viewer_blocked');
    const history = (
      await f.lab.handle(
        'GET',
        '/moderation/history',
        undefined,
        token('moderator'),
      )
    ).body.items as Json[];
    expect(history.map((h) => h.label)).toEqual(
      expect.arrayContaining([
        'module_paused',
        'module_active',
        'module_disabled',
        'block_viewer',
      ]),
    );
  });

  it('Moderation V2 console of the extension: a projection of Core with the caller as actor', async () => {
    const f = await fixture();
    await f.ready();
    const mod = token('moderator');
    const boss = token('broadcaster');
    const get = async (path: string, h = mod) =>
      (await f.lab.handle('GET', `/moderation/v2/${path}`, undefined, h)).body;
    const act = (command: Json, h = mod) =>
      f.lab.handle('POST', '/moderation/v2/actions', { command }, h);
    // Viewers never read it; a Twitch moderator gets its Core permissions (D4: refunds, no grant).
    expect(
      (await f.lab.handle('GET', '/moderation/v2/overview', undefined, viewer))
        .status,
    ).toBe(403);
    const first = (await get('overview')) as Json;
    expect(first.me).toMatchObject({ role: 'moderator', grants: [] });
    expect((first.me as Json).permissions).toContain('refund');
    expect((first.me as Json).permissions).not.toContain('wallet.admin');
    // Same queue as Core: one playing, one waiting.
    const before = await f.wallet();
    await f.buy('v2-1', 'Premier message');
    await f.play('started');
    // Another viewer (one TTS at a time per viewer).
    expect((await f.buy('v2-2', 'Deuxième message', mod)).status).toBe(200);
    const ov = (await get('overview')) as { tts: Json };
    expect((ov.tts.current as Json).message).toBe('Premier message');
    expect((ov.tts.waiting as Json[]).map((i) => i.message)).toEqual([
      'Deuxième message',
    ]);
    // Pause from the extension → Core state (what Studio reads).
    expect(
      (
        await act({
          action: 'module_state',
          module: 'tts',
          state: 'paused',
          waiting: 'keep',
        })
      ).status,
    ).toBe(200);
    expect(
      ((await get('overview', boss)) as { tts: Json }).tts.module_state,
    ).toBe('paused');
    // A gated D4 action (global pause) is refused for a moderator without the grant (Core
    // permission, named in the answer); stop + refund belongs to every moderator (D4).
    const refused = await act({ action: 'global_pause', paused: true });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      error: 'forbidden',
      permission: 'global.pause',
      grant: 'globalPause',
    });
    expect(
      (await act({ action: 'stop_current', module: 'tts', refund: true }))
        .status,
    ).toBe(200);
    await act({
      action: 'module_state',
      module: 'tts',
      state: 'active',
      waiting: 'keep',
    });
    await act({ action: 'purge', module: 'tts', refund: false });
    expect(await f.wallet()).toBe(before);
    // Block from the extension → admission refused; lifted → admitted again.
    const me = (await f.lab.handle('GET', '/session', undefined, viewer)).body
      .twitch_user_id as string;
    await act({
      action: 'block_viewer',
      viewer_id: me,
      module: 'tts',
      duration_s: 300,
      reason: 'test extension',
    });
    expect((await f.buy('v2-3', 'Bloqué')).body.error).toBe('viewer_blocked');
    await act({ action: 'unblock_viewer', viewer_id: me, module: 'tts' }, boss);
    // The natural TTS cooldown (first TTS) is cleared from the console too.
    expect((await f.buy('v2-4', 'Débloqué')).body.error).toBe(
      'viewer_cooldown',
    );
    await act({ action: 'clear_cooldown', viewer_id: me, module: 'tts' });
    expect((await f.buy('v2-5', 'Débloqué')).status).toBe(200);
    // D4 personal cooldown, viewer card, search and shared audit.
    await act({
      action: 'set_cooldown',
      viewer_id: me,
      module: 'soundboard',
      delay_s: 300,
      span: 3600,
    });
    const card = (await get(`viewers/${me}`)) as Json;
    expect(card.restrictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'cooldown',
          module: 'soundboard',
          delay_s: 300,
        }),
      ]),
    );
    expect(
      ((await get('search?q=')) as { viewers: Json[] }).viewers.map(
        (v) => v.viewer_id,
      ),
    ).toContain(me);
    const audit = ((await get('audit?limit=20')) as { audit: Json[] }).audit;
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'module_paused',
        'module_active',
        'stop',
        'purge',
        'block_viewer',
        'unblock_viewer',
        'cooldown_set',
        'cooldown_clear',
      ]),
    );
    expect(audit.find((a) => a.action === 'block_viewer')).toMatchObject({
      role: 'moderator',
      reason: 'test extension',
    });
  });

  it('Studio Lab wallet controls write the Core test wallet (the extension shows it)', async () => {
    const f = await fixture();
    await f.ready();
    await f.lab.control('wallet', { role: 'viewer', amount: 1_000_000 });
    expect(await f.wallet()).toBe(1_000_000);
    await f.buy('k-w', 'Riche');
    expect(await f.wallet()).toBe(992_500);
    await f.lab.control('reset');
    expect(await f.wallet()).toBe(12_000);
  });

  it('queue full blocks before any payment (count cap from the Core rules)', async () => {
    const f = await fixture();
    await f.core.db.query(
      `insert into tts_lab_settings (id, module_state, rules, updated_at) values (true, 'active', $1, now())
       on conflict (id) do update set rules = excluded.rules`,
      [JSON.stringify({ max_waiting_global: 1 })],
    );
    await f.ready();
    await f.buy('k-q1', 'Un', viewer);
    const before = await f.wallet(token('moderator'));
    const full = await f.buy('k-q2', 'Deux', token('moderator'));
    expect(full.status).toBe(409);
    expect(full.body.error).toBe('queue_full');
    expect(await f.wallet(token('moderator'))).toBe(before);
    const state = (
      await f.lab.handle('GET', '/tts/state', undefined, token('moderator'))
    ).body.tts_v2 as Json;
    expect((state.viewer as Json).queue_full).toBe(true);
  });
});
