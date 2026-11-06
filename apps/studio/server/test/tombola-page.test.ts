import { describe, expect, it } from 'vitest';
import {
  cmdProblem,
  filterHistory,
  groupHistory,
  histState,
  nextRoundLook,
  pickCurrency,
  type Config,
  type HistoryItem,
  type Status,
} from '../../web/src/pages/tombola-model.js';

// Page Tombola : ce que la page présente ou prévient sans attendre le Core. Monnaie à l'unité, commandes, lecture de l'historique
// (ce stream d'abord, filtres), et la manche d'aperçu donnée au vrai overlay.

const config = (over: Partial<Config> = {}) =>
  ({
    currency_id: 'tokens',
    amount_mode: 'random',
    fixed_amount: 25_000,
    prize: 'Un lot',
    duration_s: 60,
    random: {
      step: 500,
      bands: [
        { from: 5_000, to: 20_000, pct: 78 },
        { from: 20_000, to: 50_000, pct: 22 },
      ],
    },
    super: {
      enabled: true,
      one_in: 400,
      jackpot: 200_000,
      currency_id: 'tokens',
    },
    join_commands: ['!join', '!enter'],
    cancel_commands: ['!annuletombola'],
    overlay_hint: { mode: 'join', text: '' },
    labels: {},
    display: { join_feedback_ms: 1400 },
    ...over,
  }) as unknown as Config;

const round = (over: Partial<HistoryItem> = {}) =>
  ({
    raffle_id: 'r',
    status: 'finished',
    kind: 'normal',
    amount: 1000,
    currency: { id: 'tokens', label: 'Jetons', short_label: 'J' },
    prize: null,
    origin: 'manual',
    outcome: 'winners',
    is_full: false,
    opened_at: '2026-11-06T20:00:00.000Z',
    cancelled_at: null,
    session_id: null,
    participants: 3,
    winners: [
      {
        viewer_id: '1',
        display_name: 'Zelda',
        amount: 1000,
        payout_status: 'paid',
      },
    ],
    payouts: { paid: 1, failed: 0 },
    ...over,
  }) as HistoryItem;

describe('Tombola, monnaie à l’unité', () => {
  it('Bonbons : jamais un montant taillé pour les Jetons, ni des tranches en Jetons', () => {
    const c = config();
    pickCurrency(c, 'bonbons');
    expect(c).toMatchObject({
      currency_id: 'bonbons',
      amount_mode: 'fixed',
      fixed_amount: 10,
    });
  });
  it('une autre monnaie garde le mode et le montant', () => {
    const c = config();
    pickCurrency(c, 'credits_tts');
    expect(c).toMatchObject({ amount_mode: 'random', fixed_amount: 25_000 });
  });
});

describe('Tombola, commandes', () => {
  it('refuse une commande mal formée, en double, ou déjà dans l’autre liste', () => {
    const c = config();
    expect(cmdProblem(c, 'join_commands', '!a b')).not.toBe('');
    expect(cmdProblem(c, 'join_commands', '!enter')).toContain('déjà');
    expect(cmdProblem(c, 'join_commands', '!annuletombola')).toContain(
      'd’annulation',
    );
    expect(cmdProblem(c, 'join_commands', '!ticket')).toBe('');
    // En modifiant une commande, elle ne se gêne pas elle-même.
    expect(cmdProblem(c, 'join_commands', '!enter', 1)).toBe('');
  });
});

describe('Tombola, historique', () => {
  it('lit l’état d’une manche, un échec de paiement avant tout le reste', () => {
    expect(histState(round())).toBe('paid');
    expect(histState(round({ payouts: { paid: 0, failed: 1 } }))).toBe(
      'failed',
    );
    expect(histState(round({ status: 'cancelled' }))).toBe('cancelled');
    expect(histState(round({ outcome: 'no_participants' }))).toBe('empty');
    expect(histState(round({ status: 'open' }))).toBe('running');
    expect(histState(round({ kind: 'giveaway' }))).toBe('give');
  });
  it('filtre par nature et cherche un gagnant ou un lot', () => {
    const list = [
      round({ raffle_id: 'a' }),
      round({ raffle_id: 'b', kind: 'super' }),
      round({ raffle_id: 'c', is_full: true }),
      round({ raffle_id: 'd', origin: 'automatic' }),
      round({ raffle_id: 'e', status: 'cancelled', winners: [] }),
      round({ raffle_id: 'f', payouts: { paid: 0, failed: 2 } }),
      round({
        raffle_id: 'g',
        kind: 'giveaway',
        prize: 'Clavier',
        winners: [],
      }),
    ];
    const ids = (f: Parameters<typeof filterHistory>[1], q = '') =>
      filterHistory(list, f, q).map((h) => h.raffle_id);
    expect(ids('special')).toEqual(['b', 'c', 'g']);
    expect(ids('auto')).toEqual(['d']);
    expect(ids('cancelled')).toEqual(['e']);
    expect(ids('failed')).toEqual(['f']);
    expect(ids('all', 'clav')).toEqual(['g']);
    expect(ids('failed', 'zel')).toEqual(['f']);
  });
  it('place le stream en cours d’abord, puis jour par jour', () => {
    const today = new Date('2026-11-06T22:00:00');
    const list = [
      round({ raffle_id: 'a', session_id: 's1' }),
      round({ raffle_id: 'b', session_id: 's1' }),
      round({
        raffle_id: 'c',
        session_id: 's0',
        opened_at: '2026-11-06T09:00:00',
      }),
      round({
        raffle_id: 'd',
        session_id: 's0',
        opened_at: '2026-11-05T21:00:00',
      }),
      round({ raffle_id: 'e', opened_at: '2026-11-02T21:00:00' }),
    ];
    expect(
      groupHistory(list, 's1', today).map((g) => [g.label, g.items.length]),
    ).toEqual([
      ['Ce stream', 2],
      ['Aujourd’hui', 1],
      ['Hier', 1],
      ['2 novembre', 1],
    ]);
    expect(groupHistory(list, null, today)[0]!.label).toBe('Aujourd’hui');
  });
});

describe('Tombola, aperçu de la prochaine manche', () => {
  const status = {
    currencies: [{ id: 'tokens', label: 'Jetons', short_label: 'J' }],
    titles: { normal: { name: 'Tombola' }, super: {}, giveaway: {} },
  } as unknown as Status;
  it('un montant aléatoire est un exemple, le dit, et reste sur le pas', () => {
    const l = nextRoundLook(config(), status, false);
    expect(l.example).toBe(true);
    expect(l.snapshot.round.amount).toBe(12_500);
    expect(l.snapshot.round.status).toBe('open');
  });
  it('un montant fixe, un lot et la Super montrent leur vraie valeur', () => {
    const fixed = nextRoundLook(
      config({ amount_mode: 'fixed' }),
      status,
      false,
    );
    expect([fixed.example, fixed.snapshot.round.amount]).toEqual([
      false,
      25_000,
    ]);
    expect(
      nextRoundLook(config({ amount_mode: 'giveaway' }), status, false).snapshot
        .round.kind,
    ).toBe('giveaway');
    const sup = nextRoundLook(config(), status, true);
    expect([sup.example, sup.snapshot.round.amount]).toEqual([false, 200_000]);
  });
});
