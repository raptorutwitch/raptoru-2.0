import { describe, expect, it } from 'vitest';
import { DockActivityService } from '../src/dock/service.js';
import { setup, type TestCore } from './helpers.js';

// Dock OBS V1.1 (docs/OBS_DOCK.md) — Raptoru's interactions in the projection, read from their canonical tables:
// one activity per business trigger (each shot of a salve, each sound, each TTS), a status change updates that same
// activity (new position, never a second one), nothing is written to the module tables.

const CHANNEL = '900100';
const STUDIO = 'studio-A';
const V = { id: '900101', display_name: 'Viewer Lab' };
const smile = {
  provider: 'unicode' as const,
  id: 'unicode:1f600',
  glyph: '😀',
};
let seq = 0;

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-10-01T18:00:00Z'));
  await core.ttsLab.heartbeat({
    studio_instance_id: STUDIO,
    player_ready: true,
  });
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
  const dock = new DockActivityService(core.db, core.clock, {
    autoScan: false,
  });
  return { core, dock };
}

const base = () => ({
  idempotency_key: `k-${++seq}`,
  channel_id: CHANNEL,
  viewer: V,
  lab_session_id: 'lab-1',
});

async function keys(core: TestCore) {
  return (
    await core.db.query<{ n: number }>(
      `select count(*)::int as n from dock_activity where kind = 'interaction'`,
    )
  )[0]!.n;
}

describe('interactions in the dock projection', () => {
  it('Bonk (single and salve), Soundboard, TTS: one activity each, display data only', async () => {
    const { core, dock } = await lab();
    await core.bonkLab.admit({ ...base(), emote: smile });
    const volley = await core.bonkLab.admitVolley({
      ...base(),
      emotes: [smile, smile, smile],
      cadence_ms: 160,
    });
    await core.soundLab.admit({
      ...base(),
      sound_id: 'boop',
      payment_method: 'tokens',
    });
    await core.ttsLab.admit({
      ...base(),
      text: 'Salut <b>Raptoru</b> !',
      payment_method: 'tokens',
    });
    expect(await dock.scan(CHANNEL)).toBe(6);
    const { activities } = await dock.recent(CHANNEL);
    const byType = (t: string) => activities.filter((a) => a.type === t);
    expect(activities.every((a) => a.kind === 'interaction')).toBe(true);
    expect(byType('bonk')).toHaveLength(4);
    const shots = byType('bonk').filter((a) => a.data.volley);
    expect(shots).toHaveLength(3);
    expect(shots[0]!.data).toMatchObject({
      actor: { id: V.id, name: V.display_name },
      emote: { glyph: '😀' },
      volley: { id: volley.volley_id, count: 3 },
    });
    expect(byType('soundboard')[0]!.data).toMatchObject({
      sound: { id: 'boop' },
    });
    expect(byType('tts')[0]!.data).toMatchObject({
      message: 'Salut <b>Raptoru</b> !',
    });
    expect(byType('tts')[0]!.activity_key).toMatch(/^ix:tts:/);
    for (const a of activities) expect(a.state.status).toBeTruthy();
    expect(await dock.scan(CHANNEL)).toBe(0);
  });

  it('a status change (TTS started, then completed) updates the same activity — never a second one', async () => {
    const { core, dock } = await lab();
    await core.ttsLab.admit({
      ...base(),
      text: 'Hello',
      payment_method: 'tokens',
    });
    await dock.scan(CHANNEL);
    const first = await dock.recent(CHANNEL);
    const i = (await core.ttsLab.claim(STUDIO, CHANNEL))!;
    await core.ttsLab.ack(i.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: i.delivery.attempt_id!,
      event: 'started',
    });
    expect(await dock.scan(CHANNEL)).toBe(1);
    await core.ttsLab.ack(i.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: i.delivery.attempt_id!,
      event: 'completed',
    });
    expect(await dock.scan(CHANNEL)).toBe(1);
    const ch = await dock.changes(CHANNEL, { after: first.cursor });
    expect(ch.activities.map((a) => a.activity_key)).toEqual([
      `ix:tts:${i.interaction_id}`,
    ]);
    expect(ch.activities[0]!.state.status).toBe('completed');
    expect(await keys(core)).toBe(1);
  });

  it('a sound paid by channel points is not a second activity: its redemption already is', async () => {
    const { core, dock } = await lab();
    const out = await core.soundLab.admit({
      ...base(),
      sound_id: 'boop',
      payment_method: 'tokens',
    });
    await core.db.query(
      `update sound_lab_interactions set source = 'channel_points', payment_method = 'channel_points'
       where interaction_id = $1`,
      [out.interaction.interaction_id],
    );
    expect(await dock.scan(CHANNEL)).toBe(0);
    expect(await keys(core)).toBe(0);
  });
});
