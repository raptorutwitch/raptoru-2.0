import type {
  LabActor,
  LabModerationCommand,
  TtsLabAdmitRequest,
  TtsLabInteraction,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  LabModerationError,
  LabModerationService,
} from '../src/lab-moderation/service.js';
import {
  DEFAULT_LAB_WALLET,
  LabForbiddenError,
  LabWalletError,
} from '../src/lab-moderation/store.js';
import { SoundLabError409 } from '../src/sound-lab/sound-lab-service.js';
import {
  DEFAULT_TTS_RULES,
  editableRules,
  type EditableTtsRules,
} from '../src/tts-lab/rules.js';
import {
  TtsLabError409,
  TtsLabUnavailableError,
} from '../src/tts-lab/tts-lab-service.js';
import { setup } from './helpers.js';

const CHANNEL = '900100';
const STUDIO = 'studio-A';
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const mod: LabActor = {
  id: '900102',
  login: 'modo',
  role: 'moderator',
  via: 'extension',
};
const viewerActor: LabActor = {
  id: '900101',
  login: 'viewer',
  role: 'viewer',
  via: 'extension',
};
let seq = 0;

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-10-01T18:00:00Z'));
  const tts = core.ttsLab;
  const m = new LabModerationService(
    core.db,
    core.clock,
    tts,
    core.soundLab,
    core.bonkLab,
  );
  await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
  await core.soundLab.heartbeat({
    studio_instance_id: STUDIO,
    player_ready: true,
  });
  const buy = (viewer = '900101', over: Partial<TtsLabAdmitRequest> = {}) =>
    tts.admit({
      idempotency_key: `k-${++seq}`,
      channel_id: CHANNEL,
      viewer: { id: viewer, display_name: `V${viewer}` },
      lab_session_id: 'lab-1',
      text: 'Salut Raptoru !',
      payment_method: 'tokens',
      ...over,
    });
  const act = (command: Record<string, unknown>, actor: LabActor = studio) =>
    m.act(CHANNEL, { actor, command: command as LabModerationCommand });
  const wallet = (viewer = '900101') => m.wallet(CHANNEL, viewer);
  const setWallet = (viewer: string, values: Record<string, number>) =>
    m.editWallet(CHANNEL, {
      actor: studio,
      viewer_id: viewer,
      op: 'set',
      ...values,
    });
  const play = async () => {
    const i = (await tts.claim(STUDIO, CHANNEL))!;
    await tts.ack(i.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: i.delivery.attempt_id!,
      event: 'started',
    });
    return i;
  };
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof LabForbiddenError) return 'forbidden';
      if (e instanceof LabWalletError) return e.code;
      if (e instanceof TtsLabError409 || e instanceof SoundLabError409)
        return e.code;
      if (
        e instanceof TtsLabUnavailableError ||
        e instanceof LabModerationError
      )
        return e.code;
      throw e;
    }
  };
  return { core, tts, m, buy, act, wallet, setWallet, play, code };
}

const rules = (over: (r: EditableTtsRules) => void): EditableTtsRules => {
  const r = structuredClone(editableRules(DEFAULT_TTS_RULES));
  over(r);
  return r;
};

describe('TTS configuration (Studio → Core)', () => {
  it('exposes the legacy defaults; an update applies to the next admission at once, debits exactly', async () => {
    const { tts, buy, wallet, setWallet, play, core } = await lab();
    const view = await tts.rulesView();
    expect(
      view.rules.tiers.map((t) => [
        t.min,
        t.max,
        t.price,
        t.credit_cost,
        t.cooldown_seconds,
      ]),
    ).toEqual([
      [1, 80, 7500, 1, 60],
      [81, 150, 11250, 1, 90],
      [151, 300, 15000, 1, 120],
      [301, 500, 22500, 1, 180],
      [501, null, 37500, 1, 300],
    ]);
    expect(view.customized).toBe(false);
    await tts.updateRules(
      rules((r) => {
        r.tiers[0]!.price = 100;
        r.tiers[0]!.credit_cost = 2;
        r.tiers[0]!.cooldown_seconds = 5;
      }),
      studio,
      'test',
    );
    await setWallet('900101', { tokens: 1_000_000, credits_tts: 100 });
    const a = (await buy()).interaction;
    expect(a.simulated_cost).toBe(100);
    expect((await wallet()).tokens).toBe(999_900);
    // Cooldown 5 s from the real start.
    await play();
    await tts.ack(a.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: (await tts.get(a.interaction_id)).delivery.attempt_id!,
      event: 'completed',
    });
    expect(
      (await tts.viewerState(CHANNEL, '900101')).cooldown_remaining_ms,
    ).toBe(5000);
    core.clock.advance(5_000);
    const b = (await buy('900101', { payment_method: 'credits' })).interaction;
    expect(b.simulated_cost).toBe(2);
    expect((await wallet()).credits_tts).toBe(98);
  });

  it('refuses an incoherent configuration with a clear message; reset restores the legacy values', async () => {
    const { tts, core } = await lab();
    const bad = async (e: EditableTtsRules) => {
      try {
        await tts.updateRules(e, studio, null);
        return 'ok';
      } catch (error) {
        return (error as TtsLabError409).message;
      }
    };
    expect(await bad(rules((r) => (r.tiers[1]!.min = 70)))).toMatch(
      /chevauche/,
    );
    expect(await bad(rules((r) => (r.tiers[1]!.min = 90)))).toMatch(/trou/);
    expect(await bad(rules((r) => (r.tiers[0]!.price = -1)))).toMatch(/prix/);
    expect(await bad(rules((r) => (r.tiers[2]!.max = null)))).toMatch(
      /dernier palier/,
    );
    expect(
      await bad(rules((r) => (r.tiers[0]!.cooldown_seconds = 99_999))),
    ).toMatch(/cooldown/);
    expect(await bad(rules((r) => (r.tiers[4]!.max = 900)))).toMatch(
      /Longueur max du message/,
    );
    expect(
      await bad(rules((r) => ((r.tiers[4]!.max = 900), (r.max_chars = 900)))),
    ).toBe('ok');
    expect((await tts.rulesView()).rules.max_chars).toBe(900);
    expect(await bad(rules((r) => (r.max_waiting_global = 0)))).toMatch(/File/);
    // A moderator from the extension cannot change the configuration.
    await expect(
      tts.updateRules(
        rules(() => {}),
        mod,
        null,
      ),
    ).rejects.toBeInstanceOf(LabForbiddenError);
    await tts.updateRules(null as never, studio, null, true);
    expect((await tts.rulesView()).rules).toEqual(
      editableRules(DEFAULT_TTS_RULES),
    );
    const trail = await core.db.query<{
      action: string;
      before: unknown;
      after: unknown;
    }>(
      "select action, before, after from lab_moderation_audit where action like 'config_%' order by id",
    );
    expect(trail.map((t) => t.action)).toEqual([
      'config_update',
      'config_reset',
    ]);
    expect(trail[0]!.before).toBeTruthy();
    expect(trail[0]!.after).toBeTruthy();
  });
});

describe('Lab test wallet', () => {
  it('defaults, set / adjust / reset (Studio only); insufficient balance refused before anything is stored', async () => {
    const { m, buy, wallet, setWallet, code, core } = await lab();
    expect(await wallet('900150')).toEqual(DEFAULT_LAB_WALLET);
    await setWallet('900150', { tokens: 100 });
    expect(await code(buy('900150'))).toBe('insufficient_tokens');
    expect(
      (
        await core.db.query<{ n: number }>(
          "select count(*)::int as n from tts_lab_interactions where viewer_id = '900150'",
        )
      )[0]!.n,
    ).toBe(0);
    await m.editWallet(CHANNEL, {
      actor: studio,
      viewer_id: '900150',
      op: 'adjust',
      tokens: 10_000,
      credits_tts: 1,
    });
    expect(await wallet('900150')).toMatchObject({
      tokens: 10_100,
      credits_tts: 2,
    });
    await m.editWallet(CHANNEL, {
      actor: studio,
      viewer_id: '900150',
      op: 'reset',
    });
    expect(await wallet('900150')).toEqual(DEFAULT_LAB_WALLET);
    // Never from the extension, even for a broadcaster.
    expect(
      await code(
        m.editWallet(CHANNEL, {
          actor: { ...mod, role: 'broadcaster' },
          viewer_id: '900150',
          op: 'set',
          tokens: 5,
        }),
      ),
    ).not.toBe('ok');
  });
});

describe('Moderation V2 (Core)', () => {
  it('permissions: a moderator pauses and cancels, never refunds or disables; a supermod refunds', async () => {
    const { act, buy, code, m } = await lab();
    expect(
      await code(
        act(
          { action: 'module_state', module: 'tts', state: 'paused' },
          viewerActor,
        ),
      ),
    ).toBe('forbidden');
    expect(
      await code(
        act({ action: 'module_state', module: 'tts', state: 'paused' }, mod),
      ),
    ).toBe('ok');
    expect(
      await code(
        act({ action: 'module_state', module: 'tts', state: 'active' }, mod),
      ),
    ).toBe('ok');
    expect(
      await code(
        act({ action: 'module_state', module: 'tts', state: 'disabled' }, mod),
      ),
    ).toBe('forbidden');
    const a = (await buy()).interaction;
    expect(
      await code(
        act(
          {
            action: 'cancel',
            module: 'tts',
            interaction_id: a.interaction_id,
            refund: true,
          },
          mod,
        ),
      ),
    ).toBe('forbidden');
    expect((await m.whoami(CHANNEL, mod)).role).toBe('moderator');
    await act({ action: 'set_staff', viewer_id: '900102', role: 'supermod' });
    expect((await m.whoami(CHANNEL, mod)).role).toBe('supermod');
    expect(
      await code(
        act(
          {
            action: 'cancel',
            module: 'tts',
            interaction_id: a.interaction_id,
            refund: true,
          },
          mod,
        ),
      ),
    ).toBe('ok');
  });

  it('pause keeps the queue and refuses before payment; the current TTS finishes; resume hands out the next', async () => {
    const { act, buy, code, tts, play, wallet } = await lab();
    await buy('900101');
    await buy('900103');
    const playing = await play();
    await act({
      action: 'module_state',
      module: 'tts',
      state: 'paused',
      reason: 'test',
    });
    const before = await wallet('900104');
    expect(await code(buy('900104'))).toBe('tts_paused');
    expect(await wallet('900104')).toEqual(before);
    expect((await tts.get(playing.interaction_id)).status).toBe('playing');
    await tts.ack(playing.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: playing.delivery.attempt_id!,
      event: 'completed',
    });
    expect(await tts.claim(STUDIO, CHANNEL)).toBeNull(); // paused: nothing handed out, queue kept
    expect((await tts.queue(CHANNEL)).waiting).toHaveLength(1);
    await act({ action: 'module_state', module: 'tts', state: 'active' });
    expect(await tts.claim(STUDIO, CHANNEL)).not.toBeNull();
  });

  it('stop / stop + refund / purge (waiting only) / cancel: exact refunds, at most once, audited', async () => {
    const { act, buy, code, tts, play, wallet, setWallet, m } = await lab();
    for (const v of ['900101', '900103', '900104', '900105'])
      await setWallet(v, { tokens: 50_000 });
    const a = (await buy('900101')).interaction;
    const b = (await buy('900103')).interaction;
    const c = (await buy('900104')).interaction;
    const d = (await buy('900105')).interaction;
    await play();
    await act({ action: 'stop_current', module: 'tts', refund: true });
    expect(await tts.get(a.interaction_id)).toMatchObject({
      status: 'cancelled',
      refund_status: 'refunded',
    });
    expect((await wallet('900101')).tokens).toBe(50_000);
    expect(
      await code(
        act({
          action: 'refund',
          module: 'tts',
          interaction_id: a.interaction_id,
        }),
      ),
    ).toBe('already_refunded');
    expect((await wallet('900101')).tokens).toBe(50_000);
    // b becomes current; purge only touches the waiting ones (c, d).
    const current = await play();
    expect(current.interaction_id).toBe(b.interaction_id);
    await act({ action: 'purge', module: 'tts', refund: true });
    expect((await tts.get(b.interaction_id)).status).toBe('playing');
    expect(await tts.get(c.interaction_id)).toMatchObject({
      status: 'cancelled',
      refund_status: 'refunded',
    });
    expect((await wallet('900104')).tokens).toBe(50_000);
    expect((await wallet('900105')).tokens).toBe(50_000);
    // Stop without refund, then a manual refund later (eligible once).
    await act({ action: 'stop_current', module: 'tts', refund: false });
    expect((await wallet('900103')).tokens).toBe(42_500);
    await act({
      action: 'refund',
      module: 'tts',
      interaction_id: b.interaction_id,
      reason: 'geste',
    });
    expect((await wallet('900103')).tokens).toBe(50_000);
    const audit = (await m.auditTrail(CHANNEL, { limit: 100 })) as {
      action: string;
      actor: string;
      role: string;
      before: unknown;
      after: unknown;
      interaction_id: string | null;
    }[];
    expect(audit.map((x) => x.action)).toEqual(
      expect.arrayContaining(['stop', 'purge', 'cancel', 'refund']),
    );
    const refundB = audit.find(
      (x) => x.action === 'refund' && x.interaction_id === b.interaction_id,
    )!;
    expect(refundB).toMatchObject({
      actor: 'studio:antoni',
      role: 'broadcaster',
      after: { refund_status: 'refunded', amount: 7500, currency: 'tokens' },
    });
    expect(d.interaction_id).toBeTruthy();
  });

  it('blocks per module or everywhere (temporary or not); unblock; cooldown add / replace / clear', async () => {
    const { act, buy, code, core, tts } = await lab();
    await act({
      action: 'block_viewer',
      viewer_id: '900101',
      module: 'soundboard',
      duration_s: null,
    });
    expect(await code(buy('900101'))).toBe('ok'); // Soundboard block does not touch TTS
    await act({
      action: 'block_viewer',
      viewer_id: '900103',
      module: 'all',
      duration_s: 60,
      reason: 'spam',
    });
    expect(await code(buy('900103'))).toBe('viewer_blocked');
    expect((await tts.viewerState(CHANNEL, '900103')).blocked).toBe(true);
    core.clock.advance(61_000);
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    expect(await code(buy('900103'))).toBe('ok'); // temporary block over
    await act({
      action: 'block_viewer',
      viewer_id: '900104',
      module: 'tts',
      duration_s: null,
    });
    expect(await code(buy('900104'))).toBe('viewer_blocked');
    await act({ action: 'unblock_viewer', viewer_id: '900104', module: 'tts' });
    expect(await code(buy('900104'))).toBe('ok');
    // Cooldown override (TTS)
    await act({
      action: 'viewer_cooldown',
      viewer_id: '900105',
      module: 'tts',
      mode: 'replace',
      seconds: 600,
    });
    expect(
      (await tts.viewerState(CHANNEL, '900105')).cooldown_remaining_ms,
    ).toBe(600_000);
    await act({
      action: 'viewer_cooldown',
      viewer_id: '900105',
      module: 'tts',
      mode: 'add',
      seconds: 60,
    });
    expect(
      (await tts.viewerState(CHANNEL, '900105')).cooldown_remaining_ms,
    ).toBe(660_000);
    expect(await code(buy('900105'))).toBe('viewer_cooldown');
    await act({
      action: 'viewer_cooldown',
      viewer_id: '900105',
      module: 'tts',
      mode: 'clear',
    });
    expect(await code(buy('900105'))).toBe('ok');
  });

  it('Soundboard: pause refuses before admission and keeps the queue; viewer cooldown and block; no refund', async () => {
    const { act, code, core, m } = await lab();
    const sound = (viewer = '900101', key = `s-${++seq}`) =>
      core.soundLab.admit({
        idempotency_key: key,
        channel_id: CHANNEL,
        viewer: { id: viewer, display_name: `V${viewer}` },
        lab_session_id: 'lab-1',
        sound_id: 'boop',
        payment_method: 'tokens',
      });
    const first = (await sound()).interaction;
    await act({
      action: 'module_state',
      module: 'soundboard',
      state: 'paused',
    });
    expect(await code(sound('900103'))).toBe('soundboard_paused');
    expect(await core.soundLab.claim(STUDIO, CHANNEL)).toBeNull();
    await act({
      action: 'module_state',
      module: 'soundboard',
      state: 'active',
    });
    expect((await core.soundLab.claim(STUDIO, CHANNEL))?.interaction_id).toBe(
      first.interaction_id,
    );
    await act({
      action: 'viewer_cooldown',
      viewer_id: '900104',
      module: 'soundboard',
      mode: 'replace',
      seconds: 30,
    });
    expect(await code(sound('900104'))).toBe('viewer_cooldown');
    await act({
      action: 'block_viewer',
      viewer_id: '900105',
      module: 'all',
      duration_s: null,
    });
    expect(await code(sound('900105'))).toBe('viewer_blocked');
    // A waiting sound can be cancelled (none of them debited: nothing to refund).
    const waiting = (await sound('900106')).interaction;
    const q = await m.overview(CHANNEL);
    expect(q.soundboard.waiting.map((w) => w.interaction_id)).toContain(
      waiting.interaction_id,
    );
    await act({
      action: 'cancel',
      module: 'soundboard',
      interaction_id: waiting.interaction_id,
      refund: false,
    });
    expect((await core.soundLab.get(waiting.interaction_id)).status).toBe(
      'cancelled',
    );
    expect(
      await code(
        act({
          action: 'refund',
          module: 'soundboard',
          interaction_id: waiting.interaction_id,
        }),
      ),
    ).toBe('not_refundable');
  });

  it('viewer card: wallet, restrictions, activity, wallet movements, moderation history', async () => {
    const { act, buy, m, setWallet } = await lab();
    await setWallet('900101', { tokens: 20_000 });
    const i: TtsLabInteraction = (await buy('900101')).interaction;
    await act({
      action: 'block_viewer',
      viewer_id: '900101',
      module: 'bonk',
      duration_s: 300,
      reason: 'abus',
    });
    const card = await m.viewer(CHANNEL, '900101');
    expect(card.display_name).toBe('V900101');
    expect(card.wallet.tokens).toBe(12_500);
    expect(card.restrictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'block',
          module: 'bonk',
          reason: 'abus',
        }),
      ]),
    );
    expect(card.activity[0]).toMatchObject({
      module: 'tts',
      interaction_id: i.interaction_id,
      cost: 7500,
    });
    expect(
      (card.wallet_ledger as { kind: string }[]).map((l) => l.kind),
    ).toEqual(['debit', 'set']);
    expect((card.history as { action: string }[])[0]!.action).toBe(
      'block_viewer',
    );
    expect(
      (await m.search(CHANNEL, 'V9001')).map((v) => v.viewer_id),
    ).toContain('900101');
  });
});
