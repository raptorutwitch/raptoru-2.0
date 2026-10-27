import { describe, expect, it } from 'vitest';
import {
  ago,
  byRecency,
  esc,
  folded,
  groupOf,
  money,
  parseSse,
  recipientsByGift,
  replayable,
  rowHtml,
  stateOf,
  what,
  who,
} from '../dock-page/dock-view.js';
import { dockPanelView } from '../../web/src/dock-panel.ts';

// Dock OBS V1 (docs/OBS_DOCK.md) — the dock page's pure part: what each activity says (French, compact), its state,
// when the replay button shows, viewer text never inserted as HTML (pseudos, messages, reward titles), long texts,
// the stream parser, and Studio's panel (the key hidden by default).

const alert = (type, data = {}, state = {}) => ({
  activity_key: `alert:twitch:${type}`,
  kind: 'alert',
  type,
  occurred_at: '2026-10-27T20:00:00.000Z',
  data: { actor: { id: '1', login: 'alice', display_name: 'Alice' }, ...data },
  state: {
    outcome: 'queued',
    alert_id: '00000000-0000-4000-8000-000000000001',
    alert_status: 'completed',
    ...state,
  },
  seq: 1,
});
const reward = (state = {}, data = {}) => ({
  activity_key: 'cp:twitch:r1',
  kind: 'channel_points',
  type: 'reward',
  occurred_at: '2026-10-27T20:00:00.000Z',
  data: {
    actor: { id: '7', login: 'bob', name: 'Bob' },
    reward: { id: 'x', title: 'Hydrate', cost: 500 },
    ...data,
  },
  state: { status: 'done', twitch_status: 'FULFILLED', ...state },
  seq: 2,
});

describe('what each activity says', () => {
  it('every type, compact and in French', () => {
    expect(what(alert('follow'))).toBe('suit la chaîne');
    expect(what(alert('sub', { tier: '1000' }))).toBe('s’abonne · Tier 1');
    expect(what(alert('resub', { tier: 'prime', months: 14 }))).toBe(
      'se réabonne · Prime · 14 mois',
    );
    expect(
      what(
        alert('gift_targeted', {
          recipient: { login: 'carl', display_name: 'Carl' },
          tier: '2000',
        }),
      ),
    ).toBe('offre un abo à Carl · Tier 2');
    expect(what(alert('gift_community', { count: 5, tier: '1000' }))).toBe(
      'offre 5 abos · Tier 1',
    );
    expect(what(alert('gift_community', { count: 1 }))).toBe('offre 1 abo');
    expect(what(alert('bits', { bits: 1 }))).toBe('1 bit');
    expect(what(alert('bits', { bits: 1500 }))).toBe('1 500 bits');
    expect(what(alert('raid', { viewers: 42 }))).toBe('raid · 42 viewers');
    expect(what(reward())).toBe('Hydrate · 500 pts');
  });

  it('donations in their own currency, never converted', () => {
    expect(money({ value: 500, decimal_place: 2, currency: 'EUR' })).toMatch(
      /^5,00\s€$/,
    );
    expect(money({ value: 1999, decimal_place: 2, currency: 'USD' })).toMatch(
      /19,99\s\$US/,
    );
    expect(
      what(
        alert('donation', {
          amount: { value: 1000, decimal_place: 2, currency: 'EUR' },
        }),
      ),
    ).toMatch(/^don · 10,00\s€$/);
    expect(money(undefined)).toBe('');
  });

  it('who: the display name, else the login; anonymous gifts / donations say so', () => {
    expect(who(alert('follow'))).toBe('Alice');
    expect(who(reward())).toBe('Bob');
    expect(
      who(alert('gift_community', { anonymous: true, actor: undefined })),
    ).toBe('Anonyme');
  });

  it('groups for the filters', () => {
    expect(
      ['follow', 'resub', 'gift_recipient', 'bits', 'raid', 'donation'].map(
        (t) => groupOf({ type: t }),
      ),
    ).toEqual(['follow', 'sub', 'gift', 'bits', 'raid', 'donation']);
    expect(groupOf(reward())).toBe('reward');
  });
});

describe('states and the replay button', () => {
  it('alert: played / waiting / failed / no animation (below threshold, in a batch); a replay waiting', () => {
    expect(stateOf(alert('follow'))).toEqual({ label: 'jouée', tone: 'ok' });
    expect(stateOf(alert('follow', {}, { alert_status: 'queued' }))).toEqual({
      label: 'en attente',
      tone: 'wait',
    });
    expect(stateOf(alert('follow', {}, { alert_status: 'failed' }))).toEqual({
      label: 'échec',
      tone: 'bad',
    });
    expect(
      stateOf(
        alert(
          'bits',
          {},
          { outcome: 'below_threshold', alert_id: null, alert_status: null },
        ),
      ),
    ).toEqual({ label: 'sous le seuil', tone: 'muted' });
    expect(
      stateOf(
        alert('gift_recipient', {}, { outcome: 'absorbed', alert_id: null }),
      ),
    ).toEqual({ label: 'dans un lot', tone: 'muted' });
    expect(
      stateOf(alert('sub', {}, { replay: { status: 'queued', count: 1 } })),
    ).toEqual({ label: 'rejeu en attente', tone: 'wait' });
  });

  it('redemption: Raptoru’s processing; cancelled on Twitch shown as such', () => {
    expect(stateOf(reward())).toEqual({ label: 'faite', tone: 'ok' });
    expect(stateOf(reward({ status: 'failed' }))).toEqual({
      label: 'échec',
      tone: 'bad',
    });
    expect(
      stateOf(reward({ twitch_status: 'CANCELED', status: 'done' })),
    ).toEqual({ label: 'annulée sur Twitch', tone: 'muted' });
  });

  it('the replay shows only for an alert that played (or failed / expired), with nothing waiting; never a redemption', () => {
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
        alert(
          'bits',
          {},
          { outcome: 'below_threshold', alert_id: null, alert_status: null },
        ),
      ),
    ).toBe(false);
    expect(replayable(reward())).toBe(false);
    expect(rowHtml(alert('follow'))).toContain('data-replay=');
    expect(rowHtml(reward())).not.toContain('data-replay=');
    expect(rowHtml(alert('follow'), { confirm: true })).toContain('Rejouer ?');
  });
});

describe('viewer text is never HTML', () => {
  const evil = '<img src=x onerror=alert(1)>"\'`&';
  it('pseudos, messages, reward titles, recipients: escaped everywhere (row, preview, detail)', () => {
    const rows = [
      rowHtml(
        alert('donation', {
          actor: { login: 'x', display_name: evil },
          message: evil,
          amount: { value: 1, decimal_place: 0, currency: 'EUR' },
        }),
        { open: true },
      ),
      rowHtml(alert('donation', { message: evil })),
      rowHtml(reward({}, { reward: { title: evil, cost: 1 }, message: evil })),
      rowHtml(
        alert('gift_targeted', {
          recipient: { login: 'r', display_name: evil },
        }),
      ),
      rowHtml(alert('follow', { actor: { login: evil, display_name: '' } }), {
        open: true,
      }),
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

  it('a very long name and message stay one line in the row (CSS ellipsis), whole in the detail', () => {
    const long = 'a'.repeat(5000);
    const row = rowHtml(
      alert('donation', {
        actor: { login: 'x', display_name: long },
        message: long,
      }),
    );
    expect(row).toContain('class="who"');
    expect(row).toContain('class="l3"');
    const open = rowHtml(alert('donation', { message: long }), { open: true });
    expect(open).toContain('class="msg-full"');
    expect(open).not.toContain('class="l3"');
  });
});

describe('time, order and the stream', () => {
  it('relative times', () => {
    const t = Date.parse('2026-10-27T20:00:00Z');
    expect(ago(t + 10_000, '2026-10-27T20:00:00Z')).toBe('à l’instant');
    expect(ago(t + 5 * 60_000, '2026-10-27T20:00:00Z')).toBe('5 min');
    expect(ago(t + 3 * 3600_000, '2026-10-27T20:00:00Z')).toBe('3 h');
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

describe('community gifts: one row per batch, recipients folded into it', () => {
  it('absorbed recipients linked by community_gift_id are folded and listed in the gift’s detail (escaped)', () => {
    const gift = alert('gift_community', {
      count: 2,
      community_gift_id: 'cg-1',
    });
    const r1 = alert(
      'gift_recipient',
      { actor: { login: 'a', display_name: 'Ana' }, community_gift_id: 'cg-1' },
      { outcome: 'absorbed', alert_id: null },
    );
    const r2 = alert(
      'gift_recipient',
      {
        actor: { login: 'b', display_name: '<b>Bo</b>' },
        community_gift_id: 'cg-1',
      },
      { outcome: 'absorbed', alert_id: null },
    );
    const lone = alert(
      'gift_recipient',
      { actor: { login: 'c', display_name: 'Cy' } },
      { outcome: 'absorbed', alert_id: null },
    );
    expect([gift, r1, r2, lone].map(folded)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    const map = recipientsByGift([gift, r1, r2, lone]);
    expect(map.get('cg-1')).toEqual(['Ana', '<b>Bo</b>']);
    const html = rowHtml(gift, { open: true, recipients: map.get('cg-1') });
    expect(html).toContain('Reçus par');
    expect(html).toContain('Ana, &lt;b&gt;Bo&lt;/b&gt;');
  });
});
