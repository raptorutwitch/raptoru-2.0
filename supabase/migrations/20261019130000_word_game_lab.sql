-- Jeu des mots V1, Lot 3 (docs/WORD_GAME_PARITY.md §§ 8, 10, 14, 21, 22). Lab only. Core is the source of
-- truth; the chat messages go through cmd_steps (origin word_game, Lot 2). A word occurrence belongs to
-- one live session (lab_stream_sessions): active = status 'active' AND session = the open session.

-- One row per channel: the state of the game for ONE live session (reset when the session changes).
create table word_game_channels (
  channel_id text primary key,
  -- The session this state belongs to (lab_stream_sessions.session_id); null before the first live.
  session_id uuid,
  -- Studio « Arrêter »: no new word for this session (active words stay findable).
  stopped boolean not null default false,
  -- Next word of the cycle (5–15 min); null while stopped or offline.
  next_word_at timestamptz,
  -- The single streak of the channel (§ 8).
  streak_holder_id text,
  streak_holder_name text,
  streak_count integer not null default 0 check (streak_count >= 0),
  -- Streak announcer (§ 10).
  announced_streak integer not null default 0 check (announced_streak >= 0),
  announced_user_id text,
  -- !mots: 1 s for the whole channel.
  mots_at timestamptz,
  updated_at timestamptz not null,
  check ((streak_holder_id is null) = (streak_count = 0))
);

-- Every generated word (occurrence).
create table word_game_words (
  occurrence_id text primary key,
  channel_id text not null,
  session_id uuid not null,
  word text not null,
  shuffled text not null,
  golden boolean not null,
  -- cycle (5–15 min) or manual (Studio « Nouveau mot »).
  source text not null check (source in ('cycle', 'manual')),
  status text not null check (status in ('active', 'found', 'abandoned')),
  created_at timestamptz not null,
  found_at timestamptz,
  found_by_viewer_id text,
  found_message_id text,
  ended_at timestamptz,
  check ((status = 'found') = (found_at is not null)),
  check ((status = 'active') = (ended_at is null))
);
-- Never the same word twice among the active words of a channel (§ 16).
create unique index word_game_words_one_active on word_game_words (channel_id, word)
  where status = 'active';
create index word_game_words_channel on word_game_words (channel_id, created_at desc);

-- One row per winning message, written only with its Wallet credit (same transaction: a refused credit
-- rolls the whole message back): the idempotency barrier (a replayed message_id changes nothing) and the
-- single Wallet credit of the message (§§ 21, 22).
create table word_game_messages (
  channel_id text not null,
  message_id text not null,
  session_id uuid not null,
  viewer_id text not null,
  viewer_display_name text not null,
  words_points bigint not null check (words_points >= 0),
  combo bigint not null check (combo >= 0),
  breaker bigint not null check (breaker >= 0),
  broken_viewer_id text,
  broken_count integer,
  total bigint not null check (total >= 0),
  ledger_id bigint not null,
  created_at timestamptz not null,
  primary key (channel_id, message_id)
);
create index word_game_messages_recent on word_game_messages (channel_id, created_at desc);

-- One row per word found (RET-WORD-005 minimal stats): points of the word (speed and golden included,
-- combo and breaker excluded), like the legacy leaderboard record.
create table word_game_finds (
  occurrence_id text primary key references word_game_words (occurrence_id),
  channel_id text not null,
  message_id text not null,
  session_id uuid not null,
  viewer_id text not null,
  viewer_display_name text not null,
  word text not null,
  points bigint not null check (points >= 0),
  fast boolean not null,
  golden boolean not null,
  streak_after integer not null check (streak_after >= 1),
  created_at timestamptz not null,
  foreign key (channel_id, message_id) references word_game_messages (channel_id, message_id)
);

-- Lab test wallet: Jeu des mots winnings. The Wallet idempotency key (jdm:<channel_id>:<message_id>) is
-- the ledger reason: at most one Jeu des mots credit per winning message.
alter table lab_wallet_ledger drop constraint lab_wallet_ledger_kind_check;
alter table lab_wallet_ledger add constraint lab_wallet_ledger_kind_check
  check (kind in ('set', 'adjust', 'reset', 'debit', 'refund', 'admin', 'raffle_win', 'word_game'));
create unique index lab_wallet_ledger_word_game_once on lab_wallet_ledger (reason)
  where kind = 'word_game';
