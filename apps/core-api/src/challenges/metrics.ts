// Défis — the metrics a challenge can count (docs/CHALLENGES.md § 2). Each one is a recount over the table a module
// ALREADY writes in production: its rows are the event journal (one id per event), so a replayed event is never a
// second row, and a refund or a cancelled round simply drops out of the next recount (a negative correction).
// Nothing is estimated: what is not in the table (before the Core existed, free uses…) is not counted.
//
// granularity:
// - 'exact': every event has its own date → any window (a start, an end, a week, a month);
// - 'period': only weekly / monthly totals (progression_period_stats) and a lifetime total (progression_accounts,
//   imported WizeBot history included) exist → a weekly / monthly challenge, or a lifetime one that is retroactive and
//   without dates. Anything else is refused by the validation, never approximated.
//
// SQL contract. exact: $1 channel, $2 from (timestamptz or null = no start), $3 to (null = no end) → (viewer_id, n).
// period: $1 channel, $2 'week' | 'month', $3 period start (date) → (viewer_id, n). lifetime: $1 channel → (viewer_id, n).
// first: $1 channel → (at): the first record the Core holds (shown in Studio as the historical limit).

export interface ChallengeMetric {
  key: string;
  label: string;
  unit: string;
  source: string;
  granularity: 'exact' | 'period';
  /** The source tables (a Core without them cannot count this metric: the Lab has no canonical Wallet, no Daily). */
  tables: string[];
  /** What the history really holds (shown in Studio next to the metric). */
  history: string;
  exact?: string;
  period?: string;
  lifetime?: string;
  first: string;
}

const W = (col: string) =>
  `${col} >= coalesce($2::timestamptz, '-infinity') and ${col} < coalesce($3::timestamptz, 'infinity')`;

const paid = (module: string): ChallengeMetric => ({
  key: `paid_${module}`,
  label: `Utilisations payées : ${module === 'soundboard' ? 'Soundboard' : module === 'tts' ? 'TTS' : 'Bonk'}`,
  unit: 'utilisations',
  source: `Wallet canonique : débits interaction:<id>:debit (source ${module}), remboursés exclus`,
  granularity: 'exact',
  tables: ['wallet_transactions', 'wallet_operations'],
  history:
    'Depuis le Wallet canonique (20/10/2026). Usages gratuits et usages du Lab non comptés.',
  exact: `select t.twitch_user_id as viewer_id, count(*) as n
    from wallet_transactions t join wallet_operations o on o.id = t.operation_id
    where $1::text is not null and t.source = '${module}' and o.idempotency_key like 'interaction:%:debit'
      and t.amount < 0 and ${W('t.created_at')}
      and not exists (select 1 from wallet_operations r
        where r.idempotency_key = left(o.idempotency_key, -6) || ':refund' and r.status = 'applied')
    group by 1`,
  first: `select min(t.created_at) as at from wallet_transactions t join wallet_operations o on o.id = t.operation_id
    where $1::text is not null and t.source = '${module}' and o.idempotency_key like 'interaction:%:debit'`,
});

export const CHALLENGE_METRICS: readonly ChallengeMetric[] = Object.freeze([
  {
    key: 'words_found',
    label: 'Mots trouvés',
    unit: 'mots',
    source: 'Jeu des mots : word_game_finds',
    granularity: 'exact',
    tables: ['word_game_finds'],
    history:
      'Mots trouvés depuis le Core (20/10/2026). L’archive de l’ancien site n’est pas datée par mot : non comptée.',
    exact: `select viewer_id, count(*) as n from word_game_finds where channel_id = $1 and ${W('created_at')} group by 1`,
    first:
      'select min(created_at) as at from word_game_finds where channel_id = $1',
  },
  {
    key: 'words_fast',
    label: 'Mots trouvés rapidement',
    unit: 'mots',
    source: 'Jeu des mots : word_game_finds (fast)',
    granularity: 'exact',
    tables: ['word_game_finds'],
    history: 'Comme « Mots trouvés ».',
    exact: `select viewer_id, count(*) as n from word_game_finds where channel_id = $1 and fast and ${W('created_at')}
      group by 1`,
    first:
      'select min(created_at) as at from word_game_finds where channel_id = $1 and fast',
  },
  {
    key: 'raffle_joins',
    label: 'Participations aux tombolas',
    unit: 'participations',
    source:
      'Tombola : lab_raffle_entries des tirages terminés (retirés et annulés exclus)',
    granularity: 'exact',
    tables: ['lab_raffles', 'lab_raffle_entries'],
    history:
      'Tombolas du Core. Les totaux importés de l’ancien site ne sont pas datés : non comptés.',
    exact: `select e.viewer_id, count(*) as n from lab_raffle_entries e join lab_raffles r using (raffle_id)
      where r.channel_id = $1 and r.status = 'finished' and e.removed_at is null and ${W('r.finished_at')} group by 1`,
    first: `select min(finished_at) as at from lab_raffles where channel_id = $1 and status = 'finished'`,
  },
  {
    key: 'raffle_wins',
    label: 'Tombolas gagnées',
    unit: 'victoires',
    source: 'Tombola : lab_raffle_winners des tirages terminés',
    granularity: 'exact',
    tables: ['lab_raffles', 'lab_raffle_winners'],
    history: 'Comme « Participations aux tombolas ».',
    exact: `select w.viewer_id, count(*) as n from lab_raffle_winners w join lab_raffles r using (raffle_id)
      where r.channel_id = $1 and r.status = 'finished' and ${W('r.finished_at')} group by 1`,
    first: `select min(finished_at) as at from lab_raffles where channel_id = $1 and status = 'finished'`,
  },
  {
    key: 'daily_claims',
    label: 'Daily récupérés',
    unit: 'jours',
    source: 'Daily : daily_claims (historique importé daté inclus)',
    granularity: 'exact',
    tables: ['daily_claims'],
    history:
      'Chaque Daily a sa date, y compris l’historique importé de l’ancien système.',
    exact: `select twitch_user_id as viewer_id, count(*) as n from daily_claims
      where $1::text is not null and ${W('claimed_at')} group by 1`,
    first:
      'select min(claimed_at) as at from daily_claims where $1::text is not null',
  },
  {
    key: 'random_ban_sent',
    label: 'Random Ban lancés (aboutis)',
    unit: 'Random Ban',
    source:
      'Random Ban V3 : rb_requests réels terminés (touché, retourné ou raté)',
    granularity: 'exact',
    tables: ['rb_requests'],
    history:
      'Depuis Random Ban V3 dans le Core. Aucun historique exploitable avant (SAMMI).',
    exact: `select buyer_id as viewer_id, count(*) as n from rb_requests
      where channel_id = $1 and mode = 'real' and status in ('confirmed', 'flop') and ${W('created_at')} group by 1`,
    first: `select min(created_at) as at from rb_requests where channel_id = $1 and mode = 'real'`,
  },
  {
    key: 'random_ban_landed',
    label: 'Random Ban réussis sur un autre viewer',
    unit: 'Random Ban',
    source:
      'Random Ban V3 : rb_requests confirmés dont la cible n’est pas l’acheteur',
    granularity: 'exact',
    tables: ['rb_requests'],
    history: 'Comme « Random Ban lancés ».',
    exact: `select buyer_id as viewer_id, count(*) as n from rb_requests
      where channel_id = $1 and mode = 'real' and status = 'confirmed' and target_id is distinct from buyer_id
        and ${W('created_at')} group by 1`,
    first: `select min(created_at) as at from rb_requests where channel_id = $1 and mode = 'real'`,
  },
  {
    key: 'random_ban_received',
    label: 'Random Ban subis',
    unit: 'Random Ban',
    source: 'Random Ban V3 : rb_requests confirmés lancés par un autre viewer',
    granularity: 'exact',
    tables: ['rb_requests'],
    history: 'Comme « Random Ban lancés ».',
    exact: `select target_id as viewer_id, count(*) as n from rb_requests
      where channel_id = $1 and mode = 'real' and status = 'confirmed' and target_id is not null
        and buyer_id <> target_id and ${W('created_at')} group by 1`,
    first: `select min(created_at) as at from rb_requests where channel_id = $1 and mode = 'real'`,
  },
  paid('bonk'),
  paid('tts'),
  paid('soundboard'),
  {
    key: 'duels_won',
    label: 'Duels gagnés',
    unit: 'duels',
    source: 'Mini-jeux : mini_game_duels résolus',
    granularity: 'exact',
    tables: ['mini_game_duels'],
    history: 'Depuis les duels du Core (20/10/2026).',
    exact: `select winner_id as viewer_id, count(*) as n from mini_game_duels
      where channel_id = $1 and status = 'resolved' and ${W('created_at')} group by 1`,
    first:
      'select min(created_at) as at from mini_game_duels where channel_id = $1',
  },
  {
    key: 'watch_minutes',
    label: 'Temps de présence',
    unit: 'minutes',
    source:
      'Progression : progression_period_stats (semaine, mois) ; progression_accounts (total, import WizeBot inclus)',
    granularity: 'period',
    tables: ['progression_period_stats', 'progression_accounts'],
    history:
      'Totaux par semaine et par mois seulement. Le total à vie inclut l’import WizeBot (non daté).',
    period: `select twitch_user_id as viewer_id, watch_seconds / 60 as n from progression_period_stats
      where channel_id = $1 and period = $2 and period_start = $3::date and watch_seconds >= 60`,
    lifetime: `select twitch_user_id as viewer_id, (watch_seconds + imported_watch_seconds) / 60 as n
      from progression_accounts where channel_id = $1 and watch_seconds + imported_watch_seconds >= 60`,
    first:
      'select min(period_start)::timestamptz as at from progression_period_stats where channel_id = $1',
  },
  {
    key: 'messages',
    label: 'Messages dans le chat',
    unit: 'messages',
    source:
      'Progression : progression_period_stats (semaine, mois) ; progression_accounts (total, import WizeBot inclus)',
    granularity: 'period',
    tables: ['progression_period_stats', 'progression_accounts'],
    history: 'Comme « Temps de présence ».',
    period: `select twitch_user_id as viewer_id, messages as n from progression_period_stats
      where channel_id = $1 and period = $2 and period_start = $3::date and messages > 0`,
    lifetime: `select twitch_user_id as viewer_id, messages + imported_messages as n
      from progression_accounts where channel_id = $1 and messages + imported_messages > 0`,
    first:
      'select min(period_start)::timestamptz as at from progression_period_stats where channel_id = $1',
  },
]);

export const metricOf = (key: string) =>
  CHALLENGE_METRICS.find((m) => m.key === key) ?? null;
