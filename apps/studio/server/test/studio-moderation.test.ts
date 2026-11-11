import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/http.ts';
import {
  isLive,
  marked,
  modAct,
  modErr,
  money,
  pending,
  refundable,
  removal,
  sumCost,
  type ModItem,
} from '../../web/src/mod/mod.ts';
import {
  moduleMatch,
  RESTRICTION_ACTIONS,
} from '../../web/src/pages/moderation-restrictions.ts';

const item = (x: Partial<ModItem> = {}): ModItem => ({
  interaction_id: 'a1',
  viewer_id: '1',
  viewer_display_name: 'V',
  status: 'queued',
  created_at: '2026-11-06T10:00:00Z',
  ...x,
});

describe('la modération de Studio', () => {
  it('une demande à vérifier qui a quitté la file n’attend plus de décision', () => {
    expect(pending(item({ review_status: 'pending' }))).toBe(true);
    expect(
      pending(item({ review_status: 'pending', status: 'cancelled' })),
    ).toBe(false);
  });

  it('couper un TTS en cours et retirer une demande sont deux commandes, chacune avec sa clé', () => {
    const playing = item({ status: 'playing' });
    expect(removal(playing, 'tts', true).command).toEqual({
      action: 'stop_current',
      module: 'tts',
      refund: true,
    });
    expect(removal(item(), 'tts', false).command).toEqual({
      action: 'cancel',
      module: 'tts',
      interaction_id: 'a1',
      refund: false,
    });
    // Rembourser ou non sont deux intentions : le Core refuserait la même clé pour une autre commande.
    expect(removal(item(), 'tts', true).key).not.toBe(
      removal(item(), 'tts', false).key,
    );
    expect(removal(item(), 'tts', true).key.length).toBeGreaterThanOrEqual(8);
  });

  it('la clé d’intention part avec la commande', async () => {
    const f = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', f);
    await modAct({ action: 'refund' }, 'cle-intention');
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      command: { action: 'refund' },
      idempotency_key: 'cle-intention',
    });
    vi.unstubAllGlobals();
  });

  it('seul ce qui est fini, débité et pas encore remboursé se rembourse', () => {
    const paid = { movements: [{ kind: 'debit', amount: -500 }] };
    expect(refundable(item({ status: 'completed', ...paid }), 'tts')).toBe(
      true,
    );
    expect(refundable(item(paid), 'tts')).toBe(false);
    expect(
      refundable(
        item({ status: 'completed', refund_status: 'refunded', ...paid }),
        'tts',
      ),
    ).toBe(false);
    expect(refundable(item({ status: 'completed' }), 'tts')).toBe(false);
    expect(refundable(item({ status: 'completed', ...paid }), 'raffle')).toBe(
      false,
    );
  });

  it('un refus de droits nomme la permission qui manque', () => {
    expect(
      modErr(new ApiError(403, 'forbidden', { grant: 'wallet' })),
    ).toContain('« Portefeuille »');
    expect(
      modErr(new ApiError(403, 'forbidden', { permission: 'grant.sensitive' })),
    ).toContain('Sanctions sensibles');
    expect(
      modErr(new ApiError(403, 'forbidden', { needs: 'broadcaster' })),
    ).toBe('Action réservée au streamer.');
    expect(modErr(new ApiError(409, 'already_refunded'))).toBe(
      'Déjà remboursé.',
    );
  });

  it('un module montre aussi les blocages Tout Raptoru, le filtre Global les seuls', () => {
    expect(moduleMatch('any', 'tts')).toBe(true);
    expect(moduleMatch('tts', 'all')).toBe(true);
    expect(moduleMatch('tts', 'bonk')).toBe(false);
    expect(moduleMatch('all', 'tts')).toBe(false);
    expect(RESTRICTION_ACTIONS).toContain('block_viewer');
  });

  it('les totaux séparent Jetons et crédits, le texte du viewer reste échappé', () => {
    expect(
      sumCost([
        item({ simulated_cost: 500 }),
        item({ simulated_cost: 1, payment_method: 'credits' }),
      ]),
    ).toMatch(/500 J \+ 1 cr/);
    expect(money(item({ module: 'raffle', simulated_cost: 0 }))).toBe(
      'gratuit',
    );
    expect(marked('<b>mot</b>', [{ word: 'mot', start: 3, end: 6 }])).toBe(
      '&lt;b&gt;<mark>mot</mark>&lt;/b&gt;',
    );
    expect(isLive(item({ status: 'failed' }))).toBe(false);
  });
});
