import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SoundLabAdmitRequest } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../src/clock.js';
import { DEFAULT_MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { SOUND_BANK } from '../src/sound-lab/bank.js';
import {
  SoundLabError409,
  SoundLabService,
  SoundLabUnavailableError,
} from '../src/sound-lab/sound-lab-service.js';
import {
  count,
  createPgliteDb,
  MINUTE,
  setup,
  type TestCore,
} from './helpers.js';

const CHANNEL = '900100';
const STUDIO = 'studio-A';
const SOUNDS_DIR = join(
  import.meta.dirname,
  '../../twitch-extension/extension',
);
let seq = 0;
const admitReq = (
  over: Partial<SoundLabAdmitRequest> = {},
): SoundLabAdmitRequest => ({
  idempotency_key: `k-${++seq}`,
  channel_id: CHANNEL,
  viewer: { id: '900101', display_name: 'Viewer Lab' },
  lab_session_id: 'lab-1',
  sound_id: 'boop',
  payment_method: 'tokens',
  ...over,
});
const ready = (core: TestCore, player_ready = true, lab = core.soundLab) =>
  lab.heartbeat({ studio_instance_id: STUDIO, player_ready });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (error) {
    return error instanceof SoundLabError409 ||
      error instanceof SoundLabUnavailableError
      ? error.code
      : `unexpected: ${(error as Error).message}`;
  }
};
const ack = (
  core: TestCore,
  i: { interaction_id: string; delivery: { attempt_id: string | null } },
  event: 'started' | 'completed' | 'failed' | 'execution_unknown',
) =>
  core.soundLab.ack(i.interaction_id, {
    studio_instance_id: STUDIO,
    attempt_id: i.delivery.attempt_id!,
    event,
  });
const claimAll = async (core: TestCore) => {
  const out = [];
  for (let n = 0; n < 20; n++) {
    const c = await core.soundLab.claim(STUDIO, CHANNEL);
    if (!c) break;
    out.push(c);
  }
  return out;
};

describe('Soundboard Lab catalog and configuration (Core)', () => {
  it('the whole legacy bank is available; every file exists; odd ids map to their real file', async () => {
    const core = await setup();
    expect(SOUND_BANK).toHaveLength(69);
    for (const entry of SOUND_BANK)
      for (const f of entry.files)
        expect(existsSync(join(SOUNDS_DIR, f.file)), f.file).toBe(true);
    const catalog = await core.soundLab.catalog(CHANNEL);
    expect(catalog).toHaveLength(69);
    const byId = new Map(catalog.map((s) => [s.id, s]));
    expect(byId.get('hello')!.preview_url).toBe(
      'assets/sounds/balloon-boy-says-hello.mp3',
    );
    expect(byId.get('on-est-bien-d-accord')!.preview_url).toBe(
      'assets/sounds/on_est_bien_daccord.mp3',
    );
    expect(byId.get('fail-trumpet')).toMatchObject({
      token_cost: 2000,
      credit_cost: 3,
      enabled: true,
      cooldown_remaining_ms: 0,
    });
    // Initial playback modes from the measured duration.
    expect(byId.get('boop')!.playback_mode).toBe('stack');
    expect(byId.get('akh')!.playback_mode).toBe('queue');
    expect(byId.get('erenscream')!.playback_mode).toBe('ignore_if_running');
  });

  it('settings are validated, persisted, and never overwritten by the bank seed', async () => {
    const core = await setup();
    const updated = await core.soundLab.updateSound('boop', {
      token_cost: 750,
      credit_cost: 2,
      cooldown_ms: 5000,
      playback_mode: 'queue',
      volume: 60,
      label: 'Boop !',
    });
    expect(updated).toMatchObject({ token_cost: 750, volume: 60 });
    expect(
      await core.soundLab.updateSettings({ volume_protection: 'medium' }),
    ).toEqual({ volume_protection: 'medium' });
    // A new service (process restart) keeps the streamer settings.
    const again = new SoundLabService(core.db, core.clock);
    const config = await again.config();
    expect(config.settings.volume_protection).toBe('medium');
    expect(config.sounds.find((s) => s.id === 'boop')).toMatchObject({
      label: 'Boop !',
      token_cost: 750,
      credit_cost: 2,
      cooldown_ms: 5000,
      playback_mode: 'queue',
      volume: 60,
    });
    expect(config.sounds.find((s) => s.id === 'sarah')!.variants).toBe(3);
    expect(await code(core.soundLab.updateSound('nope', { volume: 1 }))).toBe(
      'sound_not_found',
    );
  });

  it('names: default from the bank, Studio rename survives a restart, empty / null / default name reset it', async () => {
    const core = await setup();
    const find = async (lab: SoundLabService, id: string) =>
      (await lab.config()).sounds.find((s) => s.id === id)!;
    // Default names come from the bank, typography fixed where certain.
    expect(await find(core.soundLab, 'sigma-a-genoux')).toMatchObject({
      label: 'Sigma - À genoux',
      default_label: 'Sigma - À genoux',
      custom_label: null,
    });
    expect((await find(core.soundLab, 'hells-kitchen-violin')).label).toBe(
      "Hell's Kitchen Violin",
    );
    // A rename with accents, apostrophes and French characters survives a Core restart.
    const name = "Ça c'est l'été à côté — œuvre !";
    await core.soundLab.updateSound('boop', { label: `  ${name}  ` });
    const restarted = new SoundLabService(core.db, core.clock);
    expect(await find(restarted, 'boop')).toMatchObject({
      label: name,
      default_label: 'Boop',
      custom_label: name,
    });
    expect(
      (await restarted.catalog(CHANNEL)).find((s) => s.id === 'boop')!.label,
    ).toBe(name);
    // The purchase keeps the name shown at that moment (history).
    await ready(core, true, restarted);
    const bought = (await restarted.admit(admitReq())).interaction;
    expect(bought.sound_label).toBe(name);
    // Empty field, null, or typing the default name: back to the default name.
    for (const reset of ['', '   ', null, 'Boop']) {
      await restarted.updateSound('boop', { label: 'Temporaire' });
      const back = await restarted.updateSound('boop', { label: reset });
      expect(back).toMatchObject({ label: 'Boop', custom_label: null });
    }
    // Other settings are untouched by a rename or a reset.
    expect(await find(restarted, 'boop')).toMatchObject({
      token_cost: 500,
      enabled: true,
    });
    expect(bought.sound_label).toBe(name);
  });

  it('migration: a previous default name becomes null, every real rename is kept, nothing else changes', async () => {
    // Database as it was before the custom_label migration, with Lab-like data.
    const dir = await mkdtemp(join(tmpdir(), 'sound-lab-migrations-'));
    const all = (await readdir(DEFAULT_MIGRATIONS_DIR)).filter((f) =>
      f.endsWith('.sql'),
    );
    for (const file of all.filter(
      (f) => f < '20261003120000_sound_lab_custom_label.sql',
    ))
      await copyFile(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
    const db = createPgliteDb(new PGlite());
    await migrate(db, 'all', dir);
    const rows: [string, string, number][] = [
      ['boop', 'Boop', 500], // previous default → default name
      ['sigma-a-genoux', 'Sigma - A genoux', 700], // previous default (now fixed) → default name
      ['sardoche-c-etait-sur', "C'était sur !", 500], // real rename → kept
      ['hells-kitchen-violin', 'Violon creepy', 2000], // real rename → kept
      ['prowler', 'Prowler', 500], // case change of 'PROWLER' → real rename, kept
      ['j-comprends-rien', "J'comprends rien", 500], // previous default with apostrophe
    ];
    for (const [id, label, tokens] of rows)
      await db.query(
        `insert into sound_lab_sounds (sound_id, label, enabled, token_cost, credit_cost, cooldown_ms, playback_mode, volume, updated_at)
         values ($1, $2, true, $3, 2, 7000, 'queue', 80, now())`,
        [id, label, tokens],
      );
    await migrate(db, 'all');
    const after = new Map(
      (
        await db.query<{
          sound_id: string;
          custom_label: string | null;
          token_cost: number;
          credit_cost: number;
          cooldown_ms: number;
          playback_mode: string;
          volume: number;
        }>('select * from sound_lab_sounds')
      ).map((r) => [r.sound_id, r]),
    );
    expect(
      Object.fromEntries([...after].map(([id, r]) => [id, r.custom_label])),
    ).toEqual({
      boop: null,
      'sigma-a-genoux': null,
      'sardoche-c-etait-sur': "C'était sur !",
      'hells-kitchen-violin': 'Violon creepy',
      prowler: 'Prowler',
      'j-comprends-rien': null,
    });
    for (const [id, , tokens] of rows)
      expect(after.get(id)).toMatchObject({
        token_cost: tokens,
        credit_cost: 2,
        cooldown_ms: 7000,
        playback_mode: 'queue',
        volume: 80,
      });
    // The service then shows the fixed default names and keeps the renames.
    const lab = new SoundLabService(db, systemClock);
    const labels = new Map(
      (await lab.config()).sounds.map((s) => [s.id, s.label]),
    );
    expect(labels.get('sigma-a-genoux')).toBe('Sigma - À genoux');
    expect(labels.get('hells-kitchen-violin')).toBe('Violon creepy');
    expect(labels.get('prowler')).toBe('Prowler');
    await db.close();
  });
});

describe('Soundboard Lab admission and playback (Core)', () => {
  it('price follows the payment method; the file and settings are snapshotted by Core; simulated only', async () => {
    const core = await setup();
    await ready(core);
    await core.soundLab.updateSound('boop', { volume: 70 });
    const tokens = (await core.soundLab.admit(admitReq())).interaction;
    const credits = (
      await core.soundLab.admit(
        admitReq({ sound_id: 'fail-trumpet', payment_method: 'credits' }),
      )
    ).interaction;
    expect(tokens).toMatchObject({
      sound_url: 'assets/sounds/boop.mp3',
      duration_ms: 842,
      playback_mode: 'stack',
      volume: 70,
      payment_method: 'tokens',
      simulated_cost: 500,
      simulated_currency: 'jetons_lab',
      test_mode: true,
      payment_mode: 'simulated',
      real_debited: 0,
    });
    expect(credits).toMatchObject({
      simulated_cost: 3,
      simulated_currency: 'credits_lab',
    });
    for (const table of ['wallets', 'wallet_operations', 'viewers'])
      expect(await count(core.db, table)).toBe(0);
  });

  it('idempotency, unknown and disabled sounds, Studio/player offline', async () => {
    const core = await setup();
    expect(await code(core.soundLab.admit(admitReq()))).toBe('studio_offline');
    await ready(core, false);
    expect(await code(core.soundLab.admit(admitReq()))).toBe('player_offline');
    await ready(core);
    const req = admitReq();
    const first = await core.soundLab.admit(req);
    expect(await core.soundLab.admit(req)).toMatchObject({
      replayed: true,
      interaction: { interaction_id: first.interaction.interaction_id },
    });
    expect(
      await code(core.soundLab.admit({ ...req, payment_method: 'credits' })),
    ).toBe('idempotency_conflict');
    expect(
      await code(core.soundLab.admit(admitReq({ sound_id: 'nope' }))),
    ).toBe('sound_not_found');
    await core.soundLab.updateSound('ohlala', { enabled: false });
    expect(
      await code(core.soundLab.admit(admitReq({ sound_id: 'ohlala' }))),
    ).toBe('sound_disabled');
    expect(await count(core.db, 'sound_lab_interactions')).toBe(1);
  });

  it('cooldown: Core decides; two viewers at the same moment → one wins; a retry replays; failures do not count', async () => {
    const core = await setup();
    await ready(core);
    await core.soundLab.updateSound('boop', { cooldown_ms: 10_000 });
    const a = admitReq({ viewer: { id: '1', display_name: 'A' } });
    const b = admitReq({ viewer: { id: '2', display_name: 'B' } });
    const results = await Promise.all([
      code(core.soundLab.admit(a)),
      code(core.soundLab.admit(b)),
    ]);
    expect(results.sort()).toEqual(['ok', 'sound_cooldown']);
    // Network retry of the winner: same interaction, not a cooldown refusal.
    const winner = results[0] === 'ok' ? a : b;
    expect((await core.soundLab.admit(winner)).replayed).toBe(true);
    const listed = (await core.soundLab.catalog(CHANNEL)).find(
      (s) => s.id === 'boop',
    )!;
    expect(listed.cooldown_remaining_ms).toBeGreaterThan(9000);
    try {
      await core.soundLab.admit(admitReq());
    } catch (e) {
      expect((e as SoundLabError409).details.retry_after_ms).toBeGreaterThan(
        9000,
      );
    }
    core.clock.advance(11_000);
    await ready(core);
    const later = (await core.soundLab.admit(admitReq())).interaction;
    // Failed plays do not keep the sound in cooldown.
    const claimed = await claimAll(core);
    expect(claimed.map((c) => c.interaction_id)).toContain(
      later.interaction_id,
    );
    for (const c of claimed) await ack(core, c, 'failed');
    expect(await code(core.soundLab.admit(admitReq()))).toBe('ok');
  });

  it('stack overlaps, queue plays one after the other, ignore_if_running refuses while running', async () => {
    const core = await setup();
    await ready(core);
    await core.soundLab.updateSound('boop', { playback_mode: 'stack' });
    await core.soundLab.updateSound('ohlala', { playback_mode: 'queue' });
    await core.soundLab.updateSound('hee-hee', {
      playback_mode: 'ignore_if_running',
    });
    for (let n = 0; n < 3; n++) await core.soundLab.admit(admitReq());
    for (let n = 0; n < 2; n++)
      await core.soundLab.admit(admitReq({ sound_id: 'ohlala' }));
    await core.soundLab.admit(admitReq({ sound_id: 'hee-hee' }));
    expect(
      await code(core.soundLab.admit(admitReq({ sound_id: 'hee-hee' }))),
    ).toBe('sound_running');
    const first = await claimAll(core);
    // 3 boop at once, the first ohlala, the hee-hee; the second ohlala waits.
    expect(first.map((i) => i.sound_id)).toEqual([
      'boop',
      'boop',
      'boop',
      'ohlala',
      'hee-hee',
    ]);
    const ohlala = first.find((i) => i.sound_id === 'ohlala')!;
    await ack(core, ohlala, 'started');
    expect(await claimAll(core)).toEqual([]);
    await ack(core, ohlala, 'completed');
    expect((await claimAll(core)).map((i) => i.sound_id)).toEqual(['ohlala']);
    // hee-hee finished → accepted again.
    const heehee = first.find((i) => i.sound_id === 'hee-hee')!;
    await ack(core, heehee, 'started');
    await ack(core, heehee, 'completed');
    expect(
      await code(core.soundLab.admit(admitReq({ sound_id: 'hee-hee' }))),
    ).toBe('ok');
  });

  it('at most 8 sounds in flight at once, even in stack mode', async () => {
    const core = await setup();
    await ready(core);
    for (let n = 0; n < 12; n++) await core.soundLab.admit(admitReq());
    expect(await claimAll(core)).toHaveLength(8);
  });

  it('random plays a playable sound; sarah picks one of its variants', async () => {
    const core = await setup();
    const lab = new SoundLabService(core.db, core.clock, () => 0);
    await ready(core, true, lab);
    for (const entry of SOUND_BANK)
      if (!['random', 'ohlala'].includes(entry.id))
        await lab.updateSound(entry.id, { enabled: false });
    const random = (await lab.admit(admitReq({ sound_id: 'random' })))
      .interaction;
    expect(random).toMatchObject({
      requested_sound_id: 'random',
      sound_id: 'ohlala',
      sound_label: 'Aléatoire · Ohlala',
      simulated_cost: 600,
    });
    await lab.updateSound('sarah', { enabled: true });
    const sarah = (await lab.admit(admitReq({ sound_id: 'sarah' })))
      .interaction;
    expect(sarah.sound_url).toBe('assets/sounds/sarah-1.mp3');
  });

  it('random skips sounds in cooldown, exactly as each sound does on its own (ASTRA-P2-020)', async () => {
    const core = await setup();
    const lab = new SoundLabService(core.db, core.clock, () => 0);
    await ready(core, true, lab);
    const [first, second] = SOUND_BANK.filter((e) => e.id !== 'random');
    for (const entry of SOUND_BANK)
      if (entry.id !== 'random')
        await lab.updateSound(entry.id, { cooldown_ms: 60_000 });
    // The first sound was just played: in cooldown, random skips it and takes the next one.
    await lab.admit(admitReq({ sound_id: first!.id }));
    core.clock.advance(1_000);
    const pick = (await lab.admit(admitReq({ sound_id: 'random' })))
      .interaction;
    expect(pick.sound_id).toBe(second!.id);
    // Cooldown over: the first one is playable again.
    core.clock.advance(60_000);
    await ready(core, true, lab); // Studio's heartbeat, as the worker sends it every 2 s
    const later = (await lab.admit(admitReq({ sound_id: 'random' })))
      .interaction;
    expect(later.sound_id).toBe(first!.id);
  });

  it('time-driven sweep (Bonk VNext lot 0): no Studio claims any more, the work still expires (refund once), a lost lease ends unknown', async () => {
    const core = await setup();
    await ready(core);
    await core.soundLab.updateSound('akh', { playback_mode: 'queue' });
    const lost = (await core.soundLab.admit(admitReq({ sound_id: 'akh' })))
      .interaction;
    const [claimed] = await claimAll(core);
    await ack(core, claimed!, 'started');
    const waiting = (await core.soundLab.admit(admitReq({ sound_id: 'akh' })))
      .interaction;
    const refunds = async (id: string) =>
      (
        await core.db.query<{ n: number }>(
          "select count(*)::int as n from lab_wallet_ledger where kind = 'refund' and interaction_id = $1",
          [id],
        )
      )[0]!.n;
    expect(await core.soundLab.sweepExpired()).toBe(0);
    core.clock.advance(3 * MINUTE);
    // No heartbeat, claim, admission or read: only the time-driven sweep.
    expect(await core.soundLab.sweepExpired()).toBe(1);
    expect(await core.soundLab.get(lost.interaction_id)).toMatchObject({
      status: 'execution_unknown',
      refund_status: 'none',
    });
    expect(await core.soundLab.get(waiting.interaction_id)).toMatchObject({
      status: 'failed',
      error: { code: 'expired' },
      refund_status: 'refunded',
    });
    expect(await refunds(waiting.interaction_id)).toBe(1);
    expect(await core.soundLab.sweepExpired()).toBe(0);
    expect(await refunds(waiting.interaction_id)).toBe(1);
    expect(await refunds(lost.interaction_id)).toBe(0);
  });

  it('never turns abandoned work into a success: expired → failed, lost lease → execution_unknown', async () => {
    const core = await setup();
    await ready(core);
    await core.soundLab.updateSound('akh', { playback_mode: 'queue' });
    const lost = (await core.soundLab.admit(admitReq({ sound_id: 'akh' })))
      .interaction;
    const [claimed] = await claimAll(core);
    await ack(core, claimed!, 'started');
    const waiting = (await core.soundLab.admit(admitReq({ sound_id: 'akh' })))
      .interaction;
    core.clock.advance(3 * MINUTE);
    const byId = new Map(
      (await core.soundLab.recent(CHANNEL)).map((i) => [i.interaction_id, i]),
    );
    expect(byId.get(lost.interaction_id)).toMatchObject({
      status: 'execution_unknown',
      error: { code: 'lease_expired' },
    });
    expect(byId.get(waiting.interaction_id)).toMatchObject({
      status: 'failed',
      error: { code: 'expired' },
    });
  });
});
