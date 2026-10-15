-- Bonk VNext lot 5 (Salves): a salve = N individual Bonks admitted and paid in one transaction. Each
-- shot keeps its own row, delivery, ACK and refund; these columns only link the shots of one salve.
-- Additive: existing rows (single Bonks) keep the four columns null.
-- The bounds (shots per salve, cadence) are Core rules (BONK_LAB_RULES), not frozen here.
alter table bonk_lab_interactions
  add column volley_id uuid,
  add column volley_index smallint,
  add column volley_count smallint,
  add column cadence_ms integer,
  add constraint bonk_lab_interactions_volley_check check (
    (volley_id is null and volley_index is null and volley_count is null and cadence_ms is null)
    or (volley_id is not null and volley_count >= 1 and volley_index >= 0 and volley_index < volley_count
        and cadence_ms > 0)
  );

-- One shot per position in a salve.
create unique index bonk_lab_interactions_volley_idx on bonk_lab_interactions (volley_id, volley_index)
  where volley_id is not null;
