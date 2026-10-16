-- Jeu des mots V1, Lot 2 (docs/WORD_GAME_PARITY.md § 19): the durable chat output queue of Commands V2
-- (cmd_steps) also carries the Jeu des mots messages, so the Lab chat executor (LeCroupier_) keeps ONE
-- queue. A Jeu des mots step has no Commands invocation: `origin` says who wrote the step.
-- Unchanged: idempotency_key unique, channel order (seq_global), claim / lease / ACK, statuses, the
-- foreign key of the Commands rows. Existing rows become origin = 'commands' (they all have an invocation).

alter table cmd_steps alter column invocation_id drop not null;

alter table cmd_steps
  add column origin text not null default 'commands'
    check (origin in ('commands', 'word_game')),
  add constraint cmd_steps_origin_invocation
    check ((origin = 'commands') = (invocation_id is not null));
