import { describe, expect, it } from 'vitest';
import {
  ago,
  avatarOf,
  byRecency,
  DEFAULT_PREFS,
  detailKind,
  emoteHtml,
  entries,
  esc,
  FAMILIES,
  familyOf,
  FILTER_GROUPS,
  FILTERS,
  folded,
  GROUP_GAP_MS,
  groupState,
  labelOf,
  learnRewards,
  money,
  parseSse,
  participants,
  prefsHtml,
  rangeKeys,
  readPrefs,
  readTrash,
  recipientsByGift,
  replayable,
  rowHtml,
  shownBy,
  stateOf,
  TRASH_DAYS,
  TRASH_MAX,
  trashAdd,
  trashedKeys,
  trashEmpty,
  trashListHtml,
  trashRestore,
  who,
} from '../dock-page/dock-view.js';
import { dockPanelView } from '../../web/src/dock-panel.ts';

// Dock OBS V1.2 (docs/OBS_DOCK.md) — the dock page's pure part: families (identity, filters), labels and notes,
// avatars, compact times, states, the one-click replay button, viewer text never inserted as HTML, the grouping
// (Bonk only, after filters and trash), the detailed preferences (V1.1 carried over, rewards by id), the display trash
// (bounded, restorable, never an event deleted), the selection range, the stream parser and Studio's panel.

const T0 = Date.parse('2026-10-27T20:00:00Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const AV =
  'https://static-cdn.jtvnw.net/jtv_user_pictures/x-profile_image-70x70.png';
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
const reward = (state = {}, data = {}, sec = 0) => ({
  activity_key: `cp:twitch:r${++n}`,
  kind: 'channel_points',
  type: 'reward',
  occurred_at: at(sec),
  data: {
    actor: { id: '7', login: 'bob', name: 'Bob' },
    reward: { id: 'rw-hydrate', title: 'Hydrate', cost: 500 },
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
const hiddenBy = (prefs) => (a) => !shownBy(prefs, a);

describe('families: an identity per kind of event', () => {
  it('every type has its family (its colour class, icon and label); Random Ban and Tombola are apart', () => {
    expect(
      [
        'follow',
        'sub',
        'resub',
        'gift_targeted',
        'gift_community',
        'gift_recipient',
        'bits',
        'raid',
        'donation',
        'reward',
        'tts',
        'soundboard',
        'bonk',
        'random_ban',
        'raffle',
        'mystery',
      ].map((type) => familyOf({ type })),
    ).toEqual([
      'follow',
      'sub',
      'resub',
      'gift',
      'gift',
      'gift',
      'bits',
      'raid',
      'donation',
      'reward',
      'tts',
      'soundboard',
      'bonk',
      'random_ban',
      'raffle',
      'other',
    ]);
    const icons = Object.values(FAMILIES).map((f) => f.icon);
    expect(new Set(icons).size).toBe(icons.length);
    expect(FAMILIES.follow.icon).toBe('heart');
    // The row carries its family class (colour) AND the icon AND the written label.
    const html = rowHtml(one(alert('follow')));
    expect(html).toContain('class="row f-follow');
    expect(html).toContain('fill="currentColor"'); // the filled heart
    expect(html).toContain('>Follow<');
  });

  it('labels and notes: short label on the main line, details in the note', () => {
    expect(labelOf(alert('follow'))).toEqual({ label: 'Follow' });
    expect(labelOf(alert('sub', { tier: '1000' }))).toEqual({
      label: 'Sub',
      note: 'Tier 1',
    });
    expect(labelOf(alert('resub', { tier: 'prime', months: 14 }))).toEqual({
      label: 'Resub',
      note: '14 mois · Prime',
    });
    expect(
      labelOf(
        alert('gift_targeted', {
          recipient: { login: 'carl', display_name: 'Carl' },
          tier: '2000',
        }),
      ),
    ).toEqual({ label: 'Subgift', note: 'à Carl · Tier 2' });
    expect(labelOf(alert('gift_community', { count: 5 })).label).toBe(
      'Subgift × 5',
    );
    expect(labelOf(alert('bits', { bits: 1500 })).label).toBe('1 500 bits');
    expect(labelOf(alert('raid', { viewers: 42 }))).toEqual({
      label: 'Raid',
      note: '42 viewers',
    });
    expect(
      labelOf(
        alert('donation', {
          amount: { value: 1000, decimal_place: 2, currency: 'EUR' },
        }),
      ).label,
    ).toMatch(/^Don 10,00\s€$/);
    expect(labelOf(ix('random_ban', 0, 'K', { target: 'Zed' }))).toEqual({
      label: 'Random Ban',
      note: 'cible : Zed',
    });
    expect(labelOf(ix('raffle', 0)).label).toBe('Tombola');
  });

  it('Soundboard: « SOUNDBOARD » on the main line, the sound’s name as the discreet note', () => {
    const a = sound(0, 'boop', 'Kev');
    expect(labelOf(a)).toEqual({ label: 'Soundboard', note: 'BOOP' });
    const html = rowHtml(one(a));
    expect(html).toMatch(/class="lab-t">Soundboard</);
    expect(html).toContain('class="note" title="BOOP">BOOP<');
  });

  it('a reward shows its real name (own case); its cost only with the preference (off by default)', () => {
    expect(labelOf(reward())).toEqual({
      label: 'Hydrate',
      named: true,
      note: '',
    });
    expect(labelOf(reward(), { ...DEFAULT_PREFS, costs: true }).note).toBe(
      '500 points',
    );
    expect(rowHtml(one(reward()))).toContain('class="lab named"');
    expect(rowHtml(one(reward()))).not.toContain('500');
  });

  it('donations in their own currency, never converted; anonymous says so', () => {
    expect(money({ value: 500, decimal_place: 2, currency: 'EUR' })).toMatch(
      /^5,00\s€$/,
    );
    expect(money({ value: 1999, decimal_place: 2, currency: 'USD' })).toMatch(
      /19,99\s\$US/,
    );
    expect(money(undefined)).toBe('');
    expect(who(reward())).toBe('Bob');
    expect(
      who(alert('gift_community', { anonymous: true, actor: undefined })),
    ).toBe('Anonyme');
  });

  it('the viewer: on the main line, its whole name in the tooltip', () => {
    const long = 'UnNomDeViewerVraimentTrèsLong_2026';
    const html = rowHtml(
      one(
        alert('follow', { actor: { id: '1', login: 'x', display_name: long } }),
      ),
    );
    expect(html).toContain(`<span class="who" title="${long}">${long}</span>`);
  });
});

describe('avatars', () => {
  it('a Twitch picture from the Core’s cache: https on static-cdn.jtvnw.net only', () => {
    const w = (avatar, extra = {}) =>
      alert('follow', {
        actor: { id: '1', display_name: 'Ana', avatar },
        ...extra,
      });
    expect(avatarOf(w(AV))).toBe(AV);
    expect(avatarOf(w('http://static-cdn.jtvnw.net/x.png'))).toBe('');
    expect(avatarOf(w('https://evil.example/x.png'))).toBe('');
    expect(avatarOf(w('javascript:alert(1)'))).toBe('');
    expect(avatarOf(w(undefined))).toBe('');
    expect(avatarOf(w(AV, { anonymous: true }))).toBe('');
  });

  it('the box: always there (fixed size), the initial under the picture, the family icon when no name; a group shows how many viewers', () => {
    const withPic = rowHtml(
      one(
        alert('follow', {
          actor: { id: '1', display_name: 'ana', avatar: AV },
        }),
      ),
    );
    expect(withPic).toContain('<span class="av-ini">A</span>');
    expect(withPic).toContain(`<img class="av-img" src="${AV}"`);
    const none = rowHtml(
      one(alert('follow', { actor: { id: '1', display_name: 'Bo' } })),
    );
    expect(none).toContain('<span class="av-ini">B</span>');
    expect(none).not.toContain('av-img');
    const anon = rowHtml(one(alert('gift_community', { anonymous: true })));
    expect(anon).toContain('av-ic');
    const group = rowHtml(entries([bonk(0, 'Ana'), bonk(5, 'Bob')])[0]);
    expect(group).toContain('<span class="av-n">2</span>');
    expect(group).not.toContain('av-img');
  });
});

describe('states (icons with a tooltip) and the one-click replay', () => {
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

  it('redemption and interactions: processing, failure reason kept for the tooltip, review, refund', () => {
    expect(stateOf(reward({ status: 'failed', reason: 'obs_down' }))).toEqual({
      label: 'Échec du traitement',
      tone: 'bad',
      reason: 'obs_down',
    });
    const s = (state) => stateOf(ix('bonk', 0, 'Kev', {}, state));
    expect(s({ status: 'accepted' }).tone).toBe('wait');
    expect(s({ status: 'execution_unknown' }).tone).toBe('bad');
    expect(s({ status: 'cancelled' }).tone).toBe('muted');
    expect(s({ status: 'queued', review_status: 'pending' }).label).toBe(
      'En attente de validation',
    );
    expect(s({ status: 'failed', refund_status: 'refunded' }).label).toBe(
      'Échec · remboursée',
    );
  });

  it('one button, one click: shown only for a replayable alert; locked while the request runs; a check once accepted', () => {
    expect(replayable(alert('follow'))).toBe(true);
    expect(replayable(alert('follow', {}, { alert_status: 'queued' }))).toBe(
      false,
    );
    expect(
      replayable(
        alert('follow', {}, { replay: { status: 'playing', count: 1 } }),
      ),
    ).toBe(false);
    for (const a of [reward(), bonk(0), ix('tts', 0), sound(0, 'boop')])
      expect(rowHtml(one(a))).not.toContain('data-replay=');
    const idle = rowHtml(one(alert('follow')));
    expect(idle).toContain('data-replay=');
    expect(idle).not.toContain('Rejouer ?'); // no confirmation step any more
    const busy = rowHtml(one(alert('follow')), { busy: true });
    expect(busy).toMatch(/class="act busy"[^>]*disabled/);
    expect(rowHtml(one(alert('follow')), { sent: true })).toContain(
      'class="act sent"',
    );
  });
});

describe('viewer text is never HTML', () => {
  const evil = '<img src=x onerror=alert(1)>"\'`&';
  it('pseudos, messages, reward and sound names, recipients, TTS, panels: escaped everywhere', () => {
    const html = [
      rowHtml(
        one(
          alert('donation', {
            actor: { login: 'x', display_name: evil },
            message: evil,
          }),
        ),
        { open: true },
      ),
      rowHtml(
        one(
          reward(
            {},
            { reward: { id: 'r', title: evil, cost: 1 }, message: evil },
          ),
        ),
      ),
      rowHtml(one(alert('gift_community', { community_gift_id: 'c' })), {
        open: true,
        recipients: [evil],
      }),
      rowHtml(one(ix('tts', 0, evil, { message: evil })), { open: true }),
      rowHtml(one(ix('soundboard', 0, 'k', { sound: { label: evil } }))),
      rowHtml(entries([bonk(0, evil), bonk(1, evil)])[0], { open: true }),
      prefsHtml(readPrefs({ v: 2, rewards: { names: { r: evil } } })),
      trashListHtml(
        entries([ix('tts', 0, evil, { message: evil })]),
        new Set(),
      ),
    ];
    for (const h of html) {
      expect(h).not.toContain('<img src=x');
      expect(h).not.toMatch(/onerror=alert\(1\)>/);
      expect(h).toContain('&lt;img');
    }
    expect(esc(evil)).toBe(
      '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&#96;&amp;',
    );
  });

  it('a Bonk emote picture: https on the emote CDNs only (the CSP list)', () => {
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
    expect(emoteHtml({ type: 'bonk', data: { emote: { glyph: '😀' } } })).toBe(
      '',
    );
  });
});

describe('details: only what the row does not already show', () => {
  it('nothing to open for a follow, a sub, a single Bonk, a sound; members, recipients, a failure reason do', () => {
    for (const a of [
      alert('follow'),
      alert('sub'),
      bonk(0),
      sound(0, 'boop'),
    ]) {
      expect(detailKind(one(a))).toBe(null);
      expect(rowHtml(one(a), { open: true })).not.toContain('class="detail"');
      expect(rowHtml(one(a))).not.toContain('aria-expanded');
    }
    expect(detailKind(entries([bonk(0), bonk(1)])[0])).toBe('members');
    expect(detailKind(one(alert('gift_community')), ['Ana'])).toBe('more');
    expect(detailKind(one(reward({ status: 'failed', reason: 'x' })))).toBe(
      'more',
    );
  });

  it('a viewer text is on the row (one line); the page makes it openable only when cut, and then shows it whole', () => {
    const a = ix('tts', 0, 'K', { message: 'Coucou Raptoru' });
    expect(detailKind(one(a))).toBe('text');
    const row = rowHtml(one(a));
    expect(row).toContain('class="row f-tts has-text"');
    expect(row).toContain('<p class="l3">Coucou Raptoru</p>');
    expect(rowHtml(one(a), { open: true })).toContain('<p class="l3 whole">');
  });
});

describe('grouping: Bonks only', () => {
  it('consecutive Bonks share a row « Bonk × N », members listed newest first; a row keyed by its first Bonk', () => {
    const items = [bonk(0, 'Kev'), bonk(10, 'Kev'), bonk(20, 'Kev')];
    const rows = entries(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(`g:${items[0].activity_key}`);
    expect(rows[0].items).toEqual([...items].reverse());
    const html = rowHtml(rows[0], { open: true });
    expect(html).toContain('Bonk × 3');
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('never grouped any more: TTS (even from two viewers), Soundboard (even the same sound), Random Ban, Tombola, rewards, alerts', () => {
    expect(shape(entries([ix('tts', 0, 'A'), ix('tts', 5, 'B')]))).toEqual([
      'tts×1',
      'tts×1',
    ]);
    expect(shape(entries([sound(0, 'boop'), sound(5, 'boop')]))).toEqual([
      'soundboard×1',
      'soundboard×1',
    ]);
    expect(shape(entries([ix('random_ban', 0), ix('random_ban', 5)]))).toEqual([
      'random_ban×1',
      'random_ban×1',
    ]);
    expect(shape(entries([ix('raffle', 0), ix('raffle', 5)]))).toEqual([
      'raffle×1',
      'raffle×1',
    ]);
    expect(shape(entries([reward({}, {}, 0), reward({}, {}, 5)]))).toEqual([
      'reward×1',
      'reward×1',
    ]);
    expect(
      shape(entries([alert('follow', {}, {}, 0), alert('follow', {}, {}, 1)])),
    ).toEqual(['follow×1', 'follow×1']);
  });

  it('a visible event in between splits the salve; a filtered or trashed one does not', () => {
    const f = alert('follow', {}, {}, 5);
    const items = [bonk(0), f, bonk(10)];
    expect(shape(entries(items))).toEqual(['bonk×1', 'follow×1', 'bonk×1']);
    expect(
      shape(entries(items, hiddenBy(readPrefs({ v: 2, hidden: ['follow'] })))),
    ).toEqual(['bonk×2']);
    expect(shape(entries(items, (a) => a === f))).toEqual(['bonk×2']);
  });

  it('time window: more than 90 s after the last Bonk, or 5 min after the first, starts a new row', () => {
    const gap = GROUP_GAP_MS / 1000;
    expect(shape(entries([bonk(0), bonk(gap)]))).toEqual(['bonk×2']);
    expect(shape(entries([bonk(0), bonk(gap + 1)]))).toEqual([
      'bonk×1',
      'bonk×1',
    ]);
    const chain = Array.from({ length: 8 }, (_, i) => bonk(i * 60));
    expect(shape(entries(chain))).toEqual(['bonk×2', 'bonk×6']);
  });

  it('several viewers are never one person: « A et B », « A, B +N » and « N viewers »', () => {
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
    const html = rowHtml(
      entries([bonk(0, 'Ana'), bonk(1, 'Bob'), bonk(2, 'Cy')])[0],
    );
    expect(html).toContain('title="Ana, Bob, Cy">Ana, Bob +1<');
    expect(html).toContain('3 viewers');
    expect(
      groupState([
        bonk(2, 'a', { status: 'failed' }),
        bonk(1, 'a', { status: 'queued' }),
        bonk(0),
      ]),
    ).toEqual({
      label: '1 exécuté · 1 en attente · 1 en échec',
      tone: 'bad',
    });
  });

  it('deterministic: the same rows whatever the arrival order, a reconnection (duplicates) or a status change', () => {
    const items = [
      bonk(0, 'a'),
      bonk(30, 'b'),
      sound(40, 'boop'),
      bonk(50, 'c'),
      bonk(200, 'd'),
      ix('tts', 210),
    ];
    const ref = keysOf(entries(items));
    const [i0, i1, i2, i3, i4, i5] = items;
    const changed = items.map((a, i) =>
      i === 1 ? { ...a, seq: 99, state: { status: 'failed' } } : a,
    );
    for (const variant of [
      [...items].reverse(),
      [i3, i0, i5, i1, i4, i2],
      changed,
    ])
      expect(keysOf(entries(variant))).toEqual(ref);
    const same = [bonk(500, 'x'), sound(500, 'boop'), bonk(500, 'y')];
    expect(keysOf(entries(same))).toEqual(keysOf(entries([...same].reverse())));
  });

  it('a growing salve keeps its key; loading older history never changes newer rows', () => {
    const a = bonk(0);
    const key = entries([a])[0].key;
    expect(entries([a, bonk(20)])[0].key).toBe(key);
    const recent = [bonk(1000), bonk(1010), alert('follow', {}, {}, 1020)];
    const before = entries(recent).map((r) => r.key);
    const after = entries([bonk(10), bonk(20), ...recent]).map((r) => r.key);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('community gifts: one business event with its recipients (folded, listed in its detail)', () => {
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
  });
});

describe('preferences', () => {
  it('defaults: everything shown, costs hidden; the 13 filters in 3 groups', () => {
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(FILTERS).toEqual([
      'follow',
      'sub',
      'resub',
      'gift',
      'bits',
      'raid',
      'donation',
      'reward',
      'tts',
      'soundboard',
      'bonk',
      'random_ban',
      'raffle',
    ]);
    expect(FILTER_GROUPS.map((g) => g.id)).toEqual([
      'channel',
      'points',
      'raptoru',
    ]);
  });

  it('V1.1 preferences carried over: « Abos et cadeaux » → Subs, Resubs, Subgifts; « Tombola et Random Ban » → both', () => {
    expect(
      readPrefs({ hidden: ['sub', 'internal', 'bonk', 'nope'], costs: true }),
    ).toEqual({
      v: 2,
      hidden: ['sub', 'resub', 'gift', 'random_ban', 'raffle', 'bonk'],
      costs: true,
      rewards: { hidden: [], names: {} },
    });
    // V1.2 values read as they are, defensively.
    expect(
      readPrefs({
        v: 2,
        hidden: ['raffle', 'internal', 3],
        costs: 1,
        rewards: { hidden: ['r1', 2], names: { r1: 'X', r2: 4 } },
      }),
    ).toEqual({
      v: 2,
      hidden: ['raffle'],
      costs: false,
      rewards: { hidden: ['r1'], names: { r1: 'X' } },
    });
  });

  it('each filter independently: Random Ban without Tombola, Subgifts without Subs', () => {
    const p = readPrefs({ v: 2, hidden: ['random_ban', 'gift'] });
    expect(shownBy(p, ix('random_ban', 0))).toBe(false);
    expect(shownBy(p, ix('raffle', 0))).toBe(true);
    expect(shownBy(p, alert('gift_community'))).toBe(false);
    expect(shownBy(p, alert('sub'))).toBe(true);
    expect(shownBy(p, alert('resub'))).toBe(true);
  });

  it('rewards one by one, by their stable id: a renamed reward keeps its choice; the others stay shown', () => {
    const p = readPrefs({ v: 2, rewards: { hidden: ['rw-hydrate'] } });
    expect(shownBy(p, reward())).toBe(false);
    expect(
      shownBy(
        p,
        reward(
          {},
          { reward: { id: 'rw-hydrate', title: 'Bois de l’eau', cost: 1 } },
        ),
      ),
    ).toBe(false);
    expect(
      shownBy(
        p,
        reward({}, { reward: { id: 'rw-other', title: 'Hydrate', cost: 1 } }),
      ),
    ).toBe(true);
    // The rewards seen are learned (id → last title), most recent kept; nothing new: the same object.
    const learned = learnRewards(DEFAULT_PREFS, [
      reward(),
      reward({}, { reward: { id: 'rw-2', title: 'Musique', cost: 9 } }),
    ]);
    expect(learned.rewards.names).toEqual({
      'rw-hydrate': 'Hydrate',
      'rw-2': 'Musique',
    });
    expect(learnRewards(learned, [reward()])).toBe(learned);
    const renamed = learnRewards(learned, [
      reward({}, { reward: { id: 'rw-hydrate', title: 'Eau', cost: 1 } }),
    ]);
    expect(renamed.rewards.names['rw-hydrate']).toBe('Eau');
  });

  it('the panel: groups with a box each, the filters, the rewards by id, the costs option', () => {
    const p = learnRewards(
      readPrefs({
        v: 2,
        hidden: ['raffle'],
        rewards: { hidden: ['rw-hydrate'] },
      }),
      [reward()],
    );
    const html = prefsHtml(p);
    for (const f of FILTERS) expect(html).toContain(`data-filter="${f}"`);
    expect(html).toMatch(/data-filter="raffle"><span>/); // unchecked
    expect(html).toMatch(/data-filter="random_ban" checked>/);
    expect(html).toMatch(/data-group="raptoru" data-mixed="1"/);
    expect(html).toMatch(/data-reward="rw-hydrate">/); // unchecked
    expect(html).toContain('Récompenses une par une (1)');
    expect(html).toContain('id="costs"');
  });

  it('a hidden family or reward is filtered from the rows only (the activities stay)', () => {
    const items = [bonk(0), alert('follow', {}, {}, 1), reward({}, {}, 2)];
    const p = readPrefs({
      v: 2,
      hidden: ['bonk'],
      rewards: { hidden: ['rw-hydrate'] },
    });
    expect(shape(entries(items, hiddenBy(p)))).toEqual(['follow×1']);
    expect(items).toHaveLength(3);
  });
});

describe('the display trash: hidden from this dock, never deleted', () => {
  const NOW = T0 + 3_600_000;
  it('hiding, restoring one or all, emptying (still hidden, no longer restorable)', () => {
    let t = readTrash(null, NOW);
    t = trashAdd(t, ['a', 'b'], NOW);
    t = trashAdd(t, ['c'], NOW + 1);
    expect(t.items.map((x) => x.k)).toEqual(['c', 'a', 'b']);
    expect([...trashedKeys(t)].sort()).toEqual(['a', 'b', 'c']);
    t = trashRestore(t, ['a']);
    expect(t.items.map((x) => x.k)).toEqual(['c', 'b']);
    t = trashEmpty(t, NOW + 2);
    expect(t.items).toEqual([]);
    expect([...trashedKeys(t)].sort()).toEqual(['b', 'c']);
    // Hidden again later: back in the restorable trash, once.
    t = trashAdd(t, ['b'], NOW + 3);
    expect(t.items.map((x) => x.k)).toEqual(['b']);
    expect(t.purged.map((x) => x.k)).toEqual(['c']);
    expect(trashRestore(t).items).toEqual([]);
  });

  it('bounded: older than the dock’s history, beyond the cap, malformed entries — dropped', () => {
    const old = { k: 'old', at: NOW - (TRASH_DAYS + 1) * 86400_000 };
    const t = readTrash(
      {
        items: [
          old,
          { k: 'x', at: NOW },
          { k: 1 },
          null,
          { k: 'x', at: NOW - 5 },
        ],
        purged: 'nope',
      },
      NOW,
    );
    expect(t).toEqual({ items: [{ k: 'x', at: NOW }], purged: [] });
    const many = Array.from({ length: TRASH_MAX + 50 }, (_, i) => `k${i}`);
    expect(trashAdd(readTrash(null, NOW), many, NOW).items).toHaveLength(
      TRASH_MAX,
    );
  });

  it('a hidden Bonk salve: all its Bonks are hidden; a reshuffled salve (reconnection) never shows a hidden one again', () => {
    const items = [bonk(0, 'a'), bonk(5, 'b'), bonk(10, 'c')];
    const salve = entries(items)[0];
    const hidden = trashedKeys(
      trashAdd(
        readTrash(null, NOW),
        salve.items.map((a) => a.activity_key),
        NOW,
      ),
    );
    const skip = (a) => hidden.has(a.activity_key);
    expect(entries(items, skip)).toEqual([]);
    // Same Bonks again, plus a new one, in another order: only the new one shows.
    const fresh = bonk(12, 'd');
    expect(
      entries([items[2], fresh, items[0], items[1]], skip).map((r) => r.items),
    ).toEqual([[fresh]]);
  });

  it('the trash panel: a salve stays together with its Bonks under it, each with its box', () => {
    const rows = entries([bonk(0, 'Ana'), bonk(5, 'Bob'), ix('tts', 60, 'Cy')]);
    const checked = new Set([rows[1].items[0].activity_key]);
    const html = trashListHtml(rows, checked, T0 + 120_000);
    expect(html).toContain('Bonk × 2');
    expect(html.match(/data-tkey=/g)).toHaveLength(2);
    expect(html).toMatch(/data-tkeys="[^"]+ [^"]+" data-mixed="1"/);
    expect(html).toContain('TTS');
  });
});

describe('selection', () => {
  it('Shift + clic: the displayed range between the anchor and the row, in either direction', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    expect(rangeKeys(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeKeys(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeKeys(order, 'gone', 'c')).toEqual(['c']);
    expect(rangeKeys(order, 'a', 'gone')).toEqual([]);
  });

  it('a selected row says so (class and aria-selected)', () => {
    const html = rowHtml(one(alert('follow')), { selected: true });
    expect(html).toContain('selected');
    expect(html).toContain('aria-selected="true"');
  });
});

describe('time, order and the stream', () => {
  it('compact times: « à l’instant », then minutes, hours, days — never « il y a »', () => {
    const ago0 = (sec) => ago(T0 + sec * 1000, at(0));
    expect(ago0(10)).toBe('à l’instant');
    expect(ago0(-5)).toBe('à l’instant');
    expect(ago0(3 * 60)).toBe('3 min');
    expect(ago0(12 * 60 + 59)).toBe('12 min');
    expect(ago0(2 * 3600)).toBe('2 h');
    expect(ago0(3 * 86400 + 5)).toBe('3 j');
    expect(rowHtml(one(alert('follow')), { now: T0 })).toContain(
      'title="27/10/2026',
    );
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
  });
  it('unavailable: why', () => {
    expect(
      dockPanelView(
        { available: false, reason: 'port_in_use', url: null },
        null,
      ),
    ).toContain('port est déjà utilisé');
  });
});
