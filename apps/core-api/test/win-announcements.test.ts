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
  raffleWinnersMessages,
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
      text: `🎡 @Viewer remporte ${GAIN.toLocaleString('fr-FR').replace(/\s/g, ' ')} jetons à la Roue du Sub !`,
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

  it('RV2-1 — the delay is the channel setting (Studio, broadcaster, journaled): 15 s, then 0 s; out of bounds refused', async () => {
    const { core, wheel } = await fixture();
    expect((await wheel.settings(CH)).announce_delay_s).toBe(
      SW_ANNOUNCE_DELAY_MS / 1000,
    );
    expect(
      (await wheel.setAnnounceDelay(CH, 15, 'studio')).announce_delay_s,
    ).toBe(15);
    for (const bad of [-1, 61, 2.5])
      await expect(
        wheel.setAnnounceDelay(CH, bad, 'studio'),
      ).rejects.toMatchObject({ code: 'invalid_announce_delay' });
    const end = async () => {
      await wheel.fromAlert(event(), null);
      const c = await wheel.claimAnimation(CH, 'studio-1');
      core.clock.advance(12_000);
      const at = core.clock.now().getTime();
      await wheel.reportAnimation(c.spin!.spin_id, {
        consumer_id: 'studio-1',
        event: 'completed',
      });
      return at;
    };
    const first = await end();
    await wheel.setAnnounceDelay(CH, 0, 'studio');
    const second = await end();
    const s = await steps(core.db, 'sub_wheel');
    expect(s.map((x) => new Date(x.available_at).getTime())).toEqual([
      first + 15_000,
      second,
    ]);
    const audit = await core.db.query<{ before: unknown; after: unknown }>(
      "select before, after from lab_moderation_audit where action = 'sw_announce_delay' order by id",
    );
    expect(audit).toEqual([
      { before: { announce_delay_s: 8 }, after: { announce_delay_s: 15 } },
      { before: { announce_delay_s: 15 }, after: { announce_delay_s: 0 } },
    ]);
  });
});

describe('Tombola — the winners announcement', () => {
  const w = (name: string, prize = '3 334 jetons') => ({ name, prize });
  it('one announcement for several winners; the exceptional single winner; the only participant; split at the Twitch limit, never a winner cut or lost', () => {
    expect(raffleWinnersMessages([w('Alice'), w('Bob'), w('Charlie')])).toEqual(
      [
        '🎉 Félicitations aux gagnants : @Alice - 3 334 jetons · @Bob - 3 334 jetons · @Charlie - 3 334 jetons',
      ],
    );
    expect(raffleWinnersMessages([w('Solo', '10 000 jetons')])).toEqual([
      '🎉 Félicitations au gagnant : @Solo - 10 000 jetons',
    ]);
    expect(raffleWinnersMessages([w('Solo', '10 000 jetons')], 'full')).toEqual(
      ['@Solo rafle toute la cagnotte : 10 000 jetons !'],
    );
    expect(
      raffleWinnersMessages([w('Solo', '10 000 jetons')], 'alone'),
    ).toEqual(['Seul participant, @Solo remporte 10 000 jetons !']);
    const names = Array.from(
      { length: 40 },
      (_, i) => `Viewer_Pseudo_${String(i).padStart(2, '0')}`,
    );
    const msgs = raffleWinnersMessages(names.map((n) => w(n, '1 000 jetons')));
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(m.length).toBeLessThanOrEqual(500);
      expect(m).toMatch(/^🎉 Félicitations aux gagnants : @.+ - 1 000 jetons$/);
    }
    const back = msgs.flatMap((m) =>
      m
        .replace(/^🎉 Félicitations aux gagnants : /, '')
        .split(' · ')
        .map((x) => x.replace(/^@/, '').replace(/ - 1 000 jetons$/, '')),
    );
    expect(back).toEqual(names);
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
  async function fixture(random = () => 0.42) {
    const core = await setup();
    core.clock.set(new Date('2026-10-22T20:00:00Z'));
    const raffle = new RaffleLabService(
      core.db,
      core.clock,
      random,
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

  it('the paid winners announced together with their real share, 6 s after the end of the reveal animation, once whatever the replays', async () => {
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
    expect(s.map((x) => x.params.text)).toEqual([
      `🎉 Félicitations aux gagnants : ${card.winners.map((w) => `@${w.display_name} - 10 000 jetons`).join(' · ')}`,
    ]);
    for (const x of s) {
      expect(x.params.mode).toBe('announce');
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
    expect(await steps(f.core.db, 'raffle')).toHaveLength(1);
  });

  it('the only participant wins by forfeit; the exceptional single winner (FULL, 4 participants) takes the whole pool: their own wording, one announcement each', async () => {
    const alone = await fixture();
    await alone.act({
      action: 'config',
      config: { ...DEFAULT_RAFFLE_CONFIG, ...QUIET },
    });
    await alone.act({ action: 'launch' });
    await alone.join('9501');
    await alone.after(62_000);
    expect(
      (await steps(alone.core.db, 'raffle')).map((x) => [
        x.params.mode,
        x.params.text,
      ]),
    ).toEqual([
      ['announce', 'Seul participant, @V9501 remporte 20 000 jetons !'],
    ]);
    // random() = 0: the FULL draw (0 < 1 %) — one winner out of four, the whole pool.
    const full = await fixture(() => 0);
    await full.act({
      action: 'config',
      config: {
        ...DEFAULT_RAFFLE_CONFIG,
        ...QUIET,
        winners_mode: 'auto',
        full: { enabled: true, chance_pct: 1 },
      },
    });
    await full.act({ action: 'launch' });
    for (const v of ['9601', '9602', '9603', '9604']) await full.join(v);
    await full.after(62_000);
    const s = await steps(full.core.db, 'raffle');
    expect(s).toHaveLength(1);
    expect(s[0]!.params.text).toMatch(
      /^@V960[1-4] rafle toute la cagnotte : 20 000 jetons !$/,
    );
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
    // The only participant: the same wording as it would have had at the draw.
    expect(s[0]!.params.text).toBe(
      'Seul participant, @V9401 remporte 20 000 jetons !',
    );
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
