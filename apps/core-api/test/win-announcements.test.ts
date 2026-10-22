import { randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  type LabActor,
  RaffleCommand,
  type RaffleConfig,
  subWheelAmount,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { CommandSteps, insertWordGameSteps } from '../src/commands/steps.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import {
  RAFFLE_ANNOUNCE_DELAY_MS,
  RaffleLabService,
} from '../src/raffle-lab/raffle-lab-service.js';
import { DEFAULT_RAFFLE_CONFIG } from '../src/raffle-lab/rules.js';
import {
  SW_ANNOUNCE_DELAY_MS,
  SubWheelService,
} from '../src/sub-wheel/service.js';
import { setup } from './helpers.js';

// Winner announcements in chat (LeCroupier_'s durable queue cmd_steps): Roue du Sub V1 (animation shown → 8 s → the
// message) and Tombola (the PAID winners, at the reveal), once each, nothing for tests / simulations / unpaid gains;
// a scheduled announcement never holds the messages behind it.

const CH = '83603689';
const studioActor: LabActor = {
  id: 'antoni',
  role: 'broadcaster',
  via: 'studio',
};
type Step = {
  origin: string;
  status: string;
  idempotency_key: string;
  params: { mode: string; text: string };
  available_at: Date;
};
const steps = async (
  db: { query: <T>(s: string, p?: unknown[]) => Promise<T[]> },
  origin: string,
) =>
  db.query<Step>(
    'select origin, status, idempotency_key, params, available_at from cmd_steps where origin = $1 order by seq_global',
    [origin],
  );

describe('Roue du Sub V1 — winner announcement', () => {
  const SEGMENT = 4;
  const GAIN = subWheelAmount(7, 1, SEGMENT);
  const event = (): AlertEventInput => ({
    channel_id: CH,
    source: 'twitch',
    source_event_id: randomUUID(),
    type: 'resub',
    actor: { id: '9201', login: 'viewer', display_name: 'Viewer' },
    tier: '1000',
    months: 7,
  });
  async function fixture() {
    const core = await setup();
    core.clock.set(new Date('2026-10-22T20:00:00Z'));
    const wheel = new SubWheelService(
      core.db,
      core.clock,
      () => SEGMENT,
      coreWalletEconomy(core.wallet.wallet),
    );
    await wheel.setEnabled(CH, true);
    return { core, wheel };
  }

  it('credited at the sub, announced only when the wheel is shown, 8 s after, once', async () => {
    const { core, wheel } = await fixture();
    const spin = (await wheel.fromAlert(event(), null))!;
    expect(spin).toMatchObject({ status: 'queued' });
    // Credited with the spin, but nothing in chat before the animation.
    expect(await steps(core.db, 'sub_wheel')).toHaveLength(0);
    const c = await wheel.claimAnimation(CH, 'studio-1');
    expect(c.spin?.amount).toBe(GAIN);
    expect(await steps(core.db, 'sub_wheel')).toHaveLength(0);
    core.clock.advance(12_000); // the animation plays
    const endedAt = core.clock.now().getTime();
    await wheel.reportAnimation(c.spin!.spin_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    // The same end reported again (answer lost): nothing more.
    await wheel.reportAnimation(c.spin!.spin_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    const s = await steps(core.db, 'sub_wheel');
    expect(s).toHaveLength(1);
    expect(s[0]!.params).toEqual({
      mode: 'normal',
      text: `🎡 Roue du Sub : @Viewer gagne ${GAIN.toLocaleString('fr-FR').replace(/\s/g, ' ')} Jetons !`,
    });
    expect(new Date(s[0]!.available_at).getTime()).toBe(
      endedAt + SW_ANNOUNCE_DELAY_MS,
    );
    expect(s[0]!.idempotency_key).toBe(`sub_wheel:win:${c.spin!.spin_id}`);
  });

  it('nothing for a Studio test, a failed animation or a gain not credited', async () => {
    const { core, wheel } = await fixture();
    // « Tester »: a « test » gain.
    await wheel.test(CH, { name: 'Antoni', months: 3 });
    const t = await wheel.claimAnimation(CH, 'studio-1');
    await wheel.reportAnimation(t.spin!.spin_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    // A real sub whose animation failed.
    await wheel.fromAlert(event(), null);
    const f = await wheel.claimAnimation(CH, 'studio-1');
    await wheel.reportAnimation(f.spin!.spin_id, {
      consumer_id: 'studio-1',
      event: 'failed',
      error: 'obs_unavailable',
    });
    // A real sub whose credit was refused (Jetons unavailable): shown, gain still pending.
    await core.db.query(
      "update currencies set active = false where id = 'main'",
    );
    const pending = (await wheel.fromAlert(event(), null))!;
    expect(pending.award.status).toBe('pending');
    const p = await wheel.claimAnimation(CH, 'studio-1');
    await wheel.reportAnimation(p.spin!.spin_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    expect(await steps(core.db, 'sub_wheel')).toHaveLength(0);
    // Paid later by the team: announced then, at once, once.
    await core.db.query(
      "update currencies set active = true where id = 'main'",
    );
    await wheel.award(p.spin!.spin_id);
    const s = await steps(core.db, 'sub_wheel');
    expect(s).toHaveLength(1);
    expect(new Date(s[0]!.available_at).getTime()).toBe(
      core.clock.now().getTime(),
    );
  });
});

describe('Tombola — winner announcements', () => {
  const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
  const QUIET: Partial<RaffleConfig> = {
    amount_mode: 'fixed',
    fixed_amount: 20_000,
    winners_mode: 'custom',
    winners_custom: 2,
    full: { enabled: false, chance_pct: 1 },
    super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
  };
  let seq = 0;
  async function fixture() {
    const core = await setup();
    core.clock.set(new Date('2026-10-22T20:00:00Z'));
    const raffle = new RaffleLabService(
      core.db,
      core.clock,
      () => 0.42,
      undefined,
      coreWalletEconomy(core.wallet.wallet),
    );
    const act = (command: Record<string, unknown>) =>
      raffle.act(CH, { actor: studio, command: RaffleCommand.parse(command) });
    const join = (v: string) =>
      raffle.join({
        channel_id: CH,
        viewer: { id: v, display_name: `V${v}` },
        idempotency_key: `ext-${v}-${++seq}`,
      }) as Promise<{ raffle_id: string }>;
    const after = async (ms: number) => {
      core.clock.advance(ms);
      await raffle.tick();
    };
    return { core, raffle, act, join, after };
  }

  it('each paid winner announced with its real share, 6 s after the end of the reveal animation, once whatever the replays', async () => {
    const f = await fixture();
    await f.act({
      action: 'config',
      config: { ...DEFAULT_RAFFLE_CONFIG, ...QUIET },
    });
    await f.act({ action: 'launch' });
    let raffleId = '';
    for (const v of ['9301', '9302', '9303'])
      raffleId = (await f.join(v)).raffle_id;
    expect(await steps(f.core.db, 'raffle')).toHaveLength(0);
    await f.after(62_000); // inscriptions closed: drawn and paid
    const card = await f.raffle.round(CH, raffleId);
    expect(card.winners).toHaveLength(2);
    const revealEnd = (
      await f.core.db.query<{ reveal_end_at: Date }>(
        'select reveal_end_at from lab_raffles where raffle_id = $1',
        [raffleId],
      )
    )[0]!.reveal_end_at;
    const s = await steps(f.core.db, 'raffle');
    expect(s.map((x) => x.params.text).sort()).toEqual(
      card.winners
        .map((w) => `🎉 Tombola : @${w.display_name} gagne 10 000 Jetons !`)
        .sort(),
    );
    for (const x of s) {
      expect(x.params.mode).toBe('normal');
      // End of the reveal animation + 6 s: the draw and the credits were not delayed (paid above).
      expect(RAFFLE_ANNOUNCE_DELAY_MS).toBe(6_000);
      expect(new Date(x.available_at).getTime()).toBe(
        new Date(revealEnd).getTime() + 6_000,
      );
      expect(new Date(x.available_at).getTime()).toBeGreaterThan(
        f.core.clock.now().getTime(),
      );
    }
    // Extra ticks and a refused retry: nothing more.
    await f.after(5_000);
    await f.after(60_000);
    await f
      .act({
        action: 'retry_payout',
        raffle_id: raffleId,
        viewer_id: card.winners[0]!.viewer_id,
      })
      .catch(() => null);
    expect(await steps(f.core.db, 'raffle')).toHaveLength(2);
  });

  it('a failed payout is not announced; announced once when the retry pays it', async () => {
    const f = await fixture();
    await f.act({
      action: 'config',
      config: { ...DEFAULT_RAFFLE_CONFIG, ...QUIET, winners_custom: 1 },
    });
    await f.act({ action: 'launch' });
    const { raffle_id } = await f.join('9401');
    await f.core.db.query(
      "update currencies set active = false where id = 'main'",
    );
    await f.after(62_000);
    expect(
      (await f.raffle.round(CH, raffle_id)).winners[0]!.payout_status,
    ).toBe('failed');
    expect(await steps(f.core.db, 'raffle')).toHaveLength(0);
    await f.after(60_000); // the reveal is over
    await f.core.db.query(
      "update currencies set active = true where id = 'main'",
    );
    await f.act({ action: 'retry_payout', raffle_id, viewer_id: '9401' });
    const s = await steps(f.core.db, 'raffle');
    expect(s).toHaveLength(1);
    expect(s[0]!.params.text).toBe('🎉 Tombola : @V9401 gagne 20 000 Jetons !');
    expect(new Date(s[0]!.available_at).getTime()).toBe(
      f.core.clock.now().getTime(),
    );
  });
});

describe('the chat queue — a scheduled announcement never holds the messages behind it', () => {
  it('a Roue du Sub message due in 8 s lets a Jeu des mots answer pass, then goes out on time', async () => {
    const core = await setup();
    const t0 = new Date('2026-10-22T20:00:00Z');
    core.clock.set(t0);
    const queue = new CommandSteps(core.db, core.clock);
    await queue.setOutput(CH, studioActor, true);
    await core.db.tx(async (q) => {
      await insertWordGameSteps(q, {
        channelId: CH,
        now: t0,
        origin: 'sub_wheel',
        drafts: [
          {
            idempotencyKey: 'sw-1',
            mode: 'normal',
            text: 'roue',
            delayMs: 8_000,
          },
        ],
      });
      await insertWordGameSteps(q, {
        channelId: CH,
        now: t0,
        drafts: [
          { idempotencyKey: 'jdm-1', mode: 'normal', text: 'mot trouvé' },
        ],
      });
    });
    const first = await queue.claim(CH, 'bot-1');
    expect(first.step?.params).toMatchObject({ text: 'mot trouvé' });
    await queue.ack(CH, first.step!.step_id, {
      executor_id: 'bot-1',
      attempt_id: first.step!.attempt_id!,
      event: 'running',
    });
    await queue.ack(CH, first.step!.step_id, {
      executor_id: 'bot-1',
      attempt_id: first.step!.attempt_id!,
      event: 'succeeded',
    });
    expect((await queue.claim(CH, 'bot-1')).reason).toBe('empty');
    core.clock.advance(8_000);
    expect((await queue.claim(CH, 'bot-1')).step?.params).toMatchObject({
      text: 'roue',
    });
  });
});
