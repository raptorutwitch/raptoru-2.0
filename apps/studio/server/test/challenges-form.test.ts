// Studio › Défis (apps/studio/web/src/challenges-model.ts): the form sends exactly the Core's definition (its strict
// schema), and « Modifier » gives the same definition back. Fictional values.
import { ChallengeInput } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  BLANK_FORM,
  challengePayload,
  conditionText,
  formOf,
} from '../../web/src/challenges-model.js';

describe('Défis: the saved definition', () => {
  it('a filled form passes the strict schema; « Modifier » round-trips it', () => {
    const form = {
      ...BLANK_FORM,
      challenge_id: 'fictif-form',
      title: '  Défi fictif ',
      metric: 'words_found',
      target: '1000',
      period: 'week' as const,
      starts_at: '2026-11-09T18:00',
      retroactive: true,
      reward_kind: 'reward' as const,
      reward_id: 'fictif-titre',
      reward_amount: '999', // not sent: the reward is an item
    };
    const body = challengePayload(form);
    expect(ChallengeInput.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      title: 'Défi fictif',
      target: 1000,
      icon: null,
      ends_at: null,
      reward: { kind: 'reward', reward_id: 'fictif-titre' },
    });
    expect(challengePayload(formOf(ChallengeInput.parse(body)))).toEqual(body);
  });

  it('Jetons or nothing; an empty threshold stays invalid (never a silent default)', () => {
    const jetons = challengePayload({
      ...BLANK_FORM,
      challenge_id: 'fictif-j',
      title: 'Fictif',
      metric: 'daily_claims',
      target: '5',
      reward_kind: 'jetons',
      reward_amount: '50',
    });
    expect(jetons.reward).toEqual({ kind: 'jetons', amount: 50 });
    expect(ChallengeInput.safeParse(jetons).success).toBe(true);
    const empty = challengePayload({
      ...BLANK_FORM,
      challenge_id: 'fictif-e',
      title: 'Fictif',
      metric: 'daily_claims',
    });
    expect(empty.reward).toBeNull();
    expect(ChallengeInput.safeParse(empty).success).toBe(false);
  });

  it('the condition in plain French', () => {
    expect(
      conditionText(
        {
          target: 1000,
          period: 'once',
          retroactive: false,
          starts_at: null,
          ends_at: null,
        },
        { label: 'Mots trouvés', unit: 'mots' },
      ),
    ).toBe(
      '1 000 mots : Mots trouvés, une seule fois, à partir de l’activation.',
    );
  });
});
