// ASTRA-P1-019 lot 2 — Soundboard and TTS over the future-prod transport (local HTTPS, real Core
// handler on PGlite, real workers and journals): same worker semantics as the Lab, different
// transport / route base / Studio instance. STOP, lost ACKs and restarts keep their guarantees.
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestCore } from '../../../core-api/test/helpers.js';
import type { CoreCall } from '../src/bonk-lab/worker.js';
import { StudioTransportError } from '../src/prod-transport/core-client.js';
import { SoundWorker } from '../src/sound-lab/worker.js';
import { TtsWorker } from '../src/tts-lab/worker.js';
import { CHANNEL, pairedStudio, type Cleanups } from './prod-fixture.js';

const cleanups: Cleanups = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const STUDIO_ACTOR = {
  id: 'studio',
  role: 'broadcaster' as const,
  via: 'studio' as const,
};

/** One module seen through the same steps (Soundboard and TTS differ only in their player API). */
interface Module {
  name: 'sound' | 'tts';
  table: string;
  open(
    file: string,
    core: CoreCall,
    studioId: string,
  ): Promise<SoundWorker | TtsWorker>;
  ready(w: SoundWorker | TtsWorker, player: string): Promise<void>;
  admit(
    core: TestCore,
    w: SoundWorker | TtsWorker,
    key: string,
    session?: string,
  ): Promise<string>;
  /** Hands the next item to `player`; returns its attempt. */
  play(
    w: SoundWorker | TtsWorker,
    player: string,
  ): Promise<{ id: string; attempt: string } | null>;
  ack(
    w: SoundWorker | TtsWorker,
    id: string,
    attempt: string,
    player: string,
    event: 'started' | 'completed' | 'stopped',
  ): Promise<void>;
  cancel(core: TestCore, id: string): Promise<unknown>;
  /** Stop order currently proposed to the player (null: none). */
  stopOrder(w: SoundWorker | TtsWorker, player: string): Promise<string | null>;
  status(
    core: TestCore,
    id: string,
  ): Promise<{ status: string; stopped?: boolean }>;
}

const sound: Module = {
  name: 'sound',
  table: 'sound_lab_deliveries',
  open: (file, core, studioId) =>
    SoundWorker.open(file, core, { base: '/v1/studio/sound', studioId }),
  ready: async (w, player) => {
    await (w as SoundWorker).playerHeartbeat(player, true);
    await w.tick();
  },
  admit: async (core, w, key, session) =>
    (
      await core.soundLab.admit({
        idempotency_key: key,
        channel_id: CHANNEL,
        viewer: { id: '900101', display_name: 'Viewer Lab' },
        lab_session_id: session ?? w.session,
        sound_id: 'boop',
        payment_method: 'tokens',
      })
    ).interaction.interaction_id,
  play: async (w, player) => {
    const i = await (w as SoundWorker).command(player);
    return i ? { id: i.interaction_id, attempt: i.delivery.attempt_id! } : null;
  },
  ack: (w, id, attempt, player, event) =>
    (w as SoundWorker).playerAck(id, attempt, player, event),
  cancel: (core, id) =>
    core.db.tx((q) =>
      core.soundLab.applyModeration(
        q,
        CHANNEL,
        {
          action: 'cancel',
          module: 'soundboard',
          interaction_id: id,
          refund: false,
        },
        STUDIO_ACTOR,
        'broadcaster',
      ),
    ),
  stopOrder: async (w, player) =>
    (await (w as SoundWorker).stopOrders(player))[0]?.interaction_id ?? null,
  status: async (core, id) => {
    const i = await core.soundLab.get(id);
    return { status: i.status, stopped: Boolean(i.delivery.stopped_at) };
  },
};

const tts: Module = {
  name: 'tts',
  table: 'tts_lab_deliveries',
  open: (file, core, studioId) =>
    TtsWorker.open(file, core, { base: '/v1/studio/tts', studioId }),
  ready: async (w, player) => {
    await (w as TtsWorker).playerHeartbeat(player, 12);
    await w.tick();
  },
  admit: async (core, w, key, session) =>
    (
      await core.ttsLab.admit({
        idempotency_key: key,
        channel_id: CHANNEL,
        viewer: { id: '900101', display_name: 'Viewer Lab' },
        lab_session_id: session ?? w.session,
        text: 'Salut Raptoru, test du transport de production',
        payment_method: 'tokens',
      })
    ).interaction.interaction_id,
  play: async (w, player) => {
    const c = await (w as TtsWorker).command(player);
    return c && 'play' in c
      ? { id: c.play.interaction_id, attempt: c.play.delivery.attempt_id! }
      : null;
  },
  ack: (w, id, attempt, player, event) =>
    (w as TtsWorker).playerAck(id, attempt, player, event),
  cancel: (core) =>
    core.ttsLab.moderate(CHANNEL, {
      action: 'stop_current',
      actor: 'test',
      refund: false,
    }),
  stopOrder: async (w, player) => {
    const c = await (w as TtsWorker).command(player, false);
    return c && 'stop' in c ? c.stop : null;
  },
  status: async (core, id) => ({ status: (await core.ttsLab.get(id)).status }),
};

async function fixture(m: Module) {
  const p = await pairedStudio(cleanups);
  const journal = join(p.dir, 'production', m.name, 'journal.json');
  let dropNext: string | null = null;
  // Network that can lose the answer of one ACK (Core applied it, Studio never heard back).
  const lossy: CoreCall = async (path, body, options) => {
    const result = await p.client()(path, body, options);
    if (
      dropNext &&
      path.endsWith('/ack') &&
      (body as { event?: string }).event === dropNext
    ) {
      dropNext = null;
      throw new StudioTransportError(
        'core_unreachable',
        'Core unreachable (ECONNRESET)',
      );
    }
    return result as never;
  };
  const open = () => m.open(journal, lossy, p.installation.installationId);
  const worker = await open();
  const deliveries = async (id: string) =>
    Number(
      (
        await p.core.db.query<{ n: string }>(
          `select count(*) as n from ${m.table} where interaction_id = $1`,
          [id],
        )
      )[0]!.n,
    );
  return {
    ...p,
    open,
    worker,
    deliveries,
    loseAnswerOf: (event: string) => {
      dropNext = event;
    },
  };
}

describe.each([sound, tts])(
  'production transport — $name (ASTRA-P1-019 lot 2)',
  (m) => {
    it('normal: claim over HTTPS, player plays, ACK started → completed; delivery owned by the installation', async () => {
      const f = await fixture(m);
      await m.ready(f.worker, 'player-1');
      const id = await m.admit(f.core, f.worker, 'k-1');
      await f.worker.tick();
      const handed = await m.play(f.worker, 'player-1');
      expect(handed?.id).toBe(id);
      await m.ack(f.worker, id, handed!.attempt, 'player-1', 'started');
      await m.ack(f.worker, id, handed!.attempt, 'player-1', 'completed');
      await f.worker.tick();
      expect(f.worker.error).toBeNull();
      expect((await m.status(f.core, id)).status).toBe('completed');
      expect(await f.deliveries(id)).toBe(1);
    });

    it('STOP after a network cut: learnt once Core is back, proposed again until the player proves it, lost answer re-sent', async () => {
      const f = await fixture(m);
      await m.ready(f.worker, 'player-1');
      const id = await m.admit(f.core, f.worker, 'k-stop');
      await f.worker.tick();
      const handed = (await m.play(f.worker, 'player-1'))!;
      await m.ack(f.worker, id, handed.attempt, 'player-1', 'started');
      await f.worker.tick();
      await f.net.down();
      await m.cancel(f.core, id); // moderation stops it while Studio is cut off
      await f.worker.tick();
      expect(f.worker.error).toMatch(/^Core unreachable/);
      expect(await m.stopOrder(f.worker, 'player-1')).toBeNull(); // not known yet: nothing invented
      await f.net.up();
      await f.worker.tick(); // learns the cancellation from Core
      expect(await m.stopOrder(f.worker, 'player-1')).toBe(id);
      expect(await m.stopOrder(f.worker, 'player-1')).toBeNull(); // within the resend delay
      // The answer carrying the stop was lost: proposed again until the player's proof.
      const t = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(t + 1500);
      expect(await m.stopOrder(f.worker, 'player-1')).toBe(id);
      f.loseAnswerOf('stopped');
      await m.ack(f.worker, id, handed.attempt, 'player-1', 'stopped');
      await f.worker.tick(); // Soundboard: the « stopped » ACK reaches Core, its answer is lost
      await f.worker.tick(); // re-sent: idempotent
      vi.spyOn(Date, 'now').mockReturnValue(t + 5000);
      expect(await m.stopOrder(f.worker, 'player-1')).toBeNull(); // proven: no more stop orders
      const final = await m.status(f.core, id);
      expect(final.status).toBe('cancelled');
      if (m.name === 'sound') expect(final.stopped).toBe(true);
      expect(await f.deliveries(id)).toBe(1);
      expect(await m.play(f.worker, 'player-1')).toBeNull(); // never replayed
    });

    it('admitted outside this Studio session (future public EBS): played normally in Production', async () => {
      const f = await fixture(m);
      await m.ready(f.worker, 'player-1');
      const id = await m.admit(f.core, f.worker, 'k-ebs', 'public-ebs');
      await f.worker.tick();
      expect((await m.play(f.worker, 'player-1'))?.id).toBe(id);
    });

    it('lost ACK: Core applied « started », the answer was lost — re-sent idempotently, nothing replayed', async () => {
      const f = await fixture(m);
      await m.ready(f.worker, 'player-1');
      const id = await m.admit(f.core, f.worker, 'k-lost');
      await f.worker.tick();
      const handed = (await m.play(f.worker, 'player-1'))!;
      await m.ack(f.worker, id, handed.attempt, 'player-1', 'started');
      f.loseAnswerOf('started');
      await f.worker.tick();
      expect(f.worker.error).toMatch(/^Core unreachable/);
      expect(['executing', 'playing']).toContain(
        (await m.status(f.core, id)).status,
      ); // started, recorded once
      expect(await m.play(f.worker, 'player-1')).toBeNull();
      await m.ack(f.worker, id, handed.attempt, 'player-1', 'completed');
      await f.worker.tick();
      expect(f.worker.error).toBeNull();
      expect((await m.status(f.core, id)).status).toBe('completed');
      expect(await f.deliveries(id)).toBe(1);
    });

    it('Studio restarted after handing an item out: execution_unknown, never replayed', async () => {
      const f = await fixture(m);
      await m.ready(f.worker, 'player-1');
      const id = await m.admit(f.core, f.worker, 'k-restart');
      await f.worker.tick();
      expect((await m.play(f.worker, 'player-1'))?.id).toBe(id);
      const again = await f.open();
      await m.ready(again, 'player-2');
      expect((await m.status(f.core, id)).status).toBe('execution_unknown');
      expect(await m.play(again, 'player-2')).toBeNull();
    });

    it('revoked installation: refused on the next call with an explicit message, its work never continues', async () => {
      const f = await fixture(m);
      await m.ready(f.worker, 'player-1');
      const id = await m.admit(f.core, f.worker, 'k-revoked');
      await f.worker.tick();
      const handed = (await m.play(f.worker, 'player-1'))!;
      await m.ack(f.worker, id, handed.attempt, 'player-1', 'started');
      await f.core.studioInstallations.revoke(f.installation.installationId);
      await f.worker.tick();
      expect(f.worker.error).toBe(
        'Studio révoqué côté Core : nouvel appairage requis',
      );
      // Never continued nor completed by the revoked Studio; nothing else is handed to it.
      expect((await m.status(f.core, id)).status).not.toBe('completed');
      await m.ack(f.worker, id, handed.attempt, 'player-1', 'completed');
      await f.worker.tick();
      expect(f.worker.error).toBe(
        'Studio révoqué côté Core : nouvel appairage requis',
      );
      expect((await m.status(f.core, id)).status).not.toBe('completed');
      expect(await f.deliveries(id)).toBe(1);
    });

    it('incompatible protocol: « mise à jour requise », nothing claimed', async () => {
      const f = await fixture(m);
      await m.ready(f.worker, 'player-1'); // a paired, compatible Studio opens the admissions
      const id = await m.admit(f.core, f.worker, 'k-proto');
      const old = await m.open(
        join(f.dir, 'old', m.name, 'journal.json'),
        f.client({ protocolVersion: 2 }),
        f.installation.installationId,
      );
      await m.ready(old, 'player-9');
      expect(old.error).toBe(
        'Mise à jour requise : protocole Studio 2 incompatible (Core accepte 1)',
      );
      expect(await f.deliveries(id)).toBe(0);
    });
  },
);
