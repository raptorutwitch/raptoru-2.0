import { randomUUID } from 'node:crypto';
import type {
  SpotifyPlayback,
  SpotifySearchItem,
  SpotifyStudioStatus,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { adminAdjust } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// Music Hub (docs/music/MUSIC_HUB_STATE.md): the extension's entry into Spotify V2 — the SAME requests, queue, limits
// and Studio jobs as the reward, paid in Jetons (debited with the request, refunded once), team actions behind Core
// permissions. Studio is played by its syncs and job reports, as in spotify-service.test.ts.

const CH = '83603689';
const ID = (n: number) => `MUSICHUB${String(n).padStart(14, '0')}`;
const item = (
  n: number,
  over: Partial<SpotifySearchItem> = {},
): SpotifySearchItem => ({
  id: ID(n),
  uri: `spotify:track:${ID(n)}`,
  title: `Titre ${n}`,
  artists: [`Artiste ${n}`],
  album: `Album ${n}`,
  duration_ms: 200_000,
  image_url: null,
  playable: true,
  ...over,
});
const OK: SpotifyStudioStatus = {
  auth: 'ok',
  limited_until: null,
  quota_exceeded: false,
  device: { name: 'PC (simulé)', type: 'Computer' },
  calls_last_minute: 1,
};
const viewer = (n: number) => ({
  id: String(9100 + n),
  login: `fan${n}`,
  name: `Fan${n}`,
});
const MOD = {
  id: '900102',
  login: 'lab_modo',
  display_name: 'Lab_Modo',
  role: 'moderator' as const,
  via: 'extension' as const,
};

/** The streamer from the extension (Music Hub V2: the player is the supermods' and the streamer's). */
const STREAMER = { ...MOD, id: '83603689', role: 'broadcaster' as const };

async function hub(
  o: { extension?: boolean; open?: boolean; controls?: boolean } = {},
) {
  const core = await setup();
  core.clock.set(new Date('2026-11-08T20:00:00Z'));
  const { spotify } = core;
  await spotify.saveSettings(
    CH,
    {
      enabled: o.open !== false,
      extension_enabled: o.extension !== false,
      extension_price_tokens: 500,
      player_controls: !!o.controls,
    },
    'test',
  );
  const sync = (playback?: SpotifyPlayback | null) =>
    spotify.sync(CH, {
      status: OK,
      ...(playback !== undefined ? { playback } : {}),
    });
  await sync();
  const balance = async (v: { id: string }) =>
    (await core.economy.balances(core.db, CH, v.id)).tokens;
  const fund = async (v: { id: string }, amount: number) =>
    core.db.tx(async (q) => {
      const now = core.clock.now();
      const b = (await core.economy.balances(q, CH, v.id)).tokens;
      await adminAdjust(q, now, {
        channelId: CH,
        viewerId: v.id,
        currency: 'tokens',
        delta: amount - b,
        actor: 'test',
        reason: null,
      });
    });
  /** Studio answers every queued search job with these items. */
  const answerSearches = async (items: SpotifySearchItem[]) => {
    const a = await sync();
    for (const j of a.jobs.filter((x) => x.kind === 'search')) {
      const attempt_id = randomUUID();
      await spotify.startJob(CH, j.job_id, attempt_id);
      await spotify.reportJob(CH, j.job_id, {
        kind: 'search',
        attempt_id,
        outcome: 'done',
        provider: 'lab',
        items,
      });
    }
  };
  /** Studio runs every queued song request: queued (or refused with `reason`). */
  const runRequests = async (reason?: 'NOT_FOUND') => {
    const a = await sync();
    for (const j of a.jobs.filter((x) => x.kind === 'song_request')) {
      if (j.kind !== 'song_request') continue;
      const attempt_id = randomUUID();
      await spotify.startJob(CH, j.job_id, attempt_id);
      const id = j.reference.kind === 'exact' ? j.reference.track_id : ID(99);
      await spotify.reportJob(CH, j.job_id, {
        kind: 'song_request',
        attempt_id,
        ...(reason
          ? { outcome: 'refused' as const, reason }
          : {
              outcome: 'queued' as const,
              track: {
                id,
                uri: `spotify:track:${id}`,
                title: `Titre de ${id}`,
                artists: ['Artiste'],
                duration_ms: 200_000,
              },
              confirmation: 'http_204' as const,
            }),
      });
    }
  };
  const search = async (v: { id: string }, text: string) =>
    spotify.extensionSearch(CH, v.id, text);
  const ask = (
    v: ReturnType<typeof viewer>,
    n: number,
    key = randomUUID(),
    expected_price: number | null = 500,
  ) =>
    spotify.extensionRequest({
      channel_id: CH,
      viewer: v,
      track_id: ID(n),
      key,
      expected_price,
    });
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  };
  const steps = async () =>
    Number(
      (
        await core.db.query<{ n: string }>(
          'select count(*) as n from cmd_steps',
        )
      )[0]!.n,
    );
  return {
    core,
    spotify,
    sync,
    balance,
    fund,
    answerSearches,
    runRequests,
    search,
    ask,
    code,
    steps,
  };
}

describe('Music Hub — search (the catalogue through Studio)', () => {
  it('OFF by default: the reward is untouched, the extension entry refuses', async () => {
    const core = await setup();
    const s = await core.spotify.settings(CH);
    expect(s.extension_enabled).toBe(false);
    expect(s.player_controls).toBe(false);
    const h = await hub({ extension: false });
    expect(await h.code(h.search(viewer(1), 'numb'))).toBe(
      'extension_disabled',
    );
    const closed = await hub({ open: false });
    expect(await closed.code(closed.search(viewer(1), 'numb'))).toBe(
      'requests_closed',
    );
  });

  it('one job per text (reused), results with « trop long » marked, a per-viewer rate limit', async () => {
    const h = await hub();
    const a = await h.search(viewer(1), '  Numb ');
    expect(a.status).toBe('pending');
    const b = await h.search(viewer(2), 'numb');
    expect(b.search_id).toBe(a.search_id);
    await h.answerSearches([
      item(1),
      item(2, { duration_ms: 11 * 60_000 }),
      item(3, { playable: false }),
    ]);
    const r = await h.spotify.searchResult(CH, a.search_id);
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    expect(r.provider).toBe('lab');
    expect(r.items.map((i) => i.too_long)).toEqual([false, true, false]);
    expect(await h.code(h.search(viewer(1), 'x'))).toBe('query_too_short');
    for (let n = 0; n < 20; n++) await h.search(viewer(3), `mot ${n}`);
    expect(await h.code(h.search(viewer(3), 'mot de trop'))).toBe(
      'search_rate_limited',
    );
  });

  it('Studio silent: the search ends « indisponible », never pending forever', async () => {
    const h = await hub();
    const a = await h.search(viewer(1), 'blinding');
    h.core.clock.set(new Date(h.core.clock.now().getTime() + 7_000));
    const r = await h.spotify.searchResult(CH, a.search_id);
    expect(r.status).toBe('failed');
  });
});

describe('Music Hub — a request paid in Jetons', () => {
  it('debited once with the request; the same key again (double click, retry) is the same request', async () => {
    const h = await hub();
    await h.fund(viewer(1), 2_000);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([item(1)]);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      h.ask(viewer(1), 1, key),
      h.ask(viewer(1), 1, key),
    ]);
    expect(a.request.request_id).toBe(b.request.request_id);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(await h.balance(viewer(1))).toBe(1_500);
    expect(a.request.payment).toBe('tokens');
    expect(a.request.price_tokens).toBe(500);
    expect(a.request.source).toBe('extension');
    await h.runRequests();
    const st = await h.spotify.extensionState(CH, viewer(1), false);
    expect(st.queue).toHaveLength(1);
    expect(st.queue[0]!.own).toBe(true);
    expect(st.me?.pending).toBe(1);
    expect(st.me?.balance).toBe(1_500);
  });

  it('refusals before any debit: price changed, not from a search, not playable, too long, no Jetons', async () => {
    const h = await hub();
    await h.fund(viewer(1), 300);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([
      item(1),
      item(2, { playable: false }),
      item(3, { duration_ms: 20 * 60_000 }),
    ]);
    expect(await h.code(h.ask(viewer(1), 1, randomUUID(), 400))).toBe(
      'price_changed',
    );
    expect(await h.code(h.ask(viewer(1), 7))).toBe('track_unknown');
    expect(await h.code(h.ask(viewer(1), 2))).toBe('not_playable');
    expect(await h.code(h.ask(viewer(1), 3))).toBe('too_long');
    expect(await h.code(h.ask(viewer(1), 1))).toBe('insufficient_tokens');
    expect(await h.balance(viewer(1))).toBe(300);
    const n = await h.core.db.query(
      `select 1 from spotify_requests where source = 'extension'`,
    );
    expect(n).toHaveLength(0);
  });

  it('the reward and the extension share ONE queue and ONE set of limits; no track twice', async () => {
    const h = await hub();
    await h.spotify.saveSettings(
      CH,
      { max_pending_per_viewer: 1, viewer_cooldown_seconds: 0 },
      'test',
    );
    await h.fund(viewer(1), 5_000);
    await h.fund(viewer(2), 5_000);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([item(1), item(2)]);
    // A reward redemption of the same viewer first (channel points).
    await h.spotify.admit({
      channel_id: CH,
      source: 'simulation',
      source_ref: 'simulation:r1',
      reward_id: 'lab-simulated',
      redemption_id: 'r1',
      viewer: viewer(1),
      user_input: `spotify:track:${ID(5)}`,
    });
    expect(await h.code(h.ask(viewer(1), 1))).toBe('viewer_limit');
    await h.ask(viewer(2), 1);
    expect(await h.code(h.ask(viewer(1), 1))).toBe('viewer_limit');
    await h.runRequests();
    const st = await h.spotify.extensionState(CH, null, true);
    expect(st.queue.map((e) => e.source)).toEqual(['reward', 'extension']);
    // Another viewer asking the track already waiting.
    await h.fund(viewer(3), 5_000);
    expect(await h.code(h.ask(viewer(3), 1))).toBe('duplicate_track');
  });

  it('Studio refuses the request (not found): Jetons given back once, no refusal line in the chat', async () => {
    const h = await hub();
    await h.fund(viewer(1), 1_000);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([item(1)]);
    await h.ask(viewer(1), 1);
    expect(await h.balance(viewer(1))).toBe(500);
    const before = await h.steps();
    await h.runRequests('NOT_FOUND');
    expect(await h.balance(viewer(1))).toBe(1_000);
    expect(await h.steps()).toBe(before);
    const r = (
      await h.core.db.query<{ state: string; refund_status: string }>(
        `select state, refund_status from spotify_requests where source = 'extension'`,
      )
    )[0]!;
    expect(r).toEqual({ state: 'FAILED', refund_status: 'refunded' });
  });
});

describe('Music Hub — withdrawals and moderation', () => {
  it('the viewer withdraws a waiting request: refunded exactly once (twice, concurrently: still once)', async () => {
    const h = await hub();
    await h.fund(viewer(1), 1_000);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([item(1)]);
    const { request } = await h.ask(viewer(1), 1);
    await h.runRequests();
    const before = await h.steps();
    const [a, b] = await Promise.all([
      h.spotify.extensionCancel(
        CH,
        { id: viewer(1).id, name: 'Fan1' },
        request.request_id,
      ),
      h.spotify.extensionCancel(
        CH,
        { id: viewer(1).id, name: 'Fan1' },
        request.request_id,
      ),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual([
      'songcancel',
      'songcancel_none',
    ]);
    expect(await h.balance(viewer(1))).toBe(1_000);
    expect(await h.steps()).toBe(before); // silent: the extension shows it
    const other = await h.spotify.extensionCancel(
      CH,
      { id: viewer(2).id, name: 'Fan2' },
      request.request_id,
    );
    expect(other.outcome).toBe('songcancel_none');
    expect(other.request).toBeNull();
  });

  it('!songcancel in the chat on a request paid in Jetons: the Jetons come back once, the chat answers as for the reward', async () => {
    const h = await hub();
    await h.fund(viewer(1), 1_000);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([item(1)]);
    await h.ask(viewer(1), 1);
    await h.runRequests();
    expect(await h.balance(viewer(1))).toBe(500);
    const before = await h.steps();
    const a = await h.spotify.cancel(CH, 'chat-msg-1', {
      id: viewer(1).id,
      name: 'Fan1',
    });
    expect(a).toBe('songcancel');
    expect(await h.balance(viewer(1))).toBe(1_000);
    expect(await h.steps()).toBeGreaterThan(before); // the chat line, as for the reward
    const again = await h.spotify.cancel(CH, 'chat-msg-2', {
      id: viewer(1).id,
      name: 'Fan1',
    });
    expect(again).toBe('songcancel_none');
    expect(await h.balance(viewer(1))).toBe(1_000);
  });

  it('a viewer cannot moderate; a moderator removes with refund, or without (kept), never twice', async () => {
    const h = await hub();
    await h.spotify.saveSettings(
      CH,
      { max_pending_per_viewer: 5, viewer_cooldown_seconds: 0 },
      'test',
    );
    await h.fund(viewer(1), 5_000);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([item(1), item(2)]);
    const r1 = (await h.ask(viewer(1), 1)).request;
    const r2 = (await h.ask(viewer(1), 2)).request;
    await h.runRequests();
    expect(await h.balance(viewer(1))).toBe(4_000);
    expect(
      await h.code(
        h.spotify.extensionModerate(
          CH,
          { ...MOD, id: viewer(1).id, role: 'viewer' },
          { action: 'remove', request_id: r1.request_id, refund: true },
          'key-viewer-1',
        ),
      ),
    ).toBe('forbidden');
    type Removed = {
      request: {
        state: string;
        refund_status: string | null;
        refunded_by: string | null;
      } | null;
    };
    const removed = (await h.spotify.extensionModerate(
      CH,
      MOD,
      { action: 'remove', request_id: r1.request_id, refund: true },
      'key-mod-0001',
    )) as Removed;
    expect(removed.request?.state).toBe('REMOVED_BY_MOD');
    expect(removed.request?.refund_status).toBe('refunded');
    expect(await h.balance(viewer(1))).toBe(4_500);
    const kept = (await h.spotify.extensionModerate(
      CH,
      MOD,
      { action: 'remove', request_id: r2.request_id, refund: false },
      'key-mod-0002',
    )) as Removed;
    expect(kept.request?.refund_status).toBe('kept');
    expect(kept.request?.refunded_by).toBe('Lab_Modo');
    expect(await h.balance(viewer(1))).toBe(4_500);
    expect(
      await h.code(
        h.spotify.extensionModerate(
          CH,
          MOD,
          { action: 'remove', request_id: r1.request_id, refund: true },
          'key-mod-0003',
        ),
      ),
    ).toBe('not_removable');
    expect(await h.balance(viewer(1))).toBe(4_500);
  });

  it('player controls (the streamer here; supermods: V2 tests): OFF by default; ON: a job for Studio, its real result, the volume read back', async () => {
    const off = await hub();
    expect(
      await off.code(
        off.spotify.extensionModerate(
          CH,
          STREAMER,
          { action: 'pause' },
          'key-pause-1',
        ),
      ),
    ).toBe('player_controls_disabled');
    const h = await hub({ controls: true });
    const asked = (await h.spotify.extensionModerate(
      CH,
      STREAMER,
      { action: 'volume', volume_percent: 40 },
      'key-volume-1',
    )) as { job_id: string };
    expect((await h.spotify.controlResult(CH, asked.job_id)).status).toBe(
      'pending',
    );
    const a = await h.sync();
    const job = a.jobs.find((j) => j.kind === 'control')!;
    expect(job).toMatchObject({ action: 'volume', volume_percent: 40 });
    const attempt_id = randomUUID();
    await h.spotify.startJob(CH, job.job_id, attempt_id);
    await h.spotify.reportJob(CH, job.job_id, {
      kind: 'control',
      attempt_id,
      outcome: 'done',
      playback: {
        observed_at: h.core.clock.now().toISOString(),
        track: null,
        progress_ms: null,
        is_playing: false,
        volume_percent: 40,
      },
    });
    expect((await h.spotify.controlResult(CH, asked.job_id)).status).toBe(
      'done',
    );
  });
});

describe('Music Hub V2 — supermods, withdrawal while being added, links', () => {
  const SUPER = {
    ...MOD,
    id: '900103',
    login: 'lab_supermod',
    display_name: 'Supermod_Lab',
  };
  const named = (h: Awaited<ReturnType<typeof hub>>, id = '900103') =>
    h.core.db.query(
      `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at) values ($1, $2, 'supermod', 'test', now())`,
      [CH, id],
    );
  type Can = { can: { moderate: boolean; player: boolean; refund: boolean } };
  type Mine = {
    queue: unknown[];
    me: {
      requests: { request_id: string; state: string; cancellable: boolean }[];
      history: { state: string; refunded: boolean }[];
    };
  };
  const mine = async (h: Awaited<ReturnType<typeof hub>>) =>
    (await h.spotify.extensionState(
      CH,
      { id: viewer(1).id, login: 'fan1' },
      false,
    )) as unknown as Mine;

  it('the player (pause, resume, skip, volume) is the supermods: a moderator is refused by Core, whatever the button', async () => {
    const h = await hub({ controls: true });
    await named(h);
    for (const command of [
      { action: 'pause' as const },
      { action: 'resume' as const },
      { action: 'skip' as const },
      { action: 'volume' as const, volume_percent: 30 },
    ]) {
      expect(
        await h.code(
          h.spotify.extensionModerate(
            CH,
            MOD,
            command,
            `key-mod-${command.action}`,
          ),
        ),
      ).toBe('forbidden');
      expect(
        await h.code(
          h.spotify.extensionModerate(
            CH,
            { ...MOD, id: viewer(1).id, role: 'viewer' },
            command,
            `key-v-${command.action}`,
          ),
        ),
      ).toBe('forbidden');
    }
    const paused = (await h.spotify.extensionModerate(
      CH,
      SUPER,
      { action: 'pause' },
      'key-super-pause',
    )) as { job_id: string };
    expect(paused.job_id).toMatch(/^[0-9a-f-]{36}$/);
    const skipped = (await h.spotify.extensionModerate(
      CH,
      SUPER,
      { action: 'skip' },
      'key-super-skip',
    )) as { outcome: string; job_id: string | null };
    expect(skipped.outcome).toBe('songskip');
    expect((await h.spotify.controlResult(CH, skipped.job_id!)).status).toBe(
      'pending',
    );
    // A moderator still removes (its standard moderation), never the player.
    const st = async (
      id: string,
      team: boolean,
      role?: 'viewer' | 'moderator',
    ) =>
      (
        (await h.spotify.extensionState(
          CH,
          { id, login: 'x' },
          team,
          role,
        )) as unknown as Can
      ).can;
    expect(await st(viewer(1).id, false)).toMatchObject({
      moderate: false,
      player: false,
    });
    expect(await st(MOD.id, true, 'moderator')).toMatchObject({
      moderate: true,
      refund: true,
      player: false,
    });
    expect(await st(SUPER.id, true, 'moderator')).toMatchObject({
      moderate: true,
      player: true,
    });
    // Without the team flag (a viewer's JWT), even the supermod's id gets nothing: rights come from the verified token.
    expect(await st(SUPER.id, false)).toMatchObject({
      moderate: false,
      player: false,
    });
  });

  it('two supermods at once: two jobs, each with its own answer from Studio (never a success the player did not confirm)', async () => {
    const h = await hub({ controls: true });
    await named(h);
    await named(h, '900104');
    const [a, b] = (await Promise.all([
      h.spotify.extensionModerate(CH, SUPER, { action: 'pause' }, 'key-two-1'),
      h.spotify.extensionModerate(
        CH,
        { ...SUPER, id: '900104' },
        { action: 'resume' },
        'key-two-2',
      ),
    ])) as { job_id: string }[];
    const jobs = (await h.sync()).jobs.filter((j) => j.kind === 'control');
    expect(jobs).toHaveLength(2);
    const outcomes = ['done', 'failed'] as const;
    for (const [i, j] of jobs.entries()) {
      const attempt_id = randomUUID();
      await h.spotify.startJob(CH, j.job_id, attempt_id);
      await h.spotify.reportJob(CH, j.job_id, {
        kind: 'control',
        attempt_id,
        ...(outcomes[i] === 'done'
          ? {
              outcome: 'done' as const,
              playback: {
                observed_at: h.core.clock.now().toISOString(),
                track: null,
                progress_ms: null,
                is_playing: false,
                volume_percent: 50,
              },
            }
          : { outcome: 'failed' as const, reason: 'NO_DEVICE' as const }),
      });
    }
    const results = [
      (await h.spotify.controlResult(CH, a!.job_id)).status,
      (await h.spotify.controlResult(CH, b!.job_id)).status,
    ].sort();
    expect(results).toEqual(['done', 'failed']);
  });

  it('withdrawn before Studio takes it (RECEIVED): refunded once, its job withdrawn, never added to Spotify', async () => {
    const h = await hub();
    await h.fund(viewer(1), 1_000);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([item(1)]);
    const { request } = await h.ask(viewer(1), 1);
    expect((await mine(h)).me.requests).toEqual([
      expect.objectContaining({
        request_id: request.request_id,
        state: 'RECEIVED',
        cancellable: true,
      }),
    ]);
    const out = await h.spotify.extensionCancel(
      CH,
      { id: viewer(1).id, name: 'Fan1' },
      request.request_id,
    );
    expect(out.outcome).toBe('songcancel');
    expect(out.request).toMatchObject({
      state: 'CANCELED',
      refund_status: 'refunded',
    });
    expect(await h.balance(viewer(1))).toBe(1_000);
    expect(
      (await h.sync()).jobs.filter((j) => j.kind === 'song_request'),
    ).toHaveLength(0);
    const again = await h.spotify.extensionCancel(
      CH,
      { id: viewer(1).id, name: 'Fan1' },
      request.request_id,
    );
    expect(again.outcome).toBe('songcancel_none');
    expect(await h.balance(viewer(1))).toBe(1_000);
    const after = await mine(h);
    expect(after.queue).toHaveLength(0);
    expect(after.me.requests).toHaveLength(0);
    expect(after.me.history[0]).toMatchObject({
      state: 'CANCELED',
      refunded: true,
    });
  });

  it('withdrawn while Studio adds it (SEARCHING): refunded at once; Spotify takes it, a tombstone skipped when it plays; refused, nothing again', async () => {
    for (const outcome of ['queued', 'refused'] as const) {
      const h = await hub();
      await h.fund(viewer(1), 1_000);
      await h.search(viewer(1), 'titre');
      await h.answerSearches([item(1)]);
      const { request } = await h.ask(viewer(1), 1);
      const job = (await h.sync()).jobs.find((j) => j.kind === 'song_request')!;
      const attempt_id = randomUUID();
      await h.spotify.startJob(CH, job.job_id, attempt_id); // SEARCHING
      const out = await h.spotify.extensionCancel(
        CH,
        { id: viewer(1).id, name: 'Fan1' },
        request.request_id,
      );
      expect(out.outcome).toBe('songcancel');
      expect(await h.balance(viewer(1))).toBe(1_000);
      await h.spotify.reportJob(CH, job.job_id, {
        kind: 'song_request',
        attempt_id,
        ...(outcome === 'queued'
          ? {
              outcome,
              track: {
                id: ID(1),
                uri: `spotify:track:${ID(1)}`,
                title: 'Titre 1',
                artists: ['Artiste 1'],
                duration_ms: 200_000,
              },
              confirmation: 'http_204' as const,
            }
          : { outcome, reason: 'NOT_FOUND' as const }),
      });
      expect(await h.balance(viewer(1))).toBe(1_000); // never twice
      const s = await h.sync();
      const tomb = s.queue.find((e) => e.request_id === request.request_id);
      if (outcome === 'queued')
        expect(tomb).toMatchObject({
          state: 'CANCELED',
          auto_skip: true,
          track_uri: `spotify:track:${ID(1)}`,
        });
      else expect(tomb).toBeUndefined();
      // Gone from Raptoru's queue at once, whatever Spotify's own queue still holds.
      expect((await mine(h)).queue).toHaveLength(0);
    }
  });

  it('!songcancel alone in the chat while the only request is being added: canceled, refunded, the chat says so', async () => {
    const h = await hub();
    await h.fund(viewer(1), 1_000);
    await h.search(viewer(1), 'titre');
    await h.answerSearches([item(1)]);
    await h.ask(viewer(1), 1);
    const before = await h.steps();
    expect(
      await h.spotify.cancel(CH, 'chat-inflight-1', {
        id: viewer(1).id,
        name: 'Fan1',
      }),
    ).toBe('songcancel');
    expect(await h.balance(viewer(1))).toBe(1_000);
    expect(await h.steps()).toBeGreaterThan(before);
    expect(
      await h.spotify.cancel(CH, 'chat-inflight-2', {
        id: viewer(1).id,
        name: 'Fan1',
      }),
    ).toBe('songcancel_none');
    expect(await h.balance(viewer(1))).toBe(1_000);
  });

  it('a pasted Spotify track link searches that exact track (the reward reference rules); another link is refused', async () => {
    const h = await hub();
    const r = await h.search(
      viewer(1),
      `https://open.spotify.com/intl-fr/track/${ID(7)}?si=abc`,
    );
    expect(r.status).toBe('pending');
    const job = (await h.sync()).jobs.find((j) => j.kind === 'search')!;
    expect(job).toMatchObject({
      kind: 'search',
      query: `track:${ID(7)}`,
      track_id: ID(7),
    });
    expect(
      await h.code(
        h.search(
          viewer(1),
          'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
        ),
      ),
    ).toBe('invalid_reference');
    expect(
      await h.code(h.search(viewer(1), 'https://example.com/track/abc')),
    ).toBe('invalid_reference');
    // The same track again (its URI): the same job, no second catalogue call.
    const again = await h.search(viewer(1), `spotify:track:${ID(7)}`);
    expect(again.search_id).toBe(r.search_id);
  });
});
