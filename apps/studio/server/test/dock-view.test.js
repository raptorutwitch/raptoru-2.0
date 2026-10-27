import { describe, expect, it } from 'vitest';
import {
  ago,
  byRecency,
  catOf,
  CATS,
  DEFAULT_PREFS,
  emoteHtml,
  entries,
  esc,
  folded,
  GROUP_GAP_MS,
  groupState,
  hasDetail,
  money,
  parseSse,
  participants,
  readPrefs,
  recipientsByGift,
  replayable,
  rowHtml,
  stateOf,
  titleOf,
  who,
} from '../dock-page/dock-view.js';
import { dockPanelView } from '../../web/src/dock-panel.ts';

// Dock OBS V1.1 (docs/OBS_DOCK.md) — the dock page's pure part: titles (French, compact), categories, states as
// icons, when the replay button shows, viewer text never inserted as HTML, relative times, the presentation grouping
// (deterministic, after the filters), the preferences, the stream parser, and Studio's panel.

const T0 = Date.parse('2026-10-27T20:00:00Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
let n = 0;
const alert = (type, data = {}, state = {}, sec = 0) => ({
  activity_key: `alert:twitch:${type}-${++n}`,
  kind: 'alert',
  type,
  occurred_at: at(sec),
  data: { actor: { id: '1', login: 'alice', display_name: 'Alice' }, ...data },
  state: {
    outcome: 'queued',
    alert_id: '00000000-0000-4000-8000-000000000001',
    alert_status: 'completed',
    ...state,
  },
  seq: n,
});
const reward = (state = {}, data = {}) => ({
  activity_key: `cp:twitch:r${++n}`,
  kind: 'channel_points',
  type: 'reward',
  occurred_at: at(0),
  data: {
    actor: { id: '7', login: 'bob', name: 'Bob' },
    reward: { id: 'x', title: 'Hydrate', cost: 500 },
    ...data,
  },
  state: { status: 'done', twitch_status: 'FULFILLED', ...state },
  seq: n,
});
const ix = (type, sec, viewer = 'Kev', data = {}, state = {}) => ({
  activity_key: `ix:${type}:${++n}`,
  kind: 'interaction',
  type,
  occurred_at: at(sec),
  data: { actor: { id: viewer, name: viewer }, ...data },
  state: { status: 'completed', refund_status: 'none', ...state },
  seq: n,
});
const bonk = (sec, viewer, state) =>
  ix('bonk', sec, viewer, { emote: { glyph: '😀' } }, state);
const sound = (sec, id, viewer) =>
  ix('soundboard', sec, viewer, { sound: { id, label: id.toUpperCase() } });
const one = (a) => ({ key: a.activity_key, gk: null, items: [a] });
/** Rows as « type×count » for compact assertions. */
const shape = (rows) => rows.map((r) => `${r.items[0].type}×${r.items.length}`);
const keysOf = (rows) =>
  rows.map((r) => [r.key, r.items.map((a) => a.activity_key)]);

describe('titles and categories', () => {
  it('every type: a bold title, a short note, in French', () => {
    expect(titleOf(alert('follow')).title).toBe('Nouveau follow');
    expect(titleOf(alert('sub', { tier: '1000' }))).toMatchObject({
      title: 'Nouvel abo',
      note: 'Tier 1',
    });
    expect(titleOf(alert('resub', { tier: 'prime', months: 14 })).note).toBe(
      '14 mois · Prime',
    );
    expect(
      titleOf(
        alert('gift_targeted', {
          recipient: { login: 'carl', display_name: 'Carl' },
          tier: '2000',
        }),
      ).note,
    ).toBe('à Carl · Tier 2');
    expect(titleOf(alert('gift_community', { count: 5 })).title).toBe(
      '5 abos offerts',
    );
    expect(titleOf(alert('gift_community', { count: 1 })).title).toBe(
      'Abo offert',
    );
    expect(titleOf(alert('bits', { bits: 1 })).title).toBe('1 bit');
    expect(titleOf(alert('bits', { bits: 1500 })).title).toBe('1 500 bits');
    expect(titleOf(alert('raid', { viewers: 42 })).note).toBe('42 viewers');
    expect(
      titleOf(
        alert('donation', {
          amount: { value: 1000, decimal_place: 2, currency: 'EUR' },
        }),
      ).title,
    ).toMatch(/^Don 10,00\s€$/);
    expect(titleOf(bonk(0, 'Kev'))).toMatchObject({
      title: 'Bonk',
      note: '😀',
    });
    expect(titleOf(sound(0, 'boop', 'Kev')).title).toBe('BOOP');
    expect(titleOf(ix('tts', 0)).title).toBe('TTS');
    expect(titleOf(ix('random_ban', 0, 'Kev', { target: 'Zed' })).note).toBe(
      '→ Zed',
    );
  });

  it('a reward shows its real name; its cost only when the preference asks for it (off by default)', () => {
    expect(titleOf(reward())).toEqual({ title: 'Hydrate', note: '' });
    expect(titleOf(reward(), { ...DEFAULT_PREFS, costs: true }).note).toBe(
      '500 pts',
    );
    expect(rowHtml(one(reward()))).not.toContain('500');
  });

  it('donations in their own currency, never converted', () => {
    expect(money({ value: 500, decimal_place: 2, currency: 'EUR' })).toMatch(
      /^5,00\s€$/,
    );
    expect(money({ value: 1999, decimal_place: 2, currency: 'USD' })).toMatch(
      /19,99\s\$US/,
    );
    expect(money(undefined)).toBe('');
  });

  it('who: the display name, else the login; anonymous gifts / donations say so', () => {
    expect(who(alert('follow'))).toBe('Alice');
    expect(who(reward())).toBe('Bob');
    expect(
      who(alert('gift_community', { anonymous: true, actor: undefined })),
    ).toBe('Anonyme');
  });

  it('categories: one per type, each with its own icon (colour is never the only cue)', () => {
    expect(
      [
        'follow',
        'resub',
        'gift_recipient',
        'bits',
        'raid',
        'donation',
        'reward',
        'tts',
        'soundboard',
        'bonk',
        'raffle',
        'random_ban',
      ].map((type) => catOf({ type })),
    ).toEqual([
      'follow',
      'sub',
      'sub',
      'bits',
      'raid',
      'donation',
      'reward',
      'tts',
      'soundboard',
      'bonk',
      'internal',
      'internal',
    ]);
    expect(new Set(CATS.map((c) => c.icon)).size).toBe(CATS.length);
  });
});

describe('states (icons with a tooltip) and the replay button', () => {
  it('alert: played / waiting / failed / no animation; a replay waiting', () => {
    expect(stateOf(alert('follow')).tone).toBe('ok');
    expect(stateOf(alert('follow', {}, { alert_status: 'queued' })).tone).toBe(
      'wait',
    );
    expect(stateOf(alert('follow', {}, { alert_status: 'failed' }))).toEqual({
      label: 'Alerte en échec',
      tone: 'bad',
    });
    expect(
      stateOf(alert('bits', {}, { outcome: 'below_threshold', alert_id: null }))
        .tone,
    ).toBe('muted');
    expect(
      stateOf(alert('sub', {}, { replay: { status: 'queued', count: 1 } }))
        .label,
    ).toBe('Rejeu en attente');
  });

  it('redemption: Raptoru’s processing, its failure reason kept for the detail; cancelled on Twitch', () => {
    expect(stateOf(reward()).tone).toBe('ok');
    expect(stateOf(reward({ status: 'failed', reason: 'obs_down' }))).toEqual({
      label: 'Échec du traitement',
      tone: 'bad',
      reason: 'obs_down',
    });
    expect(
      stateOf(reward({ twitch_status: 'CANCELED', status: 'done' })).label,
    ).toBe('Annulée sur Twitch');
  });

  it('interactions: requested, running, done, failed, unknown, cancelled, in review, refunded', () => {
    const s = (state) => stateOf(ix('bonk', 0, 'Kev', {}, state));
    expect(s({ status: 'accepted' }).tone).toBe('wait');
    expect(s({ status: 'executing' }).tone).toBe('wait');
    expect(s({ status: 'completed' }).tone).toBe('ok');
    expect(s({ status: 'failed', error: 'obs_unavailable' })).toMatchObject({
      tone: 'bad',
      reason: 'obs_unavailable',
    });
    expect(s({ status: 'execution_unknown' }).tone).toBe('bad');
    expect(s({ status: 'cancelled' }).tone).toBe('muted');
    expect(s({ status: 'queued', review_status: 'pending' })).toMatchObject({
      label: 'En attente de validation',
      tone: 'wait',
    });
    expect(s({ status: 'failed', refund_status: 'refunded' }).label).toBe(
      'Échec · remboursée',
    );
  });

  it('the status is an icon with its label as tooltip and accessible name; the failure reason never on the line', () => {
    const html = rowHtml(
      one(bonk(0, 'Kev', { status: 'failed', error: 'obs_unavailable' })),
    );
    expect(html).toContain('class="st t-bad"');
    expect(html).toContain('aria-label="Échec : obs_unavailable"');
    expect(html).not.toContain('class="meta');
  });

  it('the replay shows only for an alert that played (or failed / expired), with nothing waiting; never Bonk, TTS, sounds, redemptions', () => {
    expect(replayable(alert('follow'))).toBe(true);
    expect(replayable(alert('follow', {}, { alert_status: 'expired' }))).toBe(
      true,
    );
    expect(replayable(alert('follow', {}, { alert_status: 'queued' }))).toBe(
      false,
    );
    expect(
      replayable(
        alert('follow', {}, { replay: { status: 'playing', count: 1 } }),
      ),
    ).toBe(false);
    expect(
      replayable(
        alert('bits', {}, { outcome: 'below_threshold', alert_id: null }),
      ),
    ).toBe(false);
    for (const a of [reward(), bonk(0), ix('tts', 0), sound(0, 'boop')])
      expect(rowHtml(one(a))).not.toContain('data-replay=');
    expect(rowHtml(one(alert('follow')))).toContain('data-replay=');
    expect(rowHtml(one(alert('follow')), { confirm: true })).toContain(
      'Rejouer ?',
    );
  });
});

describe('viewer text is never HTML', () => {
  const evil = '<img src=x onerror=alert(1)>"\'`&';
  it('pseudos, messages, reward and sound names, recipients, TTS: escaped everywhere (row, preview, detail)', () => {
    const rows = [
      rowHtml(
        one(
          alert('donation', {
            actor: { login: 'x', display_name: evil },
            message: evil,
          }),
        ),
        { open: true },
      ),
      rowHtml(one(alert('donation', { message: evil }))),
      rowHtml(
        one(reward({}, { reward: { title: evil, cost: 1 }, message: evil })),
      ),
      rowHtml(
        one(
          alert('gift_targeted', {
            recipient: { login: 'r', display_name: evil },
          }),
        ),
      ),
      rowHtml(one(ix('tts', 0, evil, { message: evil })), { open: true }),
      rowHtml(one(ix('soundboard', 0, 'k', { sound: { label: evil } }))),
      rowHtml(
        {
          key: 'g',
          gk: 'tts',
          items: [ix('tts', 1, evil, { message: evil }), ix('tts', 0, evil)],
        },
        { open: true },
      ),
    ];
    for (const html of rows) {
      expect(html).not.toContain('<img');
      expect(html).not.toMatch(/onerror=alert\(1\)>/);
      expect(html).toContain('&lt;img');
    }
    expect(esc(evil)).toBe(
      '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&#96;&amp;',
    );
  });

  it('a Bonk emote picture: https on the emote CDNs only (the CSP list), never another host', () => {
    const e = (url) => ({
      type: 'bonk',
      data: { emote: { glyph: null, url } },
    });
    expect(
      emoteHtml(
        e('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0'),
      ),
    ).toContain('<img class="emote"');
    expect(emoteHtml(e('https://cdn.7tv.app/emote/x/4x.webp'))).toContain(
      '<img',
    );
    expect(emoteHtml(e('http://static-cdn.jtvnw.net/x'))).toBe('');
    expect(emoteHtml(e('https://evil.example/x.png'))).toBe('');
    expect(emoteHtml(e('javascript:alert(1)'))).toBe('');
    expect(emoteHtml({ type: 'bonk', data: { emote: { glyph: '😀' } } })).toBe(
      '',
    );
  });
});

describe('details: only when useful', () => {
  it('a plain follow or Bonk opens nothing; a message, a TTS text, recipients, a failure reason or a group do', () => {
    expect(hasDetail(one(alert('follow')))).toBe(false);
    expect(hasDetail(one(bonk(0)))).toBe(false);
    expect(rowHtml(one(alert('follow')))).not.toContain('tabindex');
    expect(rowHtml(one(alert('follow')), { open: true })).not.toContain(
      'class="detail"',
    );
    expect(hasDetail(one(alert('donation', { message: 'gg' })))).toBe(true);
    expect(hasDetail(one(ix('tts', 0, 'k', { message: 'salut' })))).toBe(true);
    expect(hasDetail(one(alert('gift_community')), ['Ana'])).toBe(true);
    expect(hasDetail(one(reward({ status: 'failed', reason: 'x' })))).toBe(
      true,
    );
    expect(hasDetail({ key: 'g', gk: 'bonk', items: [bonk(1), bonk(0)] })).toBe(
      true,
    );
  });

  it('a long name and message stay one line in the row (CSS ellipsis), whole in the detail', () => {
    const long = 'a'.repeat(5000);
    const a = alert('donation', {
      actor: { login: 'x', display_name: long },
      message: long,
    });
    expect(rowHtml(one(a))).toContain('class="l3"');
    const open = rowHtml(one(a), { open: true });
    expect(open).toContain('class="msg-full"');
    expect(open).not.toContain('class="l3"');
  });

  it('community gifts: recipients folded into the gift and listed in its detail (escaped)', () => {
    const gift = alert('gift_community', { count: 2, community_gift_id: 'c' });
    const r = (name, cg) =>
      alert(
        'gift_recipient',
        {
          actor: { login: name, display_name: name },
          ...(cg ? { community_gift_id: cg } : {}),
        },
        { outcome: 'absorbed', alert_id: null },
      );
    const all = [gift, r('Ana', 'c'), r('<b>Bo</b>', 'c'), r('Cy')];
    expect(all.map(folded)).toEqual([false, true, true, false]);
    const map = recipientsByGift(all);
    expect(map.get('c')).toEqual(['Ana', '<b>Bo</b>']);
    const html = rowHtml(one(gift), { open: true, recipients: map.get('c') });
    expect(html).toContain('Reçus par');
    expect(html).toContain('Ana, &lt;b&gt;Bo&lt;/b&gt;');
    expect(entries(all).map((row) => row.items[0])).toEqual([all[3], gift]);
  });
});

describe('presentation grouping', () => {
  it('consecutive Bonks share a row « Bonk × N »; its members stay listed in the detail, newest first', () => {
    const items = [bonk(0, 'Kev'), bonk(10, 'Kev'), bonk(20, 'Kev')];
    const rows = entries(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(`g:${items[0].activity_key}`);
    expect(rows[0].items).toEqual([...items].reverse());
    const html = rowHtml(rows[0], { open: true });
    expect(html).toContain('Bonk × 3');
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('Soundboard: the same sound only; TTS together; alerts and redemptions never', () => {
    expect(
      shape(
        entries([
          sound(0, 'boop'),
          sound(5, 'boop'),
          sound(10, 'horn'),
          sound(15, 'boop'),
        ]),
      ),
    ).toEqual(['soundboard×1', 'soundboard×1', 'soundboard×2']);
    expect(shape(entries([ix('tts', 0), ix('tts', 30)]))).toEqual(['tts×2']);
    expect(
      shape(entries([alert('follow', {}, {}, 0), alert('follow', {}, {}, 1)])),
    ).toEqual(['follow×1', 'follow×1']);
  });

  it('a visible event in between splits the row; a hidden one does not (grouping after the filters)', () => {
    const items = [bonk(0), alert('follow', {}, {}, 5), bonk(10)];
    expect(shape(entries(items))).toEqual(['bonk×1', 'follow×1', 'bonk×1']);
    expect(shape(entries(items, readPrefs({ hidden: ['follow'] })))).toEqual([
      'bonk×2',
    ]);
  });

  it('time window: more than 90 s after the last trigger, or 5 min after the first, starts a new row', () => {
    const gap = GROUP_GAP_MS / 1000;
    expect(shape(entries([bonk(0), bonk(gap)]))).toEqual(['bonk×2']);
    expect(shape(entries([bonk(0), bonk(gap + 1)]))).toEqual([
      'bonk×1',
      'bonk×1',
    ]);
    // Every 60 s for 7 min: rows of at most 5 min (0…300 s, then 360…420 s).
    const chain = Array.from({ length: 8 }, (_, i) => bonk(i * 60));
    expect(shape(entries(chain))).toEqual(['bonk×2', 'bonk×6']);
  });

  it('mixed viewers are never one person: « A et B », « A, B +N », all names in the tooltip', () => {
    expect(participants([bonk(1, 'Kev'), bonk(0, 'Kev')]).text).toBe('Kev');
    expect(participants([bonk(1, 'Bob'), bonk(0, 'Ana')]).text).toBe(
      'Ana et Bob',
    );
    expect(
      participants([
        bonk(4, 'Eve'),
        bonk(3, 'Dan'),
        bonk(2, 'Ana'),
        bonk(1, 'Bob'),
        bonk(0, 'Ana'),
      ]),
    ).toEqual({ text: 'Ana, Bob +2', all: ['Ana', 'Bob', 'Dan', 'Eve'] });
    const row = entries([bonk(0, 'Ana'), bonk(1, 'Bob'), bonk(2, 'Cy')])[0];
    expect(rowHtml(row)).toContain('title="Ana, Bob, Cy">Ana, Bob +1<');
  });

  it('a row’s state is the worst of its triggers, with the counts in the tooltip', () => {
    expect(groupState([bonk(1), bonk(0)])).toEqual({
      label: '2 exécutés',
      tone: 'ok',
    });
    expect(
      groupState([
        bonk(2, 'a', { status: 'failed' }),
        bonk(1, 'a', { status: 'queued' }),
        bonk(0),
      ]),
    ).toEqual({ label: '1 exécuté · 1 en attente · 1 en échec', tone: 'bad' });
  });

  it('deterministic: the same rows whatever the arrival order, a status change or a later projection', () => {
    const items = [
      bonk(0, 'a'),
      bonk(30, 'b'),
      sound(40, 'boop'),
      bonk(50, 'c'),
      bonk(200, 'd'),
      ix('tts', 210),
      ix('tts', 400),
    ];
    const ref = keysOf(entries(items));
    const [i0, i1, i2, i3, i4, i5, i6] = items;
    const changed = items.map((a, i) =>
      i === 1 ? { ...a, seq: 99, state: { status: 'failed' } } : a,
    );
    for (const variant of [
      [...items].reverse(),
      [i3, i0, i6, i1, i5, i2, i4],
      changed,
    ])
      expect(keysOf(entries(variant))).toEqual(ref);
    // Same instant, any order: ties broken by key, never by arrival.
    const same = [bonk(500, 'x'), sound(500, 'boop'), bonk(500, 'y')];
    expect(keysOf(entries(same))).toEqual(keysOf(entries([...same].reverse())));
  });

  it('a growing row keeps its key (its place and open detail); loading older history never changes newer rows', () => {
    const a = bonk(0);
    const key = entries([a])[0].key;
    expect(entries([a, bonk(20)])[0].key).toBe(key);
    const recent = [bonk(1000), bonk(1010), alert('follow', {}, {}, 1020)];
    const before = entries(recent).map((r) => r.key);
    const after = entries([bonk(10), bonk(20), ...recent]).map((r) => r.key);
    expect(after.slice(0, before.length)).toEqual(before);
  });
});

describe('preferences', () => {
  it('defaults: everything shown, costs hidden; stored values read defensively', () => {
    expect(readPrefs(null)).toEqual({ hidden: [], costs: false });
    expect(
      readPrefs({ hidden: ['bonk', 'nope', 'bonk', 3], costs: 1 }),
    ).toEqual({ hidden: ['bonk'], costs: false });
    expect(readPrefs({ hidden: 'bonk', costs: true })).toEqual({
      hidden: [],
      costs: true,
    });
  });

  it('a hidden category is filtered from the rows only (the activities stay)', () => {
    const items = [bonk(0), alert('follow', {}, {}, 1)];
    expect(shape(entries(items, readPrefs({ hidden: ['bonk'] })))).toEqual([
      'follow×1',
    ]);
    expect(items).toHaveLength(2);
  });
});

describe('time, order and the stream', () => {
  it('relative times: seconds, minutes, then steps of 5–15 min, hours, days, up to « plus de 15 jours »', () => {
    const ago0 = (sec) => ago(T0 + sec * 1000, at(0));
    expect(ago0(10)).toBe('il y a quelques secondes');
    expect(ago0(90)).toBe('il y a quelques minutes');
    expect(ago0(5 * 60)).toBe('il y a 5 minutes');
    expect(ago0(9 * 60)).toBe('il y a 5 minutes');
    expect(ago0(12 * 60)).toBe('il y a 10 minutes');
    expect(ago0(25 * 60)).toBe('il y a 20 minutes');
    expect(ago0(50 * 60)).toBe('il y a 45 minutes');
    expect(ago0(3600)).toBe('il y a 1 heure');
    expect(ago0(5 * 3600)).toBe('il y a 5 heures');
    expect(ago0(26 * 3600)).toBe('il y a 1 jour');
    expect(ago0(15 * 86400)).toBe('il y a 15 jours');
    expect(ago0(16 * 86400)).toBe('il y a plus de 15 jours');
    expect(ago0(-5)).toBe('il y a quelques secondes');
  });

  it('newest first; same time: the later projection first', () => {
    const a = { occurred_at: '2026-10-27T20:00:00Z', seq: 1 };
    const b = { occurred_at: '2026-10-27T20:00:01Z', seq: 2 };
    const c = { occurred_at: '2026-10-27T20:00:01Z', seq: 3 };
    expect([a, b, c].sort(byRecency)).toEqual([c, b, a]);
  });

  it('server-sent events across chunks; comments (heartbeats) ignored', () => {
    let buf = 'retry: 3000\n\n: ping\n\nevent: upsert\ndata: {"a"';
    let out = parseSse(buf);
    expect(out.events).toEqual([]);
    buf = out.rest + ':1}\n\nevent: status\ndata: {"b":2}\n\n';
    out = parseSse(buf);
    expect(out.events).toEqual([
      { type: 'upsert', data: '{"a":1}' },
      { type: 'status', data: '{"b":2}' },
    ]);
    expect(out.rest).toBe('');
  });
});

describe('Studio’s « Dock OBS » panel', () => {
  const info = {
    available: true,
    reason: null,
    url: 'http://127.0.0.1:4110/#key=SECRETKEY123',
    clients: 1,
    feed: { state: 'live', error: null },
  };
  it('the key is hidden until « Afficher »; the URL is still the one copied', () => {
    expect(dockPanelView(info, null)).toContain('#key=••••••••');
    expect(dockPanelView(info, null)).not.toContain('SECRETKEY123');
    expect(dockPanelView(info, null, true)).toContain('SECRETKEY123');
    expect(dockPanelView(info, null)).toContain('Flux en direct');
    expect(dockPanelView(info, null)).toContain('1 dock(s) ouvert(s)');
  });
  it('unavailable: why', () => {
    expect(
      dockPanelView(
        { available: false, reason: 'port_in_use', url: null },
        null,
      ),
    ).toContain('port est déjà utilisé');
    expect(dockPanelView(null, 'HTTP 500')).toContain(
      'Dock indisponible : HTTP 500',
    );
  });
});
