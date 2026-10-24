import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { EffectsPlayer } from '../src/effects/player.js';
import {
  FOLLOW_GAP_MS,
  LAUNCH_SOUND_DEFAULT,
  VotekickLaunchSound,
} from '../src/votekick/launch-sound.js';
import {
  MuteController,
  RAPTORU_MUTE_FX,
} from '../src/votekick/mute-controller.js';
import { VotekickRuntime } from '../src/votekick/runtime.js';
import { SimObs } from '../src/votekick/sim-obs.js';

// Votekick V2 — the launch sound and the Studio settings: the sound plays ONCE per vote really open (never for a
// refused !votekick, never on the vote's updates, never late after a Studio start or a lost connection), only when
// enabled with a sound; a sound that fails never touches the vote. The length is Core's (sent, read back; an older
// Core: 60 s read only); the sound setting is saved in Studio and survives a restart.

const OVERLAY = fileURLToPath(new URL('../votekick-overlay', import.meta.url));
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'vk-sound-'));
  dirs.push(d);
  return d;
};

const live = (session: string, votes = 0) =>
  ({
    action: 'live',
    session,
    seq: votes,
    ends: 1_000_000,
    initiator: 'chechay',
    target: 'raptoru_',
    yes: votes,
    no: 0,
  }) as never;
const clear = { action: 'clear' } as never;

function fakePlayer(fail = false) {
  const played: { id: string; volume: number }[] = [];
  return {
    played,
    play: async (e: { id: string; volume: number }) => {
      if (fail) throw new Error('effects_player_offline');
      played.push({ id: e.id, volume: e.volume });
    },
  };
}

async function sound(
  opts: { fail?: boolean; cfg?: object | null; clock?: { t: number } } = {},
) {
  const dir = await tmp();
  const file = join(dir, 'votekick-launch-sound.json');
  if (opts.cfg !== null)
    await writeFile(
      file,
      JSON.stringify(
        opts.cfg ?? {
          enabled: true,
          sound: 'eren-scream',
          sound_name: null,
          volume: 70,
        },
      ),
    );
  const player = fakePlayer(opts.fail);
  const logs: string[] = [];
  const clock = opts.clock ?? { t: 1_000 };
  const s = await VotekickLaunchSound.open(
    file,
    player,
    (l) => logs.push(l),
    () => clock.t,
  );
  /** One follow-up of Core, 400 ms after the previous one. */
  const tick = (e: never) => {
    clock.t += 400;
    s.onEvent(e);
  };
  return { s, player, logs, clock, tick, file };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Votekick launch sound', () => {
  it('a vote that opens: one sound, never again on its updates', async () => {
    const { player, tick } = await sound();
    tick(clear); // Studio running: Core followed
    tick(live('v1'));
    tick(live('v1', 1));
    tick(live('v1', 2));
    tick(clear);
    await settle();
    expect(player.played).toEqual([{ id: 'eren-scream', volume: 70 }]);
    tick(live('v2'));
    await settle();
    expect(player.played.map((p) => p.id)).toHaveLength(2);
  });

  it('a refused !votekick (no live event) plays nothing; a verdict or a clear neither', async () => {
    const { player, tick } = await sound();
    tick(clear);
    tick({ action: 'result', session: 'v1' } as never);
    tick(clear);
    await settle();
    expect(player.played).toEqual([]);
  });

  it('a vote already open when Studio starts: noted, never sounded (and not after either)', async () => {
    const { player, tick } = await sound();
    tick(live('v1')); // first look after the start
    tick(live('v1', 1));
    await settle();
    expect(player.played).toEqual([]);
  });

  it('back after a cut longer than the follow-up gap: the vote opened meanwhile is not sounded late', async () => {
    const { player, tick, clock } = await sound();
    tick(clear);
    clock.t += FOLLOW_GAP_MS + 1; // Core unreachable meanwhile (failed ticks never call onEvent)
    tick(live('v1'));
    tick(live('v1', 1));
    await settle();
    expect(player.played).toEqual([]);
    tick(clear);
    tick(live('v2')); // followed again: the next vote sounds
    await settle();
    expect(player.played).toHaveLength(1);
  });

  it('a Studio restart: the vote in progress is never replayed', async () => {
    const clock = { t: 5_000 };
    const first = await sound({ clock });
    first.tick(clear);
    first.tick(live('v1'));
    await settle();
    expect(first.player.played).toHaveLength(1);
    // New Studio process: same saved setting, fresh memory.
    const again = await VotekickLaunchSound.open(
      first.file,
      first.player,
      () => {},
      () => clock.t,
    );
    clock.t += 400;
    again.onEvent(live('v1', 3));
    clock.t += 400;
    again.onEvent(live('v1', 4));
    await settle();
    expect(first.player.played).toHaveLength(1);
  });

  it('disabled, or no sound chosen, or nothing saved: silent', async () => {
    for (const cfg of [
      { enabled: false, sound: 'eren-scream', sound_name: null, volume: 70 },
      { enabled: true, sound: null, sound_name: null, volume: 70 },
      null,
    ]) {
      const { player, tick, s } = await sound({ cfg });
      tick(clear);
      tick(live('v1'));
      await settle();
      expect(player.played).toEqual([]);
      if (cfg === null) expect(s.config).toEqual(LAUNCH_SOUND_DEFAULT);
    }
    expect(LAUNCH_SOUND_DEFAULT).toMatchObject({ enabled: false, sound: null });
  });

  it('a sound that cannot play is logged, never thrown at the vote', async () => {
    const { tick, logs } = await sound({ fail: true });
    tick(clear);
    expect(() => tick(live('v1'))).not.toThrow();
    await settle();
    expect(logs.join('\n')).toContain(
      'son de lancement non joué : effects_player_offline',
    );
  });

  it('saved and read back; a bad setting is refused and the previous one kept; a corrupt file is ignored', async () => {
    const { s, file } = await sound({ cfg: null });
    const next = {
      enabled: true,
      sound: `upload:${'a'.repeat(64)}.wav`,
      sound_name: 'Gong',
      volume: 35,
    };
    expect(await s.save(next)).toEqual(next);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(next);
    for (const bad of [
      { ...next, volume: 101 },
      { ...next, volume: 12.5 },
      { ...next, sound: '../secret.mp3' },
      { ...next, sound: 'C:\\Windows\\x.wav' },
      { ...next, extra: 1 },
    ])
      await expect(s.save(bad)).rejects.toThrow();
    expect(s.config).toEqual(next);
    const reopened = await VotekickLaunchSound.open(file, null);
    expect(reopened.config).toEqual(next);
    await writeFile(file, '{"enabled":true,"sound":"../x"');
    expect((await VotekickLaunchSound.open(file, null)).config).toEqual(
      LAUNCH_SOUND_DEFAULT,
    );
  });
});

describe('Votekick settings in Studio (/api/votekick/settings)', () => {
  async function runtime(coreSettings: 'ok' | 'missing' = 'ok') {
    const dir = await tmp();
    const core = {
      seconds: 60,
      posts: [] as unknown[],
      overlay: clear as unknown,
    };
    const call = async <T>(path: string, body?: unknown): Promise<T> => {
      if (path.endsWith('/studio'))
        return { overlay: core.overlay, mute: null } as T;
      if (path.endsWith('/settings')) {
        if (coreSettings === 'missing')
          throw Object.assign(new Error('not_found'), { status: 404 });
        if (body !== undefined) {
          const s = (body as { vote_seconds: number }).vote_seconds;
          if (s < 15 || s > 300)
            throw Object.assign(new Error('invalid_body'), { status: 400 });
          core.posts.push(body);
          core.seconds = s;
        }
        return { vote_seconds: core.seconds } as T;
      }
      throw new Error(`unexpected ${path}`);
    };
    const player = fakePlayer();
    const effects = {
      play: player.play,
      sounds: () => [
        { id: 'eren-scream', label: 'Eren', volume: 100, available: true },
      ],
      status: () => ({ connected: true, audio: true, current: true }),
      importSound: async () => ({
        id: `upload:${'d'.repeat(64)}.mp3`,
        name: 'x.mp3',
      }),
    } as unknown as EffectsPlayer;
    const sound = await VotekickLaunchSound.open(join(dir, 'vk.json'), player);
    const rt = new VotekickRuntime({
      core: call,
      base: '/v1/studio/votekick',
      channelId: '83603689',
      mute: await MuteController.open(
        join(dir, 'votekick-mute.json'),
        () => new SimObs(RAPTORU_MUTE_FX),
        RAPTORU_MUTE_FX,
        Date.now,
        async () => {},
      ),
      overlayDir: OVERLAY,
      sound,
      effects,
    });
    const json = (b: unknown) => async () => b as Record<string, unknown>;
    const noUpload = async () => ({ body: Buffer.alloc(0), name: '' });
    return { rt, core, player, json, noUpload };
  }

  it('reads Core’s length, the sound setting (none by default), the sounds and the player', async () => {
    const { rt, json, noUpload } = await runtime();
    expect(await rt.api('GET', '/settings', json({}), noUpload)).toMatchObject({
      available: true,
      vote_seconds: 60,
      limits: { min: 15, max: 300, default: 60 },
      launch_sound: { enabled: false, sound: null },
      sounds: [{ id: 'eren-scream' }],
      player: { connected: true },
    });
  });

  it('saves the length in Core and the sound in Studio, read back', async () => {
    const { rt, core, json, noUpload } = await runtime();
    const out = await rt.api(
      'POST',
      '/settings',
      json({
        vote_seconds: 45,
        launch_sound: {
          enabled: true,
          sound: 'eren-scream',
          sound_name: null,
          volume: 60,
        },
      }),
      noUpload,
    );
    expect(core.posts).toEqual([{ vote_seconds: 45 }]);
    expect(out).toMatchObject({
      vote_seconds: 45,
      launch_sound: { enabled: true, sound: 'eren-scream', volume: 60 },
    });
  });

  it('a bad length or sound: 400, nothing saved anywhere', async () => {
    const { rt, core, json, noUpload } = await runtime();
    for (const body of [
      { vote_seconds: 10 },
      { vote_seconds: 301 },
      { vote_seconds: 30.5 },
      { vote_seconds: '60' },
      { vote_seconds: 60, extra: true },
    ])
      await expect(
        rt.api('POST', '/settings', json(body), noUpload),
      ).rejects.toMatchObject({
        status: 400,
      });
    await expect(
      rt.api(
        'POST',
        '/settings',
        // A good length with a bad sound: refused as a whole, the length never sent to Core.
        json({
          vote_seconds: 45,
          launch_sound: {
            enabled: true,
            sound: '../x',
            sound_name: null,
            volume: 50,
          },
        }),
        noUpload,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(core.posts).toEqual([]);
    expect(
      (await rt.api('GET', '/settings', json({}), noUpload)) as object,
    ).toMatchObject({
      vote_seconds: 60,
      launch_sound: { enabled: false },
    });
  });

  it('an older Core without the setting: 60 s read only, the sound still configurable', async () => {
    const { rt, json, noUpload } = await runtime('missing');
    expect(await rt.api('GET', '/settings', json({}), noUpload)).toMatchObject({
      available: false,
      vote_seconds: 60,
      error: 'core_outdated',
    });
    const out = await rt.api(
      'POST',
      '/settings',
      json({
        launch_sound: {
          enabled: true,
          sound: 'eren-scream',
          sound_name: null,
          volume: 50,
        },
      }),
      noUpload,
    );
    expect(out).toMatchObject({
      available: false,
      launch_sound: { enabled: true },
    });
  });

  it('the follow-up loop sounds a vote that opens, once', async () => {
    const { rt, core, player, json, noUpload } = await runtime();
    await rt.api(
      'POST',
      '/settings',
      json({
        launch_sound: {
          enabled: true,
          sound: 'eren-scream',
          sound_name: null,
          volume: 90,
        },
      }),
      noUpload,
    );
    await rt.tick(); // clear: Studio followed Core
    core.overlay = live('vote-1');
    await rt.tick();
    core.overlay = live('vote-1', 1);
    await rt.tick();
    await settle();
    expect(player.played).toEqual([{ id: 'eren-scream', volume: 90 }]);
  });
});
