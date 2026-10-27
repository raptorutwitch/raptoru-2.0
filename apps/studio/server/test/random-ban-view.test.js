import { describe, expect, it } from 'vitest';
import { randomBanView, rbError } from '../../web/src/random-ban-view.ts';

// Random Ban V2 — Studio section, pure view: names escaped, refund owed said (never claimed done), missing rights
// readable, the fixed rules shown, tests never presented as real.

const base = {
  rules: { duration_sub_s: 180, duration_non_sub_s: 300 },
  executor: {
    login: 'lecroupier_',
    can_search: true,
    can_timeout: false,
    missing: ['lecroupier_: moderator:manage:banned_users'],
  },
  recent: [],
  effects: {
    connected: true,
    audio: true,
    current: true,
    media: [{ id: 'rb-csc', label: 'Random Ban — CSC', available: false }],
  },
};
const row = (over) => ({
  request_id: 'r',
  source: 'channel_points',
  mode: 'real',
  buyer: { id: '1', name: 'Buyer' },
  status: 'confirmed',
  target: { id: '2', name: '<b>T</b>', is_sub: true },
  duration_s: 180,
  error: null,
  refund: 'none',
  stats: { chatters: 10, candidates: 6, follow_checks: 3 },
  animation: 'ban_rm_mirror',
  animation_status: 'completed',
  created_at: '2026-10-18T20:00:00.000Z',
  ...over,
});

describe('Random Ban view', () => {
  it('executor rights, missing media, rules, results with escaped names, refund owed, CSC, tests marked', () => {
    const html = randomBanView(
      {
        ...base,
        recent: [
          row({}),
          row({
            status: 'failed',
            error: 'Twitch 400 : may not be put in a timeout',
            refund: 'needed',
            animation: null,
            animation_status: 'none',
          }),
          row({
            status: 'uncertain',
            error: 'no_answer_after_timeout_request',
            refund: 'to_verify',
          }),
          row({
            target: { id: '1', name: 'Buyer', is_sub: false },
            duration_s: 300,
            animation: 'ban_csc',
          }),
          row({
            status: 'flop',
            target: null,
            duration_s: null,
            animation: 'flop',
          }),
          row({ mode: 'dry_run', status: 'simulated', source: 'test' }),
        ],
      },
      null,
    );
    expect(html).toContain('Timeouts par lecroupier_ : droit manquant');
    expect(html).toContain('moderator:manage:banned_users');
    expect(html).toContain('Médias non importés : Random Ban — CSC');
    expect(html).toContain('3 min pour un abonné, 5 min sinon');
    expect(html).toContain('&lt;b&gt;T&lt;/b&gt; · 3 min (abonné)');
    expect(html).not.toContain('<b>T</b>');
    expect(html).toContain('Rick &amp; Morty (miroir) — affichée');
    expect(html).toContain(
      '<b>Remboursement nécessaire</b> (non effectué : récompense créée par SAMMI)',
    );
    expect(html).toContain(
      '<b>Vérifier sur Twitch</b> avant tout remboursement',
    );
    expect(html).toContain('Buyer (CSC) · 5 min');
    expect(html).toContain('aucun follower éligible');
    expect(html).toContain('(à blanc)');
    expect(html).toContain('Tirage à blanc');
    expect(rbError('executor_absent')).toContain('exécuteur Twitch absent');
    expect(randomBanView({ ...base, executor: null }, null)).toContain(
      'Exécuteur Twitch : absent',
    );
  });
});

describe('Random Ban V3 view', () => {
  const v3 = {
    ...base,
    rules: {
      duration_sub_s: 180,
      duration_non_sub_s: 300,
      buyer_weight: 0.25,
      streamer_per_mille: 20,
      streamer_mute_s: 60,
    },
  };
  it('the rules: buyer 4× rarer, streamer 2 % → 60 s mic mute, caution price', () => {
    const html = randomBanView(
      { ...v3, mic: { input: 'Micro', obs_connected: true, held_by: [] } },
      null,
    );
    expect(html).toContain('4 fois moins souvent');
    expect(html).toContain('2 % des fois');
    expect(html).toContain('coupé 60 s dans OBS');
    expect(html).toContain('300 jetons par tranche de 10 s');
    expect(html).toContain('Mute du streamer : prêt');
    expect(html).toContain('data-act="rb-streamer-mute"');
  });
  it('the mic held by another effect / OBS absent: said; a streamer mute row reads as one', () => {
    const held = randomBanView(
      {
        ...v3,
        mic: {
          input: 'Micro',
          obs_connected: true,
          held_by: ['votekick:mute:1'],
        },
        recent: [
          row({
            streamer_mute: true,
            target: { id: '83603689', name: 'raptoru_', is_sub: null },
            duration_s: 60,
          }),
        ],
      },
      null,
    );
    expect(held).toContain('tenu par : votekick');
    expect(held).toContain('micro de raptoru_ coupé 60 s');
    const off = randomBanView(
      { ...v3, mic: { input: 'Micro', obs_connected: false, held_by: [] } },
      null,
    );
    expect(off).toContain('OBS non connecté');
  });
});

describe('Random Ban V3 view — the streamer trace', () => {
  const v3 = {
    ...base,
    rules: {
      duration_sub_s: 180,
      duration_non_sub_s: 300,
      buyer_weight: 0.25,
      streamer_per_mille: 20,
      streamer_mute_s: 60,
    },
  };
  it('the summary: eligible, drawn, the run since the last win and its chance; reasons; each row its decision', () => {
    const html = randomBanView(
      {
        ...v3,
        streamer_trace: {
          requests: 60,
          traced: 52,
          by_decision: { not_drawn: 49, drawn: 1, obs_not_ready: 2 },
          eligible: 50,
          drawn: 1,
          obs_failed: 0,
          eligible_since_last_drawn: 49,
          luck_pct: 37.159,
        },
        recent: [
          row({
            status: 'flop',
            target: null,
            streamer_decision: { decision: 'not_drawn', draw: 734 },
          }),
          row({
            status: 'flop',
            target: null,
            streamer_decision: {
              decision: 'studio_silent',
              studio_age_ms: 12400,
            },
          }),
        ],
      },
      null,
    );
    expect(html).toContain('éligible 50 fois, tiré 1 fois');
    expect(html).toContain('49 tirage(s) éligible(s) perdu(s)');
    expect(html).toContain('37.159 % de chances par simple malchance (normal)');
    expect(html).toContain('OBS non connecté × 2');
    expect(html).toContain('Streamer : éligible, pas tiré (tirage 734/1000)');
    expect(html).toContain(
      'Streamer : Studio non vu par le Core (vu il y a 12 s)',
    );
  });
  it('a run too long for luck is flagged', () => {
    const html = randomBanView(
      {
        ...v3,
        streamer_trace: {
          requests: 200,
          traced: 200,
          by_decision: { not_drawn: 200 },
          eligible: 200,
          drawn: 0,
          obs_failed: 0,
          eligible_since_last_drawn: 200,
          luck_pct: 1.759,
        },
      },
      null,
    );
    expect(html).toContain(
      'seulement 1.759 % de chances par simple malchance (à signaler)',
    );
  });
});
