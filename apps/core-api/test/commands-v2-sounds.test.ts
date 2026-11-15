import { randomUUID } from 'node:crypto';
import type { CmdConfig, LabChatMessage } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandsAdmission } from '../src/commands/admission.js';
import { diffConfig } from '../src/commands/model.js';
import { CommandsService } from '../src/commands/service.js';
import { CommandSteps } from '../src/commands/steps.js';
import type { Db } from '../src/db/db.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { createTestDb, FakeClock } from './helpers.js';

// Commands V2, the « sound » action and the people allowed by Twitch id: « !groslot » by Aouh plays a sound on stream
// (Studio's invisible OBS sound source), once per accepted use, never late; nobody else; a rename keeps the right.

const CH = '900100';
const STUDIO: Actor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const T0 = new Date('2026-11-15T20:00:00Z');
const SOUND = '0123456789abcdef';

let db: Db;
let clock: FakeClock;
let svc: CommandsService;
let adm: CommandsAdmission;
let steps: CommandSteps;
beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  svc = new CommandsService(db, clock);
  adm = new CommandsAdmission(db, clock);
  steps = new CommandSteps(db, clock);
});

const soundAction = (sound = SOUND) => ({
  type: 'sound' as const,
  v: 1 as const,
  id: randomUUID(),
  on_error: 'continue' as const,
  sound,
  label: 'Gros lot',
});
/** « !groslot »: only Aouh (by Twitch id), a sound, no message; 30 s between two uses. */
const groslot = (over: Partial<CmdConfig> = {}) =>
  svc.create(CH, STUDIO, {
    name: 'groslot',
    reply: { mode: 'silent', text: '', to: 'none' },
    audience: {
      groups: [],
      allow: [],
      allow_ids: [{ id: '501', name: 'Aouh' }],
      deny: [],
    },
    actions: [soundAction()],
    cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'global' },
    ...over,
  });
let seq = 0;
const msg = (
  text: string,
  who: { id: string; login: string },
  id = `m-${++seq}`,
): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: {
    id: who.id,
    login: who.login,
    display_name: who.login,
    role: 'viewer',
    badges: [],
  },
  source: 'twitch',
});
const AOUH = { id: '501', login: 'aouh' };
const BOB = { id: '702', login: 'bob' };
const queued = async () =>
  (
    await db.query<{ sound: string; status: string }>(
      'select sound, status from cmd_sounds order by id',
    )
  ).map((r) => [r.sound, r.status]);
const chatSteps = async () =>
  Number(
    (await db.query<{ n: string }>('select count(*) as n from cmd_steps'))[0]!
      .n,
  );

describe('Commands V2 — the sound action and the people allowed by Twitch id', () => {
  it('Aouh’s !groslot: ONE sound queued, no chat message; anyone else refused, no sound', async () => {
    await groslot();
    expect((await adm.chat(msg('!groslot', AOUH))).outcome).toBe('accepted');
    expect(await queued()).toEqual([[SOUND, 'queued']]);
    expect(await chatSteps()).toBe(0); // the sound only: nothing in the chat
    expect((await adm.chat(msg('!groslot', BOB))).outcome).toBe('rejected');
    expect(await queued()).toHaveLength(1);
  });

  it('a rename keeps the right (the Twitch id, not the pseudo); the cooldown holds the spam', async () => {
    await groslot();
    expect(
      (await adm.chat(msg('!groslot', { id: '501', login: 'aouh_renamed' })))
        .outcome,
    ).toBe('accepted');
    clock.current = new Date(T0.getTime() + 10_000);
    expect((await adm.chat(msg('!groslot', AOUH))).reason).toBe('cooldown');
    clock.current = new Date(T0.getTime() + 31_000);
    expect((await adm.chat(msg('!groslot', AOUH))).outcome).toBe('accepted');
    expect(await queued()).toHaveLength(2);
  });

  it('Studio’s OBS source takes each sound ONCE; a replayed message adds none; one not taken within its minute expires (never late)', async () => {
    await groslot();
    await adm.chat(msg('!groslot', AOUH, 'tw-1'));
    await adm.chat(msg('!groslot', AOUH, 'tw-1')); // the same Twitch message again
    expect(await steps.claimSounds(CH, 'obs-1')).toEqual({
      sounds: [{ id: expect.any(Number), sound: SOUND }],
    });
    expect(await steps.claimSounds(CH, 'obs-1')).toEqual({ sounds: [] });
    clock.current = new Date(T0.getTime() + 31_000);
    await adm.chat(msg('!groslot', AOUH));
    clock.current = new Date(T0.getTime() + 31_000 + 61_000);
    expect(await steps.claimSounds(CH, 'obs-1')).toEqual({ sounds: [] });
    expect(await queued()).toEqual([
      [SOUND, 'played'],
      [SOUND, 'expired'],
    ]);
  });

  it('several actions: a sound AND a message (one chat step); a command without the sound action plays nothing', async () => {
    await groslot({
      actions: [
        soundAction(),
        {
          type: 'chat',
          v: 1,
          id: randomUUID(),
          on_error: 'continue',
          mode: 'normal',
          text: 'JACKPOT !',
          to: 'none',
        },
      ],
    });
    await svc.create(CH, STUDIO, {
      name: 'hug',
      reply: { mode: 'normal', text: 'Câlin !', to: 'none' },
    });
    await adm.chat(msg('!groslot', AOUH));
    await adm.chat(msg('!hug', BOB));
    expect(await queued()).toHaveLength(1);
    expect(await chatSteps()).toBe(2); // « JACKPOT ! » and « Câlin ! »
  });

  it('the people allowed by id are the « audience.allow » field (the same team right, in the history); a bad sound id is refused', async () => {
    const before = (await groslot()).config;
    const after: CmdConfig = {
      ...before,
      audience: {
        ...before.audience,
        allow_ids: [
          ...(before.audience.allow_ids ?? []),
          { id: '702', name: 'Bob' },
        ],
      },
    };
    expect(diffConfig(before, after)).toEqual([
      {
        field: 'audience.allow',
        before: ['Aouh (ID 501)'],
        after: ['Aouh (ID 501)', 'Bob (ID 702)'],
      },
    ]);
    await expect(
      svc.create(CH, STUDIO, {
        name: 'mauvais',
        reply: { mode: 'silent', text: '', to: 'none' },
        actions: [{ ...soundAction(), sound: '../../etc/passwd' }],
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('long-poll: a waiting claim takes the sound as soon as the message is admitted (exact or keyword), never twice', async () => {
    await groslot({
      cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'global' },
    });
    await svc.create(CH, STUDIO, {
      name: 'ao',
      reply: { mode: 'silent', text: '', to: 'none' },
      audience: { groups: ['everyone'], allow: [], deny: [] },
      actions: [soundAction()],
      cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'global' },
      trigger: { mode: 'keywords', keywords: ['ao'], match: 'word' },
    });
    for (const text of ['!groslot', 'franchement ao']) {
      const started = Date.now();
      // Two Studios wait at once: the sound goes to one of them only.
      const claims = [
        steps.claimSounds(CH, 'obs-1', 20_000),
        steps.claimSounds(CH, 'obs-2', 300),
      ];
      await new Promise((r) => setTimeout(r, 30));
      expect((await adm.chat(msg(text, AOUH))).outcome).toBe('accepted');
      const got = (await Promise.all(claims)).flatMap((c) => c.sounds);
      expect(got).toHaveLength(1);
      // Woken by the admission, not by the end of the 20 s wait.
      expect(Date.now() - started).toBeLessThan(2_000);
    }
    // Nothing queued: the claim answers [] at the end of its wait.
    const t = Date.now();
    expect(await steps.claimSounds(CH, 'obs-1', 80)).toEqual({ sounds: [] });
    expect(Date.now() - t).toBeGreaterThanOrEqual(70);
    // A sound already queued: answered at once.
    await adm.chat(msg('!groslot', AOUH));
    expect((await steps.claimSounds(CH, 'obs-1', 20_000)).sounds).toHaveLength(
      1,
    );
  });
});
