import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { SoundLabSoundCreate } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { soundFileRoutes } from '../src/http/sound-lab-routes.js';
import { studioCockpitRoutes } from '../src/http/studio-cockpit-routes.js';
import {
  SoundLabError409,
  SoundLabService,
} from '../src/sound-lab/sound-lab-service.js';
import { checkWav, SoundFileError } from '../src/sound-lab/wav.js';
import { setup, type TestCore } from './helpers.js';

// Soundboard: sounds added or re-cut in Studio (docs/SOUNDBOARD.md § Ajouter un son).

const CHANNEL = '900100';
const STUDIO = 'studio-A';

/** A PCM 16-bit WAV of `ms` milliseconds (its content varies with `seed`: another seed, another file). */
function wav(
  ms: number,
  o: { channels?: number; rate?: number; bits?: number; seed?: number } = {},
) {
  const { channels = 1, rate = 44100, bits = 16, seed = 1 } = o;
  const frames = Math.round((rate * ms) / 1000);
  const data = Buffer.alloc(frames * channels * (bits / 8));
  for (let i = 0; i < data.length / 2; i++)
    data.writeInt16LE(((i * 37 + seed * 101) % 2000) - 1000, i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * (bits / 8), 28);
  h.writeUInt16LE(channels * (bits / 8), 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const b64 = (b: Buffer) => b.toString('base64');
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof SoundLabError409 || e instanceof SoundFileError
      ? e.code
      : `unexpected: ${(e as Error).message}`;
  }
};
let seq = 0;
const buy = (lab: SoundLabService, sound_id: string) =>
  lab.admit({
    idempotency_key: `k-${++seq}`,
    channel_id: CHANNEL,
    viewer: { id: '900101', display_name: 'Viewer Lab' },
    lab_session_id: 'lab-1',
    sound_id,
    payment_method: 'tokens',
  });
async function added(
  core: TestCore,
  over: Partial<SoundLabSoundCreate> = {},
  ms = 1200,
  seed = 1,
) {
  const file = await core.soundLab.uploadFile(b64(wav(ms, { seed })));
  const sound = await core.soundLab.createSound({
    id: 'ouais-mon-gars-a1b2c3',
    label: 'Ouais mon gars',
    file_id: file.file_id,
    token_cost: 500,
    credit_cost: 1,
    ...over,
  });
  return { file, sound };
}

describe('Soundboard — published files (WAV checked by Core)', () => {
  it('a complete PCM 16-bit WAV: id = SHA-256 of its bytes, measured duration', () => {
    const bytes = wav(1500, { channels: 2 });
    expect(checkWav(bytes)).toEqual({
      file_id: createHash('sha256').update(bytes).digest('hex'),
      mime: 'audio/wav',
      duration_ms: 1500,
      size: bytes.length,
    });
  });

  it('refuses an incomplete, foreign, unsupported, too long, too short or too heavy file', () => {
    const err = (b: Buffer) => {
      try {
        checkWav(b);
        return 'ok';
      } catch (e) {
        return (e as SoundFileError).code;
      }
    };
    const ok = wav(1000);
    expect(err(ok.subarray(0, ok.length - 10))).toBe('incomplete_file');
    const lying = Buffer.from(ok);
    lying.writeUInt32LE(ok.readUInt32LE(40) + 100, 40); // data chunk longer than the file
    lying.writeUInt32LE(ok.readUInt32LE(4), 4);
    expect(err(lying)).toBe('incomplete_file');
    expect(
      err(Buffer.from('ID3\u0004 not a wav at all, an mp3 header'.repeat(3))),
    ).toBe('not_wav');
    expect(err(wav(1000, { bits: 8 }))).toBe('unsupported_wav');
    expect(err(wav(1000, { channels: 3 }))).toBe('unsupported_wav');
    expect(err(wav(1000, { rate: 96000 }))).toBe('unsupported_wav');
    expect(err(wav(20_500))).toBe('duration_out_of_bounds');
    expect(err(wav(50))).toBe('duration_out_of_bounds');
    expect(err(Buffer.alloc(4 * 1024 * 1024 + 1))).toBe('file_too_large');
    expect(err(wav(20_000, { channels: 2, rate: 48000 }))).toBe('ok'); // the heaviest valid file fits
    expect(err(wav(20_000))).toBe('ok');
  });

  it('a file is stored once (same bytes, same id) and read back identical', async () => {
    const core = await setup();
    const bytes = wav(800);
    const a = await core.soundLab.uploadFile(b64(bytes));
    const b = await core.soundLab.uploadFile(b64(bytes));
    expect(b).toEqual(a);
    expect((await core.soundLab.file(a.file_id))!.bytes.equals(bytes)).toBe(
      true,
    );
    expect(await core.soundLab.file('0'.repeat(64))).toBeNull();
    expect(
      await code(core.soundLab.uploadFile(b64(bytes.subarray(0, 100)))),
    ).toBe('incomplete_file');
  });
});

describe('Soundboard — a sound added in Studio', () => {
  it('is offered at once, after the bank, with its file, prices and a mode from its duration', async () => {
    const core = await setup();
    const { file, sound } = await added(core);
    expect(sound).toMatchObject({
      id: 'ouais-mon-gars-a1b2c3',
      source: 'studio',
      file_id: file.file_id,
      label: 'Ouais mon gars',
      default_label: 'Ouais mon gars',
      enabled: true,
      token_cost: 500,
      credit_cost: 1,
      cooldown_ms: 0,
      playback_mode: 'stack',
      volume: 100,
      duration_ms: 1200,
      preview_url: `sound-files/${file.file_id}.wav`,
      variants: 1,
    });
    const catalog = await core.soundLab.catalog(CHANNEL);
    expect(catalog).toHaveLength(70);
    expect(catalog.at(-1)).toMatchObject({
      id: sound.id,
      label: 'Ouais mon gars',
      preview_url: `sound-files/${file.file_id}.wav`,
      duration_ms: 1200,
      enabled: true,
    });
    // The bank is untouched.
    expect(catalog[0]).toMatchObject({
      id: 'boop',
      preview_url: 'assets/sounds/boop.mp3',
    });
    expect(
      (await core.soundLab.config()).sounds.find((s) => s.id === 'boop')!
        .source,
    ).toBe('bank');
  });

  it('a repeated request returns the same sound; no duplicate by id, by file or over the bank', async () => {
    const core = await setup();
    const { file } = await added(core);
    const again = await core.soundLab.createSound({
      id: 'ouais-mon-gars-a1b2c3',
      label: 'Ouais mon gars',
      file_id: file.file_id,
      token_cost: 500,
      credit_cost: 1,
    });
    expect(again.id).toBe('ouais-mon-gars-a1b2c3');
    expect(await core.soundLab.catalog(CHANNEL)).toHaveLength(70);
    // The same extract under another id: refused, naming the sound that has it.
    await expect(
      core.soundLab.createSound({
        id: 'copie-ffffff',
        label: 'Copie',
        file_id: file.file_id,
        token_cost: 1,
        credit_cost: 0,
      }),
    ).rejects.toMatchObject({
      code: 'duplicate_file',
      details: { sound_id: 'ouais-mon-gars-a1b2c3', label: 'Ouais mon gars' },
    });
    const other = await core.soundLab.uploadFile(b64(wav(900, { seed: 2 })));
    expect(
      await code(
        core.soundLab.createSound({
          id: 'ouais-mon-gars-a1b2c3',
          label: 'X',
          file_id: other.file_id,
          token_cost: 1,
          credit_cost: 0,
        }),
      ),
    ).toBe('sound_exists');
    expect(
      await code(
        core.soundLab.createSound({
          id: 'boop',
          label: 'X',
          file_id: other.file_id,
          token_cost: 1,
          credit_cost: 0,
        }),
      ),
    ).toBe('sound_exists');
    expect(
      await code(
        core.soundLab.createSound({
          id: 'fantome-000000',
          label: 'X',
          file_id: 'a'.repeat(64),
          token_cost: 1,
          credit_cost: 0,
        }),
      ),
    ).toBe('file_not_found');
  });

  it('concurrent publications: one sound per id, one live sound per file (the database decides)', async () => {
    const core = await setup();
    const file = await core.soundLab.uploadFile(b64(wav(700)));
    const req = (id: string): SoundLabSoundCreate => ({
      id,
      label: 'Clic',
      file_id: file.file_id,
      token_cost: 500,
      credit_cost: 1,
    });
    const same = await Promise.all(
      [1, 2, 3].map(() => code(core.soundLab.createSound(req('clic-111111')))),
    );
    expect(same.filter((c) => c === 'ok').length).toBeGreaterThanOrEqual(1);
    expect(same.every((c) => c === 'ok' || c === 'sound_exists')).toBe(true);
    const others = await Promise.all(
      ['clic-222222', 'clic-333333'].map((id) =>
        code(core.soundLab.createSound(req(id))),
      ),
    );
    expect(others).toEqual(['duplicate_file', 'duplicate_file']);
    const live = (await core.soundLab.config()).sounds.filter(
      (s) => s.file_id === file.file_id,
    );
    expect(live.map((s) => s.id)).toEqual(['clic-111111']);
    // A real race on a new extract: both pass the check, the unique index keeps one.
    const fresh = await core.soundLab.uploadFile(b64(wav(650, { seed: 7 })));
    const race = await Promise.all(
      ['course-aaaaaa', 'course-bbbbbb'].map((id) =>
        code(core.soundLab.createSound({ ...req(id), file_id: fresh.file_id })),
      ),
    );
    expect(race.sort()).toEqual(['duplicate_file', 'ok']);
    expect(
      (await core.soundLab.config()).sounds.filter(
        (s) => s.file_id === fresh.file_id,
      ),
    ).toHaveLength(1);
  });

  it('is bought, claimed and played from its published file, at its own price', async () => {
    const core = await setup();
    const { file, sound } = await added(core, { token_cost: 750 });
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    const bought = (await buy(core.soundLab, sound.id)).interaction;
    expect(bought).toMatchObject({
      sound_id: sound.id,
      sound_label: 'Ouais mon gars',
      sound_url: `sound-files/${file.file_id}.wav`,
      duration_ms: 1200,
      simulated_cost: 750,
      status: 'queued',
    });
    const claimed = await core.soundLab.claim(STUDIO, CHANNEL);
    expect(claimed!.interaction_id).toBe(bought.interaction_id);
  });

  it('renamed, re-priced, disabled like any sound; never without a name', async () => {
    const core = await setup();
    const { sound } = await added(core);
    expect(
      await core.soundLab.updateSound(sound.id, {
        label: 'Ouais !',
        token_cost: 900,
      }),
    ).toMatchObject({
      label: 'Ouais !',
      custom_label: 'Ouais !',
      default_label: 'Ouais !',
      token_cost: 900,
    });
    expect(
      await code(core.soundLab.updateSound(sound.id, { label: '  ' })),
    ).toBe('label_required');
    expect(
      await code(core.soundLab.updateSound(sound.id, { label: null })),
    ).toBe('label_required');
    expect(
      await code(core.soundLab.updateSound(sound.id, { file_id: null })),
    ).toBe('file_required');
    await core.soundLab.updateSound(sound.id, { enabled: false });
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    expect(await code(buy(core.soundLab, sound.id))).toBe('sound_disabled');
    // A restart (new service) keeps everything.
    const again = new SoundLabService(core.db, core.clock);
    expect(
      (await again.config()).sounds.find((s) => s.id === sound.id),
    ).toMatchObject({ label: 'Ouais !', enabled: false });
  });

  it('a new extract replaces its file; the previous purchase keeps the file it was bought with', async () => {
    const core = await setup();
    const { file, sound } = await added(core);
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    const before = (await buy(core.soundLab, sound.id)).interaction;
    const cut = await core.soundLab.uploadFile(b64(wav(400, { seed: 9 })));
    expect(
      await core.soundLab.updateSound(sound.id, { file_id: cut.file_id }),
    ).toMatchObject({
      file_id: cut.file_id,
      duration_ms: 400,
      preview_url: `sound-files/${cut.file_id}.wav`,
    });
    const after = (await buy(core.soundLab, sound.id)).interaction;
    expect(after.sound_url).toBe(`sound-files/${cut.file_id}.wav`);
    expect((await core.soundLab.get(before.interaction_id)).sound_url).toBe(
      `sound-files/${file.file_id}.wav`,
    );
  });
});

describe('Soundboard — a bank sound re-cut in Studio', () => {
  it('plays its new extract (one file, no variant), and goes back to the bank file on request', async () => {
    const core = await setup();
    const cut = await core.soundLab.uploadFile(b64(wav(600, { seed: 4 })));
    const sarah = await core.soundLab.updateSound('sarah', {
      file_id: cut.file_id,
    });
    expect(sarah).toMatchObject({
      source: 'bank',
      file_id: cut.file_id,
      variants: 1,
      duration_ms: 600,
      preview_url: `sound-files/${cut.file_id}.wav`,
    });
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    expect((await buy(core.soundLab, 'sarah')).interaction.sound_url).toBe(
      `sound-files/${cut.file_id}.wav`,
    );
    const back = await core.soundLab.updateSound('sarah', { file_id: null });
    expect(back).toMatchObject({
      file_id: null,
      variants: 3,
      preview_url: 'assets/sounds/sarah-1.mp3',
    });
    expect(
      await code(core.soundLab.updateSound('random', { file_id: cut.file_id })),
    ).toBe('not_replaceable');
    // The bank name stays the default name of a re-cut bank sound.
    expect(back.default_label).toBe('Sarah');
  });

  it('the same extract cannot be given to two live sounds', async () => {
    const core = await setup();
    const { file } = await added(core);
    expect(
      await code(core.soundLab.updateSound('boop', { file_id: file.file_id })),
    ).toBe('duplicate_file');
  });
});

describe('Soundboard — removing a sound', () => {
  it('leaves the catalogue, the purchases and the random pool; its admitted purchase still plays; history kept', async () => {
    const core = await setup();
    const { file, sound } = await added(core);
    await core.soundLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    const queued = (await buy(core.soundLab, sound.id)).interaction;
    expect(await core.soundLab.deleteSound(sound.id)).toEqual({ ok: true });
    expect(await core.soundLab.deleteSound(sound.id)).toEqual({ ok: true }); // idempotent
    expect(
      (await core.soundLab.catalog(CHANNEL)).some((s) => s.id === sound.id),
    ).toBe(false);
    expect(
      (await core.soundLab.config()).sounds.some((s) => s.id === sound.id),
    ).toBe(false);
    expect(await code(buy(core.soundLab, sound.id))).toBe('sound_not_found');
    expect(
      await code(core.soundLab.updateSound(sound.id, { volume: 10 })),
    ).toBe('sound_not_found');
    expect(await code(core.soundLab.deleteSound('nope-000000'))).toBe(
      'sound_not_found',
    );
    // Already admitted: handed to the player with its file.
    const claimed = await core.soundLab.claim(STUDIO, CHANNEL);
    expect(claimed).toMatchObject({
      interaction_id: queued.interaction_id,
      sound_url: `sound-files/${file.file_id}.wav`,
    });
    expect(await core.soundLab.file(file.file_id)).not.toBeNull();
    // The extract is free again: it may be published as a new sound.
    expect(
      (
        await core.soundLab.createSound({
          id: 'retour-abcdef',
          label: 'Retour',
          file_id: file.file_id,
          token_cost: 500,
          credit_cost: 1,
        })
      ).file_id,
    ).toBe(file.file_id);
  });

  it('a removed bank sound never comes back with the bank seed (restart)', async () => {
    const core = await setup();
    await core.soundLab.deleteSound('wrong');
    const again = new SoundLabService(core.db, core.clock);
    expect((await again.catalog(CHANNEL)).some((s) => s.id === 'wrong')).toBe(
      false,
    );
    expect(await again.catalog(CHANNEL)).toHaveLength(68);
  });

  it('random draws from the added sounds too, never from a removed one', async () => {
    const core = await setup();
    const { sound } = await added(core);
    // The last candidate: the added sound (after the whole bank).
    const last = new SoundLabService(core.db, core.clock, () => 0.99999);
    await last.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    expect((await buy(last, 'random')).interaction.sound_id).toBe(sound.id);
    await last.deleteSound(sound.id);
    expect((await buy(last, 'random')).interaction.sound_id).not.toBe(sound.id);
  });
});

describe('Soundboard — routes', () => {
  it('the public file: exact bytes, immutable, readable by the extension (CORS), unknown → 404', async () => {
    const core = await setup();
    const bytes = wav(500);
    const { file_id } = await core.soundLab.uploadFile(b64(bytes));
    const [route] = soundFileRoutes(core.soundLab);
    const path = `/v1/ext/sound-files/${file_id}.wav`;
    expect(route!.auth).toBe('public');
    let head: Record<string, unknown> = {};
    let body: Buffer | null = null;
    const res = {
      writeHead: (_s: number, h: Record<string, unknown>) => (head = h),
      end: (b: Buffer) => (body = b),
    } as unknown as ServerResponse;
    await route!.handle({
      params: route!.pattern.exec(path)!.slice(1),
      body: undefined,
      url: new URL(path, 'http://core'),
      res,
    });
    expect(body!.equals(bytes)).toBe(true);
    expect(head).toMatchObject({
      'content-type': 'audio/wav',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    });
    const unknown = `/v1/ext/sound-files/${'b'.repeat(64)}.wav`;
    await expect(
      route!.handle({
        params: route!.pattern.exec(unknown)!.slice(1),
        body: undefined,
        url: new URL(unknown, 'http://core'),
        res,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(route!.pattern.test('/v1/ext/sound-files/../../etc.wav')).toBe(
      false,
    );
  });

  it('the Studio cockpit relays the Soundboard media routes only, the upload with its larger body', async () => {
    const calls: [string, unknown][] = [];
    const routes = studioCockpitRoutes(
      async <T>(path: string, body?: unknown) => {
        calls.push([path, body]);
        return {} as T;
      },
      '83603689',
    );
    const post = (p: string) => {
      const path = `/v1/studio/cockpit/${p}`;
      const r = routes.find(
        (x) => x.method === 'POST' && x.pattern.test(path),
      )!;
      return {
        r,
        run: () =>
          r.handle({
            params: r.pattern.exec(path)!.slice(1),
            body: { x: 1 },
            url: new URL(path, 'http://core'),
          }),
      };
    };
    const upload = post('sound/files');
    expect(upload.r.maxBody).toBeGreaterThan(5 * 1024 * 1024);
    await upload.run();
    await post('sound/sounds').run();
    await post('sound/sounds/ouais-a1b2c3/delete').run();
    expect(calls.map(([p]) => p)).toEqual([
      '/v1/lab/sound/files',
      '/v1/lab/sound/sounds',
      '/v1/lab/sound/sounds/ouais-a1b2c3/delete',
    ]);
    // The generic relay keeps its 64 Ko body; other paths stay refused.
    expect(post('sound/sounds').r.maxBody).toBeUndefined();
    await expect(
      (async () => post('sound/interactions').run())(),
    ).rejects.toMatchObject({ status: 404 });
  });
});
