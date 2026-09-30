import {
  LabModerationCommand,
  type LabActor,
  type TtsLabAdmitRequest,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { BonkLabError409 } from '../src/bonk-lab/bonk-lab-service.js';
import {
  LabModerationError,
  LabModerationService,
} from '../src/lab-moderation/service.js';
import {
  LabForbiddenError,
  LabWalletError,
} from '../src/lab-moderation/store.js';
import { findWordHits, normalizeWord } from '../src/lab-moderation/words.js';
import {
  RaffleLabError409,
  RaffleLabService,
} from '../src/raffle-lab/raffle-lab-service.js';
import { SoundLabError409 } from '../src/sound-lab/sound-lab-service.js';
import {
  TtsLabError409,
  TtsLabUnavailableError,
} from '../src/tts-lab/tts-lab-service.js';
import { setup } from './helpers.js';

// Moderation V2 — parity D4: fine permissions, sensitive sanctions, watched / blocked words, notes,
// global pause, D4 cooldown, wallet admin, Soundboard stop + refunds, Bonk debit, minimal Tombola,
// history / ledger read models. Everything is decided by Core.

const CHANNEL = '900100';
const STUDIO = 'studio-A';
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const ext = (
  id: string,
  role: LabActor['role'],
  login = `u${id}`,
): LabActor => ({
  id,
  login,
  display_name: login,
  role,
  via: 'extension',
});
const modA = ext('900102', 'moderator', 'lab_modo');
const modB = ext('900107', 'moderator', 'modo_b');
const superMod = ext('900108', 'moderator', 'grobinou');
const owner = ext(CHANNEL, 'broadcaster', 'raptoru_lab');
const viewer = ext('900101', 'viewer', 'lab_viewer');
let seq = 0;

async function lab(random: () => number = Math.random) {
  const core = await setup();
  core.clock.set(new Date('2026-10-01T18:00:00Z'));
  const raffle = new RaffleLabService(core.db, core.clock, random);
  const m = new LabModerationService(
    core.db,
    core.clock,
    core.ttsLab,
    core.soundLab,
    core.bonkLab,
    raffle,
  );
  const tts = core.ttsLab;
  const ready = async () => {
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    await core.bonkLab.heartbeat({
      studio_instance_id: STUDIO,
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
  };
  await ready();
  const buy = (
    v = '900101',
    text = 'Salut Raptoru !',
    over: Partial<TtsLabAdmitRequest> = {},
  ) =>
    tts.admit({
      idempotency_key: `k-${++seq}`,
      channel_id: CHANNEL,
      viewer: { id: v, display_name: `V${v}` },
      lab_session_id: 'lab-1',
      text,
      payment_method: 'tokens',
      ...over,
    });
  const sound = (v = '900101', soundId = 'boop') =>
    core.soundLab.admit({
      idempotency_key: `s-${++seq}`,
      channel_id: CHANNEL,
      viewer: { id: v, display_name: `V${v}` },
      lab_session_id: 'lab-1',
      sound_id: soundId,
      payment_method: 'tokens',
    });
  const bonk = (v = '900101') =>
    core.bonkLab.admit({
      idempotency_key: `b-${++seq}`,
      channel_id: CHANNEL,
      viewer: { id: v, display_name: `V${v}` },
      lab_session_id: 'lab-1',
      emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
    });
  const join = (v = '900101') =>
    raffle.join({
      channel_id: CHANNEL,
      viewer: { id: v, display_name: `V${v}` },
      idempotency_key: `r-${++seq}`,
    });
  const act = (command: Record<string, unknown>, actor: LabActor = studio) =>
    m.act(CHANNEL, {
      actor,
      command: LabModerationCommand.parse(command),
    });
  const wallet = (v = '900101') => m.wallet(CHANNEL, v);
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof LabForbiddenError) return 'forbidden';
      if (
        e instanceof LabWalletError ||
        e instanceof TtsLabError409 ||
        e instanceof SoundLabError409 ||
        e instanceof BonkLabError409 ||
        e instanceof RaffleLabError409 ||
        e instanceof LabModerationError ||
        e instanceof TtsLabUnavailableError
      )
        return e.code;
      throw e;
    }
  };
  /** Claims the next TTS and starts it. */
  const playTts = async () => {
    const i = (await tts.claim(STUDIO, CHANNEL))!;
    await tts.ack(i.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: i.delivery.attempt_id!,
      event: 'started',
    });
    return i;
  };
  const endTts = async (i: { interaction_id: string }) =>
    tts.ack(i.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: (await tts.get(i.interaction_id)).delivery.attempt_id!,
      event: 'completed',
    });
  // The moderators are seen once through the extension (team), the supermod is named by Studio.
  for (const a of [modA, modB, superMod, owner]) await m.whoami(CHANNEL, a);
  await act({ action: 'set_staff', viewer_id: superMod.id, role: 'supermod' });
  return {
    core,
    m,
    tts,
    raffle,
    ready,
    buy,
    sound,
    bonk,
    join,
    act,
    wallet,
    code,
    playTts,
    endTts,
  };
}

const grantCmd = (viewer_id: string, permission: string, granted = true) => ({
  action: 'set_permission',
  viewer_id,
  permission,
  granted,
});

describe('D4 team & fine permissions (Core-enforced)', () => {
  it('a moderator without a grant is refused each gated action; granted → accepted; removed → refused at once', async () => {
    const { act, code, buy } = await lab();
    const i = (await buy('900150')).interaction;
    const gated: [string, Record<string, unknown>][] = [
      [
        'wallet',
        {
          action: 'wallet_adjust',
          viewer_id: '900150',
          currency: 'tokens',
          delta: 100,
        },
      ],
      [
        'modules',
        { action: 'module_state', module: 'bonk', state: 'disabled' },
      ],
      ['globalPause', { action: 'global_pause', paused: true }],
      ['perms', grantCmd(modB.id, 'words')],
      [
        'sensitive',
        {
          action: 'block_viewer',
          viewer_id: '900151',
          module: 'all',
          duration_s: 60,
        },
      ],
      ['words', { action: 'add_word', word: 'nul', kind: 'watch' }],
      [
        'wallet',
        { action: 'refund', module: 'tts', interaction_id: i.interaction_id },
      ],
    ];
    for (const [, cmd] of gated)
      expect(await code(act(cmd, modA))).toBe('forbidden');
    // The broadcaster grants everything to modA.
    for (const g of [
      'wallet',
      'modules',
      'globalPause',
      'perms',
      'sensitive',
      'words',
    ])
      await act(grantCmd(modA.id, g));
    await act({
      action: 'cancel',
      module: 'tts',
      interaction_id: i.interaction_id,
      refund: false,
    });
    for (const [, cmd] of gated.slice(0, 6))
      expect(await code(act(cmd, modA))).toBe('ok');
    expect(await code(act(gated[6]![1], modA))).toBe('ok'); // manual refund of a finished TTS
    // Removed → refused immediately.
    await act(grantCmd(modA.id, 'wallet', false));
    expect(await code(act(gated[0]![1], modA))).toBe('forbidden');
    await act({ action: 'global_pause', paused: false });
  });

  it('supermod and broadcaster (extension or Studio) have every permission; a viewer none', async () => {
    const { act, code, m } = await lab();
    const s = await m.whoami(CHANNEL, superMod);
    expect(s.role).toBe('supermod');
    expect(s.grants).toHaveLength(6);
    expect((await m.whoami(CHANNEL, owner)).role).toBe('broadcaster');
    expect(
      await code(act({ action: 'global_pause', paused: true }, superMod)),
    ).toBe('ok');
    expect(
      await code(act({ action: 'global_pause', paused: false }, owner)),
    ).toBe('ok');
    expect(
      await code(
        act({ action: 'module_state', module: 'tts', state: 'paused' }, viewer),
      ),
    ).toBe('forbidden');
    const v = await m.whoami(CHANNEL, viewer);
    expect(v).toMatchObject({ role: 'viewer', grants: [], permissions: [] });
    // Studio-only tools stay the broadcaster's (a supermod cannot name supermods).
    expect(
      await code(
        act(
          { action: 'set_staff', viewer_id: modB.id, role: 'supermod' },
          superMod,
        ),
      ),
    ).toBe('forbidden');
  });

  it('no self-escalation, only permissions one holds, never a supermod or the broadcaster; audited', async () => {
    const { act, code, m } = await lab();
    await act(grantCmd(modA.id, 'perms'));
    await act(grantCmd(modA.id, 'words'));
    // Own permissions: never.
    expect(await code(act(grantCmd(modA.id, 'wallet'), modA))).toBe(
      'self_edit',
    );
    // A permission modA does not hold: refused.
    expect(await code(act(grantCmd(modB.id, 'wallet'), modA))).toBe(
      'forbidden',
    );
    // One it holds: granted to another moderator, and removed.
    expect(await code(act(grantCmd(modB.id, 'words'), modA))).toBe('ok');
    expect((await m.whoami(CHANNEL, modB)).grants).toEqual(['words']);
    expect(await code(act(grantCmd(modB.id, 'words', false), modA))).toBe('ok');
    // Higher levels: never editable.
    expect(await code(act(grantCmd(superMod.id, 'words'), modA))).toBe(
      'target_not_editable',
    );
    expect(await code(act(grantCmd(CHANNEL, 'words'), modA))).toBe(
      'target_not_editable',
    );
    expect(await code(act(grantCmd(superMod.id, 'words')))).toBe(
      'target_not_editable',
    );
    // Not in the team.
    expect(await code(act(grantCmd('900199', 'words')))).toBe('not_in_team');
    const trail = (await m.auditTrail(CHANNEL, { limit: 50 })) as {
      action: string;
      actor: string;
      viewer_id: string;
      after: { permission: string; granted: boolean };
    }[];
    const perms = trail.filter((t) => t.action === 'set_permission');
    expect(perms[0]).toMatchObject({
      actor: 'lab_modo',
      viewer_id: modB.id,
      after: { permission: 'words', granted: false },
    });
    expect(perms.length).toBe(4);
  });

  it('team read model: broadcaster, supermod, moderators with their grants', async () => {
    const { act, m } = await lab();
    await act(grantCmd(modB.id, 'modules'));
    const { members } = await m.team(CHANNEL);
    expect(members.map((x) => [x.viewer_id, x.role])).toEqual([
      [CHANNEL, 'broadcaster'],
      [superMod.id, 'supermod'],
      [modA.id, 'moderator'],
      [modB.id, 'moderator'],
    ]);
    expect(members.find((x) => x.viewer_id === modB.id)!.grants).toEqual([
      'modules',
    ]);
    expect(
      members.find((x) => x.viewer_id === superMod.id)!.grants,
    ).toHaveLength(6);
    // Demoted supermod → moderator with the standard moderation (no grant).
    await act({ action: 'set_staff', viewer_id: superMod.id, role: null });
    expect((await m.whoami(CHANNEL, superMod)).role).toBe('moderator');
    expect((await m.whoami(CHANNEL, superMod)).grants).toEqual([]);
  });

  it('module states: pause / resume = every mod; to or from « Désactivé » = « Désactiver un module »', async () => {
    const { act, code } = await lab();
    expect(
      await code(
        act(
          { action: 'module_state', module: 'soundboard', state: 'paused' },
          modA,
        ),
      ),
    ).toBe('ok');
    expect(
      await code(
        act(
          { action: 'module_state', module: 'soundboard', state: 'active' },
          modA,
        ),
      ),
    ).toBe('ok');
    await act({
      action: 'module_state',
      module: 'soundboard',
      state: 'disabled',
    });
    expect(
      await code(
        act(
          { action: 'module_state', module: 'soundboard', state: 'active' },
          modA,
        ),
      ),
    ).toBe('forbidden');
    expect(
      await code(
        act(
          { action: 'module_state', module: 'soundboard', state: 'paused' },
          modA,
        ),
      ),
    ).toBe('forbidden');
    await act(grantCmd(modA.id, 'modules'));
    expect(
      await code(
        act(
          { action: 'module_state', module: 'soundboard', state: 'active' },
          modA,
        ),
      ),
    ).toBe('ok');
  });
});

describe('D4 sensitive sanctions', () => {
  it('everything or more than one hour (or until unblocked) needs « Sanctions sensibles »; exactly 1 h does not', async () => {
    const { act, code, m } = await lab();
    const block = (module: string, duration_s: number | null) =>
      act(
        { action: 'block_viewer', viewer_id: '900160', module, duration_s },
        modA,
      );
    expect(await code(block('tts', 3600))).toBe('ok');
    expect(await code(block('tts', 3601))).toBe('forbidden');
    expect(await code(block('all', 30))).toBe('forbidden');
    expect(await code(block('raffle', null))).toBe('forbidden');
    await act(grantCmd(modA.id, 'sensitive'));
    expect(await code(block('all', 7200))).toBe('ok');
    const trail = (await m.auditTrail(CHANNEL, { limit: 10 })) as {
      action: string;
      after: { sensitive: boolean };
    }[];
    expect(
      trail.find((t) => t.action === 'block_viewer')!.after.sensitive,
    ).toBe(true);
  });

  it('a team member is never sanctioned (block, cooldown)', async () => {
    const { act, code } = await lab();
    expect(
      await code(
        act(
          {
            action: 'block_viewer',
            viewer_id: modB.id,
            module: 'tts',
            duration_s: 60,
          },
          modA,
        ),
      ),
    ).toBe('target_is_staff');
    expect(
      await code(
        act({
          action: 'set_cooldown',
          viewer_id: CHANNEL,
          module: 'tts',
          delay_s: 60,
          span: 900,
        }),
      ),
    ).toBe('target_is_staff');
  });
});

describe('D4 watched / blocked words (TTS admission in Core)', () => {
  it('matching: whole words, case and accents ignored, flexible spaces, positions in the original text', () => {
    const rules = [
      {
        id: 1,
        word: 'nul',
        normalized: normalizeWord('nul'),
        kind: 'watch' as const,
      },
      {
        id: 2,
        word: 'arrête le stream',
        normalized: normalizeWord('Arrête le stream'),
        kind: 'watch' as const,
      },
      {
        id: 3,
        word: 'ta gueule',
        normalized: normalizeWord('ta gueule'),
        kind: 'block' as const,
      },
    ];
    const text = 'Raptoru t NUL, arrete  le STREAM';
    const hits = findWordHits(text, rules);
    expect(hits.map((h) => [h.word, text.slice(h.start, h.end)])).toEqual([
      ['nul', 'NUL'],
      ['arrête le stream', 'arrete  le STREAM'],
    ]);
    expect(findWordHits('nulle part, annulé', rules)).toEqual([]);
    expect(findWordHits('TA GUEULE', rules)[0]!.kind).toBe('block');
  });

  it('blocked word: refused before the queue, nothing paid or stored', async () => {
    const { act, buy, code, wallet, core } = await lab();
    await act({ action: 'add_word', word: 'ta gueule', kind: 'block' });
    const before = await wallet('900170');
    expect(await code(buy('900170', 'Oh TA GUEULE !'))).toBe('message_blocked');
    expect(await wallet('900170')).toEqual(before);
    expect(
      (
        await core.db.query<{ n: number }>(
          "select count(*)::int as n from tts_lab_interactions where viewer_id = '900170'",
        )
      )[0]!.n,
    ).toBe(0);
  });

  it('watched word: held « À vérifier », the queue goes on without it; « Laisser passer » releases it', async () => {
    const { act, buy, tts, playTts, endTts, code } = await lab();
    await act({ action: 'add_word', word: 'nul', kind: 'watch' }, superMod);
    const flagged = (await buy('900171', 'raptoru t vraiment nul ce soir'))
      .interaction;
    expect(flagged).toMatchObject({
      review_status: 'pending',
      status: 'queued',
    });
    expect(flagged.review_hits).toEqual([{ word: 'nul', start: 19, end: 22 }]);
    const clean = (await buy('900172', 'Coucou le stream')).interaction;
    // The held one is skipped: the clean one is read first.
    const first = await playTts();
    expect(first.interaction_id).toBe(clean.interaction_id);
    await endTts(first);
    expect(await tts.claim(STUDIO, CHANNEL)).toBeNull();
    // « Laisser passer » needs no special grant (standard moderation, D4).
    expect(
      await code(
        act(
          {
            action: 'allow',
            module: 'tts',
            interaction_id: flagged.interaction_id,
          },
          modA,
        ),
      ),
    ).toBe('ok');
    const released = await tts.get(flagged.interaction_id);
    expect(released).toMatchObject({
      review_status: 'allowed',
      reviewed_by: 'lab_modo',
    });
    expect((await tts.claim(STUDIO, CHANNEL))?.interaction_id).toBe(
      flagged.interaction_id,
    );
    expect(
      await code(
        act({
          action: 'allow',
          module: 'tts',
          interaction_id: flagged.interaction_id,
        }),
      ),
    ).toBe('not_pending');
  });

  it('a held TTS can be removed with its refund; unreviewed, it expires and is refunded automatically', async () => {
    const { act, buy, tts, core, wallet } = await lab();
    await act({ action: 'add_word', word: 'nul', kind: 'watch' });
    const a = (await buy('900173', 'nul')).interaction;
    await act(
      {
        action: 'cancel',
        module: 'tts',
        interaction_id: a.interaction_id,
        refund: true,
      },
      modA,
    );
    expect(await tts.get(a.interaction_id)).toMatchObject({
      status: 'cancelled',
      refund_status: 'refunded',
    });
    expect((await wallet('900173')).tokens).toBe(12_000);
    const b = (await buy('900174', 'toujours nul')).interaction;
    core.clock.advance(31 * 60_000);
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    await tts.claim(STUDIO, CHANNEL); // sweep
    expect(await tts.get(b.interaction_id)).toMatchObject({
      status: 'failed',
      refund_status: 'refunded',
    });
    expect((await wallet('900174')).tokens).toBe(12_000);
  });

  it('the list: add / remove (permission « Mots »), queued TTS re-evaluated, audited', async () => {
    const { act, buy, tts, code, m } = await lab();
    const t = (await buy('900175', 'Arrête le stream stp')).interaction;
    expect(t.review_status).toBe('none');
    expect(
      await code(
        act(
          { action: 'add_word', word: 'arrete le stream', kind: 'watch' },
          modA,
        ),
      ),
    ).toBe('forbidden');
    await act(grantCmd(modA.id, 'words'));
    expect(
      await code(
        act(
          { action: 'add_word', word: 'arrete le stream', kind: 'watch' },
          modA,
        ),
      ),
    ).toBe('ok');
    expect(
      await code(
        act(
          { action: 'add_word', word: 'ARRÊTE  le stream', kind: 'block' },
          modA,
        ),
      ),
    ).toBe('word_exists');
    expect((await tts.get(t.interaction_id)).review_status).toBe('pending');
    const { words } = await m.words(CHANNEL);
    expect(words.map((w) => [w.word, w.kind])).toEqual([
      ['arrete le stream', 'watch'],
    ]);
    await act({ action: 'remove_word', word_id: words[0]!.id }, modA);
    expect((await tts.get(t.interaction_id)).review_status).toBe('none');
    const trail = (await m.auditTrail(CHANNEL, { limit: 10 })) as {
      action: string;
    }[];
    expect(trail.map((x) => x.action)).toEqual(
      expect.arrayContaining(['word_add', 'word_remove']),
    );
  });
});

describe('D4 internal notes', () => {
  it('any moderator adds a note (author, time, team only); a viewer cannot; audited; 140 characters max', async () => {
    const { act, code, m, core } = await lab();
    await act(
      { action: 'add_note', viewer_id: '900180', text: 'spam TTS, averti' },
      modA,
    );
    core.clock.advance(60_000);
    await act(
      { action: 'add_note', viewer_id: '900180', text: 'second' },
      superMod,
    );
    expect(
      await code(
        act({ action: 'add_note', viewer_id: '900180', text: 'x' }, viewer),
      ),
    ).toBe('forbidden');
    const card = await m.viewer(CHANNEL, '900180');
    expect(card.notes.map((n) => [n.text, n.author])).toEqual([
      ['second', 'grobinou'],
      ['spam TTS, averti', 'lab_modo'],
    ]);
    expect(card.notes[1]!.created_at).toBe('2026-10-01T18:00:00.000Z');
    expect(
      LabModerationCommand.safeParse({
        action: 'add_note',
        viewer_id: '1',
        text: 'x'.repeat(141),
      }).success,
    ).toBe(false);
    await expect(m.assertReader(CHANNEL, viewer)).rejects.toBeInstanceOf(
      LabForbiddenError,
    );
    await expect(m.assertReader(CHANNEL, modA)).resolves.toBeUndefined();
    const trail = (await m.auditTrail(CHANNEL, { viewer: '900180' })) as {
      action: string;
    }[];
    expect(trail.filter((t) => t.action === 'note_add')).toHaveLength(2);
  });
});

describe('D4 global pause', () => {
  it('refuses every new interaction (TTS, sounds, bonks, Tombola), counts them, cuts nothing; resume resets', async () => {
    const { act, buy, sound, bonk, join, code, tts, wallet, m } = await lab();
    const queued = (await buy('900190')).interaction;
    await act({ action: 'raffle_open', jackpot: 1000, duration_s: 600 });
    await act({ action: 'global_pause', paused: true }, superMod);
    const before = await wallet('900191');
    expect(await code(buy('900191'))).toBe('global_pause');
    expect(await code(sound('900191'))).toBe('global_pause');
    expect(await code(bonk('900191'))).toBe('global_pause');
    expect(await code(join('900191'))).toBe('global_pause');
    expect(await wallet('900191')).toEqual(before);
    expect((await m.overview(CHANNEL)).global).toMatchObject({
      paused: true,
      refused: 4,
    });
    expect((await tts.viewerState(CHANNEL, '900191')).global_paused).toBe(true);
    // What was already admitted goes on.
    expect((await tts.claim(STUDIO, CHANNEL))?.interaction_id).toBe(
      queued.interaction_id,
    );
    await act({ action: 'global_pause', paused: false }, superMod);
    expect((await m.overview(CHANNEL)).global).toMatchObject({
      paused: false,
      refused: 0,
    });
    expect(await code(sound('900191'))).toBe('ok');
    const trail = (await m.auditTrail(CHANNEL, { limit: 20 })) as {
      action: string;
    }[];
    expect(trail.map((t) => t.action)).toEqual(
      expect.arrayContaining(['global_pause', 'global_resume']),
    );
  });
});

describe('D4 personal cooldown (delay between two uses, during a span)', () => {
  it('applies from the last use, lets a use through after the delay, replaced, expires with its span', async () => {
    const { act, sound, code, core, m } = await lab();
    await sound('900200');
    await act(
      {
        action: 'set_cooldown',
        viewer_id: '900200',
        module: 'soundboard',
        delay_s: 120,
        span: 900,
      },
      modA,
    );
    expect(await code(sound('900200'))).toBe('viewer_cooldown');
    core.clock.advance(120_000);
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    expect(await code(sound('900200'))).toBe('ok');
    expect(await code(sound('900200'))).toBe('viewer_cooldown'); // the delay starts again
    // Replaced: a shorter delay.
    await act({
      action: 'set_cooldown',
      viewer_id: '900200',
      module: 'soundboard',
      delay_s: 30,
      span: 900,
    });
    core.clock.advance(30_000);
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    expect(await code(sound('900200'))).toBe('ok');
    const card = await m.viewer(CHANNEL, '900200');
    expect(card.restrictions).toEqual([
      expect.objectContaining({
        kind: 'cooldown',
        module: 'soundboard',
        delay_s: 30,
        stream: false,
      }),
    ]);
    // Span over: no more imposed delay.
    core.clock.advance(900_000);
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    expect(await code(sound('900200'))).toBe('ok');
    expect(await code(sound('900200'))).toBe('ok');
    expect((await m.viewer(CHANNEL, '900200')).restrictions).toEqual([]);
  });

  it('« Ce stream » (3 h), Bonk and TTS; clear removes it; audited', async () => {
    const { act, bonk, buy, code, m, playTts, endTts, core } = await lab();
    await bonk('900201');
    await act({
      action: 'set_cooldown',
      viewer_id: '900201',
      module: 'bonk',
      delay_s: 300,
      span: 'stream',
    });
    expect(await code(bonk('900201'))).toBe('viewer_cooldown');
    const r = (await m.viewer(CHANNEL, '900201')).restrictions[0]!;
    expect(r).toMatchObject({ stream: true, delay_s: 300 });
    expect(Date.parse(r.until!) - core.clock.now().getTime()).toBe(
      3 * 3600_000,
    );
    await act(
      { action: 'clear_cooldown', viewer_id: '900201', module: 'bonk' },
      modA,
    );
    expect(await code(bonk('900201'))).toBe('ok');
    // TTS: the personal delay is shown to the viewer as its cooldown.
    const t = (await buy('900202')).interaction;
    await endTts(await playTts());
    core.clock.advance(60_000); // the tier cooldown (60 s) is over
    await act({
      action: 'set_cooldown',
      viewer_id: '900202',
      module: 'tts',
      delay_s: 600,
      span: 3600,
    });
    expect(await code(buy('900202'))).toBe('viewer_cooldown');
    expect(t.interaction_id).toBeTruthy();
    const trail = (await m.auditTrail(CHANNEL, { limit: 20 })) as {
      action: string;
    }[];
    expect(trail.map((x) => x.action)).toEqual(
      expect.arrayContaining(['cooldown_set', 'cooldown_clear']),
    );
  });

  it('non-regression: a clear made while a TTS waits is not re-armed when it starts', async () => {
    const { act, buy, playTts, endTts, core, tts, code } = await lab();
    await act({
      action: 'wallet_adjust',
      viewer_id: '900203',
      currency: 'tokens',
      delta: 50_000,
    });
    const a = (await buy('900203')).interaction;
    await endTts(await playTts()); // cooldown 60 s armed at the start
    expect(
      (await tts.viewerState(CHANNEL, '900203')).cooldown_remaining_ms,
    ).toBe(60_000);
    await act(
      { action: 'clear_cooldown', viewer_id: '900203', module: 'tts' },
      modA,
    );
    expect(
      (await tts.viewerState(CHANNEL, '900203')).cooldown_remaining_ms,
    ).toBe(0);
    const b = (await buy('900203')).interaction; // bought right after the clear
    await act({ action: 'clear_cooldown', viewer_id: '900203', module: 'tts' });
    await playTts(); // b starts: its start must not re-arm the cleared cooldown
    expect(
      (await tts.viewerState(CHANNEL, '900203')).cooldown_remaining_ms,
    ).toBe(0);
    expect(a.interaction_id).not.toBe(b.interaction_id);
    core.clock.advance(1000);
    expect(await code(buy('900204'))).toBe('ok');
  });
});

describe('D4 wallet admin', () => {
  it('credit / debit with « Admin Wallet », never below 0, exact ledger (actor, reason); refused without', async () => {
    const { act, code, wallet, m } = await lab();
    const adj = (delta: number, currency = 'tokens', actor: LabActor = modA) =>
      act(
        {
          action: 'wallet_adjust',
          viewer_id: '900210',
          currency,
          delta,
          reason: 'bug Soundboard',
        },
        actor,
      );
    expect(await code(adj(500))).toBe('forbidden');
    await act(grantCmd(modA.id, 'wallet'));
    expect(await code(adj(500))).toBe('ok');
    expect((await wallet('900210')).tokens).toBe(12_500);
    expect(await code(adj(-2, 'credits_soundboard'))).toBe('ok');
    expect((await wallet('900210')).credits_soundboard).toBe(1);
    expect(await code(adj(-50, 'credits_soundboard'))).toBe('ok'); // floored at 0 (D4)
    expect((await wallet('900210')).credits_soundboard).toBe(0);
    expect(await code(adj(-1, 'credits_soundboard'))).toBe('nothing_to_debit');
    const { items } = await m.ledger(CHANNEL, { viewer: '900210' });
    expect(
      items.map((e) => [
        e.operation_type,
        e.amount,
        e.currency,
        e.actor,
        e.reason,
        e.label,
      ]),
    ).toEqual([
      [
        'admin',
        -1,
        'credits_soundboard',
        'lab_modo',
        'bug Soundboard',
        'Ajustement admin',
      ],
      [
        'admin',
        -2,
        'credits_soundboard',
        'lab_modo',
        'bug Soundboard',
        'Ajustement admin',
      ],
      [
        'admin',
        500,
        'tokens',
        'lab_modo',
        'bug Soundboard',
        'Ajustement admin',
      ],
    ]);
  });
});

describe('D4 Soundboard: stop, stop all, refunds (Core → worker → player → ACK)', () => {
  it('a playing sound is stopped (+ refund); late ACKs ignored; the player proves the stop', async () => {
    const { act, sound, core, wallet, code } = await lab();
    const s = (await sound('900220')).interaction;
    expect((await wallet('900220')).tokens).toBe(11_500);
    const claimed = (await core.soundLab.claim(STUDIO, CHANNEL))!;
    await core.soundLab.ack(s.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: claimed.delivery.attempt_id!,
      event: 'started',
    });
    expect(
      await code(
        act(
          {
            action: 'cancel',
            module: 'soundboard',
            interaction_id: s.interaction_id,
            refund: true,
          },
          modA,
        ),
      ),
    ).toBe('ok');
    expect(await core.soundLab.get(s.interaction_id)).toMatchObject({
      status: 'cancelled',
      refund_status: 'refunded',
    });
    expect((await wallet('900220')).tokens).toBe(12_000);
    const late = await core.soundLab.ack(s.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: claimed.delivery.attempt_id!,
      event: 'completed',
    });
    expect(late.status).toBe('cancelled');
    const stopped = await core.soundLab.ack(s.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: claimed.delivery.attempt_id!,
      event: 'stopped',
    });
    expect(stopped.delivery.stopped_at).toBeTruthy();
  });

  it('« Stop tous les sons » stops every playing sound, not the queue; purge + refund; nothing playing → explicit', async () => {
    const { act, sound, core, code, wallet } = await lab();
    const a = (await sound('900221', 'boop')).interaction;
    const b = (await sound('900222', 'boop')).interaction;
    await core.soundLab.claim(STUDIO, CHANNEL);
    await core.soundLab.claim(STUDIO, CHANNEL);
    const c = (await sound('900223', 'boop')).interaction; // waiting (not claimed)
    await act(
      { action: 'stop_all', module: 'soundboard', refund: false },
      modA,
    );
    expect((await core.soundLab.get(a.interaction_id)).status).toBe(
      'cancelled',
    );
    expect((await core.soundLab.get(b.interaction_id)).status).toBe(
      'cancelled',
    );
    expect((await core.soundLab.get(c.interaction_id)).status).toBe('queued');
    expect(
      await code(
        act({ action: 'stop_all', module: 'soundboard', refund: true }),
      ),
    ).toBe('nothing_playing');
    await act({ action: 'purge', module: 'soundboard', refund: true }, modA);
    expect(await core.soundLab.get(c.interaction_id)).toMatchObject({
      status: 'cancelled',
      refund_status: 'refunded',
    });
    expect((await wallet('900223')).tokens).toBe(12_000);
    expect((await wallet('900221')).tokens).toBe(11_500); // stopped without refund
  });

  it('a sound that can never be played is refunded automatically (failure before start, expiry)', async () => {
    const { sound, core, wallet } = await lab();
    const a = (await sound('900224')).interaction;
    const claimed = (await core.soundLab.claim(STUDIO, CHANNEL))!;
    await core.soundLab.ack(a.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: claimed.delivery.attempt_id!,
      event: 'failed',
      error: { code: 'file_missing', message: 'Fichier du son introuvable' },
    });
    expect(await core.soundLab.get(a.interaction_id)).toMatchObject({
      status: 'failed',
      refund_status: 'refunded',
    });
    expect((await wallet('900224')).tokens).toBe(12_000);
    await core.db.query(
      "update lab_modules set state = 'active' where module_id = 'soundboard'",
    );
    const b = (await sound('900225')).interaction;
    await core.db
      .query(`insert into lab_modules (module_id, state, updated_at, updated_by) values ('soundboard', 'paused', now(), 't')
      on conflict (module_id) do update set state = 'paused'`);
    core.clock.advance(121_000);
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    await core.soundLab.recent(CHANNEL);
    expect(await core.soundLab.get(b.interaction_id)).toMatchObject({
      status: 'failed',
      refund_status: 'refunded',
    });
  });
});

describe('Bonk debit and refunds', () => {
  it('debited at admission; refunded if never shown; manual refund needs « Admin Wallet »', async () => {
    const { bonk, core, wallet, act, code } = await lab();
    const a = (await bonk('900230')).interaction;
    expect((await wallet('900230')).tokens).toBe(11_800);
    const claimed = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    await core.bonkLab.ack(a.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: claimed.delivery.attempt_id!,
      event: 'failed',
    });
    expect((await core.bonkLab.get(a.interaction_id)).refund_status).toBe(
      'refunded',
    );
    expect((await wallet('900230')).tokens).toBe(12_000);
    const b = (await bonk('900230')).interaction;
    const c2 = (await core.bonkLab.claim(STUDIO, CHANNEL))!;
    for (const event of ['started', 'completed'] as const)
      await core.bonkLab.ack(b.interaction_id, {
        studio_instance_id: STUDIO,
        attempt_id: c2.delivery.attempt_id!,
        event,
      });
    expect(
      await code(
        act(
          {
            action: 'refund',
            module: 'bonk',
            interaction_id: b.interaction_id,
          },
          modA,
        ),
      ),
    ).toBe('forbidden');
    expect(
      await code(
        act({
          action: 'refund',
          module: 'bonk',
          interaction_id: b.interaction_id,
        }),
      ),
    ).toBe('ok');
    expect((await wallet('900230')).tokens).toBe(12_000);
  });
});

describe('Minimal Tombola V2 (real model: free entry)', () => {
  it('Studio opens / closes / draws; one free entry per viewer; blocked / paused refused; winner paid on the Lab wallet', async () => {
    const { act, join, code, raffle, wallet, core, m } = await lab(() => 0.99);
    expect(await code(join('900240'))).toBe('raffle_closed');
    expect(
      await code(
        act({ action: 'raffle_open', jackpot: 8000, duration_s: 60 }, modA),
      ),
    ).toBe('forbidden');
    await act({ action: 'raffle_open', jackpot: 8000, duration_s: 60 });
    expect(
      await code(act({ action: 'raffle_open', jackpot: 1, duration_s: 60 })),
    ).toBe('raffle_already_open');
    expect((await join('900240')).replayed).toBe(false);
    expect((await join('900240')).replayed).toBe(true); // one per viewer
    await join('900241');
    await act(
      {
        action: 'block_viewer',
        viewer_id: '900242',
        module: 'raffle',
        duration_s: 300,
      },
      modA,
    );
    expect(await code(join('900242'))).toBe('viewer_blocked');
    await act(
      { action: 'module_state', module: 'raffle', state: 'paused' },
      modA,
    );
    expect(await code(join('900243'))).toBe('raffle_paused');
    await act(
      { action: 'module_state', module: 'raffle', state: 'active' },
      modA,
    );
    const st = await raffle.state(CHANNEL, '900240');
    expect(st.current).toMatchObject({
      status: 'open',
      participants: 2,
      jackpot: 8000,
    });
    expect(st.joined).toBe(true);
    core.clock.advance(61_000); // closes by itself
    expect(await code(join('900244'))).toBe('raffle_closed');
    expect((await raffle.state(CHANNEL)).current!.status).toBe('closed');
    const drawn = (await act({ action: 'raffle_draw' })) as {
      winners: { viewer_id: string; amount: number; ledger_id: number }[];
    };
    expect(drawn.winners).toEqual([
      expect.objectContaining({ viewer_id: '900241', amount: 8000 }),
    ]);
    expect((await wallet('900241')).tokens).toBe(20_000);
    const after = await raffle.state(CHANNEL);
    expect(after.last_draw).toMatchObject({
      status: 'drawn',
      winners: [{ viewer_id: '900241', amount: 8000 }],
    });
    const { items } = await m.ledger(CHANNEL, { viewer: '900241' });
    expect(items[0]).toMatchObject({
      operation_type: 'raffle_win',
      label: 'Tombola',
      amount: 8000,
    });
    const hist = await m.interactions(CHANNEL, { module: 'raffle' });
    expect(hist.items.map((i) => i.viewer_id).sort()).toEqual([
      '900240',
      '900241',
    ]);
  });
});

describe('D4 read models (history, ledger, drawer, search)', () => {
  it('history: filters in Core (module, status family, viewer, period), newest first, paginated', async () => {
    const { act, buy, sound, m, core, ready } = await lab();
    const a = (await buy('900250', 'un')).interaction;
    core.clock.advance(20 * 60_000);
    await ready();
    await sound('900251');
    const b = (await buy('900252', 'deux')).interaction;
    await act(
      {
        action: 'cancel',
        module: 'tts',
        interaction_id: b.interaction_id,
        refund: true,
      },
      modA,
    );
    const all = await m.interactions(CHANNEL, {});
    expect(all.items.map((i) => i.module)).toEqual([
      'tts',
      'soundboard',
      'tts',
    ]);
    expect(
      (await m.interactions(CHANNEL, { status: 'refunded' })).items.map(
        (i) => i.interaction_id,
      ),
    ).toEqual([b.interaction_id]);
    expect(
      (await m.interactions(CHANNEL, { module: 'soundboard' })).items,
    ).toHaveLength(1);
    expect(
      (await m.interactions(CHANNEL, { viewer: '900250' })).items[0]!
        .interaction_id,
    ).toBe(a.interaction_id);
    expect((await m.interactions(CHANNEL, { q: 'V90025' })).items).toHaveLength(
      3,
    );
    expect(
      (await m.interactions(CHANNEL, { period: '15' })).items,
    ).toHaveLength(2);
    const page = await m.interactions(CHANNEL, { limit: 2 });
    expect(page.more).toBe(true);
    const next = await m.interactions(CHANNEL, {
      limit: 2,
      before: page.items[1]!.created_at,
    });
    expect(next.items.map((i) => i.interaction_id)).toEqual([a.interaction_id]);
    // Drawer: who ended it, the linked movements.
    const d = (await m.interaction(CHANNEL, b.interaction_id))!;
    expect(d.actions.map((x) => [x.action, x.actor])).toEqual([
      ['refund', 'lab_modo'],
      ['cancel', 'lab_modo'],
    ]);
    expect(d.movements.map((x) => x.kind)).toEqual(['debit', 'refund']);
  });

  it('ledger of the whole channel with viewer names and refund links; search with role and restriction badges', async () => {
    const { act, buy, m } = await lab();
    const b = (await buy('900260', 'hello')).interaction;
    await act(
      {
        action: 'cancel',
        module: 'tts',
        interaction_id: b.interaction_id,
        refund: true,
      },
      modA,
    );
    const { items, hidden } = await m.ledger(CHANNEL, {});
    expect(hidden).toBe(0);
    const refund = items.find((e) => e.kind === 'refund')!;
    const debit = items.find((e) => e.kind === 'debit')!;
    expect(refund).toMatchObject({
      viewer_display_name: 'V900260',
      label: 'Remboursement TTS',
      refund_of: debit.id,
    });
    expect(debit.refunded_by).toBe(refund.id);
    await act(
      {
        action: 'block_viewer',
        viewer_id: '900260',
        module: 'tts',
        duration_s: 60,
      },
      modA,
    );
    const found = await m.search(CHANNEL, '');
    expect(found.find((v) => v.viewer_id === '900260')).toMatchObject({
      role: 'viewer',
      restriction: 'block',
    });
    expect(found.find((v) => v.viewer_id === modA.id)).toMatchObject({
      role: 'moderator',
    });
    expect(found.find((v) => v.viewer_id === CHANNEL)).toMatchObject({
      role: 'broadcaster',
    });
  });
});
