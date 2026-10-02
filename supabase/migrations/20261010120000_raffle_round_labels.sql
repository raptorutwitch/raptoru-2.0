-- Tombola V2 (Lab) — the name a round was created with stays its name.
-- Studio's overlay labels (event name, its agreement, title with no participant) are copied on the
-- round when it opens; renaming the event later only changes the next rounds. Null = the round was
-- created before this column: the automatic names of its kind (« Tombola », « Giveaway »).
alter table lab_raffles add column title_labels jsonb;
