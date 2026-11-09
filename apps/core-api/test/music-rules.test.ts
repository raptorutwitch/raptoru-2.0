import { randomUUID } from 'node:crypto';
import {
  MUSIC_RULES,
  type SpotifyPlayback,
  type SpotifySearchItem,
  type SpotifyStudioStatus,
  type SpotifyTrack,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../src/lab-moderation/store.js';
import { adminAdjust } from '../src/lab-moderation/store.js';
import { CommandSteps } from '../src/commands/steps.js';
import { setup } from './helpers.js';

// Music Hub — the paid viewer skip (25 000 Jetons, doubled within 30 min of the last successful one, global to the
// stream), the Open Bar (free requests from the extension, no count per viewer), `!song` (SMTC first, an announcement,
// 30 s global cooldown) and the seek on the timeline (docs/music/MUSIC_HUB_STATE.md § 14). Studio is played by its
// syncs and job reports, as in music-hub.test.ts.

const CH = '83603689';
const ID = (n: number) => `MUSICRULE${String(n).padStart(13, '0')}`;
const sp = (n: number, duration_ms = 200_000): SpotifyTrack => ({
  id: ID(n),
  uri: `spotify:track:${ID(n)}`,
  title: `Titre ${n}`,
  artists: [`Artiste ${n}`],
  duration_ms,
});
const item = (n: number): SpotifySearchItem => ({
  ...sp(n),
  album: `Album ${n}`,
  image_url: null,
  playable: true,
});
const OK: SpotifyStudioStatus = {
  auth: 'ok',
  limited_until: null,
  quota_exceeded: false,
  device: { name: 'PC', type: 'Computer' },
  calls_last_minute: 1,
};
const viewer = (n: number) => ({
  id: String(9400 + n),
  login: `fan${n}`,
  name: `Fan${n}`,
});
const MIN = 60_000;

async function music(o: { controls?: boolean } = {}) {
  const core = await setup();
  core.clock.set(new Date('2026-11-09T20:00:00Z'));
  const { spotify } = core;
  // The new `!song` is the Lab's (app.ts / lab-core.ts set it there); a Production Core keeps the historical one.
  spotify.songV2 = true;
  await spotify.saveSettings(
    CH,
    {
      enabled: true,
      extension_enabled: true,
      extension_price_tokens: 500,
      player_controls: !!o.controls,
    },
    'test',
  );
  let track: SpotifyTrack | null = sp(1);
  let progress = 30_000;
  let playing = true;
  let status = OK;
  const reading = (): SpotifyPlayback => ({
    observed_at: core.clock.now().toISOString(),
    track,
    progress_ms: track ? progress : null,
    is_playing: !!track && playing,
  });
  const sync = () => spotify.sync(CH, { status, playback: reading() });
  await sync();
  const at = async (ms: number) => {
    progress = ms;
    await sync();
  };
  const play = async (n: number | null) => {
    progress = 30_000;
    track = n === null ? null : sp(n);
    playing = true;
    await sync();
  };
  const pause = async () => {
    playing = false;
    await sync();
  };
  const setStatus = async (s: Partial<SpotifyStudioStatus>) => {
    status = { ...OK, ...s };
    await sync();
  };
  const fund = (v: { id: string }, amount: number) =>
    core.db.tx(async (q) => {
      const b = (await core.economy.balances(q, CH, v.id)).tokens;
      await adminAdjust(q, core.clock.now(), {
        channelId: CH,
        viewerId: v.id,
        currency: 'tokens',
        delta: amount - b,
        actor: 'test',
        reason: null,
      });
    });
  const balance = async (v: { id: string }) =>
    (await core.economy.balances(core.db, CH, v.id)).tokens;
  const rules = (u: Parameters<typeof spotify.saveMusicRules>[1]) =>
    spotify.saveMusicRules(CH, u, 'test');
  const price = async () =>
    (await spotify.musicRules(CH)).viewer_skip.price as number;
  const buy = (
    v: ReturnType<typeof viewer>,
    expected: number | null = null,
    key: string = randomUUID(),
  ) =>
    spotify.viewerSkip({
      channel_id: CH,
      viewer: v,
      key,
      expected_price: expected,
    });
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  };
  /** Studio runs the queued skip jobs with this outcome (the track moves on when it is a skip). */
  const runSkips = async (
    outcome: 'skipped' | 'failed' | 'unknown',
    reason?: 'RATE_LIMITED' | 'TRACK_CHANGED' | 'SPOTIFY_UNAVAILABLE',
  ) => {
    const a = await sync();
    const jobs = a.jobs.filter((j) => j.kind === 'skip');
    for (const j of jobs) {
      const attempt_id = randomUUID();
      await spotify.startJob(CH, j.job_id, attempt_id);
      await spotify.reportJob(CH, j.job_id, {
        kind: 'skip',
        attempt_id,
        outcome,
        ...(reason ? { reason } : {}),
        skipped_track: track,
      });
    }
    return jobs;
  };
  /** One paid skip, proven by Studio, then the next track plays. */
  const skipOk = async (v = viewer(1), next = 2) => {
    const r = await buy(v);
    await runSkips('skipped');
    await play(next);
    return r;
  };
  /** Time passes with Studio alive (it syncs every second or so). */
  const later = async (ms: number) => {
    core.clock.advance(ms);
    await sync();
  };
  const skipRow = async (id: string) =>
    (await spotify.viewerSkipResult(CH, viewer(1).id, id)).skip;
  return {
    core,
    spotify,
    sync,
    play,
    pause,
    setStatus,
    fund,
    balance,
    rules,
    price,
    buy,
    code,
    runSkips,
    skipOk,
    skipRow,
    later,
    at,
  };
}

describe('Music Hub — paid viewer skip: the price', () => {
  it('OFF by default; 25 000 → 50 000 → 100 000 → 200 000, each within 30 min of the previous success', async () => {
    const m = await music();
    expect((await m.spotify.musicRules(CH)).viewer_skip).toMatchObject({
      enabled: false,
      protect_requests: true,
      price: 25_000,
      base_price: 25_000,
      window_minutes: 30,
    });
    expect(await m.code(m.buy(viewer(1)))).toBe('viewer_skip_disabled');
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 1_000_000);
    const paid: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = await m.balance(viewer(1));
      const r = await m.skipOk(viewer(1), 10 + i);
      paid.push(before - (await m.balance(viewer(1))));
      expect(r.skip.price).toBe(paid[i]);
      await m.later(29 * MIN);
    }
    expect(paid).toEqual([25_000, 50_000, 100_000, 200_000]);
    // 29 min after the 4th: still in its window.
    expect(await m.price()).toBe(400_000);
    // 30 min without a successful paid skip: back to the base.
    await m.later(1 * MIN + 1);
    expect(await m.price()).toBe(25_000);
  });

  it('global to the stream: another account pays the doubled price; the window restarts at each success', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    for (const n of [1, 2, 3]) await m.fund(viewer(n), 1_000_000);
    await m.skipOk(viewer(1), 2);
    await m.later(20 * MIN);
    expect(await m.price()).toBe(50_000);
    await m.skipOk(viewer(2), 3);
    // 25 min after the 2nd (45 after the 1st): the window started again at the 2nd.
    await m.later(25 * MIN);
    expect(await m.price()).toBe(100_000);
    const before = await m.balance(viewer(3));
    await m.skipOk(viewer(3), 4);
    expect(before - (await m.balance(viewer(3)))).toBe(100_000);
    await m.later(31 * MIN);
    expect(await m.price()).toBe(25_000);
  });

  it('the moderation’s free skips never raise the price', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.spotify.skip(CH, 'spotify:test:mod-1', 'Lab_Modo');
    await m.runSkips('skipped');
    await m.play(2);
    await m.spotify.skip(CH, 'spotify:test:mod-2', null);
    await m.runSkips('skipped');
    await m.play(3);
    expect(await m.price()).toBe(25_000);
  });

  it('the price is Core’s: an expected price that changed refuses, nothing debited', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 1_000_000);
    await m.skipOk(viewer(1), 2);
    // The page still shows 25 000.
    expect(await m.code(m.buy(viewer(1), 25_000))).toBe('price_changed');
    expect(await m.balance(viewer(1))).toBe(975_000);
    const r = await m.buy(viewer(1), 50_000);
    expect(r.skip).toMatchObject({ status: 'pending', price: 50_000 });
  });
});

describe('Music Hub — paid viewer skip: refusals, refunds, concurrency', () => {
  it('not enough Jetons: refused, nothing debited, no skip job', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 24_999);
    expect(await m.code(m.buy(viewer(1)))).toBe('insufficient_tokens');
    expect(await m.balance(viewer(1))).toBe(24_999);
    expect((await m.sync()).jobs.filter((j) => j.kind === 'skip')).toHaveLength(
      0,
    );
  });

  it('a double click (same key) is one purchase; a second skip while one is on its way is refused', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    await m.fund(viewer(2), 100_000);
    const a = await m.buy(viewer(1), null, 'skip-key-0001');
    const b = await m.buy(viewer(1), null, 'skip-key-0001');
    expect(b.duplicate).toBe(true);
    expect(b.skip.id).toBe(a.skip.id);
    expect(await m.code(m.buy(viewer(1)))).toBe('skip_in_progress');
    expect(await m.code(m.buy(viewer(2)))).toBe('skip_in_progress');
    expect(await m.balance(viewer(1))).toBe(75_000);
    expect(await m.balance(viewer(2))).toBe(100_000);
    // One job only: never two tracks skipped.
    expect(await m.runSkips('skipped')).toHaveLength(1);
  });

  it('two purchases at the same instant: one skip, one debit', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    await m.fund(viewer(2), 100_000);
    const out = await Promise.all([
      m.code(m.buy(viewer(1))),
      m.code(m.buy(viewer(2))),
    ]);
    expect(out.sort()).toEqual(['ok', 'skip_in_progress']);
    expect((await m.balance(viewer(1))) + (await m.balance(viewer(2)))).toBe(
      175_000,
    );
    expect(await m.runSkips('skipped')).toHaveLength(1);
  });

  it('a moderator’s skip on its way: the paid skip waits (never two skips in a row)', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    await m.spotify.skip(CH, 'spotify:test:mod-busy', 'Lab_Modo');
    expect(await m.code(m.buy(viewer(1)))).toBe('skip_in_progress');
    expect(await m.balance(viewer(1))).toBe(100_000);
  });

  for (const [outcome, reason] of [
    ['failed', 'RATE_LIMITED'],
    ['failed', 'SPOTIFY_UNAVAILABLE'],
    ['failed', 'TRACK_CHANGED'],
    ['unknown', undefined],
  ] as const)
    it(`Studio says ${outcome}${reason ? ` (${reason})` : ''}: refunded once, the price and its window unchanged`, async () => {
      const m = await music();
      await m.rules({ viewer_skip_enabled: true });
      await m.fund(viewer(1), 1_000_000);
      await m.skipOk(viewer(1), 2);
      const window = (await m.spotify.musicRules(CH)).viewer_skip;
      await m.later(5 * MIN);
      const r = await m.buy(viewer(1));
      expect(r.skip.price).toBe(50_000);
      expect(await m.balance(viewer(1))).toBe(925_000);
      await m.runSkips(outcome, reason);
      const done = await m.skipRow(r.skip.id);
      expect(done).toMatchObject({
        status: 'refunded',
        reason: reason ?? 'SKIP_RESULT_UNKNOWN',
      });
      expect(await m.balance(viewer(1))).toBe(975_000);
      const after = (await m.spotify.musicRules(CH)).viewer_skip;
      expect(after.price).toBe(50_000);
      expect(after.resets_at).toBe(window.resets_at);
      // The report again (a replay): nothing given back twice.
      await m.runSkips(outcome, reason);
      expect(await m.balance(viewer(1))).toBe(975_000);
    });

  it('Studio never takes the job (closed): refunded after the delay; Studio lost while skipping: refunded too', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    const a = await m.buy(viewer(1));
    m.core.clock.advance(16_000);
    await m.spotify.tick(CH);
    expect((await m.skipRow(a.skip.id)).status).toBe('refunded');
    expect(await m.balance(viewer(1))).toBe(100_000);
    // Taken, then Studio restarts without a report: it may have run — never charged on a guess.
    await m.sync();
    const b = await m.buy(viewer(1));
    const job = (await m.sync()).jobs.find((j) => j.kind === 'skip')!;
    await m.spotify.startJob(CH, job.job_id, randomUUID());
    m.core.clock.advance(31_000);
    await m.spotify.tick(CH);
    expect((await m.skipRow(b.skip.id)).status).toBe('refunded');
    expect(await m.balance(viewer(1))).toBe(100_000);
    expect(await m.price()).toBe(25_000);
  });

  it('the skip aims at the exact track playing (Studio checks it again)', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    await m.buy(viewer(1));
    const job = (await m.sync()).jobs.find((j) => j.kind === 'skip');
    expect(job).toMatchObject({
      kind: 'skip',
      expect_uri: sp(1).uri,
      request_id: null,
    });
  });

  it('nothing playing, paused, Studio silent, rate limited, Lab read-only: refused before any debit', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    await m.play(null);
    expect(await m.code(m.buy(viewer(1)))).toBe('nothing_playing');
    await m.play(1);
    await m.pause();
    expect(await m.code(m.buy(viewer(1)))).toBe('paused');
    await m.play(1);
    await m.setStatus({ read_only: true });
    expect(await m.code(m.buy(viewer(1)))).toBe('lab_read_only');
    await m.setStatus({
      limited_until: new Date(
        m.core.clock.now().getTime() + 60_000,
      ).toISOString(),
    });
    expect(await m.code(m.buy(viewer(1)))).toBe('rate_limited');
    await m.setStatus({});
    m.core.clock.advance(20_000);
    expect(await m.code(m.buy(viewer(1)))).toBe('studio_unavailable');
    await m.spotify.saveSettings(CH, { enabled: false }, 'test');
    await m.sync();
    expect(await m.code(m.buy(viewer(1)))).toBe('requests_closed');
    expect(await m.balance(viewer(1))).toBe(100_000);
  });

  it('a request paid by a viewer is protected (the moderation can still skip it); the switch exists, ON by default', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    // A reward request queued by Studio, then seen playing by Core (its own attribution).
    await m.spotify.admit({
      channel_id: CH,
      source: 'simulation',
      source_ref: `simulation:test-${randomUUID()}`,
      reward_id: 'lab-simulated',
      redemption_id: `r-${randomUUID()}`,
      viewer: { id: '9499', login: 'demandeur', name: 'Demandeur' },
      user_input: sp(7).uri,
    });
    const a = await m.sync();
    const job = a.jobs.find((j) => j.kind === 'song_request')!;
    const attempt_id = randomUUID();
    await m.spotify.startJob(CH, job.job_id, attempt_id);
    await m.spotify.reportJob(CH, job.job_id, {
      kind: 'song_request',
      attempt_id,
      outcome: 'queued',
      track: sp(7),
      confirmation: 'http_204',
    });
    await m.play(7);
    const state = (await m.spotify.extensionState(
      CH,
      { id: viewer(1).id, login: 'fan1' },
      false,
    )) as unknown as { viewer_skip: { blocked: string | null } };
    expect(state.viewer_skip.blocked).toBe(null); // no SMTC link here: Core still refuses at the purchase
    expect(await m.code(m.buy(viewer(1)))).toBe('protected_request');
    expect(await m.balance(viewer(1))).toBe(100_000);
    // The moderation keeps its free skip of it.
    expect(await m.spotify.skip(CH, 'spotify:test:mod-req', 'Lab_Modo')).toBe(
      'songskip',
    );
  });
});

describe('Music Hub — Open Bar', () => {
  async function bar() {
    const m = await music();
    // Ten tracks per search (the extension asks only what a search showed it).
    for (let s = 0; s < 6; s++) {
      await m.spotify.extensionSearch(CH, viewer(1).id, `recherche ${s}`);
      const a = await m.sync();
      for (const j of a.jobs.filter((x) => x.kind === 'search')) {
        const attempt_id = randomUUID();
        await m.spotify.startJob(CH, j.job_id, attempt_id);
        await m.spotify.reportJob(CH, j.job_id, {
          kind: 'search',
          attempt_id,
          outcome: 'done',
          provider: 'lab',
          items: Array.from({ length: 10 }, (_, i) => item(100 + s * 10 + i)),
        });
      }
    }
    /** A request from the extension, then Studio adds it to Spotify's queue at once (as the real one does). */
    const ask = async (
      v: ReturnType<typeof viewer>,
      n: number,
      expected: number | null = null,
    ) => {
      const r = await m.spotify.extensionRequest({
        channel_id: CH,
        viewer: v,
        track_id: ID(n),
        key: randomUUID(),
        expected_price: expected,
      });
      const a = await m.sync();
      for (const j of a.jobs) {
        if (j.kind !== 'song_request' || j.reference.kind !== 'exact') continue;
        const attempt_id = randomUUID();
        await m.spotify.startJob(CH, j.job_id, attempt_id);
        await m.spotify.reportJob(CH, j.job_id, {
          kind: 'song_request',
          attempt_id,
          outcome: 'queued',
          track: sp(Number(j.reference.track_id.slice(-4))),
          confirmation: 'http_204',
        });
      }
      return r;
    };
    return { ...m, ask };
  }

  it('open: free, no count per viewer, a short frequency limit; closed: back to the price and the limits', async () => {
    const m = await bar();
    await m.fund(viewer(1), 10_000);
    // Before: 500 and 2 at a time (the historical defaults).
    const paid = await m.ask(viewer(1), 100, 500);
    expect(paid.request.price_tokens).toBe(500);
    await m.rules({ open_bar: true });
    const open = (await m.spotify.musicRules(CH)).open_bar;
    expect(open).toMatchObject({ on: true, by: 'test', cooldown_seconds: 20 });
    expect(await m.code(m.ask(viewer(1), 101, 0))).toBe('viewer_cooldown'); // 20 s since the last request, not the 10 min of the normal rule
    for (let i = 0; i < 4; i++) {
      await m.later(21_000);
      const r = await m.ask(viewer(1), 101 + i, 0);
      expect(r.request.price_tokens).toBe(0);
    }
    expect(await m.balance(viewer(1))).toBe(9_500);
    const st = (await m.spotify.extensionState(
      CH,
      { id: viewer(1).id, login: 'fan1' },
      false,
    )) as unknown as {
      price_tokens: number;
      open_bar: { cooldown_seconds: number } | null;
      me: { pending: number; unlimited: boolean };
    };
    expect(st).toMatchObject({
      price_tokens: 0,
      open_bar: { cooldown_seconds: 20 },
      me: { pending: 5, unlimited: true },
    });
    // Closing: the page still showing « 0 » gets `price_changed`, nothing free after the closing.
    await m.rules({ open_bar: false });
    await m.later(11 * MIN);
    expect(await m.code(m.ask(viewer(1), 110, 0))).toBe('price_changed');
    // The limits are back (5 waiting > 2).
    expect(await m.code(m.ask(viewer(1), 110, 500))).toBe('viewer_limit');
    expect(await m.balance(viewer(1))).toBe(9_500);
    // The request bought before the Open Bar keeps its price: withdrawn, its 500 come back.
    await m.spotify.extensionCancel(
      CH,
      { id: viewer(1).id, name: 'Fan1' },
      paid.request.request_id,
    );
    expect(await m.balance(viewer(1))).toBe(10_000);
  });

  it('the whole queue is capped while open; duplicates still refused; the paid skip stays paid', async () => {
    const m = await bar();
    await m.rules({ open_bar: true, viewer_skip_enabled: true });
    expect(await m.code(m.ask(viewer(1), 100))).toBe('ok');
    expect(await m.code(m.ask(viewer(2), 100))).toBe('duplicate_track');
    let n = 101;
    for (let v = 2; n < 100 + MUSIC_RULES.openBarMaxQueue; v++)
      for (let k = 0; k < 7 && n < 100 + MUSIC_RULES.openBarMaxQueue; k++) {
        await m.later(21_000);
        await m.ask(viewer(v), n++);
      }
    await m.later(21_000);
    expect(await m.code(m.ask(viewer(30), n))).toBe('queue_full');
    expect((await m.spotify.musicRules(CH)).viewer_skip.price).toBe(25_000);
    await m.fund(viewer(1), 10_000);
    expect(
      await m.code(
        m.spotify.viewerSkip({
          channel_id: CH,
          viewer: viewer(1),
          key: randomUUID(),
          expected_price: 0,
        }),
      ),
    ).toBe('price_changed');
  });

  it('closing while a request is submitted: free before, priced after — never free after the closing', async () => {
    for (let round = 0; round < 3; round++) {
      const m = await bar();
      await m.fund(viewer(1), 10_000);
      await m.rules({ open_bar: true });
      const [ask] = await Promise.all([
        m.code(m.ask(viewer(1), 100 + round, 0)),
        m.rules({ open_bar: false }),
      ]);
      const rows = await m.core.db.query<{ price_tokens: number }>(
        `select price_tokens from spotify_requests where channel_id = $1`,
        [CH],
      );
      if (ask === 'ok') expect(rows.map((r) => r.price_tokens)).toEqual([0]);
      else {
        expect(ask).toBe('price_changed');
        expect(rows).toHaveLength(0);
      }
      expect(await m.balance(viewer(1))).toBe(10_000);
    }
  });

  it('kept across a restart of Core (stored), journaled on and off', async () => {
    const m = await bar();
    await m.rules({ open_bar: true });
    await m.later(1_000);
    const again = await setup({ db: m.core.db, clock: m.core.clock });
    expect((await again.spotify.musicRules(CH)).open_bar.on).toBe(true);
    await again.spotify.saveMusicRules(CH, { open_bar: false }, 'studio');
    const log = await m.core.db.query<{ action: string; ended_by: string }>(
      `select action, ended_by from module_activity where module_id = 'music_hub' order by created_at`,
    );
    expect(log.map((l) => l.action)).toEqual(['open_bar_on', 'open_bar_off']);
  });
});

describe('Music Hub — `!song` and the seek', () => {
  const STUDIO: Actor = { id: 'studio', role: 'broadcaster', via: 'studio' };
  const songSteps = (m: Awaited<ReturnType<typeof music>>) =>
    m.core.db.query<{
      idempotency_key: string;
      params: { mode: string; text: string };
    }>(
      `select idempotency_key, params from cmd_steps where origin = 'music' and idempotency_key like 'spotify:song:%'
        order by created_at, idempotency_key`,
    );
  const smtc = (
    m: Awaited<ReturnType<typeof music>>,
    seq: number,
    state: 'playing' | 'paused' = 'playing',
  ) =>
    m.spotify.liveNow(CH, {
      boot: 'boot-song-0001',
      boot_at: '2026-11-09T19:00:00.000Z',
      seq,
      gen: 1,
      state,
      track: {
        title: 'Nuit Blanche',
        artists: ['Lab Orchestra'],
        album: 'Lab',
        duration_ms: 200_000,
      },
      position_ms: 10_000,
      link: null,
      ended: null,
    });

  it('answered from Windows (SMTC) at once, as an announcement, no Spotify read; 30 s global cooldown, silent', async () => {
    const m = await music();
    await smtc(m, 1);
    expect(await m.spotify.askNowPlaying(CH, 'msg-1', 'Fan1')).toBe(
      'song_live',
    );
    expect(await m.spotify.askNowPlaying(CH, 'msg-2', 'Fan2')).toBe(
      'song_cooldown',
    );
    m.core.clock.advance(29_000);
    expect(await m.spotify.askNowPlaying(CH, 'msg-3', 'Fan3')).toBe(
      'song_cooldown',
    );
    m.core.clock.advance(1_000);
    await smtc(m, 2, 'paused');
    expect(await m.spotify.askNowPlaying(CH, 'msg-4', 'Fan4')).toBe(
      'song_live',
    );
    const steps = await songSteps(m);
    expect(steps.map((s) => [s.params.mode, s.params.text])).toEqual([
      ['announce', '🎵 En cours : Nuit Blanche — Lab Orchestra'],
      ['announce', '🎵 En pause : Nuit Blanche — Lab Orchestra'],
    ]);
    expect(
      (await m.sync()).jobs.filter((j) => j.kind === 'read_playback'),
    ).toHaveLength(0);
  });

  it('Windows silent (stale): never told as current — one Studio reading instead, still an announcement', async () => {
    const m = await music();
    await smtc(m, 1);
    m.core.clock.advance(120_000);
    await m.sync();
    expect(await m.spotify.askNowPlaying(CH, 'msg-1', 'Fan1')).toBe(
      'song_asked',
    );
    const job = (await m.sync()).jobs.find((j) => j.kind === 'read_playback')!;
    const attempt_id = randomUUID();
    await m.spotify.startJob(CH, job.job_id, attempt_id);
    await m.spotify.reportJob(CH, job.job_id, {
      kind: 'read_playback',
      attempt_id,
      playback: {
        observed_at: m.core.clock.now().toISOString(),
        track: sp(1),
        progress_ms: 1_000,
        is_playing: true,
      },
    });
    const steps = await songSteps(m);
    expect(steps.map((s) => [s.params.mode, s.params.text])).toEqual([
      ['announce', '🎵 En cours : Titre 1 — Artiste 1'],
    ]);
  });

  it('LeCroupier_ cannot announce (missing scope): the same text once as a plain message, never after an unknown send', async () => {
    const m = await music();
    const steps = new CommandSteps(m.core.db, m.core.clock);
    await steps.setOutput(CH, STUDIO, true);
    await smtc(m, 1);
    await m.spotify.askNowPlaying(CH, 'msg-1', 'Fan1');
    const s = (await steps.claim(CH, 'bot')).step!;
    await steps.ack(CH, s.step_id, {
      executor_id: 'bot',
      attempt_id: s.attempt_id!,
      event: 'failed',
      error: { code: 'missing_scope', message: 'no scope', retryable: false },
    });
    const all = await songSteps(m);
    expect(all.map((x) => [x.idempotency_key, x.params.mode])).toEqual([
      ['spotify:song:msg-1', 'announce'],
      ['spotify:song:msg-1:plain', 'normal'],
    ]);
    // The plain message failing too: nothing more (no loop).
    const p = (await steps.claim(CH, 'bot')).step!;
    await steps.ack(CH, p.step_id, {
      executor_id: 'bot',
      attempt_id: p.attempt_id!,
      event: 'failed',
      error: { code: 'forbidden', message: 'no', retryable: false },
    });
    expect(await songSteps(m)).toHaveLength(2);
  });

  it('seek: supermods / streamer only, inside the track (never its first or last seconds), Lab read-only refused', async () => {
    const m = await music({ controls: true });
    const MOD = {
      id: '900102',
      login: 'lab_modo',
      display_name: 'Lab_Modo',
      role: 'moderator' as const,
      via: 'extension' as const,
    };
    const STREAMER = { ...MOD, id: CH, role: 'broadcaster' as const };
    expect(
      await m.code(
        m.spotify.extensionModerate(
          CH,
          MOD,
          { action: 'seek', position_ms: 90_000 },
          'seek-key-0001',
        ),
      ),
    ).toBe('forbidden');
    const a = (await m.spotify.extensionModerate(
      CH,
      STREAMER,
      { action: 'seek', position_ms: 1_000 },
      'seek-key-0002',
    )) as { position_ms: number };
    expect(a.position_ms).toBe(MUSIC_RULES.seekMinMs);
    const b = (await m.spotify.extensionModerate(
      CH,
      STREAMER,
      { action: 'seek', position_ms: 199_000 },
      'seek-key-0003',
    )) as { position_ms: number };
    expect(b.position_ms).toBe(200_000 - MUSIC_RULES.seekEndMarginMs);
    const jobs = (await m.sync()).jobs.filter((j) => j.kind === 'control');
    expect(jobs[0]).toMatchObject({
      action: 'seek',
      position_ms: MUSIC_RULES.seekMinMs,
      expect_uri: sp(1).uri,
    });
    await m.setStatus({ read_only: true });
    expect(
      await m.code(
        m.spotify.extensionModerate(
          CH,
          STREAMER,
          { action: 'seek', position_ms: 90_000 },
          'seek-key-0004',
        ),
      ),
    ).toBe('lab_read_only');
    expect(await m.code(m.spotify.control(CH, 'pause', null, 'studio'))).toBe(
      'lab_read_only',
    );
  });
});

describe('Music Hub — audit 09/11', () => {
  it('a moderator skip while a paid skip is on its way is refused (never the NEXT track skipped too)', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    await m.buy(viewer(1));
    expect(await m.spotify.skip(CH, 'spotify:test:mod-after', 'Lab_Modo')).toBe(
      'songskip_busy',
    );
    expect(await m.runSkips('skipped')).toHaveLength(1);
    // Once settled, the moderation skips again.
    await m.play(2);
    expect(await m.spotify.skip(CH, 'spotify:test:mod-next', 'Lab_Modo')).toBe(
      'songskip',
    );
  });

  it('a paid skip in the last 10 s of a track is refused before any debit', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    await m.at(200_000 - 8_000);
    expect(await m.code(m.buy(viewer(1)))).toBe('track_ending');
    expect(await m.balance(viewer(1))).toBe(100_000);
  });

  it('a stale Studio reading (nothing watched) is never a target', async () => {
    const m = await music();
    await m.rules({ viewer_skip_enabled: true });
    await m.fund(viewer(1), 100_000);
    m.core.clock.advance(20_000);
    // Studio alive (it syncs), its last reading of the player 20 s old.
    await m.spotify.sync(CH, {
      status: {
        auth: 'ok',
        limited_until: null,
        quota_exceeded: false,
        device: { name: 'PC', type: 'Computer' },
        calls_last_minute: 1,
      },
    });
    expect(await m.code(m.buy(viewer(1)))).toBe('nothing_playing');
  });

  it('Production (songV2 off): the historical !song — a plain message, no cooldown, a Studio reading', async () => {
    const m = await music();
    m.spotify.songV2 = false;
    expect(await m.spotify.askNowPlaying(CH, 'h-1', 'Fan1')).toBe('song_asked');
    expect(await m.spotify.askNowPlaying(CH, 'h-2', 'Fan2')).toBe('song_asked');
    const songs = await m.core.db.query<{ params: { mode: string } }>(
      `select params from cmd_steps where origin = 'music'`,
    );
    expect(songs).toHaveLength(0); // answered when Studio reports (read_playback jobs)
    expect(
      (await m.sync()).jobs.filter((j) => j.kind === 'read_playback'),
    ).toHaveLength(2);
  });
});
