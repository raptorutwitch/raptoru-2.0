// Défis (docs/CHALLENGES.md) — Studio's form ⇄ the Core's definition. Pure, tested by server/test/challenges-form.test.ts.

export type Reward =
  | { kind: 'reward'; reward_id: string }
  | { kind: 'jetons'; amount: number }
  | null;

export interface ChallengeForm {
  challenge_id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  metric: string;
  target: string;
  period: 'once' | 'week' | 'month';
  /** datetime-local values (the PC's clock = Paris), '' = none. */
  starts_at: string;
  ends_at: string;
  retroactive: boolean;
  visibility: 'public' | 'secret';
  reward_kind: 'none' | 'reward' | 'jetons';
  reward_id: string;
  reward_amount: string;
}

export const BLANK_FORM: ChallengeForm = {
  challenge_id: '',
  title: '',
  description: '',
  category: 'general',
  icon: '',
  metric: '',
  target: '',
  period: 'once',
  starts_at: '',
  ends_at: '',
  retroactive: false,
  visibility: 'public',
  reward_kind: 'none',
  reward_id: '',
  reward_amount: '',
};

const pad = (n: number) => String(n).padStart(2, '0');
/** An ISO instant as a datetime-local value in this PC's time zone. */
export function localInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The Core's definition, exactly its strict schema's fields (nothing displayed-only). Invalid numbers stay invalid. */
export function challengePayload(f: ChallengeForm) {
  const reward: Reward =
    f.reward_kind === 'reward'
      ? { kind: 'reward', reward_id: f.reward_id }
      : f.reward_kind === 'jetons'
        ? { kind: 'jetons', amount: Number(f.reward_amount) }
        : null;
  return {
    challenge_id: f.challenge_id.trim(),
    title: f.title.trim(),
    description: f.description.trim(),
    category: f.category.trim() || 'general',
    icon: f.icon.trim() || null,
    metric: f.metric,
    target: Number(f.target),
    period: f.period,
    starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
    ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
    retroactive: f.retroactive,
    visibility: f.visibility,
    reward,
  };
}

/** A definition from the Core, back into the form (« Modifier »). */
export function formOf(d: {
  challenge_id: string;
  title: string;
  description: string;
  category: string;
  icon: string | null;
  metric: string;
  target: number;
  period: 'once' | 'week' | 'month';
  starts_at: string | null;
  ends_at: string | null;
  retroactive: boolean;
  visibility: 'public' | 'secret';
  reward: Reward;
}): ChallengeForm {
  return {
    challenge_id: d.challenge_id,
    title: d.title,
    description: d.description,
    category: d.category,
    icon: d.icon ?? '',
    metric: d.metric,
    target: String(d.target),
    period: d.period,
    starts_at: localInput(d.starts_at),
    ends_at: localInput(d.ends_at),
    retroactive: d.retroactive,
    visibility: d.visibility,
    reward_kind: d.reward?.kind ?? 'none',
    reward_id: d.reward?.kind === 'reward' ? d.reward.reward_id : '',
    reward_amount: d.reward?.kind === 'jetons' ? String(d.reward.amount) : '',
  };
}

/** A plain-French sentence of the condition (the preview and the list). */
export function conditionText(
  d: {
    target: number;
    period: string;
    retroactive: boolean;
    starts_at: string | null;
    ends_at: string | null;
  },
  metric: { label: string; unit: string } | undefined,
) {
  const what = `${new Intl.NumberFormat('fr-FR').format(d.target)} ${metric?.unit ?? ''} — ${metric?.label ?? '?'}`;
  const when =
    d.period === 'week'
      ? 'chaque semaine (lundi → dimanche, heure de Paris)'
      : d.period === 'month'
        ? 'chaque mois'
        : 'une seule fois';
  const from = d.retroactive ? 'historique compté' : 'à partir de l’activation';
  const dates = [
    d.starts_at
      ? `dès le ${new Date(d.starts_at).toLocaleString('fr-FR')}`
      : '',
    d.ends_at ? `jusqu’au ${new Date(d.ends_at).toLocaleString('fr-FR')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${what}, ${when}, ${from}${dates ? `, ${dates}` : ''}.`;
}
