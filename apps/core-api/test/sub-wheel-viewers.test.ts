import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { subWheelAmount } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../src/bonk-lab/lab-core.js';
import { systemClock } from '../src/clock.js';
import type { Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { loyaltyRoutes } from '../src/http/loyalty-routes.js';
import { classifyAnswer } from '../src/sub-wheel/chat.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { count, createPgliteDb, setup } from './helpers.js';

// Roue du Sub V2 — the Lab end to end (simulated live, presence, Twitch subscriptions, player, Lab wallet), « !roue »
// (R8), the natural invitations (R9), the Helix catch-up (R7), the viewers' privacy. The REAL Lab Core over HTTP on
// the dedicated Lab database (no production table), and the main Core's loyalty route for R7. Test databases only.

const CH = '900100';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function lab() {
  const db = createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
  await migrate(db, 'lab');
  const secret = randomBytes(32).toString('hex');
  const server: Server = createLabCore({
    db,
    clock: systemClock,
    secret,
  }).server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(async () => {
    server.close();
    await db.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async <T = Record<string, unknown>>(
    path: string,
    body?: unknown,
  ) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json()) as T & { error?: string };
    if (!res.ok)
      throw Object.assign(new Error(out.error ?? 'http'), {
        status: res.status,
      });
    return out as T;
  };
  const sw = `/v1/lab/sub-wheel/${CH}`;
  const studio = { id: 'antoni', role: 'broadcaster', via: 'studio' } as const;
  const live = (on: boolean) =>
    call(`/v1/lab/raffle/${CH}/actions`, {
      actor: studio,
      command: { action: on ? 'stream_start' : 'stream_end', reason: 'test' },
    });
  const playAlerts = async () => {
    for (;;) {
      const c = await call<{
        alert: { alert_id: string; attempt_id: string } | null;
      }>(`/v1/lab/alerts/${CH}/claim`, { consumer_id: 'a' });
      if (!c.alert) return;
      for (const event of ['started', 'completed'])
        await call(`/v1/lab/alerts/items/${c.alert.alert_id}/ack`, {
          consumer_id: 'a',
          attempt_id: c.alert.attempt_id,
          event,
        });
    }
  };
  /** The effects player claiming the next wheel and showing it to its end. */
  const wheel = async () => {
    const { spin } = await call<{
      spin: {
        spin_id: string;
        amount: number;
        months: number;
        tier: number;
        segment: number;
      } | null;
    }>(`${sw}/animations/claim`, { consumer_id: 'obs' });
    if (spin)
      await call(`/v1/lab/sub-wheel/spins/${spin.spin_id}/animation`, {
        consumer_id: 'obs',
        event: 'completed',
      });
    return spin;
  };
  const say = (
    viewer: { id: string; name: string },
    text: string,
    id = randomUUID(),
  ) =>
    call<{ handled: { module: string; outcome: string }[] }>('/v1/lab/chat', {
      channel_id: CH,
      message_id: id,
      text,
      chatter: {
        id: viewer.id,
        login: viewer.name.toLowerCase(),
        display_name: viewer.name,
        role: 'viewer',
      },
      source: 'simulator',
    });
  const outcome = async (p: ReturnType<typeof say>) =>
    (await p).handled.find((h) => h.module === 'sub_wheel')?.outcome ?? 'none';
  const replies = async () =>
    (
      await db.query<{ text: string }>(
        "select params->>'text' as text from cmd_steps where origin = 'sub_wheel' order by created_at, seq",
      )
    ).map((r) => r.text);
  /** The wheel's movements on the Lab test wallet (its own ledger kind). */
  const ledger = async (viewer: string) =>
    (
      await db.query<{ amount: number }>(
        "select amount from lab_wallet_ledger where kind = 'sub_wheel' and channel_id = $1 and viewer_id = $2",
        [CH, viewer],
      )
    ).map((r) => Number(r.amount));
  const tokens = async (viewer: string) =>
    Number(
      (
        await db.query<{ t: number }>(
          'select tokens as t from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, viewer],
        )
      )[0]?.t ?? 0,
    );
  const v2 = async () => {
    await call(`${sw}/settings`, { enabled: true });
    await call(`${sw}/mode`, { mode: 'v2' });
  };
  /** « Sortie chat réelle » (Studio, the broadcaster). */
  const output = (enabled: boolean) =>
    call(`/v1/lab/commands/${CH}/output`, { actor: studio, enabled });
  /** The chat executor (the bot) sending every due message: `succeeded` (delivered) or `failed` (Twitch refused). */
  const deliver = async (event: 'succeeded' | 'failed' = 'succeeded') => {
    const sent: string[] = [];
    for (;;) {
      const { step } = await call<{
        step: {
          step_id: string;
          attempt_id: string;
          params: { text: string };
        } | null;
      }>(`/v1/lab/commands/${CH}/steps/claim`, { executor_id: 'bot-1' });
      if (!step) return sent;
      const ack = (e: string, extra = {}) =>
        call(`/v1/lab/commands/${CH}/steps/${step.step_id}/ack`, {
          executor_id: 'bot-1',
          attempt_id: step.attempt_id,
          event: e,
          ...extra,
        });
      if (event === 'succeeded') {
        await ack('running');
        await ack('succeeded');
      } else
        await ack('failed', {
          error: { code: 'twitch_refused', message: 'drop', retryable: false },
        });
      sent.push(step.params.text);
    }
  };
  /** `!caution @target` by `payer`, read by the Caution executor: quoted (target timed out 5 min). */
  const cautionQuote = async (
    payer: { id: string; name: string },
    target: { id: string; name: string },
  ) => {
    const exec = { executor_id: 'bot-1', login: 'lecroupier_' };
    const claim = () =>
      call<{ job: { request_id: string; attempt_id: string } | null }>(
        `/v1/lab/caution/${CH}/claim`,
        { ...exec, can_read: true, can_release: true, missing: [] },
      );
    await claim(); // the executor is seen
    await say(payer, `!caution @${target.name}`);
    const job = (await claim()).job!;
    await call(`/v1/lab/caution/requests/${job.request_id}/check`, {
      executor_id: exec.executor_id,
      attempt_id: job.attempt_id,
      target: {
        id: target.id,
        login: target.name.toLowerCase(),
        name: target.name,
      },
      sanction: {
        kind: 'timeout',
        ends_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    });
    return job.request_id;
  };
  return {
    output,
    deliver,
    cautionQuote,
    db,
    call,
    sw,
    live,
    playAlerts,
    wheel,
    say,
    outcome,
    replies,
    tokens,
    ledger,
    v2,
  };
}

const ana = { id: '9801', name: 'Ana' };
const bob = { id: '9802', name: 'Bob' };

describe('Roue du Sub V2 — Lab end to end (simulators, player, Lab wallet)', () => {
  it('event → tour → presence → wheel → ONE Lab wallet credit → history; absent or unknown: kept', async () => {
    const l = await lab();
    await l.v2();
    await l.live(true);
    expect(
      (await l.call<{ settings: { lab: boolean } }>(`${l.sw}/state`)).settings,
    ).toMatchObject({ lab: true });
    // A new sub, as Twitch sends it: the chat notice and channel.subscribe — one tour, two proofs, auto (in live).
    await l.call(`${l.sw}/lab/simulate`, { kind: 'sub', viewer: ana, tier: 2 });
    await l.playAlerts();
    let rights = await l.call<Record<string, unknown>[]>(`${l.sw}/rights`);
    expect(rights).toHaveLength(1);
    expect(rights[0]).toMatchObject({
      status: 'owed',
      presence: 'unknown',
      sources: ['chat_notification', 'subscribe'],
      right: {
        queue: 'auto',
        month_source: 'estimated_no_history',
        sub_month: 1,
      },
    });
    // Readings OFF: unknown → nothing. Readings ON, Ana absent → nothing.
    expect(await l.wheel()).toBeNull();
    await l.call(`${l.sw}/lab/presence`, {
      readings: true,
      viewers: [{ ...ana, present: false }],
    });
    expect(
      (await l.call<Record<string, unknown>[]>(`${l.sw}/rights`))[0]!.presence,
    ).toBe('absent');
    expect(await l.wheel()).toBeNull();
    // Present: the next wheel draws it; one credit on the Lab test wallet, never a second.
    await l.call(`${l.sw}/lab/presence`, {
      viewers: [{ ...ana, present: true }],
    });
    const spin = (await l.wheel())!;
    expect(spin.amount).toBe(subWheelAmount(1, 2, spin.segment));
    expect(await l.wheel()).toBeNull();
    expect(await l.ledger(ana.id)).toEqual([spin.amount]); // one Lab wallet movement, the exact gain
    expect(
      await count(l.db, "lab_wallet_ledger where kind = 'sub_wheel'"),
    ).toBe(1);
    const s = await l.call<{ recent: Record<string, unknown>[] }>(
      `${l.sw}/state`,
    );
    expect(s.recent[0]).toMatchObject({
      status: 'shown',
      award: { status: 'awarded' },
    });
    rights = await l.call(`${l.sw}/rights`);
    expect(rights).toEqual([]);
  });

  it('resub with cumulative months (notice + message): one certain tour; Prime: tier 1; a subscribe alone (unshared)', async () => {
    const l = await lab();
    await l.v2();
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'resub',
      viewer: ana,
      tier: 1,
      months: 9,
    });
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'prime',
      viewer: bob,
      tier: 3,
    });
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'subscribe',
      viewer: { id: '9803', name: 'Cid' },
      tier: 1,
    });
    const rights = await l.call<
      {
        viewer: { name: string };
        tier: number;
        right: { sub_month: number; month_source: string; queue: string };
        sources: string[];
      }[]
    >(`${l.sw}/rights`);
    const by = (n: string) => rights.find((r) => r.viewer.name === n)!;
    expect(by('Ana')).toMatchObject({
      right: { sub_month: 9, month_source: 'twitch', queue: 'manual' },
      sources: ['chat_notification', 'message'],
    });
    expect(by('Bob')).toMatchObject({
      tier: 1,
      sources: ['chat_notification', 'subscribe'],
    });
    expect(by('Cid')).toMatchObject({ sources: ['subscribe'] });
    expect(await count(l.db, 'sw_spins')).toBe(3);
  });

  it('the simulators answer only in the Lab (a production-like database has none)', async () => {
    const core = await setup();
    const wheel = new SubWheelService(core.db, core.clock);
    await expect(wheel.labPresence(CH)).rejects.toMatchObject({
      code: 'lab_only',
    });
  });
});

describe('Roue du Sub V2 — « !roue » (R8)', () => {
  it('silent in mode v1 (production today): no answer, nothing written', async () => {
    const l = await lab();
    expect(await l.outcome(l.say(ana, '!roue'))).toBe('none');
    expect(await l.outcome(l.say(ana, 'oui'))).toBe('none');
    expect(await l.replies()).toEqual([]);
  });

  it('status, « oui » (in live: requested, drawn once present), « non » (nothing lost); one answer per message', async () => {
    const l = await lab();
    await l.v2();
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'resub',
      viewer: ana,
      tier: 1,
      months: 4,
    });
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'resub',
      viewer: bob,
      tier: 1,
      months: 6,
    });
    await l.playAlerts();
    const id = randomUUID();
    expect(await l.outcome(l.say(ana, '!roue', id))).toBe('status');
    await l.say(ana, '!roue', id); // redelivered: no second answer
    expect(await l.outcome(l.say(ana, '!roue oui'))).toBe('not_live');
    await l.live(true);
    expect(await l.outcome(l.say(ana, '!ROUE OUI'))).toBe('accepted');
    expect(await l.outcome(l.say(ana, '!roue oui'))).toBe('nothing_to_accept');
    expect(await l.outcome(l.say(bob, '!roue non'))).toBe('declined');
    expect(await l.replies()).toEqual([
      '@Ana Roue du Sub : 1 tour (1 à lancer). Tape !roue oui pour les lancer.',
      '@Ana les tours se lancent pendant le live : reviens à ce moment-là !',
      '@Ana c’est parti : 1 tour sera lancé pendant le live, quand tu seras là.',
      '@Ana c’est déjà demandé : tes tours arrivent.',
      '@Bob d’accord, ton tour t’attend (!roue oui quand tu veux).',
    ]);
    const rights = await l.call<
      { viewer: { name: string }; status: string; requested_via: string }[]
    >(`${l.sw}/rights`);
    expect(rights.find((r) => r.viewer.name === 'Ana')).toMatchObject({
      status: 'requested',
      requested_via: 'command',
    });
    expect(rights.find((r) => r.viewer.name === 'Bob')).toMatchObject({
      status: 'owed',
    });
    // A viewer's own request waits for its presence (never a credit at acceptance).
    const before = await l.tokens(ana.id);
    expect(await l.wheel()).toBeNull();
    expect(await l.tokens(ana.id)).toBe(before);
    await l.call(`${l.sw}/lab/presence`, {
      readings: true,
      viewers: [{ ...ana, present: true }],
    });
    const spin = (await l.wheel())!;
    expect(spin.months).toBe(4);
    expect(await l.ledger(ana.id)).toEqual([spin.amount]); // one Lab wallet movement, the exact gain
    expect(
      await count(l.db, "lab_wallet_ledger where kind = 'sub_wheel'"),
    ).toBe(1);
  });
});

describe('Roue du Sub V2 — natural invitations (R9)', () => {
  async function ready() {
    const l = await lab();
    await l.v2();
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'resub',
      viewer: ana,
      tier: 1,
      months: 4,
    });
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'resub',
      viewer: ana,
      tier: 1,
      months: 5,
    });
    await l.playAlerts();
    await l.live(true);
    await l.output(true);
    return l;
  }

  it('OFF by default: no invitation; ON (broadcaster, journaled): one per viewer and per live', async () => {
    const l = await ready();
    expect(await l.outcome(l.say(ana, 'salut tout le monde'))).toBe('none');
    expect(
      (
        await l.call<{ invitations_enabled: boolean }>(`${l.sw}/invitations`, {
          enabled: true,
        })
      ).invitations_enabled,
    ).toBe(true);
    expect(await l.outcome(l.say(ana, 'salut tout le monde'))).toBe('invited');
    expect(await l.outcome(l.say(ana, 'gg le dernier mot'))).toBe('none'); // unrelated: silent
    expect(await l.outcome(l.say(ana, 'encore moi'))).toBe('none');
    expect(await count(l.db, 'sw_invitations')).toBe(1);
    // A new live: one new invitation is possible.
    await l.live(false);
    await l.live(true);
    expect(await l.outcome(l.say(ana, 're'))).toBe('invited');
    expect(await count(l.db, 'sw_invitations')).toBe(2);
    expect(
      await count(l.db, "lab_moderation_audit where action = 'sw_invitations'"),
    ).toBe(1);
    expect((await l.replies())[0]).toBe(
      '@Ana tu as 2 tours de Roue du Sub en attente ! On les lance ? Réponds oui ou non.',
    );
  });

  it('« ouais vas-y »: accepted → requested (never a credit); the same message again: nothing more', async () => {
    const l = await ready();
    await l.call(`${l.sw}/invitations`, { enabled: true });
    await l.say(ana, 'coucou');
    await l.deliver();
    const id = randomUUID();
    expect(await l.outcome(l.say(ana, 'ouais vas-y !', id))).toBe('accepted');
    expect(await l.outcome(l.say(ana, 'ouais vas-y !', id))).toBe('replayed');
    const rights = await l.call<{ status: string; requested_via: string }[]>(
      `${l.sw}/rights`,
    );
    expect(rights.map((r) => [r.status, r.requested_via])).toEqual([
      ['requested', 'chat_accept'],
      ['requested', 'chat_accept'],
    ]);
    expect(
      await count(l.db, "lab_wallet_ledger where kind = 'sub_wheel'"),
    ).toBe(0);
    expect(
      (
        await l.db.query(
          'select status, answer_class, rights_requested from sw_invitations',
        )
      )[0],
    ).toEqual({
      status: 'accepted',
      answer_class: 'accept',
      rights_requested: 2,
    });
  });

  it('ambiguous: ONE clarification; then « non »: declined, rights kept; expired: kept, no answer', async () => {
    const l = await ready();
    await l.call(`${l.sw}/invitations`, { enabled: true });
    await l.say(ana, 'hello');
    await l.deliver();
    expect(await l.outcome(l.say(ana, 'oui mais plus tard'))).toBe('clarified');
    expect(await l.outcome(l.say(ana, 'euh ?'))).toBe('none');
    expect(await l.outcome(l.say(ana, 'nan'))).toBe('declined');
    expect(await count(l.db, "sw_spins where status = 'owed'")).toBe(2);
    const r = await l.replies();
    expect(r[1]).toBe('@Ana réponds !roue oui ou !roue non.');
    expect(r[2]).toBe(
      '@Ana d’accord, tes 2 tours t’attendent (!roue oui quand tu veux).',
    );
    // Expiry (3 min): the next answer is ignored, nothing lost; « !roue oui » still accepts.
    const g = await ready();
    await g.call(`${g.sw}/invitations`, { enabled: true });
    await g.say(ana, 'hello');
    await g.deliver();
    await g.db.query(
      "update sw_invitations set expires_at = now() - interval '1 second'",
    );
    expect(await g.outcome(g.say(ana, 'oui'))).toBe('expired');
    expect(await count(g.db, "sw_spins where status = 'owed'")).toBe(2);
    expect(await g.outcome(g.say(ana, '!roue oui'))).toBe('accepted');
  });

  it('only manual tours invite; a viewer without tours, or with auto tours only, is never invited', async () => {
    const l = await lab();
    await l.v2();
    await l.live(true);
    await l.call(`${l.sw}/invitations`, { enabled: true });
    await l.call(`${l.sw}/lab/simulate`, { kind: 'sub', viewer: ana, tier: 1 }); // in live → auto
    await l.playAlerts();
    expect(await l.outcome(l.say(ana, 'salut'))).toBe('none');
    expect(await l.outcome(l.say(bob, 'salut'))).toBe('none');
    expect(await count(l.db, 'sw_invitations')).toBe(0);
  });

  it('RV2-1 — « Sortie chat » OFF: nothing offered nor recorded; ON: answerable only once its message reached the chat', async () => {
    const l = await ready();
    await l.call(`${l.sw}/invitations`, { enabled: true });
    await l.output(false);
    expect(await l.outcome(l.say(ana, 'salut'))).toBe('none');
    expect(await count(l.db, 'sw_invitations')).toBe(0);
    expect(await l.replies()).toEqual([]);
    expect(await l.outcome(l.say(ana, 'oui'))).toBe('none'); // nothing to answer: tours untouched
    expect(await count(l.db, "sw_spins where status = 'owed'")).toBe(2);
    // ON: invited, but its message is still on its way — an answer is ignored, nothing consumed.
    await l.output(true);
    expect(await l.outcome(l.say(ana, 're'))).toBe('invited');
    expect(await l.outcome(l.say(ana, 'oui'))).toBe('invitation_pending');
    expect(await count(l.db, "sw_spins where status = 'owed'")).toBe(2);
    expect(
      (
        await l.db.query<{ status: string }>(
          'select status from sw_invitations',
        )
      )[0]!.status,
    ).toBe('offered');
    // Delivered: the next answer accepts (requested, never a credit here).
    expect(await l.deliver()).toEqual([
      '@Ana tu as 2 tours de Roue du Sub en attente ! On les lance ? Réponds oui ou non.',
    ]);
    expect(await l.outcome(l.say(ana, 'oui'))).toBe('accepted');
    expect(await count(l.db, "sw_spins where status = 'requested'")).toBe(2);
  });

  it('RV2-1 — never delivered (output turned OFF, then expired; or Twitch refused it): undelivered, never answerable, tours owed', async () => {
    for (const lost of ['expired', 'refused'] as const) {
      const l = await ready();
      await l.call(`${l.sw}/invitations`, { enabled: true });
      expect(await l.outcome(l.say(ana, 'salut'))).toBe('invited');
      if (lost === 'expired') {
        await l.output(false); // LeCroupier_ silenced before it was sent
        await l.db.query(
          "update cmd_steps set expires_at = now() - interval '1 second' where origin = 'sub_wheel'",
        );
      } else await l.deliver('failed');
      expect(await l.outcome(l.say(ana, 'oui'))).toBe('invitation_undelivered');
      expect(
        (
          await l.db.query<{ status: string }>(
            'select status from sw_invitations',
          )
        ).map((r) => r.status),
        lost,
      ).toEqual(['undelivered']);
      // Never answerable afterwards, never offered again in this live; the tours stay owed.
      await l.output(true);
      expect(await l.outcome(l.say(ana, 'oui'))).toBe('none');
      expect(await l.outcome(l.say(ana, 'coucou'))).toBe('none');
      expect(await count(l.db, 'sw_invitations')).toBe(1);
      expect(await count(l.db, "sw_spins where status = 'owed'")).toBe(2);
      // « !roue oui » always works (explicit), and leaves the undelivered invitation as it is.
      expect(await l.outcome(l.say(ana, '!roue oui'))).toBe('accepted');
      expect(await count(l.db, "sw_spins where status = 'requested'")).toBe(2);
      expect(
        (
          await l.db.query<{ status: string }>(
            'select status from sw_invitations',
          )
        )[0]!.status,
      ).toBe('undelivered');
    }
  });

  it('RV2-1 — one « oui », one question: a quoted caution takes it, the invitation stays open; the next « oui » accepts it', async () => {
    const l = await ready();
    await l.call(`${l.sw}/invitations`, { enabled: true });
    expect(await l.outcome(l.say(ana, 'salut'))).toBe('invited');
    await l.deliver();
    const request = await l.cautionQuote(ana, bob);
    // Ana has two questions open: the caution's quote (her own `!caution`) and the wheel's invitation.
    const id = randomUUID();
    const first = await l.say(ana, 'oui', id);
    expect(first.handled.map((h) => [h.module, h.outcome])).toEqual([
      ['caution', 'confirmed'],
    ]);
    expect(await count(l.db, "sw_spins where status = 'owed'")).toBe(2);
    expect(
      (
        await l.db.query<{ status: string }>(
          'select status from sw_invitations',
        )
      )[0]!.status,
    ).toBe('offered');
    expect(
      (
        await l.db.query<{ status: string }>(
          'select status from caution_requests where request_id = $1',
          [request],
        )
      )[0]!.status,
    ).toBe('confirmed');
    // The same Twitch message again (redelivery): still Caution's only, the wheel never sees it.
    const again = await l.say(ana, 'oui', id);
    expect(again.handled.map((h) => h.module)).toEqual(['caution']);
    expect(await count(l.db, "sw_spins where status = 'owed'")).toBe(2);
    // No caution question left: the next « oui » answers the invitation.
    const next = await l.say(ana, 'oui');
    expect(next.handled.map((h) => [h.module, h.outcome])).toEqual([
      ['sub_wheel', 'accepted'],
    ]);
    expect(await count(l.db, "sw_spins where status = 'requested'")).toBe(2);
  });
});

describe('Roue du Sub V2 — answer recognition (closed lists, deterministic)', () => {
  const table: [string, ReturnType<typeof classifyAnswer>][] = [
    ...[
      'oui',
      'ouais',
      'ouai',
      'ouiii',
      'OUI',
      'Oui !',
      'oui oui',
      'ouais vas-y',
      'vas y',
      'vasy',
      'go',
      'gooo',
      'GO GO',
      'ok',
      'ok go',
      'okay',
      'let’s go',
      "let's go",
      'lets go',
      'carrément',
      'carrement',
      'allez',
      'allez go',
      'yes',
      'yep',
      'yeah',
      'grave',
      'évidemment',
      'volontiers',
      'c’est parti',
      'bien sûr',
      'chaud',
      'partant',
      'oui stp',
      'oui svp',
      'oui merci',
      'go stp',
      'vas-y lance',
      'lance les tours',
      'oui lance la roue',
      'ouais direct',
      'go maintenant',
      'ok vas y',
      'yes !!',
      'oui 😄',
      '👍 oui',
      'Ouais.',
      'dac',
      'd’accord',
    ].map((t) => [t, 'accept'] as [string, 'accept']),
    ...[
      'non',
      'nan',
      'nope',
      'no',
      'NON',
      'non merci',
      'pas maintenant',
      'plus tard',
      'tout à l’heure',
      "tout a l'heure",
      'jamais',
      'nan merci',
      'non non',
      'later',
      'après',
      'demain',
      'pas maintenant merci',
      'non stp',
      'nan plus tard',
      'Non.',
      'non 😅',
      'nope !',
    ].map((t) => [t, 'decline'] as [string, 'decline']),
    ...[
      'oui mais plus tard',
      'euh ouais ?',
      'peut-être',
      'peut être',
      'go non attends',
      'oui ?',
      'non ?',
      'ouais non',
      'euh',
      'bof',
      'jsp',
      'je sais pas',
      'oui mais quand',
      'attends',
      'hmm ok',
      'ok mais pourquoi',
      'non oui',
      'go ? ',
      'euh non',
      'oui euh',
      'pourquoi pas',
    ].map((t) => [t, 'ambiguous'] as [string, 'ambiguous']),
    ...[
      'gg',
      'gg le dernier mot',
      '@aouh ouais',
      '@Ana oui',
      'oui @bob',
      'trop bien ce stream',
      'salut',
      'lol',
      'merci',
      'c’est quoi ?',
      '?',
      '',
      '   ',
      'oui oui oui oui oui oui',
      'ouais je suis là depuis le début',
      'go go go go go go',
      'non mais t’as vu ça',
      'ok je reviens',
      'GG WP',
      'bonne nuit',
      'nan mais allo',
      'le chat est fou',
      'on y va les gars',
      'oui je confirme le pseudo',
      'roue',
      'tour',
      '!roue',
      'je veux',
      'alors',
      'tout de suite',
      'ouii trop drole',
      'gooo raptor',
      'ok boomer',
      'yes sir',
      'go les bleus',
      'non jamais de la vie mdr',
      'kappa',
      'PogChamp',
      'mdr',
      'ahah oui',
    ].map((t) => [t, 'unrelated'] as [string, 'unrelated']),
  ];
  // The same phrases in other cases and spacing: never another class.
  const variants = table.flatMap(([t, c]) => [
    [t.toUpperCase(), c],
    [`  ${t}  `, c],
  ]) as [string, ReturnType<typeof classifyAnswer>][];

  it(`${table.length + variants.length} phrases (real answers and traps): the expected class, no false acceptance`, () => {
    expect(table.length + variants.length).toBeGreaterThanOrEqual(150);
    const wrong = [...table, ...variants]
      .map(([t, c]) => [t, c, classifyAnswer(t)] as const)
      .filter(([, c, got]) => c !== got);
    expect(JSON.stringify(wrong)).toBe('[]');
  });
});

describe('Roue du Sub V2 — privacy and the team (R8)', () => {
  it('a viewer reads only its own tours; the team view needs « Tirer » or « Accorder »; a moderator acts as itself', async () => {
    const l = await lab();
    await l.v2();
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'resub',
      viewer: ana,
      tier: 1,
      months: 3,
    });
    await l.call(`${l.sw}/lab/simulate`, {
      kind: 'resub',
      viewer: bob,
      tier: 1,
      months: 3,
    });
    const me = await l.call<{
      counts: Record<string, number>;
      rights: { spin_id: string }[];
    }>(`${l.sw}/viewers/${ana.id}`);
    expect(me.counts).toMatchObject({ manual: 1, auto: 0 });
    expect(me.rights).toHaveLength(1);
    expect(JSON.stringify(me)).not.toContain('Bob');
    const mod = {
      id: '7101',
      login: 'mod',
      role: 'moderator',
      via: 'extension',
    };
    await expect(
      l.call(`${l.sw}/team/rights`, { actor: mod }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      l.call(`/v1/lab/sub-wheel/spins/${me.rights[0]!.spin_id}/request`, {
        actor: mod,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await l.db.query(
      `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants) values ($1, '7101', 'moderator', 't', now(), '{subWheelDraw}')`,
      [CH],
    );
    expect(
      await l.call<unknown[]>(`${l.sw}/team/rights`, { actor: mod }),
    ).toHaveLength(2);
    await l.call(`/v1/lab/sub-wheel/spins/${me.rights[0]!.spin_id}/request`, {
      actor: mod,
    });
    const audit = (
      await l.db.query<{ actor: string; role: string }>(
        "select actor, role from lab_moderation_audit where action = 'sw_draw_request'",
      )
    )[0];
    expect(audit).toEqual({ actor: 'mod', role: 'moderator' });
    // The viewer's button (extension): its own tours only.
    expect(
      (
        await l.call<{ requested: number }>(
          `${l.sw}/viewers/${bob.id}/accept`,
          { login: 'bob' },
        )
      ).requested,
    ).toBe(1);
    expect(
      (
        await l.call<{ counts: Record<string, number> }>(
          `${l.sw}/viewers/${ana.id}`,
        )
      ).counts.requested,
    ).toBe(1);
  });
});

describe('Roue du Sub V2 — Helix catch-up (R7)', () => {
  async function main() {
    const core = await setup({ loyalty: { eventCredits: true } });
    const wheel = new SubWheelService(
      core.db,
      core.clock,
      () => 0,
      coreWalletEconomy(core.wallet.wallet),
    );
    const routes = loyaltyRoutes(core.loyalty, {
      service: wheel,
      channelId: CH,
    });
    const snap = routes.find((r) =>
      r.pattern.test('/v1/bot/loyalty/subscriptions/snapshot'),
    )!;
    const event = routes.find((r) => r.pattern.test('/v1/bot/loyalty/events'))!;
    const viewer = (id: string) => ({
      twitchUserId: id,
      login: `v${id}`,
      displayName: `V${id}`,
    });
    const snapshot = (at: Date, subs: [string, boolean][]) =>
      snap.handle({
        params: [],
        url: new URL('http://core'),
        body: {
          fetchedAt: at.toISOString(),
          subscribers: subs.map(([id, isGift]) => ({
            viewer: viewer(id),
            tier: 't1',
            isGift,
          })),
        },
      });
    const post = (body: unknown) =>
      event.handle({ params: [], url: new URL('http://core'), body });
    return { core, wheel, snapshot, post, viewer, db: core.db as Db };
  }
  const T = new Date('2026-10-22T20:00:00Z');
  const h = (n: number) => new Date(T.getTime() + n * 3_600_000);

  it('an active subscription alone never makes a tour: a paid subscriber Twitch never announced is only DETECTED (not on the baseline, never a gift)', async () => {
    const m = await main();
    await m.wheel.setMode(CH, 'v2_acquire', 'studio');
    // Baseline: everyone already known (first snapshot) — nothing.
    await m.snapshot(h(0), [['9901', false]]);
    // Later: 9902 (paid) and 9903 (gift) appear without any event.
    const later: [string, boolean][] = [
      ['9901', false],
      ['9902', false],
      ['9903', true],
    ];
    await m.snapshot(h(6), later);
    expect(await count(m.db, 'sw_spins')).toBe(0);
    expect(await m.wheel.subscriptionDetections(CH)).toMatchObject([
      { viewer_id: '9902', tier: 1 },
    ]);
    expect(
      await count(
        m.db,
        "sw_spin_sources where source = 'reconcile' and spin_id is null",
      ),
    ).toBe(1);
    // The same snapshot again: nothing more.
    await m.snapshot(h(6), later);
    expect(await count(m.db, 'sw_spin_sources')).toBe(1);
    expect(await count(m.db, 'sw_spins')).toBe(0);
  });

  it('a subscriber whose event was heard is never detected; mode v1: nothing', async () => {
    const m = await main();
    await m.wheel.setMode(CH, 'v2_acquire', 'studio');
    await m.snapshot(h(0), []);
    await m.post({
      type: 'sub',
      eventId: randomUUID(),
      occurredAt: h(1).toISOString(),
      viewer: m.viewer('9904'),
      tier: 't1',
      isGift: false,
    });
    await m.snapshot(h(6), [['9904', false]]);
    expect(
      await count(m.db, "sw_spin_sources where source = 'reconcile'"),
    ).toBe(0);
    expect(await count(m.db, 'sw_spins')).toBe(1);
    const v1 = await main();
    await v1.snapshot(h(0), []);
    await v1.snapshot(h(6), [['9905', false]]);
    expect(await count(v1.db, 'sw_spin_sources')).toBe(0);
  });

  it('its real event arriving later: ONE tour (the event), the detection stays a proof — no duplicate, no review', async () => {
    const m = await main();
    await m.wheel.setMode(CH, 'v2_acquire', 'studio');
    await m.snapshot(h(0), []);
    await m.snapshot(h(6), [['9906', false]]);
    // The outbox delivers the missed channel.subscribe (its Twitch time between the two snapshots), 2 h later.
    await m.post({
      type: 'sub',
      eventId: randomUUID(),
      occurredAt: h(3).toISOString(),
      viewer: m.viewer('9906'),
      tier: 't1',
      isGift: false,
    });
    expect(await count(m.db, 'sw_spins')).toBe(1);
    expect(await count(m.db, 'sw_spin_reviews')).toBe(0);
  });
});
